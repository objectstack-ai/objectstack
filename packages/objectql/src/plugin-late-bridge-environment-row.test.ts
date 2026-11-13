// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33003] The late-manifest bridge rewrites an environment row the boot pass
 * stamped with the host, and the row stays the environment's.
 *
 * ## The defect
 *
 * On a host that declares its package and stores metadata in a database, the
 * metadata boot pass stamps each stored row naming no package with the host
 * (`_packageId`), and ObjectQL owns such an object as the host's. When another
 * package extends it, {@link ObjectQLPlugin}'s late-manifest bridge sees the
 * metadata service's copy stamped with the owner and re-registers the merged
 * object (`ownPreviousCopy`); withdrawing the extender puts the owner's body
 * back the same way (`restoreExtendedObjectCopies`). Each write replaced the
 * object the boot pass had marked as the environment's own row and stored the
 * host stamp in the row's body, so `unregisterPackage(host)` deleted the
 * environment's object, in that process and after a restart.
 *
 * ## Why these parts are real
 *
 * The bridge and its restore are this plugin's own methods, run over a real
 * `ObjectQL` registry (the extender's merge, the owner's stamp) into a real
 * `MetadataManager` whose rows a real `DatabaseLoader` reads and writes, primed
 * by `MetadataPlugin`'s real boot pass; a second pass over the same store is
 * the restart. The metadata-level pins of every writer live in
 * `packages/metadata/src/loaders/database-loader.test.ts` (`[#33003]`).
 */

import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseLoader, MetadataPlugin, type MetadataManager } from '@objectstack/metadata';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/** In-memory driver, copied from `protocol-delete-boot-hydrated-object-heal.test.ts`; equality-only WHERE. */
function makeMemoryDriver(stores: Stores) {
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
        async syncSchema() {},
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
        async dropTable(object: string) { stores.delete(object); },
    };
    return driver;
}

const HOST = 'com.host.app';
const EXT = 'com.ext.score';
const OBJECT = 'env_account';

/** An extender whose only content is a field on the environment's object. */
const extender = () => ({
    id: EXT,
    name: EXT,
    version: '1.0.0',
    type: 'app',
    objectExtensions: [{ extend: OBJECT, fields: { ext_score: { name: 'ext_score', label: 'Score', type: 'number' } } }],
});

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });

/** The metadata boot pass over the store, on a host that declares `HOST`. */
async function bootPass(stores: Stores): Promise<MetadataManager> {
    const plugin = new MetadataPlugin({ packageId: HOST, watch: false, config: { bootstrap: 'eager' } });
    const m = (plugin as any).manager as MetadataManager;
    (m as any).loaders.clear();
    m.registerLoader(new DatabaseLoader({ driver: makeMemoryDriver(stores) }));
    await (plugin as any)._loadFromFileSystem({ logger: logger() });
    return m;
}

/** A stored row naming no package, as the environment saved it; `body` may name the host (CONTROL). */
function seed(stores: Stores, name: string, body: Record<string, unknown> = {}) {
    const table = new Map<string, Record<string, unknown>>(stores.get('sys_metadata') ?? []);
    table.set(`object_${name}`, {
        id: `object_${name}`, type: 'object', name, state: 'active', version: 1, checksum: name, source: 'database',
        package_id: null, metadata: JSON.stringify({ name, label: 'env', fields: { name: { name: 'name', type: 'text', label: 'Name' } }, ...body }),
    });
    stores.set('sys_metadata', table);
}

/**
 * The ObjectQL side: the registry owns each object as the metadata copy's
 * stamp names it (ObjectQL registers a copy under `_packageId`), the extender
 * is installed, and the bridge and its restore are the plugin's own.
 */
