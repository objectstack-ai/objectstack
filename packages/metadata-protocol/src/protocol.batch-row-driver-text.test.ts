// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8502] A batch row's `errors[].message` quotes a caught sentence only when
 * its producer declared a client-facing refusal.
 *
 * ## The premise, reproduced
 *
 * `toRowApiError` interpolated `err.message` unconditionally, so one row of a
 * `deleteManyData` against a failing store answered
 *
 * ```json
 * { "code": "INTERNAL_ERROR", "message": "SQLITE_ERROR: no such table: leave_request" }
 * ```
 *
 * riding a **200** as response DATA. The `code` half was already right (#8441
 * gates it on catalog membership, which is why `SQLITE_ERROR` had become
 * `INTERNAL_ERROR`); the message half had no gate at all. Fourth sink in the
 * family, after #8136's overlay delete, #8333's `failed[].error` and #8442's
 * seed `errors[].message`.
 *
 * ## Why this sink needed its OWN measurement, and got a different answer
 *
 * The question is #8136's — *did a producer author this sentence for a
 * caller?* — but the population that answers it is this sink's own. All three
 * catches sit under `engine.insert` / `update` / `delete`, so they receive
 * every refusal the DATA path raises, and driven on the real stack (a real
 * `ObjectQL` over a real `SqlDriver` on better-sqlite3, through all three
 * loops) that population declares itself in **three** spellings:
 *
 * | producer | code | `status` | `statusCode` | validation shape |
 * |---|---|---|---|---|
 * | `rowRequiredIdError` | VALIDATION_FAILED | **400** | — | no |
 * | `recordNotFoundError` | RECORD_NOT_FOUND | **404** | — | no |
 * | objectql `ValidationError` | VALIDATION_FAILED | — | — | **yes** |
 * | plugin-approvals' record lock | RECORD_LOCKED | — | **409** | no |
 * | an app hook throwing a bare `Error` | — | — | — | no |
 * | driver fault (`SqliteError`) | SQLITE_* | — | — | no |
 *
 * A `status`-only test (#8333's answer) admits the first two and blanks the
 * next two. #8442's answer — a 4xx `status` OR the `VALIDATION_FAILED` shape —
 * reaches the third and still blanks the fourth, because `plugin-approvals`
 * binds a GLOBAL `beforeUpdate` hook whose `lockedError` spells its refusal
 * `statusCode`. So neither sibling's answer transfers whole, and the rule here
 * asks the one question that covers all three: **would the boundary serving
 * this throw call it a client refusal?** — `resolveThrownHttpError`,
 * IMPORTED from `@objectstack/types` rather than re-spelled, which is the same
 * resolver `/api/v1/data` answers with. Reading only one status spelling is
 * how that door answered 500 to a deliberate `409 RECORD_LOCKED` until #7525;
 * a fourth local spelling here would re-create exactly that divergence one
 * layer down.
 *
 * ## What the doubles below are, and why they are trustworthy
 *
 * Every error shape here was MEASURED from its real producer on the real stack
 * (see the `MEASURED` note on each), never invented: metadata-protocol cannot
 * import `@objectstack/objectql` or `@objectstack/driver-sql` — objectql
 * depends on THIS package, so the import would close a cycle. Section 6 pins
 * each double's exact own-property set and runs the PRODUCTION recogniser over
 * it, so a double that drifted from the class it stands for turns this file
 * red rather than passing for the wrong reason. The populations that CAN be
 * driven for real are, in the two packages that may import both sides:
 * `packages/objectql/src/batch-row-authoring-feedback.test.ts` (the real
 * validator) and `packages/runtime/src/batch-row-driver-text-real-driver.
 * integration.test.ts` (the real driver).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch } from '@objectstack/metadata-core';
import { resolveThrownHttpError, validationFailureDetails } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'leave_request',
    fields: {
        title: { name: 'title', type: 'text' },
        progress: { name: 'progress', type: 'number' },
    },
};

