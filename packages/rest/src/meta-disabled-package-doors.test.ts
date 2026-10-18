// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7557, #24210] Two `RestServer` doors that read past the by-name read for a
 * DISABLED package's item, each pinned before, during and after the disable,
 * beside a control (another package's item, still served):
 *
 *  - `GET /meta/:type/:name/published`, a non-object item: answered as a name
 *    with nothing behind it, status and body, on both of its exits (the stored
 *    overlay row and the code/package snapshot). The owner is the plain read's
 *    kept protection envelope's `packageId`, asked of the registry.
 *  - `GET /meta/object/:name/state/:field`: the protocol's own refusal, `404
 *    OBJECT_PACKAGE_DISABLED`, byte for byte what `GET /meta/object/:name`
 *    answers, and the registry is never asked for the schema.
 *
 * The protocol and the registry are the REAL ones (the predicate lives on the
 * registry, so a double would measure the double); only `sys_metadata` is
 * held in memory.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const META = '/api/v1/meta';
const PKG = 'app.disabled_demo';
const OTHER_PKG = 'app.healthy_demo';

const objectBody = (name: string) => ({
    name,
    label: 'Gadget',
    sharingModel: 'private',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
});

const rowKey = (w: Record<string, unknown>) =>
    [w.type, w.name, w.organization_id ?? '', w.package_id ?? '', w.state ?? 'active'].join('|');

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return row[k] === v;
    });

/** In-memory `sys_metadata` carrying a REAL `SchemaRegistry`. */
function makeHarness() {
    const registry = new SchemaRegistry({ multiTenant: false });
    (registry as any).logLevel = 'silent';
    const rows = new Map<string, any>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>) => {
        for (const [k, r] of rows) if (matchesWhere(r, w)) return { key: k, row: r };
        return null;
    };
    const engine: any = {
        registry,
        async findOne(table: string, o: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, o);
            if (table !== 'sys_metadata') return null;
            return findRow(o.where)?.row ?? null;
        },
        async find(table: string, o: { where: Record<string, unknown>; limit?: number }) {
            if (table !== 'sys_metadata') return [];
            const matched = Array.from(rows.values()).filter((r) => matchesWhere(r, o.where));
            return typeof o?.limit === 'number' ? matched.slice(0, o.limit) : matched;
        },
        async insert(table: string, data: Record<string, unknown>) {
            if (table !== 'sys_metadata') return { id: `rec_${++nextId}` };
            const row = { id: `r_${++nextId}`, ...(data as any) };
            rows.set(rowKey(data), row);
            return { id: row.id };
        },
        async update(table: string, data: Record<string, unknown>, o: { where: Record<string, unknown> }) {
            assertEngineUpdateDispatch(data, o);
            if (table !== 'sys_metadata') return { id: null };
            const found = findRow(o.where);
            if (!found) return { id: null };
            const merged = { ...found.row, ...(data as any) };
            rows.delete(found.key);
            rows.set(rowKey(merged), merged);
            return { id: merged.id };
        },
        async delete(table: string, o?: Record<string, unknown>) {
            assertEngineDeleteDispatch(o);
            if (table !== 'sys_metadata') return { deleted: 0 };
            const found = findRow(((o as any)?.where ?? {}) as Record<string, unknown>);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        async syncObjectSchema() { /* no physical storage in this double */ },
    };
    const protocol = new ObjectStackProtocolImplementation(engine, undefined, 'env_test');
    return { protocol, registry };
}

/**
 * Each package: a runtime-saved dashboard (the `/published` overlay exit), a
 * code-registered page (the snapshot exit, served by the metadata service's
 * `getPublished`) and a runtime-saved object (the `/state` door).
 */
async function seed(protocol: any, registry: SchemaRegistry) {
    for (const [pkg, prefix] of [[PKG, 'demo'], [OTHER_PKG, 'healthy']] as const) {
        registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        await protocol.saveMetaItem({
            type: 'dashboard', name: `${prefix}_dash`, packageId: pkg,
            item: { name: `${prefix}_dash`, label: `${prefix} board`, widgets: [] },
        });
        registry.registerItem('page', { name: `${prefix}_page`, label: `${prefix} page` } as any, 'name', pkg);
        await protocol.saveMetaItem({ type: 'object', name: `${prefix}_gadget`, packageId: pkg, item: objectBody(`${prefix}_gadget`) });
    }
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

function setup(objectQLProvider?: () => Promise<unknown>) {
    const h = makeHarness();
    const snapshot = {
        getPublished: vi.fn(async (type: string, name: string) =>
            (type === 'page' && name.endsWith('_page') && !name.startsWith('no_such')
                ? { name, label: `${name} (published)` }
                : undefined)),
    };
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest = new RestServer(server as any, h.protocol as any, { api: { requireAuth: false } } as any);
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    (rest as any).metadataServiceProvider = async () => snapshot;
    (rest as any).objectQLProvider = objectQLProvider ?? (async () => ({ registry: h.registry }));
    rest.registerRoutes();
    const get = async (pattern: string, path: string, params: Record<string, string>, query: Record<string, string> = {}) => {
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}${pattern}`);
        if (!route) throw new Error(`GET ${pattern} is not registered`);
        const res = makeRes();
        await route.handler({ method: 'GET', path: `${META}${path}`, params, query, body: {}, headers: {} }, res);
        return { status: res.statusCode, body: res.body };
    };
    return {
        ...h,
        snapshot,
        published: (type: string, name: string) => get('/:type/:name/published', `/${type}/${name}/published`, { type, name }),
        state: (name: string) => get('/object/:name/state/:field', `/object/${name}/state/status`, { name, field: 'status' }, { from: 'open' }),
        plain: (type: string, name: string) => get('/:type/:name', `/${type}/${name}`, { type, name }),
    };
}

