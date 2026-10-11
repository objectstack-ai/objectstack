// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22755] The `/webhooks/redeliver` dispatcher domain — the webhook redeliver
 * door for a kernel with no raw app (segment 2 of #22564's stage 2; ruling A
 * on #22438).
 *
 * Driven through the REAL `HttpDispatcher.dispatch()` on a kernel that
 * registers no `http.server` (the hosted shape: a tenant kernel owns no socket),
 * with a stub `webhooks` member. The stub is shaped like the real one where it
 * matters — it reads its `deliveryId` with `request.json()` off the `Request`
 * it is handed — so a domain that handed it anything other than the
 * transport's own, unread request would be caught by the member's own read
 * rather than by an assertion about plumbing.
 *
 * What this pins:
 *  1. `POST` reaches the member with the transport's request, and the member's
 *     `Response` comes back as it is;
 *  2. the claim is the exact path and `POST` alone: no other method, no
 *     sub-path, no sibling — and the member never runs for a non-`POST`;
 *  3. an absent `webhooks` slot, or a slot whose service has no
 *     `handleRedeliver`, answers `501 NOT_IMPLEMENTED` — ⛔ never
 *     `ROUTE_NOT_FOUND`;
 *  4. the slot is resolved per request: a slot that appears after a request
 *     was answered `501` is reached by the next one (nothing recorded the
 *     absence);
 *  5. a member that throws, or a body the transport already consumed, answers
 *     a sanitised `500` and is logged — never the member's message, never a
 *     "not JSON" refusal for a well-formed request;
 *  6. no preamble-gate exemption: unlike `/approvals/act`, the project-
 *     membership gate and the ADR-0069 auth gate both apply to this path, so
 *     a signed-in non-member and a session owing an authentication step are
 *     stopped before the member runs, while a member of the environment and an
 *     anonymous caller reach it (the member itself refuses the anonymous one).
 *
 * The wire half — the `@objectstack/hono` catch-all, the real plugin-webhooks
 * member on both doors — is
 * `packages/qa/http-conformance/src/hono-webhooks-redeliver.conformance.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from '../http-dispatcher.js';

const ORIGIN = 'http://tenant.example';
const REDELIVER = '/webhooks/redeliver';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/**
 * A member shaped like `IWebhookService.handleRedeliver`: it reads the
 * `deliveryId` from the JSON body of the request it is handed and answers
 * with it. It records every request it was handed.
 */
function stubMember() {
    const seen: Request[] = [];
    const ids: string[] = [];
    const handleRedeliver = vi.fn(async (request: Request): Promise<Response> => {
        seen.push(request);
        let body: any;
        try {
            body = await request.json();
        } catch {
            return new Response(JSON.stringify({ success: false, error: { code: 'INVALID_REQUEST', message: 'Request body must be JSON.' } }), { status: 400, headers: JSON_HEADERS });
        }
        ids.push(String(body?.deliveryId));
        return new Response(JSON.stringify({ success: true, data: { id: body?.deliveryId, status: 'pending' } }), { status: 200, headers: JSON_HEADERS });
    });
    return { handleRedeliver, seen, ids };
}

/** A kernel with no `http.server` — only the services named. */
function kernelWith(services: Record<string, unknown>): any {
    return {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
}

function makeDispatcher(services: Record<string, unknown>) {
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });
    (dispatcher as any).domainDeps.logger = logger;
    return { dispatcher, logger };
}

const ctx = (request: Request): HttpProtocolContext => ({ request });
const post = (body: unknown = { deliveryId: 'del_1' }, path = REDELIVER) => new Request(`${ORIGIN}/api/v1${path}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
});

/** `{ status, code }` of a dispatcher envelope answer. */
const envelope = (r: any) => ({ status: r.response?.status, code: r.response?.body?.error?.code });

