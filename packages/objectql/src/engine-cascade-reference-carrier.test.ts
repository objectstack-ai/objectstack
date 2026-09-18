// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#18550] The delete-cascade path's TWO `FieldSchema.reference` carrier reads
 * must refuse a carrier they cannot read, rather than reading it as "this
 * child does not reference the object being deleted".
 *
 * Ruling letter E item 2 on #18095 asked for the loud refusal at EVERY reader.
 * PR #18503 delivered it at the arbiter (`referenceCarrierOf`) and the lint
 * read sites; these two were the measured residue. Both used to read
 * `fdef.reference` raw behind `if (!ref) continue`, which is correct for an
 * ABSENT carrier and silent for an UNREADABLE one: an object- or array-valued
 * `reference` is TRUTHY, so it passed that guard and then failed both name
 * comparisons below it, and the relation dropped out of the cascade.
 *
 * ## The measured consequence, which is why this file exists
 *
 * With a `master_detail` child whose carrier is `{ object: 'acct' }`:
 *
 *     before-delete  acct=1 task=1
 *     delete         RESOLVED true        <- success reported to the caller
 *     after-delete   acct=0 task=1        <- an ORPHANED detail row
 *
 * No `restrict` refusal, no `set_null`, no `cascade`, nothing logged. The same
 * probe against the routed reads refuses with the arbiter's `TypeError` and
 * touches NO row, because `delete()` calls `planCascadeAtomicity` before it
 * runs the cascade.
 *
 * ## Absence and unreadability are DIFFERENT answers, and both are pinned
 *
 * `FieldSchema.reference` is `z.string().optional()` and `StrictField` declares
 * it nullable, so `undefined` / `null` / `''` say "this field names no target"
 * — a legal thing for a field to say, and they must never throw. Only a
 * carrier in a shape no reader can read refuses. Every refusal case here has
 * an absence partner and a positive control, so a harness that had stopped
 * cascading at all could not pass vacuously.
 *
 * ## Why the carrier is injected at the registry rather than authored
 *
 * The engine's own WRITE path already refuses this shape — `insert()` runs
 * `assertReferencesResolve`, which asks `referenceTargetOf` and therefore the
 * same arbiter — so a row in this shape cannot be created through the engine.
 * It gets there the way the arbiter's docblock names: a value that never went
 * through parse (a raw `registerObject`, a stored/artifact row). The child row
 * is written straight through the driver for the same reason, and the two
 * seams are told apart by WHICH registry read sees the unreadable carrier:
 * `delete()` reads first for `planCascadeAtomicity` and second for
 * `cascadeDeleteRelations`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

const OWNER_PACKAGE = 'test-18550';

/** The carrier shape `FieldSchema` declares a string and no reader can read. */
const UNREADABLE_CARRIER = { object: 'acct' } as unknown as string;

const acct: ServiceObject = {
    name: 'acct',
    label: 'Account',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        name: { name: 'name', label: 'Name', type: 'text' as const },
    },
};

/** A readable `master_detail` child — the shape every control below registers. */
const taskReadable: ServiceObject = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        account: {
            name: 'account',
            label: 'Account',
            type: 'master_detail' as const,
            reference: 'acct',
            required: true,
        },
    },
};

/** The same child with `reference` ABSENT — the other legal answer. */
const taskAbsentCarrier = {
    ...taskReadable,
    fields: {
        ...taskReadable.fields,
        account: { name: 'account', label: 'Account', type: 'master_detail' as const, reference: null },
    },
} as unknown as ServiceObject;

/** The same child with an UNREADABLE carrier. */
const taskUnreadable: ServiceObject = {
    ...taskReadable,
    fields: {
        ...taskReadable.fields,
        account: {
            name: 'account',
            label: 'Account',
            type: 'master_detail' as const,
            reference: UNREADABLE_CARRIER,
            required: true,
        },
    },
};

