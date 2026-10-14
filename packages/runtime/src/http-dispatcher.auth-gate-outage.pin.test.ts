// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23245 — #13906 decision 2 option B, at the dispatcher's own seam]
 *
 * "An *active* auth gate whose session re-read fails answers **503**." REST's
 * `computeExecCtx` has answered that window since #13906, and the declared-
 * endpoint fallback since #23190 (`endpoint-policy.auth-gate.pin.test.ts`).
 * `HttpDispatcher.enforceAuthGate` was the one gated seam that still failed
 * open: its read carried `.catch(() => undefined)` and the whole decision sat
 * under `catch { return null }`, so while the auth service could not answer, a
 * session the ADR-0069 policy holds passed the gate on every dispatcher-served
 * route.
 *
 * ## The three cases, driven through `dispatch()`
 *
 *  1. OUTAGE — the gate is active and the session read fails: `dispatch()`
 *     rejects with the branded `AuthzStoreUnavailableError('auth_gate', …)`
 *     (`SERVICE_UNAVAILABLE`, 503) and the route's member never runs.
 *  2. GATE OFF — the SAME failing backend with no gate feature active: the
 *     gate makes no read of its own and the request is served as before.
 *  3. ACTIVE, CLEAR — the read succeeds and carries no posture: served.
 *
 * Case 2 runs on the outage's own backend on purpose: the only difference
 * between it and case 1 is `isAuthGateActive()`, so it proves the refusal is
 * the ACTIVE gate's and nothing else's.
 *
 * A positive control rides beside them — an expired password on a route the
 * allow-list does not name answers the gate's 403 — so the fixture provably
 * gates and a green "served" cannot mean "the gate never ran".
 *
 * ## The rendering
 *
 * `enforceAuthGate` sits above `dispatch()`'s `try`, so the outage leaves
 * `dispatch()` and the transport's envelope answers it, as it answers the
 * identity step's and the membership gate's outages. The second block mounts
 * the real dispatcher plugin on a recording server and reads the wire body.
 *
 * Negative control (one-shot, recorded in the PR, not kept as a test):
 * restoring `catch { return null }` reds both OUTAGE cases and leaves every
 * control green.
 */

import { describe, it, expect, vi } from 'vitest';

import { isAuthzStoreUnavailableError } from '@objectstack/core';
import { ApiErrorSchema, BaseResponseSchema } from '@objectstack/spec/api';

import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';

const ORIGIN = 'http://tenant.example';
/** Not allow-listed, and the domain hands the request to a recording member. */
const ROUTE = '/webhooks/redeliver';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

/** An ADR-0069 posture (`normalizeAuthGate`'s shape): an expired password. */
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'You must change your password before continuing.' };

type Backend = 'healthy' | 'outage';

/**
 * An `auth` service. `gateActive` answers the probe; `backend` decides whether
 * a session read answers or rejects; `user` is the session's user. Every read
 * is counted, so "the gate made no read" is a number rather than a hope.
 */
function authService(opts: { gateActive: boolean; backend: Backend; user?: Record<string, unknown> }) {
    const getSession = vi.fn(async () => {
        if (opts.backend === 'outage') throw new Error('session backend unavailable');
        return opts.user ? { user: opts.user, session: { userId: opts.user.id, activeOrganizationId: 'org_tenant' } } : null;
    });
    const isAuthGateActive = vi.fn(() => opts.gateActive);
    return { service: { isAuthGateActive, getApi: async () => ({ getSession }) }, getSession, isAuthGateActive };
}

/** A member shaped like `IWebhookService.handleRedeliver`, recording each run. */
function recordingMember() {
    const handleRedeliver = vi.fn(async () => new Response(
        JSON.stringify({ success: true, data: { status: 'pending' } }),
        { status: 200, headers: JSON_HEADERS },
    ));
    return { handleRedeliver };
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

function objectqlStub() {
    return {
        find: vi.fn().mockResolvedValue([]),
        getObjects: vi.fn().mockReturnValue({}),
        registry: {
            getObject: vi.fn().mockReturnValue(null),
            getRegisteredTypes: vi.fn().mockReturnValue([]),
        },
    };
}

function harness(opts: { gateActive: boolean; backend: Backend; user?: Record<string, unknown> }) {
    const auth = authService(opts);
    const member = recordingMember();
    const services = { objectql: objectqlStub(), auth: auth.service, webhooks: { handleRedeliver: member.handleRedeliver } };
    const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });
    const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    (dispatcher as any).domainDeps.logger = logger;
    return { dispatcher, auth, member };
}

