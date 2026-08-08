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
 *
 * ---
 *
 * # [#6409] Class 2 emptied: `count_distinct` COMPILES
 *
 * The measurement at the top of this file is now history in one row. `LOCAL
 * count_distinct` no longer throws at all — it lowers to `COUNT(DISTINCT x)`,
 * the ENFORCE leg of #6188's split ruling, landed on both SQL faces in one
 * change. The class-2 block below is flipped rather than deleted, and the
 * distinction matters: what replaced the 501 assertions is not silence but the
 * NEW substance —
 *
 * - the declared-minus-compiled set is asserted to be **empty**, positively,
 *   so the day the spec grows a function this driver does not lower, this file
 *   goes red rather than quietly stopping to cover anything;
 * - `count_distinct` is asserted to **compute the right number** here, with the
 *   dedup and the NULL exclusion both visible in the fixture, so "it stopped
 *   refusing" cannot be mistaken for "it works";
 * - the refusal WORDING is asserted to have lost `count_distinct` as a subject —
 *   the "Compiled here:" list now names it.
 *
 * The class-1 cases are untouched: `median`, `array_agg`, `string_agg` and the
 * miscased spellings are still names the Query Protocol does not declare, and
 * their refusals stay verbatim. A pin is flipped only where the fact under it
 * moved.
 *
 * The VALUES `count_distinct` computes, and the fact that the remote face
 * computes the same ones, are the shared table's job
 * (`AGGREGATION_CASES`, run by `sql-driver-aggregation-conformance.test.ts` and
 * its remote twin). What stays here is this file's own subject: which door a
 * name goes through, and what the refusal says when it is refused.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import { AggregationFunction } from '@objectstack/spec/data';
