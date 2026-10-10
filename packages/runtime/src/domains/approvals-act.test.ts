// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22576] The `/approvals/act` dispatcher domain — the ADR-0043 action page
 * for a kernel with no raw app (segment 2 of ruling A on #22438).
 *
 * Driven through the REAL `HttpDispatcher.dispatch()` on a kernel that
 * registers no `http.server` (the hosted shape: a tenant kernel owns no socket),
 * with a stub `approvals` member. The stub is shaped like the real one where it
 * matters — it reads the token off the `Request` it is handed, from the query
 * on `GET` and from `formData()` on `POST` — so a domain that handed it
 * anything other than the transport's own, unread request would be caught by
 * the member's own read rather than by an assertion about plumbing.
 *
 * What this pins:
 *  1. `GET` and `POST` reach the member with the transport's request, and the
 *     member's `Response` comes back as it is;
 *  2. `HEAD` is answered as the self-hosted mount answers it — the `GET`
 *     page's status and headers, no body — and never decides;
 *  3. the claim is the exact path and the three methods, nothing wider;
 *  4. an absent `approvals` slot, or a slot whose service has no
 *     `handleActionPage`, answers `501 NOT_IMPLEMENTED` — ⛔ never
 *     `ROUTE_NOT_FOUND`;
 *  5. a member that throws, or a body the transport already consumed, answers
 *     a sanitised `500` and is logged — never the member's message, never an
 *     "invalid link" page for a live link;
 *  6. the token is the only credential: a SIGNED-IN caller who is not a member
 *     of the request's environment reaches the member, exactly as an anonymous
 *     one does — the project-membership gate skips the exact act path, and
 *     only it.
 *
 * The wire half — the `@objectstack/hono` catch-all, the real approvals
 * plugin on both doors, `HEAD` parity with the self-hosted mount — is
 * `packages/qa/http-conformance/src/hono-approvals-act.conformance.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from '../http-dispatcher.js';

const ORIGIN = 'http://tenant.example';
const ACT = '/approvals/act';
const PAGE_HEADERS = { 'Content-Type': 'text/html; charset=utf-8', 'X-Page': 'action' };

/**
 * A member shaped like `ApprovalService.handleActionPage`: the token from the
 * query on `GET`, from the LAST `token` form field on `POST`, and a page that
 * names it. It records every request it was handed.
 */
function stubMember() {
    const seen: Request[] = [];
    const tokens: string[] = [];
    const handleActionPage = vi.fn(async (request: Request): Promise<Response> => {
        seen.push(request);
        let token = '';
        if (request.method === 'GET') {
            token = new URL(request.url).searchParams.get('token') ?? '';
        } else if (request.method === 'POST') {
            const fields = (await request.formData()).getAll('token');
            token = String(fields[fields.length - 1] ?? '');
        } else {
            return new Response(null, { status: 405, headers: { Allow: 'GET, POST' } });
        }
        tokens.push(token);
        return new Response(`<p>${request.method} ${token}</p>`, { status: 200, headers: PAGE_HEADERS });
    });
    return { handleActionPage, seen, tokens };
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
const get = (token: string) => new Request(`${ORIGIN}/api/v1${ACT}?token=${encodeURIComponent(token)}`);
const form = (token: string) => new Request(`${ORIGIN}/api/v1${ACT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
});

/** `{ status, code }` of a dispatcher envelope answer. */
const envelope = (r: any) => ({ status: r.response?.status, code: r.response?.body?.error?.code });