function objectql(m: MetadataManager, names: readonly string[]) {
    const engine = new ObjectQL();
    for (const name of names) {
        const copy = (m as any).registry.get('object').get(name) as Record<string, unknown>;
        const { _packageId, ...schema } = copy;
        engine.registry.registerObject(schema as any, _packageId as string);
    }
    engine.registerApp(extender());
    const plugin = new ObjectQLPlugin({ ql: engine });
    (plugin as any).bridgeLateManifests = true;
    const ctx = { logger: logger(), getService: (name: string) => { if (name === 'metadata') return m; throw new Error(name); } };
    return {
        engine,
        bridge: () => (plugin as any).bridgeManifestObjectsToMetadataService(ctx, extender()) as Promise<void>,
        restore: async () => {
            engine.registry.uninstallPackage(EXT);
            await (plugin as any).restoreExtendedObjectCopies(ctx, EXT);
        },
    };
}

/** Per object: the registry's stamp, its served field names, and how many stored rows it has. */
async function state(m: MetadataManager, stores: Stores, names: readonly string[]) {
    const out: unknown[] = [];
    for (const name of names) {
        const held = (m as any).registry.get('object')?.get(name) as { _packageId?: string; fields?: object } | undefined;
        const rows = [...(stores.get('sys_metadata')?.values() ?? [])].filter((r) => r.type === 'object' && r.name === name);
        out.push([name, held?._packageId ?? null, held ? Object.keys(held.fields ?? {}).includes('ext_score') : null, rows.length]);
    }
    return out;
}

describe('[#33003] the late-manifest bridge rewrites the environment\'s object the boot pass stamped with the host: unregisterPackage(host) keeps it', () => {
    it('the extender bridged (ownPreviousCopy): unregisterPackage(host) keeps the object in this process and after a restart (BEFORE: deleted)', async () => {
        const stores: Stores = new Map();
        seed(stores, OBJECT);
        const m = await bootPass(stores);
        const { bridge } = objectql(m, [OBJECT]);
        await bridge();
        // Identity: the bridge rewrote the copy with the merged body, stamped with the owner.
        expect(await state(m, stores, [OBJECT])).toEqual([[OBJECT, HOST, true, 1]]);

        const rebooted = await bootPass(stores);
        await rebooted.unregisterPackage(HOST);
        expect(await state(rebooted, stores, [OBJECT])).toEqual([[OBJECT, HOST, true, 1]]);
        await m.unregisterPackage(HOST);
        expect(await state(m, stores, [OBJECT])).toEqual([[OBJECT, HOST, true, 1]]);
    });

    it('the extender withdrawn (restoreExtendedObjectCopies): unregisterPackage(host) keeps the restored object in this process and after a restart (BEFORE: deleted)', async () => {
        const stores: Stores = new Map();
        seed(stores, OBJECT);
        const m = await bootPass(stores);
        const { bridge, restore } = objectql(m, [OBJECT]);
        await bridge();
        await restore();
        expect(await state(m, stores, [OBJECT])).toEqual([[OBJECT, HOST, false, 1]]);

        const rebooted = await bootPass(stores);
        await rebooted.unregisterPackage(HOST);
        expect(await state(rebooted, stores, [OBJECT])).toEqual([[OBJECT, HOST, false, 1]]);
        await m.unregisterPackage(HOST);
        expect(await state(m, stores, [OBJECT])).toEqual([[OBJECT, HOST, false, 1]]);
    });

    it('CONTROL the host\'s own object (its stored body carries the host\'s stamp), bridged and restored the same way, is still removed', async () => {
        const stores: Stores = new Map();
        seed(stores, OBJECT, { _packageId: HOST });
        const m = await bootPass(stores);
        const { bridge, restore } = objectql(m, [OBJECT]);
        await bridge();
        await restore();
        const rebooted = await bootPass(stores);
        await rebooted.unregisterPackage(HOST);
        expect(await state(rebooted, stores, [OBJECT])).toEqual([[OBJECT, null, null, 0]]);
        await m.unregisterPackage(HOST);
        expect(await state(m, stores, [OBJECT])).toEqual([[OBJECT, null, null, 0]]);
    });
});
