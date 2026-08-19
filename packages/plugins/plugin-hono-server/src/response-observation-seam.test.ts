// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `HonoHttpServer.afterResponse` — the adapter-local edges of the #9835
 * response-observation seam. Cross-adapter semantics (pattern-never-path,
 * unmatched label, append registration, observer isolation) are locked in
 * `@objectstack/http-conformance`; the runtime's integration file pins the
 * composed-kernel behavior. What is pinned HERE is what only this adapter
 * can promise:
 *
 *  - a route mounted on the RAW Hono app (`getRawApp()` — the #9650 blind
 *    spot) is observed, labelled by its registered pattern;
 *  - a request the `use()` middleware chain SHORT-CIRCUITS (429) is
 *    observed — the seam sits outside the middleware seam;
 *  - a request answered by the `setFallbackHandler` seam carries the
 *    reserved unmatched label: the fallback is by definition serving a
 *    request no registered route matched, and `routePath(c)` alone cannot
 *    say so (after `next()` it reports the adapter's own `use('*')` seam,
 *    `/*` — the notFound marker is the authority).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { UNMATCHED_ROUTE_PATTERN } from '@objectstack/core';
import type { HttpResponseObservation } from '@objectstack/core';
import { HonoHttpServer } from './adapter';

describe('HonoHttpServer afterResponse seam (#9835)', () => {
    const opened: HonoHttpServer[] = [];

    const boot = async (setup: (server: HonoHttpServer) => void) => {
        const server = new HonoHttpServer(0);
        server.installNotFoundSeam();
        setup(server);
        await server.listen(0);
        opened.push(server);
        return `http://127.0.0.1:${server.getPort()}`;
    };

    afterEach(async () => {
        while (opened.length > 0) await opened.pop()!.close();
    });

    it('observes a route mounted on the RAW app, labelled by its registered pattern', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot((server) => {
            server.afterResponse((o) => seen.push(o));
            // The #9650 blind spot: a plugin mounting through getRawApp()
            // bypasses IHttpServer entirely (auth's `rawApp.all` is the
            // production line this mirrors).
            server.getRawApp().all('/api/v1/auth/*', (c: any) => c.json({ ok: true }, 200));
        });

        const res = await fetch(`${baseUrl}/api/v1/auth/sign-in/email`, { method: 'POST' });
        expect(res.status).toBe(200);

        expect(seen).toHaveLength(1);
        expect(seen[0].routePattern).toBe('/api/v1/auth/*');
        expect(seen[0].routePattern).not.toContain('sign-in');
        expect(seen[0].status).toBe(200);
    });

    it('observes a request the use() chain REFUSES — the seam sits outside the middleware seam', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot((server) => {
            // Plugin order, reproduced: observation seam first, middleware
            // seam second — exactly what `HonoServerPlugin.init()` does.
            server.installResponseObservationSeam();
            server.afterResponse((o) => seen.push(o));
            server.installMiddlewareSeam();
            server.use(async (req, res, _next) => {
                // Stands in for the inbound rate limiter: refuse everything.
                void req;
                res.status(429).json({ error: 'too many requests' });
            });
            server.get('/never-reached', async (_req, res) => res.json({ ok: true }));
        });

        const res = await fetch(`${baseUrl}/never-reached`);
        expect(res.status).toBe(429);

        // A refused request is exactly the one an operator alerts on.
        expect(seen).toHaveLength(1);
        expect(seen[0].status).toBe(429);
    });

    it('labels a fallback-served request with the reserved unmatched pattern', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot((server) => {
            server.afterResponse((o) => seen.push(o));
            server.get('/registered', async (_req, res) => res.json({ ok: true }));
            server.setFallbackHandler(async (_req, res) => {
                res.status(200).json({ served: 'by-fallback' });
            });
        });

        const res = await fetch(`${baseUrl}/declarative/endpoint`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ served: 'by-fallback' });

        // The fallback answered, but no REGISTERED route matched — the
        // contract's unmatched label, delivered via the notFound marker.
        expect(seen).toHaveLength(1);
        expect(seen[0].routePattern).toBe(UNMATCHED_ROUTE_PATTERN);
        expect(seen[0].status).toBe(200);
    });

    it('a method mismatch (405 + Allow) is unmatched too — Hono routes it to the same sink', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot((server) => {
            server.afterResponse((o) => seen.push(o));
            server.put('/only-put', async (_req, res) => res.json({ ok: true }));
        });

        const res = await fetch(`${baseUrl}/only-put`, { method: 'POST' });
        expect(res.status).toBe(405);

        expect(seen).toHaveLength(1);
        expect(seen[0].routePattern).toBe(UNMATCHED_ROUTE_PATTERN);
        expect(seen[0].status).toBe(405);
        expect(seen[0].method).toBe('POST');
    });
});
