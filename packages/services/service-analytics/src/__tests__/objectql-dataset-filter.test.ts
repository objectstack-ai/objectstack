// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A dataset's definition-level `filter` reaches `engine.aggregate` on the
 * ObjectQL door too — #10413 phase 1.
 *
 * # The three doors, measured together
 *
 * `#10298` / PR #10411 repaired the NATIVE-SQL door: the compiled statement now
 * carries both the dataset's own scope (a plain `WHERE` conjunct) and one
 * conditional aggregate per measure-scoped `filter`. The DASHBOARD door
 * (`queryDataset` -> `DatasetExecutor`) was never broken: it ANDs the dataset
 * filter into the runtime filter itself (`combineFilters`) and fans out one
 * supplementary query per filtered measure (`splitMeasuresByFilter` /
 * `runMeasurePass`). The OBJECTQL door — `/api/v1/analytics/query` on any
 * deployment whose driver reports `objectqlAggregate` but not `nativeSql`
 * (Mongo, the memory driver) — read neither: `ObjectQLStrategy.execute` built
 * its engine filter from `normalizeAnalyticsFilterTree(query)` alone, so
 * `engine.aggregate` was called with NO `filter` key at all.
 *
 * All three are exercised below in one run, over one fixture, so the
 * disagreement is a measurement rather than a description.
 *
 * # Phase 1 fixes ONE of the two halves — deliberately
 *
 * `engine.aggregate` accepts exactly one predicate for the whole call, so the
 * dataset's definition-level filter fits with no contract movement and is fixed
 * here. A per-MEASURE filter has nowhere to go: an aggregation is
 * `{ field, method, alias }`. Widening that contract is **#10576**, and
 * lowering the measure filters into it is phase 2 of #10413.
 *
 * So the conditional measures on this door are STILL WRONG after this change,
 * and the `[#10413 phase 2 — NOT DONE]` block below pins them wrong on purpose.
 * Without that pin the path reads all-green while `won_amount` still answers the
 * whole book, and nothing here would say the numbers were supposed to move when
 * #10576 lands. When it does: those two expectations must flip to
 * `won_count: 8` / `won_amount: 1_290_000` — the numbers the other two doors
 * already answer here.
 */

import { describe, it, expect } from 'vitest';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { DatasetSchema, type Dataset } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';

// -- fixture ---------------------------------------------------------------

type Row = Record<string, unknown>;

/**
 * #10298's own org — 24 live opportunities, 8 won summing to 1,290,000, 5 lost,
 * 5,632,500 in total — plus 6 SOFT-DELETED rows the dataset's definition-level
 * `filter: { is_deleted: false }` exists to exclude. Three of the deleted rows
 * are `closed_won`, so a dropped dataset filter is visible in every measure: a
 * live count of 24 reads 30, and won revenue picks up 3,000,000 that no door
 * should ever report.
 */
const LIVE_WON: Row[] = [
  { amount: 300_000, owner: 'u1' }, { amount: 250_000, owner: 'u2' },
  { amount: 200_000, owner: 'u1' }, { amount: 150_000, owner: 'u2' },
  { amount: 120_000, owner: 'u1' }, { amount: 110_000, owner: 'u2' },
  { amount: 100_000, owner: 'u1' }, { amount: 60_000, owner: 'u2' },
].map((r) => ({ ...r, stage: 'closed_won', is_deleted: false }));

const LIVE_LOST: Row[] = [90_000, 90_000, 90_000, 90_000, 90_000].map((amount, i) => ({
  amount, owner: i % 2 === 0 ? 'u1' : 'u2', stage: 'closed_lost', is_deleted: false,
}));

const LIVE_OPEN: Row[] = [
  350_000, 350_000, 350_000, 350_000, 350_000,
  350_000, 350_000, 350_000, 350_000, 350_000, 392_500,
].map((amount, i) => ({
  amount, owner: i % 2 === 0 ? 'u2' : 'u1', stage: 'prospecting', is_deleted: false,
}));

const DELETED: Row[] = [
  { amount: 1_000_000, stage: 'closed_won' }, { amount: 1_000_000, stage: 'closed_won' },
  { amount: 1_000_000, stage: 'closed_won' }, { amount: 500_000, stage: 'closed_lost' },
  { amount: 500_000, stage: 'prospecting' }, { amount: 500_000, stage: 'prospecting' },
].map((r) => ({ ...r, owner: 'u1', is_deleted: true }));

const LIVE: Row[] = [...LIVE_WON, ...LIVE_LOST, ...LIVE_OPEN];
const ALL_ROWS: Row[] = [...LIVE, ...DELETED];
const sum = (rows: Row[]) => rows.reduce((a, r) => a + Number(r.amount), 0);

