// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declarative-endpoint chain, through a REAL boot (#5040 E3 / E5b).
 *
 * `api-endpoint-step.test.ts` covers the decision; this file covers the
 * WIRING — LiteKernel + the real Hono transport + the real dispatcher plugin,
 * driven over a real socket. That distinction is the whole reason #4936 found
 * two broken links at once: the old `handleApiEndpoint` branch was unit-tested
 * by calling `dispatch()` directly, which is exactly the shortcut that hid the
 * fact that nothing ever mounted the paths it claimed to serve. "Who serves
 * this path" is a question about the composed runtime; ask it there.
 *
 * Since #5129 the seam serves the whole chain — policies (E4) then target
 * delegation (E5) — so the cases below drive REAL `callData` and a REAL
 * automation slot, and pin the two things only a socket can prove: that a 429
 * carries its `Retry-After` ON THE WIRE, and that a `cacheTtl` `Cache-Control`
 * rides a success and never an error.
 *
 * The load-bearing assertion in most of these is a NEGATIVE one: that adding
 * this seam changed nothing for anybody who did not ask for it. The unmatched
 * answers — the transport's 404 and the 405 + `Allow` — must come back byte for
 * byte for every path no declaration owns. Since the #5040 E7 publish flip that is
 * the assertion's whole weight: stacks CAN declare endpoints now, so "the
 * fallback stays silent unless a declaration matches" is a promise to live
 * deployments rather than a property of a surface nothing could reach.
 *
 * NOTE on the body guarantee: that the fallback receives a READABLE `req.body`
 * (the difference from the `use()` middleware seam) is a transport promise, and
 * is asserted against the real adapter in
 * `packages/plugins/plugin-hono-server/src/fallback-seam.test.ts`. Here the
 * body-carrying case is driven end to end (a POST with JSON reaching the step)
 * so the two halves are known to compose.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/** Two declared endpoints in the ADR-0121 D1 shape (`<prefix>/apps/<ns>/…`). */
const DECLARED: ApiEndpoint[] = [
    ApiEndpointSchema.parse({
        name: 'showcase_tasks',
        path: '/api/v1/apps/showcase/tasks',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
    }),
    ApiEndpointSchema.parse({
        name: 'showcase_purge_inquiries',
        path: '/api/v1/apps/showcase/inquiries/purge',
        method: 'POST',
        type: 'flow',
        target: 'showcase_inquiry_janitor',
    }),
];

/** Every `matchEndpoint` query the boot made, in order. */
const queries: Array<{ path: string; method: string }> = [];

/**
 * A `metadata` slot occupant. `withMatcher: false` is the #5089-not-landed
 * shape — the member simply absent, which the contract says consumers probe for
 * with `typeof === 'function'`.
 */
function fakeMetadataPlugin(options: { withMatcher: boolean; endpoints?: ApiEndpoint[] }): Plugin {
    const endpoints = options.endpoints ?? DECLARED;
    return {
        name: 'com.objectstack.test.fake-metadata',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('metadata', {
                list: async () => [],
                ...(options.withMatcher
                    ? {
                        matchEndpoint: async (q: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> => {
                            queries.push(q);
                            const hit = endpoints.find(
                                (e) => e.path === q.path.replace(/\/$/, '') && e.method === q.method.toUpperCase(),
                            );
                            return hit ? { endpoint: hit, params: {} } : undefined;
                        },
                    }
                    : {}),
            });
        },
    };
}

/** Stands in for any plugin that mounts routes — here, one PUT-only path. */
function routePlugin(): Plugin {
    return {
        name: 'com.objectstack.test.routes',
        version: '1.0.0',
        init: async () => { /* nothing */ },
        start: async (ctx: PluginContext) => {
            const server = ctx.getService<IHttpServer>('http.server');
            server.put('/api/v1/apps/showcase/tasks', (_req, res) => { res.status(200); res.json({ from: 'route' }); });
        },
    };
}

