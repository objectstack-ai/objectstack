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
import { BaseResponseSchema, envelopeViolations } from '@objectstack/spec/api';
import { sendOk, sendError, type EnvelopeResponse } from './response-envelope.js';

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
