// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0076 D11 / OQ#10 (#2462) — multi-adapter conformance suite.
 *
 * The transport port (`IHttpServer`) was designed for multiple adapters but
 * only Hono ever existed, so "the port is framework-agnostic" was an unproven
 * claim. This suite is the proof: it boots the SAME framework stacks —
 * the dispatcher bridge (control plane) and the REST route generator (data
 * plane) — once on `plugin-hono-server` and once on the zero-dependency
 * `NodeHttpServer`, and asserts identical observable behavior over real
 * sockets.
 *
 * If a Hono-ism ever leaks into a route consumer (dispatcher-plugin,
 * rest-server, package-routes), the node half of this suite is what breaks.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin, createRestApiPlugin } from '@objectstack/runtime';
import { NodeServerPlugin } from './node-plugin.js';
import type { IHttpServer } from '@objectstack/spec/contracts';

type AdapterCase = {
    label: 'node' | 'hono';
    makePlugin: () => any;
};

const ADAPTERS: AdapterCase[] = [
    { label: 'node', makePlugin: () => new NodeServerPlugin({ port: 0 }) },
    { label: 'hono', makePlugin: () => new HonoServerPlugin({ port: 0 }) },
];

/**
 * Boot the full HTTP stack (ObjectQL engine + REST generator + dispatcher
 * bridge) on the given adapter and return its base URL + kernel.
 *
 * `withAnalytics` (default true) registers a minimal in-memory `analytics`
 * service so the capability-conditional `/analytics` routes mount (#3891
 * follow-through) — the transport contracts under test (405 method mismatch,
 * parity) need the routes to exist. Pass false to exercise the
 * capability-absent posture: no mounts, shared 404.
 */
async function bootStack(makePlugin: () => any, opts: { withAnalytics?: boolean } = {}) {
    const kernel = new LiteKernel();
    kernel.use(new ObjectQLPlugin());
    // [#3963] Anonymous-deny is unconditional now; conformance focuses on
    // transport parity, so authenticate every request with a stub session.
    kernel.use({
        metadata: { name: 'test-auth', version: '1.0.0' },
        init: (c: any) => c.registerService('auth', {
            api: { getSession: async () => ({ user: { id: 'test-user' } }) },
        }),
    } as any);
    if (opts.withAnalytics !== false) {
        kernel.use({
            name: 'com.test.analytics-stub',
            version: '0.0.0',
            init: (c: any) => {
                c.registerService('analytics', {
                    query: async () => ({ rows: [], fields: [] }),
                    getMeta: async () => ({ cubes: [] }),
                    generateSql: async () => ({ sql: null, params: [] }),
                });
            },
        } as any);
    }
    kernel.use(makePlugin());
    kernel.use(createRestApiPlugin({}));
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));

    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    // In-memory SQLite (pure-JS WASM, no native build) — the same engine
    // `@objectstack/verify`'s bootStack runs the dogfood gate on. `connect()`
    // is NOT optional the way it was for the mingo driver this used before
    // #4065: an unconnected datasource is an UNAVAILABLE one, and every data
    // entry point then reports the object as unregistered (a 404 that looks
    // like a routing bug and is really a boot-order one).
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    ql.registerDriver(driver as never, true);
    ql.registerObject({
        name: 'task',
        label: 'Task',
        fields: {
            title: { type: 'text', label: 'Title' },
        },
    });
    // Registering an object after bootstrap misses the boot-time schema sync,
    // so nothing has issued this table's DDL. The mingo driver this fixture used
    // before #4065 created a table on first touch and hid that; on SQL the
    // insert fails with `no such table`, which the REST error mapper turns into
    // a 404 OBJECT_NOT_FOUND — a routing-shaped symptom for a DDL-shaped cause.
    await ql.syncObjectSchema('task');

    const httpServer = kernel.getService<IHttpServer>('http.server');
    return { kernel, base: `http://127.0.0.1:${httpServer.getPort!()}` };
}

