// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A lookup dimension serves the referenced record's display name, not its id,
 * in the two shapes a downstream metadata app hit on the published packages:
 *
 * - **A — a relationship-path lookup** (`field: 'crm_account.owner_id'`): the
 *   column lives on the HOP object, so the label pass has to read that object's
 *   field map, not the base object's. The hop is resolved by the one hop
 *   resolver the query itself joins with (`columnObjectOf`, `hop-object.ts`),
 *   in the display pass and in the sort-key pass alike.
 * - **B — a base-field lookup to an object whose title is its `nameField`**
 *   (an autonumber `order_number`, no `name`/`title`/`label` field, and a
 *   null text field declared ahead of it): the label read takes the target's
 *   declared `nameField` before the name/title/label/first-text convention.
 *
 * Driven end to end: a real `ObjectQL` engine over SQLite, the analytics
 * service `AnalyticsServicePlugin` registers (its real `fetchRecordLabels`
 * bridge), and three faces of one saved dataset — the REST door
 * (`POST /analytics/dataset/query` with `datasetName`), the `query_dataset`
 * tool executor (`AnalyticsService.datasetTools`, the executor MCP's
 * `query_dataset` bridge member calls: `packages/runtime/src/domains/mcp.ts`),
 * and the direct service call. All three serve the same labelled rows, because
 * all three reach `AnalyticsService.queryDataset`'s one label pass.
 *
 * Pinned around the fix: grouping stays by id (two reps who share a name stay
 * two rows), a hop target the API exposure decision does not serve still
 * renders its id (the label read is gated as before), and a lookup to an
 * object with a `name` field labels exactly as it did.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const OBJECTS = [
  {
    name: 'ld_rep', label: 'Rep',
    fields: { name: { name: 'name', type: 'text' } },
  },
  {
    // The API exposure decision does not serve this object: a dimension whose
    // label target it is renders the stored id.
    name: 'ld_region', label: 'Region', enable: { apiEnabled: false },
    fields: { name: { name: 'name', type: 'text' } },
  },
  {
    name: 'ld_grade', label: 'Grade',
    fields: { name: { name: 'name', type: 'text' } },
  },
  {
    name: 'ld_account', label: 'Account',
    fields: {
      name: { name: 'name', type: 'text' },
      owner_id: { name: 'owner_id', type: 'lookup', reference: 'ld_rep' },
      region: { name: 'region', type: 'lookup', reference: 'ld_region' },
    },
  },
  {
    // B's target: titled by its `nameField`, an autonumber, and no
    // `name`/`title`/`label` field. The platform injects the ownership `queue`
    // text column (null on every row here), which is the first text field the
    // name/title/label/first-text convention finds — the card's shape.
    name: 'ld_order', label: 'Order', nameField: 'order_number',
    fields: {
      order_number: { name: 'order_number', type: 'autonumber', autonumberFormat: 'SO-{YYYY}-{0000}' },
      account: { name: 'account', type: 'lookup', reference: 'ld_account' },
      carbon_grade: { name: 'carbon_grade', type: 'lookup', reference: 'ld_grade' },
      tonnes: { name: 'tonnes', type: 'number' },
    },
  },
  {
    name: 'ld_plan', label: 'Plan',
    fields: {
      cb_order: { name: 'cb_order', type: 'lookup', reference: 'ld_order' },
      margin: { name: 'margin', type: 'number' },
    },
  },
];

const SEED: Record<string, Record<string, unknown>[]> = {
  ld_rep: [
    // Ids sort OPPOSITE to names (rep_a < rep_b, "Zed Young" > "Sam Lee"), so
    // a sort by the stored id and a sort by the rendered name disagree.
    { id: 'rep_a', name: 'Zed Young' },
    // Two reps who share a display name: grouping stays by id.
    { id: 'rep_b', name: 'Sam Lee' },
    { id: 'rep_c', name: 'Sam Lee' },
  ],
  ld_region: [{ id: 'reg_e', name: 'East' }],
  ld_grade: [{ id: 'gr_330', name: 'N330' }, { id: 'gr_550', name: 'N550' }],
  ld_account: [
    { id: 'acc_1', name: 'Acme', owner_id: 'rep_a', region: 'reg_e' },
    { id: 'acc_2', name: 'Globex', owner_id: 'rep_b', region: 'reg_e' },
    { id: 'acc_3', name: 'Initech', owner_id: 'rep_c', region: 'reg_e' },
  ],
  ld_order: [
    { id: 'ord_1', order_number: 'SO-2026-0001', account: 'acc_1', carbon_grade: 'gr_330', tonnes: 10 },
    { id: 'ord_2', order_number: 'SO-2026-0002', account: 'acc_2', carbon_grade: 'gr_550', tonnes: 20 },
    { id: 'ord_3', order_number: 'SO-2026-0003', account: 'acc_3', carbon_grade: 'gr_330', tonnes: 5 },
  ],
  ld_plan: [
    { id: 'pl_1', cb_order: 'ord_1', margin: 1.5 },
    { id: 'pl_2', cb_order: 'ord_2', margin: 2.5 },
    { id: 'pl_3', cb_order: 'ord_2', margin: 1 },
  ],
};

