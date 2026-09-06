// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16025 — WHERE the adapter mounts the auth surface, and the boot refusal that
 * guards it.
 *
 * `hono-auth-owned-404.test.ts` (#15928) pins WHICH 404 that mount may yield;
 * its own "not covered" list names this file's subject as the gap it leaves:
 * "the `basePath`/`prefix` alignment". This file closes it.
 *
 * ## The measurement this file exists for
 *
 * Re-driven on the CURRENT tree — a real `ObjectKernel` with `AuthPlugin` (a
 * real `AuthManager` over better-auth) via `@objectstack/verify`'s `bootStack`,
 * the DOCUMENTED embed `createHonoApp({ kernel })` with both defaults
 * untouched, requests injected through the returned app.
 *
 * BEFORE:
 *
 *     POST /api/auth/sign-in/email  (valid shape, wrong password)  ->  200 {}
 *     GET  /api/auth/get-session                                   ->  200 {}
 *     POST /api/auth/sign-up/email                                 ->  200 {}
 *     POST /api/v1/auth/delete-user                                ->  404 ROUTE_NOT_FOUND
 *
 * AFTER:
 *
 *     POST /api/v1/auth/sign-in/email  (wrong password)  ->  401 {"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}
 *     GET  /api/v1/auth/get-session                      ->  200 null
 *     POST /api/v1/auth/sign-up/email                    ->  403 {"code":"SELF_REGISTRATION_CLOSED",…}
 *     POST /api/v1/auth/delete-user                      ->  401 {"message":"Unauthorized","code":"UNAUTHORIZED"}
 *
 * A failed sign-in answering `200 {}` is the silent-success shape: a client
 * reading `res.ok` sends the user into an authenticated view with no session.
 * The `401` row is better-auth answering for real — the arrival proof.
 *
 * Maintainer ruling of 2026-09-06 (director batch #54), options A + B: the
 * mount FOLLOWS the auth service's `basePath` (B), and a `prefix` the base is
 * not inside REFUSES AT BOOT naming both values (A). ⛔ Neither default moves.
 *
 * ## ⭐ Why these cases assert a RELATION, not the string `/api/v1/auth`
 *
 * A pin that asserted the mount equals `/api/v1/auth` would be mirroring a
 * default that lives in another package (`@objectstack/plugin-auth`), and this
 * package neither depends on it nor can. Every case below asserts the mount is
 * WHATEVER THE SERVICE ANSWERED — so a repair that hard-coded today's default
 * fails them, and moving that default in plugin-auth cannot silently invalidate
 * them. `/api/v1/auth` appears in one case only, as the card's own composition.
 *
 * ## ⛔ What these cases do NOT cover
 *
 *   - That the kernel's real `auth` service carries `getBasePath` at all, or
 *     that its answer is the string better-auth really matches under. Both are
 *     `@objectstack/plugin-auth`'s to keep (`auth-manager-base-path.test.ts`
 *     pins the accessor there, and `AuthManager` hands better-auth that very
 *     expression), and both were measured on the real boot quoted above. This
 *     package does not depend on `@objectstack/plugin-auth` and gains no
 *     dependency here — the same boundary #15928's file records.
 *   - The `200 {}` the BEFORE rows carried. That is manufactured one layer out,
 *     by the terminal dispatcher catch-all rendering a `Response` result as
 *     `c.json(res, 200)`; the card names it as a sibling finding and places it
 *     outside its own scope. It still stands on `${prefix}/auth/*` after this
 *     change, and no case here asserts otherwise.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Hono } from 'hono';

const mockDispatcher = {
  dispatch: vi.fn(),
  handleAuth: vi.fn(),
  getDiscoveryInfo: vi.fn(async () => ({})),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

/** The shape of the `200 {}` the real dispatcher catch-all answers with. */
const DISPATCH_ANSWERED = { handled: true, response: { body: {}, status: 200 } };

/** better-auth's real refusal on a routed path — the arrival shape the card names. */
const unauthorized = () => new Response(
  JSON.stringify({ message: 'Unauthorized', code: 'UNAUTHORIZED' }),
  { status: 401, headers: { 'Content-Type': 'application/json' } },
);

const kernelWith = (authService?: unknown) => ({
  name: 'test-kernel',
  getService: (n: string) => (n === 'auth' && authService ? authService : undefined),
}) as any;

/** A kernel whose `auth` is factory-registered: the sync accessor throws. */
const kernelWithAsyncOnlyAuth = () => ({
  name: 'test-kernel',
  getService: (n: string) => {
    if (n === 'auth') throw new Error(`Service '${n}' is async - use await`);
    return undefined;
  },
}) as any;

/** An auth service that answers where it serves, in the kernel's real shape. */
const authServiceAt = (basePath: unknown, answer: () => Response = unauthorized) => ({
  handleRequest: vi.fn(async () => answer()),
  getBasePath: vi.fn(() => basePath as string),
});

/** The pre-#16025 shape: a service that does not say where it serves. */
const authServiceWithoutAccessor = (answer: () => Response = unauthorized) => ({
  handleRequest: vi.fn(async () => answer()),
});

beforeEach(() => {
  vi.clearAllMocks();
  mockDispatcher.dispatch.mockResolvedValue(DISPATCH_ANSWERED);
  mockDispatcher.handleAuth.mockResolvedValue({ handled: false });
});

describe('#16025 B: the /auth mount follows the auth service, not the adapter prefix', () => {
  it("reaches the auth service on the card's own composition — default prefix, base /api/v1/auth", async () => {
    // The documented embed: `createHonoApp({ kernel })`, both defaults untouched.
    const svc = authServiceAt('/api/v1/auth');
    const app: Hono = createHonoApp({ kernel: kernelWith(svc) });

    const res = await app.request('http://localhost/api/v1/auth/delete-user', { method: 'POST' });

    // ADR-0112 envelope: the code and the status, not merely "it threw".
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: 'Unauthorized', code: 'UNAUTHORIZED' });
    expect(svc.handleRequest).toHaveBeenCalledTimes(1);
    // The load-bearing half: nothing downstream answered in its place.
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('does NOT mount at `${prefix}/auth` any more — the wire path the card measured', async () => {
    const svc = authServiceAt('/api/v1/auth');
    const app: Hono = createHonoApp({ kernel: kernelWith(svc) });

    await app.request('http://localhost/api/auth/sign-in/email', { method: 'POST' });

    // The defect was that THIS path claimed the mount and then forwarded a
    // request better-auth does not route. It reaches the catch-all instead.
    expect(svc.handleRequest).not.toHaveBeenCalled();
    expect(mockDispatcher.dispatch).toHaveBeenCalled();
  });

  it('follows an ARBITRARY base the service answers — the rule, not the default', async () => {
    const svc = authServiceAt('/api/v9/identity');
    const app: Hono = createHonoApp({ kernel: kernelWith(svc) });

    const reached = await app.request('http://localhost/api/v9/identity/delete-user', { method: 'POST' });
    expect(reached.status).toBe(401);
    expect(svc.handleRequest).toHaveBeenCalledTimes(1);

    // …and today's plugin-auth default is NOT special-cased into the mount.
    await app.request('http://localhost/api/v1/auth/delete-user', { method: 'POST' });
    expect(svc.handleRequest).toHaveBeenCalledTimes(1);
  });

  it('resolves the adapter-owned /auth/config route relative to the mount', async () => {
    const svc = {
      handleRequest: vi.fn(async () => unauthorized()),
      getBasePath: () => '/api/v1/auth',
      getPublicConfig: () => ({ features: {} }),
    };
    const app: Hono = createHonoApp({ kernel: kernelWith(svc) });

    const res = await app.request('http://localhost/api/v1/auth/config');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { features: {} } });
    // `config` is answered by the adapter, never forwarded.
    expect(svc.handleRequest).not.toHaveBeenCalled();
  });

  it('normalises what the service answers — a missing leading or trailing slash is the same base', async () => {
    for (const spelling of ['api/v1/auth', '/api/v1/auth/', '/api/v1/auth//']) {
      const svc = authServiceAt(spelling);
      const app: Hono = createHonoApp({ kernel: kernelWith(svc) });
      const res = await app.request('http://localhost/api/v1/auth/delete-user', { method: 'POST' });
      expect(res.status, `mount for ${JSON.stringify(spelling)}`).toBe(401);
    }
  });
});

