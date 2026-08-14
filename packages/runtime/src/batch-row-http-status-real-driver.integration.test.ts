// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8570] A batch row's `httpStatus`, measured on the REAL stack — a real
 * `ObjectQL` over a real `SqlDriver` on better-sqlite3, through the real
 * `ObjectStackProtocolImplementation`'s bulk-write loops.
 *
 * ## What this file is for
 *
 * The card's first row was measured here, not argued:
 *
 * ```json
 * { "code": "VALIDATION_FAILED", "message": "name must be ≤ 4 characters (got 15)" }
 * ```
 *
 * — a well-defined 400 shipping with no status at all, beside siblings in the
 * SAME response that carried one, because the limb read `err.status` and
 * objectql's `ValidationError` deliberately declares none (deciding it means
 * 400 is "the job of whichever boundary serves it", per `@objectstack/types`'
 * `validation-failure.ts`). Nothing below builds that error: a real record is
 * malformed against a real schema and the engine's own validator rejects it.
 *
 * ## Both directions, on the real stack
 *
 * The fix delegates to `resolveThrownHttpError`, which answers for EVERY
 * throw — including the ones that are not refusals at all. So the driver-fault
 * case is here too, and it is the half that fails if the limb ever stamps the
 * resolver's `status` (500, the fallback) instead of its `declaredStatus`:
 * a `SqliteError` must keep carrying NO status, exactly as before this card.
 * A file that only asserted the newly-populated row would be green either way.
 *
 * The card's second row — `plugin-approvals`' `RECORD_LOCKED`, spelled
 * `statusCode: 409` — is driven through the REAL lock hook in
 * `packages/plugins/plugin-approvals/src/record-lock-batch-row-status.integration.test.ts`,
 * which is where both halves of that producer can be imported.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import { resolveThrownHttpError, validationFailureDetails } from '@objectstack/types';

/** `maxLength` is what the real record validator rejects against. */
const TASK = {
    name: 'hs_task',
    fields: {
        name: { type: 'text', maxLength: 4 },
        progress: { type: 'number' },
    },
};
const PARENT = { name: 'hs_parent', fields: { name: { type: 'text' } } };
const CHILD = {
    name: 'hs_child',
    fields: {
        name: { type: 'text' },
        parent: { type: 'lookup', reference_to: 'hs_parent' },
    },
};