describe('[#22755] /webhooks/redeliver forwards to the webhooks member on a kernel with no http.server', () => {
    it('POST reaches the member with the transport\'s own request, body unread, and its Response comes back as it is', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ webhooks: { handleRedeliver: member.handleRedeliver } });
        const request = post({ deliveryId: 'del_42' });

        // The parsed `body` a transport hands dispatch() is irrelevant here:
        // the domain never reads it, the member reads the request.
        const result = await dispatcher.dispatch('POST', REDELIVER, { deliveryId: 'not-this-one' }, {}, ctx(request));

        expect(result.handled).toBe(true);
        expect(member.handleRedeliver).toHaveBeenCalledTimes(1);
        expect(member.seen[0]).toBe(request);
        expect(member.ids).toEqual(['del_42']);
        const res = result.result as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('application/json');
        expect(await res.json()).toEqual({ success: true, data: { id: 'del_42', status: 'pending' } });
        expect(result.response).toBeUndefined();
    });

    it('a refusal the member makes is the member\'s, passed through untouched — status and body', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ webhooks: { handleRedeliver: member.handleRedeliver } });
        const request = new Request(`${ORIGIN}/api/v1${REDELIVER}`, { method: 'POST', headers: JSON_HEADERS, body: '{deliveryId:' });

        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(request));

        expect(result.response).toBeUndefined();
        const res = result.result as Response;
        expect(res.status).toBe(400);
        expect(await res.json()).toEqual({ success: false, error: { code: 'INVALID_REQUEST', message: 'Request body must be JSON.' } });
    });

    it('claims exactly /webhooks/redeliver for POST — no other method, no sub-path, no sibling', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ webhooks: { handleRedeliver: member.handleRedeliver } });
        const claimant = (path: string, method: string): string | undefined =>
            (dispatcher as any).domainRegistry.resolve(path, method)?.prefix;

        expect(claimant(REDELIVER, 'POST')).toBe(REDELIVER);
        for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(claimant(REDELIVER, method), method).toBeUndefined();
        for (const path of ['/webhooks', '/webhooks/redeliver/x', '/webhooks/redeliverx', '/webhooks/deliveries']) {
            expect(claimant(path, 'POST'), path).toBeUndefined();
        }

        // On the wire: an unclaimed method is the dispatcher's ordinary miss,
        // and the member never runs for it — the member does not match the
        // method, so a non-POST that reached it would be judged as a redeliver.
        for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
            const request = new Request(`${ORIGIN}/api/v1${REDELIVER}`, { method });
            const result = await dispatcher.dispatch(method, REDELIVER, undefined, {}, ctx(request));
            expect(envelope(result), method).toEqual({ status: 404, code: 'ROUTE_NOT_FOUND' });
        }
        expect(member.handleRedeliver).not.toHaveBeenCalled();
    });
});

describe('[#22755] absence is a typed 501, never ROUTE_NOT_FOUND', () => {
    it('no webhooks slot on the kernel: 501 NOT_IMPLEMENTED, naming the plugin that registers it', async () => {
        const { dispatcher } = makeDispatcher({});
        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain('no webhooks service is registered');
        expect(result.response?.body?.error?.message).toContain('@objectstack/plugin-webhooks');
    });

    it('a webhooks service with no handleRedeliver member: 501 NOT_IMPLEMENTED, naming the member', async () => {
        const { dispatcher } = makeDispatcher({ webhooks: { somethingElse: vi.fn() } });
        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain('does not implement handleRedeliver');
    });

    it('the slot is read per request: one registered after a 501 is reached by the next request', async () => {
        // plugin-webhooks registers the slot at `kernel:ready`, after its veto
        // installs. A domain that read the slot once — at registration, or on
        // its first request — would keep answering 501 after that.
        const services: Record<string, unknown> = {};
        const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
        const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });
        (dispatcher as any).domainDeps.logger = logger;

        const before = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));
        expect(envelope(before)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });

        const member = stubMember();
        services.webhooks = { handleRedeliver: member.handleRedeliver };
        const after = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post({ deliveryId: 'del_late' })));
        expect(after.response, JSON.stringify(after.response?.body)).toBeUndefined();
        expect((after.result as Response).status).toBe(200);
        expect(member.ids).toEqual(['del_late']);
    });
});

describe('[#22755] faults are the server\'s, answered as such', () => {
    it('a member that throws: a sanitised 500, its message withheld from the client and logged', async () => {
        const boom = new Error('SQLITE_ERROR: no such table: sys_http_delivery');
        const { dispatcher, logger } = makeDispatcher({ webhooks: { handleRedeliver: vi.fn().mockRejectedValue(boom) } });

        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(result.response?.body)).not.toContain('sys_http_delivery');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0]![1]).toBe(boom);
    });

    it('a POST whose body the transport already consumed: 500 and logged, and the member is never asked', async () => {
        const member = stubMember();
        const { dispatcher, logger } = makeDispatcher({ webhooks: { handleRedeliver: member.handleRedeliver } });
        const request = post({ deliveryId: 'del_live' });
        await request.text(); // what a transport that parsed `c.req.json()` off the raw request would leave

        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(request));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(member.handleRedeliver).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('request body was consumed');
    });
});

