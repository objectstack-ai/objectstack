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
        // [#32183 M4] `stamped_page`: the copy the metadata service keeps for a
        // type it keys by name alone, when the disabled holder's body
        // registered last (stamped with that holder).
        getPublished: vi.fn(async (type: string, name: string, _packageId?: string) =>
            (type === 'page' && name === 'stamped_page'
                ? { name, label: 'disabled code', _packageId: PKG }
                : type === 'page' && name.endsWith('_page') && !name.startsWith('no_such')
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
        rest,
        snapshot,
        published: (type: string, name: string) => get('/:type/:name/published', `/${type}/${name}/published`, { type, name }),
        state: (name: string) => get('/object/:name/state/:field', `/object/${name}/state/status`, { name, field: 'status' }, { from: 'open' }),
        plain: (type: string, name: string) => get('/:type/:name', `/${type}/${name}`, { type, name }),
        plainWith: (type: string, name: string, query: Record<string, string>) =>
            get('/:type/:name', `/${type}/${name}`, { type, name }, query),
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

/**
 * [#32183, contract review M1] A name an enabled and a disabled package both
 * ship: every bare door (the plain read, `/layers`, `/published`) serves the
 * enabled holder's stack, whichever registered first, and a stored row bound
 * to the disabled holder reaches none of them. The page's `/published` is the
 * snapshot exit, whose stub here (as the metadata service) is blind to the
 * package. [contract review M4] Its `stamped_page` copy is the one a service
 * that keys the type by name alone keeps when the disabled holder's body
 * registered last: the door serves the enabled holder's code layer instead
 * (the artifact door's own pin is
 * `packages/runtime/src/domains/meta-disabled-holder-artifact-door.test.ts`).
 *
 * Contract review M4: with this door's stamp check ablated (fix round 2,
 * leg A12), `stamped_page`'s `/published` served the disabled holder's copy
 * in both orders.
 *
 * Contract review M1 (branch head 340f7cbc, measured on this fixture): with a
 * stored row bound to the disabled holder, the plain read, `/layers` and
 * `/published` answered 404 (the bare read took that row and the face withheld
 * it); with a stored row bound to each holder, `/layers` answered 409.
 */
describe('[#32183] RestServer: a name an enabled and a disabled package both ship', () => {
    const tag = (pkg: string) => (pkg === PKG ? 'disabled' : 'healthy');
    const SPECIMENS = [
        // [type, name, plain, code, overlay, /published]
        ['page', 'mix_page', 'healthy code', 'healthy code', undefined, 'mix_page (published)'],
        // [contract review M4] The snapshot's copy is the disabled holder's: never served; the
        // enabled holder's code layer is.
        ['page', 'stamped_page', 'healthy code', 'healthy code', undefined, 'healthy code'],
        ['dashboard', 'row_one_dash', 'healthy code', 'healthy code', undefined, undefined],
        ['dashboard', 'row_both_dash', 'healthy row', 'healthy code', 'healthy row', 'healthy row'],
    ] as const;

    it.each([['disabled first', [PKG, OTHER_PKG]], ['enabled first', [OTHER_PKG, PKG]]] as const)('%s: the plain read, /layers and /published serve the enabled holder\'s code layer and stored row, never the disabled one\'s', async (_order, packages) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        for (const pkg of packages) {
            for (const name of ['mix_page', 'stamped_page']) {
                host.registry.registerItem('page', { name, label: `${tag(pkg)} code` } as any, 'name', pkg);
            }
            for (const name of ['row_one_dash', 'row_both_dash']) {
                host.registry.registerItem('dashboard', { name, label: `${tag(pkg)} code`, widgets: [] } as any, 'name', pkg);
            }
        }
        // A stored row bound to the disabled holder alone, and one bound to each holder.
        await host.protocol.saveMetaItem({ type: 'dashboard', name: 'row_one_dash', packageId: PKG, item: { name: 'row_one_dash', label: 'disabled row', widgets: [] } });
        for (const pkg of packages) {
            await host.protocol.saveMetaItem({ type: 'dashboard', name: 'row_both_dash', packageId: pkg, item: { name: 'row_both_dash', label: `${tag(pkg)} row`, widgets: [] } });
        }
        // CONTROL: the fixture carries the disabled holder's layers; its own address serves them while it is enabled.
        expect(await host.layers('dashboard', 'row_one_dash', { package: PKG }))
            .toMatchObject({ status: 200, body: { code: { label: 'disabled code' }, effective: { label: 'disabled row' } } });

        host.registry.disablePackage(PKG);
        for (const [type, name, plain, code, overlay, published] of SPECIMENS) {
            const read = await host.plain(type, name);
            expect([read.status, read.body?.item?.label, name], JSON.stringify(read.body)).toEqual([200, plain, name]);
            const layers = await host.layers(type, name);
            expect([layers.status, layers.body?.code?.label, layers.body?.overlay?.label, layers.body?.effective?.label, name], JSON.stringify(layers.body))
                .toEqual([200, code, overlay, overlay ?? code, name]);
            const served = await host.published(type, name);
            if (published === undefined) expect([served.status, name]).toEqual([404, name]);
            else expect([served.status, served.body?.label, name], JSON.stringify(served.body)).toEqual([200, published, name]);
            for (const answer of [read, layers, served]) expect(JSON.stringify(answer.body ?? null)).not.toMatch(/disabled (code|row)/);
        }
        // [contract review M4] The snapshot is read at the enabled holder's package, so a type the
        // metadata service stores per (package, name) answers that package's copy.
        expect(host.snapshot.getPublished).toHaveBeenCalledWith('page', 'stamped_page', OTHER_PKG);
    }, 60_000);
});

/**
 * [#32354, ADR-0150 D3] The row layer judges a name's holders over the served
 * set too: a holder is a registry holder or a package a stored row of the name
 * is bound to. With one of them disabled, the bare doors read at the one
 * served holder's address, and refuse naming only the served holders when two
 * or more are; `?package=DISABLED` is that package's withheld item whether it
 * holds the name in the registry or only as a stored row. The runtime
 * dispatcher's pins are in
 * `packages/runtime/src/domains/meta-disabled-holder-served-stack.test.ts`.
 *
 * Measured on the #32183 head (6655b742, step 0 of #32354): rows saved by the
 * save door (which writes each through to the registry's one bare slot of the
 * name), the disabled row saved first: the plain read and /layers answered
 * 404; the enabled row first: /layers answered 409 naming the disabled
 * package. `?package=DISABLED` of a name the enabled package ships in code
 * served the disabled row's body under the enabled package's envelope.
 */
describe('[#32354] RestServer: stored rows judged over the served set', () => {
    const THIRD_PKG = 'app.third_demo';
    const tag = (pkg: string) => (pkg === PKG ? 'disabled' : pkg === THIRD_PKG ? 'third' : 'healthy');
    const save = (host: ReturnType<typeof setup>, name: string, pkg: string) => host.protocol.saveMetaItem({
        type: 'dashboard', name, packageId: pkg, item: { name, label: `${tag(pkg)} row`, widgets: [] },
    });
    const noDisabledTrace = (answers: ReadonlyArray<{ body: unknown }>) => {
        for (const answer of answers) {
            const text = JSON.stringify(answer.body ?? null);
            expect(text).not.toMatch(/disabled (code|row)/);
            expect(text).not.toContain(PKG);
        }
    };
    const ORDERS = [['disabled first', [PKG, OTHER_PKG, THIRD_PKG]], ['enabled first', [OTHER_PKG, THIRD_PKG, PKG]]] as const;

    it.each(ORDERS.flatMap(([order, packages]) => [
        [`${order}, the disabled row saved first`, packages, [PKG, OTHER_PKG]],
        [`${order}, the enabled row saved first`, packages, [OTHER_PKG, PKG]],
    ] as const))('%s: no package ships the name; the plain read, /layers and /published serve the enabled row', async (_label, packages, saved) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        for (const pkg of saved) await save(host, 'rows_only_dash', pkg);
        host.registry.disablePackage(PKG);
        const read = await host.plain('dashboard', 'rows_only_dash');
        expect([read.status, read.body?.item?.label, read.body?.packageId], JSON.stringify(read.body)).toEqual([200, 'healthy row', OTHER_PKG]);
        const layers = await host.layers('dashboard', 'rows_only_dash');
        expect([layers.status, layers.body?.overlay?.label, layers.body?.effective?.label], JSON.stringify(layers.body))
            .toEqual([200, 'healthy row', 'healthy row']);
        const published = await host.published('dashboard', 'rows_only_dash');
        expect([published.status, published.body?.label], JSON.stringify(published.body)).toEqual([200, 'healthy row']);
        const exact = await host.plainWith('dashboard', 'rows_only_dash', { package: PKG });
        expect(exact.status, JSON.stringify(exact.body)).toBe(404);
        noDisabledTrace([read, layers, published, exact]);
        // Re-enabled: two holders again, and /layers refuses naming both.
        host.registry.enablePackage(PKG);
        const again = await host.layers('dashboard', 'rows_only_dash');
        expect(again.status).toBe(409);
        expect(JSON.stringify(again.body)).toContain(PKG);
    }, 60_000);

    it.each(ORDERS)('%s, ruling Q2: two served row holders beside a disabled one are refused naming only the served holders, the plain read with details.candidates', async (_order, packages) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        for (const pkg of [PKG, OTHER_PKG, THIRD_PKG]) await save(host, 'three_rows_dash', pkg);
        host.registry.disablePackage(PKG);
        const read = await host.plain('dashboard', 'three_rows_dash');
        expect([read.status, read.body?.code], JSON.stringify(read.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect([...(read.body?.details?.candidates ?? [])].map((c: any) => c.packageId).sort(), JSON.stringify(read.body))
            .toEqual([OTHER_PKG, THIRD_PKG].sort());
        // The layered door answers a package-scoped refusal by its sentence alone, as for two registry holders (#32622).
        const layers = await host.layers('dashboard', 'three_rows_dash');
        expect(layers.status, JSON.stringify(layers.body)).toBe(409);
        for (const pkg of [OTHER_PKG, THIRD_PKG]) expect(JSON.stringify(layers.body)).toContain(pkg);
        noDisabledTrace([read, layers]);
    }, 60_000);

    it.each(ORDERS)('%s, case 3: ?package=DISABLED, where the enabled package ships the name and the disabled one holds it only as a stored row, is the withheld 404', async (_order, packages) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        host.registry.registerItem('dashboard', { name: 'shipped_dash', label: 'healthy code', widgets: [] } as any, 'name', OTHER_PKG);
        await save(host, 'shipped_dash', PKG);
        // CONTROL: enabled, that address serves the row.
        const own = await host.plainWith('dashboard', 'shipped_dash', { package: PKG });
        expect([own.status, own.body?.item?.label], JSON.stringify(own.body)).toEqual([200, 'disabled row']);
        host.registry.disablePackage(PKG);
        const exact = await host.plainWith('dashboard', 'shipped_dash', { package: PKG });
        expect(exact.status, JSON.stringify(exact.body)).toBe(404);
        const bare = await host.plain('dashboard', 'shipped_dash');
        expect([bare.status, bare.body?.item?.label], JSON.stringify(bare.body)).toEqual([200, 'healthy code']);
        noDisabledTrace([exact, bare]);
    }, 60_000);
});

