// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16146] `declaredRefusalMessage` — the ONE read of the producer-side refusal
 * declaration, which all three withhold arms make.
 *
 * The WIRE proof lives at the doors (`rest-declared-refusal-relay.test.ts`,
 * `dispatcher-plugin.declared-5xx-prose-withhold.test.ts`), because the defect
 * this closes was a message dying between a producer and a caller and no unit
 * test on the arm could see it. This file pins the CONDITIONS instead, in one
 * place, so a door never grows its own answer to any of them — the per-door
 * divergence `serverFaultProvenance` and `demotedDeclaredCode` were extracted
 * to end (#12509).
 */

import { describe, it, expect } from 'vitest';
import { declaredRefusalMessage } from './thrown-http-error.js';
import { declaresServerFault } from './error-leak.js';

const AUTHORED = 'References to a `field` item cannot be computed. Ask the owning object instead.';

function declaring(props: Record<string, unknown>, message = AUTHORED) {
    return Object.assign(new Error(message), props);
}

describe('[#16146] declaredRefusalMessage — the declared shape', () => {
    it('answers the prose for `status` + `code` + `refusal: true`', () => {
        expect(declaredRefusalMessage(declaring({ status: 501, code: 'NOT_IMPLEMENTED', refusal: true })))
            .toBe(AUTHORED);
    });

    it('reads BOTH status spellings — a producer answer never depends on the field it reached for (#7525)', () => {
        expect(declaredRefusalMessage(declaring({ statusCode: 501, code: 'NOT_IMPLEMENTED', refusal: true })))
            .toBe(AUTHORED);
    });

    it('`status` wins over `statusCode` where both are present, exactly as the resolver reads them', () => {
        // A 4xx `status` beside a 5xx `statusCode` declares a 4xx, and the
        // field is redundant on a 4xx — so nothing is relayed and no arm is
        // reached. Pinned because the opposite precedence would silently widen
        // the band.
        expect(declaredRefusalMessage(declaring({ status: 409, statusCode: 503, code: 'RECORD_LOCKED', refusal: true })))
            .toBeUndefined();
    });

    it('answers `undefined` for a declared FAULT — the default, and the whole second row of the table', () => {
        expect(declaredRefusalMessage(declaring({ status: 503, code: 'SERVICE_UNAVAILABLE' }))).toBeUndefined();
    });
});

describe('[#16146] declaredRefusalMessage — each condition, alone', () => {
    it('⛔ `true` is the only value: presence IS the declaration', () => {
        for (const refusal of [false, 'true', 'yes', 1, {}, null] as unknown[]) {
            expect(declaredRefusalMessage(declaring({ status: 501, code: 'NOT_IMPLEMENTED', refusal })), String(refusal))
                .toBeUndefined();
        }
    });

    it('⛔ it QUALIFIES a declared status and never invents one', () => {
        expect(declaredRefusalMessage(Object.assign(new Error(AUTHORED), { code: 'NOT_IMPLEMENTED', refusal: true })))
            .toBeUndefined();
    });

    it('⛔ a 4xx declares no server fault to except — the field is redundant there', () => {
        expect(declaredRefusalMessage(declaring({ status: 403, code: 'PERMISSION_DENIED', refusal: true })))
            .toBeUndefined();
    });

    it('⛔ an out-of-band status is not a declaration, so the withhold below it is untouched', () => {
        // `declaresServerFault` has no upper bound, so a nonsense `status: 700`
        // with a code still reaches the analytics door's generic-500 branch and
        // must keep the withhold it has had since #5367. Bounding the read at
        // 599 — the same band `packages/rest`'s `declaredHttpStatus` uses — is
        // what keeps that branch unreachable by a refusal.
        expect(declaredRefusalMessage(declaring({ status: 700, code: 'NOT_IMPLEMENTED', refusal: true })))
            .toBeUndefined();
        expect(declaresServerFault({ status: 700, code: 'NOT_IMPLEMENTED' })).toBe(true);
    });

    it('⛔ the `code` half is asked through `declaresServerFault`, not restated', () => {
        // The ruling's fourth constraint says that predicate keeps its live
        // production caller; this read is a SECOND one, so an ADR-0049 remove
        // pass now breaks two things instead of one.
        expect(declaredRefusalMessage(declaring({ status: 501, refusal: true }))).toBeUndefined();
        expect(declaredRefusalMessage(declaring({ status: 501, code: '', refusal: true }))).toBeUndefined();
        expect(declaresServerFault({ status: 501, code: '' })).toBe(false);
    });

    it('⛔ there must be prose to relay — nothing is invented', () => {
        expect(declaredRefusalMessage(declaring({ status: 501, code: 'NOT_IMPLEMENTED', refusal: true }, ''))).toBeUndefined();
        expect(declaredRefusalMessage(declaring({ status: 501, code: 'NOT_IMPLEMENTED', refusal: true }, '   '))).toBeUndefined();
    });

    it('⛔ SECURITY FLOOR — the declaration says ADDRESSED, the heuristic says SAFE', () => {
        expect(declaredRefusalMessage(declaring(
            { status: 501, code: 'NOT_IMPLEMENTED', refusal: true },
            'SQLITE_ERROR: no such column: crm_account.secret_policy_field',
        ))).toBeUndefined();
    });

    it('a non-object throw declares nothing', () => {
        for (const value of [undefined, null, 'boom', 42] as unknown[]) {
            expect(declaredRefusalMessage(value), String(value)).toBeUndefined();
        }
    });
});
