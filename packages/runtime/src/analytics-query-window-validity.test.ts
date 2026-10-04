// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21365] An analytics query's row window has ONE answer at
 * `POST /api/v1/analytics/query` (and its dry-run twin `/analytics/sql`), on
 * both drivers and both faces: a window outside the non-negative integers is
 * refused `400 VALIDATION_FAILED` at the door before any engine runs, and an
 * `offset` with no `limit` answers the same rows everywhere.
 *
 * ## Measured on the base, through this door
 *
 * `main` `ee75aae1a`, four groups by `note` (w, x, y, z), `order { note: 'asc' }`:
 *
 * | window | native SQLite | native PostgreSQL 16.14 | ObjectQL face, both |
 * |:--|:--|:--|:--|
 * | `limit: -1` | 200, every row | 500 | 200, all but the last row |
 * | `limit: 1.5` | 500 | 200, two rows | 200, one row |
 * | `offset: -1` | 500 | 500 | 200, every row |
 * | `offset: 1`, no `limit` | 500 (`near "OFFSET": syntax error`) | 200, x y z | 200, x y z |
 *
 * `/analytics/sql` answered 200 for every one of them, rendering the statement.
 *
 * ## The composition is the shipped one
 *
 * `AnalyticsServicePlugin` over a real `ObjectQL` engine as its `'data'`
 * service: the default composition (native face, both auto-bridges live) and
 * one narrowed to the engine aggregate (the ObjectQL face). The route is the
 * real `dispatcher-plugin` mount.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. No CI step
 * provisions that variable for this file, so the live cell is red-capable and
 * un-run in CI; the PR that landed this file carries its local PostgreSQL 16
 * run. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin, type AnalyticsService } from '@objectstack/service-analytics';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// [#21061] The analytics domain refuses an anonymous caller first (ADR-0056 D2),
// so this harness signs its caller in: an `auth` slot in the shape
// `resolveExecutionContext` reads answers a session for every request. Only
// identity is stubbed; the route, the service and every expectation are
// unchanged. Anonymity is pinned in `domains/analytics-anonymous-deny.test.ts`.
const SIGNED_IN_AUTH = { api: { getSession: async () => ({ user: { id: 'usr_analytics_caller' } }) } };

const OBJECT = 'os21365_window_deal';
const CUBE = 'os21365_window_cube';

const DEAL = {
    name: OBJECT,
    label: 'Window deal',
    fields: {
        note: { name: 'note', type: 'text' as const },
        amount: { name: 'amount', type: 'number' as const },
    },
};

// Inserted out of note order, so an answer in note order is the ORDER BY's.
const ROWS = [
    { id: 'd1', note: 'y', amount: 20 },
    { id: 'd2', note: 'w', amount: 7 },
    { id: 'd3', note: 'z', amount: 1 },
    { id: 'd4', note: 'x', amount: 10 },
];

const WINDOW_CUBE = {
    name: CUBE,
    title: 'Window cube',
    sql: OBJECT,
    public: true,
    measures: { amount_sum: { type: 'sum' as const, sql: 'amount', label: 'Amount' } },
    dimensions: { note: { type: 'string' as const, sql: 'note', label: 'Note' } },
};

const BASE = { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { note: 'asc' } };

/** The card's rows 1 to 3, plus the fractional offset — the key the door names for each. */
const REFUSED: ReadonlyArray<[string, Record<string, unknown>, 'limit' | 'offset']> = [
    ['limit: -1', { limit: -1 }, 'limit'],
    ['limit: 1.5', { limit: 1.5 }, 'limit'],
    ['offset: -1', { offset: -1 }, 'offset'],
    ['offset: 1.5', { offset: 1.5 }, 'offset'],
];

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

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

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

const notes = (body: any) => (body.data.rows as Array<Record<string, unknown>>).map((row) => row.note);

