// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29277 — the write door's arm for a cleared one-string column on the
 * `$empty` table's `null_only` row, at the validator module:
 * `normalizeBlankTypedValues` stores exactly `''` as `null` on every OPTIONAL
 * column the table puts on `null_only` whose value is one string — an option
 * code, a record id, a file id (maintainer ruling B on #29346, record
 * 6579813296).
 *
 * The population is DERIVED from the table: every `FieldType` whose
 * expansion is `null_only` and which is not typed (`NON_TEXT_STORED_VALUE_TYPES`,
 * the #20308 arm) must be classified — one string (joins), object/array
 * (`STRUCTURED_JSON_TYPES`, out) or engine-owned (`COMPUTED_VALUE_TYPES`,
 * out) — so a type joining the row unclassified turns the first case red. The
 * engine and physical-column halves, through REST on SQLite, are
 * `packages/rest/src/rest-data-single-value-blank.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  FieldType,
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  FILE_REFERENCE_TYPES,
  STRUCTURED_JSON_TYPES,
  COMPUTED_VALUE_TYPES,
  NON_TEXT_STORED_VALUE_TYPES,
  MULTI_CAPABLE_TYPES,
  expandEmptyOperator,
} from '@objectstack/spec/data';
import { blankAsNullColumns } from '@objectstack/core';
import { normalizeBlankTypedValues } from './record-validator.js';

/** Every declarable type the `$empty` table puts on `null_only` that the typed arm does not own. */
const nullOnlyUntyped = FieldType.options.filter(
  (t) => expandEmptyOperator({ type: t }).arm === 'null_only' && !NON_TEXT_STORED_VALUE_TYPES.has(t),
);
const oneString = new Set<string>([...SINGLE_OPTION_TYPES, ...REFERENCE_VALUE_TYPES, ...FILE_REFERENCE_TYPES]);
const singleValue = nullOnlyUntyped.filter((t) => oneString.has(t));
const leftOut = nullOnlyUntyped.filter((t) => !oneString.has(t));
const multiCapable = singleValue.filter((t) => MULTI_CAPABLE_TYPES.has(t));

type Def = Record<string, unknown>;
function schemaOf(types: readonly string[], extra: Def = {}) {
  const fields: Record<string, Def> = {};
  for (const t of types) {
    fields[`f_${t}`] = {
      name: `f_${t}`,
      type: t,
      ...(REFERENCE_VALUE_TYPES.has(t) ? { reference: 'other' } : {}),
      ...(SINGLE_OPTION_TYPES.has(t) ? { options: [{ value: 'a', label: 'A' }] } : {}),
      ...extra,
    };
  }
  return { fields } as any;
}
const rowOf = (types: readonly string[], value: unknown) => Object.fromEntries(types.map((t) => [`f_${t}`, value]));

describe('normalizeBlankTypedValues: optional single-value option / reference columns (#29277)', () => {
  it('every untyped null_only type is classified: one string joins, object/array and engine-owned stay out', () => {
    for (const t of nullOnlyUntyped) {
      const classes = [oneString.has(t), STRUCTURED_JSON_TYPES.has(t), COMPUTED_VALUE_TYPES.has(t)].filter(Boolean);
      expect(classes, `${t}: exactly one storage class`).toHaveLength(1);
    }
    // Controls on the sets themselves: if one ever emptied, every case below
    // would pass over nothing.
    expect([...singleValue].sort()).toEqual(
      ['audio', 'avatar', 'file', 'image', 'lookup', 'master_detail', 'radio', 'select', 'tree', 'user', 'video'],
    );
    expect([...leftOut].sort()).toEqual(
      ['address', 'autonumber', 'composite', 'formula', 'json', 'location', 'record', 'repeater', 'vector'],
    );
    expect(multiCapable.sort()).toEqual(['file', 'image', 'lookup', 'radio', 'select', 'user']);
  });

  it('the left-out types keep "": object/array-stored and engine-owned', () => {
    const row = rowOf(leftOut, '');
    expect(normalizeBlankTypedValues(schemaOf(leftOut), row)).toBe(row);
  });

  it('"" on every optional member becomes null, unique or not', () => {
    for (const extra of [{}, { unique: true }, { required: false }]) {
      const out = normalizeBlankTypedValues(schemaOf(singleValue, extra), rowOf(singleValue, '')) as Record<string, unknown>;
      for (const t of singleValue) expect(out[`f_${t}`], `${t} ${JSON.stringify(extra)}`).toBeNull();
    }
  });

  it('a required column keeps "" (refused `required` downstream), with or without a defaultValue', () => {
    for (const extra of [{ required: true }, { required: true, defaultValue: 'a' }]) {
      const row = rowOf(singleValue, '');
      expect(normalizeBlankTypedValues(schemaOf(singleValue, extra), row), JSON.stringify(extra)).toBe(row);
    }
  });

  it('a multiple: true column is the multi_value row, not this arm: #29343\'s list arm owns it', () => {
    const schema = schemaOf(multiCapable, { multiple: true });
    for (const t of multiCapable) expect(expandEmptyOperator(schema.fields[`f_${t}`]).arm, t).toBe('multi_value');
    const reach = blankAsNullColumns(schema);
    for (const t of multiCapable) expect(reach.get(`f_${t}`), t).toBe('emptyList');
  });

  it('a lifecycle column the engine owns is never rewritten', () => {
    const schema = { fields: { created_by: { name: 'created_by', type: 'user' }, updated_by: { name: 'updated_by', type: 'lookup', reference: 'sys_user' } } } as any;
    const row = { created_by: '', updated_by: '' };
    expect(normalizeBlankTypedValues(schema, row)).toBe(row);
  });

  it('whitespace, and every non-blank value, pass through untouched', () => {
    for (const v of ['  ', '\t', ' a ', 'a', 'rec_1', null, undefined, 0, false]) {
      const row = rowOf(singleValue, v);
      expect(normalizeBlankTypedValues(schemaOf(singleValue), row), String(v)).toBe(row);
    }
  });

  it('pure: an array is rewritten per row, the caller rows are never mutated', () => {
    const schema = schemaOf(['select', 'lookup']);
    const rows = [{ f_select: '', f_lookup: 'r1' }, { f_select: 'a', f_lookup: 'r2' }];
    const out = normalizeBlankTypedValues(schema, rows) as Array<Record<string, unknown>>;
    expect(out).not.toBe(rows);
    expect(out).toEqual([{ f_select: null, f_lookup: 'r1' }, { f_select: 'a', f_lookup: 'r2' }]);
    expect(out[1]).toBe(rows[1]);
    expect(rows[0]!.f_select).toBe('');
  });
});
