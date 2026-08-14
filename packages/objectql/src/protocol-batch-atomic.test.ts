// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0119 (#4612), end-to-end: the real `ObjectQL` engine + the real metadata
// protocol + a driver whose transactions actually roll back. The unit pins in
// `metadata-protocol/src/protocol.batch-atomic.test.ts` prove `batchData` asks
// for the right things; these prove the stack delivers them — that the rows are
// genuinely gone after a rollback, and that internal reads issued during a
// transactional write bind to the open transaction rather than reaching for a
// second connection.
//
// That last one is the coverage whose absence ADR-0034 was written about: a
// nested query taking another connection deadlocks the single-connection SQLite
// pool, and no unit test with a fake engine can catch it.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import type { IDataDriver, IObjectQLEngine } from '@objectstack/spec/contracts';

/**
 * A stub driver with real transaction semantics: `beginTransaction` snapshots
 * every table, `rollback` restores the snapshot wholesale, `commit` drops it —
 * a genuine rollback, small enough to assert against.
 *
 * Typed `IDataDriver` on purpose, not `any` (#6546). Nothing in this file parses
 * the double through `DriverInterfaceSchema`, so `tsc` at THIS literal is the
 * only channel that can reject a retired capability bit — and `any` switched it
 * off. Under the annotation the retired keys tombstoned in
 * `DriverCapabilitiesSchema` (`retiredKey()`, i.e. `never`) fail to compile
 * here, which is the point of the tombstone: mocks get copied, and a copy of
 * this one now inherits the diagnostic rather than the silence.
 */
function makeSnapshotDriver() {
    const stores = new Map<string, Map<string, any>>();
    const seen = {
        create: [] as Array<{ object: string; transaction: unknown }>,
        findOne: [] as Array<{ object: string; transaction: unknown }>,
        begin: [] as unknown[],
        commit: [] as unknown[],
        rollback: [] as unknown[],
    };
    const storeFor = (o: string) => {
        let s = stores.get(o);
        if (!s) { s = new Map(); stores.set(o, s); }
        return s;
    };
    const snapshots = new Map<unknown, Map<string, Map<string, any>>>();
    let nextId = 0;
    let nextTrx = 0;

    const driver: IDataDriver = {
        name: 'snapshot',
        version: '0.0.0',
        // No capability bits at all, deliberately. This driver used to author
        // `{ transactions: true }`, a key RETIRED by #4634 whose prescription is
        // exactly this: transaction use gates on METHOD PRESENCE
        // (`beginTransaction` below), so the bit decided nothing. The suite
        // proves it — every transactional assertion here passes against an
        // empty `supports`.
        supports: {},
        async connect() { },
        async disconnect() { },
        async checkHealth() { return true; },
        async execute() { return null; },
        async find(object: string) { return Array.from(storeFor(object).values()); },
        async findOne(object: string, ast: any, options: any) {
            seen.findOne.push({ object, transaction: options?.transaction });
            const id = ast?.where?.id ?? ast?.filters?.id;
            if (id) return storeFor(object).get(id) ?? null;
            for (const r of storeFor(object).values()) return r;
            return null;
        },
        async create(object: string, data: Record<string, unknown>, options: any) {
            seen.create.push({ object, transaction: options?.transaction });
            // The poison row fails at the driver, the way a constraint would.
            if (data.title === '__explode__') throw new Error('constraint violated');
            nextId += 1;
            const id = (data.id as string) ?? `r_${nextId}`;
            const row = { ...data, id };
            storeFor(object).set(id, row);
            return row;
        },
        async update(object: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(object);
            const row = { ...s.get(id), ...data, id };
            s.set(id, row);
            return row;
        },
        async delete(object: string, id: string) { return storeFor(object).delete(id); },
        async count() { return 0; },
        async bulkCreate(object: string, rows: Record<string, unknown>[]) {
            return Promise.all(rows.map((r) => this.create(object, r, undefined)));
        },
        async bulkUpdate() { return []; },
        async bulkDelete() { },
        // Required by `IDataDriver`, unreached by these tests — stubbed so the
        // annotation above can stand. Each throws rather than returning a
        // plausible value: a silent no-op would let a future test believe it had
        // exercised a path this double does not model.
        async upsert(): Promise<Record<string, unknown>> { throw new Error('snapshot driver: upsert() is not modelled'); },
        async syncSchema() { throw new Error('snapshot driver: syncSchema() is not modelled'); },
        async dropTable() { throw new Error('snapshot driver: dropTable() is not modelled'); },
        async beginTransaction() {
            nextTrx += 1;
            const trx = { __trx: nextTrx };
            const snap = new Map<string, Map<string, any>>();
            for (const [name, rows] of stores) snap.set(name, new Map(rows));
            snapshots.set(trx, snap);
            seen.begin.push(trx);
            return trx;
        },
        async commit(trx: unknown) { snapshots.delete(trx); seen.commit.push(trx); },
        async rollback(trx: unknown) {
            const snap = snapshots.get(trx);
            if (snap) {
                stores.clear();
                for (const [name, rows] of snap) stores.set(name, new Map(rows));
            }
            snapshots.delete(trx);
            seen.rollback.push(trx);
        },
    };
    return { driver, seen, rowsOf: (o: string) => Array.from(storeFor(o).values()) };
}

