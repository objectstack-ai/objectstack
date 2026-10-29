// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27506] A same-origin `type: 'api'` action is dispatched through the two
// action doors — the REST `POST /actions/:object/:action` route and the MCP
// `run_action` bridge — and forwarded IN-PROCESS to its declared `target`
// after the gates that door already runs. Ruling 6499781492 (option C).
//
// ## What this file pins, and why each half is load-bearing
//
// The defect was that the ADR-0126 §8 switch could not reach an api action:
// the console fetched `target` directly, so "Ban User switched off" still
// banned. So the FIRST pin is the refusal — a disabled api action answers
// 409 ACTION_DISABLED and the target is never called. The positive half is
// not optional either: an api action that the door refused for its TYPE (the
// pre-#27506 400) would also "never call the target" and still be the defect
// in a second spelling, so an enabled action must be forwarded and its answer
// relayed — method, path, the body the declaration assembles, the caller's
// credentials across, and the target's credential rotation back.
//
// What stays browser-only is pinned too: an off-origin target is refused by
// both doors and cannot be switched by the activation write door.
//
// The real HTTP surface (a booted showcase, better-auth's admin endpoints,
// the cookie lane) is pinned in `packages/qa/dogfood/test/api-action-door-
// forward.dogfood.test.ts`; this file drives the doors over fakes so each
// forwarded byte can be asserted.

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import {
    invokeBusinessAction,
    buildApiActionRequest,
    isHeadlessInvokableAction,
    headlessActionTypeError,
    offOriginApiActivationRefusal,
    API_FORWARD_MARK_HEADER,
} from '../action-execution.js';

const OBJECT = 'crm_lead';
const BAN_LEAD = {
    name: 'ban_lead', label: 'Ban Lead', objectName: OBJECT, type: 'api',
    target: '/api/v1/auth/admin/ban-user', recordIdParam: 'userId',
    params: [{ name: 'banReason', label: 'Reason', type: 'text', required: false }],
    ai: { exposed: true, description: 'Ban the lead.' },
};
const REMOTE_PING = {
    name: 'ping_remote', label: 'Ping Remote', objectName: OBJECT, type: 'api',
    target: 'https://example.invalid/ping', ai: { exposed: true, description: 'Ping a remote host.' },
};
const DELETE_LEAD = {
    name: 'purge_lead_remote', label: 'Purge', objectName: OBJECT, type: 'api', method: 'DELETE',
    target: '/api/v1/data/crm_lead/${ctx.recordId}',
};

type Injected = { url: string; init: RequestInit };

function boot(opts: {
    disabled?: string[];
    /** What the target answers: status, JSON body, extra response headers. */
    answer?: { status?: number; body?: unknown; headers?: Array<[string, string]> };
    noServer?: boolean;
} = {}) {
    const disabled = new Set(opts.disabled ?? []);
    const injected: Injected[] = [];
    const answer = opts.answer ?? {};
    const request = vi.fn(async (url: string, init: RequestInit) => {
        injected.push({ url, init });
        return new Response(JSON.stringify(answer.body ?? { success: true, data: { ok: true } }), {
            status: answer.status ?? 200,
            headers: [['content-type', 'application/json'], ...(answer.headers ?? [])],
        });
    });
    const server = { getRawApp: () => ({ request }) };
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const objectDef = { name: OBJECT, actions: [BAN_LEAD, REMOTE_PING, DELETE_LEAD] };
    const ql: any = {
        executeAction,
        getSchema: (name: string) => (name === OBJECT ? objectDef : undefined),
        registry: { getObject: (name: string) => (name === OBJECT ? objectDef : undefined), getItem: () => undefined },
        // The subject rows the doors load under the caller's scope.
        find: vi.fn(async (_object: string, q: any) => {
            const id = q?.where?.id;
            return id === 'u_target' || id === 'lead 7' ? [{ id, email: 'target@example.test' }] : [];
        }),
        insert: vi.fn(), update: vi.fn(), delete: vi.fn(),
        isActionEnabled: (name: string) => !disabled.has(name),
        describeDisabledAction: (name: string) =>
            `Action '${name}' is disabled — switched off in the packaged-metadata activation ledger ` +
            `(sys_metadata_activation, ADR-0126 §8).`,
    };
    const metadata: any = {
        load: vi.fn(async () => null),
        loadDiagnosed: vi.fn(async () => ({ data: null, degraded: false, errors: [] })),
        loadMany: vi.fn(async () => []),
        listObjects: vi.fn(async () => [objectDef]),
        getObject: vi.fn(async () => objectDef),
    };
    const resolve = (n: string) =>
        n === 'objectql' || n === 'data' ? ql
        : n === 'metadata' ? metadata
        : (n === 'http.server' || n === 'http-server') && !opts.noServer ? server
        : null;
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (n: string) => resolve(n),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel), ql, metadata, executeAction, request, injected };
}