describe.each(ADAPTERS)('IHttpServer conformance on $label adapter', ({ makePlugin }) => {
    let kernel: LiteKernel;
    let base: string;

    beforeAll(async () => {
        ({ kernel, base } = await bootStack(makePlugin));
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    // ── Dispatcher bridge (control plane) ────────────────────────────────

    it('serves GET /api/v1/ready (dispatcher bridge)', async () => {
        const res = await fetch(`${base}/api/v1/ready`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.success).toBe(true);
        expect(body.data.status).toBe('ready');
    });

    it('serves GET /api/v1/health (dispatcher bridge)', async () => {
        const res = await fetch(`${base}/api/v1/health`);
        expect(res.status).toBe(200);
        expect((await res.json()).data.status).toBe('ok');
    });

    it('serves /.well-known/objectstack discovery', async () => {
        const res = await fetch(`${base}/.well-known/objectstack`);
        expect(res.status).toBe(200);
        const body = await res.json();
        const routes = body.data?.routes ?? body.routes;
        expect(routes.data).toBe('/api/v1/data');
        // D12 (#2462): no HTTP realtime surface exists — must not be advertised.
        expect(routes.realtime).toBeUndefined();
    });

    it('routes :param segments through the bridge (i18n 501 without service)', async () => {
        // No i18n service registered — the handler answers 501. Reaching the
        // handler at all proves param-routing works on this adapter.
        const res = await fetch(`${base}/api/v1/i18n/translations/zh-CN`);
        expect(res.status).toBe(501);
    });

    // ── REST route generator (data plane) ────────────────────────────────

    it('runs a full /data CRUD roundtrip through the REST generator', async () => {
        const created = await fetch(`${base}/api/v1/data/task`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: 'adapter parity' }),
        });
        expect(created.status).toBe(201);
        const createdBody = await created.json();
        const id = createdBody?.record?.id ?? createdBody?.data?.record?.id ?? createdBody?.id;
        expect(id).toBeTruthy();

        const list = await fetch(`${base}/api/v1/data/task`);
        expect(list.status).toBe(200);
        const listBody = await list.json();
        const records = listBody?.records ?? listBody?.data?.records ?? [];
        expect(records.some((r: any) => r.title === 'adapter parity')).toBe(true);

        const one = await fetch(`${base}/api/v1/data/task/${id}`);
        expect(one.status).toBe(200);

        const del = await fetch(`${base}/api/v1/data/task/${id}`, { method: 'DELETE' });
        expect(del.status).toBe(200);
    });

    it('serves /api/v1/meta metadata reads', async () => {
        const res = await fetch(`${base}/api/v1/meta/objects/task`);
        expect(res.status).toBe(200);
    });

    // ── Error semantics ───────────────────────────────────────────────────
    // These lock the FORMAL unmatched-request contract on `IHttpServer`
    // (spec/src/contracts/http-server.ts, #3607) — no longer just observed
    // parity: new adapters must satisfy the interface JSDoc verbatim.

    it('404s unknown paths with the shared not-found body', async () => {
        const res = await fetch(`${base}/api/v1/this-route-does-not-exist`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
        });
    });

    it('405s a method mismatch with an Allow header', async () => {
        // /api/v1/analytics/query is registered POST-only by the bridge —
        // mounted here because bootStack registers the analytics stub
        // (capability-conditional since #3891 follow-through).
        const res = await fetch(`${base}/api/v1/analytics/query`, { method: 'PUT' });
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toContain('POST');
        expect((await res.json()).error.code).toBe('METHOD_NOT_ALLOWED');
    });
});

/**
 * [#3891 follow-through] Capability-conditional mounting: without an
 * `analytics` service the routes are NOT mounted, so the path answers the
 * adapter's shared not-found contract — for EVERY method. No 405 Allow hint
 * may leak for an API that isn't there. Single adapter suffices: the
 * conditional lives in the dispatcher plugin, above the adapter seam.
 */
describe('analytics capability-conditional mounting (no service installed)', () => {
    let stack: { kernel: LiteKernel; base: string };

    beforeAll(async () => {
        stack = await bootStack(ADAPTERS[0].makePlugin, { withAnalytics: false });
    }, 30_000);

    afterAll(async () => {
        if (stack?.kernel) {
            await Promise.race([
                stack.kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    it.each(['POST', 'PUT', 'GET'])('%s /api/v1/analytics/query answers the shared 404', async (method) => {
        const res = await fetch(`${stack.base}/api/v1/analytics/query`, { method });
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
        });
    });

    it('GET /api/v1/analytics/meta answers the shared 404 too', async () => {
        const res = await fetch(`${stack.base}/api/v1/analytics/meta`);
        expect(res.status).toBe(404);
    });

    it('a sibling dispatcher route is still mounted (the absence is analytics-scoped)', async () => {
        const res = await fetch(`${stack.base}/api/v1/health`);
        expect(res.status).toBe(200);
    });
});

/**
 * Cross-adapter parity: the SAME requests against both adapters must produce
 * the same status codes and (for JSON control-plane responses) the same body
 * shape. Catches divergence that per-adapter assertions can miss.
 */
describe('node ↔ hono response parity', () => {
    let node: { kernel: LiteKernel; base: string };
    let hono: { kernel: LiteKernel; base: string };

    beforeAll(async () => {
        node = await bootStack(ADAPTERS[0].makePlugin);
        hono = await bootStack(ADAPTERS[1].makePlugin);
    }, 60_000);

    afterAll(async () => {
        for (const stack of [node, hono]) {
            if (stack?.kernel) {
                await Promise.race([
                    stack.kernel.shutdown(),
                    new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
                ]);
            }
        }
    }, 30_000);

    const PROBES: Array<{ path: string; method?: string }> = [
        { path: '/api/v1/ready' },
        { path: '/api/v1/health' },
        { path: '/.well-known/objectstack' },
        { path: '/api/v1/discovery' },
        { path: '/api/v1/i18n/locales' },
        { path: '/api/v1/meta/objects/task' },
        { path: '/api/v1/data/task' },
        { path: '/api/v1/no-such-route' },
        { path: '/api/v1/analytics/query', method: 'PUT' },
    ];

    it.each(PROBES)('parity on $method $path', async ({ path, method = 'GET' }) => {
        const [a, b] = await Promise.all([
            fetch(`${node.base}${path}`, { method }),
            fetch(`${hono.base}${path}`, { method }),
        ]);
        expect(a.status).toBe(b.status);
        const [aBody, bBody] = await Promise.all([a.json(), b.json()]);
        // Compare shapes, not values (ids/timestamps differ): same top-level keys.
        expect(Object.keys(aBody ?? {}).sort()).toEqual(Object.keys(bBody ?? {}).sort());
    });
});
