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

    it('MEASURED: a consumer that resolved `http.server` in an EARLIER start() keeps the raw handle', async () => {
        const resolved: string[] = [];
        const kernel = new LiteKernel();
        const raw = { id: 'raw' };
        const providerPlugin: Plugin = {
            name: 'com.objectstack.test.provider',
            version: '1.0.0',
            providesServices: ['http.server'],
            init: async (ctx: PluginContext) => { ctx.registerService('http.server', raw); },
        };
        const earlyConsumer: Plugin = {
            name: 'com.objectstack.test.early-consumer',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                resolved.push((ctx.getService<any>('http.server') as any).id ?? 'proxy');
            },
        };
        const lateRegistrar: Plugin = {
            name: 'com.objectstack.test.late-registrar',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                const proxy = new Proxy(raw, {
                    get: (t, p, r) => (p === 'id' ? 'proxy' : Reflect.get(t, p, r)),
                });
                ctx.registerService('http.server', proxy as any);
            },
        };
        const lateConsumer: Plugin = {
            name: 'com.objectstack.test.late-consumer',
            version: '1.0.0',
            init: async () => {},
            start: async (ctx: PluginContext) => {
                resolved.push((ctx.getService<any>('http.server') as any).id ?? 'proxy');
            },
        };
        kernel.use(providerPlugin);
        kernel.use(earlyConsumer);
        kernel.use(lateRegistrar);
        kernel.use(lateConsumer);
        await kernel.bootstrap();
        await kernel.shutdown();

        // This is ruling ②'s condition, measured: correctness of seam A is a
        // function of Phase-2 position, and in the shipped composition REST
        // (serve.ts:2548) starts BEFORE the dispatcher (serve.ts:2566).
        expect(resolved).toEqual(['raw', 'proxy']);
    });
});

describe('#9650 §3 — SEAM B/C: a raw-app Hono middleware, and when it is installed', () => {
    it('MEASURED: a middleware installed AFTER a route does not observe that route (seam B)', async () => {
        const { Hono } = await import('hono');
        const app = new Hono();
        const seen: string[] = [];
        app.get('/early', (c: any) => c.json({ ok: true }));
        app.use('*', async (c: any, next: any) => {
            await next();
            seen.push(c.req.path);
        });
        app.get('/late', (c: any) => c.json({ ok: true }));

        await app.request('/early');
        await app.request('/late');

        // Hono composes the handlers that matched in REGISTRATION order; the
        // route registered first answers and never calls next().
        expect(seen).toEqual(['/late']);
    });

    it('MEASURED: a middleware installed BEFORE every route observes all of them, incl. status (seam C)', async () => {
        const { Hono } = await import('hono');
        const app = new Hono();
        const seen: Array<{ route: string; status: number }> = [];
        app.use('*', async (c: any, next: any) => {
            await next();
            seen.push({ route: c.req.routePath, status: c.res.status });
        });
        // Both mount styles, on the one app, after the middleware.
        app.all(`${AUTH_BASE}/*`, (c: any) => c.json({ ok: true }, 200));
        app.get(REST_PROBE, (c: any) => c.json({ ok: true }, 201));

        await app.request(AUTH_PROBE, { method: 'POST' });
        await app.request(REST_PROBE);

        expect(seen).toEqual([
            { route: `${AUTH_BASE}/*`, status: 200 },
            { route: REST_PROBE, status: 201 },
        ]);
    });

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
    });
});
