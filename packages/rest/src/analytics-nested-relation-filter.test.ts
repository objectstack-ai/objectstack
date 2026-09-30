// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20887, the analytics half of #20802's ruling] The nested-relation form
 * `{ relation: { field: value } }` gets ONE answer on every analytics face, and
 * that answer is the engine's: the related object read AS THE CALLER (its row
 * scope and field permissions apply), capped, a multi-valued relation matching on
 * any member. The engine is the reference every assertion below compares with,
 * computed in the same test over the same rows: `engine.find` for a `where`,
 * `engine.aggregate` for an aggregation's own `filter`.
 *
 * The composition is the shipped one, with the REAL security layer:
 * `SecurityPlugin` over a real `ObjectQL` on a real `SqlDriver`, and
 * `AnalyticsServicePlugin` over the same engine as its `'data'` service. Two
 * compositions, one per strategy:
 *
 * - `native` — the plugin's own capabilities, so `NativeSQLStrategy` is the
 *   strategy the service asks first (a SQL driver serves raw statements);
 * - `objectql` — the capabilities narrowed to the engine-aggregate path, so
 *   `ObjectQLStrategy` answers every query.
 *
 * Two faces per composition: the cube read (`AnalyticsService.query`, what
 * `POST /api/v1/analytics/query` relays) over the object's inferred cube, and
 * the dataset door through this package's own route
 * (`POST /api/v1/analytics/dataset/query`, the caller's filter as
 * `selection.runtimeFilter`); plus the SQL echo (`AnalyticsService.generateSql`,
 * what `POST /api/v1/analytics/sql` relays).
 *
 * ## Measured on the base (`00a92e18`), one fixture, before this file's change
 *
 * | face · strategy | `{ owner: { region: 'NA' } }` | `{ owners: … }` (multi) | unreadable field | past the cap |
 * |:--|:--|:--|:--|:--|
 * | engine `find` (member) | d1, d3 | d1, d3 | 403 `PERMISSION_DENIED` | 400 `INVALID_FILTER` |
 * | cube read · native | 500 `DATABASE_ERROR` | 500 | 500 | 500 |
 * | dataset door · native | d1, d3 | 400 `DATASET_INVALID` | **rows d1, d3** | **no rows, 200** |
 * | cube read / dataset door · objectql | 400 `INVALID_FIELD` | 400 | 400 | 400 |
 *
 * The native dataset door joined the related table itself: the related object's
 * row scope rode in as a `WHERE` conjunct, its field permissions did not (so it
 * filtered by a value the caller may not read), and nothing bounded the match.
 *
 * SQLite only: the dialect axis of the lowering is the engine's, pinned in
 * `data-nested-object-door.test.ts`; this file's axis is the analytics faces.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import type { FilterCondition } from '@objectstack/spec/data';
import { PermissionSetSchema } from '@objectstack/spec/security';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { RestServer } from './rest-server';

const OBJECT = 'rest_an_nested_ledger';
const OWNER = 'rest_an_nested_owner';

const SYS_CTX = { isSystem: true, userId: 'usr_system' };

const MEMBER_SET = PermissionSetSchema.parse({
  name: 'member_default',
  label: 'Member',
  objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } },
  // The field the caller may not read, on the RELATED object.
  fields: { [`${OWNER}.secret`]: { readable: false, editable: false } },
  // The related object's row scope: the caller sees no owner in region HIDDEN.
  rowLevelSecurity: [{ name: 'owner_scope', object: OWNER, operation: 'all', using: "record.region != 'HIDDEN'" }],
});

const MEMBER_CTX = { userId: 'usr_member', positions: [], permissions: [MEMBER_SET.name], posture: 'MEMBER' };

const OWNERS = [
  { id: 'u1', region: 'NA', secret: 's1' },
  { id: 'u2', region: 'EU', secret: 's2' },
  { id: 'u3', region: 'HIDDEN', secret: 's3' },
];
/** One more related record than the engine's cap matches `region: 'CAP'`. */
const CAP_OWNERS = Array.from({ length: 1001 }, (_, i) => ({ id: `c${i}`, region: 'CAP', secret: 'x' }));
const ROWS = [
  { id: 'd1', title: 'a', owner: 'u1', owners: ['u1'] },
  { id: 'd2', title: 'b', owner: 'u2', owners: ['u2'] },
  { id: 'd3', title: 'c', owner: 'u1', owners: ['u2', 'u1'] },
  { id: 'd4', title: 'd', owner: 'u3', owners: ['u3'] },
];
const TITLE_OF = new Map(ROWS.map((r) => [r.id, r.title]));

