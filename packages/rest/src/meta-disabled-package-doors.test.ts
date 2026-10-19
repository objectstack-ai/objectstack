// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7557, #24210] The `RestServer` doors that read past the by-name read for a
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
 *  - the layered view, `GET /meta/:type/:name/layers` and the deprecated
 *    `?layers=true`, a non-object item: answered as a name with nothing behind
 *    it, status, body and headers, for a code-shipped, an overlay-only and a
 *    combined item, to an author as to any other caller. The owner is the plain
 *    read's kept envelope `packageId` under the same `?package=` scope, asked
 *    of the registry by the shared chain's step 1b; the protocol's layered read
 *    keeps serving its layers.
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

/** [#24371] One `where` value as the store reads it: `{ $in: [...] }` (the by-name read's both-spellings `type`) or equality. */
const whereValueMatches = (actual: unknown, want: unknown): boolean =>
    want !== null && typeof want === 'object' && Array.isArray((want as { $in?: unknown }).$in)
        ? (want as { $in: unknown[] }).$in.includes(actual)
        : actual === want;

const matchesWhere = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
        if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
        if (v === null) return row[k] === null || row[k] === undefined;
        return whereValueMatches(row[k], v);
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

/**
 * [#24210] The layered doors' extra specimens, beside {@link seed}'s: a
 * dashboard the disabled package ships whose name also carries an unpackaged
 * overlay row (the combined item: a code layer and an overlay), and one name
 * stored in BOTH packages, which `?package=` tells apart.
 */
