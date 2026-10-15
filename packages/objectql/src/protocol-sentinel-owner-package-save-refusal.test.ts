// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23514, ADR-0029 D9.9 — a save naming package Q of a runtime object whose
 * owner is its PACKAGE-LESS definition (the `'sys_metadata'` sentinel) is
 * refused before any write, and the refusal names a way out that works.
 *
 * ## The defect
 *
 * `classifyObjectContribution` judged a runtime owner only when it was bound to
 * a real package (#23416), so a row bound to Q beside a package-less owner was
 * classified `own` and written. The write-through's
 * `registerObject(…, Q, …, 'own')` met the registry's single-owner rule and
 * landed in `applyObjectRegistryMutation`'s best-effort warn: the save answered
 * `200`, the metadata read served Q's row, and the registry (so the data plane)
 * kept the package-less definition, before and after a boot. Measured at
 * `cb9841aa25` per the card, and again at `23e689dc7d` through
 * `PUT /api/v1/meta/object/NAME?package=Q` on a SQLite store.
 *
 * ## The way out the refusal prescribes, and why it is that one
 *
 * Delete the package-less definition WITHOUT `dropStorage` (the delete door's
 * default), which keeps the table and its records, then save naming Q: Q's row
 * becomes the owner at once and at every later boot. ADR-0070 D5's
 * `adopt-orphans` door is not it: it rebinds an object's row in storage only,
 * and the registry keeps the sentinel owner until the next boot.
 *
 * ## Why a real kernel, and two of them
 *
 * The disagreement is between the `sys_metadata` rows the driver holds and the
 * `SchemaRegistry` the data plane dispatches on, and the boot half is
 * `loadMetaFromDb`'s. `ObjectQLPlugin` binds the real protocol to the real
 * engine and registry; a second kernel over the same store is the boot.
 *
 * ## The pins
 *
 *  - the card's sequence: Q's save is refused (`code` + `status`), nothing is
 *    stored for Q, and the registry, the data plane and the metadata read agree
 *    on the package-less definition, before and after a boot;
 *  - #23630 member 2's sequence: saves naming P and then Q are both refused, so
 *    the rows `[P, Q, package-less]` cannot be produced;
 *  - the prescription, followed: the object moves into Q with its table and
 *    records, and Q's row is the owner and the served definition across a boot,
 *    for an object saved in this process and for one HYDRATED AT BOOT, on the
 *    kernel's fallback metadata and with `MetadataPlugin` (the delete heal for
 *    a boot-hydrated object is what makes the second half hold);
 *  - CONTROL: a save naming no package over the package-less owner is unchanged.
 *
 * The D9.9 refusal for an owner bound to a real package is pinned, unchanged,
 * by `protocol-runtime-owner-overlay-refusal.test.ts`.
 */

import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { MetadataPlugin } from '@objectstack/metadata';
import { ObjectQL, type EngineReadOptions } from './engine.js';
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
/** The data plane's reads and writes in these pins run as the system. */
const SYSTEM: EngineReadOptions = { context: { isSystem: true } };

