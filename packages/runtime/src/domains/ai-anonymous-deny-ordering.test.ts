// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7653 — the anonymous-deny gate is consulted BEFORE `/ai/**`'s capability
 * answers, not after them.
 *
 * ## The defect
 *
 * `handleAIRequest` held the gate INSIDE its per-route loop, which is reachable
 * only once the AI service is serveable. On an open-edition boot — where
 * `@objectstack/service-ai` is absent by construction, it being a
 * Cloud/Enterprise package — the `!isServiceServeable` branch answered first,
 * so the whole family replied to unauthenticated callers: `GET /ai/agents`
 * → 200 with the console's empty-list courtesy, every other route → 501
 * carrying the Cloud/EE remedy sentence. Measured twice on the QA boot in
 * objectstack-ai/objectstack#7627, against a control on the same boot
 * (anonymous `GET /api/v1/data/showcase_task` → 401) that proves the platform
 * gate was live and this is ORDERING, not absence.
 *
 * The disclosure is two static strings, so the value here is the contract, not
 * the secret: serveability must not decide whether the gate runs. `/ai` stands
 * on the same anonymous-deny floor as `/data`, `/meta`, `/security`,
 * `/actions` and `/automation` (ADR-0056 D2 → #3963), and `domains/automation.ts`
 * already gates ahead of its own `capabilityUnavailable` for the same reason.
 *
 * ## What must NOT change, and why half these cases exist
 *
 * The honest degradation is CORRECT and was never the bug. A fix that simply
 * 401s everyone would satisfy every positive case above and still be a
 * regression, so the authenticated half is pinned just as hard:
 *
 *   - `/ai/models`, `/ai/conversations`, `/ai/usage`, `/ai/chat` → **501**
 *     (mounted-but-unimplemented — never 404, never 503) carrying
 *     `serviceUnavailableMessage('ai')` verbatim;
 *   - `/ai/agents` → the declared envelope with the payload RELOCATED under
 *     `data` (`data.agents`), not flattened to a bare array — `useAiSurfaceEnabled`
 *     reads `.agents` off it and a flatten hides the whole AI surface (#4053);
 *   - the 501 body is string-identical to what `/discovery` reports for the
 *     `ai` slot, because both sides call the one producer
 *     (`http-dispatcher.ts`'s `services.<name>.message`, and
 *     `domains/unavailable.ts` — see #4093).
 *
 * ## The control, at the level this file can hold it
 *
 * `Group C` is the unit-level form of the QA boot's `/data` control: with a
 * SERVEABLE service, an `auth: true` route still denies anonymous (the gate
 * that always worked, unchanged) while an `auth: false` route still SERVES
 * anonymous. The second case is what distinguishes "the gate was hoisted" from
 * "the gate became blanket": a registered route may legitimately open itself,
 * and only a registered route can — which is why the unserveable and
 * no-route-table exits apply the family default instead.
 */

import { describe, it, expect } from 'vitest';
import { serviceUnavailableMessage } from '@objectstack/spec/system';
import {
    ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';

import { handleAIRequest } from './ai.js';
import { apiErrorResponse } from '../error-envelope.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

/** The sentence discovery reports for the `ai` slot — the ONE producer. */
const AI_REMEDY = serviceUnavailableMessage('ai');

// ── contexts ────────────────────────────────────────────────────────────────
// Two anonymous shapes, both of which occur in the wild: `resolveExecutionContext`
// leaves `executionContext` UNDEFINED when identity resolution throws, and
// writes a `userId`-less record for a resolved-but-sessionless caller.
const anonUnresolved = () => ({ request: { headers: {} } }) as unknown as HttpProtocolContext;
const anonResolved = () => ({
    request: { headers: {} },
    executionContext: { isSystem: false, positions: [], permissions: [], systemPermissions: [] },
}) as unknown as HttpProtocolContext;
const authed = () => ({
    request: { headers: {} },
    executionContext: { userId: 'usr_1', isSystem: false, positions: [], permissions: [], systemPermissions: [] },
}) as unknown as HttpProtocolContext;
const system = () => ({
    request: { headers: {} },
    executionContext: { isSystem: true },
}) as unknown as HttpProtocolContext;

// ── deps ────────────────────────────────────────────────────────────────────

/**
 * `error` is the REAL envelope builder the dispatcher wires in
 * (`http-dispatcher.ts` → `apiErrorResponse`), not a stub that drops the third
 * argument. Without it `details.code` would never be promoted into
 * `error.code` and every `code` assertion below would be vacuous — the exact
 * way an ADR-0112 envelope test can pass while asserting nothing.
 */
function makeDeps(opts: {
    /** `undefined` → the open-edition boot: no AI service in the slot. */
    aiService?: any;
    /** `undefined` → the route table has not been published yet. */
    routes?: Array<{ method: string; path: string; auth?: boolean; handler: (req: any) => Promise<any> }>;
} = {}): DomainHandlerDeps {
    return {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) =>
            (name === 'ai' ? opts.aiService : undefined)) as any,
        getRegisteredAiRoutes: (_ctx: HttpProtocolContext) => opts.routes,
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500, details?: any) =>
            apiErrorResponse({ message, httpStatus, details }),
        routeNotFound: (route: string) => ({ status: 404, body: { success: false, error: { code: 'ROUTE_NOT_FOUND', route } } }),
        getObjectQL: () => undefined,
    } as unknown as DomainHandlerDeps;
}

function dispatch(deps: DomainHandlerDeps, context: HttpProtocolContext, subPath: string, method = 'GET') {
    return handleAIRequest(deps, subPath, method, {}, {}, context);
}

/** Assert the ADR-0112 refusal envelope: status AND code, never one alone. */
function expectAnonymousDenied(result: any) {
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(ANONYMOUS_DENY_STATUS);
    expect(result.response.status).toBe(401);
    expect(result.response.body.success).toBe(false);
    expect(result.response.body.error.code).toBe(ANONYMOUS_DENY_CODE);
    expect(result.response.body.error.code).toBe('UNAUTHENTICATED');
    expect(result.response.body.error.httpStatus).toBe(401);
    expect(result.response.body.error.message).toBe(ANONYMOUS_DENY_MESSAGE);
}

// ── Group A: the defect ─────────────────────────────────────────────────────

describe('#7653 A — an open-edition boot denies anonymous callers on the whole /ai/** family', () => {
    // The two the issue measured, by name and by number.
    it('GET /ai/models → 401, not the 501 remedy sentence', async () => {
        const result: any = await dispatch(makeDeps(), anonUnresolved(), '/ai/models');
        expectAnonymousDenied(result);
        // The precise leak: the Cloud/EE sentence must not reach an
        // unauthenticated caller, and 501 must not be the answer they get.
        expect(result.response.status).not.toBe(501);
        expect(JSON.stringify(result.response.body)).not.toContain(AI_REMEDY);
    });

    it('GET /ai/agents → 401, not the 200 empty-list courtesy', async () => {
        const result: any = await dispatch(makeDeps(), anonUnresolved(), '/ai/agents');
        expectAnonymousDenied(result);
        expect(result.response.status).not.toBe(200);
        // The courtesy body must not be served either — the console is an
        // authenticated surface, so nothing is owed here.
        expect(result.response.body.success).toBe(false);
        expect(result.response.body.data).toBeUndefined();
    });

    it('denies the resolved-but-sessionless anonymous shape identically', async () => {
        for (const path of ['/ai/models', '/ai/agents']) {
            expectAnonymousDenied(await dispatch(makeDeps(), anonResolved(), path));
        }
    });

    it('covers the rest of the family, not just the two that were measured', async () => {
        const cases: Array<[string, string]> = [
            ['/ai/conversations', 'GET'],
            ['/ai/usage', 'GET'],
            ['/ai/chat', 'POST'],
            ['/ai/status', 'GET'],
            ['/ai/tools/create_object/execute', 'POST'],
        ];
        for (const [path, method] of cases) {
            expectAnonymousDenied(await dispatch(makeDeps(), anonUnresolved(), path, method));
        }
    });
});

// ── Group B: the honest degradation — LOAD-BEARING, must stay green ─────────

describe('#7653 B — the honest degradation is untouched for an authenticated caller', () => {
    it('501s /ai/models, /conversations, /usage and /chat with the remedy sentence', async () => {
        const cases: Array<[string, string]> = [
            ['/ai/models', 'GET'],
            ['/ai/conversations', 'GET'],
            ['/ai/usage', 'GET'],
            ['/ai/chat', 'POST'],
        ];
        for (const [path, method] of cases) {
            const result: any = await dispatch(makeDeps(), authed(), path, method);
            expect(result.handled).toBe(true);
            // Mounted-but-unimplemented. NOT 404 (the route IS mounted) and
            // NOT 503 (retrying does not install a Cloud package).
            expect(result.response.status).toBe(501);
            expect(result.response.status).not.toBe(404);
            expect(result.response.status).not.toBe(503);
            expect(result.response.body.error.message).toBe(AI_REMEDY);
            expect(result.response.body.error.httpStatus).toBe(501);
        }
    });

    it('serves /ai/agents as the declared envelope with the payload relocated under data', async () => {
        const result: any = await dispatch(makeDeps(), authed(), '/ai/agents');
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: { agents: [] } });
        // A RELOCATION, not a flatten: `unwrapResponse` returns `data`, and
        // `client.ai.agents.list()` reads `.agents` off it. `data: []` would
        // make `.agents` undefined, which `useAiSurfaceEnabled` reads as "hide
        // the entire AI surface" (#4053).
        expect(Array.isArray(result.response.body.data)).toBe(false);
        expect(result.response.body.data.agents).toEqual([]);
    });

    it("keeps the 501 body string-identical to /discovery's services.ai message", async () => {
        // Both sides call the one producer — `serviceUnavailableMessage`
        // (`domains/unavailable.ts` here, `services.<name>.message` in
        // `http-dispatcher.ts`) — so they cannot drift into naming different
        // remedies. Pinned as an exact string, not a substring.
        const result: any = await dispatch(makeDeps(), authed(), '/ai/models');
        expect(result.response.body.error.message).toBe(serviceUnavailableMessage('ai'));
        expect(result.response.body.error.message).toBe(
            'Provided by @objectstack/service-ai in ObjectStack Cloud/Enterprise'
            + ' — no implementation ships in the open framework',
        );
    });

    it('lets an internal SYSTEM context through to the same degradation answers', async () => {
        // `isSystem` is never settable from the wire; a host dispatching
        // internally must not be caught by a caller-facing gate.
        const models: any = await dispatch(makeDeps(), system(), '/ai/models');
        expect(models.response.status).toBe(501);
        expect(models.response.body.error.message).toBe(AI_REMEDY);
        const agents: any = await dispatch(makeDeps(), system(), '/ai/agents');
        expect(agents.response.body).toEqual({ success: true, data: { agents: [] } });
    });
});