async function seedLayered(protocol: any, registry: SchemaRegistry) {
    registry.registerItem('dashboard', { name: 'demo_both', label: 'shipped', widgets: [] } as any, 'name', PKG);
    await protocol.saveMetaItem({ type: 'dashboard', name: 'demo_both', item: { name: 'demo_both', label: 'customised', widgets: [] } });
    for (const [pkg, label] of [[PKG, 'disabled copy'], [OTHER_PKG, 'healthy copy']] as const) {
        await protocol.saveMetaItem({ type: 'dashboard', name: 'twin_dash', packageId: pkg, item: { name: 'twin_dash', label, widgets: [] } });
    }
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.headers = {} as Record<string, string>;
    res.header = vi.fn((k: string, v: string) => { res.headers[k] = v; return res; });
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

function setup(objectQLProvider?: () => Promise<unknown>, caller: Record<string, unknown> = { userId: 'u1' }) {
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
    (rest as any).resolveExecCtx = async () => caller;
    (rest as any).metadataServiceProvider = async () => snapshot;
    (rest as any).objectQLProvider = objectQLProvider ?? (async () => ({ registry: h.registry }));
    rest.registerRoutes();
    const call = async (pattern: string, path: string, params: Record<string, string>, query: Record<string, string> = {}) => {
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === `${META}${pattern}`);
        if (!route) throw new Error(`GET ${pattern} is not registered`);
        const res = makeRes();
        await route.handler({ method: 'GET', path: `${META}${path}`, params, query, body: {}, headers: {} }, res);
        return { status: res.statusCode, body: res.body, headers: res.headers as Record<string, string> };
    };
    const get = async (pattern: string, path: string, params: Record<string, string>, query: Record<string, string> = {}) => {
        const { status, body } = await call(pattern, path, params, query);
        return { status, body };
    };
    return {
        ...h,
        snapshot,
        published: (type: string, name: string) => get('/:type/:name/published', `/${type}/${name}/published`, { type, name }),
        state: (name: string) => get('/object/:name/state/:field', `/object/${name}/state/status`, { name, field: 'status' }, { from: 'open' }),
        plain: (type: string, name: string) => get('/:type/:name', `/${type}/${name}`, { type, name }),
        // [#24210] The layered view's two spellings, with every header each answer carries.
        layers: (type: string, name: string, query: Record<string, string> = {}) =>
            call('/:type/:name/layers', `/${type}/${name}/layers`, { type, name }, query),
        layersFlag: (type: string, name: string, query: Record<string, string> = {}) =>
            call('/:type/:name', `/${type}/${name}`, { type, name }, { ...query, layers: 'true' }),
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

/**
 * [#24210] The flag's answer with its `Link` set aside: that header names the
 * item's own path, so it differs from the missing name's by the name alone.
 */
const withoutLink = (r: { status: number; body: any; headers: Record<string, string> }) => {
    const { Link: _link, ...headers } = r.headers;
    return { ...r, headers };
};

describe('[#24210] RestServer: the layered view of a disabled package\'s item, both spellings', () => {
    const SPECIMENS = [
        ['page', 'demo_page'], // code-shipped: a code layer only
        ['dashboard', 'demo_dash'], // runtime-saved: an overlay only, whose layers name no owner
        ['dashboard', 'demo_both'], // combined: the shipped layer and an overlay row
    ] as const;

    it('served, then the missing name\'s answer on /layers and ?layers=true, then served again', async () => {
        const host = setup();
        await seed(host.protocol, host.registry);
        await seedLayered(host.protocol, host.registry);

        const before = new Map<string, unknown>();
        for (const [type, name] of SPECIMENS) {
            const layers = await host.layers(type, name);
            expect(layers.status).toBe(200);
            expect(layers.body?.effective).toMatchObject({ name });
            const flag = await host.layersFlag(type, name);
            expect(flag.status).toBe(200);
            expect(flag.headers.Deprecation).toBe('true');
            // One body behind both spellings.
            expect(flag.body).toEqual(layers.body);
            before.set(`${type}/${name}`, { layers, flag });
        }

        host.registry.disablePackage(PKG);
        const missingPlain = await host.plain('dashboard', 'no_such_dash');
        expect(missingPlain.status).toBe(404);
        const missingLayers = await host.layers('dashboard', 'no_such_dash');
        const missingFlag = await host.layersFlag('dashboard', 'no_such_dash');
        // The two spellings' missing name is the plain read's own absence.
        expect({ status: missingLayers.status, body: missingLayers.body }).toEqual(missingPlain);
        expect({ status: missingFlag.status, body: missingFlag.body }).toEqual(missingPlain);
        for (const [type, name] of SPECIMENS) {
            // Status, body and headers, byte for byte the missing name's.
            expect(await host.layers(type, name)).toEqual(missingLayers);
            const flag = await host.layersFlag(type, name);
            expect(withoutLink(flag)).toEqual(withoutLink(missingFlag));
            expect(flag.headers.Link).toBe(`<${META}/${type}/${name}/layers>; rel="successor-version"`);
            // …and the plain read's, which the list read agrees with.
            expect(await host.plain(type, name)).toEqual(missingPlain);
            // The producer keeps serving its layers to its resolution readers.
            expect((await host.protocol.getMetaItemLayered({ type, name }))?.effective).toMatchObject({ name });
        }
        // Control: another package's items, both spellings, still served.
        for (const [type, name] of [['page', 'healthy_page'], ['dashboard', 'healthy_dash']] as const) {
            expect(await host.layers(type, name)).toMatchObject({ status: 200, body: { effective: { name } } });
            expect(await host.layersFlag(type, name)).toMatchObject({ status: 200, body: { effective: { name } } });
        }

        host.registry.enablePackage(PKG);
        for (const [type, name] of SPECIMENS) {
            const { layers, flag } = before.get(`${type}/${name}`) as any;
            expect(await host.layers(type, name)).toEqual(layers);
            expect(await host.layersFlag(type, name)).toEqual(flag);
        }
    }, 60_000);

    it('an author is answered the same absence: the owner step precedes the per-caller gate', async () => {
        const author = { userId: 'u_author', systemPermissions: ['manage_metadata', 'studio.access'] };
        expect((RestServer as any).metaSaveVerdict(author).allowed).toBe(true);
        const authorHost = setup(undefined, author);
        const memberHost = setup(undefined, { userId: 'u_member' });
        for (const host of [authorHost, memberHost]) {
            await seed(host.protocol, host.registry);
            await host.protocol.saveMetaItem({
                type: 'app', name: 'demo_gated_app', packageId: PKG,
                item: {
                    name: 'demo_gated_app', label: 'Gated',
                    navigation: [
                        { id: 'gated_entry', type: 'url', label: 'Gated', url: 'https://example.com/a', requiredPermissions: ['gate_24210_cap'] },
                        { id: 'open_entry', type: 'url', label: 'Open', url: 'https://example.com/b' },
                    ],
                },
            });
        }
        const navIds = (r: any) => (r.body?.effective?.navigation ?? []).map((e: any) => e?.id);
        // Enabled: the per-caller gate decides. The author reads the stored
        // version whole (ruling 5856774816); the member reads it pruned.
        const authorServed = await authorHost.layers('app', 'demo_gated_app');
        expect(authorServed.status).toBe(200);
        expect(navIds(authorServed)).toEqual(['gated_entry', 'open_entry']);
        const memberServed = await memberHost.layers('app', 'demo_gated_app');
        expect(memberServed.status).toBe(200);
        expect(navIds(memberServed)).toEqual(['open_entry']);

        for (const host of [authorHost, memberHost]) {
            host.registry.disablePackage(PKG);
            const missing = await host.layers('app', 'no_such_app');
            expect(missing.status).toBe(404);
            // Both callers, both spellings: the missing name's answer, not the
            // author's whole view, and not the member's pruned one.
            expect(await host.layers('app', 'demo_gated_app')).toEqual(missing);
            expect(withoutLink(await host.layersFlag('app', 'demo_gated_app')))
                .toEqual(withoutLink(await host.layersFlag('app', 'no_such_app')));
            host.registry.enablePackage(PKG);
        }
        expect(await authorHost.layers('app', 'demo_gated_app')).toEqual(authorServed);
        expect(await memberHost.layers('app', 'demo_gated_app')).toEqual(memberServed);
    }, 60_000);

    it('an object keeps the protocol\'s own 404 OBJECT_PACKAGE_DISABLED, the plain read\'s refusal', async () => {
        const host = setup();
        await seed(host.protocol, host.registry);
        host.registry.disablePackage(PKG);
        const plain = await host.plain('object', 'demo_gadget');
        expect({ status: plain.status, code: plain.body?.code ?? plain.body?.error?.code })
            .toEqual({ status: 404, code: 'OBJECT_PACKAGE_DISABLED' });
        const layers = await host.layers('object', 'demo_gadget');
        expect({ status: layers.status, body: layers.body }).toEqual(plain);
        const flag = await host.layersFlag('object', 'demo_gadget');
        expect({ status: flag.status, body: flag.body }).toEqual(plain);
        expect(await host.layers('object', 'healthy_gadget')).toMatchObject({ status: 200, body: { effective: { name: 'healthy_gadget' } } });
    }, 60_000);

    it('?package= picks the owner: the healthy package\'s copy of a shared name is served, the disabled one\'s is absent', async () => {
        const host = setup();
        await seed(host.protocol, host.registry);
        await seedLayered(host.protocol, host.registry);
        host.registry.disablePackage(PKG);
        const missing = await host.layers('dashboard', 'no_such_dash', { package: OTHER_PKG });
        expect(missing.status).toBe(404);
        expect(await host.layers('dashboard', 'twin_dash', { package: OTHER_PKG }))
            .toMatchObject({ status: 200, body: { effective: { label: 'healthy copy' } } });
        expect(await host.layersFlag('dashboard', 'twin_dash', { package: OTHER_PKG }))
            .toMatchObject({ status: 200, body: { effective: { label: 'healthy copy' } } });
        expect(await host.layers('dashboard', 'twin_dash', { package: PKG })).toEqual(missing);
    }, 60_000);

    // The objectQLProvider slot's consumer census (`objectql-slot-consumer-census.test.ts`)
    // cites this case: the layered owner step keeps a failed engine and an
    // absent one apart, as every consumer of the slot must.
    it('the owner step reads the objectQLProvider slot through wiredEngineOrLoud: a rejecting engine is loud, an absent one serves as before', async () => {
        const rejecting = setup(async () => { throw new Error('driver handshake failed'); });
        await seed(rejecting.protocol, rejecting.registry);
        for (const read of [rejecting.layers, rejecting.layersFlag]) {
            const failed = await read('dashboard', 'demo_dash');
            expect({ status: failed.status, code: failed.body?.code ?? failed.body?.error?.code })
                .toEqual({ status: 503, code: 'SERVICE_UNAVAILABLE' });
            expect(JSON.stringify(failed.body)).not.toContain('demo board');
        }

        const absent = setup(async () => undefined);
        await seed(absent.protocol, absent.registry);
        absent.registry.disablePackage(PKG);
        // No engine to ask, so nothing is withheld: the doors' answer before #24210.
        expect(await absent.layers('dashboard', 'demo_dash')).toMatchObject({ status: 200, body: { effective: { label: 'demo board' } } });
        expect(await absent.layersFlag('dashboard', 'demo_dash')).toMatchObject({ status: 200, body: { effective: { label: 'demo board' } } });
    }, 60_000);
});
