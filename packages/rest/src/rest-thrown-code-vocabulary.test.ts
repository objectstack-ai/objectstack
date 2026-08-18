// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#9232] The FLAT door speaks the closed ADR-0112 vocabulary too.
//
// ---------------------------------------------------------------------------
// What this file pins, and why both halves are load-bearing
// ---------------------------------------------------------------------------
// The 2026-08-16 ruling on #9106 made `error.code` a closed vocabulary at every
// door and demoted an unregistered thrown spelling to a `declaredCode` sibling.
// Its scope named the doors served by `resolveThrownHttpError` — the dispatcher
// exits and the direct-mount package registrar — so `packages/rest`'s FLAT
// responder, which puts `code` at the body's TOP level rather than in
// `error.code`, stayed outside it and went on passing a caught error's `code`
// through verbatim. The ADR then read "closed at every door" absolutely while an
// observable door contradicted it, which is the reader ambiguity #9106 was filed
// to remove, moved one door over. The 2026-08-17 ruling on #9232 closed it:
// body POSITION is not a carve-out from the vocabulary.
//
// Two halves, and the second is not decoration:
//
//   ① an unregistered thrown `code` is DEMOTED — the status-derived member
//      arrives in `code`, the producer's string in `declaredCode`;
//   ② a REGISTERED thrown `code` still arrives in `code`, verbatim, with no
//      `declaredCode` beside it.
//
// Half ② is what stops an over-eager narrowing from swallowing valid codes. A
// door that answered `INTERNAL_ERROR` for everything would satisfy half ① on
// every case in this file and would have destroyed the vocabulary it was
// written to protect — and it would do so silently, because a body carrying a
// registered code parses exactly like one carrying the right registered code.
//
// ---------------------------------------------------------------------------
// Why the assertions are `code` + `status` pairs, never `toThrow`
// ---------------------------------------------------------------------------
// These doors SEND (or return a body); they never throw. A `toThrow`-shaped
// assertion could not separate "answered with the wrong code" from "did not
// answer at all", and the wrong code IS the defect. Per ADR-0112 every case
// asserts the wire pair the envelope declares.
//
// ---------------------------------------------------------------------------
// Reverse verification, direction predicted BEFORE running
// ---------------------------------------------------------------------------
// Restoring any one of the four verbatim passthroughs (`{ code: error.code }`)
// turns the demote cases in §1 RED — they assert a body that only exists once
// the narrowing runs — and leaves every §2 case GREEN, because a registered
// code is passed through identically by both the old and the new arm. That
// asymmetry is the point of keeping §2: it is the half a regression does NOT
// redden, so it can only be defended by being written down. Confirmed by
// running it; see the PR.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ErrorCode, standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { INTERNAL_ERROR_MESSAGE } from '@objectstack/types';
// `.js` extension deliberately: this package resolves `nodenext`, so an
// extensionless relative import is a `tsc` error (TS2835). The neighbouring
// suites omit it and are part of this package's frozen TEST_DEBT — a new file
// must not add to a shrink-only ratchet.
import { mapDataError, sendThrownError, sendDeclaredFault } from './error-response.js';

// ---------------------------------------------------------------------------
// Vehicles
// ---------------------------------------------------------------------------

/**
 * A spelling the ledger deliberately does not know. Not a placeholder: what
 * these cases pin is the DEMOTE, not any particular producer, and a code that
 * someone might register later would silently turn every §1 case vacuous.
 * The control below proves the union really rejects it.
 */
const UNREGISTERED = 'PACKAGE_IS_HAUNTED';

/** A registered member, for the half that must keep arriving verbatim. */
const REGISTERED = 'RECORD_LOCKED';

function makeRes() {
    const res: any = { statusCode: 200, body: undefined };
    res.status = vi.fn((c: number) => { res.statusCode = c; return res; });
    res.json = vi.fn((b: any) => { res.body = b; return res; });
    return res;
}

/** Drive the flat door end to end and read the wire answer. */
function wire(error: any, object?: string): { status: number; body: any } {
    const res = makeRes();
    sendThrownError(res, error, object);
    return { status: res.statusCode, body: res.body };
}

/** `.status` reaches `resolveErrorResponse`'s passthrough; `.statusCode` falls to `mapDataError`. */
const thrownWithStatus = (status: number, code?: unknown) =>
    Object.assign(new Error('boom'), { status, ...(code !== undefined ? { code } : {}) });
