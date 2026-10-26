/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `aggregate()`'s SPEC-SHAPE branch keeps `where` strict and refuses at the
 * producer (objectui#6825, maintainer ruling 2026-08-30 — option A).
 *
 * WHY THIS FILE EXISTS. `aggregate()` has two branches and they take a filter
 * by different names. The analytics branch takes `filter` and, since #6302,
 * lowers a rule-shaped array through `translateFilterArray` before posting it
 * to `/analytics/query`. The spec-shape branch takes `where` and posts it to
 * `POST /data/:object/query` VERBATIM — no lowering, before or after #6302. One
 * authored chart can reach either branch, and which one it reaches is decided
 * by whether it carries `groupBy`/`aggregations` — a property with nothing to
 * do with its filter.
 *
 * The card's census found a STRUCTURAL zero in this repo: no producer, fixture
 * or test can reach the spec-shape branch with a rule-shaped `where`
 * (`ObjectChart`'s gate needs a non-array `aggregate.groupBy`, and all three
 * in-tree constructors pass a string). So this is not about a failure RATE. It
 * is about the failure MODE, and about the half the census could not measure:
 * `ObjectChart`'s props are `any`, so an out-of-repo host may already send this
 * shape.
 *
 * What the old behaviour did with it: nothing visible. The array went to the
 * wire, the receiving engine refused it ("is not a filter" — objectstack's
 * `engine-filter-array-lowering.test.ts` pins `engine.aggregate` rejecting the
 * same shape with `400 INVALID_FILTER`, refused before the store is touched),
 * and where the predicate was instead dropped the chart rendered confident,
 * wrong numbers with no signal to their author. Neither end is a degradation;
 * both are failures. The ruling moves the refusal to the producer, where an
 * author can read it and act on it.
 *
 * ⛔ Three things this deliberately does NOT do, each a refused option:
 *   - it does not LOWER on the spec-shape branch (option B — the tolerant-
 *     consumer direction, and it would bless a shape `AggregateParams` does not
 *     declare);
 *   - it does not RETIRE the branch (option D — no in-repo producer, but the
 *     `props: any` half is unmeasurable);
 *   - it does not touch `AggregateParams` (`packages/types`), which is carded
 *     separately.
 *
 * ⚠️ SINCE objectui#6864, the same branch also refuses the ANALYTICS branch’s
 * own keys — `filter`, `field`, `function` — which it reads not at all and used
 * to drop in silence. That is the same ruling applied to the rest of the branch,
 * pinned in `aggregate-spec-shape-analytics-keys.test.ts`; the rows here vary only
 * `where` and are unaffected, except the one that names #6864 inline.
 *
 * ⭐ WHICH BRANCH RAN IS ASSERTED, NOT ASSUMED. The two branches post to
 * different endpoints, so the wire proves the branch for anything that reaches
 * it. A refusal reaches nothing, so for the refusing inputs the branch is
 * proven a second way: `looksLikeSpecShape` is transcribed into
 * `branchSelectors()` below and the refused params are asserted to produce the
 * SAME selector triple as a control that is observed on the spec-shape wire.
 * Without that, a test that accidentally landed in the analytics branch would
 * pass for the wrong reason.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  isMalformedFilterError,
  UnloweredAggregateWhereError,
  AnalyticsKeysOnSpecShapeError,
} from './index';

/** Rows the spec-shape door answers with, so nothing degrades to a fallback. */
const QUERY_ROWS = { success: true, data: { object: 'opportunity', records: [{ stage: 'won', n: 2 }], total: 1 } };
/** Rows the analytics door answers with, carrying the measure it was asked for. */
const ANALYTICS_ROWS = { rows: [{ amount_sum: 150 }] };

/**
 * A fetch mock that keeps the two branches' doors apart.
 *
 * `POST /api/v1/data/:object/query` is the spec-shape branch (`client.data.query`).
 * `POST /api/v1/analytics/query` is the analytics branch (`client.analytics.query`).
 * `GET /api/v1/data/:object` is the client-side fallback `aggregateViaFind` uses —
 * recorded too, so "nothing was sent" can be asserted against ALL THREE, not
 * just the one a test happens to look at.
 */
