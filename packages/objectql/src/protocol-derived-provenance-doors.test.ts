// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #16702 — the two doors that keep a tenant's OWN item editable.
 *
 * `_packageId` / `_packageVersion` / `_provenance` are READ-SIDE DERIVED:
 * `mergeArtifactProtection` recomputes them from the artifact on every read,
 * so a copy stored inside a `sys_metadata` body is never load-bearing and its
 * removal is observable only where that copy was a lie. Two seams let the lie
 * become permanent, and they cover different time windows:
 *
 *  1. **The write door.** `saveMetaItem` persisted the caller's three keys
 *     verbatim. `metadata-read-decorations.ts` deliberately does NOT strip
 *     `_provenance` from a served document, so the ordinary Studio
 *     `GET /meta/app/x` -> edit -> `PUT /meta/app/x` round trip wrote
 *     `_provenance: 'package'` into the tenant's own row.
 *  2. **Hydration.** For a non-`object` type the stored body was registered
 *     as-is (`registerItem(type, mergeArtifactProtection(data, artifact))`),
 *     while the `object` branch already restated `_provenance: 'org'` on a
 *     copy. So the row's own bytes decided: `isCodeArtifactBody` saw a truthy
 *     non-sentinel `_packageId` with non-`org` provenance, `getArtifactItem`'s
 *     bare-key fallback returned the overlay as an artifact, `isArtifactBacked`
 *     turned true and `saveMetaItem`'s overlay gate refused every later write
 *     with `NOT_OVERRIDABLE` — permanently, because the next boot re-derived
 *     the same verdict from the same row.
 *
 * Only (1) leaves rows already written bricked; only (2) lets the corpus keep
 * accumulating lies. Both land here.
 *
 * ⚠️ The keys stripped are EXACTLY those three. The `_lock*` family is NOT
 * touched: a lock is author-declarable, and dropping one is the fail-open
 * direction (the line cloud PR #2065 drew at its own producer).
 *
 * This file lives in `@objectstack/objectql` for the same reason
 * `protocol-writepath-object-ownership.test.ts` does: the subject is the REAL
 * `SchemaRegistry` reached through a REAL `ObjectQL` engine, and objectql
 * depends on metadata-protocol — only this direction holds both halves
 * without closing a cycle turbo rejects.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The repository's OWN checksum function, so a hand-seeded at-rest row carries
// the `checksum` column a real write would have left. Without it the
// optimistic lock reads `hashSpec(body)` as the parent and `null` as the head
// and refuses the follow-up save with `METADATA_CONFLICT` — a fixture defect
// that would otherwise read as the subject refusing the write.
import { hashSpec } from '@objectstack/metadata-core';
import { ObjectQL } from './engine.js';

const PKG = 'app.sdbh';
const ENV = 'env_test';

const sysMetadataObject = {
    name: 'sys_metadata',
    label: 'System Metadata',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const, primaryKey: true },
        type: { name: 'type', label: 'Type', type: 'text' as const, required: true },
        name: { name: 'name', label: 'Name', type: 'text' as const, required: true },
        organization_id: { name: 'organization_id', label: 'Org', type: 'text' as const },
        package_id: { name: 'package_id', label: 'Package', type: 'text' as const },
        metadata: { name: 'metadata', label: 'Body', type: 'longtext' as const },
        checksum: { name: 'checksum', label: 'Checksum', type: 'text' as const, maxLength: 71 },
        state: { name: 'state', label: 'State', type: 'text' as const },
        version: { name: 'version', label: 'Version', type: 'number' as const },
        created_at: { name: 'created_at', label: 'Created', type: 'datetime' as const },
        updated_at: { name: 'updated_at', label: 'Updated', type: 'datetime' as const },
    },
};

/**
 * Minimal stub DRIVER — not an engine double. The engine above it is the real
 * `ObjectQL`, so every dispatch rule the protocol depends on is the shipped
 * one; only the storage bytes are in memory. Equality-only WHERE, one record
 * store per object, shared across "restarts" so a fresh engine reads the same
 * rows a previous session wrote.
 */
function makeStubDriver() {
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
            const expected = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            const a = rowVal === undefined ? null : rowVal;
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
            const rows = Array.from(storeFor(object).values()).filter((r) => matchesWhere(r, ast?.where));
            // The caller's bound, applied AFTER the filter and by PRESENCE — a
            // `find` double that ignores `limit` answers a different query than
            // the one it was handed (`pnpm check:objectql-double-limit`).
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
        async bulkUpdate() { return []; },
        async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {},
        async rollback() {},
    };
    return { driver, stores };
}

