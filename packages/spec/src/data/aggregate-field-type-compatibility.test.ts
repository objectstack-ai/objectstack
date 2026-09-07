// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the aggregate × field-type compatibility table (#16353).
 *
 * Two totality claims are the card's acceptance and are held here literally:
 * every `AggregationFunction` member has a row, and every `FieldType` member
 * is classified (in or out) on every row. The per-row memberships are pinned
 * as the LITERAL sets the ruling resolved to, and tied to the `field-value.zod`
 * semantic classes so a field type joining the numeric or temporal class
 * elsewhere reds this file until the table records a decision.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction } from './query.zod';
import { FieldType } from './field.zod';
import {
  NUMERIC_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  INSTANT_TYPES,
  CLOCK_TIME_TYPES,
} from './field-value.zod';
import { isIncoherentAggregate } from './aggregation-policy';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  isAggregateCompatibleWithFieldType,
} from './aggregate-field-type-compatibility';

const sorted = (xs: Iterable<string>) => [...xs].sort();

const NUMERIC = ['currency', 'number', 'percent', 'progress', 'rating', 'slider', 'summary'];
const ADDITIVE = NUMERIC.filter((t) => t !== 'percent');
const TEMPORAL = ['date', 'datetime', 'time'];

describe('AGGREGATE_FIELD_TYPE_COMPATIBILITY — totality', () => {
  it('every AggregationFunction member has a row, and no row is for a non-member', () => {
    expect(sorted(Object.keys(AGGREGATE_FIELD_TYPE_COMPATIBILITY))).toEqual(sorted(AggregationFunction.options));
  });

  it('every row member is a declared FieldType', () => {
    const all = new Set<string>(FieldType.options);
    for (const row of Object.values(AGGREGATE_FIELD_TYPE_COMPATIBILITY)) {
      for (const t of row) expect(all).toContain(t);
    }
  });

  it('every FieldType member is classified on every row — the predicate answers a boolean for all pairs', () => {
    for (const fn of AggregationFunction.options) {
      const row = AGGREGATE_FIELD_TYPE_COMPATIBILITY[fn];
      for (const t of FieldType.options) {
        expect(isAggregateCompatibleWithFieldType(fn, t)).toBe(row.includes(t));
      }
    }
  });

  it('the table and its rows are frozen — consumers read, never edit', () => {
    expect(Object.isFrozen(AGGREGATE_FIELD_TYPE_COMPATIBILITY)).toBe(true);
    for (const row of Object.values(AGGREGATE_FIELD_TYPE_COMPATIBILITY)) expect(Object.isFrozen(row)).toBe(true);
  });
});

describe('AGGREGATE_FIELD_TYPE_COMPATIBILITY — the ruled rows, resolved against the membership', () => {
  it('`count` / `count_distinct`: every FieldType', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.count)).toEqual(sorted(FieldType.options));
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.count_distinct)).toEqual(sorted(FieldType.options));
  });

  it('`sum`: the numeric class EXCEPT `percent`', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.sum)).toEqual(ADDITIVE);
    expect(isAggregateCompatibleWithFieldType('sum', 'percent')).toBe(false);
  });

  it('`avg`: the numeric class, `percent` included', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg)).toEqual(NUMERIC);
  });

  it('`min` / `max`: the numeric class plus the temporal class', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.min)).toEqual(sorted([...NUMERIC, ...TEMPORAL]));
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.max)).toEqual(sorted([...NUMERIC, ...TEMPORAL]));
  });

  it('the numeric bucket IS the field-value numeric class — a type joining it elsewhere must be decided here', () => {
    // `avg` accepts exactly the numeric class; `sum` is that class minus the rate.
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg)).toEqual(sorted(NUMERIC_VALUE_TYPES));
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.sum)).toEqual(sorted([...NUMERIC_VALUE_TYPES].filter((t) => t !== 'percent')));
  });

  it('the temporal bucket IS the three field-value temporal classes', () => {
    const temporal = sorted([...CALENDAR_DATE_TYPES, ...INSTANT_TYPES, ...CLOCK_TIME_TYPES]);
    expect(temporal).toEqual(TEMPORAL);
    const minOnly = AGGREGATE_FIELD_TYPE_COMPATIBILITY.min.filter((t) => !NUMERIC_VALUE_TYPES.has(t));
    expect(sorted(minOnly)).toEqual(temporal);
  });
});

