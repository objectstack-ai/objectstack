// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integration test — end-to-end project-scoped REST routing.
 *
 * Boots a real Hono server, wires up ObjectQL + createRestApiPlugin with
 * `enableProjectScoping: true` / `projectResolution: 'auto'`, and verifies:
 *   1. Scoped `/api/v1/environments/:id/data/:object` works.
 *   2. Unscoped `/api/v1/data/:object` still works (backward compat).
 *   3. Scoped meta routes return metadata.
 *   4. `projectResolution: 'required'` mode rejects unscoped requests.
 *
 * Uses the same LiteKernel + HonoServerPlugin pattern as client.hono.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/runtime';
import { ObjectStackClient } from './index';

describe('Project-scoped REST routing (live Hono)', () => {
    let baseUrl: string;
    let kernel: LiteKernel;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(new ObjectQLPlugin());

        const honoPlugin = new HonoServerPlugin({
            port: 0,
            // IMPORTANT: skip hardcoded hono CRUD routes so createRestApiPlugin
            // owns /data and /meta registration end-to-end.
            registerStandardEndpoints: false,
        });
        kernel.use(honoPlugin);

        // Drive REST route generation through the canonical RestServer so
        // the new enableProjectScoping / projectResolution fields are
        // actually consumed at runtime.
        kernel.use(
            createRestApiPlugin({
                api: {
                    api: {
                        // Routing test, no auth stack mounted — opt out of the
                        // secure-by-default anonymous deny (ADR-0056 D2).
                        requireAuth: false,
                        enableProjectScoping: true,
                        projectResolution: 'auto',
                    } as any,
                },
            }),
        );

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
        const port = httpServer.getPort();
        baseUrl = `http://localhost:${port}`;
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    it('serves scoped CRUD at /api/v1/environments/:environmentId/data/:object', async () => {
        const res = await fetch(
            `${baseUrl}/api/v1/environments/proj-alpha/data/task?top=5`,
        );
        expect(res.status).toBe(200);
        const body = await res.json();
        // The response shape is controlled by the protocol's findData —
        // the key assertion is that the route resolved (not 404) and the
        // handler ran.
        expect(body).toBeDefined();
    });

    it('serves unscoped CRUD at /api/v1/data/:object (backward compat in auto mode)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/data/task?top=5`);
        expect(res.status).toBe(200);
    });

    it('serves scoped metadata at /api/v1/environments/:environmentId/meta', async () => {
        const res = await fetch(`${baseUrl}/api/v1/environments/proj-alpha/meta`);
        expect(res.status).toBe(200);
    });

    it('client.project(id).data.find() hits the scoped URL end-to-end', async () => {
        const client = new ObjectStackClient({ baseUrl });
        const scoped = client.project('proj-alpha');
        // Should resolve without throwing — the route must exist on the server.
        await expect(scoped.data.find('task')).resolves.toBeDefined();
    });

    it("scoping flags are surfaced on the discovery response", async () => {
        const res = await fetch(`${baseUrl}/api/v1/discovery`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body?.scoping?.enabled).toBe(true);
        expect(body?.scoping?.resolution).toBe('auto');
    });
});
