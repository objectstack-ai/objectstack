// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24031] The API-exposure gate on the `/data` doors reads the ONE object it
// judges, by name, and never the whole object list.
//
// The defect: `enforceApiAccess` asked `getMetaItems({ type: 'object' })` and
// searched the answer for one name. The list read decorates every object it
// serves with a full schema diagnostic, so every authenticated `/data` request
// paid a diagnostic pass over the whole registry to read one object's
// `enable` block — measured at 62-72 % of a data request's time.
//
// What this file holds, over the REAL protocol (`ObjectStackProtocolImplementation`)
// over a REAL `SchemaRegistry`, unscoped and environment-scoped:
//
//  1. COST — a list, get, create, update and delete each make ZERO object-list
//     reads. `getMetaItems` (and `getMetaItemsForExecution`) are the only
//     faces into the protocol's list body, whose served face is where the
//     list-wide diagnostic (`decorateMetadataItems`) runs, so zero calls there
//     is zero diagnostic passes. They are counted on the instance, which also
//     catches the protocol's own internal `this.getMetaItems` calls.
//  2. ANSWERS — the same 404 / 405 as the list-backed gate gave, for a
//     code-registered object, a stored environment object and an object
//     another package extends (an extension carries no `enable` of its own:
//     `ObjectExtensionSchema` is strict and the registry's merge set is
//     closed, so the owner's `enable` is the one that counts); an unknown
//     object is still no policy, answered by the data path's own 404.
//  3. FAULTS — a THROWING by-name read fails OPEN and logs, as #3545 requires;
//     "no object" logs nothing.
//  4. FALLBACK — a protocol with no by-name read is asked the list, as before.
//  5. A DISABLED PACKAGE'S OBJECT — the one class whose answer moves: the list
//     omits it, the by-name read serves it, so a DENIED operation now answers
//     the exposure verdict instead of the data plane's 404
//     `OBJECT_PACKAGE_DISABLED`; an ALLOWED one still gets that 404.
//
// ⛔ The count rows are the regression this file exists for: put the list read
// back in `enforceApiAccess` and they go red while every answer row stays
// green — which is the point, because "still 405" is exactly what the slow
// gate looked like too.

import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Unrestricted — every door reaches its data call. */
const OPEN = { name: 'open_thing', label: 'Open Thing', fields: { title: { name: 'title', type: 'text' } } };
/** Code-registered, whitelisted to reads. */
const CODE = {
    name: 'code_widget', label: 'Code Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get', 'list'] },
};
/** Code-registered, hidden from the API. */
const HIDDEN = {
    name: 'code_hidden', label: 'Code Hidden',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiEnabled: false },
};
/** Owned by one package, extended by another; the owner restricts delete. */
const OWNER = {
    name: 'ext_account', label: 'Account',
    fields: { name: { name: 'name', type: 'text' } },
    enable: { apiMethods: ['get', 'list', 'update'] },
};
const EXTENSION = {
    name: 'ext_account',
    fields: { loyalty_tier: { name: 'loyalty_tier', type: 'text' } },
};
/** Stored in the environment (`sys_metadata`), registered by no package. */
const STORED = {
    name: 'stored_widget', label: 'Stored Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get'] },
};
const UNKNOWN = 'no_such_object';
/** Owned by a package the test DISABLES; whitelisted to reads. */
const OFF = {
    name: 'off_widget', label: 'Off Widget',
    fields: { title: { name: 'title', type: 'text' } },
    enable: { apiMethods: ['get', 'list'] },
};
const OFF_PACKAGE = 'pkg_off';

const DATA_METHODS = ['findData', 'getData', 'createData', 'updateData', 'deleteData'] as const;

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

interface Host {
    rest: RestServer;
    protocol: any;
    registry: SchemaRegistry;
    /** Object-list reads since the last `reset()`. */
    listReads: () => number;
    reset: () => void;
}

