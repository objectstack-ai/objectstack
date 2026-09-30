// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20933] An object an analytics query reads through a RELATIONSHIP PATH is
 * admitted and row-scoped exactly as a declared join to the same object is,
 * on both strategies and on every analytics face: the cube read
 * (`AnalyticsService.query`, what `POST /api/v1/analytics/query` relays), the
 * SQL echo (`AnalyticsService.generateSql`, what `POST /api/v1/analytics/sql`
 * relays) and the dataset door (`POST /api/v1/analytics/dataset/query`, through
 * this package's own route).
 *
 * The reference for every answer is the same question asked through a DECLARED
 * join — an authored cube whose `joins` lists the relationship — by the same
 * caller, on the same strategy, in the same test. A declared join has always
 * been in the object set the door admits and scopes, so "answers what the
 * declared join answers" is the property: a related object the caller may not
 * read is refused, related rows outside the caller's row scope are not read,
 * and a readable related object is answered. Each reference is also checked
 * absolutely, so an equality between two wrong answers cannot pass.
 *
 * The composition is the shipped one, with the REAL security layer:
 * `SecurityPlugin` over a real `ObjectQL` on a real `SqlDriver` (SQLite), and
 * `AnalyticsServicePlugin` over the same engine as its `'data'` service, with no
 * admission or scope hook of its own — the plugin reaches the `security`
 * service itself. Two compositions, one per strategy: `native` (the plugin's
 * own capabilities, so `NativeSQLStrategy` is asked first) and `objectql` (the
 * capabilities narrowed to the engine-aggregate path).
 *
 * Covered: an inferred cube's dimension, filter member and time-dimension
 * window; an authored cube's dimension and measure over a relationship it does
 * not declare, and a path the query names on it; a two-hop path whose first hop
 * resolves by falling back to its alias; the dataset door.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const LEDGER = 'rest_an_rpa_ledger';
/** Reached through a relationship path; the member holds no read grant on it. */
const DENIED = 'rest_an_rpa_denied';
/** Reached through a relationship path; a row-level policy hides some of its rows from the member. */
const SCOPED = 'rest_an_rpa_scoped';
/** Reached through a relationship path; readable — the control. */
const OPEN = 'rest_an_rpa_open';
/** The second hop of the two-hop path. */
const LEAF = 'rest_an_rpa_leaf';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: {
    '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true },
    [DENIED]: { allowRead: false, allowCreate: false, allowEdit: false, allowDelete: false },
  },
  rowLevelSecurity: [{ name: 'scoped_visible_region', object: SCOPED, operation: 'all', using: "record.region != 'r_out'" }],
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const count = { type: 'count', sql: '*', label: 'Count' };

/** The declared-join references: one authored cube per related object, each listing its join. */
const VIA_DENIED = {
  name: 'rest_an_rpa_via_denied',
  title: 'Via denied',
  sql: LEDGER,
  measures: { count, denied_total: { type: 'sum', sql: `${DENIED}.amount`, label: 'Total' } },
  dimensions: {
    denied_label: { type: 'string', sql: `${DENIED}.label`, label: 'Label' },
    denied_seen_at: { type: 'time', sql: `${DENIED}.seen_at`, label: 'Seen' },
  },
  joins: { [DENIED]: { name: DENIED } },
};
const VIA_SCOPED = {
  name: 'rest_an_rpa_via_scoped',
  title: 'Via scoped',
  sql: LEDGER,
  measures: { count },
  dimensions: { scoped_region: { type: 'string', sql: `${SCOPED}.region`, label: 'Region' } },
  joins: { [SCOPED]: { name: SCOPED } },
};
const VIA_OPEN = {
  name: 'rest_an_rpa_via_open',
  title: 'Via open',
  sql: LEDGER,
  measures: { count },
  dimensions: { open_name: { type: 'string', sql: `${OPEN}.name`, label: 'Name' } },
  joins: { [OPEN]: { name: OPEN } },
};
const VIA_TWO_HOPS = {
  name: 'rest_an_rpa_via_two_hops',
  title: 'Via two hops',
  sql: LEDGER,
  measures: { count },
  dimensions: { leaf_label: { type: 'string', sql: `${DENIED}.${LEAF}.label`, label: 'Leaf' } },
  joins: { [DENIED]: { name: DENIED }, [`${DENIED}__${LEAF}`]: { name: LEAF } },
};

/** An authored cube whose members walk relationships it does not declare. */
const PATHS = {
  name: 'rest_an_rpa_paths',
  title: 'Paths',
  sql: LEDGER,
  measures: { count, denied_total: { type: 'sum', sql: `${DENIED}.amount`, label: 'Total' } },
  dimensions: {
    title: { type: 'string', sql: 'title', label: 'Title' },
    denied_label: { type: 'string', sql: `${DENIED}.label`, label: 'Label' },
    scoped_region: { type: 'string', sql: `${SCOPED}.region`, label: 'Region' },
  },
};
/** A two-hop path whose second hop is keyed and whose first falls back to its alias. */
const TWO_HOP = {
  name: 'rest_an_rpa_two_hop',
  title: 'Two hop',
  sql: LEDGER,
  measures: { count },
  dimensions: { leaf_label: { type: 'string', sql: `${DENIED}.${LEAF}.label`, label: 'Leaf' } },
  joins: { [`${DENIED}__${LEAF}`]: { name: LEAF } },
};

const LEAVES = [{ id: 'f1', label: 'f_one' }];
const DENIED_ROWS = [{ id: 'k1', label: 'k_one', amount: 3, seen_at: '2026-01-05T00:00:00.000Z', [LEAF]: 'f1' }];
const SCOPED_ROWS = [{ id: 's1', region: 'r_in' }, { id: 's2', region: 'r_out' }];
const OPEN_ROWS = [{ id: 'o1', name: 'o_one' }];
const LEDGER_ROWS = [
  { id: 'd1', title: 't1', [DENIED]: 'k1', [SCOPED]: 's1', [OPEN]: 'o1' },
  { id: 'd2', title: 't2', [DENIED]: 'k1', [SCOPED]: 's2', [OPEN]: 'o1' },
  { id: 'd3', title: 't3' },
];

/** The dataset door's inline datasets: one declaring the relationship, one not. */
const dataset = (include: string[], dimensions: Array<Record<string, unknown>>) => ({
  name: 'rpa_inline',
  label: 'Relationship path inline',
  object: LEDGER,
  include,
  dimensions: [{ name: 'title_dim', field: 'title', type: 'string' }, ...dimensions],
  measures: [{ name: 'row_count', aggregate: 'count' }],
});

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

interface Harness {
  engine: ObjectQL;
  service: AnalyticsService;
  datasetDoor: (definition: Record<string, unknown>, selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;
}

async function boot(strategy: 'native' | 'objectql'): Promise<Harness> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-relationship-path-admission-20933',
    name: 'Analytics relationship path admission',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      { name: LEAF, label: 'Leaf', sharingModel: 'public_read_write', fields: { label: { name: 'label', type: 'text' } } },
      {
        name: DENIED,
        label: 'Denied',
        sharingModel: 'public_read_write',
        fields: {
          label: { name: 'label', type: 'text' },
          amount: { name: 'amount', type: 'number' },
          seen_at: { name: 'seen_at', type: 'datetime' },
          [LEAF]: { name: LEAF, type: 'lookup', reference: LEAF },
        },
      },
      { name: SCOPED, label: 'Scoped', sharingModel: 'public_read_write', fields: { region: { name: 'region', type: 'text' } } },
      { name: OPEN, label: 'Open', sharingModel: 'public_read_write', fields: { name: { name: 'name', type: 'text' } } },
      {
        name: LEDGER,
        label: 'Ledger',
        sharingModel: 'public_read_write',
        fields: {
          title: { name: 'title', type: 'text' },
          // Each relationship field is named after its target object: the
          // spelling a relationship path joins through (`<field>.<column>`).
          [DENIED]: { name: DENIED, type: 'lookup', reference: DENIED },
          [SCOPED]: { name: SCOPED, type: 'lookup', reference: SCOPED },
          [OPEN]: { name: OPEN, type: 'lookup', reference: OPEN },
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

  await engine.insert(LEAF, LEAVES.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(DENIED, DENIED_ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(SCOPED, SCOPED_ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(OPEN, OPEN_ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);
  await engine.insert(LEDGER, LEDGER_ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

  await new AnalyticsServicePlugin({
    cubes: [VIA_DENIED, VIA_SCOPED, VIA_OPEN, VIA_TWO_HOPS, PATHS, TWO_HOP] as never,
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
  const datasetDoor = async (definition: Record<string, unknown>, selection: Record<string, unknown>) => {
    const res = makeRes();
    const body = JSON.parse(JSON.stringify({ dataset: definition, selection }));
    await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
    return { status: res.statusCode, body: res.body };
  };
  return { engine, service, datasetDoor };
}

type Thrown = { code?: string; status?: number; statusCode?: number; object?: string } | null;

/**
 * What a face answered — its rows with the column names dropped (a path member
 * and the declared member that reads the same column are named differently),
 * or its refusal's envelope and the object it names.
 */
const answerOf = (run: () => Promise<{ rows?: ReadonlyArray<Record<string, unknown>>; sql?: unknown }>) =>
  run().then(
    (r) => ({ answered: r.rows ? [...r.rows].map((row) => JSON.stringify(Object.values(row))).sort() : typeof r.sql }),
    (e: Thrown) => ({ refused: { code: e?.code, status: e?.status ?? e?.statusCode, object: e?.object } }),
  );

/** One question asked through a relationship path, and the same question through a declared join. */
type Case = readonly [label: string, path: Record<string, unknown>, declared: Record<string, unknown>];

const DENIED_CASES: readonly Case[] = [
  ['an inferred cube\'s dimension', { cube: LEDGER, measures: ['count'], dimensions: [`${DENIED}.label`] }, { cube: VIA_DENIED.name, measures: ['count'], dimensions: ['denied_label'] }],
  ['an inferred cube\'s filter member', { cube: LEDGER, measures: ['count'], where: { [`${DENIED}.label`]: 'k_one' } }, { cube: VIA_DENIED.name, measures: ['count'], where: { denied_label: 'k_one' } }],
  [
    'an inferred cube\'s time-dimension window',
    { cube: LEDGER, measures: ['count'], timeDimensions: [{ dimension: `${DENIED}.seen_at`, dateRange: ['2026-01-01', '2026-01-31'] }] },
    { cube: VIA_DENIED.name, measures: ['count'], timeDimensions: [{ dimension: 'denied_seen_at', dateRange: ['2026-01-01', '2026-01-31'] }] },
  ],
  ['an authored dimension over an undeclared relationship', { cube: PATHS.name, measures: ['count'], dimensions: ['denied_label'] }, { cube: VIA_DENIED.name, measures: ['count'], dimensions: ['denied_label'] }],
  ['an authored measure over an undeclared relationship', { cube: PATHS.name, measures: ['denied_total'] }, { cube: VIA_DENIED.name, measures: ['denied_total'] }],
  ['a path the query names on an authored cube', { cube: PATHS.name, measures: ['count'], dimensions: [`${DENIED}.label`] }, { cube: VIA_DENIED.name, measures: ['count'], dimensions: ['denied_label'] }],
  ['a two-hop path whose first hop falls back to its alias', { cube: TWO_HOP.name, measures: ['count'], dimensions: ['leaf_label'] }, { cube: VIA_TWO_HOPS.name, measures: ['count'], dimensions: ['leaf_label'] }],
];

const SCOPED_CASES: readonly Case[] = [
  ['an inferred cube\'s dimension', { cube: LEDGER, measures: ['count'], dimensions: [`${SCOPED}.region`] }, { cube: VIA_SCOPED.name, measures: ['count'], dimensions: ['scoped_region'] }],
  ['an inferred cube\'s filter member', { cube: LEDGER, measures: ['count'], where: { [`${SCOPED}.region`]: 'r_out' } }, { cube: VIA_SCOPED.name, measures: ['count'], where: { scoped_region: 'r_out' } }],
  ['an authored dimension over an undeclared relationship', { cube: PATHS.name, measures: ['count'], dimensions: ['scoped_region'] }, { cube: VIA_SCOPED.name, measures: ['count'], dimensions: ['scoped_region'] }],
];

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#20933] an object read through a relationship path is admitted and scoped as a declared join is — ${strategy} composition`, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await boot(strategy);
    }, 60_000);

    afterAll(async () => {
      try { await h?.engine.destroy(); } catch { /* noop */ }
    });

    it('the fixture: a system caller reads the denied object and the related rows outside the member\'s scope', async () => {
      const denied = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], dimensions: [`${DENIED}.label`] } as never, SYS_CTX as never));
      expect(JSON.stringify(denied)).toContain('k_one');
      const scoped = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], dimensions: [`${SCOPED}.region`] } as never, SYS_CTX as never));
      expect(JSON.stringify(scoped)).toContain('r_out');
    });

    it.each(DENIED_CASES)('%s: a related object without a read grant is refused, as through a declared join', async (_label, path, declared) => {
      const reference = await answerOf(() => h.service.query(declared as never, MEMBER_CTX as never));
      expect(reference).toEqual({ refused: { code: 'PERMISSION_DENIED', status: 403, object: DENIED } });
      expect(await answerOf(() => h.service.query(path as never, MEMBER_CTX as never)), 'the cube read').toEqual(reference);
      expect(await answerOf(() => h.service.generateSql(path as never, MEMBER_CTX as never)), 'the SQL echo').toEqual(reference);
    });

    it.each(SCOPED_CASES)('%s: related rows outside the caller\'s scope are not read, as through a declared join', async (_label, path, declared) => {
      const reference = await answerOf(() => h.service.query(declared as never, MEMBER_CTX as never));
      expect(JSON.stringify(reference)).not.toContain('r_out');
      const answer = await answerOf(() => h.service.query(path as never, MEMBER_CTX as never));
      expect(answer).toEqual(reference);
      expect(JSON.stringify(answer)).not.toContain('r_out');
    });

    it('a filter on a related value outside the caller\'s scope does not count the row that holds it', async () => {
      const system = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], where: { [`${SCOPED}.region`]: 'r_out' } } as never, SYS_CTX as never));
      const member = await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], where: { [`${SCOPED}.region`]: 'r_out' } } as never, MEMBER_CTX as never));
      expect(member).not.toEqual({ answered: [JSON.stringify([1])] });
      // A strategy that serves the filter at all counts the row for a caller the policy does not hide it from.
      if (strategy === 'native') expect(system).toEqual({ answered: [JSON.stringify([1])] });
    });

    it('the control: a readable related object is answered, as through a declared join', async () => {
      const reference = await answerOf(() => h.service.query({ cube: VIA_OPEN.name, measures: ['count'], dimensions: ['open_name'] } as never, MEMBER_CTX as never));
      expect(JSON.stringify(reference)).toContain('o_one');
      expect(await answerOf(() => h.service.query({ cube: LEDGER, measures: ['count'], dimensions: [`${OPEN}.name`] } as never, MEMBER_CTX as never))).toEqual(reference);
      expect(await answerOf(() => h.service.generateSql({ cube: LEDGER, measures: ['count'], dimensions: [`${OPEN}.name`] } as never, MEMBER_CTX as never))).toEqual({ answered: 'string' });
    });

    it('the dataset door refuses a related object without a read grant, named through a relationship the dataset does not declare, as a declared one', async () => {
      const reference = await h.datasetDoor(
        dataset([DENIED], [{ name: 'denied_dim', field: `${DENIED}.label`, type: 'string' }]),
        { measures: ['row_count'], dimensions: ['denied_dim'] },
      );
      expect({ status: reference.status, code: reference.body?.code }).toEqual({ status: 403, code: 'PERMISSION_DENIED' });
      const answer = await h.datasetDoor(
        dataset([OPEN], [{ name: 'open_dim', field: `${OPEN}.name`, type: 'string' }]),
        { measures: ['row_count'], dimensions: [`${DENIED}.label`] },
      );
      expect({ status: answer.status, code: answer.body?.code, message: answer.body?.message }).toEqual({
        status: reference.status,
        code: reference.body?.code,
        message: reference.body?.message,
      });
      expect(answer.body?.rows).toBeUndefined();
    });
  });
}
