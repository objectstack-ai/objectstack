// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29563, ADR-0146 D8 item 3] "`GET /packages/hotcrm.custom/export` carries
 * the overriding item with its `overrides` block; `GET /packages/hotcrm/export`
 * carries the base unchanged" — for every type a `.custom` pair overrides, not
 * only for views.
 *
 * Measured through the real door (`HttpDispatcher.handlePackages`) over the
 * real protocol and the real `ObjectQL` engine on a SQLite file: the base is
 * registered as a code package, its pair is installed through the package
 * door, and each override goes through the draft save and the per-item
 * publish, as Studio's Customize writes it. Per type (view, dashboard,
 * report):
 *
 *  - the base's export carries the base's own document, with no `overrides`
 *    block;
 *  - the pair's export carries the overriding item with its `overrides` block;
 *  - CONTROL: the effective read of the base's name serves the override, so
 *    the base export's answer is the export's own and not an unpublished
 *    override.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import '../lint-root-preload.testkit.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import { HttpDispatcher } from '../http-dispatcher.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const PLATFORM_PKG = 'com.objectstack.platform';
const DECLARATION = { package: BASE, basedOn: '1.0.0' } as const;

const CALLER: any = {
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] },
};

const VIEW = 'showcase_task.default';
const DASHBOARD = 'showcase_ops_dashboard';
const REPORT = 'showcase_hours_by_status';
const BASE_LABEL = 'Shipped label';
const OVERRIDE_LABEL = 'Edited label';

const viewBody = (label: string) => ({
    name: VIEW,
    object: 'showcase_task',
    viewKind: 'list',
    label,
    config: {
        type: 'grid',
        data: { provider: 'object', object: 'showcase_task' },
        columns: [{ field: 'title' }, { field: 'status' }],
    },
});
const dashboardBody = (label: string) => ({ name: DASHBOARD, label, columns: 12, widgets: [] });
const reportBody = (label: string) => ({
    name: REPORT,
    label,
    type: 'summary',
    dataset: 'showcase_task_metrics',
    rows: ['status'],
    values: ['task_count'],
});

const TYPES = [
    { type: 'view', plural: 'views', name: VIEW, body: viewBody },
    { type: 'dashboard', plural: 'dashboards', name: DASHBOARD, body: dashboardBody },
    { type: 'report', plural: 'reports', name: REPORT, body: reportBody },
] as const;

function baseManifest(): Record<string, unknown> {
    return {
        id: BASE,
        name: 'showcase',
        version: '1.0.0',
        namespace: 'showcase',
        objects: [{
            name: 'showcase_task',
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
            object: 'showcase_task',
            dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
            measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'count' }],
        }],
        // A code package's `views:` carry containers; its `list` expands to `showcase_task.default`.
        views: [{
            object: 'showcase_task',
            list: { label: BASE_LABEL, type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: viewBody(BASE_LABEL).config.columns },
        }],
        dashboards: [dashboardBody(BASE_LABEL)],
        reports: [reportBody(BASE_LABEL)],
    };
}

let cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
    for (const c of cleanup.reverse()) await c();
    cleanup = [];
});

const envSnapshot = { OS_HOME: process.env.OS_HOME, OS_METADATA_WRITABLE: process.env.OS_METADATA_WRITABLE };
let home: string;
beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'os-29563-home-'));
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

async function boot() {
    const dir = mkdtempSync(join(tmpdir(), 'os-29563-db-'));
    cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
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
    engine.registerApp(baseManifest());

    const services = new Map<string, unknown>([['objectql', engine]]);
    const protocol: any = new ObjectStackProtocolImplementation(engine as any, () => services as any);
    services.set('protocol', protocol);
    const get = (name: string) => services.get(name) ?? null;
    const dispatcher = new HttpDispatcher({ context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) } as any);

    await protocol.installPackage({
        manifest: {
            id: PAIR, name: 'showcase-custom', version: '0.1.0', type: 'app',
            namespace: 'showcase_custom', dependencies: { [BASE]: '^1' },
        },
    });

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

/** The exported items of one type under `name`, the view partition (`views` + `viewItems`) read together. */
const itemsOf = (manifest: Record<string, any>, plural: string, name: string): any[] => {
    const all = plural === 'views'
        ? [...(manifest.views ?? []), ...(manifest.viewItems ?? [])]
        : [...(manifest[plural] ?? [])];
    return all.filter((item) => item?.name === name);
};

describe('[#29563] GET /packages/<base>/export carries the base unchanged for every overridden type', () => {
    for (const { type, plural, name, body } of TYPES) {
        it(`${type}: the base's export carries the base's document; the pair's export carries the override with its \`overrides\` block`, async () => {
            const door = await boot();
            await door.override(type, name, { ...body(OVERRIDE_LABEL), overrides: { ...DECLARATION } });

            // CONTROL: the effective read of the base's name serves the published override.
            const effective: any = await door.protocol.getMetaItem({ type, name, packageId: BASE });
            expect(effective?.item?.label, `the effective ${type} read`).toBe(OVERRIDE_LABEL);

            const base = itemsOf(await door.exported(BASE), plural, name);
            expect(base.map((item) => item.label), `the base's ${type} export`).toEqual([BASE_LABEL]);
            expect(base[0].overrides).toBeUndefined();

            const pair = itemsOf(await door.exported(PAIR), plural, name);
            expect(pair.map((item) => item.label), `the pair's ${type} export`).toEqual([OVERRIDE_LABEL]);
            expect(pair[0].overrides).toEqual(DECLARATION);
        });
    }
});
