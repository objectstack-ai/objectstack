// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9154] The roll-up summary index's registry read must not answer a failed
 * read with an invented "no object declares a roll-up" — and, the limb that
 * makes this one worse than its two #9002 siblings, must not CACHE that
 * invention under the registry's current `objectRevision`.
 *
 * `ObjectQL.buildSummaryIndex()`'s first statement used to be
 *
 * ```ts
 * try { objects = (this._registry as any).getAllObjects?.() ?? []; } catch { objects = []; }
 * ```
 *
 * and `ensureSummaryIndexes()` memoizes what it returns, stamped with the
 * registry's `objectRevision`. So a single failed read did not degrade one
 * write: it installed an EMPTY roll-up index and recorded it as measured, and
 * `recomputeSummaries()` — which every insert / update / delete consults to
 * decide which parent roll-ups to recompute — then found nothing to do, on
 * every subsequent write, silently, with each write reporting success.
 *
 * `objectRevision` moves only on a metadata MUTATION (`registerObject`,
 * `unregisterObject`, `unregisterObjectsByPackage`, `removeObjectOverlay`,
 * `invalidate`, `invalidateAll`, `reset`) and never on a data write, so the
 * invented emptiness outlived the condition that caused it — until a restart or
 * an unrelated publish. That lifetime is measured here rather than asserted:
 * every recovery test below re-reads `registry.objectRevision` and pins it
 * UNCHANGED across the failure, so the recovery it proves cannot be the
 * accidental one an unrelated registry change would have produced.
 *
 * ⚠️ Like #9002's pin this closes a STRUCTURAL hole, not a live defect.
 * `SchemaRegistry.getAllObjects()` is a walk over in-memory `Map`s calling
 * `resolveObject()`, which returns `undefined` on every failure branch it models
 * and never throws; the fold below it is spreads and comparisons. No I/O, no
 * driver, no `throw` on the measured path — re-derived on this tree. The failure
 * is therefore injected at the registry method itself, and the injection IS the
 * statement that nothing shipped reaches the seam today.
 *
 * Two handles are used deliberately, because they answer different questions:
 * `getOwnedSummaryDescriptors()` is the engine's own PUBLIC read of the index
 * (#6063) and reaches `buildSummaryIndex()` through exactly one registry read,
 * so it isolates THIS seam from every other `getAllObjects()` consumer on the
 * write path; the `insert()` tests then show the same failure end-to-end, where
 * the consequence — a parent roll-up that silently stops recomputing — actually
 * lands. Every roll-up expectation is read out of the driver's own store, never
 * back out of the engine.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

/** The package id every fixture below is registered under. */
const OWNER_PACKAGE = 'test-9154';

/*
 * Fixtures are typed as `ServiceObject` (and registered WITH their `packageId`)
 * rather than left to inference, so this file adds nothing to
 * `@objectstack/objectql`'s TEST_DEBT ledger — a shrink-only ratchet (#5278).
 */
const inv: ServiceObject = {
    name: 'inv',
    label: 'Invoice',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        name: { name: 'name', label: 'Name', type: 'text' as const },
        line_total: {
            name: 'line_total',
            label: 'Line total',
            type: 'summary' as const,
            summaryOperations: { object: 'inv_line', field: 'amount', function: 'sum' as const },
        },
        line_count: {
            name: 'line_count',
            label: 'Line count',
            type: 'summary' as const,
            summaryOperations: { object: 'inv_line', field: 'amount', function: 'count' as const },
        },
    },
};
const invLine: ServiceObject = {
    name: 'inv_line',
    label: 'Invoice line',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        amount: { name: 'amount', label: 'Amount', type: 'number' as const },
        inv: { name: 'inv', label: 'Invoice', type: 'master_detail' as const, reference: 'inv' },
    },
};

