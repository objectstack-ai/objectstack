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
    apiActionRequestReadsSubjectRow,
    apiForwardSubjectRecord,
    forwardsOnDeniedSubjectLoad,
    apiActionResultOf,
    buildApiActionRequest,
    isHeadlessInvokableAction,
    headlessActionTypeError,
    offOriginApiActivationRefusal,
    apiActionIdentityRouteKeyRefusal,
    apiActionOAuthForwardRefusal,
    apiForwardCredentialRefusal,
    API_FORWARD_MARK_HEADER,
    apiForwardAgentOf,
} from '../action-execution.js';
import { FORWARD_CREDENTIAL_HEADER, redeemForwardCredential } from '@objectstack/rest';
import { standardErrorCodeForHttpStatus } from '@objectstack/spec/api';
import { ActionActivationProjection } from '@objectstack/objectql';

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
/** [#27738] The showcase's recalc shape: a flow endpoint that answers `400 FLOW_FAILED` when its run is refused. */
const RECALC_LEAD = {
    name: 'recalc_lead', label: 'Recalculate', objectName: OBJECT, type: 'api',
    target: '/api/v1/apps/showcase/recalc', recordIdParam: 'recordId',
    ai: { exposed: true, description: 'Recalculate the lead.' },
};
/**
 * [#27738] `plugin-approvals`' `approval_approve` shape: declared params, and the
 * per-request decision outputs the console sends as `outputs.<key>` params.
 */
const APPROVE_LEAD = {
    name: 'approve_lead', label: 'Approve', objectName: OBJECT, type: 'api', method: 'POST',
    target: '/api/v1/approvals/requests/{id}/approve',
    params: [
        { name: 'comment', label: 'Comment', type: 'textarea', required: false },
        { name: 'attachments', label: 'Attachments', type: 'file', multiple: true, required: false },
    ],
    ai: { exposed: true, description: 'Approve the lead.' },
};

/**
 * [#28657] An api action whose request needs a field OF the subject row: a
 * `{field}` path token other than `{id}`.
 */
const NOTE_OWNER = {
    name: 'note_owner', label: 'Note Owner', objectName: OBJECT, type: 'api', method: 'POST',
    target: '/api/v1/data/crm_note/{email}', ai: { exposed: true, description: 'Note the owner.' },
};
/** [#28657] The other one: a `recordIdParam` seeded from a `recordIdField` other than `id`. */
const FLAG_BY_EMAIL = {
    name: 'flag_by_email', label: 'Flag', objectName: OBJECT, type: 'api', method: 'POST',
    target: '/api/v1/data/crm_flag', recordIdParam: 'email', recordIdField: 'email',
    ai: { exposed: true, description: 'Flag the lead by email.' },
};

type Injected = { url: string; init: RequestInit };

function boot(opts: {
    disabled?: string[];
    /** What the target answers: status, JSON body, extra response headers. */
    answer?: { status?: number; body?: unknown; text?: string; headers?: Array<[string, string]> };
    noServer?: boolean;
} = {}) {
    const disabled = new Set(opts.disabled ?? []);
    const injected: Injected[] = [];
    const answer = opts.answer ?? {};
    const request = vi.fn(async (url: string, init: RequestInit) => {
        injected.push({ url, init });
        // `text` is a raw (non-JSON) body with the caller's own content-type;
        // otherwise the JSON `body` under `application/json`.
        const raw = typeof answer.text === 'string';
        return new Response(raw ? answer.text : JSON.stringify(answer.body ?? { success: true, data: { ok: true } }), {
            status: answer.status ?? 200,
            headers: [...(raw ? [] : [['content-type', 'application/json'] as [string, string]]), ...(answer.headers ?? [])],
        });
    });
    const server = { getRawApp: () => ({ request }) };
    const executeAction = vi.fn(async () => ({ ran: 'script' }));
    const objectDef = { name: OBJECT, actions: [BAN_LEAD, REMOTE_PING, DELETE_LEAD, RECALC_LEAD, APPROVE_LEAD, NOTE_OWNER, FLAG_BY_EMAIL] };
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
        // [#27842] The engine's own sentence, never a transcribed copy of it.
        describeDisabledAction: (name: string) => new ActionActivationProjection().describeDisabled(name),
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
        // `http://<Host>` — the URL the direct request has at this process. The
        // caller's `x-forwarded-proto: https` is NOT consulted (see the next case).
        expect(url).toBe('http://app.example.test/api/v1/auth/admin/ban-user');
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

    it('builds the forwarded URL from `Host` alone — a caller-sent `X-Forwarded-Host` / `-Proto` cannot choose it (they cross as headers only)', async () => {
        // `server.trustProxy` is the platform's one rule for believing forwarded
        // headers (`security/inbound-rate-limit.ts`), and this seam cannot see
        // it; so the URL never follows them. The headers still reach the target
        // as the caller sent them, where its own trust rule judges them.
        const { dispatcher, injected } = boot();

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' },
            CTX({ 'x-forwarded-host': 'attacker.example', 'x-forwarded-proto': 'https' }),
        );

        expect(statusOf(res)).toBe(200);
        expect(injected[0].url).toBe('http://app.example.test/api/v1/auth/admin/ban-user');
        const headers = headersOf(injected[0].init);
        expect(headers['x-forwarded-host']).toBe('attacker.example');
        expect(headers['x-forwarded-proto']).toBe('https');
    });

    it('refuses (502) a target that answered 2xx with a non-JSON body instead of relaying it as a result', async () => {
        // The console's direct fetch read such an answer as `{}` — a silent
        // loss. The door names the content-type so the declaration can be fixed.
        const { dispatcher, injected } = boot({
            answer: { status: 200, text: 'id,name\n1,ada\n', headers: [['content-type', 'text/csv; charset=utf-8']] },
        });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(injected).toHaveLength(1);
        expect(statusOf(res)).toBe(502);
        expect(messageOf(res)).toContain('text/csv');
        expect(messageOf(res)).toContain('not JSON');
        expect(res?.response?.body?.data).toBeUndefined();
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

    // [#27918] Today's reading, pinned: the STATUS is the target's verdict, so a
    // 2xx is relayed as a result even when its body says `success: false`. No
    // same-origin target in the repository answers that shape (the measured
    // census is on `apiActionResultOf`'s docblock); one that starts to is fixed
    // at the target, so a change here is a decision, not a cleanup.
    it('relays a 2xx `{ success: false, … }` answer as a 200 result, never as a refusal', async () => {
        const enveloped = boot({ answer: { status: 200, body: { success: false, data: { reason: 'already_banned' } } } });
        const viaData = await enveloped.dispatcher.handleActions(
            `/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX(),
        );
        expect(statusOf(viaData)).toBe(200);
        expect(viaData?.response?.body?.success).toBe(true);
        expect(viaData?.response?.body?.data).toEqual({ reason: 'already_banned' });

        const bare = boot({ answer: { status: 200, body: { success: false, message: 'not applied' } } });
        const viaMessage = await bare.dispatcher.handleActions(
            `/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX(),
        );
        expect(statusOf(viaMessage)).toBe(200);
        expect(viaMessage?.response?.body?.success).toBe(true);
        expect(viaMessage?.response?.body?.data).toEqual({ success: false, message: 'not applied' });
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
        expect(injected[0].url).toBe('http://app.example.test/api/v1/data/crm_lead/lead%207');
        expect(injected[0].init.method).toBe('DELETE');
        expect(injected[0].init.body).toBeUndefined();
    });
});

