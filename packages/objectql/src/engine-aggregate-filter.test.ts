// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `engine.aggregate({ aggregations: [{ …, filter }] })` — ENFORCED since
// #10576, the contract half of #10413's ruling (maintainer, 2026-08-21,
// verbatim 「其他接受」 accepting option A: 「给引擎聚合契约加逐聚合过滤,一次修
// 对所有驱动」).
//
// The defect being closed: the ObjectQL analytics path handed per-measure
// filters (`stage: 'closed_won'`) toward `engine.aggregate` and the contract
// had nowhere to put them, so "won deals" counted EVERY row — silently, with
// the dashboard door on the same deployment answering the filtered numbers
// (#10413's two-door disagreement). These tests reproduce that measurement's
// shape at the objectql level: the same dataset, the same three measures, and
// the numbers CHANGING once the filter is honoured.
//
// Execution model pinned here (the correct-first two-tier shape date bucketing
// and HAVING use):
//   * any aggregation carrying a non-empty `filter` forces the in-memory path
//     — no driver compiles a conditional aggregate today, and pushing the
//     entry down would aggregate the unfiltered rows;
//   * aggregations WITHOUT a filter keep the native pushdown path untouched
//     (the widening must not move the existing acceptance face);
//   * an unknown operator inside a per-aggregation filter REFUSES with the
//     ADR-0112 `INVALID_FILTER`/400 envelope, naming the aggregation position
//     — ignoring it would silently answer the unfiltered aggregate, which is
//     the very defect this key closes.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

// The #10413 measurement's dataset shape: opportunities with a stage and an
// amount. 6 rows, 2 closed_won worth 700 total.
const OPPORTUNITIES = [
  { stage: 'closed_won', amount: 500, region: 'east' },
  { stage: 'closed_won', amount: 200, region: 'west' },
  { stage: 'open', amount: 900, region: 'east' },
  { stage: 'open', amount: 300, region: 'west' },
  { stage: 'closed_lost', amount: 50, region: 'east' },
  { stage: 'closed_lost', amount: 20, region: 'west' },
];

/** A driver WITH native aggregate() — counts its calls so the fork is visible. */
function makeNativeDriver(rows: any[]) {
  let nativeAggregateCalls = 0;
  let findCalls = 0;
  const driver: any = {
    name: 'native-agg-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { findCalls += 1; return rows.slice(); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
    async aggregate(_object: string, ast: any) {
      nativeAggregateCalls += 1;
      // A native driver that DROPS the per-aggregation filter — the pre-#10576
      // behaviour of every real driver. If the engine ever pushes a filtered
      // aggregation down here, the totals below come back unfiltered and the
      // reproduction test reads the wrong numbers.
      const out: Record<string, any> = {};
      for (const agg of ast.aggregations ?? []) {
        if (agg.function === 'count') out[agg.alias] = rows.length;
        if (agg.function === 'sum') out[agg.alias] = rows.reduce((a: number, r: any) => a + r[agg.field], 0);
      }
      return [out];
    },
  };
  return { driver, nativeCalls: () => nativeAggregateCalls, finds: () => findCalls };
}

