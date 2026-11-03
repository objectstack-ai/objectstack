// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29649, ADR-0146 D8 item 3] "`GET /packages/hotcrm/export` carries the base
 * unchanged" while its `.custom` pair's override of an item is live — on a base
 * booted as the showcase boots, where the base's code documents are held twice:
 * by the registry (`ObjectQL.registerApp`) AND by the metadata service
 * (`MetadataPlugin`'s artifact door, which stamps each body with the base's
 * envelope before it stores it).
 *
 * That second holder is what the #29563 pin
 * (`packages-export-base-unchanged-per-type.integration.test.ts`) does not
 * register, and why it stayed green while a real showcase boot lost the item:
 * the per-package layer merges the registry's items over the metadata
 * service's, one per `(name, package)` slot, and the published override is
 * registered in the registry's bare slot wearing the base's envelope (#29600).
 * So the base's slot of the name holds the override alone, and the export's
 * "never an override of THIS package" filter (#29563) left nothing in it.
 * Measured on a real showcase boot at b391feb1: dashboards 3 → 2, reports
 * 4 → 3, views 36 → 36. #29640 (7dae3b3c) took the dashboard and report copy
 * out of the bare slot; on a real showcase boot at 7dae3b3c a published page,
 * app, dataset, doc or book override still dropped the item (pages 29 → 28,
 * apps 1 → 0, datasets 4 → 3, docs 8 → 7, books 1 → 0).
 *
 * Per type (view, dashboard, report, and the five types #29640 left in the
 * registry's bare slot: page, app, dataset, doc, book), over the real door
 * (`HttpDispatcher.handlePackages`), the real protocol, the real `ObjectQL`
 * engine on a SQLite file and the real `MetadataManager`:
 *
 *  - the base's export after the override is published is byte-identical to
 *    the base's export before it, so the item is present and equal, and no
 *    item in it carries an `overrides` block;
 *  - the same holds on a restart over the same database;
 *  - the pair's export carries the overriding item with its `overrides` block
 *    (every type since #29613; see `pairServed`);
 *  - CONTROL: the pair's override row is published, and the effective read of
 *    the base's name serves it, so the base export's answer is the export's
 *    own.
 *
 * [#29903] A second describe pins the same rule for an object the pair
 * EXTENDS (ADR-0146 D10: objects are extended, never replaced). The published
 * extension adds `region__c` and relabels a base field; the registry folds it
 * into the base's object, and the per-package layer the export reads served
 * that merged object, so the base's export carried the customer's field and
 * label as if the base shipped them. Now the base's export is byte-identical to
 * its export before the extension (and after a restart that hydrates the
 * extension from storage), the pair's export carries the extension as its
 * `objectExtensions` entry, and the served object reads keep the merged field
 * and label.
 *
 * [#29872] A third describe pins the same rule for an extension a manifest
 * declares: a package installed the way install-local installs one
 * (`ObjectQL.registerApp`, which registers the manifest's `objectExtensions`
 * as `'extend'` contributors and files no `object_extension` item). Its export
 * carried no `objectExtensions`, and the base's export carried its field
 * instead. Now the extender's export carries the entry, the base's export is
 * byte-identical to its export before the extender was installed (with the
 * pair's extension published beside it, and after a restart), and the served
 * object reads keep the field.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { MetadataManager } from '@objectstack/metadata';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import { applyProtection } from '@objectstack/spec/shared';
import { expandViewContainer } from '@objectstack/spec/ui';
import { HttpDispatcher } from '../http-dispatcher.js';

const BASE = 'com.example.showcase';
const BASE_VERSION = '0.1.0';
const PAIR = 'com.example.showcase.custom';
const PLATFORM_PKG = 'com.objectstack.platform';
const DECLARATION = { package: BASE, basedOn: BASE_VERSION } as const;

const CALLER: any = {
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
};

const OBJECT = 'showcase_task';
const VIEW = `${OBJECT}.in_progress`;
const DASHBOARD = 'showcase_ops_dashboard';
const REPORT = 'showcase_hours_by_status';
const OVERRIDE_LABEL = 'Edited label';

const COLUMNS = [{ field: 'title' }, { field: 'status' }];
const viewContainer = () => ({
    object: OBJECT,
    list: { label: 'All Tasks', type: 'grid', data: { provider: 'object', object: OBJECT }, columns: COLUMNS },
    listViews: {
        in_progress: { label: 'In Progress', type: 'grid', data: { provider: 'object', object: OBJECT }, columns: COLUMNS },
    },
});
const dashboards = () => [
    { name: 'showcase_chart_gallery', label: 'Chart Gallery', columns: 12, widgets: [] },
    { name: DASHBOARD, label: 'Delivery Operations', columns: 12, widgets: [] },
    { name: 'showcase_revenue_pulse', label: 'Revenue Pulse', columns: 12, widgets: [] },
];
const report = (name: string, label: string) => ({
    name,
    label,
    type: 'summary',
    dataset: 'showcase_task_metrics',
    rows: ['status'],
    values: ['task_count'],
});
const reports = () => [
    report(REPORT, 'Hours by Status'),
    report('showcase_task_overview', 'Task Overview'),
];

/**
 * The base's collections the metadata service holds besides its views, as the
 * artifact door files them: plural collection → metadata type. Every one is a
 * type a `.custom` pair can publish an override of.
 */
const SERVICE_COLLECTIONS = {
    apps: 'app',
    pages: 'page',
    datasets: 'dataset',
    dashboards: 'dashboard',
    reports: 'report',
    docs: 'doc',
    books: 'book',
} as const;

/**
 * `pairServed`: whether the pair's export and the effective read serve the
 * override. [#29613] True for every type: page, app, dataset, doc and book
 * were false while the reads declined their pair override as a sealed overlay
 * (the pair's per-package layer listed none of them, and on this boot shape,
 * with a `MetadataManager`, the effective read served the base's document).
 * The reads now serve it from its row, as a dashboard's.
 */
const TYPES = [
    { type: 'view', plural: 'viewItems', name: VIEW, pairServed: true },
    { type: 'dashboard', plural: 'dashboards', name: DASHBOARD, pairServed: true },
    { type: 'report', plural: 'reports', name: REPORT, pairServed: true },
    { type: 'page', plural: 'pages', name: 'showcase_start_here', pairServed: true },
    { type: 'app', plural: 'apps', name: 'showcase_app', pairServed: true },
    { type: 'dataset', plural: 'datasets', name: 'showcase_task_metrics', pairServed: true },
    { type: 'doc', plural: 'docs', name: 'showcase_index', pairServed: true },
    { type: 'book', plural: 'books', name: 'showcase_manual', pairServed: true },
] as const;

/** The base's body, as the showcase's `defineStack` carries it: one fresh copy per reader. */
function baseBody(): Record<string, any> {
    return {
        id: BASE,
        name: 'showcase',
        version: BASE_VERSION,
        namespace: 'showcase',
        objects: [{
            name: OBJECT,
            label: 'Task',
            sharingModel: 'private',
            fields: {
                title: { name: 'title', label: 'Title', type: 'text' },
                status: { name: 'status', label: 'Status', type: 'text' },
            },
        }],
        datasets: [{
            name: 'showcase_task_metrics',
            label: 'Task Metrics',
            object: OBJECT,
            dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
            measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'count' }],
        }],
        apps: [{ name: 'showcase_app', label: 'Showcase', navigation: [] }],
        pages: [
            { name: 'showcase_capability_map', label: 'Capability Map', type: 'app', regions: [] },
            { name: 'showcase_start_here', label: 'Start Here', type: 'app', regions: [] },
        ],
        views: [viewContainer()],
        dashboards: dashboards(),
        reports: reports(),
        docs: [
            { name: 'showcase_docs_guide', label: 'Docs Guide', content: '# Docs guide' },
            { name: 'showcase_index', label: 'Showcase', content: '# Showcase' },
        ],
        books: [{ name: 'showcase_manual', label: 'Showcase Manual', groups: [] }],
    };
}

/**
 * The metadata service's copy of the base's documents, stored as
 * `MetadataPlugin`'s artifact door stores them: each body stamped with the
 * base's envelope (`applyProtection`), a view container under its object and
 * each view it expands to under its own name.
 */
async function metadataServiceOf(): Promise<MetadataManager> {
    const manager = new MetadataManager({ formats: ['json'], loaders: [] });
    const body = baseBody();
    const stamp = <T extends Record<string, any>>(item: T): T =>
        applyProtection(item as any, { packageId: BASE, packageVersion: BASE_VERSION }) as T;
    for (const container of body.views) {
        await manager.register('view', OBJECT, stamp(container), { notify: false });
        for (const view of expandViewContainer(OBJECT, container)) {
            await manager.register('view', view.name, stamp(view as any), { notify: false });
        }
    }
    for (const [plural, type] of Object.entries(SERVICE_COLLECTIONS)) {
        for (const item of body[plural]) await manager.register(type, item.name, stamp(item), { notify: false });
    }
    return manager;
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanup.reverse()) await c();
    cleanup = [];
});

const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_METADATA_WRITABLE: process.env.OS_METADATA_WRITABLE };
let home: string;
beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-29649-home-'));
    process.env.OS_HOME = home;
});
afterAll(() => {
    for (const [k, v] of Object.entries(envSnapshot)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
    }
    rmSync(home, { recursive: true, force: true });
});
beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); });

