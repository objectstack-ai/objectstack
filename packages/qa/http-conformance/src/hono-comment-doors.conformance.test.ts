// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36469] The three comment doors on the hosted shape: `createHonoApp` over a
 * kernel with NO `http.server` (a hosted tenant kernel owns no socket), the
 * REAL `AuditPlugin` over a real store.
 *
 * Before the `/comments` dispatcher domain and the `comments` slot existed,
 * every request below answered the dispatcher's `404 ROUTE_NOT_FOUND` on
 * this shape: the doors were mounted only on the kernel's own `http.server`,
 * which this kernel does not have, and the catch-all's `dispatch()` had no
 * domain for them. The first pin here asserts no door answers a route miss
 * any more, door by door. (The card's hosted reading spelled the miss
 * `ENDPOINT_NOT_FOUND`, the transport's own: item 4 below explains it.)
 *
 * What this pins:
 *  1. on the hosted shape, a member removes their own reaction, resolves and
 *     reopens a thread, and removes their own comment, each answered by the
 *     door and each landing in the store;
 *  2. the two doors answer the same request with the same bytes — the
 *     anonymous refusal and a refused body — because the member runs the very
 *     registration the self-hosted mount runs;
 *  3. a hosted kernel without plugin-audit answers a typed
 *     `501 NOT_IMPLEMENTED`, never a route miss;
 *  4. on the `objectstack serve` / `objectstack dev` host shape (HonoServerPlugin
 *     + DispatcherPlugin on the host, a kernel-resolver, NO catch-all) the same
 *     member answers, with the same bytes, through DispatcherPlugin's fallback.
 *     Without that fallback arm this shape answered the transport's own
 *     `{"success":false,"error":{"code":"ENDPOINT_NOT_FOUND","message":"Not found"}}`,
 *     byte for byte the card's hosted reading (cloud's local rig runs
 *     `apps/objectos` under `objectstack dev`).
 *
 * The domain's own claim, gates and faults are pinned on the real dispatcher
 * in `packages/runtime/src/domains/comments.test.ts`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectKernel, LiteKernel } from '@objectstack/core';
import type { Plugin, PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, type ObjectQL } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { AuditPlugin } from '@objectstack/plugin-audit';
import { createHonoApp } from '@objectstack/hono';
import { createDispatcherPlugin } from '@objectstack/runtime';
import type { IHttpServer } from '@objectstack/spec/contracts';
import { installDefaultOrganization, DEFAULT_ORGANIZATION_ID } from './default-organization.testkit.js';

const PREFIX = '/api/v1';
const COMMENT = 'sys_comment';
const REACTION = 'sys_comment_reaction';
const BOARD = 'cdh_board';
/** The header the test auth service reads the signed-in user from. */
const SIGNED_IN_AS = 'x-test-signed-in-as';
const ALICE = 'usr_alice';
const SYSTEM = { isSystem: true } as const;

/**
 * The identity rows the door's caller resolution reads on every signed-in
 * request (`resolve-authz-context.ts`: membership, positions, permission
 * sets). A deployment's auth and security plugins register them; this kernel
 * stubs `auth`, so they are spelled here with only the columns that resolver
 * reads, the precedent `conformance.integration.test.ts` set. Registered
 * before the schema sync, so their tables exist and Alice's membership reads.
 */
const text = (name: string) => ({ name, type: 'text' as const });
const identityObjects = [
    { owner: '@objectstack/plugin-auth', def: { name: 'sys_user', label: 'User', fields: { id: { ...text('id'), primaryKey: true }, email: text('email') } } },
    {
        owner: '@objectstack/plugin-auth',
        def: { name: 'sys_member', label: 'Member', fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), organization_id: text('organization_id'), role: text('role') } },
    },
    {
        owner: '@objectstack/plugin-security',
        def: { name: 'sys_user_position', label: 'User Position', fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), position: text('position'), organization_id: text('organization_id') } },
    },
    {
        owner: '@objectstack/plugin-security',
        def: { name: 'sys_user_permission_set', label: 'User Permission Set', fields: { id: { ...text('id'), primaryKey: true }, user_id: text('user_id'), permission_set_id: text('permission_set_id'), organization_id: text('organization_id') } },
    },
    {
        owner: '@objectstack/plugin-security',
        def: { name: 'sys_position', label: 'Position', fields: { id: { ...text('id'), primaryKey: true }, name: text('name'), active: { name: 'active', type: 'boolean' as const }, organization_id: text('organization_id') } },
    },
] as const;

