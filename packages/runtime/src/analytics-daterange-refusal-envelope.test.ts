// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16041] `POST /analytics/query` (and `/analytics/sql`) refuse a
 * `timeDimensions[].dateRange` string outside the closed date-range vocabulary
 * AT THE DOOR, with the ADR-0112 envelope `400 ANALYTICS_DATE_RANGE_UNRECOGNIZED`
 * — and the analytics service is never reached.
 *
 * The defect this pins shut is a silent widening: the schema's arm was a bare
 * `z.string()`, so `"Last 7 days"` (the schema comment's own example) passed the
 * door, reached driver-memory as written, fell through to a `[range, range]`
 * pseudo-window and matched EVERY `Date`-typed row at HTTP 200. Maintainer
 * ruling (decision batch #57, option A): the vocabulary closes at the schema and
 * any other string is refused with a stable code. The schema raises one
 * prescriptive issue and exports the structural predicate
 * (`isAnalyticsDateRangeRefusalIssue`); this door lifts it into the registered
 * code — so the assertions read the code, the status and the "service not
 * called" fact, never message prose.
 *
 * Harness: the shape `dispatcher-validation-error.test.ts` uses to drive the
 * mounted route through `dispatcher-plugin`'s thrown-error exit.
 */

import { describe, it, expect } from 'vitest';
import { ApiErrorSchema } from '@objectstack/spec/api';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

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
        query: async (body: unknown) => { calls.query.push(body); return { data: [] }; },
        getMeta: async () => ({ cubes: [] }),
        generateSql: async (body: unknown) => { calls.sql.push(body); return { sql: 'SELECT 1', params: [] }; },
    };
    const kernel = {
        getService: (name: string) => (name === 'analytics' ? analytics : undefined),
        getServiceAsync: async (name: string) => (name === 'analytics' ? analytics : undefined),
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

async function post(path: '/analytics/query' | '/analytics/sql', body: unknown) {
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

const body = (dateRange: unknown, extra: Record<string, unknown> = {}) => ({
    cube: 'orders',
    measures: ['count'],
    timeDimensions: [{ dimension: 'created_at', granularity: 'day', dateRange, ...extra }],
});

describe('#16041 — /analytics/query refuses an unrecognised dateRange string at the door', () => {
    it('answers 400 ANALYTICS_DATE_RANGE_UNRECOGNIZED for "Last 7 days" and never calls the service', async () => {
        const { res, calls } = await post('/analytics/query', body('Last 7 days'));

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.httpStatus).toBe(400);
        expect(res.body.error.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
        // A registered code is served verbatim — nothing was demoted.
        expect(res.body.error.declaredCode).toBeUndefined();
        // The message locates the field and carries the schema's prescription.
        expect(res.body.error.message).toContain('timeDimensions.0.dateRange');
        expect(res.body.error.message).toContain('"Last 7 days"');
        expect(res.body.error.message).toContain('last_7_days');
        // The whole point: the silent widening never reaches an engine.
        expect(calls.query).toEqual([]);
    });

    it('the envelope parses against ApiErrorSchema — the code is a vocabulary member, not a dialect', async () => {
        const { res } = await post('/analytics/query', body('last 3 months'));
        const parsed = ApiErrorSchema.safeParse(res.body.error);
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
        expect(res.body.error.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
    });

    it('/analytics/sql shares the body contract and refuses identically', async () => {
        const { res, calls } = await post('/analytics/sql', body('2026-01-20'));
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('ANALYTICS_DATE_RANGE_UNRECOGNIZED');
        expect(calls.sql).toEqual([]);
    });

    it('a preset name passes the door and the ORIGINAL body reaches the service untouched', async () => {
        const request = body('last_7_days');
        const { res, calls } = await post('/analytics/query', request);
        expect(res.statusCode ?? 200).toBe(200);
        expect(calls.query).toHaveLength(1);
        // Validation-only: the door forwards the caller's body, not a parse.
        expect(calls.query[0]).toBe(request);
    });

    it('the array arm is untouched by the closing', async () => {
        const { res, calls } = await post('/analytics/query', body(['2026-01-01', '2026-01-31']));
        expect(res.statusCode ?? 200).toBe(200);
        expect(calls.query).toHaveLength(1);
    });

    it('a body wrong in MORE than the dateRange stays the generic VALIDATION_FAILED + fields[] — the lift is all-or-nothing', async () => {
        const { res, calls } = await post('/analytics/query', body('Last 7 days', { granuarity: 'day' }));
        expect(res.statusCode).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        const fields: Array<{ field: string }> = res.body.error.details.fields;
        expect(fields.map((f) => f.field)).toContain('timeDimensions.0.dateRange');
        expect(fields.some((f) => f.field.startsWith('timeDimensions.0'))).toBe(true);
        expect(calls.query).toEqual([]);
    });
});