function host(opts: { environmentId?: string; withoutByName?: boolean } = {}): Host {
    const registry = new SchemaRegistry();
    registry.registerObject(clone(OPEN) as never, 'pkg_code', undefined, 'own');
    registry.registerObject(clone(CODE) as never, 'pkg_code', undefined, 'own');
    registry.registerObject(clone(HIDDEN) as never, 'pkg_code', undefined, 'own');
    registry.registerObject(clone(OWNER) as never, 'pkg_owner', undefined, 'own');
    registry.registerObject(clone(EXTENSION) as never, 'pkg_extender', undefined, 'extend', 210);
    registry.installPackage({ id: OFF_PACKAGE, name: OFF_PACKAGE, version: '1.0.0' } as never, 'code');
    registry.registerObject(clone(OFF) as never, OFF_PACKAGE, undefined, 'own');

    const rows = [{
        id: 'row_stored',
        type: 'object',
        name: STORED.name,
        state: 'active',
        organization_id: null,
        package_id: null,
        metadata: JSON.stringify(STORED),
    }];
    const matches = (r: Record<string, unknown>, w: Record<string, unknown>) =>
        Object.entries(w).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            return (r[k] ?? null) === (v ?? null);
        });
    const engine = {
        registry,
        find: async (table: string, q: { where: Record<string, unknown>; limit?: number }) => {
            const hits = table === 'sys_metadata' ? rows.filter((r) => matches(r, q.where)) : [];
            return typeof q?.limit === 'number' ? hits.slice(0, q.limit) : hits;
        },
        findOne: async (table: string, q: { where: Record<string, unknown> }) => {
            assertEngineFindOnePredicate(table, q as never);
            return table === 'sys_metadata' ? rows.find((r) => matches(r, q.where)) : undefined;
        },
    };

    const protocol: any = new ObjectStackProtocolImplementation(
        engine as never,
        () => new Map(),
        opts.environmentId,
    );

    let reads = 0;
    for (const face of ['getMetaItems', 'getMetaItemsForExecution'] as const) {
        const real = protocol[face].bind(protocol);
        protocol[face] = async (...a: unknown[]) => { reads += 1; return real(...a); };
    }
    if (opts.withoutByName) protocol.getMetaItem = undefined;

    // The data calls: stubbed for every object this host declares, so a door
    // the gate clears answers 200/201; the REAL call for an unknown object and
    // for the disabled package's object, so their answers are the data path's
    // own (the registry gate's 404s).
    for (const m of DATA_METHODS) {
        const real = protocol[m].bind(protocol);
        protocol[m] = vi.fn(async (req: any) => {
            if (req?.object === UNKNOWN || req?.object === OFF.name) return real(req);
            if (m === 'findData') return { object: req.object, records: [], total: 0 };
            if (m === 'deleteData') return { object: req.object, id: req.id, success: true };
            return { object: req.object, id: req.id ?? 'r1', record: { id: req.id ?? 'r1' } };
        });
    }

    const rest = new RestServer(createMockServer() as never, protocol as never, { api: { requireAuth: false } } as never);
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx =
        async () => ({ userId: 'test-user' });
    rest.registerRoutes();
    return { rest, protocol, registry, listReads: () => reads, reset: () => { reads = 0; } };
}

type Door = 'list' | 'get' | 'create' | 'update' | 'delete';
const DOORS: Record<Door, { method: string; path: string }> = {
    list: { method: 'GET', path: '/api/v1/data/:object' },
    get: { method: 'GET', path: '/api/v1/data/:object/:id' },
    create: { method: 'POST', path: '/api/v1/data/:object' },
    update: { method: 'PATCH', path: '/api/v1/data/:object/:id' },
    delete: { method: 'DELETE', path: '/api/v1/data/:object/:id' },
};

async function call(h: Host, door: Door, object: string): Promise<{ status: number; body: any }> {
    const { method, path } = DOORS[door];
    const route = (h.rest as any).getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`route not registered: ${method} ${path}`);
    let status = 200;
    let body: any;
    const res: any = {
        status: (c: number) => { status = c; return res; },
        json: (b: unknown) => { body = b; return res; },
        send: (b: unknown) => { body = b; return res; },
        header: () => res, setHeader: () => res, write: () => true, end: () => res,
    };
    const params: Record<string, string> = { object };
    if (door === 'get' || door === 'update' || door === 'delete') params.id = 'r1';
    const reqBody = door === 'create' || door === 'update' ? { title: 'x' } : {};
    await route.handler({ method, path, params, query: {}, headers: {}, body: reqBody }, res);
    return { status, body };
}

const errorCode = (body: any): unknown => body?.code ?? body?.error?.code;

// This file OBSERVES the REST fault log (the #3545 fail-open line, and its
// absence on a not-found), so it declares the level it observes under; the
// package harness runs silent (`vitest.config.ts`, `check:rest-log-spy-declared`).
beforeAll(() => { vi.stubEnv('OS_REST_LOG', 'info'); });
afterAll(() => { vi.unstubAllEnvs(); });
afterEach(() => { vi.restoreAllMocks(); });

