// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5437] A declared 5xx never ships its own message to the client.
//
// `resolveErrorResponse` — the value side of `sendError`, and therefore the
// error path of every metadata / UI / discovery / batch route — passed an
// explicit status straight through for the whole 400-599 band. `mapDataError`'s
// sibling branch stops at 4xx *on purpose*: "5xx messages keep going through
// the sanitizing heuristics below so internal/SQL details never reach the
// client verbatim". Two opposite verdicts on one question, and the routes that
// report through `sendError` got the permissive one — a declared 500 shorter
// than 500 characters was returned word for word, past `isSqlLeak`, past
// `looksLikeInternalErrorLeak`, past `Internal data error`.
//
// The producer that makes this live rather than theoretical is
// `metadata-protocol`, which interpolates the raw driver error into two
// client-facing 500s (`Failed to persist customization overlay to
// sys_metadata: ${dbError.message}`, `Failed to delete customization overlay:
// ${err.message}`). A real driver line — `SQLITE_ERROR: no such table:
// sys_metadata`, `relation "sys_metadata" does not exist`, a unique-constraint
// payload naming columns — is nowhere near 500 characters, so the length bound
// never touched it. Length was never a proxy for leakage; on this side of the
// bound it failed OPEN.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Restoring the old bound (`error.status < 600` with no 5xx branch) turns every
// "withheld" case here RED — they assert on a body that only exists once the
// message is dropped — and leaves every 4xx case GREEN, because #5436's
// truncation is untouched by this change. That is the ordinary direction, and
// it was confirmed by running it (see the PR).
//
// ---------------------------------------------------------------------------
// Why the fix does NOT delegate to `mapDataError`
// ---------------------------------------------------------------------------
// The obvious shape — drop 5xx out of the passthrough and let it fall through
// to `mapDataError`'s heuristics — was measured first and rejected, because
// `mapDataError` derives its status from the message TEXT:
//
//   500 `...sys_metadata: SQLITE_ERROR: no such table: sys_metadata`
//        -> 404 OBJECT_NOT_FOUND     ("no such table" trips unknown-object)
//   501 `Atomic batch on 'showcase_account' requires engine transaction ...`
//        -> 404 Object 'showcase_account' is not registered
//   500 `Failed to delete customization overlay: connect ECONNREFUSED ...`
//        -> 400 with the driver text STILL verbatim (terminal fallback)
//           [#5489] that terminal fallback is now a sanitised 500, so this
//           third row's LEAK is closed at the source. The other two rows are
//           untouched — they are mis-classifications by the text heuristics,
//           not by the fallback — and the reason this fix stays in the branch
//           itself (keep the producer's declared status) is unchanged.
//
// So it re-labels a server fault as a client mistake, re-labels a capability
// refusal as a missing object, and — for any 5xx whose wording matches no
// keyword — leaks exactly what it was supposed to stop, now wearing a 4xx. Two
// of those statuses are also `isExpectedDataStatus`, so the fault would stop
// being logged at all. The cure is therefore applied in the branch itself:
// keep the status the producer declared, keep the machine-readable `code`, drop
// the prose. The status-preservation assertions below are what pin that.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { RestServer } from './rest-server';

const META_ITEM = '/api/v1/meta/:type/:name';
const OBJ_BATCH = '/api/v1/data/:object/batch';
const BATCH_OBJECT = 'showcase_account';

/** The driver line a missing `sys_metadata` produces on each dialect. */
const SQLITE_NO_TABLE = 'SQLITE_ERROR: no such table: sys_metadata';
const PG_NO_RELATION = 'relation "sys_metadata" does not exist';

// ---------------------------------------------------------------------------
// Harness — the shape #5436 introduced, reused verbatim
// ---------------------------------------------------------------------------

function createMockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    res.header = vi.fn(() => res);
    res.setHeader = vi.fn(); res.write = vi.fn(); res.end = vi.fn(); res.send = vi.fn();
    return res;
}

function mountRest(protocol: any) {
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false, enableBatch: true } } as any,
    );
    // [#6603] this route now demands `manage_metadata` — an authoring capability, not just a session.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    return rest;
}

function setup(protocolOverrides: Record<string, unknown> = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        saveMetaItem: vi.fn().mockResolvedValue({}),
        deleteMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        batchData: vi.fn().mockResolvedValue({}),
        ...protocolOverrides,
    };
    return mountRest(protocol);
}

async function callRoute(rest: any, method: string, path: string, req: Record<string, unknown> = {}) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    const res = makeRes();
    await route.handler({ method, params: {}, query: {}, body: {}, headers: {}, ...req }, res);
    return res;
}

