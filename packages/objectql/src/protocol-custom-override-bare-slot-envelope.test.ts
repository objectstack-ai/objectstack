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
 * [#30062] …and mapping, measured the same way: before, a published mapping
 * override was answered by no read (every reader served S), so an import that
 * named the mapping ran the base's field mapping.
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
// Pays the lint root's first load at collection, never inside a clocked case.
import './__fixtures__/lint-root-preload.testkit.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { translateMetadataDocument } from '@objectstack/spec/system';
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
/** [#30062] An import mapping: the import door resolves it through the by-name read (`@objectstack/rest`'s `import-mapping.ts`). */
const mappingBody = (label: string) => ({
    name: 'showcase_task_feed', label, sourceFormat: 'csv', targetObject: 'showcase_task',
    fieldMapping: [{ source: 'Title', target: 'title' }], mode: 'insert',
});

/** Per type: its body and the manifest collection that ships it. */
const SEALED_TYPES = [
    { type: 'page', body: pageBody, collection: 'pages' },
    { type: 'app', body: appBody, collection: 'apps' },
    { type: 'dataset', body: datasetBody, collection: 'datasets' },
    { type: 'doc', body: docBody, collection: 'docs' },
    { type: 'book', body: bookBody, collection: 'books' },
    // [#30062] Before, a published mapping override was answered by no read: every reader served the base's body.
    { type: 'mapping', body: mappingBody, collection: 'mappings' },
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

/**
 * [#30062, ADR-0146 D2] "Removing it brings the base's back": a pair's removal
 * of its own published override succeeds for every type whose declared
 * override the gate admits and a pair can hold, and the base's item is served
 * again by every read; a removal naming the base keeps its answer and leaves
 * the override served (a base's own item is never removed).
 *
 * Before, `doc` and `mapping` answered 403 NOT_OVERRIDABLE (`refusePackagedBaseRemoval`,
 * the pair-row admission being `flow`'s alone) and the override stayed served:
 * a customization the customer could not undo. `flow` is pinned beside its own
 * read in `protocol-flow-custom-override.test.ts`; `action` takes no declared
 * override yet (ADR-0146 D9), so no pair holds one.
 *
 * Both topologies: an environment kernel asks the protocol's removal door, a
 * host-config kernel only the repository's delete gate.
 */
const REMOVAL_TYPES = [
    ...TYPES.map(({ type, name, body }) => ({ type, name, body: body as (label: string) => Record<string, unknown> })),
    ...SEALED_TYPES.map(({ type, body }) => ({ type, name: body(SHIPPED).name, body: body as (label: string) => Record<string, unknown> })),
    {
        type: 'translation', name: 'showcase_zh_cn',
        body: (label: string) => ({ name: 'showcase_zh_cn', label, locale: 'zh-CN', objects: { showcase_task: { label: '任务' } } }),
    },
] as const;

function removalBaseManifest(): Record<string, unknown> {
    // The #29600 base and the #29613 sealed types in one package; the sealed dataset's body wins the shared name.
    return { ...baseManifest(), ...sealedBaseManifest(), views: baseManifest().views, dashboards: baseManifest().dashboards, reports: baseManifest().reports, emailTemplates: baseManifest().emailTemplates };
}

async function bootRemoval(environmentId: string | undefined) {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver().driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(removalBaseManifest());
    // The manifest door registers no translation artifact here; a code package's translation file does (the metadata plugin).
    engine.registry.registerItem('translation', REMOVAL_TYPES[REMOVAL_TYPES.length - 1].body(SHIPPED), 'name', BASE);
    const protocol: any = new ObjectStackProtocolImplementation(engine, () => new Map(), environmentId);
    await protocol.ensureCustomizationPackage({ basePackageId: BASE });
    return { engine, protocol };
}

/** The overridable types that open no overlay channel and are no `supportsOverlay` type: a removal naming the base is refused for them. */
const SEALED_OUTSIDE_CARVE_OUT: ReadonlySet<string> = new Set(['doc', 'mapping']);

const activePairRows = async (engine: ObjectQL, type: string, name: string): Promise<number> =>
    ((await engine.find('sys_metadata', { where: { type, name, package_id: PAIR, state: 'active' }, context: { isSystem: true } })) as any[]).length;

describe('[#30062] a pair\'s removal of its own override brings the base\'s item back, for every type a pair can hold', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';
        for (const { type, name, body } of REMOVAL_TYPES) {
            it(`${type} (${kernel} kernel): the removal naming the pair succeeds and every read serves the base's item again`, async () => {
                const { engine, protocol } = await bootRemoval(environmentId);
                await publishOverride(protocol, type, name, body(EDITED));
                expect(await byName(protocol, type, name, BASE), `${type} served before the removal`).toBe(EDITED);

                const removed = await protocol.deleteMetaItem({ type, name, packageId: PAIR });
                expect(removed?.success, `the ${type} removal`).toBe(true);
                expect(await activePairRows(engine, type, name), `the pair's ${type} row`).toBe(0);

                expect(await byName(protocol, type, name), `${type} by name, no package`).toBe(SHIPPED);
                expect(await byName(protocol, type, name, BASE), `${type} by name, the base`).toBe(SHIPPED);
                expect(await effectiveList(protocol, type, name), `${type} list, no package`).toEqual([SHIPPED]);
                expect((await protocol.getMetaItemLayered({ type, name, packageId: BASE }))?.effective?.label, `${type} layered, the base`).toBe(SHIPPED);
                expect(await perPackage(protocol, type, name, PAIR), `the pair's ${type} layer`).toEqual([]);
            });

            it(`${type} (${kernel} kernel): a removal naming the base keeps main's answer, removes nothing, and the override stays served`, async () => {
                const { engine, protocol } = await boot2(environmentId, type, name, body);
                const outcome = await protocol.deleteMetaItem({ type, name, packageId: BASE }).then(
                    (r: any) => ({ success: r?.success, reset: r?.reset }),
                    (e: any) => ({ code: e?.code, status: e?.status }),
                );
                // Main's answer, unchanged: the sealed removal refusal where the protocol's door
                // asks it of a type outside the #6960 carve-out, else a receipt that removed nothing.
                expect(outcome, `the ${type} removal naming the base`).toEqual(
                    environmentId !== undefined && SEALED_OUTSIDE_CARVE_OUT.has(type)
                        ? { code: 'NOT_OVERRIDABLE', status: 403 }
                        : { success: true, reset: false },
                );
                expect(await activePairRows(engine, type, name), `the pair's ${type} row`).toBe(1);
                expect(await byName(protocol, type, name, BASE), `${type} by name, the base`).toBe(EDITED);
                expect((await protocol.getMetaItemLayered({ type, name, packageId: BASE }))?.code?.label, `the base's own ${type}`).toBe(SHIPPED);
            });
        }
    }
});

