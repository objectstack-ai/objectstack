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
import { inspect } from 'node:util';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SqlDriver } from '@objectstack/driver-sql';
import {
  captureExpectedReadRefusals,
  type ExpectedReadRefusalCapture,
} from './expected-read-refusal-noise.js';
import { provisionRawForeignKey } from './raw-foreign-key-fixture.js';
import { validationFailureDetails, resolveThrownHttpError } from '@objectstack/types';

const PARENT = { name: 'bd_parent', fields: { name: { type: 'text' } } };
const CHILD = {
    name: 'bd_child',
    fields: {
        name: { type: 'text' },
        // ⚠️ Deliberately NOT declared as a lookup — see
        // `raw-foreign-key-fixture.ts`. A canonical `reference` would let the
        // ENGINE see the relationship and apply `deleteBehavior` on delete,
        // clearing the child BEFORE the parent delete ever reaches the
        // database — which dissolves the raw driver fault this suite exists to
        // withhold. The column still carries a real FOREIGN KEY (raw DDL); what
        // it must not carry is a relationship the engine will resolve for it.
        parent: { type: 'text' },
    },
};
const NOTE = {
    name: 'bd_note',
    fields: {
        body: { type: 'text' },
        email: { type: 'text', unique: true },
    },
};

/**
 * [#10629] This fixture provisions its own business objects and nothing else,
 * so the engine's single-tenant probe (`ObjectQL.probeInstallOrganizations`,
 * memoised once per engine) reads a `sys_organization` that was never created.
 * The probe is fail-soft by construction — it catches `isMissingTableError` and
 * only that — but the driver and the engine each log the fault on the way out.
 * Withheld and asserted rather than muted; `expected-read-refusal-noise.ts`
 * says why.
 */
const ABSENT_TENANCY_TABLE = 'sys_organization';

/**
 * [#14403] The first bytes of the batch-row sink's OWN log line
 * (`clientFacingRowFailureText`, `metadata-protocol/src/protocol.ts`). A
 * literal rather than an import: the sink keeps that function private on
 * purpose, and what this suite pins is the line an OPERATOR reads, which is
 * the string itself.
 */
const SINK_WITHHOLD_PREFIX = "[Protocol] Withheld a caught error's text from a batch row";

