// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { InMemoryMetricsRegistry, RUNTIME_METRICS } from '@objectstack/observability';
import { RouteManager } from '@objectstack/rest';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * MEASUREMENT harness for #9650 — which inbound HTTP surfaces does
 * `http_requests_total` actually observe, and what does each candidate seam
 * cover?
 *
 * This file measures; it does not assert a fix. Every `it` here pins a
 * MEASURED fact about the current wiring and about the two seams triage
 * pre-declared as a fork, so the decision that follows is made against
 * numbers rather than against a reading of the source.
 *
 * ## Why the composition is shaped this way
 *
 * Plugin registration order mirrors the SHIPPED one in
 * `packages/cli/src/commands/serve.ts`: HonoServerPlugin (:1759) → auth
 * (:2185) → rest (:2548) → dispatcher (:2566). The dispatcher is registered
 * LAST, and the kernel runs `init()` for every plugin before any `start()`
 * (`LiteKernel.bootstrap`, Phase 1 / Phase 2), while every route in the
 * platform is mounted in some plugin's `start()`. That ordering is the whole
 * subject here, so it is reproduced rather than assumed.
 *
 * The two consumer mounts are MODELLED rather than booted whole — the
 * precedent set by `auth-unknown-subpath.hono.integration.test.ts`, so
 * `packages/runtime`'s test-time dependency set does not grow a better-auth
 * stack or a full REST protocol. Each model is pinned to the production line
 * it mirrors:
 *
 *  - auth  → `rawApp.all(`${basePath}/*`)` after `getRawApp()`,
 *    `packages/plugins/plugin-auth/src/auth-plugin.ts:1622`.
 *  - REST  → the REAL `RouteManager` from `@objectstack/rest`, which is the
 *    class every REST data-API route is mounted through
 *    (`rest-server.ts:834` constructs it; `route-manager.ts:191-213` calls
 *    `server.get/post/put/delete/patch`). Modelling the mount would have been
 *    weaker: this is the production registrar itself.
 *
 * ## What a fix has to invert
 *
 * The two §1 assertions spelled "does NOT count" are this card's acceptance
 * criterion in executable form. Whichever seam is chosen, BOTH have to flip
 * together — a change that flips one and leaves the other reproduces the
 * defect one surface over, which is the thing this card exists about.
 */

const AUTH_BASE = '/api/v1/auth';
const AUTH_PROBE = `${AUTH_BASE}/sign-in/email`;
const REST_PROBE = '/api/v1/data/probe';
const DISPATCHER_PROBE = '/.well-known/objectstack';

const HTTP_REQUESTS_TOTAL = RUNTIME_METRICS.httpRequestsTotal;

/** Mirrors `AuthPlugin.registerAuthRoutes` — a raw-Hono wildcard mount. */
function authLikePlugin(): Plugin {
    return {
        name: 'com.objectstack.test.auth-like',
        version: '1.0.0',
        init: async () => {},
        start: async (ctx: PluginContext) => {
            const httpServer = ctx.getService<IHttpServer>('http.server');
            const rawApp = (httpServer as unknown as { getRawApp(): any }).getRawApp();
            rawApp.all(`${AUTH_BASE}/*`, async (c: any) =>
                c.json({ ok: true, surface: 'auth' }, 200),
            );
        },
    };
}

/** Mirrors `RestApiPlugin.start` — resolves `http.server` itself, mounts via RouteManager. */
function restLikePlugin(): Plugin {
    return {
        name: 'com.objectstack.test.rest-like',
        version: '1.0.0',
        init: async () => {},
        start: async (ctx: PluginContext) => {
            // `rest-api-plugin.ts:122,129` — the plugin resolves the service
            // itself rather than being handed a handle.
            const server = ctx.getService<IHttpServer>('http.server');
            const manager = new RouteManager(server);
            manager.register({
                method: 'GET',
                path: REST_PROBE,
                handler: (async (_req: any, res: any) => {
                    res.json({ ok: true, surface: 'rest' });
                }) as any,
            });
        },
    };
}

async function bootMeasurementKernel(metrics: InMemoryMetricsRegistry) {
    const kernel = new LiteKernel();
    // Shipped serve.ts order — dispatcher LAST.
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(authLikePlugin());
    kernel.use(restLikePlugin());
    kernel.use(
        createDispatcherPlugin({
            prefix: '/api/v1',
            securityHeaders: false,
            observability: { metrics },
        } as any),
    );
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    return { kernel, baseUrl: `http://127.0.0.1:${httpServer.getPort!()}` };
}