/**
 * [#32607, ADR-0150 D3] With NO package disabled, a name two enabled packages
 * hold only as stored rows (no package ships it) is refused on every bare door
 * naming both, whichever was saved first; each exact address serves its own
 * row, and one row holder is served as before. The reboot leg (the registry's
 * one bare slot hydrated from the last row) is pinned on a booted kernel in
 * `packages/runtime/src/domains/meta-disabled-holder-served-stack.test.ts`.
 *
 * Measured on the #32183 head plus #32354's work (step 0 of #32607): the plain
 * read and `/published` served the row saved first, while `/layers` refused 409
 * naming both.
 */
describe('[#32607] RestServer: two enabled row holders and no shipper', () => {
    const THIRD_PKG = 'app.third_demo';
    const label = (pkg: string) => (pkg === OTHER_PKG ? 'healthy row' : 'third row');
    const save = (host: ReturnType<typeof setup>, name: string, pkg: string) => host.protocol.saveMetaItem({
        type: 'dashboard', name, packageId: pkg, item: { name, label: label(pkg), widgets: [] },
    });
    const ORDERS = [['healthy registered first', [OTHER_PKG, THIRD_PKG]], ['third registered first', [THIRD_PKG, OTHER_PKG]]] as const;

    it.each(ORDERS.flatMap(([order, packages]) => [
        [`${order}, the healthy row saved first`, packages, [OTHER_PKG, THIRD_PKG]],
        [`${order}, the third row saved first`, packages, [THIRD_PKG, OTHER_PKG]],
    ] as const))('%s: the plain read, /layers, /published and the execution face refuse naming both', async (_label, packages, saved) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        for (const pkg of saved) await save(host, 'two_rows_dash', pkg);
        const read = await host.plain('dashboard', 'two_rows_dash');
        expect([read.status, read.body?.code], JSON.stringify(read.body)).toEqual([409, 'RESOURCE_CONFLICT']);
        expect([...(read.body?.details?.candidates ?? [])].map((c: any) => c.packageId).sort(), JSON.stringify(read.body))
            .toEqual([OTHER_PKG, THIRD_PKG].sort());
        // `/published` answers the plain read's refusal; `/layers` keeps the package-less writes' own (#28337). Both name both holders and serve no row.
        for (const answer of [await host.layers('dashboard', 'two_rows_dash'), await host.published('dashboard', 'two_rows_dash')]) {
            expect(answer.status, JSON.stringify(answer.body)).toBe(409);
            for (const pkg of [OTHER_PKG, THIRD_PKG]) expect(JSON.stringify(answer.body)).toContain(pkg);
            expect(JSON.stringify(answer.body)).not.toMatch(/(healthy|third) row/);
        }
        await expect(host.protocol.getMetaItemForExecution({ type: 'dashboard', name: 'two_rows_dash' }))
            .rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', httpStatus: 409 });
        for (const pkg of [OTHER_PKG, THIRD_PKG]) {
            const exact = await host.plainWith('dashboard', 'two_rows_dash', { package: pkg });
            expect([exact.status, exact.body?.item?.label], JSON.stringify(exact.body)).toEqual([200, label(pkg)]);
        }
    }, 60_000);

    // [#32607, A1] The layered chain's owner step reads the plain read first; its refusal of two row holders is
    // left to step 1c (the writes' own refusal, #28337), and every other refusal of it is answered as before.
    const WRITES_SENTENCE = 'Name the package this layered read is for';
    const messageOf = (body: any): string => String(body?.error?.message ?? body?.message ?? body?.error ?? '');

    it.each(ORDERS)('%s, A1 CONTROL: /layers of a name two packages ship in code keeps the plain read\'s refusal', async (_order, packages) => {
        const host = setup();
        for (const pkg of packages) {
            host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
            host.registry.registerItem('dashboard', { name: 'two_code_dash', label: `${label(pkg)} code`, widgets: [] } as any, 'name', pkg);
        }
        const read = await host.plain('dashboard', 'two_code_dash');
        const layers = await host.layers('dashboard', 'two_code_dash');
        expect([read.status, layers.status], JSON.stringify([read.body, layers.body])).toEqual([409, 409]);
        expect(messageOf(layers.body), JSON.stringify(layers.body)).toBe(messageOf(read.body));
        expect(messageOf(layers.body)).not.toContain(WRITES_SENTENCE);
    }, 60_000);

    it.each(ORDERS)('%s, A1 CONTROL: /layers of two served row holders beside a disabled one keeps the plain read\'s refusal (#32354 Q2)', async (_order, packages) => {
        const host = setup();
        for (const pkg of [...packages, PKG]) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        for (const pkg of [PKG, ...packages]) await save(host, 'q2_rows_dash', pkg);
        host.registry.disablePackage(PKG);
        const read = await host.plain('dashboard', 'q2_rows_dash');
        const layers = await host.layers('dashboard', 'q2_rows_dash');
        expect([read.status, layers.status], JSON.stringify([read.body, layers.body])).toEqual([409, 409]);
        expect(messageOf(layers.body), JSON.stringify(layers.body)).toBe(messageOf(read.body));
        expect(messageOf(layers.body)).not.toContain(WRITES_SENTENCE);
        expect(JSON.stringify(layers.body)).not.toContain(PKG);
    }, 60_000);

    it.each(ORDERS)('%s, A1: /layers of two enabled row holders answers the package-less writes\' refusal, not the plain read\'s', async (_order, packages) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        for (const pkg of packages) await save(host, 'a1_rows_dash', pkg);
        const read = await host.plain('dashboard', 'a1_rows_dash');
        const layers = await host.layers('dashboard', 'a1_rows_dash');
        expect([read.status, layers.status], JSON.stringify([read.body, layers.body])).toEqual([409, 409]);
        expect(messageOf(layers.body).startsWith(WRITES_SENTENCE), JSON.stringify(layers.body)).toBe(true);
        for (const pkg of packages) expect(messageOf(layers.body)).toContain(pkg);
    }, 60_000);

    it.each(ORDERS)('%s, CONTROL: one row holder is served on every bare door as before', async (_order, packages) => {
        const host = setup();
        for (const pkg of packages) host.registry.installPackage({ id: pkg, name: pkg, version: '1.0.0' } as any, 'code');
        await save(host, 'one_row_dash', OTHER_PKG);
        const read = await host.plain('dashboard', 'one_row_dash');
        expect([read.status, read.body?.item?.label, read.body?.packageId], JSON.stringify(read.body)).toEqual([200, 'healthy row', OTHER_PKG]);
        const layers = await host.layers('dashboard', 'one_row_dash');
        expect([layers.status, layers.body?.effective?.label], JSON.stringify(layers.body)).toEqual([200, 'healthy row']);
        const published = await host.published('dashboard', 'one_row_dash');
        expect([published.status, published.body?.label], JSON.stringify(published.body)).toEqual([200, 'healthy row']);
        const executed: any = await host.protocol.getMetaItemForExecution({ type: 'dashboard', name: 'one_row_dash' });
        expect(executed?.item?.label).toBe('healthy row');
    }, 60_000);
});