const ORDER_METRICS = {
  name: 'ld_order_metrics',
  label: 'Order metrics',
  object: 'ld_order',
  include: ['account'],
  dimensions: [
    // A — a relationship-path lookup.
    { name: 'rep', label: 'Sales Rep', field: 'account.owner_id', type: 'lookup' },
    // A, gated — the path's label target is not served by the API.
    { name: 'region', label: 'Region', field: 'account.region', type: 'lookup' },
    // CONTROL — a base-field lookup to an object with a `name` field.
    { name: 'customer', label: 'Customer', field: 'account', type: 'lookup' },
  ],
  measures: [
    { name: 'order_tonnes', label: 'Tonnes', aggregate: 'sum', field: 'tonnes' },
    { name: 'order_count', label: 'Orders', aggregate: 'count' },
  ],
};

const PLAN_METRICS = {
  name: 'ld_plan_metrics',
  label: 'Plan metrics',
  object: 'ld_plan',
  include: ['cb_order'],
  dimensions: [
    // B — a base-field lookup to an object titled by its `nameField`.
    { name: 'order', label: 'Order', field: 'cb_order', type: 'lookup' },
    // A again — the card's "Margin by Grade" path.
    { name: 'grade', label: 'Grade', field: 'cb_order.carbon_grade', type: 'lookup' },
  ],
  measures: [{ name: 'plan_margin', label: 'Margin', aggregate: 'sum', field: 'margin' }],
};
const SAVED = [ORDER_METRICS, PLAN_METRICS];

const CALLER = { userId: 'u_admin', tenantId: 't1' } as ExecutionContext;

/** A security service that admits every read: this file is about labels. */
const security = {
  getReadFilter: async () => undefined,
  canReadObject: async () => true,
  getReadableFields: async (object: string) =>
    ['id', ...Object.keys(OBJECTS.find((o) => o.name === object)?.fields ?? {})],
  getQueryableFields: async (object: string) =>
    ['id', ...Object.keys(OBJECTS.find((o) => o.name === object)?.fields ?? {})],
};

function mockServer() {
  return {
    get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
    use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
  };
}
function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
  res.json = vi.fn((b: any) => { res.body = b; return res; });
  res.end = vi.fn(() => res);
  return res;
}

let engine: ObjectQL;
let service: AnalyticsService;
let restRoute: any;

type Rows = Record<string, unknown>[];

const faces: Record<string, (datasetName: string, selection: Record<string, unknown>) => Promise<Rows>> = {
  rest: async (datasetName, selection) => {
    const res = mockRes();
    await restRoute.handler({ method: 'POST', params: {}, headers: {}, query: {}, body: { datasetName, selection } }, res);
    expect(res.statusCode, JSON.stringify(res.body)).toBeLessThan(400);
    return res.body.rows;
  },
  queryDatasetTool: async (datasetName, selection) => {
    const tools = service.datasetTools({ loadDatasets: async () => SAVED });
    const out = await tools.execute({ toolName: 'query_dataset', input: { datasetName, selection } }, CALLER);
    return (out as { rows: Rows }).rows;
  },
  direct: async (datasetName, selection) => {
    const dataset = DatasetSchema.parse(SAVED.find((d) => d.name === datasetName));
    return (await service.queryDataset(dataset as never, selection as never, CALLER)).rows;
  },
};

/** Rows as sorted `[k, v]` lists, so face answers compare without caring about row order. */
const byKey = (rows: Rows) =>
  rows.map((r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]))).sort();

