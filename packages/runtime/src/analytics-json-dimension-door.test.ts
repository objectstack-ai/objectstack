// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cube dimension and a dataset dimension on a structured-JSON field are
 * refused at the public analytics door — `POST /api/v1/analytics/query` (and
 * its dry-run twin `POST /api/v1/analytics/sql`) answer `400 INVALID_FIELD`,
 * naming the member the caller wrote, before any SQL is built — over a real
 * `SqlDriver`; and a `text` dimension (the control) is served unchanged.
 *
 * ## The composition is the shipped one
 *
 * `AnalyticsServicePlugin` is initialised over a real `ObjectQL` engine as its
 * `'data'` service, so both of its auto-bridges are live: `executeRawSql` →
 * `engine.execute` (which is what makes `NativeSQLStrategy` the strategy that
 * answers on a SQL driver) and `executeAggregate` → `engine.aggregate`. The
 * route is the real `dispatcher-plugin` mount. A dataset is registered with
 * `registerDataset`, the configuration door, and queried by its name — the
 * cube it compiles to.
 *
 * ## Measured on the base, through this door
 *
 * Three rows, `title` x, x, y, and a different `meta` document per row:
 *
 * | `dimensions` | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | `title` (text, the control) | 200, `x` 2 · `y` 1 (native SQL) | same |
 * | `meta` (json), a cube dimension | 200, one group per serialized document (3) | 500 |
 * | `meta_doc` (a dataset dimension on `meta`) | 200, 3 groups | 500 |
 *
 * `engine.aggregate` was reached 0 times on those rows: the native strategy
 * compiled `GROUP BY` itself, so the engine's own `groupBy` refusal never saw
 * the query.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. No CI step
 * provisions that variable for this file, so the live cell is red-capable and
 * un-run in CI; the PR that landed this file carries its local PostgreSQL
 * 16 run. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';
import { DatasetSchema } from '@objectstack/spec/ui';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const OBJECT = 'analytics_json_dim_ledger';
const CUBE = 'json_dim_ledger';
const DATASET = 'json_dim_ledger_ds';

const LEDGER = {
    name: OBJECT,
    label: 'JSON dimension ledger',
    fields: {
        title: { name: 'title', type: 'text' as const },
        meta: { name: 'meta', type: 'json' as const },
    },
};

const ROWS = [
    { id: 'j1', title: 'x', meta: { a: 1 } },
    { id: 'j2', title: 'x', meta: { a: 2 } },
    { id: 'j3', title: 'y', meta: { b: 1 } },
];

/** An authored cube over the object: one text and one json dimension. */
const LEDGER_CUBE = {
    name: CUBE,
    title: 'JSON dimension ledger',
    sql: OBJECT,
    public: true,
    measures: { count: { label: 'Rows', type: 'count' as const, sql: '*' } },
    dimensions: {
        title: { label: 'Title', type: 'string' as const, sql: 'title' },
        meta: { label: 'Meta', type: 'string' as const, sql: 'meta' },
    },
};

/** A dataset whose dimensions compile to the same two columns, under names of their own. */
const LEDGER_DATASET = DatasetSchema.parse({
    name: DATASET,
    label: 'JSON dimension ledger dataset',
    object: OBJECT,
    dimensions: [
        { name: 'title_dim', field: 'title', type: 'string' },
        { name: 'meta_doc', field: 'meta', type: 'string' },
    ],
    measures: [{ name: 'row_count', aggregate: 'count' }],
});

/** The route the refusal prescribes — asserted on the wire body. */
const ROUTE = 'Group by a field that stores one scalar value: store the part you group on in a field of its own and group by that field.';

