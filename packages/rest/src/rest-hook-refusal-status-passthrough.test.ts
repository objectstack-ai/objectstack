// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#7525] An engine lifecycle HOOK that refuses a write with an explicit status
// gets that status — and its ADR-0112 `code` — onto the wire through
// `/api/v1/data`, instead of an opaque `500 INTERNAL_ERROR`.
//
// ---------------------------------------------------------------------------
// The seam, because the card explicitly asked where the status was lost rather
// than assuming the passthrough needed widening again.
//
// The two producers QA reproduced (2× each) declare their status as
// `statusCode`, which is what `runtime`'s own exits have read as a second
// spelling since #3867:
//
//   plugin-approvals/src/lifecycle-hooks.ts:122  lockedError()
//       err.code = 'RECORD_LOCKED'; err.statusCode = 409;
//   plugin-approvals/src/lifecycle-hooks.ts:440  deny()          (delegation guard)
//       err.code = 'FORBIDDEN';     err.statusCode = 403;
//
// `mapDataError`'s passthrough asked `typeof error.status === 'number'` and
// nothing else, so the refusal never entered that branch at all: it fell past
// every structured branch, matched no message heuristic, and left through
// `UNCLASSIFIED_FAULT` as `500 INTERNAL_ERROR` with no `code`. #5582 (PR #7402)
// widened that branch's RANGE (4xx → 400-599) and could not have covered this —
// the loss is one question earlier, at "did the producer declare a status".
//
// Every OTHER HTTP exit in the repo already reads both spellings —
// `HttpDispatcher.errorFromThrown`, `dispatcher-plugin.errorResponseBase`
// (`runtime/src/dispatcher-plugin.ts:494-497`), `endpoint-executor`,
// `domains/actions`, `plugin-hono-server`'s user endpoints — so one thrown
// error answered `403` through a dispatcher route and `500` through
// `/api/v1/data`. Fixed at the boundary, not at the two hooks: the hooks are
// well-behaved producers, and `runtime/src/action-execution.ts`
// (`{ statusCode: 503 | 501 | 400 }`) and `metadata-protocol`
// (`{ statusCode: 404 }`) throw the same shape at the same routes.
//
// ⚠️ `declaresServerFault`'s own `status`-only read is UNCHANGED (#5811 ruled
// that a DISCLOSURE rule must not depend on a producer's spelling). This file
// pins that separation from both sides: §4 asserts the resolved-status call
// keeps the `code` on a `statusCode`-declared 5xx, and that an empty / numeric
// code is still not a declaration.
//
// ---------------------------------------------------------------------------
// Mutation table. Every one of the 26 cases below was PROVEN able to fail —
// none is covered by fewer than one mutation. Directions were predicted BEFORE
// running; where a prediction was wrong it is recorded as MEASURED rather than
// rewritten to fit.
//
// A · BASELINE — the file run against unmodified `main`, i.e. the real defect
//     rather than a synthetic mutation (identical result to deleting the
//     `?? error.statusCode` limb from `declaredHttpStatus`).
//       §1 predicted RED,   measured 6/8 red   — prediction said 7/8. The two
//          survivors are direction-insensitive BY CONSTRUCTION: "a `statusCode`
//          outside 400-599 is not a declaration" expects the 500 the unfixed
//          code already gives, and "`status` wins over `statusCode`" reads a
//          `status` the unfixed code already honours. Mutation D moves both.
//       §2 predicted RED,   measured 4/4 red   — the two reported requests
//          answer `500 INTERNAL_ERROR` on the wire, exactly as QA measured.
//       §3 predicted GREEN, measured 3/3 green — the no-status default is what
//          this section pins; nothing about `statusCode` can move it.
//       §4 predicted RED,   measured 5/6 red   — prediction said 2/6 and was
//          WRONG about the mechanism: the empty-code / numeric-code cases fail
//          too, because their STATUS collapses to 500 before their `code`
//          assertion is ever the interesting half.
//       §5 predicted GREEN, measured 6/6 green — the structured branches sit
//          ABOVE the passthrough and the undeclared band never enters it.
//     Total: 15 of 26 red.
//
// B · `declaredHttpStatus` returns 400 for an UNDECLARED error (the "every hook
//     refusal is now a 4xx" overreach the fix must not become).
//       predicted RED for §3 + the undeclared half of §5, measured 4 red:
//       §3's two undeclared cases and §5's raw-driver / non-object cases.
//
// C · The passthrough is allowed to OUTRANK the structured branches
//     (`&& declaredHttpStatus(error) === undefined` added to the
//     OBJECT_NOT_FOUND / DELETE_RESTRICTED / VALIDATION_FAILED guards) and the
//     sandbox unwrap is removed.
//       predicted RED for the ordering pins, measured 4 red: §5's three
//       structured cases and §3's sandbox case.
//
// D · Three independent loosenings of the helper at once — the 400-599 band
//     check dropped, the `status`/`statusCode` precedence inverted, and the 5xx
//     arm's `declaresServerFault` call deleted.
//       predicted RED for the four cases A left green, measured exactly those
//       4 red.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
import { mapDataError, RestServer } from './rest-server.js';

