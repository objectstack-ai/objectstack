// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24025] The dispatcher's observability Proxy wraps EVERY route verb.
 *
 * ## What went wrong
 *
 * `createDispatcherPlugin` wraps its `IHttpServer` in a Proxy that hands each
 * route registration to `instrumentRouteHandler`. The trap named `get`, `post`
 * and `delete` only, so a route mounted through `put` or `patch` was registered
 * bare. Measured on a stock showcase boot: `PUT` and `PATCH /api/v1/keys`
 * answered with no `X-Request-Id`, while `GET` and `DELETE` on the same boot
 * carried one. A bare mount loses everything the wrapper owns on every
 * transport — the request-id echo or mint, `req.requestId`, the 5xx
 * `errorReporter` capture, and the `res.__obsRequest` coordinates the 5xx log
 * line prints — and, on a transport without `afterResponse`, the counter and
 * the histogram as well.
 *
 * ## How the pins are shaped
 *
 * The REAL plugin over a fake transport that records each registration's
 * handler — i.e. whatever the Proxy handed down. Every block is a table over
 * the five verbs, so GET/POST/DELETE, wrapped all along, are the in-file
 * positive control: if those rows go red, the harness is wrong, not the Proxy.
 *
 *  - request id and metrics: `/api/v1/keys`, mounted for every verb. The
 *    assertions read what the wrapper wrote (the header, `req.requestId`, the
 *    samples), never the status — the domain answers this anonymous caller
 *    401, which is beside the point here.
 *  - 5xx capture: the `/api/v1/ai/*` wildcards, also mounted for every verb,
 *    and throw-transparent: a route-table handler that throws leaves
 *    `dispatch()` and lands in the route's `errorResponse`, which parks the
 *    error on `res.__obsRecordedError` for the wrapper to report. One more row
 *    drives a service-emitted PATCH route (`ai:routes` → `mountRouteOnServer`),
 *    the other helper that registers PATCH through the Proxy.
 *
 * The fake transport has no `afterResponse`, so the wrapper is the metrics
 * emitter here. The wire-level twin — the header on a real Hono socket, with
 * the transport still counting PUT and PATCH exactly once — is in
 * `http-metrics-inbound-coverage.hono.integration.test.ts` §5.
 */

import { describe, it, expect, vi } from 'vitest';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
import {
    InMemoryErrorReporter,
    InMemoryMetricsRegistry,
    RUNTIME_METRICS,
    type ErrorReporter,
    type MetricsRegistry,
} from './observability/index.js';

const VERBS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Verb = (typeof VERBS)[number];

const KEYS_ROUTE = '/api/v1/keys';
const AI_WILDCARD = '/api/v1/ai/*';
const AI_PROBE_PATH = '/api/v1/ai/probe';
/** `generateRequestId`'s shape — the docs' `req_<hex>`. */
const MINTED_ID = /^req_[0-9a-f]+$/;

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: Verb) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            patch: rec('PATCH'),
            delete: rec('DELETE'),
        },
    };
}

function makeRes() {
    const headers: Record<string, string> = {};
    const res: any = {
        statusCode: undefined as number | undefined,
        body: undefined as any,
        headers,
        status(c: number) { res.statusCode = c; return res; },
        header(k: string, v: string) { headers[k] = v; return res; },
        json(b: any) { res.body = b; return res; },
        end() { return res; },
    };
    return res;
}

function makeReq(path: string, headers: Record<string, string> = {}): any {
    return { headers, body: {}, query: {}, params: {}, path };
}

interface BootOptions {
    services?: Record<string, unknown>;
    /** The host kernel's AI route table, which `dispatch()` reads for `/ai/*`. */
    aiRoutes?: unknown[];
    observability?: { metrics?: MetricsRegistry; errorReporter?: ErrorReporter };
}

/** Boot the real plugin over a fake transport, with a spied kernel logger. */
async function boot(opts: BootOptions = {}) {
    const services = opts.services ?? {};
    const kernel = {
        getService: (n: string) => services[n],
        getServiceAsync: async (n: string) => services[n],
        __aiRoutes: opts.aiRoutes,
    };
    const hooks: Record<string, (...args: any[]) => unknown> = {};
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
    const { server, handlers } = makeFakeServer();
    const ctx: any = {
        getKernel: () => kernel,
        getService: (n: string) => (n === 'http.server' ? server : undefined),
        environmentId: undefined,
        logger,
        hook: (name: string, fn: (...args: any[]) => unknown) => { hooks[name] = fn; },
        on: () => { },
    };
    const plugin = createDispatcherPlugin({
        prefix: '/api/v1',
        securityHeaders: false,
        observability: opts.observability,
    });
    await plugin.start?.(ctx);
    return { handlers, hooks, logger };
}

function mounted(handlers: Record<string, (req: any, res: any) => any>, key: string) {
    const handler = handlers[key];
    expect(handler, `${key} must be mounted`).toBeTypeOf('function');
    return handler;
}