function makeAdapter() {
  const specShapeBodies: any[] = [];
  const analyticsBodies: any[] = [];
  const urls: string[] = [];
  const fetchImpl = vi.fn(async (url: any, init?: any) => {
    const u = String(url);
    urls.push(u);
    if (u.includes('/api/v1/discovery')) {
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => ({ success: true, data: { version: 'v1', routes: {} } }),
      } as any;
    }
    if (u.includes('/api/v1/data/') && u.endsWith('/query')) {
      specShapeBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return { ok: true, status: 200, statusText: 'OK', json: async () => QUERY_ROWS } as any;
    }
    if (u.includes('/api/v1/analytics/query')) {
      analyticsBodies.push(init?.body ? JSON.parse(String(init.body)) : undefined);
      return { ok: true, status: 200, statusText: 'OK', json: async () => ANALYTICS_ROWS } as any;
    }
    return {
      ok: true, status: 200, statusText: 'OK',
      json: async () => ({ success: true, data: { object: 'opportunity', records: [], total: 0 } }),
    } as any;
  });
  const adapter = new ObjectStackAdapter({
    baseUrl: 'http://localhost:3000', token: 't', autoReconnect: false, fetch: fetchImpl as any,
  });
  return { adapter, specShapeBodies, analyticsBodies, urls };
}

/** Which door a call came out of. `null` = it never reached the wire at all. */
type Door = 'spec-shape' | 'analytics' | 'find-fallback' | null;

function doorOf(urls: string[]): Door {
  if (urls.some((u) => u.includes('/api/v1/data/') && u.endsWith('/query'))) return 'spec-shape';
  if (urls.some((u) => u.includes('/api/v1/analytics/query'))) return 'analytics';
  if (urls.some((u) => u.includes('/api/v1/data/opportunity'))) return 'find-fallback';
  return null;
}

/** Run `aggregate()` and report the door it came out of plus what it posted. */
async function run(params: unknown) {
  const { adapter, specShapeBodies, analyticsBodies, urls } = makeAdapter();
  const error = await adapter.aggregate('opportunity', params as any).then(() => null, (e) => e);
  return { door: doorOf(urls), specShapeBodies, analyticsBodies, urls, error };
}

/**
 * `looksLikeSpecShape`, transcribed from `aggregate()`.
 *
 * The three disjuncts, kept separate so an assertion can show WHICH one decided
 * the branch. This is a transcription on purpose: it lets a test state that two
 * different `params` take the same branch even when neither reaches the wire.
 * If `aggregate()`'s predicate ever changes, the control rows below — which
 * observe the real branch on the real wire — go red and bring this with them.
 */
function branchSelectors(params: any): [boolean, boolean, boolean] {
  return [
    params != null && Array.isArray(params.groupBy),
    params != null && Array.isArray(params.aggregations),
    params != null && params.where !== undefined,
  ];
}

/** Spec-shape params, filter-free. Every case below varies only `where`. */
const SPEC_SHAPE = {
  groupBy: ['stage'],
  aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
};

/** A properly-lowered `where`: the AST the spec's own gate accepts. */
const AST_WHERE = ['stage', '=', 'won'];
/** The unlowered shape the ruling is about: authoring sugar, not a filter. */
const RULE_WHERE = [{ field: 'stage', operator: 'equals', value: 'won' }];

describe('the spec-shape branch is the branch under test — asserted on the wire', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('spec-shape params with a lowered `where` go to POST /data/:object/query, NOT to analytics', async () => {
    const r = await run({ ...SPEC_SHAPE, where: AST_WHERE });
    expect(r.error).toBeNull();
    // The positive control the whole file rests on: this IS the spec-shape branch.
    expect(r.door).toBe('spec-shape');
    expect(r.analyticsBodies).toHaveLength(0);
    expect(r.urls.some((u) => u === 'http://localhost:3000/api/v1/data/opportunity/query')).toBe(true);
  });

  it('legacy analytics params go to POST /analytics/query — the OTHER branch, still lowering (#6302, #7752)', async () => {
    // The control that keeps "we now refuse" from meaning "we now refuse
    // everything": the analytics branch is untouched by THIS file's ruling and
    // still LOWERS the very rule array the spec-shape branch refuses.
    //
    // What that branch lowers TO moved one hop in objectui#7752: it used to post
    // the AST tuple, and now posts the `FilterCondition` `parseFilterAST` makes
    // of it, because a POST body's `where` is transport and a `FilterArray` is
    // input-only sugar (objectstack#5158 ruling C). The refusal this file pins
    // is unaffected — the two branches still take their filter by different
    // names and answer it differently — so only the expected value moves, read
    // from the spec's own sink rather than written out here.
    const r = await run({ function: 'sum', field: 'amount', groupBy: '_all', filter: RULE_WHERE });
    expect(r.error).toBeNull();
    expect(r.door).toBe('analytics');
    expect(r.analyticsBodies[0].where).toEqual(parseFilterAST(['stage', '=', 'won']));
    expect(r.specShapeBodies).toHaveLength(0);
  });

  it('a `where` key alone flips legacy params onto the spec-shape branch', async () => {
    // Same legacy params as the row above; only the KEY NAME changes. This is
    // the asymmetry the card reported, and it is what makes the branch
    // selection provable for params that never reach the wire.
    //
    // ⚠️ WHAT THIS ROW USED TO ASSERT, AND WHY IT MOVED (objectui#6864). It
    // used to observe the flipped call landing on the spec-shape door with only
    // its `where` in the body — which is to say, it pinned the very drop #6864
    // reported: this call's `field` and `function` never reached the wire and
    // nothing said so. Since #6864 the branch REFUSES them, applying #6825’s own
    // ruling (refuse at the producer, never degrade quietly) to the keys it does
    // not read. The flip is still what is being proven, and it is proven at
    // least as well: only the spec-shape branch has this gate, so the refusal
    // could not have come from the analytics branch.
    const r = await run({ function: 'sum', field: 'amount', groupBy: '_all', where: AST_WHERE });
    expect(r.error).toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
    expect(r.error.keys).toEqual(['field', 'function']);
    expect(r.door).toBeNull();
    // …and with those two analytics keys gone, the same flipped params post the
    // `where` verbatim, exactly as this row observed before.
    const clean = await run({ groupBy: '_all', where: AST_WHERE });
    expect(clean.error).toBeNull();
    expect(clean.door).toBe('spec-shape');
    expect(clean.specShapeBodies[0].where).toEqual(AST_WHERE);
  });
});

