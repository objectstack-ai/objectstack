// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `engine.aggregate({ having })` — ENFORCED since #4286 (step 3).
//
// `having` had been declared on the request surface since AST v2 and executed
// by nothing (finding 1: aggregate() rebuilt the driver AST without it, so
// even a driver implementing HAVING could never receive it). It is now
// engine-owned: applied AFTER aggregation over the aggregated row's own
// columns, identically on the native-driver path and the in-memory fallback.
// These tests pin both paths and the identical-semantics seam between them.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

const ROWS = [
  { customer_id: 'c1', amount: 100 },
  { customer_id: 'c1', amount: 400 },
  { customer_id: 'c2', amount: 900 },
  { customer_id: 'c2', amount: 300 },
  { customer_id: 'c2', amount: 50 },
  { customer_id: 'c3', amount: 20 },
];

/** A driver WITH native aggregate() (groups + sums itself, no HAVING). */
function makeNativeDriver(rows: any[]) {
  let nativeAggregateCalls = 0;
  const driver: any = {
    name: 'native-agg-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return rows.slice(); },
    findStream() { throw new Error('ni'); },
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
      const groups = new Map<string, { customer_id: string; order_count: number; total: number }>();
      for (const r of rows) {
        const g = groups.get(r.customer_id) ?? { customer_id: r.customer_id, order_count: 0, total: 0 };
        g.order_count += 1;
        g.total += r.amount;
        groups.set(r.customer_id, g);
      }
      // A real native driver ignores ast.having today — the engine post-filter
      // is what makes the clause live. Return the FULL grouped set.
      void ast;
      return Array.from(groups.values());
    },
  };
  return { driver, nativeCalls: () => nativeAggregateCalls };
}

/** A driver WITHOUT aggregate() — engine falls back to find() + in-memory. */
function makeRawDriver(rows: any[]) {
  const driver: any = {
    name: 'raw-mock',
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find() { return rows.slice(); },
    findStream() { throw new Error('ni'); },
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
    name: 'order',
    fields: { customer_id: { type: 'text' }, amount: { type: 'number' } },
  } as any);
  return engine;
}

const AGG_QUERY = {
  groupBy: ['customer_id'],
  aggregations: [
    { function: 'count', alias: 'order_count' },
    { function: 'sum', field: 'amount', alias: 'total' },
  ],
};

describe('engine.aggregate — having (#4286 step 3)', () => {
  it('applies having AFTER the native driver aggregate', async () => {
    const { driver, nativeCalls } = makeNativeDriver(ROWS);
    const engine = await makeEngine(driver);

    const rows = await engine.aggregate('order', {
      ...AGG_QUERY,
      having: { order_count: { $gt: 1 } },
    } as any);

    expect(nativeCalls()).toBe(1); // native path taken…
    expect(rows.map((r: any) => r.customer_id).sort()).toEqual(['c1', 'c2']); // …and post-filtered
  });

  it('applies having on the in-memory fallback path with identical semantics', async () => {
    const engine = await makeEngine(makeRawDriver(ROWS));

    const rows = await engine.aggregate('order', {
      ...AGG_QUERY,
      having: { order_count: { $gt: 1 } },
    } as any);

    expect(rows.map((r: any) => r.customer_id).sort()).toEqual(['c1', 'c2']);
  });

  it('having references the aggregation ALIAS namespace, composing with $and', async () => {
    const engine = await makeEngine(makeRawDriver(ROWS));

    const rows = await engine.aggregate('order', {
      ...AGG_QUERY,
      having: { $and: [{ order_count: { $gte: 2 } }, { total: { $gt: 600 } }] },
    } as any);

    expect(rows).toEqual([{ customer_id: 'c2', order_count: 3, total: 1250 }]);
  });

  it('an absent having returns the full grouped set (no behavior change)', async () => {
    const engine = await makeEngine(makeRawDriver(ROWS));
    const rows = await engine.aggregate('order', { ...AGG_QUERY } as any);
    expect(rows).toHaveLength(3);
  });

  it('an unknown having operator REJECTS the aggregate instead of ignoring it', async () => {
    const engine = await makeEngine(makeRawDriver(ROWS));
    await expect(engine.aggregate('order', {
      ...AGG_QUERY,
      having: { order_count: { $median: 2 } },
    } as any)).rejects.toThrow(/Unsupported operator '\$median' in `having`/);
  });
});
