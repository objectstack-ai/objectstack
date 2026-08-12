// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `getMountedRoutes()` / `resolveMountedRoute()` — the adapter's answer to
 * "what did this server REALLY mount, and which of it can actually be
 * reached?" (#7526).
 *
 * WHY THIS EXISTS. Four route ledgers declare the platform's HTTP surface and
 * every guard built on them reads that union as an observation of what is
 * mounted. Three routes shipped ledgered-but-unmounted in one build because a
 * declaration cannot audit itself. The parity gate that closes it
 * (`packages/qa/dogfood/test/route-ledger-live-mount-parity.dogfood.test.ts`)
 * rests entirely on the two members exercised here, so they get their own pins
 * rather than being trusted implicitly by the gate that uses them.
 *
 * The first `describe` below is the MEASUREMENT the `/meta` fix is argued
 * from. `rest-server.ts` registers `/meta/types` before `/meta/:type` and says
 * in a comment that registering it after would silently break the route. That
 * claim is about Hono's matching, not about ObjectStack, and a comment
 * asserting third-party behaviour with no test under it is how the original
 * defect stayed invisible.
 */

import { describe, it, expect, vi } from 'vitest';
import { HonoHttpServer } from './adapter';

const noop = () => {};

describe('Hono is first-match-wins (the premise the /meta registration order rests on)', () => {
    it('a literal route registered AFTER a :param sibling never runs', async () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/:type', (_req, res: any) => res.json({ answered: ':type' }));
        server.get('/api/v1/meta/types', (_req, res: any) => res.json({ answered: 'types' }));

        const app = server.getRawApp();
        const body = await (await app.request('/api/v1/meta/types')).json();

        // The disguise this whole card is about: a 200 whose body is the
        // catch-all's, indistinguishable from "that type is empty".
        expect(body).toEqual({ answered: ':type' });
        // …and the live router agrees about WHY, which is the fact the gate reads.
        expect(server.resolveMountedRoute('GET', '/api/v1/meta/types'))
            .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type' });
    });

    it('the same literal registered BEFORE the :param sibling wins', async () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/types', (_req, res: any) => res.json({ answered: 'types' }));
        server.get('/api/v1/meta/:type', (_req, res: any) => res.json({ answered: ':type' }));

        const app = server.getRawApp();
        expect(await (await app.request('/api/v1/meta/types')).json()).toEqual({ answered: 'types' });
        expect(server.resolveMountedRoute('GET', '/api/v1/meta/types'))
            .toEqual({ method: 'GET', pattern: '/api/v1/meta/types' });
        // The catch-all still serves everything it used to.
        expect(await (await app.request('/api/v1/meta/zzz')).json()).toEqual({ answered: ':type' });
    });
});

describe('HonoHttpServer.getMountedRoutes', () => {
    it('reports every registered (method, pattern) in registration order, spelled as passed', () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/types', noop);
        server.get('/api/v1/meta/:type', noop);
        server.put('/api/v1/meta/:type/:name', noop);
        server.delete('/api/v1/meta/:type/:name', noop);

        expect(server.getMountedRoutes()).toEqual([
            { method: 'GET', pattern: '/api/v1/meta/types' },
            { method: 'GET', pattern: '/api/v1/meta/:type' },
            { method: 'PUT', pattern: '/api/v1/meta/:type/:name' },
            { method: 'DELETE', pattern: '/api/v1/meta/:type/:name' },
        ]);
    });

    it('hands back a copy — a consumer cannot edit the thing it is observing', () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/health', noop);

        const first = server.getMountedRoutes() as Array<{ method: string; pattern: string }>;
        first.push({ method: 'GET', pattern: '/api/v1/invented' });
        first[0]!.pattern = '/api/v1/rewritten';

        expect(server.getMountedRoutes()).toEqual([{ method: 'GET', pattern: '/api/v1/health' }]);
    });

    it('excludes middleware and the fallback seam — this answers "what did I register", not "what might respond"', () => {
        const server = new HonoHttpServer(0);
        server.use('/api/v1/*', (async (_req: any, _res: any, next: any) => next()) as any);
        server.setFallbackHandler(noop);
        server.get('/api/v1/health', noop);

        expect(server.getMountedRoutes()).toEqual([{ method: 'GET', pattern: '/api/v1/health' }]);
    });
});

describe('HonoHttpServer.resolveMountedRoute', () => {
    it('resolves a concrete path to the pattern that would answer it', () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/:type/:name/published', noop);
        server.get('/api/v1/meta/:type/:section/:name', noop);

        expect(server.resolveMountedRoute('GET', '/api/v1/meta/object/lead/published'))
            .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type/:name/published' });
        expect(server.resolveMountedRoute('GET', '/api/v1/meta/object/views/all_leads'))
            .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type/:section/:name' });
    });

    it('returns a pattern string identical to the getMountedRoutes entry (the gate compares them with ===)', () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/objects/:name/state/:field', noop);

        const resolved = server.resolveMountedRoute('GET', '/api/v1/meta/objects/lead/state/status');
        expect(server.getMountedRoutes().some(
            (r) => r.method === resolved?.method && r.pattern === resolved?.pattern,
        )).toBe(true);
    });

    it('is undefined when no registered route matches — the request would reach the notFound sink', () => {
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/:type', noop);

        expect(server.resolveMountedRoute('GET', '/api/v1/nothing/here')).toBeUndefined();
        // A method mismatch on an existing PATH is also "no registered route
        // answers", which is exactly what the 405 machinery is for.
        expect(server.resolveMountedRoute('POST', '/api/v1/meta/object')).toBeUndefined();
    });

    it('skips middleware and the fallback: neither is a route this adapter registered', () => {
        const server = new HonoHttpServer(0);
        server.use('/api/v1/*', (async (_req: any, _res: any, next: any) => next()) as any);
        server.get('/api/v1/meta/:type', noop);
        server.setFallbackHandler(noop);

        expect(server.resolveMountedRoute('GET', '/api/v1/meta/object'))
            .toEqual({ method: 'GET', pattern: '/api/v1/meta/:type' });
        // A path only the fallback could answer resolves to nothing — the
        // fallback is not a mount, and a gate must not read it as one.
        expect(server.resolveMountedRoute('GET', '/api/v1/apps/acme/webhook')).toBeUndefined();
    });

    it('does not run the handler it resolves', () => {
        const handler = vi.fn();
        const server = new HonoHttpServer(0);
        server.get('/api/v1/meta/:type', handler);

        server.resolveMountedRoute('GET', '/api/v1/meta/object');
        expect(handler).not.toHaveBeenCalled();
    });

    it('is case-insensitive on the verb, so a ledger row\'s spelling cannot change the verdict', () => {
        const server = new HonoHttpServer(0);
        server.post('/api/v1/meta/_migrate-stored', noop);

        expect(server.resolveMountedRoute('post', '/api/v1/meta/_migrate-stored'))
            .toEqual({ method: 'POST', pattern: '/api/v1/meta/_migrate-stored' });
    });
});
