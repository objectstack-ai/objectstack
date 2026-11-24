// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] The personal-view and attachment doors on the hosted shape:
 * `createHonoApp` over a kernel with NO `http.server` (a hosted tenant kernel
 * owns no socket), the REAL `AuthPlugin` composed with
 * `registerRoutes: false` (the per-environment kernel's shape), the REAL
 * `StorageServicePlugin`, the real security and sharing plugins, over a real
 * store. Every credential is a real better-auth session, signed in through the
 * same transport.
 *
 * Before the `/personal-views` and `/attachments` dispatcher domains existed,
 * every request below answered the dispatcher's `404 ROUTE_NOT_FOUND` on this
 * shape: the doors were mounted only on the kernel's own `http.server`, which
 * this kernel does not have, and the catch-all's `dispatch()` had no domain for
 * them. The first pin asserts no door answers a route miss any more.
 *
 * What this pins:
 *  1. on the hosted shape, a member removes their own personal view, and
 *     renames then removes their own attachment, each answered by the door
 *     with 200 and each landing in the store; another member and an anonymous
 *     caller are refused by the door's own rule, and the row stays;
 *  2. the two doors answer the same refusals with the same bytes, because the
 *     member runs the very registration the self-hosted mount runs;
 *  3. a hosted kernel without `@objectstack/service-storage` answers the
 *     attachment doors with a typed `501 NOT_IMPLEMENTED`, never a route miss.
 *
 * The domains' own claim, gates and faults are pinned on the real dispatcher
 * in `packages/runtime/src/domains/own-door-bridge.test.ts`.
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { AuthManager, AuthPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, appSecurityPluginOptions } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { StorageServicePlugin } from '@objectstack/service-storage';
import { AppPlugin, DefaultDatasourcePlugin } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';
import type { IHttpServer } from '@objectstack/spec/contracts';

const BOOT_TIMEOUT = 180_000;
const ORIGIN = 'http://localhost:3000';
const API = '/api/v1';
const SYS = { isSystem: true } as const;
const SECRET = 'own-row-doors-conformance-secret-0001';
const NOTE = 'ord_note';
const ALICE = { email: 'alice@own-row-doors.test', password: 'alice-own-row-doors-password-36506', name: 'Alice' };
const BOB = { email: 'bob@own-row-doors.test', password: 'bob-own-row-doors-password-36506', name: 'Bob' };

const APP: any = {
    manifest: { id: 'com.conformance.ownrowdoors', name: 'Own-row doors conformance', version: '1.0.0' },
    objects: [{ name: NOTE, label: 'Note', enable: { files: true }, fields: { title: { type: 'text', label: 'Title' } } }],
};

/** One booted composition and the requests it answers. */
interface Door {
    kernel: any;
    engine: any;
    /** One request at `path` (the full wire path), through this composition's door. */
    send: (path: string, init?: RequestInit) => Promise<Response>;
    aliceToken: string;
    bobToken: string;
    aliceId: string;
    bobId: string;
    rootDir: string;
}

/**
 * One kernel. `hosted` is the tenant kernel's shape: no `http.server`, auth
 * composed with `registerRoutes: false`, every request through
 * `createHonoApp`'s catch-all. Without `hosted`, the self-hosted shape: the
 * plugins mount their doors on the kernel's own server, over a real socket.
 * `storage: false` leaves the `file-attachments` slot empty.
 */
async function boot(opts: { hosted: boolean; storage?: boolean }): Promise<Door> {
    const rootDir = join(tmpdir(), `os-own-row-doors-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(rootDir, { recursive: true });

    const kernel: any = new ObjectKernel({ logger: { level: 'silent' } } as any);
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new DefaultDatasourcePlugin({ driver: 'sqlite-wasm', config: { filename: ':memory:' } }));
    if (!opts.hosted) await kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    await kernel.use(new AppPlugin(APP));
    await kernel.use(new PlatformObjectsPlugin());
    await kernel.use(new AuthPlugin({ secret: SECRET, ...(opts.hosted ? { registerRoutes: false } : {}) } as never));
    await kernel.use(new SecurityPlugin(appSecurityPluginOptions(APP)));
    await kernel.use(new SharingServicePlugin());
    if (opts.storage !== false) {
        await kernel.use(new StorageServicePlugin({ adapter: 'local', local: { rootDir }, bindToSettings: false }));
    }
    await kernel.bootstrap();

    let send: Door['send'];
    if (opts.hosted) {
        let server: unknown;
        try { server = kernel.getService('http.server'); } catch { server = undefined; }
        expect(server, 'the hosted shape owns no socket').toBeUndefined();
        const app = createHonoApp({ kernel, prefix: API, cors: false });
        send = async (path, init) => app.request(`${ORIGIN}${path}`, init);
    } else {
        const server = kernel.getService('http.server') as IHttpServer;
        const base = `http://127.0.0.1:${server.getPort!()}`;
        send = (path, init) => fetch(`${base}${path}`, init);
    }

    const engine = await kernel.getServiceAsync('objectql');
    const auth = await kernel.getServiceAsync('auth');
    const door: Door = { kernel, engine, send, aliceToken: '', bobToken: '', aliceId: '', bobId: '', rootDir };
    door.aliceToken = await provision(door, auth, ALICE);
    door.bobToken = await provision(door, auth, BOB);
    door.aliceId = await userIdOf(engine, ALICE.email);
    door.bobId = await userIdOf(engine, BOB.email);
    return door;
}

async function stop(door: Door | undefined): Promise<void> {
    if (!door) return;
    await Promise.race([door.kernel.shutdown(), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]);
    await fs.rm(door.rootDir, { recursive: true, force: true });
}

/** A member provisioned through the operator door, then signed in, both through the composition's own door. */
async function provision(door: Door, auth: any, who: { email: string; password: string; name: string }): Promise<string> {
    const ticket = auth.stageOperatorProvisioning(who.email);
    let signUp: Response;
    try {
        signUp = await door.send(`${API}/auth/sign-up/email`, {
            method: 'POST', headers: { 'Content-Type': 'application/json', origin: ORIGIN },
            body: JSON.stringify({ ...who, [AuthManager.OPERATOR_PROVISIONING_TICKET_FIELD]: ticket }),
        });
    } finally {
        auth.clearOperatorProvisioning(who.email);
    }
    expect(signUp.status, await signUp.clone().text()).toBe(200);
    const signIn = await door.send(`${API}/auth/sign-in/email`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', origin: ORIGIN },
        body: JSON.stringify({ email: who.email, password: who.password }),
    });
    expect(signIn.status, await signIn.clone().text()).toBe(200);
    return ((await signIn.json()) as { token: string }).token;
}

