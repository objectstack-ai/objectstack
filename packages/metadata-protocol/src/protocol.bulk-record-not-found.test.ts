// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5088] The BY-ID bulk write faces answer `RECORD_NOT_FOUND` for a row whose
 * id names no record — and never let that row reach the write pipeline.
 *
 * #4435 made "a write that touched zero rows must not report success" the rule,
 * but it landed on 2 of the 5 write faces in `protocol.ts`: `updateData` (an
 * existence probe) and `runDeleteManyLoop` (`deleted === false`). The three
 * bulk faces went straight to the engine:
 *
 *   * `updateManyData` — no probe. A row naming no record entered the write
 *     pipeline, where #4770's record materialisation (stored ⊕ payload) had no
 *     stored side, a hook `condition` reading any untouched field found it
 *     absent, and #4775's unevaluable-condition abort fired. The row came back
 *     `INTERNAL_ERROR` with a diagnostic accusing a CORRECT hook of naming an
 *     undeclared field — so an operator with one stale id in a batch was told
 *     their hook was broken and pointed at the object's field list.
 *   * `batchData` `update` — the same gap, same file.
 *   * `batchData` `delete` — discarded the driver's return and pushed
 *     `success: true` unconditionally: a batch of typo'd ids reported every one
 *     of them deleted. Verbatim the defect #4435's own body describes, still
 *     live ten lines from the `deleteMany` loop that fixed it.
 *
 * The pins that matter most here are the ones about what the engine was ASKED
 * to do: a 404 in the response body is cheap to produce, but "the write
 * pipeline never ran for that row" is the actual guarantee — it is what keeps
 * hooks, automation and audit rows from firing for a record that does not
 * exist. So the fake engine below reproduces the #4775 abort verbatim on any
 * write it receives for an unknown id, and each test asserts both the row's
 * code and that the write was never attempted.
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'showcase_task',
    fields: {
        progress: { name: 'progress', type: 'number' },
        done: { name: 'done', type: 'boolean' },
    },
};

/**
 * What the real pipeline answers today when a write reaches it for an id with
 * no stored row — quoted from the issue's repro. Unclassified (no `code`, no
 * `status`), so `toRowApiError` renders it `INTERNAL_ERROR`: exactly the
 * misdirection the probe exists to prevent.
 */
const HOOK_ABORT =
    "Hook 'showcase_audit_task_completion' could not evaluate its condition " +
    '(runtime: No such key: done) — operation aborted. The condition reads ' +
    "'done', which this object does not declare — fix the hook's condition, or " +
    'declare the field.';

/**
 * In-memory store with real snapshot/rollback transaction semantics — the
 * harness shape the #4620 / #4793 suites use, so every response row here is
 * produced by the actual loops, builders and rollback classifier.
 */