const board = { name: BOARD, label: 'Board', fields: { name: { name: 'name', label: 'Name', type: 'text' as const } } };

/** An auth service whose in-process session read names the user the request names. */
class TestAuth implements Plugin {
    name = 'test.comment-doors-auth';
    version = '1.0.0';
    type = 'standard' as const;
    async init(ctx: PluginContext): Promise<void> {
        ctx.registerService('auth', {
            api: {
                async getSession(input: { headers: Headers }) {
                    const userId = input.headers.get(SIGNED_IN_AS);
                    if (!userId) return null;
                    return { user: { id: userId, email: `${userId}@acme.test` }, session: { id: `ses_${userId}`, userId, activeOrganizationId: DEFAULT_ORGANIZATION_ID } };
                },
            },
        });
    }
}

const liveKernels: ObjectKernel[] = [];
const liveDrivers: SqliteWasmDriver[] = [];
afterEach(async () => {
    while (liveKernels.length) {
        const kernel = liveKernels.pop();
        await Promise.race([kernel?.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    }
    while (liveDrivers.length) {
        try { await liveDrivers.pop()?.disconnect(); } catch { /* already closed */ }
    }
});

/**
 * One kernel. `selfHosted` gives it the real Hono server, so plugin-audit
 * mounts the doors on it; without it the kernel has no `http.server`, the
 * hosted shape. `audit: false` leaves the `comments` slot empty.
 */
async function bootKernel(opts: { selfHosted: boolean; audit?: boolean }) {
    const kernel = new ObjectKernel({ logger: { level: 'silent' } } as any);
    liveKernels.push(kernel);
    await kernel.use(new ObjectQLPlugin());
    if (opts.selfHosted) await kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    await kernel.use(new TestAuth());
    if (opts.audit !== false) await kernel.use(new AuditPlugin());
    await kernel.bootstrap();

    const objectql = kernel.getService<ObjectQL>('objectql');
    const driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.connect();
    liveDrivers.push(driver);
    (objectql as any).registerDriver(driver, true);
    objectql.registry.registerObject(board as any, 'comment-doors-test', 'comment-doors-test');
    for (const o of identityObjects) objectql.registry.registerObject(o.def as never, o.owner);
    await (objectql as any).syncSchemas();
    await installDefaultOrganization(objectql as any);
    // Alice is a current member of the organization her session names.
    await objectql.insert('sys_user', { id: ALICE, email: `${ALICE}@acme.test` }, { context: SYSTEM } as any);
    await objectql.insert('sys_member', { user_id: ALICE, organization_id: DEFAULT_ORGANIZATION_ID, role: 'member' }, { context: SYSTEM } as any);

    /** A thread on a board, with one top-level comment Alice wrote and one reaction of hers on it. */
    const seed = async () => {
        const row: any = await objectql.insert(BOARD, { name: 'board' }, { context: SYSTEM } as any);
        const comment: any = await objectql.insert(
            COMMENT,
            { thread_id: `${BOARD}:${row.id}`, author_id: ALICE, body: 'hello' },
            { context: { ...SYSTEM, userId: ALICE } } as any,
        );
        const reaction: any = await objectql.insert(
            REACTION,
            { comment_id: String(comment.id), emoji: '👍', user_id: ALICE },
            { context: { ...SYSTEM, userId: ALICE } } as any,
        );
        return { commentId: String(comment.id), reactionId: String(reaction.id) };
    };
    const stored = (object: string, id: string) => objectql.findOne(object, { where: { id }, context: { ...SYSTEM } });
    return { kernel, seed, stored };
}

/** The hosted door: `createHonoApp` over a kernel with no `http.server`. */
async function hostedDoor(opts: { audit?: boolean } = {}) {
    const booted = await bootKernel({ selfHosted: false, audit: opts.audit });
    let server: unknown;
    try { server = booted.kernel.getService<unknown>('http.server'); } catch { server = undefined; }
    expect(server, 'the hosted shape owns no socket').toBeUndefined();
    const app = createHonoApp({ kernel: booted.kernel as any, prefix: PREFIX, cors: false });
    return { ...booted, send: (path: string, init?: RequestInit) => app.request(`http://tenant.example${path}`, init) };
}

/** The self-hosted door: plugin-audit's own mount on the kernel's `http.server`, over a real socket. */
async function selfHostedDoor() {
    const booted = await bootKernel({ selfHosted: true });
    const server = booted.kernel.getService<IHttpServer>('http.server');
    const base = `http://127.0.0.1:${server.getPort!()}`;
    return { ...booted, send: (path: string, init?: RequestInit) => fetch(`${base}${path}`, init) };
}

const as = (userId: string | undefined, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { 'content-type': 'application/json', ...(userId ? { [SIGNED_IN_AS]: userId } : {}) },
});

/** Headers a transport adds or drops on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'content-encoding', 'vary']);
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
        body: await res.text(),
    };
}

describe('[#36469] the comment doors answer on the hosted shape (createHonoApp, no http.server, real AuditPlugin)', () => {
    it('no door answers a route miss (ROUTE_NOT_FOUND or ENDPOINT_NOT_FOUND) any more', async () => {
        const door = await hostedDoor();
        const { commentId, reactionId } = await door.seed();
        const requests: Array<[string, RequestInit]> = [
            [`${PREFIX}/comments/reactions/${reactionId}`, as(ALICE, { method: 'DELETE' })],
            [`${PREFIX}/comments/${commentId}/resolution`, as(ALICE, { method: 'PUT', body: JSON.stringify({ resolved: true }) })],
            [`${PREFIX}/comments/${commentId}`, as(undefined, { method: 'DELETE' })],
        ];
        for (const [path, init] of requests) {
            const res = await door.send(path, init);
            const body = await res.text();
            expect(body, `${init.method} ${path}`).not.toContain('ROUTE_NOT_FOUND');
            expect(body, `${init.method} ${path}`).not.toContain('ENDPOINT_NOT_FOUND');
            expect(res.status, `${init.method} ${path}: ${body}`).not.toBe(404);
        }
    });

    it('a member removes their own reaction: 200, and the row is gone', async () => {
        const door = await hostedDoor();
        const { reactionId } = await door.seed();

        const res = await door.send(`${PREFIX}/comments/reactions/${reactionId}`, as(ALICE, { method: 'DELETE' }));

        expect(res.status, await res.clone().text()).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { id: reactionId, deleted: true } });
        expect(await door.stored(REACTION, reactionId)).toBeNull();
    });

    it('a member resolves and reopens a thread: 200 each, and the stored flag follows', async () => {
        const door = await hostedDoor();
        const { commentId } = await door.seed();
        const path = `${PREFIX}/comments/${commentId}/resolution`;

        const resolved = await door.send(path, as(ALICE, { method: 'PUT', body: JSON.stringify({ resolved: true }) }));
        expect(resolved.status, await resolved.clone().text()).toBe(200);
        expect(((await resolved.json()) as { data: unknown }).data).toMatchObject({ id: commentId, is_resolved: true, resolved_by: ALICE });
        expect((await door.stored(COMMENT, commentId) as any)?.is_resolved).toBeTruthy();

        const reopened = await door.send(path, as(ALICE, { method: 'PUT', body: JSON.stringify({ resolved: false }) }));
        expect(reopened.status, await reopened.clone().text()).toBe(200);
        expect(((await reopened.json()) as { data: unknown }).data).toMatchObject({ id: commentId, is_resolved: false });
        expect((await door.stored(COMMENT, commentId) as any)?.is_resolved).toBeFalsy();
    });

    it('a member removes their own comment: 200, and the row is gone', async () => {
        const door = await hostedDoor();
        const { commentId, reactionId } = await door.seed();
        // The comment's own reaction first, so nothing hangs under it but what the door reads.
        await door.send(`${PREFIX}/comments/reactions/${reactionId}`, as(ALICE, { method: 'DELETE' }));

        const res = await door.send(`${PREFIX}/comments/${commentId}`, as(ALICE, { method: 'DELETE' }));

        expect(res.status, await res.clone().text()).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { id: commentId, deleted: true } });
        expect(await door.stored(COMMENT, commentId)).toBeNull();
    });
});

describe('[#36469] both doors answer the same request with the same bytes', () => {
    it('the anonymous refusal and the refused body are byte-identical at the mount and at the hosted door', async () => {
        const hosted = await hostedDoor();
        const selfHosted = await selfHostedDoor();
        const cases: Array<[label: string, path: string, init: RequestInit]> = [
            ['anonymous unreact', `${PREFIX}/comments/reactions/rx_missing`, as(undefined, { method: 'DELETE' })],
            ['anonymous resolve', `${PREFIX}/comments/c_missing/resolution`, as(undefined, { method: 'PUT', body: '{"resolved":true}' })],
            ['anonymous own delete', `${PREFIX}/comments/c_missing`, as(undefined, { method: 'DELETE' })],
            ['a body that is not JSON', `${PREFIX}/comments/c_missing/resolution`, as(ALICE, { method: 'PUT', body: '{resolved:' })],
            ['a body that is not exactly { resolved }', `${PREFIX}/comments/c_missing/resolution`, as(ALICE, { method: 'PUT', body: '{"resolved":"yes"}' })],
        ];
        for (const [label, path, init] of cases) {
            const viaHosted = await snapshot(await hosted.send(path, init));
            const viaMount = await snapshot(await selfHosted.send(path, init));
            expect(viaHosted.status, label).not.toBe(404);
            expect(viaHosted, label).toEqual(viaMount);
        }
    });
});

describe('[#36469] a hosted kernel without plugin-audit answers a typed 501, never a route miss', () => {
    it('each door: 501 NOT_IMPLEMENTED naming the plugin', async () => {
        const door = await hostedDoor({ audit: false });
        const requests: Array<[string, RequestInit]> = [
            [`${PREFIX}/comments/reactions/rx_1`, as(ALICE, { method: 'DELETE' })],
            [`${PREFIX}/comments/c_1/resolution`, as(ALICE, { method: 'PUT', body: '{"resolved":true}' })],
            [`${PREFIX}/comments/c_1`, as(ALICE, { method: 'DELETE' })],
        ];
        for (const [path, init] of requests) {
            const res = await door.send(path, init);
            const body = await res.json() as any;
            expect(res.status, `${init.method} ${path}`).toBe(501);
            expect(body.error.code).toBe('NOT_IMPLEMENTED');
            expect(body.error.message).toContain('@objectstack/plugin-audit');
        }
    });
});

/**
 * [#36469] The `objectstack serve` / `objectstack dev` host shape: the HOST
 * kernel has `HonoServerPlugin` and `DispatcherPlugin` but NO `createHonoApp`
 * catch-all, and a `kernel-resolver` places each request on a per-environment
 * kernel that runs the real AuditPlugin with no `http.server` (cloud's local
 * rig runs this way, `apps/objectos` under `objectstack dev`). Before
 * `DispatcherPlugin`'s fallback handed the door shapes on, every request below
 * answered the transport's own `404 ENDPOINT_NOT_FOUND`: the card's literal
 * hosted reading.
 */
async function serveShapedHost() {
    const tenant = await hostedDoor();
    // A host kernel with no data engine of its own, as the runtime's
    // multi-tenant fallback tests compose one: the doors' data is the tenant's.
    const host = new LiteKernel({ logger: { level: 'silent' } } as any);
    liveKernels.push(host as unknown as ObjectKernel);
    await host.use(new HonoServerPlugin({ port: 0, cors: false }));
    await host.use(new TestAuth());
    await host.use({
        name: 'test.comment-doors-kernel-resolver',
        version: '1.0.0',
        type: 'standard',
        init: async (ctx: PluginContext) => {
            ctx.registerService('kernel-resolver', {
                resolveKernel: async (context: any) => {
                    const headers = context?.request?.headers;
                    const envId = typeof headers?.get === 'function' ? headers.get(ENVIRONMENT) : headers?.[ENVIRONMENT];
                    if (envId !== TENANT_ENV) return undefined;
                    context.environmentId = TENANT_ENV;
                    return tenant.kernel;
                },
            });
        },
    } as Plugin);
    await host.use(createDispatcherPlugin({ prefix: PREFIX, securityHeaders: false }) as any);
    await host.bootstrap();
    const base = `http://127.0.0.1:${host.getService<IHttpServer>('http.server').getPort!()}`;
    const send = (path: string, init: RequestInit = {}) =>
        fetch(`${base}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), [ENVIRONMENT]: TENANT_ENV } });
    return { ...tenant, send };
}

const ENVIRONMENT = 'x-environment-id';
const TENANT_ENV = 'env_tenant';

describe('[#36469] the comment doors answer on an `objectstack serve`-shaped multi-tenant host (no catch-all)', () => {
    it('a member removes their own reaction: 200, and the row is gone on the tenant', async () => {
        const door = await serveShapedHost();
        const { reactionId } = await door.seed();

        const res = await door.send(`${PREFIX}/comments/reactions/${reactionId}`, as(ALICE, { method: 'DELETE' }));

        expect(await res.clone().text()).not.toContain('ENDPOINT_NOT_FOUND');
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { id: reactionId, deleted: true } });
        expect(await door.stored(REACTION, reactionId)).toBeNull();
    });

    it('a member resolves and reopens a thread, then removes their own comment', async () => {
        const door = await serveShapedHost();
        const { commentId, reactionId } = await door.seed();
        const resolution = `${PREFIX}/comments/${commentId}/resolution`;

        const resolved = await door.send(resolution, as(ALICE, { method: 'PUT', body: JSON.stringify({ resolved: true }) }));
        expect(resolved.status, await resolved.clone().text()).toBe(200);
        expect((await door.stored(COMMENT, commentId) as any)?.is_resolved).toBeTruthy();

        const reopened = await door.send(resolution, as(ALICE, { method: 'PUT', body: JSON.stringify({ resolved: false }) }));
        expect(reopened.status, await reopened.clone().text()).toBe(200);
        expect((await door.stored(COMMENT, commentId) as any)?.is_resolved).toBeFalsy();

        await door.send(`${PREFIX}/comments/reactions/${reactionId}`, as(ALICE, { method: 'DELETE' }));
        const removed = await door.send(`${PREFIX}/comments/${commentId}`, as(ALICE, { method: 'DELETE' }));
        expect(removed.status, await removed.clone().text()).toBe(200);
        expect(await door.stored(COMMENT, commentId)).toBeNull();
    });

    it('the anonymous refusal and the refused body are byte-identical to the self-hosted mount', async () => {
        const host = await serveShapedHost();
        const selfHosted = await selfHostedDoor();
        const cases: Array<[label: string, path: string, init: RequestInit]> = [
            ['anonymous unreact', `${PREFIX}/comments/reactions/rx_missing`, as(undefined, { method: 'DELETE' })],
            ['a body that is not JSON', `${PREFIX}/comments/c_missing/resolution`, as(ALICE, { method: 'PUT', body: '{resolved:' })],
            ['a body that is not exactly { resolved }', `${PREFIX}/comments/c_missing/resolution`, as(ALICE, { method: 'PUT', body: '{"resolved":"yes"}' })],
        ];
        for (const [label, path, init] of cases) {
            const viaHost = await snapshot(await host.send(path, init));
            const viaMount = await snapshot(await selfHosted.send(path, init));
            expect(viaHost.status, label).not.toBe(404);
            expect(viaHost, label).toEqual(viaMount);
        }
    });
});
