// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29600, ADR-0146 D8] A `.custom` pair's published override of a base's
 * dashboard, report or email template is not registered in the registry's
 * bare slot wearing the BASE's envelope, so the per-package layer lists the
 * base's own item only under the base and the override only under the pair.
 * `view` has held this since #22057 and is pinned here beside them.
 *
 * Before the fix the hydrator (`hydrateOverlayIntoRegistry`) registered the
 * pair's row under the bare name, and the artifact lookup, scoped to the pair,
 * fell back to the base's code artifact, so the bare entry carried the base's
 * `_packageId` and `_provenance: 'package'`. The base's per-package layer (the
 * read the base's export takes) then listed two items of the name.
 *
 * Pinned per type:
 *
 *  - the per-package layer naming the base lists the base's item alone, and
 *    the layer naming the pair lists the override alone;
 *  - the registry's bare-name read answers the base's own item, not a copy of
 *    the override under the base's envelope;
 *  - every protocol read that served the override before still serves it: the
 *    by-name read (no package, the base, the pair), the effective list (no
 *    package, the base) and the layered read naming the base;
 *  - CONTROL (#4624, ADR-0048): a row bound to a package that ships its OWN
 *    artifact of a name another package also ships keeps its bare entry, with
 *    its own body and its own package's envelope.
 *
 * Why this file is in `objectql` and not in `metadata-protocol`, where the
 * fix is: the question is the real `SchemaRegistry`'s bare slot against its
 * package entries, and `metadata-protocol` tests cannot import
 * `@objectstack/objectql` (objectql depends on metadata-protocol). The
 * harness is `protocol-per-package-layer-provenance.test.ts`'s: the real
 * protocol over the real `ObjectQL` engine and an in-memory driver.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
/** A second code package shipping the dashboard name too (the #4624 control). */
const OTHER = 'com.example.other';
const DECLARATION = { package: BASE, basedOn: '1.0.0' };
const SHIPPED = 'Shipped label';
const EDITED = 'Edited label';

const sysMetadataObject: ServiceObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        bundle_member: { name: 'bundle_member', label: 'Bundle Member', type: 'text' as const, maxLength: 100 },
        metadata: { name: 'metadata', label: 'Body', type: 'textarea' as const },
        draft_changes: { name: 'draft_changes', label: 'Draft Changes', type: 'textarea' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

function makeMemoryDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;
    const matchesWhere = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k === '$and' && Array.isArray(v)) {
                if (!v.every((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k === '$or' && Array.isArray(v)) {
                if (!v.some((w: any) => matchesWhere(row, w))) return false;
                continue;
            }
            if (k.startsWith('$')) continue;
            const rowVal = row[k];
            if (v && typeof v === 'object' && Array.isArray((v as any).$in)) {
                if (!(v as any).$in.includes(rowVal === undefined ? null : rowVal)) return false;
                continue;
            }
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {} as any,
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const cur = s.get(id);
            if (!cur) throw new Error(`not found: ${object}/${id}`);
            const updated = { ...cur, ...data, id };
            s.set(id, updated);
            return updated;
        },
        async upsert(object: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            if (id && storeFor(object).has(id)) return this.update(object, id, data);
            return this.create(object, data);
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count(object: string, ast: any) { return (await this.find(object, ast)).length; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver };
}

const VIEW = 'showcase_task.default';
const DASHBOARD = 'showcase_ops_dashboard';
const REPORT = 'showcase_hours_by_status';
const EMAIL = 'showcase_digest';

const viewBody = (label: string) => ({
    name: VIEW, object: 'showcase_task', viewKind: 'list', label,
    config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: [{ field: 'title' }] },
});
const dashboardBody = (label: string) => ({ name: DASHBOARD, label, columns: 12, widgets: [] });
const reportBody = (label: string) => ({
    name: REPORT, label, type: 'summary', dataset: 'showcase_task_metrics', rows: ['status'], values: ['task_count'],
});
const emailBody = (label: string) => ({ name: EMAIL, label, subject: 'Digest', bodyHtml: '<p>Digest</p>' });

/** Per type: the name, its body, and the registry key of its bare slot (a bundle keys its member). */
const TYPES = [
    { type: 'view', name: VIEW, body: viewBody, bareKey: VIEW },
    { type: 'dashboard', name: DASHBOARD, body: dashboardBody, bareKey: DASHBOARD },
    { type: 'report', name: REPORT, body: reportBody, bareKey: REPORT },
    { type: 'email_template', name: EMAIL, body: emailBody, bareKey: `${EMAIL}@en-US` },
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
            list: { label: SHIPPED, type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: [{ field: 'title' }, { field: 'status' }] },
        }],
        dashboards: [dashboardBody(SHIPPED)],
        reports: [reportBody(SHIPPED)],
        emailTemplates: [emailBody(SHIPPED)],
    };
}

async function boot(extraManifests: Record<string, unknown>[] = []) {
    const engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(baseManifest());
    for (const m of extraManifests) engine.registerApp(m);
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map());
    await protocol.installPackage({
        manifest: {
            id: PAIR, name: 'showcase-custom', version: '0.1.0', type: 'app',
            namespace: 'showcase_custom', dependencies: { [BASE]: '^1' },
        },
    });
    return { engine, protocol };
}