function makeStoreEngine() {
    const rows = new Map<string, any>([
        ['t1', { id: 't1', progress: 0, done: false }],
        ['t2', { id: 't2', progress: 0, done: false }],
        ['t3', { id: 't3', progress: 0, done: false }],
    ]);
    const handle = { id: 'trx-1' };

    const update = vi.fn(async (_object: string, data: any, options?: any) => {
        assertEngineUpdateDispatch(data, options);
        const id = options?.where?.id;
        // The write pipeline, reached for an id that names no row: the hook
        // condition evaluates against a payload-only record and #4775 aborts.
        if (!rows.has(id)) throw new Error(HOOK_ABORT);
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
        registry: { getObject: (n: string) => (n === 'showcase_task' ? SCHEMA : undefined) },
        update,
        delete: del,
        findOne,
        insert: vi.fn(async (_object: string, data: any) => {
            const rec = { id: data.id ?? `new-${rows.size + 1}`, ...data };
            rows.set(rec.id, rec);
            return rec;
        }),
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
    return { engine, rows, update, del, findOne };
}

/**
 * The 404 the single-record PATCH answers, asserted on a BATCH ROW. Same code,
 * same status, same message text — "matching the single-record path" is the
 * acceptance criterion, so it is checked literally rather than by `/not found/`.
 */
function expectRecordNotFoundRow(row: any, id: string) {
    expect(row.success).toBe(false);
    expect(row.errors?.[0]?.code).toBe('RECORD_NOT_FOUND');
    expect(row.errors?.[0]?.httpStatus).toBe(404);
    expect(row.errors?.[0]?.message).toBe(`Record ${id} not found in showcase_task`);
    // The misdirection this fixes: never the hook diagnostic, never a 500.
    expect(row.errors?.[0]?.message).not.toContain('could not evaluate its condition');
}

describe('[#5088] updateManyData — a row naming no record is RECORD_NOT_FOUND', () => {
    it('non-atomic: the row is a 404 and the write pipeline never ran for it', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_task',
            records: [{ id: 'definitely_missing', data: { progress: 1 } }],
            options: { continueOnError: true },
        } as any);

        expectRecordNotFoundRow(res.results[0], 'definitely_missing');
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(1);
        // THE CRUX. A refused row must not fire hooks, automation or an audit
        // row for a record that does not exist — so the engine is never asked.
        expect(t.update).not.toHaveBeenCalled();
    });

    it('non-atomic: a stale id fails alone — the real rows in the same batch still land', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_task',
            records: [
                { id: 't1', data: { progress: 1 } },
                { id: 'definitely_missing', data: { progress: 1 } },
                { id: 't3', data: { progress: 3 } },
            ],
            options: { continueOnError: true },
        } as any);

        expect(res.succeeded).toBe(2);
        expect(res.failed).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 't1', success: true });
        expectRecordNotFoundRow(res.results[1], 'definitely_missing');
        expect(res.results[2]).toMatchObject({ id: 't3', success: true });
        expect(t.rows.get('t1')).toMatchObject({ progress: 1 });
        expect(t.rows.get('t3')).toMatchObject({ progress: 3 });
        expect(t.update).toHaveBeenCalledTimes(2);
    });

    it('atomic: the stale row is the CAUSAL row — later rows NOT_ATTEMPTED, nothing written', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_task',
            records: [
                { id: 'definitely_missing', data: { progress: 1 } },
                { id: 't2', data: { progress: 2 } },
            ],
            options: { atomic: true },
        } as any);

        // The atomic shape is UNCHANGED by this fix — only the causal row's
        // code moves from INTERNAL_ERROR to RECORD_NOT_FOUND.
        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(2);
        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'RECORD_NOT_FOUND', 'NOT_ATTEMPTED',
        ]);
        expectRecordNotFoundRow(res.results[0], 'definitely_missing');
        expect(t.rows.get('t2')).toMatchObject({ progress: 0 });
        expect(t.update).not.toHaveBeenCalled();
    });

    it('atomic: a stale row AFTER a real one still rolls the real one back', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_task',
            records: [
                { id: 't1', data: { progress: 1 } },
                { id: 'definitely_missing', data: { progress: 1 } },
                { id: 't3', data: { progress: 3 } },
            ],
            options: { atomic: true },
        } as any);

        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'ROLLED_BACK', 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED',
        ]);
        // Nothing persisted — the guarantee, read back off the store.
        expect(t.rows.get('t1')).toMatchObject({ progress: 0 });
        expect(t.rows.get('t3')).toMatchObject({ progress: 0 });
    });

    it('regression: a batch of real ids is completely unaffected', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_task',
            records: [
                { id: 't1', data: { progress: 1 } },
                { id: 't2', data: { progress: 2 } },
            ],
            context: { userId: 'u1' },
        } as any);

        expect(res).toMatchObject({ success: true, operation: 'update', total: 2, succeeded: 2, failed: 0 });
        expect(res.results[0]).toMatchObject({ id: 't1', success: true, index: 0 });
        expect(res.results[0].data).toMatchObject({ id: 't1', progress: 1 });
        // Context is still threaded to every write (#3455).
        expect(t.update.mock.calls.every((c: any[]) => c[2]?.context?.userId === 'u1')).toBe(true);
        // …and the probe asks EXISTENCE, not visibility (#4435): system context,
        // so a row the caller cannot READ is still the by-id write policy's call.
        expect(t.findOne.mock.calls.every((c: any[]) => c[1]?.context?.isSystem === true)).toBe(true);
    });
});

