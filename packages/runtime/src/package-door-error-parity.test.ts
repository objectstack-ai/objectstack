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
 *   REST door  == resolveThrownHttpError.code          (packages/rest/src/package-routes-coded-error-mapping.test.ts)
 *   dispatcher == resolveThrownHttpError.declaredCode  (this file)
 *   status: the SAME field on both
 *   ⇒ same status always, same code for every registered code
 *
 * — with each half independently falsifiable: a door that grows a second
 * mapping of its own turns its own half red. Comparing to the shared rule is
 * also what keeps this honest as new throw shapes appear; two suites agreeing
 * about hand-written literals only ever agree about the shapes someone thought
 * to enumerate, which is how the divergence arose in the first place.
 *
 * The two code spellings are one function's two outputs, not two rules. They
 * differ only for a code outside `StandardErrorCode ∪ ERROR_CODE_LEDGER`, which
 * this door emits verbatim and the REST door cannot — that difference is
 * pinned explicitly at the bottom of this file, with the reason.
 *
 * ## What is deliberately NOT asserted: the message
 *
 * The dispatcher withholds a 5xx message that looks like a driver/internal leak
 * (`looksLikeInternalErrorLeak`, #3867); the REST package door applies no such
 * filter and ships the thrown message verbatim. That asymmetry predates #8016
 * and is filed separately — it is a DISCLOSURE rule, not a mapping rule, so
 * pinning `status` + `code` here is the whole of what "the two doors agree"
 * means today. Asserting message parity would pin the gap shut instead of
 * leaving it visible.
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
                .toEqual({ status: expected.status, code: expected.declaredCode ?? expected.code });
        });
    }

    /**
     * The one place the two doors' codes differ, pinned so it stays a stated
     * difference rather than a drift.
     *
     * This door puts a producer's code on the wire verbatim — `STORAGE_FAILURE`,
     * `FLOW_FAILED` and `DUPLICATE` are all outside
     * `StandardErrorCode ∪ ERROR_CODE_LEDGER` and all pinned by existing suites
     * here. The REST door cannot: `sendError` takes the closed `ErrorCode`, and
     * that door's conformance suite parses its bodies against the ledger, so an
     * unregistered code there is a failing test rather than a wire answer.
     *
     * The STATUS agrees either way, which is what #8016 was about. Whether this
     * door's `error.code` should be closed too is a live contract question
     * (`ApiErrorSchema` would reject these bodies) and is filed separately — it
     * is not a decision this fix took.
     */
    it('an unregistered code reaches this door verbatim, and the narrowed spelling differs', () => {
        const error = thrown('dialect', { status: 409, code: 'PACKAGE_IS_HAUNTED' });
        const resolved = resolveThrownHttpError(error, 500);
        const response = errorFromThrown(error, 500);

        expect(resolved.declaredCode).toBe('PACKAGE_IS_HAUNTED');
        expect(resolved.code).toBe('RESOURCE_CONFLICT');
        expect((response.body as any).error.code).toBe('PACKAGE_IS_HAUNTED');
        // The half that must never differ.
        expect(response.status).toBe(resolved.status);
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