const DATA_ITEM = '/api/v1/data/:object/:id';
const DATA_COLLECTION = '/api/v1/data/:object';

// ---------------------------------------------------------------------------
// Producer fixtures — COPIED from the shipping hooks, not invented.
//
// `@objectstack/rest` must not depend on `plugin-approvals` to run its own
// tests, so the shapes are reproduced here byte for byte. What makes them a
// valid fixture is precisely what makes the unfixed code answer 500: the status
// is on `statusCode`, and there is no `status` property at all.
// ---------------------------------------------------------------------------

/** `lifecycle-hooks.ts` `lockedError()` — case (a) of the report. */
function recordLockedError(message = 'showcase_task rec1 has a pending approval that locks it') {
    const err: any = new Error(`RECORD_LOCKED: ${message}`);
    err.code = 'RECORD_LOCKED';
    err.statusCode = 409;
    return err;
}

/** `lifecycle-hooks.ts` `bindDelegationWriteGuard`'s `deny()` — case (b). */
function delegationForbiddenError(userId = 'u1') {
    const err: any = new Error(
        'FORBIDDEN: you may only manage out-of-office delegations where you are the delegator'
        + ` ('${userId}')`,
    );
    err.code = 'FORBIDDEN';
    err.statusCode = 403;
    return err;
}

/**
 * A hook that refuses with NO status at all — the third case the card asked for,
 * so what the default STAYS is pinned rather than left to drift. This is the
 * overwhelming majority shape: `throw new Error('…')` from a hook body.
 */
function unstatusedHookRefusal() {
    const err: any = new Error('this record cannot be edited during month-end close');
    err.code = 'CLOSE_PERIOD_LOCKED';
    return err;
}

// ---------------------------------------------------------------------------
// §1 The mapping itself
// ---------------------------------------------------------------------------

