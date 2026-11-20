// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [order and cut] `query_dataset`'s ObjectQL face cuts a top-N in the
 * database: the strategy hands the engine its order and `offset + limit`
 * through the plugin's `executeOrderCutAggregate` bridge, the driver's own
 * statement orders, cuts and counts (objectql `aggregate-order-cut.ts`), and
 * only the cut rows are read. The composition is the plugin's, over a real
 * `ObjectQL` and a real `SqliteWasmDriver`, with the ObjectQL face forced.
 *
 * Pinned: the driver reads only the cut rows and `totalGroups` stays the
 * count of every group; a text order is the database's (its collation, NULL
 * last in both directions) — the maintainer's ruling, arm A; where the engine
 * declines the cut (a driver that compiles none, a date bucket the driver
 * does not compile) the face reads every group and cuts in memory, and no
 * refusal reaches the caller; a select or lookup dimension ordered by its
 * display label is never cut in the database (the executor windows it in
 * memory, so the top-N is picked by label). A `having` never reaches this face;
 * its decline is pinned in objectql `aggregate-order-cut.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';

import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { GroupCountRequest } from '../dataset-group-count.js';

const ORDER = 'zz_oc_order';
const CUSTOMER = 'zz_oc_customer';
const DIRECTIVE = Symbol.for('objectstack.driver.aggregate.orderCut');

const CUSTOMER_FIELDS = { name: { type: 'text', name: 'name' } };
const ORDER_FIELDS = {
  region: { type: 'text', name: 'region' },
  amount: { type: 'number', name: 'amount' },
  closed_on: { type: 'date', name: 'closed_on' },
  customer: { type: 'lookup', name: 'customer', reference: CUSTOMER },
};

const dataset = DatasetSchema.parse({
  name: 'oc_orders',
  label: 'Orders',
  object: ORDER,
  dimensions: [
    { name: 'region', field: 'region', type: 'string' },
    { name: 'customer', field: 'customer', type: 'string' },
    { name: 'closed_on', field: 'closed_on', type: 'date' },
  ],
  measures: [
    { name: 'order_count', aggregate: 'count' },
    { name: 'amount_sum', aggregate: 'sum', field: 'amount' },
  ],
});

// Ids and names order differently: by id c1 < c2 < c3 < c4, by name Amy (c4) < Bob (c3) < Cat (c2) < Zed (c1).
const CUSTOMERS = [
  { id: 'c1', name: 'Zed' }, { id: 'c2', name: 'Cat' }, { id: 'c3', name: 'Bob' }, { id: 'c4', name: 'Amy' },
];
// Five region groups: four texts — `Emea` sorts first under the database's binary collation, after
// `amer` and `apac` under `localeCompare` — and NULL. amount_sum: amer 40, apac 30, Emea 20, zulu 10, NULL 50.
const ORDERS = [
  { id: 'o1', region: 'amer', amount: 25, closed_on: '2026-01-10', customer: 'c1' },
  { id: 'o2', region: 'amer', amount: 15, closed_on: '2026-02-10', customer: 'c2' },
  { id: 'o3', region: 'apac', amount: 30, closed_on: '2026-02-11', customer: 'c3' },
  { id: 'o4', region: 'Emea', amount: 20, closed_on: '2026-03-10', customer: 'c4' },
  { id: 'o5', region: 'zulu', amount: 10, closed_on: '2026-03-11', customer: 'c1' },
  { id: 'o6', region: null, amount: 50, closed_on: '2026-03-12', customer: 'c2' },
];

const CALLER = { userId: 'u_admin', tenantId: 'org_A' } as ExecutionContext;
const OLD_POSTURE = process.env.OS_TENANCY_POSTURE;
const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

interface Read { readonly object: string; readonly directive: unknown; readonly rows: number }

async function pluginService(engine: ObjectQL): Promise<AnalyticsService> {
  const registered: Record<string, unknown> = {};
  const ctx = {
    getService: (name: string) => (name === 'data' ? engine : registered[name]),
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: quiet,
  };
  await new AnalyticsServicePlugin({
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
  }).init(ctx as never);
  const service = registered.analytics as AnalyticsService;
  service.registerDataset(dataset);
  return service;
}

/** A driver that compiles no cut: named as the in-memory driver, it answers rows and the engine groups them. */
function rowsOnlyDriver(rows: Record<string, unknown[]>, reads: Read[]) {
  return {
    name: 'com.objectstack.driver.memory', version: '0.0.0', supports: {},
    async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
    async find(object: string) {
      const out = (rows[object] ?? []).map((r) => ({ ...(r as object) }));
      reads.push({ object, directive: undefined, rows: out.length });
      return out;
    },
    async findOne() { return null; }, async count() { return 0; },
    async create(_o: string, data: Record<string, unknown>) { return { ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async beginTransaction() { return {}; }, async commit() {}, async rollback() {},
  };
}

const byRegion = (limit: number, order: 'asc' | 'desc', offset?: number) => ({
  dimensions: ['region'], measures: ['amount_sum'], order: { region: order }, limit, ...(offset != null ? { offset } : {}),
});

describe('[order and cut] the ObjectQL face on a compiling driver reads only the cut rows', () => {
  let driver: SqliteWasmDriver;
  let service: AnalyticsService;
  const reads: Read[] = [];

  beforeAll(async () => {
    process.env.OS_TENANCY_POSTURE = 'isolated';
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    const engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: CUSTOMER, label: 'Customer', fields: CUSTOMER_FIELDS } as never);
    engine.registerObject({ name: ORDER, label: 'Order', fields: ORDER_FIELDS } as never);
    await engine.syncSchemas();
    for (const row of CUSTOMERS) await driver.create(CUSTOMER, { ...row, organization_id: 'org_A' }, { bypassTenantAudit: true } as never);
    for (const row of ORDERS) await driver.create(ORDER, { ...row, organization_id: 'org_A' }, { bypassTenantAudit: true } as never);
    const aggregate = driver.aggregate.bind(driver);
    (driver as unknown as { aggregate: unknown }).aggregate = async (object: string, ast: Record<symbol, unknown>, options?: unknown) => {
      const rows = await aggregate(object, ast as never, options as never);
      reads.push({ object, directive: ast?.[DIRECTIVE], rows: Array.isArray(rows) ? rows.length : -1 });
      return rows;
    };
    service = await pluginService(engine);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
    if (OLD_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = OLD_POSTURE;
  });

  it('top two by a measure: one statement, cut to two rows, totalGroups every group', async () => {
    reads.length = 0;
    const groupCount: GroupCountRequest = {};
    const { rows } = await service.queryDataset(dataset, {
      dimensions: ['region'], measures: ['amount_sum'], order: { amount_sum: 'desc' }, limit: 2,
    } as never, CALLER, { groupCount });
    expect(rows.map((r) => [r.region, r.amount_sum])).toEqual([[null, 50], ['amer', 40]]);
    expect(reads).toEqual([{ object: ORDER, directive: expect.objectContaining({ limit: 2 }), rows: 2 }]);
    expect(groupCount.outcome).toEqual({ groupCount: 5 });
  });

  it('an offset is cut as offset + limit in the statement and skipped here', async () => {
    reads.length = 0;
    const groupCount: GroupCountRequest = {};
    const { rows } = await service.queryDataset(dataset, {
      dimensions: ['region'], measures: ['amount_sum'], order: { amount_sum: 'desc' }, limit: 2, offset: 1,
    } as never, CALLER, { groupCount });
    expect(rows.map((r) => r.region)).toEqual(['amer', 'apac']);
    expect(reads).toEqual([{ object: ORDER, directive: expect.objectContaining({ limit: 3 }), rows: 3 }]);
    expect(groupCount.outcome).toEqual({ groupCount: 5 });
  });

  it('a text order is the database\'s: its collation picks the top-N, NULL last ascending and descending', async () => {
    reads.length = 0;
    const asc = await service.queryDataset(dataset, byRegion(1, 'asc') as never, CALLER);
    // Binary collation: `Emea` before `amer`; `localeCompare` (the in-memory comparator) would pick `amer`.
    expect(asc.rows.map((r) => r.region)).toEqual(['Emea']);
    const ascAll = await service.queryDataset(dataset, byRegion(4, 'asc') as never, CALLER);
    expect(ascAll.rows.map((r) => r.region)).not.toContain(null);
    const descAll = await service.queryDataset(dataset, byRegion(4, 'desc') as never, CALLER);
    expect(descAll.rows.map((r) => r.region)).not.toContain(null);
    expect(reads.map((r) => r.rows)).toEqual([1, 4, 4]);
    expect(reads.every((r) => r.directive !== undefined)).toBe(true);
  });

  it('the analytics query door is the same face: order and limit cut in the statement', async () => {
    reads.length = 0;
    const { rows } = await service.query({
      cube: dataset.name, dimensions: ['region'], measures: ['order_count'], order: { order_count: 'desc' }, limit: 1,
    } as AnalyticsQuery, CALLER);
    expect(rows).toEqual([{ region: 'amer', order_count: 2 }]);
    expect(reads).toEqual([{ object: ORDER, directive: expect.objectContaining({ limit: 1 }), rows: 1 }]);
  });

  it('a date bucket the driver does not compile (a reference zone) declines: every group read, cut in memory, no refusal', async () => {
    reads.length = 0;
    const { rows } = await service.query({
      cube: dataset.name, measures: ['order_count'], timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }],
      order: { order_count: 'desc' }, limit: 1, timezone: 'Asia/Shanghai',
    } as AnalyticsQuery, CALLER);
    expect(rows).toEqual([{ closed_on: '2026-03', order_count: 3 }]);
    expect(reads.some((r) => r.directive !== undefined)).toBe(false);
  });

  it('a lookup dimension ordered by its display label is never cut in the database: the top-N is picked by name', async () => {
    reads.length = 0;
    const groupCount: GroupCountRequest = {};
    const { rows } = await service.queryDataset(dataset, {
      dimensions: ['customer'], measures: ['order_count'], order: { customer: 'asc' }, limit: 2,
    } as never, CALLER, { groupCount });
    // By name Amy (c4), Bob (c3), rendered by name; a cut on the stored id would have kept c1 (Zed) and c2 (Cat).
    expect(rows.map((r) => r.customer)).toEqual(['Amy', 'Bob']);
    expect(reads.some((r) => r.directive !== undefined)).toBe(false);
    expect(reads.find((r) => r.object === ORDER)?.rows).toBe(4);
    expect(groupCount.outcome).toEqual({ groupCount: 4 });
  });
});

describe('[order and cut] on a driver that compiles no cut the face declines to its in-memory cut, no refusal', () => {
  it('the in-memory driver: every group read, the top two cut here, totalGroups exact', async () => {
    const reads: Read[] = [];
    const engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(rowsOnlyDriver({ [ORDER]: ORDERS }, reads) as never, true);
    await engine.init();
    engine.registerObject({ name: CUSTOMER, label: 'Customer', fields: CUSTOMER_FIELDS } as never);
    engine.registerObject({ name: ORDER, label: 'Order', fields: ORDER_FIELDS } as never);
    const service = await pluginService(engine);
    const groupCount: GroupCountRequest = {};
    const { rows } = await service.queryDataset(dataset, {
      dimensions: ['region'], measures: ['amount_sum'], order: { amount_sum: 'desc' }, limit: 2,
    } as never, CALLER, { groupCount });
    expect(rows.map((r) => [r.region, r.amount_sum])).toEqual([[null, 50], ['amer', 40]]);
    expect(reads).toEqual([{ object: ORDER, directive: undefined, rows: ORDERS.length }]);
    expect(groupCount.outcome).toEqual({ groupCount: 5 });
  });
});