/** Every face's rows for one selection, asserted equal; the shared answer is returned. */
async function served(datasetName: string, selection: Record<string, unknown>): Promise<Rows> {
  const answers: Record<string, Rows> = {};
  for (const [face, run] of Object.entries(faces)) answers[face] = await run(datasetName, selection);
  for (const [face, rows] of Object.entries(answers)) expect(byKey(rows), face).toEqual(byKey(answers.direct));
  return answers.direct;
}

beforeAll(async () => {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  for (const object of OBJECTS) engine.registry.registerObject(object as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine as any);
  for (const [object, rows] of Object.entries(SEED)) {
    for (const row of rows) await driver.create(object, { ...row, organization_id: DEFAULT_ORGANIZATION_ID });
  }

  const registered: Record<string, unknown> = {};
  const ctx = {
    getService: (name: string) => {
      if (name === 'security') return security;
      if (name === 'data') return engine;
      return registered[name];
    },
    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };
  await new AnalyticsServicePlugin().init(ctx as never);
  service = registered.analytics as AnalyticsService;

  const protocol = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItem: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
      type: 'dataset', name, item: SAVED.map((d) => ({ ...d })).find((d) => d.name === name),
    })),
  };
  const rest = new RestServer(
    mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => service,
  );
  (rest as any).resolveExecCtx = async () => CALLER;
  rest.registerRoutes();
  restRoute = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'));
  expect(restRoute).toBeDefined();
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

describe('A — a relationship-path lookup dimension serves the hop target\'s name', () => {
  it('labels `account.owner_id` with the rep\'s name on every face, still grouped by rep id', async () => {
    const rows = await served(ORDER_METRICS.name, { dimensions: ['rep'], measures: ['order_tonnes', 'order_count'] });
    // Two reps named "Sam Lee" stay two rows: the grid groups by the stored id
    // and only the rendered value is the name.
    expect(byKey(rows)).toEqual(byKey([
      { rep: 'Zed Young', order_tonnes: 10, order_count: 1 },
      { rep: 'Sam Lee', order_tonnes: 20, order_count: 1 },
      { rep: 'Sam Lee', order_tonnes: 5, order_count: 1 },
    ]));
  });

  it('sorts `account.owner_id` by the name the rows render (the sort-key pass reads the hop too)', async () => {
    const all = await served(ORDER_METRICS.name, {
      dimensions: ['rep'], measures: ['order_tonnes'], order: { rep: 'asc' },
    });
    expect(all.map((r) => r.rep)).toEqual(['Sam Lee', 'Sam Lee', 'Zed Young']);
    // …and the window is taken over that order: by id the first row is rep_a.
    const first = await served(ORDER_METRICS.name, {
      dimensions: ['rep'], measures: ['order_tonnes'], order: { rep: 'asc' }, limit: 1,
    });
    expect(first.map((r) => r.rep)).toEqual(['Sam Lee']);
  });

  it('labels the card\'s second path shape, `cb_order.carbon_grade`, with the grade name', async () => {
    const rows = await served(PLAN_METRICS.name, { dimensions: ['grade'], measures: ['plan_margin'] });
    expect(byKey(rows)).toEqual(byKey([
      { grade: 'N330', plan_margin: 1.5 },
      { grade: 'N550', plan_margin: 3.5 },
    ]));
  });

  it('still renders the id when the path\'s label target is not served by the API exposure decision', async () => {
    const rows = await served(ORDER_METRICS.name, { dimensions: ['region'], measures: ['order_count'] });
    expect(rows).toEqual([{ region: 'reg_e', order_count: 3 }]);
  });
});

describe('B — a lookup to an object titled by its nameField serves that field', () => {
  it('labels `cb_order` with the order number, not the id, on every face', async () => {
    const rows = await served(PLAN_METRICS.name, { dimensions: ['order'], measures: ['plan_margin'] });
    expect(byKey(rows)).toEqual(byKey([
      { order: 'SO-2026-0001', plan_margin: 1.5 },
      { order: 'SO-2026-0002', plan_margin: 3.5 },
    ]));
  });
});

describe('CONTROL — a lookup to an object with a `name` field labels as it did', () => {
  it('labels `account` with the account name', async () => {
    const rows = await served(ORDER_METRICS.name, { dimensions: ['customer'], measures: ['order_count'] });
    expect(byKey(rows)).toEqual(byKey([
      { customer: 'Acme', order_count: 1 },
      { customer: 'Globex', order_count: 1 },
      { customer: 'Initech', order_count: 1 },
    ]));
  });
});
