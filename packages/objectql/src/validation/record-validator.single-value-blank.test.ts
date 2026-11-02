// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29277 — the write door's arm for a cleared single-value option or reference
 * column, at the validator module: `normalizeBlankTypedValues` stores exactly
 * `''` as `null` on every OPTIONAL column whose type is string-stored
 * single-value (`SINGLE_OPTION_TYPES`, `REFERENCE_VALUE_TYPES`) and sits on the
 * `$empty` table's `null_only` row (maintainer ruling B on #29346, record
 * 6579813296).
 *
 * `''` is neither an option code nor a record id, so it is no value on those
 * columns; the `$empty` table already reads only `null` as empty there, and is
 * unchanged. The population is read from the spec's own sets and the table's
 * own expansion, so a type joining either class tomorrow is covered here
 * without an edit. The engine and physical-column halves, through REST on
 * SQLite, are `packages/rest/src/rest-data-single-value-blank.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import {
  REFERENCE_VALUE_TYPES,
  SINGLE_OPTION_TYPES,
  MULTI_CAPABLE_TYPES,
  expandEmptyOperator,
} from '@objectstack/spec/data';
import { normalizeBlankTypedValues } from './record-validator.js';

const singleValue = [...SINGLE_OPTION_TYPES, ...REFERENCE_VALUE_TYPES];
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
  it('the population is the ruled set, every member on the $empty table null_only row', () => {
    // A control on the set itself: if it ever emptied, every case below would
    // pass over nothing.
    expect([...singleValue].sort()).toEqual(['lookup', 'master_detail', 'radio', 'select', 'tree', 'user']);
    for (const t of singleValue) expect(expandEmptyOperator({ type: t }).arm, t).toBe('null_only');
    expect(multiCapable.sort()).toEqual(['lookup', 'radio', 'select', 'user']);
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

  it('a multiple: true column is the multi_value row, not this arm: "" passes through', () => {
    const schema = schemaOf(multiCapable, { multiple: true });
    for (const t of multiCapable) expect(expandEmptyOperator(schema.fields[`f_${t}`]).arm, t).toBe('multi_value');
    const row = rowOf(multiCapable, '');
    expect(normalizeBlankTypedValues(schema, row)).toBe(row);
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