describe('#16025 A: a prefix the auth base is not inside refuses at boot', () => {
  it('refuses, and the message names BOTH values and the fix', () => {
    const svc = authServiceAt('/api/v1/auth');

    let thrown: Error | undefined;
    try {
      createHonoApp({ kernel: kernelWith(svc), prefix: '/custom' });
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown, 'a misaligned composition must not build an app').toBeDefined();
    // Both values, because a refusal naming one of them cannot be acted on.
    expect(thrown!.message).toContain('/api/v1/auth');
    expect(thrown!.message).toContain('/custom');
    // And the one-line fix, in both directions.
    expect(thrown!.message).toContain('createHonoApp({ kernel, prefix:');
    expect(thrown!.message).toContain('new AuthPlugin({ basePath:');
  });

  it('⭐ does NOT refuse the prefixes the base IS inside — the over-refusal control', () => {
    // A repair that refused everything would pass the case above. These three
    // are the compositions that must keep booting: the default embed, the
    // prefix the card measured as already lining up, and the base itself.
    const svc = authServiceAt('/api/v1/auth');
    for (const prefix of [undefined, '/api', '/api/v1', '/api/v1/auth'] as const) {
      expect(
        () => createHonoApp(prefix === undefined
          ? { kernel: kernelWith(svc) }
          : { kernel: kernelWith(svc), prefix }),
        `prefix ${String(prefix)}`,
      ).not.toThrow();
    }
  });

  it('refuses a base that only SHARES A PREFIX STRING with the namespace', () => {
    // `/apifoo/auth` starts with the five characters of `/api` and is not
    // inside it — the same segment-boundary trap #16026 closed one layer down.
    const svc = authServiceAt('/apifoo/auth');
    expect(() => createHonoApp({ kernel: kernelWith(svc), prefix: '/api' })).toThrow(/apifoo/);
  });
});