/** The card's dataset: a definition-level scope AND two measure-scoped measures. */
const OPPORTUNITY_METRICS: Dataset = DatasetSchema.parse({
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  object: 'crm_opportunity',
  filter: { is_deleted: false },
  dimensions: [{ name: 'owner', label: 'Owner', field: 'owner', type: 'string' }],
  measures: [
    { name: 'opp_count', label: 'Opportunities', aggregate: 'count' },
    { name: 'won_count', label: 'Won Deals', aggregate: 'count', filter: { stage: 'closed_won' } },
    {
      name: 'won_amount', label: 'Won Revenue', aggregate: 'sum', field: 'amount',
      filter: { stage: 'closed_won' },
    },
  ],
}) as Dataset;

/** The same shape with NO definition-level filter — the "invent nothing" control. */
const UNSCOPED_METRICS: Dataset = DatasetSchema.parse({
  name: 'unscoped_metrics',
  label: 'Unscoped Metrics',
  object: 'crm_opportunity',
  dimensions: [],
  measures: [{ name: 'opp_count', label: 'Opportunities', aggregate: 'count' }],
}) as Dataset;

// -- a probe `engine.aggregate` --------------------------------------------

interface AggOptions {
  groupBy?: string[];
  aggregations?: Array<{ field: string; method: string; alias: string; filter?: Record<string, unknown> }>;
  filter?: Record<string, unknown>;
}
interface AggCall { object: string; options: AggOptions }

/**
 * Evaluate an engine filter against one row.
 *
 * Deliberately narrow — equality leaves and `$and` only — and it THROWS on
 * anything else rather than ignoring it. A matcher that silently skipped an
 * operator it does not know would answer the unfiltered number and read as a
 * pass, which is the very failure mode this file is about.
 */
function matches(row: Row, filter: unknown): boolean {
  if (filter == null) return true;
  return Object.entries(filter as Record<string, unknown>).every(([key, cond]) => {
    if (key === '$and') {
      if (!Array.isArray(cond)) throw new Error('[probe engine] $and expects an array');
      return cond.every((c) => matches(row, c));
    }
    if (key.startsWith('$')) throw new Error(`[probe engine] cannot evaluate combinator "${key}"`);
    if (cond !== null && typeof cond === 'object') {
      throw new Error(`[probe engine] cannot evaluate an operator object on "${key}"`);
    }
    return row[key] === cond;
  });
}

