// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import type { IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

/**
 * End-to-end regression for #5085 — the `/auth/*` forwarding layer handed
 * better-auth an INTERNAL request object.
 *
 * ## What was measured
 *
 * On a real showcase boot (`pnpm dev -- --fresh --seed-admin`):
 *
 * ```
 * POST /api/v1/auth/login
 * → HTTP 500
 * {"success":false,"error":{"code":"INTERNAL_ERROR",
 *   "message":"request.headers.get is not a function","httpStatus":500}}
 * ```
 *
 * …while the positive control `POST /api/v1/auth/sign-in/email` — a REAL
 * better-auth route, same boot, same forwarding layer — answered 200 with a
 * `set-cookie`. Two defects stacked: the wrong error CLASS (a path better-auth
 * does not implement is a 404, not a 500) and a raw internal `TypeError` in the
 * response body.
 *
 * ## Why this suite is shaped the way it is
 *
 * `HonoHttpServer` hands a route handler the adapter's own `IHttpRequest`, whose
 * `headers` is a PLAIN OBJECT built from `c.req.header()` — not a `Headers`.
 * `createDispatcherPlugin` used to mount one auth route,
 * `POST ${prefix}/auth/login`, forwarding that object straight into
 * `dispatcher.handleAuth(…, { request: req })`; the domain hands
 * `context.request` whole to `IAuthService.handleRequest(request: Request)`, and
 * better-auth's fetch-style handler opens with `request.headers.get(…)`.
 *
 * So the fake auth service below is deliberately better-auth-SHAPED rather than
 * convenient: it reads `request.headers.get('cookie')` and `new URL(request.url)`
 * first thing, which is what makes an internal request object explode here the
 * way it exploded in production. A fake that tolerated `headers` as a plain
 * object would have kept this suite green through the whole defect.
 *
 * The `rawApp.all('/api/v1/auth/*')` mount mirrors what `AuthPlugin` (and
 * cloud's `AuthProxyPlugin`) register on the raw Hono app, including the #4088
 * "a 404 means better-auth does not own this path, so yield" behaviour —
 * MODELLED here rather than depended on, so `packages/runtime`'s test-time
 * dependency set does not grow a better-auth stack.
 */

const SIGN_IN_PATH = '/api/v1/auth/sign-in/email';
const UNKNOWN_PATH = '/api/v1/auth/login';

/**
 * A better-auth-shaped `auth` service: it can ONLY be driven by a real Fetch
 * `Request`, exactly like the real one.
 */
function fakeBetterAuthPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.fake-better-auth',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('auth', {
                handleRequest: async (request: Request): Promise<Response> => {
                    // Both reads are ones better-auth performs before it routes
                    // anything — and both are TypeErrors on an `IHttpRequest`.
                    request.headers.get('cookie');
                    const { pathname } = new URL(request.url);

                    if (pathname === SIGN_IN_PATH) {
                        return new Response(JSON.stringify({ token: 'tok_test', user: { id: 'usr_1' } }), {
                            status: 200,
                            headers: {
                                'content-type': 'application/json',
                                'set-cookie': 'better-auth.session_token=tok_test; Path=/; HttpOnly',
                            },
                        });
                    }
                    // better-auth's own answer for a path it does not implement.
                    return new Response(JSON.stringify({ message: 'Not Found' }), {
                        status: 404,
                        headers: { 'content-type': 'application/json' },
                    });
                },
            });
        },
    };
}

/** Mirrors `AuthPlugin`'s terminal-but-yielding `rawApp.all(`${basePath}/*`)`. */
function mountAuthWildcard(kernel: LiteKernel): void {
    const httpServer = kernel.getService<IHttpServer>('http.server');
    const rawApp = (httpServer as unknown as { getRawApp(): any }).getRawApp();
    rawApp.all('/api/v1/auth/*', async (c: any, next: any) => {
        const service = kernel.getService<{ handleRequest(r: Request): Promise<Response> }>('auth');
        const response = await service.handleRequest(c.req.raw);
        if (response.status === 404) {
            await next();
            if (c.res && c.res.status !== 404) return;
            c.res = response;
            return;
        }
        return response;
    });
}

describe('/auth/* forwarding over a real hono server (integration, #5085)', () => {
    let kernel: LiteKernel;
    let baseUrl: string;

    beforeAll(async () => {
        // `LiteKernel`, like `route-parity.integration.test.ts`: this suite is
        // about the HTTP forwarding seam, and a full `ObjectKernel` would demand
        // the critical `data` service (a driver + ObjectQL) that no assertion
        // here reads.
        kernel = new LiteKernel();
        kernel.use(fakeBetterAuthPlugin());
        // port 0 → OS-assigned free port; resolved via getPort() after listening.
        kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
        kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));

        await kernel.bootstrap();

        // Registered AFTER bootstrap so the dispatcher's own mounts are already
        // on the app — i.e. the wildcard is the LAST matcher, the least
        // favourable order for this fix. A surviving dispatcher `/auth/*` route
        // would win the match outright and this suite would go red.
        mountAuthWildcard(kernel);

        const httpServer = kernel.getService<IHttpServer>('http.server');
        baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    // ── ① the defect: an unknown auth sub-path is a clean 404, not a 500 ────
    it('answers an unknown auth sub-path with better-auth\'s own 404 — no 500, no TypeError', async () => {
        const res = await fetch(`${baseUrl}${UNKNOWN_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
        });
        const text = await res.text();

        expect(res.status).toBe(404);
        // ② the raw internal error never reaches the wire — asserted on the
        // WHOLE body, not on a parsed field, so a leak through any envelope
        // shape is caught.
        expect(text).not.toContain('headers.get');
        expect(text).not.toContain('is not a function');
        expect(text).not.toContain('TypeError');
    });

    // ── ③ positive control: the real better-auth route is untouched ─────────
    it('keeps POST /auth/sign-in/email at 200 with its set-cookie', async () => {
        const res = await fetch(`${baseUrl}${SIGN_IN_PATH}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'a@b.c', password: 'x' }),
        });

        expect(res.status).toBe(200);
        expect(res.headers.get('set-cookie')).toContain('better-auth.session_token=');
        expect((await res.json()).token).toBe('tok_test');
    });

    // The legacy mount is gone from the route table, so a verb it never had a
    // handler for cannot be answered by a stale one either.
    it('does not resurrect /auth/login for any verb', async () => {
        const res = await fetch(`${baseUrl}${UNKNOWN_PATH}`, { method: 'GET' });
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain('is not a function');
    });
});
