// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0149 D4] Four-face parity for a saved dataset: the REST door
 * (`POST /analytics/dataset/query` with `datasetName`), the chat tool
 * (`query_dataset` through the tools' `execute`, the registry face the product
 * AI delegates to), the MCP tool, and the direct service call
 * (`AnalyticsService.queryDataset`) return the SAME rows for the same caller,
 * and refuse the same callers.
 *
 * The MCP face is `@objectstack/mcp`'s bridge member over the same executor;
 * it lands with its own registration (the bridge members and
 * `registerDatasetTools`), which adds its row to this file. The three faces
 * here are the ones this package's executor serves.
 *
 * ## The rig
 *
 * A real `ObjectQL` engine over SQLite holds the rows. The analytics service
 * is the one `AnalyticsServicePlugin` registers — its admission hooks bridged
 * to a `security` double whose read filter folds, for one caller, a tenant
 * predicate, an owner (RLS) predicate and a sharing grant into one condition,
 * the shape plugin-security's read filter composes. So a row hidden by the
 * tenant, by RLS or by the sharing rule's absence, a field the caller may not
 * read and an object the caller may not read are each judged by the real
 * service, through each face.
 *
 * What the faces may differ on, by contract: an object the caller may not
 * read is `NOT_FOUND` / 404 on the tool (one answer for missing and hidden,
 * ADR-0149 D2) and `PERMISSION_DENIED` / 403 on the REST door and the direct
 * call. Each refuses; none serves a row.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { DatasetSchema } from '@objectstack/spec/ui';
import { RestServer } from './rest-server';
import { DEFAULT_ORGANIZATION_ID, installDefaultOrganization } from './default-organization.testkit.js';

const OBJECT = 'ai_parity_deal';
const LOCKED_OBJECT = 'ai_parity_locked';

const FIELDS = {
  tenant: { name: 'tenant', type: 'text' as const },
  owner: { name: 'owner', type: 'text' as const },
  stage: { name: 'stage', type: 'text' as const },
  amount: { name: 'amount', type: 'number' as const },
  margin: { name: 'margin', type: 'number' as const },
};

const ROWS = [
  { id: 'd1', tenant: 't1', owner: 'u_me', stage: 'won', amount: 100, margin: 10 },
  { id: 'd2', tenant: 't1', owner: 'u_me', stage: 'open', amount: 40, margin: 4 },
  { id: 'd3', tenant: 't1', owner: 'u_peer', stage: 'won', amount: 500, margin: 50 },
  { id: 'd_shared', tenant: 't1', owner: 'u_peer', stage: 'open', amount: 7, margin: 1 },
  { id: 'd5', tenant: 't2', owner: 'u_me', stage: 'won', amount: 9000, margin: 900 },
  { id: 'd6', tenant: 't2', owner: 'u_far', stage: 'lost', amount: 30, margin: 3 },
];

const DATASET = {
  name: 'deal_metrics',
  label: 'Deal metrics',
  object: OBJECT,
  dimensions: [
    { name: 'owner', label: 'Owner', field: 'owner', type: 'string' },
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string' },
  ],
  measures: [
    { name: 'revenue', label: 'Revenue', aggregate: 'sum', field: 'amount', synonyms: ['营收'] },
    { name: 'deal_count', label: 'Deals', aggregate: 'count' },
    { name: 'margin_total', label: 'Margin', aggregate: 'sum', field: 'margin' },
  ],
};
const LOCKED_DATASET = {
  name: 'locked_metrics',
  label: 'Locked',
  object: LOCKED_OBJECT,
  dimensions: [],
  measures: [{ name: 'total', label: 'Total', aggregate: 'sum', field: 'amount' }],
};
const SAVED = [DATASET, LOCKED_DATASET];

const callers: Record<string, ExecutionContext> = {
  // Tenant t1, RLS to own rows, plus one row shared to them.
  u_me: { userId: 'u_me', tenantId: 't1' } as ExecutionContext,
  // Tenant t1, every row of it.
  u_admin: { userId: 'u_admin', tenantId: 't1' } as ExecutionContext,
  // Tenant t2 only.
  u_far: { userId: 'u_far', tenantId: 't2' } as ExecutionContext,
};

/** The read filter plugin-security would compose: tenant ∧ (RLS ∨ sharing). */
function readFilterFor(ctx?: ExecutionContext): Record<string, unknown> | undefined {
  const tenant = { tenant: ctx?.tenantId ?? '__none__' };
  if (ctx?.userId === 'u_me') {
    return { $and: [tenant, { $or: [{ owner: 'u_me' }, { id: { $in: ['d_shared'] } }] }] };
  }
  return tenant;
}