function runAggregate(rows: Row[], options: AggOptions): Row[] {
  const kept = rows.filter((r) => matches(r, options.filter));
  const groupBy = (options.groupBy ?? []).map((g) => {
    if (typeof g !== 'string') throw new Error('[probe engine] date bucketing is out of scope here');
    return g;
  });
  const groups = new Map<string, Row[]>();
  for (const row of kept) {
    const key = groupBy.map((g) => String(row[g])).join('|');
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  const buckets: Row[][] = groupBy.length > 0 ? [...groups.values()] : [kept];
  return buckets.map((bucket) => {
    const out: Row = {};
    for (const g of groupBy) out[g] = bucket[0]?.[g];
    for (const agg of options.aggregations ?? []) {
      // [#10413 phase 2] `agg.filter` is a PER-AGGREGATION predicate over the
      // rows already admitted by the whole-call `filter` above — SQL
      // `FILTER (WHERE …)` semantics (#10576) — never a second whole-call
      // narrowing. Evaluated with the SAME strict `matches`, so an operator
      // this probe cannot evaluate throws rather than silently answering the
      // unfiltered number.
      const admitted = agg.filter ? bucket.filter((r) => matches(r, agg.filter)) : bucket;
      if (agg.method === 'count') {
        out[agg.alias] = agg.field === '*'
          ? admitted.length
          : admitted.filter((r) => r[agg.field] != null).length;
      } else if (agg.method === 'sum') {
        out[agg.alias] = admitted.reduce((a, r) => a + Number(r[agg.field] ?? 0), 0);
      } else {
        throw new Error(`[probe engine] cannot compute "${agg.method}"`);
      }
    }
    return out;
  });
}

/** A service on the ObjectQL door: `nativeSql: false` makes `NativeSQLStrategy` decline. */
function objectqlService(datasets: Dataset[], rows: Row[] = ALL_ROWS) {
  const calls: AggCall[] = [];
  const svc = new AnalyticsService({
    debugSql: true,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    executeAggregate: async (object: string, options: AggOptions) => {
      calls.push({ object, options });
      return runAggregate(rows, options);
    },
  });
  for (const d of datasets) svc.registerDataset(d);
  return { svc, calls };
}

/** A service on the native-SQL door — the compiled statement is the measurement. */
function sqlService(datasets: Dataset[]) {
  const svc = new AnalyticsService({
    debugSql: true,
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    executeRawSql: async () => [],
  });
  for (const d of datasets) svc.registerDataset(d);
  return svc;
}

const MEASURES = ['opp_count', 'won_count', 'won_amount'];

// -- 0. the fixture is what it claims to be --------------------------------

describe('[#10413] the fixture', () => {
  it('holds 24 live opportunities (8 won, 1,290,000) and 6 soft-deleted ones', () => {
    expect(LIVE).toHaveLength(24);
    expect(LIVE_WON).toHaveLength(8);
    expect(sum(LIVE_WON)).toBe(1_290_000);
    expect(sum(LIVE)).toBe(5_632_500);
    expect(DELETED).toHaveLength(6);
    expect(ALL_ROWS).toHaveLength(30);
    // The wrong answers stay REACHABLE from this fixture, which is what makes
    // every assertion below falsifiable.
    expect(sum(ALL_ROWS)).toBe(10_132_500);
  });
});

// -- 1. the three doors ----------------------------------------------------

describe('[#10413] the three doors on one dataset', () => {
  it('the NATIVE-SQL door carries the dataset scope AND the measure filters (#10298 / #10411)', async () => {
    const svc = sqlService([OPPORTUNITY_METRICS]);
    const { sql } = await svc.generateSql({ cube: 'opportunity_metrics', measures: MEASURES });
    // Its own scope, as a whole-statement conjunct...
    expect(sql).toContain('is_deleted = $');
    // ...and one conditional aggregate per measure-scoped filter.
    expect(sql).toContain('THEN 1 END) AS "won_count"');
    expect(sql).toContain('THEN amount END) AS "won_amount"');
  });

  it('the DASHBOARD door answers the fully-declared numbers (it always did)', async () => {
    const { svc } = objectqlService([OPPORTUNITY_METRICS]);
    const result = await svc.queryDataset!(OPPORTUNITY_METRICS, { measures: MEASURES });
    expect(result.rows[0]).toMatchObject({
      opp_count: 24, won_count: 8, won_amount: 1_290_000,
    });
  });

  it('the OBJECTQL door now agrees with the other two — phase 1 AND phase 2 combined', async () => {
    const { svc, calls } = objectqlService([OPPORTUNITY_METRICS]);
    const result = await svc.query({ cube: 'opportunity_metrics', measures: MEASURES });

    // The engine call carries the dataset's own predicate (phase 1)...
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(calls[0].options.filter)).toContain('is_deleted');
    // ...and every measure now answers the SAME numbers the dashboard door
    // answers two tests above — phase 2 closes the remaining gap. 30 / 24 /
    // 5,632,500 are the numbers this door answered before phase 1 and phase 2
    // respectively; asserting `not.toBe` on each keeps the fix falsifiable.
    expect(result.rows[0]).toMatchObject({ opp_count: 24, won_count: 8, won_amount: 1_290_000 });
    expect(result.rows[0]?.opp_count).not.toBe(30);
    expect(result.rows[0]?.won_count).not.toBe(24);
    expect(result.rows[0]?.won_amount).not.toBe(5_632_500);
  });
});

// -- 2. per-measure filters lower into their own aggregation — phase 2 -----

