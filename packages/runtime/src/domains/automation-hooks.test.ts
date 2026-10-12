// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22773] The inbound automation hook, `POST /automation/hooks/:flowName/:hookId`,
 * through the dispatcher — segment 2 of ruling A on #22757 (director record
 * `6105447950`): admitted with no session, through to the trigger's own HMAC
 * verifier and nothing else, on a kernel that registers no `http.server` (the
 * hosted shape: a tenant kernel owns no socket).
 *
 * Driven through the REAL `HttpDispatcher.dispatch()`. The `trigger-api` member
 * is a test double, because the real one is a separate card (#22774), but its
 * verifier is not: it reads the raw body off the `Request` it is handed and
 * checks the `x-objectstack-signature` with `verifyHttpSignature`, the very
 * function `ApiTrigger.handleRequest` verifies with (`@objectstack/core`),
 * accepts the timestamped form only, as that door does, and answers every
 * post that does not verify with the trigger's one refusal. So a
 * domain that handed it anything but the transport's own unread request, or a
 * re-serialised body, would be caught by the verifier, not by an assertion
 * about plumbing.
 *
 * What this pins:
 *  1. a correctly signed post reaches the verifier and is accepted; a wrongly
 *     signed, unsigned, unknown-flow or wrong-hook post is refused BY THE
 *     VERIFIER — the member runs, and its answer comes back untouched;
 *  2. the two parameters reach the member decoded;
 *  3. condition 1: every other `/automation` path, and every other method on
 *     this one, stays at the anonymous floor (`401 UNAUTHENTICATED`, the answer
 *     each of them gave on the base commit), and the member never runs;
 *  4. condition 2: nothing sits between the allow-list and the verifier — no
 *     `/automation` gate or probe reads anything first, and a non-`POST` meets
 *     the floor's refusal before any absence leaks (the #5519 ordering);
 *  5. an absent `trigger-api` slot or member answers `501 NOT_IMPLEMENTED`,
 *     ⛔ never `ROUTE_NOT_FOUND`, resolved per request;
 *  6. faults (a member that throws, a consumed body) are sanitised 500s;
 *  7. the preamble gates are signature-only for this route, `POST` only: a
 *     signed-in non-member and a session owing an authentication step reach
 *     the verifier, while the same callers stay gated on every other method;
 *  8. the pointer's extra self-test: the allow-list row and the route agree on
 *     every spelling they are shown — a spelling one admits, the other serves
 *     with the same parameters, and every other spelling stays gated;
 *  9. CONTROL: a kernel WITH an `http.server` gets no mount for the path from
 *     the dispatcher (the trigger's own raw-app mount is its door there), so the
 *     path is never mounted twice.
 */

import { describe, it, expect, vi } from 'vitest';
import { isAuthGateAllowlisted, matchInboundHookRoute, signHttpBodyAt, verifyHttpSignature } from '@objectstack/core';
import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext, KernelResolver } from '../http-dispatcher.js';
import { createDispatcherPlugin } from '../dispatcher-plugin.js';

const ORIGIN = 'http://tenant.example';
const FLOW = 'stripe_orders';
const HOOK = 'default';
/** A probe sentinel, not a credential. */
const SECRET = 'pin-22773-hook-secret-4be1';
const ROUTE = `/automation/hooks/${FLOW}/${HOOK}`;
/** A spaced body: a re-serialised one would differ from the bytes the sender signed. */
const BODY = '{ "id": "evt_1",  "amount": 42, "currency": "usd" }';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
const REFUSAL = { success: false, error: { code: 'INVALID_SIGNATURE', message: 'Signature verification failed.' } };

/** The timestamped signature form, the one the inbound door accepts, signed now. */
const sign = (body: string, secret: string) => signHttpBodyAt(body, secret, Math.floor(Date.now() / 1000));

/**
 * A `handleInboundHook` member with the trigger's verifier inside it: the hook
 * armed for each flow, the raw body read once off the request, the signature
 * checked by core's `verifyHttpSignature` and accepted in the timestamped form
 * only, one refusal for every post that does not verify, `202` for one that
 * does. It records every call.
 */
function verifierMember(armed: Record<string, { hookId: string; secret: string }> = { [FLOW]: { hookId: HOOK, secret: SECRET } }) {
    const calls: Array<{ request: Request; hook: { flowName: string; hookId: string }; body: string }> = [];
    const accepted: string[] = [];
    const handleInboundHook = vi.fn(async (request: Request, hook: { readonly flowName: string; readonly hookId: string }): Promise<Response> => {
        const body = await request.text();
        calls.push({ request, hook: { ...hook }, body });
        const arm = Object.prototype.hasOwnProperty.call(armed, hook.flowName) ? armed[hook.flowName] : undefined;
        const verdict = arm && arm.hookId === hook.hookId
            ? verifyHttpSignature(body, arm.secret, request.headers.get('x-objectstack-signature') ?? undefined)
            : { valid: false as const };
        if (!verdict.valid || verdict.scheme !== 'v1') return json(401, REFUSAL);
        accepted.push(body);
        return json(202, { accepted: true, messageId: `msg_${accepted.length}` });
    });
    return { handleInboundHook, calls, accepted };
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

/** An `auth` service whose session is `user` (anonymous when absent). */
const authAs = (user?: { id: string; authGate?: { code: string; message: string } }) => ({
    isAuthGateActive: () => user?.authGate !== undefined,
    getApi: async () => ({
        getSession: async () => (user ? { user, session: { userId: user.id, activeOrganizationId: 'org_tenant' } } : null),
    }),
});

const ctx = (request: Request): HttpProtocolContext => ({ request });
function post(path = ROUTE, opts: { body?: string; signature?: string | null; method?: string } = {}) {
    const body = opts.body ?? BODY;
    const signature = opts.signature === undefined ? sign(body, SECRET) : opts.signature;
    return new Request(`${ORIGIN}/api/v1${path}`, {
        method: opts.method ?? 'POST',
        headers: { ...JSON_HEADERS, ...(signature !== null ? { 'x-objectstack-signature': signature } : {}) },
        body,
    });
}

/** `{ status, code }` of a dispatcher envelope answer. */
const envelope = (r: any) => ({ status: r.response?.status, code: r.response?.body?.error?.code });

describe('[#22773] the inbound hook reaches the verifier on a kernel with no http.server', () => {
    it('a correctly signed anonymous POST reaches the verifier and is accepted — its own request, body unread, the 202 returned as it is', async () => {
        const member = verifierMember();
        // No `auth` service: the caller is anonymous. No `automation` service
        // either: nothing on this route needs it.
        const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
        const request = post();

        // The parsed `body` a transport hands dispatch() is irrelevant: the
        // domain never reads it, the verifier reads the request.
        const result = await dispatcher.dispatch('POST', ROUTE, { id: 'not-this' }, {}, ctx(request));

        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(member.handleInboundHook).toHaveBeenCalledTimes(1);
        expect(member.calls[0]!.request).toBe(request);
        expect(member.calls[0]!.hook).toEqual({ flowName: FLOW, hookId: HOOK });
        expect(member.calls[0]!.body).toBe(BODY);
        expect(member.accepted).toEqual([BODY]);
        const res = result.result as Response;
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(202);
        expect(await res.json()).toEqual({ accepted: true, messageId: 'msg_1' });
    });

    it('a wrongly signed, unsigned, unknown-flow or wrong-hook POST is refused BY THE VERIFIER — its one answer passed through', async () => {
        const member = verifierMember();
        const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
        const cases: Array<[string, Request, string]> = [
            ['wrong secret', post(ROUTE, { signature: sign(BODY, 'not-the-secret') }), ROUTE],
            ['body changed after signing', post(ROUTE, { body: `${BODY} `, signature: sign(BODY, SECRET) }), ROUTE],
            ['unsigned', post(ROUTE, { signature: null }), ROUTE],
            ['malformed signature', post(ROUTE, { signature: 'sha256=zz' }), ROUTE],
            ['unknown flow', post('/automation/hooks/no_such_flow/default'), '/automation/hooks/no_such_flow/default'],
            ['wrong hook id', post(`/automation/hooks/${FLOW}/other`), `/automation/hooks/${FLOW}/other`],
        ];
        for (const [label, request, path] of cases) {
            const result = await dispatcher.dispatch('POST', path, {}, {}, ctx(request));
            expect(result.response, label).toBeUndefined();
            const res = result.result as Response;
            expect(res.status, label).toBe(401);
            expect(await res.json(), label).toEqual(REFUSAL);
        }
        // Every one reached the verifier — nothing in front of it pre-filtered
        // the signature — and none was accepted.
        expect(member.handleInboundHook).toHaveBeenCalledTimes(cases.length);
        expect(member.accepted).toEqual([]);
    });

    it('a signed-in caller is judged exactly as an anonymous one: the verifier decides, both ways', async () => {
        const member = verifierMember();
        const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook }, auth: authAs({ id: 'u_operator' }) });

        const signed = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));
        expect((signed.result as Response).status).toBe(202);
        const forged = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post(ROUTE, { signature: sign(BODY, 'session-is-no-credential') })));
        expect((forged.result as Response).status).toBe(401);
        expect(member.handleInboundHook).toHaveBeenCalledTimes(2);
    });

    it('the two parameters reach the member DECODED; an escape that does not decode is passed raw', async () => {
        const member = verifierMember();
        const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
        for (const [path, hook] of [
            ['/automation/hooks/a%2Fb/h%20x%25', { flowName: 'a/b', hookId: 'h x%' }],
            ['/automation/hooks/%E6%B5%81/default', { flowName: '流', hookId: 'default' }],
            ['/automation/hooks/f%E0/h', { flowName: 'f%E0', hookId: 'h' }],
        ] as const) {
            member.calls.length = 0;
            await dispatcher.dispatch('POST', path, {}, {}, ctx(post(path)));
            expect(member.calls.map((c) => c.hook), path).toEqual([hook]);
        }
    });
});

