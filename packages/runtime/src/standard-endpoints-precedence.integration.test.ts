// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #4073 — is `registerStandardEndpoints` really all DUPLICATE supply?
 *
 * The retirement plan (flip the default to `false` → observe a release → delete
 * `registerDiscoveryAndCrudEndpoints`) rests on that premise. This file is the
 * evidence, and it CORRECTS the first version of itself, which got the `/data`
 * half wrong.
 *
 * That version mounted `createRestApiPlugin({})` against a STUB `objectql`
 * service, saw `/api/v1/data/:object` 404 with the flag off, and concluded the
 * flip removes the route. The 404 was real; the conclusion was not. REST
 * generates its CRUD from the object registry, so it needs a real engine — a
 * driver and at least one registered object — plus its own `api.api` config.
 * Under-provision it and it serves nothing, which says nothing about REST and
 * everything about the harness.
 *
 * `packages/client/src/client.environment-scoping.test.ts` had the answer the
 * whole time: it boots `registerStandardEndpoints: false` and asserts
 * `GET /api/v1/data/task` → 200, served by REST, with a comment saying that is
 * the point ("skip hardcoded hono CRUD routes so createRestApiPlugin owns /data
 * ... end-to-end").
 *
 * Reproducing that provisioning, the answer is unambiguous: `/data/:object`,
 * `/discovery` and `/.well-known/objectstack` return BYTE-IDENTICAL responses
 * with the flag on and off. The surface is duplicate supply on both halves, and
 * the flip is a no-op for a host that mounts REST or the dispatcher — which is
 * every composed deployment, `os serve` included.
 *
 * What that does NOT license: flipping the default is still a real change for a
 * BARE host that mounts neither, which is the composition the flag was written
 * for. That is a deliberate API decision, not something this file decides.
 *
 * The lesson #4073 has now hit three times: "who serves this path" is a question
 * about the composed, PROVISIONED runtime. Not about which plugin declares it
 * (the issue's first correction), not about registration order (the second), and
 * not about a minimal harness that merely boots (this one).
 */

import { describe, it, expect, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/rest';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

function authStub() {
    return {
        metadata: { name: 'test-auth', version: '1.0.0' },
        async init(ctx: any) {
            ctx.registerService('auth', {
                api: { getSession: async () => ({ user: { id: 'test-user' } }) },
            });
        },
    } as any;
}

/**
 * `serve.ts` order — Hono (line 1173) long before REST (1872) and the dispatcher
 * (1883) — with REST provisioned the way a real deployment provisions it.
 */
async function boot(registerStandardEndpoints: boolean) {
    const kernel = new LiteKernel();
    kernel.use(new ObjectQLPlugin());
    kernel.use(authStub());
    kernel.use(new HonoServerPlugin({ port: 0, registerStandardEndpoints, cors: false }));
    kernel.use(
        createRestApiPlugin({
            // Routing probe with no auth stack mounted — same opt-out the client
            // suites use (ADR-0056 D2).
            api: { api: { requireAuth: false } as any },
        }),
    );
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
    await kernel.bootstrap();

    // After bootstrap, mirroring the client suites: the engine service only
    // exists once plugins have initialised, and REST's `/data/:object` is a
    // generic route rather than one emitted per object, so registering the
    // object afterwards is enough to make the read resolve.
    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
    ql.registerObject({
        name: 'task',
        label: 'Task',
        fields: { name: { type: 'text', label: 'Name' } },
    } as never);

    const server = kernel.getService<any>('http.server');
    return { kernel, baseUrl: `http://127.0.0.1:${server.getPort()}` };
}

let kernel: LiteKernel | undefined;
afterEach(async () => {
    if (kernel) await Promise.race([kernel.shutdown(), new Promise<void>((r) => setTimeout(r, 5_000))]);
    kernel = undefined;
});

/** Status + body for a path, so two flag positions can be compared exactly. */
async function probe(baseUrl: string, path: string) {
    const res = await fetch(`${baseUrl}${path}`);
    return { status: res.status, body: (await res.text()).slice(0, 400) };
}

describe('#4073 — registerStandardEndpoints against a PROVISIONED REST', () => {
    /**
     * The retirement question stated exactly: does turning the flag off change
     * what a caller sees? Compare the two positions rather than asserting a
     * status, because a status alone is what misled the earlier version of this
     * file — `/data/task` answers 404 `OBJECT_NOT_FOUND` here (the object is
     * registered after bootstrap, so the handler reaches the engine and the
     * ENGINE says no), which is a route that WORKS. A routing 404 would be
     * `{"error":"Not found"}`. Same-response-in-both-positions is the property
     * the flip actually needs, and it does not depend on that distinction.
     */
    for (const path of ['/api/v1/data/task?top=5', '/api/v1/discovery', '/.well-known/objectstack']) {
        it(`${path} answers identically with the flag ON and OFF`, async () => {
            const on = await boot(true);
            kernel = on.kernel;
            const withFlag = await probe(on.baseUrl, path);
            await on.kernel.shutdown();

            const off = await boot(false);
            kernel = off.kernel;
            const withoutFlag = await probe(off.baseUrl, path);

            expect(
                withoutFlag,
                `${path} differs between flag positions — the #4073 flip is NOT a no-op for this path`,
            ).toEqual(withFlag);
        }, 60_000);
    }

    /**
     * ...and the routes are live, not uniformly absent — otherwise the parity
     * above would be satisfied by two identical 404s.
     */
    it('the compared routes are actually mounted', async () => {
        const booted = await boot(false);
        kernel = booted.kernel;

        const data = await probe(booted.baseUrl, '/api/v1/data/task?top=5');
        // Reached the engine: OBJECT_NOT_FOUND is the engine's answer, not Hono's
        // unmatched-route 404.
        expect(data.body, '/data/:object must reach the engine').toContain('OBJECT_NOT_FOUND');

        const discovery = await probe(booted.baseUrl, '/api/v1/discovery');
        expect(discovery.status, '/discovery must be served').toBe(200);
        expect(discovery.body).toContain('"routes"');
    }, 30_000);
});
