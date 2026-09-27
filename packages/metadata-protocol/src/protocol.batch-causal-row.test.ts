// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19452] A stopped or rolled-back bulk batch must name the row that actually
 * failed — and must never call a real error 「unknown」 while it is sitting in
 * the same array.
 *
 * `reconcileStoppedBatch` and `buildRolledBackBatchResponse` located the causal
 * row with `findIndex(r => !r.success)`, which encoded the invariant
 * **`!success` ⇒ this row failed and carries `errors[0]`**. #19412 broke that
 * invariant deliberately and correctly: a row that MATCHED and was NOT removed
 * (`IDataEngine.delete` answering the count arm's `0`) now reports
 * `success: false` with ⛔ no `errors` entry, because a surviving record is an
 * OUTCOME, not a fault.
 *
 * ⇒ the locator landed on that survivor, `errors?.[0]?.message` was
 * `undefined`, and the message named the WRONG index while falling back to
 * 「unknown error」. Measured on the unfixed tree, with the harness below:
 *
 *   deleteMany ['t1'(survives), 'missing'(throws), 't3']
 *     -> results[2] NOT_ATTEMPTED "record 0 failed — unknown error; the batch
 *        stopped there. ..."            ⚠️ record 1 is what threw
 *   batchData atomic [t1, t2(survives), t3]
 *     -> results[0] ROLLED_BACK "record 1 failed — unknown error"
 *                                       ⚠️ record 1 SURVIVED; nothing failed
 *
 * The negative case — a batch whose FIRST non-success row is a survivor — is
 * what these pins exist for. The ordinary batches at the bottom are the
 * positive controls: the same assertions on a run with no survivor in it, so a
 * locator that simply stopped naming anything cannot pass this file.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'showcase_private_note',
    fields: {
        title: { name: 'title', type: 'text' },
    },
};

/** The row the fake engine rejects — a classified failure, as `toRowApiError` expects. */
const POISON = '__invalid__';

function validationFailure(): Error {
    const err: any = new Error('title is invalid');
    err.code = 'VALIDATION_FAILED';
    err.status = 400;
    return err;
}

/**
 * In-memory store with real snapshot/rollback transaction semantics — the same
 * harness shape the #4620 / #4793 / #7539 suites use, so every row asserted
 * here is produced by the actual loops, builders and rollback classifier.
 *
 * `delete` speaks the COUNT arm of `IDataEngine.delete`: an unknown id keeps
 * the contract's `false` (which the loop turns into a thrown
 * `RECORD_NOT_FOUND`), the nominated `survivor` matches and is deliberately
 * kept (`0`), everything else really goes (`1`).
 */
function makeCountingEngine(survivor: string) {
    const rows = new Map<string, any>([
        ['t1', { id: 't1', title: 'stored one' }],
        ['t2', { id: 't2', title: 'stored two' }],
        ['t3', { id: 't3', title: 'stored three' }],
    ]);
    const handle = { id: 'trx-1' };

    const insert = vi.fn(async (_object: string, data: any) => {
        if (data?.title === POISON) throw validationFailure();
        const rec = { id: data.id ?? `new-${rows.size + 1}`, ...data };
        rows.set(rec.id, rec);
        return rec;
    });
    const update = vi.fn(async (_object: string, data: any, options?: any) => {
        assertEngineUpdateDispatch(data, options);
        const id = options?.where?.id;
        if (data?.title === POISON) throw validationFailure();
        const next = { ...rows.get(id), ...data };
        rows.set(id, next);
        return next;
    });
    const del = vi.fn(async (_object: string, options?: any) => {
        assertEngineDeleteDispatch(options);
        const id = options?.where?.id;
        if (!rows.has(id)) return false;   // [#4435] the positive not-found value
        if (id === survivor) return 0;     // [#19412] matched, deliberately NOT removed
        rows.delete(id);
        return 1;
    });
    const findOne = vi.fn(async (_object: string, options?: any) => {
        assertEngineFindOnePredicate(_object, options);
        return rows.get(options?.where?.id) ?? null;
    });

    const engine: any = {
        registry: { getObject: (n: string) => (n === 'showcase_private_note' ? SCHEMA : undefined) },
        insert,
        update,
        delete: del,
        findOne,
        getDefaultDriverName: () => 'default',
        getDriverByName: () => ({ beginTransaction: async () => handle }),
        transaction: vi.fn(async (callback: (ctx: any) => Promise<any>, baseContext?: any) => {
            const snapshot = new Map(rows);
            try {
                return await callback({ ...(baseContext ?? {}), transaction: handle });
            } catch (err) {
                rows.clear();
                for (const [k, v] of snapshot) rows.set(k, v);
                throw err;
            }
        }),
    };
    return { engine, rows, insert, update, del, findOne };
}