async function userIdOf(engine: any, email: string): Promise<string> {
    const row = await engine.findOne('sys_user', { where: { email }, context: SYS });
    expect(row?.id, `${email} provisioned`).toBeTruthy();
    return String(row.id);
}

const as = (token: string | undefined, init: RequestInit = {}): RequestInit => ({
    ...init,
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
});

/** The record a data-door answer carries, in either envelope spelling. */
const recordOf = (body: any) => body?.data?.record ?? body?.record ?? body?.data ?? body;

/** Save a personal view as Alice, through the data door. */
async function saveView(door: Door, label: string): Promise<string> {
    const res = await door.send(`${API}/data/sys_personal_view`, as(door.aliceToken, {
        method: 'POST',
        body: JSON.stringify({
            user_id: door.aliceId, object_name: NOTE, label,
            config: { type: 'grid', data: { provider: 'object', object: NOTE }, columns: ['title'] },
        }),
    }));
    expect(res.status, await res.clone().text()).toBe(201);
    const id = recordOf(await res.json())?.id;
    expect(id, 'the saved view carries an id').toBeTruthy();
    return String(id);
}

/** An attachment Alice uploaded, on a note of hers: the file row as a committed upload leaves it, attached through the data door. */
async function attachAsAlice(door: Door, tag: string): Promise<string> {
    const note = await door.send(`${API}/data/${NOTE}`, as(door.aliceToken, { method: 'POST', body: JSON.stringify({ title: `note ${tag}` }) }));
    expect(note.status, await note.clone().text()).toBe(201);
    const noteRow = recordOf(await note.json());
    const fileId = `f_${tag}`;
    await door.engine.insert('sys_file', {
        id: fileId, key: `attachments/${fileId}.txt`, name: `${fileId}.txt`, scope: 'attachments',
        status: 'committed', owner_id: door.aliceId, organization_id: noteRow.organization_id,
    }, { context: SYS });
    const res = await door.send(`${API}/data/sys_attachment`, as(door.aliceToken, {
        method: 'POST',
        body: JSON.stringify({ parent_object: NOTE, parent_id: String(noteRow.id), file_id: fileId, file_name: `${fileId}.txt` }),
    }));
    expect(res.status, await res.clone().text()).toBe(201);
    const id = recordOf(await res.json())?.id;
    expect(id, 'the attachment carries an id').toBeTruthy();
    return String(id);
}