async function boot(plugins: Plugin[]) {
    const kernel = new LiteKernel();
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    for (const plugin of plugins) kernel.use(plugin);
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    return { kernel, baseUrl: `http://127.0.0.1:${httpServer.getPort!()}` };
}

async function shutdown(kernel: LiteKernel | undefined) {
    if (!kernel) return;
    await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
}

/**
 * The transport's unmatched answer, captured from a boot with no seam armed.
 *
 * The hono adapter's `unmatchedResponse()` — the declared refusal envelope
 * since #9364, previously the bare `{ error: 'Not found' }`. Every use below
 * is asserting "the transport answered, the seam did not", so the value has to
 * track the adapter; what those cases pin is the ROUTING, not the wording.
 */
const TRANSPORT_NOT_FOUND = {
    success: false,
    error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
};

describe('metadata slot carries no matchEndpoint — a fully working passthrough', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        queries.length = 0;
        ({ kernel, baseUrl } = await boot([fakeMetadataPlugin({ withMatcher: false })]));
    }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    it('answers an endpoint-shaped path with the transport\'s own 404, unchanged', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/tasks`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(TRANSPORT_NOT_FOUND);
    });

    it('serves the dispatcher\'s own routes normally', async () => {
        const res = await fetch(`${baseUrl}/.well-known/objectstack`);
        expect(res.status).toBe(200);
    });
});

describe('no metadata service at all', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => { ({ kernel, baseUrl } = await boot([])); }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    it('answers 404 rather than failing the request', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/tasks`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(TRANSPORT_NOT_FOUND);
    });
});

