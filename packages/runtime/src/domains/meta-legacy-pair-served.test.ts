// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29594, ADR-0146 D3 as amended, merge question 12] A per-package pair an
 * earlier version created for a module of an App (`<module id>.custom`) is
 * honoured as it was: the declared override it holds of an item the module
 * ships is served at the module's address — by name, in the list, and in the
 * layered read — and the pair can still remove that override, after which
 * the module's own item is served again ("Restore package original").
 *
 * Through the doors a client calls: the reads through `HttpDispatcher`'s
 * catch-all (the `@objectstack/hono` path), the removal through `RestServer`'s
 * `DELETE /meta/:type/:name` (the catch-all answers `405` for a delete). One
 * real engine, SQL store and protocol behind both; the App lookup is the real
 * `appOf` over the registry's installed manifests, nothing stubbed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadata, SysMetadataHistoryObject, SysMetadataAuditObject } from '@objectstack/platform-objects/metadata';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';
// The dispatcher's package door reaches `import('@objectstack/metadata')` in
// standalone-stack.ts; pay that load during collection, never inside a
// clocked case (check:test-source-alias).
import '@objectstack/metadata';

const PREFIX = '/api/v1';
const META = `${PREFIX}/meta`;
const TEST_PACKAGE_ID = 'objectstack-test';
const APP = 'app.objectstack.hotcrm';
const MODULE = `${APP}.service`;
const LEGACY_PAIR = `${MODULE}.custom`;
const BOARD = 'crm_service_board';
const SHIPPED = 'Service board (shipped)';
const CUSTOMIZED = 'Service board (customized in the legacy pair)';
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] };

const GUIDE = 'crm_service_guide';
const board = (label: string) => ({ name: BOARD, label, columns: 12, widgets: [] });
// A doc opens no overlay channel: its removal passes the sealed-removal
// refusal only as a pair's removal of its own declared override.
const guide = (label: string) => ({ name: GUIDE, label, content: '# Service guide' });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

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

async function boot(environmentId?: string) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
    // HotCRM's shape: the App, and a module that declares it and ships a dashboard.
    engine.registerApp({ id: APP, name: 'hotcrm', version: '6.1.0', type: 'app', namespace: 'crm' });
    engine.registerApp({
        id: MODULE, name: 'hotcrm-service', version: '6.1.0', type: 'module', namespace: 'crm',
        dependencies: { [APP]: '^6.1.0' },
        objects: [{ name: 'crm_service_case', label: 'Case', fields: { subject: { name: 'subject', label: 'Subject', type: 'text' } } }],
        dashboards: [board(SHIPPED)],
        docs: [guide(SHIPPED)],
    });
    // The per-package pair an earlier version's ensure door created for the module.
    engine.registry.installPackage({
        id: LEGACY_PAIR, name: 'hotcrm-service (custom)', version: '0.1.0', type: 'module', namespace: 'crm_svc_custom',
        dependencies: { [MODULE]: '^6' },
    } as any, 'authored');
    await engine.syncSchemas();
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map(), environmentId);

    // The reads: the dispatcher's catch-all.
    const get = (n: string) => (n === 'protocol' ? protocol : n === 'objectql' ? engine : null);
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => clone(AUTHOR);
    const read = async (path: string, query: Record<string, string> = {}) => {
        const res = await dispatcher.dispatch('GET', path, undefined, query, { request: new Request(`http://localhost${PREFIX}${path}`) }, PREFIX);
        return { status: res.response?.status ?? 0, body: res.response?.body };
    };

    // The removal: RestServer's DELETE route.
    const noop = () => {};
    const server = { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    rest.resolveExecCtx = async () => clone(AUTHOR);
    rest.registerRoutes();
    const remove = async (type: string, name: string, query: Record<string, string>) => {
        const entry = rest.getRoutes().find((r: any) => r.method === 'DELETE' && r.path === `${META}/:type/:name`);
        if (!entry) throw new Error('DELETE /meta/:type/:name is not registered');
        const res = makeRes();
        await entry.handler({
            method: 'DELETE', path: `${META}/${type}/${name}`, params: { type, name }, query: { ...query }, headers: {}, body: {},
        }, res);
        return { status: res.statusCode, body: res.body };
    };
    /**
     * The legacy pair's declared override as an earlier version stored it: the
     * row itself, written straight to the store, so the reads and the removal
     * below are judged on a row no write gate of this version admitted.
     */
    const seedLegacyOverride = (type: string, body: Record<string, unknown>) =>
        engine.insert('sys_metadata', {
            name: body.name, type, namespace: 'default', package_id: LEGACY_PAIR, scope: 'platform', strategy: 'merge',
            state: 'active', version: 1,
            metadata: JSON.stringify({ ...body, overrides: { package: MODULE, basedOn: '6.1.0' } }),
        }, { context: { isSystem: true } } as any);
    return { engine, protocol, read, remove, seedLegacyOverride };
}

