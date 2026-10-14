// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23298 — on an environment kernel that hydrates its own `sys_metadata` into
 * its own registry, a body published through the metadata door reaches that
 * registry at once, so the security catalog (which reads the registry first)
 * resolves a narrowed permission set's new body with no rebuild.
 *
 * ## The defect
 *
 * `applyRegistryWriteThrough` skipped every non-`object` type whenever the
 * protocol had an `environmentId`. Its stated reason — a project-scoped row must
 * not be registered into a registry that unscoped (control-plane) callers share
 * — holds only for a SHARED registry. An environment kernel that hydrates its
 * own store at boot (`ObjectQLPlugin`'s `hydrateMetadataFromDb`: the standalone
 * stack, a hosted tenant kernel) put every stored body into its registry at
 * boot and then never updated it: the save was accepted and served by the
 * protocol's reads, while the engine registry, and so the security catalog,
 * kept the boot-time body until the kernel was rebuilt. A narrowed set kept
 * granting its old, wider body.
 *
 * ## The pins
 *
 *  - on an environment kernel, a narrowed set's next resolution reads the new
 *    body with no rebuild, and it is the body a rebuild reads;
 *  - the same for a view, read from the registry;
 *  - a reset of an item whose baseline the MetadataService holds puts the
 *    baseline back in the registry (the delete's heal re-registers on the
 *    kernels the write registers on, so a save followed by a reset leaves no
 *    deleted body behind);
 *  - a shared registry still never receives a project-scoped row: an
 *    environment protocol whose store was never hydrated into the registry it
 *    shares with a control-plane protocol writes nothing into it.
 *
 * ## The harness
 *
 * `environment-overlay-email-locale-restart.test.ts`'s: the real `ObjectQL`
 * engine and its `SchemaRegistry`, the real `ObjectStackProtocolImplementation`
 * constructed with an `environmentId`, and an in-memory driver. A BOOT hydrates
 * the way `ObjectQLPlugin.start()` does on a kernel with
 * `hydrateMetadataFromDb` (`loadMetaFromDb()`); a REBUILD is a new engine and a
 * new protocol over the same stores. The catalog is the real
 * `createSecurityCatalogReader` over the engine registry and a MetadataService
 * double; the writes are the real `saveMetaItem` publish and `deleteMetaItem`.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSecurityCatalogReader } from '@objectstack/core';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import {
    SysMetadataAuditObject,
    SysMetadataCommitObject,
    SysMetadataHistoryObject,
    SysMetadataObject,
} from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const ENV = 'env_tenant';
const PKG = 'com.acme.crm';
const SET = 'crm_editor';
const VIEW = 'crm_account_admin_list';
/** A view the MetadataService holds as its baseline, and no package ships. */
const BASELINE_VIEW = 'crm_account_baseline_list';

type Stores = Map<string, Map<string, Record<string, unknown>>>;
type Row = Record<string, unknown>;

/** The package: one object the bodies below name. */
function crmManifest(): Record<string, unknown> {
    return {
        id: PKG,
        name: 'acme_crm',
        version: '1.0.0',
        objects: [{
            name: 'crm_account',
            label: 'Account',
            fields: { name: { type: 'text', label: 'Name' } },
        }],
    };
}

/** The set as first published: delete granted, not the app baseline. */
const wideSet = (): Row => ({
    name: SET,
    label: 'CRM editor',
    objects: { crm_account: { allowRead: true, allowEdit: true, allowDelete: true } },
});

/** The set as narrowed: delete revoked, marked the app baseline (the card's measured pair). */
const narrowedSet = (): Row => ({
    name: SET,
    label: 'CRM editor',
    isDefault: true,
    objects: { crm_account: { allowRead: true, allowEdit: true, allowDelete: false } },
});

const viewBody = (name: string, label: string): Row => ({
    name,
    label,
    object: 'crm_account',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
});