describe('matcher present — the endpoint dispatch step (#5090)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        queries.length = 0;
        ({ kernel, baseUrl } = await boot([fakeMetadataPlugin({ withMatcher: true }), routePlugin()]));
    }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    it('answers a MATCH by running the chain — anonymous meets `authRequired` first', async () => {
        // Both declarations keep the schema default `authRequired: true`, and
        // this boot has no auth service, so every caller is anonymous. The 401
        // is the WHOLE answer: the request never reaches execution, which is
        // what "policies, then the target" means (#5040 §3).
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/tasks`);
        expect(res.status).toBe(401);
        const body = await res.json() as { success: boolean; error: Record<string, unknown> };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('UNAUTHENTICATED');
        expect(queries).toContainEqual({ path: '/api/v1/apps/showcase/tasks', method: 'GET' });
    });

    it('reaches the step for a POST carrying a JSON body', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/inquiries/purge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ olderThanDays: 30 }),
        });
        expect(res.status).toBe(401);
        expect(queries).toContainEqual({ path: '/api/v1/apps/showcase/inquiries/purge', method: 'POST' });
    });

    it('answers a MISS under the mount with the transport\'s 404, unchanged', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/nope`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(TRANSPORT_NOT_FOUND);
        expect(queries).toContainEqual({ path: '/api/v1/apps/showcase/nope', method: 'GET' });
    });

    it('never consults the matcher for a path outside the mount', async () => {
        queries.length = 0;
        const res = await fetch(`${baseUrl}/api/v1/nope`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(TRANSPORT_NOT_FOUND);
        const notFoundOnRoot = await fetch(`${baseUrl}/totally/unrouted`);
        expect(notFoundOnRoot.status).toBe(404);
        expect(queries, 'the endpoint step ran for a path outside `/api/v1/apps/`').toEqual([]);
    });

    it('never shadows a registered route, even one under the mount prefix', async () => {
        // The structural guarantee of using `notFound` rather than a
        // `${prefix}/apps/*` wildcard: this PUT is registered by a plugin that
        // starts BEFORE the dispatcher, and it still wins — while the SAME path
        // under GET (which no route owns) reaches the endpoint step.
        queries.length = 0;
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/tasks`, { method: 'PUT' });
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ from: 'route' });
        expect(queries, 'the fallback ran for a request a registered route matched').toEqual([]);
    });

    it('keeps the 405 + `Allow` answer for a method mismatch', async () => {
        // Hono routes a method mismatch to the same not-found sink, so the
        // fallback sees these too. Declining must leave 405 intact — the
        // baseline `notfound-405.test.ts` pins without a fallback installed.
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/tasks`, { method: 'DELETE' });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('PUT');
        // The adapter's 405, in the declared envelope since #9364 — `code` and
        // the `allowed` hint moved from top-level siblings into `error` and
        // `error.details` respectively. Same two facts, one level in.
        const body = await res.json() as {
            success: boolean;
            error: { code: string; details: { allowed: string[] } };
        };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.error.details.allowed).toEqual(['PUT']);
    });

    it('answers an execution result, never the "nothing was wired" 501', async () => {
        // The two 501 branches inside the step (no policy context / no execution
        // wiring) are honest reports for a host that mounted the step by hand.
        // The COMPOSED runtime threads both, so neither may ever appear on this
        // wire — asserted rather than assumed, since the shape of the bug they
        // describe is "the seam silently stopped doing half its job".
        for (const path of ['/api/v1/apps/showcase/tasks', '/api/v1/apps/showcase/inquiries/purge']) {
            const res = await fetch(`${baseUrl}${path}`, { method: path.endsWith('purge') ? 'POST' : 'GET' });
            const text = await res.text();
            expect(res.status).not.toBe(501);
            expect(text).not.toContain('no wiring');
            expect(text).not.toContain('without a policy context');
            expect(text).not.toContain('no execution wiring');
        }
    });

    it('answers 5xx — not 404 — when the matcher itself fails', async () => {
        // `matchEndpoint`'s contract: an implementation that cannot read its
        // store MUST throw, because a miss becomes a 404 and an outage must not
        // masquerade as one.
        const brokenMetadata: Plugin = {
            name: 'com.objectstack.test.broken-metadata',
            version: '1.0.0',
            init: async (ctx: PluginContext) => {
                ctx.registerService('metadata', {
                    matchEndpoint: async () => { throw new Error('metadata store unreachable'); },
                });
            },
        };
        const { kernel: k2, baseUrl: url2 } = await boot([brokenMetadata]);
        try {
            const res = await fetch(`${url2}/api/v1/apps/showcase/tasks`);
            expect(res.status).toBeGreaterThanOrEqual(500);
            const body = await res.json() as { success: boolean };
            expect(body.success).toBe(false);
        } finally {
            await shutdown(k2);
        }
    }, 30_000);
});

// ============================================================================
// The wired chain (#5040 E5b / #5129)
// ============================================================================

/**
 * The declarations this boot serves. Each one exists to pin ONE key of the
 * chain end to end; `authRequired: false` where the case is about something
 * else, so a 401 can never be mistaken for the property under test.
 */
const EXECUTABLE: ApiEndpoint[] = [
    ApiEndpointSchema.parse({
        name: 'showcase_open_tasks',
        path: '/api/v1/apps/showcase/open-tasks',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
        authRequired: false,
    }),
    ApiEndpointSchema.parse({
        name: 'showcase_my_tasks',
        path: '/api/v1/apps/showcase/my-tasks',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
        // The schema default, spelled out: this endpoint is the auth case.
        authRequired: true,
    }),
    ApiEndpointSchema.parse({
        name: 'showcase_purge',
        path: '/api/v1/apps/showcase/purge',
        method: 'POST',
        type: 'flow',
        target: 'showcase_inquiry_janitor',
        authRequired: false,
    }),
    ApiEndpointSchema.parse({
        name: 'showcase_limited',
        path: '/api/v1/apps/showcase/limited',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
        authRequired: false,
        rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 1 },
    }),
    ApiEndpointSchema.parse({
        name: 'showcase_cached',
        path: '/api/v1/apps/showcase/cached',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'find' },
        authRequired: false,
        cacheTtl: 30,
    }),
    ApiEndpointSchema.parse({
        // Same `cacheTtl`, but a shape whose execution FAILS: `get` with no
        // `?id=` is a 400 from the executor. The pair is the whole point —
        // one key, two outcomes, only one of them cacheable.
        name: 'showcase_cached_get',
        path: '/api/v1/apps/showcase/cached-get',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
        objectParams: { object: 'showcase_task', operation: 'get' },
        authRequired: false,
        cacheTtl: 30,
    }),
];