describe('[#22576] /approvals/act forwards to the approvals member on a kernel with no http.server', () => {
    it('GET reaches the member with the transport\'s own request, and its Response comes back as it is', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ approvals: { handleActionPage: member.handleActionPage } });
        const request = get('tok-get');

        const result = await dispatcher.dispatch('GET', ACT, undefined, { token: 'tok-get' }, ctx(request));

        expect(result.handled).toBe(true);
        expect(member.handleActionPage).toHaveBeenCalledTimes(1);
        expect(member.seen[0]).toBe(request);
        expect(member.tokens).toEqual(['tok-get']);
        const res = result.result as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(res.headers.get('x-page')).toBe('action');
        expect(await res.text()).toBe('<p>GET tok-get</p>');
        expect(result.response).toBeUndefined();
    });

    it('POST reaches the member with the form body UNREAD — the member reads the token itself', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ approvals: { handleActionPage: member.handleActionPage } });
        const request = form('tok-post');

        // The parsed `body` a transport hands dispatch() is irrelevant here:
        // the domain never reads it, the member reads the request.
        const result = await dispatcher.dispatch('POST', ACT, {}, {}, ctx(request));

        expect(member.seen[0]).toBe(request);
        expect(member.tokens).toEqual(['tok-post']);
        expect(await (result.result as Response).text()).toBe('<p>POST tok-post</p>');
    });

    it('HEAD is the GET page with no body — forwarded as a GET, so the member renders and never decides', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ approvals: { handleActionPage: member.handleActionPage } });
        const request = new Request(`${ORIGIN}/api/v1${ACT}?token=tok-head`, {
            method: 'HEAD',
            headers: { 'Accept-Language': 'de' },
        });

        const result = await dispatcher.dispatch('HEAD', ACT, undefined, {}, ctx(request));

        expect(member.handleActionPage).toHaveBeenCalledTimes(1);
        const forwarded = member.seen[0]!;
        expect(forwarded.method).toBe('GET');
        expect(forwarded.url).toBe(request.url);
        expect(forwarded.headers.get('accept-language')).toBe('de');
        expect(member.tokens).toEqual(['tok-head']);

        const res = result.result as Response;
        expect(res.status).toBe(200);
        expect([...res.headers.entries()]).toEqual([
            ['content-type', 'text/html; charset=utf-8'],
            ['x-page', 'action'],
        ]);
        expect(res.body).toBeNull();
    });

    it('claims exactly /approvals/act for GET, HEAD and POST — no other method, no sub-path, no sibling', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ approvals: { handleActionPage: member.handleActionPage } });
        const claimant = (path: string, method: string): string | undefined =>
            (dispatcher as any).domainRegistry.resolve(path, method)?.prefix;

        for (const method of ['GET', 'HEAD', 'POST']) expect(claimant(ACT, method), method).toBe(ACT);
        for (const method of ['PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(claimant(ACT, method), method).toBeUndefined();
        for (const path of ['/approvals', '/approvals/act/x', '/approvals/actx', '/approvals/requests']) {
            expect(claimant(path, 'GET'), path).toBeUndefined();
        }

        // On the wire: an unclaimed method is the dispatcher's ordinary miss,
        // and the member never runs for it.
        const put = await dispatcher.dispatch('PUT', ACT, {}, {}, ctx(new Request(`${ORIGIN}/api/v1${ACT}`, { method: 'PUT' })));
        expect(envelope(put)).toEqual({ status: 404, code: 'ROUTE_NOT_FOUND' });
        expect(member.handleActionPage).not.toHaveBeenCalled();
    });
});

describe('[#22576] absence is a typed 501, never ROUTE_NOT_FOUND', () => {
    it('no approvals slot on the kernel: 501 NOT_IMPLEMENTED, for GET, HEAD and POST', async () => {
        const { dispatcher } = makeDispatcher({});
        for (const [method, request] of [['GET', get('t')], ['HEAD', new Request(`${ORIGIN}/api/v1${ACT}`, { method: 'HEAD' })], ['POST', form('t')]] as const) {
            const result = await dispatcher.dispatch(method, ACT, {}, {}, ctx(request));
            expect(envelope(result), method).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(result.response?.body?.error?.message).toContain('no approvals service is registered');
        }
    });

    it('an approvals service with no handleActionPage member: 501 NOT_IMPLEMENTED, naming the member', async () => {
        const { dispatcher } = makeDispatcher({ approvals: { getRequest: vi.fn() } });
        const result = await dispatcher.dispatch('GET', ACT, undefined, {}, ctx(get('t')));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain('does not implement handleActionPage');
    });
});

