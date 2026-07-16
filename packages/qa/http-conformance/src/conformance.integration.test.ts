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
import { InMemoryDriver } from '@objectstack/driver-memory';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createDispatcherPlugin, createRestApiPlugin } from '@objectstack/runtime';
import { NodeServerPlugin } from './node-plugin.js';

type AdapterCase = {
    label: 'node' | 'hono';
    makePlugin: () => any;
};

const ADAPTERS: AdapterCase[] = [
    { label: 'node', makePlugin: () => new NodeServerPlugin({ port: 0 }) },
    { label: 'hono', makePlugin: () => new HonoServerPlugin({ port: 0, registerStandardEndpoints: false }) },
];

/**
 * Boot the full HTTP stack (ObjectQL engine + REST generator + dispatcher
 * bridge) on the given adapter and return its base URL + kernel.
 */
async function bootStack(makePlugin: () => any) {
    const kernel = new LiteKernel();
    kernel.use(new ObjectQLPlugin());
    kernel.use(makePlugin());
    kernel.use(createRestApiPlugin({
        api: {
            api: {
                // Conformance focuses on transport parity; the anonymous-deny
                // posture is exercised separately with requireAuth on.
                requireAuth: false,
            } as any,
        },
    }));
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false, requireAuth: false }));

    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registerDriver(new InMemoryDriver(), true);
    ql.registerObject({
        name: 'task',
        label: 'Task',
        fields: {
            title: { type: 'text', label: 'Title' },
        },
    });

    const httpServer = kernel.getService<any>('http.server');
    return { kernel, base: `http://127.0.0.1:${httpServer.getPort()}` };
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

    it('404s unknown paths with the shared not-found body', async () => {
        const res = await fetch(`${base}/api/v1/this-route-does-not-exist`);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({ error: 'Not found' });
    });

    it('405s a method mismatch with an Allow header', async () => {
        // /api/v1/analytics/query is registered POST-only by the bridge.
        const res = await fetch(`${base}/api/v1/analytics/query`, { method: 'PUT' });
        expect(res.status).toBe(405);
        expect(res.headers.get('allow')).toContain('POST');
        expect((await res.json()).code).toBe('METHOD_NOT_ALLOWED');
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
