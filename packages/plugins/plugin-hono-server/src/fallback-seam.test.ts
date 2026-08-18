// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `HonoHttpServer.setFallbackHandler()` — the unmatched-request seam, exercised
 * through the real Hono app (`app.fetch`), never a mock.
 *
 * ## Why this file exists (#5090, #5040 E3)
 *
 * The contract on `IHttpServer.setFallbackHandler` makes four promises, and
 * each one is a thing an implementation could plausibly get wrong:
 *
 *  1. it runs ONLY after every registered route missed — the reason this is a
 *     `notFound` hook and not a `${prefix}/*` wildcard route, which Hono would
 *     resolve by first-registration-wins across plugin `start()` order
 *     (ADR-0076 D11);
 *  2. `req.body` IS readable here, unlike the `use()` middleware seam whose
 *     contract explicitly does not populate it;
 *  3. installing again REPLACES — one fallback, never a chain;
 *  4. a handler that writes NOTHING leaves the adapter's standard answer in
 *     place — 404, or 405 + `Allow` for a method mismatch.
 *
 * (4) is also the design-flagged risk (#5040 §7-1) made concrete: Hono routes a
 * method mismatch to the SAME `notFound` sink as a missing path, so the
 * fallback sees those requests too and must be able to decline them without
 * costing the 405. `notfound-405.test.ts` pins the no-fallback baseline; this
 * file pins it with a fallback installed.
 */

import { describe, it, expect } from 'vitest';
import type { IHttpRequest, IHttpResponse } from '@objectstack/core';

import { HonoHttpServer } from './adapter';

/** A server with routes + the standard unmatched-request seam mounted. */
function serverWithRoutes() {
    const server = new HonoHttpServer(0);
    server.get('/api/v1/thing', (_req, res) => { res.status(200); res.json({ route: 'get' }); });
    server.post('/api/v1/thing', (_req, res) => { res.status(201); res.json({ route: 'post' }); });
    server.put('/api/v1/only-put', (_req, res) => { res.status(200); res.json({ route: 'put' }); });
    server.installNotFoundSeam();
    return server;
}

const call = (server: HonoHttpServer, path: string, init?: RequestInit) =>
    server.getRawApp().fetch(new Request(`http://localhost${path}`, init));

const postJson = (server: HonoHttpServer, path: string, body: unknown) =>
    call(server, path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });

describe('guarantee 1 — a fallback can never shadow a registered route', () => {
    it('does not run for a path+method a route owns', async () => {
        const server = serverWithRoutes();
        let ran = false;
        server.setFallbackHandler((_req, res) => { ran = true; res.status(200); res.json({ from: 'fallback' }); });

        const res = await call(server, '/api/v1/thing');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ route: 'get' });
        expect(ran, 'fallback ran for a request a registered route matched').toBe(false);
    });

    it('is order-independent — installing BEFORE the routes changes nothing', async () => {
        // The whole point of mapping onto `notFound` instead of a wildcard
        // route: with a `${prefix}/*` route this test is the one that fails.
        const server = new HonoHttpServer(0);
        server.setFallbackHandler((_req, res) => { res.status(200); res.json({ from: 'fallback' }); });
        server.get('/api/v1/thing', (_req, res) => { res.status(200); res.json({ route: 'get' }); });

        expect(await (await call(server, '/api/v1/thing')).json()).toEqual({ route: 'get' });
        expect(await (await call(server, '/api/v1/other')).json()).toEqual({ from: 'fallback' });
    });

    it('runs for a path no route owns', async () => {
        const server = serverWithRoutes();
        const seen: Array<{ method: string; path: string }> = [];
        server.setFallbackHandler((req, res) => {
            seen.push({ method: req.method, path: req.path });
            res.status(200);
            res.json({ from: 'fallback' });
        });

        const res = await call(server, '/api/v1/apps/showcase/tasks');
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ from: 'fallback' });
        expect(seen).toEqual([{ method: 'GET', path: '/api/v1/apps/showcase/tasks' }]);
    });
});

describe('guarantee 2 — the fallback receives a fully populated request', () => {
    it('reads a JSON body (the difference from the `use()` middleware seam)', async () => {
        const server = serverWithRoutes();
        let received: IHttpRequest | undefined;
        server.setFallbackHandler((req, res) => { received = req; res.status(200); res.json({ ok: true }); });

        await postJson(server, '/api/v1/apps/showcase/inquiries/purge?dry=1', { reason: 'stale', count: 3 });

        expect(received?.body).toEqual({ reason: 'stale', count: 3 });
        expect(received?.query).toEqual({ dry: '1' });
        expect(received?.method).toBe('POST');
        expect(received?.path).toBe('/api/v1/apps/showcase/inquiries/purge');
        expect(received?.headers['content-type']).toContain('application/json');
        // Backfilled from the URL — Fetch `Request` hides the Host header, and
        // hostname-based environment routing depends on it.
        expect(received?.headers.host).toBe('localhost');
        expect(typeof received?.rawBody).toBe('function');
    });

    it('parses a form body by content-type, exactly as a route handler would', async () => {
        const server = serverWithRoutes();
        let routeBody: unknown;
        let fallbackBody: unknown;
        server.post('/api/v1/echo', (req, res) => { routeBody = req.body; res.status(200); res.json({ ok: true }); });
        server.setFallbackHandler((req, res) => { fallbackBody = req.body; res.status(200); res.json({ ok: true }); });

        const form = () => {
            const body = new URLSearchParams({ a: '1', b: 'two' });
            return { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body };
        };
        await call(server, '/api/v1/echo', form() as RequestInit);
        await call(server, '/api/v1/apps/showcase/form', form() as RequestInit);

        expect(fallbackBody).toEqual({ a: '1', b: 'two' });
        expect(fallbackBody).toEqual(routeBody);
    });

    it('leaves `body` an empty object when there is none', async () => {
        const server = serverWithRoutes();
        let received: IHttpRequest | undefined;
        server.setFallbackHandler((req, res) => { received = req; res.status(200); res.json({ ok: true }); });

        await call(server, '/api/v1/apps/showcase/tasks');
        expect(received?.body).toEqual({});
    });
});

