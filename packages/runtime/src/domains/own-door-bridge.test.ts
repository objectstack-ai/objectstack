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
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { PERSONAL_VIEWS_BRIDGE } from './personal-views.js';
import { ATTACHMENTS_BRIDGE } from './attachments.js';
import { PRINT_BRIDGE } from './print.js';
import type { OwnDoorBridge } from './own-door-bridge.js';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// [#37273] The bridge's two `501` sentences are the operation-message
// catalog's, in the request's top `Accept-Language` tag, for a bridge that
// names its noun's key (the print door). Code and status are unchanged, no
// `userMessage` is added.
describe('[#37273] the print door\'s 501 follows the request\'s language', () => {
    const [method, path, body] = ['POST', '/print/records', { app: 'sales', object: 'invoice', recordId: 'inv_1', page: 'invoice_document' }] as const;
    const withHeaders = (headers: Record<string, string>) => {
        const request = new Request(`${ORIGIN}/api/v1${path}`, { method, headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(body) });
        return ctx(request);
    };
    const SITES = [
        {
            name: 'no print service on the kernel',
            services: {},
            zh: '打印接口不可用：此内核上未注册 print 服务。该服务由 @objectstack/service-print (PrintServicePlugin) 注册。',
            en: 'The print door is not available: no print service is registered on this kernel. @objectstack/service-print (PrintServicePlugin) registers it.',
        },
        {
            name: 'a print service without handlePrintDoor',
            services: { print: { somethingElse: vi.fn() } },
            zh: '打印接口不可用：已注册的 print 服务未实现 handlePrintDoor。',
            en: 'The print door is not available: the registered print service does not implement handlePrintDoor.',
        },
    ];

    it.each(SITES)('$name: under accept-language zh-CN, 501 NOT_IMPLEMENTED in Chinese', async (site) => {
        const { dispatcher } = makeDispatcher(site.services);
        const result = await dispatcher.dispatch(method, path, {}, {}, withHeaders({ 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toBe(site.zh);
        expect(result.response?.body?.error?.userMessage).toBeUndefined();
    });

    it.each(SITES)('$name: the control — an English or absent accept-language keeps today\'s English, byte for byte', async (site) => {
        for (const headers of [{ 'accept-language': 'en-US,en;q=0.9' }, {}] as Array<Record<string, string>>) {
            const { dispatcher } = makeDispatcher(site.services);
            const result = await dispatcher.dispatch(method, path, {}, {}, withHeaders(headers));
            expect(envelope(result), JSON.stringify(headers)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
            expect(result.response?.body?.error?.message, JSON.stringify(headers)).toBe(site.en);
        }
    });

    // [#37610] The English-only arm is gone: `nounKey` is required, so no
    // bridge can ship a `501` that stays English under another language.
});

// [#37352] The personal-view and attachment doors sit on the same bridge as the
// print door and now name their noun keys, so one failure mode answers in one
// language whichever of the three doors was hit. The English stays byte for
// byte, the code and status are unchanged, and no `userMessage` is added.
describe('[#37352] the personal-view and attachment doors\' 501s follow the request\'s language', () => {
    const PV = { slot: 'personal-views', member: 'handlePersonalViewDoor', producer: '@objectstack/plugin-auth (AuthPlugin)' };
    const AT = { slot: 'file-attachments', member: 'handleAttachmentDoor', producer: '@objectstack/service-storage (StorageServicePlugin)' };
    const DOORS = [
        {
            name: 'personal-view delete',
            ...PV,
            requests: [['DELETE', '/personal-views/pv_1']] as Array<[string, string, unknown?]>,
            unregistered: {
                en: 'The personal view delete door is not available: no personal-views service is registered on this kernel. @objectstack/plugin-auth (AuthPlugin) registers it.',
                'zh-CN': '个人视图删除接口不可用：此内核上未注册 personal-views 服务。该服务由 @objectstack/plugin-auth (AuthPlugin) 注册。',
                'ja-JP': '個人ビュー削除エンドポイントは利用できません。このカーネルには personal-views サービスが登録されていません。このサービスは @objectstack/plugin-auth (AuthPlugin) が登録します。',
                'es-ES': 'El punto de acceso para eliminar vistas personales no está disponible: no hay ningún servicio personal-views registrado en este kernel. Lo registra @objectstack/plugin-auth (AuthPlugin).',
            },
            memberMissing: {
                en: 'The personal view delete door is not available: the registered personal-views service does not implement handlePersonalViewDoor.',
                'zh-CN': '个人视图删除接口不可用：已注册的 personal-views 服务未实现 handlePersonalViewDoor。',
                'ja-JP': '個人ビュー削除エンドポイントは利用できません。登録されている personal-views サービスは handlePersonalViewDoor を実装していません。',
                'es-ES': 'El punto de acceso para eliminar vistas personales no está disponible: el servicio personal-views registrado no implementa handlePersonalViewDoor.',
            },
        },
        {
            name: 'attachment removal and rename',
            ...AT,
            requests: [['DELETE', '/attachments/att_1'], ['PATCH', '/attachments/att_1', { file_name: 'renamed.pdf' }]] as Array<[string, string, unknown?]>,
            unregistered: {
                en: 'The attachment removal and rename doors are not available: no file-attachments service is registered on this kernel. @objectstack/service-storage (StorageServicePlugin) registers it.',
                'zh-CN': '附件删除和重命名接口不可用：此内核上未注册 file-attachments 服务。该服务由 @objectstack/service-storage (StorageServicePlugin) 注册。',
                'ja-JP': '添付ファイルの削除・名前変更エンドポイントは利用できません。このカーネルには file-attachments サービスが登録されていません。このサービスは @objectstack/service-storage (StorageServicePlugin) が登録します。',
                'es-ES': 'Los puntos de acceso para eliminar y renombrar adjuntos no están disponibles: no hay ningún servicio file-attachments registrado en este kernel. Lo registra @objectstack/service-storage (StorageServicePlugin).',
            },
            memberMissing: {
                en: 'The attachment removal and rename doors are not available: the registered file-attachments service does not implement handleAttachmentDoor.',
                'zh-CN': '附件删除和重命名接口不可用：已注册的 file-attachments 服务未实现 handleAttachmentDoor。',
                'ja-JP': '添付ファイルの削除・名前変更エンドポイントは利用できません。登録されている file-attachments サービスは handleAttachmentDoor を実装していません。',
                'es-ES': 'Los puntos de acceso para eliminar y renombrar adjuntos no están disponibles: el servicio file-attachments registrado no implementa handleAttachmentDoor.',
            },
        },
    ];
    const HEADERS: Record<'en' | 'zh-CN' | 'ja-JP' | 'es-ES', Array<Record<string, string>>> = {
        en: [{ 'accept-language': 'en-US,en;q=0.9' }, {}],
        'zh-CN': [{ 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }],
        'ja-JP': [{ 'accept-language': 'ja-JP,ja;q=0.9' }],
        'es-ES': [{ 'accept-language': 'es-ES,es;q=0.9' }],
    };

    async function answer(services: Record<string, unknown>, [method, path, body]: [string, string, unknown?], headers: Record<string, string>) {
        const { dispatcher } = makeDispatcher(services);
        const request = new Request(`${ORIGIN}/api/v1${path}`, {
            method,
            headers: { ...JSON_HEADERS, ...headers },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return dispatcher.dispatch(method, path, body ?? {}, {}, ctx(request));
    }

    for (const door of DOORS) {
        for (const site of [
            { name: `no ${door.slot} service on the kernel`, services: {} as Record<string, unknown>, sentences: door.unregistered },
            { name: `a ${door.slot} service without ${door.member}`, services: { [door.slot]: { somethingElse: vi.fn() } }, sentences: door.memberMissing },
        ]) {
            it(`${door.name} — ${site.name}: 501 NOT_IMPLEMENTED in en (and with no header), zh-CN, ja-JP and es-ES`, async () => {
                for (const request of door.requests) {
                    for (const [locale, list] of Object.entries(HEADERS) as Array<[keyof typeof HEADERS, Array<Record<string, string>>]>) {
                        for (const headers of list) {
                            const label = `${request[0]} ${request[1]} ${JSON.stringify(headers)}`;
                            const result = await answer(site.services, request, headers);
                            expect(envelope(result), label).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
                            expect(result.response?.body?.error?.message, label).toBe(site.sentences[locale]);
                            expect(result.response?.body?.error?.userMessage, label).toBeUndefined();
                        }
                    }
                }
            });
        }
    }

    it('the English the catalog keys carry is each bridge\'s noun, byte for byte', () => {
        expect(BUILTIN_OPERATION_MESSAGES.en[PERSONAL_VIEWS_BRIDGE.nounKey]).toBe(PERSONAL_VIEWS_BRIDGE.noun);
        expect(BUILTIN_OPERATION_MESSAGES.en[ATTACHMENTS_BRIDGE.nounKey]).toBe(ATTACHMENTS_BRIDGE.noun);
        expect(BUILTIN_OPERATION_MESSAGES.en[PRINT_BRIDGE.nounKey]).toBe(PRINT_BRIDGE.noun);
    });
});

/**
 * [#37662] Every bridge's flags against the catalog, found rather than listed:
 * each module of this directory that builds a bridge domain
 * (`createOwnDoorBridgeDomain(`) is imported and its exported bridges walked,
 * so a fourth bridge is held to the same rules the day it lands.
 */
describe('[#37662] every own-door bridge is tied to the catalog', () => {
    const isBridge = (value: unknown): value is OwnDoorBridge =>
        !!value && typeof value === 'object'
        && typeof (value as OwnDoorBridge).nounKey === 'string'
        && typeof (value as OwnDoorBridge).slot === 'string'
        && Array.isArray((value as OwnDoorBridge).doors);
    const here = dirname(fileURLToPath(import.meta.url));
    const builders = readdirSync(here)
        .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && name !== 'own-door-bridge.ts')
        .filter((name) => readFileSync(join(here, name), 'utf8').includes('createOwnDoorBridgeDomain('));

    it('finds the shipped bridges, each module exporting the bridge it builds', async () => {
        const found: Array<[string, OwnDoorBridge]> = [];
        for (const name of builders) {
            const mod = await import(/* @vite-ignore */ `./${name.replace(/\.ts$/, '.js')}`) as Record<string, unknown>;
            const bridges = Object.entries(mod).filter(([, value]) => isBridge(value)) as Array<[string, OwnDoorBridge]>;
            expect(bridges.length, `${name} builds a bridge domain but exports no bridge`).toBeGreaterThan(0);
            found.push(...bridges);
        }
        expect(found.map(([exported]) => exported).sort())
            .toEqual(expect.arrayContaining(['ATTACHMENTS_BRIDGE', 'PERSONAL_VIEWS_BRIDGE', 'PRINT_BRIDGE']));

        const locales = Object.keys(BUILTIN_OPERATION_MESSAGES);
        for (const [exported, bridge] of found) {
            // The noun key is in every locale, and its English is the noun.
            for (const locale of locales) {
                expect(BUILTIN_OPERATION_MESSAGES[locale][bridge.nounKey], `${exported} ${locale}`).toBeTruthy();
            }
            expect(BUILTIN_OPERATION_MESSAGES.en[bridge.nounKey], exported).toBe(bridge.noun);
            // `nounPlural` is set exactly when the English noun is plural (`the … doors`).
            expect(bridge.nounPlural === true, `${exported}: '${bridge.noun}'`).toBe(/\bdoors\b/.test(bridge.noun));
            // The pair of sentences the bridge reads is in every locale.
            const suffix = bridge.nounPlural ? '_plural' : '';
            for (const key of ['own_door_service_unregistered', 'own_door_member_missing']) {
                for (const locale of locales) {
                    expect(BUILTIN_OPERATION_MESSAGES[locale][key + suffix], `${exported} ${locale} ${key}${suffix}`).toBeTruthy();
                }
            }
        }
    });
});
