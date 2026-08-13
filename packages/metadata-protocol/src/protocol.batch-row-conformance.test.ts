// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #4793 — the batch-row conformance PIN: declared = delivered, held by a test.
//
// `BatchOperationResultSchema` declared `errors: ApiError[]` / `data` / `index`
// for years while the wire carried a legacy shape (`error: string`, `record`,
// no `index`). Every declaration surface — the schema, the client SDK's
// exported `BatchOperationResult`, the reference docs — said one thing and the
// implementation another, so a consumer written FROM the declaration compiled,
// validated, and read `undefined` at runtime. #4793 migrated the emitters;
// this suite is what keeps them migrated: every row the three bulk-write
// endpoints (`batchData` / `updateManyData` / `deleteManyData`) actually emit
// is parsed with `BatchOperationResultSchema.parse` — success rows, failure
// rows, and both classes of atomic-rollback marking (ROLLED_BACK /
// NOT_ATTEMPTED, which are `errors[0].code` values, never message prefixes).
//
// Zod `z.object` parse STRIPS unknown keys rather than failing on them, and
// `errors` is optional — so `.parse` alone cannot catch a regression back to
// the legacy keys. The pin therefore asserts three things per row:
//   1. `BatchOperationResultSchema.parse(row)` succeeds — which also holds the
//      `errors[].code` vocabulary to the closed ErrorCode set (an invented
//      code fails parse, ADR-0112);
//   2. the legacy keys are ABSENT (`error` / `record` never reappear);
//   3. the declared keys are DELIVERED: a failed row carries `errors` with at
//      least one entry, and every row carries its request-array `index`.

import { describe, it, expect, vi } from 'vitest';
import { BatchOperationResultSchema, BatchUpdateResponseSchema } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = { name: 'invoice', fields: { title: { name: 'title', type: 'text' } } };

/** Marks a write the fake engine rejects, so a failure lands at a chosen row. */
const POISON = '__explode__';

/**
 * In-memory store engine with real snapshot/rollback transaction semantics —
 * the same harness shape the #4620 suites use, so "real response rows" here
 * means rows produced by the actual loops, builders and rollback classifier.
 */