describe('[#22755] no preamble-gate exemption — the credential is the session, so both gates apply', () => {
    const ENV = 'env-tenant-1';
    const USER = 'u-operator';

    /**
     * A multi-tenant host: the resolver places every request in `ENV` on a
     * tenant kernel whose session reads `session` (mutable per case) and whose
     * `sys_environment_member` holds a row only when `member` is set. A path
     * that reaches the membership check with a non-member answers
     * `403 PROJECT_MEMBERSHIP_REQUIRED`; the answer itself tells the cases
     * apart.
     */
    function makeTenantHost(opts: { member?: boolean; authGate?: { code: string; message: string } } = {}) {
        const webhooks = stubMember();
        const find = vi.fn(async (object: string) => (object === 'sys_environment_member' && opts.member
            ? [{ environment_id: ENV, user_id: USER }]
            : []));
        const objectql = {
            find,
            getObjects: vi.fn().mockReturnValue({}),
            registry: {
                getObject: vi.fn((name: string) => (name === 'sys_environment_member' ? { name } : null)),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
            },
        };
        let signedIn = true;
        const auth = {
            isAuthGateActive: () => opts.authGate !== undefined,
            getApi: async () => ({
                getSession: async () => (signedIn
                    ? {
                        user: { id: USER, ...(opts.authGate ? { authGate: opts.authGate } : {}) },
                        session: { userId: USER, activeOrganizationId: 'org-tenant' },
                    }
                    : null),
            }),
        };
        const tenant = kernelWith({ objectql, auth, webhooks: { handleRedeliver: webhooks.handleRedeliver } });
        const resolver: KernelResolver = {
            resolveKernel: async (c: HttpProtocolContext) => {
                c.environmentId = ENV;
                return tenant;
            },
        };
        const dispatcher = new HttpDispatcher(kernelWith({}), undefined, {
            kernelResolver: resolver,
            enforceProjectMembership: true,
        });
        const membershipReads = () => find.mock.calls.filter((call) => call[0] === 'sys_environment_member').length;
        return { dispatcher, webhooks, membershipReads, signOut: () => { signedIn = false; } };
    }

    it('a signed-in caller who is not a member of the environment is refused 403 before the member runs', async () => {
        const { dispatcher, webhooks, membershipReads } = makeTenantHost();
        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));
        expect(envelope(result)).toEqual({ status: 403, code: 'PROJECT_MEMBERSHIP_REQUIRED' });
        expect(membershipReads()).toBe(1);
        expect(webhooks.handleRedeliver).not.toHaveBeenCalled();
    });

    it('…and so is the environment-scoped spelling of the same route', async () => {
        const { dispatcher, webhooks } = makeTenantHost();
        const result = await dispatcher.dispatch('POST', `/environments/${ENV}${REDELIVER}`, {}, {}, ctx(post()));
        expect(envelope(result)).toEqual({ status: 403, code: 'PROJECT_MEMBERSHIP_REQUIRED' });
        expect(webhooks.handleRedeliver).not.toHaveBeenCalled();
    });

    it('⭐ control: a member of the environment reaches the member, on both spellings', async () => {
        for (const path of [REDELIVER, `/environments/${ENV}${REDELIVER}`]) {
            const { dispatcher, webhooks, membershipReads } = makeTenantHost({ member: true });
            const result = await dispatcher.dispatch('POST', path, {}, {}, ctx(post({ deliveryId: 'del_member' })));
            expect(result.response, `${path} ${JSON.stringify(result.response?.body)}`).toBeUndefined();
            expect((result.result as Response).status, path).toBe(200);
            expect(webhooks.ids, path).toEqual(['del_member']);
            expect(membershipReads(), path).toBe(1);
        }
    });

    it('an anonymous caller passes both gates — they decide nothing for it — and reaches the member, which judges it', async () => {
        const { dispatcher, webhooks, membershipReads, signOut } = makeTenantHost();
        signOut();
        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(webhooks.handleRedeliver).toHaveBeenCalledTimes(1);
        expect(membershipReads()).toBe(0);
    });

    it('a session that still owes an authentication step is stopped by the ADR-0069 gate: the path is not allow-listed', async () => {
        // The same member fixture the control above lets through, now with a
        // gate posture on its session: the gate, and nothing else, refuses it.
        const { dispatcher, webhooks } = makeTenantHost({
            member: true,
            authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
        });
        const result = await dispatcher.dispatch('POST', REDELIVER, {}, {}, ctx(post()));
        expect(result.response?.status).toBe(403);
        // The gate's 403 carries its code in `details` (`error(msg, 403, { code })`).
        expect(result.response?.body?.error?.details?.code ?? result.response?.body?.error?.code).toBe('PASSWORD_EXPIRED');
        expect(webhooks.handleRedeliver).not.toHaveBeenCalled();
    });
});