/** Rows the fake engine serves, so a 200 body can be checked against real data. */
const TASK_ROWS = [
    { id: 'tsk_1', name: 'Draft the brief', status: 'open' },
    { id: 'tsk_2', name: 'Ship the thing', status: 'done' },
];

const ADMIN_SET = {
    id: 'ps-admin',
    name: 'admin_full_access',
    object_permissions: { '*': { viewAllRecords: true, modifyAllRecords: true } },
};

/** Every `execute` the automation slot received, with the context it was given. */
const flowRuns: Array<{ name: string; context: Record<string, unknown> }> = [];
/** Every `find` the data engine served, with the ExecutionContext it was handed. */
const engineFinds: Array<{ object: string; options: any }> = [];

/**
 * The services a real `os serve` provisions, stubbed at the KERNEL boundary —
 * not at the plugin boundary. Everything between the socket and these stubs is
 * the production path: the fallback seam, the scope resolution, the policy
 * chain, `action-execution.callData`, `buildAutomationContext`.
 */
function executionServicesPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.endpoint-execution-services',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    async getSession({ headers }: { headers: Headers }) {
                        const uid = headers.get('x-test-user');
                        return uid ? { user: { id: uid } } : null;
                    },
                },
            });
            ctx.registerService('objectql', {
                async find(object: string, options: any) {
                    engineFinds.push({ object, options });
                    if (object === 'sys_user_permission_set') {
                        return options?.where?.user_id === 'admin1'
                            ? [{ user_id: 'admin1', permission_set_id: 'ps-admin', organization_id: null }]
                            : [];
                    }
                    if (object === 'sys_permission_set') {
                        const ids: string[] = options?.where?.id?.$in ?? [];
                        return ids.includes('ps-admin') ? [ADMIN_SET] : [];
                    }
                    if (object === 'showcase_task') return TASK_ROWS;
                    return [];
                },
            });
            ctx.registerService('automation', {
                async execute(name: string, context: Record<string, unknown>) {
                    flowRuns.push({ name, context });
                    return { runId: 'run_1', status: 'completed' };
                },
            });
        },
    };
}

