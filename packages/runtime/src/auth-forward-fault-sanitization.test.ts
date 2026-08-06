// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5085 — the two halves of the `/auth/*` forwarding defect, pinned at the two
 * layers that own them.
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
 * `set-cookie`.
 *
 * ## ① The producer: `createDispatcherPlugin` mounts NO auth route
 *
 * It used to mount exactly one — `POST ${prefix}/auth/login`, "legacy explicit
 * … retained for self-hosted clients" — and that mount was the only place in
 * this repo that handed better-auth a NON-Fetch request. `IHttpServer` gives a
 * handler the adapter's internal `IHttpRequest` (`headers` is a plain object,
 * built by `HonoHttpServer.runHandler` from `c.req.header()`), the auth domain
 * forwards `context.request` whole to `IAuthService.handleRequest(request:
 * Request)`, and better-auth's fetch-style handler opens with
 * `request.headers.get(…)`.
 *
 * The route could not work for anyone: `/login` is not a better-auth endpoint
 * (absent from `plugin-auth`'s `auth-route-ledger.ts`; `content/docs/api/
 * plugin-endpoints.mdx` says so outright), and the domain does not route on the
 * sub-path at all (#4113) — so the mount's ONLY effect was a 500 where the
 * raw-app `/auth/*` wildcard yields better-auth's own clean 404.
 *
 * ## ② The exit: a throw out of the auth service never ships its own words
 *
 * The leak was a plain `TypeError`. Both dispatcher exits sanitise on
 * `looksLikeInternalErrorLeak`, a SQL/driver-dump heuristic that has nothing to
 * say about a `TypeError`, and #5462 recorded that a negative from a keyword
 * heuristic is not evidence of safety. The domain now withholds the message
 * UNCONDITIONALLY, per the #5437/#5464 discipline and #5489's
 * `UNCLASSIFIED_FAULT` — which names a handler `TypeError` as exactly the shape
 * that lands there.
 *
 * Both halves are pinned through the REAL `HttpDispatcher` / real plugin rather
 * than against a hand-built `DomainHandlerDeps`, so the assertions are about
 * what a caller receives rather than about an internal seam.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

/** The exact message the showcase boot leaked (#5085). */
const LEAKED = 'request.headers.get is not a function';

// ───────────────────────────── ① route table ─────────────────────────────

function makeFakeServer() {
    const routes: string[] = [];
    const rec = (verb: string) => (path: string, _handler: any) => {
        routes.push(`${verb} ${path}`);
    };
    return {
        routes,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            delete: rec('DELETE'),
            patch: rec('PATCH'),
        },
    };
}