/** Studio's Customize: a draft save into the pair declaring the override, then the per-item publish. */
async function publishOverride(protocol: any, type: string, name: string, item: Record<string, unknown>): Promise<void> {
    const saved = await protocol.saveMetaItem({ type, name, item: { ...item, overrides: DECLARATION }, mode: 'draft', packageId: PAIR });
    expect(saved?.success, `the ${type} draft save`).toBe(true);
    const published = await protocol.publishMetaItem({ type, name, packageId: PAIR });
    expect(published?.success, `the ${type} publish`).toBe(true);
}

/** `label/_packageId`, the two facts each reading is judged by. */
const reading = (item: any): string | null => (item ? `${item.label}/${item._packageId ?? '-'}` : null);

const perPackage = async (protocol: any, type: string, name: string, packageId?: string): Promise<string[]> =>
    ((await protocol.getMetaItemsPerPackage({ type, ...(packageId ? { packageId } : {}) }))?.items ?? [])
        .filter((i: any) => i?.name === name)
        .map((i: any) => i.label)
        .sort();

const effectiveList = async (protocol: any, type: string, name: string, packageId?: string): Promise<string[]> =>
    ((await protocol.getMetaItems({ type, ...(packageId ? { packageId } : {}) }))?.items ?? [])
        .filter((i: any) => i?.name === name)
        .map((i: any) => i.label);

const byName = async (protocol: any, type: string, name: string, packageId?: string): Promise<unknown> =>
    (await protocol.getMetaItem({ type, name, ...(packageId ? { packageId } : {}) }))?.item?.label;

const savedWritable = process.env.OS_METADATA_WRITABLE;
beforeEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});
afterEach(() => {
    if (savedWritable === undefined) delete process.env.OS_METADATA_WRITABLE;
    else process.env.OS_METADATA_WRITABLE = savedWritable;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

describe('[#29600] a pair\'s published override never takes the base\'s envelope in the registry\'s bare slot', () => {
    for (const { type, name, body, bareKey } of TYPES) {
        it(`${type}: the base's per-package layer lists the base's item alone, the pair's the override alone`, async () => {
            const { engine, protocol } = await boot();
            await publishOverride(protocol, type, name, body(EDITED));

            expect(await perPackage(protocol, type, name, BASE), `the base's ${type} layer`).toEqual([SHIPPED]);
            expect(await perPackage(protocol, type, name, PAIR), `the pair's ${type} layer`).toEqual([EDITED]);
            expect(await perPackage(protocol, type, name), `the unscoped ${type} layer`).toEqual([EDITED, SHIPPED]);

            // The registry holds no copy of the override under the bare key, so its
            // bare-name read answers the base's own item, with the base's envelope.
            const bare = (engine.registry as any).metadata.get(type)?.get(bareKey);
            expect(bare, `the ${type} bare slot`).toBeUndefined();
            expect(reading(engine.registry.getItem(type, name)), `the ${type} bare-name read`).toBe(`${SHIPPED}/${BASE}`);
        });

        it(`${type}: every protocol read that serves the override still serves it`, async () => {
            const { protocol } = await boot();
            await publishOverride(protocol, type, name, body(EDITED));

            expect(await byName(protocol, type, name), `${type} by name, no package`).toBe(EDITED);
            expect(await byName(protocol, type, name, BASE), `${type} by name, the base`).toBe(EDITED);
            expect(await byName(protocol, type, name, PAIR), `${type} by name, the pair`).toBe(EDITED);
            expect(await effectiveList(protocol, type, name), `${type} list, no package`).toEqual([EDITED]);
            expect(await effectiveList(protocol, type, name, BASE), `${type} list, the base`).toEqual([EDITED]);
            const layered = await protocol.getMetaItemLayered({ type, name, packageId: BASE });
            expect(layered?.effective?.label, `${type} layered, the base`).toBe(EDITED);
        });
    }

    it('CONTROL (#4624): a row bound to a package that ships its own artifact of a two-shipper name keeps its bare entry and its own envelope', async () => {
        const other = { id: OTHER, name: 'other', version: '1.0.0', namespace: 'other', dashboards: [dashboardBody('Other shipped')] };
        const { engine, protocol } = await boot([other]);
        // A stored row of OTHER's own dashboard, as the boot hydration reads it.
        await engine.insert('sys_metadata', {
            type: 'dashboard', name: DASHBOARD, organization_id: null, package_id: OTHER, state: 'active', version: 1,
            metadata: JSON.stringify(dashboardBody('Other customized')),
        }, { context: { isSystem: true } });
        const loaded = await protocol.loadMetaFromDb();
        expect(loaded.errors).toBe(0);

        const bare: any = (engine.registry as any).metadata.get('dashboard')?.get(DASHBOARD);
        expect(reading(bare)).toBe(`Other customized/${OTHER}`);
        expect(bare._provenance).toBe('package');
    });
});