/** A runtime object body; `label` tells the writes apart. */
const gadgetBody = (label: string) => ({
    name: NAME,
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
}

describe('#23514 — a save naming a package beside an object its package-less definition owns', () => {
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
     * One boot over `stores`: a kernel, a fresh engine, and `loadMetaFromDb` run
     * by the plugin's start. `withMetadataPlugin` adds the `metadata` service
     * (`MetadataPlugin`, an empty temp root, `watch: false`), into which
     * `ObjectQLPlugin.start()` copies every object it hydrated: the composition
     * whose boot-hydrated delete kept the object registered until the delete
     * heal for boot-hydrated objects landed.
     */
    async function boot(stores: Stores, drops: string[], withMetadataPlugin = false): Promise<Booted> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores, drops), true);
        if (withMetadataPlugin) {
            const root = mkdtempSync(join(tmpdir(), 'os-23514-'));
            roots.push(root);
            await kernel.use(new MetadataPlugin({ watch: false, rootDir: root }));
        }
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        return { kernel, engine, protocol: kernel.getService('protocol') };
    }

    /** The bindings of the object's stored rows, as the driver holds them. */
    const storedBindings = (stores: Stores, table: 'sys_metadata' | 'sys_metadata_history' = 'sys_metadata') =>
        Array.from(stores.get(table)?.values() ?? [])
            .filter((r) => r.type === 'object' && r.name === NAME)
            .map((r) => r.package_id ?? null);

    const save = (k: Booted, packageId: string | undefined, label: string) =>
        k.protocol.saveMetaItem({
            type: 'object', name: NAME, ...(packageId ? { packageId } : {}), item: gadgetBody(label),
        });

    const refusalOf = (k: Booted, packageId: string, label: string) =>
        save(k, packageId, label).then(() => null, (e: any) => e);

    /**
     * The three answers that must agree: the registry's owner, the definition
     * the data plane dispatches on (the registry's object), and the metadata
     * read's served row; plus the records the data plane serves.
     */
    async function served(k: Booted) {
        const read = await k.protocol.getMetaItem({ type: 'object', name: NAME });
        const records = await k.engine.find(NAME, {}, SYSTEM);
        return {
            owner: k.engine.registry.getObjectOwner(NAME)?.packageId,
            dataPlaneLabel: (k.engine.registry.getObject(NAME) as { label?: string } | undefined)?.label,
            metaReadLabel: (read?.item ?? read)?.label,
            records: records.length,
        };
    }

    /** The object saved naming no package, with two records in its table. */
    async function seedPackagelessOwner(stores: Stores, drops: string[]): Promise<Booted> {
        const k = await boot(stores, drops);
        const res = await save(k, undefined, 'Gadget unbound');
        expect(res.success).toBe(true);
        await k.engine.insert(NAME, { name: 'rec-1' }, SYSTEM);
        await k.engine.insert(NAME, { name: 'rec-2' }, SYSTEM);
        expect(storedBindings(stores)).toEqual([null]);
        expect(k.engine.registry.getObjectOwner(NAME)?.packageId).toBe(SENTINEL);
        expect(k.engine.registry.getPackagedObjectOwner(NAME)).toBeUndefined();
        return k;
    }

    /** The refusal's envelope, and the first sentence the ruling binds: a way out, never "bind it to sys_metadata". */
    function expectRefusal(err: any): void {
        expect(err).toBeInstanceOf(Error);
        expect(err.code).toBe('OBJECT_OVERLAY_PACKAGE_MISMATCH');
        expect(err.status).toBe(422);
        expect(err.packageId).toBe(Q);
        expect(err.ownerPackageId).toBeNull();
        expect(err.message).toMatch(
            new RegExp(`^Move object '${NAME}' into package '${Q.replace(/\./g, '\\.')}' first: delete its `
                + 'package-less definition without dropStorage, which keeps its table and records '),
        );
        expect(err.message).not.toContain(`'${SENTINEL}'`);
    }

    it('the card\'s sequence: Q\'s save is refused before any write, and the stores agree, before and after a boot', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k1 = await seedPackagelessOwner(stores, drops);
        const historyBefore = storedBindings(stores, 'sys_metadata_history');

        expectRefusal(await refusalOf(k1, Q, 'Gadget Q'));

        // Nothing stored for Q: no row, and no history entry either.
        expect(storedBindings(stores)).toEqual([null]);
        expect(storedBindings(stores, 'sys_metadata_history')).toEqual(historyBefore);
        expect(await served(k1)).toEqual({
            owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
        });

        await k1.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(await served(k2)).toEqual({
            owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
        });
        // The refusal holds across the boot.
        expectRefusal(await refusalOf(k2, Q, 'Gadget Q'));
        expect(storedBindings(stores)).toEqual([null]);
        expect(drops).toEqual([]);
    });

    it('#23630 member 2: saves naming P and then Q are both refused, so `[P, Q, package-less]` cannot be produced', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k1 = await seedPackagelessOwner(stores, drops);

        const pErr = await refusalOf(k1, P, 'Gadget P');
        expect(pErr?.code).toBe('OBJECT_OVERLAY_PACKAGE_MISMATCH');
        expect(pErr?.status).toBe(422);
        expect(pErr?.packageId).toBe(P);
        expectRefusal(await refusalOf(k1, Q, 'Gadget Q'));

        expect(storedBindings(stores)).toEqual([null]);
        expect(await served(k1)).toEqual({
            owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
        });

        await k1.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(storedBindings(stores)).toEqual([null]);
        expect(await served(k2)).toEqual({
            owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
        });
    });

    it('the prescription is a way out: the object moves into Q with its table and records, and Q\'s row is the owner across a boot', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k1 = await seedPackagelessOwner(stores, drops);
        expectRefusal(await refusalOf(k1, Q, 'Gadget Q'));

        // The prescription, as written: the delete names no package and no dropStorage…
        const del = await k1.protocol.deleteMetaItem({ type: 'object', name: NAME });
        expect(del.success).toBe(true);
        expect(storedBindings(stores)).toEqual([]);
        expect(drops).toEqual([]);
        expect(stores.get(NAME)?.size).toBe(2);
        // …and the same save, sent again.
        const res = await save(k1, Q, 'Gadget Q');
        expect(res.success).toBe(true);

        expect(storedBindings(stores)).toEqual([Q]);
        expect(await served(k1)).toEqual({
            owner: Q, dataPlaneLabel: 'Gadget Q', metaReadLabel: 'Gadget Q', records: 2,
        });

        await k1.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(await served(k2)).toEqual({
            owner: Q, dataPlaneLabel: 'Gadget Q', metaReadLabel: 'Gadget Q', records: 2,
        });
        // Q's own re-save after the boot goes live.
        expect((await save(k2, Q, 'Gadget Q2')).success).toBe(true);
        expect(storedBindings(stores)).toEqual([Q]);
        expect(await served(k2)).toEqual({
            owner: Q, dataPlaneLabel: 'Gadget Q2', metaReadLabel: 'Gadget Q2', records: 2,
        });
        expect(drops).toEqual([]);
    });

    for (const { composition, withMetadataPlugin } of [
        { composition: 'the kernel\'s fallback metadata', withMetadataPlugin: false },
        { composition: 'MetadataPlugin', withMetadataPlugin: true },
    ]) {
        it(`the prescription is a way out for an object HYDRATED AT BOOT too (${composition}): gone at once after the delete, then Q's row is the owner with the table and records kept, and a boot agrees`, async () => {
            const stores: Stores = new Map();
            const drops: string[] = [];
            const k1 = await seedPackagelessOwner(stores, drops);
            await k1.kernel.shutdown();

            // The object is now hydrated at boot, not saved in this process.
            const k2 = await boot(stores, drops, withMetadataPlugin);
            expect(await served(k2)).toEqual({
                owner: SENTINEL, dataPlaneLabel: 'Gadget unbound', metaReadLabel: 'Gadget unbound', records: 2,
            });
            expectRefusal(await refusalOf(k2, Q, 'Gadget Q'));
            expect(storedBindings(stores)).toEqual([null]);

            // The prescription's first call: the delete names no package and no dropStorage.
            const del = await k2.protocol.deleteMetaItem({ type: 'object', name: NAME });
            expect(del.success).toBe(true);
            // The registry owner, the metadata read and the data plane agree it is gone at once;
            // the table keeps its records.
            expect(storedBindings(stores)).toEqual([]);
            expect(k2.engine.registry.getObjectOwner(NAME)).toBeUndefined();
            expect(k2.engine.registry.getObject(NAME)).toBeUndefined();
            expect((await k2.protocol.getMetaItem({ type: 'object', name: NAME }))?.item).toBeUndefined();
            await expect(k2.engine.find(NAME, {}, SYSTEM))
                .rejects.toMatchObject({ code: 'OBJECT_NOT_FOUND', status: 404 });
            expect(stores.get(NAME)?.size).toBe(2);

            // The second call: the same save, sent again.
            expect((await save(k2, Q, 'Gadget Q')).success).toBe(true);
            expect(storedBindings(stores)).toEqual([Q]);
            expect(await served(k2)).toEqual({
                owner: Q, dataPlaneLabel: 'Gadget Q', metaReadLabel: 'Gadget Q', records: 2,
            });
            await k2.engine.insert(NAME, { name: 'rec-3' }, SYSTEM);

            await k2.kernel.shutdown();
            const k3 = await boot(stores, drops, withMetadataPlugin);
            expect(await served(k3)).toEqual({
                owner: Q, dataPlaneLabel: 'Gadget Q', metaReadLabel: 'Gadget Q', records: 3,
            });
            expect(storedBindings(stores)).toEqual([Q]);
            expect(drops).toEqual([]);
        });
    }

    it('CONTROL: a save naming no package over the package-less owner is unchanged', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k1 = await seedPackagelessOwner(stores, drops);

        const res = await save(k1, undefined, 'Gadget unbound v2');

        expect(res.success).toBe(true);
        expect(storedBindings(stores)).toEqual([null]);
        expect(await served(k1)).toEqual({
            owner: SENTINEL, dataPlaneLabel: 'Gadget unbound v2', metaReadLabel: 'Gadget unbound v2', records: 2,
        });
    });
});
