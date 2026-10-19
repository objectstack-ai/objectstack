// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24561] A batch row answers a sandboxed hook's business refusal in the
 * hook's own words, with the code every data door gives it.
 *
 * ## What was measured broken
 *
 * On a live boot (18.0 release QA, subject `5b14b7f3`), a sandboxed
 * `beforeInsert` hook body throwing `new Error('QA-B: locked codes cannot be
 * created.')`:
 *
 * - `POST /api/v1/data/:object`, `/createMany` and `/import` answered the
 *   sentence (`400 VALIDATION_ERROR` on the first two, the row's `error` on the
 *   third);
 * - `POST /api/v1/data/:object/batch` answered `200` with the row
 *   `{ code: 'INTERNAL_ERROR', message: 'The create of this record failed. The
 *   reason is in the server log.' }`, and the server logged the withhold.
 *
 * The row sink (`toRowApiError` / `clientFacingRowFailureText`) decided
 * disclosure only from a declared 4xx, and a sandboxed body's bare `throw`
 * declares none. So it was withheld as if it were a driver fault. It is not
 * one: the QuickJS runner puts the body's sentence on `.innerMessage` for the
 * caller and keeps the `hook '<name>' threw: …` wrapper on `.message` for the
 * log. Every sibling door reads that sentence through `sandboxBusinessMessage`
 * (`@objectstack/types`), and the row now makes the same read.
 *
 * ## Why the pin lives here
 *
 * `packages/rest/src/rest-write-route-hook-refusal-sentence.ledger.test.ts`
 * lists `/batch` as answering the sentence, but its double makes
 * `protocol.batchData` reject as a whole, so the per-row catch never runs
 * there. This file drives the REAL per-row catches of all three loops that
 * share the sink (`batchData`, `updateManyData`, `deleteManyData`).
 *
 * ## The doubles
 *
 * The thrown values are the shapes `runtime/src/sandbox/quickjs-runner.ts`
 * produces (`SandboxError`: `.message` the wrapper, `.innerMessage` the
 * sentence, `status` / `code` / `fields` only when the body declared them),
 * built here because `@objectstack/runtime` depends on this package and the
 * import would close a cycle. They are the same doubles the import-runner and
 * REST ledger pins use. §6 runs the PRODUCTION recognisers and the data door's
 * own classification (`mapDataError`) over each one, so a double that stopped
 * being the shape it stands for turns this file red rather than passing for
 * the wrong reason.
 */

import { describe, it, expect, vi, type MockInstance } from 'vitest';
import { assertEngineDeleteDispatch, assertEngineUpdateDispatch, assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { mapDataError, sandboxBusinessMessage, isSandboxOwnFault } from '@objectstack/types';
import { BatchOperationResultSchema, standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { ObjectStackProtocolImplementation } from './protocol.js';

const OBJECT = 'showcase_qa_uniq';
const SENTENCE = 'QA-B: locked codes cannot be created.';
const WRAPPER = `hook 'qa_lock_codes' threw: Error: ${SENTENCE}`;
/** Any trace of the runner's debug wrapper. */
const WRAPPER_RE = /threw:|hook '/;

const SCHEMA = {
    name: OBJECT,
    fields: { code: { name: 'code', type: 'text' } },
};

/** The rows' withheld sentences, one per verb (`rowOperationFailureFallback`). */
const WITHHELD = {
    create: 'The create of this record failed. The reason is in the server log.',
    update: 'The update of this record failed. The reason is in the server log.',
    upsert: 'The upsert of this record failed. The reason is in the server log.',
    delete: 'The delete of this record failed. The reason is in the server log.',
};

const WITHHOLD_PREFIX = "[Protocol] Withheld a caught error's text from a batch row";

// ─── The producer's shapes ───────────────────────────────────────────────────

/** A body's deliberate `throw`: the sentence on `.innerMessage`, anything it declared beside it. */
function sandboxRefusal(extra: Record<string, unknown> = {}): Error {
    const err = new Error(WRAPPER);
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: SENTENCE }, extra);
}

/** A body that CRASHED: the runner puts the native error text on `.innerMessage`. */
function sandboxCrash(extra: Record<string, unknown> = {}): Error {
    const err = new Error("hook 'qa_lock_codes' threw: TypeError: boom");
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: 'TypeError: boom' }, extra);
}

/** A refusal that declared a server-band status: the doors answer it as a fault. */
function sandboxDeclared5xx(): Error {
    const err = new Error("hook 'qa_lock_codes' threw: Error: The ledger service is down.");
    err.name = 'SandboxError';
    return Object.assign(err, { innerMessage: 'The ledger service is down.', status: 503, code: 'SERVICE_UNAVAILABLE' });
}

