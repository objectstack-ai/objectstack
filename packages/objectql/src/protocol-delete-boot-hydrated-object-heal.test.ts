// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23645 — deleting a runtime object that was HYDRATED AT BOOT unregisters it
 * at once, as the delete of one saved in the same process always did.
 *
 * ## The defect
 *
 * On a kernel with no `environmentId`, `ObjectQLPlugin.start()` copies every
 * object the registry holds into the `metadata` service
 * (`bridgeObjectsToMetadataService`). That includes each runtime object
 * hydrated from `sys_metadata`, whose copy carries the registry's
 * `_provenance: 'org'`. Nothing removes the copy when the row is deleted.
 *
 * The delete heal (`restoreArtifactRegistryView`) reads the `metadata`
 * service as its tier-2 BASELINE. It found the copy, re-registered it, and
 * returned before tier 3's `unregisterObject`. Measured on this file's kernel
 * before the fix: `DELETE` answered "it no longer exists" and the stored row
 * was gone. Yet the registry owner stayed, the data plane kept serving the
 * table's records, and `getMetaItem`, the list and the layered `code` layer
 * served the same copy, all until the next boot. The two other kernel shapes
 * never had the copy, so they never had the defect: an object saved in the
 * same process, and a kernel with an `environmentId` (no bridge).
 *
 * The fix is in `readItemFromMetadataService`, the one read every code-layer
 * reader goes through, the heal's tier 2 included. A tenant-authored OBJECT
 * body answers there as a clean miss, by the marker #21059 already reads
 * (`isTenantAuthored`). The list's merge drops such objects from its base.
 *
 * ## Why a real kernel, with `MetadataPlugin`
 *
 * The copy is made by `ObjectQLPlugin.start()` into the `metadata` service
 * `MetadataPlugin` provides (a `NodeMetadataManager`, `watch: false`), and the
 * boot half is `loadMetaFromDb`'s. A second kernel over the same store is the
 * boot.
 *
 * ## The pins
 *
 *  - a package-less runtime object and one bound to a package (the variant the
 *    card left unmeasured): after the delete, the owner, the by-name read, the
 *    list, the layered read and the data plane agree it is gone, and its table
 *    keeps its records;
 *  - then a save naming a package makes that package the owner, with the table
 *    and records kept, and a boot agrees: the way out #23514's refusal names;
 *  - CONTROL: a code package's object that reaches the same delete keeps its
 *    baseline (tier 2 still re-registers it).
 *
 * The negative control (red with the fix removed) is a one-time ablation,
 * cited in the PR, not a permanent case.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/**
 * In-memory driver, copied from `protocol-runtime-owner-overlay-refusal.test.ts`;
 * equality-only WHERE. `dropTable` records the tables a run drops, so a pin can
 * say none was.
 */
function makeMemoryDriver(stores: Stores, drops: string[]) {
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
        async dropTable(object: string) { drops.push(object); stores.delete(object); },
    };
    return driver;
}

const P = 'com.qa.p';
const Q = 'com.qa.q';
const NAME = 'qa_probe_gadget';
const SENTINEL = 'sys_metadata';
const SHIPPED_PKG = 'com.qa.shipped';
const SHIPPED = 'qa_shipped_widget';
const SYSTEM = { context: { isSystem: true } } as any;

/** A runtime object body; `label` tells the writes apart. */
const gadgetBody = (label: string, name = NAME) => ({
    name,
    label,
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
    },
});

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    protocol: any;
    metadata: any;
}