/** A minimal in-memory driver: the failure under test is in the READ of the
 *  field def, before any driver call, so a driver that always succeeds is what
 *  makes the orphaned row visible. */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (exp ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) {
            const matched = Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
            // The caller's bound, applied AFTER the filter and by PRESENCE
            // (`check:objectql-double-limit`): a double that silently ignores a
            // `limit` it was handed cannot witness a paged read at all.
            return typeof ast?.limit === 'number' ? matched.slice(0, ast.limit) : matched;
        },
        async findOne(o: string, ast: any) {
            for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
            return null;
        },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(o).set(id, row);
            return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id);
            if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async upsert(o: string, data: Record<string, unknown>) {
            const id = data.id as string | undefined;
            return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data);
        },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) {
            return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
        },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores };
}

/** Row count read straight out of the stub's store — never through the engine. */
const rows = (stores: Map<string, Map<string, Record<string, unknown>>>, object: string) =>
    stores.get(object)?.size ?? 0;

/**
 * Serve `swapped` from the engine's registry on its Nth `getAllObjects()` call,
 * counted from this call, and the real (readable) objects on every other.
 *
 * `delete()` reads the registry twice — once for `planCascadeAtomicity`, then
 * once for `cascadeDeleteRelations` — so `nth: 1` isolates the first seam and
 * `nth: 2` the second with the atomicity plan already computed. Returns the
 * live counter, so each test asserts how many reads the delete actually got to
 * make rather than re-deriving it from the code under test.
 */
function swapObjectsOnNthRead(
    engine: ObjectQL,
    nth: number,
    swapped: ServiceObject[],
): { reads: () => number } {
    const registry = engine.registry as unknown as {
        getAllObjects: (packageId?: string) => ServiceObject[];
    };
    const real = registry.getAllObjects.bind(registry);
    let n = 0;
    registry.getAllObjects = (packageId?: string): ServiceObject[] => {
        n += 1;
        return n === nth ? swapped : real(packageId);
    };
    return { reads: () => n };
}