describe('[#22773] condition 1 — every other /automation path, and every other method, stays at the floor', () => {
    // Measured on the base commit (12b9daf7) before any change: every one of
    // these answered an anonymous caller `401 UNAUTHENTICATED` from the
    // `/automation` domain's floor — and so did `POST` on the exact route.
    const OTHER_PATHS = [
        '/automation', '/automation/hooks', '/automation/hooks/x', '/automation/hooks/x/y/z',
        '/automation/hooks/f/h/runs', '/automation/hooks/trigger', '/automation/hooks/runs/r1/resume',
        '/automation/f/trigger', '/automation/trigger/f', '/automation/f/runs/r1', '/automation/hooksx/f/h',
        '/automation/hook/f/h', '/automation//hooks/f/h', '/automation/hooks//h', '/automation/hooks/f//h',
        '/automation/%68ooks/f/h', '/automation/HOOKS/f/h',
    ];

    it('anonymous: every other /automation path, on every method, is the floor\'s 401 — the member never runs', async () => {
        const member = verifierMember();
        const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
        for (const path of OTHER_PATHS) {
            for (const method of ['POST', 'GET', 'PUT', 'PATCH', 'DELETE']) {
                const request = new Request(`${ORIGIN}/api/v1${path}`, { method, ...(method === 'GET' ? {} : { body: BODY }) });
                const result = await dispatcher.dispatch(method, path, {}, {}, ctx(request));
                expect(envelope(result), `${method} ${path}`).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
            }
        }
        expect(member.handleInboundHook).not.toHaveBeenCalled();
    });

    it('anonymous: every non-POST on the exact route is the floor\'s 401, and the member never runs for it', async () => {
        const member = verifierMember();
        const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
        for (const method of ['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE']) {
            const request = new Request(`${ORIGIN}/api/v1${ROUTE}`, { method });
            const result = await dispatcher.dispatch(method, ROUTE, undefined, {}, ctx(request));
            expect(envelope(result), method).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        }
        expect(member.handleInboundHook).not.toHaveBeenCalled();
    });
});

