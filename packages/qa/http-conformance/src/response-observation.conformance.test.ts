// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `IHttpServer.afterResponse` — cross-adapter conformance (#9835).
 *
 * The contract (`packages/spec/src/contracts/http-server.ts`) makes the
 * response-observation seam the transport-agnostic home for HTTP metrics:
 * an observation point that runs AFTER the response exists, carrying the
 * status the framework-agnostic `use()` middleware chain can never see
 * (it runs to completion BEFORE dispatch — measured in
 * `packages/runtime/src/http-metrics-inbound-coverage.hono.integration.test.ts`).
 * Its testable promises, each locked here against BOTH adapters over a real
 * socket:
 *
 *  1. each registered observer is invoked EXACTLY ONCE per answered request,
 *     with `{ method, routePattern, status, elapsedMs }`;
 *  2. `routePattern` is the registered PATTERN, NEVER the concrete path —
 *     the hard cardinality requirement no adapter may re-decide — and a
 *     request no route matched carries the reserved
 *     `UNMATCHED_ROUTE_PATTERN`;
 *  3. registration APPENDS (several observers coexist, registration order),
 *     unlike `setFallbackHandler`'s replace semantics;
 *  4. a throwing observer affects neither the response nor sibling
 *     observers;
 *  5. optionality is feature-detected runtime-real:
 *     `typeof server.afterResponse === 'function'`.
 *
 * A Hono-only case would prove nothing about cross-adapter agreement, which
 * is the entire point of this package: the #9650 ruling's documented
 * expectation — "a transport that does not implement the seam reports no
 * HTTP metrics" — stops applying to a transport exactly when this suite
 * passes for it.
 */

import { describe, it, expect, afterEach } from 'vitest';
import type { RouteHandler, HttpResponseObservation, HttpResponseObserver } from '@objectstack/core';
import { UNMATCHED_ROUTE_PATTERN } from '@objectstack/core';
import { HonoHttpServer } from '@objectstack/plugin-hono-server';

import { NodeHttpServer } from './adapter.js';

/**
 * The structural surface this suite drives — `afterResponse` REQUIRED. The
 * member is optional on the contract; an adapter in this list claims it, and
 * from that moment the promises above are load-bearing, not aspirational.
 */
interface ObservableServer {
    get(path: string, handler: RouteHandler): void;
    post(path: string, handler: RouteHandler): void;
    afterResponse(observer: HttpResponseObserver): void;
    listen(port: number): Promise<void>;
    close?(): Promise<void>;
    getPort(): number;
}

type AdapterCase = {
    label: 'node' | 'hono';
    make: () => ObservableServer;
};

const ADAPTERS: AdapterCase[] = [
    { label: 'node', make: () => new NodeHttpServer(0) },
    {
        label: 'hono',
        make: () => {
            const server = new HonoHttpServer(0);
            // The standard composed state: `HonoServerPlugin.start()` mounts
            // the unmatched-request seam (404 / 405 + Allow) exactly like
            // this — without it a bare HonoHttpServer answers Hono's own
            // 404 text page, which no deployment serves.
            server.installNotFoundSeam();
            return server;
        },
    },
];

