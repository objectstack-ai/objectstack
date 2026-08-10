// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #6928 — `GET /api/v1/notifications`'s coerced query parameters.
 *
 * The filed defect: `?limit=abc` was coerced with a bare `Number(...)`, so `NaN`
 * reached `MessagingService.listInbox`, survived its clamp
 * (`Math.min(Math.max(NaN ?? 50, 1), 200)` — `??` does not catch NaN and neither
 * bound rejects it) and landed in `data.find({ limit: NaN })`. Driver-dependent
 * behaviour from there, and never a 400. Applying the same probe to the route's
 * other two coerced parameters found the same shape twice more: `?read=1`
 * silently served the UNREAD half of the inbox, and a repeated `?type=a&type=b`
 * silently became the single topic `'a,b'`.
 *
 * Two halves are asserted here, and the second is the one that constrains the
 * fix hardest:
 *
 *  1. REFUSAL — a value the contract does not admit answers `400` with
 *     `error.code === 'VALIDATION_FAILED'` (ADR-0112) and a `details.fields[]`
 *     entry naming the parameter with an ADR-0114 field code. Both the code and
 *     the status are asserted on every refusal case: a `toThrow()` here would be
 *     permanently green, because the unfixed handler ALSO throws for some of
 *     these inputs (a `data.find({ limit: NaN })` that the driver rejects) — what
 *     was missing was never the throw, it was the envelope.
 *  2. PRESERVATION — every value that had a defensible answer before keeps it,
 *     byte for byte, including the clamp semantics for out-of-range numbers,
 *     which are DECLARED contract (`ListNotificationsRequestSchema.limit`) and
 *     therefore explicitly not part of the refusal.
 */

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import { validationFailureDetails, VALIDATION_FAILED_STATUS } from '../validation-failure.js';

/** A serveable notification slot whose `listInbox` records what it was asked for. */
function makeDispatcher() {
    const listInbox = vi.fn().mockResolvedValue({ notifications: [{ id: 'n1', read: false }], unreadCount: 1 });
    const service = { listInbox, markRead: vi.fn(), markAllRead: vi.fn() };
    const kernel: any = {
        context: { getService: (name: string) => (name === 'notification' ? service : null) },
    };
    return { dispatcher: new HttpDispatcher(kernel), listInbox };
}

const CTX = () => ({ request: {}, executionContext: { userId: 'u1' } } as any);

/**
 * Drive `GET /notifications` with a raw query object, the way the HTTP layer
 * delivers it (string values), and report the refusal as the wire would.
 *
 * The status is the one both dispatcher error exits derive for a thrown
 * validation failure with no `.status` of its own (`errorFromThrown`,
 * `errorResponseBase` — #3918); the wire-level proof that this really is the
 * status a socket sees lives in `notifications.hono.integration.test.ts`.
 */
async function refusalFor(query: Record<string, unknown>) {
    const { dispatcher, listInbox } = makeDispatcher();
    let thrown: unknown;
    let response: unknown;
    try {
        response = (await dispatcher.handleNotification('', 'GET', undefined, query, CTX())).response;
    } catch (e) {
        thrown = e;
    }
    expect(thrown, `${JSON.stringify(query)} was accepted (answered ${JSON.stringify(response)}) instead of refused`)
        .toBeDefined();
    const details = validationFailureDetails(thrown);
    const status =
        typeof (thrown as any)?.status === 'number' ? (thrown as any).status
        : details ? VALIDATION_FAILED_STATUS
        : 500;
    return { details, status, listInbox, message: (thrown as Error).message };
}

describe('#6928 — GET /notifications refuses a malformed `limit` instead of querying with NaN', () => {
    it.each([
        ['non-numeric', 'abc'],
        ['numeric prefix only', '10abc'],
        ['not a whole number', '1.5'],
        ['infinite', 'Infinity'],
        ['repeated parameter', ['1', '2']],
        ['structured', { $gt: 1 }],
    ])('refuses ?limit=%s with 400 VALIDATION_FAILED', async (_label, raw) => {
        const { details, status, listInbox } = await refusalFor({ limit: raw });

        // ADR-0112: the envelope, not merely the throw — `code` AND `status`.
        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        // ADR-0114: the field-addressed half names the parameter and the
        // constraint it violated, so a caller can point at the input.
        expect(details?.fields).toEqual([
            { field: 'limit', code: 'invalid_number', message: expect.stringContaining('`limit`') },
        ]);
        // The whole point: the service is never reached with a poisoned window.
        expect(listInbox).not.toHaveBeenCalled();
    });

    it('names the offending value in the message, capped so the body cannot be stuffed', async () => {
        const { message } = await refusalFor({ limit: 'x'.repeat(500) });

        expect(message).toContain('expected a whole number');
        expect(message.length).toBeLessThan(200);
    });
});

