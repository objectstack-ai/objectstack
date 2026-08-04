// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared === enforced probe for inbound rate limiting (#4910).
 *
 * This is the acceptance criterion of #4910 and the answer to #4686: a budget
 * an author WRITES, carried through the real composition, producing a real 429
 * on a real socket. Everything else in this change is unit-testable and unit-
 * tested; this file is the only place that proves the two ends are connected,
 * which is precisely what nobody could prove before — the spec's three
 * `RateLimitConfig` embeddings had zero readers (#4686) and the runtime's token
 * bucket had zero call sites (#4937).
 *
 * ## Read the RED control first
 *
 * The first suite boots the SAME stack with the SAME budget and the wiring
 * omitted, and asserts no request is ever refused. That is not a formality: it
 * IS `origin/main` before this change, and without it a green "429 observed"
 * could come from anywhere — a proxy, a coincidence, an assertion that would
 * pass against an unmodified tree. A declared-≠-enforced probe that cannot fail
 * on the unfixed code is not a probe.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/** The authored budget, exactly as `defineStack({ server })` would carry it. */
const BUDGET = { enabled: true, windowMs: 60_000, maxRequests: 3 };

/**
 * Minimal `auth` service: the `x-test-user` header names the principal. Enough
 * for the limiter to resolve one, which is all the keying decision needs.
 */
function fakeAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-auth',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                api: {
                    getSession: async ({ headers }: { headers: any }) => {
                        const uid = typeof headers?.get === 'function'
                            ? headers.get('x-test-user')
                            : headers?.['x-test-user'];
                        return uid ? { user: { id: uid } } : undefined;
                    },
                },
            });
        },
    };
}

/** A `cache` service so counters land in the shared store, as in production. */
function fakeCachePlugin(): Plugin {
    const entries = new Map<string, unknown>();
    return {
        name: 'com.objectstack.test.fake-cache',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('cache', {
                get: async (key: string) => entries.get(key),
                set: async (key: string, value: unknown) => { entries.set(key, value); },
                delete: async (key: string) => entries.delete(key),
                has: async (key: string) => entries.has(key),
                clear: async () => entries.clear(),
                stats: async () => ({ hits: 0, misses: 0, keys: entries.size }),
            });
        },
    };
}

/**
 * A plugin that mounts a route in `start()` and is REGISTERED BEFORE the
 * dispatcher — so its route exists before the dispatcher installs the limiter.
 * Stands in for `@objectstack/rest`, whose `/data` surface is mounted exactly
 * this way. If the gate only covered routes registered after it,
 * `server.security.rateLimit` would silently mean "some routes".
 */
function earlyRoutePlugin(): Plugin {
    return {
        name: 'com.objectstack.test.early-route',
        version: '1.0.0',
        init: async () => { /* nothing */ },
        start: async (ctx: PluginContext) => {
            const server = ctx.getService<IHttpServer>('http.server');
            server.get('/early/route', (_req, res) => { res.status(200); res.json({ early: true }); });
        },
    };
}

async function boot(dispatcherConfig: Record<string, unknown>) {
    // LiteKernel, like `dispatcher-plugin.ready.integration.test.ts`: the same
    // two-phase init/start contract the gate placement depends on, without a
    // data engine this suite has no use for. Port 0 → an OS-assigned free port.
    const kernel = new LiteKernel();
    kernel.use(fakeAuthPlugin());
    kernel.use(fakeCachePlugin());
    kernel.use(new HonoServerPlugin({ port: 0 }));
    // Registered — and therefore started — BEFORE the dispatcher, on purpose.
    kernel.use(earlyRoutePlugin());
    kernel.use(createDispatcherPlugin({
        prefix: '/api/v1',
        securityHeaders: false,
        ...dispatcherConfig,
    }));
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

describe('RED control — a declared budget with no wiring never refuses anything', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        // Same budget, deliberately NOT handed to the plugin. This is the state
        // of the repo before #4910: parseable, unread, inert.
        ({ kernel, baseUrl } = await boot({}));
    }, 30_000);

    afterAll(() => shutdown(kernel), 30_000);

    it('serves far past the budget without a single 429', async () => {
        const statuses: number[] = [];
        for (let i = 0; i < BUDGET.maxRequests + 5; i++) {
            statuses.push((await fetch(`${baseUrl}/api/v1/health`)).status);
        }
        expect(statuses).not.toContain(429);
        expect(new Set(statuses)).toEqual(new Set([200]));
    });
});