/** Conditions the engine SERVES: its rows are the answer every face must give. */
const SERVED: ReadonlyArray<readonly [string, FilterCondition]> = [
  ['single-valued', { owner: { region: 'NA' } }],
  ['multi-valued', { owners: { region: 'NA' } }],
  ['related row scope', { owner: { region: 'HIDDEN' } }],
  ['under $not', { $not: { owner: { region: 'NA' } } }],
  ['multi-valued under $not', { $not: { owners: { region: 'NA' } } }],
  ['inside $or', { $or: [{ owner: { region: 'NA' } }, { title: 'b' }] }],
];

/** Conditions the engine REFUSES: its envelope is the answer every face must give. */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition, { code: string; status: number }]> = [
  ['a related field the caller cannot read', { owner: { secret: 's1' } }, { code: 'PERMISSION_DENIED', status: 403 }],
  ['a related field the caller cannot read, multi-valued', { owners: { secret: 's1' } }, { code: 'PERMISSION_DENIED', status: 403 }],
  ['past the cap', { owner: { region: 'CAP' } }, { code: 'INVALID_FILTER', status: 400 }],
  ['past the cap, multi-valued', { owners: { region: 'CAP' } }, { code: 'INVALID_FILTER', status: 400 }],
];

/**
 * The inline dataset the dataset door queries: the ledger, grouped by title. It
 * includes the `owner` relationship, the join the native strategy used to answer
 * the form with before this file's change.
 */
