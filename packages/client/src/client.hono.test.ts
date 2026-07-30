import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ObjectStackClient } from './index';

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
        
        // 2. Setup Hono Plugin
        // This suite exercises the CLIENT's data operations over the raw-hono
        // standard endpoints; it wires no auth service. Opt out of the
        // secure-by-default anonymous-deny posture (#2567) so the anonymous
        // data CRUD under test stays reachable — the same explicit
        // `requireAuth: false` a deployment that intentionally serves data
        // publicly would set. The gate itself is proven in
        // plugin-hono-server/hono-anonymous-deny.test.ts.
        const honoPlugin = new HonoServerPlugin({
            port: 0,
            registerStandardEndpoints: true,
        });
        kernel.use(honoPlugin);
        
        // --- BROKER SHIM START ---
        // HttpDispatcher requires a broker to function. We inject a simple shim.
        (kernel as any).broker = {
            call: async (action: string, params: any, opts: any) => {
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
        const httpServer = kernel.getService<any>('http.server');
        const port = httpServer.getPort();
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

        // The standalone hono surface advertises what it actually mounts
        // (#4018): /data CRUD and the /auth/me/* helpers are registered here,
        // so both are advertised and both answer.
        const endpoints = client['discoveryInfo']!.routes;
        expect(endpoints.data).toContain('/api/v1/data');
        expect(endpoints.auth).toContain('/api/v1/auth');

        // `metadata` is NOT advertised on this boot, and that is the point of
        // #4018: no plugin here mounts /api/v1/meta (it ships with
        // @objectstack/rest / the dispatcher), so the old hardcoded table was
        // promising a route that 404s. Proof the omission is honest:
        expect(endpoints.metadata).toBeUndefined();
        expect((await fetch(`${baseUrl}/api/v1/meta/objects`)).status).toBe(404);
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
});
