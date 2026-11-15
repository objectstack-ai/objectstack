// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33138] A dataset over a relationship field whose name is a SQL keyword
 * (`order`, `group`, `select`) answers rows, not `500 DATABASE_ERROR`.
 *
 * The native SQL compiler wrote a base-table column bare when the statement
 * joined nothing, so a lookup dimension on a field named `order` reached
 * SQLite as the keyword (`near "order": syntax error`). It now writes every
 * plain column quoted, as it already did when the statement joins.
 *
 * Driven end to end: a real `ObjectQL` engine over SQLite, the analytics
 * service the plugin registers, the REST door (`POST /analytics/dataset/query`
 * with `datasetName`) and the `query_dataset` tool executor. `user` (not a
 * keyword to SQLite, `CURRENT_USER` to Postgres) and `cb_order` are CONTROLs
 * that answered before.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';


const WORDS = ['order', 'user', 'group', 'select', 'cb_order'];
const OBJECTS = [
  { name: 'rw_target', label: 'Target', fields: { name: { name: 'name', type: 'text' }, region: { name: 'region', type: 'text' } } },
  {
    name: 'rw_line', label: 'Line',
    fields: Object.fromEntries([
      ...WORDS.map((w) => [w, { name: w, type: 'lookup', reference: 'rw_target' }]),
      ['amount', { name: 'amount', type: 'number' }],
    ]),
  },
];
const SEED: Record<string, Record<string, unknown>[]> = {
  rw_target: [{ id: 't_1', name: 'One', region: 'East' }, { id: 't_2', name: 'Two', region: 'West' }],
  rw_line: [
    { id: 'l_1', ...Object.fromEntries(WORDS.map((w) => [w, 't_1'])), amount: 1 },
    { id: 'l_2', ...Object.fromEntries(WORDS.map((w) => [w, 't_2'])), amount: 2 },
    { id: 'l_3', ...Object.fromEntries(WORDS.map((w) => [w, 't_2'])), amount: 4 },
  ],
};
const SAVED = WORDS.map((w) => ({
  name: `rw_${w}_metrics`, label: w, object: 'rw_line', include: [w],
  dimensions: [
    { name: 'base', label: 'Base', field: w, type: 'lookup' },
    { name: 'hop', label: 'Hop', field: `${w}.region`, type: 'string' },
  ],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
}));
const CALLER = { userId: 'u_admin', tenantId: 't1' } as ExecutionContext;
const security = {
  getReadFilter: async () => undefined,
  canReadObject: async () => true,
  getReadableFields: async (object: string) => ['id', ...Object.keys(OBJECTS.find((o) => o.name === object)?.fields ?? {})],
  getQueryableFields: async (object: string) => ['id', ...Object.keys(OBJECTS.find((o) => o.name === object)?.fields ?? {})],
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


const EXPECTED: Record<string, Rows> = {
  base: [{ base: 'One', total: 1 }, { base: 'Two', total: 6 }],
  hop: [{ hop: 'East', total: 1 }, { hop: 'West', total: 6 }],
};

describe('[#33138] a relationship field named after a SQL keyword', () => {
  for (const word of WORDS) {
    const control = word === 'user' || word === 'cb_order' ? 'CONTROL ' : '';
    for (const dim of ['base', 'hop'] as const) {
      it(`${control}\`${word}\` as a ${dim === 'base' ? 'lookup dimension' : 'relationship path'}: rows on the REST door and the query_dataset tool`, async () => {
        const datasetName = `rw_${word}_metrics`;
        const selection = { dimensions: [dim], measures: ['total'] };
        for (const [face, run] of Object.entries(faces)) {
          expect(byKey(await run(datasetName, selection)), face).toEqual(byKey(EXPECTED[dim]));
        }
      });
    }
  }
});
