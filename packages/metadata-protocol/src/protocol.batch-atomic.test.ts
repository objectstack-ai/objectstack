// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0119 D4 (#4612) — `batchData`'s `atomic` flag is REAL or REFUSED.
//
// It used to be neither. The flag advertised "rollback entire batch on any
// failure (transaction mode)" and opened no transaction at all: it `break`-ed
// the loop, so every write before the failure stayed committed while the
// response reported those rows `success: true` under a flag whose one job is
// to guarantee they were undone. Same class as #4346 — a write-path guarantee
// declared and not enforced, silent and destructive exactly when it matters.
//
// These pins are the regression net that class of bug needs, and the write-path
// ones matter most: a regression here is invisible until someone's half-batch
// is already in the database.

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'invoice',
    fields: {
        title: { name: 'title', type: 'text' },
    },
};

/** Marks a row the fake engine should reject, so a failure lands at a chosen index. */
const POISON = '__explode__';

/**
 * A fake engine that transacts. `transaction()` mirrors the real
 * `ObjectQL.transaction` contract: run the callback with a handle-carrying
 * context, commit on resolve, roll back and re-throw on reject.
 */
function makeTransactionalEngine(opts: { driverCanTransact?: boolean } = {}) {
    const { driverCanTransact = true } = opts;
    const commits: unknown[] = [];
    const rollbacks: unknown[] = [];
    const handle = { id: 'trx-1' };

    const insert = vi.fn(async (_object: string, data: any) => {
        if (data?.title === POISON) throw new Error('insert exploded');
        return { id: `rec-${insert.mock.calls.length}`, ...data };
    });
    const update = vi.fn(async (_object: string, data: any, options?: any) => {
        if (data?.title === POISON) throw new Error('update exploded');
        return { id: options?.where?.id, ...data };
    });
    const findOne = vi.fn(async (_object: string, options?: any) => ({ id: options?.where?.id }));
    const del = vi.fn(async () => ({ deleted: 1 }));

    const engine: any = {
        registry: { getObject: () => SCHEMA },
        insert,
        update,
        findOne,
        delete: del,
        getDefaultDriverName: () => 'default',
        getDriverByName: () => (driverCanTransact ? { beginTransaction: async () => handle } : {}),
        transaction: vi.fn(async (callback: (ctx: any) => Promise<any>, baseContext?: any) => {
            const trxCtx = { ...(baseContext ?? {}), transaction: handle };
            try {
                const result = await callback(trxCtx);
                commits.push(handle);
                return result;
            } catch (err) {
                rollbacks.push(handle);
                throw err;
            }
        }),
    };
    return { engine, insert, update, findOne, del, commits, rollbacks, handle };
}

describe('batchData atomic — rollback is real and the response admits it (ADR-0119 D4)', () => {
    it('rolls back the whole batch on the first failure and reports ZERO successes', async () => {
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: POISON } }, { data: { title: 'C' } }],
                options: { atomic: true },
            },
        } as any);

        // The transaction was opened once and ROLLED BACK — not committed.
        expect(t.engine.transaction).toHaveBeenCalledTimes(1);
        expect(t.rollbacks).toHaveLength(1);
        expect(t.commits).toHaveLength(0);

        // The third row is never attempted: two inserts, not three.
        expect(t.insert).toHaveBeenCalledTimes(2);

        // The heart of the fix. Row 0 DID succeed against the engine, but the
        // rollback undid it — so the response must not call it a success.
        expect(res.success).toBe(false);
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(3);
        expect(res.total).toBe(3);
        expect(res.results.every((r: any) => r.success === false)).toBe(true);

        // "Attempted, undone" vs "never ran" is a CODE, not a message-prefix
        // regex (#4793) — the message keeps the human-readable cause.
        expect(res.results[0].errors?.[0]?.code).toBe('ROLLED_BACK');
        // [#8502] `insert exploded` is a BARE `Error` — it declares no client
        // refusal, so its sentence is withheld and the row says the stable
        // operation-named line instead. The claim under test is unchanged and
        // is about PROPAGATION: whatever the causal row says, the rolled-back
        // row quotes it, so a caller reading row 0 learns why row 1 stopped
        // the batch. Asserted against the causal row's own message rather than
        // a literal, so the two cannot drift apart.
        expect(res.results[1].errors?.[0]?.message).toBe('The create of this record failed. The reason is in the server log.');
        expect(res.results[0].errors?.[0]?.message).toContain(res.results[1].errors?.[0]?.message); // carries the cause
        expect(res.results[2].errors?.[0]?.code).toBe('NOT_ATTEMPTED');
        // Rows correlate to the request array by `index` (#4793).
        expect(res.results.map((r: any) => r.index)).toEqual([0, 1, 2]);
    });

    it('commits when every row succeeds, and every operation runs on the transaction handle', async () => {
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);
        const ctx = { userId: 'u1' };

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: 'B' } }, { data: { title: 'C' } }],
                options: { atomic: true },
            },
            context: ctx,
        } as any);

        expect(t.commits).toHaveLength(1);
        expect(t.rollbacks).toHaveLength(0);
        expect(res.success).toBe(true);
        expect(res.succeeded).toBe(3);
        expect(res.failed).toBe(0);

        // Every write must carry the OPEN transaction, not the caller's bare
        // context — otherwise it commits outside the batch and the rollback
        // above would silently spare it.
        expect(t.insert).toHaveBeenCalledTimes(3);
        for (const call of t.insert.mock.calls) {
            expect(call[2].context.transaction).toBe(t.handle);
            expect(call[2].context.userId).toBe('u1'); // caller identity preserved
        }
    });

    it('rolls back an update batch too, restoring nothing as successful', async () => {
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'update',
                records: [
                    { id: 'rec-1', data: { title: 'A' } },
                    { id: 'rec-2', data: { title: POISON } },
                ],
                options: { atomic: true },
            },
        } as any);

        expect(t.rollbacks).toHaveLength(1);
        expect(res.succeeded).toBe(0);
        expect(res.results[0].errors?.[0]?.code).toBe('ROLLED_BACK');
        expect(res.results[0].id).toBe('rec-1'); // ids survive so a caller can reconcile
        // [#8502] withheld: a bare `Error` declares no client refusal.
        expect(res.results[1].errors?.[0]?.message).toBe('The update of this record failed. The reason is in the server log.');
    });
});

