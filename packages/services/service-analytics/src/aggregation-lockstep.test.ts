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
import { SUPPORTED_AGGREGATE_SQL_KEYS, CONDITIONAL_AGGREGATE_SQL_KEYS } from './strategies/native-sql-strategy.js';

describe('aggregate vocabulary lockstep', () => {
  it('the strategy lowers exactly the aggregates the compiler admits', () => {
    expect([...SUPPORTED_AGGREGATE_SQL_KEYS].sort()).toEqual([...SUPPORTED_AGGREGATES].sort());
  });

  it('every lowered aggregate also has a measure-FILTERED form (#10298)', () => {
    // Two tables in the strategy: the plain wrapper and the conditional one a
    // measure's own `filter` selects. An aggregate present in the first only
    // does not fail — it silently DROPS the author's filter and answers the
    // unfiltered number under the filtered measure's name, which is the defect
    // #10298 closed on the whole vocabulary at once. Pinned as set equality so
    // the next aggregate added to one table and not the other fails here.
    expect([...CONDITIONAL_AGGREGATE_SQL_KEYS].sort())
      .toEqual([...SUPPORTED_AGGREGATE_SQL_KEYS].sort());
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
    // Empty since #6188: the rejection list's two members (`array_agg`,
    // `string_agg`) were retired from the spec instead, so the refusal moved
    // one layer earlier — to the parse, where it carries a prescription. The
    // split is now "everything declared is lowered", which is the state
    // ADR-0049 asks for; this line is what makes a regression away from it
    // visible in review.
    expect([...UNSUPPORTED_AGGREGATES].sort()).toEqual([]);
  });

  it('the spec no longer declares the two aggregates this runtime refused', () => {
    // The other direction of the same fact, asserted against the spec rather
    // than against our subtraction list — so re-adding either upstream fails
    // here even if someone also re-adds it to `UNSUPPORTED_AGGREGATES` and
    // keeps the partition arithmetic balanced.
    expect(AggregationFunction.options as string[]).not.toContain('array_agg');
    expect(AggregationFunction.options as string[]).not.toContain('string_agg');
    // Kept deliberately (maintainer ruling 2026-08-07): it takes ADR-0049's
    // enforce leg, and this compiler already lowers it.
    expect(AggregationFunction.options as string[]).toContain('count_distinct');
  });
});

describe('the compiler error message is derived, not restated', () => {
  it('names every supported aggregate, and none of the unsupported ones', async () => {
    const { compileDataset } = await import('./dataset-compiler.js');

    // #6188 emptied `UNSUPPORTED_AGGREGATES`, so no real value reaches the
    // refusal branch any more. The branch is still the landing site for the
    // next aggregate the spec declares ahead of this runtime, so the probe is
    // injected rather than dropped — testing the message's DERIVATION, which
    // is what this suite was written for, instead of the retired member that
    // happened to trigger it.
    UNSUPPORTED_AGGREGATES.add('probe_agg');
    let message = '';
    try {
      compileDataset({
        name: 'agg_probe',
        object: 'showcase_task',
        dimensions: [{ name: 'status', field: 'status', type: 'string' }],
        measures: [{ name: 'names', field: 'title', aggregate: 'probe_agg' }],
      } as never);
    } catch (e) {
      message = (e as Error).message;
    } finally {
      UNSUPPORTED_AGGREGATES.delete('probe_agg');
    }
    expect(message).toContain('probe_agg');
    for (const a of SUPPORTED_AGGREGATES) {
      expect(message, `error message omits supported aggregate "${a}"`).toContain(a);
    }
    // The prose list it replaced would have kept claiming the refused one is
    // supported; the derived message names it only as the rejected value.
    expect(message).not.toContain('probe_agg,');
  });
});
