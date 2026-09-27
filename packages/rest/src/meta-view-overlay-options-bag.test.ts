// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #20051 — a flat list overlay's legacy `options` bag is judged at
 * `PUT /api/v1/meta/view/:name`, the door a Studio tenant or an MCP/AI author
 * writes through, on the real composition: the real `RestServer` route over
 * the real `saveMetaItem`, backed by a real `ObjectQL` + SQLite `sys_metadata`.
 *
 * Before the change (measured on `origin/main` @ `8d1f7ab`): the list overlay
 * member `.strip()`ped a top-level `options` from the parse without judging it,
 * so `options.timeline.metaFields` answered `200` and was stored as sent, while
 * the direct `timeline.metaFields` answered `422`.
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

const TIMELINE = { startDateField: 'created_at', titleField: 'name', metaFields: ['region'] };
const flatList = (extra: Record<string, unknown>) => ({
    name: 'crm_lead.timeline',
    object: 'crm_lead',
    viewKind: 'list',
    label: 'Timeline',
    type: 'timeline',
    columns: ['name'],
    ...extra,
});

type Issue = { path?: string; code?: string; message?: string };
const issuesOf = (res: any): Issue[] => (res._json?.issues ?? []) as Issue[];

describe('#20051 PUT /api/v1/meta/view judges a flat list overlay\'s `options` bag', () => {
    it('a direct and an `options`-wrapped out-of-contract key get the same 422, and nothing is stored', async () => {
        const { put, storedRows } = await boot();

        const direct = await put('crm_lead.timeline', flatList({ timeline: TIMELINE }));
        const wrapped = await put('crm_lead.timeline', flatList({ options: { timeline: TIMELINE } }));

        for (const res of [direct, wrapped]) {
            expect(res._status, JSON.stringify(res._json)).toBe(422);
            expect(res._json?.code).toBe('INVALID_METADATA');
        }
        expect(await storedRows('crm_lead.timeline')).toEqual([]);

        const directHit = issuesOf(direct).find((i) => i.path === 'timeline' && i.code === 'unrecognized_keys');
        const wrappedHit = issuesOf(wrapped).find((i) => i.path === 'options.timeline' && i.code === 'unrecognized_keys');
        expect(directHit, JSON.stringify(direct._json)).toBeDefined();
        expect(wrappedHit, JSON.stringify(wrapped._json)).toBeDefined();
        expect(wrappedHit!.message).toBe(directHit!.message);
        expect(wrappedHit!.message).toContain('`metaFields`');
    });

    it('a legal legacy `options.map` bag answers 200 and the stored row carries it unchanged', async () => {
        const { put, storedRows } = await boot();
        const options = { map: { locationField: 'location', titleField: 'legacy_title' } };
        const res = await put('showcase_task.work_map', {
            name: 'showcase_task.work_map',
            object: 'showcase_task',
            viewKind: 'list',
            label: 'Work Map',
            type: 'map',
            columns: ['title', 'location'],
            options,
        });
        expect(res._status, JSON.stringify(res._json)).toBe(200);
        const rows = await storedRows('showcase_task.work_map');
        expect(rows).toHaveLength(1);
        const stored = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
        expect(stored.options).toEqual(options);
    });
});