const itemOf = (body: any) => body?.data?.item ?? body?.data ?? body;
const labelOf = (body: any) => itemOf(body)?.label;
const listedLabel = (body: any) => {
    const data = body?.data ?? body;
    const items: any[] = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
    return items.find((i: any) => i?.name === BOARD)?.label;
};
const effectiveLabel = (body: any) => (body?.data ?? body)?.effective?.label;

// Both topologies: an environment kernel (`environmentId` set) asks the
// protocol's removal door — `refusePackagedBaseRemoval` and the pair-row
// removal's pass past it — and a host-config kernel only the repository's
// delete gate.
for (const environmentId of [undefined, 'env_hotcrm'] as const) {
    const topology = environmentId === undefined ? 'host-config kernel' : 'environment kernel';
    describe(`[#29594] merge question 12 (${topology}): a legacy per-package pair of an App's module is honoured as before`, () => {
        it('the pair still saves a declared override of the module\'s item (the write gate admits it)', async () => {
            const { protocol, read } = await boot(environmentId);
            await protocol.saveMetaItem({
                type: 'dashboard', name: BOARD, packageId: LEGACY_PAIR,
                item: { ...board(CUSTOMIZED), overrides: { package: MODULE, basedOn: '6.1.0' } },
            });
            const byName = await read(`/meta/dashboard/${BOARD}`, { package: MODULE });
            expect([byName.status, labelOf(byName.body)]).toEqual([200, CUSTOMIZED]);
        }, 60_000);

        it('its declared override is served at the module\'s address (by name, list, layered); it removes it, and the module\'s item is served again', async () => {
            const { read, remove, seedLegacyOverride } = await boot(environmentId);

            // Precondition: the module ships the board.
            const shipped = await read(`/meta/dashboard/${BOARD}`, { package: MODULE });
            expect([shipped.status, labelOf(shipped.body)], JSON.stringify(shipped.body).slice(0, 400)).toEqual([200, SHIPPED]);

            // The legacy pair holds its declared override of the module's board.
            await seedLegacyOverride('dashboard', board(CUSTOMIZED));

            const byName = await read(`/meta/dashboard/${BOARD}`, { package: MODULE });
            const list = await read('/meta/dashboard', { package: MODULE });
            const layered = await read(`/meta/dashboard/${BOARD}/layers`, { package: MODULE });
            expect({
                byName: [byName.status, labelOf(byName.body)],
                list: [list.status, listedLabel(list.body)],
                layered: [layered.status, effectiveLabel(layered.body)],
            }, JSON.stringify({ byName: byName.body, layered: layered.body }).slice(0, 800)).toEqual({
                byName: [200, CUSTOMIZED],
                list: [200, CUSTOMIZED],
                layered: [200, CUSTOMIZED],
            });

            // "Restore package original": the legacy pair removes its own override.
            const removed = await remove('dashboard', BOARD, { package: LEGACY_PAIR });
            expect(removed.status, JSON.stringify(removed.body).slice(0, 600)).toBe(200);

            const after = await read(`/meta/dashboard/${BOARD}`, { package: MODULE });
            const layeredAfter = await read(`/meta/dashboard/${BOARD}/layers`, { package: MODULE });
            expect([labelOf(after.body), effectiveLabel(layeredAfter.body)]).toEqual([SHIPPED, SHIPPED]);
        }, 60_000);

        it('a doc (no overlay channel) the legacy pair overrides is served, and its removal passes the sealed-removal refusal as the pair\'s own', async () => {
            const { read, remove, seedLegacyOverride } = await boot(environmentId);
            await seedLegacyOverride('doc', guide(CUSTOMIZED));
            const byName = await read(`/meta/doc/${GUIDE}`, { package: MODULE });
            expect([byName.status, labelOf(byName.body)], JSON.stringify(byName.body).slice(0, 400)).toEqual([200, CUSTOMIZED]);

            const removed = await remove('doc', GUIDE, { package: LEGACY_PAIR });
            expect(removed.status, JSON.stringify(removed.body).slice(0, 600)).toBe(200);
            const after = await read(`/meta/doc/${GUIDE}`, { package: MODULE });
            expect([after.status, labelOf(after.body)]).toEqual([200, SHIPPED]);
        }, 60_000);
    });
}