for (const cell of CELLS) {
    const config = cell.config();
    describe.skipIf(!config)(
        `[#21365] the analytics query window at POST /api/v1/analytics/query — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
        () => {
            let driver: any;
            let engine: ObjectQL;
            /** Raw-SQL statements and engine aggregates that read THIS object. */
            const reads = { rawSql: [] as string[], aggregate: 0 };
            const handlers: Partial<Record<Face, Record<string, Handler>>> = {};

            const dropTables = async () => {
                if (cell.id === 'sqlite') return;
                await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
            };

            async function post(face: Face, sub: 'query' | 'sql', body: Record<string, unknown>) {
                const handler = handlers[face]![`POST /api/v1/analytics/${sub}`];
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
                engine.registry.registerObject(DEAL as any);
                await engine.syncSchemas();
                for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

                // Count what reaches the engine for THIS object, on both bridges.
                const realExecute = (engine as any).execute.bind(engine);
                (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
                    if (opts?.object === OBJECT) reads.rawSql.push(String(sql));
                    return realExecute(sql, opts);
                };
                const realAggregate = engine.aggregate.bind(engine);
                (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
                    if (object === OBJECT) reads.aggregate += 1;
                    return (realAggregate as any)(object, ...rest);
                };

                for (const [face, caps] of [
                    ['native', undefined],
                    ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
                ] as const) {
                    const registered: Record<string, unknown> = {};
                    await new AnalyticsServicePlugin({ cubes: [WINDOW_CUBE as any], debugSql: true, ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
                        getService: (name: string) => (name === 'data' ? engine : registered[name]),
                        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
                        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
                        hook: () => {},
                        logger: quiet,
                    } as never);
                    const analytics = registered.analytics as AnalyticsService;

                    const routes: Record<string, Handler> = {};
                    const rec = (verb: string) => (path: string, handler: Handler) => { routes[`${verb} ${path}`] = handler; };
                    const server = { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') };
                    const kernel = {
                        getService: (name: string) => (name === 'analytics' ? analytics : name === 'auth' ? SIGNED_IN_AUTH : undefined),
                        getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : name === 'auth' ? SIGNED_IN_AUTH : undefined),
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
                    handlers[face] = routes;
                }
            });

            afterAll(async () => {
                await dropTables();
                try { await engine?.destroy(); } catch { /* noop */ }
            });

            for (const [label, window, key] of REFUSED) {
                it(`${label} answers 400 VALIDATION_FAILED naming \`${key}\` at both routes, on both faces — no engine runs`, async () => {
                    for (const face of FACES) {
                        for (const sub of ['query', 'sql'] as const) {
                            const before = { rawSql: reads.rawSql.length, aggregate: reads.aggregate };
                            const res = await post(face, sub, { ...BASE, ...window });
                            expect(res.status, `${face} /${sub}: ${JSON.stringify(res.body)}`).toBe(400);
                            expect(res.body.error.code, `${face} /${sub}`).toBe('VALIDATION_FAILED');
                            expect(res.body.error.httpStatus, `${face} /${sub}`).toBe(400);
                            const fields: Array<{ field: string }> = res.body.error.details.fields;
                            expect(fields.map((f) => f.field), `${face} /${sub}`).toEqual([key]);
                            expect(
                                { rawSql: reads.rawSql.length, aggregate: reads.aggregate },
                                `${face} /${sub}: no raw SQL and no engine aggregate for the object`,
                            ).toEqual(before);
                        }
                    }
                });
            }

            it("the card's row 4 — ordered, offset 1, no limit — answers the same rows on both faces", async () => {
                for (const face of FACES) {
                    const res = await post(face, 'query', { ...BASE, offset: 1 });
                    expect(res.status, `${face}: ${JSON.stringify(res.body)}`).toBe(200);
                    expect(notes(res.body), face).toEqual(['x', 'y', 'z']);
                }
            });

            it('row 4 on the native face: the echoed `sql` and /analytics/sql are the statement that ran', async () => {
                const before = reads.rawSql.length;
                const res = await post('native', 'query', { ...BASE, offset: 1 });
                const ran = reads.rawSql.slice(before);
                expect(ran, 'the native face ran ONE statement').toHaveLength(1);
                // No bound parameter, so the raw-SQL bridge's `$N` → `?` rewrite
                // leaves the statement byte-identical to the echo.
                expect(res.body.data.sql).not.toContain('$');
                expect(res.body.data.sql).toBe(ran[0]);
                const dryRun = await post('native', 'sql', { ...BASE, offset: 1 });
                expect(dryRun.status).toBe(200);
                expect(dryRun.body.data.sql).toBe(ran[0]);
            });

            it('CONTROL: an integer window — limit 2, offset 1 — answers the same rows on both faces', async () => {
                for (const face of FACES) {
                    const res = await post(face, 'query', { ...BASE, limit: 2, offset: 1 });
                    expect(res.status, `${face}: ${JSON.stringify(res.body)}`).toBe(200);
                    expect(notes(res.body), face).toEqual(['x', 'y']);
                }
            });

            it('CONTROL: limit 0 answers no rows on both faces', async () => {
                for (const face of FACES) {
                    const res = await post(face, 'query', { ...BASE, limit: 0 });
                    expect(res.status, `${face}: ${JSON.stringify(res.body)}`).toBe(200);
                    expect(res.body.data.rows, face).toEqual([]);
                }
            });
        },
    );
}
