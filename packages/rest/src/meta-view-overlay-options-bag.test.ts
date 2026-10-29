// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #25923 — a flat list overlay's `options` bag is refused by name at
 * `PUT /api/v1/meta/view/:name`, the door a Studio tenant or an MCP/AI author
 * writes through, on the real composition: the real `RestServer` route over
 * the real `saveMetaItem`, backed by a real `ObjectQL` + SQLite `sys_metadata`.
 *
 * From #20051 until #25923 the door judged the bag key by key and stored a
 * legal one as sent (`options.map` answered `200`). The bag is retired: each
 * per-kind block is a top-level key of the view, and a stored bag is folded
 * onto it on read (`list-view-options-bag-folded`, pinned in
 * `@objectstack/metadata-protocol`).
 *
 * Refusal cases assert the ADR-0112 envelope — `code` AND `status` — and that
 * no row reached `sys_metadata`: the pair separates "refused by the door" from
 * a failure somewhere downstream, and the empty store separates "refused" from
 * "refused after writing".
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import {
    SysMetadata,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/platform-objects/metadata';
import { RestServer } from './rest-server.js';

const META_ITEM = '/api/v1/meta/:type/:name';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

function createMockServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => {}, close: async () => {},
    };
}

function makeRes() {
    const res: any = {
        _status: 200,
        write: () => true, end: () => {}, send: () => res, setHeader: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

async function boot() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registerApp({
        id: 'com.objectstack.metadata-objects',
        name: 'Metadata Platform Objects',
        version: '1.0.0',
        type: 'plugin',
        scope: 'system',
        objects: [SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject],
    });
    // [#24668] The object the fixture view binds to: the overlay save door
    // refuses a list view bound to an object that exists nowhere, and nothing
    // here declared `showcase_task`.
    engine.registry.registerObject({
        name: 'showcase_task',
        label: 'Task',
        fields: {
            title: { name: 'title', label: 'Title', type: 'text' },
            location: { name: 'location', label: 'Location', type: 'text' },
        },
    } as any, 'objectstack-test');
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // The route demands `manage_metadata`; the caller holds it, so a refusal
    // here is the spec door's and nothing else's.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === META_ITEM);
    if (!route) throw new Error(`PUT ${META_ITEM} is not registered`);

    const put = async (name: string, body: unknown) => {
        const res = makeRes();
        await route.handler({ params: { type: 'view', name }, query: {}, headers: {}, body } as any, res);
        return res;
    };
    const storedRows = async (name: string) => engine.find('sys_metadata', { where: { type: 'view', name } });
    return { put, storedRows };
}

type Issue = { path?: string; code?: string; message?: string };
const issuesOf = (res: any): Issue[] => (res._json?.issues ?? []) as Issue[];

const MAP_VIEW = {
    name: 'showcase_task.work_map',
    object: 'showcase_task',
    viewKind: 'list',
    label: 'Work Map',
    type: 'map',
    columns: ['title', 'location'],
};
const MAP = { locationField: 'location', titleField: 'title' };

describe('#25923 PUT /api/v1/meta/view refuses a flat list overlay\'s `options` bag', () => {
    it('a legal legacy `options.map` bag answers 422 at `options`, naming the move, and nothing is stored', async () => {
        const { put, storedRows } = await boot();
        const res = await put('showcase_task.work_map', { ...MAP_VIEW, options: { map: MAP } });
        expect(res._status, JSON.stringify(res._json)).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect(await storedRows('showcase_task.work_map')).toEqual([]);
        const hit = issuesOf(res).find((i) => i.path === 'options');
        expect(hit, JSON.stringify(res._json)).toBeDefined();
        expect(hit!.message).toMatch(/^A list view's `options` bag was removed in @objectstack\/spec 18\.3\.0/);
        expect(hit!.message).toContain('Move each `options.KIND` block to `KIND`');
    });

    it('CONTROL: the same block written top-level answers 200, and the stored row carries it', async () => {
        const { put, storedRows } = await boot();
        const res = await put('showcase_task.work_map', { ...MAP_VIEW, map: MAP });
        expect(res._status, JSON.stringify(res._json)).toBe(200);
        const rows = await storedRows('showcase_task.work_map');
        expect(rows).toHaveLength(1);
        const stored = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
        expect(stored.map).toEqual(MAP);
        expect('options' in stored).toBe(false);
    });
});