/** A minimal in-memory driver — no read-failure injection here, deliberately:
 *  the failure this file is about happens in the REGISTRY, so a driver that
 *  always succeeds is what makes the roll-up's silence visible. */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string): Map<string, Record<string, unknown>> => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    let nextId = 0;
    const checkOp = (value: unknown, cond: unknown): boolean => {
        if (cond === null || typeof cond !== 'object' || Array.isArray(cond) || cond instanceof Date) {
            return value === cond;
        }
        return Object.entries(cond as Record<string, unknown>).every(([op, target]) => {
            switch (op) {
                case '$eq': return value === target;
                case '$ne': return value !== target;
                case '$in': return Array.isArray(target) && target.includes(value);
                default: return true;
            }
        });
    };
    const matches = (row: Record<string, unknown>, where: unknown): boolean => {
        if (!where || typeof where !== 'object') return true;
        return Object.entries(where as Record<string, unknown>).every(([k, v]) => {
            if (k === '$and') return (v as unknown[]).every((w) => matches(row, w));
            if (k === '$or') return (v as unknown[]).some((w) => matches(row, w));
            if (k === '$not') return !matches(row, v);
            return checkOp(row?.[k], v);
        });
    };
    const driver: Record<string, unknown> = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect(): Promise<void> {}, async disconnect(): Promise<void> {},
        async checkHealth(): Promise<boolean> { return true; },
        async execute(): Promise<null> { return null; },
        async find(o: string, ast: { where?: unknown }): Promise<Record<string, unknown>[]> {
            return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
        },
        async findOne(o: string, ast: { where?: unknown }): Promise<Record<string, unknown> | null> {
            for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r;
            return null;
        },
        async create(o: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(o).set(id, row);
            return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>): Promise<Record<string, unknown>> {
            const s = storeFor(o);
            const row = { ...s.get(id), ...data, id };
            s.set(id, row);
            return row;
        },
        async delete(o: string, id: string): Promise<boolean> { return storeFor(o).delete(id); },
        async count(o: string, ast: { where?: unknown }): Promise<number> {
            return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
        },
        async bulkCreate(o: string, rows: Record<string, unknown>[]): Promise<Record<string, unknown>[]> {
            const out: Record<string, unknown>[] = [];
            for (const r of rows) out.push(await (driver.create as (a: string, b: Record<string, unknown>) => Promise<Record<string, unknown>>)(o, r));
            return out;
        },
        async bulkUpdate(): Promise<Record<string, unknown>[]> { return []; },
        async bulkDelete(): Promise<void> {},
        async beginTransaction(): Promise<Record<string, unknown>> {
            return { commit: async (): Promise<void> => {}, rollback: async (): Promise<void> => {} };
        },
        async commit(): Promise<void> {}, async rollback(): Promise<void> {},
    };
    return { driver, stores };
}

/**
 * Make the engine's registry throw `error` from `getAllObjects()` while it is
 * ARMED, and report how many reads it has served.
 *
 * A toggle rather than #9002's nth-call counter, because the point of this card
 * is what happens AFTER the failing read is over: the registry is healed with
 * `heal()` and nothing else about the engine or the registry is touched — in
 * particular `objectRevision` does not move — so a subsequent correct roll-up
 * can only come from a rebuild that was NOT short-circuited by a cached answer.
 */
function injectRegistryReadFailure(
    engine: ObjectQL,
    error: unknown,
): { arm: () => void; heal: () => void; calls: () => number } {
    const registry = engine.registry as unknown as {
        getAllObjects: (packageId?: string) => ServiceObject[];
    };
    const real = registry.getAllObjects.bind(registry);
    let armed = false;
    let calls = 0;
    registry.getAllObjects = (packageId?: string): ServiceObject[] => {
        calls += 1;
        if (armed) throw error;
        return real(packageId);
    };
    return { arm: () => { armed = true; }, heal: () => { armed = false; }, calls: () => calls };
}

