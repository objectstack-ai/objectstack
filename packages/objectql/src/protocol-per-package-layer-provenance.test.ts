// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28831, #22024, ADR-0146 D8] The per-package layer
 * (`getMetaItemsPerPackage`) stamps each item with ITS OWN package's
 * envelope, or with none: a stored row bound to a package that ships no
 * artifact of the name never takes another package's `_packageId`,
 * `_packageVersion` or `_provenance` through the artifact lookup's fallback
 * to the first code package that ships the name. A `.custom` pair's declared
 * override keeps the stamp it is served under (its base's), judged by
 * `isServedOverrideRowOf` on the row's own `package_id`.
 *
 * Two readers ask this layer: the anonymous form doors' withdrawal layer
 * (unscoped) and the package export (scoped to the exported package). Both
 * reads are pinned here, row by row, beside PR #28828's view control in
 * `protocol-bundle-member-base-address.test.ts`. The doors themselves read no
 * stamp (the withdrawal judgement matches by name, and the export drops every
 * `_` key), so the layer is where the stamp is pinned.
 *
 * Harness: the real protocol over the real `ObjectQL` engine and an in-memory
 * driver (copied from `protocol-bundle-member-base-address.test.ts`). Rows the
 * override write gate refuses today are laid down as stored before it: the
 * same door with the gate's verdict held at `not_concerned` for that write.
 *
 * Test-path resolution: the protocol is `@objectstack/metadata-protocol`'s
 * `dist/`, so a change there is read here after that package is rebuilt.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SysMetadataAuditObject, SysMetadataCommitObject, SysMetadataHistoryObject } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const BASE = 'com.example.showcase';
const PAIR = 'com.example.showcase.custom';
const DEPENDENT = 'com.default.acme-addon';
/** A view item the base ships (its container expands it). */
const VIEW = 'showcase_task.default';
const BASE_COLUMNS = ['title', 'status'];
const DECLARATION = { package: BASE, basedOn: '1.0.0' };
/** The base's artifact envelope: `_packageId`, `_packageVersion`, `_provenance`. */
const BASE_ENVELOPE = [BASE, '1.0.0', 'package'] as const;

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
    return { driver, stores };
}

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
            fields: Object.fromEntries(BASE_COLUMNS.map((f) => [f, { name: f, label: f, type: 'text' }])),
        }],
        views: [{
            object: 'showcase_task',
            list: {
                label: 'All Tasks',
                type: 'grid',
                data: { provider: 'object', object: 'showcase_task' },
                columns: BASE_COLUMNS.map((field) => ({ field })),
            },
        }],
    };
}

async function boot() {
    const engine = new ObjectQL();
    const { driver } = makeMemoryDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject, 'test-package');
    for (const o of [SysMetadataHistoryObject, SysMetadataAuditObject, SysMetadataCommitObject]) {
        engine.registry.registerObject(o as any, 'test-package');
    }
    engine.registerApp(baseManifest());
    const protocol = new ObjectStackProtocolImplementation(engine, () => new Map());
    return { engine, protocol };
}

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

/** Installs a writable package through the package door (the pair as its ensure door writes it). */
async function install(protocol: ObjectStackProtocolImplementation, id: string): Promise<void> {
    await (protocol as any).installPackage({
        manifest: {
            id, name: id.split('.').join('-'), version: '0.1.0', type: 'app',
            ...(id === PAIR
                ? { namespace: 'showcase_custom', dependencies: { [BASE]: '^1' } }
                : { dependencies: { [BASE]: '*' } }),
        },
    });
}

const viewBody = (columns: readonly string[], extra: Record<string, unknown> = {}) => ({
    name: VIEW, object: 'showcase_task', viewKind: 'list', label: 'All Tasks',
    config: { type: 'grid', data: { provider: 'object', object: 'showcase_task' }, columns: columns.map((field) => ({ field })) },
    ...extra,
});

/** A draft save naming the package, then the per-item publish, the override write gate held for a legacy row. */
async function store(
    protocol: ObjectStackProtocolImplementation, packageId: string, item: Record<string, unknown>, legacy: boolean,
): Promise<void> {
    const gated = protocol as any;
    if (legacy) gated.overrideWriteVerdict = () => ({ verdict: 'not_concerned' });
    try {
        await protocol.saveMetaItem({ type: 'view', name: VIEW, item, mode: 'draft', packageId } as any);
        await protocol.publishMetaItem({ type: 'view', name: VIEW, packageId } as any);
    } finally {
        if (legacy) delete gated.overrideWriteVerdict;
    }
}

/**
 * The per-package layer's items of `VIEW`, as `[columns, _packageId, _packageVersion, _provenance]`,
 * by columns. Unscoped: the anonymous form doors' withdrawal layer. Scoped: the package export's read.
 */
const layer = async (protocol: ObjectStackProtocolImplementation, packageId?: string) =>
    (((await (protocol as any).getMetaItemsPerPackage({ type: 'view', ...(packageId ? { packageId } : {}) })) as any).items as any[])
        .filter((i) => i?.name === VIEW)
        .map((i) => [
            (i?.config?.columns ?? i?.columns ?? []).map((c: any) => c?.field ?? c).join(','),
            i._packageId ?? null, i._packageVersion ?? null, i._provenance ?? null,
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

describe('[#28831] the per-package layer stamps each row with its own package', () => {
    it('a dependent\'s and a pair\'s undeclared row under a base view name read their own package; the base\'s view reads the base', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await install(protocol, DEPENDENT);
        await store(protocol, PAIR, viewBody(['title']), true);
        await store(protocol, DEPENDENT, viewBody(['status']), true);

        const rows = await layer(protocol);
        expect(rows).toEqual([
            ['status', DEPENDENT, null, null],
            ['title', PAIR, null, null],
            ['title,status', ...BASE_ENVELOPE],
        ]);
    });

    it('control: the pair\'s declared override keeps the stamp it is served under, the base\'s', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await store(protocol, PAIR, viewBody(['title'], { overrides: DECLARATION }), false);

        const rows = await layer(protocol);
        expect(rows).toEqual([
            ['title', ...BASE_ENVELOPE],
            ['title,status', ...BASE_ENVELOPE],
        ]);
    });

    it('the export\'s read: each package\'s scoped layer carries its own provenance, never the base\'s', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await install(protocol, DEPENDENT);
        await store(protocol, PAIR, viewBody(['title']), true);
        await store(protocol, DEPENDENT, viewBody(['status']), true);
        expect(await layer(protocol, DEPENDENT)).toEqual([['status', DEPENDENT, null, null]]);
        expect(await layer(protocol, PAIR)).toEqual([['title', PAIR, null, null]]);
        expect(await layer(protocol, BASE)).toEqual([['title,status', ...BASE_ENVELOPE]]);
    });

    it('control: the pair\'s scoped layer keeps the base\'s stamp on its declared override', async () => {
        const { protocol } = await boot();
        await install(protocol, PAIR);
        await store(protocol, PAIR, viewBody(['title'], { overrides: DECLARATION }), false);

        expect(await layer(protocol, PAIR)).toEqual([['title', ...BASE_ENVELOPE]]);
    });
});