for (const scope of [{ label: 'unscoped kernel', environmentId: undefined }, { label: 'environment-scoped kernel', environmentId: 'env_test' }]) {
    describe(`[#24031] the exposure gate reads one object by name — ${scope.label}`, () => {
        it.each(Object.keys(DOORS) as Door[])('a /data %s makes ZERO object-list reads (no list-wide diagnostic pass)', async (door) => {
            const h = host({ environmentId: scope.environmentId });
            h.reset();
            const out = await call(h, door, OPEN.name);
            expect(out.status, JSON.stringify(out.body)).toBeLessThan(300);
            expect(h.listReads()).toBe(0);
        });

        it('a refused request makes ZERO object-list reads too', async () => {
            const h = host({ environmentId: scope.environmentId });
            h.reset();
            const out = await call(h, 'create', CODE.name);
            expect(out.status).toBe(405);
            expect(h.listReads()).toBe(0);
        });

        it('asks the by-name read for exactly the object in the path', async () => {
            const h = host({ environmentId: scope.environmentId });
            const spy = vi.spyOn(h.protocol, 'getMetaItem');
            await call(h, 'list', CODE.name);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(spy.mock.calls[0]![0]).toEqual({ type: 'object', name: CODE.name });
        });

        it.each([
            ['code-registered, whitelisted', CODE.name, 'create', 405, 'OBJECT_API_METHOD_NOT_ALLOWED'],
            ['code-registered, whitelisted', CODE.name, 'list', 200, undefined],
            ['code-registered, hidden', HIDDEN.name, 'get', 404, 'OBJECT_API_DISABLED'],
            ['extended by another package', OWNER.name, 'delete', 405, 'OBJECT_API_METHOD_NOT_ALLOWED'],
            ['extended by another package', OWNER.name, 'update', 200, undefined],
            ['stored in the environment', STORED.name, 'list', 405, 'OBJECT_API_METHOD_NOT_ALLOWED'],
            ['stored in the environment', STORED.name, 'get', 200, undefined],
        ] as const)('%s object (%s) — %s answers %i', async (_kind, object, door, status, code) => {
            const h = host({ environmentId: scope.environmentId });
            const out = await call(h, door, object);
            expect(out.status, JSON.stringify(out.body)).toBe(status);
            if (code) {
                expect(errorCode(out.body)).toBe(code);
                // The data call is never reached on a refusal.
                for (const m of DATA_METHODS) expect(h.protocol[m]).not.toHaveBeenCalled();
            }
        });

        it('a 405 still names the EFFECTIVE operation set the object declares', async () => {
            const h = host({ environmentId: scope.environmentId });
            const out = await call(h, 'create', STORED.name);
            expect(out.status).toBe(405);
            expect(out.body.allowed).toEqual(['get']);
        });

        it('an unknown object is no policy here: the data path answers its own 404, and nothing is logged', async () => {
            const h = host({ environmentId: scope.environmentId });
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            const out = await call(h, 'list', UNKNOWN);
            expect(h.protocol.findData).toHaveBeenCalledTimes(1);
            expect(out.status).toBe(404);
            expect(errorCode(out.body)).toBe('OBJECT_NOT_FOUND');
            expect(warn).not.toHaveBeenCalled();
        });

        it('a THROWING by-name read fails OPEN and logs it (#3545)', async () => {
            const h = host({ environmentId: scope.environmentId });
            h.protocol.getMetaItem = vi.fn().mockRejectedValue(new Error('metadata store unreachable'));
            const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
            // `create` is refused on this object when its metadata CAN be read.
            const out = await call(h, 'create', CODE.name);
            expect(out.status).toBe(201);
            expect(h.protocol.createData).toHaveBeenCalledTimes(1);
            expect(warn).toHaveBeenCalledTimes(1);
            expect(warn.mock.calls[0]![1]).toBe('metadata store unreachable');
            expect(h.listReads()).toBe(0);
        });
    });
}

describe('[#24031] a protocol with no by-name read is asked the list, as before', () => {
    it('answers the same 405 off the list read', async () => {
        const h = host({ withoutByName: true });
        h.reset();
        const out = await call(h, 'create', CODE.name);
        expect(out.status).toBe(405);
        expect(errorCode(out.body)).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
        expect(h.listReads()).toBe(1);
    });
});

// [#24031] An object whose package is DISABLED: the list read omits it (#7557)
// while the by-name read still serves it, so the gate now judges it by its own
// `enable`. A DENIED operation answers the exposure verdict — it answered the
// data plane's 404 OBJECT_PACKAGE_DISABLED while the gate read the list — and an
// ALLOWED one still reaches the data plane, which refuses it as before.
describe('[#24031] an object of a disabled package', () => {
    it('a DENIED operation answers the exposure verdict (405), and the data call is never reached', async () => {
        const h = host();
        h.registry.disablePackage(OFF_PACKAGE);
        const out = await call(h, 'create', OFF.name);
        expect(out.status, JSON.stringify(out.body)).toBe(405);
        expect(errorCode(out.body)).toBe('OBJECT_API_METHOD_NOT_ALLOWED');
        expect(h.protocol.createData).not.toHaveBeenCalled();
    });

    it('an ALLOWED operation still answers the data plane\'s 404 OBJECT_PACKAGE_DISABLED', async () => {
        const h = host();
        h.registry.disablePackage(OFF_PACKAGE);
        const out = await call(h, 'list', OFF.name);
        expect(h.protocol.findData).toHaveBeenCalledTimes(1);
        expect(out.status, JSON.stringify(out.body)).toBe(404);
        expect(errorCode(out.body)).toBe('OBJECT_PACKAGE_DISABLED');
    });
});