/** The caller: a signed-in member whose request carries a bearer AND a cookie. */
const CTX = (headers: Record<string, string> = {}): HttpProtocolContext => ({
    request: {
        headers: {
            host: 'app.example.test',
            'x-forwarded-proto': 'https',
            authorization: 'Bearer tok_member',
            cookie: 'better-auth.session_token=abc',
            'content-type': 'application/json',
            'content-length': '42',
            ...headers,
        },
    },
    environmentId: 'platform',
    executionContext: { userId: 'u_member', tenantId: 'org_1', systemPermissions: [] },
} as unknown as HttpProtocolContext);

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code ?? r?.response?.body?.error?.details?.code;
const messageOf = (r: any): string => String(r?.response?.body?.error?.message ?? '');
const headersOf = (init: RequestInit): Record<string, string> => init.headers as Record<string, string>;

describe('the predicates — a same-origin api action IS server-dispatched, an off-origin one is not', () => {
    it('isHeadlessInvokableAction admits a same-origin api target and refuses an off-origin / missing one', () => {
        const deps: any = {};
        expect(isHeadlessInvokableAction(deps, BAN_LEAD, false)).toBe(true);
        expect(isHeadlessInvokableAction(deps, REMOTE_PING, true)).toBe(false);
        expect(isHeadlessInvokableAction(deps, { ...BAN_LEAD, target: '//evil.example/x' }, true)).toBe(false);
        expect(isHeadlessInvokableAction(deps, { ...BAN_LEAD, target: undefined }, true)).toBe(false);
    });

    it('headlessActionTypeError is silent for a same-origin api action and names the off-origin case', () => {
        const deps: any = {};
        expect(headlessActionTypeError(deps, BAN_LEAD, OBJECT)).toBeNull();
        const msg = headlessActionTypeError(deps, REMOTE_PING, OBJECT);
        expect(msg).toContain('off-origin');
        expect(msg).toContain(REMOTE_PING.target);
    });

    it('offOriginApiActivationRefusal explains why the ledger cannot switch an off-origin api action', () => {
        expect(offOriginApiActivationRefusal(BAN_LEAD, OBJECT)).toBeNull();
        expect(offOriginApiActivationRefusal({ name: 'x', type: 'script' }, OBJECT)).toBeNull();
        const msg = offOriginApiActivationRefusal(REMOTE_PING, OBJECT);
        expect(msg).toContain('sys_metadata_activation');
        expect(msg).toContain('never sees the request');
    });
});

