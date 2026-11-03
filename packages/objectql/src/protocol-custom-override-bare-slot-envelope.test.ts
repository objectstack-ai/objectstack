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
 *
 * ## [#29613] The second describe: page, app, dataset, doc and book
 *
 * A `.custom` pair's published override of a base's
 * page, app, dataset, doc or book is served from its ROW, as a dashboard's
 * is, and no longer from a copy in the registry's bare slot wearing the
 * base's envelope.
 *
 * These five types are SEALED (ADR-0131 D6: `allowEnvironmentOverlay:
 * false`), so every read declined their stored row as an overlay of managed
 * content (`declinesStoredRow`), the pair's declared override with the rest.
 * The override was served only from the bare slot, where the hydrator
 * registered it under the base's envelope. Measured on main 744211fc, the
 * #29600 harness run without and with a metadata service (S = shipped,
 * O = the override):
 *
 *  - by-name (no package, BASE, PAIR): O from the bare slot without a
 *    metadata service; S with one (a real boot), the service's copy of the
 *    base's body answering before the registry;
 *  - the effective list (no package, BASE): O, from the bare slot;
 *  - the layered read's effective layer naming BASE: S;
 *  - the per-package layer naming PAIR: []; naming BASE: [S, O] without a
 *    metadata service, [O] with one;
 *  - `registry.getAllApps` (the app): [S, O].
 *
 * Pinned here, per type, with and without a metadata service, at once and
 * after a restart: the served reads all answer O (ADR-0146 D8 item 2), the
 * per-package layer lists S under BASE and O under PAIR (D8 item 3), and the
 * registry's bare slot holds no copy of the override, so its direct reads
 * (and `registry.getAllApps`) answer the base's own item. CONTROL: a sealed
 * row that is not the pair's declared override (a package-less environment
 * row of the base's name) stays unserved. Its boot is
 * `environment-overlay-email-locale-restart.test.ts`'s: the hydration
 * `ObjectQLPlugin.start()` runs, then the pair.
 */
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
/** [#29613] A sealed row that is not the pair's declared override. */
const RESIDUE = 'Residue label';
/** Unique across boots: a restart is a new driver over the same stores. */
let nextId = 0;

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

/** [#29613] `stores` shared by two boots = a restart over the same database. */
function makeMemoryDriver(stores: Map<string, Map<string, Record<string, unknown>>> = new Map()) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
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

const pageBody = (label: string) => ({ name: 'showcase_settings', label, type: 'app', regions: [] });
const appBody = (label: string) => ({ name: 'showcase', label });
const datasetBody = (label: string) => ({
    name: 'showcase_task_metrics', label, object: 'showcase_task',
    dimensions: [{ name: 'status', label: 'Status', field: 'status', type: 'string' }],
    measures: [{ name: 'task_count', label: 'Tasks', aggregate: 'count' }],
});
const docBody = (label: string) => ({ name: 'showcase_index', label, content: '# Index' });
const bookBody = (label: string) => ({
    name: 'showcase_manual', label, groups: [{ key: 'start', label: 'Start', pages: ['showcase_index'] }],
});

/** Per type: its body and the manifest collection that ships it. */
const SEALED_TYPES = [
    { type: 'page', body: pageBody, collection: 'pages' },
    { type: 'app', body: appBody, collection: 'apps' },
    { type: 'dataset', body: datasetBody, collection: 'datasets' },
    { type: 'doc', body: docBody, collection: 'docs' },
    { type: 'book', body: bookBody, collection: 'books' },
] as const;

function sealedBaseManifest(): Record<string, unknown> {
    const manifest: Record<string, unknown> = {
        id: BASE, name: 'showcase', version: '1.0.0', namespace: 'showcase',
        objects: [{
            name: 'showcase_task', label: 'Task', sharingModel: 'private',
            fields: {
                title: { name: 'title', label: 'Title', type: 'text' },
                status: { name: 'status', label: 'Status', type: 'text' },
            },
        }],
    };
    for (const t of SEALED_TYPES) manifest[t.collection] = [t.body(SHIPPED)];
    return manifest;
}

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/**
 * One boot over `stores`: engine, the base, the protocol, the hydration
 * `ObjectQLPlugin.start()` runs, then the pair. Called twice over the same
 * stores = a restart. `withService` registers a metadata service holding the
 * code package's bodies, as every real boot's MetadataService holds them: the
 * by-name read consults it before the registry.
 */