/** One boot over the SQLite file in `dir`; the pair is installed on the first boot only. */
async function boot(dir: string, { installPair }: { installPair: boolean }) {
    const driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: join(dir, 'data.sqlite') },
        useNullAsDefault: true,
    });
    const objects = [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject] as any[];
    await driver.initObjects(objects);

    const engine = new ObjectQL();
    engine.registerDriver(driver as any, true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o, PLATFORM_PKG);
    cleanup.push(() => engine.destroy());
    engine.registerApp(baseBody());

    const services = new Map<string, unknown>([['objectql', engine], ['metadata', await metadataServiceOf()]]);
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => services as any);
    services.set('protocol', protocol);
    const get = (name: string) => services.get(name) ?? null;
    const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);

    if (installPair) {
        await protocol.installPackage({
            manifest: {
                id: PAIR, name: 'showcase-custom', version: '0.1.0', type: 'app',
                namespace: 'showcase_custom', dependencies: { [BASE]: '^0' },
            },
        });
    }

    return {
        protocol,
        engine,
        /** [#29903] `GET /meta/<path>` through the door, as the console reads it. */
        async served(path: string): Promise<any> {
            const res = await dispatcher.handleMetadata(path, CALLER, 'GET');
            expect(res.response?.status, JSON.stringify(res.response?.body)).toBe(200);
            const body: any = JSON.parse(JSON.stringify(res.response?.body ?? null));
            return body?.data ?? body;
        },
        /** The pair's active (published) rows of `(type, name)`, read off the store. */
        async publishedRows(type: string, name: string): Promise<unknown[]> {
            return await driver.find('sys_metadata', { where: { type, name, package_id: PAIR, state: 'active' } });
        },
        async exported(id: string): Promise<Record<string, any>> {
            const res = await dispatcher.handlePackages(`/${encodeURIComponent(id)}/export`, 'GET', undefined, {}, CALLER);
            expect(res.response?.status, JSON.stringify(res.response?.body)).toBe(200);
            const body: any = JSON.parse(JSON.stringify(res.response?.body ?? null));
            return body?.data ?? body;
        },
        async override(type: string, name: string, item: Record<string, unknown>) {
            const saved = await protocol.saveMetaItem({ type, name, item, mode: 'draft', packageId: PAIR });
            expect(saved?.success, `the ${type} draft save`).toBe(true);
            await protocol.publishMetaItem({ type, name, packageId: PAIR });
        },
    };
}