const codesOf = (res: any): Array<string | undefined> =>
    res.results.map((r: any) => r.errors?.[0]?.code);

/**
 * The card's acceptance, as ONE assertion usable on every message that names a
 * causal row: it names the row that really failed, it carries that row's own
 * error text, and it never says 「unknown error」 while that text exists.
 *
 * `causalIndex` is read from the response rather than hard-coded, so the pin
 * asserts an AGREEMENT between the message and the rows beside it.
 */
function expectAttributedTo(message: string, res: any, causalIndex: number) {
    const causalText = res.results[causalIndex].errors[0].message;
    expect(causalText).toBeTruthy();
    expect(message).toContain(`record ${causalIndex} failed`);
    expect(message).toContain(causalText);
    expect(message).not.toContain('unknown error');
}

describe('[#19452] a stopped batch attributes the stop to the row that threw, not to a survivor', () => {
    it('deleteManyData: a leading survivor does not become the cause', async () => {
        const t = makeCountingEngine('t1');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'showcase_private_note',
            ids: ['t1', 'definitely_missing', 't3'],
        } as any);

        // Row 0 survived (no `errors`), row 1 threw, row 2 was never attempted.
        expect(codesOf(res)).toEqual([undefined, 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED']);
        expect(res.results[0]).toMatchObject({ id: 't1', success: false });
        expect(res.results[0].errors).toBeUndefined();   // why `!success` lies here
        expect(t.rows.has('t1')).toBe(true);             // it really is still there

        // Pre-fix: "record 0 failed — unknown error; the batch stopped there. ..."
        const message = res.results[2].errors[0].message;
        expectAttributedTo(message, res, 1);
        expect(message).not.toContain('record 0');
        expect(message).toContain('continueOnError');
    });

    it('batchData delete: the same run through the other non-atomic face', async () => {
        const t = makeCountingEngine('t1');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'delete', records: [{ id: 't1' }, { id: 'definitely_missing' }, { id: 't3' }] },
        } as any);

        expect(codesOf(res)).toEqual([undefined, 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED']);
        expect(res.results[0].errors).toBeUndefined();

        const message = res.results[2].errors[0].message;
        expectAttributedTo(message, res, 1);
        expect(message).not.toContain('record 0');
    });
});