describe('[#8570] a batch row carries the status its producer DECLARED — real driver', () => {
    let dir: string | null = null;
    let engine: ObjectQL | null = null;

    afterEach(async () => {
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
    });

    async function rig() {
        dir = mkdtempSync(join(tmpdir(), 'os-8570-real-'));
        const real = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.sqlite') },
            useNullAsDefault: true,
        });
        await real.initObjects([TASK, PARENT, CHILD]);

        // Capture the RAW error at the seam and let it propagate untouched, so
        // the assertions below are about what the producer really threw rather
        // than about an assumption about it.
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
        for (const o of [TASK, PARENT, CHILD]) {
            engine.registry.registerObject(o as any, 'com.objectstack.test.8570');
        }
        const protocol: any = new ObjectStackProtocolImplementation(engine as any);
        return { protocol, rawOf: () => raw };
    }

    it('the REAL validator: the card\'s first row, verbatim, now carrying 400', async () => {
        const { protocol } = await rig();
        await engine!.insert('hs_task', { id: 'ok1', name: 'ok', progress: 0 });

        // 15 characters against `maxLength: 4` — the card's own row.
        const TOO_LONG = 'fifteen chars!!';
        expect(TOO_LONG).toHaveLength(15);

        const res: any = await protocol.updateManyData({
            object: 'hs_task',
            records: [{ id: 'ok1', data: { name: TOO_LONG } }],
        });

        const error = res.results[0].errors[0];
        expect(res.results[0].success).toBe(false);
        // The card's measured row, plus the limb it was missing.
        expect(error).toEqual({
            code: 'VALIDATION_FAILED',
            message: 'name must be ≤ 4 characters (got 15)',
            httpStatus: 400,
        });

        // Non-vacuity on the PRODUCER: this row gains a status only because
        // the fix reads the declaration the shape carries — the thrown error
        // really does spell no status in either channel, so a limb reading
        // `err.status` (or `err.statusCode`) still answers nothing for it.
        let thrown: any = null;
        try {
            await engine!.update('hs_task', { name: TOO_LONG }, { where: { id: 'ok1' } } as any);
        } catch (e) { thrown = e; }
        expect(thrown).not.toBeNull();
        expect(thrown.name).toBe('ValidationError');
        expect(thrown.code).toBe('VALIDATION_FAILED');
        expect(thrown.status).toBeUndefined();
        expect(thrown.statusCode).toBeUndefined();
        expect(validationFailureDetails(thrown)).toBeDefined();
        expect(resolveThrownHttpError(thrown).declaredStatus).toBe(400);

        // …and the record is unchanged, so the refusal was a refusal.
        expect((await engine!.findOne('hs_task', { where: { id: 'ok1' } }))?.name).toBe('ok');
    });

    it('the same row in a MIXED batch — the asymmetry the card measured is gone', async () => {
        // The complaint was not "no row has a status", it was "some rows in one
        // response do and others do not, with nothing saying which". So the two
        // populations are driven into ONE response here.
        const { protocol } = await rig();
        await engine!.insert('hs_task', { id: 'ok1', name: 'ok', progress: 0 });

        const res: any = await protocol.updateManyData({
            object: 'hs_task',
            records: [
                { data: { progress: 1 } },                          // no id → rowRequiredIdError (400)
                { id: 'ok1', data: { name: 'fifteen chars!!' } },    // real ValidationError
            ],
            options: { continueOnError: true },
        });

        expect(res.results[0].errors[0]).toEqual({
            code: 'VALIDATION_FAILED', message: 'Record id is required for update', httpStatus: 400,
        });
        expect(res.results[1].errors[0].code).toBe('VALIDATION_FAILED');
        expect(res.results[1].errors[0].httpStatus).toBe(400);
    });

    it('a REAL driver fault still carries NO status — the over-broad direction', async () => {
        // `resolveThrownHttpError(raw).status` is 500 here, and 500 is what an
        // unconditional stamp would put on this row. It never carried one and
        // must not start: that is an addition to the wire for a population that
        // declared nothing, which is not what this card does.
        const { protocol, rawOf } = await rig();
        await engine!.insert('hs_parent', { id: 'p1', name: 'kept' });
        await engine!.insert('hs_child', { id: 'c1', name: 'dependent', parent: 'p1' });

        const res: any = await protocol.deleteManyData({ object: 'hs_parent', ids: ['p1'] });

        const raw = rawOf();
        expect(raw).not.toBeNull();
        expect(raw.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
        expect(raw.status).toBeUndefined();
        expect(raw.statusCode).toBeUndefined();
        // The production recogniser, on the real throw: a 500 that nobody
        // declared. Both halves asserted, because the whole fix is the gap
        // between them.
        expect(resolveThrownHttpError(raw).status).toBe(500);
        expect(resolveThrownHttpError(raw).declaredStatus).toBeUndefined();

        const error = res.results[0].errors[0];
        expect(res.results[0].success).toBe(false);
        expect(Object.prototype.hasOwnProperty.call(error, 'httpStatus')).toBe(false);
        // Nowhere in the payload either — `reconcileStoppedBatch` copies the
        // causal row's text onto its siblings, so a row-only scan can miss a
        // live path.
        expect(JSON.stringify(res)).not.toContain('httpStatus');
    });

    it('a not-found row still answers 404 — the population that already worked', async () => {
        const { protocol } = await rig();
        const res: any = await protocol.deleteManyData({ object: 'hs_task', ids: ['ghost'] });
        expect(res.results[0].errors[0]).toEqual({
            code: 'RECORD_NOT_FOUND', message: 'Record ghost not found in hs_task', httpStatus: 404,
        });
    });
});