/** A REAL engine + REAL SchemaRegistry over `driver`. No code package loaded. */
async function boot(driver: unknown) {
    const engine = new ObjectQL();
    engine.registry.logLevel = 'silent';
    engine.registerDriver(driver as any, true);
    await engine.init();
    engine.registry.registerObject(sysMetadataObject as any);
    const protocol = new ObjectStackProtocolImplementation(engine as any, undefined, ENV);
    return { engine, protocol };
}

/** The packaged artifact a real code package would have registered at load. */
function packagedApp(label: string) {
    return {
        name: 'pet_hospital',
        label,
        _packageId: PKG,
        _packageVersion: '1.0.0',
        _provenance: 'package',
        _lock: 'full',
        _lockReason: `Shipped by ${PKG}`,
    };
}


/** One `sys_metadata` row exactly as a previous session would have left it. */
function seedRow(stores: Map<string, Map<string, Record<string, unknown>>>, body: Record<string, unknown>) {
    stores.set('sys_metadata', new Map([['r_seeded', {
        id: 'r_seeded', type: 'app', name: 'pet_hospital',
        organization_id: null, package_id: PKG, state: 'active', version: 1,
        metadata: JSON.stringify(body),
        checksum: hashSpec(body),
    }]]));
}

async function storedBody(engine: ObjectQL, name = 'pet_hospital'): Promise<Record<string, unknown>> {
    const rows = await engine.find('sys_metadata', { where: { type: 'app', name } });
    expect(rows.length).toBe(1);
    return JSON.parse(String((rows[0] as any).metadata));
}

describe('#16702 — the card\'s reproduction leg, run as written', () => {
    it('write an app carrying _provenance:package -> fresh engine -> loadMetaFromDb() -> saveMetaItem no longer 403s', async () => {
        const { driver } = makeStubDriver();

        // ── session 1: the Studio GET -> PUT round trip's bytes ──────────────
        const s1 = await boot(driver);
        await s1.protocol.saveMetaItem({
            type: 'app', name: 'pet_hospital', packageId: PKG,
            item: {
                name: 'pet_hospital', label: 'Pet Hospital',
                _packageId: PKG, _packageVersion: '1.0.0', _provenance: 'package',
            },
        });
        const stored = await storedBody(s1.engine);
        console.log('[#16702 repro] stored row:', JSON.stringify(stored));

        // ── session 2: fresh engine + protocol over the SAME driver ─────────
        const s2 = await boot(driver);
        const hydration = await s2.protocol.loadMetaFromDb();
        console.log('[#16702 repro] loadMetaFromDb():', JSON.stringify(hydration));
        expect(hydration).toMatchObject({ loaded: 1, errors: 0, invalid: 0, storeUnavailable: false });

        // ── the edit that used to be refused, forever ───────────────────────
        const receipt = await s2.protocol.saveMetaItem({
            type: 'app', name: 'pet_hospital',
            item: { name: 'pet_hospital', label: 'edit' }, packageId: PKG,
        });
        console.log('[#16702 repro] second saveMetaItem receipt:', JSON.stringify(receipt));
        expect(await storedBody(s2.engine)).toMatchObject({ label: 'edit' });
    });
});

describe('#16702 door 1 — saveMetaItem strips exactly the three DERIVED keys', () => {
    it('drops _packageId / _packageVersion / _provenance from the body it persists', async () => {
        const { driver } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        await protocol.saveMetaItem({
            type: 'app', name: 'pet_hospital', packageId: PKG,
            item: {
                name: 'pet_hospital', label: 'Pet Hospital',
                _packageId: PKG, _packageVersion: '1.0.0', _provenance: 'package',
            },
        });
        const body = await storedBody(engine);
        expect(body).not.toHaveProperty('_packageId');
        expect(body).not.toHaveProperty('_packageVersion');
        expect(body).not.toHaveProperty('_provenance');
        // …and nothing else was taken with them.
        expect(body).toMatchObject({ name: 'pet_hospital', label: 'Pet Hospital' });
    });

    it('⛔ does NOT touch the _lock* family — dropping a lock is the fail-open direction', async () => {
        const { driver } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        await protocol.saveMetaItem({
            type: 'app', name: 'pet_hospital', packageId: PKG,
            item: {
                name: 'pet_hospital', label: 'Pet Hospital',
                _lock: 'full', _lockReason: 'author declared', _lockSource: 'package',
                _lockDocsUrl: 'https://example.invalid/locks',
                _packageId: PKG, _provenance: 'package',
            },
        });
        const body = await storedBody(engine);
        expect(body._lock).toBe('full');
        expect(body._lockReason).toBe('author declared');
        expect(body._lockSource).toBe('package');
        expect(body._lockDocsUrl).toBe('https://example.invalid/locks');
        expect(body).not.toHaveProperty('_packageId');
        expect(body).not.toHaveProperty('_provenance');
    });
});