describe('inbound rate limit, wired (#4910)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        ({ kernel, baseUrl } = await boot({ rateLimit: { budget: BUDGET, trustProxy: false } }));
    }, 30_000);

    afterAll(() => shutdown(kernel), 30_000);

    it('answers 429 with Retry-After once the declared budget is spent', async () => {
        const statuses: number[] = [];
        let limited: Response | undefined;
        for (let i = 0; i < BUDGET.maxRequests + 2; i++) {
            const res = await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': 'usr_budget' } });
            statuses.push(res.status);
            if (res.status === 429 && !limited) limited = res;
        }

        expect(statuses.slice(0, BUDGET.maxRequests)).toEqual([200, 200, 200]);
        expect(statuses.slice(BUDGET.maxRequests)).toEqual([429, 429]);

        expect(limited).toBeDefined();
        const retryAfter = Number(limited!.headers.get('retry-after'));
        expect(Number.isFinite(retryAfter)).toBe(true);
        expect(retryAfter).toBeGreaterThanOrEqual(1);

        const body = await limited!.json() as { success: boolean; error: Record<string, unknown> };
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(body.error.httpStatus).toBe(429);
    });

    it('gates a route this plugin does NOT own — the budget is server-level, not dispatcher-level', async () => {
        // `/nope` is served by nothing: without the gate it 404s. With the gate
        // in front of every route it 429s once the caller's bucket is empty,
        // which is what makes `server.security.rateLimit` an honest name. A
        // limiter bolted onto this plugin's own mounts would leave `/data` (and
        // everything else another plugin mounts) unmetered.
        const first = await fetch(`${baseUrl}/nope`, { headers: { 'x-test-user': 'usr_unowned' } });
        expect(first.status).toBe(404);

        let last = first;
        for (let i = 0; i < BUDGET.maxRequests + 2; i++) {
            last = await fetch(`${baseUrl}/nope`, { headers: { 'x-test-user': 'usr_unowned' } });
        }
        expect(last.status).toBe(429);
    });

    it('gates a route another plugin mounted BEFORE the limiter was installed', async () => {
        // The `@objectstack/rest` shape: a plugin registered earlier mounts its
        // routes in `start()`, which runs before the dispatcher's. Registration
        // order must not decide which paths are metered.
        const first = await fetch(`${baseUrl}/early/route`, { headers: { 'x-test-user': 'usr_early' } });
        expect(first.status).toBe(200);

        let last = first;
        for (let i = 0; i < BUDGET.maxRequests + 2; i++) {
            last = await fetch(`${baseUrl}/early/route`, { headers: { 'x-test-user': 'usr_early' } });
        }
        expect(last.status).toBe(429);
    });

    it('meters each principal against its own bucket', async () => {
        // usr_a spends its whole budget …
        for (let i = 0; i < BUDGET.maxRequests + 1; i++) {
            await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': 'usr_a' } });
        }
        const aDenied = await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': 'usr_a' } });
        expect(aDenied.status).toBe(429);

        // … and usr_b, on the very same connection, is unaffected.
        const bAllowed = await fetch(`${baseUrl}/api/v1/health`, { headers: { 'x-test-user': 'usr_b' } });
        expect(bAllowed.status).toBe(200);
    });

    it('never meters a CORS preflight', async () => {
        for (let i = 0; i < BUDGET.maxRequests + 3; i++) {
            const res = await fetch(`${baseUrl}/api/v1/health`, {
                method: 'OPTIONS',
                headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
            });
            expect(res.status).not.toBe(429);
        }
    });
});

describe('trustProxy decides whether a forged header can mint fresh buckets', () => {
    it('IGNORES X-Forwarded-For when trustProxy is not declared', async () => {
        const { kernel, baseUrl } = await boot({ rateLimit: { budget: BUDGET, trustProxy: false } });
        try {
            // Every request claims a DIFFERENT client address. Undeclared, the
            // header is worth nothing and all of them share the loopback bucket
            // — so the limit still bites. Believing it here is the bypass.
            const statuses: number[] = [];
            for (let i = 0; i < BUDGET.maxRequests + 2; i++) {
                const res = await fetch(`${baseUrl}/api/v1/health`, {
                    headers: { 'x-forwarded-for': `203.0.113.${i}` },
                });
                statuses.push(res.status);
            }
            expect(statuses).toContain(429);
        } finally {
            await shutdown(kernel);
        }
    }, 30_000);

    it('honours X-Forwarded-For once trustProxy IS declared', async () => {
        const { kernel, baseUrl } = await boot({ rateLimit: { budget: BUDGET, trustProxy: true } });
        try {
            // Declared, each distinct forwarded address is a distinct caller and
            // gets its own budget — the behaviour an operator behind a real
            // reverse proxy is asking for.
            const statuses: number[] = [];
            for (let i = 0; i < BUDGET.maxRequests + 2; i++) {
                const res = await fetch(`${baseUrl}/api/v1/health`, {
                    headers: { 'x-forwarded-for': `203.0.113.${i}` },
                });
                statuses.push(res.status);
            }
            expect(statuses).not.toContain(429);

            // …and one address that overspends is still cut off.
            const repeated: number[] = [];
            for (let i = 0; i < BUDGET.maxRequests + 2; i++) {
                const res = await fetch(`${baseUrl}/api/v1/health`, {
                    headers: { 'x-forwarded-for': '198.51.100.1' },
                });
                repeated.push(res.status);
            }
            expect(repeated).toContain(429);
        } finally {
            await shutdown(kernel);
        }
    }, 30_000);
});
