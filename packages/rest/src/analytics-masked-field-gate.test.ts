// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20935] A field the caller is served MASKED is readable and NOT queryable:
 * as a member an analytics query groups or filters by, it answers the engine's
 * own refusal — `403 PERMISSION_DENIED`, in the engine's words — whichever
 * strategy would have served the cube, and before either strategy runs.
 *
 * The field-level gate at the analytics door (`field-read-admission.ts`) asks
 * the `security` service's `getQueryableFields` beside its `getReadableFields`.
 * The read projection alone counts a masked field readable — it is a served
 * column, its value replaced — so a door that judged by it admitted a masked
 * field as a group key or a filter, which the engine refuses.
 *
 * The composition is the shipped one, with the REAL security layer:
 * `SecurityPlugin` over a real `ObjectQL` on a real `SqlDriver` (SQLite), and
 * `AnalyticsServicePlugin` over the same engine as its `'data'` service, with no
 * field-permission hook of its own. Two compositions, one per strategy:
 *
 * - `native` — the plugin's own capabilities, so `NativeSQLStrategy` is the
 *   strategy the service asks first (a SQL driver serves raw statements);
 * - `objectql` — the capabilities narrowed to the engine-aggregate path, so
 *   `ObjectQLStrategy` answers every query.
 *
 * Two callers, one field: the member, for whom each field's masking rule
 * applies, and an unmasker, who holds the capability that lifts it — the same
 * field, queryable for one and not for the other. The reference for every
 * refusal is the engine's answer for the same field, computed in the same test
 * as the same caller: `engine.aggregate` grouping by the field for a grouped
 * member, `engine.find` filtering on it for a filtered one. Code, status and
 * message must all equal it, and neither the engine's aggregate nor its raw
 * statement runs for a refused query: the verdict is the door's.
 *
 * SQLite only, and the fixtures are synthetic. The gate answers before a
 * strategy is selected, so no statement is compiled for a refused query and the
 * dialect cannot enter into the verdict.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_an_mask_ledger';
const OWNER = 'rest_an_mask_owner';
const AUTHORED = 'rest_an_mask_authored';
const CAPABILITY = 'view_masked_codes';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

/** Every authenticated caller's baseline: every object readable, no field rules. */
const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});
/** The capability both masking rules name as their unmask gate. */
const UNMASK_SET = PermissionSetSchema.parse({
  name: 'rest_an_mask_unmasker',
  label: 'Unmasker',
  objects: { '*': { allowRead: true } },
  systemPermissions: [CAPABILITY],
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };
const UNMASKER_CTX = { userId: 'usr_unmasker', positions: [], permissions: [UNMASK_SET.name], posture: 'MEMBER' };

const OWNERS = [
  { id: 'u1', region: 'r1', masked_region: 'north' },
  { id: 'u2', region: 'r2', masked_region: 'south' },
];
const ROWS = [
  { id: 'd1', title: 't1', masked_code: 'AA11', owner: 'u1', [OWNER]: 'u1' },
  { id: 'd2', title: 't2', masked_code: 'BB22', owner: 'u2', [OWNER]: 'u2' },
  { id: 'd3', title: 't3', masked_code: 'AA11', owner: 'u1', [OWNER]: 'u1' },
];

/** An authored cube over the ledger: its members are aliases over the fields. */
const AUTHORED_CUBE = {
  name: AUTHORED,
  title: 'Authored ledger',
  sql: OBJECT,
  measures: { count: { type: 'count', sql: '*', label: 'Count' } },
  dimensions: {
    title: { type: 'string', sql: 'title', label: 'Title' },
    alias_code: { type: 'string', sql: 'masked_code', label: 'Code' },
    alias_owner_region: { type: 'string', sql: 'owner.masked_region', label: 'Owner region' },
  },
  joins: { owner: { name: OWNER } },
};

/** The inline dataset the dataset door queries. */
const DATASET = {
  name: 'mask_gate_inline',
  label: 'Masked field gate inline',
  object: OBJECT,
  include: ['owner'],
  dimensions: [
    { name: 'title_dim', field: 'title', type: 'string' },
    { name: 'code_dim', field: 'masked_code', type: 'string' },
  ],
  measures: [{ name: 'row_count', aggregate: 'count' }],
};

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

function createMockServer() {
  const noop = () => {};
  return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function mockProtocol() {
  return {
    getDiscovery: async () => ({ version: 'v0', routes: { data: '', metadata: '' } }),
    getMetaTypes: async () => [],
    getMetaItems: async () => [],
  };
}

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined as any,
    header: () => res,
    status: (code: number) => { res.statusCode = code; return res; },
    json: (body: unknown) => { res.body = body; return res; },
    end: () => res,
  };
  return res;
}