describe('[#19452] a rolled-back atomic batch attributes the abort to the row that threw', () => {
    /**
     * One run that reaches all THREE message sites: a committed-then-undone
     * row, a survivor, the row that threw, and a row never reached. The two
     * interpolations of the causal index get SEPARATE tests, so neither can
     * mask the other's reading when this file runs red.
     */
    const atomicRunReachingBothInterpolations = async () => {
        const t = makeCountingEngine('t1');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: {
                operation: 'delete',
                records: [{ id: 't3' }, { id: 't1' }, { id: 'definitely_missing' }, { id: 't2' }],
                options: { atomic: true },
            },
        } as any);

        expect(res).toMatchObject({ success: false, total: 4, succeeded: 0, failed: 4 });
        expect(codesOf(res)).toEqual(['ROLLED_BACK', undefined, 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED']);
        return { t, res };
    };

    it('the ROLLED_BACK message names record 2, not the survivor at record 1', async () => {
        const { t, res } = await atomicRunReachingBothInterpolations();

        // Pre-fix: "record 1 failed — unknown error" — record 1 SURVIVED.
        expectAttributedTo(res.results[0].errors[0].message, res, 2);
        expect(res.results[0].errors[0].message).not.toContain('record 1');

        // The rollback is real, and the survivor still carries no `errors`.
        expect(res.results[1].errors).toBeUndefined();
        expect(t.rows.has('t1')).toBe(true);
        expect(t.rows.has('t2')).toBe(true);
        expect(t.rows.has('t3')).toBe(true);
    });

    it('the NOT_ATTEMPTED message names record 2 too — it reads the same index', async () => {
        // ⛔ Not assumed to ride along with the two 「unknown error」 sites. This
        // wording never says 「failed」 and never quotes a cause, so its only
        // defect was the INDEX — but that index is the shared one, so it moves
        // with the locator. Pre-fix this read "atomic batch aborted by record 1".
        const { res } = await atomicRunReachingBothInterpolations();

        expect(res.results[3].errors[0].message).toBe('atomic batch aborted by record 2');
    });

    it('a rollback caused by a survivor ALONE reports no failure at all', async () => {
        // Nothing threw: `runAtomicBatch` aborted on `outcome.failed > 0`, which
        // a lone survivor satisfies. There is no causal ERROR to quote, so the
        // message must not invent one — and must not call the survivor a
        // failure either.
        const t = makeCountingEngine('t2');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: {
                operation: 'delete',
                records: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
                options: { atomic: true },
            },
        } as any);

        expect(codesOf(res)).toEqual(['ROLLED_BACK', undefined, 'ROLLED_BACK']);
        // No row in the whole response carries a fault entry of its own.
        expect(res.results.some((r: any) => r.errors?.[0]?.code === 'RECORD_NOT_FOUND')).toBe(false);

        // Pre-fix: "record 1 failed — unknown error".
        for (const row of [res.results[0], res.results[2]]) {
            expect(row.errors[0].message).toBe('record 1 did not succeed');
            expect(row.errors[0].message).not.toContain('unknown error');
            expect(row.errors[0].message).not.toContain('failed');
        }
        expect(t.rows.has('t2')).toBe(true);
    });
});

describe('[#19452] CONTROLS — an ordinary batch, with no survivor in it, attributes exactly as before', () => {
    const threeCreates = [
        { data: { title: 'first valid' } },
        { data: { title: POISON } },
        { data: { title: 'third valid' } },
    ];

    it('batchData create: the stopped tail still names record 1 and quotes its error', async () => {
        // The positive control for `expectAttributedTo`: this leg is green on
        // the unfixed tree too, so a green above is about the survivor case and
        // ⛔ not about an assertion that can no longer fail.
        const t = makeCountingEngine('none_of_them');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeCreates },
        } as any);

        expect(codesOf(res)).toEqual([undefined, 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expectAttributedTo(res.results[2].errors[0].message, res, 1);
        expect(res.results[2].errors[0].message).toContain('title is invalid');
    });

    it('batchData create atomic: ROLLED_BACK still names record 1 and quotes its error', async () => {
        const t = makeCountingEngine('none_of_them');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeCreates, options: { atomic: true } },
        } as any);

        expect(codesOf(res)).toEqual(['ROLLED_BACK', 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expectAttributedTo(res.results[0].errors[0].message, res, 1);
        expect(res.results[2].errors[0].message).toBe('atomic batch aborted by record 1');
    });

    it('updateManyData: the third bulk face cannot produce an errors-less non-success row', async () => {
        // This face is covered by REASONING rather than by a survivor pin: it
        // has no producer of a non-success row without `errors` — every push in
        // `runUpdateManyLoop` is either `success: true` or a `toRowApiError`
        // row — so `!success` and "carries a fault" still coincide on it. The
        // reading is asserted, not asserted-about: every non-success row here
        // carries an `errors` entry, which is exactly what the delete faces
        // above violate.
        const t = makeCountingEngine('none_of_them');
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_private_note',
            records: [
                { id: 't1', data: { title: 'renamed one' } },
                { id: 't2', data: { title: POISON } },
                { id: 't3', data: { title: 'renamed three' } },
            ],
        } as any);

        expect(codesOf(res)).toEqual([undefined, 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expect(res.results.filter((r: any) => r.success === false).every((r: any) => (r.errors?.length ?? 0) > 0)).toBe(true);
        // And it shares the two builders, so the attribution moves with them.
        expectAttributedTo(res.results[2].errors[0].message, res, 1);
    });
});
