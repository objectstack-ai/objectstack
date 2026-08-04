// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declarative-endpoint mount seam, through a REAL boot (#5040 E3 / #5090).
 *
 * `api-endpoint-step.test.ts` covers the decision; this file covers the
 * WIRING — LiteKernel + the real Hono transport + the real dispatcher plugin,
 * driven over a real socket. That distinction is the whole reason #4936 found
 * two broken links at once: the old `handleApiEndpoint` branch was unit-tested
 * by calling `dispatch()` directly, which is exactly the shortcut that hid the
 * fact that nothing ever mounted the paths it claimed to serve. "Who serves
 * this path" is a question about the composed runtime; ask it there.
 *
 * The load-bearing assertion in most of these is a NEGATIVE one: that adding
 * this seam changed nothing for anybody. Today's unmatched answers — the bare
 * 404 and the 405 + `Allow` — must come back byte for byte, since a stack
 * cannot declare an endpoint at all until the E7 flip.
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

/** The transport's unmatched answer, captured from a boot with no seam armed. */
const BARE_NOT_FOUND = { error: 'Not found' };

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
        expect(await res.json()).toEqual(BARE_NOT_FOUND);
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
        expect(await res.json()).toEqual(BARE_NOT_FOUND);
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

    it('answers a MATCH with 501 NOT_IMPLEMENTED in the declared envelope', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/tasks`);
        expect(res.status).toBe(501);
        const body = await res.json() as { success: boolean; error: Record<string, unknown> };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('NOT_IMPLEMENTED');
        expect(body.error.httpStatus).toBe(501);
        expect(body.error.message).toContain('showcase_tasks');
    });

    it('reaches the step for a POST carrying a JSON body', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/inquiries/purge`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ olderThanDays: 30 }),
        });
        expect(res.status).toBe(501);
        const body = await res.json() as { error: Record<string, unknown> };
        expect(body.error.message).toContain('showcase_purge_inquiries');
        expect(queries).toContainEqual({ path: '/api/v1/apps/showcase/inquiries/purge', method: 'POST' });
    });

    it('answers a MISS under the mount with the transport\'s 404, unchanged', async () => {
        const res = await fetch(`${baseUrl}/api/v1/apps/showcase/nope`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(BARE_NOT_FOUND);
        expect(queries).toContainEqual({ path: '/api/v1/apps/showcase/nope', method: 'GET' });
    });

    it('never consults the matcher for a path outside the mount', async () => {
        queries.length = 0;
        const res = await fetch(`${baseUrl}/api/v1/nope`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(BARE_NOT_FOUND);
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
        const body = await res.json() as { code: string; allowed: string[] };
        expect(body.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.allowed).toEqual(['PUT']);
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