describe('atomic batchData over the real engine (ADR-0119 D4 / ADR-0034)', () => {
    let engine: ObjectQL;
    let protocol: ObjectStackProtocolImplementation;
    let d: ReturnType<typeof makeSnapshotDriver>;

    beforeEach(async () => {
        engine = new ObjectQL();
        d = makeSnapshotDriver();
        engine.registerDriver(d.driver, true);
        await engine.init();
        engine.registry.registerObject({ name: 'invoice', fields: { title: { type: 'text' } } });
        protocol = new ObjectStackProtocolImplementation(engine as any);
    });

    it('commits every row on success, on ONE transaction', async () => {
        const res: any = await protocol.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: 'B' } }, { data: { title: 'C' } }],
                options: { atomic: true },
            },
        } as any);

        expect(res.succeeded).toBe(3);
        expect(d.rowsOf('invoice')).toHaveLength(3);
        expect(d.seen.begin).toHaveLength(1);
        expect(d.seen.commit).toHaveLength(1);
        expect(d.seen.rollback).toHaveLength(0);

        // One transaction, shared by every write — not three.
        const handle = d.seen.begin[0];
        for (const c of d.seen.create) expect(c.transaction).toBe(handle);
    });

    it('a failing row rolls the whole batch back — ZERO rows persist', async () => {
        const res: any = await protocol.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: 'B' } }, { data: { title: '__explode__' } }],
                options: { atomic: true },
            },
        } as any);

        // The two rows that succeeded against the driver are gone.
        expect(d.rowsOf('invoice')).toHaveLength(0);
        expect(d.seen.rollback).toHaveLength(1);
        expect(d.seen.commit).toHaveLength(0);

        // …and the response does not claim them.
        expect(res.success).toBe(false);
        expect(res.succeeded).toBe(0);
        expect(res.results.every((r: any) => r.success === false)).toBe(true);
        expect(res.results[0].errors?.[0]?.code).toBe('ROLLED_BACK');
        // [#8502] `constraint violated` is a bare driver `Error` — it declares
        // no client refusal, so its sentence is withheld and the causal row
        // says the stable operation-named line. The claim here is unchanged:
        // row 2 is the CAUSAL row and rows 0/1 are its collateral, which is
        // what `ROLLED_BACK` above and this row's own message together say.
        expect(res.results[2].errors?.[0]?.message).toBe(
            'The create of this record failed. The reason is in the server log.',
        );
        // …and the driver's own text is nowhere in the response.
        expect(JSON.stringify(res)).not.toContain('constraint violated');
    });

    it('leaves rows written BEFORE the batch untouched when it rolls back', async () => {
        await engine.insert('invoice', { title: 'pre-existing' });
        expect(d.rowsOf('invoice')).toHaveLength(1);

        await protocol.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: '__explode__' } }],
                options: { atomic: true },
            },
        } as any);

        // Rollback undoes the batch, not the world.
        const rows = d.rowsOf('invoice');
        expect(rows).toHaveLength(1);
        expect(rows[0].title).toBe('pre-existing');
    });

    it('an internal read during the batch binds to the open transaction (no second connection)', async () => {
        // The upsert path issues a findOne before writing. Under ADR-0034's
        // ambient store it must run on the batch's transaction; if it asked the
        // pool for another connection this is where a single-connection driver
        // would deadlock.
        await protocol.batchData({
            object: 'invoice',
            request: {
                operation: 'upsert',
                records: [{ id: 'inv-1', data: { title: 'A' } }],
                options: { atomic: true },
            },
        } as any);

        const handle = d.seen.begin[0];
        expect(d.seen.findOne.length).toBeGreaterThan(0);
        for (const r of d.seen.findOne) expect(r.transaction).toBe(handle);
    });

    it('gates transactions on METHOD PRESENCE, not a capability bit (#4634 / #6546)', async () => {
        // The half of the gate that is easy to mistake for a capability bit.
        // This driver advertises NO capabilities at all, and the transactional
        // path below still runs end to end. Until #6546 the double authored
        // `supports: { transactions: true }` — a key RETIRED by #4634 and
        // tombstoned in `DriverCapabilitiesSchema` as `never` — and every
        // assertion in this suite passed identically with it, because nothing
        // has ever read it. `beginTransaction` being a function is the gate;
        // the companion test below removes the method and the engine refuses.
        expect(Object.keys(d.driver.supports)).toHaveLength(0);
        expect(typeof d.driver.beginTransaction).toBe('function');

        await protocol.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }],
                options: { atomic: true },
            },
        } as any);

        expect(d.seen.begin).toHaveLength(1);
        expect(d.seen.commit).toHaveLength(1);
    });

    it('refuses atomic when the driver cannot transact, and writes nothing', async () => {
        const bare = new ObjectQL();
        const plain = makeSnapshotDriver();
        // The other half: remove the METHOD and the engine refuses — no bit
        // anywhere can put the capability back. `Reflect.deleteProperty` rather
        // than `delete` because `beginTransaction` is REQUIRED on `IDataDriver`
        // (`delete` on a non-optional property is TS2790); identical at runtime,
        // and it keeps the double free of casts.
        Reflect.deleteProperty(plain.driver, 'beginTransaction');
        expect(plain.driver.beginTransaction).toBeUndefined();
        bare.registerDriver(plain.driver, true);
        await bare.init();
        bare.registry.registerObject({ name: 'invoice', fields: { title: { type: 'text' } } });
        const p = new ObjectStackProtocolImplementation(bare as any);

        await expect(p.batchData({
            object: 'invoice',
            request: { operation: 'create', records: [{ data: { title: 'A' } }], options: { atomic: true } },
        } as any)).rejects.toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });

        expect(plain.rowsOf('invoice')).toHaveLength(0);
    });
});

describe('ADR-0119 D1 — transaction is reachable through the contract', () => {
    it('calls transaction() on an engine typed as IObjectQLEngine, with no cast', async () => {
        const engine = new ObjectQL();
        const d = makeSnapshotDriver();
        engine.registerDriver(d.driver, true);
        await engine.init();
        engine.registry.registerObject({ name: 'invoice', fields: { title: { type: 'text' } } });

        // The point of the pin is the TYPE, not the runtime: before ADR-0119 D1
        // this line could not compile — `transaction` was absent from the
        // contract, so every cross-package consumer reached it through
        // `as unknown as { transaction: ... }`.
        const contract: IObjectQLEngine = engine;
        const result = await contract.transaction(async (trxCtx: any) => {
            expect(trxCtx.transaction).toBeTruthy();
            await engine.insert('invoice', { title: 'via-contract' });
            return 'ok';
        });

        expect(result).toBe('ok');
        expect(d.seen.commit).toHaveLength(1);
        expect(d.rowsOf('invoice')).toHaveLength(1);
    });
});
