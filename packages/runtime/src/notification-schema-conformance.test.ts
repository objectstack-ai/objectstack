// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#5792 / Part of #3877] Stage A, notification family — the DISPATCHER half.
//
// The producer gate lives next to the producer
// (`service-messaging/src/notification-schema-conformance.test.ts`); it proves
// `MessagingService` authors bodies that satisfy the schemas
// `DEFAULT_NOTIFICATION_ROUTES` declares. This file proves the OTHER half: that
// `/notifications` hands those bodies to the wire unchanged, and that every one
// of the domain's emit sites — not only the three happy ones — answers in a
// declared shape.
//
// ## Why a pass-through needs its own gate
//
// `domains/notifications.ts` forwards `deps.success(result)`. "Forwards" is a
// property of today's code, not of the contract: a domain that starts folding
// in a computed `cursor`, an `unreadTotal`, or a re-keyed row would emit keys
// no schema declares, and the producer-side gate could not see it. `safeParse`
// on its own could not see it either — a zod object strips unknown keys — which
// is why this file carries the SAME two assertions as the producer gate:
//
//   * `Schema.safeParse(body.data)` judges VALUES;
//   * `Object.keys(body.data) ⊆ Schema.shape` judges KEYS.
//
// Both allowed sets are derived from the schemas' own `shape` (#5682 / the
// maintainer's 2026-08-06 ruling point 3) — never hand-listed here.
//
// ## The eight emit sites of this family
//
// #3877 measured the notification family at EIGHT thin emit sites. They are the
// eight `return`s of `domains/notifications.ts`, and three of them are the ones
// carrying a `responseSchema`:
//
//   1  :79  capabilityUnavailable — no service / not serveable / no `listInbox`
//   2  :86  deps.error('Authentication required', 401)
//   3  :111 deps.success(listInbox result)      ← ListNotificationsResponseSchema
//   4  :116 capabilityUnavailable — `markRead` absent
//   5  :128 throw validationFailure(...) — malformed mark-read body
//   6  :134 deps.success(markRead result)       ← MarkNotificationsReadResponseSchema
//   7  :139 capabilityUnavailable — `markAllRead` absent
//   8  :141 deps.success(markAllRead result)    ← MarkAllNotificationsReadResponseSchema
//
// (`return { handled: false }` for an unmatched sub-path is not an emit — the
// plugin's single exit turns it into 404 ROUTE_NOT_FOUND — but it is pinned
// below so the count is closed rather than assumed.)
//
// The five non-success sites carry no `responseSchema`; what they DO declare is
// the shared envelope, so they are gated against `envelopeViolations` plus the
// status each one owes. A family whose error exits were never checked is a
// family whose conformance claim covers only its happy path.

import { describe, it, expect } from 'vitest';
import {
    BaseResponseSchema,
    envelopeViolations,
    ListNotificationsRequestSchema,
    ListNotificationsResponseSchema,
    MarkNotificationsReadResponseSchema,
    MarkAllNotificationsReadResponseSchema,
    NotificationSchema,
    SERVICE_SELF_INFO_KEY,
} from '@objectstack/spec/api';
import { serviceUnavailableMessage } from '@objectstack/spec/system';
import { HttpDispatcher } from './http-dispatcher.js';
import { validationFailureDetails } from './validation-failure.js';

const USER = 'usr_dispatch_conformance';

/** Declared key sets — derived from the schemas, never hand-listed. */
const declaredListKeys = () => new Set(Object.keys((ListNotificationsResponseSchema as any).shape));
const declaredNotificationKeys = () => new Set(Object.keys((NotificationSchema as any).shape));
const declaredMarkReadKeys = () => new Set(Object.keys((MarkNotificationsReadResponseSchema as any).shape));
const declaredMarkAllReadKeys = () => new Set(Object.keys((MarkAllNotificationsReadResponseSchema as any).shape));