function makeStoreEngine() {
    const rows = new Map<string, any>([
        ['a', { id: 'a', title: 'a-old' }],
        ['b', { id: 'b', title: 'b-old' }],
        ['c', { id: 'c', title: 'c-old' }],
    ]);
    let nextId = 1;
    const handle = { id: 'trx-1' };

    const engine: any = {
        registry: { getObject: (n: string) => (n === 'invoice' ? SCHEMA : undefined) },
        insert: vi.fn(async (_object: string, data: any) => {
            if (data?.title === POISON) throw new Error('insert exploded');
            const rec = { id: data.id ?? `new-${nextId++}`, ...data };
            rows.set(rec.id, rec);
            return rec;
        }),
        update: vi.fn(async (_object: string, data: any, options?: any) => {
            const id = options?.where?.id;
            const current = rows.get(id);
            if (!current) throw new Error(`no such record: ${id}`);
            if (data?.title === POISON) throw new Error('update exploded');
            const next = { ...current, ...data };
            rows.set(id, next);
            return next;
        }),
        // Contract per #4435: `false` is the positive not-found value.
        delete: vi.fn(async (_object: string, options?: any) => {
            const id = options?.where?.id;
            if (!rows.has(id)) return false;
            rows.delete(id);
            return { deleted: 1 };
        }),
        findOne: vi.fn(async (_object: string, options?: any) => rows.get(options?.where?.id)),
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
    return { engine, rows };
}

/** The pin, applied to one REAL response row (see the file header for why parse alone is not enough). */
function expectConformantRow(row: any, index: number) {
    // 1. The row IS the declared shape (and its error codes are in the closed vocabulary).
    expect(() => BatchOperationResultSchema.parse(row)).not.toThrow();
    // 2. The legacy pre-#4793 keys never come back.
    expect(row).not.toHaveProperty('error');
    expect(row).not.toHaveProperty('record');
    // 3. Declared = delivered: failures carry `errors`, every row carries `index`.
    expect(row.index).toBe(index);
    if (row.success === false) {
        expect(Array.isArray(row.errors)).toBe(true);
        expect(row.errors.length).toBeGreaterThan(0);
    } else {
        expect(row.errors).toBeUndefined();
    }
}

/** Pin every row of a response, plus the response envelope itself. */
function expectConformantResponse(res: any, expectedRows: number) {
    expect(() => BatchUpdateResponseSchema.parse(res)).not.toThrow();
    expect(res.results).toHaveLength(expectedRows);
    res.results.forEach((row: any, i: number) => expectConformantRow(row, i));
}

describe('batchData rows conform to BatchOperationResultSchema (#4793)', () => {
    it('non-atomic create — success rows (data present) and the failure row (errors, code, index)', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: POISON } }, { data: { title: 'C' } }],
                options: { continueOnError: true },
            },
        } as any);

        expectConformantResponse(res, 3);
        expect(res.results[0].data).toMatchObject({ title: 'A' });
        // An unclassified engine throw is a 500 in row form.
        // [#8502] `code` is unchanged; the message is the withheld stable line.
        expect(res.results[1].errors[0]).toMatchObject({
            code: 'INTERNAL_ERROR',
            message: 'The create of this record failed. The reason is in the server log.',
        });
        expect(res.results[1].data).toBeUndefined();
    });

    it('returnRecords: false — rows stay conformant, `data` is dropped, `errors`/`index` are kept', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'update',
                records: [{ id: 'a', data: { title: 'a-new' } }, { id: 'missing', data: { title: 'x' } }],
                options: { returnRecords: false, continueOnError: true },
            },
        } as any);

        expectConformantResponse(res, 2);
        expect(res.results[0].data).toBeUndefined();
        // [#5088] Was an unclassified engine throw (`no such record`, rendered
        // INTERNAL_ERROR) because the row reached `engine.update` at all. The
        // update branch now runs the same existence probe as the single-record
        // PATCH, so a missing id is refused BEFORE the write with the catalogued
        // 404 — see `protocol.bulk-record-not-found.test.ts`.
        expect(res.results[1].errors[0]).toMatchObject({ code: 'RECORD_NOT_FOUND', httpStatus: 404 });
        expect(res.results[1].errors[0].message).toMatch(/not found/);
    });

    it('a row that names no id fails with VALIDATION_FAILED, not an unclassified 500', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: { operation: 'update', records: [{ data: { title: 'no-id' } }] },
        } as any);

        expectConformantResponse(res, 1);
        expect(res.results[0].errors[0]).toMatchObject({ code: 'VALIDATION_FAILED', httpStatus: 400 });
    });

    it('atomic rollback — ROLLED_BACK, the causal row, and NOT_ATTEMPTED all parse, as CODES', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.batchData({
            object: 'invoice',
            request: {
                operation: 'create',
                records: [{ data: { title: 'A' } }, { data: { title: POISON } }, { data: { title: 'C' } }],
                options: { atomic: true },
            },
        } as any);

        expectConformantResponse(res, 3);
        expect(res.results[0].errors[0].code).toBe('ROLLED_BACK');
        // [#8502] Same propagation claim, against the causal row's own text.
        expect(res.results[1].errors[0].message).toBe('The create of this record failed. The reason is in the server log.');
        expect(res.results[0].errors[0].message).toContain(res.results[1].errors[0].message); // human-readable cause
        expect(res.results[2].errors[0].code).toBe('NOT_ATTEMPTED');
        // No reverted write may carry a record payload.
        for (const row of res.results) expect(row.data).toBeUndefined();
    });
});

describe('updateManyData rows conform to BatchOperationResultSchema (#4793)', () => {
    it('non-atomic — mixed success and failure', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.updateManyData({
            object: 'invoice',
            records: [
                { id: 'a', data: { title: 'a-new' } },
                { id: 'b', data: { title: POISON } },
                { id: 'c', data: { title: 'c-new' } },
            ],
            options: { continueOnError: true },
        } as any);

        expectConformantResponse(res, 3);
        expect(res.results[0].data).toMatchObject({ id: 'a', title: 'a-new' });
        expect(res.results[1].errors[0].message).toBe('The update of this record failed. The reason is in the server log.'); // [#8502]
    });

    it('atomic rollback — all three row classes, as codes', async () => {
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

        expectConformantResponse(res, 3);
        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'ROLLED_BACK', 'INTERNAL_ERROR', 'NOT_ATTEMPTED',
        ]);
    });
});

describe('deleteManyData rows conform to BatchOperationResultSchema (#4793)', () => {
    it('non-atomic — a missing id is RECORD_NOT_FOUND with its HTTP status mirrored', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'invoice',
            ids: ['a', 'missing', 'c'],
            options: { continueOnError: true },
        } as any);

        expectConformantResponse(res, 3);
        // A thrown error that carries its own catalogued code keeps it.
        expect(res.results[1].errors[0]).toMatchObject({ code: 'RECORD_NOT_FOUND', httpStatus: 404 });
    });

    it('atomic rollback — all three row classes, as codes', async () => {
        const t = makeStoreEngine();
        const p = new ObjectStackProtocolImplementation(t.engine);

        const res: any = await p.deleteManyData({
            object: 'invoice',
            ids: ['a', 'missing', 'c'],
            options: { atomic: true },
        } as any);

        expectConformantResponse(res, 3);
        expect(res.results.map((r: any) => r.errors[0].code)).toEqual([
            'ROLLED_BACK', 'RECORD_NOT_FOUND', 'NOT_ATTEMPTED',
        ]);
    });
});
