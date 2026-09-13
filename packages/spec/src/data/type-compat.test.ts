// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  canonicalizeSqlType,
  suggestFieldTypeForSqlType,
  isCompatible,
  type SqlDialect,
} from './type-compat';
import { suggestFieldType } from '../shared/suggestions.zod';

describe('canonicalizeSqlType (ADR-0015 §4.6)', () => {
  it('strips length/precision parameters', () => {
    expect(canonicalizeSqlType('varchar(255)')).toBe('text');
    expect(canonicalizeSqlType('numeric(10,2)')).toBe('decimal');
    expect(canonicalizeSqlType('char(1)')).toBe('text');
  });

  it('normalises timezone qualifiers', () => {
    expect(canonicalizeSqlType('timestamp without time zone')).toBe('datetime');
    expect(canonicalizeSqlType('timestamp with time zone')).toBe('datetime');
  });

  it('detects array notation', () => {
    expect(canonicalizeSqlType('text[]')).toBe('array');
    expect(canonicalizeSqlType('_int4')).toBe('array');
  });

  it('applies postgres dialect aliases', () => {
    expect(canonicalizeSqlType('jsonb', 'postgres')).toBe('json');
    expect(canonicalizeSqlType('timestamptz', 'postgres')).toBe('datetime');
    expect(canonicalizeSqlType('int8', 'postgres')).toBe('bigint');
    expect(canonicalizeSqlType('bool', 'postgres')).toBe('boolean');
  });

  it('applies snowflake/bigquery/mongo aliases', () => {
    expect(canonicalizeSqlType('NUMBER', 'snowflake')).toBe('decimal');
    expect(canonicalizeSqlType('VARIANT', 'snowflake')).toBe('json');
    expect(canonicalizeSqlType('INT64', 'bigquery')).toBe('bigint');
    expect(canonicalizeSqlType('STRING', 'bigquery')).toBe('text');
    expect(canonicalizeSqlType('objectId', 'mongo')).toBe('text');
  });

  it('falls back to unknown for unrecognised types', () => {
    expect(canonicalizeSqlType('geography')).toBe('unknown');
    expect(canonicalizeSqlType('')).toBe('unknown');
  });
});

describe('suggestFieldTypeForSqlType', () => {
  it('suggests sensible defaults per canonical type', () => {
    expect(suggestFieldTypeForSqlType('varchar(255)')).toBe('text');
    expect(suggestFieldTypeForSqlType('integer')).toBe('number');
    expect(suggestFieldTypeForSqlType('numeric(10,2)')).toBe('number');
    expect(suggestFieldTypeForSqlType('boolean')).toBe('boolean');
    expect(suggestFieldTypeForSqlType('timestamptz', 'postgres')).toBe('datetime');
    expect(suggestFieldTypeForSqlType('date')).toBe('date');
    expect(suggestFieldTypeForSqlType('jsonb', 'postgres')).toBe('json');
    expect(suggestFieldTypeForSqlType('vector', 'postgres')).toBe('vector');
  });

  it('returns undefined for unknown types', () => {
    expect(suggestFieldTypeForSqlType('geometry')).toBeUndefined();
  });

  // #4539: this mapper and shared/suggestions.zod's `suggestFieldType` used to
  // SHARE the name `suggestFieldType` while being different functions with
  // different signatures, semantics and return types — the worst dual-source
  // shape, since a wrong auto-import compiled (`[]` is truthy where
  // `undefined` was expected) and misbehaved with no type error. These pins
  // encode the divergence that forced the rename; if the two are ever
  // reconciled, delete this block deliberately.
  it('is NOT the typo-suggester: same input, divergent semantics', () => {
    // SQL vocabulary: mapper resolves it, typo-suggester cannot.
    expect(suggestFieldTypeForSqlType('varchar(255)')).toBe('text');
    expect(suggestFieldType('varchar(255)')).toEqual([]);
    // FieldType typo: typo-suggester resolves it, mapper cannot.
    expect(suggestFieldTypeForSqlType('text_area')).toBeUndefined();
    expect(suggestFieldType('text_area')).toEqual(['textarea']);
    // Overlapping input: scalar FieldType vs array of candidates.
    expect(suggestFieldTypeForSqlType('int')).toBe('number');
    expect(suggestFieldType('int')).toEqual(['number']);
  });
});

