// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8885] The approvals routes' wire codes are REGISTERED vocabulary — pins
 * for the population the card's sweep found.
 *
 * The #8885 sweep measured 9 codes reaching the wire from `packages/rest` that
 * were in neither `StandardErrorCode` nor `ERROR_CODE_LEDGER`, all in one
 * family and all with the same cause: the approvals route factories spell the
 * terminal 500 catch's code as a TEMPLATE
 * (`` `APPROVAL_${action.toUpperCase()}_FAILED` `` — `decisionRoute`,
 * `flowMoveRoute`, `threadRoute` in `rest-server.ts`), so the literal-grep
 * pass that registered their literal-spelled siblings
 * (`APPROVAL_RECALL_FAILED`, `APPROVAL_ACTIONS_FAILED`, …) never saw them; the
 * ninth, `THROTTLED`, is a single-word code the multi-token sweep shape
 * missed. All nine are registered by this card's ledger edit, and this file
 * pins them three ways:
 *
 * 1. **A live emission per channel** — the `THROTTLED` 429 through the real
 *    remind route, and one template-generated 500 through the real approve
 *    route — asserting the ADR-0112 minimum (`code` AND `status`) plus
 *    closed-union membership.
 * 2. **The class, not the instances**: the derivation case enumerates the
 *    registered `POST /approvals/requests/:id/<action>` routes and asserts the
 *    code each one's catch arm would generate parses against `ApiErrorSchema`'s
 *    closed union. A future action route whose generated code nobody registers
 *    fails HERE, mechanically — the same gap cannot reopen by adding a tenth
 *    route. The derivation mirrors the production template exactly
 *    (single-occurrence `.replace('-', '_')` included), so a route name the
 *    template would mangle into an invalid code also fails here.
 * [#14573] The file has since become the home for the approvals door's
 * live-emission pins generally, not only the #8885 population: the
 * `FORBIDDEN` → 403 case below pins a row that is registered vocabulary and
 * whose emission was — contrary to that card's premise — already observed
 * elsewhere. See its own comment for where, and why it is pinned here too.
 *
 * [#14849] Six more rows joined that home: VALIDATION_FAILED, DUPLICATE_REQUEST,
 * INVALID_STATE, REQUEST_NOT_FOUND, RESUME_TARGET_LOST and RESUME_FAILED had no
 * live-emission pin ANYWHERE — established by ablating each row and running the
 * whole `packages/rest` suite, not by grepping this file. The per-row results and
 * the instrument's positive control are recorded beside those cases below.
 *
 * 3. The union stays CLOSED — the control case in
 *    `rest-field-visibility-fault-envelope.test.ts` covers this file too (same
 *    schema instance); membership green here is evidence, not vacuity.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema } from '@objectstack/spec/api';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { RestServer } from './rest-server.js';

const REQ = '/api/v1/approvals/requests/:id';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
    };
    return res;
}

/** Boot a RestServer with a real approvals service stub wired (per #7527's harness). */
function boot(approvals: Record<string, any>) {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        findData: vi.fn().mockResolvedValue({ records: [] }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, // kernelManager
        undefined, // envRegistry
        undefined, // defaultEnvironmentIdProvider
        undefined, // authServiceProvider
        undefined, // objectQLProvider
        undefined, // emailServiceProvider
        undefined, // sharingServiceProvider
        undefined, // reportsServiceProvider
        async () => approvals, // approvalsServiceProvider
    );
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    return rest;
}

