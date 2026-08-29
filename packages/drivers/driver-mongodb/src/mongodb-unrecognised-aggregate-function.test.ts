// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12818] An aggregate function this builder does not lower is REFUSED, with
 * the wire identity that says which kind of "no" it is — where it used to be
 * answered as a SUM of the column.
 *
 * # What was measured on `origin/main` @ `cd1348802`
 *
 * `buildAccumulator`'s switch ended:
 *
 * ```js
 * default:
 *   return { $sum: fieldRef ?? 0 };
 * ```
 *
 * so `{ function: 'median', field: 'score', alias: 'm' }` built
 * `{ $group: { _id: null, m: { $sum: '$score' } } }` and, over
 * `AGGREGATION_ROWS`, ANSWERED `m: 210`. No error, no envelope, no log — the
 * sum of the column, under the alias the caller asked for. That is the worst
 * available answer: `median` is not `sum`, but 210 is a number a dashboard tile
 * renders without complaint, so nothing downstream can tell the difference
 * between "your function ran" and "your function was silently replaced".
 *
 * It is the "answers rather than fails" family this file's history is made of:
 * the `"[object Object]"` `$group._id` (#6850) and the `count_distinct` that
 * kept its nulls (#6814) both emitted well-formed pipelines and returned
 * plausible numbers.
 *
 * # ⚠️ Why every case asserts `code` AND `status`, never merely "it threw"
 *
 * The inverse of the trap `driver-sql`'s twin records, and it bites the other
 * way round here. On that face the un-fixed driver already threw (anonymously),
 * so `rejects.toThrow()` was permanently green. On THIS face the un-fixed
 * builder does not throw at all — it returns a pipeline — so a bare `toThrow()`
 * would catch the defect today and go blind the moment somebody replaces the
 * ADR-0112 envelope with a bare `Error`, which is exactly the state #5907 found
 * on the SQL faces. The envelope IS the deliverable: `mapDataError` reads
 * `code`/`status`, and without them a legible client mistake reaches the caller
 * as an opaque 500.
 *
 * # What this file does NOT establish
 *
 * That a real mongod agrees with any pipeline here. This fleet cannot run one:
 * there is no daemon on the box and no image path, and the `mongodb-memory-server`
 * download is refused by the egress proxy (#5517 — the real-server suites in
 * this package have been opt-in since). Every value below is produced by
 * `mongodb-pipeline-evaluator.testkit.ts`, a strict in-process reader modelled
 * from the MongoDB manual. That bound is real and is not weakened by this card:
 * a REFUSAL, though, is decided entirely inside `buildAggregationPipeline`
 * before a single stage reaches a server, so it is one of the few claims here
 * that a live catalog could not tell us more about. The positive controls are
 * the half that carries the bound — they say "the evaluator computes these
 * numbers from the emitted pipeline", not "MongoDB returns them".
 *
 * # Reverse verification — direction predicted BEFORE it was run
 *
 * Prediction: restore the `default: return { $sum: fieldRef ?? 0 };` arm and
 * change nothing else, and every refusal case here fails on its FIRST
 * assertion — `refusalOf`'s "expected a refusal, but it returned a pipeline"
 * — and NOT on `expected undefined to be 'INVALID_QUERY'`, because the un-fixed
 * builder does not throw anonymously, it answers. (That is the opposite
 * direction from `driver-sql`'s ablation of the same class, where every failure
 * was an absent `code`.) The controls — the six declared functions and the
 * numbers they compute — must stay GREEN, pinning that the change moved what
 * happens to UNRECOGNISED names and nothing else. (As written for #12818 that
 * control set ALSO named `array_agg` / `string_agg`, "the two retired ones this
 * face still lowers". #13075 closed that divergence, so they are controls no
 * longer: they are refusals, pinned below in the block that used to record the
 * lowering.)
 *
 * Measured: recorded on the PR.
 */

import { describe, it, expect } from 'vitest';
import { AggregationFunction, AGGREGATION_ROWS } from '@objectstack/spec/data';
import { buildAggregationPipeline, type AggregationInput } from './mongodb-aggregation.js';
import { runPipeline, type Doc } from './mongodb-pipeline-evaluator.testkit.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const ROWS = AGGREGATION_ROWS as unknown as Doc[];

/**
 * The first sentences, spelled out here rather than imported from the producer.
 * This is the contract #5240 asks for — "one condition, one wording", so a
 * caller cannot tell which backend answered from the words it used — and a test
 * that read the same constant the producer reads would pass however the wording
 * drifted. These bytes are the ones `driver-sql`'s
 * `sql-driver-out-of-contract-aggregate-function.test.ts` and `driver-turso`'s
 * `remote-transport-aggregate-function-refusal.test.ts` already spell for their
 * own faces; this is the third copy, for the third face.
 */
const UNDECLARED_SENTENCE = (f: string) =>
  `Aggregate function "${f}" is not a declared aggregate function.`;
const UNCOMPILABLE_SENTENCE = (f: string) =>
  `Aggregate function "${f}" is declared but not implemented by this backend.`;

/**
 * ⚠️ No `as unknown as` cast anywhere in this file, and that is a statement
 * rather than a convenience. `driver-sql`'s twin needs one because its fixtures
 * are `QueryAST`s, whose `aggregations[].function` is the declared enum.
 * `AggregationInput.function` is a bare `string` ON PURPOSE (see its docblock):
 * this builder is exported, its own driver reads aggregations through an `any`
 * cast, and `StrategyContext.executeAggregate` declares `method` as `string`
 * (#12776). An off-contract name reaching here needs no cast because nothing in
 * the type system is stopping it — which is the whole argument for a RUNTIME
 * refusal over the narrowing the card offered as its alternative.
 */
const aggs = (...entries: AggregationInput[]): AggregationInput[] => entries;

/** Build the pipeline for `fn`, expecting a refusal; return it. */
function refusalOf(fn: string, field: string | null = 'score'): WireBearingError {
  try {
    buildAggregationPipeline({
      aggregations: aggs({ function: fn, ...(field ? { field } : {}), alias: 'm' }),
    });
  } catch (err) {
    return err as WireBearingError;
  }
  throw new Error(`expected the builder to refuse "${fn}", but it returned a pipeline`);
}

/** Run a single whole-table aggregation through the evaluator and read its value. */
function value(fn: string, field?: string): unknown {
  const aggregations = aggs({ function: fn, ...(field ? { field } : {}), alias: 'm' });
  return runPipeline(ROWS, buildAggregationPipeline({ aggregations }))[0].m;
}

// ── Class 1: the Query Protocol does not declare this name ──────────────────

describe('[#12818] an UNDECLARED aggregate function answers INVALID_QUERY / 400', () => {
  // `median` is the card's own repro. The rest are what a SQL-fluent author
  // reaches for and `AggregationFunction` does not declare — the same roster
  // `driver-sql` refuses, minus `array_agg` / `string_agg`. Those two are
  // refused here as well since #13075 — but by `refuseRetiredAggregateFunction`,
  // whose first sentence says the name "was REMOVED" rather than "is not a
  // declared aggregate function", so they would fail the `startsWith` below.
  // They are pinned in their own block further down, rather than quietly
  // omitted from this one.
  const UNDECLARED = ['median', 'stddev', 'percentile_cont', 'group_concat', 'variance'];

  for (const fn of UNDECLARED) {
    it(`refuses "${fn}"`, () => {
      const err = refusalOf(fn);
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
      // The remedy is in the message: what the protocol DOES declare.
      for (const declared of AggregationFunction.options) {
        expect(err.message).toContain(declared);
      }
      // …and it must not be mistaken for the capability-gap answer. The
      // positive control for this zero-hit reading is a phrase that shares no
      // substring with the absent one, so "the message is empty" cannot pass
      // both lines.
      expect(err.message).not.toContain('capability gap');
      expect(err.message).toContain('no such function');
    });
  }

  // The case-sensitivity ruling, pinned. `AggregationFunction` is a
  // case-SENSITIVE `z.enum` (`AggregationFunction.parse('COUNT')` throws), so
  // `COUNT_DISTINCT` is not `count_distinct` and "declared but not implemented"
  // would be false of it. Same judgement the two SQL faces make, so one query
  // cannot get a 400 on one face and a 501 on another.
  for (const fn of ['COUNT_DISTINCT', 'Median', 'COUNT', 'SUM']) {
    it(`refuses the miscased "${fn}" as UNDECLARED, not as a capability gap`, () => {
      const err = refusalOf(fn);
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(true);
      // The caller's own spelling is quoted back — that is the actionable part.
      expect(err.message).toContain(`"${fn}"`);
    });
  }

  it('refuses a name with no `field` too — the SUM it used to answer was `0`', () => {
    // `fieldRef ?? 0` meant a field-less unrecognised function accumulated the
    // constant 0, i.e. `{ $sum: 0 }` = 0 per group. A zero is even quieter than
    // a plausible sum: it reads as "no matching rows".
    const err = refusalOf('median', null);
    expect(err.code).toBe('INVALID_QUERY');
    expect(err.status).toBe(400);
  });

  it('refuses the SECOND entry too, not just the first', () => {
    // The switch runs per aggregation; a call whose first entry is fine must
    // not smuggle the second past the door.
    let thrown: WireBearingError | undefined;
    try {
      buildAggregationPipeline({
        aggregations: aggs(
          { function: 'count', alias: 'n' },
          { function: 'median', field: 'score', alias: 'm' },
        ),
        groupBy: ['region'],
      });
    } catch (err) {
      thrown = err as WireBearingError;
    }
    expect(thrown, 'an unrecognised name in any position must be refused').toBeDefined();
    expect(thrown!.code).toBe('INVALID_QUERY');
    expect(thrown!.message).toContain('"median"');
  });
});

// ── Class 2: declared by the protocol, not lowered by this backend ──────────

describe('[#12818] class 2 is EMPTY — every declared function lowers here', () => {
  /**
   * The guard that keeps this block from silently covering nothing. It fails in
   * both directions: the spec growing a function this driver does not lower, or
   * this driver's roster drifting away from the enum. The lowered roster is not
   * exported, so it is restated here as the population the cases below drive —
   * and the cases are what hold the restatement honest.
   */
  const LOWERED = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'];

  /**
   * [#13075] The two names that LEFT the roster above, kept rather than
   * dropped. `array_agg` and `string_agg` sat on it because this face lowered
   * them; it refuses both now, so naming them as lowered would be the lie the
   * roster exists to prevent. But two names simply disappearing from a list is
   * exactly the shape a silent re-baseline takes, and from `main` it is
   * indistinguishable from the divergence reopening — so they move here and the
   * roster case below asserts the fact that replaced the one they used to pin.
   */
  const RETIRED_AND_REFUSED = ['array_agg', 'string_agg'];

  it('the declared-but-unlowered set is EMPTY', () => {
    expect([...AggregationFunction.options].filter((f) => !LOWERED.includes(f))).toEqual([]);
  });

  it('every declared function goes through the lowering door, not the refusal door', () => {
    for (const fn of AggregationFunction.options) {
      expect(
        () => buildAggregationPipeline({ aggregations: aggs({ function: fn, field: 'score', alias: 'm' }) }),
        `${fn} must lower, not refuse`,
      ).not.toThrow();
    }
  });

  it('every name on the lowered roster really lowers — the roster is not decoration', () => {
    // The other direction of the same equality: a name the refusal messages
    // claim is lowered here must not be refused by the switch. Without this the
    // roster could name a function the switch dropped, and the message would
    // advertise a lowering that does not exist.
    for (const fn of LOWERED) {
      expect(
        () => buildAggregationPipeline({ aggregations: aggs({ function: fn, field: 'score', alias: 'm' }) }),
        `${fn} is on the roster and must lower`,
      ).not.toThrow();
    }
    // [#13075] …and every name that left the roster really refuses. This half
    // is what makes the shrink above a measured change rather than a quiet one:
    // if `buildAccumulator` lowered either name again, the roster would be back
    // to advertising a lowering the switch does not perform, and nothing but
    // this loop would say so. The envelope is read, never a bare `toThrow()` —
    // `refusalOf` already fails loudly when a pipeline comes back instead.
    for (const fn of RETIRED_AND_REFUSED) {
      const err = refusalOf(fn);
      expect(err.code, `${fn} left the roster at #13075 and must refuse`).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
    }
  });

  it('the two refusal sentences remain distinguishable', () => {
    // The class-2 PRODUCER is deliberately kept in `mongodb-aggregation.ts`
    // with nothing to produce — see its docblock: it is the classifier that
    // decides which of two truths the FIRST function of a later spec bump is
    // told. This case states the consequence so the unreachable branch is not
    // read as an oversight, and keeps its sentence exercised.
    expect(UNCOMPILABLE_SENTENCE('x')).not.toBe(UNDECLARED_SENTENCE('x'));
    expect(UNCOMPILABLE_SENTENCE('x')).toContain('declared but not implemented');
  });
});

// ── The divergence this file recorded, CLOSED by #13075 ─────────────────────

describe('[#12818 → #13075] `array_agg` / `string_agg` are REFUSED here — the recorded divergence is CLOSED', () => {
  /**
   * #6188 retired both from `AggregationFunction` (ADR-0049 enforce-or-remove);
   * `driver-sql` and `driver-turso` have refused them as UNDECLARED names ever
   * since, while this face went on lowering them to `$push` — so one query
   * answered 400 on two backends and an array on the third. #12818 could not
   * close that (a second accept-face narrowing, its own changeset), so it
   * RECORDED the divergence here as two cases asserting the lowering, for one
   * reason: without them, the absence of `array_agg` from the UNDECLARED roster
   * above reads as an oversight in this file instead of a measured property of
   * this driver.
   *
   * #13075 closed it, and those two cases are INVERTED IN PLACE — not deleted,
   * not re-baselined. A pin whose fact a later card falsifies is the one kind
   * of test that must not quietly vanish: from `main`, its disappearance and
   * the divergence silently REOPENING look identical. Each case now asserts the
   * refusal that replaced the lowering it used to record.
   *
   * ⚠️ Class 1 / 400, but NOT the message the roster above asserts.
   * `refuseRetiredAggregateFunction` says the name "was REMOVED" at #6188,
   * which is a different fact from "is not a declared aggregate function" —
   * telling the author of `arry_agg` their value was removed would misinform,
   * and telling the author of `array_agg` the protocol never had the name would
   * too. Both producers are kept for that reason, the same distinction
   * `AggregationFunction`'s own error map draws. The envelope is what is
   * asserted — `code` and `status` (ADR-0112) — never a bare `toThrow()`, for
   * the reason this file's head note gives.
   */
  for (const fn of ['array_agg', 'string_agg'] as const) {
    it(`refuses \`${fn}\` rather than lowering it — the answer both SQL faces already gave`, () => {
      const err = refusalOf(fn);
      expect(err.code).toBe('INVALID_QUERY');
      expect(err.status).toBe(400);
      // The RETIRED wording: the caller learns the name left the vocabulary,
      // and when. These two positive readings are also the control for the
      // negative one below — an empty message could not satisfy them.
      expect(err.message).toContain('was REMOVED');
      expect(err.message).toContain('#6188');
      expect(err.message.startsWith(UNDECLARED_SENTENCE(fn))).toBe(false);
    });
  }

  it('neither is a member of the declared vocabulary', () => {
    expect(AggregationFunction.options).not.toContain('array_agg');
    expect(AggregationFunction.options).not.toContain('string_agg');
    // Positive control for the two zero-hit readings above, sharing no
    // substring with either term: the enum is non-empty and holds what it
    // should.
    expect(AggregationFunction.options).toContain('count_distinct');
  });
});

// ── Controls: a recognised function still answers, in the same call ──────────

describe('[#12818] the refusal did not break aggregation', () => {
  /**
   * The control the refusal is worthless without. "It refused" must never be
   * readable as "aggregation broke", so each case below runs a RECOGNISED
   * function through the same builder — and, for the numbers, through the same
   * evaluator — and reads the value out.
   *
   * ⚠️ These numbers come from `mongodb-pipeline-evaluator.testkit.ts`, not from
   * a mongod. See this file's head note.
   */
  it('every declared function computes its value over the shared fixture', () => {
    expect(value('count')).toBe(6);                       // count(*) — the rows
    expect(value('count', 'stage')).toBe(4);              // count(col) — non-null values
    expect(value('sum', 'score')).toBe(210);
    expect(value('avg', 'score')).toBe(35);
    expect(value('min', 'score')).toBe(10);
    expect(value('max', 'score')).toBe(60);
    // `count_distinct` collects here and is SIZED by `postProcessAggregation`
    // (#6814, which is where the null exclusion lives) — this is the `$addToSet`
    // as the accumulator leaves it, nulls included, which is the half this
    // builder owns.
    expect(value('count_distinct', 'stage')).toEqual(['won', 'lost', null]);
  });

  it('a recognised function answers in a call that ALSO carries a refused one, once the bad entry is dropped', () => {
    // Same shape, one entry apart: the call with `median` in it refuses (above),
    // and the same call without it answers both measures. So the refusal is
    // attributable to the unrecognised name and to nothing else in the query.
    const aggregations = aggs(
      { function: 'count', alias: 'n' },
      { function: 'sum', field: 'score', alias: 'total' },
    );
    const rows = runPipeline(ROWS, buildAggregationPipeline({ aggregations, groupBy: ['region'] }));
    const byRegion = Object.fromEntries(rows.map((r) => [r.region, `${r.n}/${r.total}`]));
    expect(byRegion).toEqual({ west: '4/100', east: '2/110' });
  });

  it('grouped aggregation still answers', () => {
    const aggregations = aggs({ function: 'count', field: 'id', alias: 'n' });
    const rows = runPipeline(ROWS, buildAggregationPipeline({ aggregations, groupBy: ['region'] }));
    expect(rows.map((r) => `${r.region}:${r.n}`).sort()).toEqual(['east:2', 'west:4']);
  });
});
