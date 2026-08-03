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
 * ## Two mounting positions, and why the fixtures differ
 *
 * Hono composes the handlers that matched in registration order, so what a
 * middleware can gate depends on when Hono learned about it. This class mounts
 * ONE Hono middleware — the chain runner — and `use()` appends to the chain it
 * reads per request, so the question becomes "when was the RUNNER mounted":
 *
 *  - `installMiddlewareSeam()` up front (what `HonoServerPlugin.init()` does) —
 *    every later `use()` gates the whole server, whenever it happens.
 *  - never called — the runner is mounted on the first `use()`, so that call
 *    still has to precede the routes it means to guard.
 *
 * Both are pinned below, including the negative case, so the decoupling is not
 * mistaken for something `use()` provides on its own.
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

describe('installMiddlewareSeam decouples use() from route registration order', () => {
    it('gates routes registered AFTER it', async () => {
        const server = new HonoHttpServer(0);
        server.use((_req: IHttpRequest, res: IHttpResponse) => { res.status(429); res.send('nope'); });
        server.get('/late', (_req, res) => { res.status(200); res.send('late'); });

        expect((await call(server, '/late')).status).toBe(429);
    });

    it('gates routes registered BEFORE the use() call, once the seam was placed up front', async () => {
        // This is the composition `HonoServerPlugin` produces: it places the
        // seam at the end of its own `init()`, and consumers `use()` later —
        // from `start()`, after other plugins have already mounted routes. The
        // gate must still cover those routes, or "server-level rate limit"
        // would silently mean "whichever routes happened to be registered after
        // the limiter", i.e. a different set per deployment.
        const server = new HonoHttpServer(0);
        server.installMiddlewareSeam();
        server.get('/early', (_req, res) => { res.status(200); res.send('early'); });
        server.use((_req: IHttpRequest, res: IHttpResponse) => { res.status(429); res.send('nope'); });

        expect((await call(server, '/early')).status).toBe(429);
    });

    it('is idempotent — calling it twice does not double-run the chain', async () => {
        let runs = 0;
        const server = new HonoHttpServer(0);
        server.installMiddlewareSeam();
        server.installMiddlewareSeam();
        server.use(async (_req: IHttpRequest, _res: IHttpResponse, next: () => void | Promise<void>) => {
            runs++;
            await next();
        });
        server.get('/thing', (_req, res) => { res.status(200); res.send('ok'); });

        await call(server, '/thing');
        expect(runs).toBe(1);
    });

    it('without the seam placed up front, a use() after routes cannot gate them', async () => {
        // Pinned so the requirement above is not mistaken for an accident: the
        // decoupling comes from WHERE the seam is mounted, not from `use()`
        // itself. Hono composes matched handlers in registration order.
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