const itemsOf = (manifest: Record<string, any>, plural: string, name: string): any[] =>
    (manifest[plural] ?? []).filter((item: any) => item?.name === name);

/** Every exported item, across the collections, that carries an `overrides` block. */
const overridingItems = (manifest: Record<string, any>): string[] => Object.entries(manifest)
    .filter(([, value]) => Array.isArray(value))
    .flatMap(([plural, value]) => (value as any[])
        .filter((item) => item && typeof item === 'object' && 'overrides' in item)
        .map((item) => `${plural}/${item.name}`));

describe('[#29649] GET /packages/<base>/export carries the base unchanged on a showcase-shaped boot', () => {
    for (const { type, plural, name, pairServed } of TYPES) {
        it(`${type}: the base's export is byte-identical with the override published, and after a restart`, async () => {
            const dir = mkdtempSync(join(tmpdir(), 'os-29649-db-'));
            cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

            const door = await boot(dir, { installPair: true });
            const before = await door.exported(BASE);
            const shipped = itemsOf(before, plural, name);
            expect(shipped, `the base's ${type} before the override`).toHaveLength(1);

            await door.override(type, name, { ...shipped[0], label: OVERRIDE_LABEL, overrides: { ...DECLARATION } });

            // CONTROL: the override is published, and, where the protocol serves
            // it, the effective read of the base's name serves it.
            expect(await door.publishedRows(type, name), `the pair's published ${type} row`).toHaveLength(1);
            if (pairServed) {
                const effective: any = await door.protocol.getMetaItem({ type, name, packageId: BASE });
                expect(effective?.item?.label, `the effective ${type} read`).toBe(OVERRIDE_LABEL);
            }

            const after = await door.exported(BASE);
            expect(itemsOf(after, plural, name), `the base's ${type} with the override live`).toEqual(shipped);
            expect(overridingItems(after), `the base's export carries no override`).toEqual([]);
            expect(JSON.stringify(after), `the base's whole export with the ${type} override live`).toBe(JSON.stringify(before));

            if (pairServed) {
                const pair = itemsOf(await door.exported(PAIR), plural, name);
                expect(pair.map((item) => item.label), `the pair's ${type} export`).toEqual([OVERRIDE_LABEL]);
                expect(pair[0].overrides).toEqual(DECLARATION);
            }

            // A restart over the same database: the published row is hydrated from storage.
            const restarted = await boot(dir, { installPair: false });
            expect(JSON.stringify(await restarted.exported(BASE)), `the base's whole export after a restart`).toBe(JSON.stringify(before));
        });
    }
});

