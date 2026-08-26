// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #3973 — the shared envelope builders.
 *
 * Seven route modules used to carry their own `sendOk` / `sendError` pair. Now
 * they call these, so this is the one place the declared envelope gets written
 * and the only place a mistake in it can originate.
 *
 * Two things are pinned here that the per-module driven suites cannot pin as
 * cheaply:
 *
 *   1. the bodies parse against the REAL spec schemas — `BaseResponseSchema` and
 *      `envelopeViolations`, imported rather than restated, so these assertions
 *      track the contract if the contract moves;
 *   2. the parameter plumbing each module relies on — a non-200 success status,
 *      `extra` merged into `error` — because a module that lost one of those in
 *      the conversion would otherwise only fail in its own suite, if at all.
 *
 * The STATIC half — proving no route module hand-builds a body instead of
 * calling these — is `scripts/check-route-envelope.mjs`, repo-wide and outside
 * any package on purpose.
 */

import { describe, it, expect } from 'vitest';
import { ApiErrorSchema, BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { sendOk, sendError, type EnvelopeResponse } from './response-envelope.js';
import { resolveThrownHttpError, demotedDeclaredCode } from './thrown-http-error.js';

/** Captures what a route would have put on the wire. */
function capture() {
    const seen: { status: number; body: unknown } = { status: 0, body: undefined };
    const res: EnvelopeResponse = {
        status(code: number) { seen.status = code; return res; },
        json(body: unknown) { seen.body = body; return undefined; },
    };
    return { res, seen };
}

describe('sendOk', () => {
    it('emits the declared success envelope with the payload under `data`', () => {
        const { res, seen } = capture();
        sendOk(res, { locales: ['en', 'zh-CN'] });

        expect(seen.status).toBe(200);
        expect(seen.body).toEqual({ success: true, data: { locales: ['en', 'zh-CN'] } });
    });

    it('parses against BaseResponseSchema and violates nothing', () => {
        const { res, seen } = capture();
        sendOk(res, { id: 'lnk_1' });

        expect(BaseResponseSchema.safeParse(seen.body).success).toBe(true);
        expect(envelopeViolations(seen.body)).toEqual([]);
    });

    it('honours a non-200 success status (the 201 the create routes answer)', () => {
        const { res, seen } = capture();
        sendOk(res, { datasource: { name: 'crm' } }, 201);

        expect(seen.status).toBe(201);
        expect(seen.body).toEqual({ success: true, data: { datasource: { name: 'crm' } } });
    });

    it('does not spread the payload beside the flag', () => {
        // `{ success: true, data: link, link }` parses clean against the schema
        // and is still drift — it shipped on /share-links for as long as nobody
        // looked (#4038). One `data` slot is what prevents re-inventing it.
        const { res, seen } = capture();
        sendOk(res, { token: 't' });

        expect(Object.keys(seen.body as object)).toEqual(['success', 'data']);
    });
});

describe('sendError', () => {
    it('nests `message` inside `error` rather than beside it', () => {
        // The pre-#3675 dialect put the message as a SIBLING of `error`, so a
        // caller reading `body.error.message` got `undefined`.
        const { res, seen } = capture();
        sendError(res, 404, 'RESOURCE_NOT_FOUND', 'Datasource "crm" does not exist.');

        expect(seen.status).toBe(404);
        expect(seen.body).toEqual({
            success: false,
            error: { code: 'RESOURCE_NOT_FOUND', message: 'Datasource "crm" does not exist.' },
        });
        expect((seen.body as any).error.message).toBe('Datasource "crm" does not exist.');
    });

    it('parses against BaseResponseSchema and violates nothing', () => {
        const { res, seen } = capture();
        sendError(res, 503, 'SERVICE_UNAVAILABLE', 'The datasource-admin service is not available.');

        expect(BaseResponseSchema.safeParse(seen.body).success).toBe(true);
        expect(envelopeViolations(seen.body)).toEqual([]);
    });

    it('merges `extra` into `error` — the `details` slot the callers use', () => {
        const { res, seen } = capture();
        sendError(res, 400, 'PACKAGE_DELETE_PARTIAL', 'Deleting crm left 2 item(s) behind.', {
            details: { failed: ['a', 'b'], cleanups: [] },
        });

        expect(seen.body).toEqual({
            success: false,
            error: {
                code: 'PACKAGE_DELETE_PARTIAL',
                message: 'Deleting crm left 2 item(s) behind.',
                details: { failed: ['a', 'b'], cleanups: [] },
            },
        });
        expect(BaseResponseSchema.safeParse(seen.body).success).toBe(true);
    });

    it('rejects an UNDECLARED sibling of `code` at compile time (#4224)', () => {
        // `settings-routes` used to hang `namespace` / `key` / `reason` / `fields`
        // beside `code`. `ApiErrorSchema` declares none of them, and being a plain
        // `z.object` it STRIPPED them rather than rejecting — conformant by
        // stripping, not by declaration. #4224 moved those onto `details`; typing
        // `extra` as ApiError's own optional fields is what stops them returning,
        // in every module at once rather than in the one that was fixed.
        const { res } = capture();
        // @ts-expect-error 'namespace' is not a declared field of ApiError.
        sendError(res, 403, 'SETTINGS_FORBIDDEN', 'denied', { namespace: 'branding' });
    });

    it('rejects an unregistered code at COMPILE time, not just on parse', () => {
        // `code` is `ErrorCode` — `StandardErrorCode ∪ ERROR_CODE_LEDGER`. The
        // seven copies typed it `string`, so this was caught at runtime only,
        // and only on a route some test happened to drive.
        const { res } = capture();
        // @ts-expect-error 'NOT_A_REGISTERED_CODE' is not in the ADR-0112 union.
        sendError(res, 400, 'NOT_A_REGISTERED_CODE', 'invented');
    });
});

/**
 * The ADR-0112 open channel on the NESTED envelope (#9106, #9232).
 *
 * `ApiErrorSchema` has declared `declaredCode` since #9106 and the flat `/data`
 * door emits it, but `sendError`'s `extra` did not admit the field — so putting
 * a demoted producer spelling on a nested-envelope route was a COMPILE ERROR,
 * and the author's own code was dropped while the derived closed member shipped
 * in its place. Nothing invalid went on the wire, which is exactly what made the
 * loss silent.
 *
 * These drive the REAL pipeline rather than asserting the type: a thrown error
 * shaped like a sandboxed hook's refusal goes through `resolveThrownHttpError`
 * and `demotedDeclaredCode` — the one rule both doors read — and the body is
 * parsed by the real `ApiErrorSchema`. A type-level assertion would have passed
 * against a schema that declares nothing.
 */
describe('sendError — the `declaredCode` open channel', () => {
    /**
     * The reachable producer ADR-0112's amendment names: a metadata app's own
     * `.code` crossing the QuickJS boundary (#7867) on a hook refusal. It is
     * NOT a member of `StandardErrorCode ∪ ERROR_CODE_LEDGER`, so the closed
     * slot cannot hold it.
     */
    const tenantAuthored = () => Object.assign(
        new Error('Quota exceeded for this app.'),
        { code: 'crm.quota_exceeded', status: 403 },
    );

    it('carries the producer spelling beside the derived closed member', () => {
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(tenantAuthored());
        const demoted = demotedDeclaredCode(thrown);

        sendError(res, thrown.status, thrown.code, thrown.message, {
            ...(demoted !== undefined ? { declaredCode: demoted } : {}),
        });

        expect(seen.status).toBe(403);
        expect(seen.body).toEqual({
            success: false,
            error: {
                // Derived from the status, because the spelling is unregistered.
                code: 'PERMISSION_DENIED',
                message: 'Quota exceeded for this app.',
                // …and the author's own spelling survives, verbatim.
                declaredCode: 'crm.quota_exceeded',
            },
        });
    });

    it('emits a body the REAL schemas accept, with the field still on it', () => {
        // `.success` alone would not have caught this: `ApiErrorSchema` is a
        // plain `z.object`, so an UNDECLARED sibling parses clean by being
        // STRIPPED. The reading that means something is that the field is still
        // there AFTER the parse — i.e. the schema declares it.
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(tenantAuthored());
        sendError(res, thrown.status, thrown.code, thrown.message, {
            declaredCode: demotedDeclaredCode(thrown)!,
        });

        const body = seen.body as { error: unknown };
        expect(BaseResponseSchema.safeParse(seen.body).success).toBe(true);
        expect(envelopeViolations(seen.body)).toEqual([]);

        const parsed = ApiErrorSchema.safeParse(body.error);
        expect(parsed.success).toBe(true);
        expect((parsed as { data: { declaredCode?: string } }).data.declaredCode)
            .toBe('crm.quota_exceeded');
    });

    it('the survives-the-parse reading can say NO — an undeclared sibling is stripped', () => {
        // The control for the assertion above, on a term that is not a
        // substring of the one under test. `ApiErrorSchema` strips rather than
        // rejects, so "parsed clean" is worthless on its own; this pins that the
        // instrument distinguishes a DECLARED field from a tolerated one.
        const parsed = ApiErrorSchema.safeParse({
            code: 'PERMISSION_DENIED',
            message: 'denied',
            declaredCode: 'crm.quota_exceeded',
            namespace: 'branding',
        });

        expect(parsed.success).toBe(true);
        const data = (parsed as { data: Record<string, unknown> }).data;
        expect(data.declaredCode).toBe('crm.quota_exceeded');
        expect('namespace' in data).toBe(false);
    });

    it('stays ABSENT when the producer spelled a registered code', () => {
        // `ApiErrorSchema.declaredCode`'s documented invariant: presence MEANS
        // demotion. A registered spelling is already in `code`, and repeating it
        // would make one refusal carry two spellings of one fact. The writer does
        // not re-derive that — `demotedDeclaredCode` does, for both doors.
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(
            Object.assign(new Error('denied'), { code: 'PERMISSION_DENIED', status: 403 }),
        );
        const demoted = demotedDeclaredCode(thrown);

        expect(demoted).toBeUndefined();

        sendError(res, thrown.status, thrown.code, thrown.message, {
            ...(demoted !== undefined ? { declaredCode: demoted } : {}),
        });

        expect(Object.keys((seen.body as { error: object }).error))
            .toEqual(['code', 'message']);
    });
});

/**
 * The #9934 user-facing marking on the NESTED envelope (maintainer ruling
 * 2026-08-19 on objectui#5210, option 1).
 *
 * `ApiErrorSchema` declares `userMessage` — the text a producer marked AT THROW
 * TIME as addressed to the END USER — and two of the three doors already emit
 * it (the flat `/data` door, the dispatcher door). `sendError`'s `extra` did
 * not admit the field, so a route answering the nested envelope could not put
 * it on the wire: a COMPILE ERROR to try, and the author's deliberate,
 * localized refusal text was dropped on this door alone while a valid body
 * shipped without it.
 *
 * Same discipline as the `declaredCode` block above: drive the REAL resolver
 * and parse the emitted body with the REAL `ApiErrorSchema`, because a
 * type-level assertion would pass against a schema that declares nothing, and
 * `.success` alone would pass against one that merely STRIPS the field.
 */
describe('sendError — the `userMessage` user-facing channel', () => {
    const USER_TEXT = '该任务已进入月末结账期，暂不能修改；请联系财务主管解锁。';
    const DIAGNOSTIC = 'close-period guard refused the write';

    /**
     * The producer shape the runtime actually delivers: a hook refusal that
     * opted in at throw time. Host-side hooks write this literally; a metadata
     * app's sandboxed body reaches the same shape via `e.userMessage` crossing
     * the QuickJS boundary (`SANDBOX_ERROR_PASSTHROUGH`).
     */
    const markedRefusal = () => Object.assign(
        new Error(DIAGNOSTIC),
        { statusCode: 403, userMessage: USER_TEXT },
    );

    it('carries the producer text verbatim WITHOUT replacing the diagnostic message', () => {
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(markedRefusal());

        // No re-derivation here, unlike `declaredCode`: `declaredUserMessage`
        // already decided what counts as marked, and the resolver applied it.
        sendError(res, thrown.status, thrown.code, thrown.message, {
            ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
        });

        expect(seen.status).toBe(403);
        expect(seen.body).toEqual({
            success: false,
            error: {
                code: 'PERMISSION_DENIED',
                // The diagnostic channel keeps its own wording…
                message: DIAGNOSTIC,
                // …and the marked text rides beside it, byte for byte.
                userMessage: USER_TEXT,
            },
        });
    });

    it('emits a body the REAL schemas accept, with the field still on it after the parse', () => {
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(markedRefusal());
        sendError(res, thrown.status, thrown.code, thrown.message, {
            userMessage: thrown.userMessage!,
        });

        const body = seen.body as { error: unknown };
        expect(BaseResponseSchema.safeParse(seen.body).success).toBe(true);
        expect(envelopeViolations(seen.body)).toEqual([]);

        const parsed = ApiErrorSchema.safeParse(body.error);
        expect(parsed.success).toBe(true);
        expect((parsed as { data: { userMessage?: string } }).data.userMessage).toBe(USER_TEXT);
    });

    it('the survives-the-parse reading can say NO — an undeclared sibling beside it is stripped', () => {
        // Paired control on a term that is NOT a substring of the one under
        // test. `ApiErrorSchema` is a plain `z.object`, so it strips rather
        // than rejects: "parsed clean" is worthless alone, and this is what
        // makes the assertion above distinguish a DECLARED field from a merely
        // tolerated one — same body, same parse, opposite outcomes.
        const parsed = ApiErrorSchema.safeParse({
            code: 'PERMISSION_DENIED',
            message: DIAGNOSTIC,
            userMessage: USER_TEXT,
            reason: 'closed-period',
        });

        expect(parsed.success).toBe(true);
        const data = (parsed as { data: Record<string, unknown> }).data;
        expect(data.userMessage).toBe(USER_TEXT);
        expect('reason' in data).toBe(false);
    });

    it('stays ABSENT when the producer marked nothing — #3821 preserved by construction', () => {
        // Absence is the default and it is load-bearing: the consumer keeps its
        // generic substitution for anything unmarked. A blank marking is NOT a
        // declaration (`declaredUserMessage`'s non-empty-string rule), so the
        // writer must not invent a marked message for a producer that wrote
        // none — and the key must not appear as an empty string either.
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(
            Object.assign(new Error(DIAGNOSTIC), { statusCode: 403, userMessage: '   ' }),
        );

        expect(thrown.userMessage).toBeUndefined();

        sendError(res, thrown.status, thrown.code, thrown.message, {
            ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
        });

        expect(Object.keys((seen.body as { error: object }).error)).toEqual(['code', 'message']);
    });

    it('rides BESIDE `declaredCode` — both open channels on one refusal', () => {
        // The metadata-app case both cards were filed for: an app's own `.code`
        // (unregistered, so demoted) and its own user-facing text, on the same
        // throw. Admitting the second channel must not disturb the first.
        const { res, seen } = capture();
        const thrown = resolveThrownHttpError(Object.assign(
            new Error('crm quota guard refused the write'),
            { code: 'crm.quota_exceeded', status: 403, userMessage: USER_TEXT },
        ));
        const demoted = demotedDeclaredCode(thrown);

        sendError(res, thrown.status, thrown.code, thrown.message, {
            ...(demoted !== undefined ? { declaredCode: demoted } : {}),
            ...(thrown.userMessage !== undefined ? { userMessage: thrown.userMessage } : {}),
        });

        const body = seen.body as { error: unknown };
        const parsed = ApiErrorSchema.safeParse(body.error);
        expect(parsed.success).toBe(true);
        expect((parsed as { data: Record<string, unknown> }).data).toEqual({
            code: 'PERMISSION_DENIED',
            message: 'crm quota guard refused the write',
            declaredCode: 'crm.quota_exceeded',
            userMessage: USER_TEXT,
        });
    });
});
