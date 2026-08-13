// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8502] The batch-row withhold, proven on a REAL driver — and the
 * measurement that says what this card was actually disclosing.
 *
 * ## The card understated the leak, exactly as #8442's did
 *
 * The issue quotes a tidy `SQLITE_ERROR: no such table: leave_request`, which
 * reads like a schema-shape disclosure. Driven for real — `SqlDriver` on
 * better-sqlite3 on disk, a real `ObjectQL`, the real
 * `ObjectStackProtocolImplementation` — a delete's raw driver text is the
 * whole failing statement:
 *
 * ```
 * SqliteError  code: 'SQLITE_CONSTRAINT_FOREIGNKEY'  status: undefined
 * message: delete from `bd_parent` where `id` = 'p1' - FOREIGN KEY constraint failed
 * ```
 *
 * So the leaked text carries the **WHERE clause and its bound value** — which
 * row, by id, in which table. On the insert side of the same batch surface it
 * is worse still and matches what #8442 measured on the seed path: the full
 * INSERT with every seeded VALUE. This is row data, not just schema shape, and
 * it rides `errors[].message` on a **200** where no boundary withhold reaches
 * it.
 *
 * ## What is asserted, and why over the whole payload
 *
 * `reconcileStoppedBatch` and `buildRolledBackBatchResponse` copy the causal
 * row's message onto its `NOT_ATTEMPTED` / `ROLLED_BACK` siblings, so one
 * leaked sentence is repeated across the batch. A scan of the failing row
 * alone can therefore be green while the payload still carries the text —
 * every assertion below is taken over `JSON.stringify(res)`.
 *
 * Non-vacuity is asserted alongside: that the driver really rejected the
 * operation (the row is a failure, and the store is unchanged), and that the
 * error really is NOT validation-shaped — otherwise the withhold could be
 * green because the quoting limb was never reachable for this population.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { validationFailureDetails, resolveThrownHttpError } from '@objectstack/types';

const PARENT = { name: 'bd_parent', fields: { name: { type: 'text' } } };
const CHILD = {
    name: 'bd_child',
    fields: {
        name: { type: 'text' },
        parent: { type: 'lookup', reference_to: 'bd_parent' },
    },
};
const NOTE = {
    name: 'bd_note',
    fields: {
        body: { type: 'text' },
        email: { type: 'text', unique: true },
    },
};

describe('[#8502] a REAL driver fault is withheld from every batch row', () => {
    let dir: string | null = null;
    let engine: ObjectQL | null = null;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    });

    async function rig() {
        dir = mkdtempSync(join(tmpdir(), 'os-8502-real-'));
        const real = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.sqlite') },
            useNullAsDefault: true,
        });
        await real.initObjects([PARENT, CHILD, NOTE]);

        // Capture the RAW driver error at the seam and let it propagate
        // untouched, so the test asserts on what the driver really threw
        // rather than on an assumption about it.
        let raw: any = null;
        const driver: any = Object.create(real);
        for (const m of ['create', 'update', 'delete', 'bulkCreate'] as const) {
            driver[m] = async (...args: any[]) => {
                try { return await (real as any)[m](...args); } catch (e) { raw ??= e; throw e; }
            };
        }

        engine = new ObjectQL();
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [PARENT, CHILD, NOTE]) {
            engine.registry.registerObject(o as any, 'com.objectstack.test.8502');
        }
        const protocol: any = new ObjectStackProtocolImplementation(engine as any);
        return { protocol, real, rawOf: () => raw };
    }

    it('deleteManyData leaks neither the DELETE statement nor the bound id it names', async () => {
        const { protocol, real, rawOf } = await rig();
        await engine!.insert('bd_parent', { id: 'p1', name: 'kept' });
        await engine!.insert('bd_child', { id: 'c1', name: 'dependent', parent: 'p1' });

        const res: any = await protocol.deleteManyData({ object: 'bd_parent', ids: ['p1'] });

        // The driver really refused, and it refused as a DRIVER: not
        // validation-shaped, no declared status. Without this the withhold
        // could be green because the quoting limb was never reachable.
        const raw = rawOf();
        expect(raw).not.toBeNull();
        expect(raw.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
        expect(raw.status).toBeUndefined();
        expect(raw.statusCode).toBeUndefined();
        expect(validationFailureDetails(raw)).toBeUndefined();
        expect(resolveThrownHttpError(raw, 500).status).toBe(500);
        // What the raw text actually contains — the measurement this file
        // exists for. Asserted so a driver upgrade that stops interpolating
        // the statement makes this claim fail loudly instead of silently.
        expect(raw.message).toContain('delete from');
        expect(raw.message).toContain("'p1'");

        // …and none of it reaches the caller.
        const payload = JSON.stringify(res);
        expect(res.results[0].success).toBe(false);
        expect(res.results[0].errors[0].message).toBe('The delete of this record failed. The reason is in the server log.');
        expect(payload).not.toContain('delete from');
        expect(payload).not.toContain('FOREIGN KEY');
        expect(payload).not.toContain('SQLITE');
        expect(payload).not.toContain('bd_child');

        // Non-vacuity on the other side: the row is still there, so the
        // failure was real rather than a swallowed success.
        expect(await engine!.findOne('bd_parent', { where: { id: 'p1' } } as any)).toBeTruthy();
        // The response's own accounting agrees the row failed.
        expect(res).toMatchObject({ success: false, total: 1, succeeded: 0, failed: 1 });
        void real;
    });

    it('batchData create leaks neither the INSERT statement nor the values it carries', async () => {
        const { protocol, rawOf } = await rig();
        await engine!.insert('bd_note', { id: 'n1', body: 'first', email: 'dup@example.com' });

        const res: any = await protocol.batchData({
            object: 'bd_note',
            request: {
                operation: 'create',
                records: [{ data: { body: 'second', email: 'dup@example.com' } }],
            },
        });

        const raw = rawOf();
        expect(raw.code).toBe('SQLITE_CONSTRAINT_UNIQUE');
        expect(validationFailureDetails(raw)).toBeUndefined();
        // The raw text carries the statement AND the submitted values.
        expect(raw.message).toContain('insert into');
        expect(raw.message).toContain('dup@example.com');

        const payload = JSON.stringify(res);
        expect(res.results[0].errors[0].message).toBe('The create of this record failed. The reason is in the server log.');
        expect(payload).not.toContain('insert into');
        expect(payload).not.toContain('dup@example.com');
        expect(payload).not.toContain('UNIQUE constraint failed');
    });

    it('a stopped batch does not re-publish the withheld text through its NOT_ATTEMPTED rows', async () => {
        const { protocol } = await rig();
        await engine!.insert('bd_parent', { id: 'p1', name: 'kept' });
        await engine!.insert('bd_parent', { id: 'p2', name: 'also kept' });
        await engine!.insert('bd_child', { id: 'c1', name: 'dependent', parent: 'p1' });

        const res: any = await protocol.deleteManyData({ object: 'bd_parent', ids: ['p1', 'p2'] });

        // Row 0 failed (FK), row 1 was never attempted and quotes row 0.
        expect(res.results[0].success).toBe(false);
        expect(res.results[1].errors[0].code).toBe('NOT_ATTEMPTED');
        expect(res.results[1].errors[0].message).toContain('The delete of this record failed');
        expect(JSON.stringify(res)).not.toContain('FOREIGN KEY');
        expect(JSON.stringify(res)).not.toContain('delete from');
    });
});