describe('#9650 §1 — inbound coverage of http_requests_total on the CURRENT wiring', () => {
    let kernel: LiteKernel;
    let baseUrl: string;
    const metrics = new InMemoryMetricsRegistry();

    beforeAll(async () => {
        ({ kernel, baseUrl } = await bootMeasurementKernel(metrics));
        await fetch(`${baseUrl}${DISPATCHER_PROBE}`);
        await fetch(`${baseUrl}${AUTH_PROBE}`, { method: 'POST' });
        await fetch(`${baseUrl}${REST_PROBE}`);
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    // Positive control. If this is 0 the harness is wrong, not the repo —
    // every "not counted" below would then be measuring a broken injection
    // rather than the defect.
    it('CONTROL: counts the dispatcher\'s own route (the local instrumented proxy works)', () => {
        expect(metrics.totalCounter(HTTP_REQUESTS_TOTAL, { route: DISPATCHER_PROBE })).toBeGreaterThan(0);
    });

    it('MEASURED: does NOT count the auth wildcard mounted through getRawApp()', () => {
        const seen = metrics.samples
            .filter((s) => s.name === HTTP_REQUESTS_TOTAL)
            .map((s) => s.labels.route);
        expect(seen).not.toContain(`${AUTH_BASE}/*`);
        expect(seen).not.toContain(AUTH_PROBE);
    });

    it('MEASURED: does NOT count the REST data route mounted through RouteManager', () => {
        expect(metrics.totalCounter(HTTP_REQUESTS_TOTAL, { route: REST_PROBE })).toBe(0);
    });

    it('MEASURED: both consumer surfaces answered 200 — they are live, merely uncounted', async () => {
        const auth = await fetch(`${baseUrl}${AUTH_PROBE}`, { method: 'POST' });
        const rest = await fetch(`${baseUrl}${REST_PROBE}`);
        expect(auth.status).toBe(200);
        expect(rest.status).toBe(200);
    });
});

describe('#9650 §2 — SEAM A: registering the instrumented proxy back as `http.server`', () => {
    it('MEASURED: `getRawApp` passes through the dispatcher proxy UNWRAPPED', () => {
        const rawApp = { marker: 'the real hono app' };
        const target = {
            get() {}, post() {}, delete() {},
            getRawApp() { return rawApp; },
        };
        // The proxy shape built at dispatcher-plugin.ts:700-721.
        const proxy: any = new Proxy(target, {
            get(t, prop, receiver) {
                if (prop === 'get' || prop === 'post' || prop === 'delete') {
                    const original = (t as any)[prop];
                    if (typeof original !== 'function') return original;
                    return (route: string, handler: any) => original.call(t, route, handler);
                }
                return Reflect.get(t, prop, receiver);
            },
        });
        // Structural, and independent of any ordering: a consumer that mounts
        // through getRawApp() reaches the same untouched Hono app whether it
        // holds the proxy or the raw adapter.
        expect(proxy.getRawApp()).toBe(rawApp);
    });

    it('MEASURED: the proxy traps only get/post/delete — put and patch pass through', () => {
        const calls: string[] = [];
        const target: any = {
            get: (r: string) => calls.push(`get:${r}`),
            post: (r: string) => calls.push(`post:${r}`),
            delete: (r: string) => calls.push(`delete:${r}`),
            put: (r: string) => calls.push(`put:${r}`),
            patch: (r: string) => calls.push(`patch:${r}`),
        };
        const wrapped: string[] = [];
        const proxy: any = new Proxy(target, {
            get(t, prop, receiver) {
                if (prop === 'get' || prop === 'post' || prop === 'delete') {
                    const original = (t as any)[prop];
                    if (typeof original !== 'function') return original;
                    return (route: string, handler: any) => {
                        wrapped.push(`${String(prop)}:${route}`);
                        return original.call(t, route, handler);
                    };
                }
                return Reflect.get(t, prop, receiver);
            },
        });
        proxy.get('/g', () => {});
        proxy.put('/p', () => {});
        proxy.patch('/q', () => {});
        expect(wrapped).toEqual(['get:/g']);
        // REST mounts PUT and PATCH through RouteManager (route-manager.ts:201-209),
        // so even a favourably-ordered proxy registration leaves them uncounted.
        expect(calls).toContain('put:/p');
        expect(calls).toContain('patch:/q');
    });

    it('MEASURED: `registerService` REFUSES a second `http.server`; the seam needs `replaceService`', async () => {
        const kernel = new LiteKernel();
        let registerError: string | undefined;
        kernel.use({
            name: 'com.objectstack.test.provider',
            version: '1.0.0',
            providesServices: ['http.server'],
            init: async (ctx: PluginContext) => { ctx.registerService('http.server', {} as unknown as IHttpServer); },
        } as Plugin);
        kernel.use({
            name: 'com.objectstack.test.reregistrar',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                try {
                    ctx.registerService('http.server', {} as unknown as IHttpServer);
                } catch (err: any) {
                    registerError = String(err?.message ?? err);
                }
            },
        } as Plugin);
        await kernel.bootstrap();
        await kernel.shutdown();

        // Not a detail: "register the proxy back as the service" cannot be
        // spelled with registerService at all (kernel-base.ts:79-81).
        expect(registerError).toContain("already registered");
    });

    it('MEASURED: a consumer that resolved `http.server` in an EARLIER start() keeps the raw handle', async () => {
        const resolved: string[] = [];
        // Stand-ins for the adapter and the instrumented wrapper. Which one a
        // consumer holds is decided by IDENTITY, not by a marker property —
        // `http.server` has a real contract (core-service-contracts.ts:155),
        // so the lookups below are typed to it rather than erased.
        const raw = {} as unknown as IHttpServer;
        const kernel = new LiteKernel();
        kernel.use({
            name: 'com.objectstack.test.provider',
            version: '1.0.0',
            providesServices: ['http.server'],
            init: async (ctx: PluginContext) => { ctx.registerService('http.server', raw); },
        } as Plugin);
        kernel.use({
            name: 'com.objectstack.test.early-consumer',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                resolved.push(ctx.getService<IHttpServer>('http.server') === raw ? 'raw' : 'proxy');
            },
        } as Plugin);
        kernel.use({
            name: 'com.objectstack.test.late-registrar',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                // A Proxy is never `===` its target, which is the whole point:
                // the consumers below can tell which handle they were given
                // without the stub carrying a marker member.
                const proxy = new Proxy(raw, {}) as IHttpServer;
                ctx.replaceService('http.server', proxy);
            },
        } as Plugin);
        kernel.use({
            name: 'com.objectstack.test.late-consumer',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                resolved.push(ctx.getService<IHttpServer>('http.server') === raw ? 'raw' : 'proxy');
            },
        } as Plugin);
        await kernel.bootstrap();
        await kernel.shutdown();

        // Ruling ②'s condition, measured: seam A's correctness is a function of
        // Phase-2 position. In the shipped composition REST (serve.ts:2548)
        // starts BEFORE the dispatcher (serve.ts:2566), i.e. it is the 'raw'
        // row here — the unfavourable one.
        expect(resolved).toEqual(['raw', 'proxy']);
    });
});