/** The stable sentences the withhold produces — one per operation verb. */
const WITHHELD = {
    create: 'The create of this record failed. The reason is in the server log.',
    update: 'The update of this record failed. The reason is in the server log.',
    upsert: 'The upsert of this record failed. The reason is in the server log.',
    delete: 'The delete of this record failed. The reason is in the server log.',
};

// ─── The measured populations ────────────────────────────────────────────────

/**
 * MEASURED — a real `SqliteError` from better-sqlite3 through the real
 * `SqlDriver`, reaching `runDeleteManyLoop`'s catch: own properties
 * `[stack, message, code]`, `code: 'SQLITE_ERROR'`, `status` undefined.
 *
 * The message is the card's own example. The real one is worse and is pinned
 * in the runtime integration file: a delete's raw text carries the statement's
 * WHERE clause **and its bound id**.
 */
function driverFault(message = 'SQLITE_ERROR: no such table: leave_request'): Error {
    return Object.assign(new Error(message), { code: 'SQLITE_ERROR' });
}

/**
 * MEASURED — `@objectstack/objectql`'s `ValidationError` as it arrives at
 * these catches from `engine.insert` / `engine.update`: own properties
 * `[stack, message, code, name, fields]`, `code: 'VALIDATION_FAILED'`,
 * `name: 'ValidationError'`, and deliberately **no `status`** — per
 * `@objectstack/types`' `validation-failure.ts`, deciding it means 400 is
 * "the job of whichever boundary serves it".
 */
function engineValidationError(message: string, fields: unknown[]): Error {
    const err = new Error(message) as Error & { code: string; fields: unknown[] };
    // Assignment ORDER matches the real class, whose `readonly code` field
    // initialiser runs before the constructor body sets `name` then `fields`.
    // Section 5 asserts the own-key list in order, and it caught this exact
    // difference when the double was first written the other way round.
    err.code = 'VALIDATION_FAILED';
    err.name = 'ValidationError';
    err.fields = fields;
    return err;
}

/**
 * MEASURED — `plugin-approvals`' `lockedError`, raised inside the GLOBAL
 * `beforeUpdate` hook it binds (`lifecycle-hooks.ts`), driven through the real
 * hook against a real pending `sys_approval_request` row: own properties
 * `[stack, message, code, statusCode]`, `code: 'RECORD_LOCKED'`,
 * `statusCode: 409`, and `status` **undefined**.
 *
 * The spelling is the whole point of this entry — see the file header.
 */
function approvalsRecordLock(recordId: string): Error {
    const err = new Error(
        `RECORD_LOCKED: record '${recordId}' of 'leave_request' is locked while an approval is in progress`,
    ) as Error & { code: string; statusCode: number };
    err.code = 'RECORD_LOCKED';
    err.statusCode = 409;
    return err;
}

