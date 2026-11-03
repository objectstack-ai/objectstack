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
 * 4 → 3, views 36 → 36.
 *
 * Per type (view, dashboard, report), over the real door
 * (`HttpDispatcher.handlePackages`), the real protocol, the real `ObjectQL`
 * engine on a SQLite file and the real `MetadataManager`:
 *
 *  - the base's export after the override is published is byte-identical to
 *    the base's export before it, so the item is present and equal, and no
 *    item in it carries an `overrides` block;
 *  - the same holds on a restart over the same database;
 *  - the pair's export carries the overriding item with its `overrides` block;
 *  - CONTROL: the effective read of the base's name serves the override, so
 *    the base export's answer is the export's own.
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

const TYPES = [
    { type: 'view', plural: 'viewItems', name: VIEW },
    { type: 'dashboard', plural: 'dashboards', name: DASHBOARD },
    { type: 'report', plural: 'reports', name: REPORT },
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
        views: [viewContainer()],
        dashboards: dashboards(),
        reports: reports(),
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
    for (const dashboard of body.dashboards) await manager.register('dashboard', dashboard.name, stamp(dashboard), { notify: false });
    for (const item of body.reports) await manager.register('report', item.name, stamp(item), { notify: false });
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
    for (const { type, plural, name } of TYPES) {
        it(`${type}: the base's export is byte-identical with the override published, and after a restart`, async () => {
            const dir = mkdtempSync(join(tmpdir(), 'os-29649-db-'));
            cleanup.push(() => rmSync(dir, { recursive: true, force: true }));

            const door = await boot(dir, { installPair: true });
            const before = await door.exported(BASE);
            const shipped = itemsOf(before, plural, name);
            expect(shipped, `the base's ${type} before the override`).toHaveLength(1);

            await door.override(type, name, { ...shipped[0], label: OVERRIDE_LABEL, overrides: { ...DECLARATION } });

            // CONTROL: the effective read of the base's name serves the published override.
            const effective: any = await door.protocol.getMetaItem({ type, name, packageId: BASE });
            expect(effective?.item?.label, `the effective ${type} read`).toBe(OVERRIDE_LABEL);

            const after = await door.exported(BASE);
            expect(itemsOf(after, plural, name), `the base's ${type} with the override live`).toEqual(shipped);
            expect(overridingItems(after), `the base's export carries no override`).toEqual([]);
            expect(JSON.stringify(after), `the base's whole export with the ${type} override live`).toBe(JSON.stringify(before));

            const pair = itemsOf(await door.exported(PAIR), plural, name);
            expect(pair.map((item) => item.label), `the pair's ${type} export`).toEqual([OVERRIDE_LABEL]);
            expect(pair[0].overrides).toEqual(DECLARATION);

            // A restart over the same database: the published row is hydrated from storage.
            const restarted = await boot(dir, { installPair: false });
            expect(JSON.stringify(await restarted.exported(BASE)), `the base's whole export after a restart`).toBe(JSON.stringify(before));
        });
    }
});