/** In-memory driver, copied from `environment-overlay-email-locale-restart.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them.
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
            // The caller's bound, after the filter, by presence (`check:objectql-double-limit`).
            return typeof ast?.limit === 'number' ? rows.slice(0, ast.limit) : rows;
        },
        async findOne(object: string, ast: any) {
            for (const r of storeFor(object).values()) if (matchesWhere(r, ast?.where)) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>) {
            // Unique across boots: a rebuild is a new driver over the same stores.
            const id = (data.id as string) ?? `r_${randomUUID()}`;
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
    return driver;
}

/**
 * The kernel `metadata` service as the catalog and the delete's heal read it:
 * in memory, keyed by type and name, holding only what a test declares.
 */
function makeMetadataService(declared: Array<{ type: string; item: Row }> = []) {
    const store = new Map<string, Row>();
    for (const { type, item } of declared) store.set(`${type}\u0000${String(item.name)}`, item);
    return {
        get: (type: string, name: string) => store.get(`${type}\u0000${name}`),
        list: (type: string) => [...store.entries()]
            .filter(([key]) => key.startsWith(`${type}\u0000`))
            .map(([, item]) => item),
    };
}

/** An engine over `stores`, with the platform's metadata tables and the package registered. */
async function makeEngine(stores: Stores): Promise<ObjectQL> {
    const engine = new ObjectQL();
    engine.registerDriver(makeMemoryDriver(stores), true);
    await engine.init();
    for (const o of [SysMetadataObject, SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(crmManifest());
    return engine;
}

/**
 * One environment kernel over `stores`, booted as `ObjectQLPlugin.start()`
 * boots a kernel with `hydrateMetadataFromDb`: the package registered, then
 * the protocol's own store hydrated into the engine's own registry. Called
 * again over the same stores = a rebuild.
 */
async function bootEnvironmentKernel(stores: Stores, metadata = makeMetadataService()) {
    const engine = await makeEngine(stores);
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map<string, unknown>([['metadata', metadata]]), ENV);
    const load = await protocol.loadMetaFromDb();
    expect(load, 'precondition: the boot read the store').toMatchObject({ errors: 0, storeUnavailable: false });
    const catalog = createSecurityCatalogReader({ registry: engine.registry as never, metadata });
    return { engine, protocol, catalog };
}

const definitionOf = async (catalog: ReturnType<typeof createSecurityCatalogReader>, name: string) =>
    (await catalog.resolve('permission', name))?.definition as Row | undefined;

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

describe('#23298 — an environment kernel that hydrates its own store takes the published body', () => {
    it('a narrowed permission set\'s next resolution reads the new body, with no rebuild — the body a rebuild reads', async () => {
        const stores: Stores = new Map();
        const first = await bootEnvironmentKernel(stores);
        expect(await first.protocol.saveMetaItem({ type: 'permission', name: SET, item: wideSet() }))
            .toMatchObject({ success: true });

        // The kernel the administrator works on: its boot put the wide body
        // into its registry, and the catalog resolves it from there.
        const kernel = await bootEnvironmentKernel(stores);
        const before = await kernel.catalog.resolve('permission', SET);
        expect(before, 'anti-vacuity: the boot-time body is the registry\'s').toMatchObject({ source: 'registry' });
        expect(before?.definition).toMatchObject({ objects: { crm_account: { allowDelete: true } } });
        expect(before?.definition).not.toHaveProperty('isDefault', true);

        expect(await kernel.protocol.saveMetaItem({ type: 'permission', name: SET, item: narrowedSet(), mode: 'publish' }))
            .toMatchObject({ success: true });

        const after = await kernel.catalog.resolve('permission', SET);
        expect(after).toMatchObject({ source: 'registry' });
        expect(after?.definition).toMatchObject({ isDefault: true, objects: { crm_account: { allowDelete: false } } });

        // The body the registry now holds is the one a rebuild would read.
        const rebuilt = await bootEnvironmentKernel(stores);
        expect(await definitionOf(rebuilt.catalog, SET)).toEqual(after?.definition);
    });

    it('a published view reaches the registry with no rebuild — the body a rebuild reads', async () => {
        const stores: Stores = new Map();
        const first = await bootEnvironmentKernel(stores);
        expect(await first.protocol.saveMetaItem({ type: 'view', name: VIEW, item: viewBody(VIEW, 'Accounts') }))
            .toMatchObject({ success: true });

        const kernel = await bootEnvironmentKernel(stores);
        expect(kernel.engine.registry.getItem('view', VIEW), 'anti-vacuity: the boot-time body')
            .toMatchObject({ label: 'Accounts' });

        expect(await kernel.protocol.saveMetaItem({ type: 'view', name: VIEW, item: viewBody(VIEW, 'Accounts (admin)') }))
            .toMatchObject({ success: true });
        const after = kernel.engine.registry.getItem('view', VIEW) as Row | undefined;
        expect(after).toMatchObject({ label: 'Accounts (admin)' });

        const rebuilt = await bootEnvironmentKernel(stores);
        expect(rebuilt.engine.registry.getItem('view', VIEW)).toEqual(after);
    });

    it('a reset of an item the MetadataService holds a baseline of puts the baseline back in the registry', async () => {
        const stores: Stores = new Map();
        const baseline = viewBody(BASELINE_VIEW, 'Baseline accounts');
        const metadata = makeMetadataService([{ type: 'view', item: baseline }]);
        const kernel = await bootEnvironmentKernel(stores, metadata);
        expect(kernel.engine.registry.getItem('view', BASELINE_VIEW), 'precondition: no package ships it').toBeUndefined();

        expect(await kernel.protocol.saveMetaItem({ type: 'view', name: BASELINE_VIEW, item: viewBody(BASELINE_VIEW, 'Saved accounts') }))
            .toMatchObject({ success: true });
        expect(kernel.engine.registry.getItem('view', BASELINE_VIEW)).toMatchObject({ label: 'Saved accounts' });

        await kernel.protocol.deleteMetaItem({ type: 'view', name: BASELINE_VIEW });
        expect(Array.from(stores.get('sys_metadata')?.values() ?? []).filter((r) => r.name === BASELINE_VIEW && r.state === 'active'))
            .toEqual([]);
        // Not the deleted body: the baseline, as a rebuild serves it.
        expect(kernel.engine.registry.getItem('view', BASELINE_VIEW)).toMatchObject({ label: 'Baseline accounts' });
    });
});

describe('#23298 — a shared registry never receives a project-scoped row', () => {
    /**
     * ONE engine, so ONE registry, shared by an unscoped control-plane protocol
     * (which hydrated its store into it) and an environment protocol over the
     * same engine whose store was never hydrated into it — the topology the
     * write-through's gate exists for.
     */
    async function sharedRegistry() {
        const stores: Stores = new Map();
        const engine = await makeEngine(stores);
        const controlPlane = new ObjectStackProtocolImplementation(engine, () => new Map());
        await controlPlane.loadMetaFromDb();
        const environment = new ObjectStackProtocolImplementation(engine, () => new Map(), ENV);
        return { stores, engine, controlPlane, environment };
    }

    const activeRows = (stores: Stores, name: string) =>
        Array.from(stores.get('sys_metadata')?.values() ?? []).filter((r) => r.name === name && r.state === 'active');

    it('a permission set and a view published by the environment protocol stay out of the shared registry', async () => {
        const { stores, engine, environment } = await sharedRegistry();

        expect(await environment.saveMetaItem({ type: 'permission', name: SET, item: wideSet(), mode: 'publish' }))
            .toMatchObject({ success: true });
        expect(await environment.saveMetaItem({ type: 'view', name: VIEW, item: viewBody(VIEW, 'Accounts'), mode: 'publish' }))
            .toMatchObject({ success: true });

        // Anti-vacuity: both writes landed and are live.
        expect(activeRows(stores, SET)).toHaveLength(1);
        expect(activeRows(stores, VIEW)).toHaveLength(1);
        expect(engine.registry.getItem('permission', SET)).toBeUndefined();
        expect(engine.registry.getItem('view', VIEW)).toBeUndefined();
    });

    it('CONTROL: the control-plane protocol\'s own publish reaches the same registry', async () => {
        const { engine, controlPlane } = await sharedRegistry();

        expect(await controlPlane.saveMetaItem({ type: 'permission', name: SET, item: wideSet(), mode: 'publish' }))
            .toMatchObject({ success: true });
        expect(engine.registry.getItem('permission', SET)).toMatchObject({ name: SET });
    });
});
