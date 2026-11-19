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
import { installDefaultOrganization } from './default-organization.testkit.js';

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
  // A single-valued relation is one subquery on a SQL driver: no id list, no cap.
  ['single-valued, more related matches than the id cap', { owner: { region: 'CAP' } }],
];

/** Conditions the engine REFUSES: its envelope is the answer every face must give. */
const REFUSED: ReadonlyArray<readonly [string, FilterCondition, { code: string; status: number }]> = [
  ['a related field the caller cannot read', { owner: { secret: 's1' } }, { code: 'PERMISSION_DENIED', status: 403 }],
  ['a related field the caller cannot read, multi-valued', { owners: { secret: 's1' } }, { code: 'PERMISSION_DENIED', status: 403 }],
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
  dataset: (selection: Record<string, unknown>, def?: Record<string, unknown>) => Promise<{ status: number; body: any }>;
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
  // A real `single` install's Default Organization: the system writes below
  // derive it (ADR-0131 D9), as a fresh NOT NULL tenant column requires (D1).
  await installDefaultOrganization(engine);

  const services: Record<string, unknown> = {
    manifest: { register: vi.fn() },
    objectql: engine,
    data: engine,
    metadata: {
      // The catalog reads a set by name (ADR-0150 D3): served from the same list.
      get: async (type: string, name: string) =>
        (type === 'permission' ? [MEMBER_SET].find((s: any) => s?.name === name) : engine.getSchema(name)) ?? null,
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
  const dataset = async (selection: Record<string, unknown>, def: Record<string, unknown> = DATASET) => {
    const res = makeRes();
    const body = JSON.parse(JSON.stringify({ dataset: def, selection }));
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

/**
 * [#33335] The DOTTED cross-object member (`'owner.region'`) on the
 * engine-aggregate path. `engine.aggregate` cannot join, so `ObjectQLStrategy`
 * refused every such `where` leaf (`400 INVALID_FIELD`, "cannot join in an
 * aggregate"), and a dashboard over detail rows could not leave out the rows of
 * a cancelled parent. It now hands the leaf (up to three hops, #33626) to the engine as the
 * nested-relation condition above (`cross-object-where.ts`), so its answer is
 * the engine's for that condition, computed here as the reference: the related
 * object read as the caller, its row scope and field permissions applied, an
 * empty match selecting no row, a match past the cap refused.
 *
 * Measured on the base (`ba35dfd7`), this composition, every row below:
 * `400 INVALID_FIELD`, "cannot evaluate a cross-object filter".
 *
 * Two readings are pinned beyond the reference, because they are the card's
 * questions: what a child with NO parent gets under a negative operator (it is
 * not selected — a cross-object leaf requires a related record the caller can
 * read; OR in `{ owner: { $null: true } }` to keep such rows), and that the
 * shapes this path cannot serve exactly (under `$not`, past three hops) stay refused
 * rather than answered differently.
 */
describe('[#33335] a dotted cross-object where on the engine-aggregate path answers the engine\'s nested-relation condition', () => {
  let h: Harness;
  /** A ledger row with no owner at all — the orphan the negative operators are pinned on. */
  const ORPHAN = { id: 'd5', title: 'e', owner: null, owners: [] };
  const TITLES = new Map([...TITLE_OF, [ORPHAN.id, ORPHAN.title]]);

  beforeAll(async () => {
    h = await boot({ caps: 'objectql' });
    await h.engine.insert(OBJECT, [{ ...ORPHAN }], { context: SYS_CTX } as never);
  }, 60_000);

  afterAll(async () => {
    try { await h?.engine.destroy(); } catch { /* noop */ }
  });

  const reference = (where: FilterCondition) =>
    h.engine.find(OBJECT, { where, context: MEMBER_CTX } as never).then(
      (rows: any[]) => ({ titles: rows.map((r) => TITLES.get(r.id) as string).sort() }),
      (e: Thrown) => ({ refused: envelopeOf(e) }),
    );
  const cubeRead = (where: FilterCondition) =>
    h.analytics.query(cubeQuery(where), MEMBER_CTX as never).then(
      (r) => ({ titles: titlesOf(r.rows, 'title') }),
      (e: Thrown) => ({ refused: envelopeOf(e) }),
    );

  /** One owner id list keeps the `$ne` read under the cap: the 1001 `CAP` owners are not in it. */
  const LISTED = { $in: ['u1', 'u2', 'u3'] };
  const SERVED: ReadonlyArray<readonly [string, FilterCondition, FilterCondition, string[]]> = [
    ['equality', { 'owner.region': 'NA' }, { owner: { region: 'NA' } }, ['a', 'c']],
    // u2 is the one readable owner outside NA: u3 is hidden by the owner row
    // scope, and d5 has no owner — neither is selected by a `$ne`.
    ['$ne, beside a second leaf on the same relation',
      { 'owner.region': { $ne: 'NA' }, 'owner.id': LISTED }, { owner: { region: { $ne: 'NA' }, id: LISTED } }, ['b']],
    ['$ne, with the orphan kept by its own branch',
      { $or: [{ 'owner.region': { $ne: 'NA' }, 'owner.id': LISTED }, { owner: { $null: true } }] },
      { $or: [{ owner: { region: { $ne: 'NA' }, id: LISTED } }, { owner: { $null: true } }] }, ['b', 'e']],
    ['inside $or', { $or: [{ 'owner.region': 'NA' }, { title: 'b' }] }, { $or: [{ owner: { region: 'NA' } }, { title: 'b' }] }, ['a', 'b', 'c']],
    ['a related record the caller cannot read', { 'owner.region': 'HIDDEN' }, { owner: { region: 'HIDDEN' } }, []],
    ['no related record matches', { 'owner.region': 'NOWHERE' }, { owner: { region: 'NOWHERE' } }, []],
    ['a multi-valued relation', { 'owners.region': 'NA' }, { owners: { region: 'NA' } }, ['a', 'c']],
  ];

  it('the cube read answers the engine\'s rows for the nested-relation condition the leaf stands for', async () => {
    for (const [label, dotted, nested, titles] of SERVED) {
      const expected = await reference(nested);
      expect(expected, `${label}: the engine's own answer`).toEqual({ titles });
      expect(await cubeRead(dotted), `${label}: the cube read`).toEqual(expected);
    }
    // The empty answers above are the scope and the condition, not an empty
    // table: a system caller reads the hidden owner's row.
    const system = await h.analytics.query(cubeQuery({ 'owner.region': 'HIDDEN' }), SYS_CTX as never);
    expect(titlesOf(system.rows, 'title')).toEqual(['d']);
  });

  it('the dataset door answers the same rows for the leaf in selection.runtimeFilter', async () => {
    for (const [label, dotted, , titles] of SERVED.filter(([, d]) => !JSON.stringify(d).includes('owners'))) {
      const ds = await h.dataset({ measures: ['row_count'], dimensions: ['title_dim'], runtimeFilter: dotted });
      expect(ds.status, `${label}: ${JSON.stringify(ds.body)}`).toBe(200);
      expect(titlesOf(ds.body.rows, 'title_dim'), label).toEqual(titles);
    }
  });

  it('a related field the caller cannot read is refused as the engine refuses it; a single-valued match past the id cap is served', async () => {
    const cases: ReadonlyArray<readonly [FilterCondition, FilterCondition, { code: string; status: number }]> = [
      [{ 'owner.secret': 's1' }, { owner: { secret: 's1' } }, { code: 'PERMISSION_DENIED', status: 403 }],
    ];
    for (const [dotted, nested, expected] of cases) {
      expect(await reference(nested), JSON.stringify(nested)).toEqual({ refused: expected });
      expect(await cubeRead(dotted), JSON.stringify(dotted)).toEqual({ refused: expected });
    }
    // One subquery, no id list: the 1001 `CAP` owners select no ledger row, served.
    const pastCap = await reference({ owner: { region: 'CAP' } });
    expect(pastCap).not.toHaveProperty('refused');
    expect(await cubeRead({ 'owner.region': 'CAP' })).toEqual(pastCap);
  });

  it('[#33626] the dataset\'s OWN filter carrying a dotted leaf is served the same way: the engine\'s rows, the hidden and the orphan parent left out under $ne', async () => {
    const scoped = (filter: FilterCondition) => ({
      ...DATASET,
      name: 'nested_relation_scoped',
      measures: [{ name: 'row_count', aggregate: 'count' }],
      filter,
    });
    for (const [dotted, nested] of [
      [{ 'owner.region': { $ne: 'NA' } }, { owner: { region: { $ne: 'NA' } } }],
      [{ 'owner.region': 'NA' }, { owner: { region: 'NA' } }],
    ] as Array<[FilterCondition, FilterCondition]>) {
      const expected = await reference(nested);
      expect(expected, JSON.stringify(nested)).toHaveProperty('titles');
      const ds = await h.dataset({ measures: ['row_count'], dimensions: ['title_dim'] }, scoped(dotted));
      expect(ds.status, `${JSON.stringify(dotted)}: ${JSON.stringify(ds.body)}`).toBe(200);
      expect({ titles: titlesOf(ds.body.rows, 'title_dim') }, JSON.stringify(dotted)).toEqual(expected);
    }
    // The engine's titles for `$ne` exclude d4 (the hidden owner) and d5 (no owner).
    expect(await reference({ owner: { region: { $ne: 'NA' } } })).toEqual({ titles: ['b'] });
  });

  it('a leaf under $not stays refused, never answered from a negated match that admits the hidden owner\'s row', async () => {
    // The engine answers the AUTHORED nested form under `$not` with d4 and d5
    // among its rows (the NULL-safe negation of a relation match); the dotted
    // leaf is refused instead. The two-hop refusal is pinned at the strategy
    // (`service-analytics`'s `crossobject-conjunct-refusal.test.ts`, ⑨).
    expect(await reference({ $not: { owner: { region: 'NA' } } })).toEqual({ titles: ['b', 'd', 'e'] });
    expect(await cubeRead({ $not: { 'owner.region': 'NA' } } as FilterCondition))
      .toEqual({ refused: { code: 'INVALID_FIELD', status: 400 } });
  });
});
