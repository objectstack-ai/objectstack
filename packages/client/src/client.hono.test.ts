import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/runtime';
import { ObjectStackClient } from './index';
import type { IHttpServer } from '@objectstack/spec/contracts';

describe('ObjectStackClient (with Hono Server)', () => {
    let baseUrl: string;
    let kernel: LiteKernel;

    beforeAll(async () => {
        // 1. Setup Kernel
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
        
        // 2. Setup Hono Plugin — transport only.
        //
        // This suite used to run against the raw-hono standard endpoints. That
        // surface is gone (#4073): the plugin serves the socket and the
        // current-user endpoints, and the data + discovery APIs belong to their
        // owner. What is under test here is the CLIENT — `connect()`, the
        // discovery handshake, and CRUD over HTTP — so it now runs against the
        // real owner, which is also what every deployment actually serves.
        const honoPlugin = new HonoServerPlugin({ port: 0 });
        kernel.use(honoPlugin);

        // `requireAuth: false` keeps the anonymous CRUD under test reachable —
        // the same explicit opt-out a deployment intentionally serving public
        // data would set (#2567/#3963); the gate itself is proven in
        // @objectstack/rest's own suites.
        kernel.use(createRestApiPlugin({ api: { api: { requireAuth: false } as any } }));
        
        // --- BROKER SHIM START ---
        // HttpDispatcher requires a broker to function. We inject a simple shim.
        (kernel as any).broker = {
            call: async (action: string, params: any, _opts: any) => {
                const parts = action.split('.');
                const service = parts[0];
                const method = parts[1];
                
                if (service === 'data') {
                    const ql = kernel.getService<any>('objectql'); // Use 'objectql' service name for clarity
                    // Delegate to protocol service when available for proper expand/populate support
                    let protocol: any;
                    try { protocol = kernel.getService<any>('protocol'); } catch { /* not registered */ }
                    if (method === 'create') {
                        const res = await ql.insert(params.object, params.data);
                        const record = { ...params.data, ...res };
                        return { object: params.object, id: record.id, record };
                    }
                    // Params from HttpDispatcher: { object, id, ...query }
                    if (method === 'get') {
                        if (protocol) {
                            return await protocol.getData({ object: params.object, id: params.id, expand: params.expand, select: params.select });
                        }
                        const record = await ql.findOne(params.object, { where: { id: params.id } });
                        return record ? { object: params.object, id: params.id, record } : null;
                    }
                    // Params from HttpDispatcher: { object, filters }
                    if (method === 'query') {
                        if (protocol) {
                            return await protocol.findData({ object: params.object, query: params.query || params.filters });
                        }
                        const records = await ql.find(params.object, { where: params.filters });
                        return { object: params.object, records, total: records.length };
                    }
                    if (method === 'find') {
                        if (protocol) {
                            return await protocol.findData({ object: params.object, query: params.query || params.filters });
                        }
                        const records = await ql.find(params.object, { where: params.filters });
                        return { object: params.object, records, total: records.length };
                    }
                }
                
                if (service === 'metadata') {
                    // ObjectQLPlugin registers itself as 'metadata' but doesn't implement all broker methods directly
                    // We use SchemaRegistry for lookups
                    const ql = kernel.getService<any>('objectql');
                    if (method === 'getObject') {
                         return ql.registry.getObject(params.objectName);
                    }
                    if (method === 'objects') {
                         return ql.registry.getAllObjects();
                    }
                }
                
                if (service === 'auth' && method === 'login') {
                     return { token: 'mock-token', user: { id: 'admin', name: 'Admin' } };
                }

                console.warn(`[BrokerShim] Action not implemented: ${action}`);
                throw new Error(`Action ${action} not implemented in shim`);
            }
        };
        // --- BROKER SHIM END ---

        await kernel.bootstrap();

        // 3. Setup Driver
        const ql = kernel.getService<ObjectQL>('objectql');
        ql.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);

        // 4. Load Metadata (Schema)
        ql.registerObject({
            name: 'customer',
            label: 'Customer',
            fields: {
                name: { type: 'text', label: 'Name' },
                email: { type: 'text', label: 'Email' }
            }
        });
        // Objects registered AFTER bootstrap miss the boot-time schema sync, so
        // nothing has issued their DDL. The mingo driver this suite used before
        // #4065 created a table on first touch and hid that; on SQL the first
        // write fails with `no such table`.
        await ql.syncObjectSchema('customer');

        // 5. Get Port from Service
        const httpServer = kernel.getService<IHttpServer>('http.server');
        const port = httpServer.getPort!();
        baseUrl = `http://localhost:${port}`;

        console.log(`Test server running at ${baseUrl}`);
    }, 30_000);

    afterAll(async () => {
        if (kernel) {
            // Race shutdown against a hard deadline.
            // kernel.shutdown() can hang if flush never completes
            
            await Promise.race([
                kernel.shutdown(),
                new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
            ]);
        }
    }, 30_000);

    it('should connect to hono server and discover endpoints', async () => {
        const client = new ObjectStackClient({ baseUrl });
        await client.connect();

        // Client should have populated discovery info
        expect(client['discoveryInfo']).toBeDefined();

        // Discovery is REST's, computed from its registry (#4018 D12: declared
        // === enforced). Every route it advertises must actually answer.
        // `routes` is optional on the discovery payload, so it is reached
        // optionally and asserted — a missing map fails `toContain` rather than
        // being waved through by a `!` or a `?? {}` default (#5449).
        const endpoints = client['discoveryInfo']!.routes;
        expect(endpoints?.data).toContain('/api/v1/data');
        expect(endpoints?.metadata).toContain('/api/v1/meta');

        // Enforced, not just declared — the pairing #4018 exists to hold.
        expect((await fetch(`${baseUrl}/api/v1/meta/object`)).status).not.toBe(404);
    });

    it('should create and retrieve data via hono', async () => {
        const client = new ObjectStackClient({ baseUrl });
        await client.connect();

        // Create — Spec: CreateDataResponse = { object, id, record }
        const createdResponse = await client.data.create('customer', {
            name: 'Hono User',
            email: 'hono@example.com'
        });
        
        expect(createdResponse.record.name).toBe('Hono User');
        expect(createdResponse.id).toBeDefined();

        // Retrieve — Spec: GetDataResponse = { object, id, record }
        const retrievedResponse = await client.data.get('customer', createdResponse.id);
        expect(retrievedResponse.record.name).toBe('Hono User');
    });

    it('should find data via hono', async () => {
        const client = new ObjectStackClient({ baseUrl });
        await client.connect();

        // Spec: FindDataResponse = { object, records, total? }
        const resultsResponse = await client.data.find('customer', {
            where: { name: 'Hono User' }
        });

        expect(resultsResponse.records.length).toBeGreaterThan(0);
        expect(resultsResponse.records[0].name).toBe('Hono User');
    });

    // [#5638] The one method whose declared return shape this suite never
    // exercised — and the one that was wrong. `DeleteDataResult` claimed
    // `deleted: boolean`; the schema it names declares `success`. This is the
    // runtime half of the pin: a REAL delete, over HTTP, against the server
    // this package's consumers talk to, read through the declared type.
    //
    // Nothing in this test is mocked into the answer: the DELETE route calls
    // `protocol.deleteData` (rest-server.ts), NOT the broker shim above, so the
    // body asserted here is the server's own.
    it('should delete data via hono, answering the SPEC\'s `success` body', async () => {
        const client = new ObjectStackClient({ baseUrl });
        await client.connect();

        const created = await client.data.create('customer', {
            name: 'Doomed User',
            email: 'doomed@example.com',
        });

        // Spec: DeleteDataResponse = { object, id, success }
        const deleted = await client.data.delete('customer', created.id);
        expect(deleted.success).toBe(true);
        expect(deleted.object).toBe('customer');
        expect(deleted.id).toBe(created.id);
        // The undeclared key must not ride along (a passing schema parse would
        // strip it silently, so assert the key set itself).
        expect(Object.keys(deleted).sort()).toEqual(['id', 'object', 'success']);

        // And the delete actually happened — a success flag nobody cross-checks
        // is the cheapest thing in the world to keep green.
        const remaining = await client.data.find('customer', { where: { id: created.id } });
        expect(remaining.records.length).toBe(0);
    });
});
