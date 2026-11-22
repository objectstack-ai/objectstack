// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36469] The `/comments` dispatcher domain — the three comment doors for a
 * kernel with no `http.server` (ruling A on #22438, applied to this member of
 * the class).
 *
 * Driven through the REAL `HttpDispatcher.dispatch()` on a kernel that
 * registers no `http.server` (the hosted shape), with a stub `comments`
 * member that reads the request it is handed (method, path, JSON body).
 *
 * What this pins:
 *  1. each of the three shapes reaches the member with the transport's own
 *     request, body unread, and the member's `Response` comes back as it is;
 *  2. the claim is the three method and path shapes alone: every other method
 *     and every other path under `/comments` keeps the dispatcher's ordinary
 *     miss, and the member never runs for one;
 *  3. an absent `comments` slot, or a slot with no `handleCommentDoor`,
 *     answers `501 NOT_IMPLEMENTED` — ⛔ never a route miss — and the slot is
 *     read per request;
 *  4. a member that throws, or a body the transport already consumed, answers
 *     a sanitised `500` and is logged;
 *  5. the environment-scoped spelling reaches the member at the door's wire
 *     path, its body unread;
 *  6. no preamble-gate exemption: a signed-in non-member of the environment
 *     and a session owing an authentication step are stopped before the
 *     member runs, a member of the environment reaches it.
 *
 * The wire half — `createHonoApp` over a kernel with the REAL AuditPlugin and
 * no `http.server` — is
 * `packages/qa/http-conformance/src/hono-comment-doors.conformance.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
// Paid during collection, not inside a case's clock: the dispatcher reaches
// `standalone-stack.ts`, whose dynamic `@objectstack/metadata` import would
// otherwise load inside the first case that gets that far (check:test-source-alias).
import '@objectstack/metadata';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from '../http-dispatcher.js';

const ORIGIN = 'http://tenant.example';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** A member shaped like `ICommentDoorsService.handleCommentDoor`: it records and echoes what it was handed. */
function stubMember() {
    const seen: Array<{ request: Request; method: string; path: string; body: string }> = [];
    const handleCommentDoor = vi.fn(async (request: Request): Promise<Response> => {
        const body = await request.text();
        const path = new URL(request.url).pathname;
        seen.push({ request, method: request.method, path, body });
        return new Response(JSON.stringify({ success: true, data: { method: request.method, path, body } }), {
            status: 200,
            headers: JSON_HEADERS,
        });
    });
    return { handleCommentDoor, seen };
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
const wire = (method: string, path: string, body?: unknown, prefix = '/api/v1') => new Request(`${ORIGIN}${prefix}${path}`, {
    method,
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** `{ status, code }` of a dispatcher envelope answer. */
const envelope = (r: any) => ({ status: r.response?.status, code: r.response?.body?.error?.code });

const DOORS: Array<[method: string, path: string, body?: unknown]> = [
    ['DELETE', '/comments/reactions/rx_1'],
    ['PUT', '/comments/c_1/resolution', { resolved: true }],
    ['DELETE', '/comments/c_1'],
];

describe('[#36469] /comments forwards the three comment doors to the comments member on a kernel with no http.server', () => {
    it.each(DOORS)('%s %s reaches the member with the transport\'s own request, body unread, and its Response comes back as it is', async (method, path, body) => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ comments: { handleCommentDoor: member.handleCommentDoor } });
        const request = wire(method, path, body);

        const result = await dispatcher.dispatch(method, path, { resolved: 'not-this-one' }, {}, ctx(request));

        expect(result.handled).toBe(true);
        expect(result.response).toBeUndefined();
        expect(member.handleCommentDoor).toHaveBeenCalledTimes(1);
        expect(member.seen[0]!.request).toBe(request);
        const res = result.result as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            success: true,
            data: { method, path: `/api/v1${path}`, body: body === undefined ? '' : JSON.stringify(body) },
        });
    });

    it('claims exactly the three shapes: every other method and path keeps the ordinary miss, and the member never runs', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ comments: { handleCommentDoor: member.handleCommentDoor } });
        const misses: Array<[string, string]> = [
            ['GET', '/comments/c_1'],
            ['POST', '/comments/c_1'],
            ['PATCH', '/comments/c_1'],
            ['PUT', '/comments/c_1'],
            ['DELETE', '/comments/c_1/resolution'],
            ['GET', '/comments/c_1/resolution'],
            ['PUT', '/comments/reactions/rx_1'],
            ['DELETE', '/comments'],
            ['DELETE', '/comments/'],
            ['DELETE', '/comments/reactions/rx_1/x'],
            ['DELETE', '/comments/c_1/resolution/x'],
        ];
        for (const [method, path] of misses) {
            const result = await dispatcher.dispatch(method, path, undefined, {}, ctx(wire(method, path)));
            expect(envelope(result), `${method} ${path}`).toEqual({ status: 404, code: 'ROUTE_NOT_FOUND' });
        }
        // A lexical sibling is not under the segment claim at all.
        expect((dispatcher as any).domainRegistry.resolve('/commentsx/c_1', 'DELETE')).toBeUndefined();
        expect(member.handleCommentDoor).not.toHaveBeenCalled();
    });

    it('the environment-scoped spelling reaches the member at the door\'s wire path, body unread', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher({ comments: { handleCommentDoor: member.handleCommentDoor } });
        const path = '/environments/env_1/comments/c_9/resolution';
        const request = wire('PUT', path, { resolved: false });

        const result = await dispatcher.dispatch('PUT', path, {}, {}, ctx(request));

        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(member.seen).toHaveLength(1);
        expect(member.seen[0]!.path).toBe('/api/v1/comments/c_9/resolution');
        expect(member.seen[0]!.body).toBe('{"resolved":false}');
    });
});

describe('[#36469] absence is a typed 501, never a route miss', () => {
    it('no comments slot on the kernel: 501 NOT_IMPLEMENTED, naming the plugin that registers it', async () => {
        const { dispatcher } = makeDispatcher({});
        for (const [method, path, body] of DOORS) {
            const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path, body)));
            expect(envelope(result), `${method} ${path}`).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(result.response?.body?.error?.message).toContain('@objectstack/plugin-audit');
        }
    });

    it('a comments service with no handleCommentDoor member: 501 NOT_IMPLEMENTED, naming the member', async () => {
        const { dispatcher } = makeDispatcher({ comments: { somethingElse: vi.fn() } });
        const result = await dispatcher.dispatch('DELETE', '/comments/c_1', {}, {}, ctx(wire('DELETE', '/comments/c_1')));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain('does not implement handleCommentDoor');
    });

    it('the slot is read per request: one registered after a 501 is reached by the next request', async () => {
        const services: Record<string, unknown> = {};
        const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });

        const before = await dispatcher.dispatch('DELETE', '/comments/c_1', {}, {}, ctx(wire('DELETE', '/comments/c_1')));
        expect(envelope(before)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });

        const member = stubMember();
        services.comments = { handleCommentDoor: member.handleCommentDoor };
        const after = await dispatcher.dispatch('DELETE', '/comments/c_1', {}, {}, ctx(wire('DELETE', '/comments/c_1')));
        expect(after.response, JSON.stringify(after.response?.body)).toBeUndefined();
        expect((after.result as Response).status).toBe(200);
    });
});

describe('[#36469] faults are the server\'s, answered as such', () => {
    it('a member that throws: a sanitised 500, its message withheld from the client and logged', async () => {
        const boom = new Error('SQLITE_ERROR: no such table: sys_comment');
        const { dispatcher, logger } = makeDispatcher({ comments: { handleCommentDoor: vi.fn().mockRejectedValue(boom) } });

        const result = await dispatcher.dispatch('DELETE', '/comments/c_1', {}, {}, ctx(wire('DELETE', '/comments/c_1')));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(result.response?.body)).not.toContain('sys_comment');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0]![1]).toBe(boom);
    });

    it('a PUT whose body the transport already consumed: 500 and logged, and the member is never asked', async () => {
        const member = stubMember();
        const { dispatcher, logger } = makeDispatcher({ comments: { handleCommentDoor: member.handleCommentDoor } });
        const request = wire('PUT', '/comments/c_1/resolution', { resolved: true });
        await request.text();

        const result = await dispatcher.dispatch('PUT', '/comments/c_1/resolution', {}, {}, ctx(request));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(member.handleCommentDoor).not.toHaveBeenCalled();
        expect(String(logger.error.mock.calls[0]![0])).toContain('request body was consumed');
    });
});

describe('[#36469] no preamble-gate exemption — the credential is the session, so both gates apply', () => {
    const ENV = 'env-tenant-1';
    const USER = 'u-member';

    function makeTenantHost(opts: { member?: boolean; authGate?: { code: string; message: string } } = {}) {
        const comments = stubMember();
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
        const auth = {
            isAuthGateActive: () => opts.authGate !== undefined,
            getApi: async () => ({
                getSession: async () => ({
                    user: { id: USER, ...(opts.authGate ? { authGate: opts.authGate } : {}) },
                    session: { userId: USER, activeOrganizationId: 'org-tenant' },
                }),
            }),
        };
        const tenant = kernelWith({ objectql, auth, comments: { handleCommentDoor: comments.handleCommentDoor } });
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
        return { dispatcher, comments };
    }

    it('a signed-in caller who is not a member of the environment is refused 403 before the member runs', async () => {
        const { dispatcher, comments } = makeTenantHost();
        const result = await dispatcher.dispatch('DELETE', '/comments/c_1', {}, {}, ctx(wire('DELETE', '/comments/c_1')));
        expect(envelope(result)).toEqual({ status: 403, code: 'PROJECT_MEMBERSHIP_REQUIRED' });
        expect(comments.handleCommentDoor).not.toHaveBeenCalled();
    });

    it('⭐ control: a member of the environment reaches the member', async () => {
        const { dispatcher, comments } = makeTenantHost({ member: true });
        const result = await dispatcher.dispatch('DELETE', '/comments/c_1', {}, {}, ctx(wire('DELETE', '/comments/c_1')));
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(comments.handleCommentDoor).toHaveBeenCalledTimes(1);
    });

    it('a session that still owes an authentication step is stopped by the ADR-0069 gate: the paths are not allow-listed', async () => {
        const { dispatcher, comments } = makeTenantHost({
            member: true,
            authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
        });
        const result = await dispatcher.dispatch('PUT', '/comments/c_1/resolution', {}, {}, ctx(wire('PUT', '/comments/c_1/resolution', { resolved: true })));
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.details?.code ?? result.response?.body?.error?.code).toBe('PASSWORD_EXPIRED');
        expect(comments.handleCommentDoor).not.toHaveBeenCalled();
    });
});