/** A driver WITHOUT aggregate() — the engine's find() + in-memory lowering. */
function makeRawDriver(rows: any[]) {
  const driver: any = {
    name: 'raw-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return rows.slice(); },
    async findOne() { return rows[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return rows.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  return driver;
}

async function makeEngine(driver: any) {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'crm_opportunity',
    fields: {
      stage: { type: 'text' },
      amount: { type: 'number' },
      region: { type: 'text' },
    },
  } as any);
  return engine;
}

// The #10413 reproduction's three measures, lowered to the contract this card
// widens: per-aggregation `filter` on the two "won" measures.
const REPRO_AGGREGATIONS = [
  { function: 'count', alias: 'opp_count' },
  { function: 'count', alias: 'won_count', filter: { stage: 'closed_won' } },
  { function: 'sum', field: 'amount', alias: 'won_amount', filter: { stage: 'closed_won' } },
];

describe('engine.aggregate — per-aggregation filter (#10576, the #10413 contract half)', () => {
  it('reproduces #10413: per-measure stage filters reach engine.aggregate and CHANGE the numbers', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: REPRO_AGGREGATIONS,
    } as any);

    // Pre-#10576 (the measured defect): won_count === opp_count === 6 and
    // won_amount summed every row (1970). Honoured, the numbers move.
    expect(rows).toEqual([{ opp_count: 6, won_count: 2, won_amount: 700 }]);
  });

  it('a filtered aggregation forces the in-memory lowering even on a native-aggregate driver', async () => {
    const { driver, nativeCalls, finds } = makeNativeDriver(OPPORTUNITIES);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: REPRO_AGGREGATIONS,
    } as any);

    // The driver's own aggregate() drops the filter (as every real driver
    // did), so the ONLY way these numbers are right is that the engine never
    // called it: filtered aggregations take find() + in-memory.
    expect(nativeCalls()).toBe(0);
    expect(finds()).toBe(1);
    expect(rows).toEqual([{ opp_count: 6, won_count: 2, won_amount: 700 }]);
  });

  it('positive pin: aggregations WITHOUT filter keep the native pushdown path, results unchanged', async () => {
    const { driver, nativeCalls } = makeNativeDriver(OPPORTUNITIES);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: [
        { function: 'count', alias: 'opp_count' },
        { function: 'sum', field: 'amount', alias: 'total_amount' },
      ],
    } as any);

    expect(nativeCalls()).toBe(1); // pushdown exactly as before the widening
    expect(rows).toEqual([{ opp_count: 6, total_amount: 1970 }]);
  });

  it('positive pin: an EMPTY filter object is vacuous (same convention as where/having) and does not break pushdown', async () => {
    const { driver, nativeCalls } = makeNativeDriver(OPPORTUNITIES);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: [{ function: 'count', alias: 'opp_count', filter: {} }],
    } as any);

    expect(nativeCalls()).toBe(1);
    expect(rows).toEqual([{ opp_count: 6 }]);
  });

  it('composes with groupBy: the filter narrows each bucket for ITS aggregation only', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      groupBy: ['region'],
      aggregations: [
        { function: 'count', alias: 'opp_count' },
        { function: 'sum', field: 'amount', alias: 'won_amount', filter: { stage: 'closed_won' } },
      ],
    } as any);

    const byRegion = Object.fromEntries(rows.map((r: any) => [r.region, r]));
    expect(byRegion.east).toEqual({ region: 'east', opp_count: 3, won_amount: 500 });
    expect(byRegion.west).toEqual({ region: 'west', opp_count: 3, won_amount: 200 });
  });

  it('a group the filter empties answers the ruled empty-group values: count/sum 0, avg/min/max null', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      groupBy: ['region'],
      aggregations: [
        // No row has this stage, so every bucket's filtered set is empty.
        { function: 'count', alias: 'n', filter: { stage: 'no_such_stage' } },
        { function: 'sum', field: 'amount', alias: 'total', filter: { stage: 'no_such_stage' } },
        { function: 'avg', field: 'amount', alias: 'mean', filter: { stage: 'no_such_stage' } },
        { function: 'max', field: 'amount', alias: 'top', filter: { stage: 'no_such_stage' } },
      ],
    } as any);

    // `emptyGroupValueFor` (spec data/aggregation-policy.ts): counting or
    // summing no rows is a measured 0; averaging/maximising them has no answer.
    for (const row of rows) {
      expect(row.n).toBe(0);
      expect(row.total).toBe(0);
      expect(row.mean).toBeNull();
      expect(row.top).toBeNull();
    }
  });

  it('the filter composes the where vocabulary ($in, $gte, $and) over source rows', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    const rows = await engine.aggregate('crm_opportunity', {
      aggregations: [{
        function: 'count',
        alias: 'big_closed',
        filter: { $and: [{ stage: { $in: ['closed_won', 'closed_lost'] } }, { amount: { $gte: 50 } }] },
      }],
    } as any);

    // closed_won 500, closed_won 200, closed_lost 50 — the 20 is excluded.
    expect(rows).toEqual([{ big_closed: 3 }]);
  });

  it('an unknown operator in a per-aggregation filter REFUSES with INVALID_FILTER/400, naming the position', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      await engine.aggregate('crm_opportunity', {
        aggregations: [
          { function: 'count', alias: 'opp_count' },
          { function: 'count', alias: 'bad', filter: { amount: { $median: 3 } } },
        ],
      } as any);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }

    // The named envelope, not a bare throw (#6142/#6050: a suite that only
    // asserts THREW stays green while the envelope is missing).
    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('INVALID_FILTER');
    expect(thrown!.status).toBe(400);
    expect(thrown!.message).toMatch(/Unsupported operator '\$median' in `aggregations\[1\]\.filter`/);
    expect(thrown!.message).toMatch(/refused rather than ignored/);
  });

  it('a retired operator ($regex) in a per-aggregation filter gets the retirement prescription, same envelope', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      await engine.aggregate('crm_opportunity', {
        aggregations: [{ function: 'count', alias: 'bad', filter: { stage: { $regex: 'won' } } }],
      } as any);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }

    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('INVALID_FILTER');
    expect(thrown!.status).toBe(400);
    expect(thrown!.message).toMatch(/Filter operator '\$regex' in `aggregations\[0\]\.filter` is RETIRED/);
  });

  it('the comparand-shape door covers the new filter position: a scalar $in is refused before any driver runs', async () => {
    const engine = await makeEngine(makeRawDriver(OPPORTUNITIES));

    let thrown: (Error & { code?: string; status?: number }) | undefined;
    try {
      await engine.aggregate('crm_opportunity', {
        aggregations: [{ function: 'count', alias: 'bad', filter: { stage: { $in: 'closed_won' } } }],
      } as any);
    } catch (e) {
      thrown = e as Error & { code?: string; status?: number };
    }

    expect(thrown).toBeDefined();
    expect(thrown!.code).toBe('INVALID_FILTER');
    expect(thrown!.status).toBe(400);
    // The path names WHICH aggregation carries the offending comparand.
    expect(thrown!.message).toContain('aggregations[0].filter');
  });
});