describe('#16702 door 2 — hydration restates the fact for EVERY type, not only `object`', () => {
    it('a non-`object` overlay row already poisoned at rest hydrates as tenant-authored', async () => {
        const { driver, stores } = makeStubDriver();
        // A row written BEFORE door 1 existed — the population door 1 cannot
        // reach and door 2 makes harmless without rewriting it.
        seedRow(stores, {
            name: 'pet_hospital', label: 'Pet Hospital',
            _packageId: PKG, _packageVersion: '1.0.0', _provenance: 'package',
        });

        const { engine, protocol } = await boot(driver);
        expect(await protocol.loadMetaFromDb()).toMatchObject({ loaded: 1, errors: 0 });

        const hydrated = engine.registry.getItem<Record<string, unknown>>('app', 'pet_hospital');
        expect(hydrated?._provenance).toBe('org');
        // …and the protocol therefore lets the tenant edit their own app.
        await protocol.saveMetaItem({
            type: 'app', name: 'pet_hospital',
            item: { name: 'pet_hospital', label: 'edit' }, packageId: PKG,
        });
        expect(await storedBody(engine)).toMatchObject({ label: 'edit' });
    });

    it('the read-side hydration seam (`getMetaItems`) is covered by the same restatement', async () => {
        // `getMetaItems` re-stamps `_packageId` onto the body from the row's
        // package_id COLUMN before handing it to the shared hydrator, so door 1
        // alone cannot keep that body off the code-artifact test. Door 2 can.
        const { driver, stores } = makeStubDriver();
        seedRow(stores, { name: 'pet_hospital', label: 'Pet Hospital' });

        const engine = new ObjectQL();
        engine.registry.logLevel = 'silent';
        engine.registerDriver(driver as any, true);
        await engine.init();
        engine.registry.registerObject(sysMetadataObject as any);
        // environmentId omitted — the unscoped (control-plane) kernel is the
        // only one whose list read hydrates the process-wide registry.
        const protocol = new ObjectStackProtocolImplementation(engine as any);

        await protocol.getMetaItems({ type: 'app' });
        const hydrated = engine.registry.getItem<Record<string, unknown>>('app', 'pet_hospital');
        expect(hydrated?._packageId).toBe(PKG);
        expect(hydrated?._provenance).toBe('org');

        await protocol.saveMetaItem({
            type: 'app', name: 'pet_hospital',
            item: { name: 'pet_hospital', label: 'edit' }, packageId: PKG,
        });
        expect(await storedBody(engine)).toMatchObject({ label: 'edit' });
    });
});

