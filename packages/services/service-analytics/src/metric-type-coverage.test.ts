// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Every `AggregationMetricType` a measure can declare is handled, and handled
 * as itself (#4157) — and a type outside it is refused in the spec's words
 * (#21000).
 *
 * `resolveMeasureSql` used to answer `COUNT(*)` to three different questions:
 * an undeclared measure, a custom-SQL-expression metric type, and an
 * unrecognised type. Each returned a plausible number — aliased under the name
 * the caller asked for — for a query that asked for something else.
 *
 * The custom-SQL-expression types (`number` / `string` / `boolean`) were
 * retired from the spec, so the metric vocabulary IS the six aggregates this
 * runtime lowers, and the partition that used to split it in two is gone. The
 * table must still EQUAL the spec's vocabulary rather than merely cover it: a
 * new member the spec grows (`median`, …) fails here, before it can reach
 * `aggregateOfMeasure`'s drift sentence.
 */
import { describe, it, expect } from 'vitest';
import { AggregationMetricType } from '@objectstack/spec/data';
import {
  SUPPORTED_AGGREGATE_SQL_KEYS,
  aggregateOfMeasure,
} from './strategies/native-sql-strategy.js';

describe('AggregationMetricType coverage', () => {
  it('is exactly the aggregates this runtime lowers', () => {
    expect([...SUPPORTED_AGGREGATE_SQL_KEYS].sort()).toEqual([...AggregationMetricType.options].sort());
  });

  it('leaves no metric type to the refusal', () => {
    for (const type of AggregationMetricType.options) {
      expect(aggregateOfMeasure('orders', 'm', type), type).toBe(type);
    }
  });

  it('records the current vocabulary, so a change shows up in review', () => {
    expect([...SUPPORTED_AGGREGATE_SQL_KEYS].sort())
      .toEqual(['avg', 'count', 'count_distinct', 'max', 'min', 'sum']);
  });

  it.each(['number', 'string', 'boolean'])(
    'refuses the retired custom-SQL type "%s" with the spec\'s own prescription',
    (type) => {
      const err = (() => {
        try {
          aggregateOfMeasure('orders', 'm', type);
        } catch (e) {
          return e as Error & { code?: string; status?: number };
        }
        return undefined;
      })();
      const spec = AggregationMetricType.safeParse(type);
      expect(spec.success).toBe(false);
      expect(err).toBeInstanceOf(Error);
      expect(err!.message).toContain(`measure "m" on cube "orders" cannot be served`);
      // The words are the spec's, verbatim — no second copy to drift.
      expect(err!.message).toContain(spec.error!.issues[0]!.message);
      expect(err!.message).toContain(`\`${type}\` was removed from \`AggregationMetricType\``);
      // Undeclared-500 tier: no ADR-0112 envelope (`dataset-refusal.ts` header).
      expect(err!.code).toBeUndefined();
      expect(err!.status).toBeUndefined();
    },
  );

  it('refuses a type the spec never declared with the spec\'s vocabulary, not a retirement', () => {
    let message = '';
    try {
      aggregateOfMeasure('orders', 'm', 'median');
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('cannot be served: its type "median"');
    expect(message).not.toMatch(/was removed/);
    for (const type of AggregationMetricType.options) expect(message).toContain(type);
  });
});
