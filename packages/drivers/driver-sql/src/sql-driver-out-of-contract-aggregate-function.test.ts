// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5907] An aggregate function this driver cannot compile is refused with a
 * WIRE IDENTITY — and with the identity that matches which kind of "no" it is.
 *
 * # What was measured on `origin/main` @ `80f7dc6a3`
 *
 * One `SqlDriver` (better-sqlite3, `:memory:`) and one `RemoteTransport`, the
 * same `aggregations: [{ function, field: 'stage', alias: 'n' }]`:
 *
 * ```
 * REMOTE median          -> THREW code=undefined status=undefined msg="Unsupported aggregate function: median"
 * LOCAL  median          -> THREW code=undefined status=undefined msg="Unsupported aggregate function: median"
 * REMOTE count_distinct  -> THREW code=undefined status=undefined msg="Unsupported aggregate function: count_distinct"
 * LOCAL  count_distinct  -> THREW code=undefined status=undefined msg="Unsupported aggregate function: count_distinct"
 * REMOTE array_agg       -> THREW code=undefined status=undefined msg="Unsupported aggregate function: array_agg"
 * LOCAL  array_agg       -> THREW code=undefined status=undefined msg="Unsupported aggregate function: array_agg"
 * REMOTE string_agg      -> THREW code=undefined status=undefined msg="Unsupported aggregate function: string_agg"
 * LOCAL  string_agg      -> THREW code=undefined status=undefined msg="Unsupported aggregate function: string_agg"
 * ```
 *
 * Two defects in one line. The `code`/`status` are absent, so `mapDataError`
 * falls to its default branch and a caller's `median` typo arrives as an opaque
 * 500 — the #1116/#1117 gap moved from the filter door to the aggregate door.
 * And the two conditions are indistinguishable: `median` is a name the Query
 * Protocol never declared, while `count_distinct` IS declared (and compiled by
 * `driver-mongodb`, and by `driver-memory`'s analytics face), so one message for
 * both tells a dashboard author their correct query is a typo — the line #5345
 * drew in `driver-memory`'s `filter-refusal.ts` between "the protocol has no
 * such operator" and "the protocol has it, this face cannot lower it".
 *
 * # ⚠️ Why every case asserts `code` AND `status`, never merely "it threw"
 *
 * Read the measurement again: the UNFIXED driver throws on all four inputs. A
 * test that asserted only `rejects.toThrow()` would have been green before this
 * change and green after it — permanently blind to the entire defect (#6144).
 * The refusal was never missing; its wire identity was.
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Prediction: with `mapAggregateFunc`'s bare `throw new Error(...)` restored and
 * nothing else changed, every refusal case here goes RED on its FIRST assertion
 * (`err.code` → `undefined`), and NOT ONE fails through `refusalOf`'s "expected
 * a refusal, but it resolved" branch — because the un-fixed driver refuses
 * exactly the same inputs, just anonymously. The controls (the five compiled
 * functions, and the values they compute) must stay GREEN, pinning that the
 * change moved the refusal's identity and nothing else.
 *
 * Measured after writing that down, with `mapAggregateFunc`'s refusal replaced
 * by ``throw new Error(`Unsupported aggregate function: ${func}`)`` and nothing
 * else changed: **10 failed / 4 passed** of 14. Every one of the 10 failed on
 * `expected undefined to be 'INVALID_QUERY'` or `expected undefined to be
 * 'NOT_IMPLEMENTED'` — not one through `refusalOf`'s "it resolved" branch, which
 * is the predicted direction and the #6144 point restated as evidence: the
 * refusal was already there, only its identity was missing. The 4 green are the
 * three controls plus the declared-minus-compiled fixture guard, pinning that
 * nothing outside the refusal's identity moved.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import { AggregationFunction } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The first sentences, spelled out here rather than imported: this is the
 * contract #5240 asks for ("one condition, one wording"), and a test that read
 * the same constant the producer reads would pass however the wording drifted.
 * The twin in `driver-turso` repeats these bytes, and
 * `remote-transport-aggregate-function-refusal.test.ts` compares the two
 * RUNTIME messages so the two faces cannot drift apart either.
 */
const UNDECLARED_SENTENCE = (f: string) =>
  `Aggregate function "${f}" is not a declared aggregate function.`;
const UNCOMPILABLE_SENTENCE = (f: string) =>
  `Aggregate function "${f}" is declared but not implemented by this backend.`;

describe('[#5907] SqlDriver refuses an aggregate function it cannot compile', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([
      {
        name: 'deal',
        fields: {
          id: { type: 'text', name: 'id' },
          stage: { type: 'text', name: 'stage' },
          score: { type: 'number', name: 'score' },
        },
      } as any,
    ]);
    await driver.create('deal', { id: '1', stage: 'won', score: 10 });
    await driver.create('deal', { id: '2', stage: 'lost', score: 20 });
  });

  const aggregate = (fn: string, field: string | undefined = 'stage') =>
    driver.aggregate('deal', {
      object: 'deal',
      aggregations: [{ function: fn, ...(field ? { field } : {}), alias: 'n' }],
    } as any);

  const refusalOf = async (fn: string): Promise<WireBearingError> => {
    try {
      await aggregate(fn);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error(`expected the driver to refuse "${fn}", but it resolved`);
  };

  // ── Class 1: the Query Protocol does not declare this name ─────────────────

  describe('a function name the Query Protocol never declared', () => {
    // `median` is the issue's own repro. The rest are the names a SQL-fluent
    // author reaches for that `AggregationFunction` does not declare.
    const UNDECLARED = ['median', 'stddev', 'percentile_cont', 'group_concat'];

    for (const fn of UNDECLARED) {
      it(`refuses "${fn}" with INVALID_QUERY / 400`, async () => {
        const err = await refusalOf(fn);
        expect(err.code).toBe('INVALID_QUERY');
        expect(err.status).toBe(400);
        expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
        // The remedy is in the message: what the protocol DOES declare.
        for (const declared of AggregationFunction.options) {
          expect(err.message).toContain(declared);
        }
        // …and it must not be mistaken for the capability-gap answer.
        expect(err.message).not.toContain('capability gap');
        // #3867 — no driver-internal prefix on the wire.
        expect(err.message).not.toContain('[sql-driver]');
      });
    }

    // The case-sensitivity ruling, pinned. `AggregationFunction` is a
    // case-SENSITIVE `z.enum`, so `COUNT_DISTINCT` is not `count_distinct` and
    // "declared but not implemented" would be false of it. It also keeps the two
    // faces in step: the remote transport lowercases before ITS lookup, so
    // classifying on each face's post-normalisation name would answer 400 here
    // and 501 there for one query — the local/remote fork this issue closes.
    const MISCASED = ['COUNT_DISTINCT', 'Median', 'COUNT'];
    for (const fn of MISCASED) {
      it(`refuses the miscased "${fn}" as UNDECLARED (400), not as a capability gap`, async () => {
        const err = await refusalOf(fn);
        expect(err.code).toBe('INVALID_QUERY');
        expect(err.status).toBe(400);
        expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
        // The caller's own spelling is quoted back — that is the actionable part.
        expect(err.message).toContain(`"${fn}"`);
      });
    }
  });

  // ── Class 2: declared by the protocol, not compiled by this backend ────────

  describe('a DECLARED function this backend cannot compile', () => {
    // Exactly the three `AggregationFunction` declares with no SQL lowering.
    const UNCOMPILABLE = ['count_distinct', 'array_agg', 'string_agg'];

    // Guard: the fixture is the real declared-minus-compiled set, derived rather
    // than trusted. If the spec drops one (that decision is #6188) or this driver
    // implements one, this fails HERE rather than leaving a case that passes
    // because nothing is produced.
    it('the fixture is exactly the declared-but-uncompiled set', () => {
      const compiled = ['count', 'sum', 'avg', 'min', 'max'];
      expect([...AggregationFunction.options].filter((f) => !compiled.includes(f)).sort())
        .toEqual([...UNCOMPILABLE].sort());
    });

    for (const fn of UNCOMPILABLE) {
      it(`refuses "${fn}" with NOT_IMPLEMENTED / 501`, async () => {
        const err = await refusalOf(fn);
        expect(err.code).toBe('NOT_IMPLEMENTED');
        expect(err.status).toBe(501);
        expect(err.message.startsWith(UNCOMPILABLE_SENTENCE(fn))).toBe(true);
        // ⛔ The author is NOT told they made a mistake — the whole point of
        // splitting the two classes (#5345's line, applied to aggregations).
        expect(err.message).not.toContain('is not a declared aggregate function');
        expect(err.message).toContain('spelled');
        expect(err.message).toContain('capability gap');
        // The functions that DO work here, so the message is actionable.
        expect(err.message).toContain('count, sum, avg, min, max');
        expect(err.message).not.toContain('[sql-driver]');
      });
    }
  });

  // ── Controls: nothing but the refusal's identity moved ─────────────────────

  describe('the compiled vocabulary is untouched', () => {
    it('every function this driver lowers still computes its value', async () => {
      expect(await aggregate('count', 'id')).toEqual([{ n: 2 }]);
      expect(await aggregate('sum', 'score')).toEqual([{ n: 30 }]);
      expect(await aggregate('avg', 'score')).toEqual([{ n: 15 }]);
      expect(await aggregate('min', 'score')).toEqual([{ n: 10 }]);
      expect(await aggregate('max', 'score')).toEqual([{ n: 20 }]);
    });

    it('COUNT(*) — the `field`-less spelling the spec allows — still answers', async () => {
      expect(await aggregate('count', undefined)).toEqual([{ n: 2 }]);
    });

    it('grouped aggregation still answers', async () => {
      const rows = await driver.aggregate('deal', {
        object: 'deal',
        groupBy: ['stage'],
        aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
      } as any);
      expect((rows as any[]).map((r) => `${r.stage}:${r.n}`).sort()).toEqual(['lost:1', 'won:1']);
    });
  });
});
