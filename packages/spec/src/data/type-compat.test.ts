// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  canonicalizeSqlType,
  suggestFieldTypeForSqlType,
  isCompatible,
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
