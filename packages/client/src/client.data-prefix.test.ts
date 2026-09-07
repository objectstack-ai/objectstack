// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `crud.dataPrefix` is honoured by the SDK, not restated by it (#14879).
 *
 * THE CONTRACT. `crud.dataPrefix` is a live `RestServerConfig` key: REST mounts
 * every CRUD route under `dataPath = ${basePath}${crud.dataPrefix}` and the
 * discovery handler advertises the same value as
 * `routes.data = ${realBase}${crud.dataPrefix}`. Three surfaces describe one
 * set of paths — the mounts, the discovery document, and this SDK — and the
 * liveness ledger classifies the key `live` precisely because it "moves the
 * mounted paths and the advertised discovery document together".
 *
 * WHAT WAS WRONG. The SDK's scoped surface restated `/data` as a literal in
 * every one of its data methods, so on a deployment that moved the prefix it
 * called paths the server does not mount. The unscoped twin of each of those
 * methods was already correct — it builds `${baseUrl}${getRoute('data')}` and
 * `routes.data` already carries the prefix — so ONE SDK disagreed with itself:
 * the unscoped half read the advertised value while the scoped half guessed.
 *
 * WHY THE FIXTURE CREATES THE CONDITION. Measured on `origin/main`, no in-repo
 * caller sets a non-default `dataPrefix`, so no existing fixture exercises
 * this and nothing in the tree is broken today; the exposure is external
 * deployments. So this suite BOOTS a server on a non-default prefix rather
 * than looking for one.
 *
 * WHY A LIVE SERVER AND A RECORDED URL. A mock that answers 200 to whatever it
 * is asked cannot tell a mounted path from an unmounted one — it would go
 * green against the very bug this pins. So the server is real, and the suite
 * asserts BOTH halves of the claim: that the URL the client puts on the wire
 * is the one the server actually mounts, and (`serves nothing at /data`) that
 * the old hard-coded path is genuinely dead on this deployment, which is what
 * makes the first assertion mean something.
 *
 * THE POSITIVE CONTROL. The same drive runs against a default-prefix server
 * built by the same helper. It is what distinguishes "the SDK follows the
 * advertised prefix" from "the SDK broke and now sends something else": the
 * default deployment must still be reached at `/data`, byte-for-byte as
 * before.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { ObjectQL, ObjectQLPlugin } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { createRestApiPlugin } from '@objectstack/runtime';
import { ObjectStackClient } from './index';
import type { IHttpServer } from '@objectstack/spec/contracts';

const ENV_ID = 'proj-alpha';
const CUSTOM_PREFIX = '/objects';

interface Fixture {
    baseUrl: string;
    kernel: LiteKernel;
}

/**
 * One boot recipe, two prefixes — so the non-default case and the control
 * differ in exactly the key under test and nothing else.
 */
async function bootServer(dataPrefix?: string): Promise<Fixture> {
    const kernel = new LiteKernel();
    kernel.use(new ObjectQLPlugin());
    // Same reason as the sibling scoping suite (#3963): the anonymous-deny
    // gate is unconditional, so a live-server client suite needs a session.
    kernel.use({
        metadata: { name: 'test-auth', version: '1.0.0' },
        async init(ctx: any) {
            ctx.registerService('auth', {
                api: { getSession: async () => ({ user: { id: 'test-user' } }) },
            });
        },
    } as any);

    const honoPlugin = new HonoServerPlugin({ port: 0 });
    kernel.use(honoPlugin);

    kernel.use(
        createRestApiPlugin({
            api: {
                api: {
                    // Routing test, no auth stack mounted (ADR-0056 D2).
                    requireAuth: false,
                    enableProjectScoping: true,
                    projectResolution: 'auto',
                } as any,
                // The key under test. Omitted entirely for the control, so the
                // control runs the schema's own `.default('/data')` rather than
                // a second literal written here.
                ...(dataPrefix ? { crud: { dataPrefix } as any } : {}),
            },
        }),
    );

    await kernel.bootstrap();

    const ql = kernel.getService<ObjectQL>('objectql');
    ql.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
    ql.registerObject({
        name: 'task',
        label: 'Task',
        fields: { title: { type: 'text', label: 'Title' } },
    });
    // Registered after bootstrap, so nothing has issued the DDL yet (#4065).
    await ql.syncObjectSchema('task');

    const httpServer = kernel.getService<IHttpServer>('http.server');
    const port = httpServer.getPort!();
    return { baseUrl: `http://localhost:${port}`, kernel };
}

