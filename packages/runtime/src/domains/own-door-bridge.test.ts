// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#36506] The `/personal-views` and `/attachments` dispatcher domains — the
 * personal-view delete door and the attachment removal and rename doors for a
 * kernel with no `http.server` (ruling A on #22438, applied to each member of
 * the class) — and [#36840] the `/print` domain, the print door, all through
 * `own-door-bridge.ts`.
 *
 * Driven through the REAL `HttpDispatcher.dispatch()` on a kernel that
 * registers no `http.server` (the hosted shape), with stub members that read
 * the request they are handed (method, path, body).
 *
 * What this pins, for each domain:
 *  1. each door shape reaches the member with the transport's own request,
 *     body unread, and the member's `Response` comes back as it is;
 *  2. the claim is the door shapes alone: every other method and path under
 *     the prefix keeps the dispatcher's ordinary miss, and the member never
 *     runs for one;
 *  3. an absent slot, or a service with no member, answers
 *     `501 NOT_IMPLEMENTED` — ⛔ never a route miss — and the slot is read per
 *     request;
 *  4. the slot is the REQUEST kernel's: a tenant kernel without the member is
 *     never served by the host kernel's member;
 *  5. a member that throws, or a body the transport already consumed, answers
 *     a sanitised `500` and is logged;
 *  6. the environment-scoped spelling reaches the member at the wire path;
 *  7. no preamble-gate exemption: a signed-in non-member of the environment and
 *     a session owing an authentication step are stopped before the member.
 *
 * The wire half — `createHonoApp` over a kernel with the REAL plugins and no
 * `http.server` — is
 * `packages/qa/http-conformance/src/hono-own-row-doors.conformance.test.ts`.
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

/** A member that records and echoes what it was handed. */
function stubMember() {
    const seen: Array<{ request: Request; method: string; path: string; body: string }> = [];
    const fn = vi.fn(async (request: Request): Promise<Response> => {
        const body = await request.text();
        const path = new URL(request.url).pathname;
        seen.push({ request, method: request.method, path, body });
        return new Response(JSON.stringify({ success: true, data: { method: request.method, path, body } }), {
            status: 200,
            headers: JSON_HEADERS,
        });
    });
    return { fn, seen };
}

/**
 * A kernel with no `http.server` — only the services named. An unknown name
 * answers `null`, except the names in `throwing`, which throw, as a real
 * kernel's lookup of an unregistered name does.
 */
function kernelWith(services: Record<string, unknown>, throwing: readonly string[] = []): any {
    const get = (n: string) => {
        if (services[n] == null && throwing.includes(n)) throw new Error(`Service '${n}' not found`);
        return services[n] ?? null;
    };
    return {
        getState: () => 'running',
        getService: get,
        getServiceAsync: async (n: string) => get(n),
        context: { getService: get },
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

interface Family {
    name: string;
    slot: string;
    member: string;
    producer: string;
    prefix: string;
    doors: Array<[method: string, path: string, body?: unknown]>;
    misses: Array<[method: string, path: string]>;
    lexicalSibling: string;
}

const FAMILIES: Family[] = [
    {
        name: 'personal-views',
        slot: 'personal-views',
        member: 'handlePersonalViewDoor',
        producer: '@objectstack/plugin-auth',
        prefix: '/personal-views',
        doors: [['DELETE', '/personal-views/pv_1']],
        misses: [
            ['GET', '/personal-views/pv_1'],
            ['POST', '/personal-views/pv_1'],
            ['PATCH', '/personal-views/pv_1'],
            ['PUT', '/personal-views/pv_1'],
            ['DELETE', '/personal-views'],
            ['DELETE', '/personal-views/'],
            ['DELETE', '/personal-views/pv_1/x'],
        ],
        lexicalSibling: '/personal-viewsx/pv_1',
    },
    {
        name: 'attachments',
        slot: 'file-attachments',
        member: 'handleAttachmentDoor',
        producer: '@objectstack/service-storage',
        prefix: '/attachments',
        doors: [
            ['DELETE', '/attachments/att_1'],
            ['PATCH', '/attachments/att_1', { file_name: 'renamed.pdf' }],
        ],
        misses: [
            ['GET', '/attachments/att_1'],
            ['POST', '/attachments/att_1'],
            ['PUT', '/attachments/att_1'],
            ['DELETE', '/attachments'],
            ['PATCH', '/attachments/'],
            ['DELETE', '/attachments/att_1/x'],
            ['PATCH', '/attachments/att_1/name'],
        ],
        lexicalSibling: '/attachmentsx/att_1',
    },
    {
        // [#36840] The print door: a hosted HotCRM's 「打印报价」 answered the
        // dispatcher's 404 here before this family existed.
        name: 'print',
        slot: 'print',
        member: 'handlePrintDoor',
        producer: '@objectstack/service-print',
        prefix: '/print',
        doors: [['POST', '/print/records', { app: 'sales', object: 'invoice', recordId: 'inv_1', page: 'invoice_document' }]],
        misses: [
            ['GET', '/print/records'],
            ['PUT', '/print/records'],
            ['PATCH', '/print/records'],
            ['DELETE', '/print/records'],
            ['POST', '/print'],
            ['POST', '/print/'],
            ['POST', '/print/records/x'],
            ['POST', '/print/pages'],
        ],
        lexicalSibling: '/printx/records',
    },
];

describe.each(FAMILIES)('[#36506] $prefix forwards its doors to the $slot member on a kernel with no http.server', (family) => {
    const withMember = (fn: unknown) => ({ [family.slot]: { [family.member]: fn } });

    it.each(family.doors)('%s %s reaches the member with the transport\'s own request, body unread, and its Response comes back as it is', async (method, path, body) => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher(withMember(member.fn));
        const request = wire(method, path, body);

        const result = await dispatcher.dispatch(method, path, { name: 'not-this-one' }, {}, ctx(request));

        expect(result.handled).toBe(true);
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(member.fn).toHaveBeenCalledTimes(1);
        expect(member.seen[0]!.request).toBe(request);
        const res = result.result as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({
            success: true,
            data: { method, path: `/api/v1${path}`, body: body === undefined ? '' : JSON.stringify(body) },
        });
    });

    it('claims exactly the door shapes: every other method and path keeps the ordinary miss, and the member never runs', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher(withMember(member.fn));
        for (const [method, path] of family.misses) {
            const result = await dispatcher.dispatch(method, path, undefined, {}, ctx(wire(method, path)));
            expect(envelope(result), `${method} ${path}`).toEqual({ status: 404, code: 'ROUTE_NOT_FOUND' });
        }
        // A lexical sibling is not under the segment claim at all.
        expect((dispatcher as any).domainRegistry.resolve(family.lexicalSibling, family.doors[0]![0])).toBeUndefined();
        expect(member.fn).not.toHaveBeenCalled();
    });

    it('the environment-scoped spelling reaches the member at the door\'s wire path, body unread', async () => {
        const member = stubMember();
        const { dispatcher } = makeDispatcher(withMember(member.fn));
        const [method, doorPath, body] = family.doors[family.doors.length - 1]!;
        const path = `/environments/env_1${doorPath}`;

        const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path, body)));

        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(member.seen).toHaveLength(1);
        expect(member.seen[0]!.path).toBe(`/api/v1${doorPath}`);
        expect(member.seen[0]!.body).toBe(body === undefined ? '' : JSON.stringify(body));
    });

    it(`no ${family.slot} service on the kernel: 501 NOT_IMPLEMENTED naming the package that registers it, never a route miss`, async () => {
        const { dispatcher } = makeDispatcher({});
        for (const [method, path, body] of family.doors) {
            const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path, body)));
            expect(envelope(result), `${method} ${path}`).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(result.response?.body?.error?.message).toContain(family.producer);
        }
    });

    it(`a kernel whose lookup of ${family.slot} throws reads as an empty slot: 501 NOT_IMPLEMENTED`, async () => {
        const dispatcher = new HttpDispatcher(kernelWith({}, [family.slot]), undefined, { enforceProjectMembership: false });
        const [method, path] = family.doors[0]!;
        const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
    });

    it(`a ${family.slot} service with no ${family.member}: 501 NOT_IMPLEMENTED naming the member`, async () => {
        const { dispatcher } = makeDispatcher({ [family.slot]: { somethingElse: vi.fn() } });
        const [method, path] = family.doors[0]!;
        const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain(`does not implement ${family.member}`);
    });

    it('the slot is read per request: one registered after a 501 is reached by the next request', async () => {
        const services: Record<string, unknown> = {};
        const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });
        const [method, path] = family.doors[0]!;

        const before = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
        expect(envelope(before)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });

        const member = stubMember();
        Object.assign(services, withMember(member.fn));
        const after = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
        expect(after.response, JSON.stringify(after.response?.body)).toBeUndefined();
        expect((after.result as Response).status).toBe(200);
    });

    it('the slot is the REQUEST kernel\'s: a tenant kernel without the member is never served by the host kernel\'s', async () => {
        const hostMember = stubMember();
        const tenant = kernelWith({});
        const resolver: KernelResolver = { resolveKernel: async () => tenant };
        const dispatcher = new HttpDispatcher(kernelWith(withMember(hostMember.fn)), undefined, {
            kernelResolver: resolver,
            enforceProjectMembership: false,
        });
        const [method, path] = family.doors[0]!;

        const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));

        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(hostMember.fn).not.toHaveBeenCalled();
    });

    it('a member that throws: a sanitised 500, its message withheld from the client and logged', async () => {
        const boom = new Error('SQLITE_ERROR: no such table: sys_secret_table');
        const { dispatcher, logger } = makeDispatcher(withMember(vi.fn().mockRejectedValue(boom)));
        const [method, path] = family.doors[0]!;

        const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(result.response?.body)).not.toContain('sys_secret_table');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0]![1]).toBe(boom);
    });

    it('a request whose body the transport already consumed: 500 and logged, and the member is never asked', async () => {
        const member = stubMember();
        const { dispatcher, logger } = makeDispatcher(withMember(member.fn));
        const [method, path] = family.doors[0]!;
        const request = wire(method, path, { any: 'body' });
        await request.text();

        const result = await dispatcher.dispatch(method, path, {}, {}, ctx(request));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(member.fn).not.toHaveBeenCalled();
        expect(String(logger.error.mock.calls[0]![0])).toContain('request body was consumed');
    });

    describe('no preamble-gate exemption — the credential is the session, so both gates apply', () => {
        const ENV = 'env-tenant-1';
        const USER = 'u-member';

        function makeTenantHost(opts: { member?: boolean; authGate?: { code: string; message: string } } = {}) {
            const door = stubMember();
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
            const tenant = kernelWith({ objectql, auth, ...withMember(door.fn) });
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
            return { dispatcher, door };
        }

        it('a signed-in caller who is not a member of the environment is refused 403 before the member runs', async () => {
            const { dispatcher, door } = makeTenantHost();
            const [method, path] = family.doors[0]!;
            const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
            expect(envelope(result)).toEqual({ status: 403, code: 'PROJECT_MEMBERSHIP_REQUIRED' });
            expect(door.fn).not.toHaveBeenCalled();
        });

        it('⭐ control: a member of the environment reaches the member', async () => {
            const { dispatcher, door } = makeTenantHost({ member: true });
            const [method, path] = family.doors[0]!;
            const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
            expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
            expect(door.fn).toHaveBeenCalledTimes(1);
        });

        it('a session that still owes an authentication step is stopped by the ADR-0069 gate: the paths are not allow-listed', async () => {
            const { dispatcher, door } = makeTenantHost({
                member: true,
                authGate: { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' },
            });
            const [method, path] = family.doors[0]!;
            const result = await dispatcher.dispatch(method, path, {}, {}, ctx(wire(method, path)));
            expect(result.response?.status).toBe(403);
            expect(result.response?.body?.error?.details?.code ?? result.response?.body?.error?.code).toBe('PASSWORD_EXPIRED');
            expect(door.fn).not.toHaveBeenCalled();
        });
    });
});