const stored = (door: Door, object: string, id: string) => door.engine.findOne(object, { where: { id }, context: SYS });

/** Headers a transport adds or drops on its own, independent of the route. */
const TRANSPORT_HEADERS = new Set(['date', 'connection', 'keep-alive', 'content-length', 'transfer-encoding', 'content-encoding', 'vary']);
async function snapshot(res: Response) {
    return {
        status: res.status,
        headers: [...res.headers.entries()].filter(([k]) => !TRANSPORT_HEADERS.has(k)),
        body: await res.text(),
    };
}

describe('[#36506] the personal-view and attachment doors answer on the hosted shape (createHonoApp, no http.server, AuthPlugin registerRoutes: false)', () => {
    let door: Door;
    beforeAll(async () => { door = await boot({ hosted: true }); }, BOOT_TIMEOUT);
    afterAll(async () => { await stop(door); });

    it('no door answers a route miss (ROUTE_NOT_FOUND or ENDPOINT_NOT_FOUND) any more', async () => {
        const requests: Array<[string, RequestInit]> = [
            [`${API}/personal-views/pv_missing`, as(undefined, { method: 'DELETE' })],
            [`${API}/attachments/att_missing`, as(undefined, { method: 'DELETE' })],
            [`${API}/attachments/att_missing`, as(undefined, { method: 'PATCH', body: JSON.stringify({ file_name: 'x.txt' }) })],
        ];
        for (const [path, init] of requests) {
            const res = await door.send(path, init);
            const body = await res.text();
            expect(body, `${init.method} ${path}`).not.toContain('ROUTE_NOT_FOUND');
            expect(body, `${init.method} ${path}`).not.toContain('ENDPOINT_NOT_FOUND');
            expect(res.status, `${init.method} ${path}: ${body}`).toBe(401);
        }
    });

    it('the owner removes their own personal view: 200 { id, deleted: true }, and the row is gone', async () => {
        const id = await saveView(door, 'Alice: removed on the hosted shape');

        const res = await door.send(`${API}/personal-views/${id}`, as(door.aliceToken, { method: 'DELETE' }));

        expect(res.status, await res.clone().text()).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { id, deleted: true } });
        expect(await stored(door, 'sys_personal_view', id)).toBeFalsy();
    });

    it('another member is answered 404 RECORD_NOT_FOUND for a view that is not theirs, anonymous 401, and the row stays', async () => {
        const id = await saveView(door, 'Alice: kept on the hosted shape');

        const bob = await door.send(`${API}/personal-views/${id}`, as(door.bobToken, { method: 'DELETE' }));
        expect(bob.status, await bob.clone().text()).toBe(404);
        expect(((await bob.json()) as any).error.code).toBe('RECORD_NOT_FOUND');

        const anonymous = await door.send(`${API}/personal-views/${id}`, as(undefined, { method: 'DELETE' }));
        expect(anonymous.status).toBe(401);
        expect(((await anonymous.json()) as any).error.code).toBe('UNAUTHENTICATED');

        expect(await stored(door, 'sys_personal_view', id)).toMatchObject({ id, user_id: door.aliceId });
    });

    it('the uploader renames, then removes, their own attachment: 200 each, and the store follows', async () => {
        const id = await attachAsAlice(door, 'renamed_then_removed');

        const renamed = await door.send(`${API}/attachments/${id}`, as(door.aliceToken, { method: 'PATCH', body: JSON.stringify({ file_name: ' hosted-name.txt ' }) }));
        expect(renamed.status, await renamed.clone().text()).toBe(200);
        expect(await renamed.json()).toEqual({ success: true, data: { id, file_name: 'hosted-name.txt' } });
        expect((await stored(door, 'sys_attachment', id))?.file_name).toBe('hosted-name.txt');

        const removed = await door.send(`${API}/attachments/${id}`, as(door.aliceToken, { method: 'DELETE' }));
        expect(removed.status, await removed.clone().text()).toBe(200);
        expect(await removed.json()).toEqual({ success: true, data: { id, deleted: true } });
        expect(await stored(door, 'sys_attachment', id)).toBeFalsy();
    });

    it('anonymous is answered 401 on both attachment doors, and the row stays', async () => {
        const id = await attachAsAlice(door, 'kept_anonymous');

        for (const init of [as(undefined, { method: 'DELETE' }), as(undefined, { method: 'PATCH', body: JSON.stringify({ file_name: 'x.txt' }) })]) {
            const res = await door.send(`${API}/attachments/${id}`, init);
            expect(res.status, `${init.method}`).toBe(401);
            expect(((await res.json()) as any).error.code).toBe('UNAUTHENTICATED');
        }
        expect(await stored(door, 'sys_attachment', id)).toMatchObject({ id, file_name: `f_kept_anonymous.txt` });
    });
});

