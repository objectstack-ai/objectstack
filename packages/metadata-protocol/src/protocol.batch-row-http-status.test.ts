// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8570] A batch row's `errors[].httpStatus` carries the status its producer
 * DECLARED — in any of the three spellings — and nothing where none was
 * declared.
 *
 * ## The premise, reproduced
 *
 * `toRowApiError` set the limb from `err.status` alone. Measured on the real
 * stack (a real `ObjectQL` over a real `SqlDriver`, through all three
 * bulk-write loops), two producers that reach these catches declare a genuine
 * client refusal without that spelling, and shipped rows with no status at all:
 *
 * ```json
 * { "code": "VALIDATION_FAILED", "message": "name must be ≤ 4 characters (got 15)" }
 * { "code": "RECORD_LOCKED", "message": "RECORD_LOCKED: record 'ok1' of 'm8502_task' is locked while an approval is in progress" }
 * ```
 *
 * — while their siblings in the same response carried one (`rowRequiredIdError`
 * → 400, `recordNotFoundError` → 404). A caller branching on `httpStatus` to
 * tell "fix your input" from "the server broke" got an answer for some failure
 * rows and silence for others, with nothing saying which. That is #7525's
 * single-spelling defect, one layer below the door where it was fixed.
 *
 * ## The two directions this file has to separate
 *
 * The rule delegates to `resolveThrownHttpError` (`@objectstack/types`) —
 * IMPORTED, the same resolver the `message` limb beside it uses (#8502) and the
 * one `/api/v1/data` answers with. But that resolver answers for **every**
 * throw, and for an undeclared one its `status` is the caller's fallback, 500.
 * So there are two distinct failures to pin apart:
 *
 *   (a) **under-broad** — the limb reads one spelling again, and the two
 *       populations above lose their status (§1);
 *   (b) **over-broad** — the limb stamps `status` instead of `declaredStatus`,
 *       and every undeclared driver fault and bare hook `Error` GAINS
 *       `httpStatus: 500` on a row that never carried one (§3). That is an
 *       addition to the wire for those populations, which is the scope this
 *       card does not have.
 *
 * A pin that only asserts the new rows would be green in direction (b). §3 is
 * the half that is not optional.
 *
 * ## The doubles
 *
 * Same provenance rule as the sibling file: `metadata-protocol` cannot import
 * `@objectstack/objectql` or `@objectstack/driver-sql` (objectql depends on
 * THIS package, so the import closes a cycle), so each shape below was measured
 * on its real producer and is re-checked here — §6 pins the own-property set
 * and runs the PRODUCTION recogniser over each double. The populations that CAN
 * be driven for real are, and both rows above are reproduced end to end in
 * `packages/plugins/plugin-approvals/src/record-lock-batch-row-status.integration.test.ts`
 * (the real lock hook, a real engine, a real sqlite driver) and
 * `packages/objectql/src/batch-row-authoring-feedback.test.ts` (the real
 * validator).
 */

import { describe, it, expect, vi } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch } from '@objectstack/metadata-core';
import { resolveThrownHttpError } from '@objectstack/types';
import { ObjectStackProtocolImplementation } from './protocol.js';

const SCHEMA = {
    name: 'leave_request',
    fields: {
        title: { name: 'title', type: 'text' },
        progress: { name: 'progress', type: 'number' },
    },
};

/** The stable sentences the #8502 withhold produces — one per operation verb. */
const WITHHELD = {
    create: 'The create of this record failed. The reason is in the server log.',
    update: 'The update of this record failed. The reason is in the server log.',
    upsert: 'The upsert of this record failed. The reason is in the server log.',
    delete: 'The delete of this record failed. The reason is in the server log.',
};

// ─── The measured populations ────────────────────────────────────────────────

/**
 * MEASURED — a real `SqliteError` from better-sqlite3 through the real
 * `SqlDriver`: own properties `[stack, message, code]`, `code: 'SQLITE_ERROR'`,
 * and no status in any spelling.
 */
function driverFault(message = 'SQLITE_ERROR: no such table: leave_request'): Error {
    return Object.assign(new Error(message), { code: 'SQLITE_ERROR' });
}

