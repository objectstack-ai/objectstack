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

async function boot() {
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
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => new Map());

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

describe('[#29594] merge question 12: a legacy per-package pair of an App\'s module is honoured as before', () => {
    it('the pair still saves a declared override of the module\'s item (the write gate admits it)', async () => {
        const { protocol, read } = await boot();
        await protocol.saveMetaItem({
            type: 'dashboard', name: BOARD, packageId: LEGACY_PAIR,
            item: { ...board(CUSTOMIZED), overrides: { package: MODULE, basedOn: '6.1.0' } },
        });
        const byName = await read(`/meta/dashboard/${BOARD}`, { package: MODULE });
        expect([byName.status, labelOf(byName.body)]).toEqual([200, CUSTOMIZED]);
    }, 60_000);

    it('its declared override is served at the module\'s address (by name, list, layered); it removes it, and the module\'s item is served again', async () => {
        const { read, remove, seedLegacyOverride } = await boot();

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
        const { read, remove, seedLegacyOverride } = await boot();
        await seedLegacyOverride('doc', guide(CUSTOMIZED));
        const byName = await read(`/meta/doc/${GUIDE}`, { package: MODULE });
        expect([byName.status, labelOf(byName.body)], JSON.stringify(byName.body).slice(0, 400)).toEqual([200, CUSTOMIZED]);

        const removed = await remove('doc', GUIDE, { package: LEGACY_PAIR });
        expect(removed.status, JSON.stringify(removed.body).slice(0, 600)).toBe(200);
        const after = await read(`/meta/doc/${GUIDE}`, { package: MODULE });
        expect([after.status, labelOf(after.body)]).toEqual([200, SHIPPED]);
    }, 60_000);
});
