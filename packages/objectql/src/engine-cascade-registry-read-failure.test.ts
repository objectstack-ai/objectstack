// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#9002] The delete-cascade path's TWO registry reads must not answer a failed
 * read with an invented "no relations".
 *
 * `ObjectQL.delete()`'s by-id branch reads `registry.getAllObjects()` twice, and
 * both reads used to sit behind a swallow:
 *
 *  1. {@link ObjectQL.planCascadeAtomicity} — `catch { return 'none' }`, i.e.
 *     "nothing references this object, so there is no multi-write unit to make
 *     atomic" (#7413's atomicity silently switched off);
 *  2. `cascadeDeleteRelations()`'s first statement — `catch { return }`, i.e.
 *     the cascade does not run at all: no `restrict` refusal, no `set_null`, no
 *     `cascade`, nothing logged, and the caller told the delete succeeded.
 *
 * That is the #8895 shape one layer up, with a strictly larger blast radius:
 * #8895's swallow invented "no dependents" for ONE relation, seam 2 here
 * invents "no relations" for EVERY relation at once, before the per-relation
 * probe is ever reached. #8895 ruled the family *discriminate or propagate*;
 * discrimination needs a benign failure class and there is none here — an
 * unreadable registry is never truthfully "no relations" — so both `catch`es
 * are gone and the read's own failure reaches the caller.
 *
 * ⚠️ This pins a STRUCTURAL close, not a live defect. `SchemaRegistry`'s
 * `getAllObjects()` is a walk over in-memory `Map`s (`resolveObject` → a spread
 * fold; every failure branch returns `undefined`, the orphan-overlay one after
 * a `console.warn`) with no I/O and no `throw` on the measured path, so nothing
 * shipped can reach these seams today. The tests therefore inject the failure at
 * the registry method itself — the injection IS the statement that the seam is
 * unreachable from real data, and the pin is what keeps the fail-open shape from
 * coming back the day `getAllObjects()` grows a throwing path.
 *
 * The two seams are told apart by WHICH read fails, not by mocking one function:
 * `delete()` calls `planCascadeAtomicity` first and `cascadeDeleteRelations`
 * second, so failing read #1 exercises seam 1 and failing read #2 — a read that
 * fails once after succeeding, the flaky shape the card names — exercises
 * seam 2 with the atomicity plan already computed. Every expectation is written
 * against literals (the injected error object's identity, its literal `code` /
 * `status` / message, literal row counts), and each is paired with a positive
 * control in the same describe, so a harness that had stopped cascading at all
 * could not pass vacuously.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { ServiceObject } from '@objectstack/spec/data';
import { ObjectQL } from './engine.js';

/** The package id every fixture below is registered under. */
const OWNER_PACKAGE = 'test-9002';

/*
 * Fixtures are typed as `ServiceObject` (and registered WITH their `packageId`)
 * rather than left to inference, so this file adds nothing to
 * `@objectstack/objectql`'s TEST_DEBT ledger — a shrink-only ratchet (#5278).
 */
const acct: ServiceObject = {
    name: 'acct',
    label: 'Account',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        name: { name: 'name', label: 'Name', type: 'text' as const },
    },
};
// required lookup → the defaulted set_null escalates to `restrict`, so this
// relation is the one whose refusal the swallow used to disable.
const oppRestrict: ServiceObject = {
    name: 'opp',
    label: 'Opportunity',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        name: { name: 'name', label: 'Name', type: 'text' as const },
        account: {
            name: 'account',
            label: 'Account',
            type: 'lookup' as const,
            reference: 'acct',
            required: true,
        },
    },
};
// explicit cascade → the seam also decides whether children are REMOVED.
const taskCascade: ServiceObject = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', label: 'ID', type: 'text' as const },
        title: { name: 'title', label: 'Title', type: 'text' as const },
        account: {
            name: 'account',
            label: 'Account',
            type: 'lookup' as const,
            reference: 'acct',
            required: true,
            deleteBehavior: 'cascade' as const,
        },
    },
};

/** A minimal in-memory driver — no read-failure injection here, deliberately:
 *  the failure this file is about happens in the REGISTRY, before any driver
 *  read, so a driver that always succeeds is what makes that visible. */
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
            return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
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
 * Make the engine's registry throw `error` on its Nth `getAllObjects()` call
 * counted FROM THIS CALL — every earlier read (setup, warm-up) has already
 * happened, so `nth: 1` is the delete's first read and `nth: 2` its second.
 *
 * Returns the live call counter so each test can assert HOW MANY reads the
 * delete actually got to make: that count is what separates "seam 1 stopped it"
 * from "seam 2 stopped it", and it is read from the wrapper, never re-derived
 * from the code under test.
 */
function failRegistryReadOn(
    engine: ObjectQL,
    nth: number,
    error: unknown,
): { calls: () => number } {
    const registry = engine.registry as unknown as {
        getAllObjects: (packageId?: string) => ServiceObject[];
    };
    const real = registry.getAllObjects.bind(registry);
    let n = 0;
    registry.getAllObjects = (packageId?: string): ServiceObject[] => {
        n += 1;
        if (n === nth) throw error;
        return real(packageId);
    };
    return { calls: () => n };
}

