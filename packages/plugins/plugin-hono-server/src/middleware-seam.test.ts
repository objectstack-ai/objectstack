// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `HonoHttpServer.use()` — the middleware seam, exercised through the real Hono
 * app (`app.fetch`), never a mock.
 *
 * ## Why this file exists (#4910)
 *
 * `IHttpServer.use` was DECLARED middleware and IMPLEMENTED as a no-op: both
 * branches passed `{} as any` for `req` and `res`, then called `next()`
 * unconditionally, so a middleware could not read the request, write a
 * response, or decline to continue. Nothing caught it because nothing called
 * it — `use()` had zero production call sites repo-wide. The inbound rate
 * limiter is the first consumer, and it needs exactly the three capabilities
 * the stub lacked. Each has an assertion below, so the seam cannot quietly
 * regress to a no-op again.
 *
 * ## Every fixture registers middleware BEFORE routes, on purpose
 *
 * That is the declared contract (`Middleware` in `@objectstack/spec/contracts`)
 * and it is not a wart of this implementation — Hono composes the handlers that
 * matched, in registration order, so middleware added after a route runs after
 * that route's handler and can no longer answer instead of it. The last suite
 * pins the failure mode explicitly rather than leaving it to be rediscovered.
 * Consumers satisfy the ordering for free: the kernel runs every `init()`
 * (Phase 1) before any `start()` (Phase 2), and every route in the platform is
 * mounted in some `start()`.
 */

import { describe, it, expect } from 'vitest';
import type { IHttpRequest, IHttpResponse } from '@objectstack/core';

import { HonoHttpServer } from './adapter';

/** A server whose middlewares are registered first, then its routes. */
function serverWith(...middlewares: Array<Parameters<HonoHttpServer['use']>[0]>) {
    const server = new HonoHttpServer(0);
    for (const middleware of middlewares) server.use(middleware as never);
    server.get('/api/v1/thing', (_req, res) => { res.status(200); res.json({ ok: true }); });
    server.post('/api/v1/thing', (_req, res) => { res.status(201); res.json({ created: true }); });
    server.get('/other', (_req, res) => { res.status(200); res.send('other'); });
    return server;
}

const call = (server: HonoHttpServer, path: string, init?: RequestInit) =>
    server.getRawApp().fetch(new Request(`http://localhost${path}`, init));

describe('a middleware can SHORT-CIRCUIT a request', () => {
    it('answers with its own status, headers and body when it does not call next()', async () => {
        const server = serverWith((_req: IHttpRequest, res: IHttpResponse) => {
            res.status(429);
            res.header('Retry-After', '7');
            res.json({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } });
        });

        const res = await call(server, '/api/v1/thing');
        expect(res.status).toBe(429);
        expect(res.headers.get('retry-after')).toBe('7');
        expect(await res.json()).toEqual({ success: false, error: { code: 'RATE_LIMIT_EXCEEDED' } });
    });

    it('short-circuits a path that matches NO route (the gate is in front of everything)', async () => {
        const server = serverWith((_req: IHttpRequest, res: IHttpResponse) => {
            res.status(503);
            res.send('maintenance');
        });

        const res = await call(server, '/not-a-route');
        expect(res.status).toBe(503);
        expect(await res.text()).toBe('maintenance');
    });
});

describe('a middleware can PASS THROUGH', () => {
    it('reaches the route handler when it calls next()', async () => {
        let seen = 0;
        const server = serverWith(async (_req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => {
            seen++;
            await next();
        });

        const res = await call(server, '/api/v1/thing');
        expect(seen).toBe(1);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
    });

    it('treats "neither next() nor a response" as pass-through, never a black hole', async () => {
        const server = serverWith(() => { /* forgot both branches */ });
        expect((await call(server, '/api/v1/thing')).status).toBe(200);
    });

    it('runs middlewares in registration order and stops at the first that answers', async () => {
        const order: string[] = [];
        const server = serverWith(
            async (_req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => { order.push('a'); await next(); },
            (_req: IHttpRequest, res: IHttpResponse) => { order.push('b'); res.status(418); res.send('no'); },
            async (_req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => { order.push('c'); await next(); },
        );

        const res = await call(server, '/api/v1/thing');
        expect(res.status).toBe(418);
        expect(order).toEqual(['a', 'b']);
    });
});

describe('a middleware can READ the request', () => {
    it('sees method, path, query and headers', async () => {
        let captured: IHttpRequest | undefined;
        const server = serverWith(async (req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => {
            captured = req;
            await next();
        });

        await call(server, '/api/v1/thing?top=2', { headers: { 'x-probe': 'yes' } });

        expect(captured?.method).toBe('GET');
        expect(captured?.path).toBe('/api/v1/thing');
        expect(captured?.query).toMatchObject({ top: '2' });
        expect(captured?.headers['x-probe']).toBe('yes');
    });

    it('does NOT populate the body — the route handler still owns the stream', async () => {
        let body: unknown = 'sentinel';
        const server = serverWith(async (req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => {
            body = req.body;
            await next();
        });

        const res = await call(server, '/api/v1/thing', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ hello: 'world' }),
        });

        expect(body).toBeUndefined();
        // …and the handler behind it still ran, i.e. the stream was not consumed.
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ created: true });
    });
});

describe('path-scoped middleware', () => {
    it('runs only for matching paths', async () => {
        const server = new HonoHttpServer(0);
        server.use('/api/v1/*', (_req: IHttpRequest, res: IHttpResponse) => { res.status(403); res.send('scoped'); });
        server.get('/api/v1/thing', (_req, res) => { res.status(200); res.json({ ok: true }); });
        server.get('/other', (_req, res) => { res.status(200); res.send('other'); });

        expect((await call(server, '/api/v1/thing')).status).toBe(403);
        expect((await call(server, '/other')).status).toBe(200);
    });
});

describe('the documented ordering requirement, pinned', () => {
    it('gates routes registered AFTER it', async () => {
        const server = new HonoHttpServer(0);
        server.use((_req: IHttpRequest, res: IHttpResponse) => { res.status(429); res.send('nope'); });
        server.get('/late', (_req, res) => { res.status(200); res.send('late'); });

        expect((await call(server, '/late')).status).toBe(429);
    });

    it('does NOT gate routes registered BEFORE it — register in init(), not start()', async () => {
        // Not a defect to fix here: it is Hono's composition order, and pinning
        // it is what stops a future consumer from registering the limiter in
        // `start()` and shipping a gate that covers a different set of paths per
        // deployment depending on plugin registration order.
        const server = new HonoHttpServer(0);
        server.get('/early', (_req, res) => { res.status(200); res.send('early'); });
        server.use((_req: IHttpRequest, res: IHttpResponse) => { res.status(429); res.send('nope'); });

        expect((await call(server, '/early')).status).toBe(200);
    });
});

describe('the seam costs nothing when unused', () => {
    it('does not mount a Hono middleware until the first use() call', async () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/thing', (_req, res) => { res.status(200); res.json({ ok: true }); });
        expect((await call(server, '/api/v1/thing')).status).toBe(200);
    });
});
