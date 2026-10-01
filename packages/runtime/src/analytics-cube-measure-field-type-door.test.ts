// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21044] Over the wire: `POST /api/v1/analytics/query`, served by the real
 * dispatcher route, refuses a configured cube's `max` over a `text` column with
 * the cube door's `INVALID_FIELD` / 400 — on the native-SQL face, which served
 * the column's text under `fields[] { type: 'number' }`, and on the ObjectQL
 * face, which the engine's aggregate door refused only after the strategy had
 * begun — and serves the controls.
 *
 * The service door is pinned beside the implementation (`service-analytics`
 * `cube-measure-field-type-door.test.ts`, both faces, with read counters).
 * This file asks the question that pin cannot: does the route relay the
 * refusal's envelope as a 400 with its code, and does `fields[]` reach the wire
 * as the service describes it.
 *
 * The analytics service is the one `AnalyticsServicePlugin` composes over a
 * real `ObjectQL` engine and `SqlDriver`: `sourceFieldMeta` wired from the
 * engine's registry, both auto-bridges live, the cube handed in as
 * `AnalyticsServiceConfig.cubes` (the config key the CLI threads an app's
 * `analyticsCubes` into). The SQLite cell always runs; the PostgreSQL cell runs
 * where `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise. No CI step
 * provisions that variable for this package, so the live cell is red-capable
 * and un-run in CI; the PR that landed this file carries its local PostgreSQL
 * 16 run. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { AnalyticsServicePlugin } from '@objectstack/service-analytics';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const OBJECT = 'os21044_route_ledger';

const LEDGER = {
    name: OBJECT,
    label: 'Cube measure route ledger',
    fields: {
        note: { name: 'note', type: 'text' as const },
        opened_at: { name: 'opened_at', type: 'datetime' as const },
        amount: { name: 'amount', type: 'number' as const },
    },
};

const ROWS = [
    { id: 'r1', note: 'x', opened_at: '2026-01-02T03:04:05.000Z', amount: 10 },
    { id: 'r2', note: 'y', opened_at: '2026-03-04T05:06:07.000Z', amount: 32 },
] as const;

const CUBE = {
    name: 'os21044_route_cube',
    title: 'Cube measure route cube',
    sql: OBJECT,
    public: true,
    measures: {
        max_note: { type: 'max', sql: 'note', label: 'Largest note (text)' },
        max_opened: { type: 'max', sql: 'opened_at', label: 'Latest opening (datetime)' },
        max_amount: { type: 'max', sql: 'amount', label: 'Largest amount (number)' },
    },
    dimensions: {},
};

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

// ── harness (the shape `analytics-authored-cube-format-granularity.test.ts` uses) ──

// The analytics domain refuses an anonymous caller first (ADR-0056 D2), so this
// harness signs its caller in the way that file does: an `auth` slot in the
// shape `resolveExecutionContext` reads answers a session for every request.
// Only identity is stubbed; the route, the service and the engine are real.
const SIGNED_IN_AUTH = { api: { getSession: async () => ({ user: { id: 'usr_analytics_caller' } }) } };

type Handler = (req: unknown, res: unknown) => unknown;

function makeFakeServer() {
    const handlers: Record<string, Handler> = {};
    const rec = (verb: string) => (path: string, handler: Handler) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
    };
}

function makeCtx(fakeServer: unknown, analytics: unknown) {
    const kernel = {
        getService: (name: string) => (name === 'analytics' ? analytics : name === 'auth' ? SIGNED_IN_AUTH : undefined),
        getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : name === 'auth' ? SIGNED_IN_AUTH : undefined),
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: quiet,
        hook: () => {},
        on: () => {},
    } as any;
}

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
        `[#21044] POST /api/v1/analytics/query — a cube measure the aggregate × field-type table refuses is a 400 — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
        () => {
            let driver: any;
            let engine: ObjectQL;
            const post: Partial<Record<Face, (body: unknown) => Promise<{ status: number; body: any }>>> = {};

            const dropTable = async () => {
                if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
            };

            beforeAll(async () => {
                driver = new SqlDriver(config as any);
                await dropTable();
                engine = new ObjectQL({ logger: quiet } as any);
                engine.registerDriver(driver, true);
                await engine.init();
                engine.registry.registerObject(LEDGER as any);
                await engine.syncSchemas();
                for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

                for (const [face, caps] of [
                    ['native', undefined],
                    ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
                ] as const) {
                    const registered: Record<string, unknown> = {};
                    await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
                        getService: (name: string) => (name === 'data' ? engine : registered[name]),
                        registerService: (name: string, svc: unknown) => { registered[name] = svc; },
                        replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
                        hook: () => {},
                        logger: quiet,
                    } as never);
                    const { server, handlers } = makeFakeServer();
                    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
                    await plugin.start?.(makeCtx(server, registered.analytics));
                    const handler = handlers['POST /api/v1/analytics/query'];
                    expect(handler, 'POST /api/v1/analytics/query must be mounted').toBeTypeOf('function');
                    post[face] = async (body) => {
                        const res = makeRes();
                        // What the wire carries: JSON, both ways.
                        await handler({ body: JSON.parse(JSON.stringify(body)), query: {} }, res);
                        return { status: res.statusCode ?? 200, body: JSON.parse(JSON.stringify(res.body ?? null)) };
                    };
                }
            });

            afterAll(async () => {
                await dropTable();
                try { await engine?.destroy(); } catch { /* noop */ }
            });

            for (const face of FACES) {
                it(`${face}: max over a text column answers 400 INVALID_FIELD, and nothing is served`, async () => {
                    const res = await post[face]!({ cube: CUBE.name, measures: ['max_note'] });
                    expect(res.status, JSON.stringify(res.body)).toBe(400);
                    expect(res.body.success).toBe(false);
                    expect(res.body.error.code).toBe('INVALID_FIELD');
                    expect(res.body.error.httpStatus).toBe(400);
                    expect(res.body.data).toBeUndefined();
                });

                it(`${face}: the control — max over a number column is served, a number typed number`, async () => {
                    const res = await post[face]!({ cube: CUBE.name, measures: ['max_amount'] });
                    expect(res.status, JSON.stringify(res.body)).toBe(200);
                    const fields = res.body.data.fields as Array<{ name: string; type: string }>;
                    expect(res.body.data.rows[0].max_amount).toBe(32);
                    expect(fields.find((f) => f.name === 'max_amount')?.type).toBe('number');
                });

                it(`${face}: an accepted temporal pair is served and reaches the wire typed time`, async () => {
                    const res = await post[face]!({ cube: CUBE.name, measures: ['max_opened'] });
                    expect(res.status, JSON.stringify(res.body)).toBe(200);
                    const fields = res.body.data.fields as Array<{ name: string; type: string }>;
                    expect(res.body.data.rows[0].max_opened).not.toBeNull();
                    expect(fields.find((f) => f.name === 'max_opened')?.type).toBe('time');
                });
            }
        },
    );
}