describe('[#5088] batchData update — the same gate as updateMany', () => {
    it('non-atomic: RECORD_NOT_FOUND, and the write pipeline never ran', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'update',
                records: [
                    { id: 't1', data: { progress: 1 } },
                    { id: 'definitely_missing', data: { progress: 1 } },
                ],
                options: { continueOnError: true },
            },
        } as any);

        expect(res.succeeded).toBe(1);
        expect(res.failed).toBe(1);
        expectRecordNotFoundRow(res.results[1], 'definitely_missing');
        expect(t.update).toHaveBeenCalledTimes(1);
        expect(t.update.mock.calls[0][2].where.id).toBe('t1');
    });

    it('atomic: the stale row is causal, the earlier write is rolled back', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'update',
                records: [
                    { id: 't1', data: { progress: 1 } },
                    { id: 'definitely_missing', data: { progress: 1 } },
                    { id: 't3', data: { progress: 3 } },
                ],
                options: { atomic: true },
            },
        } as any);

        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'ROLLED_BACK', 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED',
        ]);
        expect(res.succeeded).toBe(0);
        expect(t.rows.get('t1')).toMatchObject({ progress: 0 });
    });

    it('`returnRecords: false` still drops `data` and keeps the 404 row intact', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'update',
                records: [
                    { id: 't1', data: { progress: 1 } },
                    { id: 'definitely_missing', data: { progress: 1 } },
                ],
                options: { returnRecords: false, continueOnError: true },
            },
        } as any);

        expect(res.results[0].data).toBeUndefined();
        expectRecordNotFoundRow(res.results[1], 'definitely_missing');
    });

    it('upsert is deliberately UNTOUCHED: a missing id still inserts', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'upsert',
                records: [{ id: 'brand_new', data: { progress: 1 } }],
            },
        } as any);

        expect(res.succeeded).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 'brand_new', success: true });
        expect(t.rows.has('brand_new')).toBe(true);
    });
});

describe('[#5088] batchData delete — the driver`s return decides, as in deleteMany', () => {
    it('non-atomic: a typo`d id is RECORD_NOT_FOUND, not a reported deletion', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'delete',
                records: [{ id: 't1' }, { id: 'definitely_missing' }, { id: 't3' }],
                options: { continueOnError: true },
            },
        } as any);

        expect(res.succeeded).toBe(2);
        expect(res.failed).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 't1', success: true });
        expectRecordNotFoundRow(res.results[1], 'definitely_missing');
        expect(res.results[2]).toMatchObject({ id: 't3', success: true });
        expect(t.rows.has('t1')).toBe(false);
        expect(t.rows.has('t3')).toBe(false);
    });

    it('a whole batch of typo`d ids reports ZERO deletions', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'delete',
                records: [{ id: 'nope_1' }, { id: 'nope_2' }],
                options: { continueOnError: true },
            },
        } as any);

        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(2);
        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'RECORD_NOT_FOUND', 'RECORD_NOT_FOUND',
        ]);
        expect(t.rows.size).toBe(3);
    });

    it('atomic: the earlier delete is actually undone — the row is STILL THERE', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: {
                operation: 'delete',
                records: [{ id: 't1' }, { id: 'definitely_missing' }, { id: 't3' }],
                options: { atomic: true },
            },
        } as any);

        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'ROLLED_BACK', 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED',
        ]);
        expect(t.rows.has('t1')).toBe(true);
        expect(t.rows.has('t3')).toBe(true);
    });

    it('regression: real ids still delete and report success', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: { operation: 'delete', records: [{ id: 't1' }, { id: 't2' }] },
        } as any);

        expect(res).toMatchObject({ success: true, operation: 'delete', succeeded: 2, failed: 0 });
        expect(t.rows.has('t1')).toBe(false);
        expect(t.rows.has('t2')).toBe(false);
    });

    it('a driver that answers with the deleted ROW is not turned into a spurious 404', async () => {
        // `=== false` is the contract's positive not-found value; anything else
        // — a returned row, an `undefined` from an off-contract driver — is not
        // a not-found signal and must not be inferred into one (#4435).
        const t = makeStoreEngine();
        t.engine.delete = vi.fn(async () => undefined);
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'showcase_task',
            request: { operation: 'delete', records: [{ id: 't1' }] },
        } as any);

        expect(res.succeeded).toBe(1);
        expect(res.results[0]).toMatchObject({ id: 't1', success: true });
    });
});