/**
 * The bodies the REAL `MessagingService` emits, measured by the producer gate
 * in `service-messaging` and restated here as the double's returns. Restated
 * rather than imported so `packages/runtime` does not take a dependency on the
 * provider that happens to fill the slot today — the domain must forward ANY
 * conforming provider's body, and `INotificationService` is what it is typed
 * against.
 */
const LIST_BODY = {
    notifications: [
        {
            id: 'n1', type: 'deal.won', title: 'Deal one', body: 'first',
            read: false, actionUrl: '/records/1', createdAt: '2026-08-07T15:02:26.891Z',
        },
        {
            id: 'n2', type: 'task.assigned', title: 'Task two', body: 'second',
            read: true, actionUrl: undefined, createdAt: '2026-08-07T15:02:26.897Z',
        },
    ],
    unreadCount: 1,
};
const MARK_READ_BODY = { success: true, readCount: 1 };
const MARK_ALL_BODY = { success: true, readCount: 2 };

/**
 * A dispatcher over a notification slot filled by `capabilities`. Omitting a
 * method is how a real send-only provider presents (`listInbox` / `markRead` /
 * `markAllRead` are separately OPTIONAL on `INotificationService`), which is
 * what makes emit sites 1 / 4 / 7 reachable.
 */
function makeDispatcher(capabilities: Record<string, unknown> | null = {
    listInbox: async () => LIST_BODY,
    markRead: async () => MARK_READ_BODY,
    markAllRead: async () => MARK_ALL_BODY,
}) {
    const resolve = (name: string) => (name === 'notification' ? capabilities : null);
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel);
}

const CTX = { request: {}, executionContext: { userId: USER } } as any;
const ANON_CTX = { request: {} } as any;

/** Every body this domain emits must satisfy the shared envelope in full. */
function expectEnvelope(body: unknown, success: boolean) {
    expect(BaseResponseSchema.safeParse(body).success, `not a BaseResponse: ${JSON.stringify(body)}`).toBe(true);
    // `safeParse` alone passes a success body with no `data`, or a payload
    // duplicated into a stray top-level key (#4049) — `envelopeViolations` is
    // the declared envelope in full.
    expect(envelopeViolations(body), `not the declared envelope: ${JSON.stringify(body)}`).toEqual([]);
    expect((body as { success?: boolean }).success).toBe(success);
}