describe('#16025 residuals: what stays exactly as it was', () => {
  it('an auth service that does not answer getBasePath keeps the ${prefix}/auth mount', async () => {
    const svc = authServiceWithoutAccessor();
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: '/api/v1' });

    const res = await app.request('http://localhost/api/v1/auth/delete-user', { method: 'POST' });

    expect(res.status).toBe(401);
    expect(svc.handleRequest).toHaveBeenCalledTimes(1);
  });

  it('…and buys no refusal, because nothing here can tell aligned from misaligned', () => {
    const svc = authServiceWithoutAccessor();
    expect(() => createHonoApp({ kernel: kernelWith(svc), prefix: '/custom' })).not.toThrow();
  });

  it('a kernel with no auth service at all still mounts, and still reaches the dispatcher fallback', async () => {
    mockDispatcher.handleAuth.mockResolvedValue({ handled: true, response: { body: { ok: true }, status: 200 } });
    const app: Hono = createHonoApp({ kernel: kernelWith(undefined) });

    const res = await app.request('http://localhost/api/auth/anything', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(mockDispatcher.handleAuth).toHaveBeenCalled();
  });

  it('a factory-registered auth service (sync accessor throws) degrades to the legacy mount', async () => {
    const app: Hono = createHonoApp({ kernel: kernelWithAsyncOnlyAuth(), prefix: '/api/v1' });

    // No throw at construction, and the pre-#16025 mount is still in place.
    await app.request('http://localhost/api/v1/auth/anything', { method: 'POST' });
    expect(mockDispatcher.handleAuth).toHaveBeenCalled();
  });

  it('an unusable getBasePath answer degrades instead of moving the mount to nonsense', async () => {
    const answers: unknown[] = [undefined, null, 42, '', '   ', '/', '//'];
    for (const answer of answers) {
      const svc = authServiceAt(answer);
      const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: '/api/v1' });
      const res = await app.request('http://localhost/api/v1/auth/delete-user', { method: 'POST' });
      expect(res.status, `answer ${JSON.stringify(answer)}`).toBe(401);
      expect(svc.handleRequest, `answer ${JSON.stringify(answer)}`).toHaveBeenCalledTimes(1);
    }
  });

  it('a getBasePath that THROWS degrades to the legacy mount rather than taking boot down', async () => {
    const svc = {
      handleRequest: vi.fn(async () => unauthorized()),
      getBasePath: () => { throw new Error('service is still starting'); },
    };
    const app: Hono = createHonoApp({ kernel: kernelWith(svc), prefix: '/api/v1' });

    const res = await app.request('http://localhost/api/v1/auth/delete-user', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(svc.handleRequest).toHaveBeenCalledTimes(1);
  });
});
