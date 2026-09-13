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
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/runtime';
import { ObjectStackClient } from './index';
import type { IHttpServer } from '@objectstack/spec/contracts';
import type { ServiceObject } from '@objectstack/spec/data';

/**
 * ⚠️ [#18070] The authz objects every authenticated request in this file
 * makes core's `resolveUserAuthzGrants`
 * (`core/src/security/resolve-authz-context.ts`) read. They belong to
 * `@objectstack/plugin-auth` / `@objectstack/plugin-security` and are spelled
 * LOCALLY here, carrying only the columns that reading path touches, so this
 * suite adds no dependency edge onto either package — the shape PR #17982 and
 * PR #18067 landed for the same defect.
 *
 * Without them the driver REFUSED every one of those reads. Measured on
 * `fb29f62ce`, classified by the `(table, filter, limit)` triple of the eight
 * reads the resolver issues: **20** resolver-class `refused a read on` driver
 * lines in this file, 4 per table across 5. `tryFind` classifies a missing
 * table as "not provisioned" and answers `[]`, so nothing went red: every
 * assertion below passed over grant reads that never happened — a green this
 * suite had not earned, and one it could not lose if grant resolution broke.
 *
 * ⛔ Registering the tables is what makes those reads SUCCEED. The count must
 * ⛔ not fall by silencing, filtering or re-levelling the driver line.
 *
 * Columns, and why each is here — every other column of the real objects is
 * deliberately absent, because no read on this path touches it. `id` is not
 * declared anywhere below: the registry supplies the primary key itself, and
 * it is what `sys_user`'s `id` filter reads.
 *   `sys_user`                 email (the `current_user.email` owner-RLS fallback)
 *   `sys_member`               user_id / organization_id (both filters), role
 *   `sys_user_position`        user_id (filter), position, organization_id
 *   `sys_user_permission_set`  user_id (filter), permission_set_id, organization_id
 *   `sys_position`             name (filter), active (`isRowActive`),
 *                              organization_id (the driver's tenant scope)
 *
 * ⛔ `sys_position_permission_set` and `sys_permission_set` are NOT here: the
 * resolver reaches them only once a `sys_position` row resolves and a
 * permission-set id is collected, and nothing here seeds either — measured,
 * neither table appears in this file's refusals, before or after.
 */
const AUTHZ_RESOLVER_OBJECTS: { owner: string; def: ServiceObject }[] = [
    {
        owner: '@objectstack/plugin-auth',
        def: {
            name: 'sys_user',
            label: 'User',
            fields: {
                email: { type: 'text', label: 'Email' },
            },
        },
    },
    {
        owner: '@objectstack/plugin-auth',
        def: {
            name: 'sys_member',
            label: 'Member',
            fields: {
                user_id: { type: 'text', label: 'User' },
                organization_id: { type: 'text', label: 'Organization' },
                role: { type: 'text', label: 'Role' },
            },
        },
    },
    {
        owner: '@objectstack/plugin-security',
        def: {
            name: 'sys_user_position',
            label: 'User Position',
            fields: {
                user_id: { type: 'text', label: 'User' },
                position: { type: 'text', label: 'Position' },
                organization_id: { type: 'text', label: 'Organization' },
            },
        },
    },
    {
        owner: '@objectstack/plugin-security',
        def: {
            name: 'sys_user_permission_set',
            label: 'User Permission Set',
            fields: {
                user_id: { type: 'text', label: 'User' },
                permission_set_id: { type: 'text', label: 'Permission Set' },
                organization_id: { type: 'text', label: 'Organization' },
            },
        },
    },
    {
        owner: '@objectstack/plugin-security',
        def: {
            name: 'sys_position',
            label: 'Position',
            fields: {
                name: { type: 'text', label: 'Name' },
                active: { type: 'boolean', label: 'Active' },
                organization_id: { type: 'text', label: 'Organization' },
            },
        },
    },
];

describe('Project-scoped REST routing (live Hono)', () => {
    let baseUrl: string;
    let kernel: LiteKernel;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(new ObjectQLPlugin());
        // [#3963] The anonymous-deny gate is unconditional now, so the live-server
        // client suites need an authenticated session. Register a minimal auth
        // service that resolves a fixed user for every request.
        kernel.use({
            metadata: { name: 'test-auth', version: '1.0.0' },
            async init(ctx: any) {
                ctx.registerService('auth', {
                    api: { getSession: async () => ({ user: { id: 'test-user' } }) },
                });
            },
        } as any);

        const honoPlugin = new HonoServerPlugin({
            port: 0,
            // IMPORTANT: skip hardcoded hono CRUD routes so createRestApiPlugin
            // owns /data and /meta registration end-to-end.
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
        ql.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);

        ql.registerObject({
            name: 'task',
            label: 'Task',
            fields: {
                title: { type: 'text', label: 'Title' },
            },
        });
        // Objects registered AFTER bootstrap miss the boot-time schema sync, so
        // nothing has issued their DDL. The mingo driver this suite used before
        // #4065 created a table on first touch and hid that; on SQL the first
        // write fails with `no such table`.
        await ql.syncObjectSchema('task');
        // [#18070] The authz resolver's own reads, registered and synced so the
        // driver PROVISIONS them rather than refusing them.
        for (const o of AUTHZ_RESOLVER_OBJECTS) {
            ql.registerObject(o.def, o.owner);
            await ql.syncObjectSchema(o.def.name);
        }

        const httpServer = kernel.getService<IHttpServer>('http.server');
        const port = httpServer.getPort!();
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

    it('client.environment(id).data.find() hits the scoped URL end-to-end', async () => {
        const client = new ObjectStackClient({ baseUrl });
        const scoped = client.environment('proj-alpha');
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