const thrownWithStatusCode = (statusCode: number, code?: unknown) =>
    Object.assign(new Error('boom'), { statusCode, ...(code !== undefined ? { code } : {}) });

/**
 * The four flat arms a thrown error can leave through, each reached by the
 * spelling/band combination named beside it. Enumerated rather than tested one
 * at a time because the defect this card measured was FOUR verbatim
 * passthroughs, and a fix that reached three of them would read as done.
 */
const ARMS = [
    {
        name: 'resolveErrorResponse 4xx (`.status`)',
        answer: (code: unknown) => wire(thrownWithStatus(409, code)),
        status: 409,
    },
    {
        name: 'resolveErrorResponse 5xx (`.status`)',
        answer: (code: unknown) => wire(thrownWithStatus(503, code)),
        status: 503,
    },
    {
        name: 'mapDataError 4xx (`.statusCode`)',
        answer: (code: unknown) => {
            const r = mapDataError(thrownWithStatusCode(409, code));
            return { status: r.status, body: r.body };
        },
        status: 409,
    },
    {
        name: 'mapDataError 5xx (`.statusCode`)',
        answer: (code: unknown) => {
            const r = mapDataError(thrownWithStatusCode(503, code));
            return { status: r.status, body: r.body };
        },
        status: 503,
    },
] as const;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    // The 5xx arms log the withheld original through `logWithheldServerFault`
    // (#5437). That is correct behaviour and not this file's subject.
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { errorSpy.mockRestore(); });

// ---------------------------------------------------------------------------
// Anti-vacuity: the union really is closed
// ---------------------------------------------------------------------------

describe('#9232 — the control that makes the rest of this file evidence', () => {
    it('the vehicle is genuinely unregistered and the comparison code genuinely registered', () => {
        expect(ErrorCode.safeParse(UNREGISTERED).success).toBe(false);
        expect(ErrorCode.safeParse(REGISTERED).success).toBe(true);
    });

    it('the two spellings really do produce different answers', () => {
        // Without this, "demoted" and "passed through" could be the same string
        // and every assertion below would agree trivially.
        expect(standardErrorCodeForHttpStatus(409)).not.toBe(UNREGISTERED);
        expect(standardErrorCodeForHttpStatus(409)).not.toBe(REGISTERED);
        expect(standardErrorCodeForHttpStatus(503)).not.toBe(standardErrorCodeForHttpStatus(409));
    });
});

// ---------------------------------------------------------------------------
// §1 — an unregistered thrown code is DEMOTED
// ---------------------------------------------------------------------------

describe('#9232 §1 — a thrown code outside the vocabulary rides `declaredCode`', () => {
    for (const arm of ARMS) {
        it(`${arm.name}: \`code\` is the member the status derives, \`declaredCode\` the producer's string`, () => {
            const { status, body } = arm.answer(UNREGISTERED);

            expect(status).toBe(arm.status);
            expect(body.code).toBe(standardErrorCodeForHttpStatus(arm.status));
            expect(body.declaredCode).toBe(UNREGISTERED);
            // The property the un-narrowed door could never have.
            expect(ErrorCode.safeParse(body.code).success).toBe(true);
        });

        it(`${arm.name}: presence means demotion — never a member, never a copy of \`code\``, () => {
            const { body } = arm.answer(UNREGISTERED);
            // ⚠️ `toBeTypeOf` first, and it is not decoration: every assertion
            // below is vacuously true of `undefined` (an absent field is not a
            // union member and is not equal to `code`), so without it this case
            // stayed GREEN under the reverse verification that reddened its
            // sibling — a pin that cannot fail for the defect it names.
            expect(body.declaredCode).toBeTypeOf('string');
            // `ApiErrorSchema.declaredCode`'s documented semantics, held at this
            // door too so a consumer reading `declaredCode` at all knows the
            // serving side's ledger did not recognise the spelling.
            expect(ErrorCode.safeParse(body.declaredCode).success).toBe(false);
            expect(body.declaredCode).not.toBe(body.code);
        });
    }
});

// ---------------------------------------------------------------------------
// §2 — a registered thrown code is UNTOUCHED
// ---------------------------------------------------------------------------

describe('#9232 §2 — a registered thrown code still arrives verbatim in `code`', () => {
    for (const arm of ARMS) {
        it(`${arm.name}: the spelling survives and nothing is demoted beside it`, () => {
            const { status, body } = arm.answer(REGISTERED);

            expect(status).toBe(arm.status);
            expect(body.code).toBe(REGISTERED);
            // Repeating a recognised code in both slots would put two spellings
            // of one fact on every refusal — the reason `demotedDeclaredCode`
            // answers `undefined` for a member.
            expect(body.declaredCode).toBeUndefined();
        });
    }
});

