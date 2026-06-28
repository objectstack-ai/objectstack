// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0010 §3.3 — artifact protection envelope vs. registry shadows.
 *
 * Regression suite for the "registry pollution" bug: on a control-plane
 * kernel (`environmentId === undefined`), PUT /meta/app/<name> on a
 * `_lock: full` artifact-backed app succeeded (the L3 gate is
 * intentionally bypassed there), and the next GET list hydrated the
 * overlay body into the SchemaRegistry under the PLAIN key — shadowing
 * the packaged artifact registered under `<packageId>:<name>`. Every
 * envelope reader (`lookupArtifactItem` / `getEffectiveLock` /
 * `isArtifactBacked`) resolved the shadow instead of the artifact, so
 * `_lock`/`_packageId`/`_provenance` read back as undefined. A
 * subsequent DELETE (reset) removed the sys_metadata row but left the
 * shadow in place — the lock stayed lost until restart.
 *
 * Pinned here:
 *  1. The hydrated shadow carries the artifact's protection envelope.
 *  2. The list/get surfaces keep `_lock` through PUT → GET → DELETE.
 *  3. Reset heals the registry: the artifact value is visible again.
 *  4. Lock enforcement on scoped kernels is shadow-immune.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { SchemaRegistry } from './registry.js';

const PKG = 'com.objectstack.test-pkg';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'longtext' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

const sysMetadataHistoryObject = {
    name: 'sys_metadata_history',
    label: 'Metadata History',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        event_seq: { name: 'event_seq', label: 'Seq', type: 'number' as const, required: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        version: { name: 'version', label: 'Version', type: 'number' as const, required: true },
        operation_type: { name: 'operation_type', label: 'Op', type: 'text' as const, required: true },
        metadata: { name: 'metadata', label: 'Body', type: 'longtext' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        previous_checksum: { name: 'previous_checksum', label: 'Prev', type: 'text' as const, maxLength: 71 },
        change_note: { name: 'change_note', label: 'Note', type: 'longtext' as const },
        source: { name: 'source', label: 'Source', type: 'text' as const },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        recorded_by: { name: 'recorded_by', label: 'By', type: 'text' as const },
        recorded_at: { name: 'recorded_at', label: 'At', type: 'datetime' as const, required: true },
    },
};

/** Equality-only in-memory driver — same shape as the PR-10d.4 suite. */
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
        if (Array.isArray(where.$and)) return where.$and.every((w: any) => matchesWhere(row, w));
        if (Array.isArray(where.$or)) return where.$or.some((w: any) => matchesWhere(row, w));
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = row[k] === undefined ? null : row[k];
            const b = expected === undefined ? null : expected;
            if (a !== b) return false;
        }
        return true;
    };

    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {} as any,
        async connect() {},
        async disconnect() {},
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string, ast: any) {
            return Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
        },
        findStream() { throw new Error('not implemented'); },
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
        async delete(object: string, id: string) {
            return storeFor(object).delete(id);
        },
        async count(object: string, ast: any) {
            return (await this.find(object, ast)).length;
        },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}

/** Artifact app shipped by a code package with a hard lock. */
function artifactApp() {
    return {
        name: 'setup',
        label: 'Setup',
        navigation: [],
        _packageId: PKG,
        _packageVersion: '1.0.0',
        _provenance: 'package',
        _lock: 'full',
        _lockReason: 'Core admin UI shipped by the platform package.',
    };
}

const overlayBody = { name: 'setup', label: 'Setup HACKED', navigation: [] };

function findByName(items: any[], name: string): any {
    return (items as any[]).find((it) => it?.name === name);
}

