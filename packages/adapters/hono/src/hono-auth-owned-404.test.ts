// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15928 — WHICH 404 the adapter's `/auth/*` mount is allowed to yield.
 *
 * `hono-wildcard-fallthrough.test.ts` (#4117) pins that the mount yields at
 * all. This file pins the other edge, the one PR #15918 (card #15417) closed on
 * the `plugin-auth` side of the identical defect: the mount may yield only a
 * 404 that DISCLAIMS OWNERSHIP. A 404 from a path the auth service's own router
 * SERVES is its answer, and handing that on is how it becomes somebody else's
 * `200 {}`.
 *
 * ## The measurement this file exists for
 *
 * Card #15928 recorded the location and the "identical unconditioned yield"
 * reading from a REVIEWER of PR #15918, explicitly unmeasured on this seat.
 * Measured here, on a real boot through this adapter — a real `ObjectKernel`
 * with `AuthPlugin` (so a real `AuthManager`, a real better-auth with 100
 * `auth.api` entries), `createHonoApp({ kernel, prefix: '/api/v1' })`, requests
 * injected through the returned app — the reading is CONFIRMED, and the blast
 * radius at this layer is wider than the plugin's:
 *
 *     GET /api/v1/auth/delete-user/callback?token=abc&callbackURL=/x
 *       better-auth direct  : 404  application/json  {"message":"Not found","code":"NOT_FOUND"}
 *       through this mount  : 200  application/json  {}
 *
 * ⚠️ Wider because the plugin-side defect needed a composition to mount a
 * downstream wildcard, and this one does not: the `${prefix}/*` dispatcher
 * catch-all that overwrites the answer is registered by `createHonoApp` itself,
 * is terminal, and answers `200 {}` for paths under `/auth/`. Measured on the
 * same boot: `POST /api/v1/auth/definitely-not-a-route-1989` and
 * `GET /api/v1/auth/me/permissions` both come back `200 {}` from it.
 *
 * That route is not hypothetical. `plugin-auth`'s `auth-route-ledger.ts` carries
 * `POST /api/v1/auth/delete-user` and `GET /api/v1/auth/delete-user/callback`
 * under the `disabled` disposition precisely because they are published and
 * answer 404 (`user.deleteUser` is deliberately unconfigured, maintainer ruling
 * 2026-08-12). So the ledger's recorded answer was true of the auth service and
 * false on this adapter's wire.
 *
 * ## ⭐ What these cases COVER, and what they do NOT
 *
 * COVERED: the adapter's DECISION LOGIC — given an auth service that answers
 * `ownsRoute`, which 404s this mount yields and which it returns, what it does
 * with a service that has no `ownsRoute` at all, and what it passes to it.
 *
 * ⛔ NOT COVERED by any case in this file:
 *   - better-auth's real route table. The fixture's `ownsRoute` is a path set,
 *     not `buildBetterAuthRouteOwnership` over a real `auth.api` — that matcher
 *     is `plugin-auth`'s and is pinned there
 *     (`better-auth-route-ownership.test.ts`). `@objectstack/hono` does not
 *     depend on `@objectstack/plugin-auth` and gains no dependency here.
 *   - that the kernel's `auth` service really carries `ownsRoute`. Measured on
 *     the real boot above (`kernel.getServiceAsync('auth')` → `_AuthManager`,
 *     `typeof ownsRoute === 'function'`), NOT pinned by a case here.
 *   - the `basePath`/`prefix` alignment. `AuthManager.ownsRoute` answers on the
 *     AUTH SERVICE's configured `basePath`; measured on the real boot,
 *     `ownsRoute('POST', '/api/v1/auth/delete-user')` is `true` while
 *     `ownsRoute('POST', '/api/auth/delete-user')` is `false`. A deployment
 *     whose adapter `prefix` and auth `basePath` disagree therefore gets `false`
 *     for everything and keeps the pre-#15928 yield — the safe direction, and
 *     the reason every undecidable answer is `false`.
 *   - trailing-slash and doubled-slash spellings, the one known divergence of
 *     the plugin-side walk (it claims them; better-call refuses them as
 *     unrouted). Inherited here, unpinned here.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Hono } from 'hono';

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

/** The shape of the `200 {}` the real dispatcher catch-all answers with. */
const DISPATCH_ANSWERED = { handled: true, response: { body: {}, status: 200 } };

/** What better-call returns for a path it does not route: bodyless, no content-type. */
const unrouted404 = () => new Response(null, { status: 404, statusText: 'Not Found' });

/** better-auth's OWN 404 on a path it serves — enveloped, with a content-type. */
const owned404 = () => new Response(JSON.stringify({ message: 'Not found', code: 'NOT_FOUND' }), {
  status: 404,
  headers: { 'Content-Type': 'application/json' },
});

const kernelWith = (authService?: unknown) => ({
  name: 'test-kernel',
  getService: (n: string) => (n === 'auth' && authService ? authService : undefined),
}) as any;