/** Only the records the 5xx rule writes — boot-time chatter is not a fault. */
function faultRecords(logger: { error: { mock: { calls: any[][] } } }) {
    return logger.error.mock.calls.filter((c) => String(c[0]).startsWith('[5xx]'));
}

describe('[#24025] every route verb carries the request id', () => {
    it.each(VERBS)('%s /api/v1/keys echoes a valid inbound X-Request-Id and sets req.requestId', async (verb) => {
        const { handlers } = await boot();
        const inbound = `probe-${verb.toLowerCase()}-24025`;
        const req = makeReq(KEYS_ROUTE, { 'x-request-id': inbound });
        const res = makeRes();

        await mounted(handlers, `${verb} ${KEYS_ROUTE}`)(req, res);

        expect(res.headers['X-Request-Id']).toBe(inbound);
        expect(req.requestId).toBe(inbound);
    });

    it.each(VERBS)('%s /api/v1/keys mints req_<hex> when no inbound id is sent', async (verb) => {
        const { handlers } = await boot();
        const req = makeReq(KEYS_ROUTE);
        const res = makeRes();

        await mounted(handlers, `${verb} ${KEYS_ROUTE}`)(req, res);

        expect(res.headers['X-Request-Id']).toMatch(MINTED_ID);
        expect(req.requestId).toBe(res.headers['X-Request-Id']);
    });
});

describe('[#24025] a 5xx on every route verb reaches the error reporter', () => {
    it.each(VERBS)('%s /api/v1/ai/* hands the thrown fault to errorReporter, and the 5xx line keeps its coordinates', async (verb) => {
        const thrown = new Error(`boom-${verb.toLowerCase()}`);
        const errorReporter = new InMemoryErrorReporter();
        const { handlers, logger } = await boot({
            services: { ai: {} },
            aiRoutes: [{ method: verb, path: AI_PROBE_PATH, auth: false, handler: async () => { throw thrown; } }],
            observability: { errorReporter },
        });
        const inbound = `probe-5xx-${verb.toLowerCase()}`;
        const res = makeRes();

        await mounted(handlers, `${verb} ${AI_WILDCARD}`)(makeReq(AI_PROBE_PATH, { 'x-request-id': inbound }), res);

        expect(res.statusCode).toBe(500);
        expect(errorReporter.captured).toHaveLength(1);
        expect(errorReporter.captured[0].error).toBe(thrown);
        expect(errorReporter.captured[0].context).toMatchObject({ requestId: inbound, method: verb, route: AI_WILDCARD });

        // The log line reads its coordinates off `res.__obsRequest`, which only
        // the wrapper parks — a bare mount prints status and code alone.
        const records = faultRecords(logger);
        expect(records, 'exactly one fault line per fault').toHaveLength(1);
        expect(records[0][2]).toMatchObject({ status: 500, method: verb, path: AI_WILDCARD, requestId: inbound });
    });

    it('a service-emitted PATCH route (ai:routes → mountRouteOnServer) reports its 5xx too', async () => {
        const thrown = new Error('boom-emitted-patch');
        const errorReporter = new InMemoryErrorReporter();
        const { handlers, hooks } = await boot({ observability: { errorReporter } });
        expect(hooks['ai:routes'], 'the plugin subscribes to ai:routes').toBeTypeOf('function');
        await hooks['ai:routes']([
            {
                method: 'PATCH',
                path: '/ai/emitted-probe',
                description: 'a service-emitted PATCH route that faults',
                auth: false,
                handler: async () => { throw thrown; },
            },
        ]);
        const route = '/api/v1/ai/emitted-probe';
        const inbound = 'probe-emitted-patch';
        const res = makeRes();

        await mounted(handlers, `PATCH ${route}`)(makeReq(route, { 'x-request-id': inbound }), res);

        expect(res.statusCode).toBe(500);
        expect(res.headers['X-Request-Id']).toBe(inbound);
        expect(errorReporter.captured).toHaveLength(1);
        expect(errorReporter.captured[0].error).toBe(thrown);
        expect(errorReporter.captured[0].context).toMatchObject({ requestId: inbound, method: 'PATCH', route });
    });
});

describe('[#24025] on a transport without afterResponse, every verb is counted and timed under its own method label', () => {
    it.each(VERBS)('%s /api/v1/keys emits one counter sample and one duration sample labelled %s', async (verb) => {
        const metrics = new InMemoryMetricsRegistry();
        const { handlers } = await boot({ observability: { metrics } });

        await mounted(handlers, `${verb} ${KEYS_ROUTE}`)(makeReq(KEYS_ROUTE), makeRes());

        expect(metrics.totalCounter(RUNTIME_METRICS.httpRequestsTotal, { method: verb, route: KEYS_ROUTE })).toBe(1);
        expect(metrics.histogramValues(RUNTIME_METRICS.httpRequestDurationMs, { method: verb, route: KEYS_ROUTE })).toHaveLength(1);
        // Nothing lands under another verb's label: the method is the trap's
        // property name, upper-cased, and nothing else.
        expect(metrics.totalCounter(RUNTIME_METRICS.httpRequestsTotal, { route: KEYS_ROUTE })).toBe(1);
    });
});