describe('[#9154] the roll-up summary index must not invent — or cache — "no roll-ups"', () => {
    let engine: ObjectQL;
    let stores: Map<string, Map<string, Record<string, unknown>>>;

    beforeEach(async () => {
        engine = new ObjectQL();
        const stub = makeStubDriver();
        stores = stub.stores;
        engine.registerDriver(stub.driver as never, true);
        await engine.init();
        for (const o of [inv, invLine]) {
            engine.registry.registerObject(o, OWNER_PACKAGE);
        }
    });

    /** The parent row as the DRIVER holds it — never read back through the engine. */
    const parent = (id: string): Record<string, unknown> =>
        stores.get('inv')?.get(id) ?? {};

    const injected = (): Error & { code: string; status: number } =>
        Object.assign(new Error('registry unreadable: contributor fold failed'), {
            code: 'REGISTRY_READ_FAILED',
            status: 500,
        });

    // ── POSITIVE CONTROLS — a readable registry really does maintain the
    //    roll-ups in this harness. Without these, every "the roll-up is correct"
    //    assertion below could pass on a harness that never rolled anything up.

    it('control: a readable registry recomputes the parent roll-up on each child insert', async () => {
        const p = await engine.insert('inv', { name: 'INV-1' });
        await engine.insert('inv_line', { inv: p.id, amount: 10 });
        await engine.insert('inv_line', { inv: p.id, amount: 32 });

        expect(parent(p.id as string).line_total).toBe(42);
        expect(parent(p.id as string).line_count).toBe(2);
    });

    it('control: a readable registry reports the parent-side descriptors it owns', () => {
        const owned = engine.getOwnedSummaryDescriptors('inv');
        expect(owned.map((d) => d.summaryField).sort()).toEqual(['line_count', 'line_total']);
        expect(owned.every((d) => d.childObject === 'inv_line' && d.fkField === 'inv')).toBe(true);
    });

    // ── THE SEAM — `buildSummaryIndex()`'s registry read, isolated.

    it('the failed registry read surfaces instead of becoming an empty index', () => {
        const err = injected();
        const probe = injectRegistryReadFailure(engine, err);
        probe.arm();

        let thrown: unknown;
        try { engine.getOwnedSummaryDescriptors('inv'); } catch (e) { thrown = e; }

        // No new code and no new response field is minted here: the envelope the
        // read failed with is the envelope the caller receives.
        expect(thrown).toBe(err);
        expect((thrown as { code: string }).code).toBe('REGISTRY_READ_FAILED');
        expect((thrown as { status: number }).status).toBe(500);
        expect((thrown as Error).message).toBe('registry unreadable: contributor fold failed');
        expect(probe.calls()).toBe(1);
    });

    it('a registry that does not implement getAllObjects fails loudly, not emptily', () => {
        // The `?.()` half of the swallow. A double that simply OMITS the method
        // never throws, so pre-fix it produced a permanently empty roll-up index
        // with nothing to notice — the exact structural omission a shipped test
        // double really did carry (#9002 found one when it removed its swallows).
        (engine.registry as unknown as { getAllObjects?: unknown }).getAllObjects = undefined;

        expect(() => engine.getOwnedSummaryDescriptors('inv')).toThrow(TypeError);
        expect(() => engine.getOwnedSummaryDescriptors('inv')).toThrow(/not a function/);
    });

    // ── ⭐ THE CACHE LIMB — what makes this card worse than #9002's two seams.

    it('the failed read leaves NO cached index: the very next read rebuilds, with objectRevision unmoved', () => {
        const revisionBefore = (engine.registry as unknown as { objectRevision: number }).objectRevision;

        const probe = injectRegistryReadFailure(engine, injected());
        probe.arm();
        expect(() => engine.getOwnedSummaryDescriptors('inv')).toThrow();
        probe.heal();

        // Nothing about the registry's CONTENT changed — the poisoning read and
        // the healed read see the same revision. Pre-fix the first call stamped
        // an empty index with exactly this number and the second call returned
        // it, so this equality is what makes the recovery below non-accidental.
        const revisionAfter = (engine.registry as unknown as { objectRevision: number }).objectRevision;
        expect(revisionAfter).toBe(revisionBefore);

        const owned = engine.getOwnedSummaryDescriptors('inv');
        expect(owned.map((d) => d.summaryField).sort()).toEqual(['line_count', 'line_total']);
    });

    /*
     * ⚠️ Measured while writing these: the index is built LAZILY and the failing
     * read must land on a real BUILD, not on a cache hit. `beforeEach` registers
     * the fixtures and stops; nothing has built the index yet, so the poisoning
     * read below is the FIRST one — which is precisely the shape a booting
     * deployment has, and the one the card describes. Arming the failure after a
     * successful write instead would prove nothing: the write already cached a
     * good index and no further registry read happens at all (measured: an
     * `insert` over a warm index makes ZERO `getAllObjects()` calls).
     */

    it('a write after the failed read still recomputes the roll-up — the poisoned entry does not outlive its cause', async () => {
        const revisionBefore = (engine.registry as unknown as { objectRevision: number }).objectRevision;

        const probe = injectRegistryReadFailure(engine, injected());
        probe.arm();
        expect(() => engine.getOwnedSummaryDescriptors('inv')).toThrow();
        probe.heal();

        const p = await engine.insert('inv', { name: 'INV-1' });
        await engine.insert('inv_line', { inv: p.id, amount: 7 });

        // Pre-fix: the failed read installed an empty index stamped at
        // `revisionBefore`; the parent insert seeded nothing, this child insert
        // found no descriptors for `inv_line`, and the parent's roll-up was
        // never written — while both writes reported success. Every later write
        // did the same, for the life of the process.
        expect((engine.registry as unknown as { objectRevision: number }).objectRevision).toBe(revisionBefore);
        expect(parent(p.id as string).line_total).toBe(7);
        expect(parent(p.id as string).line_count).toBe(1);
    });

    it('the roll-up keeps recomputing on EVERY later write, not just the first one after the failure', async () => {
        const revisionBefore = (engine.registry as unknown as { objectRevision: number }).objectRevision;

        const probe = injectRegistryReadFailure(engine, injected());
        probe.arm();
        expect(() => engine.getOwnedSummaryDescriptors('inv')).toThrow();
        probe.heal();

        const p = await engine.insert('inv', { name: 'INV-1' });
        // The insert-time seed (#5749) is the parent-side view of the same
        // index, so it is poisoned by the same read.
        expect(parent(p.id as string).line_count).toBe(0);

        await engine.insert('inv_line', { inv: p.id, amount: 10 });
        await engine.insert('inv_line', { inv: p.id, amount: 32 });
        await engine.insert('inv_line', { inv: p.id, amount: 5 });

        expect((engine.registry as unknown as { objectRevision: number }).objectRevision).toBe(revisionBefore);
        expect(parent(p.id as string).line_total).toBe(47);
        expect(parent(p.id as string).line_count).toBe(3);
    });

    // ── END-TO-END — the write path itself, while the registry is unreadable.

    it('a write during the failed read does not report success over a skipped roll-up', async () => {
        const err = injected();
        const probe = injectRegistryReadFailure(engine, err);
        probe.arm();

        // The write path reaches the index through the insert-time seed, so the
        // read's failure reaches the CALLER. Pre-fix this insert RESOLVED, with
        // its roll-up fields silently unseeded and the poisoned index left
        // behind for every write after it.
        const caught: unknown = await engine.insert('inv', { name: 'INV-1' }).catch((e: unknown) => e);
        expect(caught).toBe(err);
        expect((caught as { code: string }).code).toBe('REGISTRY_READ_FAILED');
        expect((caught as { status: number }).status).toBe(500);

        // …and once the registry is readable again the next writes are correct,
        // with no registry mutation in between.
        probe.heal();
        const p = await engine.insert('inv', { name: 'INV-2' });
        await engine.insert('inv_line', { inv: p.id, amount: 10 });
        await engine.insert('inv_line', { inv: p.id, amount: 32 });

        const lines = Array.from(stores.get('inv_line')?.values() ?? [])
            .filter((r) => r.inv === p.id);
        const expected = lines.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
        expect(expected).toBe(42);
        expect(parent(p.id as string).line_total).toBe(expected);
        expect(parent(p.id as string).line_count).toBe(lines.length);
    });
});