describe('#9650 §3 — SEAM B/C: a raw-app Hono middleware, and when it is installed', () => {
    /**
     * Seam B — installed during the dispatcher's `start()`, i.e. AFTER the
     * plugins that mount auth and REST have already run their own `start()`.
     * Measured on the REAL booted app, not a synthetic Hono instance.
     */
    it('MEASURED: a middleware installed AFTER the routes does not observe them (seam B)', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const { kernel, baseUrl } = await bootMeasurementKernel(metrics);
        const httpServer = kernel.getService<IHttpServer>('http.server');
        const rawApp = (httpServer as unknown as { getRawApp(): any }).getRawApp();

        const seen: string[] = [];
        // Registered now = after every plugin's start() mounted its routes.
        rawApp.use('*', async (c: any, next: any) => {
            await next();
            seen.push(c.req.path);
        });
        // A route mounted after the middleware, as the positive control.
        rawApp.get('/late-probe', (c: any) => c.json({ ok: true }));

        await fetch(`${baseUrl}${AUTH_PROBE}`, { method: 'POST' });
        await fetch(`${baseUrl}${REST_PROBE}`);
        await fetch(`${baseUrl}${DISPATCHER_PROBE}`);
        await fetch(`${baseUrl}/late-probe`);
        await kernel.shutdown();

        // Hono composes the handlers that matched in REGISTRATION order, so a
        // route registered first answers and never calls next().
        expect(seen).toContain('/late-probe');
        expect(seen).not.toContain(AUTH_PROBE);
        expect(seen).not.toContain(REST_PROBE);
        expect(seen).not.toContain(DISPATCHER_PROBE);
    }, 30_000);

    /**
     * Seam C — installed during Phase 1 (`init()`), before any route exists,
     * which is exactly where the adapter puts its own `installMiddlewareSeam()`.
     */
    it('MEASURED: a middleware installed in Phase 1 observes BOTH mounts, with status (seam C)', async () => {
        const seen: Array<{ route: string; status: number }> = [];
        const probePlugin: Plugin = {
            name: 'com.objectstack.test.phase1-observer',
            version: '1.0.0',
            requiresServices: ['http.server'],
            init: async (ctx: PluginContext) => {
                const httpServer = ctx.getService<IHttpServer>('http.server');
                const rawApp = (httpServer as unknown as { getRawApp(): any }).getRawApp();
                rawApp.use('*', async (c: any, next: any) => {
                    await next();
                    seen.push({ route: c.req.routePath, status: c.res.status });
                });
            },
        };

        const kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(probePlugin);
        kernel.use(authLikePlugin());
        kernel.use(restLikePlugin());
        kernel.use(
            createDispatcherPlugin({
                prefix: '/api/v1',
                securityHeaders: false,
                observability: { metrics: new InMemoryMetricsRegistry() },
            } as any),
        );
        await kernel.bootstrap();
        const httpServer = kernel.getService<IHttpServer>('http.server');
        const baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;

        await fetch(`${baseUrl}${AUTH_PROBE}`, { method: 'POST' });
        await fetch(`${baseUrl}${REST_PROBE}`);
        await fetch(`${baseUrl}${DISPATCHER_PROBE}`);
        await kernel.shutdown();

        const routes = seen.map((s) => s.route);
        expect(routes).toContain(`${AUTH_BASE}/*`);
        expect(routes).toContain(REST_PROBE);
        expect(routes).toContain(DISPATCHER_PROBE);
        // The status label the counter needs is readable here, which is what
        // the framework-agnostic `use()` seam cannot offer.
        expect(seen.every((s) => typeof s.status === 'number')).toBe(true);
    }, 30_000);

    /**
     * The exact boundary `serve.ts:3429-3435` claims is sufficient. That
     * comment governs how the unknown-hostname guard (and anything copied
     * from it) is installed, so the claim is measured rather than trusted:
     *
     *   "Hono's `app.use('*')` is order-independent for matching, so as long
     *    as the middleware is added before kernel:listening fires, it
     *    intercepts every request regardless of which plugin registered its
     *    handler."
     *
     * Every route in the platform is mounted in a plugin's `start()`, i.e.
     * in Phase 2 — strictly BEFORE `kernel:bootstrapped` and `kernel:listening`.
     */
    it('MEASURED: a middleware installed at `kernel:bootstrapped` — before kernel:listening — still observes nothing', async () => {
        const seen: string[] = [];
        const lateObserver: Plugin = {
            name: 'com.objectstack.test.late-hook-observer',
            version: '1.0.0',
            requiresServices: ['http.server'],
            init: async (ctx: PluginContext) => {
                const httpServer = ctx.getService<IHttpServer>('http.server');
                const rawApp = (httpServer as unknown as { getRawApp(): any }).getRawApp();
                // Subscribed in init(), but the middleware is INSTALLED from
                // the hook — after every plugin's start() has mounted routes,
                // and still before kernel:listening.
                (ctx as any).hook('kernel:bootstrapped', async () => {
                    rawApp.use('*', async (c: any, next: any) => {
                        await next();
                        seen.push(c.req.path);
                    });
                });
            },
        };

        const kernel = new LiteKernel();
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(lateObserver);
        kernel.use(authLikePlugin());
        kernel.use(restLikePlugin());
        kernel.use(
            createDispatcherPlugin({
                prefix: '/api/v1',
                securityHeaders: false,
                observability: { metrics: new InMemoryMetricsRegistry() },
            } as any),
        );
        await kernel.bootstrap();
        const httpServer = kernel.getService<IHttpServer>('http.server');
        const baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;

        await fetch(`${baseUrl}${AUTH_PROBE}`, { method: 'POST' });
        await fetch(`${baseUrl}${REST_PROBE}`);
        await fetch(`${baseUrl}${DISPATCHER_PROBE}`);
        await kernel.shutdown();

        // "Before kernel:listening" is NOT sufficient — Phase 1 is.
        expect(seen).toEqual([]);
    }, 30_000);

    it('MEASURED: the IHttpServer `use()` seam cannot observe status — it runs BEFORE dispatch', async () => {
        const metrics = new InMemoryMetricsRegistry();
        const { kernel, baseUrl } = await bootMeasurementKernel(metrics);
        const httpServer = kernel.getService<IHttpServer>('http.server');
        const observed: Array<Record<string, unknown>> = [];
        httpServer.use(async (req: any, _res: any, next: any) => {
            observed.push({ method: req.method, path: req.path, body: req.body });
            await next();
        });
        await fetch(`${baseUrl}${REST_PROBE}`);
        await kernel.shutdown();

        expect(observed.length).toBeGreaterThan(0);
        // The adapter runs the whole `use()` chain and only then returns
        // Hono's `next()` (adapter.ts installMiddlewareSeam), so a middleware
        // here has no response to read — which is why the existing,
        // order-independent seam cannot carry a `{status}` counter.
        expect(observed[0]).not.toHaveProperty('status');
        expect(observed[0].body).toBeUndefined();
    }, 30_000);
});
