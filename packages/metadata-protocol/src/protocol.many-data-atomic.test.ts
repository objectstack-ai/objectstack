// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4620 — `deleteManyData` and `updateManyData` get the same `atomic` contract
// ADR-0119 D4 gave `batchData`: REAL or REFUSED, never silent best-effort.
//
// Before this, the two siblings of the fixed method — in the same file, sharing
// its response type — were:
//
//   * `deleteManyData`: fake-atomic. `if (options?.atomic) break;` opened no
//     transaction; every row deleted before the failure stayed deleted while the
//     response called itself atomic. Worse than the `batchData` case it was
//     copied from, because a partial delete has no natural undo — the caller
//     cannot reconstruct the rows from the request.
//   * `updateManyData`: `atomic` never appeared in the method at all. Accepted,
//     never read, no signal — declared ≠ enforced on a write-path guarantee.
//
// The pins that matter most here are the STATE ones: `succeeded: 0` in a
// response is cheap to produce; rows that are still readable after a failed
// atomic delete are the actual guarantee. So the fake engine below is a real
// little store with snapshot/restore transaction semantics, and each rollback
// test reads the store back afterwards.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = { name: 'invoice', fields: { title: { name: 'title', type: 'text' } } };

/** Marks an update the fake engine should reject, so a failure lands at a chosen index. */
const POISON = '__explode__';

/**
 * A fake engine backed by an in-memory store whose `transaction()` mirrors the
 * real `ObjectQL.transaction` contract: run the callback on a handle-carrying
 * context, COMMIT on resolve, ROLL BACK (restore the pre-call snapshot) and
 * re-throw on reject. Anything that survives a rollback here would survive it
 * in a database too.
 */
function makeStoreEngine(opts: { driverCanTransact?: boolean; hasTransaction?: boolean } = {}) {
    const { driverCanTransact = true, hasTransaction = true } = opts;
    const rows = new Map<string, any>([
        ['a', { id: 'a', title: 'a-old' }],
        ['b', { id: 'b', title: 'b-old' }],
        ['c', { id: 'c', title: 'c-old' }],
    ]);
    const commits: unknown[] = [];
    const rollbacks: unknown[] = [];
    const handle = { id: 'trx-1' };

    const update = vi.fn(async (_object: string, data: any, options?: any) => {
        const id = options?.where?.id;
        const current = rows.get(id);
        if (!current) throw new Error(`no such record: ${id}`);
        if (data?.title === POISON) throw new Error('update exploded');
        const next = { ...current, ...data };
        rows.set(id, next);
        return next;
    });
    // Contract per #4435: `false` is the positive not-found value.
    const del = vi.fn(async (_object: string, options?: any) => {
        const id = options?.where?.id;
        if (!rows.has(id)) return false;
        rows.delete(id);
        return { deleted: 1 };
    });

    const engine: any = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        update,
        delete: del,
        findOne: vi.fn(async (_object: string, options?: any) => rows.get(options?.where?.id)),
        getDefaultDriverName: () => 'default',
        getDriverByName: () => (driverCanTransact ? { beginTransaction: async () => handle } : {}),
    };
    if (hasTransaction) {
        engine.transaction = vi.fn(async (callback: (ctx: any) => Promise<any>, baseContext?: any) => {
            const snapshot = new Map(rows);
            const trxCtx = { ...(baseContext ?? {}), transaction: handle };
            try {
                const result = await callback(trxCtx);
                commits.push(handle);
                return result;
            } catch (err) {
                rows.clear();
                for (const [k, v] of snapshot) rows.set(k, v);
                rollbacks.push(handle);
                throw err;
            }
        });
    }
    return { engine, update, del, rows, commits, rollbacks, handle };
}

