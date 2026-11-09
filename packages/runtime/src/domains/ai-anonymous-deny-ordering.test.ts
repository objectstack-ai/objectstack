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

import { describe, it, expect, afterEach } from 'vitest';
import { serviceUnavailableMessage } from '@objectstack/spec/system';
import {
    ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';

// Group F drives the real `HttpDispatcher`, whose reach loads
// `@objectstack/metadata` lazily; pay that load during collection, never
// inside a case's clocked window (`pnpm check:test-source-alias`).
import '@objectstack/metadata';
import { ObjectKernel } from '@objectstack/core';
import type { Plugin } from '@objectstack/core';

import { handleAIRequest } from './ai.js';
import { HttpDispatcher } from '../http-dispatcher.js';
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
    /**
     * Whether the request kernel has passed `kernel:ready` (#31905). Absent →
     * `false`: still booting, so a missing table is the boot-race window.
     */
    kernelReady?: boolean;
    /** Counts the reads of the kernel-phase seam. */
    onKernelReadyRead?: () => void;
} = {}): DomainHandlerDeps {
    return {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) =>
            (name === 'ai' ? opts.aiService : undefined)) as any,
        getRegisteredAiRoutes: (_ctx: HttpProtocolContext) => opts.routes,
        isRequestKernelReady: (_ctx: HttpProtocolContext) => {
            opts.onKernelReadyRead?.();
            return opts.kernelReady === true;
        },
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
            'Provided by @objectstack/service-ai in ObjectOS Cloud/Enterprise'
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

// ── Group E: a route table that will never be published ─────────────────────

/**
 * #31905 — a serveable AI service whose route table is never published (an
 * unlicensed Enterprise image registers the service with route registration
 * off). Before, the `!routes` exit answered 503 "not yet initialized" for the
 * life of the process, telling every client to retry. Once the request
 * kernel has passed `kernel:ready` the absence is final, and the answer is the
 * unserveable exit's, byte for byte. Before that, the 503 stands (Group D is
 * the control, with the seam answering `false`).
 */
describe('#31905 E — past kernel:ready, an unpublished route table answers as the unserveable exit', () => {
    const served = { chat: async () => ({ text: 'ok' }) };
    const offDeps = (extra: { onKernelReadyRead?: () => void } = {}) =>
        makeDeps({ aiService: served, kernelReady: true, ...extra });

    it('serves GET /ai/agents the empty catalog, identical to the unserveable exit', async () => {
        const result: any = await dispatch(offDeps(), authed(), '/ai/agents');
        const unserveable: any = await dispatch(makeDeps(), authed(), '/ai/agents');
        expect(result.handled).toBe(true);
        expect(result.response.status).toBe(200);
        expect(result.response.body).toEqual({ success: true, data: { agents: [] } });
        expect(result).toEqual(unserveable);
    });

    it('answers every other /ai/* route 501 with the remedy sentence, identical to the unserveable exit', async () => {
        const cases: Array<[string, string]> = [
            ['/ai/models', 'GET'],
            ['/ai/conversations', 'GET'],
            ['/ai/usage', 'GET'],
            ['/ai/status', 'GET'],
            ['/ai/chat', 'POST'],
            ['/ai/agents', 'POST'],
        ];
        for (const [path, method] of cases) {
            const result: any = await dispatch(offDeps(), authed(), path, method);
            const unserveable: any = await dispatch(makeDeps(), authed(), path, method);
            expect(result.handled).toBe(true);
            expect(result.response.status).toBe(501);
            expect(result.response.status).not.toBe(503);
            expect(result.response.body.error.message).toBe(AI_REMEDY);
            expect(result.response.body.error.httpStatus).toBe(501);
            expect(result).toEqual(unserveable);
        }
    });

    it('lets an internal SYSTEM context through to the same answers', async () => {
        const agents: any = await dispatch(offDeps(), system(), '/ai/agents');
        expect(agents.response.body).toEqual({ success: true, data: { agents: [] } });
        const models: any = await dispatch(offDeps(), system(), '/ai/models');
        expect(models.response.status).toBe(501);
    });

    it('refuses anonymous callers first, without reading the kernel phase', async () => {
        let reads = 0;
        const deps = offDeps({ onKernelReadyRead: () => { reads++; } });
        for (const ctx of [anonUnresolved(), anonResolved()]) {
            for (const path of ['/ai/agents', '/ai/models']) {
                const result: any = await dispatch(deps, ctx, path);
                expectAnonymousDenied(result);
                expect(result.response.body.data).toBeUndefined();
            }
        }
        expect(reads).toBe(0);
    });

    it('CONTROL: before kernel:ready the same state keeps the 503', async () => {
        let reads = 0;
        const deps = makeDeps({ aiService: served, kernelReady: false, onKernelReadyRead: () => { reads++; } });
        for (const path of ['/ai/agents', '/ai/models']) {
            const result: any = await dispatch(deps, authed(), path);
            expect(result.response.status).toBe(503);
            expect(result.response.body.error.message).toBe('AI service routes not yet initialized');
        }
        expect(reads).toBe(2);
    });

    it('CONTROL: a deps that does not carry the kernel-phase seam keeps the 503', async () => {
        // The seam is OPTIONAL on the exported DomainHandlerDeps, so a host's
        // own deps written before it existed still compiles; its absence must
        // read as "not ready", never as "AI off".
        const deps = makeDeps({ aiService: served, kernelReady: true });
        delete (deps as { isRequestKernelReady?: unknown }).isRequestKernelReady;
        expect('isRequestKernelReady' in deps).toBe(false);
        for (const path of ['/ai/agents', '/ai/models']) {
            const result: any = await dispatch(deps, authed(), path);
            expect(result.response.status).toBe(503);
            expect(result.response.body.error.message).toBe('AI service routes not yet initialized');
        }
    });

    it('CONTROL: a published route table is served past kernel:ready, never answered as off', async () => {
        const deps = makeDeps({
            aiService: served,
            kernelReady: true,
            routes: [{
                method: 'GET', path: '/api/v1/ai/agents', auth: true,
                handler: async () => ({ status: 200, body: { success: true, data: { agents: [{ name: 'a1' }] } } }),
            }],
        });
        const result: any = await dispatch(deps, authed(), '/ai/agents');
        expect(result.response.status).toBe(200);
        expect(result.response.body.data.agents).toEqual([{ name: 'a1' }]);
    });
});

