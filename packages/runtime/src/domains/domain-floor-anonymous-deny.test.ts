// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0138 D2 — "The decision is taken once per domain, as the domain's first
 * statement, never surface by surface". These three dispatcher domains decided
 * it per face until the decision moved to their entry:
 *
 *  - `/notifications` decided it below the inbox capability probe, so a
 *    deployment without an inbox answered an anonymous caller 501;
 *  - `/keys` decided it below the method check, so an anonymous caller using any
 *    verb but POST was answered 405;
 *  - `/share-links` decided it inside the management faces, below the service
 *    probe, so a deployment without the share-link service answered 501.
 *
 * ## What is pinned, per domain
 *
 *  A. every face refuses an anonymous caller (both shapes the dispatcher
 *     produces: an unresolved context, and the guest envelope) with the
 *     dispatcher-wrapper `401 UNAUTHENTICATED`, before any service is resolved;
 *  B. A NEW ROUTE IN THE DOMAIN ANSWERS 401: a request on a path or verb no face
 *     serves yet is refused by the same statement, because the decision precedes
 *     route selection — a face added later is behind it from the day it lands;
 *  C. the capability answer an anonymous caller used to get first (501, 405) is
 *     now behind the floor;
 *  D. the signed-in control: a member still reaches every face exactly as
 *     before, so the 401s are the floor's answer and not a broken door;
 *  E. (`/share-links` only) the two token faces of class 2 stay admitted to an
 *     anonymous caller — the one exception the record names for this domain.
 *
 * ⛔ The envelope builder is the REAL one the dispatcher wires in
 * (`apiErrorResponse`), so `error.code` is read where the wire carries it.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { SHARE_LINK_SERVICE } from '@objectstack/spec/contracts';

import { handleNotificationRequest } from './notifications.js';
import { handleKeysRequest } from './keys.js';
import { handleShareLinksRequest } from './share-links.js';
import { apiErrorResponse } from '../error-envelope.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

// ── contexts ────────────────────────────────────────────────────────────────

const anonUnresolved = () => ({ request: { headers: {} } }) as unknown as HttpProtocolContext;
/** What the dispatcher builds for an unauthenticated request: a guest, no user id. */
const guestEnvelope = () => ({
    request: { headers: {} },
    executionContext: {
        isSystem: false, principalKind: 'guest', positions: ['guest'], permissions: [], systemPermissions: [],
    },
}) as unknown as HttpProtocolContext;
const MEMBER_EC = { userId: 'usr_member', isSystem: false, positions: [], permissions: [], systemPermissions: [] };
const member = () => ({ request: { headers: {} }, executionContext: { ...MEMBER_EC } }) as unknown as HttpProtocolContext;

const ANONYMOUS_CONTEXTS: ReadonlyArray<readonly [string, () => HttpProtocolContext]> = [
    ['an unresolved context', anonUnresolved],
    ['the guest envelope', guestEnvelope],
];

// ── deps ────────────────────────────────────────────────────────────────────

function makeDeps(services: Record<string, unknown>) {
    const resolveService = vi.fn(async (_c: unknown, name: string) => services[name]);
    const getObjectQL = vi.fn(async () => undefined);
    const getRequestKernelService = vi.fn(async () => undefined);
    const deps = {
        resolveService,
        getObjectQL,
        getRequestKernelService,
        success: (data: unknown) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500, details?: unknown) =>
            apiErrorResponse({ message, httpStatus, details }),
        routeNotFound: (route: string) => apiErrorResponse({ message: `Route not found: ${route}`, httpStatus: 404 }),
        errorFromThrown: (e: any, fallback = 500) =>
            apiErrorResponse({ message: String(e?.message ?? e), httpStatus: e?.status ?? fallback }),
    } as unknown as DomainHandlerDeps;
    return { deps, resolveService, getObjectQL, getRequestKernelService };
}

/** The ADR-0112 refusal envelope, dispatcher-wrapper family: status AND code, never one alone. */
function expectAnonymousDenied(result: any) {
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(result.response.status).toBe(401);
    expect(result.response.body.success).toBe(false);
    expect(result.response.body.error.code).toBe(ANONYMOUS_DENY_CODE);
    expect(result.response.body.error.code).toBe('UNAUTHENTICATED');
    expect(result.response.body.error.httpStatus).toBe(401);
    expect(result.response.body.error.message).toBe(ANONYMOUS_DENY_MESSAGE);
    expect(result.response.body.data).toBeUndefined();
}

