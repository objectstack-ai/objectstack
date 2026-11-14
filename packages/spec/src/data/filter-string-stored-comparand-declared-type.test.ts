// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29486] Pins for the string-stored comparand declared-type door's CONTRACT
 * — the judged families, the positions, the pure verdict — and for the
 * cross-driver case table it feeds (`FILTER_STRING_STORED_COMPARAND_CASES` in
 * `filter-comparand-type-conformance.ts`). The door itself is
 * `@objectstack/objectql`'s arm of the engine's field-aware walk.
 */

import { describe, it, expect } from 'vitest';
import { FieldSchema, FieldType, BOUNDED_STRING_FIELD_TYPES } from './field.zod';
import { BOOLEAN_VALUE_TYPES, MULTI_OPTION_TYPES, NUMERIC_VALUE_TYPES, SINGLE_OPTION_TYPES } from './field-value.zod';
import { parseFilterAST } from './filter.zod';
import { FILTER_COMPARAND_BIGINT_EXACT_LIMIT } from './filter-comparand-type';
import {
  NUMBER_COMPARAND_DOOR_LIST_OPERATORS,
  NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS,
} from './filter-number-comparand-declared-type';
import {
  STRING_STORED_COMPARAND_DOOR_FAMILIES,
  STRING_STORED_COMPARAND_DOOR_LIST_OPERATORS,
  STRING_STORED_COMPARAND_DOOR_SCALAR_OPERATORS,
  stringStoredComparandDoorVerdict,
  stringStoredComparandFieldVerdict,
} from './filter-string-stored-comparand-declared-type';
import {
  FILTER_STRING_STORED_COMPARAND_CASES,
  FILTER_STRING_STORED_COMPARAND_FIELDS,
  FILTER_STRING_STORED_COMPARAND_ROWS,
} from './filter-comparand-type-conformance';

describe('the judged fields and positions', () => {
  it('are the write side\'s three sets, by identity — never a re-listing', () => {
    expect(STRING_STORED_COMPARAND_DOOR_FAMILIES).toHaveLength(3);
    expect(STRING_STORED_COMPARAND_DOOR_FAMILIES[0]).toBe(BOUNDED_STRING_FIELD_TYPES);
    expect(STRING_STORED_COMPARAND_DOOR_FAMILIES[1]).toBe(SINGLE_OPTION_TYPES);
    expect(STRING_STORED_COMPARAND_DOOR_FAMILIES[2]).toBe(MULTI_OPTION_TYPES);
  });

  it('judges every member of those sets and nothing else, over the whole FieldType enum', () => {
    for (const type of FieldType.options) {
      const member = BOUNDED_STRING_FIELD_TYPES.has(type) || SINGLE_OPTION_TYPES.has(type) || MULTI_OPTION_TYPES.has(type);
      expect(stringStoredComparandFieldVerdict({ type }), type).toBe(member ? 'judged' : 'not-judged');
    }
  });

  it('is disjoint from the number and boolean doors\' classes, so at most one arm judges a key', () => {
    for (const type of [...NUMERIC_VALUE_TYPES, ...BOOLEAN_VALUE_TYPES]) {
      expect(stringStoredComparandFieldVerdict({ type }), type).toBe('not-judged');
    }
    expect(stringStoredComparandFieldVerdict({ type: 'formula' })).toBe('not-judged');
  });

  it('judges the number door\'s positions, by identity', () => {
    expect(STRING_STORED_COMPARAND_DOOR_SCALAR_OPERATORS).toBe(NUMBER_COMPARAND_DOOR_SCALAR_OPERATORS);
    expect(STRING_STORED_COMPARAND_DOOR_LIST_OPERATORS).toBe(NUMBER_COMPARAND_DOOR_LIST_OPERATORS);
  });
});