describe('[#10413 phase 2] per-measure filters lower into the aggregation they belong to', () => {
  /**
   * FLIPPED from the pre-#10576 pin this block used to carry (`won_count: 24`,
   * `won_amount: 5,632,500` — the CURRENT-WRONG numbers, held on purpose so the
   * gap could not be mistaken for a green path; see the git history of this
   * file / #10413's issue comments for the shape that pinned). Now pinned
   * RIGHT, against the same dashboard-door baseline the section above uses:
   * `opp_count: 24 / won_count: 8 / won_amount: 1,290,000`.
   */
  it('sends each filtered measure its OWN per-aggregation `filter` — the #10576 contract field', async () => {
    const { svc, calls } = objectqlService([OPPORTUNITY_METRICS]);
    await svc.query({ cube: 'opportunity_metrics', measures: MEASURES });

    const aggregations = calls[0].options.aggregations ?? [];
    expect(aggregations).toHaveLength(3);
    const byAlias = Object.fromEntries(aggregations.map((a) => [a.alias, a]));
    // The unfiltered measure carries NO filter key at all — unchanged shape,
    // still eligible for native pushdown on a driver that has one (#10576's
    // own positive pin, `engine-aggregate-filter.test.ts`).
    expect(Object.keys(byAlias.opp_count).sort()).toEqual(['alias', 'field', 'method']);
    // The two conditional measures each carry their OWN filter — not a shared
    // reference, and not the measure's `field`/`method` disturbed by it.
    expect(byAlias.won_count).toMatchObject({ method: 'count', filter: { stage: 'closed_won' } });
    expect(byAlias.won_amount).toMatchObject({
      field: 'amount', method: 'sum', filter: { stage: 'closed_won' },
    });
    // And the comparand does NOT ALSO leak into the whole-call filter — that
    // would be the "narrow every measure" failure mode ① below is about.
    expect(JSON.stringify(calls[0].options.filter)).not.toContain('closed_won');
  });

  it('① both directions in ONE result: won_count is right (8) and opp_count STAYS right (24)', async () => {
    const { svc } = objectqlService([OPPORTUNITY_METRICS]);
    const result = await svc.query({ cube: 'opportunity_metrics', measures: MEASURES });
    // A fix that ANDed the measure filter into the WHOLE-CALL filter instead
    // of the one aggregation it belongs to would make won_count right (8) and
    // opp_count WRONG (8 instead of 24, since opp_count would inherit the
    // stage narrowing too) — asserting both in one result catches that shape;
    // pinning won_count alone would score it green.
    expect(result.rows[0]).toEqual({ opp_count: 24, won_count: 8, won_amount: 1_290_000 });
  });

  it('② an aggregation without a filter is unchanged and answers the same as before phase 2', async () => {
    const { svc, calls } = objectqlService([UNSCOPED_METRICS]);
    const result = await svc.query({ cube: 'unscoped_metrics', measures: ['opp_count'] });
    expect(calls[0].options.aggregations).toEqual([{ field: '*', method: 'count', alias: 'opp_count' }]);
    expect(result.rows[0]?.opp_count).toBe(30);
  });

  it('③ the dataset-level filter from phase 1 still applies and is not displaced', async () => {
    const { svc, calls } = objectqlService([OPPORTUNITY_METRICS]);
    await svc.query({ cube: 'opportunity_metrics', measures: MEASURES });
    // Phase 1's whole-call conjunct is untouched by phase 2's per-aggregation
    // addition — still exactly one dataset-scope conjunct, nothing merged in.
    expect(calls[0].options.filter).toEqual({ $and: [{ is_deleted: false }] });
  });

  it('④ the native-SQL path is untouched by this change (#10411 already fixed it)', async () => {
    const svc = sqlService([OPPORTUNITY_METRICS]);
    const { sql } = await svc.generateSql({ cube: 'opportunity_metrics', measures: MEASURES });
    expect(sql).toContain('THEN 1 END) AS "won_count"');
    expect(sql).toContain('THEN amount END) AS "won_amount"');
  });
});

// -- 2b. the ObjectQL SQL echo renders the per-measure filter too ----------

describe('[#10413 phase 2] the ObjectQL SQL echo renders the measure filter it executes', () => {
  it('renders a conditional aggregate for a filtered measure, mirroring execution', async () => {
    const { svc } = objectqlService([OPPORTUNITY_METRICS]);
    const { sql } = await svc.generateSql({ cube: 'opportunity_metrics', measures: MEASURES });
    // Same shape as the native-SQL echo (test ④ above): the two previews read
    // alike. An echo showing an unconditional aggregate here would understate
    // what `execute()` really runs now that phase 2 lowers the filter.
    expect(sql).toContain('THEN 1 END) AS "won_count"');
    expect(sql).toContain('THEN amount END) AS "won_amount"');
  });

  it('renders no conditional wrapping for the unfiltered measure', async () => {
    const { svc } = objectqlService([OPPORTUNITY_METRICS]);
    const { sql } = await svc.generateSql({ cube: 'opportunity_metrics', measures: MEASURES });
    expect(sql).toContain('COUNT(*) AS "opp_count"');
  });
});

// -- 3. the four pins ------------------------------------------------------

