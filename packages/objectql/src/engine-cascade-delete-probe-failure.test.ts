// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8895] `cascadeDeleteRelations` must not fail OPEN when its dependents probe
 * fails.
 *
 * The probe (`find(child, { where: { fk: id } })`) IS the referential-integrity
 * guard: its result decides whether a `restrict` relation refuses the delete and
 * whether `set_null`/`cascade` run at all. It used to sit behind a bare
 * `catch { continue; }`, so ANY probe failure — a connection drop, a timeout, a
 * permission denial, a query error — was indistinguishable from "this child has
 * no rows": the `restrict` refusal never fired, the delete reported success, and
 * nothing was logged. A guard that could not be EVALUATED silently passed.
 *
 * The repair is discrimination, not deletion of the `catch`: only an
 * unprovisioned child TABLE is truthful emptiness (it cannot hold a referencing
 * row), and everything else propagates.
 *
 * Every expectation below is written against LITERALS — the exact injected error
 * object, its literal message, the literal `DELETE_RESTRICTED` / 409 envelope,
 * literal row counts — never against a value re-derived from the code under
 * test. And each refusal assertion is paired with a positive control in this
 * same describe (the probe SUCCEEDING and refusing, the probe SUCCEEDING and
 * allowing, and — for the benign branch — proof that the injected throw actually
 * fired), so a harness that had stopped exercising the seam at all could not
 * pass vacuously.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const acct = {
    name: 'acct',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};
// required lookup → the defaulted set_null escalates to `restrict`
const oppRestrict = {
    name: 'opp',
    label: 'Opportunity',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
        account: { name: 'account', type: 'lookup' as const, reference: 'acct', required: true },
    },
};
// explicit cascade → the probe decides whether children are REMOVED
const taskCascade = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        account: {
            name: 'account',
            type: 'lookup' as const,
            reference: 'acct',
            required: true,
            deleteBehavior: 'cascade',
        },
    },
};

/**
 * Stub driver + a per-object read-failure injector.
 *
 * `failReads.set('opp', err)` makes every `find`/`count` on `opp` throw exactly
 * `err` — the object identity is what the assertions below check, so nothing has
 * to guess at how the engine re-wraps a driver error. `readCalls` records which
 * objects were actually read, which is what turns "the delete succeeded" into
 * "the delete succeeded AND the probe really threw".
 */
function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const failReads = new Map<string, unknown>();
    const readCalls: string[] = [];
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
    const gate = (o: string) => {
        readCalls.push(o);
        if (failReads.has(o)) throw failReads.get(o);
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) {
            gate(o);
            return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where));
        },
        async findOne(o: string, ast: any) {
            gate(o);
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
            gate(o);
            return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)).length;
        },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, stores, failReads, readCalls };
}

/** Row count read straight out of the stub's store — never through the engine. */
const rows = (stores: Map<string, Map<string, Record<string, unknown>>>, object: string) =>
    stores.get(object)?.size ?? 0;

describe('[#8895] cascadeDeleteRelations — a failed dependents probe must not skip the guard', () => {
    let engine: ObjectQL;
    let stores: Map<string, Map<string, Record<string, unknown>>>;
    let failReads: Map<string, unknown>;
    let readCalls: string[];

    beforeEach(async () => {
        engine = new ObjectQL();
        const stub = makeStubDriver();
        stores = stub.stores;
        failReads = stub.failReads;
        readCalls = stub.readCalls;
        engine.registerDriver(stub.driver, true);
        await engine.init();
        for (const o of [acct, oppRestrict, taskCascade]) engine.registry.registerObject(o);
    });

    // ── POSITIVE CONTROLS — the probe RUNS, so the guard's two real answers
    //    are both observable in this harness. Without these, every refusal
    //    assertion below could pass on a harness that no longer cascades at all.

    it('control: a probe that RUNS and finds a dependent refuses the delete (DELETE_RESTRICTED, 409)', async () => {
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

    it('control: a probe that RUNS and finds nothing lets the delete through', async () => {
        const a = await engine.insert('acct', { name: 'Empty' });
        await engine.delete('acct', { where: { id: a.id } } as any);
        expect(rows(stores, 'acct')).toBe(0);
    });

    // ── THE FIX — a probe that could not run must surface, not invent "none".

    it('a probe that fails with a CONNECTION error surfaces that error and deletes nothing', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        const injected = Object.assign(new Error('connection terminated unexpectedly'), {
            code: 'ECONNRESET',
        });
        failReads.set('opp', injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        // The caller receives the PROBE's own failure, envelope intact — this
        // fix mints no new code and no new response field.
        expect(err).toBe(injected);
        expect(err.message).toBe('connection terminated unexpectedly');
        expect(err.code).toBe('ECONNRESET');
        // …and emphatically NOT the pre-fix outcome: a silent success.
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'opp')).toBe(1);
    });

    it('a probe that fails with a missing COLUMN on an existing relation surfaces it (the superstring case)', async () => {
        // Postgres phrases this failure as `column "x" of relation "opp" does
        // not exist` — which CONTAINS a complete, legal missing-table phrase
        // (`relation "opp" does not exist`). The table is there; the read still
        // did not happen. `isMissingTableError`'s front-exclusion is what keeps
        // this loud, and this pin is what keeps a future hand-rolled code test
        // from quietly reading it as benign.
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('opp', { name: 'Deal', account: a.id });

        const injected = Object.assign(
            new Error('column "amount" of relation "opp" does not exist'),
            { code: '42703' },
        );
        failReads.set('opp', injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toBe(injected);
        expect(err.message).toBe('column "amount" of relation "opp" does not exist');
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'opp')).toBe(1);
    });

    it('a failed probe on a CASCADE relation surfaces too — no parent deleted over unread children', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        await engine.insert('task', { title: 'Follow up', account: a.id });

        const injected = Object.assign(new Error('query timed out'), { code: 'ETIMEDOUT' });
        failReads.set('task', injected);

        const err: any = await engine.delete('acct', { where: { id: a.id } } as any).catch((e) => e);
        expect(err).toBe(injected);
        expect(err.message).toBe('query timed out');
        // Pre-fix this deleted the parent and left the child pointing at a row
        // that no longer exists.
        expect(rows(stores, 'acct')).toBe(1);
        expect(rows(stores, 'task')).toBe(1);
    });

    // ── THE ONE BENIGN CASE — an unprovisioned child table cannot hold a
    //    referencing row, so "no dependents" is the truth and the delete runs.

    it('an UNPROVISIONED child table (sqlite phrasing) is truthful emptiness: the delete proceeds', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        failReads.set('opp', new Error('no such table: opp'));

        readCalls.length = 0;
        await engine.delete('acct', { where: { id: a.id } } as any);

        expect(rows(stores, 'acct')).toBe(0);
        // Proof the benign branch was actually EXERCISED — the probe ran and
        // threw. Without this, the passing delete above would be consistent
        // with a harness that never probes `opp` at all.
        expect(readCalls).toContain('opp');
    });

    it('an UNPROVISIONED child table (postgres 42P01) is truthful emptiness: the delete proceeds', async () => {
        const a = await engine.insert('acct', { name: 'Acme' });
        failReads.set('opp', Object.assign(new Error('relation "opp" does not exist'), {
            code: '42P01',
        }));

        readCalls.length = 0;
        await engine.delete('acct', { where: { id: a.id } } as any);

        expect(rows(stores, 'acct')).toBe(0);
        expect(readCalls).toContain('opp');
    });
});