describe('isAggregateCompatibleWithFieldType — the pairs the card is about', () => {
  it('refuses the motivating defect: `avg` (and `sum`) over a datetime', () => {
    expect(isAggregateCompatibleWithFieldType('avg', 'datetime')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('sum', 'datetime')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('avg', 'date')).toBe(false);
  });

  it('accepts `min` / `max` over every temporal type — they return a value of the field\'s own type', () => {
    for (const t of TEMPORAL) {
      expect(isAggregateCompatibleWithFieldType('min', t)).toBe(true);
      expect(isAggregateCompatibleWithFieldType('max', t)).toBe(true);
    }
  });

  it('refuses arithmetic over booleans (row as ruled; membership referred, see module TSDoc) and over the computed / text / structured types', () => {
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      for (const t of ['boolean', 'toggle', 'formula', 'autonumber', 'text', 'select', 'lookup', 'json', 'vector', 'file']) {
        expect(isAggregateCompatibleWithFieldType(fn, t)).toBe(false);
      }
    }
  });

  it('accepts `count` / `count_distinct` over anything, `vector` and `formula` included', () => {
    for (const t of FieldType.options) {
      expect(isAggregateCompatibleWithFieldType('count', t)).toBe(true);
      expect(isAggregateCompatibleWithFieldType('count_distinct', t)).toBe(true);
    }
  });

  it('agrees with `isIncoherentAggregate` on `sum` × `percent`; the one divergence is `count_distinct` × `percent`', () => {
    // Both refuse the sum of a rate.
    expect(isIncoherentAggregate('sum', 'percent')).toBe(true);
    expect(isAggregateCompatibleWithFieldType('sum', 'percent')).toBe(false);
    // The semantic opinion flags count_distinct of a rate; the ruling reads
    // `count_distinct` as "any type" and this table follows the ruling. Pinned
    // so the divergence is visible, not discovered (reported on #16353).
    expect(isIncoherentAggregate('count_distinct', 'percent')).toBe(true);
    expect(isAggregateCompatibleWithFieldType('count_distinct', 'percent')).toBe(true);
  });

  it('fails closed on vocabulary it does not know — driver aliases and retired functions', () => {
    expect(isAggregateCompatibleWithFieldType('sum', 'integer')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('sum', 'float')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('array_agg', 'text')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('countDistinct', 'text')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('toString', 'text')).toBe(false);
    expect(isAggregateCompatibleWithFieldType('', '')).toBe(false);
  });

  it('fails closed on SHAPE — a non-string that would coerce to a member spelling is refused, not looked up', () => {
    // `hasOwnProperty.call` applies ToPropertyKey, so without the typeof guard
    // `['count']` reads as 'count' and an object with a toString reads as
    // 'sum'. A refusal gate must not be talked past by coercion.
    const loose = isAggregateCompatibleWithFieldType as unknown as (a: unknown, f: unknown) => boolean;
    expect(loose(['count'], 'number')).toBe(false);
    expect(loose({ toString: () => 'sum' }, 'currency')).toBe(false);
    expect(loose('sum', ['currency'])).toBe(false);
    expect(loose('min', { toString: () => 'date' })).toBe(false);
    expect(loose(undefined, 'number')).toBe(false);
    expect(loose(null, 'number')).toBe(false);
    expect(loose('count', undefined)).toBe(false);
    expect(loose('count', null)).toBe(false);
    expect(loose(1, 'number')).toBe(false);
    expect(loose('count', 1)).toBe(false);
    expect(loose(Symbol('count'), 'number')).toBe(false);
  });

  it('records the two overrides of existing opinions without changing the rows: booleans and the string classes', () => {
    // Booleans: refused here by the ruling's default; #11152 / AGGREGATION_CASES
    // answer them as numbers on every face. Row kept as ruled, question referred.
    for (const fn of ['sum', 'avg', 'min', 'max']) {
      expect(isAggregateCompatibleWithFieldType(fn, 'boolean')).toBe(false);
      expect(isAggregateCompatibleWithFieldType(fn, 'toggle')).toBe(false);
    }
    // String classes: min/max refused here; measureResultType (#15768) types
    // min/max over them as a supported 'string' result. Override recorded.
    for (const t of ['text', 'select', 'lookup', 'autonumber']) {
      expect(isAggregateCompatibleWithFieldType('min', t)).toBe(false);
      expect(isAggregateCompatibleWithFieldType('max', t)).toBe(false);
    }
  });
});
