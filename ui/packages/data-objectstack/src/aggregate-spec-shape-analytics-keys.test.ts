/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `aggregate()`'s SPEC-SHAPE branch refuses the ANALYTICS branch's own keys
 * instead of dropping them (objectui#6864).
 *
 * WHY THIS FILE EXISTS. The spec-shape branch builds its `queryAst` from four
 * keys — `groupBy`, `aggregations`, `where`, `limit` — and reads nothing else.
 * `filter`, `field` and `function` are the OTHER branch's parameters, and until
 * this card they were neither read, nor refused, nor warned about: they simply
 * were not in the body that went to `POST /data/:object/query`.
 *
 * ⭐ WHY THAT IS WORSE THAN THE `where` HALF (#6825, whose ruling this extends).
 * `field` + `function` are the analytics branch's WHOLE measure, and the
 * spec-shape branch takes a measure only from `aggregations`. So the legacy
 * shape `{ field, function, groupBy, filter }` whose `groupBy` happens to be an
 * ARRAY posted a `groupBy` with NO `aggregations` at all — a grouping with no
 * measure — and with the author's `filter` gone as well. The chart rendered, the
 * numbers were wrong, and there was nothing on screen or on the wire to look at.
 *
 * THE PRODUCER CHAIN IS IN-TREE, measured on 2026-09-08 (the census behind
 * #6825 read this differently on 2026-08-30, and the tree has moved).
 * `ObjectChart.runAggregate` gates its spec-shape call on the STRUCTURED node
 * shape — `gb && typeof gb === 'object' && !Array.isArray(gb)` — so an ARRAY
 * `aggregate.groupBy` falls through to its LEGACY call, `{ field, function,
 * groupBy, filter }`, and `Array.isArray(params.groupBy)` lands that call on
 * the spec-shape branch anyway. `ObjectMetricWidget.computeOne` forwards
 * `aggregate.groupBy || '_all'` into the same legacy shape. Both read authored
 * widget metadata across an `any` seam (`isObjectProvider`'s `aggregate?: any`,
 * `ds: any`), so no type refuses the array. What remains unmeasured is an
 * authored array `groupBy` in metadata: still zero in this tree.
 *
 * ⭐ WHAT THE PINS BELOW ASSERT, AND WHY IT IS NOT "IT THREW". This branch
 * ALREADY refuses one thing — an unlowered `where` (#6825) — with the same
 * `INVALID_FILTER` / 400 envelope. An envelope-only pin would therefore pass on
 * a refusal that came from the OTHER gate, and would pass on an implementation
 * strictly worse than the bug (one that refuses every unrecognised key). So
 * every refusal row asserts the REASON: the error class, the exact `keys` set,
 * and the message naming that key and not the others.
 *
 * ⛔ Three things this deliberately does NOT do:
 *   - it does not ROUTE the legacy shape back to the analytics branch (the
 *     tolerant-consumer direction #6825 refused, and impossible anyway: that
 *     branch posts `dimensions: [params.groupBy]`, so an array would nest);
 *   - it does not widen `AggregateParams` (`@object-ui/types`), a separate
 *     contract question;
 *   - it does not refuse keys OUTSIDE the analytics set, nor nullish ones.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseFilterAST } from '@objectstack/spec/data';
import {
  ObjectStackAdapter,
  clearSharedDiscoveryCache,
  isMalformedFilterError,
  AnalyticsKeysOnSpecShapeError,
  UnloweredAggregateWhereError,
} from './index';

/** Rows the spec-shape door answers with, so nothing degrades to a fallback. */
const QUERY_ROWS = { success: true, data: { object: 'opportunity', records: [{ stage: 'won', n: 2 }], total: 1 } };
/** Rows the analytics door answers with, carrying the measure it was asked for. */
const ANALYTICS_ROWS = { rows: [{ stage: 'won', amount_sum: 150 }] };

/**
 * A fetch mock that keeps the three doors apart — the same harness
 * `aggregate-spec-shape-where.test.ts` uses, so "nothing was sent" can be
 * asserted against ALL of them and not just the one a test happens to watch.
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
  let rows: any = null;
  const error = await adapter
    .aggregate('opportunity', params as any)
    .then((r) => { rows = r; return null; }, (e) => e);
  return { door: doorOf(urls), specShapeBodies, analyticsBodies, urls, error, rows };
}

/**
 * `looksLikeSpecShape`, transcribed from `aggregate()` — the same transcription
 * `aggregate-spec-shape-where.test.ts` keeps, for the same reason: it lets a
 * test state that two `params` take the same branch even when neither reaches
 * the wire, and the observed controls below bring it down if it ever drifts.
 */
function branchSelectors(params: any): [boolean, boolean, boolean] {
  return [
    params != null && Array.isArray(params.groupBy),
    params != null && Array.isArray(params.aggregations),
    params != null && params.where !== undefined,
  ];
}

/** Spec-shape params, analytics-key-free — the shape that must keep working. */
const SPEC_SHAPE = {
  groupBy: ['stage'],
  aggregations: [{ function: 'count', field: 'id', alias: 'n' }],
};

/** A properly-lowered `where`: the AST the spec's own gate accepts. */
const AST_WHERE = ['stage', '=', 'won'];
/** Authoring sugar the #6825 gate refuses — used here only to pin precedence. */
const RULE_WHERE = [{ field: 'stage', operator: 'equals', value: 'won' }];

/**
 * The exact params `ObjectChart.runAggregate` builds for an authored ARRAY
 * `aggregate.groupBy` — its structured gate excludes arrays, so this legacy
 * call is what an array produces. Transcribed, not imported: this file pins the
 * adapter's contract, and `@object-ui/plugin-charts` is not one of its deps.
 */
const OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY = {
  field: 'amount',
  function: 'sum',
  groupBy: ['stage'],
  filter: [{ field: 'stage', operator: 'equals', value: 'won' }],
};

describe('the analytics branch keys are refused on the spec-shape branch, by name', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('refuses all three at once and names each of them', async () => {
    const r = await run(OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY);
    expect(r.error).toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
    // ⭐ The REASON, not the envelope: exactly which keys were wrong.
    expect(r.error.keys).toEqual(['filter', 'field', 'function']);
    expect(r.error.resource).toBe('opportunity');
    expect(r.error.received).toEqual({
      filter: OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY.filter,
      field: 'amount',
      function: 'sum',
    });
    const msg = String(r.error.message);
    expect(msg).toContain('`filter`');
    expect(msg).toContain('`field`');
    expect(msg).toContain('`function`');
    // what arrived, verbatim, so the producer is identifiable from a log
    expect(msg).toContain(JSON.stringify(OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY.filter));
    expect(msg).toContain('field=' + JSON.stringify('amount'));
    expect(msg).toContain('function=' + JSON.stringify('sum'));
    // why this call took this branch at all
    expect(msg).toContain('`groupBy` is an array');
    // and that no numbers were invented on the way out
    expect(msg).toContain('Nothing was sent to the server');
  });

  it('sends NOTHING — not to the spec-shape door, not to analytics, not to the find() fallback', async () => {
    // The failure this replaces ended in wrong numbers on a rendered chart. A
    // refusal that quietly degraded to `aggregateViaFind` would reproduce it,
    // so all three doors are asserted, not just the one.
    const r = await run(OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY);
    expect(r.door).toBeNull();
    expect(r.specShapeBodies).toHaveLength(0);
    expect(r.analyticsBodies).toHaveLength(0);
    expect(r.urls.every((u) => u.includes('/api/v1/discovery'))).toBe(true);
  });

  it('carries the INVALID_FILTER / 400 envelope its siblings carry', async () => {
    const r = await run(OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY);
    expect(r.error.code).toBe('INVALID_FILTER');
    expect(r.error.httpStatus).toBe(400);
    expect(isMalformedFilterError(r.error)).toBe(true);
    expect(r.error.name).toBe('AnalyticsKeysOnSpecShapeError');
  });

  // ⭐ One row per key. Each asserts the message names ITS key and NOT the
  // others, so a refusal that fired for a different reason cannot pass here.
  const PER_KEY: Array<[string, Record<string, unknown>, string[], string[]]> = [
    ['filter alone', { ...SPEC_SHAPE, filter: RULE_WHERE }, ['filter'], ['field', 'function']],
    ['field alone', { ...SPEC_SHAPE, field: 'amount' }, ['field'], ['filter', 'function']],
    ['function alone', { ...SPEC_SHAPE, function: 'sum' }, ['function'], ['filter', 'field']],
    ['the measure pair', { ...SPEC_SHAPE, field: 'amount', function: 'sum' }, ['field', 'function'], ['filter']],
  ];

  for (const [name, params, expected, absent] of PER_KEY) {
    it(`refuses ${name} and reports exactly that key set`, async () => {
      const r = await run(params);
      expect(r.error).toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
      // ⛔ NOT the pre-existing #6825 gate: these params carry no `where` at all,
      // so a throw from `assertSpecShapeWhereIsFilterAst` would be the
      // wrong-reason refusal an envelope-only pin cannot tell apart.
      expect(r.error).not.toBeInstanceOf(UnloweredAggregateWhereError);
      expect(r.error.keys).toEqual(expected);
      const msg = String(r.error.message);
      for (const key of expected) expect(msg).toContain(`\`${key}\``);
      for (const key of absent) expect(msg).not.toContain(`\`${key}\``);
      expect(r.door).toBeNull();
    });
  }

  it('names the missing measure when there is no `aggregations` either', async () => {
    // ⭐ The half that is worse than #6825: `groupBy` survives, the measure does
    // not, and the query that would have gone out groups nothing.
    const r = await run(OBJECT_CHART_LEGACY_CALL_WITH_ARRAY_GROUPBY);
    expect(String(r.error.message)).toContain('NO MEASURE');
  });

  it('does NOT claim a missing measure when `aggregations` is present', async () => {
    // The same refusal, one key different: the diagnosis must track the params,
    // not be boilerplate stapled to every message.
    const r = await run({ ...SPEC_SHAPE, filter: RULE_WHERE });
    expect(r.error).toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
    expect(String(r.error.message)).not.toContain('NO MEASURE');
  });

  it('the refused params take the SAME branch as an observed spec-shape control', async () => {
    // The branch-selection proof for an input that never reaches the wire: the
    // control below is observed landing on the spec-shape door, and the refused
    // params agree with it on every disjunct `looksLikeSpecShape` reads.
    const control = SPEC_SHAPE;
    const refused = { ...SPEC_SHAPE, filter: RULE_WHERE };
    expect(branchSelectors(refused)).toEqual(branchSelectors(control));
    expect(branchSelectors(control)).toEqual([true, true, false]);
    expect((await run(control)).door).toBe('spec-shape');
  });

  it('an array `groupBy` alone is enough — no `aggregations`, no `where`', async () => {
    // This is the card's reachable shape: only `Array.isArray(groupBy)` selects
    // the branch, and the whole legacy payload behind it used to disappear.
    const params = { field: 'amount', function: 'sum', groupBy: ['stage'], filter: RULE_WHERE };
    expect(branchSelectors(params)).toEqual([true, false, false]);
    const r = await run(params);
    expect(r.error).toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
    expect(r.error.keys).toEqual(['filter', 'field', 'function']);
  });
});

describe('precedence with the #6825 gate is stated, not accidental', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('an unlowered `where` still answers UnloweredAggregateWhereError, even alongside analytics keys', async () => {
    // The addition is strictly additive: no input that already refused changes
    // which error it gets. The new gate runs after the `where` gate for exactly
    // this reason.
    const r = await run({ ...SPEC_SHAPE, where: RULE_WHERE, filter: RULE_WHERE, field: 'amount' });
    expect(r.error).toBeInstanceOf(UnloweredAggregateWhereError);
    expect(r.error).not.toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
    expect(r.door).toBeNull();
  });

  it('a LOWERED `where` alongside analytics keys answers the new refusal', async () => {
    // …and once the `where` gate has nothing to say, the analytics keys are
    // what is left to report.
    const r = await run({ ...SPEC_SHAPE, where: AST_WHERE, filter: RULE_WHERE });
    expect(r.error).toBeInstanceOf(AnalyticsKeysOnSpecShapeError);
    expect(r.error.keys).toEqual(['filter']);
    expect(String(r.error.message)).toContain('a `where` key is present');
    expect(r.door).toBeNull();
  });
});

describe('NON-REGRESSION: the refusal is not too broad', () => {
  beforeEach(() => clearSharedDiscoveryCache());

  it('the LEGACY shape still succeeds and still lowers all three of its keys', async () => {
    // ⭐ The axis derived from the plausible WRONG FIX. A refusal that caught
    // the legacy path would satisfy "the spec-shape branch now refuses
    // `filter`" and break every working chart in the product. A string
    // `groupBy` is not an array, so this call never reaches the spec-shape
    // branch — and all three keys must still do their jobs on the analytics
    // wire: `filter` lowered to a FilterCondition, `field` + `function` fused
    // into the measure, `groupBy` into the dimension.
    const params = { function: 'sum', field: 'amount', groupBy: 'stage', filter: RULE_WHERE };
    expect(branchSelectors(params)).toEqual([false, false, false]);
    const r = await run(params);
    expect(r.error).toBeNull();
    expect(r.door).toBe('analytics');
    expect(r.analyticsBodies[0].where).toEqual(parseFilterAST(['stage', '=', 'won']));
    expect(r.analyticsBodies[0].measures).toEqual(['amount_sum']);
    expect(r.analyticsBodies[0].dimensions).toEqual(['stage']);
    // …and the rows come back keyed by the column the convention promises.
    expect(r.rows).toEqual([{ stage: 'won', amount: 150 }]);
  });

  it('the legacy single-bucket shape (groupBy "_all") still succeeds', async () => {
    // `ObjectMetricWidget` and the `element:number` renderer both build this.
    const r = await run({ function: 'sum', field: 'amount', groupBy: '_all', filter: RULE_WHERE });
    expect(r.error).toBeNull();
    expect(r.door).toBe('analytics');
    expect(r.analyticsBodies[0].dimensions).toEqual([]);
  });

  it('the STRUCTURED spec-shape call ObjectChart builds still reaches the wire untouched', async () => {
    // The one in-tree producer that legitimately builds spec-shape params
    // (`runAggregate`'s structured branch, for `{ field, dateGranularity }`
    // grouping). It carries no analytics key, so the new gate must be invisible
    // to it — transcribed from that call site.
    const params = {
      groupBy: [{ field: 'closed_at', dateGranularity: 'day' }],
      aggregations: [{ function: 'count', alias: 'count' }],
      where: AST_WHERE,
    };
    const r = await run(params);
    expect(r.error).toBeNull();
    expect(r.door).toBe('spec-shape');
    expect(r.specShapeBodies[0]).toEqual(params);
  });

  it('a key that is present but NULLISH carries nothing to drop, so it passes', async () => {
    // Both in-tree producers spread possibly-absent authored values
    // (`filter: filterForRun`, `field: schema.aggregate.field`), so `in` would
    // refuse calls that lose nothing at all.
    const r = await run({ ...SPEC_SHAPE, filter: undefined, field: undefined, function: undefined });
    expect(r.error).toBeNull();
    expect(r.door).toBe('spec-shape');
    expect(r.specShapeBodies[0]).toEqual(SPEC_SHAPE);

    const withNulls = await run({ ...SPEC_SHAPE, filter: null, field: null, function: null });
    expect(withNulls.error).toBeNull();
    expect(withNulls.door).toBe('spec-shape');
  });

  it('keys OUTSIDE the analytics set are not refused', async () => {
    // ⛔ The strictly-worse implementation: refusing every unrecognised key
    // would pass a naive "spec-shape refuses `filter`" pin while breaking any
    // caller carrying an extra. The gate names three keys and only three.
    const r = await run({ ...SPEC_SHAPE, orderBy: [{ field: 'stage' }], somethingElse: 1, limit: 5 });
    expect(r.error).toBeNull();
    expect(r.door).toBe('spec-shape');
    // still only the four keys this branch reads reach the wire
    expect(r.specShapeBodies[0]).toEqual({ ...SPEC_SHAPE, limit: 5 });
  });

  it('a clean spec-shape call is byte-identical to what it posted before', async () => {
    const r = await run({ ...SPEC_SHAPE, where: AST_WHERE, limit: 5 });
    expect(r.error).toBeNull();
    expect(r.specShapeBodies[0]).toEqual({ ...SPEC_SHAPE, where: AST_WHERE, limit: 5 });
  });
});