// ---------------------------------------------------------------------------
// §3 — what the narrowing deliberately does NOT change
// ---------------------------------------------------------------------------

describe('#9232 §3 — the halves that must not move', () => {
    for (const arm of ARMS) {
        it(`${arm.name}: a throw with NO code still carries none — nothing is invented`, () => {
            const { status, body } = arm.answer(undefined);

            expect(status).toBe(arm.status);
            expect(body.code).toBeUndefined();
            expect(body.declaredCode).toBeUndefined();
            // ADR-0112 says the PRODUCER names the condition, so a
            // half-declaration is honoured for the half that was declared.
            // Narrowing the vocabulary must not start ADDING codes to bodies
            // that carried none.
        });
    }

    it('the 5xx prose is still withheld and the 4xx message still reaches the caller (#5437 / #5423)', () => {
        // The narrowing touches the `code` fields only. If it had moved the
        // message rules it would have re-opened a leak class while every
        // vocabulary assertion above stayed green.
        expect(wire(thrownWithStatus(503, UNREGISTERED)).body.error).toBe(INTERNAL_ERROR_MESSAGE);
        expect(wire(thrownWithStatus(409, UNREGISTERED)).body.error).toBe('boom');
    });

    it('`object` and `issues` still ride their arms', () => {
        const withIssues = Object.assign(new Error('boom'), {
            status: 400, code: UNREGISTERED, issues: [{ path: 'a' }],
        });
        expect(wire(withIssues).body.issues).toEqual([{ path: 'a' }]);
        expect(mapDataError(thrownWithStatusCode(409, UNREGISTERED), 'account').body.object).toBe('account');
    });

    it('`sendDeclaredFault` is byte-identical — its `code: ErrorCode` cannot be demoted', () => {
        // The author-side door types `code` to the closed union at COMPILE
        // time, so every code it can emit is a member and §2's rule applies to
        // all of them. This is what makes the narrowing invisible to the five
        // author-declared emissions this repo routes through it.
        const res = makeRes();
        sendDeclaredFault(res, {
            code: 'FIELD_VISIBILITY_UNRESOLVED',
            status: 503,
            message: 'unresolved',
        });
        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({
            error: INTERNAL_ERROR_MESSAGE,
            code: 'FIELD_VISIBILITY_UNRESOLVED',
        });
    });
});

// ---------------------------------------------------------------------------
// §4 — the one limb the narrowing closes on the way past
// ---------------------------------------------------------------------------

describe('#9232 §4 — a non-string `code` is not a wire code', () => {
    // `resolveErrorResponse`'s two arms gated on bare truthiness, so a numeric
    // driver errno reached the flat body as `code: 1062` — a number in the
    // field callers branch on, which is the drift #3842 removed at the other
    // door and the loudest possible violation of a closed vocabulary. The
    // shared resolver has always classed a non-string `code` as CONTEXT rather
    // than a spelling, and all four flat arms now ask that one question.
    it('a numeric errno reaches neither `code` nor `declaredCode`', () => {
        for (const status of [409, 503]) {
            const { body } = wire(thrownWithStatus(status, 1062));
            expect(body.code).toBeUndefined();
            expect(body.declaredCode).toBeUndefined();
        }
    });

    it('an empty-string `code` is not a declaration either', () => {
        const { body } = wire(thrownWithStatus(409, ''));
        expect(body.code).toBeUndefined();
        expect(body.declaredCode).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// §5 — the half that must never differ
// ---------------------------------------------------------------------------

describe('#9232 §5 — the demote is computed against the status the client receives', () => {
    it('every arm derives its code from its OWN resolved status, not from a fallback', () => {
        // `thrownCodeFields` hands the boundary's already-resolved status to
        // `resolveThrownHttpError` as the fallback. If a future edit dropped
        // that argument, a throw whose status this door resolved would have its
        // code derived from 500 instead — a wrong-but-registered code, which no
        // schema parse can catch. Spanning four statuses is what makes this
        // assertion able to fail.
        for (const status of [400, 403, 404, 409, 501, 503]) {
            const { body } = wire(thrownWithStatus(status, UNREGISTERED));
            expect(body.code).toBe(standardErrorCodeForHttpStatus(status));
        }
    });
});
