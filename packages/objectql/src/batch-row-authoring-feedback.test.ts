// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8502] The POSITIVE CONTROL for the batch-row message withhold: a real
 * `ObjectQL` validator, over a genuinely malformed record, through the real
 * bulk-write loops.
 *
 * ## Why it lives here and not beside the fix
 *
 * `@objectstack/metadata-protocol` cannot import `@objectstack/objectql` —
 * objectql depends on IT, so the import would close a cycle. The withhold's
 * pins therefore stand in for the validation population with a double whose
 * shape was measured (`protocol.batch-row-driver-text.test.ts`, section 5).
 * This file is the half that needs no double at all: objectql may import
 * metadata-protocol, so the sentence under test is produced by the actual
 * `validateRecord` and read off the actual `BatchOperationResult`.
 *
 * ## What would be wrong without it
 *
 * The withhold is a POSITIVE list: a caught sentence reaches the caller only
 * when its producer declared a client refusal. An objectql `ValidationError`
 * declares `code: 'VALIDATION_FAILED'` and, deliberately, **no `status`** —
 * so a rule that tested `status` alone would blank exactly the per-field
 * authoring feedback these rows exist to carry, trading a real usability
 * surface for no disclosure gain. That is the trade the card warned about in
 * capitals, and this file is what makes the answer measured rather than
 * argued: if the predicate ever narrows back to `status`, the assertions below
 * go red with the author's own sentence replaced by the stable line.
 *
 * ⛔ Nothing here builds an error by hand. The record is malformed against a
 * real schema and the engine rejects it on its own.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from './index.js';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

const LEAVE_REQUEST = {
    name: 'bf_leave_request',
    label: 'Leave Request',
    fields: {
        // `maxLength` is what the real record validator rejects against, and
        // its message is the sentence an author has to see to fix the row.
        reason: { type: 'text', maxLength: 8, label: 'Reason' },
        days: { type: 'number' },
    },
};

/** In-memory driver: the validator, not the store, is what must reject here. */
function makeDriver() {
    const rows = new Map<string, any>();
    return {
        name: 'com.objectstack.driver.memory.bf',
        version: '1.0.0',
        async connect() { /* noop */ },
        async disconnect() { /* noop */ },
        async initObjects() { /* noop */ },
        async find(_o: string, options?: any) {
            const id = options?.where?.id;
            if (id !== undefined) { const r = rows.get(String(id)); return r ? [r] : []; }
            return [...rows.values()];
        },
        async findOne(_o: string, options?: any) { return rows.get(String(options?.where?.id)) ?? null; },
        async count() { return rows.size; },
        async create(_o: string, data: any) { rows.set(String(data.id), data); return data; },
        async update(_o: string, data: any, options?: any) {
            const id = String(options?.where?.id);
            const next = { ...(rows.get(id) ?? { id }), ...data };
            rows.set(id, next);
            return next;
        },
        async delete(_o: string, options?: any) {
            const id = String(options?.where?.id);
            if (!rows.has(id)) return false;
            rows.delete(id);
            return { deleted: 1 };
        },
        rows,
    } as any;
}

describe('[#8502] a REAL validation refusal keeps its sentence on a batch row', () => {
    let engine: ObjectQL;
    let protocol: any;
    let driver: any;

    beforeEach(async () => {
        driver = makeDriver();
        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEAVE_REQUEST as any, 'com.objectstack.test.8502');
        protocol = new ObjectStackProtocolImplementation(engine as any);
    });

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
    });

    it('batchData create — the author reads WHICH field and WHY, from the real validator', async () => {
        const res: any = await protocol.batchData({
            object: 'bf_leave_request',
            request: {
                operation: 'create',
                records: [
                    { data: { reason: 'ok', days: 1 } },
                    { data: { reason: 'far too long to be accepted', days: 2 } },
                ],
                options: { continueOnError: true },
            },
        });

        expect(res.results[0].success).toBe(true);
        const bad = res.results[1];
        expect(bad.success).toBe(false);
        expect(bad.errors[0].code).toBe('VALIDATION_FAILED');
        // The engine's own sentence, verbatim — it names the field and the
        // bound that was exceeded. Asserted by CONTENT, not by equality with a
        // literal copied from the validator, so a wording change in objectql
        // does not make this file lie about what it proved.
        expect(bad.errors[0].message).toContain('Reason');
        expect(bad.errors[0].message.toLowerCase()).toContain('8');
        // NON-VACUITY: the withhold's stable sentence must NOT be what came
        // back — that is the exact failure this control exists to catch.
        expect(bad.errors[0].message).not.toContain('The reason is in the server log');
        // And the clean row really landed, so the batch ran for real.
        expect(driver.rows.size).toBe(1);
    });

    it('updateManyData — the same sentence survives on the other loop', async () => {
        await engine.insert('bf_leave_request', { id: 'lr1', reason: 'ok', days: 1 });

        const res: any = await protocol.updateManyData({
            object: 'bf_leave_request',
            records: [{ id: 'lr1', data: { reason: 'far too long to be accepted' } }],
        });

        expect(res.results[0].success).toBe(false);
        expect(res.results[0].errors[0].code).toBe('VALIDATION_FAILED');
        expect(res.results[0].errors[0].message).toContain('Reason');
        expect(res.results[0].errors[0].message).not.toContain('The reason is in the server log');
        // The stored row is untouched: the refusal happened before the write.
        expect((await engine.findOne('bf_leave_request', { where: { id: 'lr1' } } as any)).reason).toBe('ok');
    });

    it('the refusal carries no `status`, so a status-only rule WOULD have blanked it', async () => {
        // The measurement that makes the two cases above evidence rather than
        // coincidence: it is not that the error happens to be quotable, it is
        // that it is quotable ONLY because the rule reads more than `status`.
        let caught: any = null;
        try {
            await engine.insert('bf_leave_request', { id: 'lr2', reason: 'far too long to be accepted' });
        } catch (e) { caught = e; }

        expect(caught).not.toBeNull();
        expect(caught.name).toBe('ValidationError');
        expect(caught.code).toBe('VALIDATION_FAILED');
        expect(caught.status).toBeUndefined();
        expect(caught.statusCode).toBeUndefined();
    });
});