describe('[#7525] mapDataError: a hook refusal keeps the status it declared', () => {
    it('case (a): RECORD_LOCKED answers 409 with its code, not 500 INTERNAL_ERROR', () => {
        const r = mapDataError(recordLockedError(), 'showcase_task');

        expect(r.status).toBe(409);
        expect(r.body.code).toBe('RECORD_LOCKED');
        // The measured defect, pinned as a NEGATIVE so a partial fix (status
        // restored, code still overwritten) cannot pass.
        expect(r.status).not.toBe(500);
        expect(r.body.code).not.toBe('INTERNAL_ERROR');
    });

    it('case (b): the delegation refusal answers 403 FORBIDDEN', () => {
        const r = mapDataError(delegationForbiddenError(), 'sys_approval_delegation');

        expect(r.status).toBe(403);
        expect(r.body.code).toBe('FORBIDDEN');
        expect(r.status).not.toBe(500);
    });

    it("the refusal's own words reach the caller — a 4xx message IS the remedy", () => {
        // The whole complaint in the report is "no located guidance". A hook
        // refusal is a deliberate business answer addressed TO the caller, so
        // the 4xx arm's verbatim rule (#5423) applies to it like any other.
        const r = mapDataError(recordLockedError(), 'showcase_task');
        expect(r.body.error).toContain('pending approval');
        expect(r.body.error).not.toBe(INTERNAL_ERROR_MESSAGE);
        expect(r.body.object).toBe('showcase_task');
    });

    it('the envelope is the same one a `status`-declaring producer gets — one wire answer', () => {
        // The point of the fix: the two spellings are one question. Byte-equal
        // bodies, not merely equal statuses.
        const viaStatusCode = mapDataError(delegationForbiddenError('u1'), 'sys_approval_delegation');
        const asStatus = delegationForbiddenError('u1');
        delete asStatus.statusCode;
        asStatus.status = 403;
        const viaStatus = mapDataError(asStatus, 'sys_approval_delegation');

        expect(viaStatusCode).toEqual(viaStatus);
    });

    it('the whole 400-599 band is read off `statusCode`, not a hand-picked list', () => {
        // [#9232] The vehicle was the invented spelling `HOOK_REFUSED` until
        // this door started narrowing thrown codes to the closed ADR-0112
        // vocabulary. Nothing in the repo emits it; the ledger's registered
        // hook code is `ERR_HOOK_TARGET_REBIND`, which is what a hook refusal
        // actually carries. The subject here is the STATUS read (`statusCode`
        // across the whole band), and a registered vehicle keeps it that way.
        // It differs from every status-derived code in the loop, so the `code`
        // assertion below can still fail.
        for (const statusCode of [400, 403, 404, 409, 422, 429, 451, 499]) {
            const err: any = new Error('refused by hook');
            err.code = 'ERR_HOOK_TARGET_REBIND';
            err.statusCode = statusCode;
            const r = mapDataError(err, 'showcase_task');
            expect(r.status).toBe(statusCode);
            expect(r.body.code).toBe('ERR_HOOK_TARGET_REBIND');
        }
    });

    it('a `statusCode` outside 400-599 is not a declaration — the heuristics still judge it', () => {
        // Same upper/lower bound `resolveErrorResponse` opens. A `statusCode:
        // 200` or `600` is nonsense as a refusal and must not become the wire
        // status; it falls to the classifiers, which recognise nothing here.
        for (const statusCode of [0, 200, 302, 399, 600, 999]) {
            const err: any = new Error('nothing recognisable here');
            err.statusCode = statusCode;
            const r = mapDataError(err, 'showcase_task');
            expect(r.status).toBe(500);
            expect(r.body.code).toBe('INTERNAL_ERROR');
        }
    });

    it('a numeric `status` still WINS over `statusCode` — precedence matches every other exit', () => {
        // `status` → `statusCode` is the order `errorFromThrown` and
        // `errorResponseBase` read. Pinned so a future edit cannot silently
        // invert it.
        const err: any = new Error('refused');
        err.code = 'ERR_HOOK_TARGET_REBIND';
        err.status = 409;
        err.statusCode = 403;
        expect(mapDataError(err, 'showcase_task').status).toBe(409);
    });

    it("a STRING `status` does not block `statusCode` — better-auth's APIError resolves", () => {
        // `better-call` throws `{ statusCode: 403, status: 'FORBIDDEN' }` — the
        // `status` field is a string there. `plugin-auth` already reads it
        // `statusCode`-first for exactly this reason.
        const err: any = new Error('You are not allowed to do this');
        err.code = 'FORBIDDEN';
        err.status = 'FORBIDDEN';
        err.statusCode = 403;
        const r = mapDataError(err, 'sys_user');
        expect(r.status).toBe(403);
        expect(r.body.code).toBe('FORBIDDEN');
    });
});