/**
 * MEASURED — `@objectstack/objectql`'s `ValidationError` as it reaches these
 * catches: own properties `[stack, message, code, name, fields]`,
 * `code: 'VALIDATION_FAILED'`, `name: 'ValidationError'`, and deliberately NO
 * `status` (per `@objectstack/types`' `validation-failure.ts`, deciding it
 * means 400 is "the job of whichever boundary serves it"). Assignment ORDER
 * matches the real class, whose `readonly code` initialiser runs before the
 * constructor body sets `name` then `fields`.
 */
function engineValidationError(message: string, fields: unknown[]): Error {
    const err = new Error(message) as Error & { code: string; fields: unknown[] };
    err.code = 'VALIDATION_FAILED';
    err.name = 'ValidationError';
    err.fields = fields;
    return err;
}

/**
 * MEASURED — `plugin-approvals`' `lockedError`, raised inside the GLOBAL
 * `beforeUpdate` hook it binds: own properties `[stack, message, code,
 * statusCode]`, `code: 'RECORD_LOCKED'`, `statusCode: 409`, `status`
 * undefined. The spelling is this card's whole point.
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

/**
 * A refusal that declares a 5xx in the `statusCode` spelling — the edge the
 * rule's gate is deliberately NOT the 4xx band for. See §4.
 */
function declaredServiceUnavailable(): Error {
    const err = new Error('the approvals service is down, so this write cannot be judged') as Error
        & { code: string; statusCode: number };
    err.code = 'SERVICE_UNAVAILABLE';
    err.statusCode = 503;
    return err;
}

/** A refusal spelled `statusCode` whose own code the ledger does not know. */
function unregisteredCodeConflict(): Error {
    const err = new Error('locked by something this ledger has never heard of') as Error
        & { code: string; statusCode: number };
    err.code = 'PACKAGE_IS_HAUNTED';
    err.statusCode = 409;
    return err;
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/**
 * The engine double every case drives — the same one the sibling file uses, so
 * the rows below are produced by the ACTUAL loops, builders and rollback
 * classifier rather than by an assertion's idea of them.
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
            assertEngineUpdateDispatch(data, opts);
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

/** Silence — and capture — the operator-half warn the #8502 withhold writes. */
function captureWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/**
 * Membership, never a count: `httpStatus` is optional, so `undefined` and
 * "the key is not there" are the same wire fact and both must be checked
 * against the row itself rather than against the length of anything.
 */
function carriesStatus(error: Record<string, unknown>): boolean {
    return Object.prototype.hasOwnProperty.call(error, 'httpStatus');
}

describe('[#8570] section 1 — a declared refusal that does not spell `.status` now carries one', () => {
    it('the objectql VALIDATION_FAILED shape: the card\'s first row, now with 400', async () => {
        const boom = engineValidationError(
            'name must be ≤ 4 characters (got 15)',
            [{ field: 'name', code: 'max_length', message: 'name must be ≤ 4 characters (got 15)' }],
        );
        const { protocol } = makeEngine((verb) => (verb === 'update' ? boom : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { title: 'far too long a title' } }],
        });

        expect(res.results[0].errors[0]).toEqual({
            code: 'VALIDATION_FAILED',
            message: 'name must be ≤ 4 characters (got 15)',
            httpStatus: 400,
        });
    });

    it('the plugin-approvals record lock: the card\'s second row, now with 409', async () => {
        const { protocol } = makeEngine((verb) => (verb === 'update' ? approvalsRecordLock('r1') : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        expect(res.results[0].errors[0]).toEqual({
            code: 'RECORD_LOCKED',
            message: "RECORD_LOCKED: record 'r1' of 'leave_request' is locked while an approval is in progress",
            httpStatus: 409,
        });
    });

    it('all THREE loops populate it, not just the one the card sampled', async () => {
        // create (bulk `batchData`), upsert (`batchData`) and delete
        // (`deleteManyData`) each build their row through the same helper, and
        // a fix applied at one call site only would leave the other two silent.
        const a = makeEngine((verb) => (verb === 'insert' ? approvalsRecordLock('new') : undefined));
        const createRes: any = await a.protocol.batchData({
            object: 'leave_request',
            request: { operation: 'create', records: [{ data: { title: 'x' } }] },
        });
        expect(createRes.results[0].errors[0].httpStatus).toBe(409);

        const b = makeEngine((verb) => (verb === 'update' ? engineValidationError('too long', []) : undefined));
        const upsertRes: any = await b.protocol.batchData({
            object: 'leave_request',
            request: { operation: 'upsert', records: [{ id: 'r1', data: { progress: 1 } }] },
        });
        expect(upsertRes.results[0].errors[0].httpStatus).toBe(400);

        const c = makeEngine((verb) => (verb === 'delete' ? approvalsRecordLock('r1') : undefined));
        const deleteRes: any = await c.protocol.deleteManyData({ object: 'leave_request', ids: ['r1'] });
        expect(deleteRes.results[0].errors[0].httpStatus).toBe(409);
    });
});

describe('[#8570] section 2 — the rows that already carried a status are untouched', () => {
    it('rowRequiredIdError still answers 400 and recordNotFoundError still answers 404', async () => {
        const { protocol } = makeEngine(() => undefined);

        const update: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ data: { progress: 1 } }],
        });
        expect(update.results[0].errors[0]).toEqual({
            code: 'VALIDATION_FAILED', message: 'Record id is required for update', httpStatus: 400,
        });

        const del: any = await protocol.deleteManyData({ object: 'leave_request', ids: ['ghost'] });
        expect(del.results[0].errors[0]).toEqual({
            code: 'RECORD_NOT_FOUND', message: 'Record ghost not found in leave_request', httpStatus: 404,
        });
    });
});

