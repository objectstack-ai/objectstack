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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { ObjectQL } from './engine.js';
import { SchemaRegistry } from './registry.js';
import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';

const PKG = 'com.objectstack.test-pkg';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        // [#8682] Declared on the real `sys_metadata`
        // (`metadata-core/src/objects/sys-metadata.object.ts`), where it is part
        // of the row's uniqueness key `(type, name, organization_id,
        // package_id)`, and written by `SysMetadataRepository` — but omitted by
        // this minimal stub. Nothing noticed while an undeclared write key just
        // travelled on to the driver; the declared-field door judges the payload
        // against this map, so the omission now shows up as the fixture defect
        // it always was. (`sys_metadata_history` genuinely carries none, so its
        // sibling stub below is left alone.)
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
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

/** Equality-only stub driver — same shape as the PR-10d.4 suite. */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (obj: string) => {
        let s = stores.get(obj);
        if (!s) { s = new Map(); stores.set(obj, s); }
        return s;
    };
    let nextId = 0;

    // `$and` / `$or` are conjoined WITH their sibling keys, the way a real
    // driver ANDs them. The short-circuiting shape this stub used to carry
    // (`if ($or) return $or.some(...)`) discarded every sibling equality key in
    // the same object, so a query like
    // `{ state:'draft', package_id, $or:[{organization_id:ORG},{organization_id:null}] }`
    // was silently answered on the `$or` alone — a different query than the one
    // written, with the suite still green. See #7620.
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

// #6483 rolled `app`'s `allowOrgOverride` back to `false` (ADR-0005 — the
// amendment table says ❌ for `page`/`app`/`action`), so overriding the
// PACKAGED app these suites are built around now needs the ONE documented
// door that remains: the `OS_METADATA_WRITABLE` operator escape hatch, which
// both write gates consult. The machinery pinned here — envelope-preserving
// hydration, shadow healing, lock-vs-shadow ordering — is exactly what an
// operator who unlocked a type would exercise, so the cases run behind the
// hatch rather than re-specimening to `view` and losing the app-switcher
// narrative the assertions are written in.
function unlockAppOverridesViaEnvHatch(): void {
    process.env.OS_METADATA_WRITABLE = 'app';
    (ObjectStackProtocolImplementation as any).resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
}

function resetEnvHatch(): void {
    delete process.env.OS_METADATA_WRITABLE;
    (ObjectStackProtocolImplementation as any).resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
}

describe('registry shadow — control-plane PUT → GET → DELETE keeps the artifact envelope', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;

    beforeEach(async () => {
        unlockAppOverridesViaEnvHatch();
        engine = new ObjectQL();
        const { driver } = makeStubDriver();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject);
        engine.registry.registerObject(sysMetadataHistoryObject);
        engine.registry.registerItem('app', artifactApp(), 'name', PKG);
        // No environmentId — single-kernel / control-plane mode, where the
        // L3 lock gate is bypassed and the GET list hydrates overlay rows
        // into the process-wide registry.
        protocol = new ObjectStackProtocolImplementation(engine);
    });

    afterEach(resetEnvHatch);

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
    // Same #6483 door as above: with `app` no longer allowOrgOverride, the
    // save would 403 NOT_OVERRIDABLE at the type gate and never reach the
    // L3 lock this case exists to prove is shadow-immune. Behind the hatch
    // the type gate passes and the LOCK is what refuses — the ordering the
    // assertion (`ITEM_LOCKED`, not `NOT_OVERRIDABLE`) pins.
    beforeEach(unlockAppOverridesViaEnvHatch);
    afterEach(resetEnvHatch);

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
            update: async (_o: string, data: any, opts?: any) => {
                // [#5480] Pinned to ObjectQL.update's OWN dispatch predicate — the twin of
                // the delete pin, on the same argument: a double looser than the engine it
                // stands in for is how #4434 shipped a REST route that 500'd for every
                // caller with its suite green, and a predicate update is no less
                // destructive than a predicate delete.
                assertEngineUpdateDispatch(data, opts);
                return { id: 'x' };
            },
            delete: async () => ({ deleted: 1 }),
        };
        const protocol = new ObjectStackProtocolImplementation(
            mockEngine, undefined, 'env_prod',
        );

        await expect(protocol.saveMetaItem({
            type: 'app', name: 'setup', organizationId: 'org_a',
            item: { ...overlayBody },
        })).rejects.toMatchObject({ code: 'ITEM_LOCKED', status: 403 });

        await expect(protocol.deleteMetaItem({
            type: 'app', name: 'setup', organizationId: 'org_a',
        })).rejects.toMatchObject({ code: 'ITEM_LOCKED', status: 403 });
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

/**
 * [#5079] The other half of the reset heal — the case
 * {@link SchemaRegistry.removeRuntimeShadow} above deliberately declines.
 *
 * A runtime-CREATED item has no packaged artifact under a composite key, so
 * `removeRuntimeShadow` leaves its plain-key entry standing (pinned directly
 * above, and correct: that method's job is un-shadowing an artifact). Since
 * #4521's write-through puts such an item in the registry, nothing else ever
 * removed it — `getMetaItems` kept enumerating a deleted item for the life of
 * the process. `removeOverlayEntry` is what `deleteMetaItem` calls once both
 * lower layers have answered "nothing".
 */
describe('SchemaRegistry.removeOverlayEntry', () => {
    it('removes the plain-key entry of a runtime-only item', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', { name: 'mine', label: 'Mine' }, 'name');

        expect(registry.removeOverlayEntry('app', 'mine')).toBe(true);
        expect(registry.getItem('app', 'mine')).toBeUndefined();
        expect(registry.listItems('app')).toEqual([]);
    });

    it('removes a `sys_metadata`-sentinel rehydration entry', () => {
        // `loadMetaFromDb` stamps the sentinel on package-less overlay rows;
        // it marks the entry as a rehydration, not a shipped artifact.
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', { name: 'hydrated', label: 'Hydrated', _packageId: 'sys_metadata' }, 'name');

        expect(registry.removeOverlayEntry('app', 'hydrated')).toBe(true);
        expect(registry.getItem('app', 'hydrated')).toBeUndefined();
    });

    it('removes a tenant-authored entry even when it carries a real package id', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', { name: 'org_authored', label: 'Org', _packageId: PKG, _provenance: 'org' }, 'name');

        expect(registry.removeOverlayEntry('app', 'org_authored')).toBe(true);
        expect(registry.getItem('app', 'org_authored')).toBeUndefined();
    });

    it('REFUSES a plain-key entry that is itself a packaged artifact', () => {
        // `loadMetadataFromService` passes the item's own `_packageId` through,
        // so a package-shipped item can be registered under the plain key.
        // Unregistering it would delete shipped code an overlay delete never
        // touched — strictly worse than the staleness this method removes.
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', { name: 'shipped', label: 'Shipped', _packageId: PKG }, 'name');

        expect(registry.removeOverlayEntry('app', 'shipped')).toBe(false);
        expect((registry.getItem('app', 'shipped') as any)?.label).toBe('Shipped');
    });

    it('never touches composite keys, and reports nothing to remove', () => {
        const registry = new SchemaRegistry({ multiTenant: false });
        registry.registerItem('app', artifactApp(), 'name', PKG);

        // No plain-key entry at all: the artifact must survive untouched.
        expect(registry.removeOverlayEntry('app', 'setup')).toBe(false);
        expect((registry.getArtifactItem('app', 'setup') as any)?.label).toBe('Setup');
        // An unknown type is a no-op, not a throw.
        expect(registry.removeOverlayEntry('nope', 'setup')).toBe(false);
    });
});