describe('deleteManyData atomic — the deletes are actually undone (#4620)', () => {
    it('rolls the whole batch back on the first failure: the earlier rows are STILL THERE', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        // 'missing' does not exist, so `engine.delete` answers `false` and the
        // row fails — after 'a' has already been deleted inside the transaction.
        const res: any = await p.deleteManyData({
            object: 'invoice',
            ids: ['a', 'missing', 'c'],
            options: { atomic: true },
        } as any);

        // THE CRUX. A partial delete has no natural undo, so this — not the
        // response body — is what `atomic` was promising all along.
        expect(t.rows.has('a')).toBe(true);
        expect(t.rows.get('a')).toEqual({ id: 'a', title: 'a-old' });
        expect(t.rows.has('c')).toBe(true);

        expect(t.engine.transaction).toHaveBeenCalledTimes(1);
        expect(t.rollbacks).toHaveLength(1);
        expect(t.commits).toHaveLength(0);
        expect(t.del).toHaveBeenCalledTimes(2); // 'c' never attempted

        // Nothing persisted, so nothing may report success.
        expect(res.success).toBe(false);
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(3);
        expect(res.total).toBe(3);
        expect(res.results.every((r: any) => r.success === false)).toBe(true);

        // A client must be able to tell "attempted, undone" from "never ran" —
        // by errors[0].code (#4793), never by sniffing a message prefix.
        expect(res.results[0].id).toBe('a');
        expect(res.results[0].errors?.[0]?.code).toBe('ROLLED_BACK');
        expect(res.results[1].errors?.[0]?.message).toMatch(/not found/i); // the causal row, verbatim
        expect(res.results[1].errors?.[0]?.code).toBe('RECORD_NOT_FOUND');  // its own code survives
        expect(res.results[2].errors?.[0]?.code).toBe('NOT_ATTEMPTED');
        // Rows correlate to the request array by `index` (#4793).
        expect(res.results.map((r: any) => r.index)).toEqual([0, 1, 2]);
    });

    it('commits when every id deletes, and every delete runs on the transaction handle', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'invoice',
            ids: ['a', 'b'],
            options: { atomic: true },
            context: { userId: 'u1' },
        } as any);

        expect(t.commits).toHaveLength(1);
        expect(t.rollbacks).toHaveLength(0);
        expect(t.rows.has('a')).toBe(false);
        expect(t.rows.has('b')).toBe(false);
        expect(res).toMatchObject({ success: true, operation: 'delete', total: 2, succeeded: 2, failed: 0 });

        // Writes must carry the OPEN transaction, not the caller's bare context —
        // otherwise they commit outside the batch and a rollback would spare them.
        for (const call of t.del.mock.calls) {
            expect(call[1].context.transaction).toBe(t.handle);
            expect(call[1].context.userId).toBe('u1');
        }
    });

    it('atomic outranks continueOnError: the rest is never attempted and nothing lands', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'invoice',
            ids: ['missing', 'b', 'c'],
            options: { atomic: true, continueOnError: true },
        } as any);

        expect(t.del).toHaveBeenCalledTimes(1);
        expect(t.rows.size).toBe(3);
        expect(res.succeeded).toBe(0);
        expect(res.results[1].errors?.[0]?.code).toBe('NOT_ATTEMPTED');
    });
});

describe('updateManyData atomic — the option is finally read (#4620)', () => {
    it('rolls back prior updates to their previous values', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [
                { id: 'a', data: { title: 'a-new' } },
                { id: 'b', data: { title: POISON } },
                { id: 'c', data: { title: 'c-new' } },
            ],
            options: { atomic: true },
        } as any);

        // Row 'a' DID update against the engine; the rollback restored it.
        expect(t.rows.get('a')).toEqual({ id: 'a', title: 'a-old' });
        expect(t.rows.get('c')).toEqual({ id: 'c', title: 'c-old' });

        expect(t.engine.transaction).toHaveBeenCalledTimes(1);
        expect(t.rollbacks).toHaveLength(1);
        expect(t.update).toHaveBeenCalledTimes(2); // 'c' never attempted

        expect(res.success).toBe(false);
        expect(res.operation).toBe('update');
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(3);
        expect(res.results[0].id).toBe('a');
        expect(res.results[0].errors?.[0]?.code).toBe('ROLLED_BACK');
        // [#8502] withheld sentence; the propagation claim is asserted against
        // the causal row's own message so the two cannot drift.
        expect(res.results[1].errors?.[0]?.message).toBe('The update of this record failed. The reason is in the server log.');
        expect(res.results[0].errors?.[0]?.message).toContain(res.results[1].errors?.[0]?.message); // carries the cause
        expect(res.results[2].errors?.[0]?.code).toBe('NOT_ATTEMPTED');
        // Nothing persisted, so no reverted write may be reported as a success
        // or carry a record payload.
        expect(res.results.every((r: any) => r.success === false)).toBe(true);
    });

    it('commits when every row updates, on the transaction handle', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [{ id: 'a', data: { title: 'a-new' } }, { id: 'b', data: { title: 'b-new' } }],
            options: { atomic: true },
            context: { userId: 'u1' },
        } as any);

        expect(t.commits).toHaveLength(1);
        expect(t.rows.get('a')).toEqual({ id: 'a', title: 'a-new' });
        expect(res).toMatchObject({ success: true, total: 2, succeeded: 2, failed: 0 });
        for (const call of t.update.mock.calls) {
            expect(call[2].context.transaction).toBe(t.handle);
            expect(call[2].context.userId).toBe('u1');
        }
    });

    it('atomic outranks continueOnError here too', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [
                { id: 'a', data: { title: POISON } },
                { id: 'b', data: { title: 'b-new' } },
            ],
            options: { atomic: true, continueOnError: true },
        } as any);

        expect(t.update).toHaveBeenCalledTimes(1);
        expect(t.rows.get('b')).toEqual({ id: 'b', title: 'b-old' });
        expect(res.succeeded).toBe(0);
        expect(res.results[1].errors?.[0]?.code).toBe('NOT_ATTEMPTED');
    });
});

