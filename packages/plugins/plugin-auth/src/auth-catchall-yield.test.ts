// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #15417 — WHICH 404 the auth catch-all is allowed to yield.
 *
 * `auth-catchall-fallthrough.test.ts` (#4088) pins that the catch-all yields at
 * all. This file pins the other edge: it may only yield a 404 that DISCLAIMS
 * ownership. A 404 from a path better-auth's own router serves is its ANSWER —
 * a switched-off capability — and handing that to the rest of the chain is how
 * it comes back as somebody else's `200 {}`.
 *
 * ── The measurement this file exists for ────────────────────────────────────
 *
 * #15417 reported `POST /api/v1/auth/admin/<nonexistent>` answering `200 {}` on
 * a cloud composition, with a nonexistent path as the control. Reproduced on a
 * framework-side boot (`@objectstack/verify` + the showcase stack, both with
 * better-auth's admin plugin off and on), that path answers **404** — bodyless,
 * no content-type — so the framework does not produce the reported status on
 * its own. What does produce it is the yield: register ONE broad downstream
 * mount after the catch-all — `app.all('/api/v1/*', c => c.json({}))`, the
 * shape a composition adds — and the same request comes back `200 {}`, because
 * the catch-all handed it on and the wildcard answered.
 *
 * That is a framework-side defect regardless of who mounts the wildcard,
 * because the request handed on need not be an unknown path at all:
 * `delete-user` answers 404 by the ledger's `disabled` disposition, and so does
 * every routed endpoint that 404s on a bad token or an unknown id. Those
 * answers were all up for grabs. Confirmed end-to-end on the framework-side
 * boot with the wildcard installed: `POST /api/v1/auth/delete-user` now
 * answers 404 where the wildcard's `200 {}` used to stand.
 *
 * ⚠️ Ownership is "does better-call ROUTE this", not "is it in `auth.api`".
 * Measured on the stock boot: the nine `/admin/oauth2/*` endpoints are in
 * `auth.api` and every one carries `SERVER_ONLY: true`, so `createRouter` skips
 * them and their 404 is an unrouted one — they stay yieldable, and the pin
 * below says so.
 *
 * ── Why the fixture stubs better-auth, and what it does NOT stub ────────────
 *
 * Same seam as the #4088 file: `handleRequest` is a path table so the test
 * controls exactly which paths the vendor claims, and the real
 * `registerAuthRoutes` runs on a real Hono app so the assertions are about the
 * shipped handler. The ownership decision is NOT stubbed — `ownsRoute` here
 * runs the real `buildBetterAuthRouteOwnership` over a fake `auth.api`, so the
 * matcher under test is the shipped one.
 *
 * The stub's 404 is `new Response(null, { status: 404 })` — bodyless, no
 * content-type — because that is what better-call 1.4.0 really returns for an
 * unrouted path (`dist/router.mjs`), and what the framework-side boot measured
 * on the wire. The #4088 fixture's JSON 404 is a convenience of that file.
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { AuthPlugin } from './auth-plugin';
import { buildBetterAuthRouteOwnership } from './better-auth-route-ownership';
import type { PluginContext } from '@objectstack/core';

const BASE = '/api/v1/auth';

/** What better-call returns for a path it does not route: bodyless, no content-type. */
const unrouted404 = () => new Response(null, { status: 404, statusText: 'Not Found' });

/**
 * Mount the real route registration on a real Hono app.
 *
 * @param api      the fake `auth.api` the REAL ownership matcher reads
 * @param answers  path -> Response for the paths better-auth answers
 */
async function mountCatchAll(
  api: Record<string, { path: string; options: { method: string | string[] } }>,
  answers: Record<string, () => Response>,
) {
  const app = new Hono();
  const ctx: PluginContext = {
    registerService: vi.fn(),
    getService: vi.fn((name: string) => (name === 'manifest' ? { register: vi.fn() } : undefined)),
    getServices: vi.fn(() => new Map()),
    hook: vi.fn(),
    trigger: vi.fn(),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
    getKernel: vi.fn(),
  } as any;

  const plugin = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long!!' });
  await plugin.init(ctx);

  const ownership = buildBetterAuthRouteOwnership(api as any);
  const handleRequest = vi.fn(async (req: Request) => {
    const make = answers[new URL(req.url).pathname];
    return make ? make() : unrouted404();
  });
  (plugin as any).authManager = {
    handleRequest,
    // The shipped matcher, over the fake table — only the endpoint-path
    // derivation is inlined here (AuthManager's own is private).
    ownsRoute: async (req: Request) =>
      ownership.owns(req.method, new URL(req.url).pathname.slice(BASE.length)),
  };

  (plugin as any).registerAuthRoutes({ getRawApp: () => app, getPort: () => 0 }, ctx);
  return { app, handleRequest };
}

/** The shape a composition adds: one wildcard over the whole API prefix. */
const addDownstreamWildcard = (app: Hono) => app.all('/api/v1/*', (c) => c.json({}));

describe('#15417: the catch-all yields only a 404 that disclaims ownership', () => {
  it('does NOT yield a 404 from a path better-auth OWNS — even with a wildcard downstream', async () => {
    // `delete-user` is published and answers 404 because `user.deleteUser` is
    // deliberately unconfigured — `auth-route-ledger.ts`'s `disabled`
    // disposition. That 404 is an ANSWER and must reach the caller.
    const { app } = await mountCatchAll(
      { deleteUser: { path: '/delete-user', options: { method: 'POST' } } },
      { [`${BASE}/delete-user`]: () => new Response(null, { status: 404 }) },
    );
    addDownstreamWildcard(app);

    const res = await app.request(`http://localhost${BASE}/delete-user`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('does not yield an owned 404 on a PARAMETERISED path either', async () => {
    // `/callback/:id` is routed and parameterised; a 404 from it is an answer.
    const { app } = await mountCatchAll(
      { callback: { path: '/callback/:id', options: { method: 'GET' } } },
      { [`${BASE}/callback/github`]: () => new Response(null, { status: 404 }) },
    );
    addDownstreamWildcard(app);

    const res = await app.request(`http://localhost${BASE}/callback/github`);

    expect(res.status).toBe(404);
  });

  it('DOES yield a SERVER_ONLY endpoint\'s 404 — better-call never routed it', async () => {
    // Measured on the stock boot: all nine `/admin/oauth2/*` endpoints are in
    // `auth.api` carrying `SERVER_ONLY: true`. `createRouter` skips them, so the
    // 404 the wire sees is an unrouted one and yielding it is correct. Were the
    // table to trust `auth.api` wholesale instead of mirroring that skip, this
    // route would stop being yieldable and a composition serving it downstream
    // would break.
    const { app } = await mountCatchAll(
      {
        adminListOAuthResources: {
          path: '/admin/oauth2/resources',
          options: { method: 'GET', metadata: { SERVER_ONLY: true } },
        },
      } as any,
      {},
    );
    app.get(`${BASE}/admin/oauth2/resources`, (c) => c.json({ from: 'sibling' }));

    const res = await app.request(`http://localhost${BASE}/admin/oauth2/resources`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: 'sibling' });
  });

  it('STILL yields a 404 from a path better-auth does not own — #4088 intact', async () => {
    // The route plugin-hono-server mounts from its own kernel:ready hook, in
    // the registration order that used to 404. Nothing may make this red.
    const { app } = await mountCatchAll({ getSession: { path: '/get-session', options: { method: 'GET' } } }, {});
    app.get(`${BASE}/me/permissions`, (c) => c.json({ authenticated: true, from: 'hono-plugin' }));

    const res = await app.request(`http://localhost${BASE}/me/permissions`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, from: 'hono-plugin' });
  });

  it('an unknown tail with nothing downstream still answers better-auth\'s 404', async () => {
    // The control the card could not run from outside. Unchanged by #15417:
    // the framework already answered 404 here, and still does.
    const { app } = await mountCatchAll({ getSession: { path: '/get-session', options: { method: 'GET' } } }, {});

    const res = await app.request(`http://localhost${BASE}/admin/definitely-not-a-route-1989`, { method: 'POST' });

    expect(res.status).toBe(404);
  });

  it('a path better-auth owns is not yielded even when the DOWNSTREAM route is specific', async () => {
    // Precedence still favours the namespace owner (the #4088 file pins this
    // for 2xx; here it is pinned for the vendor's own 404 answer).
    const { app } = await mountCatchAll(
      { deleteUser: { path: '/delete-user', options: { method: 'POST' } } },
      { [`${BASE}/delete-user`]: () => new Response(null, { status: 404 }) },
    );
    app.post(`${BASE}/delete-user`, (c) => c.json({ hijacked: true }));

    const res = await app.request(`http://localhost${BASE}/delete-user`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(await res.text()).toBe('');
  });

  it('ownership is per METHOD: the same path on a verb better-auth does not serve still yields', async () => {
    const { app } = await mountCatchAll(
      { listUsers: { path: '/admin/list-users', options: { method: 'GET' } } },
      {},
    );
    app.post(`${BASE}/admin/list-users`, (c) => c.json({ from: 'sibling' }));

    const res = await app.request(`http://localhost${BASE}/admin/list-users`, { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ from: 'sibling' });
  });

  it('still forwards to better-auth exactly once per request', async () => {
    const { app, handleRequest } = await mountCatchAll(
      { deleteUser: { path: '/delete-user', options: { method: 'POST' } } },
      { [`${BASE}/delete-user`]: () => new Response(null, { status: 404 }) },
    );
    addDownstreamWildcard(app);
    handleRequest.mockClear();

    await app.request(`http://localhost${BASE}/delete-user`, { method: 'POST' });

    expect(handleRequest).toHaveBeenCalledTimes(1);
  });
});