const security = {
  getReadFilter: async (_object: string, ctx?: ExecutionContext) => readFilterFor(ctx),
  canReadObject: async (object: string, ctx?: ExecutionContext) => !(object === LOCKED_OBJECT && ctx?.userId === 'u_me'),
  getReadableFields: async (object: string, ctx?: ExecutionContext) =>
    Object.keys(object === OBJECT ? { id: 1, ...FIELDS } : { id: 1, amount: 1 }).filter(
      (f) => !(ctx?.userId === 'u_me' && f === 'margin'),
    ),
  getQueryableFields: async (object: string, ctx?: ExecutionContext) =>
    Object.keys(object === OBJECT ? { id: 1, ...FIELDS } : { id: 1, amount: 1 }).filter(
      (f) => !(ctx?.userId === 'u_me' && f === 'margin'),
    ),
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

type FaceAnswer = { rows: Record<string, unknown>[] } | { refused: { status: number; code: string } };

let engine: ObjectQL;
let service: AnalyticsService;
let restRoute: any;
let protocol: { getMetaItems: ReturnType<typeof vi.fn> } & Record<string, unknown>;

const byKey = (rows: Record<string, unknown>[]) =>
  [...rows].map((r) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]))).sort();

const refusalOf = (e: any) => ({ status: Number(e?.status), code: String(e?.code) });

const faces: Record<string, (user: string, selection: Record<string, unknown>, datasetName?: string) => Promise<FaceAnswer>> = {
  rest: async (user, selection, datasetName = DATASET.name) => {
    currentUser = user;
    const res = mockRes();
    await restRoute.handler({ method: 'POST', params: {}, headers: {}, query: {}, body: { datasetName, selection } }, res);
    if (res.statusCode >= 400) {
      return { refused: { status: res.statusCode, code: String(res.body?.code ?? res.body?.error?.code) } };
    }
    return { rows: res.body.rows };
  },
  chatTool: async (user, selection, datasetName = DATASET.name) => {
    const tools = service.datasetTools({ loadDatasets: async () => SAVED });
    try {
      const out = await tools.execute({ toolName: 'query_dataset', input: { datasetName, selection } }, callers[user]);
      return { rows: (out as { rows: Record<string, unknown>[] }).rows };
    } catch (e) {
      return { refused: refusalOf(e) };
    }
  },
  direct: async (user, selection, datasetName = DATASET.name) => {
    const dataset = DatasetSchema.parse(SAVED.find((d) => d.name === datasetName));
    try {
      const out = await service.queryDataset(dataset as never, selection as never, callers[user]);
      return { rows: out.rows };
    } catch (e) {
      return { refused: refusalOf(e) };
    }
  },
};
let currentUser = 'u_me';

beforeAll(async () => {
  const driver: any = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
  engine = new ObjectQL();
  engine.registerDriver(driver, true);
  await engine.init();
  engine.registry.registerObject({ name: OBJECT, label: 'Deal', fields: FIELDS } as any);
  engine.registry.registerObject({ name: LOCKED_OBJECT, label: 'Locked', fields: { amount: FIELDS.amount } } as any);
  await engine.syncSchemas();
  await installDefaultOrganization(engine as any);
  // Seeded through the driver: data at rest. The engine's own organization
  // column is the platform's; this file's tenant is the read filter's `tenant`.
  for (const row of ROWS) await driver.create(OBJECT, { ...row, organization_id: DEFAULT_ORGANIZATION_ID });
  await driver.create(LOCKED_OBJECT, { id: 'l1', amount: 1, organization_id: DEFAULT_ORGANIZATION_ID });

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

  protocol = {
    getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: vi.fn().mockResolvedValue([]),
    getMetaItems: vi.fn().mockImplementation(async () => SAVED.map((d) => ({ ...d }))),
  };
  const rest = new RestServer(
    mockServer() as any, protocol as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => service,
  );
  (rest as any).resolveExecCtx = async () => callers[currentUser];
  rest.registerRoutes();
  restRoute = rest.getRoutes().find((r) => r.method === 'POST' && r.path.endsWith('/analytics/dataset/query'));
  expect(restRoute).toBeDefined();
});

afterAll(async () => {
  try { await engine?.destroy(); } catch { /* noop */ }
});

/** Every face's answer for one caller and selection. */
async function allFaces(user: string, selection: Record<string, unknown>, datasetName?: string) {
  const out: Record<string, FaceAnswer> = {};
  for (const [name, face] of Object.entries(faces)) out[name] = await face(user, selection, datasetName);
  return out;
}