describe('[#22576] faults are the server\'s, answered as such', () => {
    it('a member that throws: a sanitised 500, its message withheld from the client and logged', async () => {
        const boom = new Error('SQLITE_ERROR: no such table: sys_approval_token');
        const { dispatcher, logger } = makeDispatcher({ approvals: { handleActionPage: vi.fn().mockRejectedValue(boom) } });

        const result = await dispatcher.dispatch('GET', ACT, undefined, {}, ctx(get('t')));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(result.response?.body)).not.toContain('sys_approval_token');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0]![1]).toBe(boom);
    });

    it('a POST whose body the transport already consumed: 500 and logged, and the member is never asked', async () => {
        const member = stubMember();
        const { dispatcher, logger } = makeDispatcher({ approvals: { handleActionPage: member.handleActionPage } });
        const request = form('live-token');
        await request.text(); // what the hono catch-all's `c.req.json()` used to do

        const result = await dispatcher.dispatch('POST', ACT, {}, {}, ctx(request));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(member.handleActionPage).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('request body was consumed');
    });
});

describe('[#22576] the token is the only credential — the membership gate skips the exact act path', () => {
    const ENV = 'env-tenant-1';
    const USER = 'u-signed-in-not-a-member';

    /**
     * A multi-tenant host: the resolver places every request in `ENV` on a
     * tenant kernel whose session reads a SIGNED-IN user and whose
     * `sys_environment_member` holds NO row for them. A path that reaches the
     * membership check therefore answers `403 PROJECT_MEMBERSHIP_REQUIRED`; a
     * path the check skips reaches its domain. The two are told apart by the
     * answer itself.
     */
    function makeTenantHost() {
        const member = stubMember();
        const find = vi.fn().mockResolvedValue([]);
        const objectql = {
            find,
            getObjects: vi.fn().mockReturnValue({}),
            registry: {
                getObject: vi.fn((name: string) => (name === 'sys_environment_member' ? { name } : null)),
                getRegisteredTypes: vi.fn().mockReturnValue([]),
            },
        };
        const auth = {
            getApi: async () => ({
                getSession: async () => ({
                    user: { id: USER },
                    session: { userId: USER, activeOrganizationId: 'org-tenant' },
                }),
            }),
        };
        const tenant = kernelWith({ objectql, auth, approvals: { handleActionPage: member.handleActionPage } });
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
        return { dispatcher, member, membershipReads };
    }

    it('a signed-in non-member reaches the member on GET and POST, and no membership read is made', async () => {
        const { dispatcher, member, membershipReads } = makeTenantHost();

        const viaGet = await dispatcher.dispatch('GET', ACT, undefined, {}, ctx(get('tok-1')));
        const viaPost = await dispatcher.dispatch('POST', ACT, {}, {}, ctx(form('tok-2')));

        expect(viaGet.response, JSON.stringify(viaGet.response?.body)).toBeUndefined();
        expect(viaPost.response, JSON.stringify(viaPost.response?.body)).toBeUndefined();
        expect(member.tokens).toEqual(['tok-1', 'tok-2']);
        expect(membershipReads()).toBe(0);
    });

    it('the scoped spelling of the same route is skipped too, as the ADR-0069 allow-list admits it', async () => {
        const { dispatcher, member, membershipReads } = makeTenantHost();
        const result = await dispatcher.dispatch('GET', `/environments/${ENV}${ACT}`, undefined, {}, ctx(get('tok-s')));
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(member.tokens).toEqual(['tok-s']);
        expect(membershipReads()).toBe(0);
    });

    it('⭐ control: the same caller on every neighbour of the act path is still checked and refused', async () => {
        for (const path of ['/approvals/act/x', '/approvals/actx', '/approvals', '/approvals/requests', '/data/task']) {
            const { dispatcher, member, membershipReads } = makeTenantHost();
            const result = await dispatcher.dispatch('GET', path, undefined, {}, ctx(new Request(`${ORIGIN}/api/v1${path}`)));
            expect(envelope(result), path).toEqual({ status: 403, code: 'PROJECT_MEMBERSHIP_REQUIRED' });
            expect(membershipReads(), path).toBe(1);
            expect(member.handleActionPage).not.toHaveBeenCalled();
        }
    });
});