describe('[#18550] the delete cascade refuses an unreadable `reference` carrier', () => {
    let engine: ObjectQL;
    let stores: Map<string, Map<string, Record<string, unknown>>>;
    let driver: any;

    beforeEach(async () => {
        engine = new ObjectQL();
        const stub = makeStubDriver();
        stores = stub.stores;
        driver = stub.driver;
        engine.registerDriver(stub.driver, true);
        await engine.init();
        engine.registry.registerObject(acct, OWNER_PACKAGE);
        engine.registry.registerObject(taskReadable, OWNER_PACKAGE);
    });

    /** A parent with one detail row, the row written through the DRIVER. */
    async function parentWithDetail(): Promise<string> {
        const a = await engine.insert('acct', { name: 'Acme' });
        await driver.create('task', { id: 'task_1', title: 'Follow up', account: a.id });
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'task')).toBe(1);
        return a.id as string;
    }

    // ── POSITIVE CONTROLS ───────────────────────────────────────────────────
    // Without these, every refusal below could pass on a harness that no
    // longer cascades at all.

    it('control: a READABLE carrier still cascades the detail row away', async () => {
        const id = await parentWithDetail();
        await engine.delete('acct', { where: { id } } as any);
        expect(rows(stores, 'acct')).toBe(0);
        expect(rows(stores, 'task')).toBe(0);
    });

    it('control: an ABSENT carrier (`reference: null`) does NOT throw — absence is legal', async () => {
        // `StrictField` declares `reference` nullable and `FieldSchema` has it
        // `.optional()`, so this says "this field names no target". The cascade
        // must skip the relation exactly as it did before the routing: the
        // parent goes, the row that references nothing stays, and NOTHING is
        // thrown. ⛔ This is the case a mechanical "throw on everything falsy"
        // sweep would break.
        const id = await parentWithDetail();
        engine.registry.registerObject(taskAbsentCarrier, OWNER_PACKAGE);

        await expect(engine.delete('acct', { where: { id } } as any)).resolves.toBeTruthy();
        expect(rows(stores, 'acct')).toBe(0);
        expect(rows(stores, 'task')).toBe(1);
    });

    // ── SEAM 1 — `planCascadeAtomicity`, the FIRST of the delete's two reads.

    it('seam 1 (planCascadeAtomicity): an unreadable carrier refuses the delete BEFORE any row is touched', async () => {
        const id = await parentWithDetail();
        const probe = swapObjectsOnNthRead(engine, 1, [acct, taskUnreadable]);

        const err: any = await engine.delete('acct', { where: { id } } as any).catch((e) => e);

        // ⛔ Not a bare "it threw": an unrepaired reader throwing some other
        // Error on some other input would satisfy that. The class, the reader
        // that could not read it, and the sentence the author reads are all
        // asserted.
        expect(err).toBeInstanceOf(TypeError);
        expect(err.message).toContain('ObjectQL.planCascadeAtomicity');
        expect(err.message).toMatch(/`reference` is an object/);
        expect(err.message).toMatch(/FieldSchema declares it as an optional STRING/);
        // The refusal is the FIRST thing the delete does, so the parent is
        // still there — this is the half that makes it a refusal rather than a
        // partially-applied delete.
        expect(probe.reads()).toBe(1);
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'task')).toBe(1);
    });

    // ── SEAM 2 — `cascadeDeleteRelations`, the SECOND read, reached with the
    //    atomicity plan already computed from a readable registry.

    it('seam 2 (cascadeDeleteRelations): an unreadable carrier refuses instead of leaving an orphan', async () => {
        const id = await parentWithDetail();
        const probe = swapObjectsOnNthRead(engine, 2, [acct, taskUnreadable]);

        const err: any = await engine.delete('acct', { where: { id } } as any).catch((e) => e);

        expect(err).toBeInstanceOf(TypeError);
        expect(err.message).toContain('ObjectQL.cascadeDeleteRelations');
        expect(err.message).toMatch(/`reference` is an object/);
        // Read #2 is where it stopped, which is what separates this seam from
        // seam 1 above.
        expect(probe.reads()).toBe(2);
        // The measured defect, inverted: the detail row is NOT orphaned behind
        // a successful delete.
        expect(rows(stores, 'task')).toBe(1);
    });

    it('seam 2: an ARRAY carrier refuses too, and the message names the shape it found', async () => {
        const id = await parentWithDetail();
        const arrayCarrier: ServiceObject = {
            ...taskReadable,
            fields: {
                ...taskReadable.fields,
                account: {
                    name: 'account', label: 'Account', type: 'master_detail' as const,
                    reference: ['acct', 'other'] as unknown as string, required: true,
                },
            },
        };
        swapObjectsOnNthRead(engine, 2, [acct, arrayCarrier]);

        const err: any = await engine.delete('acct', { where: { id } } as any).catch((e) => e);
        expect(err).toBeInstanceOf(TypeError);
        expect(err.message).toMatch(/`reference` is an array \(length 2\)/);
    });

    it("control: an EMPTY-STRING carrier is absence, not a wrong shape — it does not throw", async () => {
        // `''` names no object, so the arbiter answers `undefined` for it and
        // this seam skips the relation. The third spelling of absence, pinned
        // because it is the one a mechanical falsy-sweep gets wrong last.
        const id = await parentWithDetail();
        const emptyCarrier: ServiceObject = {
            ...taskReadable,
            fields: {
                ...taskReadable.fields,
                account: { name: 'account', label: 'Account', type: 'master_detail' as const, reference: '' },
            },
        };
        swapObjectsOnNthRead(engine, 2, [acct, emptyCarrier]);

        await expect(engine.delete('acct', { where: { id } } as any)).resolves.toBeTruthy();
        expect(rows(stores, 'acct')).toBe(0);
    });
});