/**
 * An auth service in the shape the kernel really registers: `handleRequest`
 * plus the optional `ownsRoute`. `owned` is the set of wire paths it claims —
 * a path SET, deliberately, so these cases are about the adapter's decision and
 * not about a route matcher this package does not own.
 */
const authServiceOwning = (owned: string[], answer: () => Response) => ({
  handleRequest: vi.fn(async () => answer()),
  ownsRoute: vi.fn(async (req: Request) => owned.includes(new URL(req.url).pathname)),
});

const PREFIX = '/api/v1';

describe('#15928: the adapter yields only a 404 that disclaims ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.dispatch.mockResolvedValue(DISPATCH_ANSWERED);
    mockDispatcher.handleAuth.mockResolvedValue({ handled: false });
  });

  it('does NOT yield a 404 from a path the auth service OWNS — the answer reaches the caller', async () => {
    // The measured case: published, routed, and 404 BY DESIGN. Before this fix
    // the mount handed it to the dispatcher catch-all, which answered 200 {}.
    const svc = authServiceOwning([`${PREFIX}/auth/delete-user/callback`], owned404);
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    const res = await app.request(`http://localhost${PREFIX}/auth/delete-user/callback?token=abc&callbackURL=/x`);

    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
    // The load-bearing half: nothing downstream was ever given the chance.
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('DOES yield a 404 the auth service disclaims — #4088 ordering-independence intact', async () => {
    // `/auth/me/permissions` is the canonical disclaimed path: nothing in
    // better-auth serves it, and objectui's permission layer reads it. #4088
    // made this mount non-terminal for it, and that must survive this fix.
    const svc = authServiceOwning([], unrouted404);
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    const res = await app.request(`http://localhost${PREFIX}/auth/me/permissions`);

    expect(mockDispatcher.dispatch).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
  });

  it('an auth service with NO `ownsRoute` keeps the pre-#15928 behaviour exactly', async () => {
    // The back-compat population: this is a STRUCTURAL interface over whatever
    // the kernel registered, so a service predating the method must still yield.
    const svc = { handleRequest: vi.fn(async () => unrouted404()) };
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    const res = await app.request(`http://localhost${PREFIX}/auth/anything-at-all`);

    expect(mockDispatcher.dispatch).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('an `ownsRoute` that THROWS yields — a failure to decide never costs the #4088 surface', async () => {
    const svc = {
      handleRequest: vi.fn(async () => unrouted404()),
      ownsRoute: vi.fn(async () => { throw new Error('auth.api unreachable'); }),
    };
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    const res = await app.request(`http://localhost${PREFIX}/auth/me/permissions`);

    expect(svc.ownsRoute).toHaveBeenCalled();
    expect(mockDispatcher.dispatch).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('only a literal `true` stops the yield — any other answer is "not owned"', async () => {
    // `undefined` is what an implementation returning nothing gives back. It
    // must read as "could not decide" (yield), never as "owned" (swallow).
    const svc = {
      handleRequest: vi.fn(async () => unrouted404()),
      ownsRoute: vi.fn(async () => undefined as unknown as boolean),
    };
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    const res = await app.request(`http://localhost${PREFIX}/auth/me/permissions`);

    expect(mockDispatcher.dispatch).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it('is not consulted at all on a non-404 — the predicate can only STOP a yield', async () => {
    const svc = {
      handleRequest: vi.fn(async () => new Response(JSON.stringify({ error: 'nope' }), { status: 401 })),
      ownsRoute: vi.fn(async () => true),
    };
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    const res = await app.request(`http://localhost${PREFIX}/auth/protected`);

    expect(res.status).toBe(401);
    expect(svc.ownsRoute).not.toHaveBeenCalled();
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('is asked with the RAW request — full wire URL and method, not the stripped subpath', async () => {
    // `AuthManager.ownsRoute` derives better-auth's endpoint path from the
    // request URL against its own configured `basePath`, and matches per
    // method. Hand it the stripped `delete-user/callback` and it decides
    // nothing. This pins the argument, not the answer.
    const svc = authServiceOwning([`${PREFIX}/auth/delete-user`], owned404);
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: PREFIX });

    await app.request(`http://localhost${PREFIX}/auth/delete-user`, { method: 'POST' });

    const seen = svc.ownsRoute.mock.calls[0][0] as Request;
    expect(seen).toBeInstanceOf(Request);
    expect(new URL(seen.url).pathname).toBe(`${PREFIX}/auth/delete-user`);
    expect(seen.method).toBe('POST');
  });

  it('respects a non-default `prefix` — ownership is asked on that mount too', async () => {
    const svc = authServiceOwning(['/custom/auth/delete-user/callback'], owned404);
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: '/custom' });

    const res = await app.request('http://localhost/custom/auth/delete-user/callback');

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Not found', code: 'NOT_FOUND' });
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });
});
