// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8016] The dispatcher door for `/api/v1/packages` and the direct-mount REST
 * door answer the SAME thrown error with the same status and the same code.
 *
 * ## What went wrong
 *
 * `/api/v1/packages` has two HTTP transports. This one — the dispatcher's
 * packages domain (`./domains/packages.ts`) — ends every catch in
 * `deps.errorFromThrown(e, 500)`, which has always read the error's own
 * `.status` first: a `metadata-protocol` refusal carrying `409` and
 * `DESTRUCTIVE_CHANGE` surfaced as a 409 with that code. The other transport
 * (`@objectstack/rest`'s `registerPackageRoutes`) ended all four of its catches
 * in `sendError(res, 500, 'INTERNAL_ERROR', …)` — status-blind. And that
 * registrar mounts FIRST in the production stack, so the wrong answer was the
 * one production returned: a caller who was refused was told the platform had
 * broken.
 *
 * ## Why this pin is split across two files
 *
 * The natural pin — drive both doors with one throw and compare the two bodies
 * — cannot be written anywhere. `@objectstack/rest` cannot import
 * `@objectstack/runtime` (runtime depends on rest, so the arrow only points one
 * way), and `registerPackageRoutes` is internal to rest rather than part of its
 * public surface, so this package cannot reach it either.
 *
 * What both doors CAN see is the rule itself, which is why the fix moved it to
 * `@objectstack/types`: `resolveThrownHttpError`. Each door is pinned to that
 * function from its own side, and the halves compose —
 *
 *   REST door  == resolveThrownHttpError.code  (packages/rest/src/package-routes-coded-error-mapping.test.ts)
 *   dispatcher == resolveThrownHttpError.code  (this file; `.declaredCode` until #9106)
 *   status: the SAME field on both
 *   ⇒ same status AND same code, always
 *
 * — with each half independently falsifiable: a door that grows a second
 * mapping of its own turns its own half red. Comparing to the shared rule is
 * also what keeps this honest as new throw shapes appear; two suites agreeing
 * about hand-written literals only ever agree about the shapes someone thought
 * to enumerate, which is how the divergence arose in the first place.
 *
 * [#9106] The two code spellings are one function's two outputs, not two
 * rules — and since the 2026-08-16 ruling they no longer diverge on any wire's
 * `error.code`: a code outside `StandardErrorCode ∪ ERROR_CODE_LEDGER` is
 * DEMOTED at this door exactly as at the REST door, and the verbatim spelling
 * rides the wire's `declaredCode` sibling instead (the open, author-authored
 * channel `ApiErrorSchema` declares). The demote is pinned explicitly at the
 * bottom of this file.
 *
 * ## What is deliberately NOT asserted: the message
 *
 * [#8086] The asymmetry this paragraph used to record is CLOSED, so the reason
 * has changed and the sentence that stood here would now be false. It read:
 * "the REST package door applies no such filter and ships the thrown message
 * verbatim. That asymmetry predates #8016 and is filed separately." It was
 * filed as #8086 and fixed — `sendThrownError`
 * (`packages/rest/src/package-routes.ts`) now runs the SAME
 * `looksLikeInternalErrorLeak` / `INTERNAL_ERROR_MESSAGE` expression the
 * dispatcher has run since #3867, so the two doors no longer disagree about
 * disclosure either.
 *
 * Message parity is still not asserted HERE, for the ordinary reason rather
 * than as a gap left visible: disclosure is a property each boundary applies in
 * its own envelope, and each door pins its own half against the shared
 * predicate — this file's job is the MAPPING rule (`status` + `code`), and
 * `packages/rest/src/package-door-5xx-message-sanitization.test.ts` is where
 * the REST door's disclosure behaviour is pinned. Widening this file to the
 * message would make one suite the owner of two rules that are deliberately
 * separate.
 */

import { describe, it, expect } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from './http-dispatcher.js';
import type { DomainHandlerDeps } from './domain-handler-registry.js';

/**
 * The REAL exit `domains/packages.ts` calls — reached through the dispatcher's
 * own `domainDeps` seam rather than restated, so this pins production's mapper
 * and not a stand-in for it.
 */
const errorFromThrown: DomainHandlerDeps['errorFromThrown'] = (() => {
    const dispatcher: any = new HttpDispatcher({ context: { getService: () => null } } as any);
    const deps: DomainHandlerDeps = dispatcher.domainDeps;
    return deps.errorFromThrown;
})();

/** A thrown error carrying whatever a producer declares on it. */
function thrown(message: string, carried: Record<string, unknown>): Error {
    return Object.assign(new Error(message), carried);
}

/**
 * The throw shapes the two doors have to agree about — a coded 4xx, the
 * established coded 409, both status spellings, a record-validation failure, a
 * code outside the declared vocabulary, and a genuinely unexpected fault.
 */
const SHAPES: Array<{ name: string; error: unknown }> = [
    { name: 'a coded 4xx (`status`)', error: thrown('scope required', { status: 400, code: 'TENANT_SCOPE_REQUIRED' }) },
    { name: 'the established 409', error: thrown('would drop data', { status: 409, code: 'DESTRUCTIVE_CHANGE' }) },
    { name: 'a coded 4xx spelled `statusCode`', error: thrown('locked', { statusCode: 409, code: 'RECORD_LOCKED' }) },
    {
        name: 'a record-validation failure carrying neither status nor issues',
        error: thrown('bad manifest', { name: 'ValidationError', code: 'VALIDATION_FAILED', fields: [{ field: 'id' }] }),
    },
    { name: 'a genuinely unexpected fault', error: new Error('kaboom') },
];

describe('#8016 — the dispatcher package door answers the shared mapping', () => {
    for (const shape of SHAPES) {
        it(`${shape.name}`, () => {
            const expected = resolveThrownHttpError(shape.error, 500);
            const response = errorFromThrown(shape.error, 500);

            // The declared envelope, checked against the schemas themselves so
            // a `code` outside `StandardErrorCode ∪ ERROR_CODE_LEDGER` fails
            // here rather than on someone's wire.
            expect(BaseResponseSchema.safeParse(response.body).success).toBe(true);
            expect(envelopeViolations(response.body)).toEqual([]);
            expect(ApiErrorSchema.safeParse((response.body as any).error).success).toBe(true);

            expect({ status: response.status, code: (response.body as any).error.code })
                .toEqual({ status: expected.status, code: expected.code });
            // Every shape here carries a REGISTERED code (or none) — no demote,
            // so no `declaredCode` sibling appears (#9106: presence means
            // demotion).
            expect((response.body as any).error.declaredCode).toBeUndefined();
        });
    }

    /**
     * The place the two doors' codes USED to differ — now the pin on the
     * demote that removed the difference (#9106, maintainer ruling
     * 2026-08-16: `error.code` is a closed vocabulary at every door).
     *
     * An unregistered code cannot reach `error.code` through either door THIS
     * RESOLVER SERVES: the direct-mount package registrar answers through
     * `@objectstack/types`' `sendError`, which takes the closed `ErrorCode`,
     * and this door now serves the resolver's narrowed `code` too. The
     * producer's verbatim spelling is not dropped — it rides the wire's
     * `declaredCode` sibling, the open author-authored channel
     * `ApiErrorSchema` declares, which is how the #7867 sandbox passthrough
     * capability survives the closure (a metadata app's own thrown code still
     * reaches the wire).
     *
     * ⚠️ [#9098] "Either door" is scoped deliberately, and the correction
     * #9098 landed here is why the qualifier has to be written down.
     *
     * The sentence this paragraph used to carry ("the REST door cannot:
     * `@objectstack/types`' `sendError` takes the closed `ErrorCode`") named a
     * real, strict function and drew a false conclusion from it. `packages/rest`
     * had a SECOND exported `sendError` — its own sanitizing responder, typed
     * `error: any` — and that was the one its route modules reached for. So the
     * strictness cited here was never on the path being described, and the door
     * read as closed while an author could put any spelling at all on the wire
     * (`FIELD_VISIBILITY_UNRESOLVED` did, and a gate sweep found it, not this
     * pin). #9098 renamed the responder to `sendThrownError` so the two cannot
     * be conflated again, and added `sendDeclaredFault` — `code: ErrorCode` —
     * as the typed author-side door.
     *
     * What is true now, stated per path:
     *   - AUTHOR-decided refusals: narrowed at COMPILE time, at both REST
     *     doors — `sendDeclaredFault` (flat dialect) and `@objectstack/types`'
     *     `sendError` (nested). An unregistered code is a build failure.
     *   - THROWN errors at the two doors THIS resolver serves — the dispatcher
     *     exits (this file) and the direct-mount package registrar: NARROWED,
     *     since the #9106 ruling. #9098 recorded them as "not narrowed,
     *     symmetrically with this door", which was true on 2026-08-16 and is
     *     the half #9106 changed; the ADR-0112 public-contract decision that
     *     paragraph said was required is exactly the ruling this file now pins.
     *   - THROWN errors through `packages/rest`'s FLAT `sendThrownError`:
     *     NARROWED TOO, since the #9232 ruling (maintainer, 2026-08-17). That
     *     path puts `code` at the body's TOP level rather than in `error.code`,
     *     which is why #9106's scope — the actions door and the resolver both
     *     doors above share — did not reach it by construction. It was filed as
     *     #9232 rather than fixed there, and #9232 ruled that body POSITION is
     *     NOT a carve-out from the vocabulary: an unregistered thrown spelling
     *     is demoted to a top-level `declaredCode` sibling in the flat body,
     *     computed by the same `resolveThrownHttpError` / `demotedDeclaredCode`
     *     pair this file reads. Pinned at that door by
     *     `packages/rest/src/rest-thrown-code-vocabulary.test.ts`.
     *
     * ⚠️ This paragraph carried the opposite claim until #9232 landed. #9098
     * wrote it as "NOT narrowed, deliberately and symmetrically with this
     * door", which was true on 2026-08-16; #9106 narrowed THIS door the next
     * day and took the symmetry with it, leaving a sentence that read as a
     * deliberate design decision while describing nothing that existed. That
     * gap is the same declared-≠-actual defect class as the door hole itself,
     * which is why #9232's ruling required both to be fixed in one change: a
     * pin whose prose asserts a symmetry the code abandoned teaches the next
     * reader a rule the platform does not have.
     *
     * The envelope POSITION is a separate, still-open line — the flat dialect
     * has not moved and is held by the `check:route-envelope` ratchet. It was
     * explicitly NOT a precondition for the vocabulary fix.
     *
     * History: #8087 first ruled the verbatim spelling stays and gated the
     * producer set (`dispatcher-error-vocabulary.ts`,
     * `pnpm check:dispatcher-error-vocabulary`); #8846 registered every
     * platform producer the gate found; #9106 then ruled the remaining,
     * unregisterable TENANT-AUTHORED limb demoted — completing the closure.
     * The vehicle below stays a deliberately unregistered string, because what
     * this case pins is the DEMOTE, not any particular producer.
     */
    it('an unregistered code is demoted: the narrowed spelling in `error.code`, the verbatim one in `declaredCode`', () => {
        const error = thrown('dialect', { status: 409, code: 'PACKAGE_IS_HAUNTED' });
        const resolved = resolveThrownHttpError(error, 500);
        const response = errorFromThrown(error, 500);

        expect(resolved.declaredCode).toBe('PACKAGE_IS_HAUNTED');
        expect(resolved.code).toBe('RESOURCE_CONFLICT');
        expect((response.body as any).error.code).toBe('RESOURCE_CONFLICT');
        expect((response.body as any).error.declaredCode).toBe('PACKAGE_IS_HAUNTED');
        // The half that must never differ.
        expect(response.status).toBe(resolved.status);
        // And the demoted body satisfies its declared schema — the property an
        // unregistered code could never have before #9106.
        expect(ApiErrorSchema.safeParse((response.body as any).error).success).toBe(true);
        expect(envelopeViolations(response.body)).toEqual([]);
    });

    it('the shapes really do produce different answers', () => {
        // Anti-vacuity for the comparison: two constants agree trivially. These
        // span 400 / 409 / 500 and four distinct codes, and the fault case must
        // still land on the default arm.
        const answers = SHAPES.map((s) => {
            const r = errorFromThrown(s.error, 500);
            return `${r.status} ${(r.body as any).error.code}`;
        });
        expect(new Set(answers).size).toBeGreaterThan(3);
        expect(answers).toContain('500 INTERNAL_ERROR');
    });

    it('a refusal is never reported as a server fault', () => {
        // The defect in one line, from the door that never had it: a coded 4xx
        // must not come back 5xx. This is the assertion the REST door failed.
        for (const shape of SHAPES.slice(0, 4)) {
            expect(errorFromThrown(shape.error, 500).status).toBeLessThan(500);
        }
    });
});