// ── Group F: the kernel phase, read off a real kernel ───────────────────────

/**
 * #31905 — the same arms through the real seam: `HttpDispatcher.handleAI`
 * reading `hasBootPhaseSettled('kernel:ready')` off the request's kernel, on a
 * real `ObjectKernel`. Every read the boot can still contradict must keep the
 * 503: from a plugin's `start()`, from a `kernel:ready` handler, under
 * withheld boot-phase hooks, and on a kernel that has no reader at all.
 */
describe('#31905 F — the kernel phase is read off the request kernel', () => {
    const kernels: ObjectKernel[] = [];
    const newKernel = (bootPhaseHooks?: boolean) => {
        const k = new ObjectKernel({
            logger: { level: 'error' },
            gracefulShutdown: false,
            skipSystemValidation: true,
            ...(bootPhaseHooks === undefined ? {} : { bootPhaseHooks }),
        });
        kernels.push(k);
        return k;
    };
    afterEach(async () => {
        for (const k of kernels.splice(0)) {
            if (k.isRunning()) await k.shutdown();
        }
    });

    const servedAi = { chat: async () => ({ text: 'ok' }) };
    /** Registers a serveable `ai` service; publishes `__aiRoutes` in start() only when asked. */
    const aiProvider = (publish?: unknown[]): Plugin => ({
        name: 'test.ai-provider',
        version: '1.0.0',
        init: async (ctx) => { ctx.registerService('ai', servedAi); },
        start: async (ctx) => { if (publish) (ctx.getKernel() as any).__aiRoutes = publish; },
    });
    const statusOf = async (kernel: unknown, path = '/ai/models', context: any = authed()) => {
        const r: any = await new HttpDispatcher(kernel as any).handleAI(path, 'GET', undefined, undefined, context);
        return r.response?.status;
    };

    it('keeps the 503 for every read taken while the boot can still publish, and answers off once ready settled', async () => {
        const seen: Record<string, number[]> = {};
        const take = async (at: string, kernel: unknown) => { (seen[at] ??= []).push(await statusOf(kernel)); };
        const probe: Plugin = {
            name: 'test.probe',
            version: '1.0.0',
            dependencies: ['test.ai-provider'],
            init: async (ctx) => {
                ctx.hook('kernel:ready', async () => { await take('kernel:ready', ctx.getKernel()); });
                ctx.hook('kernel:bootstrapped', async () => { await take('kernel:bootstrapped', ctx.getKernel()); });
            },
            start: async (ctx) => { await take('start', ctx.getKernel()); },
        };
        const kernel = newKernel();
        await kernel.use(aiProvider());
        await kernel.use(probe);
        await kernel.bootstrap();

        expect(seen).toEqual({ start: [503], 'kernel:ready': [503], 'kernel:bootstrapped': [501] });
        expect(await statusOf(kernel)).toBe(501);
        const agents: any = await new HttpDispatcher(kernel as any).handleAI('/ai/agents', 'GET', undefined, undefined, authed());
        expect(agents.response.status).toBe(200);
        expect(agents.response.body).toEqual({ success: true, data: { agents: [] } });
        // The gate still goes first on the off arm.
        expect(await statusOf(kernel, '/ai/agents', anonUnresolved())).toBe(401);
    });

    it('CONTROL: a kernel bootstrapped with boot-phase hooks withheld keeps the 503', async () => {
        const kernel = newKernel(false);
        await kernel.use(aiProvider());
        await kernel.bootstrap();
        expect(kernel.isRunning()).toBe(true);
        expect(await statusOf(kernel)).toBe(503);
        expect(await statusOf(kernel, '/ai/agents')).toBe(503);
    });

    it('CONTROL: a kernel that carries no phase reader keeps the 503', async () => {
        const readerless = {
            context: { getService: (name: string) => (name === 'ai' ? servedAi : null) },
        };
        expect(await statusOf(readerless)).toBe(503);
        expect(await statusOf(readerless, '/ai/agents')).toBe(503);
    });

    it('CONTROL: a table the provider publishes in start() is still served after ready', async () => {
        const kernel = newKernel();
        await kernel.use(aiProvider([{
            method: 'GET', path: '/api/v1/ai/models', auth: true,
            handler: async () => ({ status: 200, body: { success: true, data: { models: ['m1'] } } }),
        }]));
        await kernel.bootstrap();
        expect(await statusOf(kernel)).toBe(200);
    });

    it('reads the phase off the request kernel, not the host kernel', async () => {
        const booting = newKernel(false);
        await booting.use(aiProvider());
        await booting.bootstrap();
        const ready = newKernel();
        await ready.use(aiProvider());
        await ready.bootstrap();

        const onReady = { ...authed(), kernel: ready };
        const onBooting = { ...authed(), kernel: booting };
        expect(await statusOf(booting, '/ai/models', onReady)).toBe(501);
        expect(await statusOf(ready, '/ai/models', onBooting)).toBe(503);
    });
});