describe('[#22773] condition 2 — nothing sits between the allow-list and the verifier', () => {
    it('no /automation gate or probe reads anything before the member: the automation and security services are never touched', async () => {
        const member = verifierMember();
        const touched: string[] = [];
        const tripwire = (name: string) => new Proxy({}, {
            get: (_t, prop) => {
                if (prop !== 'then') touched.push(`${name}.${String(prop)}`);
                return undefined;
            },
        });
        const { dispatcher } = makeDispatcher({
            'trigger-api': { handleInboundHook: member.handleInboundHook },
            automation: tripwire('automation'),
            security: tripwire('security'),
        });

        const result = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));

        expect((result.result as Response).status).toBe(202);
        expect(touched).toEqual([]);
        // ⭐ CONTROL: the tripwire does fire for an ordinary /automation request
        // from a signed-in caller, so a silent tripwire is not why it is empty.
        const authed = makeDispatcher({ automation: tripwire('automation'), auth: authAs({ id: 'u1' }) });
        await authed.dispatcher.dispatch('GET', '/automation/actions', undefined, {}, ctx(new Request(`${ORIGIN}/api/v1/automation/actions`)));
        expect(touched.some((t) => t.startsWith('automation.')), touched.join(', ')).toBe(true);
    });

    it('the #5519 ordering: with neither service composed, a non-POST meets the floor\'s 401 — never a 501 that leaks what is mounted', async () => {
        const { dispatcher } = makeDispatcher({});
        for (const method of ['GET', 'PUT', 'DELETE']) {
            const request = new Request(`${ORIGIN}/api/v1${ROUTE}`, { method });
            const result = await dispatcher.dispatch(method, ROUTE, undefined, {}, ctx(request));
            expect(envelope(result), method).toEqual({ status: 401, code: 'UNAUTHENTICATED' });
        }
    });
});

