// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `POST /analytics/query` and `POST /analytics/sql` refuse an EMPTY cube name
 * at the door — `400 VALIDATION_FAILED`, a `fields[]` entry at `cube` — and
 * the analytics service is never reached.
 *
 * The defect this pins shut: `AnalyticsQueryRequestSchema.cube` was a bare
 * `z.string()`, so `{ cube: '' }` passed the door as "a string" and reached the
 * engine, whose own guard threw a plain `Error`, which the dispatcher mapped
 * to `500 INTERNAL_ERROR` — a client input mistake answered as a server fault,
 * while the same body with `cube` left out answered 400. The accept set closes
 * at the schema (`.min(1)`, one prescriptive sentence), so the assertions read
 * the code, the status, the field entry and the "service not called" fact.
 *
 * Harness: the shape `analytics-daterange-refusal-envelope.test.ts` uses to
 * drive the mounted route through `dispatcher-plugin`'s thrown-error exit.
 */

import { describe, it, expect } from 'vitest';
import { ApiErrorSchema, ANALYTICS_CUBE_NAME_REQUIRED } from '@objectstack/spec/api';

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

describe.each<Door>(['/analytics/query', '/analytics/sql'])('%s — an empty cube name', (door) => {
    it('answers 400 VALIDATION_FAILED with a `cube` field entry, and never calls the service', async () => {
        const { res, calls } = await post(door, { cube: '', measures: ['x.count'] });

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error.httpStatus).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        // The per-field carrier the UI anchors on: the ADR-0114 catalog code for
        // a too-short string, never Zod's `too_small`.
        expect(res.body.error.details.fields).toEqual([
            { field: 'cube', code: 'min_length', message: ANALYTICS_CUBE_NAME_REQUIRED },
        ]);
        // The message locates the field and carries the schema's prescription.
        expect(res.body.error.message).toContain('cube: Name the cube to query');
        // The whole point: a client input mistake is no longer the engine's 500.
        expect(serviceCalls(calls)).toEqual([]);
    });

    it('the envelope parses against ApiErrorSchema', async () => {
        const { res } = await post(door, { cube: '', measures: ['x.count'] });
        const parsed = ApiErrorSchema.safeParse(res.body.error);
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });

    it('a missing cube keeps the 400 VALIDATION_FAILED it already had, now with the `required` field code', async () => {
        const { res, calls } = await post(door, { measures: ['x.count'] });

        expect(res.statusCode).toBe(400);
        expect(res.body.error.httpStatus).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_FAILED');
        expect(res.body.error.details.fields).toHaveLength(1);
        // `required`, the ADR-0114 D3 code for an ABSENT key — the door hands
        // the body to the mapper now; it used to answer Zod's `invalid_type`
        // for the same body. The same code the engine's in-process guard
        // answers (service-analytics `cube-name-refusal.ts`), so one condition
        // reads one code on both sides; and the one prescription, carried by
        // the member's type-level `error`, not Zod's generic words.
        expect(res.body.error.details.fields[0]).toEqual({ field: 'cube', code: 'required', message: ANALYTICS_CUBE_NAME_REQUIRED });
        expect(res.body.error.message).toContain('cube: Name the cube to query');
        expect(serviceCalls(calls)).toEqual([]);
    });

    it('the `required` code reaches `measures` left out and a bodiless request too', async () => {
        // The door hands the body to the mapper, so the D3 split reports a
        // missing key as `required` (it used to read `invalid_type`): the two
        // other cases the changeset names, pinned by field and code (their
        // messages are Zod's own, no sentence of this change's).
        const noMeasures = await post(door, { cube: 'orders' });
        expect(noMeasures.res.statusCode).toBe(400);
        expect(noMeasures.res.body.error.code).toBe('VALIDATION_FAILED');
        expect(noMeasures.res.body.error.details.fields).toEqual([
            expect.objectContaining({ field: 'measures', code: 'required' }),
        ]);

        const noBody = await post(door, undefined);
        expect(noBody.res.statusCode).toBe(400);
        expect(noBody.res.body.error.code).toBe('VALIDATION_FAILED');
        expect(noBody.res.body.error.details.fields).toEqual([
            expect.objectContaining({ field: '(body)', code: 'required' }),
        ]);
        expect(serviceCalls(noMeasures.calls)).toEqual([]);
        expect(serviceCalls(noBody.calls)).toEqual([]);
    });

    it('preservation: a named cube reaches the service with the body untouched', async () => {
        const body = { cube: 'orders', measures: ['orders.count'] };
        const { res, calls } = await post(door, body);

        expect(res.statusCode ?? 200).toBe(200);
        expect(res.body.success).toBe(true);
        expect(serviceCalls(calls)).toEqual([body]);
    });
});