describe('the verdict', () => {
  const text = { type: 'text' };
  const select = { type: 'select' };

  it('narrows a number or a boolean to String(value) — the write side\'s reading', () => {
    for (const field of [text, select, { type: 'email' }, { type: 'multiselect' }]) {
      for (const [comparand, value] of [[42, '42'], [0, '0'], [-3.5, '-3.5'], [1e21, '1e+21'], [true, 'true'], [false, 'false']] as const) {
        expect(stringStoredComparandDoorVerdict(field, comparand), `${field.type} ${String(comparand)}`)
          .toEqual({ verdict: 'narrows', value });
        expect(value).toBe(String(comparand));
      }
    }
  });

  it('reads a bigint within ±2^53 as the number it names, and passes one beyond for the comparand-type door to refuse', () => {
    expect(stringStoredComparandDoorVerdict(text, BigInt(42))).toEqual({ verdict: 'narrows', value: '42' });
    expect(stringStoredComparandDoorVerdict(text, -FILTER_COMPARAND_BIGINT_EXACT_LIMIT))
      .toEqual({ verdict: 'narrows', value: String(-(2 ** 53)) });
    expect(stringStoredComparandDoorVerdict(text, FILTER_COMPARAND_BIGINT_EXACT_LIMIT + BigInt(1))).toEqual({ verdict: 'passes' });
  });

  it('passes a string, null (the null test — never "null"), a Date, an array and a non-literal', () => {
    for (const comparand of ['42', '', null, undefined, new Date(0), ['42'], { $field: 'other' }, new Map()]) {
      expect(stringStoredComparandDoorVerdict(text, comparand), String(comparand)).toEqual({ verdict: 'passes' });
    }
  });

  it('passes every comparand on a field outside the two families', () => {
    for (const type of ['number', 'boolean', 'date', 'datetime', 'lookup', 'json', 'formula']) {
      expect(stringStoredComparandDoorVerdict({ type }, 42), type).toEqual({ verdict: 'passes' });
      expect(stringStoredComparandDoorVerdict({ type }, true), type).toEqual({ verdict: 'passes' });
    }
  });
});

describe('FILTER_STRING_STORED_COMPARAND_CASES — the cross-driver table', () => {
  it('declares legal fields from both families', () => {
    for (const def of Object.values(FILTER_STRING_STORED_COMPARAND_FIELDS)) {
      expect(FieldSchema.safeParse(def).success, def.name).toBe(true);
    }
    expect(stringStoredComparandFieldVerdict(FILTER_STRING_STORED_COMPARAND_FIELDS.code)).toBe('judged');
    expect(stringStoredComparandFieldVerdict(FILTER_STRING_STORED_COMPARAND_FIELDS.stage)).toBe('judged');
    expect(BOUNDED_STRING_FIELD_TYPES.has(FILTER_STRING_STORED_COMPARAND_FIELDS.code.type)).toBe(true);
    expect(SINGLE_OPTION_TYPES.has(FILTER_STRING_STORED_COMPARAND_FIELDS.stage.type)).toBe(true);
  });

  it('every stored filter is its written filter with each number or boolean comparand read by the verdict', () => {
    const narrow = (field: string, v: unknown): unknown => {
      const type = (FILTER_STRING_STORED_COMPARAND_FIELDS as Record<string, { type: string }>)[field]!.type;
      const verdict = stringStoredComparandDoorVerdict({ type }, v);
      return verdict.verdict === 'narrows' ? verdict.value : v;
    };
    for (const c of FILTER_STRING_STORED_COMPARAND_CASES) {
      const [[field, spec]] = Object.entries(c.filter());
      const expected = typeof spec === 'object' && spec !== null
        ? Object.fromEntries(Object.entries(spec).map(([op, v]) => [op, Array.isArray(v) ? v.map((m) => narrow(field, m)) : narrow(field, v)]))
        : narrow(field, spec);
      expect(c.stored(), c.name).toEqual({ [field]: expected });
      // The written filter really carries a number or a boolean, else the case pins nothing.
      expect(JSON.stringify(c.filter()), c.name).not.toBe(JSON.stringify(c.stored()));
    }
  });

  it('covers both families, both comparand types, and $eq / $ne / $in / $nin with mixed scalars', () => {
    const written = FILTER_STRING_STORED_COMPARAND_CASES.map((c) => JSON.stringify(c.filter()));
    for (const field of ['code', 'stage']) {
      expect(written.some((w) => w.includes(`"${field}"`) && /[:\[,](-?\d|true|false)/.test(w)), field).toBe(true);
      for (const op of ['$eq', '$ne', '$in', '$nin']) {
        expect(written.some((w) => w.includes(`"${field}"`) && w.includes(`"${op}"`)), `${field} ${op}`).toBe(true);
      }
    }
  });

  it('every stored filter passes the shared door, and every expected id is a fixture row', () => {
    const ids = new Set(FILTER_STRING_STORED_COMPARAND_ROWS.map((r) => r.id));
    for (const c of FILTER_STRING_STORED_COMPARAND_CASES) {
      expect(() => parseFilterAST(c.stored()), c.name).not.toThrow();
      for (const id of c.expected) expect(ids.has(id), `${c.name}: ${id}`).toBe(true);
      expect([...c.expected], c.name).toEqual([...c.expected].sort());
    }
  });
});