/** Every `console.error` argument list this test produced. */
let logged: unknown[][] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
    logged = [];
    spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => { logged.push(args); });
});
afterEach(() => { spy.mockRestore(); });

/**
 * Did ANY log line carry the given text (in its message, its `cause` chain, or
 * its arguments)?
 *
 * [#8136] The `cause` traversal is not a convenience — it is where the driver
 * text now lives. This helper used to read `a.message` only, which was
 * sufficient while `metadata-protocol` interpolated the driver line INTO the
 * message it threw. Option C stopped it doing that: the client-facing sentence
 * names the operation and quotes nothing, and the original driver error is
 * carried on `cause`. `console.error('[REST] Unhandled error:', err)` still
 * receives it in full — Node formats an `Error`'s `[cause]` along with it — so
 * the operator's half of the contract is unchanged.
 *
 * Measured at this seam after the producer fix, so the traversal is not
 * speculative:
 *
 * ```
 * [REST] Unhandled error: Error(Failed to delete customization overlay for
 *   object/showcase_account. …) <<CAUSE>> SQLITE_ERROR: no such table: sys_metadata
 * ```
 *
 * ⛔ Do NOT "fix" a future red here by deleting the `loggedText` assertions.
 * They are the only thing in this file asserting that withholding text from the
 * CLIENT did not also delete it from the LOG, which is the failure mode a
 * disclosure fix is most likely to introduce.
 */
function loggedText(needle: string): boolean {
    const carries = (a: unknown, depth = 0): boolean => {
        if (depth > 5) return false;
        if (a instanceof Error) {
            return a.message.includes(needle) || carries((a as { cause?: unknown }).cause, depth + 1);
        }
        return typeof a === 'string' && a.includes(needle);
    };
    return logged.some((args) => args.some((a) => carries(a)));
}

// ---------------------------------------------------------------------------
// 1. The real producer, end to end — the issue's "unverified" half
// ---------------------------------------------------------------------------
//
// The issue was raised from a code read and said so: "没有起 REST server 打真实
// 请求造一次 `sys_metadata` 写失败". This section does that in process — a REAL
// `ObjectQL` engine, a REAL `ObjectStackProtocolImplementation`, and a driver
// that fails every `sys_metadata` access the way a missing table does. Nothing
// is hand-built: the message, its interpolated driver text and its status all
// come from the shipping protocol code, and the route is the one a client calls.
//
// The producer walked here is `deleteMetaItem`'s catch — `Failed to delete
// customization overlay: ${err.message}`, `(e as any).status = 500`. It is
// deliberately the one sampled live, because its status is ASSIGNED to an
// already-constructed error rather than written as a `status:` literal, and the
// issue flagged exactly that shape as un-enumerated ("动态赋值的路径没清点"). A
// `status:` grep does not find it; this test does.
//
// It is now the ONLY `sys_metadata` producer on this boundary. The sibling
// `saveMetaItem` one (`OVERLAY_PERSISTENCE_FAILED`) that this section used to
// name is gone, and the note that stood here was already wrong before it went:
// it argued the legacy raw-engine branch was merely hard to reach — "requires a
// metadata type that is neither overlay-allowed nor runtime-creatable AND an
// artifact-backed item of that type, and a runtime-created one is refused
// earlier with `403 NOT_CREATABLE`" — but the artifact-backed half is refused
// just as early, with `403 NOT_OVERRIDABLE` (#5086; `saveMetaItem`'s code-only
// gate throws `codeOnlyOverrideError` for exactly that stack, pinned by
// `protocol.code-only-types.test.ts`'s "refuses overlaying an artifact-backed
// <type> with not_overridable"). Both halves were refused, so the branch was
// unreachable rather than rare; #5264 deleted it, and #5783 unregistered the
// code. A reachability argument written into a comment is what rots here —
// this one was CORRECT the day it was written and outlived by one week the
// gate tightening that falsified it.
//
// What replaced it in the next section is the atomic-batch refusal
// (`501 NOT_IMPLEMENTED`), a producer that still exists: `metadata-protocol`'s
// `batchData` throws it when the runtime cannot open a transaction. It hands
// `resolveErrorResponse` the same thing this live half does — a DECLARED 5xx —
// so the live half proves the boundary and the shaped half proves that a
// declared `code` survives the sanitizing.

