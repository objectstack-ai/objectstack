// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4073 — is `registerStandardEndpoints` really all DUPLICATE supply?
 *
 * The retirement plan (flip the default to `false` → observe a release → delete
 * `registerDiscoveryAndCrudEndpoints`) rests on that premise: every path the
 * flag mounts is also served, more completely, by `@objectstack/rest` or the
 * runtime dispatcher, so flipping the default changes nothing a caller can see.
 *
 * The premise is not uniform across the surface — the two halves reach it by
 * different mechanisms, and only one of them holds:
 *
 *  - **`/discovery` + `/.well-known/objectstack` — ceded explicitly (#4018).**
 *    `registerDiscoveryEndpoints` checks `kernel.hasPlugin(rest|dispatcher)` and
 *    declines to register at all. That is order-independent, so it holds however
 *    Hono resolves precedence. Verified below against the REAL dispatcher.
 *
 *  - **`/data/:object` — no such check.** Its shadowing is asserted purely on
 *    "REST registers first and wins". Booted for real, that does not hold: with
 *    the flag off the path is a 404, with REST mounted or not. The flag's raw
 *    surface is the ONLY thing answering `/api/v1/data/:object` in every
 *    composition this harness can boot.
 *
 * So the flip is NOT the no-op the plan describes, and this file exists to keep
 * it from being made on the assumption. If you are here because you are about to
 * flip the default: first make `rest=true, flag=OFF` serve `/data/:object`, then
 * update these expectations in the same commit.
 *
 * Caveat, stated so the next reader does not over-read this: REST is mounted
 * here with a minimal service set (`objectql` + `auth`). A fully provisioned
 * `os serve` also has metadata/protocol services, and REST may mount `/data`
 * only once those resolve. What is proven is narrower than "REST never serves
 * `/data`" — it is "nothing in these compositions serves it once the flag is
 * off", which is enough to block a default flip that assumes otherwise.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

function stubServices() {
    return {
        name: 'com.objectstack.test.standard-endpoints-precedence',
        version: '1.0.0',
        init: async (ctx: any) => {
            ctx.registerService('objectql', {
                async find() { return [{ id: 'r1' }]; },
                async findOne() { return { id: 'r1' }; },
                async insert(_o: string, d: any) { return d; },
            });
            ctx.registerService('auth', {
                async getSession() { return { user: { id: 'u1' }, session: {} }; },
            });
        },
    };
}

async function boot(registerStandardEndpoints: boolean, withRest: boolean) {
    const kernel = new LiteKernel();
    kernel.use(stubServices());
    // `serve.ts` order, real plugins: HonoServerPlugin (line 1173) long before
    // REST (line 1872) and the dispatcher (line 1883).
    kernel.use(new HonoServerPlugin({ port: 0, registerStandardEndpoints, cors: false }));
    if (withRest) {
        const { createRestApiPlugin } = await import('@objectstack/rest');
        kernel.use(createRestApiPlugin({} as any));
    }
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));
    await kernel.bootstrap();
    const server = kernel.getService<any>('http.server');
    return { kernel, baseUrl: `http://127.0.0.1:${server.getPort()}` };
}

let kernel: LiteKernel | undefined;
afterEach(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 5_000))]);
    kernel = undefined;
});

describe('#4073 — registerStandardEndpoints is not uniformly duplicate supply', () => {
    for (const withRest of [true, false]) {
        const label = withRest ? 'REST + dispatcher' : 'dispatcher only';

        it(`${label}: with the flag ON, /data/:object is served and gated`, async () => {
            const booted = await boot(true, withRest);
            kernel = booted.kernel;
            const res = await fetch(`${booted.baseUrl}/api/v1/data/account`);
            // 401 — the anonymous-deny gate (#2567) fired, which proves the route
            // is MOUNTED. A 404 would mean nothing is serving it.
            expect(res.status, 'flag ON must mount /data/:object').toBe(401);
        }, 30_000);

        it(`${label}: with the flag OFF, /data/:object 404s — nothing else picks it up`, async () => {
            const booted = await boot(false, withRest);
            kernel = booted.kernel;
            const res = await fetch(`${booted.baseUrl}/api/v1/data/account`);
            expect(
                res.status,
                'if this is no longer 404, another plugin now serves /data — re-read #4073, the flip may be safe',
            ).toBe(404);
        }, 30_000);
    }

    /**
     * The half of the surface that IS safe to retire: discovery cedes by an
     * explicit `hasPlugin` check, so the dispatcher's computed payload answers
     * whether the flag is on or off.
     */
    for (const flag of [true, false]) {
        it(`discovery is the dispatcher's either way — flag ${flag ? 'ON' : 'OFF'} (#4018 cede)`, async () => {
            const booted = await boot(flag, false);
            kernel = booted.kernel;
            const res = await fetch(`${booted.baseUrl}/api/v1/discovery`);
            expect(res.status).toBe(200);
            const body = await res.json();
            // `data.routes` is the dispatcher's shape; the flag's own payload is
            // a flat `{ version, apiName, routes, capabilities }`.
            expect(body?.data?.routes, 'the dispatcher must own discovery').toBeTruthy();
        }, 30_000);
    }
});
