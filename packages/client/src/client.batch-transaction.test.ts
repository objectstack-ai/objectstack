// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Integration test — atomic cross-object batch through the typed SDK
 * (`client.data.batchTransaction`, issue #1604 / ADR-0034 item 4).
 *
 * Boots a real Hono server (LiteKernel + ObjectQLPlugin + createRestApiPlugin,
 * same pattern as client.environment-scoping.test.ts) and proves the full
 * client → hono → rest → engine chain:
 *   1. Parent + child with `{ $ref: 0 }` commit in one request and the child's
 *      FK equals the parent's generated id.
 *   2. The environment-scoped mirror resolves `/environments/:id/batch`.
 *   3. An unresolvable `$ref` rejects and the client error carries
 *      `code: 'BATCH_UNRESOLVED_REF'` (error-mapping proof).
 *   4. `atomic: false` is rejected with 400 BATCH_NOT_ATOMIC — the contract
 *      reason the SDK method exposes no `atomic` flag.
 *
 * NOTE on atomicity: all-or-nothing semantics are NOT asserted here — they are
 * covered by objectql/src/engine-ambient-transaction.test.ts and
 * rest/src/rest-batch-endpoint.test.ts. This suite's four proofs are about the
 * `$ref` wiring, the environment-scoped mirror and the error contract, not
 * rollback. (It ran on the mingo driver until #4065, whose `transaction()` is a
 * passthrough and could not have asserted rollback even if it wanted to; the
 * in-memory SQLite it now runs on does have real transactions, but adding a
 * rollback proof here would duplicate the two suites above rather than close a
 * gap.)
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
 * reads the resolver issues: **25** resolver-class `refused a read on` driver
 * lines in this file, 5 per table across 5. `tryFind` classifies a missing
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

describe('data.batchTransaction (live Hono, #1604)', () => {
    let baseUrl: string;
    let kernel: LiteKernel;
    let client: ObjectStackClient;

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

        kernel.use(
            new HonoServerPlugin({
                port: 0,
                // Skip hardcoded hono CRUD routes so createRestApiPlugin owns
                // route registration (including the root /batch route).
            }),
        );

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
            name: 'project',
            label: 'Project',
            fields: {
                name: { type: 'text', label: 'Name' },
            },
        });
        ql.registerObject({
            name: 'task',
            label: 'Task',
            fields: {
                title: { type: 'text', label: 'Title' },
                // `reference`, not `reference_to`: the latter is no key the field
                // schema knows, so this lookup declared no target at all until a
                // tsc program finally read the file (TS2561, #5449).
                project: { type: 'lookup', reference: 'project', label: 'Project' },
            },
        });
        // Objects registered AFTER bootstrap miss the boot-time schema sync, so
        // nothing has issued their DDL. The mingo driver this suite used before
        // #4065 created a table on first touch and hid that; on SQL the first
        // write fails with `no such table`.
        await ql.syncObjectSchema('project');
        await ql.syncObjectSchema('task');
        // [#18070] The authz resolver's own reads, registered and synced so the
        // driver PROVISIONS them rather than refusing them.
        for (const o of AUTHZ_RESOLVER_OBJECTS) {
            ql.registerObject(o.def, o.owner);
            await ql.syncObjectSchema(o.def.name);
        }

        const httpServer = kernel.getService<IHttpServer>('http.server');
        baseUrl = `http://localhost:${httpServer.getPort!()}`;
        client = new ObjectStackClient({ baseUrl });
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    it('creates parent + child in one request; { $ref: 0 } resolves to the parent id', async () => {
        const { results } = await client.data.batchTransaction([
            { object: 'project', action: 'create', data: { name: 'Apollo' } },
            { object: 'task', action: 'create', data: { title: 'Kickoff', project: { $ref: 0 } } },
        ]);

        expect(results).toHaveLength(2);
        const parent = results[0] as any;
        const child = results[1] as any;
        expect(parent.id).toBeDefined();
        expect(child.project).toBe(parent.id);

        // Both rows are readable afterwards through the ordinary data API.
        // One shape only (#4793): `data.get` answers the declared
        // `GetDataResponseSchema` envelope — the record rides `record`. The
        // old `?? (x as any).record?.project` double-shape hedge is exactly
        // the "test can't say which side is true" tax the contract exists to
        // remove.
        const storedChild = await client.data.get<any>('task', child.id);
        expect(storedChild.record?.project).toBe(parent.id);
    });

    it('is mirrored on the environment-scoped client (/environments/:id/batch)', async () => {
        const scoped = client.environment('proj-alpha');
        const { results } = await scoped.data.batchTransaction([
            { object: 'project', action: 'create', data: { name: 'Scoped' } },
        ]);
        expect((results[0] as any).id).toBeDefined();
    });

    it('rejects an unresolvable $ref with BATCH_UNRESOLVED_REF surfaced on the client error', async () => {
        let caught: any;
        try {
            await client.data.batchTransaction([
                { object: 'task', action: 'create', data: { title: 'orphan', project: { $ref: 5 } } },
            ]);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeDefined();
        expect(caught.httpStatus).toBe(400);
        expect(caught.code).toBe('BATCH_UNRESOLVED_REF');
    });

    it('rejects atomic:false with 400 BATCH_NOT_ATOMIC (why the SDK has no atomic flag)', async () => {
        const res = await fetch(`${baseUrl}/api/v1/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                operations: [{ object: 'project', action: 'create', data: { name: 'nope' } }],
                atomic: false,
            }),
        });
        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.code).toBe('BATCH_NOT_ATOMIC');
    });
});