const EXTENSION_FIELD = 'region__c';
const PATCHED_LABEL = 'Title (customized)';
/** Studio's add-field body on the base's object: an extension in the pair, its field suffixed, a base field relabelled. */
const extensionBody = () => ({
    extend: OBJECT,
    fields: { [EXTENSION_FIELD]: { type: 'text', label: 'Region' } },
    fieldPatches: { title: { label: PATCHED_LABEL } },
});

describe('[#29903] GET /packages/<base>/export carries the base\'s object without its pair\'s extension', () => {
    const objectOf = (manifest: Record<string, any>) => itemsOf(manifest, 'objects', OBJECT);
    /** The object as `GET /meta/object/<name>` and `GET /meta/object` serve it. */
    const servedObject = async (door: Awaited<ReturnType<typeof boot>>) => {
        const byName: any = await door.served(`/object/${OBJECT}`);
        const list: any = await door.served('/object');
        const listed = (Array.isArray(list) ? list : list?.items ?? []).find((o: any) => o?.name === OBJECT);
        return [byName?.item ?? byName, listed].map((o) => ({ field: !!o?.fields?.[EXTENSION_FIELD], title: o?.fields?.title?.label }));
    };

    it('the base\'s export is byte-identical with the extension published, and after a restart that hydrates it', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-29903-db-'));
        cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

        const door = await boot(dir, { installPair: true });
        const before = await door.exported(BASE);
        expect(objectOf(before), 'the base\'s object before the extension').toHaveLength(1);
        expect(Object.keys(objectOf(before)[0].fields)).not.toContain(EXTENSION_FIELD);

        await door.override('object_extension', OBJECT, extensionBody());
        // CONTROL: the extension is published, and both served object reads fold it in.
        expect(await door.publishedRows('object_extension', OBJECT), 'the pair\'s published extension row').toHaveLength(1);
        const merged = [{ field: true, title: PATCHED_LABEL }, { field: true, title: PATCHED_LABEL }];
        expect(await servedObject(door), 'GET /meta/object/<name> and GET /meta/object').toEqual(merged);

        const after = await door.exported(BASE);
        expect(objectOf(after), 'the base\'s object with the extension live').toEqual(objectOf(before));
        expect(Object.keys(objectOf(after)[0].fields)).not.toContain(EXTENSION_FIELD);
        expect(objectOf(after)[0].fields.title.label).toBe('Title');
        expect(after.objectExtensions, 'the base\'s export carries no extension').toBeUndefined();
        expect(JSON.stringify(after), 'the base\'s whole export with the extension live').toBe(JSON.stringify(before));

        const pair = await door.exported(PAIR);
        expect(pair.objectExtensions, 'the pair\'s export carries the extension').toEqual([extensionBody()]);
        expect(pair.objects, 'the pair owns no object').toBeUndefined();

        // A restart over the same database: the published extension is hydrated
        // from storage and folds into the served object again.
        const restarted = await boot(dir, { installPair: false });
        const hydrated = await restarted.protocol.loadMetaFromDb();
        expect(hydrated?.errors, 'the boot pull').toBe(0);
        expect(await servedObject(restarted), 'the served object reads after the restart').toEqual(merged);
        expect(JSON.stringify(await restarted.exported(BASE)), 'the base\'s whole export after a restart').toBe(JSON.stringify(before));
    });
});