describe('apiActionResultOf — a 2xx answer read as the action\'s result', () => {
    const at200 = (body: unknown) => ({ status: 200, body, headers: {} });

    it('unwraps `data` from a `{ success: false, data }` answer: the 2xx decides, not the flag', () => {
        expect(apiActionResultOf(at200({ success: false, data: { reason: 'already_banned' } }))).toEqual({ reason: 'already_banned' });
    });

    it('answers a `{ success: false, message }` answer (no `data`) as the body itself', () => {
        expect(apiActionResultOf(at200({ success: false, message: 'not applied' }))).toEqual({ success: false, message: 'not applied' });
    });

    it('still unwraps the ordinary success envelope and passes an unenveloped body through', () => {
        expect(apiActionResultOf(at200({ success: true, data: { ok: true } }))).toEqual({ ok: true });
        expect(apiActionResultOf(at200({ status: true }))).toEqual({ status: true });
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
        expect(h.injected[0].url).toBe('http://app.example.test/api/v1/auth/admin/ban-user');
        expect(JSON.parse(String(h.injected[0].init.body))).toEqual({ banReason: 'spam', userId: 'u_target', organizationId: 'org_1' });
        expect(h.executeAction).not.toHaveBeenCalled();
    });

    it('relays ONLY the bearer-lane pair into the tool result — no Set-Cookie line, ever (the MCP door admits cookie sessions)', async () => {
        // A tool result is JSON text that whatever script receives it can read;
        // an `HttpOnly` session cookie's value must not travel in it. The REST
        // door relays cookies on the response, where only the browser sees them.
        const h = boot({
            answer: {
                body: { session: { userId: 'u_target' } },
                headers: [
                    ['set-cookie', 'better-auth.session_token=new; Path=/; HttpOnly'],
                    ['set-cookie', 'better-auth.admin_session=adm; Path=/; HttpOnly'],
                    ['set-auth-token', 'tok_impersonated'],
                    ['set-admin-session-token', 'tok_admin_recovery'],
                ],
            },
        });

        const result: any = await runViaMcp(h, BAN_LEAD.name, { recordId: 'u_target' });

        expect(result.headers).toEqual({ 'set-auth-token': 'tok_impersonated', 'set-admin-session-token': 'tok_admin_recovery' });
        expect(JSON.stringify(result)).not.toContain('session_token=');
        expect(JSON.stringify(result)).not.toContain('HttpOnly');
    });

    it('a bearer-only rotation with no cookie line reaches the tool result as before', async () => {
        const h = boot({ answer: { body: { ok: true }, headers: [['set-auth-token', 'rotated']] } });
        const result: any = await runViaMcp(h, BAN_LEAD.name, { recordId: 'u_target' });
        expect(result.headers).toEqual({ 'set-auth-token': 'rotated' });
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

// [#27738] G1: the target's refusal envelope is relayed WHOLE. The door used
// to rebuild it from `code` alone, so everything a console branch reads beside
// the code was dropped on the way: a flow endpoint's `details.innerRefusal` and
// `userMessage` (the refusal its data node met), and the entitlement members a
// coded 403 carries in `details`. Each path is pinned with the target's member
// deep-equal on the door's answer, never a single key.
/** A flow endpoint's run refused by its data node: `400 FLOW_FAILED`, as the endpoint door answers it. */
const FLOW_FAILED_ENVELOPE = {
    success: false,
    error: {
        code: 'FLOW_FAILED',
        message: "Node 'update_task' failed: update_record(showcase_task) failed: Permission denied",
        httpStatus: 400,
        userMessage: 'You cannot edit this task.',
        details: {
            errorMessage: "Node 'update_task' failed: update_record(showcase_task) failed: Permission denied",
            summary: { selected: 0, acted: 0, skipped: 0, nodes: [], gates: [] },
            innerRefusal: { code: 'PERMISSION_DENIED', message: 'Permission denied' },
        },
    },
};
/** A coded entitlement refusal, the shape the console's entitlement dialog reads (`error.details`). */
const ENTITLEMENT_ENVELOPE = {
    success: false,
    error: {
        code: 'DEV_ENV_LIMIT',
        message: 'Development environment limit reached (3 of 3).',
        httpStatus: 403,
        details: {
            current: 3, limit: 3, plan: 'team',
            upgrade_url: 'https://cloud.example.test/billing/upgrade',
            contact_url: 'https://cloud.example.test/contact',
        },
    },
};

describe('[#27738] G1 — the door relays the target\'s refusal envelope whole', () => {
    it('G1a: a flow endpoint\'s 400 FLOW_FAILED keeps `details.innerRefusal` and `userMessage`', async () => {
        const { dispatcher } = boot({ answer: { status: 400, body: FLOW_FAILED_ENVELOPE } });

        const res = await dispatcher.handleActions(`/${OBJECT}/${RECALC_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(400);
        const error = res?.response?.body?.error;
        expect(res?.response?.body?.success).toBe(false);
        expect(error?.code).toBe('FLOW_FAILED');
        expect(error?.message).toBe(FLOW_FAILED_ENVELOPE.error.message);
        expect(error?.httpStatus).toBe(400);
        expect(error?.details).toEqual(FLOW_FAILED_ENVELOPE.error.details);
        expect(error?.userMessage).toBe(FLOW_FAILED_ENVELOPE.error.userMessage);
    });

    it('G1b: a coded 403 keeps its entitlement members — upgrade_url, contact_url, plan, current, limit', async () => {
        const { dispatcher } = boot({ answer: { status: 403, body: ENTITLEMENT_ENVELOPE } });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(403);
        const error = res?.response?.body?.error;
        expect(error?.code).toBe('DEV_ENV_LIMIT');
        expect(error?.message).toBe(ENTITLEMENT_ENVELOPE.error.message);
        expect(error?.details).toEqual(ENTITLEMENT_ENVELOPE.error.details);
    });

    it('a refusal the target did NOT envelope keeps today\'s answer: its status, code and sentence, and nothing invented', async () => {
        // better-auth answers `{ code, message }` with no ObjectStack envelope;
        // there is no `details` to relay, so none appears.
        const { dispatcher } = boot({ answer: { status: 404, body: { code: 'USER_NOT_FOUND', message: 'User not found' } } });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(404);
        expect(codeOf(res)).toBe('USER_NOT_FOUND');
        expect(messageOf(res)).toBe('User not found');
        expect(res?.response?.body?.error?.details).toBeUndefined();
        expect(res?.response?.body?.error?.userMessage).toBeUndefined();
    });

    it('MCP `run_action`: the target\'s `details` ride the throw, so the tool error carries them as the REST answer does', async () => {
        const h = boot({ answer: { status: 400, body: FLOW_FAILED_ENVELOPE } });
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                service === 'metadata' ? h.metadata
                : service === 'automation' ? null
                : service === 'http.server' ? { getRawApp: () => ({ request: h.request }) }
                : h.ql,
            getObjectQL: async () => h.ql,
        };

        const thrown = await invokeBusinessAction(deps, CTX() as any, RECALC_LEAD.name, { recordId: 'u_target' }, {
            driver: h.ql,
            ec: { userId: 'u_agent', tenantId: 'org_1', systemPermissions: [] },
            getMeta: () => h.metadata,
            callData: async (_a: string, p: any) => ({ object: p?.object, id: p?.id, record: { id: p?.id } }),
        }).catch((e) => e);

        expect((thrown as any).status).toBe(400);
        expect((thrown as any).code).toBe('FLOW_FAILED');
        expect((thrown as any).details).toEqual(FLOW_FAILED_ENVELOPE.error.details);
    });
});

// [#27738] G2: the `outputs.<key>` decision-output family is admitted by the
// param contract for a forwarded `type: 'api'` action (ADR-0104 D2, amended
// 2026-10-30). The console sends one such param per output an approval node
// declares; the key set is per request, so no action can declare them, and the
// door already folds them into the body's `outputs`. Refused here, an Approve
// carrying a decision output never reached that fold.
describe('[#27738] G2 — an approve click with a decision output passes the param contract and is folded', () => {
    const PARAMS = { comment: 'ok', 'outputs.next_reviewers': ['u_2', 'u_3'], 'outputs.note': '' };

    it('REST: the `outputs.<key>` params pass and reach the target folded into `outputs` (a blank one omitted)', async () => {
        const { dispatcher, injected } = boot({ answer: { body: { success: true, data: { request: { id: 'u_target' } } } } });

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${APPROVE_LEAD.name}`, 'POST', { recordId: 'u_target', params: PARAMS }, CTX(),
        );

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(injected).toHaveLength(1);
        expect(injected[0].url).toBe('http://app.example.test/api/v1/approvals/requests/u_target/approve');
        expect(JSON.parse(String(injected[0].init.body))).toEqual({ comment: 'ok', outputs: { next_reviewers: ['u_2', 'u_3'] } });
    });

    it('REST: an undeclared key outside the family is still refused with today\'s message, and nothing is forwarded', async () => {
        const { dispatcher, request } = boot();

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${APPROVE_LEAD.name}`, 'POST', { recordId: 'u_target', params: { ...PARAMS, bogus: 1 } }, CTX(),
        );

        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_ERROR');
        expect(messageOf(res)).toContain('Unknown action param "bogus"');
        // The admitted family is not among the offenders.
        expect(messageOf(res)).not.toContain('outputs.');
        expect(request).not.toHaveBeenCalled();
    });

    it('MCP `run_action`: the same params pass and reach the target folded', async () => {
        const h = boot({ answer: { body: { success: true, data: { request: { id: 'u_target' } } } } });
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                service === 'metadata' ? h.metadata
                : service === 'automation' ? null
                : service === 'http.server' ? { getRawApp: () => ({ request: h.request }) }
                : h.ql,
            getObjectQL: async () => h.ql,
        };

        const result: any = await invokeBusinessAction(deps, CTX() as any, APPROVE_LEAD.name, { recordId: 'u_target', params: PARAMS }, {
            driver: h.ql,
            ec: { userId: 'u_agent', tenantId: 'org_1', systemPermissions: [] },
            getMeta: () => h.metadata,
            callData: async (_a: string, p: any) => ({ object: p?.object, id: p?.id, record: { id: p?.id } }),
        });

        expect(result.ok).toBe(true);
        expect(JSON.parse(String(h.injected[0].init.body))).toEqual({ comment: 'ok', outputs: { next_reviewers: ['u_2', 'u_3'] } });
    });
});

describe('buildApiActionRequest — the declaration\'s request, by the console\'s own rules', () => {
    it('[#27738] folds the `outputs.<key>` family into `outputs`, omits a blank one, and leaves every other key flat', () => {
        // The fold the G2 admission relies on, pinned on its own: the console's
        // `apiHandler` folds the same family by the same rule.
        const action = { name: 'approve', type: 'api', target: '/api/v1/approvals/requests/r1/approve' };
        const req = buildApiActionRequest(action, {
            params: {
                comment: 'ok', 'outputs.next_reviewers': ['u_2'], 'outputs.reason': 'fits budget',
                'outputs.note': '', 'outputs.skipped': undefined, 'outputs.': 'no key', 'meta.source': 'console',
            },
            ec: {},
        });
        expect((req as any).body).toEqual({
            comment: 'ok', outputs: { next_reviewers: ['u_2'], reason: 'fits budget' }, 'outputs.': 'no key', 'meta.source': 'console',
        });
        // Under `bodyShape.wrap` the params are nested, and nothing is folded.
        const wrapped = buildApiActionRequest({ ...action, bodyShape: { wrap: 'data' } }, { params: { 'outputs.reason': 'x' }, ec: {} });
        expect((wrapped as any).body).toEqual({ data: { 'outputs.reason': 'x' } });
    });

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
        // Whitespace inside the braces is the same console syntax.
        const spaced = buildApiActionRequest(
            { name: 'submit', type: 'api', target: '/api/v1/forms/x', bodyExtra: { name: '{{ page.inquiryName }}' } }, { params: {}, ec },
        );
        expect((spaced as any).status).toBe(400);
    });

    it('passes a literal `{{…}}` that is NOT the console\'s `{{page.*}}` syntax through as the author\'s text', () => {
        // Only the page-variable spelling is browser-only; a Handlebars-looking
        // literal in a param or `bodyExtra` is content, not a token.
        const req = buildApiActionRequest(
            { name: 'submit', type: 'api', target: '/api/v1/forms/x', bodyExtra: { template: '{{greeting}} {{ user.name }}' } },
            { params: { note: 'see {{docs}}' }, ec },
        );
        expect((req as any).status).toBeUndefined();
        expect((req as any).body).toEqual({ note: 'see {{docs}}', template: '{{greeting}} {{ user.name }}' });
    });

    it('does not inject `organizationId` outside `/api/v1/auth/`, and respects an explicit one inside it', () => {
        const plain = buildApiActionRequest({ name: 'p', type: 'api', target: '/api/v1/apps/x/recalc' }, { params: { a: 1 }, ec });
        expect((plain as any).body).toEqual({ a: 1 });
        const explicit = buildApiActionRequest({ name: 'q', type: 'api', target: '/api/v1/auth/organization/update' }, { params: { organizationId: 'org_other' }, ec });
        expect((explicit as any).body).toEqual({ organizationId: 'org_other' });
    });
});

// [#28217] An identity route (the auth mount) reads its caller from its own
// signed-in session and admits no API key, so an API-key caller forwarded to it
// arrived as nobody and came back as the target's anonymous 401. The doors now
// refuse that one combination by name, before the target is called; which
// credentials the identity route accepts is unchanged, so the session lane is
// forwarded exactly as before and a key still reaches every other target.
describe('[#28217] an API-key caller is refused by name before a forward to an identity route', () => {
    /** A caller the door admitted by API key: the key header, no session bearer or cookie. */
    const KEY_CTX = (): HttpProtocolContext => {
        const ctx: any = CTX({ 'x-api-key': 'osk_member_key' });
        delete ctx.request.headers.authorization;
        delete ctx.request.headers.cookie;
        ctx.admission = { credential: 'api_key', authGate: undefined };
        return ctx as HttpProtocolContext;
    };
    const SESSION_CTX = (): HttpProtocolContext =>
        ({ ...CTX(), admission: { credential: 'session', authGate: undefined } } as unknown as HttpProtocolContext);
    const runViaMcp = async (h: ReturnType<typeof boot>, ctx: HttpProtocolContext, name: string, input: any = {}) => {
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                service === 'metadata' ? h.metadata
                : service === 'automation' ? null
                : service === 'http.server' ? { getRawApp: () => ({ request: h.request }) }
                : h.ql,
            getObjectQL: async () => h.ql,
        };
        return invokeBusinessAction(deps, ctx as any, name, input, {
            driver: h.ql,
            ec: { userId: 'u_member', tenantId: 'org_1', systemPermissions: [] },
            getMeta: () => h.metadata,
            callData: async (_a: string, p: any) => ({ object: p?.object, id: p?.id, record: { id: p?.id } }),
        });
    };

    it('REST: a key-admitted caller of an identity-route action gets the named 401 and the target is never called', async () => {
        const { dispatcher, request } = boot();

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, KEY_CTX());

        expect(statusOf(res)).toBe(401);
        expect(codeOf(res)).toBe(standardErrorCodeForHttpStatus(401));
        expect(messageOf(res)).toBe(apiActionIdentityRouteKeyRefusal(BAN_LEAD, BAN_LEAD.target));
        expect(request).not.toHaveBeenCalled();
    });

    it('REST: the same action for a session-admitted caller is forwarded exactly as before', async () => {
        const { dispatcher, injected } = boot({ answer: { body: { success: true, data: { banned: true } } } });

        const res = await dispatcher.handleActions(`/${OBJECT}/${BAN_LEAD.name}`, 'POST', { recordId: 'u_target' }, SESSION_CTX());

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(injected).toHaveLength(1);
        expect(headersOf(injected[0].init).authorization).toBe('Bearer tok_member');
    });

    it('REST: a key-admitted caller of a NON-identity target is still forwarded, the key carried across', async () => {
        const { dispatcher, injected } = boot();

        const res = await dispatcher.handleActions(`/${OBJECT}/${DELETE_LEAD.name}`, 'POST', { recordId: 'lead 7' }, KEY_CTX());

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(injected).toHaveLength(1);
        expect(injected[0].url).toBe('http://app.example.test/api/v1/data/crm_lead/lead%207');
        expect(headersOf(injected[0].init)['x-api-key']).toBe('osk_member_key');
    });

    it('MCP `run_action`: the key-admitted caller gets the same refusal on the throw, and nothing is forwarded', async () => {
        const h = boot();

        const thrown = await runViaMcp(h, KEY_CTX(), BAN_LEAD.name, { recordId: 'u_target' }).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as any).status).toBe(401);
        expect((thrown as any).code).toBe(standardErrorCodeForHttpStatus(401));
        expect(String(thrown.message)).toBe(apiActionIdentityRouteKeyRefusal(BAN_LEAD, BAN_LEAD.target));
        expect(h.request).not.toHaveBeenCalled();
    });

    it('MCP `run_action`: a key-admitted caller of a non-identity target is forwarded', async () => {
        const h = boot({ answer: { body: { success: true, data: { recalculated: 1 } } } });

        const result: any = await runViaMcp(h, KEY_CTX(), RECALC_LEAD.name, { recordId: 'u_target' });

        expect(result.ok).toBe(true);
        expect(result.result).toEqual({ recalculated: 1 });
        expect(h.injected[0].url).toBe('http://app.example.test/api/v1/apps/showcase/recalc');
    });
});

// [#28178] An agent connected to MCP over OAuth holds an access token that the
// platform honours on the MCP endpoint ONLY (the dispatcher's
// `acceptOAuthAccessToken`). An api action's forward carries the caller's own
// credentials, so that token reached every other target as nobody and the
// agent got the target's anonymous 401. Ruled B (fable 总监决裁 5, Elon
// 2026-10-31): refuse by name before the forward, from ONE table of credential
// kind × target door that `run_action`, the REST door and `list_actions` all
// read — and `list_actions` MARKS such an action instead of hiding it. The
// table states what each door accepts; it widens none (a server-built forward
// credential is #28367, a separate decision).
describe('[#28178] the credential × target-door table: an OAuth caller with no agent to carry is refused by name, and the listing marks it', () => {
    /**
     * An OAuth caller whose envelope carries scopes but that the MCP door did
     * not resolve to an agent principal (no `principalKind: 'agent'`, no
     * client). [ADR-0090 D10 rule 5, #28367] There is no agent for a forward
     * credential to carry, so the #28178 refusal still answers it; the agent
     * principal's flipped cells are pinned in the describe below.
     */
    const OAUTH_CTX = (): HttpProtocolContext => {
        const ctx: any = CTX({ authorization: 'Bearer oat_agent_token' });
        delete ctx.request.headers.cookie;
        ctx.admission = { credential: 'session', authGate: undefined };
        ctx.executionContext = { ...ctx.executionContext, oauthScopes: ['actions:execute', 'data:read'] };
        return ctx as HttpProtocolContext;
    };
    const KEY_CTX = (): HttpProtocolContext => {
        const ctx: any = CTX({ 'x-api-key': 'osk_member_key' });
        delete ctx.request.headers.authorization;
        delete ctx.request.headers.cookie;
        ctx.admission = { credential: 'api_key', authGate: undefined };
        return ctx as HttpProtocolContext;
    };
    const SESSION_CTX = (): HttpProtocolContext =>
        ({ ...CTX(), admission: { credential: 'session', authGate: undefined } } as unknown as HttpProtocolContext);
    const runViaMcp = async (h: ReturnType<typeof boot>, ctx: HttpProtocolContext, name: string, input: any = {}) => {
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                service === 'metadata' ? h.metadata
                : service === 'automation' ? null
                : service === 'http.server' ? { getRawApp: () => ({ request: h.request }) }
                : h.ql,
            getObjectQL: async () => h.ql,
        };
        return invokeBusinessAction(deps, ctx as any, name, input, {
            driver: h.ql,
            ec: (ctx as any).executionContext,
            getMeta: () => h.metadata,
            callData: async (_a: string, p: any) => ({ object: p?.object, id: p?.id, record: { id: p?.id } }),
        });
    };
    const listFor = async (h: ReturnType<typeof boot>, ctx: HttpProtocolContext): Promise<any[]> =>
        (h.dispatcher as any).buildMcpBridge(ctx).listActions();

    it('the table, cell by cell: identity takes a session only, the MCP endpoint all three, every other door a session or a key', () => {
        const api = (target: string) => ({ name: 'probe', type: 'api', target });
        const cell = (ctx: HttpProtocolContext, target: string) => apiForwardCredentialRefusal(ctx, api(target)) === null ? 'ok' : 'refused';
        const doors = {
            identity: '/api/v1/auth/admin/ban-user',
            mcp: '/api/v1/mcp',
            platform: '/api/v1/data/crm_lead/{id}',
        };
        const table = Object.fromEntries(
            (Object.entries({ session: SESSION_CTX, api_key: KEY_CTX, oauth: OAUTH_CTX }) as Array<[string, () => HttpProtocolContext]>)
                .map(([kind, ctx]) => [kind, Object.fromEntries(Object.entries(doors).map(([door, t]) => [door, cell(ctx(), t)]))]),
        );
        expect(table).toEqual({
            session: { identity: 'ok', mcp: 'ok', platform: 'ok' },
            api_key: { identity: 'refused', mcp: 'ok', platform: 'ok' },
            oauth: { identity: 'refused', mcp: 'ok', platform: 'refused' },
        });
        // Every refusal is the target's own 401 with the standard code.
        expect(apiForwardCredentialRefusal(OAUTH_CTX(), api(doors.platform))).toMatchObject({
            status: 401, code: standardErrorCodeForHttpStatus(401),
        });
        // Not an api action, an off-origin target, or a caller the door recorded nothing for: no refusal from the table.
        expect(apiForwardCredentialRefusal(OAUTH_CTX(), { name: 'x', type: 'script', target: doors.platform })).toBeNull();
        expect(apiForwardCredentialRefusal(OAUTH_CTX(), api('https://example.invalid/ping'))).toBeNull();
        expect(apiForwardCredentialRefusal(CTX(), api(doors.identity))).toBeNull();
    });

    it('MCP `run_action`: an OAuth agent running a data-door-style action gets the named 401, and nothing is forwarded', async () => {
        const h = boot();

        const thrown = await runViaMcp(h, OAUTH_CTX(), RECALC_LEAD.name, { recordId: 'u_target' }).catch((e) => e);

        expect(thrown).toBeInstanceOf(Error);
        expect((thrown as any).status).toBe(401);
        expect((thrown as any).code).toBe(standardErrorCodeForHttpStatus(401));
        expect(String(thrown.message)).toBe(apiActionOAuthForwardRefusal(RECALC_LEAD, RECALC_LEAD.target, 'platform'));
        expect(String(thrown.message)).toMatch(/OAuth access token, which is honoured on the MCP endpoint only.*Connect with an API key/);
        expect(h.request).not.toHaveBeenCalled();
    });

    it('MCP `run_action`: an OAuth agent running an identity-route action gets the identity sentence, and nothing is forwarded', async () => {
        const h = boot();

        const thrown = await runViaMcp(h, OAUTH_CTX(), BAN_LEAD.name, { recordId: 'u_target' }).catch((e) => e);

        expect((thrown as any).status).toBe(401);
        expect(String(thrown.message)).toBe(apiActionOAuthForwardRefusal(BAN_LEAD, BAN_LEAD.target, 'identity'));
        expect(String(thrown.message)).not.toMatch(/API key to run it/);
        expect(h.request).not.toHaveBeenCalled();
    });

    it('REST door: the shared forward refuses the same OAuth caller the same way (it never reaches the target)', async () => {
        const { dispatcher, request } = boot();

        const res = await dispatcher.handleActions(`/${OBJECT}/${RECALC_LEAD.name}`, 'POST', { recordId: 'u_target' }, OAUTH_CTX());

        expect(statusOf(res)).toBe(401);
        expect(codeOf(res)).toBe(standardErrorCodeForHttpStatus(401));
        expect(messageOf(res)).toBe(apiActionOAuthForwardRefusal(RECALC_LEAD, RECALC_LEAD.target, 'platform'));
        expect(request).not.toHaveBeenCalled();
    });

    it('unchanged lanes: a session caller and an API-key caller of the same data-door-style action are forwarded', async () => {
        for (const ctx of [SESSION_CTX(), KEY_CTX()]) {
            const h = boot({ answer: { body: { success: true, data: { recalculated: 1 } } } });
            const result: any = await runViaMcp(h, ctx, RECALC_LEAD.name, { recordId: 'u_target' });
            expect(result.ok).toBe(true);
            expect(h.injected).toHaveLength(1);
        }
    });

    it('`list_actions` LISTS the OAuth agent\'s api actions and marks each with the refusal `run_action` answers', async () => {
        const h = boot();

        const listed = await listFor(h, OAUTH_CTX());
        const byName = Object.fromEntries(listed.map((a) => [a.name, a]));

        expect(byName[RECALC_LEAD.name]?.unavailable).toEqual({
            code: standardErrorCodeForHttpStatus(401),
            reason: apiActionOAuthForwardRefusal(RECALC_LEAD, RECALC_LEAD.target, 'platform'),
        });
        expect(byName[BAN_LEAD.name]?.unavailable).toEqual({
            code: standardErrorCodeForHttpStatus(401),
            reason: apiActionOAuthForwardRefusal(BAN_LEAD, BAN_LEAD.target, 'identity'),
        });
        // The mark and the run door read the same table: the throw carries the listed reason.
        const thrown = await runViaMcp(h, OAUTH_CTX(), RECALC_LEAD.name, { recordId: 'u_target' }).catch((e) => e);
        expect(String(thrown.message)).toBe(byName[RECALC_LEAD.name].unavailable.reason);
    });

    it('`list_actions` for a session caller marks nothing; for an API-key caller it marks the identity-route action only', async () => {
        const h = boot();

        const session = await listFor(h, SESSION_CTX());
        expect(session.map((a) => a.name)).toEqual(expect.arrayContaining([BAN_LEAD.name, RECALC_LEAD.name]));
        expect(session.filter((a) => a.unavailable)).toEqual([]);

        const keyed = Object.fromEntries((await listFor(h, KEY_CTX())).map((a) => [a.name, a]));
        expect(keyed[BAN_LEAD.name]?.unavailable).toEqual({
            code: standardErrorCodeForHttpStatus(401),
            reason: apiActionIdentityRouteKeyRefusal(BAN_LEAD, BAN_LEAD.target),
        });
        expect(keyed[RECALC_LEAD.name]).toBeDefined();
        expect(keyed[RECALC_LEAD.name].unavailable).toBeUndefined();
    });
});

describe('[ADR-0090 D10 rule 5, #28367] the two flipped cells: an OAuth agent is forwarded with a forward credential, under the scope-family rule', () => {
    /** The agent principal the MCP door assembles from a verified OAuth access token. */
    const AGENT_CTX = (scopes: string[] = ['actions:execute', 'data:read', 'data:write'], over: Record<string, unknown> = {}): HttpProtocolContext => {
        const ctx: any = CTX({ authorization: 'Bearer oat_agent_token', cookie: 'better-auth.session_token=ambient' });
        ctx.admission = { credential: 'session', authGate: undefined };
        ctx.executionContext = {
            ...ctx.executionContext,
            principalKind: 'agent',
            onBehalfOf: { userId: 'u_member', principalKind: 'human' },
            performedBy: { clientId: 'client_agent' },
            oauthScopes: scopes,
            ...over,
        };
        return ctx as HttpProtocolContext;
    };
    const KEY_CTX = (): HttpProtocolContext => {
        const ctx: any = CTX({ 'x-api-key': 'osk_member_key' });
        delete ctx.request.headers.authorization;
        delete ctx.request.headers.cookie;
        ctx.admission = { credential: 'api_key', authGate: undefined };
        return ctx as HttpProtocolContext;
    };
    const SESSION_CTX = (): HttpProtocolContext =>
        ({ ...CTX(), admission: { credential: 'session', authGate: undefined } } as unknown as HttpProtocolContext);
    const deps = (h: ReturnType<typeof boot>, request = h.request): any => ({
        resolveService: async (_ctx: unknown, service: string) =>
            service === 'metadata' ? h.metadata
            : service === 'automation' ? null
            : service === 'http.server' ? { getRawApp: () => ({ request }) }
            : h.ql,
        getObjectQL: async () => h.ql,
    });
    const runViaMcp = async (h: ReturnType<typeof boot>, ctx: HttpProtocolContext, name: string, input: any = {}, request = h.request) =>
        invokeBusinessAction(deps(h, request), ctx as any, name, input, {
            driver: h.ql,
            ec: (ctx as any).executionContext,
            getMeta: () => h.metadata,
            callData: async (_a: string, p: any) => ({ object: p?.object, id: p?.id, record: { id: p?.id } }),
        });
    const listFor = async (h: ReturnType<typeof boot>, ctx: HttpProtocolContext): Promise<any[]> =>
        (h.dispatcher as any).buildMcpBridge(ctx).listActions();
    const api = (target: string, method?: string) => ({ name: 'probe', type: 'api', target, ...(method ? { method } : {}) });
    const doors = { identity: '/api/v1/auth/admin/ban-user', mcp: '/api/v1/mcp', platform: '/api/v1/data/crm_lead/{id}' };

    it('the table, cell by cell: exactly oauth × identity and oauth × platform flip; api_key × identity keeps refusing by name', () => {
        const cell = (ctx: HttpProtocolContext, target: string) => apiForwardCredentialRefusal(ctx, api(target)) === null ? 'ok' : 'refused';
        const table = Object.fromEntries(
            (Object.entries({ session: SESSION_CTX, api_key: KEY_CTX, oauth: () => AGENT_CTX() }) as Array<[string, () => HttpProtocolContext]>)
                .map(([kind, ctx]) => [kind, Object.fromEntries(Object.entries(doors).map(([door, t]) => [door, cell(ctx(), t)]))]),
        );
        expect(table).toEqual({
            session: { identity: 'ok', mcp: 'ok', platform: 'ok' },
            api_key: { identity: 'refused', mcp: 'ok', platform: 'ok' },
            oauth: { identity: 'ok', mcp: 'ok', platform: 'ok' },
        });
        expect(apiForwardCredentialRefusal(KEY_CTX(), api(doors.identity))).toMatchObject({
            status: 401, message: apiActionIdentityRouteKeyRefusal(api(doors.identity), doors.identity),
        });
    });

    it('an OAuth caller the door did not resolve to an agent (no client named) has no agent to carry: still refused by name', () => {
        const noClient = AGENT_CTX(undefined, { performedBy: undefined });
        expect(apiForwardAgentOf(noClient)).toBeUndefined();
        expect(apiForwardCredentialRefusal(noClient, api(doors.identity))).toMatchObject({
            status: 401, message: apiActionOAuthForwardRefusal(api(doors.identity), doors.identity, 'identity'),
        });
        const notAgent = AGENT_CTX(undefined, { principalKind: 'human' });
        expect(apiForwardCredentialRefusal(notAgent, api(doors.platform))?.status).toBe(401);
    });

    it('the scope-family rule: actions:execute always; a safe method needs a data scope; any other method needs data:write', () => {
        const readOnly = AGENT_CTX(['actions:execute', 'data:read']);
        // A read-consented agent reads through an action and never changes state through one, at either door.
        expect(apiForwardCredentialRefusal(readOnly, api(doors.platform, 'GET'))).toBeNull();
        expect(apiForwardCredentialRefusal(readOnly, api('/api/v1/auth/get-session', 'GET'))).toBeNull();
        for (const [target, method] of [[doors.identity, 'POST'], [doors.platform, 'PATCH'], [doors.platform, 'DELETE'], ['/api/v1/auth/update-user', undefined]] as const) {
            const refusal = apiForwardCredentialRefusal(readOnly, api(target, method));
            expect(refusal, `${method ?? 'POST'} ${target}`).toMatchObject({ status: 403, code: standardErrorCodeForHttpStatus(403) });
            expect(refusal!.message).toMatch(/may run only with the 'data:write' scope, and this connection was not granted it\. The action was not run\./);
        }
        // No data scope at all: not even a read.
        expect(apiForwardCredentialRefusal(AGENT_CTX(['actions:execute']), api(doors.platform, 'GET'))?.message)
            .toMatch(/only with the 'data:read' scope/);
        // No actions:execute: nothing is minted for any method.
        expect(apiForwardCredentialRefusal(AGENT_CTX(['data:read', 'data:write']), api(doors.platform, 'GET'))?.message)
            .toMatch(/only with the 'actions:execute' scope/);
        // The MCP door is not a flipped cell: the rule does not reach it.
        expect(apiForwardCredentialRefusal(readOnly, api(doors.mcp, 'POST'))).toBeNull();
    });

    it('a state-changing method on the metadata door stays outside the flip, whatever the scopes; a read of it is served', () => {
        const full = AGENT_CTX(['actions:execute', 'data:read', 'data:write', 'metadata:write']);
        for (const target of ['/api/v1/meta/object/crm_lead', '/api/v1/environments/env_1/meta/view/x']) {
            for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
                const refusal = apiForwardCredentialRefusal(full, api(target, method));
                expect(refusal, `${method} ${target}`).toMatchObject({ status: 403 });
                expect(refusal!.message).toMatch(/metadata endpoint .* does not change metadata through an action\. The action was not run\./);
            }
            expect(apiForwardCredentialRefusal(full, api(target, 'GET'))).toBeNull();
        }
        // A data route whose name merely starts with "meta" is not the metadata door.
        expect(apiForwardCredentialRefusal(full, api('/api/v1/metadata-like/x', 'POST'))).toBeNull();
    });

    it('MCP `run_action`: the agent\'s identity-route action is forwarded with a forward credential and none of the caller\'s identity headers', async () => {
        const h = boot();
        let redeemed: unknown;
        let handle = '';
        const request = vi.fn(async (url: string, init: RequestInit) => {
            h.injected.push({ url, init });
            handle = headersOf(init)[FORWARD_CREDENTIAL_HEADER]!;
            // What the target's door does: redeem the presented handle for this request.
            redeemed = redeemForwardCredential(handle, String(init.method), url);
            return new Response(JSON.stringify({ success: true, data: { banned: true } }), {
                status: 200,
                headers: [['content-type', 'application/json'], ['set-auth-token', 'rotated'], ['set-cookie', 'better-auth.session_token=new; HttpOnly']],
            });
        });

        const result: any = await runViaMcp(h, AGENT_CTX(), BAN_LEAD.name, { recordId: 'u_target' }, request);

        expect(result.ok).toBe(true);
        expect(request).toHaveBeenCalledTimes(1);
        const sent = headersOf(h.injected[0]!.init);
        expect(sent.authorization).toBeUndefined();
        expect(sent.cookie).toBeUndefined();
        expect(sent['x-api-key']).toBeUndefined();
        expect(handle).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(handle).not.toContain('oat_agent_token');
        expect(redeemed).toEqual({ userId: 'u_member', clientId: 'client_agent', scopes: ['actions:execute', 'data:read', 'data:write'], organizationId: 'org_1' });
        // Revoked once the forward answered; and nothing the target minted, nor the handle, comes back.
        expect(redeemForwardCredential(handle, 'POST', h.injected[0]!.url)).toBeUndefined();
        const answer = JSON.stringify(result);
        expect(answer).not.toContain(handle);
        expect(answer).not.toContain('rotated');
        expect(answer).not.toContain('session_token=new');
    });

    it('REST door: the agent\'s platform action is forwarded with a forward credential, and the answer relays no credential header', async () => {
        const h = boot({ answer: { body: { success: true, data: { recalculated: 1 } }, headers: [['set-auth-token', 'rotated'], ['set-cookie', 'a=b']] } });

        const res: any = await h.dispatcher.handleActions(`/${OBJECT}/${RECALC_LEAD.name}`, 'POST', { recordId: 'u_target' }, AGENT_CTX());

        expect(statusOf(res)).toBe(200);
        expect(h.injected).toHaveLength(1);
        const sent = headersOf(h.injected[0]!.init);
        expect(sent[FORWARD_CREDENTIAL_HEADER]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(sent.authorization).toBeUndefined();
        expect(sent.cookie).toBeUndefined();
        const relayed = JSON.stringify(res?.response?.headers ?? {});
        expect(relayed).not.toMatch(/set-auth-token|set-cookie|rotated/i);
    });

    it('a refused agent run mints nothing: the read-only agent\'s state-changing action is refused 403 by name and the target is never called', async () => {
        const h = boot();

        const thrown = await runViaMcp(h, AGENT_CTX(['actions:execute', 'data:read']), BAN_LEAD.name, { recordId: 'u_target' }).catch((e) => e);

        expect((thrown as any).status).toBe(403);
        expect((thrown as any).code).toBe(standardErrorCodeForHttpStatus(403));
        expect(String(thrown.message)).toMatch(/^Action 'ban_lead' sends a POST request to '\/api\/v1\/auth\/admin\/ban-user', which an AI agent may run only with the 'data:write' scope/);
        expect(h.request).not.toHaveBeenCalled();
    });

    it('`list_actions` marks from the same predicate: the read-only agent sees its state-changing actions marked 403, a full agent sees none marked', async () => {
        const h = boot();

        const readOnly = Object.fromEntries((await listFor(h, AGENT_CTX(['actions:execute', 'data:read']))).map((a) => [a.name, a]));
        expect(readOnly[BAN_LEAD.name]?.unavailable).toMatchObject({ code: standardErrorCodeForHttpStatus(403) });
        expect(readOnly[BAN_LEAD.name].unavailable.reason).toMatch(/only with the 'data:write' scope/);
        const thrown = await runViaMcp(h, AGENT_CTX(['actions:execute', 'data:read']), BAN_LEAD.name, { recordId: 'u_target' }).catch((e) => e);
        expect(String(thrown.message)).toBe(readOnly[BAN_LEAD.name].unavailable.reason);

        const full = await listFor(h, AGENT_CTX());
        expect(full.filter((a) => a.unavailable && [BAN_LEAD.name, RECALC_LEAD.name].includes(a.name))).toEqual([]);
    });

    it('a session caller is forwarded exactly as before: its own credentials, no forward credential', async () => {
        const h = boot();
        const result: any = await runViaMcp(h, SESSION_CTX(), BAN_LEAD.name, { recordId: 'u_target' });
        expect(result.ok).toBe(true);
        const sent = headersOf(h.injected[0]!.init);
        expect(sent.authorization).toBe('Bearer tok_member');
        expect(sent[FORWARD_CREDENTIAL_HEADER]).toBeUndefined();
    });
});

// [#28657] A same-origin api action's target authorizes the caller itself
// (ADR-0066 D4), so a subject row the caller's own scope did not deliver no
// longer answers the door's own 404 ahead of the forward: the door forwards
// and answers what the target answers. The real-stack half — a non-admin
// pending approver's decision from the request page, on the real approvals
// routes — is `packages/verify/src/action-door-api-forward-denied-subject.test.ts`.
// The branches that keep the 404 on a denied load (flow, script/body, and the
// declarative update) stay pinned in `../action-door-record-load-denied.test.ts`
// and `../http-dispatcher.actions-type-dispatch.test.ts`.
describe('[#28657] a denied subject load forwards an api action whose request needs nothing from the row', () => {
    /** An id the fake data layer delivers no row for: the caller-scope load is denied. */
    const HIDDEN = 'areq_hidden';
    const runViaMcp = async (h: ReturnType<typeof boot>, name: string, input: any = {}) => {
        const deps: any = {
            resolveService: async (_ctx: unknown, service: string) =>
                service === 'metadata' ? h.metadata
                : service === 'automation' ? null
                : service === 'http.server' ? { getRawApp: () => ({ request: h.request }) }
                : h.ql,
            getObjectQL: async () => h.ql,
        };
        return invokeBusinessAction(deps, CTX() as any, name, input, {
            driver: h.ql,
            ec: { userId: 'u_agent', tenantId: 'org_1', systemPermissions: [] },
            getMeta: () => h.metadata,
            // The caller's scope delivers nothing for HIDDEN: the data layer's 404.
            callData: async (_a: string, p: any) => {
                if (p?.id === HIDDEN) throw Object.assign(new Error('not found'), { status: 404, code: 'RECORD_NOT_FOUND' });
                return { object: p?.object, id: p?.id, record: { id: p?.id, email: 'target@example.test' } };
            },
        });
    };

    it('REST: the approve shape on a row the caller cannot read is forwarded, and the target\'s 200 is the answer', async () => {
        const { dispatcher, injected } = boot({ answer: { body: { success: true, data: { request: { id: HIDDEN } } } } });

        const res = await dispatcher.handleActions(
            `/${OBJECT}/${APPROVE_LEAD.name}`, 'POST', { recordId: HIDDEN, params: { comment: 'ok' } }, CTX(),
        );

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(injected).toHaveLength(1);
        expect(injected[0].url).toBe(`http://app.example.test/api/v1/approvals/requests/${HIDDEN}/approve`);
        expect(JSON.parse(String(injected[0].init.body))).toEqual({ comment: 'ok' });
        expect(headersOf(injected[0].init).authorization).toBe('Bearer tok_member');
        expect(res?.response?.body?.data).toEqual({ request: { id: HIDDEN } });
    });

    it('REST: the target\'s refusal is the answer — its status, its code, and its `{ code, error }` sentence', async () => {
        // The approvals decision routes answer `{ code, error: '<sentence>' }`.
        const sentence = "actor 'u_member' is not a pending approver";
        const { dispatcher, injected } = boot({ answer: { status: 403, body: { code: 'FORBIDDEN', error: sentence } } });

        const res = await dispatcher.handleActions(`/${OBJECT}/${APPROVE_LEAD.name}`, 'POST', { recordId: HIDDEN }, CTX());

        expect(injected).toHaveLength(1);
        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('FORBIDDEN');
        expect(messageOf(res)).toBe(sentence);
    });

    it('REST: a `recordIdParam` read from `id` is seeded from the routed id alone', async () => {
        const { dispatcher, injected } = boot();

        const res = await dispatcher.handleActions(`/${OBJECT}/${RECALC_LEAD.name}`, 'POST', { recordId: HIDDEN }, CTX());

        expect(statusOf(res), JSON.stringify(res?.response?.body)).toBe(200);
        expect(JSON.parse(String(injected[0].init.body))).toEqual({ recordId: HIDDEN });
    });

    it('REST: an api action whose request needs a field OF the row keeps the 404 RECORD_NOT_FOUND, and nothing is forwarded', async () => {
        for (const action of [NOTE_OWNER, FLAG_BY_EMAIL]) {
            const { dispatcher, request } = boot();

            const res = await dispatcher.handleActions(`/${OBJECT}/${action.name}`, 'POST', { recordId: HIDDEN }, CTX());

            expect(statusOf(res), action.name).toBe(404);
            expect(codeOf(res), action.name).toBe('RECORD_NOT_FOUND');
            expect(request, action.name).not.toHaveBeenCalled();
        }
    });

    it('REST, the firing control: the same two actions on a row the caller CAN read are forwarded with the row\'s field', async () => {
        const note = boot();
        expect(statusOf(await note.dispatcher.handleActions(`/${OBJECT}/${NOTE_OWNER.name}`, 'POST', { recordId: 'u_target' }, CTX()))).toBe(200);
        expect(note.injected[0].url).toBe('http://app.example.test/api/v1/data/crm_note/target%40example.test');

        const flag = boot();
        expect(statusOf(await flag.dispatcher.handleActions(`/${OBJECT}/${FLAG_BY_EMAIL.name}`, 'POST', { recordId: 'u_target' }, CTX()))).toBe(200);
        expect(JSON.parse(String(flag.injected[0].init.body))).toEqual({ email: 'target@example.test' });
    });

    it('REST: a target\'s 400 prescription in `{ code, error }` is relayed, not replaced by "its target answered HTTP 400"', async () => {
        const sentence = 'decision output(s) `amount` are required to approve this step';
        const { dispatcher } = boot({ answer: { status: 400, body: { code: 'VALIDATION_FAILED', error: sentence } } });

        const res = await dispatcher.handleActions(`/${OBJECT}/${APPROVE_LEAD.name}`, 'POST', { recordId: 'u_target' }, CTX());

        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(messageOf(res)).toBe(sentence);
    });

    it('MCP `run_action`: the same approve shape on a row the caller cannot read is forwarded and succeeds', async () => {
        const h = boot({ answer: { body: { success: true, data: { request: { id: HIDDEN } } } } });

        const result: any = await runViaMcp(h, APPROVE_LEAD.name, { recordId: HIDDEN, params: { comment: 'ok' } });

        expect(result.ok).toBe(true);
        expect(result.result).toEqual({ request: { id: HIDDEN } });
        expect(h.injected[0].url).toBe(`http://app.example.test/api/v1/approvals/requests/${HIDDEN}/approve`);
        expect(JSON.parse(String(h.injected[0].init.body))).toEqual({ comment: 'ok' });
    });

    it('MCP `run_action`: a request that needs a field OF the row is thrown the 404 RECORD_NOT_FOUND, and nothing is forwarded', async () => {
        for (const action of [NOTE_OWNER, FLAG_BY_EMAIL]) {
            const h = boot();

            const thrown = await runViaMcp(h, action.name, { recordId: HIDDEN }).catch((e) => e);

            expect((thrown as any).status ?? (thrown as any).statusCode, action.name).toBe(404);
            expect((thrown as any).code, action.name).toBe('RECORD_NOT_FOUND');
            expect(h.request, action.name).not.toHaveBeenCalled();
        }
    });

    it('MCP `run_action`: the target\'s `{ code, error }` sentence rides the throw', async () => {
        const sentence = 'decision output(s) `amount` are required to approve this step';
        const h = boot({ answer: { status: 400, body: { code: 'VALIDATION_FAILED', error: sentence } } });

        const thrown = await runViaMcp(h, APPROVE_LEAD.name, { recordId: HIDDEN }).catch((e) => e);

        expect((thrown as any).status).toBe(400);
        expect((thrown as any).code).toBe('VALIDATION_FAILED');
        expect(String(thrown.message)).toBe(sentence);
    });

    it('the shared helpers: which declarations read the row, and the row a denied load builds from', () => {
        expect(apiActionRequestReadsSubjectRow(APPROVE_LEAD)).toBe(false);
        expect(apiActionRequestReadsSubjectRow(RECALC_LEAD)).toBe(false);
        expect(apiActionRequestReadsSubjectRow(BAN_LEAD)).toBe(false);
        expect(apiActionRequestReadsSubjectRow(DELETE_LEAD)).toBe(false);
        expect(apiActionRequestReadsSubjectRow(NOTE_OWNER)).toBe(true);
        expect(apiActionRequestReadsSubjectRow(FLAG_BY_EMAIL)).toBe(true);
        expect(apiActionRequestReadsSubjectRow({ ...APPROVE_LEAD, target: '/api/v1/x/{id}/{status}' })).toBe(true);

        expect(forwardsOnDeniedSubjectLoad(APPROVE_LEAD)).toBe(true);
        expect(forwardsOnDeniedSubjectLoad(NOTE_OWNER)).toBe(false);
        expect(forwardsOnDeniedSubjectLoad(REMOTE_PING)).toBe(false);
        expect(forwardsOnDeniedSubjectLoad({ name: 'run_it', type: 'flow', target: 'some_flow' })).toBe(false);
        expect(forwardsOnDeniedSubjectLoad({ name: 'go', type: 'script' })).toBe(false);
        // `operation` before `type`: a declarative update is never forwarded.
        expect(forwardsOnDeniedSubjectLoad({ ...APPROVE_LEAD, operation: 'update', patch: { done: true } })).toBe(false);

        // ⛔ Whatever a denied load left behind, the request sees the routed id only.
        const leftover = { record: { id: HIDDEN, email: 'secret@example.test' }, recordLoadDenied: true };
        expect(apiForwardSubjectRecord(HIDDEN, leftover)).toEqual({ id: HIDDEN });
        const delivered = { record: { id: 'u_target', email: 'target@example.test' }, recordLoadDenied: false };
        expect(apiForwardSubjectRecord('u_target', delivered)).toBe(delivered.record);
    });
});