/** An app-authored hook that refuses without declaring anything. */
function undeclaredHookRefusal(): Error {
    return new Error('Approval is required before this task may be updated. Ask your manager first.');
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * The engine double every case drives. `throwOn` decides which row fails and
 * with what, so one harness serves all three loops and the response rows are
 * produced by the ACTUAL loops, builders and rollback classifier.
 */
function makeEngine(throwOn: (verb: string, id: unknown) => unknown | undefined) {
    const rows = new Map<string, any>([
        ['r1', { id: 'r1', title: 'one', progress: 0 }],
        ['r2', { id: 'r2', title: 'two', progress: 0 }],
        ['r3', { id: 'r3', title: 'three', progress: 0 }],
    ]);
    const handle = { id: 'trx-1' };

    const engine: any = {
        registry: { getObject: (n: string) => (n === 'leave_request' ? SCHEMA : undefined) },
        findOne: vi.fn(async (_o: string, opts?: any) => rows.get(opts?.where?.id) ?? null),
        insert: vi.fn(async (_o: string, data: any) => {
            const boom = throwOn('insert', data?.id);
            if (boom) throw boom;
            const rec = { id: data.id ?? `new-${rows.size + 1}`, ...data };
            rows.set(rec.id, rec);
            return rec;
        }),
        update: vi.fn(async (_o: string, data: any, opts?: any) => {
            const id = opts?.where?.id;
            const boom = throwOn('update', id);
            if (boom) throw boom;
            const next = { ...rows.get(id), ...data };
            rows.set(id, next);
            return next;
        }),
        delete: vi.fn(async (_o: string, opts?: any) => {
            assertEngineDeleteDispatch(opts);
            const id = opts?.where?.id;
            const boom = throwOn('delete', id);
            if (boom) throw boom;
            if (!rows.has(id)) return false;
            rows.delete(id);
            return { deleted: 1 };
        }),
        getDefaultDriverName: () => 'default',
        getDriverByName: () => ({ beginTransaction: async () => handle }),
        transaction: vi.fn(async (cb: (ctx: any) => Promise<any>, base?: any) => {
            const snapshot = new Map(rows);
            try {
                return await cb({ ...(base ?? {}), transaction: handle });
            } catch (err) {
                rows.clear();
                for (const [k, v] of snapshot) rows.set(k, v);
                throw err;
            }
        }),
    };
    return { engine, protocol: new ObjectStackProtocolImplementation(engine) as any, rows };
}

/** Silence — and capture — the operator-half warn the withhold writes. */
function captureWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

describe('[#8502] section 1 — the premise: an undeclared driver sentence never reaches a row', () => {
    it('deleteManyData answers the stable sentence, not the driver line', async () => {
        const warn = captureWarn();
        const { protocol } = makeEngine((verb) => (verb === 'delete' ? driverFault() : undefined));

        const res: any = await protocol.deleteManyData({ object: 'leave_request', ids: ['r1'] });

        expect(res.results[0]).toEqual({
            id: 'r1', success: false, index: 0,
            // `code` unchanged — #8441's limb, deliberately untouched here.
            errors: [{ code: 'INTERNAL_ERROR', message: WITHHELD.delete }],
        });
        // The whole payload, not just the tail: the leak the card measured was
        // one field, but `reconcileStoppedBatch` copies a row's message onto
        // its siblings, so a scan of the row alone can miss a live path.
        expect(JSON.stringify(res)).not.toContain('SQLITE_ERROR');
        expect(JSON.stringify(res)).not.toContain('leave_request. ');
        expect(JSON.stringify(res)).not.toContain('no such table');
        warn.mockRestore();
    });

    it('the bulk batchData loop and updateManyData answer the same way, each naming ITS verb', async () => {
        const warn = captureWarn();
        const a = makeEngine((verb) => (verb === 'insert' ? driverFault() : undefined));
        const createRes: any = await a.protocol.batchData({
            object: 'leave_request',
            request: { operation: 'create', records: [{ data: { title: 'x' } }] },
        });
        expect(createRes.results[0].errors[0].message).toBe(WITHHELD.create);

        const b = makeEngine((verb) => (verb === 'update' ? driverFault() : undefined));
        const updateRes: any = await b.protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });
        expect(updateRes.results[0].errors[0].message).toBe(WITHHELD.update);

        const c = makeEngine((verb) => (verb === 'update' ? driverFault() : undefined));
        const upsertRes: any = await c.protocol.batchData({
            object: 'leave_request',
            request: { operation: 'upsert', records: [{ id: 'r1', data: { progress: 1 } }] },
        });
        expect(upsertRes.results[0].errors[0].message).toBe(WITHHELD.upsert);

        for (const res of [createRes, updateRes, upsertRes]) {
            expect(JSON.stringify(res)).not.toContain('SQLITE_ERROR');
        }
        warn.mockRestore();
    });

    it('an EMPTY message no longer falls back to String(err) — the second leak path', async () => {
        // The old fallback was `String(err)`, which renders `Error: SQLITE…`.
        // Same shape as the second leak #8333 found at P13; closed by the same
        // change, since the withhold branch now owns the no-message case too.
        const warn = captureWarn();
        const bare = Object.assign(new Error(''), { code: 'SQLITE_ERROR' });
        Object.defineProperty(bare, 'toString', { value: () => 'Error: SQLITE_ERROR: no such table: leave_request' });
        const { protocol } = makeEngine((verb) => (verb === 'delete' ? bare : undefined));

        const res: any = await protocol.deleteManyData({ object: 'leave_request', ids: ['r1'] });

        expect(res.results[0].errors[0].message).toBe(WITHHELD.delete);
        expect(JSON.stringify(res)).not.toContain('SQLITE_ERROR');
        warn.mockRestore();
    });
});

