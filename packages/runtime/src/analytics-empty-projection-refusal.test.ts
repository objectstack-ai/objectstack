// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /analytics/query` and `POST /analytics/sql` refuse a query that SELECTS
 * NOTHING at the door: no measure, no dimension and no `timeDimensions` entry
 * with a `granularity` answers `400 VALIDATION_FAILED` with a `fields[]` entry
 * at `measures`, and the analytics service is never reached.
 *
 * The defect this pins shut: the schema accepts `measures: []` (a
 * dimension-only query is legal) and has no cross-field rule, so the empty
 * projection reached the engine, which ran `SELECT  FROM "<table>"` and
 * answered `500 DATABASE_ERROR`; the `/analytics/sql` echo of the same body
 * printed that statement as a 200. Both doors share one body check.
 *
 * Harness: the shape `analytics-empty-cube-refusal.test.ts` uses to drive the
 * mounted route through `dispatcher-plugin`'s thrown-error exit.
 */

// Paid at collection, not inside a case's clock (check:test-source-alias).
import '@objectstack/metadata';
import { describe, it, expect } from 'vitest';
import { ApiErrorSchema } from '@objectstack/spec/api';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

// [#21061] The analytics domain refuses an anonymous caller first (ADR-0056 D2),
// so this harness signs its caller in; only identity is stubbed.
const SIGNED_IN_AUTH = { api: { getSession: async () => ({ user: { id: 'usr_analytics_caller' } }) } };

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
    };
}

function makeCtx(fakeServer: any, calls: { query: unknown[]; sql: unknown[] }) {
    const analytics = {
        query: async (body: unknown) => { calls.query.push(body); return { rows: [], fields: [] }; },
        getMeta: async () => [],
        generateSql: async (body: unknown) => { calls.sql.push(body); return { sql: 'SELECT 1', params: [] }; },
    };
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
        json(b: any) { res.body = b; return res; },
    };
    return res;
}

type Door = '/analytics/query' | '/analytics/sql';

async function post(path: Door, body: unknown) {
    const { server, handlers } = makeFakeServer();
    const calls = { query: [] as unknown[], sql: [] as unknown[] };
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(makeCtx(server, calls));
    const handler = handlers[`POST /api/v1${path}`];
    expect(handler, `POST /api/v1${path} must be mounted`).toBeTypeOf('function');
    const res = makeRes();
    await handler({ body, query: {} }, res);
    return { res, calls };
}

const serviceCalls = (calls: { query: unknown[]; sql: unknown[] }) => [...calls.query, ...calls.sql];

const EMPTY_PROJECTIONS: Array<[string, Record<string, unknown>]> = [
    ['`measures: []`, no dimensions', { cube: 'orders', measures: [] }],
    ['`measures: []`, `dimensions: []`', { cube: 'orders', measures: [], dimensions: [] }],
    [
        '`measures: []` with a date-range-only time dimension',
        { cube: 'orders', measures: [], timeDimensions: [{ dimension: 'orders.created_at', dateRange: ['2026-01-01', '2026-01-31'] }] },
    ],
];

describe.each<Door>(['/analytics/query', '/analytics/sql'])('%s — an empty projection', (door) => {
    it.each(EMPTY_PROJECTIONS)('%s answers 400 VALIDATION_FAILED at `measures`, and never calls the service', async (_label, body) => {
        const { res, calls } = await post(door, body);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.httpStatus).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details.fields).toEqual([
            expect.objectContaining({ field: 'measures', code: 'min_items' }),
        ]);
        // The whole point: a client input mistake is no longer the engine's 500.
        expect(serviceCalls(calls)).toEqual([]);
    });

    it('the envelope parses against ApiErrorSchema', async () => {
        const { res } = await post(door, { cube: 'orders', measures: [] });
        const parsed = ApiErrorSchema.safeParse(res.body.error);
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });

    it.each<[string, Record<string, unknown>]>([
        ['one measure, no dimension', { cube: 'orders', measures: ['orders.count'] }],
        ['a dimension-only query', { cube: 'orders', measures: [], dimensions: ['orders.status'] }],
        [
            'a bucketed time dimension only',
            { cube: 'orders', measures: [], timeDimensions: [{ dimension: 'orders.created_at', granularity: 'month' }] },
        ],
    ])('preservation: %s reaches the service with the body untouched', async (_label, body) => {
        const { res, calls } = await post(door, body);

        expect(res.statusCode ?? 200).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serviceCalls(calls)).toEqual([body]);
    });
});