/**
 * [#32501, ADR-0150 D5, epic red line 2] A stored row read at an exact address
 * wears the envelope of the package that address reads, and `/layers` reads
 * that package's code layer: never the package that registered the name first.
 * The real engine and SQL store. The rows are inserted straight into
 * `sys_metadata`, not hydrated through `loadMetaFromDb`; the hydrated rows
 * answer the same (measured by the contract review of #32808).
 *
 * BASE (main 874166b6, measured on this fixture):
 *  - alpha's pair override row, beta registered first: `?package=alpha.custom`
 *    served it under beta's `_packageId`, `_packageVersion` and `_provenance`,
 *    and `/layers` reported beta's shipped body as its code layer;
 *  - a row bound only to gamma (which ships nothing), `?package=gamma`: under
 *    the first registered shipper's envelope, and `/layers` that shipper's body;
 *  - the App pair's row, two modules of the App holding the name: under alpha's
 *    envelope (the first package that registered the name, not a module of the
 *    App), and `/layers` 200 with alpha's body as its code layer.
 *
 * Re-measured on main 2f80f2897 (#32497 landed): every plain-read envelope
 * above stands, and the gamma row beside a disabled only shipper is 404 on
 * both doors. `/layers` already answers alpha's code layer for alpha's pair
 * row, `code: null` for the gamma row, and 409 for the App pair's row when
 * alpha registered ahead of the modules (the code layer's lookup lands on
 * alpha, which #32497's `exactQualifierItem` refuses); with a module of the
 * App registered first and no other shipper, `/layers` there answered 200
 * with that module's body as its code layer, the move the App pair row pin's
 * module-first cases hold.
 *
 * Re-measured again for the contract review of #32808: with NO stored row
 * and the App's two modules the only shippers of the name, `?package=` the
 * App pair and its `/layers` answered 200 with the first registered
 * module's item on `main`, on this real engine as on the bare
 * `SchemaRegistry` composition; with another package registered ahead of
 * the modules, both doors already answered 409. The registration shape
 * decides the FROM, not the composition (the last pin).
 */
