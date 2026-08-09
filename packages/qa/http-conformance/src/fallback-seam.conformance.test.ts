// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `IHttpServer.setFallbackHandler` — cross-adapter conformance (#6143).
 *
 * The contract (`packages/spec/src/contracts/http-server.ts`, #5040 §1-C)
 * makes four testable promises, and until this file the conformance package
 * asserted NONE of them — `HonoHttpServer` pins them adapter-locally
 * (`plugin-hono-server/src/fallback-seam.test.ts`), but a second adapter
 * could diverge on all four with CI green. Since the #5111 flip this seam is
 * the ONLY entry path for declarative `apis:` endpoints, so divergence means
 * "declarative endpoints behave unpredictably on that adapter":
 *
 *  1. the fallback runs ONLY after every explicitly registered route missed —
 *     zero registration-order dependency, which is exactly what a
 *     `${prefix}/*` catch-all route CANNOT provide (first-match-wins across
 *     plugin `start()` order, the ADR-0076 D11 hazard);
 *  2. `req.body` IS readable in the fallback, unlike the `use()` middleware
 *     seam whose contract explicitly does not populate it;
 *  3. installing again REPLACES — one fallback, never a chain;
 *  4. a fallback that writes NOTHING leaves the adapter's own
 *     unmatched-request answer in place: the shared 404 body, or
 *     405 + `Allow` for a method mismatch.
 *
 * Every case here runs against BOTH adapters over a real socket: the
 * zero-dependency `NodeHttpServer` (this package's reference implementation,
 * which gained the member for this suite — #6143) and `HonoHttpServer` (the
 * primary adapter). A Hono-only conditional case would prove nothing about
 * cross-adapter agreement, which is the entire point of this package.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { IHttpRequest, RouteHandler } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { NodeHttpServer } from './adapter.js';

/**
 * The structural surface this suite drives — the `IHttpServer` members the
 * cases touch, with `setFallbackHandler` REQUIRED. The member is optional on
 * the contract (an adapter that cannot express a not-found hook omits it and
 * consumers degrade), but an adapter that is in this list claims it, and from
 * that moment the four guarantees are load-bearing, not aspirational.
 */
interface FallbackCapableServer {
    get(path: string, handler: RouteHandler): void;
    post(path: string, handler: RouteHandler): void;
    put(path: string, handler: RouteHandler): void;
    setFallbackHandler(handler: RouteHandler): void;
    listen(port: number): Promise<void>;
    close?(): Promise<void>;
    getPort(): number;
}

type AdapterCase = {
    label: 'node' | 'hono';
    make: () => FallbackCapableServer;
};

const ADAPTERS: AdapterCase[] = [
    { label: 'node', make: () => new NodeHttpServer(0) },
    {
        label: 'hono',
        make: () => {
            const server = new HonoHttpServer(0);
            // The standard composed state: `HonoServerPlugin.start()` mounts
            // the unmatched-request seam (404 / 405 + Allow) exactly like
            // this. Without it a bare HonoHttpServer answers Hono's own
            // `404 Not Found` text page, which is the pre-composition state
            // no deployment serves.
            server.installNotFoundSeam();
            return server;
        },
    },
];

describe.each(ADAPTERS)('IHttpServer.setFallbackHandler conformance on $label adapter', ({ make }) => {
    const opened: FallbackCapableServer[] = [];

    /** Register the fixture routes shared by most cases. */
    function addRoutes(server: FallbackCapableServer) {
        server.get('/api/v1/thing', (_req, res) => { res.status(200); res.json({ route: 'get' }); });
        server.post('/api/v1/thing', (_req, res) => { res.status(201); res.json({ route: 'post' }); });
        server.put('/api/v1/only-put', (_req, res) => { res.status(200); res.json({ route: 'put' }); });
    }

    /** Boot a server on an OS-assigned port and return its base URL. */
    async function boot(server: FallbackCapableServer): Promise<string> {
        await server.listen(0);
        opened.push(server);
        return `http://127.0.0.1:${server.getPort()}`;
    }

    afterEach(async () => {
        await Promise.all(opened.splice(0).map((s) => s.close?.()));
    });

    // ── Guarantee 1 — only after every registered route missed ──────────────

    it('G1-a: a fallback installed BEFORE the routes still cannot shadow them (zero order dependency)', async () => {
        // THE case a `${prefix}/*` catch-all implementation fails: a wildcard
        // ROUTE registered first wins first-match-wins and answers requests
        // the later-registered routes own. A real not-found hook cannot.
        const server = make();
        let ran = 0;
        server.setFallbackHandler((_req, res) => { ran++; res.status(200); res.json({ from: 'fallback' }); });
        addRoutes(server);
        const base = await boot(server);

        const owned = await fetch(`${base}/api/v1/thing`);
        expect(owned.status).toBe(200);
        expect(await owned.json()).toEqual({ route: 'get' });
        expect(ran, 'fallback ran for a request a registered route owns').toBe(0);

        const unowned = await fetch(`${base}/api/v1/other`);
        expect(unowned.status).toBe(200);
        expect(await unowned.json()).toEqual({ from: 'fallback' });
        expect(ran).toBe(1);
    });

    it('G1-b: does not run for a path+method a route owns (installed after the routes)', async () => {
        const server = make();
        addRoutes(server);
        let ran = false;
        server.setFallbackHandler((_req, res) => { ran = true; res.status(200); res.json({ from: 'fallback' }); });
        const base = await boot(server);

        const res = await fetch(`${base}/api/v1/thing`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ n: 1 }),
        });
        expect(res.status).toBe(201);
        expect(await res.json()).toEqual({ route: 'post' });
        expect(ran, 'fallback ran for a request a registered route matched').toBe(false);
    });

    it('G1-c: runs for a path no route owns, with the request identity intact', async () => {
        const server = make();
        addRoutes(server);
        const seen: Array<{ method: string; path: string }> = [];
        server.setFallbackHandler((req, res) => {
            seen.push({ method: req.method, path: req.path });
            res.status(200);
            res.json({ from: 'fallback' });
        });
        const base = await boot(server);

        const res = await fetch(`${base}/api/v1/apps/showcase/tasks`);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ from: 'fallback' });
        expect(seen).toEqual([{ method: 'GET', path: '/api/v1/apps/showcase/tasks' }]);
    });

    // ── Guarantee 2 — `req.body` IS readable here ───────────────────────────

    it('G2-a: receives a fully populated request — JSON body, query, method, path, headers, rawBody', async () => {
        // The difference from the `use()` middleware seam, and the whole
        // reason declarative `apis:` endpoints must enter through THIS seam:
        // a declared endpoint backed by a flow or a `create` operation must
        // read the request body.
        const server = make();
        addRoutes(server);
        let received: IHttpRequest | undefined;
        server.setFallbackHandler((req, res) => { received = req; res.status(200); res.json({ ok: true }); });
        const base = await boot(server);

        await fetch(`${base}/api/v1/apps/showcase/inquiries/purge?dry=1`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ reason: 'stale', count: 3 }),
        });

        expect(received?.body).toEqual({ reason: 'stale', count: 3 });
        expect(received?.query).toEqual({ dry: '1' });
        expect(received?.method).toBe('POST');
        expect(received?.path).toBe('/api/v1/apps/showcase/inquiries/purge');
        expect(received?.headers['content-type']).toContain('application/json');
        // An unmatched request HAS no path params — `{}`, never a crash.
        expect(received?.params).toEqual({});
        expect(typeof received?.rawBody).toBe('function');
    });

    it('G2-b: parses a form body by content-type, exactly as a route handler would', async () => {
        const server = make();
        addRoutes(server);
        let routeBody: unknown;
        let fallbackBody: unknown;
        server.post('/api/v1/echo', (req, res) => { routeBody = req.body; res.status(200); res.json({ ok: true }); });
        server.setFallbackHandler((req, res) => { fallbackBody = req.body; res.status(200); res.json({ ok: true }); });
        const base = await boot(server);

        const form = () => ({
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ a: '1', b: 'two' }).toString(),
        });
        await fetch(`${base}/api/v1/echo`, form());
        await fetch(`${base}/api/v1/apps/showcase/form`, form());

        expect(fallbackBody).toEqual({ a: '1', b: 'two' });
        expect(fallbackBody).toEqual(routeBody);
    });

    // ── Guarantee 3 — repeated calls REPLACE, they do not chain ─────────────

    it('G3-a: only the most recently installed handler runs, exactly once', async () => {
        const server = make();
        addRoutes(server);
        const ran: string[] = [];
        server.setFallbackHandler((_req, res) => { ran.push('first'); res.status(200); res.json({ which: 'first' }); });
        server.setFallbackHandler((_req, res) => { ran.push('second'); res.status(200); res.json({ which: 'second' }); });
        const base = await boot(server);

        const res = await fetch(`${base}/api/v1/apps/showcase/tasks`);
        expect(await res.json()).toEqual({ which: 'second' });
        // One fallback, not a chain — and not a stack of hooks either.
        expect(ran).toEqual(['second']);
    });

    // ── Guarantee 4 — writing nothing leaves the standard answer ────────────

    it('G4-a: a declining fallback leaves the 404 answer byte-for-byte — and it DID run', async () => {
        const baselineServer = make();
        addRoutes(baselineServer);
        const baselineBase = await boot(baselineServer);
        const baseline = await fetch(`${baselineBase}/api/v1/apps/showcase/tasks`);
        const baselineText = await baseline.text();

        const server = make();
        addRoutes(server);
        let ran = false;
        server.setFallbackHandler(() => { ran = true; /* declines: writes nothing */ });
        const base = await boot(server);
        const res = await fetch(`${base}/api/v1/apps/showcase/tasks`);

        // `ran` is what separates "declined and fell through" from "was never
        // consulted": an adapter that ignores the installed handler produces
        // this exact 404 too.
        expect(ran).toBe(true);
        expect(baseline.status).toBe(404);
        expect(res.status).toBe(404);
        expect(await res.text()).toBe(baselineText);
        expect(JSON.parse(baselineText)).toEqual({ error: 'Not found' });
    });

    it('G4-b: a declining fallback keeps 405 + `Allow` for a method mismatch (#5040 §7-1)', async () => {
        // A method mismatch on an existing path is ALSO an unmatched request,
        // so the fallback sees it — and declining must not cost the caller
        // the 405 or its `Allow` header.
        const server = make();
        addRoutes(server);
        const seen: string[] = [];
        server.setFallbackHandler((req) => { seen.push(`${req.method} ${req.path}`); });
        const base = await boot(server);

        const res = await fetch(`${base}/api/v1/only-put`, { method: 'DELETE' });
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toBe('PUT');
        const body = await res.json();
        expect(body.code).toBe('METHOD_NOT_ALLOWED');
        expect(body.allowed).toEqual(['PUT']);
        expect(seen).toEqual(['DELETE /api/v1/only-put']);
    });

    // ── Failure-mode parity ─────────────────────────────────────────────────

    it('G5-a: a THROWING fallback answers 500, not the unremarkable 404', async () => {
        // Not one of the four guarantees, but the failure mode both adapters
        // must agree on: a fallback that threw is a broken consumer, and
        // reporting that as the adapter's ordinary 404 would hide it behind
        // the most unremarkable status on the wire.
        const server = make();
        addRoutes(server);
        server.setFallbackHandler(() => { throw new Error('boom'); });
        const base = await boot(server);

        const res = await fetch(`${base}/api/v1/apps/showcase/tasks`);
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: 'Fallback handler failed' });
    });
});