type Thrown = { code?: string; status?: number; statusCode?: number; message?: string } | null;
/** The three things a caller reads off a refusal. */
const refusalOf = (e: Thrown) => ({ code: e?.code, status: e?.status ?? e?.statusCode, message: String(e?.message) });

type Ctx = typeof MEMBER_CTX;

interface Harness {
  engine: ObjectQL;
  service: AnalyticsService;
  /** How many times the engine's aggregate or its raw statement ran since boot. */
  strategyReads: () => number;
  dataset: (ctx: Ctx, selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;
}

async function boot(strategy: 'native' | 'objectql'): Promise<Harness> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-masked-field-gate-20935',
    name: 'Analytics masked field gate',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OWNER,
        label: 'Owner',
        sharingModel: 'public_read_write',
        fields: {
          region: { name: 'region', type: 'text' },
          masked_region: {
            name: 'masked_region', type: 'text', maskingRule: { keepHead: 1, keepTail: 0 }, requiredPermissions: [CAPABILITY],
          },
        },
      },
      {
        name: OBJECT,
        label: 'Ledger',
        sharingModel: 'public_read_write',
        fields: {
          title: { name: 'title', type: 'text' },
          masked_code: {
            name: 'masked_code', type: 'text', maskingRule: { keepHead: 1, keepTail: 1 }, requiredPermissions: [CAPABILITY],
          },
          owner: { name: 'owner', type: 'lookup', reference: OWNER },
          // The same relationship under a field named after its target object:
          // the spelling an inferred cube joins through (`<field>.<column>`).
          [OWNER]: { name: OWNER, type: 'lookup', reference: OWNER },
        },
      },
    ],
  } as never);
  await engine.syncSchemas();

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    data: engine,
    metadata: {
      get: async (_type: string, name: string) => engine.getSchema(name) ?? null,
      list: async () => [MEMBER_SET, UNMASK_SET],
    },
  };
  const ctx: any = {
    logger: quiet,
    hook: () => {},
    registerService: (name: string, svc: unknown) => { services[name] = svc; },
    replaceService: (name: string, svc: unknown) => { services[name] = svc; },
    getService: (name: string) => {
      if (!(name in services)) throw new Error(`service not registered: ${name}`);
      return services[name];
    },
  };
  const security = new SecurityPlugin({ fallbackPermissionSet: 'member_default' });
  await security.init(ctx);
  await security.start(ctx);
  vi.spyOn((engine as unknown as { logger: { warn: () => void } }).logger, 'warn').mockImplementation(() => undefined);

  await engine.insert(OWNER, OWNERS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(OBJECT, ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

  await new AnalyticsServicePlugin({
    cubes: [AUTHORED_CUBE as never],
    ...(strategy === 'objectql'
      ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
      : {}),
  }).init(ctx);
  const service = services.analytics as AnalyticsService;

  const aggregateSpy = vi.spyOn(engine, 'aggregate');
  const executeSpy = vi.spyOn(engine, 'execute');
  const strategyReads = () => aggregateSpy.mock.calls.length + executeSpy.mock.calls.length;

  const rest = new RestServer(
    createMockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => service,
  );
  let caller: Ctx = MEMBER_CTX;
  (rest as any).resolveExecCtx = async () => caller;
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
  expect(route).toBeDefined();
  const dataset = async (as: Ctx, selection: Record<string, unknown>) => {
    caller = as;
    const res = makeRes();
    const body = JSON.parse(JSON.stringify({ dataset: DATASET, selection }));
    await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
    return { status: res.statusCode, body: res.body };
  };
  return { engine, service, strategyReads, dataset };
}

/** The engine's answer for a member it GROUPS by, as the caller. */
async function engineGrouped(engine: ObjectQL, object: string, field: string, context: Ctx) {
  return engine
    .aggregate(object, { groupBy: [field], aggregations: [{ function: 'count', alias: 'n' }], context } as never)
    .then(() => null, (e: Thrown) => refusalOf(e));
}

/** The engine's answer for a member it FILTERS on, as the caller. */
async function engineFiltered(engine: ObjectQL, object: string, field: string, value: string, context: Ctx) {
  return engine
    .find(object, { where: { [field]: value }, context } as never)
    .then(() => null, (e: Thrown) => refusalOf(e));
}

/** What a face answered: its rows, or its refusal. */
const answerOf = (run: () => Promise<{ rows?: unknown; sql?: unknown }>) =>
  run().then(
    (r) => ({ answered: r }),
    (e: Thrown) => ({ refused: refusalOf(e) }),
  );

const sortRows = (rows: ReadonlyArray<Record<string, unknown>>) =>
  [...rows].map((r) => JSON.stringify(r)).sort();

/** Each masked position: the query, how the engine is asked for the reference, and on what. */
const CASES: ReadonlyArray<readonly [string, Record<string, unknown>, 'grouped' | 'filtered', string, string, string]> = [
  ['a masked field as a group member', { cube: OBJECT, measures: ['count'], dimensions: ['masked_code'] }, 'grouped', OBJECT, 'masked_code', ''],
  ['a masked field as a filter member', { cube: OBJECT, measures: ['count'], where: { masked_code: 'AA11' } }, 'filtered', OBJECT, 'masked_code', 'AA11'],
  ['an authored alias over a masked field as a group member', { cube: AUTHORED, measures: ['count'], dimensions: ['alias_code'] }, 'grouped', OBJECT, 'masked_code', ''],
  ['an authored alias over a masked field as a filter member', { cube: AUTHORED, measures: ['count'], where: { alias_code: 'AA11' } }, 'filtered', OBJECT, 'masked_code', 'AA11'],
  ['a joined masked field as a group member', { cube: OBJECT, measures: ['count'], dimensions: [`${OWNER}.masked_region`] }, 'grouped', OWNER, 'masked_region', ''],
  ['a joined masked field as a filter member', { cube: OBJECT, measures: ['count'], where: { [`${OWNER}.masked_region`]: 'north' } }, 'filtered', OWNER, 'masked_region', 'north'],
];

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#20935] a member naming a field the caller is served masked answers the engine's refusal — ${strategy} composition`, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await boot(strategy);
    }, 60_000);

    afterAll(async () => {
      try { await h?.engine.destroy(); } catch { /* noop */ }
    });

    it('the references: the engine refuses each masked field to the member, grouped and filtered, and serves it to the unmasker', async () => {
      for (const [object, field, value] of [[OBJECT, 'masked_code', 'AA11'], [OWNER, 'masked_region', 'north']] as const) {
        expect(await engineGrouped(h.engine, object, field, MEMBER_CTX), `${object}.${field} grouped, member`).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(await engineFiltered(h.engine, object, field, value, MEMBER_CTX), `${object}.${field} filtered, member`).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(await engineGrouped(h.engine, object, field, UNMASKER_CTX), `${object}.${field} grouped, unmasker`).toBeNull();
        expect(await engineFiltered(h.engine, object, field, value, UNMASKER_CTX), `${object}.${field} filtered, unmasker`).toBeNull();
      }
    });

    it('the cube read and the SQL echo refuse the member a masked field as a group or a filter member, before any strategy ran', async () => {
      for (const [label, body, role, object, field, value] of CASES) {
        const reference = role === 'grouped'
          ? await engineGrouped(h.engine, object, field, MEMBER_CTX)
          : await engineFiltered(h.engine, object, field, value, MEMBER_CTX);
        expect(reference, `${label}: the engine's reference`).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        const query = body as never;
        const before = h.strategyReads();
        expect(await answerOf(() => h.service.query(query, MEMBER_CTX as never)), `${label}: the cube read`).toEqual({ refused: reference });
        expect(await answerOf(() => h.service.generateSql(query, MEMBER_CTX as never)), `${label}: the SQL echo`).toEqual({ refused: reference });
        expect(h.strategyReads() - before, `${label}: no strategy ran`).toBe(0);
      }
    });

    it('the dataset door refuses the member a masked field as a group or a filter member — never rows beside the refusal', async () => {
      const cases: ReadonlyArray<readonly [string, Record<string, unknown>, Thrown]> = [
        ['a group member', { measures: ['row_count'], dimensions: ['code_dim'] }, await engineGrouped(h.engine, OBJECT, 'masked_code', MEMBER_CTX)],
        ['a filter member', { measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter: { masked_code: 'AA11' } }, await engineFiltered(h.engine, OBJECT, 'masked_code', 'AA11', MEMBER_CTX)],
      ];
      for (const [label, selection, reference] of cases) {
        const before = h.strategyReads();
        const ds = await h.dataset(MEMBER_CTX, selection);
        expect({ status: ds.status, code: ds.body?.code, message: ds.body?.message }, `${label}: the dataset door`).toEqual(reference);
        expect(ds.body?.rows, `${label}: no rows beside the refusal`).toBeUndefined();
        expect(h.strategyReads() - before, `${label}: no strategy ran`).toBe(0);
      }
    });

    it('the control: the unmasker is answered for the same members exactly as the system caller is', async () => {
      const normalized = (a: { answered?: { rows?: unknown }; refused?: unknown }) =>
        (a.answered ? { rows: sortRows((a.answered.rows ?? []) as Record<string, unknown>[]) } : a);
      for (const [label, body] of CASES) {
        const query = body as never;
        const unmasker = await answerOf(() => h.service.query(query, UNMASKER_CTX as never));
        const system = await answerOf(() => h.service.query(query, SYS_CTX as never));
        expect(normalized(unmasker), `${label}: the unmasker`).toEqual(normalized(system));
        // The ObjectQL strategy serves no cross-object filter to anyone — the
        // engine cannot join in an aggregate — so that one case is answered by
        // the strategy's own refusal, for the system caller too. Every other
        // case is served rows.
        const joinedFilter = strategy === 'objectql' && label === 'a joined masked field as a filter member';
        if (!joinedFilter) expect((unmasker as { answered?: { rows: unknown[] } }).answered?.rows.length, `${label}: rows`).toBeGreaterThan(0);
      }
      const ds = await h.dataset(UNMASKER_CTX, { measures: ['row_count'], dimensions: ['code_dim'] });
      expect(ds.status, JSON.stringify(ds.body)).toBe(200);
      expect(ds.body.rows.length).toBeGreaterThan(0);
    });

    it('the control: the member is answered for the fields it may query on', async () => {
      const cube = await h.service.query(
        { cube: OBJECT, measures: ['count'], dimensions: ['title'], where: { title: { $in: ['t1', 't3'] } } } as never,
        MEMBER_CTX as never,
      );
      expect(sortRows(cube.rows)).toEqual(sortRows([{ title: 't1', count: 1 }, { title: 't3', count: 1 }]));
      const joined = await h.service.query({ cube: OBJECT, measures: ['count'], dimensions: [`${OWNER}.region`] } as never, MEMBER_CTX as never);
      expect(sortRows(joined.rows)).toEqual(sortRows([{ [`${OWNER}.region`]: 'r1', count: 2 }, { [`${OWNER}.region`]: 'r2', count: 1 }]));
    });
  });
}