describe('the wired chain — policies, then the real pipeline (#5129)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        queries.length = 0;
        flowRuns.length = 0;
        engineFinds.length = 0;
        ({ kernel, baseUrl } = await boot([
            fakeMetadataPlugin({ withMatcher: true, endpoints: EXECUTABLE }),
            executionServicesPlugin(),
        ]));
    }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    it('serves an object_operation through the REAL callData pipeline', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/open-tasks`);
        expect(res.status).toBe(200);
        // The `/data` list body, not a reshaped one: `success(result)` where
        // `result` is what `callData('query', …)` returned. #5040 §4 requires
        // the declared endpoint and the built-in route to answer the same thing,
        // and a second success shape here would be the first divergence.
        expect(await res.json()).toEqual({
            success: true,
            data: { object: 'showcase_task', records: TASK_ROWS, total: 2 },
        });
        expect(engineFinds.some((f) => f.object === 'showcase_task')).toBe(true);
    });

    it('runs a flow through the automation slot with the trigger route\'s context', async () => {
        flowRuns.length = 0;
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/purge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-test-user': 'admin1' },
            body: JSON.stringify({ recordId: 'inq_1', objectName: 'showcase_inquiry', params: { olderThanDays: 30 } }),
        });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { runId: 'run_1', status: 'completed' } });
        expect(flowRuns).toHaveLength(1);
        expect(flowRuns[0]!.name).toBe('showcase_inquiry_janitor');
        // `buildAutomationContext`'s shape, reused rather than reinvented: the
        // `{recordId, objectName, params}` translation INCLUDING the
        // `<objectName>Id` alias a flow author writes, plus the identity the
        // envelope carries — a `runAs:'user'` flow that loses it is refused
        // fail-closed (#3760) or runs as somebody else (#1888).
        expect(flowRuns[0]!.context).toMatchObject({
            object: 'showcase_inquiry',
            event: 'manual',
            userId: 'admin1',
            params: { olderThanDays: 30, recordId: 'inq_1', showcaseInquiryId: 'inq_1' },
        });
    });

    it('denies an anonymous caller on the default authRequired, and serves a session', async () => {
        const anon = await fetch(`${baseUrl}/api/v1/apps/showcase/my-tasks`);
        expect(anon.status).toBe(401);
        expect((await anon.json() as { error: { code: string } }).error.code).toBe('UNAUTHENTICATED');

        const signedIn = await fetch(`${baseUrl}/api/v1/apps/showcase/my-tasks`, {
            headers: { 'x-test-user': 'admin1' },
        });
        expect(signedIn.status).toBe(200);
        expect((await signedIn.json() as { success: boolean }).success).toBe(true);
    });

    it('answers 429 WITH the Retry-After header on the wire once the budget is spent', async () => {
        // The regression this pins: the fallback used to write `status` + body
        // and drop `answer.headers`, so a 429 arrived with nothing telling the
        // client when to come back. Header-on-the-socket is the only assertion
        // that can catch that — the step-level one passed the whole time.
        const first = await fetch(`${baseUrl}/api/v1/apps/showcase/limited`);
        expect(first.status).toBe(200);

        const second = await fetch(`${baseUrl}/api/v1/apps/showcase/limited`);
        expect(second.status).toBe(429);
        const retryAfter = second.headers.get('Retry-After');
        expect(retryAfter).toBeTruthy();
        expect(Number(retryAfter)).toBeGreaterThan(0);
        expect(Number(retryAfter)).toBeLessThanOrEqual(60);
        const body = await second.json() as { error: { code: string; details?: Record<string, unknown> } };
        expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(body.error.details?.retryAfterSeconds).toBe(Number(retryAfter));
    });

    it('sends cacheTtl\'s Cache-Control on a success and on nothing else', async () => {
        const ok = await fetch(`${baseUrl}/api/v1/apps/showcase/cached`);
        expect(ok.status).toBe(200);
        expect(ok.headers.get('Cache-Control')).toBe('private, max-age=30');

        // Same endpoint family, same `cacheTtl: 30`, but the execution fails
        // (a `get` with no `?id=`). Telling the client to reuse a 400 for 30
        // seconds would make an author's typo sticky.
        const failed = await fetch(`${baseUrl}/api/v1/apps/showcase/cached-get`);
        expect(failed.status).toBe(400);
        expect(failed.headers.get('Cache-Control')).toBeNull();
        const body = await failed.json() as { error: { code: string; details?: { fields?: Array<{ field: string }> } } };
        expect(body.error.code).toBe('VALIDATION_FAILED');
        expect(body.error.details?.fields?.[0]?.field).toBe('id');
    });

    it('still leaves every non-endpoint answer exactly as it was', async () => {
        // The negative guarantee, re-asserted on the boot that CAN execute: the
        // seam costs a request nothing unless a declaration owns it.
        queries.length = 0;
        const outside = await fetch(`${baseUrl}/api/v1/nope`);
        expect(outside.status).toBe(404);
        expect(await outside.json()).toEqual(TRANSPORT_NOT_FOUND);

        const missUnderMount = await fetch(`${baseUrl}/api/v1/apps/showcase/not-declared`);
        expect(missUnderMount.status).toBe(404);
        expect(await missUnderMount.json()).toEqual(TRANSPORT_NOT_FOUND);

        expect(queries).toEqual([{ path: '/api/v1/apps/showcase/not-declared', method: 'GET' }]);
    });
});