describe('isCompatible', () => {
  it('returns true for exact mappings', () => {
    expect(isCompatible('varchar(255)', 'text')).toBe(true);
    expect(isCompatible('integer', 'number')).toBe(true);
    expect(isCompatible('boolean', 'toggle')).toBe(true);
    expect(isCompatible('timestamptz', 'datetime', 'postgres')).toBe(true);
    expect(isCompatible('numeric(10,2)', 'currency')).toBe(true);
    expect(isCompatible('jsonb', 'json', 'postgres')).toBe(true);
  });

  // #12117 — the compat table drifted from the platform's own emitted shape.
  // After #11875 (maintainer ruling 2026-08-25) an unbounded TEXT column is
  // what `sql-driver.ts` emits for `signature` / `qrcode`, whose stored value
  // is a string per `STRING_VALUE_TYPES` / `valueSchemaFor`. Before this fix,
  // introspecting a table the driver itself created reported the column it had
  // just written as NOT exactly compatible with the field type that wrote it.
  it('accepts a TEXT column for the field types the driver emits as TEXT', () => {
    // The tie to the driver, stated rather than assumed: every member of the
    // spec's own string-value class that a TEXT column can back is exact here.
    expect(isCompatible('text', 'signature')).toBe(true);
    expect(isCompatible('text', 'qrcode')).toBe(true);
    // The dialect spellings the same column arrives under from introspection.
    expect(isCompatible('varchar(255)', 'signature')).toBe(true);
    expect(isCompatible('clob', 'qrcode')).toBe(true);
    expect(isCompatible('citext', 'signature', 'postgres')).toBe(true);
    expect(isCompatible('STRING', 'qrcode', 'bigquery')).toBe(true);
    // Regression guard for the row as a whole, not just the two types that
    // moved — the next string-valued type to join the driver's text family has
    // to be added here on purpose rather than drift out of the set again.
    // `password` / `secret` are absent on purpose: not import-mappable targets
    // (ADR-0100 keeps `secret` an opaque `sys_secret` reference).
    for (const ft of ['text', 'textarea', 'email', 'url', 'phone', 'markdown',
      'html', 'richtext', 'code', 'color', 'signature', 'qrcode'] as const) {
      expect(isCompatible('text', ft), `text column should back \`${ft}\``).toBe(true);
    }
  });

  // The `binary` row keeps `signature`: this matrix is many-to-many by design
  // ("which field types can THIS column serve?"), keyed on the column, so the
  // two memberships answer questions about two different columns and never
  // collide. `text` is already exact under `text` / `uuid` / `enum` the same
  // way. Measured when the `text` row moved: nothing in the monorepo stores a
  // signature as a binary payload, so this entry is import-side reach only —
  // and dropping it would single `signature` out from `file` / `image`, which
  // sit on the same row under the same content-class reading.
  it('keeps a field type exact under every column that can serve it', () => {
    expect(isCompatible('text', 'signature')).toBe(true);
    expect(isCompatible('bytea', 'signature', 'postgres')).toBe(true);
    // The pre-existing precedent for the same shape.
    expect(isCompatible('text', 'text')).toBe(true);
    expect(isCompatible('uuid', 'text')).toBe(true);
    expect(isCompatible('enum', 'text')).toBe(true);
  });

  it('returns "lossy" for usable-but-imperfect mappings', () => {
    expect(isCompatible('jsonb', 'text', 'postgres')).toBe('lossy');
    expect(isCompatible('date', 'datetime')).toBe('lossy');
    expect(isCompatible('integer', 'currency')).toBe('lossy');
  });

  it('returns false for incompatible mappings', () => {
    expect(isCompatible('integer', 'datetime')).toBe(false);
    expect(isCompatible('boolean', 'json')).toBe(false);
    expect(isCompatible('varchar(255)', 'number')).toBe(false);
  });

  it('treats unknown remote types as lossy only against text/json', () => {
    expect(isCompatible('geometry', 'text')).toBe('lossy');
    expect(isCompatible('geometry', 'json')).toBe('lossy');
    expect(isCompatible('geometry', 'number')).toBe(false);
  });
});