describe('[#24210] RestServer: /published and /state of a disabled package\'s item', () => {
    it('/published, a non-object item: served, then the missing name\'s answer on both exits, then served again', async () => {
        const host = setup();
        await seed(host.protocol, host.registry);

        // Enabled: the overlay exit (a runtime-saved dashboard) and the
        // snapshot exit (a code-registered page) both serve.
        expect(await host.published('dashboard', 'demo_dash')).toMatchObject({ status: 200, body: { label: 'demo board' } });
        expect(await host.published('page', 'demo_page')).toEqual({ status: 200, body: { name: 'demo_page', label: 'demo_page (published)' } });

        host.registry.disablePackage(PKG);
        const missing = await host.published('dashboard', 'no_such_dash');
        expect(missing).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Not found' } } });
        expect(await host.published('page', 'no_such_page')).toEqual(missing);
        host.snapshot.getPublished.mockClear();
        expect(await host.published('dashboard', 'demo_dash')).toEqual(missing);
        expect(await host.published('page', 'demo_page')).toEqual(missing);
        // The snapshot was never asked for a withheld item.
        expect(host.snapshot.getPublished).not.toHaveBeenCalled();
        // Control: another package's item, both exits, still served.
        expect(await host.published('dashboard', 'healthy_dash')).toMatchObject({ status: 200, body: { label: 'healthy board' } });
        expect(await host.published('page', 'healthy_page')).toEqual({ status: 200, body: { name: 'healthy_page', label: 'healthy_page (published)' } });

        host.registry.enablePackage(PKG);
        expect(await host.published('dashboard', 'demo_dash')).toMatchObject({ status: 200, body: { label: 'demo board' } });
        expect(await host.published('page', 'demo_page')).toEqual({ status: 200, body: { name: 'demo_page', label: 'demo_page (published)' } });
    }, 60_000);

    it('/state/:field: served, then GET /meta/object/:name\'s own 404 OBJECT_PACKAGE_DISABLED, then served again', async () => {
        const host = setup();
        await seed(host.protocol, host.registry);
        const served = { status: 200, body: { object: 'demo_gadget', field: 'status', from: 'open', next: null } };
        expect(await host.state('demo_gadget')).toEqual(served);

        host.registry.disablePackage(PKG);
        const getObject = vi.spyOn(host.registry, 'getObject');
        const refused = await host.state('demo_gadget');
        expect({ status: refused.status, code: refused.body?.code }).toEqual({ status: 404, code: 'OBJECT_PACKAGE_DISABLED' });
        // Byte for byte the by-name read's answer for the same object.
        expect(refused).toEqual(await host.plain('object', 'demo_gadget'));
        // The schema is never read for that name.
        expect(getObject.mock.calls.filter(([name]) => name === 'demo_gadget')).toEqual([]);
        getObject.mockRestore();
        // Control: another package's object, and a name with no object behind it.
        expect(await host.state('healthy_gadget')).toEqual({ ...served, body: { ...served.body, object: 'healthy_gadget' } });
        expect(await host.state('no_such_gadget')).toEqual({ status: 404, body: { error: { code: 'NOT_FOUND', message: 'Object not found' } } });

        host.registry.enablePackage(PKG);
        expect(await host.state('demo_gadget')).toEqual(served);
    }, 60_000);

    // The objectQLProvider slot's consumer census (`objectql-slot-consumer-census.test.ts`)
    // cites this case: the `/published` consumer keeps a failed engine and an
    // absent one apart, as every consumer of the slot must.
    it('/published reads the objectQLProvider slot through wiredEngineOrLoud: a rejecting engine is loud, an absent one serves as before', async () => {
        const rejecting = setup(async () => { throw new Error('driver handshake failed'); });
        await seed(rejecting.protocol, rejecting.registry);
        const failed = await rejecting.published('dashboard', 'demo_dash');
        expect({ status: failed.status, code: failed.body?.code ?? failed.body?.error?.code })
            .toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
        expect(JSON.stringify(failed.body)).not.toContain('demo board');

        const absent = setup(async () => undefined);
        await seed(absent.protocol, absent.registry);
        absent.registry.disablePackage(PKG);
        // No engine to ask, so nothing is withheld: the door's answer before #24210.
        expect(await absent.published('dashboard', 'demo_dash')).toMatchObject({ status: 200, body: { label: 'demo board' } });
    }, 60_000);
});
