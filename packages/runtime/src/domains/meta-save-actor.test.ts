// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23086] The runtime dispatcher's `PUT /meta/:type/:name` records the user
 * who saved, or nobody — the same answer as `RestServer`'s twin.
 *
 * ## What was wrong
 *
 * The branch called `protocol.saveMetaItem` with no `actor`, although the
 * execution context it had just admitted carried the caller's `userId`. So
 * on a host that serves `/meta` through `@objectstack/hono`'s catch-all, a
 * signed-in author's save recorded `null` in `sys_metadata.updated_by` /
 * `created_by` and in `sys_metadata_history.recorded_by`. `RestServer`'s
 * `PUT` door records the user id through `resolveMetaWriteActor`. The branch
 * now passes `executionContext.userId` when there is one and nothing
 * otherwise, the reading its own `_migrate-stored` branch already uses.
 *
 * ## The rig
 *
 * One REAL store per door — better-sqlite3 `:memory:`, the real
 * `sys_metadata*` objects, a real `ObjectStackProtocolImplementation` — so the
 * claim is about the rows: the actor columns are read back from the store
 * after every save. The dispatcher is driven through `dispatch()` with a real
 * Fetch `Request`, with the identity step as the one stubbed seam (the
 * sibling `meta-save-preconditions-parity.test.ts` drives it the same way).
 * An anonymous caller never reaches the save (the anonymous deny answers
 * first), so "nobody" is an `isSystem` caller with no user.
 *
 * The CONTROL is `RestServer`'s twin over the same rig: it recorded the user
 * before this change and still does.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const META = `${PREFIX}/meta`;
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';

interface Caller { userId?: string; isSystem: boolean; systemPermissions?: string[] }
/** Authors: `manage_metadata` saves, on both doors. */
const author = (userId: string): Caller => ({ userId, isSystem: false, systemPermissions: ['manage_metadata'] });
/** Engine self-invocation: admitted by `isSystem`, with no user to record. */
const SYSTEM: Caller = { isSystem: true };

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const view = (name: string, label: string) => ({
    name,
    label,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
});

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** What the store recorded as the writer of a view, read off the rows themselves. */
interface Recorded { created_by: unknown; updated_by: unknown; recorded_by: unknown[] }

async function bootStore() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const recorded = async (name: string): Promise<Recorded> => {
        const rows = await engine.find('sys_metadata', { where: { type: 'view', name } });
        expect(rows ?? [], `one sys_metadata row for ${name}`).toHaveLength(1);
        const history = await engine.find('sys_metadata_history', {
            where: { type: 'view', name },
            orderBy: [{ field: 'version', order: 'asc' }],
        } as any);
        return {
            created_by: (rows as any[])[0].created_by ?? null,
            updated_by: (rows as any[])[0].updated_by ?? null,
            recorded_by: (history ?? []).map((h: any) => h.recorded_by ?? null),
        };
    };
    return { protocol, recorded };
}

interface Door {
    save(caller: Caller, name: string, label: string): Promise<number>;
    recorded(name: string): Promise<Recorded>;
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined, headers: {} as Record<string, string> };
    res.status = (code: number) => { res.statusCode = code; return res; };
    res.json = (body: any) => { res.body = body; return res; };
    res.send = () => res;
    res.end = () => res;
    res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
    res.setHeader = () => {};
    res.write = () => true;
    return res;
}

/** The runtime dispatcher, reached the way `@objectstack/hono`'s catch-all reaches it. */
async function bootDispatcher(): Promise<Door> {
    const { protocol, recorded } = await bootStore();
    const get = (n: string) => (n === 'protocol' ? protocol : null);
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    return {
        recorded,
        save: async (caller, name, label) => {
            (dispatcher as any).timedResolveExecutionContext = async () => clone(caller);
            const body = view(name, label);
            const request = new Request(`http://localhost${META}/view/${name}`, {
                method: 'PUT',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
            const res = await dispatcher.dispatch('PUT', `/meta/view/${name}`, body, {}, { request }, PREFIX);
            return res.response?.status ?? 0;
        },
    };
}

/** CONTROL: `RestServer`'s `PUT` twin, attributing through `resolveMetaWriteActor`. */
async function bootRestServer(): Promise<Door> {
    const { protocol, recorded } = await bootStore();
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === `${META}/:type/:name`);
    if (!route) throw new Error(`PUT ${META}/:type/:name is not registered`);
    return {
        recorded,
        save: async (caller, name, label) => {
            rest.resolveExecCtx = async () => clone(caller);
            const res = makeRes();
            await route.handler({
                method: 'PUT', path: `${META}/view/${name}`, params: { type: 'view', name },
                headers: {}, query: {}, body: view(name, label),
            }, res);
            return res.statusCode;
        },
    };
}

const DOORS: ReadonlyArray<readonly [string, () => Promise<Door>]> = [
    ['the runtime dispatcher', bootDispatcher],
    ['CONTROL: RestServer', bootRestServer],
];

for (const [doorName, boot] of DOORS) {
    describe(`[#23086] ${doorName}: PUT /meta/:type/:name records the user who saved, or null`, () => {
        it('a signed-in save records the user id; a later save by another user records that user', async () => {
            const door = await boot();
            expect(await door.save(author('u_author'), 'case_grid', 'v1')).toBe(200);
            expect(await door.recorded('case_grid')).toEqual({
                created_by: 'u_author', updated_by: 'u_author', recorded_by: ['u_author'],
            });

            expect(await door.save(author('u_editor'), 'case_grid', 'v2')).toBe(200);
            expect(await door.recorded('case_grid')).toEqual({
                created_by: 'u_author', updated_by: 'u_editor', recorded_by: ['u_author', 'u_editor'],
            });
        }, 60_000);

        it('an isSystem save with no user records null, never a label', async () => {
            const door = await boot();
            expect(await door.save(SYSTEM, 'sys_grid', 'v1')).toBe(200);
            expect(await door.recorded('sys_grid')).toEqual({
                created_by: null, updated_by: null, recorded_by: [null],
            });
        }, 60_000);
    });
}
