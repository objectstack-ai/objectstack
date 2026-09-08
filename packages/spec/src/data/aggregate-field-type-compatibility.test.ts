// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Pins for the aggregate × field-type compatibility table (#16353).
 *
 * Two totality claims are the card's acceptance and are held here literally:
 * every `AggregationFunction` member has a row, and every `FieldType` member
 * is classified (in or out) on every row. The per-row memberships are pinned
 * as the LITERAL sets the ruling resolved to, and tied to the `field-value.zod`
 * semantic classes so a field type joining the numeric, temporal or boolean
 * class elsewhere reds this file until the table records a decision.
 *
 * The boolean rows are pinned twice: literally, and against the spec's own
 * conformance suite — every boolean case `AGGREGATION_CASES` requires a
 * backend to ANSWER (#11152) must be a pair this table accepts, so the two
 * tables in this package cannot contradict each other on the boolean axis
 * (#16685) — the cross-pin reaches exactly as far as the `flag` cases.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction } from './query.zod';
import { FieldType } from './field.zod';
import {
  NUMERIC_VALUE_TYPES,
  CALENDAR_DATE_TYPES,
  INSTANT_TYPES,
  CLOCK_TIME_TYPES,
  BOOLEAN_VALUE_TYPES,
} from './field-value.zod';
import { isIncoherentAggregate } from './aggregation-policy';
import { AGGREGATION_CASES } from './aggregation-conformance';
import {
  AGGREGATE_FIELD_TYPE_COMPATIBILITY,
  isAggregateCompatibleWithFieldType,
} from './aggregate-field-type-compatibility';

const sorted = (xs: Iterable<string>) => [...xs].sort();

const NUMERIC = ['currency', 'number', 'percent', 'progress', 'rating', 'slider', 'summary'];
const ADDITIVE = NUMERIC.filter((t) => t !== 'percent');
const TEMPORAL = ['date', 'datetime', 'time'];
const BOOLEAN = ['boolean', 'toggle'];

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

  it('`sum`: the numeric class EXCEPT `percent`, plus the boolean class', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.sum)).toEqual(sorted([...ADDITIVE, ...BOOLEAN]));
    expect(isAggregateCompatibleWithFieldType('sum', 'percent')).toBe(false);
  });

  it('`avg`: the numeric class, `percent` included, plus the boolean class', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg)).toEqual(sorted([...NUMERIC, ...BOOLEAN]));
  });

  it('`min` / `max`: the numeric class plus the temporal class plus the boolean class', () => {
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.min)).toEqual(sorted([...NUMERIC, ...TEMPORAL, ...BOOLEAN]));
    expect(sorted(AGGREGATE_FIELD_TYPE_COMPATIBILITY.max)).toEqual(sorted([...NUMERIC, ...TEMPORAL, ...BOOLEAN]));
  });

  it('the numeric bucket IS the field-value numeric class — a type joining it elsewhere must be decided here', () => {
    // Outside the boolean class, `avg` accepts exactly the numeric class and
    // `sum` is that class minus the rate.
    const avgNonBoolean = AGGREGATE_FIELD_TYPE_COMPATIBILITY.avg.filter((t) => !BOOLEAN_VALUE_TYPES.has(t));
    const sumNonBoolean = AGGREGATE_FIELD_TYPE_COMPATIBILITY.sum.filter((t) => !BOOLEAN_VALUE_TYPES.has(t));
    expect(sorted(avgNonBoolean)).toEqual(sorted(NUMERIC_VALUE_TYPES));
    expect(sorted(sumNonBoolean)).toEqual(sorted([...NUMERIC_VALUE_TYPES].filter((t) => t !== 'percent')));
  });

  it('the temporal bucket IS the three field-value temporal classes', () => {
    const temporal = sorted([...CALENDAR_DATE_TYPES, ...INSTANT_TYPES, ...CLOCK_TIME_TYPES]);
    expect(temporal).toEqual(TEMPORAL);
    const minOnly = AGGREGATE_FIELD_TYPE_COMPATIBILITY.min.filter(
      (t) => !NUMERIC_VALUE_TYPES.has(t) && !BOOLEAN_VALUE_TYPES.has(t),
    );
    expect(sorted(minOnly)).toEqual(temporal);
  });

  it('the boolean bucket IS the field-value boolean class, and it is in all four arithmetic / order rows', () => {
    expect(sorted(BOOLEAN_VALUE_TYPES)).toEqual(BOOLEAN);
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      const booleanMembers = AGGREGATE_FIELD_TYPE_COMPATIBILITY[fn].filter((t) => BOOLEAN_VALUE_TYPES.has(t));
      expect(sorted(booleanMembers)).toEqual(BOOLEAN);
    }
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

  it('accepts `sum` / `avg` / `min` / `max` over booleans — #11152 (numbers on every backend), upheld by decision batch #80', () => {
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      expect(isAggregateCompatibleWithFieldType(fn, 'boolean')).toBe(true);
      expect(isAggregateCompatibleWithFieldType(fn, 'toggle')).toBe(true);
    }
  });

  it('accepts every boolean pair the conformance suite requires a backend to ANSWER — the two spec tables cannot contradict', () => {
    // `AGGREGATION_ROWS.flag` is the boolean aggregand (declared `type:
    // 'boolean'` by every harness); each case over it is a pair #11152 pins
    // on six backends. A table refusing one of them would refuse a pair the
    // spec elsewhere REQUIRES an answer to (#16685).
    const booleanCases = AGGREGATION_CASES.filter((c) => c.field === 'flag');
    expect(sorted(new Set(booleanCases.map((c) => c.function)))).toEqual(sorted(AggregationFunction.options));
    for (const c of booleanCases) {
      expect(isAggregateCompatibleWithFieldType(c.function, 'boolean')).toBe(true);
      expect(isAggregateCompatibleWithFieldType(c.function, 'toggle')).toBe(true);
    }
  });

  it('refuses arithmetic over the computed / text / structured types', () => {
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      for (const t of ['formula', 'autonumber', 'text', 'select', 'lookup', 'json', 'vector', 'file']) {
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

  it('records the one override of an existing opinion without changing the row: the string classes', () => {
    // String classes: min/max refused here; measureResultType (#15768) types
    // min/max over them as a supported 'string' result. Override recorded.
    for (const t of ['text', 'select', 'lookup', 'autonumber']) {
      expect(isAggregateCompatibleWithFieldType('min', t)).toBe(false);
      expect(isAggregateCompatibleWithFieldType('max', t)).toBe(false);
    }
  });
});