describe('batchData atomic — refuses rather than degrading (ADR-0119 D4)', () => {
    it('refuses with 501 when the engine has no transaction(), attempting NO writes', async () => {
        const t = makeTransactionalEngine();
        delete t.engine.transaction;
        const p = new ObjectStackProtocolImplementation(t.engine);

        await expect(p.batchData({
            object: 'invoice',
            request: { operation: 'create', records: [{ data: { title: 'A' } }], options: { atomic: true } },
        } as any)).rejects.toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });

        // Refusing means refusing: not one row may land before the complaint.
        expect(t.insert).not.toHaveBeenCalled();
    });

    it('refuses when the default driver cannot begin a transaction, even though the engine exposes transaction()', async () => {
        // The subtle case: `engine.transaction()` silently runs the callback
        // with NO transaction when the driver lacks `beginTransaction`
        // (ADR-0119 D1's declared caveat). Probing only the engine would let
        // "atomic" go back to meaning best-effort precisely here.
        const t = makeTransactionalEngine({ driverCanTransact: false });
        const p = new ObjectStackProtocolImplementation(t.engine);

        await expect(p.batchData({
            object: 'invoice',
            request: { operation: 'create', records: [{ data: { title: 'A' } }], options: { atomic: true } },
        } as any)).rejects.toMatchObject({ status: 501, code: 'NOT_IMPLEMENTED' });

        expect(t.insert).not.toHaveBeenCalled();
        expect(t.engine.transaction).not.toHaveBeenCalled();
    });
});

describe('batchData atomic — precedence and opt-in (ADR-0119 D4)', () => {
    it('atomic outranks continueOnError: the batch aborts and rolls back instead of continuing', async () => {
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: POISON } }, { data: { title: 'B' } }, { data: { title: 'C' } }],
                options: { atomic: true, continueOnError: true },
            },
        } as any);

        expect(t.insert).toHaveBeenCalledTimes(1); // rows 2 and 3 never attempted
        expect(t.rollbacks).toHaveLength(1);
        expect(res.succeeded).toBe(0);
        expect(res.results[1].errors?.[0]?.code).toBe('NOT_ATTEMPTED');
    });

    it('an atomic upsert whose update throws propagates instead of falling back to insert', async () => {
        // Inside an aborted transaction the fallback insert can only fail with
        // a secondary error that buries the real cause.
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'upsert',
                records: [{ id: 'rec-1', data: { title: POISON } }],
                options: { atomic: true },
            },
        } as any);

        expect(t.rollbacks).toHaveLength(1);
        expect(t.insert).not.toHaveBeenCalled();          // no blind fallback
        // [#8502] The cause is withheld from the RESPONSE (bare `Error`), so
        // "the real cause survives" is now carried by the two structural
        // assertions above — the update was attempted and no fallback insert
        // ran — plus the row naming the UPSERT it was doing. What must never
        // appear is the fallback insert's duplicate-key text.
        expect(res.results[0].errors?.[0]?.message).toBe('The upsert of this record failed. The reason is in the server log.');
        expect(res.results[0].errors?.[0]?.message).not.toContain('duplicate key');
    });
});

describe('batchData non-atomic — unchanged (ADR-0119 D4 regression net)', () => {
    it('opens no transaction and keeps prior successes when atomic is absent', async () => {
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: POISON } }, { data: { title: 'C' } }],
            },
        } as any);

        expect(t.engine.transaction).not.toHaveBeenCalled();
        expect(res.succeeded).toBe(1);
        expect(res.results[0].success).toBe(true);   // committed, and honestly reported
        expect(res.results[1].success).toBe(false);
        // Still stops without `continueOnError` — two inserts, never three.
        expect(t.insert).toHaveBeenCalledTimes(2);
        // [#7539] But the STOP is now reported rather than inferred from a
        // counter mismatch. This block used to assert `failed: 1` and
        // `results.length === 2` against `total: 3` — the truncated `results`
        // array and the `succeeded + failed != total` arithmetic that were the
        // card's entire symptom.
        expect(res.failed).toBe(2);
        expect(res.results).toHaveLength(3);
        expect(res.succeeded + res.failed).toBe(res.total);
        expect(res.results[2].errors[0].code).toBe('NOT_ATTEMPTED');
    });

    it('atomic: false is best-effort, not a refusal, even on a non-transactional engine', async () => {
        const t = makeTransactionalEngine();
        delete t.engine.transaction;
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }],
                options: { atomic: false },
            },
        } as any);

        expect(res.succeeded).toBe(1);
    });

    it('continueOnError still processes every row when not atomic', async () => {
        const t = makeTransactionalEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: POISON } }, { data: { title: 'B' } }, { data: { title: 'C' } }],
                options: { continueOnError: true },
            },
        } as any);

        expect(t.insert).toHaveBeenCalledTimes(3);
        expect(res.succeeded).toBe(2);
        expect(res.failed).toBe(1);
    });
});
