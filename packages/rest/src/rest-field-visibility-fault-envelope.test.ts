// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8885] ADR-0112 pins for the two wire codes the card measured, on the REST
 * emitters themselves.
 *
 * ## 1. `sendFieldVisibilityFault` — the ADR-0106 D6 tier-3 refusal
 *
 * The deployment docs (`content/docs/deployment/production-readiness.mdx`)
 * advertise `FIELD_VISIBILITY_UNRESOLVED` as a real operator signal, and until
 * this file NO test anywhere asserted the emission — the exact
 * documented-but-unpinned shape Prime Directive #10 names. #9170 registered
 * the code in `ERROR_CODE_LEDGER`; this is the other half the card owed, the
 * envelope minimum (`code` AND `status`) on the tier-3 path.
 *
 * What the pin deliberately records about the BODY: `sendError` routes a
 * declared 5xx through the #5437 sanitization, so the emitter's carefully
 * worded message ("Field visibility for object 'x' could not be evaluated…")
 * is WITHHELD from the wire — the client reads `INTERNAL_ERROR_MESSAGE`, and
 * the original text reaches the operator via `logWithheldServerFault`. That is
 * current, ruled behaviour (#5437: a declared 5xx never ships its own prose),
 * pinned here so a future edit that starts shipping the prose is a decision,
 * not drift.
 *
 * ## 2. `mapDataError`'s comment-access branch — `RECORD_NOT_ACCESSIBLE`
 *
 * #8885's table claimed this code is in NEITHER `StandardErrorCode` nor the
 * ledger. That row was a measurement error: `RECORD_NOT_ACCESSIBLE` has been a
 * `StandardErrorCode` member (Authorization block, "Sharing rule restriction")
 * since before the card's own measured commit — the #4630 branch comment
 * ("uses the STANDARD catalog code") is correct as written. The membership
 * case below pins that fact so the premise cannot be re-reported, and the
 * emission case is the characterization baseline (`code` + 403 + the
 * `error.object` preference) the card asked for.
 *
 * ## Why the vocabulary parse maps `{ code, error }` → `{ code, message }`
 *
 * These data-door bodies are the FLAT dialect (`code` beside `error`), #7035's
 * declared debt held by the `check:route-envelope` ratchet — the envelope
 * POSITION is that card's business, not this one's. What THIS card owes is the
 * VOCABULARY: `ApiErrorSchema.code` is the closed union
 * (`StandardErrorCode ∪ ERROR_CODE_LEDGER`), so each case parses the wire
 * code + message through `ApiErrorSchema` slots to assert union membership,
 * and a control case proves the union is closed (an unregistered spelling
 * fails parse) so the green here is evidence rather than vacuous.
 */

import { describe, it, expect, vi } from 'vitest';
import { ApiErrorSchema, StandardErrorCode, ERROR_CODE_LEDGER } from '@objectstack/spec/api';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
// `.js` on purpose — NodeNext resolution requires the extension (#7248).
import { sendFieldVisibilityFault, mapDataError } from './error-response.js';

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        header: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/** The vocabulary half: the wire pair parses through `ApiErrorSchema`'s slots. */
function expectVocabulary(code: unknown, message: unknown) {
    const parsed = ApiErrorSchema.safeParse({ code, message });
    expect(parsed.success, `code ${String(code)} must be in StandardErrorCode ∪ ERROR_CODE_LEDGER`)
        .toBe(true);
}

describe('sendFieldVisibilityFault — ADR-0106 D6 tier 3 (#8885)', () => {
    it('answers 503 with code FIELD_VISIBILITY_UNRESOLVED (the ADR-0112 envelope minimum)', () => {
        const res = mockRes();
        sendFieldVisibilityFault(res, 'task');
        expect(res.statusCode).toBe(503);
        const body = res.json.mock.calls.at(-1)?.[0];
        expect(body?.code).toBe('FIELD_VISIBILITY_UNRESOLVED');
        // #5437: a declared 5xx never ships its own prose — the emitter's
        // message is withheld from the client and logged for the operator.
        expect(body?.error).toBe(INTERNAL_ERROR_MESSAGE);
        expectVocabulary(body?.code, body?.error);
    });

    it('is registered in the ledger under @objectstack/rest (#9170), and the union is CLOSED', () => {
        expect(ERROR_CODE_LEDGER['@objectstack/rest']).toContain('FIELD_VISIBILITY_UNRESOLVED');
        // Control: an invented spelling fails parse — which is what makes the
        // membership assertions in this file evidence rather than vacuous.
        expect(
            ApiErrorSchema.safeParse({ code: 'FIELD_VISIBILITY_UNRESOLVED_X', message: 'x' }).success,
        ).toBe(false);
    });
});

describe('mapDataError comment-access branch — RECORD_NOT_ACCESSIBLE (#8885)', () => {
    it('RECORD_NOT_ACCESSIBLE is a StandardErrorCode member — the #4630 comment is right, the card’s table row was not', () => {
        expect(StandardErrorCode.safeParse('RECORD_NOT_ACCESSIBLE').success).toBe(true);
        // And therefore it must NOT be registered in the ledger — the admission
        // gate refuses codes that shadow the standard catalog.
        for (const codes of Object.values(ERROR_CODE_LEDGER)) {
            expect(codes).not.toContain('RECORD_NOT_ACCESSIBLE');
        }
    });

    it('answers 403 with code RECORD_NOT_ACCESSIBLE, preferring the error’s own object (characterization baseline)', () => {
        // The shape plugin-audit's #4630 engine hooks throw: the gated RECORD's
        // object rides on `error.object`; the route saw the join table.
        const answer = mapDataError(
            { code: 'RECORD_NOT_ACCESSIBLE', message: 'Record access denied', object: 'task' },
            'sys_comment',
        );
        expect(answer.status).toBe(403);
        expect(answer.body.code).toBe('RECORD_NOT_ACCESSIBLE');
        expect(answer.body.error).toBe('Record access denied');
        expect(answer.body.object).toBe('task');
        expectVocabulary(answer.body.code, answer.body.error);
    });
});
