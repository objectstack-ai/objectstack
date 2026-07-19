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
 * NOTE on atomicity: the InMemoryDriver's `transaction()` is a passthrough
 * (no rollback), so all-or-nothing semantics are NOT asserted here — they are
 * covered by objectql/src/engine-ambient-transaction.test.ts and
 * rest/src/rest-batch-endpoint.test.ts against transactional drivers.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { InMemoryDriver } from '@objectstack/driver-memory';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/runtime';
import { ObjectStackClient } from './index';

describe('data.batchTransaction (live Hono, #1604)', () => {
    let baseUrl: string;
    let kernel: LiteKernel;
    let client: ObjectStackClient;

    beforeAll(async () => {
        kernel = new LiteKernel();
        kernel.use(new ObjectQLPlugin());

        kernel.use(
            new HonoServerPlugin({
                port: 0,
                // Skip hardcoded hono CRUD routes so createRestApiPlugin owns
                // route registration (including the root /batch route).
                registerStandardEndpoints: false,
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
        ql.registerDriver(new InMemoryDriver(), true);

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
                project: { type: 'lookup', reference_to: 'project', label: 'Project' },
            },
        });

        const httpServer = kernel.getService<any>('http.server');
        baseUrl = `http://localhost:${httpServer.getPort()}`;
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
        const storedChild = await client.data.get<any>('task', child.id);
        expect((storedChild as any).project ?? (storedChild as any).record?.project).toBeDefined();
    });

    it('is mirrored on the environment-scoped client (/environments/:id/batch)', async () => {
        const scoped = client.project('proj-alpha');
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