const request = () => new Request(`${ORIGIN}/api/v1${ROUTE}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, cookie: 'session=held' },
    body: JSON.stringify({ deliveryId: 'del_1' }),
});
const ctx = (r: Request): HttpProtocolContext => ({ request: r });

/** Settle to the rejection, or to `undefined` when the call RESOLVED. */
const rejectionOf = (p: Promise<unknown>) => p.then(() => undefined, (e) => e);

const HELD_USER = { id: 'u_held', authGate: PASSWORD_EXPIRED };
const CLEAR_USER = { id: 'u_clear' };

describe('[#23245] HttpDispatcher.enforceAuthGate — an active gate that cannot read the session answers 503', () => {
    it('⭐ POSITIVE CONTROL — this fixture gates: an expired password is refused 403 with the gate code, and the member never runs', async () => {
        const { dispatcher, member } = harness({ gateActive: true, backend: 'healthy', user: HELD_USER });
        const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request()));
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.code).toBe('PASSWORD_EXPIRED');
        expect(member.handleRedeliver).not.toHaveBeenCalled();
    });

    it('CASE 1 — OUTAGE: an active gate whose session read fails rejects with the branded 503, and the member never runs', async () => {
        // What origin/main answered on this fixture: the read's rejection
        // became "no session", the gate admitted, and `dispatch()` RESOLVED —
        // the request went on to the route exactly as the gate-off control
        // (CASE 2, same backend) still does.
        const { dispatcher, member } = harness({ gateActive: true, backend: 'outage' });
        const err: any = await rejectionOf(dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request())));
        expect(err, '`dispatch()` RESOLVED — the active gate failed open on the outage').toBeDefined();
        expect(isAuthzStoreUnavailableError(err)).toBe(true);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
        expect(err.object).toBe('auth_gate');
        expect(member.handleRedeliver).not.toHaveBeenCalled();
    });

    it('CASE 2 — GATE OFF: the SAME failing backend with no gate active makes no gate read and is served as before', async () => {
        const off = harness({ gateActive: false, backend: 'outage' });
        const result: any = await off.dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request()));
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect((result.result as Response).status).toBe(200);
        expect(off.member.handleRedeliver).toHaveBeenCalledTimes(1);
        expect(off.auth.isAuthGateActive).toHaveBeenCalled();

        // "No read" measured, not assumed: an ACTIVE gate on the same request
        // reads exactly once more than the inactive one does (the identity
        // step's own reads are the shared baseline).
        const on = harness({ gateActive: true, backend: 'healthy', user: CLEAR_USER });
        const offHealthy = harness({ gateActive: false, backend: 'healthy', user: CLEAR_USER });
        await on.dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request()));
        await offHealthy.dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request()));
        expect(on.auth.getSession.mock.calls.length).toBe(offHealthy.auth.getSession.mock.calls.length + 1);
        expect(off.auth.getSession.mock.calls.length).toBe(offHealthy.auth.getSession.mock.calls.length);
    });

    it('CASE 3 — ACTIVE, CLEAR: a successful read carrying no posture still admits', async () => {
        const { dispatcher, member } = harness({ gateActive: true, backend: 'healthy', user: CLEAR_USER });
        const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request()));
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect((result.result as Response).status).toBe(200);
        expect(member.handleRedeliver).toHaveBeenCalledTimes(1);
    });

    it('CASE 3 — ACTIVE, NO SESSION: a read that resolves with no session (an anonymous caller) is not an outage', async () => {
        const { dispatcher, member } = harness({ gateActive: true, backend: 'healthy' });
        const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request()));
        expect(result.response, JSON.stringify(result.response?.body)).toBeUndefined();
        expect(member.handleRedeliver).toHaveBeenCalledTimes(1);
    });
});

describe('[#23245] the outage reaches the transport envelope as 503 SERVICE_UNAVAILABLE', () => {
    /** A fake `IHttpServer` recording the handlers the plugin mounts. */
    function makeFakeServer() {
        const handlers: Record<string, (req: any, res: any) => any> = {};
        const rec = (verb: string) => (path: string, handler: any) => { handlers[`${verb} ${path}`] = handler; };
        return {
            handlers,
            server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
        };
    }

    async function mountOn(opts: { gateActive: boolean; backend: Backend; user?: Record<string, unknown> }) {
        const { server, handlers } = makeFakeServer();
        const auth = authService(opts);
        const services: Record<string, unknown> = { objectql: objectqlStub(), auth: auth.service };
        const kernel = kernelWith({ ...services, 'http.server': server });
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.({
            getKernel: () => kernel,
            getService: (n: string) => (n === 'http.server' ? server : undefined),
            environmentId: undefined,
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            hook: () => {}, on: () => {},
        } as any);
        return handlers;
    }

    async function drive(handler: (req: any, res: any) => any, req: any) {
        expect(handler, 'route must be mounted').toBeTypeOf('function');
        const res: any = {
            statusCode: undefined, body: undefined,
            status(c: number) { res.statusCode = c; return res; },
            header() { return res; },
            json(b: any) { res.body = b; return res; },
            end() { return res; },
        };
        await handler(req, res);
        return { status: res.statusCode as number, body: res.body };
    }

    // A mounted route whose own answer is distinguishable from every gate
    // answer — `501 NOT_IMPLEMENTED` with no i18n service — measured on this
    // fixture, one row per gate state:
    //
    //   gate     | session read        | before (origin/main)   | after
    //   ---------|---------------------|------------------------|------------------------
    //   active   | FAILS               | 401 UNAUTHENTICATED    | 503 SERVICE_UNAVAILABLE
    //   inactive | FAILS (same backend)| 401 UNAUTHENTICATED    | 401 — unchanged
    //   active   | resolves, no posture| 501 NOT_IMPLEMENTED    | 501 — unchanged (admitted)
    //   active   | resolves, held      | 403 PASSWORD_EXPIRED   | 403 — unchanged
    //
    // The 401 on the first row is the defect on the wire: the gate admitted,
    // and the request ran on as the anonymous caller the identity step's own
    // failed read left behind, byte-identical to the gate-off row.
    const MOUNTED = 'GET /api/v1/i18n/locales';
    const wireRequest = { headers: { cookie: 'session=held' }, query: {} };

    it('OUTAGE on the wire: an active gate whose read fails answers 503 with a declared `SERVICE_UNAVAILABLE` envelope', async () => {
        const handlers = await mountOn({ gateActive: true, backend: 'outage' });
        const { status, body } = await drive(handlers[MOUNTED], wireRequest);
        expect(status).toBe(503);
        expect(BaseResponseSchema.safeParse(body).success).toBe(true);
        expect(body?.success).toBe(false);
        const parsed = ApiErrorSchema.safeParse(body?.error);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('CONTROL on the wire: the same failing backend with no gate active keeps its anonymous answer', async () => {
        const handlers = await mountOn({ gateActive: false, backend: 'outage' });
        const { status, body } = await drive(handlers[MOUNTED], wireRequest);
        expect(status, JSON.stringify(body)).toBe(401);
        expect(body?.error?.code).toBe('UNAUTHENTICATED');
    });

    it('CONTROL on the wire: an active gate whose read resolves with no posture admits — the route answers for itself', async () => {
        const handlers = await mountOn({ gateActive: true, backend: 'healthy', user: CLEAR_USER });
        const { status, body } = await drive(handlers[MOUNTED], wireRequest);
        expect(status, JSON.stringify(body)).toBe(501);
        expect(body?.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('POSITIVE CONTROL on the wire: a held session is refused with the gate code', async () => {
        const handlers = await mountOn({ gateActive: true, backend: 'healthy', user: HELD_USER });
        const { status, body } = await drive(handlers[MOUNTED], wireRequest);
        expect(status, JSON.stringify(body)).toBe(403);
        expect(body?.error?.code).toBe('PASSWORD_EXPIRED');
    });
});