describe('#16702 criterion 3 — NEGATIVE CONTROL: real package protection survives', () => {
    it('an app GENUINELY provided by a code package is STILL refused NOT_OVERRIDABLE', async () => {
        const { driver } = makeStubDriver();
        const { engine, protocol } = await boot(driver);
        // What a code package's loader does: register under the COMPOSITE key.
        engine.registry.registerItem('app', packagedApp('Packaged Pet Hospital'), 'name', PKG);

        await expect(
            protocol.saveMetaItem({
                type: 'app', name: 'pet_hospital',
                item: { name: 'pet_hospital', label: 'edit' }, packageId: PKG,
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    });

    it('…and still refused after a boot that hydrated a tenant overlay of the same name', async () => {
        const { driver, stores } = makeStubDriver();
        seedRow(stores, { name: 'pet_hospital', label: 'Customized' });
        const { engine, protocol } = await boot(driver);
        engine.registry.registerItem('app', packagedApp('Packaged Pet Hospital'), 'name', PKG);
        expect(await protocol.loadMetaFromDb()).toMatchObject({ loaded: 1, errors: 0 });

        await expect(
            protocol.saveMetaItem({
                type: 'app', name: 'pet_hospital',
                item: { name: 'pet_hospital', label: 'edit' }, packageId: PKG,
            }),
        ).rejects.toMatchObject({ code: 'NOT_OVERRIDABLE', status: 403 });
    });
});

describe('#16702 criterion 5 — mergeArtifactProtection precedence is unchanged', () => {
    it('where a real artifact exists its envelope still beats the stored copy AND the restatement', async () => {
        const { driver, stores } = makeStubDriver();
        seedRow(stores, { name: 'pet_hospital', label: 'Customized', _lock: 'none' });
        const { engine, protocol } = await boot(driver);
        engine.registry.registerItem('app', packagedApp('Packaged Pet Hospital'), 'name', PKG);
        expect(await protocol.loadMetaFromDb()).toMatchObject({ loaded: 1, errors: 0 });

        const hydrated = engine.registry.getItem<Record<string, unknown>>('app', 'pet_hospital');
        // The overlay's own authored content still wins for ordinary fields…
        expect(hydrated?.label).toBe('Customized');
        // …and the ARTIFACT's protection envelope wins for every protection key,
        // over the stored copy AND over door 2's `_provenance: 'org'` stamp.
        expect(hydrated?._lock).toBe('full');
        expect(hydrated?._lockReason).toBe(`Shipped by ${PKG}`);
        expect(hydrated?._packageId).toBe(PKG);
        expect(hydrated?._packageVersion).toBe('1.0.0');
        expect(hydrated?._provenance).toBe('package');
    });

    it('with NO artifact present the restatement stands and nothing is invented', async () => {
        const { driver, stores } = makeStubDriver();
        seedRow(stores, { name: 'pet_hospital', label: 'Customized', _lock: 'none' });
        const { engine, protocol } = await boot(driver);
        expect(await protocol.loadMetaFromDb()).toMatchObject({ loaded: 1, errors: 0 });

        const hydrated = engine.registry.getItem<Record<string, unknown>>('app', 'pet_hospital');
        expect(hydrated?._provenance).toBe('org');
        expect(hydrated?._lock).toBe('none');
        expect(hydrated?._packageId).toBeUndefined();
    });
});

describe('#16702 criterion 4 — the `object` branch is correct today and STAYS correct', () => {
    // [#8310] The runtime object door requires an authored OWD.
    const objectBody = (label: string) => ({
        name: 'pet_visit',
        label,
        sharingModel: 'private',
        fields: {
            name: { name: 'name', type: 'text', label: 'Name' },
            note: { name: 'note', type: 'text', label: 'Note' },
        },
    });

    it('an `object` overlay row still hydrates as `_provenance: org` and stays editable across a restart', async () => {
        const { driver } = makeStubDriver();
        const s1 = await boot(driver);
        await s1.protocol.saveMetaItem({
            type: 'object', name: 'pet_visit', packageId: PKG,
            item: {
                ...objectBody('Pet Visit'),
                _packageId: PKG, _packageVersion: '1.0.0', _provenance: 'package',
            },
        });

        // Door 1's strip runs BEFORE `saveMetaItem`'s type branch, so its scope
        // is type-AGNOSTIC: an `object` body loses the same three keys at rest.
        // Pinned here rather than implied — the `_provenance: 'org'` read below
        // comes from door 2's restatement and would stay green on its own even
        // if the strip had skipped `object`.
        const seededRows = await s1.engine.find('sys_metadata', { where: { type: 'object', name: 'pet_visit' } });
        const seededObject = JSON.parse(String((seededRows[0] as any).metadata));
        expect(seededObject).not.toHaveProperty('_packageId');
        expect(seededObject).not.toHaveProperty('_packageVersion');
        expect(seededObject).not.toHaveProperty('_provenance');
        // …and nothing else was taken with them.
        expect(seededObject).toMatchObject({ name: 'pet_visit', label: 'Pet Visit' });

        const s2 = await boot(driver);
        expect(await s2.protocol.loadMetaFromDb()).toMatchObject({ loaded: 1, errors: 0 });
        const obj = s2.engine.registry.getObject('pet_visit') as Record<string, unknown> | undefined;
        expect(obj?._provenance).toBe('org');

        await s2.protocol.saveMetaItem({
            type: 'object', name: 'pet_visit', packageId: PKG,
            item: objectBody('Pet Visit (edited)'),
        });
        const rows = await s2.engine.find('sys_metadata', { where: { type: 'object', name: 'pet_visit' } });
        expect(JSON.parse(String((rows[0] as any).metadata)).label).toBe('Pet Visit (edited)');
    });

    it('the `object` branch keeps its own registration path — door 2 did not fold it onto the shared one', async () => {
        // `applyObjectRegistryMutation` / the boot `object` limb register through
        // `registerObject` (contributor layers, ADR-0029 D9.8), never through
        // `registerItem`. The observable that tells them apart: an object
        // resolves through the CONTRIBUTOR store, so `getObject` answers.
        const { driver } = makeStubDriver();
        const s1 = await boot(driver);
        await s1.protocol.saveMetaItem({
            type: 'object', name: 'pet_visit', packageId: PKG, item: objectBody('Pet Visit'),
        });
        const s2 = await boot(driver);
        await s2.protocol.loadMetaFromDb();
        expect(s2.engine.registry.getObject('pet_visit')).toBeDefined();
        expect(s2.engine.registry.getAllObjects(PKG).map((o: any) => o.name)).toContain('pet_visit');
    });
});
