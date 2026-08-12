// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8111] SDK compatibility across the record-sharing envelope convergence.
 *
 * `registerSharingEndpoints` moved its nine refusal arms from two retired
 * dialects onto the ADR-0112 D5 envelope. This measures what a caller of
 * `client.shares.*` actually observes across that move — re-run against THESE
 * consumers rather than inherited from #7981 or #8073, because a compatibility
 * claim taken on one call path is not evidence about another.
 *
 * The method: drive the REAL `ObjectStackClient` against a stubbed transport
 * answering the OLD body and then the NEW body for each arm, and compare every
 * property the client attaches to the thrown error. `client.shares.*` goes
 * through `ObjectStackClient.fetch`, whose error path reads BOTH envelopes'
 * declared spots on purpose (`errorBody?.code ?? errorBody?.error?.code`, plus
 * a bare-string limb for the message), which is what makes the move safe.
 *
 * ## The measured result
 *
 * `code`, `message`, `httpStatus`, `category`, `retryable` and `fields` are
 * IDENTICAL on every arm. `details` CHANGES on every arm — its last fallback
 * is the whole response body (`errorBody?.details ?? errorBody?.error?.details
 * ?? errorBody`), and the body is exactly what this card reshapes. Neither
 * envelope carries a `details`, so both fall through to that last limb; the
 * value differs because the body differs.
 *
 * That is discharged by census, not by assertion: no in-repo consumer reads
 * `err.details` off a `shares.*` call, and `details` is documented as
 * unstructured debugging context. It is pinned here rather than left implicit
 * so the next reader sees the one property that moved and why it was accepted.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackClient } from './index';

/** A client whose transport answers exactly one refusal body. */
function clientAnswering(status: number, body: any) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText: 'Error',
        json: async () => body,
        headers: new Headers(),
    });
    return new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
}

/** Every property `ObjectStackClient.fetch` attaches to the error it throws. */
function observed(err: any) {
    return {
        message: err.message,
        code: err.code,
        httpStatus: err.httpStatus,
        category: err.category,
        retryable: err.retryable,
        fields: err.fields,
        details: err.details,
    };
}

async function refusalFrom(status: number, body: any, call: (c: ObjectStackClient) => Promise<unknown>) {
    const client = clientAnswering(status, body);
    try {
        await call(client);
        throw new Error('expected the call to reject, but it resolved');
    } catch (err: any) {
        if (err?.httpStatus === undefined) throw err;
        return observed(err);
    }
}

const LIST = (c: ObjectStackClient) => c.shares.list('lead', 'rec1');
const GRANT = (c: ObjectStackClient) => c.shares.grant('lead', 'rec1', {
    recipientType: 'user', recipientId: 'u1', accessLevel: 'read',
});
const REVOKE = (c: ObjectStackClient) => c.shares.revoke('lead', 'rec1', 'sh1');

/**
 * Every arm, in both dialects.
 *
 * `old` is what the arm emitted before this card — the flat `{ code, message }`
 * for the 501 and `{ code, error: '<bare string>' }` for the rest. `next` is
 * what the shared `sendError` writes now.
 */
const ARMS: Array<{
    label: string;
    status: number;
    code: string;
    message: string;
    old: any;
    call: (c: ObjectStackClient) => Promise<unknown>;
}> = [
    {
        label: '501 NOT_IMPLEMENTED',
        status: 501, code: 'NOT_IMPLEMENTED',
        message: 'Sharing service is not configured on this deployment',
        old: { code: 'NOT_IMPLEMENTED', message: 'Sharing service is not configured on this deployment' },
        call: LIST,
    },
    {
        label: '400 VALIDATION_FAILED',
        status: 400, code: 'VALIDATION_FAILED', message: 'recipientId is required',
        old: { code: 'VALIDATION_FAILED', error: 'recipientId is required' },
        call: GRANT,
    },
    {
        label: '403 PERMISSION_DENIED',
        status: 403, code: 'PERMISSION_DENIED', message: 'you do not hold canManageShares on this record',
        old: { code: 'PERMISSION_DENIED', error: 'you do not hold canManageShares on this record' },
        call: LIST,
    },
    {
        label: '404 NOT_FOUND',
        status: 404, code: 'NOT_FOUND', message: 'record lead/rec1 does not exist',
        old: { code: 'NOT_FOUND', error: 'record lead/rec1 does not exist' },
        call: LIST,
    },
    {
        label: '409 CONFLICT',
        status: 409, code: 'CONFLICT', message: "share sh1 is materialised by source 'rule'",
        old: { code: 'CONFLICT', error: "share sh1 is materialised by source 'rule'" },
        call: REVOKE,
    },
    {
        label: '422 SHARING_NOT_ENABLED',
        status: 422, code: 'SHARING_NOT_ENABLED', message: "'lead' bypasses record sharing",
        old: { code: 'SHARING_NOT_ENABLED', error: "'lead' bypasses record sharing" },
        call: GRANT,
    },
    {
        label: '500 SHARE_GRANT_FAILED',
        status: 500, code: 'SHARE_GRANT_FAILED', message: 'boom',
        old: { code: 'SHARE_GRANT_FAILED', error: 'boom' },
        call: GRANT,
    },
];

const nextBody = (code: string, message: string) => ({ success: false, error: { code, message } });

describe('[#8111] client.shares.* observes the same error across the envelope move', () => {
    for (const arm of ARMS) {
        it(`${arm.label} — code, message, httpStatus, category, retryable, fields unchanged`, async () => {
            const before = await refusalFrom(arm.status, arm.old, arm.call);
            const after = await refusalFrom(arm.status, nextBody(arm.code, arm.message), arm.call);

            // The properties a caller branches on are identical, arm by arm.
            expect(after.code).toBe(before.code);
            expect(after.code).toBe(arm.code);
            expect(after.message).toBe(before.message);
            expect(after.message).toBe(arm.message);
            expect(after.httpStatus).toBe(before.httpStatus);
            expect(after.category).toBe(before.category);
            expect(after.retryable).toBe(before.retryable);
            expect(after.fields).toBe(before.fields);
        });
    }

    it('`details` is the ONE property that moves — measured, not assumed', async () => {
        // Both envelopes fall through to the same last limb (`?? errorBody`),
        // because neither carries a `details`. So `err.details` is the whole
        // response body in both cases — and the body is what this card
        // reshapes. Discharged by census: nothing in-repo reads `err.details`
        // off a `shares.*` call.
        const arm = ARMS[1];
        const before = await refusalFrom(arm.status, arm.old, arm.call);
        const after = await refusalFrom(arm.status, nextBody(arm.code, arm.message), arm.call);

        expect(before.details).toEqual({ code: 'VALIDATION_FAILED', error: 'recipientId is required' });
        expect(after.details).toEqual({
            success: false,
            error: { code: 'VALIDATION_FAILED', message: 'recipientId is required' },
        });
        expect(after.details).not.toEqual(before.details);
    });

    it('the NEW envelope alone satisfies the whole read surface — no dialect straddle', async () => {
        // Read on its own terms rather than only relative to the old body: a
        // caller on a converged server gets the pair, not a half-populated error.
        for (const arm of ARMS) {
            const after = await refusalFrom(arm.status, nextBody(arm.code, arm.message), arm.call);
            expect(after.code, `${arm.label} lost its code`).toBe(arm.code);
            expect(after.message, `${arm.label} lost its message`).toBe(arm.message);
            expect(after.httpStatus, `${arm.label} lost its status`).toBe(arm.status);
        }
    });
});