/**
 * The Object.prototype fall-through pin. Its POPULATION is the point: the
 * suite's other cases iterate the canonical vocabulary only, which is
 * precisely the population that behaves, and that is why this site sat green
 * while `canonicalizeSqlType('constructor')` returned the `Object` FUNCTION
 * out of a signature that admits only `CanonicalSqlType` string literals.
 *
 * `rawType` is uncontrolled — it arrives from live database introspection —
 * so the population below is the reachable one, not a contrived one.
 */
describe('canonicalizeSqlType — Object.prototype fall-through', () => {
  // Fixed at five: the three prototype members a lower-cased key can name or
  // nearly name, the assignment-shaped one, and a plain unknown word that
  // names nothing at all. Four is not four-fifths of this pin.
  const POPULATION = ['constructor', 'toString', 'valueOf', '__proto__', 'nope'] as const;
  // Every member of the declared `SqlDialect` union, so the dialect half of the
  // guarded line is covered for each table it can select — including the two
  // the union declares but `DIALECT_ALIASES` does not populate, which fall
  // through to the base map and must answer just as safely.
  const DIALECTS: readonly SqlDialect[] = [
    'postgres', 'mysql', 'sqlite', 'snowflake', 'bigquery', 'mongo',
  ];

  // The declared return type is a private union, so the pin names it here.
  // ⛔ This list pins the SIGNATURE, not today's answers: a member added to
  // `CanonicalSqlType` belongs here too.
  const CANONICAL: readonly string[] = [
    'text', 'integer', 'bigint', 'decimal', 'float', 'boolean', 'date', 'time',
    'datetime', 'json', 'uuid', 'binary', 'enum', 'array', 'vector', 'unknown',
  ];

  it.each(POPULATION)('%s resolves to a declared CanonicalSqlType, never a prototype member', (word) => {
    // The assertion is on the SHAPE of the answer, not on which word it is:
    // what the defect produced was a `function`, and pinning "is a declared
    // member of the union" survives a vocabulary change that pinning the
    // string `'unknown'` would break.
    expect(typeof canonicalizeSqlType(word)).toBe('string');
    expect(CANONICAL).toContain(canonicalizeSqlType(word));
    for (const dialect of DIALECTS) {
      expect(typeof canonicalizeSqlType(word, dialect)).toBe('string');
      expect(CANONICAL).toContain(canonicalizeSqlType(word, dialect));
    }
  });

  it('`constructor` is refused with this function\'s own declared refusal value', () => {
    // `'unknown'` is the trailing `return` of the function itself, ⛔ not a
    // value invented for the fix.
    expect(canonicalizeSqlType('constructor')).toBe('unknown');
    for (const dialect of DIALECTS) expect(canonicalizeSqlType('constructor', dialect)).toBe('unknown');
  });

  it('`__proto__` answers `array` from the array-notation rule, ahead of either table', () => {
    // Not a fall-through: `__proto__` starts with `_`, which is Postgres array
    // notation (`_int4`), and that branch returns before any lookup. Recorded
    // so a later reader does not mistake a legitimate declared answer for the
    // defect, and so the array rule cannot be quietly dropped.
    expect(canonicalizeSqlType('__proto__')).toBe('array');
    expect(canonicalizeSqlType('_int4')).toBe('array');
  });

  it('the published sibling accessors stay total over the same population', () => {
    // The defect was not confined to this function's own return: a
    // non-`CanonicalSqlType` reaches `CANONICAL_TO_FIELD[canonical]`, which is
    // `undefined`, and both accessors below threw a TypeError on the member
    // read. That is the consequence a plain-JS caller actually meets.
    for (const word of POPULATION) {
      expect(() => suggestFieldTypeForSqlType(word)).not.toThrow();
      expect(() => isCompatible(word, 'text')).not.toThrow();
      for (const dialect of DIALECTS) {
        expect(() => suggestFieldTypeForSqlType(word, dialect)).not.toThrow();
        expect(() => isCompatible(word, 'text', dialect)).not.toThrow();
      }
    }
  });

  it('lit control — the canonical vocabulary is untouched by the guard', () => {
    // If the guard narrowed anything it should not, these go red. Both halves
    // of the guarded line are represented: the base map and a dialect map.
    expect(canonicalizeSqlType('varchar')).toBe('text');
    expect(canonicalizeSqlType('numeric(10,2)')).toBe('decimal');
    expect(canonicalizeSqlType('timestamptz', 'postgres')).toBe('datetime');
    expect(canonicalizeSqlType('objectid', 'mongo')).toBe('text');
  });
});