/** A removal boot with the pair's override already published. */
async function boot2(environmentId: string | undefined, type: string, name: string, body: (label: string) => Record<string, unknown>) {
    const booted = await bootRemoval(environmentId);
    await publishOverride(booted.protocol, type, name, body(EDITED));
    return booted;
}

/**
 * [#30062 item 3, ruling record 6631250894] The label order on a declared
 * override — a translation in the pair, then the override's own label, then
 * the base's translation — needs two inputs only the protocol has, and this
 * pins both on a real boot (the #29613 harness: the real engine, the boot
 * hydration, the pair through its ensure door, the override through Studio's
 * draft save and publish):
 *
 *  - the PACKAGED base of a page, dataset, app and book
 *    (`getPackagedPageBase`, `getPackagedDatasetBase`, `getPackagedAppBase`,
 *    `getPackagedBookBase`) answers the base's own item while the pair's
 *    override is served, at once and after a restart, with and without a
 *    metadata service — never the override it is compared against;
 *  - the served override names its base (`servedOverrideBaseOf`), the base's
 *    own item names none, and the pair's own published translation is what
 *    `getPairTranslationBundle` answers for that base, without the base's.
 *
 * Fed to the spec's translator, the two give the ruled answer for each type.
 */
const PAIR_TRANSLATION = 'showcase_custom_zh_cn';
/** The `zh-CN` text each type's catalog group carries, keyed by the item's name. */
const zhGroup = (type: string, name: string, label: string): Record<string, unknown> => {
    const group = ({ page: 'pages', app: 'apps', dataset: 'datasets', book: 'books' } as Record<string, string>)[type];
    return { [group]: { [name]: { label } } };
};
const LABEL_ORDER_TYPES = SEALED_TYPES.filter((t) => ['page', 'app', 'dataset', 'book'].includes(t.type));
const accessorOf = (type: string): string => `getPackaged${type[0].toUpperCase()}${type.slice(1)}Base`;

