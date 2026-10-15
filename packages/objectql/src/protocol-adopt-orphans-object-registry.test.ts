// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23646, ADR-0070 D5 — an orphan adoption leaves the registry agreeing with
 * storage for every object it adopts, in the same request, with no restart.
 *
 * ## The defect
 *
 * `reassignOrphanedMetadata` (the method `POST /api/v1/packages/:id/adopt-orphans`
 * calls) rebinds each package-less `sys_metadata` row to the target package Q
 * in storage. Its registry write-through followed view rows only, so an
 * adopted runtime object kept the owner its package-less row registered (the
 * `'sys_metadata'` sentinel) and its pre-adoption definition until the next
 * boot. Meanwhile a save naming Q answered `200` and never went live: the
 * write-through's `registerObject(…, Q, …, 'own')` met the registry's
 * single-owner rule (ADR-0029 D3) and landed in a best-effort warn. Measured
 * on `origin/main` `57994c311f` at protocol level and over the HTTP route on a
 * booted CRM example.
 *
 * ## The fix the pins hold
 *
 * For each adopted object row, the orphan's own contribution leaves the
 * registry (`SchemaRegistry.unregisterObject`, the verb the delete heal hands
 * an object's name to a remaining row with) and the row registers at its new
 * binding through the one write-through every save uses. The registry holds
 * one owner per name throughout; no new registry verb exists.
 *
 * ## Why a real kernel, and three of them
 *
 * The disagreement is between the `sys_metadata` rows the driver holds and the
 * `SchemaRegistry` the data plane dispatches on, and the boot half is
 * `loadMetaFromDb`'s. `ObjectQLPlugin` binds the real protocol to the real
 * engine and registry; another kernel over the same store is a boot.
 *
 * ## The pins
 *
 *  - adopt, then read the owner and the served definition: Q at once, for an
 *    object saved in this process and for one hydrated at boot;
 *  - a save naming Q after the adoption goes live;
 *  - a boot after that agrees;
 *  - an adopted draft object row registers nothing, as the boot registers
 *    none;
 *  - an object another package extends keeps its old owner (the registry
 *    refuses to drop it), said once at `error`;
 *  - CONTROL: an adoption of non-object items leaves the object registry
 *    untouched, and the view write-through follows the view as before;
 *  - CONTROL: a package-less row of an object another package's row owns is
 *    rebound in storage and the registry keeps that owner, as before.
 *
 * The negative control (the object limb removed, these pins red) is a one-off
 * ablation recorded in the PR body, not a test.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
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

const Q = 'com.qa.q';
const R = 'com.qa.r';
const NAME = 'qa_probe_gadget';
const VIEW = 'qa_probe_gadget_grid';
const SENTINEL = 'sys_metadata';

/** A runtime object body; `label` tells the writes apart, `extra` adds a field. */
const gadgetBody = (label: string, extra?: string) => ({
    name: NAME,
    label,
    // [#8310] The runtime object door requires an authored OWD.
    sharingModel: 'private',
    fields: {
        name: { name: 'name', type: 'text', label: 'Name' },
        ...(extra ? { [extra]: { name: extra, type: 'text', label: 'Extra' } } : {}),
    },
});

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    protocol: any;
}