describe('[#5792] /notifications conforms to the schemas the catalog declares', () => {
    // ═══════════════════════════════════════════════════════════════════════
    // Emit site 3 — GET /notifications
    // ═══════════════════════════════════════════════════════════════════════
    describe('emit site 3 — GET / → ListNotificationsResponseSchema', () => {
        it('satisfies the declared schema (VALUE assertion)', async () => {
            const result = await makeDispatcher().handleNotification('', 'GET', undefined, {}, CTX);

            expect(result.response?.status).toBe(200);
            expectEnvelope(result.response?.body, true);
            const parsed = ListNotificationsResponseSchema.safeParse(result.response?.body?.data);
            expect(
                parsed.success ? [] : parsed.error!.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
                'GET /notifications body must satisfy ListNotificationsResponseSchema',
            ).toEqual([]);
            // Anti-vacuity: an empty list also parses.
            expect(parsed.data?.notifications).toHaveLength(2);
        });

        it('emits NO top-level key the protocol does not declare (KEY assertion)', async () => {
            const result = await makeDispatcher().handleNotification('', 'GET', undefined, {}, CTX);

            const declared = declaredListKeys();
            expect(
                Object.keys(result.response?.body?.data ?? {}).filter((k) => !declared.has(k)),
                'undeclared top-level keys on the GET /notifications body',
            ).toEqual([]);
        });

        it('emits NO `notifications[]` key the protocol does not declare (KEY assertion, one level down)', async () => {
            const result = await makeDispatcher().handleNotification('', 'GET', undefined, {}, CTX);

            const declared = declaredNotificationKeys();
            const rows: Array<Record<string, unknown>> = result.response?.body?.data?.notifications ?? [];
            expect(rows.length, 'fixture must produce rows for this gate to mean anything').toBe(2);
            expect(
                [...new Set(rows.flatMap((n) => Object.keys(n).filter((k) => !declared.has(k))))],
                'undeclared keys inside notifications[] on the GET /notifications body',
            ).toEqual([]);
        });

        it('forwards the provider body UNCHANGED — no key added, none dropped', async () => {
            // The pass-through property stated as an assertion rather than
            // assumed from reading the handler. `deps.success(result)` must put
            // the provider's object under `data` verbatim.
            const result = await makeDispatcher().handleNotification('', 'GET', undefined, {}, CTX);

            expect(result.response?.body?.data).toBe(LIST_BODY);
            expect(Object.keys(result.response?.body?.data)).toEqual(Object.keys(LIST_BODY));
        });

        it('reads the declared query filters (`read` / `type` / `limit`) off the request', async () => {
            // Anti-vacuity for the route itself: the three filters
            // `ListNotificationsRequestSchema` declares AND `InboxQuery` accepts
            // must reach the provider, or the conforming body above would be a
            // conforming answer to a question nobody asked (#3676's shape).
            const seen: unknown[] = [];
            const dispatcher = makeDispatcher({
                listInbox: async (_userId: string, options: unknown) => { seen.push(options); return LIST_BODY; },
                markRead: async () => MARK_READ_BODY,
                markAllRead: async () => MARK_ALL_BODY,
            });

            await dispatcher.handleNotification('', 'GET', undefined, { read: 'false', type: 'deal.won', limit: '7' }, CTX);

            expect(seen[0]).toEqual({ read: false, type: 'deal.won', limit: 7 });
        });

        it('[#6361] the declaration no longer states a `limit` default the route never applies', async () => {
            // FLIPPED by #6361 (maintainer ruling 2026-08-07, Option A). This pin
            // used to record the DEFECT: `limit` was `z.number().default(20)` while
            // the route forwarded `undefined` and the provider applied its own 50,
            // so the declared default had never once been in effect.
            //
            // The runtime half of that measurement is UNCHANGED and is re-asserted
            // below, because the ruled direction was the schema catching up to the
            // implementation — not the reverse. What changed is the declaration:
            // there is no default to be wrong about any more.
            const seen: unknown[] = [];
            const dispatcher = makeDispatcher({
                listInbox: async (_userId: string, options: unknown) => { seen.push(options); return LIST_BODY; },
                markRead: async () => MARK_READ_BODY,
                markAllRead: async () => MARK_ALL_BODY,
            });

            await dispatcher.handleNotification('', 'GET', undefined, {}, CTX);

            // Behaviour: untouched. An omitted `limit` still reaches the provider
            // as `undefined`, which is what lets the provider window it.
            expect(seen[0]).toEqual({ read: undefined, type: undefined, limit: undefined });

            // Declaration: `limit` is now plainly optional — no `default`, so
            // parsing an empty query stamps no number onto it. Asserted through
            // the PARSE rather than through `_zod.def`, so it cannot go quietly
            // vacuous if the internal shape of a Zod default ever moves.
            const parsedEmpty = ListNotificationsRequestSchema.parse({});
            expect(Object.prototype.hasOwnProperty.call(parsedEmpty, 'limit')).toBe(false);
            expect((parsedEmpty as { limit?: number }).limit).toBeUndefined();
            // An explicit limit still parses — only the invented default is gone.
            expect(ListNotificationsRequestSchema.parse({ limit: 7 }).limit).toBe(7);
        });

        it('[#6361] `cursor` is retired on BOTH halves, and the ROUTE still ignores it', async () => {
            // The declaration half: tombstoned, not deleted, on request AND
            // response (one capability, two halves — the ruled clause).
            for (const schema of [ListNotificationsRequestSchema, ListNotificationsResponseSchema]) {
                const refused = schema.safeParse({ notifications: [], unreadCount: 0, cursor: 'n2' });
                expect(refused.success).toBe(false);
                expect(refused.error!.issues.some((i) => i.path.join('.') === 'cursor')).toBe(true);
            }

            // ⚠️ THE ROUTE'S BEHAVIOUR IS UNCHANGED, deliberately, and this is
            // the half worth pinning here. The tombstone is loud only where
            // something PARSES — and this route parses no query at all (#3899
            // wired the catalog's requestSchema for bodies only). So a request
            // still carrying `cursor` is IGNORED, exactly as before: 200, three
            // named keys read, no 400. The ruled direction was to stop declaring
            // a filter nobody reads, NOT to start refusing traffic, and this
            // assertion is what would catch the difference.
            const seen: unknown[] = [];
            const dispatcher = makeDispatcher({
                listInbox: async (_userId: string, options: unknown) => { seen.push(options); return LIST_BODY; },
                markRead: async () => MARK_READ_BODY,
                markAllRead: async () => MARK_ALL_BODY,
            });

            const result = await dispatcher.handleNotification(
                '', 'GET', undefined, { cursor: 'n2', limit: '2' }, CTX,
            );

            expect(result.response?.status).toBe(200);
            expect(seen[0]).toEqual({ read: undefined, type: undefined, limit: 2 });
            expect(seen[0]).not.toHaveProperty('cursor');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Emit sites 6 and 8 — the two mark-read routes
    // ═══════════════════════════════════════════════════════════════════════
    describe('emit site 6 — POST /read → MarkNotificationsReadResponseSchema', () => {
        it('satisfies the declared schema (VALUE assertion)', async () => {
            const result = await makeDispatcher().handleNotification('/read', 'POST', { ids: ['n1'] }, {}, CTX);

            expect(result.response?.status).toBe(200);
            expectEnvelope(result.response?.body, true);
            const parsed = MarkNotificationsReadResponseSchema.safeParse(result.response?.body?.data);
            expect(
                parsed.success ? [] : parsed.error!.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
                'POST /notifications/read body must satisfy MarkNotificationsReadResponseSchema',
            ).toEqual([]);
            expect(parsed.data?.readCount).toBe(1);
        });

        it('emits NO key the protocol does not declare (KEY assertion)', async () => {
            const result = await makeDispatcher().handleNotification('/read', 'POST', { ids: ['n1'] }, {}, CTX);

            const declared = declaredMarkReadKeys();
            expect(
                Object.keys(result.response?.body?.data ?? {}).filter((k) => !declared.has(k)),
                'undeclared keys on the POST /notifications/read body',
            ).toEqual([]);
        });
    });

    describe('emit site 8 — POST /read/all → MarkAllNotificationsReadResponseSchema', () => {
        it('satisfies the declared schema (VALUE assertion)', async () => {
            const result = await makeDispatcher().handleNotification('/read/all', 'POST', undefined, {}, CTX);

            expect(result.response?.status).toBe(200);
            expectEnvelope(result.response?.body, true);
            const parsed = MarkAllNotificationsReadResponseSchema.safeParse(result.response?.body?.data);
            expect(
                parsed.success ? [] : parsed.error!.issues.map((i) => `${i.path.join('.')}: ${i.code}`),
                'POST /notifications/read/all body must satisfy MarkAllNotificationsReadResponseSchema',
            ).toEqual([]);
            expect(parsed.data?.readCount).toBe(2);
        });

        it('emits NO key the protocol does not declare (KEY assertion)', async () => {
            const result = await makeDispatcher().handleNotification('/read/all', 'POST', undefined, {}, CTX);

            const declared = declaredMarkAllReadKeys();
            expect(
                Object.keys(result.response?.body?.data ?? {}).filter((k) => !declared.has(k)),
                'undeclared keys on the POST /notifications/read/all body',
            ).toEqual([]);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Emit sites 1 / 4 / 7 — the capability-unavailable exits
    // ═══════════════════════════════════════════════════════════════════════
    //
    // No `responseSchema` covers these; the envelope and the status ARE their
    // contract. 501 (not 404, not 503) is the ADR-0076 D12 answer for "the
    // route is mounted, the implementation is not" — see `domains/unavailable.ts`.
    describe('emit sites 1 / 4 / 7 — capabilityUnavailable(…, "notification")', () => {
        it.each([
            ['site 1 — empty slot', null, '', 'GET'],
            // The marker key is taken from the spec's own constant, not spelled
            // here — a hand-written `__serviceInfo` would make this row pass for
            // the wrong reason the day the marker is renamed.
            ['site 1 — a slot filled by a self-declared non-handler', { [SERVICE_SELF_INFO_KEY]: { status: 'stub', handlerReady: false }, listInbox: async () => LIST_BODY }, '', 'GET'],
            ['site 1 — a send-only provider with no `listInbox`', { send: async () => ({ success: true }) }, '', 'GET'],
            ['site 4 — an inbox provider with no `markRead`', { listInbox: async () => LIST_BODY }, '/read', 'POST'],
            ['site 7 — an inbox provider with no `markAllRead`', { listInbox: async () => LIST_BODY }, '/read/all', 'POST'],
        ])('%s → 501, declared envelope, the slot\'s own remedy sentence', async (_label, service, path, method) => {
            const dispatcher = makeDispatcher(service as Record<string, unknown> | null);

            const result = await dispatcher.handleNotification(path, method, { ids: ['n1'] }, {}, CTX);

            expect(result.handled).toBe(true);
            expect(result.response?.status).toBe(501);
            expectEnvelope(result.response?.body, false);
            // The message is the SAME sentence discovery reports for this slot,
            // by construction (`serviceUnavailableMessage`) — so the 501 body and
            // the discovery entry cannot name different remedies.
            expect(result.response?.body?.error?.message).toBe(serviceUnavailableMessage('notification'));
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Emit site 2 — the auth gate
    // ═══════════════════════════════════════════════════════════════════════
    it('emit site 2 — an unauthenticated caller gets 401 in the declared envelope', async () => {
        const result = await makeDispatcher().handleNotification('', 'GET', undefined, {}, ANON_CTX);

        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(401);
        expectEnvelope(result.response?.body, false);
        expect(result.response?.body?.error?.message).toBe('Authentication required');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // Emit site 5 — the request-schema gate (#3899)
    // ═══════════════════════════════════════════════════════════════════════
    it('emit site 5 — a malformed mark-read body is a VALIDATION_FAILED throw naming the field', async () => {
        // `{"notificationIds": [...]}` used to become `markRead(userId, [])` —
        // a 200 with `readCount: 0` and a badge that never cleared (#3899).
        const dispatcher = makeDispatcher();

        let thrown: unknown;
        try {
            await dispatcher.handleNotification('/read', 'POST', { notificationIds: ['n1'] }, {}, CTX);
        } catch (e) {
            thrown = e;
        }

        const details = validationFailureDetails(thrown);
        expect(details?.code).toBe('VALIDATION_FAILED');
        expect(details?.fields.map((f) => f.field)).toContain('ids');
    });

    // ═══════════════════════════════════════════════════════════════════════
    // The ninth return: not an emit, and pinned so the count is closed
    // ═══════════════════════════════════════════════════════════════════════
    it('an unmatched sub-path is `handled: false` — no body, so nothing to conform', async () => {
        const result = await makeDispatcher().handleNotification('/unknown', 'GET', undefined, {}, CTX);

        expect(result.handled).toBe(false);
        expect(result.response).toBeUndefined();
    });
});
