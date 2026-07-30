// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * One aggregate vocabulary, three places that must agree (objectui#2945 Track C).
 *
 *   1. `AggregationFunction` (`@objectstack/spec/data`) — what an author may
 *      declare as a dataset measure's `aggregate`.
 *   2. `UNSUPPORTED_AGGREGATES` (`dataset-compiler.ts`) — the ones v1 rejects at
 *      compile time, with a clear error.
 *   3. `AGGREGATE_SQL` (`native-sql-strategy.ts`) — the ones it can lower to SQL.
 *
 * (2) and (3) are complements of each other over (1), and nothing enforced it.
 * The strategy used to `switch` with `default: return 'COUNT(*)'`, so an
 * aggregate added to the spec would pass the compiler's gate, be advertised as
 * supported by its error message, and then return **a row count in place of the
 * number the author asked for** — no error, no log, wrong analytics.
 *
 * These tests make that arithmetic explicit, so growing the vocabulary fails
 * here instead of shipping a silently wrong figure.
 */
import { describe, it, expect } from 'vitest';
import { AggregationFunction } from '@objectstack/spec/data';
import { UNSUPPORTED_AGGREGATES, SUPPORTED_AGGREGATES } from './dataset-compiler.js';
import { SUPPORTED_AGGREGATE_SQL_KEYS } from './strategies/native-sql-strategy.js';

describe('aggregate vocabulary lockstep', () => {
  it('the strategy lowers exactly the aggregates the compiler admits', () => {
    expect([...SUPPORTED_AGGREGATE_SQL_KEYS].sort()).toEqual([...SUPPORTED_AGGREGATES].sort());
  });

  it('every spec aggregate is either lowered or explicitly rejected', () => {
    const lowered = new Set(SUPPORTED_AGGREGATE_SQL_KEYS);
    const unhandled = AggregationFunction.options.filter(
      (a: string) => !lowered.has(a) && !UNSUPPORTED_AGGREGATES.has(a),
    );
    expect(
      unhandled,
      'these would fall through to the COUNT(*) fallback and return a row count',
    ).toEqual([]);
  });

  it('nothing is both rejected and lowered', () => {
    const both = SUPPORTED_AGGREGATE_SQL_KEYS.filter((a) => UNSUPPORTED_AGGREGATES.has(a));
    expect(both).toEqual([]);
  });

  it('the rejection list names only aggregates the spec actually has', () => {
    // A stale entry here silently *widens* what v1 claims to support: the name
    // is subtracted from SUPPORTED_AGGREGATES for nothing.
    const stray = [...UNSUPPORTED_AGGREGATES].filter(
      (a) => !(AggregationFunction.options as string[]).includes(a),
    );
    expect(stray).toEqual([]);
  });

  it('the two halves partition the vocabulary', () => {
    expect(SUPPORTED_AGGREGATES.length + UNSUPPORTED_AGGREGATES.size)
      .toBe(AggregationFunction.options.length);
  });

  it('records the current split, so a vocabulary change is visible in review', () => {
    expect([...SUPPORTED_AGGREGATES].sort())
      .toEqual(['avg', 'count', 'count_distinct', 'max', 'min', 'sum']);
    expect([...UNSUPPORTED_AGGREGATES].sort()).toEqual(['array_agg', 'string_agg']);
  });
});

describe('the compiler error message is derived, not restated', () => {
  it('names every supported aggregate, and none of the unsupported ones', async () => {
    const { compileDataset } = await import('./dataset-compiler.js');
    let message = '';
    try {
      compileDataset({
        name: 'agg_probe',
        object: 'showcase_task',
        dimensions: [{ name: 'status', field: 'status', type: 'string' }],
        measures: [{ name: 'names', field: 'title', aggregate: 'string_agg' }],
      } as never);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('string_agg');
    for (const a of SUPPORTED_AGGREGATES) {
      expect(message, `error message omits supported aggregate "${a}"`).toContain(a);
    }
    // The prose list it replaced would have kept claiming these are supported.
    expect(message).not.toContain('array_agg,');
  });
});