describe('[#22773] absence is a typed 501, never ROUTE_NOT_FOUND', () => {
    it('no trigger-api slot on the kernel: 501 NOT_IMPLEMENTED, naming the service', async () => {
        const { dispatcher } = makeDispatcher({});
        const result = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain('no trigger-api service is registered');
        expect(result.response?.body?.error?.message).toContain('@objectstack/trigger-api');
    });

    it('a trigger-api service with no handleInboundHook member: 501 NOT_IMPLEMENTED, naming the member', async () => {
        const { dispatcher } = makeDispatcher({ 'trigger-api': { somethingElse: vi.fn() } });
        const result = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));
        expect(envelope(result)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });
        expect(result.response?.body?.error?.message).toContain('does not implement handleInboundHook');
    });

    it('the slot is read per request: one registered after a 501 is reached by the next request', async () => {
        const services: Record<string, unknown> = {};
        const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });

        const before = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));
        expect(envelope(before)).toEqual({ status: 501, code: 'NOT_IMPLEMENTED' });

        const member = verifierMember();
        services['trigger-api'] = { handleInboundHook: member.handleInboundHook };
        const after = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));
        expect(after.response, JSON.stringify(after.response?.body)).toBeUndefined();
        expect((after.result as Response).status).toBe(202);
    });
});

describe('[#22773] faults are the server\'s, answered as such', () => {
    it('a member that throws: a sanitised 500, its message withheld from the sender and logged', async () => {
        const boom = new Error('SQLITE_ERROR: no such table: sys_flow_credential');
        const { dispatcher, logger } = makeDispatcher({ 'trigger-api': { handleInboundHook: vi.fn().mockRejectedValue(boom) } });

        const result = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(JSON.stringify(result.response?.body)).not.toContain('sys_flow_credential');
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0]![1]).toBe(boom);
    });

    it('a POST whose body the transport already consumed: 500 and logged, and the verifier is never asked', async () => {
        const member = verifierMember();
        const { dispatcher, logger } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
        const request = post();
        await request.text(); // what a transport that parsed the body off the raw request would leave

        const result = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request));

        expect(envelope(result)).toEqual({ status: 500, code: 'INTERNAL_ERROR' });
        expect(member.handleInboundHook).not.toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(String(logger.error.mock.calls[0]![0])).toContain('request body was consumed');
    });
});