/** The runner's OWN fault (a budget, a denied capability): no `.innerMessage` at all. */
function sandboxOwnFault(): Error {
    const err = new Error("hook 'qa_lock_codes' exceeded CPU budget of 50ms (after 3 pump iterations)");
    err.name = 'SandboxError';
    return err;
}

/** A driver fault, the population the withhold exists for. */
function driverFault(): Error {
    return Object.assign(new Error(`SQLITE_ERROR: no such table: ${OBJECT}`), { code: 'SQLITE_ERROR' });
}

// ─── Harness ─────────────────────────────────────────────────────────────────

/** The engine every case drives; `throwOn` decides which call fails and with what. */
function makeEngine(throwOn: (verb: string, id: unknown) => unknown | undefined) {
    const rows = new Map<string, any>([
        ['r1', { id: 'r1', code: 'A-1' }],
        ['r2', { id: 'r2', code: 'A-2' }],
    ]);
    const handle = { id: 'trx-1' };
    const engine: any = {
        registry: { getObject: (n: string) => (n === OBJECT ? SCHEMA : undefined) },
        findOne: vi.fn(async (_o: string, opts?: any) => { assertEngineFindOnePredicate(_o, opts); return rows.get(opts?.where?.id) ?? null; }),
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
    return { protocol: new ObjectStackProtocolImplementation(engine) as any };
}

function captureWarn(): MockInstance {
    return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

/** The sink's withhold lines only, so an unrelated warning cannot satisfy or break a count. */
function withholdCalls(warn: MockInstance): unknown[][] {
    return warn.mock.calls.filter((call) => typeof call[0] === 'string' && call[0].startsWith(WITHHOLD_PREFIX));
}

/** One failed create through `POST /data/:object/batch`'s protocol method — the card's request. */
async function batchCreate(error: Error): Promise<any> {
    const { protocol } = makeEngine((verb) => (verb === 'insert' ? error : undefined));
    return protocol.batchData({ object: OBJECT, request: { operation: 'create', records: [{ data: { code: 'LOCK-9' } }] } });
}

// ─── §1 ──────────────────────────────────────────────────────────────────────

describe('[#24561] §1 the card: a sandboxed refusal on a batch create reads as the hook\'s sentence', () => {
    it('the row carries the sentence and the 400 floor code, and no withhold warning is written', async () => {
        const warn = captureWarn();
        try {
            const res = await batchCreate(sandboxRefusal());

            expect(res.results[0].success).toBe(false);
            expect(res.results[0].errors).toEqual([{ code: 'VALIDATION_ERROR', message: SENTENCE }]);
            // No `httpStatus`: the body declared none, and the limb reports only a
            // declared status (#8570). The row's shape is what it was.
            expect(res.results[0].errors[0]).not.toHaveProperty('httpStatus');
            expect(() => BatchOperationResultSchema.parse(res.results[0])).not.toThrow();
            expect(JSON.stringify(res)).not.toMatch(WRAPPER_RE);
            expect(withholdCalls(warn)).toHaveLength(0);
        } finally {
            warn.mockRestore();
        }
    });

    it('the row agrees with the data door: the same sentence, and the code the door\'s status names', async () => {
        const refusal = sandboxRefusal();
        const door = mapDataError(refusal, OBJECT);
        const res = await batchCreate(refusal);

        expect(door.status).toBe(400);
        expect(res.results[0].errors[0].message).toBe(door.body.error);
        expect(res.results[0].errors[0].code).toBe(standardErrorCodeForHttpStatus(door.status));
    });
});

// ─── §2 ──────────────────────────────────────────────────────────────────────

describe('[#24561] §2 every loop that shares the row sink answers the same way', () => {
    const refusing = () => makeEngine(() => sandboxRefusal()).protocol;
    const cases: Array<[string, (p: any) => Promise<any>]> = [
        ['batchData create', (p) => p.batchData({ object: OBJECT, request: { operation: 'create', records: [{ data: { code: 'LOCK-9' } }] } })],
        ['batchData update', (p) => p.batchData({ object: OBJECT, request: { operation: 'update', records: [{ id: 'r1', data: { code: 'LOCK-9' } }] } })],
        ['batchData upsert', (p) => p.batchData({ object: OBJECT, request: { operation: 'upsert', records: [{ id: 'r1', data: { code: 'LOCK-9' } }] } })],
        ['batchData delete', (p) => p.batchData({ object: OBJECT, request: { operation: 'delete', records: [{ id: 'r1' }] } })],
        ['updateManyData', (p) => p.updateManyData({ object: OBJECT, records: [{ id: 'r1', data: { code: 'LOCK-9' } }] })],
        ['deleteManyData', (p) => p.deleteManyData({ object: OBJECT, ids: ['r1'] })],
    ];

    it.each(cases)('%s', async (_label, run) => {
        const warn = captureWarn();
        try {
            const res = await run(refusing());
            expect(res.results[0].errors).toEqual([{ code: 'VALIDATION_ERROR', message: SENTENCE }]);
            expect(JSON.stringify(res)).not.toMatch(WRAPPER_RE);
            expect(withholdCalls(warn)).toHaveLength(0);
        } finally {
            warn.mockRestore();
        }
    });
});

// ─── §3 ──────────────────────────────────────────────────────────────────────

describe('[#24561] §3 a refusal that declared its own code or status keeps them, with the sentence instead of the wrapper', () => {
    it('a declared 409 and registered code: the code and status ride, the sentence replaces the wrapper', async () => {
        const refusal = sandboxRefusal({ code: 'RECORD_LOCKED', status: 409 });
        const res = await batchCreate(refusal);

        expect(res.results[0].errors).toEqual([{ code: 'RECORD_LOCKED', message: SENTENCE, httpStatus: 409 }]);
        expect(JSON.stringify(res)).not.toMatch(WRAPPER_RE);
        const door = mapDataError(refusal, OBJECT);
        expect(door.status).toBe(409);
        expect(door.body.error).toBe(SENTENCE);
    });

    it('a body that threw VALIDATION_FAILED with fields: 400 VALIDATION_FAILED, in the body\'s words', async () => {
        const refusal = sandboxRefusal({ code: 'VALIDATION_FAILED', fields: [{ field: 'code', code: 'pattern', message: SENTENCE }] });
        const res = await batchCreate(refusal);

        expect(res.results[0].errors).toEqual([{ code: 'VALIDATION_FAILED', message: SENTENCE, httpStatus: 400 }]);
        expect(JSON.stringify(res)).not.toMatch(WRAPPER_RE);
        expect(mapDataError(refusal, OBJECT).body.error).toBe(SENTENCE);
    });

    it('an UNREGISTERED code with no status: the code is the floor of the 400 the door serves', async () => {
        const refusal = sandboxRefusal({ code: 'QA_LOCKED_CODE' });
        const res = await batchCreate(refusal);

        expect(res.results[0].errors).toEqual([{ code: 'VALIDATION_ERROR', message: SENTENCE }]);
        expect(mapDataError(refusal, OBJECT).status).toBe(400);
        expect(() => BatchOperationResultSchema.parse(res.results[0])).not.toThrow();
    });
});

// ─── §4 ──────────────────────────────────────────────────────────────────────

describe('[#24561] §4 the boundary does not widen: what the doors answer as a fault stays withheld, and warns', () => {
    const faults: Array<[string, () => Error, RegExp, { code: string; httpStatus?: number }]> = [
        ['a body that CRASHED', () => sandboxCrash(), /TypeError|boom/, { code: 'INTERNAL_ERROR' }],
        ['a refusal that declared a 5xx', sandboxDeclared5xx, /ledger service/, { code: 'SERVICE_UNAVAILABLE', httpStatus: 503 }],
        ["the sandbox's OWN fault", sandboxOwnFault, /CPU budget/, { code: 'INTERNAL_ERROR' }],
        ['a driver fault (no sandbox at all)', driverFault, /SQLITE_ERROR|no such table/, { code: 'INTERNAL_ERROR' }],
    ];

    it.each(faults)('%s: the fallback sentence, its code unchanged, one withhold warning with the original error', async (_label, make, leak, wire) => {
        const warn = captureWarn();
        try {
            const error = make();
            const res = await batchCreate(error);

            expect(res.results[0].errors).toEqual([{ ...wire, message: WITHHELD.create }]);
            expect(JSON.stringify(res)).not.toMatch(leak);
            expect(JSON.stringify(res)).not.toMatch(WRAPPER_RE);
            const calls = withholdCalls(warn);
            expect(calls).toHaveLength(1);
            expect(calls[0][1]).toBe(error);
        } finally {
            warn.mockRestore();
        }
    });

    it('a CRASH that declared a 4xx is still a crash: its wrapper is withheld, as every door withholds it', async () => {
        // Before this card the declared 400 sent this row down the 4xx branch,
        // which quoted `.message` — the runner's wrapper with the native error
        // text in it — where every data door answers `500` (a crash is a fault
        // whatever it declares). Only the text is decided here; see the PR's
        // acceptance notes for the row's `code` / `httpStatus`.
        const warn = captureWarn();
        try {
            const crash = sandboxCrash({ status: 400 });
            const res = await batchCreate(crash);

            expect(res.results[0].errors[0].message).toBe(WITHHELD.create);
            expect(JSON.stringify(res)).not.toMatch(/TypeError|boom/);
            expect(JSON.stringify(res)).not.toMatch(WRAPPER_RE);
            expect(withholdCalls(warn)).toHaveLength(1);
            expect(mapDataError(crash, OBJECT).status).toBe(500);
        } finally {
            warn.mockRestore();
        }
    });

    it('control: the SAME sentence thrown in-process (no sandbox) is still withheld — the read keys on the producer, never the text', async () => {
        const warn = captureWarn();
        try {
            const res = await batchCreate(new Error(SENTENCE));

            expect(res.results[0].errors).toEqual([{ code: 'INTERNAL_ERROR', message: WITHHELD.create }]);
            expect(withholdCalls(warn)).toHaveLength(1);
        } finally {
            warn.mockRestore();
        }
    });
});

// ─── §5 ──────────────────────────────────────────────────────────────────────

describe('[#24561] §5 the rows that quote the causal row carry the sentence, never the wrapper', () => {
    it('NOT_ATTEMPTED (a stopped run) and ROLLED_BACK (an atomic one)', async () => {
        const stopped = makeEngine((verb, id) => (verb === 'update' && id === 'r1' ? sandboxRefusal() : undefined));
        const stoppedRes = await stopped.protocol.updateManyData({
            object: OBJECT,
            records: [{ id: 'r1', data: { code: 'LOCK-9' } }, { id: 'r2', data: { code: 'B-2' } }],
        });
        expect(stoppedRes.results[0].errors[0].message).toBe(SENTENCE);
        expect(stoppedRes.results[1].errors[0].code).toBe('NOT_ATTEMPTED');
        expect(stoppedRes.results[1].errors[0].message).toContain(SENTENCE);
        expect(JSON.stringify(stoppedRes)).not.toMatch(WRAPPER_RE);

        const atomic = makeEngine((verb, id) => (verb === 'update' && id === 'r2' ? sandboxRefusal() : undefined));
        const atomicRes = await atomic.protocol.updateManyData({
            object: OBJECT,
            records: [{ id: 'r1', data: { code: 'B-1' } }, { id: 'r2', data: { code: 'LOCK-9' } }],
            options: { atomic: true },
        });
        expect(atomicRes.results[0].errors[0].code).toBe('ROLLED_BACK');
        expect(atomicRes.results[0].errors[0].message).toContain(SENTENCE);
        expect(JSON.stringify(atomicRes)).not.toMatch(WRAPPER_RE);
    });
});

// ─── §6 ──────────────────────────────────────────────────────────────────────

describe('[#24561] §6 anti-vacuity: each double is classified as the producer it stands for', () => {
    it('the shared read recognises the refusal and declines the crash and the runner\'s own fault', () => {
        expect(sandboxBusinessMessage(sandboxRefusal())).toBe(SENTENCE);
        expect(sandboxBusinessMessage(sandboxCrash())).toBeUndefined();
        expect(sandboxBusinessMessage(sandboxOwnFault())).toBeUndefined();
        expect(isSandboxOwnFault(sandboxOwnFault())).toBe(true);
        expect(isSandboxOwnFault(sandboxRefusal())).toBe(false);
        // The declared-5xx refusal IS read as a sentence; only the status band
        // keeps it withheld, so §4's row for it tests the gate, not the read.
        expect(sandboxBusinessMessage(sandboxDeclared5xx())).toBe('The ledger service is down.');
    });

    it('the data door answers each double the way §1–§4 hold the row to', () => {
        expect(mapDataError(sandboxRefusal(), OBJECT).status).toBe(400);
        expect(mapDataError(sandboxCrash(), OBJECT).status).toBe(500);
        expect(mapDataError(sandboxCrash({ status: 400 }), OBJECT).status).toBe(500);
        expect(mapDataError(sandboxOwnFault(), OBJECT).status).toBe(500);
        expect(mapDataError(sandboxDeclared5xx(), OBJECT).status).toBe(503);
        expect(standardErrorCodeForHttpStatus(400)).toBe('VALIDATION_ERROR');
    });
});