describe('[#8502] a REAL driver fault is withheld from every batch row', () => {
    /** [#10629] The expected-noise capture belonging to the latest rig. */
    let noise: ExpectedReadRefusalCapture | null = null;
    let dir: string | null = null;
    let engine: ObjectQL | null = null;
    /** [#14403] Undoes the latest rig's `console.warn` recorder. */
    let restoreWarn: (() => void) | null = null;

    afterEach(async () => {
        // [#14403] First, so a throw below can never leave `console.warn` patched.
        restoreWarn?.();
        restoreWarn = null;
        try { await engine?.destroy(); } catch { /* noop */ }
        engine = null;
        if (dir) { rmSync(dir, { recursive: true, force: true }); dir = null; }
        // [#10629] The capture is a PIN, not a mute — asserted after teardown so
        // a failure here can never leave the engine running. Every test in this
        // file rigs and writes, so the probe fires for each of them: this holds
        // for a single `-t` run as well as for the whole file.
        expect(noise?.silentChannels() ?? ['no capture was installed']).toEqual([]);
        noise = null;
    });

    async function rig() {
        dir = mkdtempSync(join(tmpdir(), 'os-8502-real-'));
        const real = new SqlDriver({
            client: 'better-sqlite3',
            connection: { filename: join(dir, 'data.sqlite') },
            useNullAsDefault: true,
        });
        // [#10629] Installed on the REAL driver (the one that logs) before it
        // runs a statement — the `Object.create(real)` wrapper below resolves
        // `logger` through the prototype chain to this sink.
        noise = captureExpectedReadRefusals([ABSENT_TENANCY_TABLE]);
        noise.captureDriver(real);
        // [#11567] The FK this suite's raw-fault vehicle depends on is built
        // with RAW DDL, because the driver no longer emits one: `reference_to`
        // (a key `FieldSchema` refuses) used to gate `createColumn`'s FK
        // emission, and that branch is retired. The lookup below is now spelled
        // the canonical way and contributes NO constraint — see
        // `raw-foreign-key-fixture.ts` for why the vehicle was kept rather than
        // dropped along with the key.
        await provisionRawForeignKey(real, 'bd_parent', 'bd_child', 'parent');
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
        noise.captureEngine(engine);
        engine.registerDriver(driver, true);
        await engine.init();
        for (const o of [PARENT, CHILD, NOTE]) {
            engine.registry.registerObject(o as any, 'com.objectstack.test.8502');
        }
        const protocol: any = new ObjectStackProtocolImplementation(engine as any);

        // [#14403] Record the sink's own withhold line so BOTH directions of
        // its decision can be asserted: it must log exactly when it withheld.
        // ⛔ Recorded, never muted — every call is forwarded to the real
        // `console.warn`, so what a shard log shows is unchanged by this
        // suite. The recorder wraps whatever `console.warn` is current, so it
        // composes with the driver-channel pass-through above rather than
        // replacing it.
        const sinkWarnings: string[] = [];
        const outerWarn = console.warn;
        restoreWarn = () => { console.warn = outerWarn; };
        console.warn = (...args: unknown[]) => {
            if (typeof args[0] === 'string' && args[0].startsWith(SINK_WITHHOLD_PREFIX)) {
                sinkWarnings.push(args.map((a) => (typeof a === 'string' ? a : inspect(a))).join(' '));
            }
            (outerWarn as (...a: unknown[]) => void)(...args);
        };

        return { protocol, real, rawOf: () => raw, sinkWarnings };
    }

    it('deleteManyData leaks neither the DELETE statement nor the bound id it names', async () => {
        const { protocol, real, rawOf, sinkWarnings } = await rig();
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

        // ── [#14403] The sink's OPERATOR half, direction one: it withheld,
        // so it LOGGED — and the line carries the driver's own sentence whole.
        // That is what keeps withholding distinguishable from DELETING the
        // diagnostic, which is the failure this file's sink was built against.
        //
        // It is also the live control for the disclosed row in the next test,
        // where the same recorder on the same rig must see nothing: without
        // this assertion a green zero over there could mean the recorder was
        // never wired rather than that the sink stayed silent.
        expect(sinkWarnings).toHaveLength(1);
        expect(sinkWarnings[0]).toContain('cause (withheld from the response)');
        expect(sinkWarnings[0]).toContain('FOREIGN KEY constraint failed');

        // Non-vacuity on the other side: the row is still there, so the
        // failure was real rather than a swallowed success.
        expect(await engine!.findOne('bd_parent', { where: { id: 'p1' } })).toBeTruthy();
        // The response's own accounting agrees the row failed.
        expect(res).toMatchObject({ success: false, total: 1, succeeded: 0, failed: 1 });
        void real;
    });

    it('batchData create leaks neither the INSERT statement nor the values it carries', async () => {
        const { protocol, rawOf, sinkWarnings } = await rig();
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

        // ── The row's SENTENCE moved populations (#14095) ──────────────────
        // ⚠️ RETRIAGED, not re-baselined. `clientFacingRowFailureText` is a
        // POSITIVE list: it quotes a caught sentence exactly when the producer
        // DECLARES a client refusal (a 4xx status/statusCode, or the
        // VALIDATION_FAILED shape) and withholds it otherwise. Nothing about
        // that rule moved. What moved is which side of it THIS error is on:
        // since #14095 the insert door answers a driver unique violation with
        // the ADR-0112 envelope `DUPLICATE_RECORD` / `status: 409`, so the row
        // is now a DECLARED refusal and the sink quotes it — which is the
        // remedy this file's own sink documents ("declaring is cheaper than
        // the workaround"), taken by the producer.
        //
        // The withheld population is NOT vacated: the `deleteManyData` case
        // above is the live control. Its FK fault declares no status, still
        // takes the withheld branch, and still says the generic sentence — so
        // a regression that stopped withholding UNDECLARED faults reddens
        // here, in this same file, on the very next test.
        expect(res.results[0].errors[0].message).toBe(
            "Duplicate record refused on 'bd_note': a unique constraint on 'email' already holds this value. "
            + 'No record was written.',
        );
        // The row now carries the machine-readable half too, which is what an
        // idempotent batch writer branches on — it was `INTERNAL_ERROR` with no
        // status while the sentence was withheld.
        expect(res.results[0].errors[0].code).toBe('DUPLICATE_RECORD');
        expect(res.results[0].errors[0].httpStatus).toBe(409);

        // ── …and NOT ONE leak assertion moved ──────────────────────────────
        // These are what this file exists for, and they hold against the new
        // sentence for the reason the envelope was built that way: the
        // platform sentence carries no statement, no bound value and no
        // dialect text — the driver's error is preserved WHOLE on `cause`,
        // which never reaches response data.
        expect(payload).not.toContain('insert into');
        expect(payload).not.toContain('dup@example.com');
        expect(payload).not.toContain('UNIQUE constraint failed');
        expect(payload).not.toContain('SQLITE_CONSTRAINT');

        // ── [#14403] The OPERATOR half — re-measured, and now a PIN ────────
        // What stood here called this a KNOWN RESIDUAL and deliberately
        // asserted nothing, on the reading that the driver's own sentence
        // "reaches neither the response nor the console". Re-measured on this
        // exact rig, one half of that holds and the other does not — so it is
        // pinned instead of left as prose that can drift:
        //
        //   * TRUE — the sink returns before its `console.warn`, so its own
        //     line fires ZERO times for this row. That is CORRECT rather than
        //     a loss: the line exists to record a WITHHOLD, and nothing was
        //     withheld. The caller received the producer's authored sentence.
        //   * FALSE — "nor the console". The driver's sentence does reach an
        //     operator one layer down, on the engine's insert door:
        //     `ERROR Insert operation failed {"object":"bd_note","error":
        //     {"message":"UNIQUE constraint failed: bd_note.email …"}}`.
        //     That line takes the envelope's `cause` on purpose (#14095 /
        //     #14390, `e instanceof DuplicateRecordError ? e.cause : e`,
        //     because the platform logger serializes only `message` and
        //     `stack`) and is pinned in objectql's
        //     `driver-fault-redaction.test.ts`, which asserts the failing
        //     column survives in it. The diagnostic moved one hop; it was
        //     never deleted.
        //
        // ⇒ There is nothing to repair in `metadata-protocol/src/protocol.ts`,
        // and adding a second log line to its disclosed branch would be wrong
        // twice over: it would restate what the engine already logged, once
        // per duplicate row of a batch, at a site where the failure was handed
        // to the CALLER — which AGENTS.md's degradation rule names as not a
        // degradation at all.
        //
        // So what is pinned is the sink's decision/log COHERENCE, in both
        // directions on one rig: it logs when it withholds (the
        // `deleteManyData` case above, same recorder) and is silent when it
        // discloses (here). A regression that started withholding this row
        // again reddens both at once — the sentence assertions up top, and
        // this zero.
        expect(sinkWarnings).toEqual([]);
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
