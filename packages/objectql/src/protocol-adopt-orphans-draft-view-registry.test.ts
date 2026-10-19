// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #23690, ADR-0070 D5 / ADR-0048 — an orphan adoption never makes a DRAFT view
 * live: an adopted draft view is rebound in storage only, as the boot treats it.
 *
 * ## The defect
 *
 * `reassignOrphanedMetadata` (the method `POST /api/v1/packages/:id/adopt-orphans`
 * calls) sends each rebound view row through the registry write-through
 * (#23198). The view limb admitted a row by its type alone, so a package-less
 * draft view adopted into Q was registered as live (its draft body, stamped
 * `_packageId` Q) until the next boot, which registers active rows only
 * (`loadMetaFromDb`). `applyRegistryWriteThrough`'s own header: drafts "are a
 * staging buffer and must never leak into the runtime". Measured on
 * `origin/main` `4c21e57169` before the fix.
 *
 * ## The pins, on a real kernel (another kernel over the same store is a boot)
 *
 *  - an adopted draft view: before and after the adoption the registry serves
 *    nothing for it, the stored row is Q's draft, and a boot afterwards agrees;
 *  - an adopted draft beside an adopted active row of the same view: the
 *    active body is served at Q, never the draft's;
 *  - CONTROL: an adopted active view is served at Q at once (#23198), and a
 *    boot afterwards agrees.
 *
 * The negative control (the gate removed, the draft pins red) is a one-off
 * ablation recorded in the PR body, not a test.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { ObjectQLPlugin } from './plugin.js';

type Stores = Map<string, Map<string, Record<string, unknown>>>;

/**
 * In-memory driver, copied from `protocol-adopt-orphans-object-registry.test.ts`;
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

/** The data plane read, as the system reads it: typed, never erased (`check:query-options-erasure`). */

const Q = 'com.qa.q';
const VIEW = 'qa_probe_gadget_grid';

/** A view body; `label` tells the rows apart. */
const viewBody = (label: string) => ({
    name: VIEW, label, type: 'grid', data: { provider: 'object', object: 'qa_probe_gadget' },
});

interface Booted {
    kernel: ObjectKernel;
    engine: ObjectQL;
    protocol: any;
}

describe('#23690 — an orphan adoption rebinds a draft view in storage only', () => {
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
        // gracefulShutdown:false keeps process signal handlers out of vitest's fork workers (#4250).
        const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
        live.push(kernel);
        const engine = new ObjectQL();
        engine.registerDriver(makeMemoryDriver(stores, drops), true);
        await kernel.use(new ObjectQLPlugin({ ql: engine }));
        await kernel.bootstrap();
        return { kernel, engine, protocol: kernel.getService('protocol') };
    }

    /** A package-less view row, as a pre-package-first stopgap left it. */
    const insertOrphan = (k: Booted, state: 'active' | 'draft', label: string) =>
        k.engine.insert('sys_metadata', {
            type: 'view', name: VIEW, state, package_id: null, metadata: JSON.stringify(viewBody(label)),
        }, { context: { isSystem: true } } as any);

    /** The view's stored rows, as the driver holds them. */
    const storedRows = (stores: Stores) =>
        Array.from(stores.get('sys_metadata')?.values() ?? [])
            .filter((r) => r.type === 'view' && r.name === VIEW)
            .map((r) => ({ state: r.state, packageId: r.package_id ?? null }));

    /** What the registry serves for the view: nothing, or its label and package stamp. */
    const served = (k: Booted) => {
        const view = k.engine.registry.getItem('view', VIEW) as { label?: string; _packageId?: string } | undefined;
        return view === undefined ? undefined : { label: view.label, packageId: view._packageId };
    };

    it('an adopted DRAFT view: the registry serves nothing before, after, and at the next boot', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        await insertOrphan(k, 'draft', 'Draft gadgets');
        expect(served(k)).toBeUndefined();
        const registerItem = vi.spyOn(k.engine.registry, 'registerItem');

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        // The storage rebind and its answer are unchanged.
        expect(adopted).toMatchObject({ success: true, reassignedCount: 1, reassigned: [{ type: 'view', name: VIEW }] });
        expect(storedRows(stores)).toEqual([{ state: 'draft', packageId: Q }]);
        // Nothing of the draft reaches the registry.
        expect(registerItem.mock.calls.filter(([type]) => type === 'view')).toEqual([]);
        expect(served(k)).toBeUndefined();

        // A boot afterwards agrees.
        await k.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(served(k2)).toBeUndefined();
        expect(storedRows(stores)).toEqual([{ state: 'draft', packageId: Q }]);
        expect(drops).toEqual([]);
    });

    it('an adopted draft beside an adopted active row of the same view: the active body is served at Q, never the draft', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        await insertOrphan(k, 'active', 'Published gadgets');
        await insertOrphan(k, 'draft', 'Draft gadgets');

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ success: true, reassignedCount: 2 });
        expect(storedRows(stores)).toEqual([{ state: 'active', packageId: Q }, { state: 'draft', packageId: Q }]);
        expect(served(k)).toEqual({ label: 'Published gadgets', packageId: Q });

        await k.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(served(k2)).toEqual({ label: 'Published gadgets', packageId: Q });
    });

    it('CONTROL: an adopted ACTIVE view is served at Q at once (#23198), and a boot afterwards agrees', async () => {
        const stores: Stores = new Map();
        const drops: string[] = [];
        const k = await boot(stores, drops);
        await insertOrphan(k, 'active', 'Published gadgets');

        const adopted = await k.protocol.reassignOrphanedMetadata({ targetPackageId: Q });

        expect(adopted).toMatchObject({ success: true, reassignedCount: 1, reassigned: [{ type: 'view', name: VIEW }] });
        expect(storedRows(stores)).toEqual([{ state: 'active', packageId: Q }]);
        expect(served(k)).toEqual({ label: 'Published gadgets', packageId: Q });

        await k.kernel.shutdown();
        const k2 = await boot(stores, drops);
        expect(served(k2)).toEqual({ label: 'Published gadgets', packageId: Q });
        expect(drops).toEqual([]);
    });
});