function expectNothingResolved(seams: ReturnType<typeof makeDeps>) {
    expect(seams.resolveService).not.toHaveBeenCalled();
    expect(seams.getObjectQL).not.toHaveBeenCalled();
    expect(seams.getRequestKernelService).not.toHaveBeenCalled();
}

// ── /notifications ──────────────────────────────────────────────────────────

const inbox = () => ({
    listInbox: vi.fn(async () => ({ notifications: [], unreadCount: 0 })),
    markRead: vi.fn(async () => ({ success: true, readCount: 0 })),
    markAllRead: vi.fn(async () => ({ success: true, readCount: 0 })),
});

/** [sub-path, method, body] — the three served faces. */
const NOTIFICATION_FACES = [
    ['', 'GET', undefined],
    ['/read', 'POST', { ids: ['n1'] }],
    ['/read/all', 'POST', undefined],
] as const;
/** Paths and verbs no face serves: what a route added later looks like today. */
const NOTIFICATION_UNSERVED = [
    ['/anon-unrouted', 'GET'],
    ['/read', 'DELETE'],
    ['', 'PUT'],
] as const;

describe('ADR-0138 D2 — /notifications decides anonymity once, as its first statement', () => {
    describe.each(ANONYMOUS_CONTEXTS)('%s', (_label, ctx) => {
        it.each(NOTIFICATION_FACES)('A — face %s %s is refused 401 and nothing is resolved', async (path, method, body) => {
            const seams = makeDeps({ notification: inbox() });
            expectAnonymousDenied(await handleNotificationRequest(seams.deps, path, method, body, {}, ctx()));
            expectNothingResolved(seams);
        });

        it.each(NOTIFICATION_UNSERVED)('B — a route the domain does not serve yet (%s %s) is refused 401', async (path, method) => {
            const seams = makeDeps({ notification: inbox() });
            expectAnonymousDenied(await handleNotificationRequest(seams.deps, path, method, undefined, {}, ctx()));
            expectNothingResolved(seams);
        });

        it('C — a deployment with no inbox answers 401, never the 501 capability disclosure', async () => {
            const seams = makeDeps({});
            expectAnonymousDenied(await handleNotificationRequest(seams.deps, '', 'GET', undefined, {}, ctx()));
            expectNothingResolved(seams);
        });
    });

    it('D — a member is served by the inbox with their own user id, and still gets the 501 with no inbox', async () => {
        const service = inbox();
        const served: any = await handleNotificationRequest(makeDeps({ notification: service }).deps, '', 'GET', undefined, {}, member());
        expect(served.response.status).toBe(200);
        expect(service.listInbox).toHaveBeenCalledWith('usr_member', { read: undefined, type: undefined, limit: undefined });

        const empty: any = await handleNotificationRequest(makeDeps({}).deps, '', 'GET', undefined, {}, member());
        expect(empty.response.status).toBe(501);
    });
});

// ── /keys ───────────────────────────────────────────────────────────────────

describe('ADR-0138 D2 — /keys decides anonymity once, as its first statement', () => {
    describe.each(ANONYMOUS_CONTEXTS)('%s', (_label, ctx) => {
        it('A — the mint face (POST) is refused 401 and nothing is resolved', async () => {
            const seams = makeDeps({});
            expectAnonymousDenied(await handleKeysRequest(seams.deps, 'POST', { name: 'k' }, ctx()));
            expectNothingResolved(seams);
        });

        it.each(['GET', 'PUT', 'DELETE', 'PATCH'])('B/C — a verb no face serves (%s) is refused 401, never the 405', async (method) => {
            const seams = makeDeps({});
            expectAnonymousDenied(await handleKeysRequest(seams.deps, method, undefined, ctx()));
            expectNothingResolved(seams);
        });
    });

    it('D — a member still gets the 405 for a wrong verb, and reaches the data service on POST', async () => {
        const wrongVerb: any = await handleKeysRequest(makeDeps({}).deps, 'GET', undefined, member());
        expect(wrongVerb.response.status).toBe(405);

        const seams = makeDeps({});
        const mint: any = await handleKeysRequest(seams.deps, 'POST', { name: 'k' }, member());
        // No data service in this harness: the member got past the floor and the
        // method check, and was told the data service is absent.
        expect(mint.response.status).toBe(503);
        expect(seams.getObjectQL).toHaveBeenCalledTimes(1);
    });
});