describe('an unlowered `where` is refused at the producer, loudly', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('throws UnloweredAggregateWhereError instead of posting a rule array', async () => {
    const r = await run({ ...SPEC_SHAPE, where: RULE_WHERE });
    expect(r.error).toBeInstanceOf(UnloweredAggregateWhereError);
    // Same `INVALID_FILTER` / 400 pair the data API and `MalformedFilterError`
    // use, so a failed widget renders "this filter is malformed" rather than
    // "check your connection" (objectui#3066).
    expect(r.error.code).toBe('INVALID_FILTER');
    expect(r.error.httpStatus).toBe(400);
    expect(isMalformedFilterError(r.error)).toBe(true);
    expect(r.error.where).toEqual(RULE_WHERE);
    expect(r.error.resource).toBe('opportunity');
  });

  it('sends NOTHING — not to the spec-shape door, not to analytics, not to the find() fallback', async () => {
    // The silent failure this replaces ended in wrong numbers on a rendered
    // chart. A refusal that quietly degraded to `aggregateViaFind` would
    // reproduce it, so all three doors are asserted, not just the one.
    const r = await run({ ...SPEC_SHAPE, where: RULE_WHERE });
    expect(r.door).toBeNull();
    expect(r.specShapeBodies).toHaveLength(0);
    expect(r.analyticsBodies).toHaveLength(0);
    expect(r.urls.every((u) => u.includes('/api/v1/discovery'))).toBe(true);
  });

  it('the refused params take the SAME branch as the observed control', async () => {
    // ⭐ The branch-selection proof for an input that never reaches the wire.
    // The control above is observed landing on the spec-shape door; these two
    // params differ in nothing `looksLikeSpecShape` reads, so the refusal
    // cannot have come from the analytics branch.
    const control = { ...SPEC_SHAPE, where: AST_WHERE };
    const refused = { ...SPEC_SHAPE, where: RULE_WHERE };
    expect(branchSelectors(refused)).toEqual(branchSelectors(control));
    expect(branchSelectors(control)).toEqual([true, true, true]);
    expect(Object.keys(refused).sort()).toEqual(Object.keys(control).sort());
    // …and the control really is on that door, in this same test.
    expect((await run(control)).door).toBe('spec-shape');
  });

  it('the message tells an author what arrived, what is expected, and where to fix it', async () => {
    const r = await run({ ...SPEC_SHAPE, where: RULE_WHERE });
    const msg = String(r.error.message);
    // 1. what arrived — verbatim, so the producer is identifiable from a log.
    expect(msg).toContain(JSON.stringify(RULE_WHERE));
    // 2. what is expected, and where it is declared.
    expect(msg).toContain('QuerySchema.where');
    expect(msg).toContain('data/query.zod.ts');
    expect(msg).toContain("['stage','=','won']");
    expect(msg).toContain('ViewFilterRule[]');
    // 3. where to fix it — the producer, not this adapter.
    expect(msg).toContain('lower it in the producer that built these aggregate params, not here');
    // 4. and that no numbers were invented on the way out.
    expect(msg).toContain('Nothing was sent to the server');
    // It names the branch, so a reader of the log knows which of the two ran.
    expect(msg).toContain('spec-shape branch');
  });
});