async function bootSealed(stores: Stores, withService: boolean) {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores).driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(sealedBaseManifest());
    const services = new Map<string, unknown>();
    if (withService) {
        const shipped = new Map(SEALED_TYPES.map((t) => [t.type as string, { ...t.body(SHIPPED), _packageId: BASE }]));
        services.set('metadata', {
            async get(type: string, name: string) {
                const item = shipped.get(type);
                return item && item.name === name ? item : undefined;
            },
            async list(type: string) {
                const item = shipped.get(type);
                return item ? [item] : [];
            },
        });
    }
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => services as any);
    const load = await protocol.loadMetaFromDb();
    expect(load.errors, 'the boot hydration').toBe(0);
    await protocol.ensureCustomizationPackage({ basePackageId: BASE });
    return { engine, protocol };
}

const byNameReading = async (protocol: any, type: string, name: string, packageId?: string): Promise<string | null> =>
    reading((await protocol.getMetaItem({ type, name, ...(packageId ? { packageId } : {}) }))?.item);

/** Every reading the card names, for one type and name. */
async function sealedReadings(engine: ObjectQL, protocol: any, type: string, name: string) {
    return {
        byName: [await byNameReading(protocol, type, name), await byNameReading(protocol, type, name, BASE), await byNameReading(protocol, type, name, PAIR)],
        list: [await effectiveList(protocol, type, name), await effectiveList(protocol, type, name, BASE)],
        layered: (await protocol.getMetaItemLayered({ type, name, packageId: BASE }))?.effective?.label,
        perPackage: {
            base: await perPackage(protocol, type, name, BASE),
            pair: await perPackage(protocol, type, name, PAIR),
            unscoped: await perPackage(protocol, type, name),
        },
        bareSlot: reading((engine.registry as any).metadata.get(type)?.get(name)),
        registryGetItem: reading(engine.registry.getItem(type, name)),
        ...(type === 'app' ? { getAllApps: engine.registry.getAllApps().filter((a: any) => a?.name === name).map(reading) } : {}),
    };
}

/** What every reading answers once the override is published (ADR-0146 D8 items 2 and 3). */
const servedReadings = (type: string) => ({
    byName: [`${EDITED}/${BASE}`, `${EDITED}/${BASE}`, `${EDITED}/${BASE}`],
    list: [[EDITED], [EDITED]],
    layered: EDITED,
    perPackage: { base: [SHIPPED], pair: [EDITED], unscoped: [EDITED, SHIPPED] },
    bareSlot: null,
    registryGetItem: `${SHIPPED}/${BASE}`,
    ...(type === 'app' ? { getAllApps: [`${SHIPPED}/${BASE}`] } : {}),
});

describe('[#29613] a pair\'s published override of a sealed type is served from its row', () => {
    for (const withService of [false, true]) {
        const shape = withService ? 'with a metadata service (a real boot)' : 'with no metadata service';
        for (const { type, body } of SEALED_TYPES) {
            const name = body(SHIPPED).name;

            it(`${type}, ${shape}: every reader serves the override, at once and after a restart`, async () => {
                const stores: Stores = new Map();
                const first = await bootSealed(stores, withService);
                await publishOverride(first.protocol, type, name, body(EDITED));
                expect(await sealedReadings(first.engine, first.protocol, type, name), `${type} at once`).toEqual(servedReadings(type));

                const restarted = await bootSealed(stores, withService);
                expect(await sealedReadings(restarted.engine, restarted.protocol, type, name), `${type} after a restart`).toEqual(servedReadings(type));
            });
        }
    }

    for (const { type, body } of SEALED_TYPES) {
        const name = body(SHIPPED).name;
        it(`CONTROL, ${type}: a package-less environment row of the base's name is not the pair's override and stays unserved`, async () => {
            const stores: Stores = new Map();
            await bootSealed(stores, true);
            // A row written through the hatch before the ADR-0131 D6 seal: bound to no package, no declaration.
            stores.get('sys_metadata')!.set(`residue_${type}`, {
                id: `residue_${type}`, type, name, organization_id: null, package_id: null, state: 'active', version: 1,
                metadata: JSON.stringify(body(RESIDUE)),
            });
            const { protocol } = await bootSealed(stores, true);
            expect(await byNameReading(protocol, type, name), `${type} by name`).toBe(`${SHIPPED}/${BASE}`);
            expect(await byNameReading(protocol, type, name, BASE), `${type} by name, the base`).toBe(`${SHIPPED}/${BASE}`);
            expect((await protocol.getMetaItemLayered({ type, name, packageId: BASE }))?.effective?.label, `${type} layered`).toBe(SHIPPED);
        });
    }
});
