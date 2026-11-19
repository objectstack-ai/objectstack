// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0053 Phase 2 (D2): `engine.aggregate({ timezone })` routing.
//
// A driver that does NOT declare `supports.zonedDateBucketing` buckets
// natively in UTC only, so a non-UTC reference timezone must force the
// in-memory path while UTC / unset keeps the native fast path. These tests pin
// both halves using a driver that advertises native day bucketing and records
// whether its native `aggregate()` was taken. [#33697] D2 as amended: a driver
// that DOES declare it receives the zone, resolved by the runtime first — the
// last describe block pins that dispatch, spelling by spelling.

import { describe, it, expect } from 'vitest';
import type { EngineAggregateOptions } from '@objectstack/spec/data';
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
  // [#24618] `closed_at` holds INSTANTS, so it is declared a `datetime` — the
  // type whose buckets follow the reference zone. Declared a `date` (as it
  // was), the rows path buckets it by its calendar day under every zone
  // (ADR-0053), which is what in-memory-aggregation-date-calendar-day.test.ts
  // pins; the routing this file is about is the same for both types.
  engine.registry.registerObject({
    name: 'deal',
    fields: { closed_at: { type: 'datetime' }, amount: { type: 'number' } },
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

// [#33697] ADR-0053 Phase 2 D2 as amended: a driver declaring
// `supports.zonedDateBucketing` is handed the zone the RUNTIME resolves the
// request's string to, and only an area/location name; review items (d) and
// (e) on the card name the spellings.
describe('engine.aggregate zoned-bucket pushdown (#33697, D2 as amended)', () => {
  const zonedDayBucket = (timezone: string): EngineAggregateOptions => ({
    groupBy: [{ field: 'closed_at', dateGranularity: 'day' }],
    aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
    timezone,
  });

  async function makeZonedEngine(zoned: boolean | undefined) {
    const received: any[] = [];
    let findCalls = 0;
    const driver: any = {
      name: 'zoned-mock',
      version: '0.0.0',
      supports: {
        queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true },
        ...(zoned === undefined ? {} : { zonedDateBucketing: zoned }),
      },
      async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
      async find() { findCalls += 1; return ROWS.slice(); },
      async findOne() { return null; },
      async create(_o: string, d: any) { return d; },
      async update(_o: string, _id: string, d: any) { return d; },
      async delete() { return true; },
      async count() { return ROWS.length; },
      async bulkCreate(_o: string, r: any[]) { return r; },
      async bulkUpdate() { return []; }, async bulkDelete() {},
      async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
      async commit() {}, async rollback() {},
      async aggregate(_object: string, ast: any) { received.push(ast); return []; },
    };
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject({
      name: 'deal',
      fields: { closed_at: { type: 'datetime' }, amount: { type: 'number' } },
    } as any);
    return { engine, received, finds: () => findCalls };
  }

  it.each([
    ['Asia/Taipei', 'Asia/Taipei'],
    ['Europe/Berlin', 'Europe/Berlin'],
    ['CST', 'America/Chicago'],
    ['US/Eastern', 'America/New_York'],
    ['Etc/GMT+5', 'Etc/GMT+5'],
  ])('pushes %s down as the resolved name %s', async (asked, sent) => {
    const { engine, received, finds } = await makeZonedEngine(true);
    await engine.aggregate('deal', zonedDayBucket(asked));
    expect(finds()).toBe(0);
    expect(received).toHaveLength(1);
    expect(received[0].timezone).toBe(sent);
  });

  it.each(['UTC', 'Etc/UTC', 'GMT', 'Zulu'])('reads %s as the UTC bucket: native, no zone sent', async (asked) => {
    const { engine, received, finds } = await makeZonedEngine(true);
    await engine.aggregate('deal', zonedDayBucket(asked));
    expect(finds()).toBe(0);
    expect(received).toHaveLength(1);
    expect('timezone' in received[0]).toBe(false);
  });

  it.each(['EST5EDT', '+08:00', 'Bogus/Zone'])('keeps %s in memory: it resolves to no area/location name', async (asked) => {
    const { engine, received, finds } = await makeZonedEngine(true);
    await engine.aggregate('deal', zonedDayBucket(asked));
    expect(received).toHaveLength(0);
    expect(finds()).toBe(1);
  });

  it.each([false, undefined])('keeps a non-UTC zone in memory on a driver whose bit is %s', async (bit) => {
    const { engine, received, finds } = await makeZonedEngine(bit);
    await engine.aggregate('deal', zonedDayBucket('Asia/Taipei'));
    expect(received).toHaveLength(0);
    expect(finds()).toBe(1);
  });

  it('sends no zone for a query with no date bucket', async () => {
    const { engine, received } = await makeZonedEngine(true);
    await engine.aggregate('deal', {
      groupBy: ['closed_at'],
      aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }],
      timezone: 'Asia/Taipei',
    } satisfies EngineAggregateOptions);
    expect(received).toHaveLength(1);
    expect('timezone' in received[0]).toBe(false);
  });
});