// ── /share-links ────────────────────────────────────────────────────────────

const shareLinkService = () => ({
    createLink: vi.fn(async () => ({ id: 'lnk_1' })),
    listLinks: vi.fn(async () => []),
    revokeLink: vi.fn(async () => undefined),
    resolveToken: vi.fn(async () => null),
});

/** [sub-path, method, body] — the management faces. */
const SHARE_LINK_MANAGEMENT_FACES = [
    ['', 'POST', { object: 'doc', recordId: 'd1' }],
    ['', 'GET', undefined],
    ['/lnk_1', 'DELETE', undefined],
] as const;
/** Paths and verbs no face serves, including the token routes under a verb they do not take. */
const SHARE_LINK_UNSERVED = [
    ['/a/b/c', 'GET'],
    ['/tok_1/resolve', 'POST'],
    ['/tok_1/messages', 'DELETE'],
    ['/tok_1/anon-unrouted', 'GET'],
] as const;

describe('ADR-0138 D2 — /share-links decides anonymity once, as its first statement, class 2 excepted', () => {
    describe.each(ANONYMOUS_CONTEXTS)('%s', (_label, ctx) => {
        it.each(SHARE_LINK_MANAGEMENT_FACES)('A — management face %s %s is refused 401 and nothing is resolved', async (path, method, body) => {
            const service = shareLinkService();
            const seams = makeDeps({ [SHARE_LINK_SERVICE]: service });
            expectAnonymousDenied(await handleShareLinksRequest(seams.deps, path, method, body, {}, ctx()));
            expectNothingResolved(seams);
            expect(service.createLink).not.toHaveBeenCalled();
            expect(service.listLinks).not.toHaveBeenCalled();
            expect(service.revokeLink).not.toHaveBeenCalled();
        });

        it.each(SHARE_LINK_UNSERVED)('B — a route the domain does not serve yet (%s %s) is refused 401', async (path, method) => {
            const seams = makeDeps({ [SHARE_LINK_SERVICE]: shareLinkService() });
            expectAnonymousDenied(await handleShareLinksRequest(seams.deps, path, method, undefined, {}, ctx()));
            expectNothingResolved(seams);
        });

        it('C — a deployment with no share-link service answers 401 on a management face, never the 501', async () => {
            const seams = makeDeps({});
            expectAnonymousDenied(await handleShareLinksRequest(seams.deps, '', 'GET', undefined, {}, ctx()));
            expectNothingResolved(seams);
        });

        it.each(['resolve', 'messages'])('E — the class 2 token face /:token/%s stays admitted: the token decides', async (face) => {
            const service = shareLinkService();
            const seams = makeDeps({ [SHARE_LINK_SERVICE]: service });
            const result: any = await handleShareLinksRequest(seams.deps, `/tok_1/${face}`, 'GET', undefined, {}, ctx());
            // The service was asked about the token; the refusal, if any, is the
            // token's answer (an unknown token here), never the anonymous 401.
            expect(service.resolveToken).toHaveBeenCalledTimes(1);
            expect(result.response.body?.error?.code).not.toBe('UNAUTHENTICATED');
            expect(result.response.status).not.toBe(401);
        });
    });

    it('D — a member still reaches every management face', async () => {
        const service = shareLinkService();
        const deps = makeDeps({ [SHARE_LINK_SERVICE]: service }).deps;
        expect(((await handleShareLinksRequest(deps, '', 'GET', undefined, {}, member())) as any).response.status).toBe(200);
        expect(service.listLinks).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'usr_member' }), expect.objectContaining(MEMBER_EC));
        expect(((await handleShareLinksRequest(deps, '/lnk_1', 'DELETE', undefined, {}, member())) as any).response.status).toBe(200);
        expect(service.revokeLink).toHaveBeenCalledTimes(1);
        const created: any = await handleShareLinksRequest(deps, '', 'POST', { object: 'doc', recordId: 'd1' }, {}, member());
        expect(created.response.status).toBe(201);
        expect(service.createLink).toHaveBeenCalledTimes(1);
        // …and with no service, a member gets the 501 the domain always answered.
        const empty: any = await handleShareLinksRequest(makeDeps({}).deps, '', 'GET', undefined, {}, member());
        expect(empty.response.status).toBe(501);
    });
});
