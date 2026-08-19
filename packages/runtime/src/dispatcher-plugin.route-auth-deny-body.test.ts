// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #9823 — the `mountRouteOnServer` 401 arm answers the SHARED flat deny body,
 * `code` key included.
 *
 * Which path this pins, re-derived rather than assumed:
 * `dispatcher-plugin.endpoint-fallback.integration.test.ts` asserts a NESTED
 * `body.error.code` — that is the http-dispatcher wildcard path (`/ai/*` via
 * `dispatch()`), a different 401 producer answering the WRAPPED envelope
 * family. THIS file pins the concrete hook-route mounts (`RouteDefinition[]`
 * emitted via `ai:routes`, recovered here through the `__aiRoutes` cache),
 * whose 401 arm writes the FLAT family. The arm is live on the wire, not just
 * in principle: `registerAIRoutes` mounts wildcards for get/post/delete/put
 * only, so a PATCH route under `/ai/*` — a legal `RouteDefinition.method` —
 * reaches these concrete mounts unshadowed, as does any emitted path outside
 * `/ai/*`.
 *
 * Until #9823 the arm wrote an inline `{ error, message }` copy of
 * `ANONYMOUS_DENY_BODY`, which is exactly why #9487's additive `code` key
 * (maintainer-ruled: additive only, no key removed or moved) never reached
 * it. The exact-body pin below spells every key literally — deliberately NOT
 * via the constant — so this seam can neither drift from the constant again
 * nor change envelope family unnoticed; whether the flat family survives at
 * all stays ADR-0112 D5 territory (#9559) and is not settled here.
 */

import { describe, it, expect, vi } from 'vitest';
import { ANONYMOUS_DENY_BODY, ANONYMOUS_DENY_STATUS } from '@objectstack/core';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const ROUTE_PATH = '/ai/agents/:name';
const MOUNTED = `PATCH /api/v1${ROUTE_PATH}`;

function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => {
        handlers[`${verb} ${path}`] = handler;
    };
    return {
        handlers,
        server: {
            get: rec('GET'),
            post: rec('POST'),
            put: rec('PUT'),
            delete: rec('DELETE'),
            patch: rec('PATCH'),
        },
    };
}

/**
 * `session === undefined` is the anonymous caller — `resolveSessionData`
 * forwards whatever `auth.api.getSession` answers, and every failure mode of
 * that lookup resolves to `undefined` too, so this is the exact input the 401
 * arm keys off.
 */
function makeCtx(fakeServer: any, route: Record<string, unknown>, routeHandler: (req: any) => Promise<any>, session?: any) {
    const kernel: any = {
        getService: () => undefined,
        getServiceAsync: async () => undefined,
        // The AIServicePlugin's cross-plugin cache the dispatcher recovers
        // routes from when the `ai:routes` hook fired before it was listening.
        __aiRoutes: [{ ...route, handler: routeHandler }],
    };
    const authService: any = { api: { getSession: async () => session } };
    return {
        getKernel: () => kernel,
        getService: (name: string) =>
            name === 'http.server' ? fakeServer.server : name === 'auth' ? authService : undefined,
        environmentId: undefined,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        hook: () => {},
        on: () => {},
    } as any;
}

function recordingRes() {
    const rec: { status?: number; body?: unknown; headers: Record<string, string>; ended: boolean } = {
        headers: {},
        ended: false,
    };
    const res: any = {
        status(code: number) {
            rec.status = code;
            return res;
        },
        header(k: string, v: string) {
            rec.headers[k] = v;
            return res;
        },
        json(body: unknown) {
            rec.body = body;
            return res;
        },
        end() {
            rec.ended = true;
            return res;
        },
    };
    return { rec, res };
}

async function mountAndCall(route: Record<string, unknown>, session?: any) {
    const fakeServer = makeFakeServer();
    const routeHandler = vi.fn(async () => ({ status: 200, body: { ok: true } }));
    const ctx = makeCtx(fakeServer, route, routeHandler, session);
    const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
    await plugin.start?.(ctx);

    const handler = fakeServer.handlers[MOUNTED];
    expect(handler).toBeTypeOf('function');
    const { rec, res } = recordingRes();
    await handler({ headers: {}, body: {}, params: { name: 'support_bot' }, query: {} }, res);
    return { rec, routeHandler };
}

const AUTH_ROUTE = { method: 'PATCH', path: ROUTE_PATH, description: 'pin', auth: true };

describe('#9823 — mountRouteOnServer 401 arm: the flat deny body carries the code key', () => {
    it('anonymous caller → 401 with the EXACT flat body — error, code and message, spelled literally', async () => {
        const { rec, routeHandler } = await mountAndCall(AUTH_ROUTE);

        expect(rec.status).toBe(401);
        // The pin: every key, literal. `code` is the #9487 maintainer-ruled
        // additive key ("one documented key identifies the machine code on
        // every error family, 401 included"); `error` keeps carrying the same
        // code value it always has, so no existing reader breaks.
        expect(rec.body).toEqual({
            error: 'UNAUTHENTICATED',
            code: 'UNAUTHENTICATED',
            message: 'Authentication is required to access this endpoint.',
        });
        // The refusal is a refusal: the route handler never ran.
        expect(routeHandler).not.toHaveBeenCalled();
    });

    it('…and that exact body IS the shared constant — the seam no longer owns an inline copy', async () => {
        const { rec } = await mountAndCall(AUTH_ROUTE);

        expect(rec.status).toBe(ANONYMOUS_DENY_STATUS);
        expect(rec.body).toEqual(ANONYMOUS_DENY_BODY);
    });

    it('the same request with a session is served — the deny targets anonymity, not the route', async () => {
        const { rec, routeHandler } = await mountAndCall(AUTH_ROUTE, {
            user: { id: 'usr_1', email: 'u1@example.com' },
            session: {},
        });

        expect(rec.status).toBe(200);
        expect(rec.body).toEqual({ ok: true });
        expect(routeHandler).toHaveBeenCalledTimes(1);
    });

    it('a route declaring auth: false stays open to anonymous callers — it opts out by declaration', async () => {
        const { rec, routeHandler } = await mountAndCall({ ...AUTH_ROUTE, auth: false });

        expect(rec.status).toBe(200);
        expect(routeHandler).toHaveBeenCalledTimes(1);
    });
});
