// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `AggregationMetricType` a measure can declare is handled, and handled
 * as itself (#4157).
 *
 * `resolveMeasureSql` used to answer `COUNT(*)` to three different questions:
 * an undeclared measure, a custom-SQL-expression metric type, and an
 * unrecognised type. Each returned a plausible number — aliased under the name
 * the caller asked for — for a query that asked for something else.
 *
 * The two sets below must partition the spec's vocabulary. Deriving one as "the
 * complement of the other" would defeat the point: a *new aggregate* the spec
 * grows would be classified as an expression and emitted as a bare column,
 * which is a different silent wrong answer. Naming both makes a new member fail
 * here instead.
 */
import { describe, it, expect } from 'vitest';
import { AggregationMetricType } from '@objectstack/spec/data';
import {
  SUPPORTED_AGGREGATE_SQL_KEYS,
  EXPRESSION_METRIC_TYPES,
} from './strategies/native-sql-strategy.js';

describe('AggregationMetricType coverage', () => {
  it('is partitioned by the aggregate and expression sets', () => {
    const handled = [...SUPPORTED_AGGREGATE_SQL_KEYS, ...EXPRESSION_METRIC_TYPES].sort();
    expect(handled).toEqual([...AggregationMetricType.options].sort());
  });

  it('leaves no metric type to the unrecognised-type throw', () => {
    const handled = new Set([...SUPPORTED_AGGREGATE_SQL_KEYS, ...EXPRESSION_METRIC_TYPES]);
    const unhandled = AggregationMetricType.options.filter((t: string) => !handled.has(t));
    expect(
      unhandled,
      'a declared metric type that reaches the throw is a spec member no query can use',
    ).toEqual([]);
  });

  it('classifies nothing as both an aggregate and an expression', () => {
    const both = SUPPORTED_AGGREGATE_SQL_KEYS.filter((a) => EXPRESSION_METRIC_TYPES.has(a));
    expect(both).toEqual([]);
  });

  it('records the current split, so a vocabulary change shows up in review', () => {
    expect([...SUPPORTED_AGGREGATE_SQL_KEYS].sort())
      .toEqual(['avg', 'count', 'count_distinct', 'max', 'min', 'sum']);
    expect([...EXPRESSION_METRIC_TYPES].sort()).toEqual(['boolean', 'number', 'string']);
  });
});