describe('[#10413] what the dataset filter must and must not do', () => {
  it('1. reaches `engine.aggregate` as a conjunct of the whole-call filter', async () => {
    const { svc, calls } = objectqlService([OPPORTUNITY_METRICS]);
    await svc.query({ cube: 'opportunity_metrics', measures: ['opp_count'] });
    expect(calls[0].options.filter).toEqual({ $and: [{ is_deleted: false }] });
  });

  it('2. invents nothing for a dataset that declares no filter', async () => {
    const { svc, calls } = objectqlService([UNSCOPED_METRICS]);
    await svc.query({ cube: 'unscoped_metrics', measures: ['opp_count'] });
    // No filter key at all — the unfiltered call is still the unfiltered call.
    expect(calls[0].options.filter).toBeUndefined();
  });

  it('3. ANDs with the caller\'s own `where` instead of replacing it', async () => {
    const { svc, calls } = objectqlService([OPPORTUNITY_METRICS]);
    const query: AnalyticsQuery = {
      cube: 'opportunity_metrics',
      measures: ['opp_count'],
      where: { stage: 'closed_won' },
    };
    const result = await svc.query(query);

    // Both predicates survive: the caller's `where` merged per field, the
    // dataset's scope ANDed in beside it.
    expect(calls[0].options.filter).toEqual({
      stage: 'closed_won',
      $and: [{ is_deleted: false }],
    });
    // 8 live won deals — not 11 (dataset filter dropped) and not 24 (the
    // caller's `where` clobbered by the dataset filter).
    expect(result.rows[0]?.opp_count).toBe(8);
  });

  it('3. leaves a time window intact too', async () => {
    // No rows: the assertion is on the RECORDED engine call, and the probe
    // matcher deliberately refuses operator objects (a window is `{$gte,$lte}`)
    // rather than pretending to evaluate one.
    const { svc, calls } = objectqlService([
      DatasetSchema.parse({
        name: 'dated_metrics', label: 'Dated', object: 'crm_opportunity',
        filter: { is_deleted: false },
        dimensions: [{ name: 'close_date', label: 'Close', field: 'close_date', type: 'date' }],
        measures: [{ name: 'opp_count', label: 'Opportunities', aggregate: 'count' }],
      }) as Dataset,
    ], []);
    await svc.query({
      cube: 'dated_metrics',
      measures: ['opp_count'],
      timeDimensions: [{ dimension: 'close_date', dateRange: ['2026-01-01', '2026-03-31'] }],
    });
    const filter = calls[0].options.filter as Record<string, unknown>;
    // The window still lands on its own field, unmerged with the dataset scope.
    expect(filter.close_date).toMatchObject({ $gte: '2026-01-01' });
    expect(filter.$and).toEqual([{ is_deleted: false }]);
  });

  it('4. leaves the NATIVE-SQL path exactly as #10411 left it', async () => {
    const svc = sqlService([OPPORTUNITY_METRICS]);
    const { sql, params } = await svc.generateSql({
      cube: 'opportunity_metrics', measures: MEASURES,
    });
    // One dataset-scope conjunct, in the WHERE, bound once — not doubled by a
    // second application from this card.
    expect(sql.match(/is_deleted/g) ?? []).toHaveLength(1);
    expect(params.filter((p) => p === 0 || p === false)).toHaveLength(1);
  });

  it('leaves a cube that is NOT a compiled dataset untouched', async () => {
    const calls: AggCall[] = [];
    const svc = new AnalyticsService({
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (object: string, options: AggOptions) => {
        calls.push({ object, options });
        return runAggregate(ALL_ROWS, options);
      },
      cubes: [{
        name: 'crm_opportunity', title: 'Opportunities', sql: 'crm_opportunity', public: false,
        measures: { count: { name: 'count', label: 'Count', type: 'count', sql: '*' } },
        dimensions: {},
      }],
    });
    const result = await svc.query({ cube: 'crm_opportunity', measures: ['count'] });
    expect(calls[0].options.filter).toBeUndefined();
    expect(result.rows[0]?.count).toBe(30);
  });
});

// -- 4. the echo tells the same story as the execution ---------------------

describe('[#10413] the ObjectQL SQL echo renders the dataset scope it executes', () => {
  it('renders the dataset filter in the echoed statement', async () => {
    const { svc } = objectqlService([OPPORTUNITY_METRICS]);
    const { sql, params } = await svc.generateSql({
      cube: 'opportunity_metrics', measures: ['opp_count'],
    });
    // #3601 / #3602's rule applied to this predicate: the echo exists to
    // reproduce the execution, and a rendering that omits a predicate the engine
    // really applies is the same lie as one that invents a predicate.
    expect(sql).toContain('WHERE is_deleted = $1');
    expect(params).toEqual([false]);
  });

  it('renders nothing extra for a dataset with no filter', async () => {
    const { svc } = objectqlService([UNSCOPED_METRICS]);
    const { sql, params } = await svc.generateSql({
      cube: 'unscoped_metrics', measures: ['opp_count'],
    });
    expect(sql).not.toContain('WHERE');
    expect(params).toEqual([]);
  });
});