describe('[ADR-0149 D4] query_dataset returns the rows the REST door and the service return, for the same caller', () => {
  const selection = { dimensions: ['owner', 'stage'], measures: ['deal_count', 'revenue'] };

  it.each([
    // tenant t1 ∧ (own rows ∨ the shared one): d1, d2, d_shared.
    ['u_me', [['u_me', 'open', 1, 40], ['u_me', 'won', 1, 100], ['u_peer', 'open', 1, 7]]],
    // tenant t1, every row.
    ['u_admin', [['u_me', 'open', 1, 40], ['u_me', 'won', 1, 100], ['u_peer', 'open', 1, 7], ['u_peer', 'won', 1, 500]]],
    // tenant t2 only — u_me's t2 row is not u_me's to see from t1, and is u_far's tenant's.
    ['u_far', [['u_far', 'lost', 1, 30], ['u_me', 'won', 1, 9000]]],
  ] as const)('%s — tenant, RLS and sharing hide the same rows on every face', async (user, expected) => {
    const answers = await allFaces(user, selection);
    const want = byKey(expected.map(([owner, stage, deal_count, revenue]) => ({ owner, stage, deal_count, revenue })));
    for (const [face, answer] of Object.entries(answers)) {
      expect('rows' in answer, `${face} served`).toBe(true);
      expect(byKey((answer as { rows: Record<string, unknown>[] }).rows), face).toEqual(want);
    }
  });

  it('a field the caller may not read is refused on every face, with the same envelope', async () => {
    const answers = await allFaces('u_me', { measures: ['margin_total'] });
    for (const [face, answer] of Object.entries(answers)) {
      expect(answer, face).toEqual({ refused: { status: 403, code: 'PERMISSION_DENIED' } });
    }
    // …and the same member is served to a caller who may read the field.
    const admitted = await allFaces('u_admin', { measures: ['margin_total'] });
    for (const answer of Object.values(admitted)) {
      expect(byKey((answer as { rows: Record<string, unknown>[] }).rows)).toEqual(byKey([{ margin_total: 65 }]));
    }
  });

  it('an object the caller may not read is refused on every face (the tool answers it as absent)', async () => {
    const answers = await allFaces('u_me', { measures: ['total'] }, LOCKED_DATASET.name);
    expect(answers.rest).toEqual({ refused: { status: 403, code: 'PERMISSION_DENIED' } });
    expect(answers.direct).toEqual({ refused: { status: 403, code: 'PERMISSION_DENIED' } });
    expect(answers.chatTool).toEqual({ refused: { status: 404, code: 'NOT_FOUND' } });
  });

  it('list_datasets lists for each caller exactly what query_dataset serves them', async () => {
    const tools = service.datasetTools({ loadDatasets: async () => SAVED });
    const me = await tools.listDatasets({ terms: ['营收'] }, callers.u_me);
    expect(me.datasets.map((d) => d.name)).toEqual(['deal_metrics']);
    expect(me.datasets[0].measures.map((m) => m.name)).toEqual(['revenue', 'deal_count']);
    expect(me.datasets[0].membersWithheld).toBe(true);
    expect(me.datasets[0].matches).toEqual([{ term: '营收', member: 'measures.revenue', matchedOn: 'synonym' }]);

    const admin = await tools.listDatasets({}, callers.u_admin);
    expect(admin.datasets.map((d) => d.name)).toEqual(['deal_metrics', 'locked_metrics']);
    expect(admin.datasets[0].membersWithheld).toBeUndefined();
  });
});

describe('a FAILED saved-dataset read is answered alike by the REST door and query_dataset', () => {
  // A read that threw is a server-side fault, not an absent dataset: neither
  // face may answer it as `404 NOT_FOUND`, and both answer it the same way.
  it('both answer 503 SERVICE_UNAVAILABLE, neither 404', async () => {
    const outage = new Error('the metadata store is unreachable');
    const selection = { measures: ['revenue'] };

    protocol.getMetaItems.mockRejectedValueOnce(outage);
    const rest = await faces.rest('u_me', selection);

    const tools = service.datasetTools({ loadDatasets: async () => { throw outage; } });
    let chatTool: FaceAnswer | undefined;
    try {
      await tools.execute({ toolName: 'query_dataset', input: { datasetName: DATASET.name, selection } }, callers.u_me);
    } catch (e) {
      chatTool = { refused: refusalOf(e) };
    }

    expect(rest).toEqual({ refused: { status: 503, code: 'SERVICE_UNAVAILABLE' } });
    expect(chatTool).toEqual(rest);
  });
});
