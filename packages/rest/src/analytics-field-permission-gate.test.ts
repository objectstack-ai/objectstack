// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20917] Every member an analytics query names is judged against the
 * caller's field-level read permissions BEFORE either strategy runs, and a
 * member the caller may not read answers the engine's own refusal:
 * `403 PERMISSION_DENIED`, in the engine's words, whichever strategy would have
 * served the cube and on every analytics face — the cube read
 * (`AnalyticsService.query`, what `POST /api/v1/analytics/query` relays), the
 * SQL echo (`AnalyticsService.generateSql`, what `POST /api/v1/analytics/sql`
 * relays) and the dataset door (`POST /api/v1/analytics/dataset/query`, through
 * this package's own route).
 *
 * The composition is the shipped one, with the REAL security layer:
 * `SecurityPlugin` over a real `ObjectQL` on a real `SqlDriver` (SQLite), and
 * `AnalyticsServicePlugin` over the same engine as its `'data'` service, with no
 * field-permission hook of its own — the plugin reaches the `security`
 * service's reader itself. Two compositions, one per strategy:
 *
 * - `native` — the plugin's own capabilities, so `NativeSQLStrategy` is the
 *   strategy the service asks first (a SQL driver serves raw statements);
 * - `objectql` — the capabilities narrowed to the engine-aggregate path, so
 *   `ObjectQLStrategy` answers every query.
 *
 * The reference for every refusal is the engine's answer for the same field,
 * computed in the same test as the same caller: `engine.aggregate` grouping by
 * the field for a member the query groups or aggregates, `engine.find`
 * filtering on it for a member the query constrains. Code, status and message
 * must all equal it.
 *
 * Both cube kinds are covered: the object's INFERRED cube (the ad-hoc read) and
 * an AUTHORED cube whose members are aliases over the fields, where the gate
 * judges the field a member resolves to rather than the alias.
 *
 * SQLite only. The gate asks its question before a strategy is selected, so no
 * statement is compiled and no driver is reached for a refused query — the
 * dialect cannot enter into the verdict.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_an_fls_ledger';
const OWNER = 'rest_an_fls_owner';
const AUTHORED = 'rest_an_fls_authored';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

/** The member's grants: every object readable, four fields not. */
const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  fields: {
    [`${OBJECT}.hidden_text`]: { readable: false, editable: false },
    [`${OBJECT}.hidden_number`]: { readable: false, editable: false },
    [`${OBJECT}.hidden_at`]: { readable: false, editable: false },
    [`${OWNER}.hidden_text`]: { readable: false, editable: false },
  },
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const OWNERS = [
  { id: 'u1', region: 'r1', hidden_text: 'h1' },
  { id: 'u2', region: 'r2', hidden_text: 'h2' },
];
const ROWS = [
  { id: 'd1', title: 't1', hidden_text: 'x1', hidden_number: 1, hidden_at: '2026-01-05T00:00:00.000Z', owner: 'u1', [OWNER]: 'u1' },
  { id: 'd2', title: 't2', hidden_text: 'x2', hidden_number: 2, hidden_at: '2026-02-05T00:00:00.000Z', owner: 'u2', [OWNER]: 'u2' },
  { id: 'd3', title: 't3', hidden_text: 'x1', hidden_number: 3, hidden_at: '2026-03-05T00:00:00.000Z', owner: 'u1', [OWNER]: 'u1' },
];

/** An authored cube over the ledger: its members are aliases over the fields. */
const AUTHORED_CUBE = {
  name: AUTHORED,
  title: 'Authored ledger',
  sql: OBJECT,
  measures: {
    count: { type: 'count', sql: '*', label: 'Count' },
    alias_total: { type: 'sum', sql: 'hidden_number', label: 'Total' },
  },
  dimensions: {
    title: { type: 'string', sql: 'title', label: 'Title' },
    alias_code: { type: 'string', sql: 'hidden_text', label: 'Code' },
    alias_owner_code: { type: 'string', sql: 'owner.hidden_text', label: 'Owner code' },
    alias_owner_region: { type: 'string', sql: 'owner.region', label: 'Owner region' },
  },
  joins: { owner: { name: OWNER } },
};

/** The inline dataset the dataset door queries. It includes the `owner` relationship. */
const DATASET = {
  name: 'fls_gate_inline',
  label: 'Field gate inline',
  object: OBJECT,
  include: ['owner'],
  dimensions: [
    { name: 'title_dim', field: 'title', type: 'string' },
    { name: 'hidden_dim', field: 'hidden_text', type: 'string' },
    { name: 'owner_hidden_dim', field: 'owner.hidden_text', type: 'string' },
    { name: 'owner_region_dim', field: 'owner.region', type: 'string' },
  ],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'hidden_total', aggregate: 'sum', field: 'hidden_number' },
    { name: 'hidden_filtered_count', aggregate: 'count', filter: { hidden_text: 'x1' } },
  ],
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