const DATASET = {
  name: 'nested_relation_inline',
  label: 'Nested relation inline',
  object: OBJECT,
  include: ['owner'],
  dimensions: [{ name: 'title_dim', field: 'title', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'na_n', aggregate: 'count', filter: { owner: { region: 'NA' } } },
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
const envelopeOf = (e: Thrown) => ({ code: e?.code, status: e?.status ?? e?.statusCode });
const titlesOf = (rows: ReadonlyArray<Record<string, unknown>>, key: string) =>
  rows.map((r) => String(r[key])).sort();

interface Harness {
  engine: ObjectQL;
  analytics: AnalyticsService;
  dataset: (selection: Record<string, unknown>) => Promise<{ status: number; body: any }>;
}

/**
 * Boot the shipped composition. `caps` narrows the strategy set; `getReadScope`
 * is a host-supplied read scope (the plugin option), used by the read-scope rows.
 */
async function boot(opts: { caps?: 'objectql'; getReadScope?: (object: string) => FilterCondition | null }): Promise<Harness> {
  const engine = new ObjectQL({ logger: quiet } as any);
  engine.registerDriver(
    new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any),
    true,
  );
  await engine.init();
  engine.registerApp({
    id: 'com.objectstack.qa.analytics-nested-relation-20887',
    name: 'Analytics nested relation',
    version: '1.0.0',
    type: 'plugin',
    scope: 'system',
    objects: [
      {
        name: OWNER,
        label: 'Owner',
        sharingModel: 'public_read_write',
        fields: { region: { name: 'region', type: 'text' }, secret: { name: 'secret', type: 'text' } },
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
  // SQLite caps one compound insert at 500 terms.
  for (let i = 0; i < CAP_OWNERS.length; i += 200) {
    await engine.insert(OWNER, CAP_OWNERS.slice(i, i + 200).map((r) => ({ ...r })), { context: SYS_CTX } as never);
  }
  await engine.insert(OBJECT, ROWS.map((r) => ({ ...r })), { context: SYS_CTX } as never);

  await new AnalyticsServicePlugin({
    ...(opts.caps === 'objectql'
      ? { queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }) }
      : {}),
    ...(opts.getReadScope ? { getReadScope: opts.getReadScope } : {}),
  }).init(ctx);
  const analytics = services.analytics as AnalyticsService;

  const rest = new RestServer(
    createMockServer() as any, mockProtocol() as any, { api: { requireAuth: false } } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined,
    async () => analytics,
  );
  (rest as any).resolveExecCtx = async () => MEMBER_CTX;
  rest.registerRoutes();
  const route = rest.getRoutes().find((r: any) => r.method === 'POST' && r.path === '/api/v1/analytics/dataset/query');
  expect(route).toBeDefined();
  const dataset = async (selection: Record<string, unknown>) => {
    const res = makeRes();
    const body = JSON.parse(JSON.stringify({ dataset: DATASET, selection }));
    await route!.handler({ method: 'POST', params: {}, headers: {}, body, query: {} } as any, res);
    return { status: res.statusCode, body: res.body };
  };
  return { engine, analytics, dataset };
}

/** The engine's answer for a `where`, as the member: its titles, or its refusal. */
async function engineAnswer(engine: ObjectQL, where: FilterCondition, context: unknown = MEMBER_CTX) {
  return engine.find(OBJECT, { where, context } as never).then(
    (rows: any[]) => ({ titles: rows.map((r) => TITLE_OF.get(r.id) as string).sort() }),
    (e: Thrown) => ({ refused: envelopeOf(e) }),
  );
}

const cubeQuery = (where: FilterCondition) =>
  ({ cube: OBJECT, measures: ['count'], dimensions: ['title'], where }) as never;

for (const strategy of ['native', 'objectql'] as const) {
  describe(`[#20887] the nested-relation form at the analytics faces is the engine's answer — ${strategy} composition`, () => {
    let h: Harness;

    beforeAll(async () => {
      h = await boot(strategy === 'objectql' ? { caps: 'objectql' } : {});
    }, 60_000);

    afterAll(async () => {
      try { await h?.engine.destroy(); } catch { /* noop */ }
    });

    it('the cube read and the dataset door answer the engine\'s rows — single-valued, multi-valued, the related row scope, $not and $or', async () => {
      for (const [label, where] of SERVED) {
        const reference = await engineAnswer(h.engine, where);
        expect('titles' in reference, `${label}: the engine serves it`).toBe(true);

        const cube = await h.analytics.query(cubeQuery(where), MEMBER_CTX as never).then(
          (r) => ({ titles: titlesOf(r.rows, 'title') }),
          (e: Thrown) => ({ refused: envelopeOf(e), message: e?.message }),
        );
        expect(cube, `${label}: the cube read`).toEqual(reference);

        const ds = await h.dataset({ measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter: where });
        expect(ds.status, `${label}: the dataset door ${JSON.stringify(ds.body)}`).toBe(200);
        expect(titlesOf(ds.body.rows, 'title_dim'), `${label}: the dataset door`).toEqual((reference as { titles: string[] }).titles);
      }
    });

    it('a related field the caller cannot read, and a match past the cap, are refused as the engine refuses them — never rows', async () => {
      for (const [label, where, expected] of REFUSED) {
        const reference = await engineAnswer(h.engine, where);
        expect(reference, `${label}: the engine`).toEqual({ refused: expected });

        const cube = await h.analytics.query(cubeQuery(where), MEMBER_CTX as never).then(
          (r) => ({ rows: r.rows }),
          (e: Thrown) => ({ refused: envelopeOf(e) }),
        );
        expect(cube, `${label}: the cube read`).toEqual({ refused: expected });

        const ds = await h.dataset({ measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter: where });
        expect(ds.status, `${label}: the dataset door ${JSON.stringify(ds.body)}`).toBe(expected.status);
        expect(ds.body?.code, `${label}: the dataset door`).toBe(expected.code);
        expect(ds.body?.rows, `${label}: no rows beside the refusal`).toBeUndefined();
      }
      // What the permission refusal withholds: a system caller's condition does match.
      const system = await h.analytics.query(cubeQuery({ owner: { secret: 's1' } }), SYS_CTX as never);
      expect(titlesOf(system.rows, 'title')).toEqual(['a', 'c']);
    });

    it('a measure\'s own filter carrying the form answers what the engine answers at an aggregation\'s filter: refused INVALID_FILTER, never a count', async () => {
      const reference = await h.engine
        .aggregate(OBJECT, {
          groupBy: ['title'],
          aggregations: [{ function: 'count', alias: 'na_n', filter: { owner: { region: 'NA' } } }],
          context: MEMBER_CTX,
        } as never)
        .then(() => null, (e: Thrown) => envelopeOf(e));
      expect(reference, 'the engine refuses the form at an aggregation\'s filter').toEqual({ code: 'INVALID_FILTER', status: 400 });

      const ds = await h.dataset({ measures: ['row_count', 'na_n'], dimensions: ['title_dim'] });
      expect(ds.status, JSON.stringify(ds.body)).toBe(400);
      expect(ds.body?.code, JSON.stringify(ds.body)).toBe('INVALID_FILTER');
      expect(ds.body?.rows).toBeUndefined();
    });

    it('the SQL echo refuses the form in the where-door envelope, naming the served route, rather than print a statement that is not what ran', async () => {
      const echo = await h.analytics.generateSql(cubeQuery({ owner: { region: 'NA' } }), MEMBER_CTX as never).then(
        (r) => ({ sql: r.sql }),
        (e: Thrown) => ({ refused: envelopeOf(e), message: String(e?.message) }),
      );
      expect(echo).toMatchObject({ refused: { code: 'INVALID_FILTER', status: 400 } });
      const message = (echo as { message: string }).message;
      expect(message).toContain('"owner"');
      expect(message).toContain('/analytics/query');
    });
  });
}

describe('[#20887] a read scope carrying the nested-relation form', () => {
  /** A host read scope (the plugin option): the member reads only ledger rows whose owner is in NA. */
  const scope = (object: string): FilterCondition | null => (object === OBJECT ? { owner: { region: 'NA' } } : null);

  /**
   * B4, measured: the read scope's SQL compile (`compileScopedFilterToSql`) is a
   * synchronous string builder that holds the caller's context for placeholders
   * and no data engine — it cannot read the related object as the caller. So
   * where a scope is compiled to SQL — the native strategy's statement and both
   * SQL echoes — it keeps its fail-closed refusal, now in words that name the
   * route that serves the form. On the engine-aggregate path the scope reaches
   * the engine as written, and the engine serves it as the caller, as it did
   * before this change.
   */
  const bootWithScope = (strategy: 'native' | 'objectql') =>
    boot({ ...(strategy === 'objectql' ? { caps: 'objectql' as const } : {}), getReadScope: scope });
  const query = { cube: OBJECT, measures: ['count'], dimensions: ['title'] } as never;

  it('the native strategy compiles the scope to SQL and keeps the fail-closed refusal, naming the route — never unscoped rows', async () => {
    const h = await bootWithScope('native');
    try {
      for (const run of [() => h.analytics.query(query, MEMBER_CTX as never), () => h.analytics.generateSql(query, MEMBER_CTX as never)]) {
        const answer = await run().then((r) => ({ answered: r }), (e: Thrown) => ({ refused: envelopeOf(e), message: String(e?.message) }));
        expect(answer).toMatchObject({ refused: { code: 'READ_SCOPE_COMPILE_FAILED', status: 500 } });
        const message = (answer as { message: string }).message;
        expect(message).toContain("The engine serves the form in a query's where");
        expect(message).toContain('reads the related object as the caller');
      }
    } finally {
      try { await h.engine.destroy(); } catch { /* noop */ }
    }
  }, 60_000);

  it('the engine-aggregate path hands the scope to the engine, which serves it as the caller — its SQL echo refuses', async () => {
    const h = await bootWithScope('objectql');
    try {
      const reference = await engineAnswer(h.engine, { owner: { region: 'NA' } });
      expect(reference).toEqual({ titles: ['a', 'c'] });
      const cube = await h.analytics.query(query, MEMBER_CTX as never)
        .then((r) => ({ titles: titlesOf(r.rows, 'title') }), (e: Thrown) => ({ refused: envelopeOf(e), message: e?.message }));
      expect(cube).toEqual(reference);
      const echo = await h.analytics.generateSql(query, MEMBER_CTX as never)
        .then((r) => ({ sql: r.sql }), (e: Thrown) => ({ refused: envelopeOf(e), message: String(e?.message) }));
      expect(echo).toMatchObject({ refused: { code: 'READ_SCOPE_COMPILE_FAILED', status: 500 } });
      expect((echo as { message: string }).message).toContain('reads the related object as the caller');
    } finally {
      try { await h.engine.destroy(); } catch { /* noop */ }
    }
  }, 60_000);
});
