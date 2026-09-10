// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#16642] The in-memory lowering path of `engine.aggregate` asks the driver
// for ROWS — the AST it sends to `find()` carries no `groupBy`, no
// `aggregations` and no `having`, because this path is about to evaluate all
// three itself.
//
// ## The defect this pins
//
// `engine.aggregate` forks: a driver with a native `aggregate()` gets the
// pushdown, and anything the pushdown cannot express — a per-aggregation
// `filter` (#10576), a date granularity the driver does not advertise, a
// non-UTC reference timezone — falls back to `driver.find()` + a second pass
// through `applyInMemoryAggregation`. That fallback used to hand `find()` the
// WHOLE aggregate AST, aggregation keys included.
//
// `find()`'s contract says nothing about those keys, and the drivers disagree
// about them. `driver-sql` and `driver-rest` ignore them and return rows —
// which is the only reason this path ever worked. `driver-memory` HONOURS
// them: its `find()` funnels straight into the same `performAggregation` its
// `aggregate(AST)` door uses. `driver-mongodb` and `driver-turso` carry the
// same refusal on their own aggregation faces. Against a driver of the second
// kind the one seam answered two different wrong things:
//
//   * the per-aggregation `filter` that ROUTED the call here was refused
//     NOT_IMPLEMENTED/501 by the driver's own #10413 guard. That guard is
//     aimed at a caller reaching the driver's aggregation face directly, and
//     it names the remedy "route the query through the engine" — so the
//     engine's own lowering was being told to use the engine. Downstream,
//     `service-analytics`'s ObjectQL strategy lowers a dataset measure
//     `filter` into exactly this key, so a measure filter answered 501 on the
//     memory driver while sqlite answered the number (#16642);
//   * a date-bucketed `groupBy` came back ALREADY grouped — on the raw
//     timestamp, since `dateGranularity` is an ENGINE concept the driver face
//     does not read — and `applyInMemoryAggregation` then aggregated those
//     GROUP rows a second time. That one does not refuse: it reports a count
//     of buckets under the author's own measure name (#16178's shape).
//
// Both driver refusals document themselves as unreachable through
// `engine.aggregate` "because the engine lowers in memory for every driver".
// These tests are what makes that sentence true.
//
// ## Why stand-in drivers rather than `@objectstack/driver-memory`
//
// The real driver is in a retirement programme whose census
// (`scripts/check-driver-memory-census.mjs`, #6664) requires a maintainer
// ruling before a package declares it, so this file models the two behaviours
// instead of importing them, and pins the MECHANISM — the AST the driver
// received — beside the numbers, so a stand-in that drifts from the real
// driver cannot make the mechanism assertion pass.

import { describe, it, expect } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

// 88 applications, 15 of them rejected — the #16642 measurement's own numbers
// (`rejected_count` = 15, and 15/88 = 0.1704… is the `ratio` the card says is
// blocked outright on the memory driver).
type Row = Record<string, unknown>;

const APPLICATIONS: Row[] = Array.from({ length: 88 }, (_, i) => ({
  id: `a${i}`,
  stage: i < 15 ? 'rejected' : i < 40 ? 'applied' : 'screening',
  score: i,
  // Two calendar days, so a day bucket is a real bucket and the
  // count-of-buckets answer (2) is distinguishable from the true count (88).
  created_at: i % 2 === 0 ? '2026-01-01T03:00:00.000Z' : '2026-01-02T03:00:00.000Z',
}));

/** The keys a driver must never be asked to interpret on the rows path. */
const AGGREGATION_KEYS = ['groupBy', 'aggregations', 'having'] as const;

interface Seen { findAsts: any[]; nativeAggregateCalls: number }