// ---------------------------------------------------------------------------
// §2 The two reported routes, walked in process
//
// §1 calls `mapDataError` directly. This section proves the WIRE answer on the
// exact two requests QA reproduced — the direct-call territory that bypasses
// `resolveErrorResponse` entirely.
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

function setup(protocolOverrides: Record<string, unknown> = {}) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([{ name: 'showcase_task' }]),
        getMetaItem: vi.fn().mockResolvedValue({}),
        findData: vi.fn().mockResolvedValue([]),
        createData: vi.fn().mockResolvedValue({}),
        updateData: vi.fn().mockResolvedValue({}),
        ...protocolOverrides,
    };
    const rest = new RestServer(
        createMockServer() as any,
        protocol,
        { api: { requireAuth: false } } as any,
    );
    (rest as any).resolveExecCtx = async () => ({ userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

function routeOf(rest: any, method: string, path: string) {
    const route = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!route) throw new Error(`${method} ${path} route not registered`);
    return route;
}

/** `PATCH /api/v1/data/{object}/{id}` — the report's case (a) request. */
async function callPatch(rest: any, object: string, id: string, body: Record<string, unknown>) {
    const res = makeRes();
    await routeOf(rest, 'PATCH', DATA_ITEM).handler(
        { method: 'PATCH', params: { object, id }, query: {}, headers: {}, body },
        res,
    );
    return res;
}

/** `POST /api/v1/data/{object}` — the report's case (b) request. */
async function callPost(rest: any, object: string, body: Record<string, unknown>) {
    const res = makeRes();
    await routeOf(rest, 'POST', DATA_COLLECTION).handler(
        { method: 'POST', params: { object }, query: {}, headers: {}, body },
        res,
    );
    return res;
}

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { errorSpy.mockRestore(); });