describe('[#8502] section 2 — the authored population survives, in all THREE declarations', () => {
    it('a 4xx `status` is quoted verbatim (rowRequiredIdError, the REAL producer)', async () => {
        const { protocol } = makeEngine(() => undefined);
        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ data: { progress: 1 } }],
        });
        expect(res.results[0].errors[0]).toEqual({
            code: 'VALIDATION_FAILED', message: 'Record id is required for update', httpStatus: 400,
        });
    });

    it('a 4xx `status` is quoted verbatim (recordNotFoundError, the REAL producer)', async () => {
        const { protocol } = makeEngine(() => undefined);
        const res: any = await protocol.deleteManyData({ object: 'leave_request', ids: ['ghost'] });
        expect(res.results[0].errors[0]).toEqual({
            code: 'RECORD_NOT_FOUND', message: 'Record ghost not found in leave_request', httpStatus: 404,
        });
    });

    it('the VALIDATION_FAILED shape is quoted even though it carries NO status', async () => {
        // #8442's population, and the reason a status-only test would blank
        // exactly the per-field authoring feedback `errors[]` exists for.
        const boom = engineValidationError(
            'title must be ≤ 4 characters (got 15)',
            [{ field: 'title', code: 'too_long', message: 'title must be ≤ 4 characters (got 15)' }],
        );
        const { protocol } = makeEngine((verb) => (verb === 'update' ? boom : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { title: 'far too long' } }],
        });

        expect(res.results[0].errors[0].message).toBe('title must be ≤ 4 characters (got 15)');
        expect(res.results[0].errors[0].code).toBe('VALIDATION_FAILED');
        // NO `httpStatus`: the producer declared none, and #8502 does not mint
        // one — that would be an ADDITION to the wire, a separate decision.
        expect(res.results[0].errors[0].httpStatus).toBeUndefined();
    });

    it('a 4xx `statusCode` is quoted — THIS sink’s own population, met by neither sibling', async () => {
        const boom = approvalsRecordLock('r1');
        const { protocol } = makeEngine((verb) => (verb === 'update' ? boom : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        expect(res.results[0].errors[0].message).toBe(
            "RECORD_LOCKED: record 'r1' of 'leave_request' is locked while an approval is in progress",
        );
        expect(res.results[0].errors[0].code).toBe('RECORD_LOCKED');
    });

    it('an UNDECLARED hook refusal is withheld — the measured cost of a positive list', async () => {
        // Deliberate and pinned rather than regretted: at this sink an
        // undeclared hook throw is indistinguishable from an undeclared driver
        // throw, which is the whole hole. The remedy is at the producer and has
        // three accepted spellings (the three cases above).
        const warn = captureWarn();
        const { protocol } = makeEngine((verb) => (verb === 'update' ? undeclaredHookRefusal() : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        expect(res.results[0].errors[0].message).toBe(WITHHELD.update);
        expect(JSON.stringify(res)).not.toContain('Approval is required');
        warn.mockRestore();
    });
});

describe('[#8502] section 3 — the leak does not survive in the collateral rows either', () => {
    it('NOT_ATTEMPTED quotes the causal row, so it quotes the WITHHELD sentence', async () => {
        const warn = captureWarn();
        const { protocol } = makeEngine((verb, id) => (verb === 'delete' && id === 'r2' ? driverFault() : undefined));

        const res: any = await protocol.deleteManyData({ object: 'leave_request', ids: ['r1', 'r2', 'r3'] });

        expect(res.results[1].errors[0].message).toBe(WITHHELD.delete);
        expect(res.results[2].errors[0].code).toBe('NOT_ATTEMPTED');
        expect(res.results[2].errors[0].message).toContain(WITHHELD.delete);
        expect(JSON.stringify(res)).not.toContain('SQLITE_ERROR');
        warn.mockRestore();
    });

    it('ROLLED_BACK quotes the causal row, so it quotes the WITHHELD sentence', async () => {
        const warn = captureWarn();
        const { protocol } = makeEngine((verb, id) => (verb === 'update' && id === 'r2' ? driverFault() : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request',
            records: [{ id: 'r1', data: { progress: 1 } }, { id: 'r2', data: { progress: 2 } }],
            options: { atomic: true },
        });

        expect(res.results[0].errors[0].code).toBe('ROLLED_BACK');
        expect(res.results[0].errors[0].message).toContain(WITHHELD.update);
        expect(JSON.stringify(res)).not.toContain('SQLITE_ERROR');
        warn.mockRestore();
    });
});

describe('[#8502] section 4 — the operator half: withheld, not discarded', () => {
    it('the withheld sentence reaches console.warn, marked as withheld, with the original error', async () => {
        const warn = captureWarn();
        const boom = driverFault();
        const { protocol } = makeEngine((verb) => (verb === 'delete' ? boom : undefined));

        await protocol.deleteManyData({ object: 'leave_request', ids: ['r1'] });

        expect(warn).toHaveBeenCalledTimes(1);
        const [line, cause] = warn.mock.calls[0];
        expect(line).toContain('#8502');
        expect(line).toContain('withheld from the response');
        // The ORIGINAL error object, not a re-spelling of it, so a log reader
        // gets the stack too.
        expect(cause).toBe(boom);
        warn.mockRestore();
    });

    it('a QUOTED row writes no withhold warning at all', async () => {
        const warn = captureWarn();
        const { protocol } = makeEngine(() => undefined);
        await protocol.deleteManyData({ object: 'leave_request', ids: ['ghost'] });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });
});

describe('[#8502] section 5 — anti-vacuity: the doubles are the shapes they claim to be', () => {
    it('each double carries EXACTLY the own properties measured on its real producer', () => {
        expect(Object.getOwnPropertyNames(driverFault())).toEqual(['stack', 'message', 'code']);
        expect(Object.getOwnPropertyNames(engineValidationError('m', []))).toEqual(
            ['stack', 'message', 'code', 'name', 'fields'],
        );
        expect(Object.getOwnPropertyNames(approvalsRecordLock('r1'))).toEqual(
            ['stack', 'message', 'code', 'statusCode'],
        );
        expect(Object.getOwnPropertyNames(undeclaredHookRefusal())).toEqual(['stack', 'message']);
    });

    it('none of the withheld population declares a `status`, and the driver fault is not validation-shaped', () => {
        for (const e of [driverFault(), engineValidationError('m', []), approvalsRecordLock('r1'), undeclaredHookRefusal()]) {
            expect((e as any).status).toBeUndefined();
        }
        expect(validationFailureDetails(driverFault())).toBeUndefined();
        expect(validationFailureDetails(approvalsRecordLock('r1'))).toBeUndefined();
        expect(validationFailureDetails(engineValidationError('m', []))).toBeDefined();
    });

    it('the PRODUCTION recogniser classifies each double the way the real stack measured it', () => {
        // Not the test's own predicate — the very function `toRowApiError` now
        // calls, so a double that drifted from its class cannot pass here.
        expect(resolveThrownHttpError(driverFault(), 500).status).toBe(500);
        expect(resolveThrownHttpError(undeclaredHookRefusal(), 500).status).toBe(500);
        expect(resolveThrownHttpError(engineValidationError('m', []), 500).status).toBe(400);
        expect(resolveThrownHttpError(approvalsRecordLock('r1'), 500).status).toBe(409);
    });

    it('the withheld sentence interpolates NOTHING — it cannot carry a leak by construction', () => {
        const secret = 'no such table: leave_request';
        for (const message of Object.values(WITHHELD)) {
            expect(message).not.toContain(secret);
            expect(message).not.toContain('${');
        }
        // Four verbs, four distinct sentences: a row says which operation it
        // was doing, which is the whole information budget a withheld row has.
        expect(new Set(Object.values(WITHHELD)).size).toBe(4);
    });
});