function baseDriver(seen: Seen) {
  return {
    name: 'stand-in',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; },
    async execute() { return null; },
    async findOne() { return APPLICATIONS[0] ?? null; },
    async create(_o: string, d: any) { return d; },
    async update(_o: string, _id: string, d: any) { return d; },
    async delete() { return true; },
    async count() { return APPLICATIONS.length; },
    async bulkCreate(_o: string, r: any[]) { return r; },
    async bulkUpdate() { return []; }, async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
    async aggregate(_object: string, _ast: any) {
      seen.nativeAggregateCalls += 1;
      return [{ pushed_down: true }];
    },
  };
}

/**
 * `driver-memory`'s shape: `find()` funnels `groupBy` / `aggregations` into the
 * driver's own aggregation face, which REFUSES a per-aggregation filter with
 * the #10413 envelope (NOT_IMPLEMENTED/501) and otherwise groups on the RAW
 * value — `dateGranularity` is an engine concept no driver face reads.
 */
function makeAggregatingDriver(seen: Seen) {
  return {
    ...baseDriver(seen),
    async find(_object: string, query: any) {
      seen.findAsts.push(structuredClone(query));
      const aggs = query.aggregations ?? [];
      for (const agg of aggs) {
        const f = agg?.filter;
        if (f && typeof f === 'object' && Object.keys(f).length > 0) {
          // The same ENVELOPE `refusePerAggregationFilter` raises — the
          // `code`/`status` pair, which is what ADR-0112 makes the contract
          // and what these cases assert. The message text is this file's
          // own: pinning the driver's prose here would pin a sentence this
          // package does not own.
          const err = new Error(
            `Per-aggregation \`filter\` on "${agg.alias}" is not supported by this backend (stand-in).`,
          ) as Error & { code?: string; status?: number };
          err.code = 'NOT_IMPLEMENTED';
          err.status = 501;
          throw err;
        }
      }
      if (!query.groupBy && aggs.length === 0) return APPLICATIONS.slice();
      // Group on the raw value, then aggregate — the driver's own face.
      // `dateGranularity` is deliberately NOT read: it is an engine concept,
      // and no driver aggregation face reads it. That is what makes the
      // double-aggregation case below reproduce.
      const groupFields: string[] = (query.groupBy ?? []).map(
        (g: string | { field: string }) => (typeof g === 'string' ? g : g.field),
      );
      const buckets = new Map<string, Row[]>();
      for (const row of APPLICATIONS) {
        const key = groupFields.map((f) => String(row[f])).join('|');
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key)!.push(row);
      }
      return [...buckets.entries()].map(([, rows]) => {
        const out: Record<string, unknown> = {};
        for (const field of groupFields) out[field] = rows[0][field];
        for (const agg of aggs) if (agg.function === 'count') out[agg.alias] = rows.length;
        return out;
      });
    },
  };
}

async function makeEngine(driver: any) {
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  (engine.registry as any).registerObject({
    name: 'ats_application',
    fields: { stage: { type: 'text' }, score: { type: 'number' }, created_at: { type: 'datetime' } },
  });
  return engine;
}