async function shutdown(fixture: Fixture | undefined): Promise<void> {
    if (!fixture?.kernel) return;
    await Promise.race([
        fixture.kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
}

/**
 * A client whose every request URL is recorded. The recorder DELEGATES to the
 * real fetch, so the recorded URL and the server's real answer are the same
 * exchange — the assertion cannot pass on a URL that was never served.
 */
function recordingClient(baseUrl: string): { client: ObjectStackClient; urls: string[] } {
    const urls: string[] = [];
    const client = new ObjectStackClient({
        baseUrl,
        fetch: (input: RequestInfo | URL, init?: RequestInit) => {
            urls.push(typeof input === 'string' ? input : String(input));
            return globalThis.fetch(input as any, init);
        },
    } as any);
    return { client, urls };
}

describe('SDK honours crud.dataPrefix (#14879)', () => {
    describe(`non-default prefix (${CUSTOM_PREFIX})`, () => {
        let fx: Fixture;

        beforeAll(async () => { fx = await bootServer(CUSTOM_PREFIX); }, 30_000);
        afterAll(async () => { await shutdown(fx); }, 30_000);

        it('mounts scoped CRUD under the configured prefix, and serves nothing at /data', async () => {
            const mounted = await fetch(`${fx.baseUrl}/api/v1/environments/${ENV_ID}${CUSTOM_PREFIX}/task?top=5`);
            expect(mounted.status).toBe(200);

            // The half that makes this fixture worth anything: the path the
            // SDK used to hard-code is genuinely not mounted here.
            const hardCoded = await fetch(`${fx.baseUrl}/api/v1/environments/${ENV_ID}/data/task?top=5`);
            expect(hardCoded.status).toBe(404);
        });

        it('advertises the prefix on the discovery document', async () => {
            const res = await fetch(`${fx.baseUrl}/api/v1/discovery`);
            expect(res.status).toBe(200);
            const body = await res.json();
            const routes = (body?.data ?? body)?.routes;
            expect(routes?.data).toBe(`/api/v1${CUSTOM_PREFIX}`);
        });

        it('scoped data.find() calls the mounted path, not /data', async () => {
            const { client, urls } = recordingClient(fx.baseUrl);
            await client.connect();

            const scoped = client.environment(ENV_ID);
            await expect(scoped.data.find('task')).resolves.toBeDefined();

            const dataCalls = urls.filter((u) => u.includes('/task'));
            expect(dataCalls).toHaveLength(1);
            expect(dataCalls[0]).toContain(`/api/v1/environments/${ENV_ID}${CUSTOM_PREFIX}/task`);
            expect(dataCalls[0]).not.toContain('/data/');
        });

        it('scoped data.query() calls the mounted path, not /data', async () => {
            const { client, urls } = recordingClient(fx.baseUrl);
            await client.connect();

            const scoped = client.environment(ENV_ID);
            await expect(scoped.data.query('task', { top: 1 })).resolves.toBeDefined();

            const queryCalls = urls.filter((u) => u.includes('/task/query'));
            expect(queryCalls).toHaveLength(1);
            expect(queryCalls[0]).toContain(`/api/v1/environments/${ENV_ID}${CUSTOM_PREFIX}/task/query`);
            expect(queryCalls[0]).not.toContain('/data/');
        });
    });

    describe('positive control — default prefix on the same fixture', () => {
        let fx: Fixture;

        beforeAll(async () => { fx = await bootServer(); }, 30_000);
        afterAll(async () => { await shutdown(fx); }, 30_000);

        it('advertises /api/v1/data', async () => {
            const res = await fetch(`${fx.baseUrl}/api/v1/discovery`);
            const body = await res.json();
            const routes = (body?.data ?? body)?.routes;
            expect(routes?.data).toBe('/api/v1/data');
        });

        it('scoped data.find() still calls /data — unchanged by the derivation', async () => {
            const { client, urls } = recordingClient(fx.baseUrl);
            await client.connect();

            const scoped = client.environment(ENV_ID);
            await expect(scoped.data.find('task')).resolves.toBeDefined();

            const dataCalls = urls.filter((u) => u.includes('/task'));
            expect(dataCalls).toHaveLength(1);
            expect(dataCalls[0]).toContain(`/api/v1/environments/${ENV_ID}/data/task`);
        });

        it('an unconnected client declines to the /data convention', async () => {
            // No `connect()`, so there is no advertised document to read. The
            // derivation must fall back to today's literal rather than invent
            // a prefix -- this is the "declines rather than guess" leg.
            const { client, urls } = recordingClient(fx.baseUrl);
            const scoped = client.environment(ENV_ID);
            await expect(scoped.data.find('task')).resolves.toBeDefined();

            expect(urls).toHaveLength(1);
            expect(urls[0]).toContain(`/api/v1/environments/${ENV_ID}/data/task`);
        });
    });
});