describe('door 1 — REST `POST /actions/:object/:action` forwards a same-origin api action', () => {
    it('a DISABLED api action answers 409 ACTION_DISABLED and the target is never called (the #27506 defect)', async () => {
        const { dispatcher, request } = boot({ disabled: [BAN_LEAD.name] });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(409);
        expect(codeOf(res)).toBe('ACTION_DISABLED');
        expect(request).not.toHaveBeenCalled();
    });

    it('an ENABLED api action is forwarded: method, caller-origin URL, assembled body, credentials across', async () => {
        const { dispatcher, injected } = boot({
            answer: { body: { success: true, data: { userId: 'u_target', banned: true } } },
        });

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target', params: { banReason: 'spam' } }, CTX(),
        );

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(injected).toHaveLength(1);
        const [{ url, init }] = injected;
        // The caller's origin, so a target that reads `request.url` sees the deployment, not localhost.
        expect(url).toBe('https://app.example.test/api/v1/auth/admin/ban-user');
        expect(init.method).toBe('POST');
        const headers = headersOf(init);
        expect(headers.authorization).toBe('Bearer tok_member');
        expect(headers.cookie).toBe('better-auth.session_token=abc');
        expect(headers[API_FORWARD_MARK_HEADER]).toBe(`${OBJECT}/${BAN_LEAD.name}`);
        // The injector owns the framing headers; a stale `content-length` must not cross.
        expect(headers['content-length']).toBeUndefined();
        // The body the DECLARATION assembles: params, `recordIdParam` from the
        // subject row's `id`, and `organizationId` for an `/api/v1/auth/` target.
        expect(JSON.parse(String(init.body))).toEqual({ banReason: 'spam', userId: 'u_target', organizationId: 'org_1' });
        // The target's `data`, unwrapped — what the console's direct fetch handed `result.data`.
        expect(res?.response?.body?.data).toEqual({ userId: 'u_target', banned: true });
    });

    it('relays the target\'s credential rotation — every Set-Cookie line, and the bearer-lane headers', async () => {
        const { dispatcher } = boot({
            answer: {
                body: { session: { userId: 'u_target' } },
                headers: [
                    ['set-cookie', 'better-auth.session_token=new; Path=/; HttpOnly'],
                    ['set-cookie', 'better-auth.admin_session=adm; Path=/; HttpOnly'],
                    ['set-auth-token', 'tok_impersonated'],
                    ['set-admin-session-token', 'tok_admin_recovery'],
                    ['x-unrelated', 'not relayed'],
                ],
            },
        });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(200);
        const relayed = res?.response?.headers ?? {};
        // An ARRAY — one header line per cookie. A comma-joined string would be
        // parsed by the browser as one cookie, which is the shape this pins out.
        expect(relayed['set-cookie']).toEqual([
            'better-auth.session_token=new; Path=/; HttpOnly',
            'better-auth.admin_session=adm; Path=/; HttpOnly',
        ]);
        expect(relayed['set-auth-token']).toBe('tok_impersonated');
        expect(relayed['set-admin-session-token']).toBe('tok_admin_recovery');
        expect(relayed['x-unrelated']).toBeUndefined();
        // A stock better-auth body is not enveloped: it comes back as-is.
        expect(res?.response?.body?.data).toEqual({ session: { userId: 'u_target' } });
    });

    it('relays the target\'s OWN refusal — its status and its code, never a 200', async () => {
        const { dispatcher } = boot({
            answer: { status: 403, body: { success: false, error: { code: 'FORBIDDEN', message: 'Platform admin only' } } },
        });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('FORBIDDEN');
        expect(messageOf(res)).toBe('Platform admin only');
    });

    it('an OFF-ORIGIN api action is refused 400 before any forward — the browser-only case', async () => {
        const { dispatcher, request } = boot();

        const res = await dispatcher.handleActions(`/${OBJECT}/${REMOTE_PING.name}`, 'POST', {}, CTX());

        expect(statusOf(res)).toBe(400);
        expect(messageOf(res)).toContain('off-origin');
        expect(request).not.toHaveBeenCalled();
    });

    it('a forwarded request that lands back on an action door is refused, not looped', async () => {
        const { dispatcher, request } = boot();

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' },
            CTX({ [API_FORWARD_MARK_HEADER]: 'crm_lead/other_action' }),
        );

        expect(statusOf(res)).toBe(400);
        expect(messageOf(res)).toContain('would loop');
        expect(request).not.toHaveBeenCalled();
    });

    it('a kernel with no in-process request path answers 503, never a silent pass', async () => {
        const { dispatcher } = boot({ noServer: true });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(503);
        expect(messageOf(res)).toContain('getRawApp');
    });

    it('a `DELETE` api action with a `${ctx.recordId}` target carries no body and the interpolated path', async () => {
        const { dispatcher, injected } = boot();

        const res = await dispatcher.handleActions(`/${OBJECT}/${DELETE_LEAD.name}`, 'POST', { recordId: 'lead 7' }, CTX());

        expect(statusOf(res)).toBe(200);
        expect(injected[0].url).toBe('https://app.example.test/api/v1/data/crm_lead/lead%207');
        expect(injected[0].init.method).toBe('DELETE');
        expect(injected[0].init.body).toBeUndefined();
    });
});

describe('door 2 — the MCP `run_action` bridge forwards a same-origin api action', () => {
    const runViaMcp = async (h: ReturnType<typeof boot>, name: string, input: any = {}) => {
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                service === 'metadata' ? h.metadata
                : service === 'automation' ? null
                : service === 'http.server' ? (h.request ? { getRawApp: () => ({ request: h.request }) } : null)
                : h.ql,
            getObjectQL: async () => h.ql,
        };
        return invokeBusinessAction(deps, CTX() as any, name, input, {
            driver: h.ql,
            ec: { userId: 'u_agent', tenantId: 'org_1', systemPermissions: [] },
            getMeta: () => h.metadata,
            callData: async (_a: string, p: any) => ({ object: p?.object, id: p?.id, record: { id: p?.id } }),
        });
    };

    it('a DISABLED api action is refused with the ADR-0112 envelope and the target is never called', async () => {
        const h = boot({ disabled: [BAN_LEAD.name] });

        const thrown = await runViaMcp(h, BAN_LEAD.name, { recordId: 'u_target' }).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as any).code).toBe('ACTION_DISABLED');
        expect((thrown as any).status).toBe(409);
        expect(h.request).not.toHaveBeenCalled();
    });

    it('an ENABLED api action is forwarded and its answer returned as the tool result', async () => {
        const h = boot({ answer: { body: { success: true, data: { banned: true } }, headers: [['set-auth-token', 'rotated']] } });

        const result: any = await runViaMcp(h, BAN_LEAD.name, { recordId: 'u_target', params: { banReason: 'spam' } });

        expect(result.ok).toBe(true);
        expect(result.action).toBe(BAN_LEAD.name);
        expect(result.result).toEqual({ banned: true });
        expect(result.headers).toEqual({ 'set-auth-token': 'rotated' });
        expect(h.injected[0].url).toBe('https://app.example.test/api/v1/auth/admin/ban-user');
        expect(JSON.parse(String(h.injected[0].init.body))).toEqual({ banReason: 'spam', userId: 'u_target', organizationId: 'org_1' });
        expect(h.executeAction).not.toHaveBeenCalled();
    });

    it('the target\'s refusal rides the throw with its own status and code', async () => {
        const h = boot({ answer: { status: 403, body: { success: false, error: { code: 'FORBIDDEN', message: 'nope' } } } });

        const thrown = await runViaMcp(h, BAN_LEAD.name, { recordId: 'u_target' }).catch((e) => e);

        expect((thrown as any).status).toBe(403);
        expect((thrown as any).code).toBe('FORBIDDEN');
        expect(String(thrown.message)).toBe('nope');
    });

    it('an OFF-ORIGIN api action cannot be invoked via MCP', async () => {
        const h = boot();

        const thrown = await runViaMcp(h, REMOTE_PING.name).catch((e) => e);

        expect(String(thrown.message)).toContain('cannot be invoked via MCP');
        expect(h.request).not.toHaveBeenCalled();
    });
});

