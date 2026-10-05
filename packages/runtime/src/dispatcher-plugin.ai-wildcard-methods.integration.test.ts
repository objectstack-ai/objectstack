// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #21806 — `PATCH` reaches a declared AI route over HTTP, and a method the AI
 * route table does not declare for a path still answers `405`.
 *
 * ## The defect
 *
 * `registerAIRoutes` mounted the `${base}/ai/*` method wildcards for `get`,
 * `post`, `delete` and `put` only. On a host where the wildcards are the ONLY
 * door into `/ai/**` — cloud's hosted composition, whose measured `405` listed
 * `Allowed: DELETE, GET, HEAD, POST, PUT`, i.e. no concrete `PATCH` mount
 * either — a `PATCH` never reached the dispatcher: Hono routed it to
 * `notFound`, and the adapter's `unmatchedResponse()` answered `405` because
 * the path matched the wildcards under the four other verbs. The declared
 * `PATCH /api/v1/ai/conversations/:id` (the SDK's `ai.conversations.update`,
 * the console's conversation rename) was therefore unreachable.
 *
 * ## Where the 405 came from, and why it needed a second producer
 *
 * Measured on `origin/main` before the fix, through this file: the `405` for
 * an undeclared method was the ADAPTER's, and only for the one verb the
 * wildcard did not mount. For the four mounted verbs the AI route table itself
 * answered a method it does not declare with `404 ROUTE_NOT_FOUND` (its only
 * miss exit). Mounting `patch` alone would therefore have moved an undeclared
 * `PATCH` from the adapter's `405` to the table's `404` — so the table now
 * tells the two misses apart, for every verb alike: a path declared under
 * other methods answers `405 METHOD_NOT_ALLOWED` with an `Allow` header naming
 * exactly the methods the table declares for it, and a path declared under
 * none stays `404 ROUTE_NOT_FOUND`.
 *
 * ## The composition, and why the route table is installed AFTER boot
 *
 * `plugin-hono-server` + the dispatcher, scoping on under `auto`, so BOTH
 * bases `registerAIRoutes` serves are mounted (the unscoped `${prefix}` and
 * `${prefix}/environments/:environmentId`) and each case runs at each.
 *
 * The AI route table is written onto the kernel only once `bootstrap()` has
 * returned, and no `ai:routes` hook ever fires. Either of those would make the
 * dispatcher ALSO mount every declared route concretely (`mountAiRoute`), and
 * a concrete `PATCH` mount would answer a `PATCH` whether or not the wildcard
 * lets the verb through — the very door this file exists to measure would then
 * be shadowed out of the reading. Installed late, the method wildcards are the
 * only door, exactly as on the host where the defect was measured.
 *
 * Every route is declared `auth: false` so no session plumbing is needed; the
 * route-level auth contract is pinned in `domains/ai-anonymous-deny-ordering.test.ts`
 * and is not what this file measures.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const PREFIX = '/api/v1';
const ENV_ID = 'env_alpha';

const BASES: Array<[string, string]> = [
    ['unscoped', PREFIX],
    ['scoped', `${PREFIX}/environments/${ENV_ID}`],
];

/** Every handler invocation, so a refusal can prove no handler ran. */
const calls: Array<{ route: string; params: Record<string, string>; body: any }> = [];

function route(method: string, path: string) {
    return {
        method,
        path,
        auth: false,
        handler: async (req: any) => {
            calls.push({ route: `${method} ${path}`, params: req.params, body: req.body });
            return {
                status: 200,
                body: { success: true, data: { route: `${method} ${path}`, params: req.params, body: req.body ?? null } },
            };
        },
    };
}

/**
 * The AI route table. `/conversations/:id` carries the SDK's
 * `ai.conversations.update` verb beside a read; `/models` is GET-only, the
 * path the undeclared-method direction is asked on.
 */
const AI_ROUTES = [
    route('GET', '/api/v1/ai/conversations/:id'),
    route('PATCH', '/api/v1/ai/conversations/:id'),
    route('GET', '/api/v1/ai/models'),
];

/** A serveable `ai` slot — the domain reads the route table only behind one. */
function fakeAiServicePlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-ai-service',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('ai', { name: 'ai' });
        },
    };
}

let kernel: LiteKernel | undefined;
let baseUrl = '';

beforeAll(async () => {
    kernel = new LiteKernel();
    kernel.use(fakeAiServicePlugin());
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(createDispatcherPlugin({
        prefix: PREFIX,
        scoping: { enableProjectScoping: true, projectResolution: 'auto' },
        enforceProjectMembership: false,
        securityHeaders: false,
    }));
    await kernel.bootstrap();
    // AFTER boot, deliberately — see the header: no concrete mount may exist.
    (kernel as any).__aiRoutes = AI_ROUTES;
    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
}, 60_000);

afterAll(async () => {
    if (!kernel) return;
    await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
}, 60_000);

beforeEach(() => {
    calls.length = 0;
});

async function probe(method: string, path: string, body?: unknown): Promise<{ status: number; allow: string | null; body: any }> {
    const res = await fetch(`${baseUrl}${path}`, {
        method,
        ...(body !== undefined
            ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
    });
    let parsed: any;
    try { parsed = await res.json(); } catch { parsed = undefined; }
    return { status: res.status, allow: res.headers.get('allow'), body: parsed };
}

describe.each(BASES)('#21806 — /ai/* method wildcards at the %s base', (_label, base) => {
    it('PATCH to a declared AI route reaches its handler', async () => {
        const r = await probe('PATCH', `${base}/ai/conversations/conv_1`, { title: 'Renamed' });

        expect(r.status, JSON.stringify(r.body)).toBe(200);
        expect(r.body).toEqual({
            success: true,
            data: {
                route: 'PATCH /api/v1/ai/conversations/:id',
                params: { id: 'conv_1' },
                body: { title: 'Renamed' },
            },
        });
        expect(calls).toEqual([
            { route: 'PATCH /api/v1/ai/conversations/:id', params: { id: 'conv_1' }, body: { title: 'Renamed' } },
        ]);
    }, 60_000);

    it('PATCH to a path the table declares under GET only answers 405 and runs no handler', async () => {
        const r = await probe('PATCH', `${base}/ai/models`, { anything: true });

        expect(r.status, JSON.stringify(r.body)).toBe(405);
        expect(r.body?.success).toBe(false);
        expect(r.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
        expect(r.allow).toBe('GET');
        expect(calls).toEqual([]);
    }, 60_000);

    it('the same rule holds for a wildcard verb that is not PATCH — no per-verb case', async () => {
        const r = await probe('PUT', `${base}/ai/conversations/conv_1`, { title: 'Renamed' });

        expect(r.status, JSON.stringify(r.body)).toBe(405);
        expect(r.body?.success).toBe(false);
        expect(r.body?.error?.code).toBe('METHOD_NOT_ALLOWED');
        expect(r.allow).toBe('GET, PATCH');
        expect(calls).toEqual([]);
    }, 60_000);

    it('a path the table declares under no method stays 404 ROUTE_NOT_FOUND', async () => {
        const r = await probe('PATCH', `${base}/ai/not-a-route`, {});

        expect(r.status, JSON.stringify(r.body)).toBe(404);
        expect(r.body?.success).toBe(false);
        expect(r.body?.error?.code).toBe('ROUTE_NOT_FOUND');
        expect(r.allow).toBeNull();
        expect(calls).toEqual([]);
    }, 60_000);
});
