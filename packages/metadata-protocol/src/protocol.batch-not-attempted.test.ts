// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7539] A bulk write that STOPS must still report on every record it was
 * given.
 *
 * `POST /data/:object/batch` with no `options` (so `atomic` defaults false,
 * ADR-0119 D4) and three records — valid, failing, valid — answered:
 *
 *     200 { total: 3, succeeded: 1, failed: 1,
 *           results: [ {idx 0 ok}, {idx 1 VALIDATION_FAILED} ] }
 *
 * Four defects in one body, all of them REPORTING defects:
 *   * 2 `results` entries for 3 records;
 *   * no row for idx 2, so the caller cannot tell it was skipped;
 *   * `succeeded + failed` (2) != `total` (3) — the counters do not reconcile;
 *   * the only trace of the skipped record is that arithmetic mismatch.
 *
 * The loop's `break` is NOT the defect. `BatchOptionsSchema.continueOnError`
 * declares itself as "If true (and atomic=false), continue processing remaining
 * records after errors", and ADR-0119 D4 scopes it to exactly `atomic=false`
 * while its test plan item 5 holds non-atomic batches to "behave exactly as
 * before". So stopping is the DECLARED default and `continueOnError` is the
 * knob that buys continuation; if `atomic:false` alone continued, the flag
 * would be inert. What was never declared anywhere is a truncated `results`
 * array and counters that do not add up.
 *
 * `buildBatchDataResponse` reported `total = records.length` while `results`,
 * `succeeded` and `failed` came from a loop that had stopped early — so the
 * un-attempted tail was invisible twice over. Its two siblings
 * (`updateManyData`, `deleteManyData`) under-reported identically: the card's
 * "per-object bulk counters under-report whenever a row fails without
 * `continueOnError`".
 *
 * The shape being restored is the one the ATOMIC arm has delivered since #4793:
 * `results.length === total`, every row saying what happened to it, rows never
 * reached carrying `errors[0].code === 'NOT_ATTEMPTED'`, and
 * `succeeded + failed === total` because `failed` counts every row that is not
 * a success. The two same-run controls from the issue are kept below as GUARDs.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'showcase_private_note',
    fields: {
        title: { name: 'title', type: 'text' },
    },
};

/** The row the fake engine rejects, standing in for the issue's failing record. */
const POISON = '__invalid__';

/**
 * A validation failure shaped like the real one: a classified `code` +
 * `status`, so `toRowApiError` renders `VALIDATION_FAILED`/400 rather than
 * falling back to `INTERNAL_ERROR`.
 */
function validationFailure(): Error {
    const err: any = new Error('title is invalid');
    err.code = 'VALIDATION_FAILED';
    err.status = 400;
    return err;
}

/**
 * In-memory store with real snapshot/rollback transaction semantics — the
 * harness shape the #4620 / #4793 / #5088 suites use, so every row asserted
 * below is produced by the actual loops, builders and rollback classifier, and
 * "did the record LAND?" is answerable by reading the store.
 */