function failingDriver(dbError: string) {
    const boom = () => { throw new Error(dbError); };
    const driver: any = {
        name: 'memory-broken', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find() { boom(); }, async findOne() { boom(); },
        async create() { boom(); }, async update() { boom(); }, async delete() { boom(); },
        async upsert() { boom(); }, async count() { boom(); },
        async bulkCreate() { boom(); }, async bulkUpdate() { boom(); }, async bulkDelete() { boom(); },
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return driver;
}

async function bootRealProtocol(dbError: string) {
    const engine = new ObjectQL();
    engine.registerDriver(failingDriver(dbError), true);
    await engine.init();
    const protocol = new ObjectStackProtocolImplementation(engine as any);
    return mountRest(protocol as any);
}

describe('[#5437] a real sys_metadata failure, walked in process', () => {
    it('the driver line does not appear anywhere in the client body', async () => {
        const rest = await bootRealProtocol(SQLITE_NO_TABLE);

        const res = await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('no such table');
        expect(wire).not.toContain('SQLITE_ERROR');
        expect(wire).not.toContain('sys_metadata');
        // Still a server fault on the wire — NOT laundered into a 4xx by a
        // heuristic reading of the message. `mapDataError` would have answered
        // 404 OBJECT_NOT_FOUND for this exact text.
        expect(res.statusCode).toBe(500);
    }, 60_000);

    it('the withheld text still reaches the server log, in full', async () => {
        // [#8136] This case's own prediction came true, and it is corrected in
        // place rather than deleted. It used to say "the only way this text can
        // reach the log is if the protocol really did interpolate the driver
        // error into the message it threw. If the producer ever stops doing
        // that, this goes red" — and option C is the producer doing exactly
        // that. It is no longer a premise guard for the case above.
        //
        // What survives, and is the reason the case stays, is the LOG
        // GUARANTEE: the driver line still reaches the operator in full, now on
        // the thrown error's `cause` rather than inside its message. That is
        // the half a disclosure fix is most likely to break by accident —
        // withholding from the client by simply dropping the diagnostic — so it
        // is asserted here at the boundary as well as at the producer.
        const rest = await bootRealProtocol(SQLITE_NO_TABLE);

        await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(loggedText('no such table')).toBe(true);
        expect(loggedText('Failed to delete customization overlay')).toBe(true);
    }, 60_000);

    it('Postgres phrasing is withheld too — this is not a SQLite-shaped guard', async () => {
        const rest = await bootRealProtocol(PG_NO_RELATION);

        const res = await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        const wire = JSON.stringify(res.body);
        expect(wire).not.toContain('does not exist');
        expect(wire).not.toContain('relation');
        expect(loggedText('does not exist')).toBe(true);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. The envelope a declared 5xx now produces
// ---------------------------------------------------------------------------
//
// Built the way `metadata-protocol` builds it at the two producer sites that
// survive, so the assertions read against the exact shape that ships. The two
// are deliberately opposite in the one dimension this branch keys on: the batch
// refusal DECLARES a `code`, the overlay delete declares only a `status`.

/**
 * `protocol.ts` — `batchData`'s atomic refusal, the code-carrying declared 5xx
 * on this boundary. Copied from the producer verbatim, `status` and `code` set
 * on the error before it is thrown.
 *
 * It is here because #5264 removed the one this section used to build
 * (`saveMetaItem`'s `OVERLAY_PERSISTENCE_FAILED` catch, unregistered from the
 * ledger by #5783). Same job, and a strictly better specimen for it: its
 * message is the "accepted cost" sentence `resolveErrorResponse`'s own docblock
 * names — written FOR the caller, and withheld from them anyway — so the case
 * below asserts a real loss rather than the withholding of a driver dump that
 * nobody wanted delivered.
 */
function atomicBatchUnsupportedError(object: string) {
    const err = new Error(
        `Atomic batch on '${object}' requires engine transaction support; this runtime cannot roll back. `
        + `Retry without options.atomic, or probe capabilities.transactionalBatch on /discovery first.`,
    );
    (err as any).code = 'NOT_IMPLEMENTED';
    (err as any).status = 501;
    return err;
}

/**
 * `protocol.ts` — `deleteMetaItem`'s catch. The status is assigned to an
 * already-constructed error rather than passed to a constructor or an object
 * literal, which is the producer shape the issue flagged as un-enumerated
 * ("动态赋值的路径没清点"): a `status:` literal grep does not find it. Same
 * band, same boundary, so it is sampled here rather than assumed.
 */
function deleteOverlayError(dbError: string) {
    const e = new Error(`Failed to delete customization overlay: ${dbError}`);
    (e as any).status = 500;
    return e;
}

describe('[#5437] the 5xx envelope: status and code survive, the prose does not', () => {
    it('NOT_IMPLEMENTED keeps its 501 and its code, loses its text', async () => {
        const rest = setup({
            getMetaItems: vi.fn().mockResolvedValue([{ name: BATCH_OBJECT }]),
            batchData: vi.fn().mockRejectedValue(atomicBatchUnsupportedError(BATCH_OBJECT)),
        });

        const res = await callRoute(rest, 'POST', OBJ_BATCH, {
            params: { object: BATCH_OBJECT },
            body: { operation: 'update', records: [{ id: 'r1', data: { name: 'r1' } }] },
        });

        // The producer's own declaration is honoured — this is what routing the
        // error through `mapDataError` would have destroyed: its text carries
        // the quoted object name and the word "cannot", so the unknown-object
        // heuristic's last limb answers `404 Object '<name>' is not registered`
        // (asserted directly in `rest-unknown-object-heuristic.test.ts` §4).
        expect(res.statusCode).toBe(501);
        expect(res.body.code).toBe('NOT_IMPLEMENTED');
        // A machine-readable code is not a leak; the prose is — even here,
        // where the prose was addressed to the caller and is the remedy.
        expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(res.body).toEqual({ error: INTERNAL_ERROR_MESSAGE, code: 'NOT_IMPLEMENTED' });
        expect(JSON.stringify(res.body)).not.toContain('options.atomic');
    }, 60_000);

    it('a dynamically-assigned status is treated identically (no code declared)', async () => {
        const rest = setup({
            deleteMetaItem: vi.fn().mockRejectedValue(deleteOverlayError(PG_NO_RELATION)),
        });

        const res = await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(500);
        expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        // No `code` was declared, so none is invented here — ADR-0112 says the
        // PRODUCER names the condition.
        expect(res.body.code).toBeUndefined();
        expect(loggedText('does not exist')).toBe(true);
    }, 60_000);

    it('a SHORT 5xx is withheld too — length was never the criterion', async () => {
        // The whole defect in one case: well under the bound that used to be
        // the only thing standing here, and every word of it a driver
        // internal. Built on the delete producer (#5783: the persist one this
        // used to call was deleted with its branch in #5264), which is the
        // surviving `sys_metadata` 500 and interpolates the driver line the
        // same way.
        const short = deleteOverlayError('UNIQUE constraint failed: sys_metadata.name');
        expect(short.message.length).toBeLessThan(500);
        expect(short.message).toContain('sys_metadata');

        const rest = setup({ deleteMetaItem: vi.fn().mockRejectedValue(short) });
        const res = await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(String(res.body.error)).not.toContain('sys_metadata');
    }, 60_000);

    it('a 5xx message that trips NO leak keyword is withheld all the same', async () => {
        // The case a keyword gate cannot catch and the reason this is not one:
        // `connect ECONNREFUSED <host>:<port>` names infrastructure without
        // saying a single word `looksLikeInternalErrorLeak` looks for.
        const rest = setup({
            deleteMetaItem: vi.fn().mockRejectedValue(
                deleteOverlayError('connect ECONNREFUSED 10.0.0.5:5432'),
            ),
        });

        const res = await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(500);
        expect(String(res.body.error)).not.toContain('10.0.0.5');
        expect(String(res.body.error)).not.toContain('ECONNREFUSED');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. The rest of the 5xx family
// ---------------------------------------------------------------------------

describe('[#5437] the whole 5xx band, not just 500', () => {
    // `metadata-protocol`'s atomic-batch refusal — the third live producer in
    // this band, and the one that shows why the status must be preserved: its
    // message names the object, so `mapDataError` answers `404 Object '<name>'
    // is not registered` for an object that exists perfectly well and a runtime
    // that simply cannot open a transaction.
    const NOT_IMPLEMENTED = Object.assign(
        new Error(
            `Atomic batch on 'showcase_account' requires engine transaction support; this runtime cannot roll back. `
            + `Retry without options.atomic, or probe capabilities.transactionalBatch on /discovery first.`,
        ),
        { status: 501, code: 'NOT_IMPLEMENTED' },
    );

    it('a 501 stays a 501 with its code — it does not become a 404 or a 400', async () => {
        const rest = setup({ getMetaItem: vi.fn().mockRejectedValue(NOT_IMPLEMENTED) });
        const res = await callRoute(rest, 'GET', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(501);
        expect(res.body.code).toBe('NOT_IMPLEMENTED');
        expect(res.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        // Accepted cost, pinned so it is a decision and not a surprise: this
        // sentence is self-authored and carries a genuine remedy. It reaches
        // the operator's log, and the client keys on `501 NOT_IMPLEMENTED`.
        expect(String(res.body.error)).not.toContain('options.atomic');
    }, 60_000);

    it('502 and 503 are withheld and, being "expected" statuses, still get a log line', async () => {
        for (const status of [502, 503]) {
            logged = [];
            const err = Object.assign(
                new Error(`upstream metadata store returned garbage at 10.0.0.5:5432`),
                { status, code: 'UPSTREAM_FAILED' },
            );
            const rest = setup({ getMetaItem: vi.fn().mockRejectedValue(err) });
            const res = await callRoute(rest, 'GET', META_ITEM, {
                params: { type: 'object', name: 'showcase_account' },
            });

            expect(res.statusCode, `status ${status}`).toBe(status);
            expect(res.body.error, `status ${status}`).toBe(INTERNAL_ERROR_MESSAGE);
            // `isExpectedDataStatus` treats 502/503 as lifecycle outcomes and
            // keeps "[REST] Unhandled error" quiet for them. Before #5437 the
            // operator could still read the cause — off the client's response.
            // Now that the body is generic, the log line is the ONLY copy.
            expect(loggedText('10.0.0.5'), `status ${status}`).toBe(true);
        }
    }, 60_000);

    it('a genuine 500 fault logs exactly ONE line, not two', async () => {
        // `handleRouteError` already prints the whole error object for a fault
        // this size; the withheld-message line must not double it.
        const rest = setup({
            deleteMetaItem: vi.fn().mockRejectedValue(deleteOverlayError(SQLITE_NO_TABLE)),
        });
        await callRoute(rest, 'DELETE', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(logged).toHaveLength(1);
        expect(loggedText('no such table')).toBe(true);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 4. #5436 must not regress
// ---------------------------------------------------------------------------
//
// This change rewrote the expression that #5436 landed, so the 4xx half is
// re-pinned here at the same boundary rather than trusted. Full coverage of the
// truncation itself stays in `rest-4xx-message-truncation.test.ts`.

describe('[#5437] the 4xx half is untouched (#5436 non-regression)', () => {
    it('a short 4xx is still byte-for-byte verbatim', async () => {
        const msg = '[no_draft] No pending draft exists for object/showcase_account.';
        const rest = setup({
            getMetaItem: vi.fn().mockRejectedValue(
                Object.assign(new Error(msg), { code: 'NO_DRAFT', status: 404 }),
            ),
        });
        const res = await callRoute(rest, 'GET', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ error: msg, code: 'NO_DRAFT' });
    }, 60_000);

    it('a long 4xx is still TRUNCATED, not erased, and keeps its issues', async () => {
        const head = 'The main clause a caller must read is right here at the front. ';
        const err = Object.assign(
            new Error(head + 'x'.repeat(600 - head.length)),
            { code: 'INVALID_METADATA', status: 422, issues: [{ path: 'label', message: 'Required' }] },
        );
        const rest = setup({ saveMetaItem: vi.fn().mockRejectedValue(err) });
        const res = await callRoute(rest, 'PUT', META_ITEM, {
            params: { type: 'object', name: 'showcase_account' },
            body: { name: 'showcase_account' },
        });

        expect(res.statusCode).toBe(422);
        expect(res.body.error).toContain(head.trim());
        expect(String(res.body.error)).toHaveLength(500);
        expect(String(res.body.error).endsWith('…')).toBe(true);
        expect(res.body.issues).toHaveLength(1);
    }, 60_000);

    it('a 499 is a client status and passes through; 500 is the first withheld one', async () => {
        // The bound itself, from both sides — an off-by-one here would either
        // start withholding 4xx bodies (#5436's regression) or leave 500 open
        // (this issue's).
        for (const [status, expected] of [[499, 'verbatim'], [500, 'withheld']] as const) {
            const msg = `driver said: ${SQLITE_NO_TABLE}`;
            const rest = setup({
                getMetaItem: vi.fn().mockRejectedValue(Object.assign(new Error(msg), { status })),
            });
            const res = await callRoute(rest, 'GET', META_ITEM, {
                params: { type: 'object', name: 'showcase_account' },
            });

            expect(res.statusCode, `status ${status}`).toBe(status);
            expect(res.body.error, `status ${status}`).toBe(
                expected === 'verbatim' ? msg : INTERNAL_ERROR_MESSAGE,
            );
        }
    }, 60_000);
});