describe('engine.aggregate — the in-memory lowering path asks for ROWS (#16642)', () => {
  it('the measured cell: a per-aggregation filter answers the FILTERED number instead of the driver refusal', async () => {
    const seen: Seen = { findAsts: [], nativeAggregateCalls: 0 };
    const engine = await makeEngine(makeAggregatingDriver(seen));

    const rows = await engine.aggregate('ats_application', {
      aggregations: [{ function: 'count', alias: 'rejected_count', filter: { stage: 'rejected' } }],
    } satisfies EngineAggregateOptions);

    // 15, not 88 (the unfiltered count #10413 refused to answer) and not a
    // 501 (what the driver raised when the key reached it).
    expect(rows).toEqual([{ rejected_count: 15 }]);
    expect(seen.nativeAggregateCalls).toBe(0);
  });

  it('the ratio case: two differently-filtered counts in ONE call, both filtered', async () => {
    const seen: Seen = { findAsts: [], nativeAggregateCalls: 0 };
    const engine = await makeEngine(makeAggregatingDriver(seen));

    const rows = await engine.aggregate('ats_application', {
      aggregations: [
        { function: 'count', alias: 'rejected_count', filter: { stage: 'rejected' } },
        { function: 'count', alias: 'total_count' },
      ],
    } satisfies EngineAggregateOptions);

    expect(rows).toEqual([{ rejected_count: 15, total_count: 88 }]);
    // The number the blocked `derived: { op: 'ratio' }` tile is built from.
    const [row] = rows as Array<{ rejected_count: number; total_count: number }>;
    expect(row.rejected_count / row.total_count).toBeCloseTo(0.1704545, 6);
  });

  it('MECHANISM: the AST handed to find() carries no aggregation keys — and still carries `where`', async () => {
    const seen: Seen = { findAsts: [], nativeAggregateCalls: 0 };
    const engine = await makeEngine(makeAggregatingDriver(seen));

    await engine.aggregate('ats_application', {
      where: { score: { $gte: 40 } },
      groupBy: ['stage'],
      aggregations: [{ function: 'count', alias: 'n', filter: { stage: 'screening' } }],
    } satisfies EngineAggregateOptions);

    expect(seen.findAsts).toHaveLength(1);
    const [ast] = seen.findAsts;
    for (const key of AGGREGATION_KEYS) expect(ast).not.toHaveProperty(key);
    // The scope half of the AST is NOT collateral: this seam is where a
    // middleware-injected read filter (RLS / tenancy, #2737) lives, and a
    // rows-only AST that dropped it would read the whole table.
    expect(ast.where).toEqual({ score: { $gte: 40 } });
    expect(ast.object).toBe('ats_application');
  });

  it('the silent half: a date-bucketed groupBy answers the true count, not a count of BUCKETS (#16178 shape)', async () => {
    const seen: Seen = { findAsts: [], nativeAggregateCalls: 0 };
    const engine = await makeEngine(makeAggregatingDriver(seen));

    const rows = await engine.aggregate('ats_application', {
      groupBy: [{ field: 'created_at', dateGranularity: 'day' }],
      aggregations: [{ function: 'count', alias: 'n' }],
    } satisfies EngineAggregateOptions);

    // Two calendar days, 44 rows each. When the driver grouped first, the
    // engine counted its GROUP rows instead — a plausible number, no refusal.
    const byDay = Object.fromEntries((rows as any[]).map((r) => [r.created_at, r.n]));
    expect(byDay).toEqual({ '2026-01-01': 44, '2026-01-02': 44 });
  });

  it('control: aggregations with no filter still take the driver pushdown — the fork is untouched', async () => {
    const seen: Seen = { findAsts: [], nativeAggregateCalls: 0 };
    const engine = await makeEngine(makeAggregatingDriver(seen));

    const rows = await engine.aggregate('ats_application', {
      aggregations: [{ function: 'count', alias: 'total_count' }],
    } satisfies EngineAggregateOptions);

    expect(seen.nativeAggregateCalls).toBe(1);
    expect(seen.findAsts).toHaveLength(0);
    expect(rows).toEqual([{ pushed_down: true }]);
  });

  it('control: a GENUINE driver error still surfaces — the rows path swallows nothing', async () => {
    const seen: Seen = { findAsts: [], nativeAggregateCalls: 0 };
    const faulty = {
      ...makeAggregatingDriver(seen),
      async find() {
        const err = new Error('no such column: stage') as Error & { code?: string; status?: number };
        err.code = 'INVALID_FIELD';
        err.status = 400;
        throw err;
      },
    };
    const engine = await makeEngine(faulty);

    // A capability gap is lowered; a fault is not converted into an empty
    // chart. Asserted on the ADR-0112 envelope, not on the message text.
    const thrown = await engine
      .aggregate('ats_application', {
        aggregations: [{ function: 'count', alias: 'n', filter: { stage: 'rejected' } }],
      } satisfies EngineAggregateOptions)
      .then(() => null, (e: Error & { code?: string; status?: number }) => e);

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown!.code).toBe('INVALID_FIELD');
    expect(thrown!.status).toBe(400);
  });
});