describe('registry shadow — control-plane PUT → GET → DELETE keeps the artifact envelope', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        engine = new ObjectQL();
        const { driver } = makeMemoryDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject as any);
        engine.registry.registerObject(sysMetadataHistoryObject as any);
        engine.registry.registerItem('app', artifactApp(), 'name', PKG);
        // No environmentId — single-kernel / control-plane mode, where the
        // L3 lock gate is bypassed and the GET list hydrates overlay rows
        // into the process-wide registry.
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    it('GET list while the overlay row exists: overlay content wins, artifact envelope wins', async () => {
        await protocol.saveMetaItem({ type: 'app', name: 'setup', item: { ...overlayBody } });

        const res = await protocol.getMetaItems({ type: 'app' });
        const setup = findByName((res as any).items, 'setup');
        expect(setup).toBeDefined();
        expect(setup.label).toBe('Setup HACKED');     // overlay content
        expect(setup._lock).toBe('full');             // artifact envelope (ADR-0010 §3.3)
        expect(setup._packageId).toBe(PKG);
        expect(setup._provenance).toBe('package');
    });

    it('the hydrated plain-key shadow itself carries the artifact envelope', async () => {
        await protocol.saveMetaItem({ type: 'app', name: 'setup', item: { ...overlayBody } });
        await protocol.getMetaItems({ type: 'app' }); // triggers hydration

        // Registry-direct read (what nav/UI code does) must not see a
        // stripped envelope even though the overlay body shadows the
        // artifact on the plain key.
        const direct: any = engine.registry.getItem('app', 'setup');
        expect(direct.label).toBe('Setup HACKED');
        expect(direct._lock).toBe('full');
        expect(direct._packageId).toBe(PKG);
    });

    it('DELETE (reset) heals the registry: artifact value and lock are back without a restart', async () => {
        await protocol.saveMetaItem({ type: 'app', name: 'setup', item: { ...overlayBody } });
        await protocol.getMetaItems({ type: 'app' }); // pollute via hydration

        const del = await protocol.deleteMetaItem({ type: 'app', name: 'setup' });
        expect(del.success).toBe(true);
        expect(del.reset).toBe(true);

        // Registry-direct read resolves the packaged artifact again.
        const direct: any = engine.registry.getItem('app', 'setup');
        expect(direct.label).toBe('Setup');
        expect(direct._lock).toBe('full');
        expect(direct._packageId).toBe(PKG);

        // And the protocol list surface agrees.
        const res = await protocol.getMetaItems({ type: 'app' });
        const setup = findByName((res as any).items, 'setup');
        expect(setup.label).toBe('Setup');
        expect(setup._lock).toBe('full');
        expect(setup._packageId).toBe(PKG);
    });

    it('a second DELETE self-heals pre-existing pollution even with no overlay row', async () => {
        // Simulate the pre-fix world: overlay body sits on the plain key
        // with a stripped envelope, and the sys_metadata row is gone.
        engine.registry.registerItem('app', { ...overlayBody }, 'name');

        const del = await protocol.deleteMetaItem({ type: 'app', name: 'setup' });
        expect(del.success).toBe(true);
        expect(del.reset).toBe(false); // no row to delete…

        // …but the registry shadow is healed anyway.
        const direct: any = engine.registry.getItem('app', 'setup');
        expect(direct.label).toBe('Setup');
        expect(direct._lock).toBe('full');
    });
});

describe('registry shadow — scoped-kernel lock enforcement is shadow-immune', () => {
    it('saveMetaItem still 403s on a full-locked artifact when a stripped shadow exists', async () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', artifactApp(), 'name', PKG);
        // Pre-fix pollution: plain-key shadow without the lock envelope.
        registry.registerItem('app', { ...overlayBody }, 'name');

        const mockEngine: any = {
            registry,
            find: async () => [],
            findOne: async () => null,
            insert: async () => ({ id: 'x' }),
            update: async () => ({ id: 'x' }),
            delete: async () => ({ deleted: 1 }),
        };
        const protocol = new ObjectStackProtocolImplementation(
            mockEngine, undefined, undefined, 'env_prod',
        );

        await expect(protocol.saveMetaItem({
            type: 'app', name: 'setup', organizationId: 'org_a',
            item: { ...overlayBody },
        })).rejects.toMatchObject({ code: 'item_locked', status: 403 });

        await expect(protocol.deleteMetaItem({
            type: 'app', name: 'setup', organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'item_locked', status: 403 });
    });
});

describe('SchemaRegistry.getArtifactItem / removeRuntimeShadow', () => {
    it('getArtifactItem prefers the composite-key artifact over a plain-key shadow', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', artifactApp(), 'name', PKG);
        registry.registerItem('app', { ...overlayBody }, 'name');

        expect((registry.getItem('app', 'setup') as any).label).toBe('Setup HACKED');
        const artifact: any = registry.getArtifactItem('app', 'setup');
        expect(artifact.label).toBe('Setup');
        expect(artifact._lock).toBe('full');
    });

    it('getArtifactItem returns undefined for runtime-only and sys_metadata-sentinel items', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', { name: 'mine', label: 'Mine' }, 'name');
        registry.registerItem(
            'app',
            { name: 'hydrated', label: 'Hydrated', _packageId: 'sys_metadata' },
            'name',
        );
        expect(registry.getArtifactItem('app', 'mine')).toBeUndefined();
        expect(registry.getArtifactItem('app', 'hydrated')).toBeUndefined();
    });

    it('removeRuntimeShadow deletes the plain key only when a packaged artifact remains', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', artifactApp(), 'name', PKG);
        registry.registerItem('app', { ...overlayBody }, 'name');

        expect(registry.removeRuntimeShadow('app', 'setup')).toBe(true);
        expect((registry.getItem('app', 'setup') as any).label).toBe('Setup');

        // Runtime-only item: never removed.
        registry.registerItem('app', { name: 'mine', label: 'Mine' }, 'name');
        expect(registry.removeRuntimeShadow('app', 'mine')).toBe(false);
        expect((registry.getItem('app', 'mine') as any)?.label).toBe('Mine');
    });
});