/**
 * [ruling record 6787890900] An object the caller may not read is answered on
 * every object door exactly as a name with nothing behind it — decided BEFORE
 * the store is read, so no store answer about that object (the protocol's own
 * refusal of a disabled package's object among them) reaches the caller.
 */
describe('[ruling record 6787890900] RestServer: an object the caller may not read is answered as a missing name before any store read', () => {
    /**
     * A security service that admits `healthy_gadget` alone — as the real one
     * answers: an object the caller holds no read grant on, and a name with no
     * object behind it, are both not admitted.
     */
    const hidingDemo = () => ({
        getMetadataReadableFields: async () => ['name'],
        canReadObject: async (object: string) => object === 'healthy_gadget',
    });
    /** The answer, with the requested name written out of it (a `Link` header echoes the path it was asked on). */
    const answerOf = (r: { status: number; body: unknown; headers?: Record<string, string> }, name: string) =>
        JSON.stringify({ status: r.status, body: r.body, headers: r.headers ?? {} }).split(name).join('NAME');

    for (const disabledPackage of [false, true]) {
        it(`the plain read, /layers, ?layers=true and /state answer exactly as for a missing name${disabledPackage ? ' — its package disabled' : ''}`, async () => {
            const host = setup();
            await seed(host.protocol, host.registry);
            (host.rest as any).securityServiceProvider = async () => hidingDemo();
            if (disabledPackage) host.registry.disablePackage(PKG);
            const layered = vi.spyOn(host.protocol as any, 'getMetaItemLayered');
            const byName = vi.spyOn(host.protocol as any, 'getMetaItem');
            const cached = vi.spyOn(host.protocol as any, 'getMetaItemCached');
            const doors = {
                plain: (name: string) => host.plain('object', name),
                // A NAMED member: decided before the store, exactly as without one.
                plainMember: (name: string) => host.plainWith('object', name, { member: 'en' }),
                layers: (name: string) => host.layers('object', name),
                layersFlag: (name: string) => host.layersFlag('object', name),
                state: (name: string) => host.state(name),
            };
            for (const [door, read] of Object.entries(doors)) {
                const missing = await read('no_such_gadget');
                expect(missing.status, door).toBe(404);
                layered.mockClear();
                byName.mockClear();
                cached.mockClear();
                expect(answerOf(await read('demo_gadget'), 'demo_gadget'), door).toBe(answerOf(missing, 'no_such_gadget'));
                expect(cached.mock.calls.filter(([request]: any[]) => request?.name === 'demo_gadget'), door).toEqual([]);
                // Decided before the store: neither read is ever asked about it.
                expect(layered.mock.calls.filter(([request]: any[]) => request?.name === 'demo_gadget'), door).toEqual([]);
                expect(byName.mock.calls.filter(([request]: any[]) => request?.name === 'demo_gadget'), door).toEqual([]);
            }
            // Control: the readable object, same caller and service, is served on every door.
            expect((await doors.plain('healthy_gadget')).status).toBe(200);
            expect((await doors.layers('healthy_gadget')).status).toBe(200);
            expect((await doors.state('healthy_gadget')).status).toBe(200);
        }, 60_000);
    }

    it('/state: an object read that cannot be evaluated is the field-visibility fault, never the state answer', async () => {
        const host = setup();
        await seed(host.protocol, host.registry);
        (host.rest as any).securityServiceProvider = async () => ({
            getMetadataReadableFields: async () => ['name'],
            canReadObject: async () => { throw new Error('security service unhealthy (test)'); },
        });
        const answer = await host.state('healthy_gadget');
        expect({ status: answer.status, code: answer.body?.error?.code ?? answer.body?.code })
            .toEqual({ status: 503, code: 'FIELD_VISIBILITY_UNRESOLVED' });
    }, 60_000);
});