async function drive(rest: any, method: string, path: string, body: any = {}) {
    const found = rest.getRoutes().find((r: any) => r.method === method && r.path === path);
    if (!found) throw new Error(`route not registered: ${method} ${path}`);
    const res = mockRes();
    await found.handler(
        { method, path, params: { id: 'req_1' }, query: {}, headers: {}, body } as any,
        res,
    );
    return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('approvals wire codes are registered vocabulary (#8885)', () => {
    it('remind inside the cool-down answers 429 THROTTLED — the contract-documented rejection', async () => {
        const rest = boot({
            remind: vi.fn().mockRejectedValue(new Error('THROTTLED: a reminder was already sent recently')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/remind`);
        expect(answer.status).toBe(429);
        expect(answer.body?.code).toBe('THROTTLED');
        expect(answer.body?.error).toBe('a reminder was already sent recently');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'THROTTLED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    // [#14573] The `FORBIDDEN` → 403 row is the one EVERY authorisation
    // refusal rides: recall by a non-submitter, decide by a non-approver,
    // reassign / remind / sendBack / resubmit by the wrong actor, and
    // `resolveActor`'s impersonation refusals all reach this table through
    // the same single row.
    //
    // ⚠️ THIS IS A SECOND PIN, NOT THE FIRST — read this before adding a
    // third. #14573 was filed and triaged on the reading that the row had NO
    // live-emission pin, and that reading is WRONG: §7 of
    // `rest-data-door-code-prefix.test.ts` ("[#13095] the approvals door
    // strips the code it answers") already drives the REAL approve route with
    // a `FORBIDDEN: …` throw and already asserts 403, `code: 'FORBIDDEN'` and
    // the strip. Measured, not read: deleting the row from `rest-server.ts`
    // reds THREE cases — this one and both of §7's. What was true is narrower
    // than the card: the file that OWNS the approvals wire-code contract did
    // not pin the row, so a reader auditing wire codes here saw a gap that a
    // strip-contract file was silently covering. That is the gap this case
    // closes, and naming §7 here is half the fix — an unlabelled duplicate is
    // what got the card mis-filed in the first place.
    //
    // The service suites (`recall-refusal-user-copy.test.ts`,
    // `approval-revise.test.ts`) are NOT pins on this row: they assert the
    // `FORBIDDEN:` MESSAGE PREFIX at the throw site, a different fact from
    // what the route answers.
    //
    // Losing the row FAILS CLOSED, which is why this is a contract pin and not
    // a security one: `handleApprovalError` returns false on no match, the
    // caller rethrows, and the terminal catch answers 500
    // `APPROVAL_RECALL_FAILED`. The caller is still refused — at the wrong
    // status, with the wrong code, and (because that arm forwards
    // `String(error?.message ?? error)` verbatim) with the raw `FORBIDDEN: `
    // token the [#13095] anchored strip exists to remove. Two contract
    // properties ride this one row, so the third assertion below is NOT
    // redundant with the first two: it is what catches the degraded shape's
    // unstripped message. (Ablation: all three reds read
    // `expected 500 to be 403`.)
    it('recall by a non-submitter answers 403 FORBIDDEN, prefix stripped — the row every authorisation refusal rides', async () => {
        // The message the real service throws: `approval-service.ts`'s recall
        // non-submitter branch is `FORBIDDEN: ${userFacingRefusal(...)}`.
        // Read from the catalog rather than transcribed so a [#11993] copy
        // edit cannot red this pin for a reason that is not the wire contract
        // — the same construction `approval-revise.test.ts` uses.
        const refusal = BUILTIN_OPERATION_MESSAGES.en.approval_recall_not_submitter;
        const rest = boot({
            recall: vi.fn().mockRejectedValue(new Error(`FORBIDDEN: ${refusal}`)),
        });
        const answer = await drive(rest, 'POST', `${REQ}/recall`);
        expect(answer.status).toBe(403);
        expect(answer.body?.code).toBe('FORBIDDEN');
        // [#13095] Exactly the `FORBIDDEN:` this row just answered comes off,
        // and the user-facing sentence reaches the wire whole.
        expect(answer.body?.error).toBe(refusal);
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'FORBIDDEN must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    // [#13182] `READ_BACK_FAILED` is a NAMED wire row (the RESUME_FAILED
    // precedent: a genuine server-side inconsistency, but named): the write is
    // recorded and NOT rolled back, the read-back is org-filtered, and the
    // 500 semantics stay. Pinned here so the prefix→code mapping and ledger
    // membership cannot regress independently: without the mapping arm this
    // throw would ride the template-generated `APPROVAL_APPROVE_FAILED` arm —
    // a registered code whose name does not describe what happened.
    it('an org-filtered read-back on approve answers 500 READ_BACK_FAILED — named, not the template fallback', async () => {
        const rest = boot({
            decide: vi.fn().mockRejectedValue(new Error(
                "READ_BACK_FAILED: the write to approval request 'req_1' was recorded, but the updated row is "
                + "not visible inside the caller's organization scope, so the result envelope cannot be built. "
                + 'The write is NOT rolled back — read the request back with a system or matching-organization context.',
            )),
        });
        const answer = await drive(rest, 'POST', `${REQ}/approve`);
        expect(answer.status).toBe(500);
        expect(answer.body?.code).toBe('READ_BACK_FAILED');
        expect(answer.body?.error).toMatch(/^the write to approval request 'req_1' was recorded/);
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'READ_BACK_FAILED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    // ── [#14849] The six rows that had NO live-emission pin ──────────────
    //
    // Method first, because this card exists BECAUSE a grep got this wrong
    // once already: every one of the nine rows was confirmed by ABLATION, not
    // by grep. The row's regex prefix was corrupted (`/^CODE/` →
    // `/^ZZABLATED_CODE/`) so the row can never match while its literal text
    // stays in the file — a red under that mutation is therefore an
    // observation of LIVE EMISSION, never of literal presence — and the WHOLE
    // 176-file `packages/rest` suite was run for each row on its own.
    //
    // Measured 2026-09-04, one row at a time:
    //   THROTTLED         → 1 red   (its case above)
    //   FORBIDDEN         → 3 reds  (its case above, plus BOTH cases of §7 in
    //                                `rest-data-door-code-prefix.test.ts`)
    //   READ_BACK_FAILED  → 1 red   (its case above)
    //   each of the six below → 0 reds
    //
    // The FORBIDDEN leg is the instrument's positive control: it reproduces
    // the three reds the #14573 correction measured, two of them in a file
    // whose declared subject is a DIFFERENT contract — precisely the pin a
    // file-scoped grep cannot see. Same instrument, zero reds for the six ⇒
    // they were genuinely uncovered, not covered somewhere unobvious. #14849
    // predicted at least one of the six would turn out already pinned; it did
    // not, and that prediction is now answered by measurement rather than
    // carried forward as a caveat.
    //
    // Each case below drives a DIFFERENT route, so the six also cover all four
    // catch arms that call `handleApprovalError`: `decisionRoute`, the `recall`
    // route, `flowMoveRoute` and `threadRoute`. A row lost from the table fails
    // CLOSED into its arm's terminal 500 `APPROVAL_<ACTION>_FAILED`, which
    // forwards `String(error?.message ?? error)` verbatim — so `code` and the
    // stripped sentence are what catch the degraded shape, and for RESUME_FAILED
    // (already a 500) they are the ONLY things that catch it. That is the
    // ADR-0112 minimum earning its keep, not decoration.
    //
    // The thrown messages mirror the real throw sites named per case. They are
    // INPUT FIXTURES to the door, not transcriptions pinned for equality: the
    // contract under test is prefix → (status, code, [#13095] strip), so a copy
    // edit at the throw site must not red these.

    it('reassign with no `to` answers 400 VALIDATION_FAILED, prefix stripped', async () => {
        // `approval-service.ts` `reassign()` — the first thing it refuses.
        const rest = boot({
            reassign: vi.fn().mockRejectedValue(new Error('VALIDATION_FAILED: `to` (new approver) is required')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/reassign`);
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('VALIDATION_FAILED');
        expect(answer.body?.error).toBe('`to` (new approver) is required');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'VALIDATION_FAILED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('resubmit onto an already-pending record answers 409 DUPLICATE_REQUEST, prefix stripped', async () => {
        // `approval-service.ts` `resubmit()` — a second request would collide
        // on the same record, so the re-entry is refused before any mutation.
        const rest = boot({
            resubmit: vi.fn().mockRejectedValue(new Error(
                'DUPLICATE_REQUEST: another approval request is already pending on '
                + 'showcase_inquiry/rec_1 — resolve it before resubmitting',
            )),
        });
        const answer = await drive(rest, 'POST', `${REQ}/resubmit`);
        expect(answer.status).toBe(409);
        expect(answer.body?.code).toBe('DUPLICATE_REQUEST');
        expect(answer.body?.error).toMatch(/^another approval request is already pending on/);
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'DUPLICATE_REQUEST must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('recall of a request that is no longer pending answers 409 INVALID_STATE, prefix stripped', async () => {
        // `approval-service.ts` `recall()` — the row is fine, its state is not.
        const rest = boot({
            recall: vi.fn().mockRejectedValue(new Error('INVALID_STATE: request is approved')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/recall`);
        expect(answer.status).toBe(409);
        expect(answer.body?.code).toBe('INVALID_STATE');
        expect(answer.body?.error).toBe('request is approved');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'INVALID_STATE must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('revise on an id that resolves to nothing answers 404 REQUEST_NOT_FOUND, prefix stripped', async () => {
        // `approval-service.ts` `sendBack()` → `loadPendingRow()`, which throws
        // `REQUEST_NOT_FOUND: ${requestId}` when the id resolves to no row.
        // The 404 half is the whole point: without the row this degrades to a
        // 500, which reads as "the server broke" for a caller who simply named
        // a request that is not there.
        const rest = boot({
            sendBack: vi.fn().mockRejectedValue(new Error('REQUEST_NOT_FOUND: req_1')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/revise`);
        expect(answer.status).toBe(404);
        expect(answer.body?.code).toBe('REQUEST_NOT_FOUND');
        expect(answer.body?.error).toBe('req_1');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'REQUEST_NOT_FOUND must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('approve whose flow run has vanished answers 409 RESUME_TARGET_LOST, prefix stripped', async () => {
        // `approval-service.ts` `assertRunResumable()`, reached through
        // `decide()`. A conflict, like INVALID_STATE: the request is fine, the
        // run behind it is not — which is why this row is 409 and not a 500.
        const rest = boot({
            decide: vi.fn().mockRejectedValue(new Error(
                "RESUME_TARGET_LOST: the flow run 'run_1' behind request req_1 no longer exists",
            )),
        });
        const answer = await drive(rest, 'POST', `${REQ}/approve`);
        expect(answer.status).toBe(409);
        expect(answer.body?.code).toBe('RESUME_TARGET_LOST');
        expect(answer.body?.error).toMatch(/^the flow run 'run_1' behind request req_1/);
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'RESUME_TARGET_LOST must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('a recorded rejection whose run could not be resumed answers 500 RESUME_FAILED — named, not the template fallback', async () => {
        // `approval-service.ts` `resumeRecordedOutcome()`, reached through
        // `decide()`. ⚠️ This is the row where the STATUS assertion alone is
        // vacuous: the degraded shape is a 500 too. What separates "named" from
        // "the template fallback" is the `code` — `APPROVAL_REJECT_FAILED`
        // without the row — and the [#13095] strip, which the fallback arm does
        // not perform, so the caller would read the raw `RESUME_FAILED: ` token.
        // Both are asserted below; neither is redundant with the first.
        const rest = boot({
            decide: vi.fn().mockRejectedValue(new Error(
                "RESUME_FAILED: the rejection was recorded on request req_1, but its flow run 'run_1' "
                + 'could not be resumed — an operator has to advance it',
            )),
        });
        const answer = await drive(rest, 'POST', `${REQ}/reject`);
        expect(answer.status).toBe(500);
        expect(answer.body?.code).toBe('RESUME_FAILED');
        expect(answer.body?.error).toMatch(/^the rejection was recorded on request req_1/);
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'RESUME_FAILED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('an unmapped service fault on approve answers 500 APPROVAL_APPROVE_FAILED — the template-generated arm, live', async () => {
        const rest = boot({
            decide: vi.fn().mockRejectedValue(new Error('kaboom: not in the mapping table')),
        });
        const answer = await drive(rest, 'POST', `${REQ}/approve`);
        expect(answer.status).toBe(500);
        expect(answer.body?.code).toBe('APPROVAL_APPROVE_FAILED');
        expect(
            ApiErrorSchema.safeParse({ code: answer.body?.code, message: answer.body?.error }).success,
            'APPROVAL_APPROVE_FAILED must be in StandardErrorCode ∪ ERROR_CODE_LEDGER',
        ).toBe(true);
    });

    it('every POST /approvals/requests/:id/<action> route generates a REGISTERED terminal code (the class pin)', () => {
        const rest = boot({}) as any;
        const actions: string[] = rest.getRoutes()
            .filter((r: any) => r.method === 'POST')
            .map((r: any) => /^\/api\/v1\/approvals\/requests\/:id\/([a-z][a-z-]*)$/.exec(r.path)?.[1])
            .filter((a: string | undefined): a is string => a !== undefined);
        // Anti-vacuity floor: the route shape this derivation reads must still
        // exist — if a refactor moves the paths, this fails HERE rather than
        // leaving the loop below green over an empty list. Deliberately a
        // SUBSET check: a new action route joins the loop automatically (which
        // is the point — its generated code is judged for membership without
        // anyone editing this file).
        expect(actions).toEqual(expect.arrayContaining([
            'approve', 'reject', 'recall', 'revise', 'resubmit',
            'reassign', 'remind', 'request-info', 'comment',
        ]));
        for (const action of actions) {
            // EXACTLY the production template (single-occurrence replace, per
            // `threadRoute`): if the template would mangle a future action name
            // into an invalid code, this derivation mangles identically and the
            // parse below goes red.
            const code = `APPROVAL_${action.toUpperCase().replace('-', '_')}_FAILED`;
            expect(
                ApiErrorSchema.safeParse({ code, message: 'x' }).success,
                `terminal code ${code} (route action '${action}') must be registered in ERROR_CODE_LEDGER`,
            ).toBe(true);
        }
    });
});