describe('[#5100] an id-less row is a CALLER error on both by-id update faces', () => {
    it('updateMany: VALIDATION_FAILED/400 before any engine read or write', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'showcase_task',
            records: [{ data: { progress: 1 } }],
            options: { continueOnError: true },
        } as any);

        expect(res.succeeded).toBe(0);
        expect(res.failed).toBe(1);
        expect(res.results[0].errors?.[0]?.code).toBe('VALIDATION_FAILED');
        expect(res.results[0].errors?.[0]?.httpStatus).toBe(400);
        expect(res.results[0].errors?.[0]?.message).toBe('Record id is required for update');
        // A missing id is a request-shape error, not a data-state one — and it
        // must fail BEFORE any engine round-trip: unguarded, the row reached
        // the #5088 probe as `{ id: undefined }`, whose reading is up to the
        // driver's undefined-where-key handling, and came back as a 404 with
        // `undefined` interpolated into the message.
        expect(res.results[0].errors?.[0]?.message).not.toContain('not found');
        expect(t.findOne).not.toHaveBeenCalled();
        expect(t.update).not.toHaveBeenCalled();
    });

    it('the two by-id update faces give ONE classification for the same malformed row (#4620)', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const many: any = await p.updateManyData({
            object: 'showcase_task',
            records: [{ data: { progress: 1 } }],
        } as any);
        const batch: any = await p.batchData({
            object: 'showcase_task',
            request: { operation: 'update', records: [{ data: { progress: 1 } }] },
        } as any);

        expect(many.results[0].errors[0].code).toBe(batch.results[0].errors[0].code);
        expect(many.results[0].errors[0].message).toBe(batch.results[0].errors[0].message);
        expect(many.results[0].errors[0].httpStatus).toBe(batch.results[0].errors[0].httpStatus);
        expect(batch.results[0].errors[0].code).toBe('VALIDATION_FAILED');
    });
});

describe('[#5088] the three by-id write faces answer the SAME thing', () => {
    it('single-record PATCH, updateMany and batchData produce one message for one missing id', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);
        const expected = 'Record definitely_missing not found in showcase_task';

        let single: any;
        try {
            await p.updateData({ object: 'showcase_task', id: 'definitely_missing', data: { progress: 1 } } as any);
        } catch (err) {
            single = err;
        }
        expect(single?.code).toBe('RECORD_NOT_FOUND');
        expect(single?.message).toBe(expected);

        const many: any = await p.updateManyData({
            object: 'showcase_task',
            records: [{ id: 'definitely_missing', data: { progress: 1 } }],
        } as any);
        const batch: any = await p.batchData({
            object: 'showcase_task',
            request: { operation: 'update', records: [{ id: 'definitely_missing', data: { progress: 1 } }] },
        } as any);

        expect(many.results[0].errors[0].message).toBe(expected);
        expect(batch.results[0].errors[0].message).toBe(expected);
        expect(many.results[0].errors[0].code).toBe(single.code);
        expect(batch.results[0].errors[0].code).toBe(single.code);
    });
});