describe('#23645 — a runtime object hydrated at boot, then deleted', () => {
    const live: ObjectKernel[] = [];
    const roots: string[] = [];
    afterEach(async () => {
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
        while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
    });

    /**
     * One boot over `stores`: `MetadataPlugin` provides the `metadata` service
     * (an empty temp root, so it scans nothing), and `ObjectQLPlugin` with no
     * `environmentId` hydrates `sys_metadata` and runs the boot bridge.
     * `beforeBoot` registers what a code package ships, ahead of the bridge.
     */
    async function boot(stores: Stores, drops: string[], beforeBoot?: (engine: ObjectQL) => void): Promise<Booted> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const root = mkdtempSync(join(tmpdir(), 'os-23645-'));
        roots.push(root);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores, drops), true);
        await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        beforeBoot?.(engine);
        await kernel.bootstrap();
        // [#26708] The workspaces the saves below name are installed, as
        // authored bases: a save naming a package no installed package has
        // is refused before it is written.
        for (const id of [P, Q]) engine.registry.installPackage({ id, name: id, version: '1.0.0' } as any, 'authored');
        return {
            kernel,
            engine,
            protocol: kernel.getService('protocol'),
            metadata: kernel.getService('metadata'),
        };
    }

    /** The bindings of the object's stored rows, as the driver holds them. */
    const storedBindings = (stores: Stores) =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .filter((r) => r.type === 'object' && r.name === NAME)
            .map((r) => r.package_id ?? null);

    const save = (k: Booted, packageId: string | undefined, label: string) =>
        k.protocol.saveMetaItem({
            type: 'object', name: NAME, ...(packageId ? { packageId } : {}), item: gadgetBody(label),
        });

    /**
     * The answers that must agree on a live object: the registry's owner, the
     * definition the data plane dispatches on, the by-name read, and the
     * records the data plane serves.
     */
    async function served(k: Booted, name = NAME) {
        const read = await k.protocol.getMetaItem({ type: 'object', name });
        return {
            owner: k.engine.registry.getObjectOwner(name)?.packageId,
            dataPlaneLabel: (k.engine.registry.getObject(name) as { label?: string } | undefined)?.label,
            metaReadLabel: (read?.item as { label?: string } | undefined)?.label,
            records: (await k.engine.find(name, {}, SYSTEM)).length,
        };
    }

    /** The object saved under `binding` (or none), two records in its table, then a second boot. */
    async function bootHydrated(stores: Stores, drops: string[], binding: string | undefined): Promise<Booted> {
        const k1 = await boot(stores, drops);
        expect((await save(k1, binding, 'Gadget')).success).toBe(true);
        await k1.engine.insert(NAME, { name: 'rec-1' }, SYSTEM);
        await k1.engine.insert(NAME, { name: 'rec-2' }, SYSTEM);
        await k1.kernel.shutdown();

        const k2 = await boot(stores, drops);
        expect(await served(k2)).toEqual({
            owner: binding ?? SENTINEL, dataPlaneLabel: 'Gadget', metaReadLabel: 'Gadget', records: 2,
        });
        // The defect's ingredient: the boot bridge's copy of the hydrated row,
        // stamped tenant-authored. Without it the pins below would pass for an
        // empty reason.
        const copy = await k2.metadata.get('object', NAME);
        expect(copy).toMatchObject({ label: 'Gadget', _packageId: binding ?? SENTINEL, _provenance: 'org' });
        return k2;
    }

    /** Every read that must say the object is gone, and the table that must keep its records. */
    async function expectGone(k: Booted, stores: Stores, drops: string[]) {
        expect(storedBindings(stores)).toEqual([]);
        expect(k.engine.registry.getObjectOwner(NAME)).toBeUndefined();
        expect(k.engine.registry.getObject(NAME)).toBeUndefined();
        // The by-name read, the list and the layered read.
        expect((await k.protocol.getMetaItem({ type: 'object', name: NAME }))?.item).toBeUndefined();
        const listed = (await k.protocol.getMetaItems({ type: 'object' })).items as Array<{ name?: string }>;
        expect(listed.map((it) => it?.name)).not.toContain(NAME);
        const layered = await k.protocol.getMetaItemLayered({ type: 'object', name: NAME });
        expect({ code: layered.code, overlay: layered.overlay, effective: layered.effective })
            .toEqual({ code: null, overlay: null, effective: null });
        // The data plane refuses with the ADR-0112 envelope.
        await expect(k.engine.find(NAME, {}, SYSTEM)).rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
        // The table and its records are kept (no `dropStorage`).
        expect(stores.get(NAME)?.size).toBe(2);
        expect(drops).toEqual([]);
    }

    const bindings: Array<{ label: string; binding: string | undefined }> = [
        { label: 'package-less', binding: undefined },
        { label: 'bound to a package', binding: P },
    ];

    for (const { label, binding } of bindings) {
        it(`${label}: the owner, the reads and the data plane agree it is gone at once, and the table keeps its records`, async () => {
            const stores: Stores = new Map();
            const drops: string[] = [];
            const k2 = await bootHydrated(stores, drops, binding);

            const del = await k2.protocol.deleteMetaItem({ type: 'object', name: NAME });

            expect(del).toMatchObject({ success: true, reset: true });
            await expectGone(k2, stores, drops);
        });

        it(`${label}: then a save naming a package makes it the owner, with the table and records kept, and a boot agrees`, async () => {
            const stores: Stores = new Map();
            const drops: string[] = [];
            const k2 = await bootHydrated(stores, drops, binding);
            expect((await k2.protocol.deleteMetaItem({ type: 'object', name: NAME })).success).toBe(true);
            await expectGone(k2, stores, drops);

            expect((await save(k2, Q, 'Gadget Q')).success).toBe(true);

            expect(storedBindings(stores)).toEqual([Q]);
            expect(await served(k2)).toEqual({
                owner: Q, dataPlaneLabel: 'Gadget Q', metaReadLabel: 'Gadget Q', records: 2,
            });
            await k2.engine.insert(NAME, { name: 'rec-3' }, SYSTEM);

            await k2.kernel.shutdown();
            const k3 = await boot(stores, drops);
            expect(await served(k3)).toEqual({
                owner: Q, dataPlaneLabel: 'Gadget Q', metaReadLabel: 'Gadget Q', records: 3,
            });
            expect(storedBindings(stores)).toEqual([Q]);
            expect(drops).toEqual([]);
        });
    }

    it('CONTROL: a code package\'s object reaching the same delete keeps its baseline, still owned, served and dispatched', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops, (engine) => {
            engine.registerApp({
                id: SHIPPED_PKG, name: SHIPPED_PKG, version: '1.0.0', type: 'app',
                objects: [gadgetBody('Shipped', SHIPPED)],
            });
        });
        await k.engine.insert(SHIPPED, { name: 'w-1' }, SYSTEM);
        // The boot bridge's copy of a CODE object: the baseline tier 2 restores.
        expect(await k.metadata.get('object', SHIPPED))
            .toMatchObject({ label: 'Shipped', _packageId: SHIPPED_PKG, _provenance: 'package' });
        const plainKey = () => ((k.engine.registry as any).metadata as Map<string, Map<string, any>>)
            .get('object')?.get(SHIPPED);
        expect(plainKey()).toBeUndefined();

        // No row is stored, so the delete runs the heal alone.
        const del = await k.protocol.deleteMetaItem({ type: 'object', name: SHIPPED });

        expect(del).toMatchObject({ success: true, reset: false });
        // Tier 2 re-registered the baseline, and nothing was retired.
        expect(plainKey()).toMatchObject({ label: 'Shipped' });
        expect(await served(k, SHIPPED)).toEqual({
            owner: SHIPPED_PKG, dataPlaneLabel: 'Shipped', metaReadLabel: 'Shipped', records: 1,
        });
        expect(drops).toEqual([]);
    });
});