interface Harness {
  engine: ObjectQL;
  service: AnalyticsService;
  dataset: (selection: Record<string, unknown>, dataset?: Record<string, unknown>) => Promise<{ status: number; body: any }>;
}

async function boot(strategy: 'native' | 'objectql'): Promise<Harness> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-field-permission-gate-20917',
    name: 'Analytics field permission gate',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OWNER,
        label: 'Owner',
        sharingModel: 'public_read_write',
        fields: { region: { name: 'region', type: 'text' }, hidden_text: { name: 'hidden_text', type: 'text' } },
      },
      {
        name: OBJECT,
        label: 'Ledger',
        sharingModel: 'public_read_write',
        fields: {
          title: { name: 'title', type: 'text' },
          hidden_text: { name: 'hidden_text', type: 'text' },
          hidden_number: { name: 'hidden_number', type: 'number' },
          hidden_at: { name: 'hidden_at', type: 'datetime' },
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
      list: async () => [MEMBER_SET],
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

  const rest = new RestServer(
    createMockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => service,
  );
  (rest as any).resolveExecCtx = async () => MEMBER_CTX;
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
  expect(route).toBeDefined();
  const dataset = async (selection: Record<string, unknown>, definition: Record<string, unknown> = DATASET) => {
    const res = makeRes();
    const body = JSON.parse(JSON.stringify({ dataset: definition, selection }));
    await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
    return { status: res.statusCode, body: res.body };
  };
  return { engine, service, dataset };
}

/** The engine's refusal for a member it GROUPS or AGGREGATES, as the member. */
async function engineAggregateRefusal(engine: ObjectQL, object: string, field: string) {
  return engine
    .aggregate(object, { groupBy: [field], aggregations: [{ function: 'count', alias: 'n' }], context: MEMBER_CTX } as never)
    .then(() => null, (e: Thrown) => refusalOf(e));
}

/** A comparand each hidden field's type admits, so the engine reaches its permission check. */
const COMPARAND: Readonly<Record<string, unknown>> = { hidden_text: 'x1', hidden_number: 1, hidden_at: '2026-01-05T00:00:00.000Z' };

/** The engine's refusal for a member it FILTERS on, as the member. */
async function enginePredicateRefusal(engine: ObjectQL, object: string, field: string) {
  return engine
    .find(object, { where: { [field]: COMPARAND[field] }, context: MEMBER_CTX } as never)
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

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#20917] a member naming a field the caller may not read answers the engine's refusal — ${strategy} composition`, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await boot(strategy);
    }, 60_000);

    afterAll(async () => {
      try { await h?.engine.destroy(); } catch { /* noop */ }
    });

    it('the references: the engine refuses each hidden field as the caller, grouped and filtered', async () => {
      for (const [object, field] of [[OBJECT, 'hidden_text'], [OBJECT, 'hidden_number'], [OBJECT, 'hidden_at'], [OWNER, 'hidden_text']] as const) {
        expect(await engineAggregateRefusal(h.engine, object, field), `${object}.${field} grouped`).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
        expect(await enginePredicateRefusal(h.engine, object, field), `${object}.${field} filtered`).toMatchObject({ code: 'PERMISSION_DENIED', status: 403 });
      }
    });

    it('the cube read and the SQL echo refuse a grouped, aggregated, filtered or joined hidden member of the inferred cube', async () => {
      const cases: ReadonlyArray<readonly [string, Record<string, unknown>, 'aggregate' | 'predicate', string, string]> = [
        ['a grouped member', { measures: ['count'], dimensions: ['hidden_text'] }, 'aggregate', OBJECT, 'hidden_text'],
        ['an aggregated member', { measures: ['hidden_number_sum'] }, 'aggregate', OBJECT, 'hidden_number'],
        ['a bucketed time dimension', { measures: ['count'], dimensions: ['hidden_at'], timeDimensions: [{ dimension: 'hidden_at', granularity: 'month' }] }, 'aggregate', OBJECT, 'hidden_at'],
        ['a filtered member', { measures: ['count'], where: { hidden_text: 'x1' } }, 'predicate', OBJECT, 'hidden_text'],
        ['a filtered member under $or', { measures: ['count'], where: { $or: [{ title: 't2' }, { hidden_text: 'x1' }] } }, 'predicate', OBJECT, 'hidden_text'],
        ['a time dimension\'s window', { measures: ['count'], timeDimensions: [{ dimension: 'hidden_at', dateRange: ['2026-01-01', '2026-01-31'] }] }, 'predicate', OBJECT, 'hidden_at'],
        ['an order key', { measures: ['count'], dimensions: ['title'], order: { hidden_text: 'asc' } }, 'predicate', OBJECT, 'hidden_text'],
        ['a joined member, grouped', { measures: ['count'], dimensions: [`${OWNER}.hidden_text`] }, 'aggregate', OWNER, 'hidden_text'],
        ['a joined member, filtered', { measures: ['count'], where: { [`${OWNER}.hidden_text`]: 'h1' } }, 'predicate', OWNER, 'hidden_text'],
      ];
      for (const [label, body, role, object, field] of cases) {
        const reference = role === 'aggregate'
          ? await engineAggregateRefusal(h.engine, object, field)
          : await enginePredicateRefusal(h.engine, object, field);
        const query = { cube: OBJECT, ...body } as never;
        expect(await answerOf(() => h.service.query(query, MEMBER_CTX as never)), `${label}: the cube read`).toEqual({ refused: reference });
        expect(await answerOf(() => h.service.generateSql(query, MEMBER_CTX as never)), `${label}: the SQL echo`).toEqual({ refused: reference });
      }
    });

    it('an authored cube is judged by the field each alias resolves to, joined aliases included', async () => {
      const cases: ReadonlyArray<readonly [string, Record<string, unknown>, 'aggregate' | 'predicate', string, string]> = [
        ['a grouped alias', { measures: ['count'], dimensions: ['alias_code'] }, 'aggregate', OBJECT, 'hidden_text'],
        ['an aggregated alias', { measures: ['alias_total'] }, 'aggregate', OBJECT, 'hidden_number'],
        ['a filtered alias', { measures: ['count'], where: { alias_code: 'x1' } }, 'predicate', OBJECT, 'hidden_text'],
        ['a joined alias, grouped', { measures: ['count'], dimensions: ['alias_owner_code'] }, 'aggregate', OWNER, 'hidden_text'],
        ['a joined alias, filtered', { measures: ['count'], where: { alias_owner_code: 'h1' } }, 'predicate', OWNER, 'hidden_text'],
      ];
      for (const [label, body, role, object, field] of cases) {
        const reference = role === 'aggregate'
          ? await engineAggregateRefusal(h.engine, object, field)
          : await enginePredicateRefusal(h.engine, object, field);
        const query = { cube: AUTHORED, ...body } as never;
        expect(await answerOf(() => h.service.query(query, MEMBER_CTX as never)), `${label}: the cube read`).toEqual({ refused: reference });
        expect(await answerOf(() => h.service.generateSql(query, MEMBER_CTX as never)), `${label}: the SQL echo`).toEqual({ refused: reference });
      }
    });

    it('the dataset door refuses a hidden member in every position it carries one — never rows beside the refusal', async () => {
      const cases: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown> | undefined, 'aggregate' | 'predicate', string, string]> = [
        ['a grouped member', { measures: ['row_count'], dimensions: ['hidden_dim'] }, undefined, 'aggregate', OBJECT, 'hidden_text'],
        ['an aggregated member', { measures: ['hidden_total'], dimensions: ['title_dim'] }, undefined, 'aggregate', OBJECT, 'hidden_number'],
        ['a joined member, grouped', { measures: ['row_count'], dimensions: ['owner_hidden_dim'] }, undefined, 'aggregate', OWNER, 'hidden_text'],
        ['a filtered member', { measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter: { hidden_text: 'x1' } }, undefined, 'predicate', OBJECT, 'hidden_text'],
        ['a joined member, filtered', { measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter: { 'owner.hidden_text': 'h1' } }, undefined, 'predicate', OWNER, 'hidden_text'],
        ['a measure\'s own filter', { measures: ['hidden_filtered_count'], dimensions: ['title_dim'] }, undefined, 'predicate', OBJECT, 'hidden_text'],
        ['the dataset\'s own filter', { measures: ['row_count'], dimensions: ['title_dim'] }, { ...DATASET, filter: { hidden_text: 'x1' } }, 'predicate', OBJECT, 'hidden_text'],
      ];
      for (const [label, selection, definition, role, object, field] of cases) {
        const reference = role === 'aggregate'
          ? await engineAggregateRefusal(h.engine, object, field)
          : await enginePredicateRefusal(h.engine, object, field);
        const ds = await h.dataset(selection, definition);
        expect({ status: ds.status, code: ds.body?.code, message: ds.body?.message }, `${label}: the dataset door`).toEqual(reference);
        expect(ds.body?.rows, `${label}: no rows beside the refusal`).toBeUndefined();
      }
    });

    it('the control: members the caller may read answer as before, joined members included', async () => {
      const cube = await h.service.query(
        { cube: OBJECT, measures: ['count'], dimensions: ['title'], where: { title: { $in: ['t1', 't3'] } } } as never,
        MEMBER_CTX as never,
      );
      expect(sortRows(cube.rows)).toEqual(sortRows([{ title: 't1', count: 1 }, { title: 't3', count: 1 }]));

      const joined = await h.service.query({ cube: OBJECT, measures: ['count'], dimensions: [`${OWNER}.region`] } as never, MEMBER_CTX as never);
      expect(sortRows(joined.rows)).toEqual(sortRows([{ [`${OWNER}.region`]: 'r1', count: 2 }, { [`${OWNER}.region`]: 'r2', count: 1 }]));

      const authored = await h.service.query({ cube: AUTHORED, measures: ['count'], dimensions: ['alias_owner_region'] } as never, MEMBER_CTX as never);
      expect(sortRows(authored.rows)).toEqual(sortRows([{ alias_owner_region: 'r1', count: 2 }, { alias_owner_region: 'r2', count: 1 }]));

      const ds = await h.dataset({ measures: ['row_count'], dimensions: ['owner_region_dim'], runtimeFilter: { title: { $in: ['t1', 't2'] } } });
      expect(ds.status, JSON.stringify(ds.body)).toBe(200);
      expect(sortRows(ds.body.rows)).toEqual(sortRows([{ owner_region_dim: 'r1', row_count: 1 }, { owner_region_dim: 'r2', row_count: 1 }]));

      const echo = await h.service.generateSql({ cube: OBJECT, measures: ['count'], dimensions: ['title'] } as never, MEMBER_CTX as never);
      expect(typeof echo.sql).toBe('string');
    });

    it('what the refusal withholds: a system caller is answered for the same hidden member', async () => {
      const system = await h.service.query({ cube: OBJECT, measures: ['count'], dimensions: ['hidden_text'] } as never, SYS_CTX as never);
      expect(sortRows(system.rows)).toEqual(sortRows([{ hidden_text: 'x1', count: 2 }, { hidden_text: 'x2', count: 1 }]));
    });
  });
}