describe('[#36506] both doors answer the same refusal with the same bytes', () => {
    let hosted: Door;
    let selfHosted: Door;
    beforeAll(async () => {
        hosted = await boot({ hosted: true });
        selfHosted = await boot({ hosted: false });
    }, BOOT_TIMEOUT);
    afterAll(async () => { await stop(hosted); await stop(selfHosted); });

    it('the anonymous refusals and a refused rename body are byte-identical at the mount and at the hosted door', async () => {
        const cases: Array<[label: string, path: string, init: (d: Door) => RequestInit]> = [
            ['anonymous personal-view delete', `${API}/personal-views/pv_missing`, () => as(undefined, { method: 'DELETE' })],
            ['anonymous attachment delete', `${API}/attachments/att_missing`, () => as(undefined, { method: 'DELETE' })],
            ['anonymous attachment rename', `${API}/attachments/att_missing`, () => as(undefined, { method: 'PATCH', body: '{"file_name":"x.txt"}' })],
            ['a rename body that is not JSON', `${API}/attachments/att_missing`, (d) => as(d.aliceToken, { method: 'PATCH', body: '{file_name:' })],
        ];
        for (const [label, path, init] of cases) {
            const viaHosted = await snapshot(await hosted.send(path, init(hosted)));
            const viaMount = await snapshot(await selfHosted.send(path, init(selfHosted)));
            expect(viaHosted.status, label).not.toBe(404);
            expect(viaHosted, label).toEqual(viaMount);
        }
    });
});

describe('[#36506] a hosted kernel without @objectstack/service-storage answers a typed 501, never a route miss', () => {
    let door: Door;
    beforeAll(async () => { door = await boot({ hosted: true, storage: false }); }, BOOT_TIMEOUT);
    afterAll(async () => { await stop(door); });

    it('each attachment door: 501 NOT_IMPLEMENTED naming the package', async () => {
        for (const init of [as(door.aliceToken, { method: 'DELETE' }), as(door.aliceToken, { method: 'PATCH', body: '{"file_name":"x.txt"}' })]) {
            const res = await door.send(`${API}/attachments/att_1`, init);
            const body = (await res.json()) as any;
            expect(res.status, `${init.method}`).toBe(501);
            expect(body.error.code).toBe('NOT_IMPLEMENTED');
            expect(body.error.message).toContain('@objectstack/service-storage');
        }
    });
});