const EXTENDER = 'com.acme.showcase-billing';
const EXTENDER_FIELD = 'acme_billing_code';
/** An installed package's manifest entry extending the base's object, as install-local registers it. */
const manifestExtension = () => ({ extend: OBJECT, fields: { [EXTENDER_FIELD]: { type: 'text', label: 'Billing code' } } });
const extenderManifest = () => ({
    id: EXTENDER, name: 'acme-billing', version: '1.0.0', type: 'app',
    namespace: 'acme_billing', dependencies: { [BASE]: '^0' },
    objectExtensions: [manifestExtension()],
});

describe('[#29872] an installed package\'s export carries its manifest objectExtensions, and the base\'s export does not', () => {
    const objectOf = (manifest: Record<string, any>) => itemsOf(manifest, 'objects', OBJECT);
    const servedFields = async (door: Awaited<ReturnType<typeof boot>>) => {
        const byName: any = await door.served(`/object/${OBJECT}`);
        const list: any = await door.served('/object');
        const listed = (Array.isArray(list) ? list : list?.items ?? []).find((o: any) => o?.name === OBJECT);
        return [byName?.item ?? byName, listed].map((o) => ({ extender: !!o?.fields?.[EXTENDER_FIELD], pair: !!o?.fields?.[EXTENSION_FIELD] }));
    };

    it('the extender exports its entry, the base exports unchanged beside the pair\'s extension, and after a restart', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-29872-db-'));
        cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

        const door = await boot(dir, { installPair: true });
        const before = await door.exported(BASE);
        door.engine.registerApp(extenderManifest());
        await door.override('object_extension', OBJECT, extensionBody());

        // CONTROL: both served object reads fold the extender's field and the pair's in.
        const merged = [{ extender: true, pair: true }, { extender: true, pair: true }];
        expect(await servedFields(door), 'GET /meta/object/<name> and GET /meta/object').toEqual(merged);

        const extender = await door.exported(EXTENDER);
        expect(extender.objectExtensions, 'the extender\'s export carries its manifest entry').toEqual([manifestExtension()]);
        expect(extender.objects, 'the extender owns no object').toBeUndefined();
        expect(extender.dependencies).toEqual({ [BASE]: '^0' });

        const after = await door.exported(BASE);
        expect(Object.keys(objectOf(after)[0].fields)).not.toContain(EXTENDER_FIELD);
        expect(Object.keys(objectOf(after)[0].fields)).not.toContain(EXTENSION_FIELD);
        expect(after.objectExtensions, 'the base\'s export carries no extension').toBeUndefined();
        expect(JSON.stringify(after), 'the base\'s whole export with both extensions live').toBe(JSON.stringify(before));

        // The pair's export carries its own extension only, once: its stored item.
        expect((await door.exported(PAIR)).objectExtensions).toEqual([extensionBody()]);

        // A restart over the same database: the extender is registered again (install-local
        // replays its stored manifest), the pair's extension is hydrated from storage.
        const restarted = await boot(dir, { installPair: false });
        restarted.engine.registerApp(extenderManifest());
        const hydrated = await restarted.protocol.loadMetaFromDb();
        expect(hydrated?.errors, 'the boot pull').toBe(0);
        expect(await servedFields(restarted), 'the served object reads after the restart').toEqual(merged);
        expect((await restarted.exported(EXTENDER)).objectExtensions).toEqual([manifestExtension()]);
        expect((await restarted.exported(PAIR)).objectExtensions).toEqual([extensionBody()]);
        expect(JSON.stringify(await restarted.exported(BASE)), 'the base\'s whole export after a restart').toBe(JSON.stringify(before));
    });

    it('an extender installed from its own export re-exports the same entry (the second hop)', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'os-29872-hop-'));
        cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

        const source = await boot(dir, { installPair: false });
        source.engine.registerApp(extenderManifest());
        const first = await source.exported(EXTENDER);

        const targetDir = mkdtempSync(join(tmpdir(), 'os-29872-hop-target-'));
        cleanup.push(() => rmSync(targetDir, { recursive: true, force: true }));
        const target = await boot(targetDir, { installPair: false });
        target.engine.registerApp(JSON.parse(JSON.stringify(first)));
        const second = await target.exported(EXTENDER);
        expect(second.objectExtensions).toEqual([manifestExtension()]);
        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
});