describe('[#22773] the preamble gates are signature-only for the route, POST only', () => {
    const ENV = 'env-tenant-1';
    const USER = 'u-signed-in';

    /**
     * A multi-tenant host: the resolver places every request in `ENV` on a
     * tenant kernel whose session is a signed-in user (with an optional
     * ADR-0069 gate posture) and whose `sys_environment_member` holds a row
     * only when `member` is set.
     */
    function makeTenantHost(opts: { member?: boolean; authGate?: { code: string; message: string } } = {}) {
        const hook = verifierMember();
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
        const tenant = kernelWith({
            objectql,
            auth: authAs({ id: USER, ...(opts.authGate ? { authGate: opts.authGate } : {}) }),
            'trigger-api': { handleInboundHook: hook.handleInboundHook },
        });
        const resolver: KernelResolver = {
            resolveKernel: async (c: HttpProtocolContext) => {
                c.environmentId = ENV;
                return tenant;
            },
        };
        const dispatcher = new HttpDispatcher(kernelWith({}), undefined, { kernelResolver: resolver, enforceProjectMembership: true });
        const membershipReads = () => find.mock.calls.filter((call) => call[0] === 'sys_environment_member').length;
        return { dispatcher, hook, membershipReads };
    }

    it('a signed-in caller who is NOT a member of the environment reaches the verifier, on both spellings — as on the self-hosted mount', async () => {
        for (const path of [ROUTE, `/environments/${ENV}${ROUTE}`]) {
            const { dispatcher, hook, membershipReads } = makeTenantHost();
            const result = await dispatcher.dispatch('POST', path, {}, {}, ctx(post(ROUTE)));
            expect(result.response, `${path} ${JSON.stringify(result.response?.body)}`).toBeUndefined();
            expect((result.result as Response).status, path).toBe(202);
            expect(hook.handleInboundHook, path).toHaveBeenCalledTimes(1);
            expect(membershipReads(), path).toBe(0);
        }
    });

    it('⭐ CONTROL: the same non-member stays membership-checked on every other method and every other hook-shaped path', async () => {
        for (const [method, path] of [
            ['GET', '/automation/hooks/runs/r1'],    // a run read of a flow named `hooks`
            ['GET', ROUTE], ['DELETE', ROUTE],
            ['POST', '/automation/hooks/x'], ['POST', '/automation/hooks/x/y/z'], ['POST', '/automation//hooks/f/h'],
        ] as const) {
            const { dispatcher, hook, membershipReads } = makeTenantHost();
            const request = new Request(`${ORIGIN}/api/v1${path}`, { method, ...(method === 'GET' ? {} : { body: BODY }) });
            const result = await dispatcher.dispatch(method, path, {}, {}, ctx(request));
            expect(envelope(result), `${method} ${path}`).toEqual({ status: 403, code: 'PROJECT_MEMBERSHIP_REQUIRED' });
            expect(membershipReads(), `${method} ${path}`).toBe(1);
            expect(hook.handleInboundHook).not.toHaveBeenCalled();
        }
    });

    it('a session owing an authentication step (ADR-0069) reaches the verifier with its POST, and is gated on every other method', async () => {
        const authGate = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired.' };
        {
            const { dispatcher, hook } = makeTenantHost({ member: true, authGate });
            const result = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(post()));
            expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
            expect((result.result as Response).status).toBe(202);
            expect(hook.handleInboundHook).toHaveBeenCalledTimes(1);
        }
        for (const method of ['GET', 'PUT', 'DELETE']) {
            const { dispatcher, hook } = makeTenantHost({ member: true, authGate });
            const request = new Request(`${ORIGIN}/api/v1${ROUTE}`, { method, ...(method === 'GET' ? {} : { body: BODY }) });
            const result = await dispatcher.dispatch(method, ROUTE, {}, {}, ctx(request));
            expect(result.response?.status, method).toBe(403);
            expect(result.response?.body?.error?.details?.code ?? result.response?.body?.error?.code, method).toBe('PASSWORD_EXPIRED');
            expect(hook.handleInboundHook).not.toHaveBeenCalled();
        }
    });
});

