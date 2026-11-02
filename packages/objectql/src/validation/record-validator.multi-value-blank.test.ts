// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #29343 — the write door's arm for a cleared list-valued column on the
 * `$empty` table's `multi_value` row, at the validator module:
 * `normalizeBlankTypedValues` stores the empty list `[]`, or exactly `''`, as
 * `null` on every OPTIONAL column the table puts on that row (maintainer
 * ruling B on #29346, record 6579813296, execution step 2).
 *
 * The population is DERIVED from the table: every `FieldType` whose bare
 * expansion is `multi_value`, plus every type whose expansion becomes
 * `multi_value` under `multiple: true`, so a type joining the row joins this
 * arm without a list here. The engine and physical-column halves, through
 * REST on SQLite, are `packages/rest/src/rest-data-multi-value-blank.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { FieldType, REFERENCE_VALUE_TYPES, expandEmptyOperator } from '@objectstack/spec/data';
import { normalizeBlankTypedValues } from './record-validator.js';

type Def = Record<string, unknown>;
/** One field definition per multi_value-row shape: bare, then `multiple: true`. */
const shapes: Array<[string, Def]> = [];
for (const t of FieldType.options) {
  if (expandEmptyOperator({ type: t }).arm === 'multi_value') shapes.push([`f_${t}`, { type: t }]);
  else if (expandEmptyOperator({ type: t, multiple: true }).arm === 'multi_value') {
    shapes.push([`f_${t}_multi`, { type: t, multiple: true }]);
  }
}

function schemaOf(extra: Def = {}) {
  const fields: Record<string, Def> = {};
  for (const [name, def] of shapes) {
    fields[name] = {
      name,
      ...def,
      ...(REFERENCE_VALUE_TYPES.has(def.type as string) ? { reference: 'other' } : {}),
      options: [{ value: 'a', label: 'A' }],
      ...extra,
    };
  }
  return { fields } as any;
}
const rowOf = (value: () => unknown) => Object.fromEntries(shapes.map(([name]) => [name, value()]));

describe('normalizeBlankTypedValues: optional list-valued columns on the multi_value row (#29343)', () => {
  it('the population is the multi_value row: three bare types and six multiple: true types', () => {
    // A control on the derivation itself: if it ever emptied, every case below
    // would pass over nothing.
    expect(shapes.map(([n]) => n).sort()).toEqual([
      'f_checkboxes', 'f_file_multi', 'f_image_multi', 'f_lookup_multi', 'f_multiselect',
      'f_radio_multi', 'f_select_multi', 'f_tags', 'f_user_multi',
    ]);
  });

  it('[] and "" on every optional member become null, unique or not', () => {
    for (const extra of [{}, { unique: true }, { required: false }]) {
      for (const blank of [() => [], () => '']) {
        const out = normalizeBlankTypedValues(schemaOf(extra), rowOf(blank)) as Record<string, unknown>;
        for (const [n] of shapes) expect(out[n], `${n} ${JSON.stringify(blank())} ${JSON.stringify(extra)}`).toBeNull();
      }
    }
  });

  it('a required column keeps [] and "" (refused `required` downstream), with or without a defaultValue', () => {
    for (const extra of [{ required: true }, { required: true, defaultValue: ['a'] }]) {
      for (const blank of [() => [], () => '']) {
        const row = rowOf(blank);
        expect(normalizeBlankTypedValues(schemaOf(extra), row), JSON.stringify(extra)).toBe(row);
      }
    }
  });

  it('a lifecycle column the engine owns is never rewritten', () => {
    const schema = { fields: { created_by: { name: 'created_by', type: 'user', multiple: true } } } as any;
    const row = { created_by: [] };
    expect(normalizeBlankTypedValues(schema, row)).toBe(row);
  });

  it('whitespace, a non-empty list, and every other value pass through untouched', () => {
    for (const v of ['  ', '\t', 'a', ['a'], [''], null, undefined, 0, false, {}]) {
      const row = rowOf(() => v);
      expect(normalizeBlankTypedValues(schemaOf(), row), JSON.stringify(v)).toBe(row);
    }
  });

  it('an empty list on a column off the multi_value row is not this arm', () => {
    const schema = {
      fields: {
        blob: { name: 'blob', type: 'json' },
        rep: { name: 'rep', type: 'repeater' },
        pick: { name: 'pick', type: 'select', options: [{ value: 'a', label: 'A' }] },
        note: { name: 'note', type: 'text', unique: true },
      },
    } as any;
    const row = { blob: [], rep: [], pick: [], note: [] };
    expect(normalizeBlankTypedValues(schema, row)).toBe(row);
  });

  it('pure: an array is rewritten per row, the caller rows are never mutated', () => {
    const schema = schemaOf();
    const rows = [{ f_tags: [], f_multiselect: ['a'] }, { f_tags: ['x'], f_multiselect: ['a'] }];
    const out = normalizeBlankTypedValues(schema, rows) as Array<Record<string, unknown>>;
    expect(out).not.toBe(rows);
    expect(out).toEqual([{ f_tags: null, f_multiselect: ['a'] }, { f_tags: ['x'], f_multiselect: ['a'] }]);
    expect(out[1]).toBe(rows[1]);
    expect(rows[0]!.f_tags).toEqual([]);
  });
});
