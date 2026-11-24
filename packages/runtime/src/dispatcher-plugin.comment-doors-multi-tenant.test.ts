// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36469] The comment doors on a multi-tenant host composed the way
 * `objectstack serve` / `objectstack dev` composes one: `HonoServerPlugin`
 * plus `DispatcherPlugin` on the HOST kernel, a `kernel-resolver` that places
 * each request on a per-environment kernel, and NO `createHonoApp` catch-all.
 *
 * `plugin-audit` runs on the tenant kernels, which own no `http.server`, so
 * its doors are never mounted on the host's route table. #36539 gave them a
 * `/comments` dispatcher domain, but on this shape nothing routes the request
 * into `dispatch()`: `DispatcherPlugin`'s fallback seam hands on only
 * domain-decided and app-endpoint paths, so the transport's own
 * `404 ENDPOINT_NOT_FOUND` stood — the card's exact hosted reading.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';
// Paid during collection, not inside a case's clock: `standalone-stack.ts`,
// reached through the dispatcher, loads it lazily (`check:test-source-alias`).
import '@objectstack/metadata';

/** Every request the tenant's comment-doors member received. */
const served: Array<{ tenant: string; method: string; path: string; body?: string }> = [];

function makeTenantKernel(tenant: string) {
    const services: Record<string, unknown> = {
        comments: {
            handleCommentDoor: async (request: Request) => {
                const body = request.method === 'PUT' ? await request.text() : undefined;
                served.push({ tenant, method: request.method, path: new URL(request.url).pathname, ...(body !== undefined ? { body } : {}) });
                return Response.json(
                    { success: true, data: { servedBy: tenant } },
                    { headers: { 'x-door-answer': tenant, 'cache-control': 'no-store' } },
                );
            },
        },
    };
    return {
        __tag: tenant,
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    };
}

const TENANTS: Record<string, ReturnType<typeof makeTenantKernel>> = {
    'env-1': makeTenantKernel('env-1'),
};

function tenantResolverPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.kernel-resolver',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('kernel-resolver', {
                resolveKernel: async (context: any) => {
                    // Fetch `Headers` or a plain record, as the cloud host's
                    // resolver reads them (`headerAccessor`, objectos-runtime).
                    const headers = context?.request?.headers;
                    const envId: string | undefined = typeof headers?.get === 'function'
                        ? headers.get('x-environment-id') ?? undefined
                        : headers?.['x-environment-id'];
                    const kernel = envId ? TENANTS[envId] : undefined;
                    if (!kernel) return undefined;
                    context.environmentId = envId;
                    return kernel;
                },
            });
        },
    };
}

let kernel: LiteKernel | undefined;
let baseUrl = '';

beforeAll(async () => {
    kernel = new LiteKernel();
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(tenantResolverPlugin());
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
}, 60_000);

afterAll(async () => {
    if (!kernel) return;
    await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
}, 60_000);

/** The envelope fields these assertions read. */
type Answer = { success?: boolean; data?: unknown; error?: { code?: string } };

const SIGNED_IN = { 'X-Environment-Id': 'env-1', 'content-type': 'application/json' };

describe('[#36469] comment doors on an `objectstack serve`-shaped multi-tenant host', () => {
    it.each([
        ['DELETE', '/api/v1/comments/reactions/rxn_1'],
        ['PUT', '/api/v1/comments/cmt_1/resolution'],
        ['DELETE', '/api/v1/comments/cmt_1'],
    ])('%s %s reaches the placed tenant\'s comments member', async (method, path) => {
        served.length = 0;
        const res = await fetch(`${baseUrl}${path}`, {
            method,
            headers: SIGNED_IN,
            ...(method === 'PUT' ? { body: JSON.stringify({ resolved: true }) } : {}),
        });
        const body = await res.json() as Answer;
        // Before the bridge: the transport's own unmatched answer, the card's reading.
        expect(body?.error?.code).not.toBe('ENDPOINT_NOT_FOUND');
        expect(res.status).toBe(200);
        expect(body).toEqual({ success: true, data: { servedBy: 'env-1' } });
        // The member's own headers reach the client.
        expect(res.headers.get('x-door-answer')).toBe('env-1');
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(served).toEqual([
            { tenant: 'env-1', method, path, ...(method === 'PUT' ? { body: JSON.stringify({ resolved: true }) } : {}) },
        ]);
    }, 60_000);

    it('serves the environment-scoped spelling at the door\'s wire path', async () => {
        served.length = 0;
        const res = await fetch(`${baseUrl}/api/v1/environments/env-1/comments/reactions/rxn_2`, {
            method: 'DELETE',
            headers: SIGNED_IN,
        });
        expect(res.status).toBe(200);
        expect(served).toEqual([{ tenant: 'env-1', method: 'DELETE', path: '/api/v1/comments/reactions/rxn_2' }]);
    }, 60_000);

    it.each([
        ['DELETE', '/api/v1/comments/reactions/rxn_1/extra'],
        ['PUT', '/api/v1/comments/cmt_1'],
        ['GET', '/api/v1/comments/reactions/rxn_1'],
    ])('%s %s is not a door: the transport\'s own miss stands', async (method, path) => {
        served.length = 0;
        const res = await fetch(`${baseUrl}${path}`, { method, headers: SIGNED_IN });
        const body = await res.json() as Answer;
        expect(res.status).toBe(404);
        expect(body?.error?.code).toBe('ENDPOINT_NOT_FOUND');
        expect(served).toEqual([]);
    }, 60_000);

    it('an unplaced request is never served out of a tenant kernel', async () => {
        served.length = 0;
        const res = await fetch(`${baseUrl}/api/v1/comments/reactions/rxn_1`, { method: 'DELETE' });
        expect(res.status).not.toBe(200);
        expect(served).toEqual([]);
    }, 60_000);
});

describe('[#36469] a single-kernel host keeps today\'s answer', () => {
    let single: LiteKernel | undefined;
    let singleUrl = '';
    beforeAll(async () => {
        single = new LiteKernel();
        single.use(new HonoServerPlugin({ port: 0, cors: false }));
        single.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
        await single.bootstrap();
        singleUrl = `http://127.0.0.1:${single.getService<IHttpServer>('http.server').getPort!()}`;
    }, 60_000);
    afterAll(async () => {
        if (!single) return;
        await Promise.race([single.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }, 60_000);

    it('no kernel-resolver: an unmounted door is the transport\'s miss, not handed to dispatch()', async () => {
        const res = await fetch(`${singleUrl}/api/v1/comments/reactions/rxn_1`, { method: 'DELETE' });
        expect(res.status).toBe(404);
        expect(((await res.json()) as Answer)?.error?.code).toBe('ENDPOINT_NOT_FOUND');
    }, 60_000);
});
