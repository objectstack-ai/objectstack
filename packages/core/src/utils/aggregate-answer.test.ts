// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20889] `AGGREGATE_ANSWER_KIND` and `presentAsNumber` — what an aggregate
 * ANSWERS, and the one `'number'` presenter every face that hands a SQL
 * client's aggregate row to a caller applies: `driver-sql`'s own `aggregate()`
 * (#20335) and `service-analytics`' native-SQL face (`NativeSQLStrategy`).
 *
 * The wire strings below are the values measured on live PostgreSQL 16.13
 * through the analytics native-SQL path (node-postgres parses `bigint` and
 * `numeric` to strings), and the large totals are the ones #20335 pinned at the
 * driver door. Each face pins the same presentation through its own door, in
 * its own package, on SQLite and PostgreSQL.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction } from '@objectstack/spec/data';
import { AGGREGATE_ANSWER_KIND, presentAsNumber } from './aggregate-answer';

describe('[#20889] AGGREGATE_ANSWER_KIND — what each declared aggregate function answers', () => {
  it('has exactly one row per declared aggregate function', () => {
    expect(Object.keys(AGGREGATE_ANSWER_KIND).sort()).toEqual([...AggregationFunction.options].sort());
  });

  it('count, count_distinct, sum and avg answer a number; min and max answer a value of the column', () => {
    expect(AGGREGATE_ANSWER_KIND).toEqual({
      count: 'number',
      count_distinct: 'number',
      sum: 'number',
      avg: 'number',
      min: 'column',
      max: 'column',
    });
  });
});

describe("[#20889] presentAsNumber — the 'number' presenter", () => {
  it('turns the numeric text a SQL client hands back into the number it spells', () => {
    // count / count_distinct (`bigint`), sum over an integer column (`bigint`).
    expect(presentAsNumber('2')).toBe(2);
    expect(presentAsNumber('11')).toBe(11);
    // avg over an integer column (`numeric`, 16 places).
    expect(presentAsNumber('3.5000000000000000')).toBe(3.5);
    // sum / avg / min / max over the exact-decimal column (`numeric(65,30)`).
    expect(presentAsNumber('500.000000000000000000000000000000')).toBe(500);
    expect(presentAsNumber('20.500000000000000000000000000000')).toBe(20.5);
    expect(presentAsNumber('0.125000000000000000000000000000')).toBe(0.125);
    expect(presentAsNumber('-7.250000000000000000000000000000')).toBe(-7.25);
  });

  it('precision policy: a total a double cannot hold answers the nearest double, never a string', () => {
    const big = presentAsNumber('9007199254740993.000000000000000000000000000000');
    expect(typeof big).toBe('number');
    expect(big).toBe(9007199254740992);
    expect(big).toBe(Number('9007199254740993'));
    const decimal = presentAsNumber('12345678901234567.123456789000000000000000000000');
    expect(typeof decimal).toBe('number');
    expect(decimal).toBe(12345678901234568);
    expect(decimal).toBe(Number('12345678901234567.123456789'));
  });

  it('passes every value that is not numeric text through as given', () => {
    expect(presentAsNumber(7)).toBe(7);
    expect(presentAsNumber(0.30000000000000004)).toBe(0.30000000000000004);
    expect(presentAsNumber(null)).toBeNull();
    expect(presentAsNumber(undefined)).toBeUndefined();
    expect(presentAsNumber(true)).toBe(true);
    expect(presentAsNumber('')).toBe('');
    expect(presentAsNumber('   ')).toBe('   ');
    // PostgreSQL's `numeric` 'NaN', and text `Number()` cannot read, stay as written.
    expect(presentAsNumber('NaN')).toBe('NaN');
    expect(presentAsNumber('abc')).toBe('abc');
    const date = new Date(0);
    expect(presentAsNumber(date)).toBe(date);
  });
});