describe('[#22773] the allow-list row and the route agree on every spelling they are shown', () => {
    // The segment-1 pointer on the card (`6106817103`): the allow-list's segment
    // normalisation and this route must agree on every spelling, and a spelling
    // one reader admits and the other reads differently stays gated. Each
    // spelling is dispatched as the transport hands it; `admitted` is the
    // allow-list's own answer for the path the gates see (the dispatcher strips
    // one trailing slash first, and nothing else, before its gates run).
    const SPELLINGS = [
        '/automation/hooks/f/h', '/automation/hooks/f/h/', '/automation/hooks/f/h//', '/automation/hooks/f/h?x=1',
        '/automation/hooks/f%2Fx/h%20y', '/automation/hooks/hooks/automation',
        '/environments/e1/automation/hooks/f/h', '/environments/e1/automation/hooks/f/h/',
        '/environments/e1/automation/hooks/f%2Fx/h',
        '//automation/hooks/f/h', '/automation//hooks/f/h', '/automation/hooks//f/h', '/automation/hooks/f//h',
        '/automation/hooks//h', '/environments//e1/automation/hooks/f/h', '/environments/e1//automation/hooks/f/h',
        '/projects/e1/automation/hooks/f/h', '/api/v1/automation/hooks/f/h', '/environments/automation/hooks/f/h',
        '/environments/a/environments/b/automation/hooks/f/h', '/automation/%68ooks/f/h', '/Automation/hooks/f/h',
        '/automation/hooks/f', '/automation/hooks/f/h/x', '/automation/hooks',
    ];
    const gatePath = (spelling: string) => spelling.replace(/\/$/, '');
    const decoded = (raw: { flowName: string; hookId: string }) => ({
        flowName: decodeURIComponent(raw.flowName), hookId: decodeURIComponent(raw.hookId),
    });

    it('anonymous: admitted by the row ⟺ served by the route, with the same parameters; every other spelling is refused before the member', async () => {
        let admittedCount = 0;
        for (const spelling of SPELLINGS) {
            const member = verifierMember({});
            const { dispatcher } = makeDispatcher({ 'trigger-api': { handleInboundHook: member.handleInboundHook } });
            const admitted = isAuthGateAllowlisted(gatePath(spelling), 'POST');
            const result = await dispatcher.dispatch('POST', spelling, {}, {}, ctx(post(ROUTE)));
            const reached = member.handleInboundHook.mock.calls.length === 1;
            expect(reached, spelling).toBe(admitted);
            if (admitted) {
                admittedCount++;
                const raw = matchInboundHookRoute(gatePath(spelling), 'POST');
                expect(member.calls[0]!.hook, spelling).toEqual(decoded(raw!));
            } else {
                // Gated: the floor's 401, or no route at all — never the member.
                expect([401, 404], `${spelling} -> ${JSON.stringify(result.response?.body)}`).toContain(result.response?.status);
            }
        }
        // Anti-vacuity: both answers occur.
        expect(admittedCount).toBe(9);
        expect(SPELLINGS.length - admittedCount).toBeGreaterThan(10);
    });

    it('a gated session (ADR-0069): exempted by the gate ⟺ served by the route — the gate never opens a spelling the route does not serve', async () => {
        for (const spelling of SPELLINGS) {
            const member = verifierMember({});
            const { dispatcher } = makeDispatcher({
                'trigger-api': { handleInboundHook: member.handleInboundHook },
                auth: authAs({ id: 'u1', authGate: { code: 'MFA_REQUIRED', message: 'Enrol a second factor.' } }),
            });
            const exempt = isAuthGateAllowlisted(gatePath(spelling), 'POST');
            const result = await dispatcher.dispatch('POST', spelling, {}, {}, ctx(post(ROUTE)));
            const reached = member.handleInboundHook.mock.calls.length === 1;
            expect(reached, spelling).toBe(exempt);
            if (!exempt) expect(result.response?.status, spelling).toBe(403);
        }
    });
});

describe('[#22773] CONTROL — a kernel with an http.server gets no second mount of the path', () => {
    /** Records `VERB /path` for every registration the dispatcher plugin makes; mounts nothing. */
    function recordingServer() {
        const routes: string[] = [];
        const rec = (verb: string) => (path: string, _handler: unknown) => { routes.push(`${verb} ${path}`); };
        return { routes, server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') } };
    }
    function pluginCtx(server: unknown) {
        const kernel = { getService: () => undefined, getServiceAsync: async () => undefined };
        return {
            getKernel: () => kernel,
            getService: (name: string) => (name === 'http.server' ? server : undefined),
            environmentId: undefined,
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            hook: () => {},
            on: () => {},
        } as any;
    }
    /** Does a mounted `pattern` (`:param` one segment, a trailing `*` the rest) answer `path`? */
    function answers(pattern: string, path: string): boolean {
        const want = pattern.split('/');
        const got = path.split('/');
        for (let i = 0; i < want.length; i++) {
            if (want[i] === '*') return true;
            if (i >= got.length) return false;
            if (!want[i]!.startsWith(':') && want[i] !== got[i]) return false;
        }
        return want.length === got.length;
    }

    it('the dispatcher plugin mounts nothing that answers POST /api/v1/automation/hooks/:flowName/:hookId — the trigger\'s raw-app mount is that kernel\'s door', async () => {
        const { server, routes } = recordingServer();
        const plugin = createDispatcherPlugin({ securityHeaders: false });
        await plugin.start?.(pluginCtx(server));

        // Anti-vacuity: the plugin mounted the /automation bridge at all.
        expect(routes.filter((r) => r.includes('/automation')).length).toBeGreaterThan(5);
        const hookPath = '/api/v1/automation/hooks/stripe_orders/default';
        const claimants = routes.filter((r) => {
            const sp = r.indexOf(' ');
            return ['POST', 'ALL'].includes(r.slice(0, sp)) && answers(r.slice(sp + 1), hookPath);
        });
        expect(claimants, routes.filter((r) => r.includes('/automation')).join('\n')).toEqual([]);
        // ⭐ The matcher itself is live: it does find the 3-segment POST door it should.
        expect(routes.some((r) => r.startsWith('POST ') && answers(r.slice(5), '/api/v1/automation/f/trigger'))).toBe(true);
    });
});