function makeCtx(fakeServer: any) {
    const kernel = {
        getService: () => undefined,
        getServiceAsync: async () => undefined,
    };
    return {
        getKernel: () => kernel,
        getService: (name: string) => (name === 'http.server' ? fakeServer : undefined),
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

describe('#5085 ① the dispatcher plugin owns no /auth route', () => {
    it('mounts nothing under ${prefix}/auth — the namespace belongs to the raw-app wildcard', async () => {
        const { server, routes } = makeFakeServer();
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.(makeCtx(server));

        // The specific legacy mount…
        expect(routes).not.toContain('POST /api/v1/auth/login');
        // …and the general invariant it violated: an `IHttpServer` route can
        // only ever be handed an `IHttpRequest`, so ANY auth mount here would
        // reintroduce the same non-Fetch forwarding.
        expect(routes.filter((r) => r.includes('/api/v1/auth'))).toEqual([]);

        // Sanity that start() actually ran and registered its other routes — an
        // empty route table would satisfy the assertions above vacuously.
        expect(routes).toContain('GET /api/v1/health');
        expect(routes).toContain('GET /api/v1/i18n/locales');
    });
});

// ──────────────────────── ② the auth-domain error exit ────────────────────

/**
 * A dispatcher whose `auth` slot is filled by a service behaving as `impl`
 * says. `api.getSession` is present so the mock is shaped like the real
 * better-auth-backed `AuthManager` rather than only like the one method under
 * test.
 */
function makeDispatcher(impl: Partial<{ handleRequest: (r: Request) => Promise<Response> }>) {
    const auth = {
        api: { getSession: async () => ({ user: { id: 'u1' } }) },
        ...impl,
    };
    const svc = (name: string) => (name === 'auth' ? auth : undefined);
    const kernel: any = {
        getService: svc,
        getServiceAsync: async (name: string) => svc(name),
    };
    return new HttpDispatcher(kernel);
}

describe('#5085 ② a throw out of the auth service is a sanitised 500', () => {
    it('withholds the TypeError the forwarding defect produced', async () => {
        const dispatcher = makeDispatcher({
            handleRequest: async () => { throw new TypeError(LEAKED); },
        });

        const result = await dispatcher.handleAuth('login', 'POST', {}, { request: {} });

        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(500);
        expect(result.response?.body?.error?.message).toBe('Internal server error');
        // The catalog's floor code for "500 with no more specific code" —
        // unchanged from what the leaking response already carried, so only the
        // prose moves.
        expect(result.response?.body?.error?.code).toBe('INTERNAL_ERROR');
        // Asserted over the WHOLE serialized body, not one field: a leak that
        // moved into `details` would still be a leak.
        expect(JSON.stringify(result.response?.body)).not.toContain('headers.get');
        expect(JSON.stringify(result.response?.body)).not.toContain('is not a function');
    });

    it('withholds unconditionally — not only what looksLikeInternalErrorLeak recognises', async () => {
        // The predicate matches SQL/driver dumps. This message is neither, and
        // that is the whole point: before #5085 anything it did not recognise
        // reached the client verbatim.
        const dispatcher = makeDispatcher({
            handleRequest: async () => { throw new Error('better-auth secret rotation failed for tenant acme'); },
        });

        const result = await dispatcher.handleAuth('sign-in/email', 'POST', {}, { request: {} });

        expect(result.response?.status).toBe(500);
        expect(JSON.stringify(result.response?.body)).not.toContain('acme');
        expect(result.response?.body?.error?.message).toBe('Internal server error');
    });

    it('hands the ORIGINAL error to the server log — withholding costs no diagnostics', async () => {
        // `deps.logger` is undefined on a bare `HttpDispatcher` (no host logger
        // attached), so the domain falls back to `console` — the same
        // `deps.logger ?? console` shape `domains/packages.ts` uses. Spying
        // there is what a real single-tenant boot would actually write to.
        const boom = new TypeError(LEAKED);
        const dispatcher = makeDispatcher({
            handleRequest: async () => { throw boom; },
        });
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await dispatcher.handleAuth('login', 'POST', {}, { request: {} });

            expect(spy).toHaveBeenCalledTimes(1);
            // The UNTOUCHED error object, not a re-worded copy — this is the
            // only place the leaked text is still allowed to exist.
            expect(spy.mock.calls[0]?.[1]).toBe(boom);
            expect((spy.mock.calls[0]?.[1] as Error).message).toBe(LEAKED);
        } finally {
            spy.mockRestore();
        }
    });

    // ── positive control ────────────────────────────────────────────────────
    it('passes a real better-auth Response through untouched, cookie and all', async () => {
        const response = new Response(JSON.stringify({ token: 'tok' }), {
            status: 200,
            headers: { 'set-cookie': 'better-auth.session_token=tok; Path=/; HttpOnly' },
        });
        const dispatcher = makeDispatcher({ handleRequest: async () => response });

        const result = await dispatcher.handleAuth(
            'sign-in/email',
            'POST',
            { email: 'a@b.c' },
            { request: new Request('http://x/api/v1/auth/sign-in/email', { method: 'POST' }) },
        );

        expect(result.handled).toBe(true);
        // Same object — the domain must not re-wrap or re-envelope a success.
        expect(result.result).toBe(response);
        expect(result.response).toBeUndefined();
    });

    it('leaves better-auth\'s OWN error responses alone — only a throw is withheld', async () => {
        // better-auth answers a bad credential with a `Response`, not a throw
        // (which is why `AuthPlugin`'s wildcard logs >=500 RESPONSES rather than
        // catching). Sanitising that would swallow a deliberate 401 body.
        const unauthorized = new Response(JSON.stringify({ message: 'Invalid email or password' }), { status: 401 });
        const dispatcher = makeDispatcher({ handleRequest: async () => unauthorized });

        const result = await dispatcher.handleAuth('sign-in/email', 'POST', {}, { request: {} });

        expect(result.result).toBe(unauthorized);
        expect(await (result.result as Response).clone().json()).toEqual({ message: 'Invalid email or password' });
    });

    it('still answers 501 when no auth service is registered (#4113 unchanged)', async () => {
        const kernel: any = { getService: () => undefined, getServiceAsync: async () => undefined };
        const dispatcher = new HttpDispatcher(kernel);

        const result = await dispatcher.handleAuth('sign-in/email', 'POST', {}, { request: {} });

        expect(result.response?.status).toBe(501);
        expect(JSON.stringify(result.response?.body)).toContain('plugin-auth');
    });
});
