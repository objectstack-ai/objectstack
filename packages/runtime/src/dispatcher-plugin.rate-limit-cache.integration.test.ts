// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2), through the composed dispatcher: the
 * inbound limiter's buckets count in the registered `cache` service — a value
 * or a FACTORY registration — and only when none is registered (the kernel's
 * own `degraded` stand-in included) in the bounded per-process fallback.
 *
 * Booted on a real `ObjectKernel`, the kernel that supports factory
 * registrations, over a real socket.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryCache, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const BUDGET = { enabled: true, windowMs: 60_000, maxRequests: 2 };

function fakeAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: { headers: any }) => {
                        const uid = typeof headers?.get === 'function' ? headers.get('x-test-user') : headers?.['x-test-user'];
                        return uid ? { user: { id: uid } } : undefined;
                    },
                },
            });
        },
    };
}

function cachePlugin(register: (ctx: PluginContext) => void): Plugin {
    return { name: 'com.objectstack.test.cache', version: '1.0.0', init: async (ctx: PluginContext) => register(ctx) };
}

async function boot(register: (ctx: PluginContext) => void) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true });
    await kernel.use(fakeAuthPlugin());
    await kernel.use(cachePlugin(register));
    await kernel.use(new HonoServerPlugin({ port: 0 }));
    await kernel.use(createDispatcherPlugin({
        prefix: '/api/v1',
        securityHeaders: false,
        rateLimit: { budget: BUDGET, trustProxy: false },
    }));
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    return { kernel, baseUrl: `http://127.0.0.1:${httpServer.getPort!()}` };
}

async function shutdown(kernel: ObjectKernel | undefined) {
    if (!kernel) return;
    await Promise.race([kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
}

async function statusesFor(baseUrl: string, user: string, n: number): Promise<number[]> {
    const statuses: number[] = [];
    for (let i = 0; i < n; i++) {
        statuses.push((await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': user } })).status);
    }
    return statuses;
}

describe('inbound limiter, `cache` registered by FACTORY', () => {
    const entries = new Map<string, unknown>();
    let kernel: ObjectKernel;
    let baseUrl: string;

    beforeAll(async () => {
        ({ kernel, baseUrl } = await boot((ctx) => ctx.registerServiceFactory('cache', () => ({
            get: async (key: string) => entries.get(key),
            set: async (key: string, value: unknown) => { entries.set(key, value); },
        }))));
    }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    it("the caller's bucket lives in the registered cache, and the budget holds", async () => {
        expect(await statusesFor(baseUrl, 'usr_factory', BUDGET.maxRequests + 1)).toEqual([200, 200, 429]);
        expect([...entries.keys()]).toContain('principal:usr_factory');
    });
});

describe("inbound limiter, only the kernel's `degraded` stand-in registered", () => {
    const standIn = createMemoryCache();
    let kernel: ObjectKernel;
    let baseUrl: string;

    beforeAll(async () => {
        ({ kernel, baseUrl } = await boot((ctx) => ctx.registerService('cache', standIn)));
    }, 30_000);
    afterAll(() => shutdown(kernel), 30_000);

    it('the stand-in is not counted in: the bounded fallback holds the budget', async () => {
        expect(await statusesFor(baseUrl, 'usr_standin', BUDGET.maxRequests + 1)).toEqual([200, 200, 429]);
        expect((await standIn.stats()).keyCount).toBe(0);
    });
});
