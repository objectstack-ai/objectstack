// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `metadata.prefix` is honoured by the SDK, not restated by it (#16675).
 *
 * THE CONTRACT. `metadata.prefix` is a live `RestServerConfig` key, the exact
 * sibling of the `crud.dataPrefix` #14879 fixed: REST mounts every metadata
 * route under `metaPath = ${basePath}${metadata.prefix}` and the discovery
 * handler advertises the same value as
 * `routes.metadata = ${realBase}${metadata.prefix}`. Three surfaces describe
 * one set of paths — the mounts, the discovery document, and this SDK — so the
 * SDK must READ the value rather than restate it.
 *
 * WHAT WAS WRONG. The SDK's scoped surface restated `/meta` as a literal in
 * all SIX of its metadata methods (`getTypes` / `getItems` / `getItem` /
 * `saveItem` / `deleteItem` / `getHistory`), so on a deployment that moved the
 * prefix it called paths the server does not mount. The unscoped twin of each
 * of those methods was already correct — it builds
 * `${baseUrl}${getRoute('metadata')}` — so ONE SDK disagreed with itself: the
 * unscoped half read the advertised value while the scoped half guessed.
 *
 * WHY THE FIXTURE CREATES THE CONDITION. Measured on `origin/main`, no in-repo
 * caller sets a non-default `metadata.prefix`, so no existing fixture
 * exercises this and nothing in the tree is broken today; the exposure is
 * external deployments. So this suite BOOTS a server on a non-default prefix
 * rather than looking for one.
 *
 * WHY A LIVE SERVER AND A RECORDED URL. A mock that answers 200 to whatever it
 * is asked cannot tell a mounted path from an unmounted one — it would go
 * green against the very bug this pins. So the server is real, and the suite
 * asserts BOTH halves of the claim: that the URL the client puts on the wire
 * is the one the server actually mounts, and (`serves nothing at /meta`) that
 * the old hard-coded path is genuinely dead on this deployment, which is what
 * makes the first assertion mean something.
 *
 * ⚠️ EVERY URL ASSERTION IS FULL-STRING EQUALITY, NEVER `toContain`. The
 * realistic non-default prefix `/metadata` CONTAINS the conventional `/meta`
 * as a prefix, so `expect(url).not.toContain('/meta')` would fail on the
 * CORRECT url and `toContain('/meta')` would pass on it — a substring probe
 * over this pair of values answers noise. Equality is immune to that, and it
 * is also what the negative control below needs to mean anything.
 *
 * THE NEGATIVE CONTROL (the acceptance criterion of #16675). The same drive
 * runs against a default-prefix server built by the same helper, and against a
 * client that never connected at all. It is what distinguishes "the SDK
 * follows the advertised prefix" from "the SDK now always rebuilds its paths
 * out of discovery": a default deployment must be reached at exactly the URLs
 * it was reached at before, byte for byte, and an unconnected client must
 * still produce them WITHOUT putting a discovery round-trip on the wire. An
 * implementation that always derives from discovery passes the non-default
 * case above while making every default deployment slower and more fragile —
 * these two describes are the only thing that catches it.
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
/**
 * Deliberately the value `packages/spec`'s own `MetadataEndpointsConfigSchema`
 * test uses for "custom prefix" — and deliberately one that has the
 * conventional `/meta` as a string prefix, so the substring trap above is
 * exercised rather than side-stepped.
 */
const CUSTOM_PREFIX = '/metadata';

interface Fixture {
    baseUrl: string;
    kernel: LiteKernel;
}

/**
 * One boot recipe, two prefixes — so the non-default case and the control
 * differ in exactly the key under test and nothing else.
 */
async function bootServer(metadataPrefix?: string): Promise<Fixture> {
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
                // control runs the schema's own `.default('/meta')` rather
                // than a second literal written here.
                ...(metadataPrefix ? { metadata: { prefix: metadataPrefix } as any } : {}),
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

/**
 * Drive all SIX scoped metadata methods and return the URL each one put on the
 * wire, in call order. The writes are allowed to reject — a 404 on an
 * unmounted path and a refusal from a live write door are both rejections, and
 * this suite is about the URL, not the answer. Recording happens before the
 * request is made, so a rejected call still contributes its URL.
 */
async function driveAllSix(client: ObjectStackClient, urls: string[]): Promise<string[]> {
    const scoped = client.environment(ENV_ID);
    const before = urls.length;
    const swallow = (p: Promise<unknown>) => p.then(() => undefined, () => undefined);
    await swallow(scoped.meta.getTypes());
    await swallow(scoped.meta.getItems('object'));
    await swallow(scoped.meta.getItem('object', 'task'));
    await swallow(scoped.meta.saveItem('object', 'task', { name: 'task', label: 'Task' }));
    await swallow(scoped.meta.deleteItem('object', 'task'));
    await swallow(scoped.meta.getHistory('object', 'task'));
    return urls.slice(before);
}

/** The six URLs a deployment on `prefix` must be called at. */
function expectedSix(baseUrl: string, prefix: string): string[] {
    const root = `${baseUrl}/api/v1/environments/${ENV_ID}${prefix}`;
    return [
        `${root}`,
        `${root}/object`,
        `${root}/object/task`,
        `${root}/object/task`,
        `${root}/object/task`,
        `${root}/object/task/history`,
    ];
}

describe('SDK honours metadata.prefix (#16675)', () => {
    describe(`non-default prefix (${CUSTOM_PREFIX})`, () => {
        let fx: Fixture;

        beforeAll(async () => { fx = await bootServer(CUSTOM_PREFIX); }, 30_000);
        afterAll(async () => { await shutdown(fx); }, 30_000);

        it('mounts scoped metadata under the configured prefix, and serves nothing at /meta', async () => {
            const mounted = await fetch(`${fx.baseUrl}/api/v1/environments/${ENV_ID}${CUSTOM_PREFIX}`);
            expect(mounted.status).toBe(200);

            // The half that makes this fixture worth anything: the path the
            // SDK used to hard-code is genuinely not mounted here.
            const hardCoded = await fetch(`${fx.baseUrl}/api/v1/environments/${ENV_ID}/meta`);
            expect(hardCoded.status).toBe(404);
        });

        it('advertises the prefix on the discovery document', async () => {
            const res = await fetch(`${fx.baseUrl}/api/v1/discovery`);
            expect(res.status).toBe(200);
            const body = await res.json();
            const routes = (body?.data ?? body)?.routes;
            expect(routes?.metadata).toBe(`/api/v1${CUSTOM_PREFIX}`);
        });

        it('all six scoped meta methods call the mounted path, not /meta', async () => {
            const { client, urls } = recordingClient(fx.baseUrl);
            await client.connect();

            const called = await driveAllSix(client, urls);
            expect(called).toEqual(expectedSix(fx.baseUrl, CUSTOM_PREFIX));
        });
    });

    describe('negative control — default prefix, byte-identical URLs', () => {
        let fx: Fixture;

        beforeAll(async () => { fx = await bootServer(); }, 30_000);
        afterAll(async () => { await shutdown(fx); }, 30_000);

        it('advertises /api/v1/meta', async () => {
            const res = await fetch(`${fx.baseUrl}/api/v1/discovery`);
            const body = await res.json();
            const routes = (body?.data ?? body)?.routes;
            expect(routes?.metadata).toBe('/api/v1/meta');
        });

        it('a CONNECTED client still calls the six /meta URLs, byte for byte', async () => {
            const { client, urls } = recordingClient(fx.baseUrl);
            await client.connect();

            const called = await driveAllSix(client, urls);
            expect(called).toEqual(expectedSix(fx.baseUrl, '/meta'));
        });

        it('an UNCONNECTED client calls the same six URLs and puts NO discovery request on the wire', async () => {
            // No `connect()`, so there is no advertised document to read. The
            // derivation must decline to the conventional literal rather than
            // reach for one -- this is the leg that fails on an
            // "always rebuild the path out of discovery" implementation, which
            // would make every default deployment pay a round-trip it does not
            // pay today.
            const { client, urls } = recordingClient(fx.baseUrl);

            const called = await driveAllSix(client, urls);
            expect(called).toEqual(expectedSix(fx.baseUrl, '/meta'));

            // Exactly six requests, and none of them is a discovery read.
            expect(urls).toHaveLength(6);
            expect(urls.filter((u) => u.includes('/discovery'))).toEqual([]);
        });
    });
});