describe('[#8570] section 3 — the OVER-BROAD direction: an undeclared throw gains nothing', () => {
    it('a driver fault carries no `httpStatus` — not 500, not the key at all', async () => {
        const warn = captureWarn();
        const { protocol } = makeEngine((verb) => (verb === 'delete' ? driverFault() : undefined));

        const res: any = await protocol.deleteManyData({ object: 'leave_request', ids: ['r1'] });

        const error = res.results[0].errors[0];
        // The whole row, so a stamped `httpStatus: 500` cannot hide beside a
        // green `code`/`message` assertion.
        expect(error).toEqual({ code: 'INTERNAL_ERROR', message: WITHHELD.delete });
        expect(carriesStatus(error)).toBe(false);
        // …and it is nowhere in the payload either: `500` must not appear as a
        // status the caller can read off any row of this response.
        expect(JSON.stringify(res)).not.toContain('httpStatus');
        warn.mockRestore();
    });

    it('an undeclared app-hook refusal gains nothing either', async () => {
        const warn = captureWarn();
        const { protocol } = makeEngine((verb) => (verb === 'update' ? undeclaredHookRefusal() : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        const error = res.results[0].errors[0];
        expect(error).toEqual({ code: 'INTERNAL_ERROR', message: WITHHELD.update });
        expect(carriesStatus(error)).toBe(false);
        warn.mockRestore();
    });

    it('the collateral NOT_ATTEMPTED / ROLLED_BACK rows carry no status either', async () => {
        // They are built by `reconcileStoppedBatch` / `buildRolledBackBatchResponse`,
        // which quote the causal row's MESSAGE and mint their own code — so a
        // populated causal row must not turn into a populated batch.
        const warn = captureWarn();

        const stopped = makeEngine((verb, id) => (verb === 'delete' && id === 'r1' ? approvalsRecordLock('r1') : undefined));
        const stoppedRes: any = await stopped.protocol.deleteManyData({
            object: 'leave_request', ids: ['r1', 'r2', 'r3'],
        });
        expect(stoppedRes.results[0].errors[0].httpStatus).toBe(409);
        expect(stoppedRes.results[1].errors[0].code).toBe('NOT_ATTEMPTED');
        expect(carriesStatus(stoppedRes.results[1].errors[0])).toBe(false);
        expect(carriesStatus(stoppedRes.results[2].errors[0])).toBe(false);

        const atomic = makeEngine((verb, id) => (verb === 'update' && id === 'r2' ? approvalsRecordLock('r2') : undefined));
        const atomicRes: any = await atomic.protocol.updateManyData({
            object: 'leave_request',
            records: [{ id: 'r1', data: { progress: 1 } }, { id: 'r2', data: { progress: 2 } }],
            options: { atomic: true },
        });
        expect(atomicRes.results[0].errors[0].code).toBe('ROLLED_BACK');
        expect(carriesStatus(atomicRes.results[0].errors[0])).toBe(false);
        expect(atomicRes.results[1].errors[0].httpStatus).toBe(409);
        warn.mockRestore();
    });
});

describe('[#8570] section 4 — the gate is DECLARED-ness, deliberately not the 4xx band', () => {
    it('a refusal declaring a 5xx keeps its status on the row, with its text still withheld', async () => {
        // Two different questions, two different gates, in one row. The message
        // limb (#8502) asks "may this free text be disclosed?" — no for a 5xx.
        // This limb reports a number the PRODUCER authored, and a row already
        // ships `httpStatus: 503` today when the same refusal spells `.status`;
        // gating on 4xx here would WITHDRAW that, which is a different card.
        const warn = captureWarn();
        const { protocol } = makeEngine((verb) => (verb === 'update' ? declaredServiceUnavailable() : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        expect(res.results[0].errors[0]).toEqual({
            code: 'SERVICE_UNAVAILABLE', message: WITHHELD.update, httpStatus: 503,
        });
        expect(JSON.stringify(res)).not.toContain('approvals service is down');
        warn.mockRestore();
    });

    it('the `.status` spelling of the same 5xx behaved this way BEFORE the fix, and still does', async () => {
        // The anti-regression half of the case above: this row is what the
        // limb already shipped, so the fix is measured as an addition to the
        // undeclared-spelling populations and not a change to this one.
        const warn = captureWarn();
        const boom = Object.assign(new Error('down'), { code: 'SERVICE_UNAVAILABLE', status: 503 });
        const { protocol } = makeEngine((verb) => (verb === 'update' ? boom : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        expect(res.results[0].errors[0].httpStatus).toBe(503);
        warn.mockRestore();
    });
});

describe('[#8570] section 5 — `code` and `httpStatus` are read off ONE resolution', () => {
    it('an unregistered code spelled `statusCode` yields a COHERENT row, not 409 beside INTERNAL_ERROR', async () => {
        // The reason both limbs share the resolution. Deriving `code` from
        // `err.status` while `httpStatus` came from the resolver would answer
        // `{ code: 'INTERNAL_ERROR', httpStatus: 409 }` here — a row that
        // contradicts itself, since `INTERNAL_ERROR` is the 5xx bucket.
        const warn = captureWarn();
        const { protocol } = makeEngine((verb) => (verb === 'update' ? unregisteredCodeConflict() : undefined));

        const res: any = await protocol.updateManyData({
            object: 'leave_request', records: [{ id: 'r1', data: { progress: 1 } }],
        });

        expect(res.results[0].errors[0]).toEqual({
            // `PACKAGE_IS_HAUNTED` is not in `StandardErrorCode ∪ ERROR_CODE_LEDGER`,
            // so #8441's catalog gate replaces it with the status-derived code —
            // now derived from the status the producer really declared.
            code: 'RESOURCE_CONFLICT',
            // Quoted, not withheld: the message limb (#8502) asks the 4xx
            // question of the same resolution, and a declared 409 passes it
            // whether or not the ledger knows the producer's own code.
            message: 'locked by something this ledger has never heard of',
            httpStatus: 409,
        });
        warn.mockRestore();
    });
});

describe('[#8570] section 6 — anti-vacuity: the doubles are the shapes they claim to be', () => {
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

    it('NONE of the newly-populated population declares `.status` — the spelling the limb used to read', () => {
        // If any of these grew a `.status`, this file would be green against
        // the OLD implementation too, which is the way an ablation lies.
        for (const e of [engineValidationError('m', []), approvalsRecordLock('r1'), declaredServiceUnavailable()]) {
            expect((e as any).status).toBeUndefined();
        }
    });

    it('the PRODUCTION recogniser separates declared from undeclared exactly as the rows do', () => {
        // Not this file's own predicate — the very function `toRowApiError`
        // calls. `status` collapses the two populations onto 500; only
        // `declaredStatus` tells them apart, which is why the limb reads it.
        expect(resolveThrownHttpError(driverFault()).status).toBe(500);
        expect(resolveThrownHttpError(driverFault()).declaredStatus).toBeUndefined();
        expect(resolveThrownHttpError(undeclaredHookRefusal()).declaredStatus).toBeUndefined();
        expect(resolveThrownHttpError(engineValidationError('m', [])).declaredStatus).toBe(400);
        expect(resolveThrownHttpError(approvalsRecordLock('r1')).declaredStatus).toBe(409);
        expect(resolveThrownHttpError(declaredServiceUnavailable()).declaredStatus).toBe(503);
    });
});