describe('[#30062] a declared override\'s label order: the packaged base and the pair\'s own translations, on a real boot', () => {
    for (const withService of [false, true]) {
        const shape = withService ? 'with a metadata service (a real boot)' : 'with no metadata service';
        for (const { type, body } of LABEL_ORDER_TYPES) {
            const name = body(SHIPPED).name;

            it(`${type}, ${shape}: the packaged base is the base's own item while the override is served, at once and after a restart`, async () => {
                const stores: Stores = new Map();
                const first = await bootSealed(stores, withService);
                expect(reading(first.protocol[accessorOf(type)](name)), `${type} before the override`).toBe(`${SHIPPED}/${BASE}`);
                await publishOverride(first.protocol, type, name, body(EDITED));
                expect(reading(first.protocol[accessorOf(type)](name)), `${type} at once`).toBe(`${SHIPPED}/${BASE}`);
                const restarted = await bootSealed(stores, withService);
                expect(reading(restarted.protocol[accessorOf(type)](name)), `${type} after a restart`).toBe(`${SHIPPED}/${BASE}`);
                expect(restarted.protocol[accessorOf(type)]('no_such_item'), `${type}, an unknown name`).toBeUndefined();
            });

            it(`${type}, ${shape}: the served override names its base, the pair's translation is read by its binding, and the translator answers the ruled order`, async () => {
                const stores: Stores = new Map();
                const { protocol } = await bootSealed(stores, withService);
                // Before the override: the base's own item is no declared override.
                const shipped = (await protocol.getMetaItem({ type, name }))?.item;
                expect(protocol.servedOverrideBaseOf(type, shipped), `${type}, the base's own item`).toBeUndefined();

                await publishOverride(protocol, type, name, body(EDITED));
                const served = (await protocol.getMetaItem({ type, name }))?.item;
                const listed = ((await protocol.getMetaItems({ type }))?.items ?? []).find((i: any) => i?.name === name);
                expect(protocol.servedOverrideBaseOf(type, served), `${type}, by name`).toBe(BASE);
                expect(protocol.servedOverrideBaseOf(type, listed), `${type}, listed`).toBe(BASE);
                // The pair has no translation yet.
                expect(await protocol.getPairTranslationBundle(BASE), `${type}, a pair with no translation`).toBeUndefined();

                // The pair's own translation, through the same doors; and a package-less one of the
                // same key, which is in the deployment catalog but is not the pair's.
                const saved = await protocol.saveMetaItem({
                    type: 'translation', name: PAIR_TRANSLATION, packageId: PAIR,
                    item: { name: PAIR_TRANSLATION, locale: 'zh-CN', ...zhGroup(type, name, `${EDITED} (zh)`) },
                });
                expect(saved?.success, 'the pair translation save').toBe(true);
                stores.get('sys_metadata')!.set('legacy_zh', {
                    id: 'legacy_zh', type: 'translation', name: 'legacy_zh_cn', organization_id: null, package_id: null,
                    state: 'active', version: 1, metadata: JSON.stringify({ name: 'legacy_zh_cn', locale: 'zh-CN', ...zhGroup(type, name, 'not the pair') }),
                });
                const pairBundle = await protocol.getPairTranslationBundle(BASE);
                expect(pairBundle, `${type}, the pair's bundle`).toEqual({ 'zh-CN': zhGroup(type, name, `${EDITED} (zh)`) });
                expect(await protocol.getPairTranslationBundle(PAIR), 'a pair id has no pair').toBeUndefined();

                const catalog = { 'zh-CN': zhGroup(type, name, '基包译文') };
                const translate = (pair: unknown) => (translateMetadataDocument(type, served, catalog as any, {
                    locale: 'zh-CN', packagedBase: protocol[accessorOf(type)](name), ...(pair ? { pairBundle: pair as any } : {}),
                }) as any)?.label;
                expect(translate(pairBundle), `${type}: the pair's translation first`).toBe(`${EDITED} (zh)`);
                expect(translate(undefined), `${type}: then the override's own label`).toBe(EDITED);
                const base = (translateMetadataDocument(type, shipped, catalog as any, {
                    locale: 'zh-CN', packagedBase: protocol[accessorOf(type)](name),
                }) as any)?.label;
                expect(base, `${type}: the base's own item keeps the base's translation`).toBe('基包译文');
            });
        }
    }
});
