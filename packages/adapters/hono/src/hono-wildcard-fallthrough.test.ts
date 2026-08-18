// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4117 — the `/auth/*` mount must yield paths it does not own.
 *
 * It claims a whole namespace and used to be TERMINAL: it answered 404 for a path
 * its auth service does not implement. Found by #4116's scan, which no manual grep
 * had managed. Its `/storage/*` twin was ratcheted alongside it and is now gone
 * entirely — #4087/#4112 deleted that bridge after reaching the same conclusion
 * from the other direction ("the wildcard was wider than the two routes it
 * served").
 *
 * ## What yielding buys HERE, precisely
 *
 * Not what it bought in #4092. There, yielding made another plugin's route
 * reachable. In this adapter it cannot: the `${prefix}/*` dispatcher catch-all
 * is registered right after these two and is DELIBERATELY terminal (ADR-0076
 * OQ#9, #3576/#3608 — the gate stages live inside `dispatch()`, so splitting it
 * into per-prefix Hono mounts would bypass them). So a route registered later
 * under `/api/auth/*` is swallowed by the catch-all whether or not these two
 * yield, and Hono-route mounting is not this adapter's extension path at all —
 * registering a domain handler is.
 *
 * What yielding buys is that an unowned `/auth/*` or `/storage/*` path now
 * reaches that gated `dispatch()` instead of dead-ending in a 404 built two
 * mounts earlier. A domain handler registered for such a path becomes
 * reachable, which is exactly the adapter's intended mechanism. These tests pin
 * that, and pin that the owners still win everything they own.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Hono } from 'hono';

const mockDispatcher = {
  getDiscoveryInfo: vi.fn().mockReturnValue({ version: '1.0', routes: {} }),
  handleAuth: vi.fn(),
  handleGraphQL: vi.fn(),
  dispatch: vi.fn(),
};

vi.mock('@objectstack/runtime', () => ({
  HttpDispatcher: function HttpDispatcher() { return mockDispatcher; },
}));

import { createHonoApp } from './index';

/** No domain claimed the path — the dispatcher's own ownership signal. */
const UNHANDLED = { handled: false };
const HANDLED = (body: unknown, status = 200) => ({ handled: true, response: { body, status } });

/** A kernel whose `auth` service is (or is not) present. */
const kernelWith = (authService?: unknown) => ({
  name: 'test-kernel',
  getService: (n: string) => (n === 'auth' && authService ? authService : undefined),
}) as any;

const authServiceReturning = (status: number, body: unknown = { from: 'better-auth' }) => ({
  handleRequest: vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })),
});

describe('auth mount yields paths better-auth does not own (#4117)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDispatcher.dispatch.mockResolvedValue(UNHANDLED);
    mockDispatcher.handleAuth.mockResolvedValue(UNHANDLED);
  });

  it('reaches the gated dispatch when better-auth 404s', async () => {
    // `/auth/me/permissions` is the canonical unowned path: nothing in
    // better-auth serves it. Before #4117 this 404'd here; now the request gets
    // a real dispatch attempt, so a domain handler for it is reachable.
    mockDispatcher.dispatch.mockResolvedValue(HANDLED({ authenticated: true, from: 'dispatch' }));
    const app: Hono = createHonoApp({ kernel: kernelWith(authServiceReturning(404)) });

    const res = await app.request('/api/auth/me/permissions');

    expect(mockDispatcher.dispatch).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ authenticated: true, from: 'dispatch' });
  });

  it('keeps better-auth winning the paths it DOES own', async () => {
    const app: Hono = createHonoApp({ kernel: kernelWith(authServiceReturning(200, { user: null })) });

    const res = await app.request('/api/auth/get-session');

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: null });
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('does NOT yield on 401 — a real answer, not a disclaimer of ownership', async () => {
    const app: Hono = createHonoApp({ kernel: kernelWith(authServiceReturning(401, { error: 'nope' })) });

    const res = await app.request('/api/auth/protected');

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'nope' });
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });

  it('yields on the dispatcher path too, keyed on `handled: false`', async () => {
    // No auth service at all, so the mount falls back to `dispatcher.handleAuth`
    // — whose explicit `handled` flag beats inferring ownership from a status.
    mockDispatcher.dispatch.mockResolvedValue(HANDLED({ currency: 'USD' }));
    const app: Hono = createHonoApp({ kernel: kernelWith() });

    const res = await app.request('/api/auth/me/localization');

    expect(mockDispatcher.handleAuth).toHaveBeenCalled();
    expect(mockDispatcher.dispatch).toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ currency: 'USD' });
  });

  it('still lets handleAuth answer what it DOES handle', async () => {
    mockDispatcher.handleAuth.mockResolvedValue(HANDLED({ ok: true }));
    const app: Hono = createHonoApp({ kernel: kernelWith() });

    const res = await app.request('/api/auth/login', { method: 'POST' });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mockDispatcher.dispatch).not.toHaveBeenCalled();
  });
});

describe('the enveloped 404 survives when nothing anywhere claims the path', () => {
  beforeEach(() => vi.clearAllMocks());

  it('still ends in the enveloped 404 when nothing anywhere claims it', async () => {
    mockDispatcher.handleAuth.mockResolvedValue(UNHANDLED);
    mockDispatcher.dispatch.mockResolvedValue(UNHANDLED);
    const app: Hono = createHonoApp({ kernel: kernelWith() });

    const res = await app.request('/api/auth/nope');

    expect(res.status).toBe(404);
    // Not Hono's bare "404 Not Found" text — the platform envelope is preserved.
    // `error.code` carries the ADR-0112 SEMANTIC member for the status, not the
    // status itself: this body used to read `code: 404`, a number in the slot
    // `ApiErrorSchema` declares as a closed string vocabulary (#9364).
    expect(await res.json()).toEqual({
      success: false,
      error: { code: 'RESOURCE_NOT_FOUND', message: 'Not Found' },
    });
  });
});