interface Cell {
    id: 'sqlite' | 'pg';
    label: string;
    env: string | null;
    config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
    { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
    {
        id: 'pg',
        label: 'live postgres',
        env: 'OS_TEST_POSTGRES_URL',
        config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
    },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Handler = (req: unknown, res: unknown) => unknown;

function makeRes() {
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        status(c: number) { res.statusCode = c; return res; },
        header() { return res; },
        json(b: unknown) { res.body = b; return res; },
    };
    return res;
}

for (const cell of CELLS) {
    const config = cell.config();
    describe.skipIf(!config)(
        `a dimension on a json field at POST /api/v1/analytics/query — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
        () => {
            let driver: any;
            let engine: ObjectQL;
            /** Raw-SQL statements and engine aggregates that read THIS object. */
            const reads = { rawSql: 0, aggregate: 0 };
            const handlers: Record<string, Handler> = {};

            const dropTables = async () => {
                if (cell.id === 'sqlite') return;
                await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
            };

            async function post(sub: 'query' | 'sql', body: Record<string, unknown>) {
                const handler = handlers[`POST /api/v1/analytics/${sub}`];
                expect(handler, `POST /api/v1/analytics/${sub} must be mounted`).toBeTypeOf('function');
                const res = makeRes();
                // What the wire carries: JSON.
                await handler({ body: JSON.parse(JSON.stringify(body)), query: {} }, res);
                return { status: res.statusCode ?? 200, body: res.body };
            }

            beforeAll(async () => {
                driver = new SqlDriver(config as any);
                await dropTables();
                engine = new ObjectQL({ logger: quiet } as any);
                engine.registerDriver(driver, true);
                await engine.init();
                engine.registry.registerObject(LEDGER as any);
                await engine.syncSchemas();
                for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

                // Count what reaches the engine for THIS object, on both bridges.
                const realExecute = (engine as any).execute.bind(engine);
                (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
                    if (opts?.object === OBJECT) reads.rawSql += 1;
                    return realExecute(sql, opts);
                };
                const realAggregate = engine.aggregate.bind(engine);
                (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
                    if (object === OBJECT) reads.aggregate += 1;
                    return (realAggregate as any)(object, ...rest);
                };

                // The plugin's own composition over the real engine: both auto-bridges.
                const registered: Record<string, unknown> = {};
                await new AnalyticsServicePlugin({ cubes: [LEDGER_CUBE as any] }).init({
                    getService: (name: string) => (name === 'data' ? engine : registered[name]),
                    registerService: (name: string, svc: unknown) => { registered[name] = svc; },
                    replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
                    hook: () => {},
                    logger: quiet,
                } as never);
                const analytics = registered.analytics as AnalyticsService;
                analytics.registerDataset(LEDGER_DATASET);

                const rec = (verb: string) => (path: string, handler: Handler) => { handlers[`${verb} ${path}`] = handler; };
                const server = { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') };
                const kernel = {
                    getService: (name: string) => (name === 'analytics' ? analytics : undefined),
                    getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : undefined),
                };
                const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
                await plugin.start?.({
                    getKernel: () => kernel,
                    getService: (name: string) => (name === 'http.server' ? server : undefined),
                    environmentId: undefined,
                    logger: quiet,
                    hook: () => {},
                    on: () => {},
                } as any);
            });

            afterAll(async () => {
                await dropTables();
                try { await engine?.destroy(); } catch { /* noop */ }
            });

            it('a cube dimension on a json field answers 400 INVALID_FIELD naming the member the caller wrote — no statement reaches the engine', async () => {
                const before = { ...reads };
                const res = await post('query', { cube: CUBE, measures: ['count'], dimensions: ['meta'] });
                expect(res.status, JSON.stringify(res.body)).toBe(400);
                expect(res.body.error.code).toBe('INVALID_FIELD');
                expect(res.body.error.httpStatus).toBe(400);
                expect(res.body.error.message).toContain(`Dimension 'meta' on cube '${CUBE}' groups by field 'meta'`);
                expect(res.body.error.message).toContain(`'${OBJECT}' declares as json`);
                expect(res.body.error.message).toContain(ROUTE);
                expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
            });

            it('a dataset dimension on a json field answers the same 400, naming the dataset dimension — no statement reaches the engine', async () => {
                const before = { ...reads };
                const res = await post('query', { cube: DATASET, measures: ['row_count'], dimensions: ['meta_doc'] });
                expect(res.status, JSON.stringify(res.body)).toBe(400);
                expect(res.body.error.code).toBe('INVALID_FIELD');
                expect(res.body.error.message).toContain(`Dimension 'meta_doc' on cube '${DATASET}' groups by field 'meta'`);
                expect(res.body.error.message).toContain(ROUTE);
                expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
            });

            it('the dry-run door refuses the same dimension: no statement is built to show', async () => {
                const res = await post('sql', { cube: CUBE, measures: ['count'], dimensions: ['meta'] });
                expect(res.status, JSON.stringify(res.body)).toBe(400);
                expect(res.body.error.code).toBe('INVALID_FIELD');
                expect(res.body.error.message).toContain(`Dimension 'meta' on cube '${CUBE}'`);
            });

            it('CONTROL a text dimension is served unchanged by the native strategy: one group per value, counted', async () => {
                const before = { ...reads };
                const res = await post('query', { cube: CUBE, measures: ['count'], dimensions: ['title'] });
                expect(res.status, JSON.stringify(res.body)).toBe(200);
                const groups = (res.body.data.rows as Array<{ title: string; count: number | string }>)
                    .map((r) => [r.title, Number(r.count)] as const)
                    .sort(([a], [b]) => a.localeCompare(b));
                expect(groups).toEqual([['x', 2], ['y', 1]]);
                expect(reads.rawSql - before.rawSql, 'the native strategy answered: one statement').toBe(1);
                expect(reads.aggregate - before.aggregate, 'the engine aggregate was not asked').toBe(0);

                const ds = await post('query', { cube: DATASET, measures: ['row_count'], dimensions: ['title_dim'] });
                expect(ds.status, JSON.stringify(ds.body)).toBe(200);
                const dsGroups = (ds.body.data.rows as Array<{ title_dim: string; row_count: number | string }>)
                    .map((r) => [r.title_dim, Number(r.row_count)] as const)
                    .sort(([a], [b]) => a.localeCompare(b));
                expect(dsGroups).toEqual([['x', 2], ['y', 1]]);
            });
        },
    );
}