import type { AggregationNode, QueryAST } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * [#4918] The two classes this file separates are ALSO two different type
 * situations, and the query values are built to say so rather than erased to
 * `any`:
 *
 * - {@link declaredAst} is on-contract. `function` is typed
 *   `AggregationNode['function']`, so `tsc` proves the class-2 fixtures
 *   (`count_distinct` / `array_agg` / `string_agg`) really are members of the
 *   declared enum — which is the exact claim class 2 makes at runtime. A typo
 *   there would fail the build instead of silently testing a class-1 input.
 * - {@link undeclaredAst} is DELIBERATELY off-contract: `function: 'median'`
 *   cannot be a `QueryAST`, because that is the whole point of the test. It is
 *   spelled `as unknown as QueryAST` rather than `as any` — naming the contract
 *   being bypassed, keeping every other key checked, and greppable as an
 *   intentional act.
 */
const declaredAst = (
  fn: AggregationNode['function'],
  field: string | null = 'stage',
): QueryAST => ({
  object: 'deal',
  aggregations: [{ function: fn, ...(field ? { field } : {}), alias: 'n' }],
});

const undeclaredAst = (fn: string): QueryAST => ({
  object: 'deal',
  aggregations: [{ function: fn, field: 'stage', alias: 'n' }],
}) as unknown as QueryAST;

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

  const refusalOfAst = async (fn: string, ast: QueryAST): Promise<WireBearingError> => {
    try {
      await driver.aggregate('deal', ast);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error(`expected the driver to refuse "${fn}", but it resolved`);
  };

  /** Class 1's inputs: off-contract by construction — see {@link undeclaredAst}. */
  const refusalOfUndeclared = (fn: string) => refusalOfAst(fn, undeclaredAst(fn));

  // [#6409] `refusalOfDeclared` — the class-2 helper — is gone with the class.
  // It took an `AggregationNode['function']` and there is no longer a member of
  // that type this driver refuses, so keeping it would have been a helper with
  // no callable input rather than a helper with no caller.

  // ── Class 1: the Query Protocol does not declare this name ─────────────────

  describe('a function name the Query Protocol never declared', () => {
    // `median` is the issue's own repro. The rest are the names a SQL-fluent
    // author reaches for that `AggregationFunction` does not declare.
    //
    // `array_agg` / `string_agg` MOVED HERE from class 2 at #6188: the ruling
    // retired both from `AggregationFunction`, so they are no longer "declared
    // but not compiled by this backend" (501) — they are names the protocol
    // does not declare (400), exactly like `group_concat` beside them. Keeping
    // them covered on this side of the split is the point: the answer to the
    // same input changed, and this is where that change is legible.
    const UNDECLARED = [
      'median', 'stddev', 'percentile_cont', 'group_concat', 'array_agg', 'string_agg',
    ];

    for (const fn of UNDECLARED) {
      it(`refuses "${fn}" with INVALID_QUERY / 400`, async () => {
        const err = await refusalOfUndeclared(fn);
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
        const err = await refusalOfUndeclared(fn);
        expect(err.code).toBe('INVALID_QUERY');
        expect(err.status).toBe(400);
        expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
        // The caller's own spelling is quoted back — that is the actionable part.
        expect(err.message).toContain(`"${fn}"`);
      });
    }
  });

  // ── Class 2: declared by the protocol, not compiled by this backend ────────

  describe('[#6409] class 2 is empty — every declared function compiles here', () => {
    // The list this block used to loop over. `count_distinct` was its last
    // member (`array_agg`/`string_agg` left at #6188, retired rather than
    // implemented); #6409 lowered it, so the set is empty and there is no
    // 501-bearing input left to construct. The TYPE annotation is kept even on
    // an empty array — it is what makes re-adding a name here a `tsc`-checked
    // claim that the name really is declared (#4918).
    const UNCOMPILABLE: Array<AggregationNode['function']> = [];

    // The guard, now asserting the NEW fact rather than the old fixture: the
    // declared vocabulary and this driver's compiled vocabulary are the SAME
    // SET. It fails in both directions — the spec growing a function this
    // driver does not lower, or this driver's table drifting away from the
    // enum — which is exactly the pair of events that would otherwise leave
    // this block silently covering nothing.
    it('the declared-but-uncompiled set is EMPTY', () => {
      const compiled = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];
      expect([...AggregationFunction.options].filter((f) => !compiled.includes(f)).sort())
        .toEqual([...UNCOMPILABLE].sort());
      expect(UNCOMPILABLE).toEqual([]);
    });

    // The substance that replaced the 501 assertion for `count_distinct`: it
    // ANSWERS, and with the right number. `stage` is `won`/`lost` over two rows
    // here, so the dedup is not visible in this fixture — the fixture that
    // exercises dedup and NULL exclusion is `AGGREGATION_ROWS`, run against
    // both SQL faces by the conformance suites. What this case pins is the
    // DOOR: the name no longer reaches `refuseAggregateFunction` at all.
    it('`count_distinct` goes through the compile door, not the refusal door', async () => {
      expect(await driver.aggregate('deal', declaredAst('count_distinct', 'stage')))
        .toEqual([{ n: 2 }]);
    });

    // The wording half of the acceptance: the refusal message no longer names
    // `count_distinct` as unsupported. Read off a REAL refusal — the message is
    // built from the lowering table, so this goes red the day the table and the
    // message disagree.
    it('the refusal message names `count_distinct` among the functions it COMPILES', async () => {
      const err = await refusalOfUndeclared('median');
      expect(err.message).toContain('count, sum, avg, min, max, count_distinct');
      // ⛔ It must not be listed as a gap: that sentence belongs to class 2,
      // which no longer has an inhabitant.
      expect(err.message).not.toContain('count_distinct" is declared but not implemented');
    });

    // The class-2 PRODUCER is deliberately still in `sql-driver.ts` even with
    // nothing to produce — see its docblock. This case states the consequence
    // of that decision so the unreachable branch is not read as an oversight:
    // the wording it would emit is still the wording #5907 ruled, and the
    // sentence constant is still exercised.
    it('the two refusal sentences remain distinguishable', () => {
      expect(UNCOMPILABLE_SENTENCE('x')).not.toBe(UNDECLARED_SENTENCE('x'));
      expect(UNCOMPILABLE_SENTENCE('x')).toContain('declared but not implemented');
    });
  });

  // ── Controls: nothing but the refusal's identity moved ─────────────────────

  describe('the compiled vocabulary is untouched', () => {
    it('every function this driver lowers still computes its value', async () => {
      expect(await driver.aggregate('deal', declaredAst('count', 'id'))).toEqual([{ n: 2 }]);
      expect(await driver.aggregate('deal', declaredAst('sum', 'score'))).toEqual([{ n: 30 }]);
      expect(await driver.aggregate('deal', declaredAst('avg', 'score'))).toEqual([{ n: 15 }]);
      expect(await driver.aggregate('deal', declaredAst('min', 'score'))).toEqual([{ n: 10 }]);
      expect(await driver.aggregate('deal', declaredAst('max', 'score'))).toEqual([{ n: 20 }]);
    });

    it('COUNT(*) — the `field`-less spelling the spec allows — still answers', async () => {
      expect(await driver.aggregate('deal', declaredAst('count', null))).toEqual([{ n: 2 }]);
    });

    it('grouped aggregation still answers', async () => {
      const ast: QueryAST = {
        object: 'deal',
        groupBy: ['stage'],
        aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
      };
      const rows = await driver.aggregate('deal', ast);
      expect((rows as any[]).map((r) => `${r.stage}:${r.n}`).sort()).toEqual(['lost:1', 'won:1']);
    });
  });
});