describe.each(ADAPTERS)('IHttpServer.afterResponse conformance on $label adapter', ({ make }) => {
    const opened: ObservableServer[] = [];

    /**
     * Register observers FIRST, then routes, then listen. Registration-time
     * flexibility beyond this is adapter-composition territory (the Hono
     * PLUGIN mounts the delivery seam in Phase 1 so observers may register
     * whenever; a BARE HonoHttpServer mounts it on first registration, which
     * therefore must precede routes — the same caveat its `use()` carries).
     */
    const boot = async (
        observers: HttpResponseObserver[],
        register: (server: ObservableServer) => void,
    ) => {
        const server = make();
        for (const observer of observers) server.afterResponse(observer);
        register(server);
        await server.listen(0);
        opened.push(server);
        return `http://127.0.0.1:${server.getPort()}`;
    };

    afterEach(async () => {
        while (opened.length > 0) await opened.pop()!.close?.();
    });

    it('is feature-detected runtime-real: typeof afterResponse === "function"', () => {
        const server = make();
        expect(typeof (server as { afterResponse?: unknown }).afterResponse === 'function').toBe(true);
    });

    it('fires EXACTLY ONCE per answered request, with the registered PATTERN — never the concrete path', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot([(o) => seen.push(o)], (server) => {
            server.get('/api/v1/data/:id', async (req, res) => {
                res.status(200).json({ id: req.params.id });
            });
        });

        const res = await fetch(`${baseUrl}/api/v1/data/rec_42`);
        expect(res.status).toBe(200);
        // Delivery may trail the response by a tick (node's `finish` event) —
        // settle the event loop before counting.
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(seen).toHaveLength(1);
        expect(seen[0].method).toBe('GET');
        // The hard requirement: the PATTERN (one series per mount), not the
        // path (one series per record id).
        expect(seen[0].routePattern).toBe('/api/v1/data/:id');
        expect(seen[0].routePattern).not.toContain('rec_42');
        expect(seen[0].status).toBe(200);
        expect(seen[0].elapsedMs).toBeGreaterThanOrEqual(0);
    });

    it('carries the status AS SENT — a 503 route observes 503, and elapsedMs covers the handler', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot([(o) => seen.push(o)], (server) => {
            server.get('/unhealthy', async (_req, res) => {
                await new Promise((resolve) => setTimeout(resolve, 25));
                res.status(503).json({ ok: false });
            });
        });

        const res = await fetch(`${baseUrl}/unhealthy`);
        expect(res.status).toBe(503);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(seen).toHaveLength(1);
        expect(seen[0].status).toBe(503);
        // The handler slept 25ms; allow generous slack downward (timer
        // coarseness) while still proving the window brackets the handler.
        expect(seen[0].elapsedMs).toBeGreaterThanOrEqual(10);
    });

    it('reports a request NO route matched with the reserved UNMATCHED_ROUTE_PATTERN and the 404 as sent', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot([(o) => seen.push(o)], (server) => {
            server.get('/exists', async (_req, res) => res.json({ ok: true }));
        });

        const res = await fetch(`${baseUrl}/no/such/route`);
        expect(res.status).toBe(404);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(seen).toHaveLength(1);
        expect(seen[0].routePattern).toBe(UNMATCHED_ROUTE_PATTERN);
        expect(seen[0].routePattern).not.toContain('/no/such/route');
        expect(seen[0].status).toBe(404);
    });

    it('registration APPENDS — two observers both see the same request, in registration order', async () => {
        const order: string[] = [];
        const baseUrl = await boot(
            [
                () => order.push('metrics'),
                () => order.push('access-log'),
            ],
            (server) => {
                server.get('/both', async (_req, res) => res.json({ ok: true }));
            },
        );

        await fetch(`${baseUrl}/both`);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(order).toEqual(['metrics', 'access-log']);
    });

    it('a THROWING observer affects neither the response nor its sibling', async () => {
        const delivered: HttpResponseObservation[] = [];
        const baseUrl = await boot(
            [
                () => {
                    throw new Error('broken metrics backend');
                },
                (o) => delivered.push(o),
            ],
            (server) => {
                server.get('/guarded', async (_req, res) => res.status(200).json({ ok: true }));
            },
        );

        const res = await fetch(`${baseUrl}/guarded`);
        // The response is untouched — an observer can never break a request.
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ ok: true });
        await new Promise((resolve) => setTimeout(resolve, 20));

        // The sibling registered AFTER the thrower still observed.
        expect(delivered).toHaveLength(1);
        expect(delivered[0].routePattern).toBe('/guarded');
    });

    it('N requests, N observations — no double delivery on a busy route', async () => {
        const seen: HttpResponseObservation[] = [];
        const baseUrl = await boot([(o) => seen.push(o)], (server) => {
            server.get('/counted', async (_req, res) => res.json({ ok: true }));
        });

        await fetch(`${baseUrl}/counted`);
        await fetch(`${baseUrl}/counted`);
        await fetch(`${baseUrl}/counted`);
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(seen).toHaveLength(3);
        expect(new Set(seen.map((o) => o.routePattern))).toEqual(new Set(['/counted']));
    });
});
