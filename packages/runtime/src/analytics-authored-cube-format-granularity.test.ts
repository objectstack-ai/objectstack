// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `analytics_cube.measures.format` and `analytics_cube.dimensions.granularities`
 * over the wire: an AUTHORED cube's two keys reach `POST /api/v1/analytics/query`
 * and `POST /api/v1/analytics/sql` through the real dispatcher route.
 *
 * The service door is pinned beside the implementation
 * (`service-analytics` `cube-authored-format-granularity.test.ts`, each case
 * against a compiled-dataset control). This file asks the question that pin
 * cannot: does what the service answers survive the route — `fields[].format`
 * is a member `deps.success()` relays verbatim, and the dry-run door serves
 * the bucketed statement `query()` runs.
 *
 * The cube is handed to the service as `AnalyticsServiceConfig.cubes`, the
 * config key the CLI threads an app's `analyticsCubes` into — the authoring
 * door, not a registered dataset.
 */

import { describe, it, expect } from 'vitest';
import { CubeSchema } from '@objectstack/spec/data';
import { AnalyticsService } from '@objectstack/service-analytics';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// [#21061] The analytics domain refuses an anonymous caller first (ADR-0056 D2),
// so this harness signs its caller in: an `auth` slot in the shape
// `resolveExecutionContext` reads answers a session for every request. Only
// identity is stubbed; the route, the service and every expectation are
// unchanged. Anonymity is pinned in `domains/analytics-anonymous-deny.test.ts`.
const SIGNED_IN_AUTH = { api: { getSession: async () => ({ user: { id: 'usr_analytics_caller' } }) } };

// ── harness (the shape `analytics-query-read-scope-withhold.test.ts` uses) ────

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
        logger: { info() {}, warn() {}, error() {}, debug() {} },
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

/** Drive the REAL `POST /api/v1/analytics/<sub>` route against `analytics`. */
async function post(analytics: unknown, sub: 'query' | 'sql', body: unknown) {
    const { server, handlers } = makeFakeServer();
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, analytics));
    const handler = handlers[`POST /api/v1/analytics/${sub}`];
    expect(handler, `POST /api/v1/analytics/${sub} must be mounted`).toBeTypeOf('function');
    const res = makeRes();
    await handler({ body, query: {} }, res);
    return res;
}

const silent = { debug() {}, info() {}, warn() {}, error() {} };

/** Parsed the way `defineCube()` and `defineStack({ analyticsCubes })` parse an authored cube. */
const orders = CubeSchema.parse({
    name: 'orders',
    sql: 'shop_order',
    measures: {
        count: { label: 'Orders', type: 'count', sql: '*' },
        revenue: { label: 'Revenue', type: 'sum', sql: 'amount', format: '$0,0.00' },
    },
    dimensions: {
        status: { label: 'Status', type: 'string', sql: 'status' },
        placed_at: { label: 'Placed', type: 'time', sql: 'placed_at', granularities: ['month'] },
    },
});

type GroupByItem = string | { field: string; dateGranularity?: string };

/** The composition `AnalyticsServicePlugin` wires by default: both strategies. */
function analytics() {
    const groupBys: GroupByItem[][] = [];
    const service = new AnalyticsService({
        logger: silent,
        cubes: [orders],
        queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
        executeRawSql: async () => [{ status: 'open', count: 2, revenue: 10 }],
        executeAggregate: async (_object, options) => {
            groupBys.push((options.groupBy ?? []) as GroupByItem[]);
            return [{ placed_at: '2026-07', count: 2 }];
        },
    });
    return { service, groupBys };
}

describe('POST /analytics/query — an authored cube measure\'s `format` reaches `fields[]`', () => {
    it('the measure column carries the declared format; an undeclared one and a dimension carry none', async () => {
        const res = await post(analytics().service, 'query', {
            cube: 'orders',
            measures: ['orders.revenue', 'orders.count'],
            dimensions: ['orders.status'],
        });

        expect(res.statusCode).toBe(200);
        const fields = res.body.data.fields as Array<{ name: string; format?: string }>;
        expect(fields.find((f) => f.name === 'orders.revenue')?.format).toBe('$0,0.00');
        expect(fields.find((f) => f.name === 'orders.count')).not.toHaveProperty('format');
        expect(fields.find((f) => f.name === 'orders.status')).not.toHaveProperty('format');
    });
});

describe('an authored time dimension\'s single declared granularity is its default bucket over the wire', () => {
    it('POST /analytics/query groups the dimension at the declared granularity', async () => {
        const { service, groupBys } = analytics();

        const res = await post(service, 'query', { cube: 'orders', measures: ['count'], dimensions: ['placed_at'] });

        expect(res.statusCode).toBe(200);
        expect(groupBys).toEqual([[{ field: 'placed_at', dateGranularity: 'month' }]]);
        expect(res.body.data.rows).toEqual([{ placed_at: '2026-07', count: 2 }]);
    });

    // [#21647] This case asserted 200 and `date_trunc('month'` / `date_trunc('year'`:
    // the representative bucket the SQL echo printed for a host with no
    // `dateBucketSql` hook, which no driver groups by. This host composes the
    // service directly, with no hook and no driver behind it, so the dry run now
    // answers the service's declared refusal (`NOT_IMPLEMENTED` / 501,
    // `refusal: true` at throw time). This exit reads that declaration to keep
    // the producer's message instead of withholding a 5xx as a fault, so the
    // message reaching the wire IS the declaration's effect: it names the bucket
    // it refused and the cause, the declared default for the first request and
    // the stated granularity for the second. Where a hook answers, the
    // service-level pin (`service-analytics` `cube-authored-format-granularity.test.ts`)
    // asserts the driver's expression.
    it('POST /analytics/sql dry-runs the bucket at the declared granularity, and a stated granularity still wins (no dateBucketSql hook: the declared refusal)', async () => {
        const declared = await post(analytics().service, 'sql', { cube: 'orders', measures: ['count'], dimensions: ['placed_at'] });
        const stated = await post(analytics().service, 'sql', {
            cube: 'orders',
            measures: ['count'],
            dimensions: ['placed_at'],
            timeDimensions: [{ dimension: 'placed_at', granularity: 'year' }],
        });

        for (const [res, granularity] of [[declared, 'month'], [stated, 'year']] as const) {
            expect(res.statusCode, granularity).toBe(501);
            expect(res.body.success, granularity).toBe(false);
            expect(res.body.error.code, granularity).toBe('NOT_IMPLEMENTED');
            expect(res.body.error.message, granularity).toContain(`"${granularity}" bucket of "placed_at"`);
            expect(res.body.error.message, granularity).toContain('dateBucketSql');
        }
    });
});