describe('many-data atomic — refuses rather than degrading (#4620)', () => {
    // The silent downgrade is the exact defect class this issue is about: a
    // caller who asked for atomicity is precisely the caller who must not
    // receive best-effort without being told.
    for (const [label, opts] of [
        ['the engine has no transaction()', { hasTransaction: false }],
        ['the default driver cannot beginTransaction()', { driverCanTransact: false }],
    ] as const) {
        it(`deleteManyData refuses with 501 when ${label}, deleting nothing`, async () => {
            const t = makeStoreEngine(opts);
            const p = new ObjectStackProtocolImplementation(t.engine);

            await expect(p.deleteManyData({
                object: 'invoice', ids: ['a', 'b'], options: { atomic: true },
            } as any)).rejects.toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });

            expect(t.del).not.toHaveBeenCalled();
            expect(t.rows.size).toBe(3);
        });

        it(`updateManyData refuses with 501 when ${label}, updating nothing`, async () => {
            const t = makeStoreEngine(opts);
            const p = new ObjectStackProtocolImplementation(t.engine);

            await expect(p.updateManyData({
                object: 'invoice',
                records: [{ id: 'a', data: { title: 'a-new' } }],
                options: { atomic: true },
            } as any)).rejects.toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });

            expect(t.update).not.toHaveBeenCalled();
            expect(t.rows.get('a')).toEqual({ id: 'a', title: 'a-old' });
        });
    }
});

describe('many-data non-atomic — unchanged (#4620 regression net)', () => {
    it('updateManyData opens no transaction and keeps prior successes when atomic is absent', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [
                { id: 'a', data: { title: 'a-new' } },
                { id: 'b', data: { title: POISON } },
                { id: 'c', data: { title: 'c-new' } },
            ],
        } as any);

        expect(t.engine.transaction).not.toHaveBeenCalled();
        expect(t.rows.get('a')).toEqual({ id: 'a', title: 'a-new' }); // committed, and kept
        // [#7539] The run still STOPS at `b` — `c` is never written (asserted
        // below). What changed is that the response now says so: a row for `c`
        // and counters that reconcile, where this used to report `failed: 1`
        // against `total: 3` with `c` missing from `results` entirely.
        expect(res).toMatchObject({ success: false, operation: 'update', total: 3, succeeded: 1, failed: 2 });
        expect(res.results).toHaveLength(3);
        expect(res.succeeded + res.failed).toBe(res.total);
        expect(res.results[0]).toMatchObject({ id: 'a', success: true, index: 0 });
        expect(res.results[1]).toMatchObject({
            id: 'b', success: false, index: 1,
            errors: [{ message: 'The update of this record failed. The reason is in the server log.' }], // [#8502]
        });
        expect(res.results[2]).toMatchObject({ id: 'c', success: false, index: 2 });
        expect(res.results[2].errors[0].code).toBe('NOT_ATTEMPTED');
        expect(t.rows.get('c')).toEqual({ id: 'c', title: 'c-old' }); // stops without continueOnError
    });

    it('updateManyData continueOnError still processes every row', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [
                { id: 'a', data: { title: POISON } },
                { id: 'b', data: { title: 'b-new' } },
                { id: 'c', data: { title: 'c-new' } },
            ],
            options: { continueOnError: true },
        } as any);

        expect(t.engine.transaction).not.toHaveBeenCalled();
        expect(t.update).toHaveBeenCalledTimes(3);
        expect(res).toMatchObject({ succeeded: 2, failed: 1 });
    });

    it('deleteManyData atomic:false is best-effort, not a refusal, even with no transaction()', async () => {
        const t = makeStoreEngine({ hasTransaction: false });
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'invoice', ids: ['a', 'missing', 'c'], options: { atomic: false, continueOnError: true },
        } as any);

        expect(t.del).toHaveBeenCalledTimes(3);
        expect(t.rows.has('a')).toBe(false); // stays deleted — that is the contract when not atomic
        expect(res).toMatchObject({ success: false, total: 3, succeeded: 2, failed: 1 });
    });

    it('updateManyData atomic:false is best-effort on a non-transactional engine too', async () => {
        const t = makeStoreEngine({ hasTransaction: false });
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [{ id: 'a', data: { title: 'a-new' } }],
            options: { atomic: false },
        } as any);

        expect(res.succeeded).toBe(1);
        expect(t.rows.get('a')).toEqual({ id: 'a', title: 'a-new' });
    });
});
