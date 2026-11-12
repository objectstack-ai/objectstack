// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `PUT /api/v1/meta/page/:name` — the door a Studio tenant or an MCP/AI author
 * writes through — refuses a `kind: 'full'` record page that places no
 * component, on the real composition: the real `RestServer` route over the
 * real `saveMetaItem`, backed by a real `ObjectQL` + SQLite `sys_metadata`.
 *
 * Before the change such a page saved `200` and was served with
 * `_diagnostics.valid: true`, and the console opened every record of its
 * object on a blank detail panel: a `full` record page draws only the
 * components its regions place. The parse refuses it now
 * (`checkPageRecordPlacesComponent`, `@objectstack/spec/ui`).
 *
 * Refusal cases assert the ADR-0112 envelope — `code` AND `status` — and that
 * no row reached `sys_metadata`. The controls keep the narrowing as narrow as
 * the rule: a record page with one component, a `slotted` record page and a
 * `home` page with no regions all save. The last case measures the READ side
 * on a row stored before the narrowing: served as stored, flagged in its
 * `_diagnostics`, and refused on its next save.
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
    // The object the fixture record pages bind to.
    engine.registry.registerObject({
        name: 'leave_request',
        label: 'Leave Request',
        fields: {
            reason: { name: 'reason', label: 'Reason', type: 'text' },
        },
    } as any, 'objectstack-test');
    await engine.syncSchemas();

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // The route demands `manage_metadata`; the caller holds it, so a refusal
    // here is the spec door's and nothing else's.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_author', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const routeFor = (method: string) => {
        const route = rest.getRoutes().find((r: any) => r.method === method && r.path === META_ITEM);
        if (!route) throw new Error(`${method} ${META_ITEM} is not registered`);
        return route;
    };
    const call = async (method: string, name: string, body?: unknown) => {
        const res = makeRes();
        await routeFor(method).handler({ params: { type: 'page', name }, query: {}, headers: {}, body } as any, res);
        return res;
    };
    const storedRows = async (name: string) => engine.find('sys_metadata', { where: { type: 'page', name } });
    return { engine, put: (name: string, body: unknown) => call('PUT', name, body), get: (name: string) => call('GET', name), storedRows };
}

/** The card's page: a record page of `leave_request` with no `regions`. */
const EMPTY_RECORD_PAGE = {
    name: 'leave_request_record',
    label: 'Leave request',
    type: 'record',
    object: 'leave_request',
    template: 'default',
};
const PLACED = [{ name: 'main', components: [{ type: 'record:details' }] }];

type Issue = { path?: string; code?: string; message?: string };
const issuesOf = (res: any): Issue[] => (res._json?.issues ?? []) as Issue[];

const VERDICT =
    'This record page places no component in its `regions`, so every record of its object would open on a blank detail panel';

describe('PUT /api/v1/meta/page refuses a full record page that places no component', () => {
    it.each([
        ['no `regions` (the card\'s page)', EMPTY_RECORD_PAGE],
        ['regions whose `components` are all empty', { ...EMPTY_RECORD_PAGE, regions: [{ name: 'main', components: [] }] }],
    ])('%s: 422 INVALID_METADATA at `regions`, and nothing is stored', async (_label, body) => {
        const { put, storedRows } = await boot();
        const res = await put('leave_request_record', body);

        expect(res._status, JSON.stringify(res._json)).toBe(422);
        expect(res._json?.code).toBe('INVALID_METADATA');
        expect(await storedRows('leave_request_record')).toEqual([]);
        const hit = issuesOf(res).find((i) => i.path === 'regions');
        expect(hit, JSON.stringify(res._json)).toBeDefined();
        expect(hit!.message!.startsWith(VERDICT)).toBe(true);
    });

    it('CONTROL — the same page placing one component answers 200 and is stored with it', async () => {
        const { put, storedRows } = await boot();
        const res = await put('leave_request_record', { ...EMPTY_RECORD_PAGE, regions: PLACED });

        expect(res._status, JSON.stringify(res._json)).toBe(200);
        const rows = await storedRows('leave_request_record');
        expect(rows).toHaveLength(1);
        const stored = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
        expect(stored.regions).toEqual(PLACED);
    });

    it('CONTROL — a `slotted` record page and a `home` page, neither with regions, answer 200', async () => {
        const { put } = await boot();
        const slotted = await put('leave_request_record', { ...EMPTY_RECORD_PAGE, kind: 'slotted' });
        expect(slotted._status, JSON.stringify(slotted._json)).toBe(200);
        const home = await put('leave_home', { name: 'leave_home', label: 'Leave', type: 'home' });
        expect(home._status, JSON.stringify(home._json)).toBe(200);
    });

    it('a row stored before the narrowing is served as stored, flagged in `_diagnostics`, and refused on its next save', async () => {
        const { engine, put, get, storedRows } = await boot();
        // Store a valid record page through the door, then plant a copy of its
        // row whose body places nothing — the shape a row saved before this
        // change can carry. The door can no longer write it, so the store is
        // written directly.
        expect((await put('leave_request_record', { ...EMPTY_RECORD_PAGE, regions: PLACED }))._status).toBe(200);
        const [row] = await storedRows('leave_request_record');
        const { id: _id, ...rowData } = row;
        await engine.insert('sys_metadata', {
            ...rowData,
            name: 'leave_request_legacy',
            metadata: JSON.stringify({ ...EMPTY_RECORD_PAGE, name: 'leave_request_legacy' }),
        });

        const read = await get('leave_request_legacy');
        expect(read._status, JSON.stringify(read._json)).toBe(200);
        const served = read._json?.item ?? read._json?.data ?? read._json;
        expect(served.type).toBe('record');
        expect(served.object).toBe('leave_request');
        expect(served._diagnostics?.valid, JSON.stringify(served._diagnostics)).toBe(false);
        expect(
            (served._diagnostics?.errors ?? []).map((e: Issue) => e.path),
            JSON.stringify(served._diagnostics),
        ).toContain('regions');

        const resave = await put('leave_request_legacy', { ...EMPTY_RECORD_PAGE, name: 'leave_request_legacy' });
        expect(resave._status, JSON.stringify(resave._json)).toBe(422);
        expect(resave._json?.code).toBe('INVALID_METADATA');
    });
});