describe('#32501 — a stored row at an exact address wears the envelope of the package the address reads', () => {
    const ALPHA = 'com.acme.alpha';
    const BETA = 'com.acme.beta';
    const GAMMA = 'com.acme.gamma';
    const SUITE = 'com.acme.suite';
    const ONE = 'com.acme.one';
    const TWO = 'com.acme.two';
    const dash = (label: string) => ({ name: 'd', label, columns: 12, widgets: [] });

    async function bootShippers(order: readonly string[]) {
        const engine = new ObjectQL();
        liveEngines.push(engine);
        engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }), true);
        await engine.init();
        engine.registry.registerObject(SysMetadata as any, TEST_PACKAGE_ID);
        engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
        engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
        (engine.registry as unknown as { logLevel: string }).logLevel = 'silent';
        const ns = (id: string) => id.split('.').pop()!;
        const registered = new Set<string>();
        for (const id of order) {
            const module = id === ONE || id === TWO;
            // The App registers before its first module, after the packages that ship the name ahead of it.
            if (module && !registered.has(SUITE)) {
                engine.registerApp({ id: SUITE, name: 'suite', version: '1.0.0', type: 'app', namespace: 'suite' } as any);
                registered.add(SUITE);
            }
            engine.registerApp({
                id, name: ns(id), version: '1.0.0', type: module ? 'module' : 'app', namespace: ns(id),
                ...(module ? { dependencies: { [SUITE]: '^1.0.0' } } : {}),
                dashboards: [dash(`${ns(id)} shipped`)],
            } as any);
        }
        engine.registerApp({ id: GAMMA, name: 'gamma', version: '1.0.0', type: 'app', namespace: 'gamma' } as any);
        await engine.syncSchemas();
        const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map(), undefined);
        const get = (n: string) => (n === 'protocol' ? protocol : n === 'objectql' ? engine : null);
        const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
        const dispatcher = new HttpDispatcher(kernel);
        (dispatcher as any).timedResolveExecutionContext = async () => clone(AUTHOR);
        const read = async (path: string, query: Record<string, string> = {}) => {
            const res = await dispatcher.dispatch('GET', path, undefined, query, { request: new Request(`http://localhost${PREFIX}${path}`) }, PREFIX);
            return { status: res.response?.status ?? 0, body: res.response?.body };
        };
        const seed = (packageId: string, label: string, overrides?: string) => engine.insert('sys_metadata', {
            name: 'd', type: 'dashboard', namespace: 'default', package_id: packageId, scope: 'platform', strategy: 'merge',
            state: 'active', version: 1,
            metadata: JSON.stringify({ ...dash(label), ...(overrides ? { overrides: { package: overrides, basedOn: '1.0.0' } } : {}) }),
        }, { context: { isSystem: true } } as any);
        return { engine, read, seed };
    }
    const envelope = (body: any) => {
        const item = body?.data?.item ?? body?.item;
        return [item?.label, item?._packageId, item?._provenance];
    };
    const layered = (body: any) => {
        const l = body?.data ?? body;
        return [l?.code?.label ?? null, l?.effective?.label, l?.packageId];
    };

    for (const [order, shippers] of [['alpha first', [ALPHA, BETA]], ['beta first', [BETA, ALPHA]]] as const) {
        it(`alpha's pair override row (${order}): alpha's envelope, alpha's code layer`, async () => {
            const { read, seed } = await bootShippers(shippers);
            await seed(`${ALPHA}.custom`, 'alpha customized', ALPHA);
            const plain = await read('/meta/dashboard/d', { package: `${ALPHA}.custom` });
            expect([plain.status, ...envelope(plain.body)], JSON.stringify(plain.body).slice(0, 400))
                .toEqual([200, 'alpha customized', ALPHA, 'package']);
            const layers = await read('/meta/dashboard/d/layers', { package: `${ALPHA}.custom` });
            expect([layers.status, ...layered(layers.body)], JSON.stringify(layers.body).slice(0, 400))
                .toEqual([200, 'alpha shipped', 'alpha customized', ALPHA]);
        }, 60_000);

        it(`a row bound only to a package that ships nothing (${order}): its own stamp, no shipper's envelope, no code layer`, async () => {
            const { read, seed } = await bootShippers(shippers);
            await seed(GAMMA, 'gamma authored');
            const plain = await read('/meta/dashboard/d', { package: GAMMA });
            expect([plain.status, ...envelope(plain.body)], JSON.stringify(plain.body).slice(0, 400))
                .toEqual([200, 'gamma authored', GAMMA, undefined]);
            const layers = await read('/meta/dashboard/d/layers', { package: GAMMA });
            expect([layers.status, ...layered(layers.body)], JSON.stringify(layers.body).slice(0, 400))
                .toEqual([200, null, 'gamma authored', undefined]);
        }, 60_000);
    }

    it('a row bound only to a package that ships nothing, the only shipper disabled: its own stamp, served, never withheld by the shipper\'s stamp (BASE: 404)', async () => {
        const { engine, read, seed } = await bootShippers([ALPHA]);
        await seed(GAMMA, 'gamma authored');
        engine.registry.disablePackage(ALPHA);
        const plain = await read('/meta/dashboard/d', { package: GAMMA });
        expect([plain.status, ...envelope(plain.body)], JSON.stringify(plain.body).slice(0, 400))
            .toEqual([200, 'gamma authored', GAMMA, undefined]);
        expect(JSON.stringify(plain.body)).not.toContain(ALPHA);
        // …and `/layers` at the same address: the row, no code layer (BASE: 404).
        const layers = await read('/meta/dashboard/d/layers', { package: GAMMA });
        expect([layers.status, ...layered(layers.body)], JSON.stringify(layers.body).slice(0, 400))
            .toEqual([200, null, 'gamma authored', undefined]);
    }, 60_000);

    // Both shapes of the code layer's lookup: another package (alpha) registered
    // ahead of the modules, where it lands on alpha, and a module first with no
    // other shipper, where it landed on that module and `/layers` served it.
    it.each([
        ['alpha, then one', [ALPHA, ONE, TWO]], ['alpha, then two', [ALPHA, TWO, ONE]],
        ['one first, no other shipper', [ONE, TWO]], ['two first, no other shipper', [TWO, ONE]],
    ] as const)('the App pair\'s row, two modules holding the name (%s): its own stamp; `/layers` refuses the ambiguous code layer naming both', async (_order, shippers) => {
        const { read, seed } = await bootShippers(shippers);
        await seed(`${SUITE}.custom`, 'suite pair row', ONE);
        const plain = await read('/meta/dashboard/d', { package: `${SUITE}.custom` });
        expect([plain.status, ...envelope(plain.body)], JSON.stringify(plain.body).slice(0, 400))
            .toEqual([200, 'suite pair row', `${SUITE}.custom`, undefined]);
        const layers = await read('/meta/dashboard/d/layers', { package: `${SUITE}.custom` });
        expect([layers.status, layers.body?.error?.code], JSON.stringify(layers.body).slice(0, 400)).toEqual([409, 'RESOURCE_CONFLICT']);
        for (const id of [ONE, TWO]) expect(String(layers.body?.error?.message)).toContain(`package "${id}"`);
    }, 60_000);

    // [#32808 review S1] No stored row: the App pair's own address is refused on the
    // real engine too. BASE (main 2f80f2897): the module-first cases answered 200
    // with the first registered module's item on both doors; with alpha registered
    // ahead of the modules both doors already answered 409 (the order controls).
    it.each([
        ['one first, no other shipper', [ONE, TWO]], ['two first, no other shipper', [TWO, ONE]],
        ['alpha, then one', [ALPHA, ONE, TWO]], ['alpha, then two', [ALPHA, TWO, ONE]],
    ] as const)('no stored row, two modules of the App holding the name (%s): the App pair is refused naming both, on the plain read and `/layers`', async (_order, shippers) => {
        const { read } = await bootShippers(shippers);
        for (const path of ['/meta/dashboard/d', '/meta/dashboard/d/layers']) {
            const answer = await read(path, { package: `${SUITE}.custom` });
            expect([answer.status, answer.body?.error?.code], `${path} ${JSON.stringify(answer.body).slice(0, 400)}`)
                .toEqual([409, 'RESOURCE_CONFLICT']);
            for (const id of [ONE, TWO]) expect(String(answer.body?.error?.message)).toContain(`package "${id}"`);
        }
        // CONTROL — each module's own address serves its own shipped item.
        for (const id of [ONE, TWO]) {
            const own = await read('/meta/dashboard/d', { package: id });
            expect([own.status, ...envelope(own.body)], JSON.stringify(own.body).slice(0, 400))
                .toEqual([200, `${id.split('.').pop()} shipped`, id, 'package']);
        }
    }, 60_000);
});