describe('buildApiActionRequest — the declaration\'s request, by the console\'s own rules', () => {
    const ec = { userId: 'u1', tenantId: 'org_9' };

    it('wraps params under `bodyShape.wrap`, keeps `recordIdParam` flat, merges `bodyExtra` last', () => {
        const action = {
            name: 'rename_org', type: 'api', target: '/api/v1/auth/organization/update',
            bodyShape: { wrap: 'data' }, recordIdParam: 'organizationId', bodyExtra: { source: 'console' },
        };
        const req = buildApiActionRequest(action, { recordId: 'org_9', record: { id: 'org_9' }, params: { name: 'Acme' }, ec });
        expect(req).toEqual({
            method: 'POST', path: '/api/v1/auth/organization/update',
            body: { data: { name: 'Acme' }, organizationId: 'org_9', source: 'console' },
        });
    });

    it('seeds `recordIdParam` from the subject row\'s `recordIdField`, and REFUSES a row that cannot supply it (#8018)', () => {
        const action = { name: 'revoke_session', type: 'api', target: '/api/v1/auth/revoke-session', recordIdParam: 'token', recordIdField: 'token' };
        const ok = buildApiActionRequest(action, { recordId: 's1', record: { id: 's1', token: 'tk' }, params: {}, ec });
        expect((ok as any).body).toEqual({ token: 'tk', organizationId: 'org_9' });
        const refused = buildApiActionRequest(action, { recordId: 's1', record: { id: 's1' }, params: {}, ec });
        expect((refused as any).status).toBe(400);
        expect((refused as any).message).toContain('"token"');
    });

    it('interpolates `${param.X}` / `${ctx.X}` and `{field}` in the target, percent-encoded', () => {
        const action = { name: 'go', type: 'api', target: '/api/v1/things/${ctx.recordId}/by/${param.who}/{slug}' };
        const req = buildApiActionRequest(action, { recordId: 'r 1', record: { id: 'r 1', slug: 'a/b' }, params: { who: 'x&y' }, ec });
        expect((req as any).path).toBe('/api/v1/things/r%201/by/x%26y/a%2Fb');
    });

    it('refuses a target token only the browser can resolve, and a `{{page.<var>}}` body token', () => {
        const sel = buildApiActionRequest({ name: 'bulk', type: 'api', target: '/api/v1/x?ids=${ctx.selection.ids}' }, { params: {}, ec });
        expect((sel as any).status).toBe(400);
        expect((sel as any).message).toContain('cannot resolve');
        const page = buildApiActionRequest(
            { name: 'submit', type: 'api', target: '/api/v1/forms/x', bodyExtra: { name: '{{page.inquiryName}}' } }, { params: {}, ec },
        );
        expect((page as any).status).toBe(400);
        expect((page as any).message).toContain('{{page.<var>}}');
    });

    it('does not inject `organizationId` outside `/api/v1/auth/`, and respects an explicit one inside it', () => {
        const plain = buildApiActionRequest({ name: 'p', type: 'api', target: '/api/v1/apps/x/recalc' }, { params: { a: 1 }, ec });
        expect((plain as any).body).toEqual({ a: 1 });
        const explicit = buildApiActionRequest({ name: 'q', type: 'api', target: '/api/v1/auth/organization/update' }, { params: { organizationId: 'org_other' }, ec });
        expect((explicit as any).body).toEqual({ organizationId: 'org_other' });
    });
});