describe('#6928 — the same probe on this route\'s other coerced parameters', () => {
    it.each([
        ['1', '1'],
        ['uppercase TRUE', 'TRUE'],
        ['yes', 'yes'],
        ['empty', ''],
        ['repeated parameter', ['true', 'false']],
    ])('refuses ?read=%s rather than silently serving the unread half', async (_label, raw) => {
        const { details, status, listInbox } = await refusalFor({ read: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'read', code: 'invalid_boolean', message: expect.stringContaining('`read`') },
        ]);
        expect(listInbox).not.toHaveBeenCalled();
    });

    it.each([
        ['repeated parameter', ['a', 'b']],
        ['structured', { $ne: 'x' }],
    ])('refuses ?type=%s rather than filtering on a topic nobody asked for', async (_label, raw) => {
        const { details, status, listInbox } = await refusalFor({ type: raw });

        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(status).toBe(400);
        expect(details?.fields).toEqual([
            { field: 'type', code: 'invalid_type', message: expect.stringContaining('`type`') },
        ]);
        expect(listInbox).not.toHaveBeenCalled();
    });
});

describe('#6928 — every value that had a defensible answer keeps it', () => {
    async function listWith(query: Record<string, unknown>) {
        const { dispatcher, listInbox } = makeDispatcher();
        const result = await dispatcher.handleNotification('', 'GET', undefined, query, CTX());
        return { result, listInbox };
    }

    it.each([
        // [label, query, the exact InboxQuery the service must receive]
        ['no query at all', {}, { read: undefined, type: undefined, limit: undefined }],
        ['?limit=50', { limit: '50' }, { read: undefined, type: undefined, limit: 50 }],
        ['?limit=1 (the low boundary)', { limit: '1' }, { read: undefined, type: undefined, limit: 1 }],
        ['?limit=200 (the high boundary)', { limit: '200' }, { read: undefined, type: undefined, limit: 200 }],
        // Out of RANGE is not out of DOMAIN: the clamp into 1..200 is the
        // declared contract and stays the service's job, so the handler passes
        // these through exactly as it always did.
        ['?limit=1000 (over the clamp)', { limit: '1000' }, { read: undefined, type: undefined, limit: 1000 }],
        ['?limit=-5 (under the clamp)', { limit: '-5' }, { read: undefined, type: undefined, limit: -5 }],
        // Falsy spellings meant "no limit" before this gate existed and still do
        // — they must not become a new 400.
        ['?limit= (empty)', { limit: '' }, { read: undefined, type: undefined, limit: undefined }],
        ['?limit=0', { limit: '0' }, { read: undefined, type: undefined, limit: 0 }],
        ['limit: null', { limit: null }, { read: undefined, type: undefined, limit: undefined }],
        ['?read=true', { read: 'true' }, { read: true, type: undefined, limit: undefined }],
        ['?read=false', { read: 'false' }, { read: false, type: undefined, limit: undefined }],
        ['read: true (in-process boolean)', { read: true }, { read: true, type: undefined, limit: undefined }],
        ['?type=deal.won', { type: 'deal.won' }, { read: undefined, type: 'deal.won', limit: undefined }],
        [
            'all three together',
            { read: 'false', type: 'deal.won', limit: '10' },
            { read: false, type: 'deal.won', limit: 10 },
        ],
    ])('%s answers 200 and reaches the service unchanged', async (_label, query, expected) => {
        const { result, listInbox } = await listWith(query);

        expect(result.response?.status).toBe(200);
        expect(listInbox).toHaveBeenCalledWith('u1', expected);
    });

    it('leaves an unknown query key alone — `?cursor=…` is ignored, not refused (#6361)', async () => {
        // The spec TOMBSTONES `cursor` on this request schema, but nothing on
        // this path parses the query against that schema, so the key has always
        // been silently ignored here and `notification-schema-conformance
        // .integration.test.ts` pins that wire behaviour. Refusing unknown keys
        // is a separate decision with its own blast radius; this change does not
        // take it.
        const { result, listInbox } = await listWith({ limit: '2', cursor: 'n_007' });

        expect(result.response?.status).toBe(200);
        expect(listInbox).toHaveBeenCalledWith('u1', { read: undefined, type: undefined, limit: 2 });
    });

    it('still refuses an anonymous caller with 401 before it ever looks at the query', async () => {
        // Ordering matters: a malformed query from an unauthenticated caller
        // must not become a 400 that confirms the route is wired and serveable.
        const { dispatcher, listInbox } = makeDispatcher();
        const result = await dispatcher.handleNotification(
            '', 'GET', undefined, { limit: 'abc' }, { request: {} } as any,
        );

        expect(result.response?.status).toBe(401);
        expect(listInbox).not.toHaveBeenCalled();
    });
});