describe('#23646 — an orphan adoption moves an adopted object\'s registry owner with its row', () => {
    const live: ObjectKernel[] = [];
    afterEach(async () => {
        vi.restoreAllMocks();
        while (live.length) {
            const kernel = live.pop()!;
            if (kernel.getState() === 'running') await kernel.shutdown();
        }
    });

    /** One boot over `stores`: a kernel, a fresh engine, and `loadMetaFromDb` run by the plugin's start. */
    async function boot(stores: Stores, drops: string[]): Promise<Booted> {
        // `logger.level` is the real config key, and gracefulShutdown:false keeps
        // process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores, drops), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        return { kernel, engine, protocol: kernel.getService('protocol') };
    }

    /** The bindings of `name`'s stored rows of `type`, as the driver holds them. */
    const storedBindings = (stores: Stores, type = 'object', name = NAME) =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .filter((r) => r.type === type && r.name === name)
            .map((r) => r.package_id ?? null);

    const save = (k: Booted, packageId: string | undefined, label: string, extra?: string) =>
        k.protocol.saveMetaItem({
            type: 'object', name: NAME, ...(packageId ? { packageId } : {}), item: gadgetBody(label, extra),
        });

    /**
     * The answers that must agree with storage: the registry's owner, the
     * definition the data plane dispatches on (the registry's object, its label
     * and its package stamp), the metadata read's served row, and the records.
     */
    async function served(k: Booted) {
        const read = await k.protocol.getMetaItem({ type: 'object', name: NAME });
        const records = await k.engine.find(NAME, {}, { context: { isSystem: true } } as any);
        const object = k.engine.registry.getObject(NAME) as { label?: string; _packageId?: string } | undefined;
        return {
            owner: k.engine.registry.getObjectOwner(NAME)?.packageId,
            dataPlaneLabel: object?.label,
            dataPlanePackage: object?._packageId,
            metaReadLabel: (read?.item ?? read)?.label,
            records: records.length,
        };
    }

    /** The object saved naming no package, with two records in its table: the sentinel owns it. */
    async function seedPackagelessObject(stores: Stores, drops: string[]): Promise<Booted> {
        const k = await boot(stores, drops);
        const res = await save(k, undefined, 'Gadget unbound');
        expect(res.success).toBe(true);
        await k.engine.insert(NAME, { name: 'rec-1' }, { context: { isSystem: true } } as any);
        await k.engine.insert(NAME, { name: 'rec-2' }, { context: { isSystem: true } } as any);
        expect(storedBindings(stores)).toEqual([null]);
        expect(k.engine.registry.getObjectOwner(NAME)?.packageId).toBe(SENTINEL);
        return k;
    }

    it.each([
        ['saved in this process', false],
        ['hydrated at boot', true],
    ])('an adopted object (%s): Q owns it at once, a save naming Q goes live, and a boot agrees', async (_how, reboot) => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        let k = await seedPackagelessObject(stores, drops);
        if (reboot) {
            await k.kernel.shutdown();
            k = await boot(stores, drops);
            expect(await served(k)).toMatchObject({ owner: SENTINEL, dataPlanePackage: SENTINEL });
        }

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ success: true, reassignedCount: 1, reassigned: [{ type: 'object', name: NAME }] });
        expect(storedBindings(stores)).toEqual([Q]);
        // The same request: the registry agrees with storage, with no restart.
        expect(await served(k)).toEqual({
            owner: Q, dataPlaneLabel: 'Gadget unbound', dataPlanePackage: Q, metaReadLabel: 'Gadget unbound', records: 2,
        });
        // One owner, and Q's package filter lists it (the sidebar's read).
        expect(k.engine.registry.getObjectContributors(NAME).filter((c) => c.ownership === 'own')).toHaveLength(1);
        expect(k.engine.registry.getAllObjects(Q).map((o) => o.name)).toContain(NAME);

        // A save naming Q goes live: its new field is on the data plane at once.
        expect((await save(k, Q, 'Gadget Q', 'serial')).success).toBe(true);
        expect(storedBindings(stores)).toEqual([Q]);
        expect(await served(k)).toEqual({
            owner: Q, dataPlaneLabel: 'Gadget Q', dataPlanePackage: Q, metaReadLabel: 'Gadget Q', records: 2,
        });
        await k.engine.insert(NAME, { name: 'rec-3', serial: 'S-3' }, { context: { isSystem: true } } as any);

        // A boot after that agrees.
        await k.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(await served(k2)).toEqual({
            owner: Q, dataPlaneLabel: 'Gadget Q', dataPlanePackage: Q, metaReadLabel: 'Gadget Q', records: 3,
        });
        expect(drops).toEqual([]);
    });

    it('an adopted DRAFT object row is rebound in storage only: a draft never reaches the registry', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        // A package-less draft, as a pre-package-first stopgap left it.
        await k.engine.insert('sys_metadata', {
            type: 'object', name: NAME, state: 'draft', package_id: null,
            metadata: JSON.stringify(gadgetBody('Gadget draft')),
        }, { context: { isSystem: true } } as any);
        const registerObject = vi.spyOn(k.engine.registry, 'registerObject');
        const registerItem = vi.spyOn(k.engine.registry, 'registerItem');

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ reassignedCount: 1, reassigned: [{ type: 'object', name: NAME }] });
        expect(storedBindings(stores)).toEqual([Q]);
        expect(registerObject).not.toHaveBeenCalled();
        expect(registerItem.mock.calls.filter(([type]) => type === 'object')).toEqual([]);
        expect(k.engine.registry.getObject(NAME)).toBeUndefined();
    });

    it('an object another package extends keeps its old owner, said once at `error` naming the object', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await seedPackagelessObject(stores, drops);
        // A code package's extension of the runtime object: `unregisterObject`'s
        // ADR-0029 guard refuses to drop an owner another package extends.
        k.engine.registry.registerObject({
            name: NAME, fields: { ext_note: { name: 'ext_note', type: 'text', label: 'Note' } },
        } as any, R, undefined, 'extend');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ success: true, reassignedCount: 1 });
        expect(storedBindings(stores)).toEqual([Q]);
        expect(k.engine.registry.getObjectOwner(NAME)?.packageId).toBe(SENTINEL);
        expect(k.engine.registry.getObjectContributors(NAME).map((c) => c.ownership).sort()).toEqual(['extend', 'own']);
        const said = error.mock.calls.map(([line]) => String(line)).filter((line) => line.includes(`'${NAME}'`));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(`'${Q}'`);
    });

    it('CONTROL: an adoption of non-object items leaves the object registry untouched, and the view follows as before', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        // A package-less view row, as a pre-package-first stopgap left it.
        await k.engine.insert('sys_metadata', {
            type: 'view', name: VIEW, state: 'active', package_id: null,
            metadata: JSON.stringify({
                name: VIEW, label: 'Gadgets', type: 'grid', data: { provider: 'object', object: NAME },
            }),
        }, { context: { isSystem: true } } as any);
        const registerObject = vi.spyOn(k.engine.registry, 'registerObject');
        const unregisterObject = vi.spyOn(k.engine.registry, 'unregisterObject');

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ reassignedCount: 1, reassigned: [{ type: 'view', name: VIEW }] });
        expect(storedBindings(stores, 'view', VIEW)).toEqual([Q]);
        expect(registerObject).not.toHaveBeenCalled();
        expect(unregisterObject).not.toHaveBeenCalled();
        // The view write-through (#23198), unchanged: the registry serves the
        // view at its new binding.
        expect((k.engine.registry.getItem('view', VIEW) as { _packageId?: string } | undefined)?._packageId).toBe(Q);
    });

    it('CONTROL: a package-less row of an object another package\'s row owns is rebound in storage, and that owner stays', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        expect((await save(k, R, 'Gadget R')).success).toBe(true);
        // Legacy residue beside R's row: a package-less row no door writes today.
        await k.engine.insert('sys_metadata', {
            type: 'object', name: NAME, state: 'active', package_id: null,
            metadata: JSON.stringify(gadgetBody('Gadget residue')),
        }, { context: { isSystem: true } } as any);
        const registerObject = vi.spyOn(k.engine.registry, 'registerObject');
        const registerItem = vi.spyOn(k.engine.registry, 'registerItem');
        const unregisterObject = vi.spyOn(k.engine.registry, 'unregisterObject');

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ reassignedCount: 1, reassigned: [{ type: 'object', name: NAME }] });
        expect(storedBindings(stores).sort()).toEqual([Q, R].sort());
        // Nothing of the residue reaches the registry, in either half.
        expect(unregisterObject).not.toHaveBeenCalled();
        expect(registerObject).not.toHaveBeenCalled();
        expect(registerItem.mock.calls.filter(([type]) => type === 'object')).toEqual([]);
        expect(k.engine.registry.getObjectOwner(NAME)?.packageId).toBe(R);
        const object = k.engine.registry.getObject(NAME) as { label?: string; _packageId?: string } | undefined;
        expect({ label: object?.label, pkg: object?._packageId }).toEqual({ label: 'Gadget R', pkg: R });
    });
});
