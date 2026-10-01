// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20918] A `$not` over a multi-valued lookup gets the engine's rows on BOTH
 * analytics strategies, at the cube read and at the dataset door.
 *
 * The `where` door makes every leaf of a `$not` operand total before negating
 * it (#5146): `{ $not: { owners: { $contains: 'u1' } } }` is lowered with a
 * `{ owners: { $null: false } }` conjunct beside the `$contains`, so a row
 * whose `owners` holds no value is answered by the negation instead of falling
 * into SQL's UNKNOWN. The engine-aggregate strategy handed that guard to the
 * engine as `{ $ne: null }`, and the negative-polarity escape (#5298) as the
 * bare `{ owners: null }`. `driver-sql` refuses both over a multi-valued
 * lookup's JSON column, so the engine-aggregate path answered
 * `400 INVALID_FILTER` where the engine and the native strategy answer rows.
 * The guard now reaches the engine as `{ $null: false }` / `{ $null: true }`,
 * the spellings the engine's own lowering emits for the same guard.
 *
 * The composition is the shipped one: `SecurityPlugin` over a real `ObjectQL`
 * on a real `SqlDriver` (SQLite), and `AnalyticsServicePlugin` over the same
 * engine as its `'data'` service. Two compositions, one per strategy:
 *
 * - `native` — the plugin's own capabilities, so `NativeSQLStrategy` answers
 *   (it compiles its own SQL, and its answers are unchanged by this fix);
 * - `objectql` — the capabilities narrowed to the engine-aggregate path, so
 *   `ObjectQLStrategy` answers every query.
 *
 * Two faces per composition: the cube read (`AnalyticsService.query`, what
 * `POST /api/v1/analytics/query` relays) over the object's inferred cube, and
 * the dataset door through this package's own route
 * (`POST /api/v1/analytics/dataset/query`, the caller's filter as
 * `selection.runtimeFilter`).
 *
 * ## Measured on the base (`9b0de7de7`), this fixture
 *
 * | `where` | `engine.find` | native | objectql (base) |
 * |:--|:--|:--|:--|
 * | `{ $not: { owners: { $contains: 'u1' } } }` | b, d, e | b, d, e | 400 `INVALID_FILTER` (`$ne`) |
 * | `{ $not: { owners: { $notContains: 'u1' } } }` | a, c | a, c | 400 (bare equality) |
 * | `{ owners: { $notContains: 'u1' } }` | b, d, e | b, d, e | 400 (bare equality) |
 * | `{ owners: { $null: false } }` | a, b, c, d | a, b, c, d | 400 (`$ne`) |
 * | `{ owners: { $null: true } }` | e | e | 400 (bare equality) |
 * | `{ $not: { owner: { $contains: 'u1' } } }` (single-valued) | b, d, e | b, d, e | b, d, e |
 *
 * The engine's answer, computed in the same test over the same rows, is the
 * reference for every cell. SQLite only: the strategy's spelling is the
 * change, and the driver that refused it is `driver-sql`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_an_notmv_ledger';
const OWNER = 'rest_an_notmv_owner';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const OWNERS = [
  { id: 'u1', region: 'NA' },
  { id: 'u2', region: 'EU' },
  { id: 'u3', region: 'AP' },
];
/** `e` holds no value in either relation: the row the `$not` guard is about. */
const ROWS = [
  { id: 'd1', title: 'a', owner: 'u1', owners: ['u1'] },
  { id: 'd2', title: 'b', owner: 'u2', owners: ['u2'] },
  { id: 'd3', title: 'c', owner: 'u1', owners: ['u2', 'u1'] },
  { id: 'd4', title: 'd', owner: 'u3', owners: ['u3'] },
  { id: 'd5', title: 'e', owner: null, owners: null },
];
const TITLE_OF = new Map(ROWS.map((r) => [r.id, r.title]));

/**
 * Conditions the engine SERVES, with the rows it answers on this fixture
 * (asserted too, so a moved reference cannot pass silently). Every face must
 * give the engine's rows.
 */
const SERVED: ReadonlyArray<readonly [string, FilterCondition, string[]]> = [
  ['$not over $contains, multi-valued', { $not: { owners: { $contains: 'u1' } } }, ['b', 'd', 'e']],
  ['$not over $notContains, multi-valued', { $not: { owners: { $notContains: 'u1' } } }, ['a', 'c']],
  ['$notContains, multi-valued', { owners: { $notContains: 'u1' } }, ['b', 'd', 'e']],
  ['has a value, multi-valued', { owners: { $null: false } }, ['a', 'b', 'c', 'd']],
  ['has no value, multi-valued', { owners: { $null: true } }, ['e']],
  ['CONTROL $not over $contains, single-valued', { $not: { owner: { $contains: 'u1' } } }, ['b', 'd', 'e']],
];

/** The inline dataset the dataset door queries: the ledger, grouped by title. */
const DATASET = {
  name: 'not_multivalue_inline',
  label: 'Not multi-valued inline',
  object: OBJECT,
  dimensions: [{ name: 'title_dim', field: 'title', type: 'string' }],
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
const envelopeOf = (e: Thrown) => ({ code: e?.code, status: e?.status ?? e?.statusCode });
const titlesOf = (rows: ReadonlyArray<Record<string, unknown>>, key: string) =>
  rows.map((r) => String(r[key])).sort();

interface Harness {
  engine: ObjectQL;
  service: AnalyticsService;
  dataset: (runtimeFilter: FilterCondition) => Promise<{ status: number; body: any }>;
}

/** Boot the shipped composition; `caps` narrows the strategy set to the engine-aggregate path. */
async function boot(caps?: 'objectql'): Promise<Harness> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-not-multivalue-20918',
    name: 'Analytics $not over a multi-valued lookup',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OWNER,
        label: 'Owner',
        sharingModel: 'public_read_write',
        fields: { region: { name: 'region', type: 'text' } },
      },
      {
        name: OBJECT,
        label: 'Ledger',
        sharingModel: 'public_read_write',
        fields: {
          title: { name: 'title', type: 'text' },
          owner: { name: 'owner', type: 'lookup', reference: OWNER },
          owners: { name: 'owners', type: 'lookup', reference: OWNER, multiple: true },
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

  await new AnalyticsServicePlugin(
    caps === 'objectql'
      ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
      : {},
  ).init(ctx);
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
  const dataset = async (runtimeFilter: FilterCondition) => {
    const res = makeRes();
    const selection = { measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter };
    const body = JSON.parse(JSON.stringify({ dataset: DATASET, selection }));
    await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
    return { status: res.statusCode, body: res.body };
  };
  return { engine, service, dataset };
}

/** The engine's answer for a `where`, as the member: its titles, or its refusal. */
async function engineAnswer(engine: ObjectQL, where: FilterCondition) {
  return engine.find(OBJECT, { where, context: MEMBER_CTX } as never).then(
    (rows: any[]) => ({ titles: rows.map((r) => TITLE_OF.get(r.id) as string).sort() }),
    (e: Thrown) => ({ refused: envelopeOf(e) }),
  );
}

const cubeQuery = (where: FilterCondition) =>
  ({ cube: OBJECT, measures: ['count'], dimensions: ['title'], where }) as never;

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#20918] $not over a multi-valued lookup answers the engine's rows — ${strategy} composition`, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await boot(strategy === 'objectql' ? 'objectql' : undefined);
    }, 60_000);

    afterAll(async () => {
      try { await h?.engine.destroy(); } catch { /* noop */ }
    });

    for (const [label, where, rows] of SERVED) {
      it(`${label}: the cube read and the dataset door answer the engine's rows`, async () => {
        const reference = await engineAnswer(h.engine, where);
        expect(reference, `${label}: the engine`).toEqual({ titles: rows });

        const cube = await h.service.query(cubeQuery(where), MEMBER_CTX as never).then(
          (r) => ({ titles: titlesOf(r.rows, 'title') }),
          (e: Thrown) => ({ refused: envelopeOf(e), message: e?.message }),
        );
        expect(cube, `${label}: the cube read`).toEqual(reference);

        const ds = await h.dataset(where);
        expect(ds.status, `${label}: the dataset door ${JSON.stringify(ds.body)}`).toBe(200);
        expect(titlesOf(ds.body.rows, 'title_dim'), `${label}: the dataset door`).toEqual(rows);
      });
    }
  });
}
