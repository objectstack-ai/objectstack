// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0053 Phase 2 (D2): `engine.aggregate({ timezone })` routing.
//
// Native driver date bucketing (`date_trunc`) is UTC-only, so a non-UTC
// reference timezone must force the in-memory path (uniform across drivers)
// while UTC / unset keeps the native fast path. These tests pin both halves
// using a driver that advertises native day bucketing and records whether its
// native `aggregate()` was taken.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

/**
 * A driver advertising native `day` granularity. Its native `aggregate()`
 * "buckets" in UTC (the only thing a real SQL `date_trunc` can do here) and
 * flags that it ran, so the test can assert which path the engine chose.
 */
function makeBucketingDriver(rows: any[]) {
  let nativeAggregateCalls = 0;
  const driver: any = {
    name: 'bucketing-mock',
    version: '0.0.0',
    supports: { queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true } },
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
      // Simulate UTC `date_trunc` day bucketing + sum.
      const buckets = new Map<string, number>();
      const gran = ast.groupBy?.[0];
      const field = typeof gran === 'string' ? gran : gran.field;
      for (const r of rows) {
        const day = new Date(String(r[field])).toISOString().slice(0, 10);
        buckets.set(day, (buckets.get(day) ?? 0) + Number(r.amount));
      }
      return Array.from(buckets, ([closed_at, total]) => ({ closed_at, total }));
    },
  };
  return { driver, nativeCalls: () => nativeAggregateCalls };
}

// Two events 4h apart straddling the NY midnight: same UTC day (03-01),
// different NY days (02-29 / 03-01).
const ROWS = [
  { closed_at: '2024-03-01T03:00:00.000Z', amount: 10 }, // NY 02-29
  { closed_at: '2024-03-01T07:00:00.000Z', amount: 5 },  // NY 03-01
];

async function makeEngine(rows: any[]) {
  const { driver, nativeCalls } = makeBucketingDriver(rows);
  const engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({
    name: 'deal',
    fields: { closed_at: { type: 'date' }, amount: { type: 'number' } },
  } as any);
  return { engine, nativeCalls };
}

const dayBucket = {
  groupBy: [{ field: 'closed_at', dateGranularity: 'day' }],
  aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
};

describe('engine.aggregate timezone routing (ADR-0053 Phase 2)', () => {
  it('UTC / unset takes the native driver fast path', async () => {
    const { engine, nativeCalls } = await makeEngine(ROWS);
    const utc = await engine.aggregate('deal', { ...dayBucket, timezone: 'UTC' } as any);
    expect(nativeCalls()).toBe(1);
    expect(utc).toEqual([{ closed_at: '2024-03-01', total: 15 }]);

    const unset = await engine.aggregate('deal', { ...dayBucket } as any);
    expect(nativeCalls()).toBe(2); // native again
    expect(unset).toEqual([{ closed_at: '2024-03-01', total: 15 }]);
  });

  it('non-UTC timezone forces in-memory bucketing on the reference day', async () => {
    const { engine, nativeCalls } = await makeEngine(ROWS);
    const ny = (await engine.aggregate('deal', {
      ...dayBucket,
      timezone: 'America/New_York',
    } as any)).sort((a: any, b: any) => String(a.closed_at).localeCompare(String(b.closed_at)));

    expect(nativeCalls()).toBe(0); // native path skipped
    expect(ny).toEqual([
      { closed_at: '2024-02-29', total: 10 },
      { closed_at: '2024-03-01', total: 5 },
    ]);
  });
});