describe('[#9002] the delete-cascade path\'s registry reads must not invent "no relations"', () => {
    let engine: ObjectQL;
    let stores: Map<string, Map<string, Record<string, unknown>>>;

    beforeEach(async () => {
        engine = new ObjectQL();
        const stub = makeStubDriver();
        stores = stub.stores;
        engine.registerDriver(stub.driver, true);
        await engine.init();
        for (const o of [acct, oppRestrict, taskCascade]) {
            engine.registry.registerObject(o, OWNER_PACKAGE);
        }
    });

    // ── POSITIVE CONTROLS — the registry read SUCCEEDS, so both of the
    //    cascade's real answers are observable in this harness. Without these,
    //    every refusal assertion below could pass on a harness that no longer
    //    cascades at all.

    it('control: a readable registry still refuses a restricted delete (DELETE_RESTRICTED, 409)', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err.code).toBe('DELETE_RESTRICTED');
        expect(err.status).toBe(409);
        expect(err.dependentObject).toBe('opp');
        expect(err.dependentCount).toBe(1);
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'opp')).toBe(1);
    });

    it('control: a readable registry still cascades the children away', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('task', { title: 'Follow up', account: a.id });

        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(rows(stores, 'acct')).toBe(0);
        expect(rows(stores, 'task')).toBe(0);
    });

    it('control: a readable registry still lets a dependent-free delete through', async () => {
        const a = await engine.insert('acct', { name: 'Empty' });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(rows(stores, 'acct')).toBe(0);
    });

    // ── SEAM 1 — `planCascadeAtomicity`, the FIRST of the delete's two reads.
    //    It used to answer `'none'`: no transaction opened, and the pre-#7413
    //    non-atomic path taken over a schema nobody could read.

    it('seam 1 (planCascadeAtomicity): a failed registry read surfaces and refuses the delete', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        const injected = Object.assign(new Error('registry unreadable: contributor fold failed'), {
            code: 'REGISTRY_READ_FAILED',
            status: 500,
        });
        const probe = failRegistryReadOn(engine, 1, injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);

        // The caller receives the REGISTRY read's own failure — this fix mints
        // no new code and no new response field, so the envelope it arrived
        // with is the envelope it leaves with.
        expect(err).toBe(injected);
        expect(err.message).toBe('registry unreadable: contributor fold failed');
        expect(err.code).toBe('REGISTRY_READ_FAILED');
        expect(err.status).toBe(500);
        // Seam 1 runs BEFORE the cascade, so the delete stops at the first read.
        expect(probe.calls()).toBe(1);
        // …and emphatically NOT the pre-fix outcome: a silent, non-atomic
        // success that removed the parent and orphaned the child.
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'opp')).toBe(1);
    });

    it('seam 1: a failed read refuses even a delete with NO dependents — "unreadable" is not "none"', async () => {
        // The pre-fix `'none'` verdict was indistinguishable from this object's
        // genuine one, which is the whole complaint: `'none'` asserts something
        // positive about the schema that an unreadable registry cannot support.
        const a = await engine.insert('acct', { name: 'Lonely' });

        const injected = Object.assign(new Error('registry unreadable'), { code: 'REGISTRY_READ_FAILED' });
        failRegistryReadOn(engine, 1, injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toBe(injected);
        expect(rows(stores, 'acct')).toBe(1);
    });

    // ── SEAM 2 — `cascadeDeleteRelations`, the SECOND read. Reached only when
    //    the first read SUCCEEDED, i.e. a read that fails once after succeeding
    //    — the flaky shape the card names. Pre-fix this returned silently and
    //    the parent's own `driver.delete` then ran, unguarded.

    it('seam 2 (cascadeDeleteRelations): a read that fails on the SECOND call surfaces and deletes nothing', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        const injected = Object.assign(new Error('registry unreadable mid-delete'), {
            code: 'REGISTRY_READ_FAILED',
            status: 500,
        });
        const probe = failRegistryReadOn(engine, 2, injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);

        expect(err).toBe(injected);
        expect(err.message).toBe('registry unreadable mid-delete');
        expect(err.code).toBe('REGISTRY_READ_FAILED');
        expect(err.status).toBe(500);
        // Proof this is seam 2 and not seam 1: the first read SUCCEEDED (the
        // atomicity plan was computed) and the delete died on the second.
        expect(probe.calls()).toBe(2);
        // Pre-fix: the `restrict` relation was never consulted, the parent row
        // was deleted, and the caller was told it succeeded.
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'opp')).toBe(1);
    });

    it('seam 2: a CASCADE relation is not skipped either — no parent removed over unread children', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('task', { title: 'Follow up', account: a.id });

        const injected = Object.assign(new Error('registry unreadable mid-delete'), {
            code: 'REGISTRY_READ_FAILED',
        });
        const probe = failRegistryReadOn(engine, 2, injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toBe(injected);
        expect(probe.calls()).toBe(2);
        // Pre-fix this removed the parent and left the child pointing at a row
        // that no longer exists.
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'task')).toBe(1);
    });
});