function makeStoreEngine() {
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
    // Contract per #4435: `false` is the positive not-found value.
    const del = vi.fn(async (_object: string, options?: any) => {
        assertEngineDeleteDispatch(options);
        const id = options?.where?.id;
        if (!rows.has(id)) return false;
        rows.delete(id);
        return { deleted: 1 };
    });
    const findOne = vi.fn(async (_object: string, options?: any) => rows.get(options?.where?.id) ?? null);

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

/** `errors[0].code` per row — the machine-readable outcome (#4793). */
const codesOf = (res: any): Array<string | undefined> =>
    res.results.map((r: any) => (r.success ? undefined : r.errors?.[0]?.code));

/**
 * The whole point of the card, asserted as an EQUATION over the response rather
 * than as the presence of one new entry.
 *
 * `notAttempted` is DERIVED from the rows rather than read from a new envelope
 * field: `BatchUpdateResponseSchema` declares `{ total, succeeded, failed,
 * results }` and nothing else, and the atomic arm that already gets this right
 * (`buildRolledBackBatchResponse`) counts a never-reached row in `failed` — so
 * `failed` means "rows that are not successes", and the three-term identity is
 * checked against the codes the rows actually carry.
 */
function expectCountersReconcile(res: any, total: number) {
    const notAttempted = res.results.filter((r: any) => r.errors?.[0]?.code === 'NOT_ATTEMPTED').length;
    const attemptedFailed = res.results.filter((r: any) => r.success === false).length - notAttempted;

    // 1. Every record the caller sent gets a row back.
    expect(res.total).toBe(total);
    expect(res.results).toHaveLength(total);
    // 2. The envelope's own two buckets account for the whole batch.
    expect(res.succeeded + res.failed).toBe(res.total);
    // 3. Three-term identity, with every term derived from the rows: no row is
    //    double-counted and none is invisible.
    expect(res.succeeded + attemptedFailed + notAttempted).toBe(res.total);
    // 4. The buckets agree with the rows they claim to summarise.
    expect(res.succeeded).toBe(res.results.filter((r: any) => r.success === true).length);
    expect(res.failed).toBe(res.results.filter((r: any) => r.success === false).length);
    // 5. `index` still correlates rows to the request array (#4793).
    expect(res.results.map((r: any) => r.index)).toEqual([...Array(total).keys()]);
}

describe('[#7539] batchData non-atomic — a stopped batch reports every record', () => {
    /** The issue's exact repro: no `options` key at all. */
    const threeRecords = [
        { data: { title: 'first valid' } },
        { data: { title: POISON } },
        { data: { title: 'third valid' } },
    ];

    it('answers 3 results for 3 records, with idx 2 marked NOT_ATTEMPTED', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeRecords },
        } as any);

        expectCountersReconcile(res, 3);
        // The per-index outcomes by identity, not by "something new is present".
        expect(codesOf(res)).toEqual([undefined, 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expect(res.results.map((r: any) => r.success)).toEqual([true, false, false]);
        expect(res.succeeded).toBe(1);
        expect(res.failed).toBe(2);
        expect(res.success).toBe(false);

        // The causal row keeps its own error verbatim — NOT_ATTEMPTED must not
        // overwrite the diagnosis the caller needs.
        expect(res.results[1].errors[0].message).toBe('title is invalid');
        expect(res.results[1].errors[0].httpStatus).toBe(400);
        // The skipped row says WHICH record stopped the batch, and how to make
        // the run continue — the caller's next action is in the message.
        expect(res.results[2].errors[0].message).toContain('1');
        expect(res.results[2].errors[0].message).toContain('continueOnError');
        // A skipped row is not a success and carries no record payload.
        expect(res.results[2].success).toBe(false);
        expect(res.results[2].data).toBeUndefined();
    });

    it('GUARD — the stop itself is unchanged: idx 2 is never attempted and never lands', async () => {
        // ADR-0119 D4 test plan item 5 ("non-atomic batches behave exactly as
        // before") plus `continueOnError`'s own contract text. The fix is a
        // REPORTING fix; if this flips, the semantics moved and the flag went
        // inert.
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeRecords },
        } as any);

        expect(t.engine.transaction).not.toHaveBeenCalled();  // no transaction on this arm
        expect(t.insert).toHaveBeenCalledTimes(2);            // idx 2 never reached the engine
        expect(t.insert.mock.calls.map((c: any[]) => c[1].title)).toEqual(['first valid', POISON]);
        // Prior successes are RETAINED (nothing rolled back), the tail is absent.
        expect([...t.rows.values()].map((r: any) => r.title)).toContain('first valid');
        expect([...t.rows.values()].map((r: any) => r.title)).not.toContain('third valid');
        // Deliberately asserts NOTHING about `results[2]`: this control must be
        // green in BOTH directions, and the skipped row's very existence is the
        // thing under repair. Its shape is pinned by the reporting test above.
        expect(res).toBeDefined();
    });

    it('GUARD (control 1) — continueOnError:true still yields 3 results and lands BOTH valid rows', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeRecords, options: { continueOnError: true } },
        } as any);

        expectCountersReconcile(res, 3);
        expect(codesOf(res)).toEqual([undefined, 'VALIDATION_FAILED', undefined]);
        expect(res.succeeded).toBe(2);
        expect(res.failed).toBe(1);
        expect(t.insert).toHaveBeenCalledTimes(3);
        const titles = [...t.rows.values()].map((r: any) => r.title);
        expect(titles).toContain('first valid');
        expect(titles).toContain('third valid');
    });

    it('GUARD (control 2) — atomic:true still yields ROLLED_BACK / causal / NOT_ATTEMPTED', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeRecords, options: { atomic: true } },
        } as any);

        expectCountersReconcile(res, 3);
        expect(codesOf(res)).toEqual(['ROLLED_BACK', 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(3);
        // Nothing persisted — the rollback is real, and the first row is gone.
        expect([...t.rows.values()].map((r: any) => r.title)).not.toContain('first valid');
    });

    it('a batch that never fails is untouched by the reconciliation', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: [{ data: { title: 'a' } }, { data: { title: 'b' } }] },
        } as any);

        expectCountersReconcile(res, 2);
        expect(res.success).toBe(true);
        expect(res.succeeded).toBe(2);
        expect(res.failed).toBe(0);
    });

    it('`returnRecords: false` still drops `data` and keeps the NOT_ATTEMPTED row', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_private_note',
            request: { operation: 'create', records: threeRecords, options: { returnRecords: false } },
        } as any);

        expectCountersReconcile(res, 3);
        expect(codesOf(res)).toEqual([undefined, 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expect(res.results.every((r: any) => r.data === undefined)).toBe(true);
    });
});

describe('[#7539] the same under-report on the two sibling bulk faces', () => {
    it('updateManyData stops without continueOnError — and now says so for every row', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_private_note',
            records: [
                { id: 't1', data: { title: 'renamed one' } },
                { id: 't2', data: { title: POISON } },
                { id: 't3', data: { title: 'renamed three' } },
            ],
        } as any);

        expectCountersReconcile(res, 3);
        expect(codesOf(res)).toEqual([undefined, 'VALIDATION_FAILED', 'NOT_ATTEMPTED']);
        expect(res.succeeded).toBe(1);
        expect(res.failed).toBe(2);
        // Semantics unchanged: the tail is still not written.
        expect(t.rows.get('t3').title).toBe('stored three');
    });

    it('deleteManyData stops without continueOnError — and now says so for every id', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'showcase_private_note',
            ids: ['t1', 'definitely_missing', 't3'],
        } as any);

        expectCountersReconcile(res, 3);
        expect(codesOf(res)).toEqual([undefined, 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED']);
        expect(res.succeeded).toBe(1);
        expect(res.failed).toBe(2);
        // The skipped id is echoed back, so the caller can retry exactly it.
        expect(res.results[2].id).toBe('t3');
        // Semantics unchanged: t3 is still there.
        expect(t.rows.has('t3')).toBe(true);
    });
});
