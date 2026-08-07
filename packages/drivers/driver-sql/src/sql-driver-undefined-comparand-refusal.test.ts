// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6050] An `undefined` COMPARAND is refused, in every position — and `null`
 * keeps every one of its meanings.
 *
 * # What was measured
 *
 * On `origin/main` at `cba7454df`, one `TursoDriver` over the shared conformance
 * fixture (`d` valued on rows 1-2, NULL on 3-4) answered the same filter two
 * ways, chosen by the `url` it was constructed with:
 *
 * | filter | LOCAL (this compiler) | REMOTE (`RemoteTransport`) |
 * |---|---|---|
 * | `{ d: undefined }`                    | knex `Undefined binding(s)` | `['3','4']` |
 * | `{ d: { $eq: undefined } }`           | knex `Undefined binding(s)` | `['3','4']` |
 * | `{ $not: { d: undefined } }`          | knex `Undefined binding(s)` | `['1','2']` |
 * | `{ d: { $ne: undefined } }`           | `['1','2']`                 | `['1','2']` |
 * | `{ $not: { d: { $ne: undefined } } }` | `[]`                        | `['3','4']` |
 * | `{ d: { $in: [undefined] } }`         | knex `Undefined binding(s)` | `[]` |
 * | `{ d: { $gt: undefined } }`           | knex `Undefined binding(s)` | `[]` |
 *
 * Two defects, both closed by ONE gate placed before any emitter or guard runs:
 *
 * **A — no ADR-0112 envelope.** knex's `Undefined binding(s) detected when
 * compiling SELECT` carries neither `code` nor `status`, so `mapDataError` fell
 * to its default branch and served an opaque 500 for what is a caller mistake in
 * a filter. #1116 / #4436 catalogued this exact shape for other inputs; this one
 * was missing from the list.
 *
 * **B — the guard disagreed with its own emitter.** The `$ne` emitter read
 * `coerced == null` (LOOSE — `undefined` compiled `IS NOT NULL`, a TOTAL
 * predicate) while `operatorIsNullTotal` / `nullValueSatisfiesOperator` read
 * `=== null` (STRICT — they judged the same leaf non-total AND satisfied by a
 * NULL row). `nullGuardForFieldSpec` therefore wrapped a total predicate in
 * `d IS NULL OR d IS NOT NULL` — a tautology whose negation is FALSE, which is
 * the `[]` above. #5298's invariant is that a polarity table pins the spelling
 * of ITS OWN emitter; this was that invariant broken at its own definition.
 *
 * # The ruling
 *
 * REFUSED (`INVALID_FILTER` / 400), adjudicated 2026-08-07 on #6050 — the
 * disposition #5347-A gave a non-boolean `$null`. `FieldOperatorsSchema`
 * declares no `undefined` comparand; `{ f: undefined }` and `{}` are the same
 * object to every JavaScript reader while meaning opposite things (a predicate
 * versus no constraint at all); and `undefined` cannot survive a JSON round
 * trip, so it is always the fingerprint of an in-process authoring bug — the
 * `{ owner_id: ctx.user?.id }` that silently matched every env-wide row.
 *
 * # Reverse verification — direction predicted before it was run, then measured
 *
 * Prediction: NOT one uniform direction. The refusal cases must go red, the
 * control cases must stay green, and the refusal cases must go red by TWO
 * different mechanisms — because the un-fixed driver answered this family two
 * different ways (see the matrix above).
 *
 * Measured, with both `assertDefinedComparands` call sites deleted and nothing
 * else changed: **22 failed / 6 passed** of 28. The 6 that stayed green are
 * exactly the control cases — the `null` block, the `$null`/`$exists`
 * boolean-domain case, the legal-vocabulary case and the `Date` case — which is
 * the assertion that this change moved nothing it was not ruled to move.
 *
 * The two mechanisms, per the `origin/main` measurement above: most positions
 * went red by THROWING knex's bare `Undefined binding(s)` — an Error with no
 * `code` and no `status`, so `refusalOf` returns normally and only the envelope
 * assertions fail. **A test that asserted merely "it throws" would have stayed
 * GREEN on the driver this issue was filed against**, which is why every case
 * here asserts `code` and `status`. The rest — `$ne`, the LIKE family, and
 * `{ $not: { … $ne: undefined } }` — went red by RESOLVING: they never threw at
 * all, and `{ $not: { stage: { $ne: undefined } } }` resolved to `[]`, the
 * defect-B tautology.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SqlDriver } from './index.js';
import type { FilterCondition } from '@objectstack/spec/data';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#6050] SqlDriver refuses an undefined comparand', () => {
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
    await driver.create('deal', { id: '2', stage: null, score: 20 });
  });

  const ids = async (where: unknown): Promise<string[]> => {
    const rows = await driver.find('deal', {
      fields: ['id'],
      where: where as FilterCondition,
    });
    return (rows as any[]).map((r) => String(r.id)).sort();
  };

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await ids(where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error('expected the driver to refuse this filter, but it resolved');
  };

  /**
   * Every position a comparand can occupy, with the path the refusal must name.
   *
   * "Comparand" is a POSITION, not a type, so the list is enumerated rather than
   * swept: the direct comparand, each single-value operator's comparand, and
   * each MEMBER of a list operator's array — the same split #5041 made when it
   * refused a `$field` reference inside an `$in` list.
   */
  const UNDEFINED_POSITIONS: Array<[label: string, where: unknown, path: string]> = [
    // The shape the issue opened on. It is also the one that does NOT reach the
    // reduction walk: `typeof undefined` is not `'object'`, so it cannot make
    // `applyFilters`' `hasMongoOperators` test true and the plain-map loop
    // compiles it instead. Both call sites share one function for this reason.
    ['a direct comparand', { stage: undefined }, 'filter.stage'],
    ['$eq', { stage: { $eq: undefined } }, 'filter.stage.$eq'],
    ['$ne', { stage: { $ne: undefined } }, 'filter.stage.$ne'],
    ['$gt', { score: { $gt: undefined } }, 'filter.score.$gt'],
    ['$gte', { score: { $gte: undefined } }, 'filter.score.$gte'],
    ['$lt', { score: { $lt: undefined } }, 'filter.score.$lt'],
    ['$lte', { score: { $lte: undefined } }, 'filter.score.$lte'],
    ['$contains', { stage: { $contains: undefined } }, 'filter.stage.$contains'],
    ['$notContains', { stage: { $notContains: undefined } }, 'filter.stage.$notContains'],
    ['$startsWith', { stage: { $startsWith: undefined } }, 'filter.stage.$startsWith'],
    ['$endsWith', { stage: { $endsWith: undefined } }, 'filter.stage.$endsWith'],
    // The array IS `$in`'s comparand; each ELEMENT is a comparand in its own
    // right, and one bad element is enough.
    ['an $in member', { stage: { $in: [undefined] } }, 'filter.stage.$in[0]'],
    ['an $in member beside a good one', { stage: { $in: ['won', undefined] } }, 'filter.stage.$in[1]'],
    ['a $nin member', { stage: { $nin: [undefined] } }, 'filter.stage.$nin[0]'],
    ['a $between bound', { score: { $between: [5, undefined] } }, 'filter.score.$between[1]'],
    // Nested positions — the refusal must name where it happened, not just that
    // it happened.
    ['inside $and', { $and: [{ stage: undefined }] }, 'filter.$and[0].stage'],
    ['inside $or', { $or: [{ stage: { $eq: undefined } }] }, 'filter.$or[0].stage.$eq'],
    ['inside $not', { $not: { stage: undefined } }, 'filter.$not.stage'],
    ['inside $not, one operator down', { $not: { stage: { $ne: undefined } } }, 'filter.$not.stage.$ne'],
  ];

  for (const [label, where, path] of UNDEFINED_POSITIONS) {
    it(`refuses ${label} with INVALID_FILTER / 400`, async () => {
      const err = await refusalOf(where);
      // Defect A: the envelope. Without these two lines the test passes on the
      // UNFIXED driver, which threw knex's bare `Undefined binding(s)`.
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('is undefined');
      expect(err.message).toContain(path);
      // The repair the author needs, not just the complaint.
      expect(err.message).toContain('Write null if you meant the null predicate');
      expect(err.message).toContain('FieldOperatorsSchema');
      // #3867 — no driver-internal prefix on the wire.
      expect(err.message).not.toContain('[sql-driver]');
      // It must never BE knex's message. Checked on the opening rather than by
      // absence of the phrase, because this refusal deliberately QUOTES knex's
      // wording in its explanatory tail — a `not.toContain` here would be a
      // phantom assertion that fails on the fixed driver and passes on nothing.
      expect(err.message.startsWith('Comparand at ')).toBe(true);
    });
  }

  /**
   * The placement proof, in the same shape #5348 used. `{ stage: 'won' }` is a
   * satisfiable disjunct and `{}` is the TRUE identity — an emitter-side gate
   * would resolve the enclosing node from those siblings and never look at the
   * offending one, making the refusal conditional on evaluation order.
   */
  it('refuses an undefined comparand beside a satisfiable disjunct', async () => {
    const err = await refusalOf({ $or: [{ stage: 'won' }, { stage: undefined }] });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('filter.$or[1].stage');
  });

  it('refuses an undefined comparand beside the TRUE identity `{}`', async () => {
    const err = await refusalOf({ $or: [{}, { stage: { $eq: undefined } }] });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.message).toContain('filter.$or[1].stage.$eq');
  });

  /**
   * Defect B, pinned as a REFUSAL rather than as an answer.
   *
   * This is the row that answered `[]` locally and `['3','4']` remotely, and the
   * one whose cause was internal to this file: guard `=== null`, emitter
   * `== null`, one leaf, two readings. There is no "correct" row set to assert
   * for it any more — the ruling removed the question — so what is pinned is
   * that it is refused, and that the refusal names the `$ne` comparand rather
   * than some downstream consequence of the tautology.
   */
  it('refuses the guard/emitter split case instead of answering it', async () => {
    const err = await refusalOf({ $not: { stage: { $ne: undefined } } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('filter.$not.stage.$ne');
  });

  /**
   * ⛔ The control block: `null` did not move, in any position.
   *
   * A gate written by pattern-matching on "empty-ish comparand" would take
   * `null` with it and silently delete the null predicate from the protocol.
   * Every line here answered exactly this before the change.
   */
  describe('null comparands are unchanged, line by line', () => {
    it('the null predicate spellings still compile', async () => {
      expect(await ids({ stage: null })).toEqual(['2']);
      expect(await ids({ stage: { $eq: null } })).toEqual(['2']);
      expect(await ids({ stage: { $ne: null } })).toEqual(['1']);
      expect(await ids({ stage: { $null: true } })).toEqual(['2']);
      expect(await ids({ stage: { $null: false } })).toEqual(['1']);
      expect(await ids({ stage: { $exists: true } })).toEqual(['1']);
      expect(await ids({ stage: { $exists: false } })).toEqual(['2']);
    });

    it('null keeps its meaning under $not and inside combinators', async () => {
      expect(await ids({ $not: { stage: null } })).toEqual(['1']);
      expect(await ids({ $not: { stage: { $ne: null } } })).toEqual(['2']);
      expect(await ids({ $and: [{ stage: null }] })).toEqual(['2']);
      expect(await ids({ $or: [{ stage: null }, { stage: 'won' }] })).toEqual(['1', '2']);
    });

    it('null is still a legitimate $in / $nin member', async () => {
      // `IN (NULL)` is UNKNOWN for every row in SQL — that is SQL's answer, not
      // this gate's, and it is untouched here.
      expect(await ids({ stage: { $in: ['won', null] } })).toEqual(['1']);
    });
  });

  /**
   * `$null` / `$exists` keep their OWN refusal for `undefined`.
   *
   * Their comparand is a declared BOOLEAN — a flag, not a value to compare
   * against — and `nonBooleanNullComparandError` / `nonBooleanExistsComparandError`
   * already name that declared domain, which is the more useful message for
   * that mistake. #5240's rule is one condition, one wording; re-answering these
   * two here would have given the same mistake two.
   */
  it('$null / $exists undefined keeps the boolean-domain wording', async () => {
    for (const where of [{ stage: { $null: undefined } }, { stage: { $exists: undefined } }]) {
      const err = await refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.message).toContain('requires a boolean comparand (true or false)');
      expect(err.message).not.toContain('Write null if you meant the null predicate');
    }
  });

  /**
   * The ordinary vocabulary is untouched. A gate on the reduction walk runs for
   * every filter in the process, so "did it change an answer it should not have"
   * is a question this file has to ask out loud.
   */
  it('legal filters compile exactly as before', async () => {
    expect(await ids({ stage: 'won' })).toEqual(['1']);
    expect(await ids({ stage: { $in: ['won'] } })).toEqual(['1']);
    expect(await ids({ stage: { $ne: 'won' } })).toEqual(['2']);
    expect(await ids({ score: { $between: [5, 15] } })).toEqual(['1']);
    expect(await ids({ score: { $gte: 10 } })).toEqual(['1', '2']);
    expect(await ids({ $not: { stage: 'won' } })).toEqual(['2']);
    expect(await ids({})).toEqual(['1', '2']);
    expect(await ids({ $and: [] })).toEqual(['1', '2']);
    expect(await ids({ $or: [] })).toEqual([]);
  });

  /**
   * A Date comparand is an OBJECT that is a VALUE. The walk must not read its
   * (empty) entry list as an operator map and must not refuse it — the #1066
   * routing seam, asserted from the gate's side.
   */
  it('a Date comparand is not mistaken for an operator map', async () => {
    // No row matches; the point is that it COMPILES rather than being refused.
    expect(await ids({ stage: { $ne: new Date('2020-01-01T00:00:00.000Z') } })).toEqual(['1', '2']);
  });
});
