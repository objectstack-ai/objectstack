// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4088 — the auth catch-all must not swallow other plugins' routes.
 *
 * `registerAuthRoutes` mounts `rawApp.all('${basePath}/*')` over the whole auth
 * namespace. It used to be TERMINAL — better-auth's response was returned
 * unconditionally, including the 404 better-auth produces for a path it does
 * not implement. Any other plugin's route under that prefix was therefore
 * reachable only if it happened to register FIRST (Hono runs handlers matching
 * a path in registration order; first to return a Response wins).
 *
 * That made a load-bearing surface depend on `kernel.use()` order:
 * `plugin-hono-server` mounts `/auth/me/permissions` + `/auth/me/localization`
 * from its own `kernel:ready` hook, objectui's whole permission layer reads the
 * former and `core`'s auth gate allow-lists the latter — and all of it silently
 * 404s if AuthPlugin is registered first.
 *
 * These tests register the catch-all FIRST and the specific route SECOND, i.e.
 * exactly the order that used to fail, and drive a real Hono app so the
 * assertions are about the shipped handler rather than a stand-in.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { AuthPlugin } from './auth-plugin';
import type { PluginContext } from '@objectstack/core';

const BASE = '/api/v1/auth';

/** better-auth's own 404 for a path it does not implement. */
const BETTER_AUTH_404 = { message: 'Not Found', code: 'NOT_FOUND' };

/**
 * Mount the plugin's real route registration on a real Hono app, with
 * better-auth stubbed by a path → Response table so we control exactly which
 * paths the namespace owner claims.
 */
async function mountCatchAll(owned: Record<string, () => Response>) {
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

    const handleRequest = vi.fn(async (req: Request) => {
        const path = new URL(req.url).pathname;
        const make = owned[path];
        if (make) return make();
        return new Response(JSON.stringify(BETTER_AUTH_404), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    });
    (plugin as any).authManager = { handleRequest };

    const httpServer: any = { getRawApp: () => app, getPort: () => 0 };
    (plugin as any).registerAuthRoutes(httpServer, ctx);

    return { app, handleRequest };
}

describe('auth catch-all yields paths better-auth does not own (#4088)', () => {
    let mounted: Awaited<ReturnType<typeof mountCatchAll>>;

    beforeEach(async () => {
        mounted = await mountCatchAll({
            // A path better-auth really implements, plus one that answers 401.
            [`${BASE}/get-session`]: () => new Response(JSON.stringify({ user: null }), { status: 200 }),
            [`${BASE}/protected`]: () => new Response(JSON.stringify({ error: 'nope' }), { status: 401 }),
        });
    });

    it('lets a LATER-registered route answer — the order that used to 404', async () => {
        // The real collision: plugin-hono-server mounts this from its own
        // kernel:ready hook, which may run after AuthPlugin's.
        mounted.app.get(`${BASE}/me/permissions`, (c) => c.json({ authenticated: true, from: 'hono-plugin' }));

        const res = await mounted.app.request(`http://localhost${BASE}/me/permissions`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ authenticated: true, from: 'hono-plugin' });
    });

    it('does the same for /auth/me/localization', async () => {
        mounted.app.get(`${BASE}/me/localization`, (c) => c.json({ authenticated: true, currency: 'USD' }));

        const res = await mounted.app.request(`http://localhost${BASE}/me/localization`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ authenticated: true, currency: 'USD' });
    });

    it('keeps better-auth winning every path it DOES own', async () => {
        // Precedence must still favour the namespace owner: a later route must
        // not be able to hijack a real better-auth endpoint.
        mounted.app.get(`${BASE}/get-session`, (c) => c.json({ hijacked: true }));

        const res = await mounted.app.request(`http://localhost${BASE}/get-session`);

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ user: null });
    });

    it('does NOT fall through on 401 — that is a real answer, not a disclaimer', async () => {
        mounted.app.get(`${BASE}/protected`, (c) => c.json({ leaked: true }));

        const res = await mounted.app.request(`http://localhost${BASE}/protected`);

        expect(res.status).toBe(401);
        expect(await res.json()).toEqual({ error: 'nope' });
    });

    it('returns better-auth’s own 404 verbatim when nothing else matches', async () => {
        // The wire shape for a genuinely unclaimed auth path must not change:
        // no route is registered for this path, so the fall-through finds
        // nothing and better-auth's 404 stands.
        const res = await mounted.app.request(`http://localhost${BASE}/no-such-endpoint`);

        expect(res.status).toBe(404);
        expect(await res.json()).toEqual(BETTER_AUTH_404);
    });

    it('still forwards to better-auth exactly once per request', async () => {
        mounted.app.get(`${BASE}/me/permissions`, (c) => c.json({ ok: true }));
        mounted.handleRequest.mockClear();

        await mounted.app.request(`http://localhost${BASE}/me/permissions`);

        expect(mounted.handleRequest).toHaveBeenCalledTimes(1);
    });
});