describe('the refusal is exactly the set the receiving door already refuses', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // Every row is an array `isFilterAST` rejects, which is the same gate the
  // server ingress runs. So none of these could ever have produced a correct
  // number: this relocates a failure, it does not add one.
  const REFUSED: Array<[string, unknown]> = [
    ['a single rule object', RULE_WHERE],
    ['several rule objects', [
      { field: 'stage', operator: 'eq', value: 'won' },
      { field: 'amount', operator: 'gt', value: 100 },
    ]],
    ['rules spread into a logical node', ['and', { field: 'stage', operator: 'eq', value: 'won' }, ['amount', '>', 100]]],
    ['the infix join dialect the spec never declared', [['stage', '=', 'won'], 'or', ['stage', '=', 'lost']]],
    ['a tuple whose operator is outside the AST vocabulary', ['stage', 'sounds_like', 'won']],
    ['a logical node with nothing to join', ['and']],
    ['an element that is not a condition', [42]],
  ];

  for (const [name, where] of REFUSED) {
    it(`refuses ${name}, and nothing reaches any door`, async () => {
      // Stated against the contract, not against our own opinion of the shape.
      expect(isFilterAST(where)).toBe(false);
      const r = await run({ ...SPEC_SHAPE, where });
      expect(r.error).toBeInstanceOf(UnloweredAggregateWhereError);
      expect(r.door).toBeNull();
    });
  }
});

describe('everything the receiving door accepts still passes through untouched', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  // The other half of the bar: "we now refuse" must not mean "we now refuse
  // everything". Each row lands on the spec-shape door with `where` byte-equal
  // to what the caller passed — this branch lowers nothing, before or after.
  const ACCEPTED: Array<[string, unknown]> = [
    ['a comparison tuple', ['stage', '=', 'won']],
    ['a logical AST node', ['and', ['stage', '=', 'won'], ['amount', '>', 100]]],
    ['an `or` node', ['or', ['stage', '=', 'won'], ['stage', '=', 'lost']]],
    ['a legacy nested array of nodes', [['stage', '=', 'won'], ['amount', '>', 100]]],
  ];

  for (const [name, where] of ACCEPTED) {
    it(`${name} reaches client.data.query unchanged`, async () => {
      expect(isFilterAST(where)).toBe(true);
      const r = await run({ ...SPEC_SHAPE, where });
      expect(r.error).toBeNull();
      expect(r.door).toBe('spec-shape');
      expect(r.specShapeBodies[0].where).toEqual(where);
    });
  }

  it('a FilterCondition OBJECT is not an array, and this gate leaves it alone', async () => {
    // `QuerySchema.where` IS `FilterConditionSchema` — the MongoDB-style
    // condition object. `isFilterAST` says `false` about it, which is why the
    // gate is scoped to arrays: predicate-only would have refused the declared
    // contract itself.
    expect(isFilterAST({ stage: 'won' })).toBe(false);
    const r = await run({ ...SPEC_SHAPE, where: { stage: 'won' } });
    expect(r.error).toBeNull();
    expect(r.door).toBe('spec-shape');
    expect(r.specShapeBodies[0].where).toEqual({ stage: 'won' });
  });

  it('an EMPTY array is "no filter" and still reaches the wire as `[]`', async () => {
    // The second measured carve-out. `isFilterAST([])` is `false`, but
    // objectstack's `engine-filter-array-lowering.test.ts` pins `where: []`
    // returning every row from `find()` and `3` from `count()` — the receiving
    // door accepts it, so refusing it would be a refusal nobody ruled.
    expect(isFilterAST([])).toBe(false);
    const r = await run({ ...SPEC_SHAPE, where: [] });
    expect(r.error).toBeNull();
    expect(r.door).toBe('spec-shape');
    expect(r.specShapeBodies[0].where).toEqual([]);
  });

  it('no `where` at all still posts no `where` key', async () => {
    const r = await run(SPEC_SHAPE);
    expect(r.error).toBeNull();
    expect(r.door).toBe('spec-shape');
    expect(r.specShapeBodies[0]).not.toHaveProperty('where');
    expect(r.specShapeBodies[0].groupBy).toEqual(['stage']);
    expect(r.specShapeBodies[0].aggregations).toEqual(SPEC_SHAPE.aggregations);
  });

  it('`limit` is still forwarded alongside a lowered `where`', async () => {
    const r = await run({ ...SPEC_SHAPE, where: AST_WHERE, limit: 5 });
    expect(r.error).toBeNull();
    expect(r.specShapeBodies[0]).toEqual({ ...SPEC_SHAPE, where: AST_WHERE, limit: 5 });
  });
});