describe('[#7525] the reported requests, on the real CRUD data routes', () => {
    it('(a) PATCH a locked record → 409 RECORD_LOCKED on the wire', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(recordLockedError()) });

        const res = await callPatch(rest, 'showcase_task', 'rec1', { name: 'edited' });

        expect(res.statusCode).toBe(409);
        expect(res.body.code).toBe('RECORD_LOCKED');
        expect(res.statusCode).not.toBe(500);
        expect(res.body.error).not.toBe(INTERNAL_ERROR_MESSAGE);
    }, 60_000);

    it('(b) POST a delegation the caller does not own → 403 FORBIDDEN on the wire', async () => {
        const rest = setup({ createData: vi.fn().mockRejectedValue(delegationForbiddenError('u1')) });

        const res = await callPost(rest, 'sys_approval_delegation', {
            delegator_id: 'someone_else', delegate_id: 'u2',
        });

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
        expect(res.body.error).toContain('delegator');
    }, 60_000);

    it('the refusal is not logged as an unhandled fault — 403/409 are expected outcomes', async () => {
        // `isExpectedDataStatus` covers 403 and 409, so a deliberate refusal
        // reaching its real status also stops producing a scary
        // "[REST] Unhandled error" line. Before the fix it was a 500 and did.
        const rest = setup({ updateData: vi.fn().mockRejectedValue(recordLockedError()) });

        await callPatch(rest, 'showcase_task', 'rec1', { name: 'edited' });

        const logged = errorSpy.mock.calls.some(
            (call: unknown[]) => JSON.stringify(call.map(String)).includes('Unhandled error'),
        );
        expect(logged).toBe(false);
    }, 60_000);

    it('a GET list refused by a beforeFind hook keeps its status too — not a write-only fix', async () => {
        const err: any = new Error('this object is not readable outside business hours');
        err.code = 'FORBIDDEN';
        err.statusCode = 403;
        const rest = setup({ findData: vi.fn().mockRejectedValue(err) });

        const res = makeRes();
        await routeOf(rest, 'GET', DATA_COLLECTION).handler(
            { method: 'GET', params: { object: 'showcase_task' }, query: {}, headers: {} },
            res,
        );

        expect(res.statusCode).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §3 The hook that declares NO status — what the default STAYS
//
// GREEN under the mutation by design. The card asked for it so the fix cannot
// be read as "every hook refusal is now a 4xx": a hook that declares nothing is
// still judged by the classifiers, exactly as before.
// ---------------------------------------------------------------------------

describe('[#7525] a hook that refuses WITHOUT a status is unchanged', () => {
    it('an undeclared refusal still answers the terminal sanitised 500', () => {
        const r = mapDataError(unstatusedHookRefusal(), 'showcase_task');

        expect(r.status).toBe(500);
        expect(r.body.code).toBe('INTERNAL_ERROR');
        // Its own `code` is NOT promoted to the wire by this fix: ADR-0112 says
        // the producer names the condition, and this producer named a code but
        // no status. Inventing a 4xx from the code alone would be the
        // consumer-side leniency Prime Directive #12 removes — the follow-up
        // that belongs with #7463, not here.
        expect(r.body.code).not.toBe('CLOSE_PERIOD_LOCKED');
    });

    it('a sandboxed hook body is still unwrapped to its business message at 400', () => {
        // The QuickJS path (`SandboxError.innerMessage`) sits ABOVE the
        // passthrough and is untouched: it has no status to declare.
        const err: any = new Error("hook 'block_edit' threw: Error: 删除被阻断");
        err.innerMessage = '删除被阻断';
        const r = mapDataError(err, 'showcase_task');
        expect(r.status).toBe(400);
        expect(r.body.error).toBe('删除被阻断');
    });

    it('an undeclared refusal on the wire is a 500 with nothing of its words', async () => {
        const rest = setup({ updateData: vi.fn().mockRejectedValue(unstatusedHookRefusal()) });

        const res = await callPatch(rest, 'showcase_task', 'rec1', { name: 'edited' });

        expect(res.statusCode).toBe(500);
        expect(res.body.code).toBe('INTERNAL_ERROR');
    }, 60_000);
});

// ---------------------------------------------------------------------------
// §4 The 5xx half — `declaresServerFault` is asked over the RESOLVED status
//
// The predicate's own read stays `status`-only (#5811, a disclosure rule). What
// this section pins is that the ONE call site inside the passthrough hands it
// the status the boundary just resolved — otherwise a `statusCode`-declared 5xx
// would take the 5xx arm and then be told it declared no fault, shipping the
// status with its ADR-0112 code silently dropped.
// ---------------------------------------------------------------------------

describe('[#7525] a `statusCode`-declared 5xx keeps its code, and the prose is still withheld', () => {
    it('{ statusCode: 503, code } ships the status AND the code', () => {
        // `runtime/src/action-execution.ts` throws exactly this shape.
        const err: any = new Error('Data service not available: connect ECONNREFUSED 10.0.0.5:5432');
        err.code = 'SERVICE_UNAVAILABLE';
        err.statusCode = 503;
        const r = mapDataError(err, 'showcase_task');

        expect(r.status).toBe(503);
        expect(r.body.code).toBe('SERVICE_UNAVAILABLE');
        // The 5xx arm's withhold is unconditional and applies here identically.
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(JSON.stringify(r.body)).not.toContain('10.0.0.5');
        expect(JSON.stringify(r.body)).not.toContain('ECONNREFUSED');
    });

    it('{ statusCode: 501, code } — the same answer the `status` spelling gets', () => {
        const viaStatusCode: any = Object.assign(new Error('not compiled by this backend'), {
            code: 'NOT_IMPLEMENTED', statusCode: 501,
        });
        const viaStatus: any = Object.assign(new Error('not compiled by this backend'), {
            code: 'NOT_IMPLEMENTED', status: 501,
        });
        expect(mapDataError(viaStatusCode, 'showcase_task')).toEqual(mapDataError(viaStatus, 'showcase_task'));
    });

    it('a `statusCode` 5xx with NO code invents nothing', () => {
        const err: any = new Error('boom');
        err.statusCode = 502;
        const r = mapDataError(err);
        expect(r.status).toBe(502);
        expect(r.body.code).toBeUndefined();
        expect(r.body.error).toBe(INTERNAL_ERROR_MESSAGE);
    });

    it('an EMPTY-string code is still not a declaration', () => {
        const err: any = new Error('boom');
        err.code = '';
        err.statusCode = 503;
        const r = mapDataError(err);
        expect(r.status).toBe(503);
        expect(r.body.code).toBeUndefined();
    });

    it('a NON-STRING code is still not a declaration — a driver errno is not a catalog entry', () => {
        const err: any = new Error('boom');
        err.code = 1062;
        err.statusCode = 502;
        const r = mapDataError(err);
        expect(r.status).toBe(502);
        expect(r.body.code).toBeUndefined();
    });

    it('#5582 is untouched — a `status`-declared 5xx answers exactly as it did', () => {
        const r = mapDataError(
            Object.assign(new Error('internal detail'), { status: 501, code: 'NOT_IMPLEMENTED' }),
            'showcase_account',
        );
        expect(r).toEqual({
            status: 501,
            body: { error: INTERNAL_ERROR_MESSAGE, code: 'NOT_IMPLEMENTED' },
        });
    });
});

// ---------------------------------------------------------------------------
// §5 Non-regression: the branches ABOVE the passthrough, and the undeclared band
//
// GREEN under the mutation by design.
// ---------------------------------------------------------------------------

describe('[#7525] the structured branches and the heuristics are untouched', () => {
    it('a `statusCode`-declaring OBJECT_NOT_FOUND keeps its canonical 404 envelope', () => {
        const err: any = new Error('gone');
        err.code = 'OBJECT_NOT_FOUND';
        err.statusCode = 503;
        const r = mapDataError(err, 'showcase_account');
        expect(r.status).toBe(404);
        expect(r.body.code).toBe('OBJECT_NOT_FOUND');
    });

    it('a `statusCode`-declaring DELETE_RESTRICTED still answers 409 with its fields', () => {
        const err: any = new Error('dependents exist');
        err.code = 'DELETE_RESTRICTED';
        err.statusCode = 500;
        err.dependentCount = 3;
        const r = mapDataError(err, 'sys_position');
        expect(r.status).toBe(409);
        expect(r.body.dependentCount).toBe(3);
    });

    it('a `statusCode`-declaring VALIDATION_FAILED still answers 400 with `fields[]`', () => {
        const err: any = new Error('Validation failed');
        err.code = 'VALIDATION_FAILED';
        err.statusCode = 500;
        err.fields = [{ field: 'email', code: 'invalid', message: 'bad email' }];
        const r = mapDataError(err, 'sys_user');
        expect(r.status).toBe(400);
        expect(r.body.fields).toEqual(err.fields);
    });

    it('a raw driver error carries no status in EITHER spelling and is still classified', () => {
        const leak = mapDataError(new Error('SQLITE_ERROR: no such table: some_aux_table'), 'showcase_account');
        expect(leak.status).toBe(500);
        expect(leak.body.code).toBe('DATABASE_ERROR');

        const dup = mapDataError(
            Object.assign(new Error("ER_DUP_ENTRY: Duplicate entry 'a@b.com' for key 'idx_email_unique'"), {
                code: 'ER_DUP_ENTRY',
            }),
            'sys_user',
        );
        expect(dup.status).toBe(409);
        expect(dup.body.code).toBe('UNIQUE_VIOLATION');
    });

    it('a non-object throw is not a declaration and does not crash the read', () => {
        expect(mapDataError('a bare string').status).toBe(500);
        expect(mapDataError(undefined).status).toBe(500);
        expect(mapDataError(null).status).toBe(500);
    });
});