// ── Group C: the control — hoisted, not made blanket ────────────────────────

describe('#7653 C — a serveable service keeps the per-route auth contract', () => {
    const served = { chat: async () => ({ text: 'ok' }) };
    const okRoute = (path: string, auth?: boolean) => ({
        method: 'GET',
        path,
        ...(auth === undefined ? {} : { auth }),
        handler: async () => ({ status: 200, body: { success: true, data: { served: true } } }),
    });

    it('still denies anonymous on an auth: true route (the gate that always worked)', async () => {
        const deps = makeDeps({ aiService: served, routes: [okRoute('/api/v1/ai/status', true)] });
        expectAnonymousDenied(await dispatch(deps, anonUnresolved(), '/ai/status'));
    });

    it('still SERVES anonymous on a route that declares auth: false', async () => {
        // The opt-out is the reason the family-wide decision is consulted here
        // rather than short-circuiting at the top of the handler. A fix that
        // 401s every anonymous caller passes all of Group A and fails this.
        const deps = makeDeps({ aiService: served, routes: [okRoute('/api/v1/ai/public', false)] });
        const result: any = await dispatch(deps, anonUnresolved(), '/ai/public');
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: { served: true } });
    });

    it('serves an authenticated caller on an auth: true route', async () => {
        const deps = makeDeps({ aiService: served, routes: [okRoute('/api/v1/ai/status', true)] });
        const result: any = await dispatch(deps, authed(), '/ai/status');
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: { served: true } });
    });
});

// ── Group D: the boot-race exit ─────────────────────────────────────────────

describe('#7653 D — the unpublished-route-table exit takes the gate first too', () => {
    const served = { chat: async () => ({ text: 'ok' }) };

    it('denies anonymous rather than answering "AI routes not yet initialized"', async () => {
        // Same shape as the unserveable exit: with no route table there is no
        // route to declare `auth: false`, so the family default applies. The
        // 503 is itself a disclosure that AI is mounted here.
        const result: any = await dispatch(makeDeps({ aiService: served }), anonUnresolved(), '/ai/models');
        expectAnonymousDenied(result);
        expect(result.response.status).not.toBe(503);
    });

    it('still tells an authenticated caller the routes are not initialized', async () => {
        const result: any = await dispatch(makeDeps({ aiService: served }), authed(), '/ai/models');
        expect(result.response.status).toBe(503);
        expect(result.response.body.error.message).toBe('AI service routes not yet initialized');
    });
});