describe('guarantee 3 — installing again REPLACES', () => {
    it('runs only the most recently installed handler', async () => {
        const server = serverWithRoutes();
        const ran: string[] = [];
        server.setFallbackHandler((_req, res) => { ran.push('first'); res.status(200); res.json({ which: 'first' }); });
        server.setFallbackHandler((_req, res) => { ran.push('second'); res.status(200); res.json({ which: 'second' }); });

        const res = await call(server, '/api/v1/apps/showcase/tasks');
        expect(await res.json()).toEqual({ which: 'second' });
        expect(ran).toEqual(['second']);
    });

    it('does not stack the `notFound` hook when installed repeatedly', async () => {
        const server = serverWithRoutes();
        let calls = 0;
        for (let i = 0; i < 3; i++) {
            server.setFallbackHandler((_req, res) => { calls++; res.status(200); res.json({ i }); });
        }
        await call(server, '/api/v1/apps/showcase/tasks');
        expect(calls).toBe(1);
    });
});

describe('guarantee 4 — a fallback that writes nothing leaves the standard answer', () => {
    it('keeps the 404 body byte-for-byte', async () => {
        const withoutFallback = serverWithRoutes();
        const baseline = await call(withoutFallback, '/api/v1/apps/showcase/tasks');

        const server = serverWithRoutes();
        let ran = false;
        server.setFallbackHandler(() => { ran = true; /* declines */ });
        const res = await call(server, '/api/v1/apps/showcase/tasks');

        expect(ran).toBe(true);
        expect(res.status).toBe(baseline.status);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(await baseline.text());
        expect(JSON.parse(await (await call(serverWithRoutes(), '/api/v1/nope')).text()))
            .toEqual({
                success: false,
                error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
            });
    });

    it('keeps the 405 + `Allow` answer for a method mismatch (#5040 §7-1)', async () => {
        // Hono sends a method mismatch to the SAME notFound sink, so the
        // fallback is consulted for these too — and declining must not cost the
        // 405 that `notfound-405.test.ts` pins without a fallback installed.
        const server = serverWithRoutes();
        const seen: string[] = [];
        server.setFallbackHandler((req) => { seen.push(`${req.method} ${req.path}`); });

        const res = await call(server, '/api/v1/only-put', { method: 'DELETE' });
        expect(res.status).toBe(405);
        expect(res.headers.get('Allow')).toBe('PUT');
        const body = await res.json();
        expect(body.success).toBe(false);
        expect(body.error.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.error.details.allowed).toEqual(['PUT']);
        expect(seen).toEqual(['DELETE /api/v1/only-put']);
    });

    it('answers 405 rather than the fallback even when the fallback WOULD answer', async () => {
        // Declining is the fallback's own choice; a fallback that answers a
        // method mismatch is allowed to (it saw the request first, by contract).
        // Pinned so the precedence is a decision on record, not an accident.
        const server = serverWithRoutes();
        server.setFallbackHandler((req, res) => {
            if (req.path.startsWith('/api/v1/apps/')) { res.status(200); res.json({ from: 'fallback' }); }
        });
        const res = await call(server, '/api/v1/only-put', { method: 'DELETE' });
        expect(res.status).toBe(405);
    });
});

describe('failure modes', () => {
    it('reports a THROWING fallback as a 500 instead of hiding it in the 404', async () => {
        const server = serverWithRoutes();
        server.setFallbackHandler(() => { throw new Error('boom'); });
        const res = await call(server, '/api/v1/apps/showcase/tasks');
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'INTERNAL_ERROR', message: 'Fallback handler failed' },
        });
    });

    it('honours a status set without a body (the `res.end()` shape)', async () => {
        const server = serverWithRoutes();
        server.setFallbackHandler((_req, res: IHttpResponse) => { res.status(204); res.end?.(); });
        const res = await call(server, '/api/v1/apps/showcase/tasks');
        expect(res.status).toBe(204);
    });

    it('a bare server without the seam keeps Hono\'s own 404 (no silent behavior change)', async () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/thing', (_req, res) => { res.json({ ok: true }); });
        const res = await server.getRawApp().fetch(new Request('http://localhost/api/v1/nope'));
        expect(res.status).toBe(404);
        // Hono's built-in answer — NOT this adapter's enveloped 404 body.
        expect(await res.text()).toBe('404 Not Found');
    });
});
