// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#15910 — maintainer ruling 2026-09-06, decision batch #57, option C, 「同意」]
 *
 * > Carve liveness out of the identity step. `/health` (liveness) answers 200
 * > whenever the process can serve HTTP, regardless of configuration faults;
 * > `/ready` (readiness) keeps returning 503 for the identity/configuration
 * > fault so traffic is withheld until the fault is fixed. A configuration
 * > fault must never restart a pod that cannot be fixed by restarting.
 *
 * ## The behaviour this pins, and why one-sided assertions do not discriminate
 *
 * #15909 (merged) made the identity step re-raise the ONE fault that must stay
 * loud: a `tenancy` service that is registered and FAILED TO BUILD is no longer
 * absorbed into "there is no posture". `HttpDispatcher.resolveRequestScope`
 * reads that posture for EVERY request, credentialed or not, and ran before any
 * domain handler — so an uncredentialed `GET /health` went 200 → 503 for the
 * duration of the outage. A liveness probe reads 503 as "restart me"; the
 * tenancy service then fails to build again; and the restart loop hides the
 * fault it was made loud to expose.
 *
 * The ruling does not soften the 503 — it moves it off the one route whose
 * consumer answers by killing the process. So the acceptance shape is a PAIR,
 * asserted together against ONE forced fault: `/health` 200 **and** `/ready`
 * 503 simultaneously. Either half alone passes on a tree that is still wrong —
 * `/health` 200 alone is satisfied by deleting the re-raise outright, `/ready`
 * 503 alone is satisfied by `origin/main`.
 *
 * And a 503 on `/ready` is not self-describing: the readiness handler has a 503
 * of its own ("Service not ready", while the kernel is not `running`). The
 * legs below therefore assert which 503 it is — the identity step's, or the
 * handler's — so "readiness keeps the full identity step and its 503 body
 * unchanged" is measured rather than assumed.
 *
 * ## The anti-drift half of the ruling
 *
 * "Which routes are liveness" is DERIVED from the dispatcher's own route table
 * (`DomainHandlerRegistry.resolveLiveness` = `resolve` + one field read), never
 * written down again as a list of paths. `§3` pins that by registering a NEW
 * liveness route through the public seam and driving it through the same fault:
 * a hard-coded `'/health'` test in `dispatch()` would fail there while every
 * other leg in this file stayed green.
 */

import { describe, it, expect } from 'vitest';

import { ObjectKernel } from '@objectstack/core';
import { ApiErrorSchema, BaseResponseSchema } from '@objectstack/spec/api';

import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { DomainHandlerRegistry } from './domain-handler-registry.js';

/**
 * A REAL kernel, as the host hands it to the dispatcher — so the rejection under
 * test is the service registry's own (branded on "never registered", UNBRANDED
 * on "registered and could not be built"), not a stub's imitation of one.
 *
 * `gracefulShutdown: false` — a fixture kernel must not hook the test runner's
 * process signals.
 */
function kernelWith(tenancy: 'failed' | 'healthy'): ObjectKernel {
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    kernel.registerService('objectql', { find: async () => [] });
    if (tenancy === 'healthy') {
        kernel.registerService('tenancy', { posture: 'isolated' });
    } else {
        // The REAL failure class the ruling is about: a service that IS
        // registered and throws while being built.
        kernel.registerServiceFactory('tenancy', () => {
            throw new Error('tenancy backend unavailable');
        });
    }
    return kernel;
}

const kernelWithFailedTenancy = () => kernelWith('failed');
const kernelWithHealthyTenancy = () => kernelWith('healthy');

/** A fake `IHttpServer` recording the handlers the dispatcher plugin mounts. */
function makeFakeServer() {
    const handlers: Record<string, (req: any, res: any) => any> = {};
    const rec = (verb: string) => (path: string, handler: any) => { handlers[`${verb} ${path}`] = handler; };
    return {
        handlers,
        server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
    };
}

async function mountOn(kernel: ObjectKernel) {
    const { server, handlers } = makeFakeServer();
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

const HEALTH = 'GET /api/v1/health';
const READY = 'GET /api/v1/ready';

/** What an orchestrator's probe sends: no credential, no query. */
const anonymous = { headers: {}, query: {} };

/** Settle to the rejection, or to `undefined` when the call RESOLVED. */
const rejectionOf = (p: Promise<unknown>) => p.then(() => undefined, (e) => e);

// ---------------------------------------------------------------------------
// §1 — the ruling's acceptance test: ONE fault, BOTH probes, asserted together
// ---------------------------------------------------------------------------

describe('[#15910] a forced identity fault: `/health` 200 and `/ready` 503, simultaneously', () => {
    it('THE PAIR: on ONE kernel with a registered-and-failing `tenancy`, the uncredentialed probes answer 200 / 503', async () => {
        // SUPERSEDED PIN, quoted — what origin/main answered on this wiring
        // (measured by reverting the carve-out on this branch):
        //     expect({ health: 503, ready: 503 })
        // i.e. the liveness probe told the orchestrator to restart a pod whose
        // fault no restart can fix.
        const handlers = await mountOn(kernelWithFailedTenancy());

        const health = await drive(handlers[HEALTH], anonymous);
        const ready = await drive(handlers[READY], anonymous);

        // Asserted as ONE object on purpose: a tree that fixed only the
        // liveness side, or only the readiness side, cannot satisfy this line.
        expect({ health: health.status, ready: ready.status }).toEqual({ health: 200, ready: 503 });
    });

    it('the 200 is the real liveness PAYLOAD, not an empty body that happens to carry a 200', async () => {
        const handlers = await mountOn(kernelWithFailedTenancy());
        const { status, body } = await drive(handlers[HEALTH], anonymous);
        expect(status).toBe(200);
        expect(BaseResponseSchema.safeParse(body).success).toBe(true);
        expect(body?.success).toBe(true);
        expect(body?.data?.status).toBe('ok');
        // Process-local signals only — the ruling's first execution note. The
        // whole payload is answerable without reading configuration.
        expect(typeof body?.data?.uptime).toBe('number');
        expect(typeof body?.data?.timestamp).toBe('string');
    });

    it('READINESS IS UNCHANGED: the 503 is the identity step\'s own envelope, not the handler\'s "Service not ready"', async () => {
        const handlers = await mountOn(kernelWithFailedTenancy());
        const { status, body } = await drive(handlers[READY], anonymous);
        expect(status).toBe(503);
        expect(BaseResponseSchema.safeParse(body).success).toBe(true);
        expect(body?.success).toBe(false);
        const parsed = ApiErrorSchema.safeParse(body?.error);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
        // WHICH 503 this is: the identity step raised before the readiness
        // handler ever ran, so the body carries the outage envelope (a 5xx whose
        // producer declared it, hence the withheld message) and NOT the
        // handler's own verdict, which names its message and its kernel state.
        expect(body?.error?.message).toBe('Internal server error');
        expect(body?.error?.details).toBeUndefined();
    });

    it('CONTROL — healthy `tenancy`, same wiring: `/health` still 200, and `/ready` now answers from its own HANDLER', async () => {
        // Without this leg the previous one proves nothing: an unstarted fixture
        // kernel is `idle`, so `/ready` has a 503 of its own. Here the identity
        // step passes, the handler runs, and its verdict is visibly a DIFFERENT
        // 503 — which is what makes the fault leg's envelope evidence.
        const handlers = await mountOn(kernelWithHealthyTenancy());

        const health = await drive(handlers[HEALTH], anonymous);
        expect(health.status).toBe(200);

        const ready = await drive(handlers[READY], anonymous);
        expect(ready.status).toBe(503);
        expect(ready.body?.error?.message).toBe('Service not ready');
        expect((ready.body?.error?.details as any)?.state).toBe('idle');
    });
});

// ---------------------------------------------------------------------------
// §2 — the carve-out is ROUTE-SCOPED: nothing else stopped being loud
// ---------------------------------------------------------------------------

describe('[#15910] the re-raise is unchanged everywhere except the declared liveness route', () => {
    it('`/data/task` still raises the outage out of `dispatch()` — #15909 is not softened', async () => {
        const err: any = await rejectionOf(
            new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false })
                .dispatch('GET', '/data/task', undefined, {}, { request: { headers: {} } } as any),
        );
        expect(err, '`dispatch()` RESOLVED — the outage was absorbed').toBeDefined();
        expect(err.status).toBe(503);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('`GET /health` resolves through `dispatch()` without the identity step even under the fault', async () => {
        const result = await new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false })
            .dispatch('GET', '/health', undefined, {}, { request: { headers: {} } } as any);
        expect(result.handled).toBe(true);
        expect(result.response?.status).toBe(200);
        // The carve-out runs the handler INSTEAD of the preamble, so nothing
        // resolved a per-request kernel onto this context. Asserted rather than
        // assumed: it is the observable difference between "the identity step
        // ran and forgave the fault" and "the identity step did not run".
        const context: any = { request: { headers: {} } };
        await new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false })
            .dispatch('GET', '/health', undefined, {}, context);
        expect(context.executionContext).toBeUndefined();
        expect(context.kernel).toBeUndefined();
    });

    it('`POST /health` is not liveness — the method restriction on the route governs the carve-out too', async () => {
        // The route declares `methods: ['GET']`, so nothing claims POST and the
        // request takes the ordinary path — which under this fault is the loud
        // one. A carve-out matching on the path alone would answer 200 here.
        const err: any = await rejectionOf(
            new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false })
                .dispatch('POST', '/health', undefined, {}, { request: { headers: {} } } as any),
        );
        expect(err?.status).toBe(503);
    });

    it('the environment-scoped `/environments/:id/health` keeps today\'s behaviour — it is not a wired probe surface', async () => {
        // The carve-out sits above the scoped-URL strip deliberately: a scoped
        // health URL still resolves its environment and runs both gates, exactly
        // as it did before this change.
        const err: any = await rejectionOf(
            new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false })
                .dispatch('GET', '/environments/env_alpha/health', undefined, {}, { request: { headers: {} } } as any),
        );
        expect(err?.status).toBe(503);
    });
});

// ---------------------------------------------------------------------------
// §3 — the liveness set is DERIVED from the route table, never a second list
// ---------------------------------------------------------------------------

describe('[#15910] "which routes are liveness" is a projection of the route table', () => {
    it('a NEW liveness route registered through the public seam is carved out too — no path is hard-coded', async () => {
        // The load-bearing leg of the anti-drift constraint. If `dispatch()`
        // tested for `'/health'` instead of reading the route's own declaration,
        // this is the only test in the file that would fail.
        const dispatcher = new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false });
        dispatcher.registerDomainHandler({
            prefix: '/probe', match: 'exact', methods: ['GET'], liveness: true,
            handler: async () => ({ handled: true, response: { status: 200, body: { success: true, data: { status: 'ok' } } } }),
        });
        const result = await dispatcher.dispatch('GET', '/probe', undefined, {}, { request: { headers: {} } } as any);
        expect(result.response?.status).toBe(200);
    });

    it('a route registered WITHOUT the declaration is not carved out — opting in is the only way in', async () => {
        const dispatcher = new HttpDispatcher(kernelWithFailedTenancy(), undefined, { enforceProjectMembership: false });
        dispatcher.registerDomainHandler({
            prefix: '/not-a-probe', match: 'exact', methods: ['GET'],
            handler: async () => ({ handled: true, response: { status: 200, body: { success: true } } }),
        });
        const err: any = await rejectionOf(
            dispatcher.dispatch('GET', '/not-a-probe', undefined, {}, { request: { headers: {} } } as any),
        );
        expect(err?.status).toBe(503);
    });

    it('`resolveLiveness` inherits `resolve`\'s matcher and its first-match-wins order', async () => {
        const registry = new DomainHandlerRegistry();
        const handler = async () => ({ handled: true, response: { status: 200, body: {} } });
        registry.register({ prefix: '/live', match: 'exact', methods: ['GET'], liveness: true, handler });
        registry.register({ prefix: '/plain', match: 'exact', methods: ['GET'], handler });

        expect(registry.resolveLiveness('/live', 'GET')).toBeDefined();
        // Same matcher: an exact route does not claim a deeper path, and a
        // method the route excludes reaches nothing at all.
        expect(registry.resolveLiveness('/live/deep', 'GET')).toBeUndefined();
        expect(registry.resolveLiveness('/live', 'POST')).toBeUndefined();
        // A registered route with no declaration is not liveness.
        expect(registry.resolveLiveness('/plain', 'GET')).toBeUndefined();
    });

    it('a non-liveness route registered EARLIER shadows here exactly as it shadows in `resolve`', async () => {
        // The set can never disagree with the matcher about which route a path
        // reaches: `resolveLiveness` asks `resolve` first and only then reads
        // the field, so it cannot certify a route the request would not get.
        const registry = new DomainHandlerRegistry();
        const handler = async () => ({ handled: true, response: { status: 200, body: {} } });
        registry.register({ prefix: '/x', match: 'prefix', handler });
        registry.register({ prefix: '/x', match: 'exact', methods: ['GET'], liveness: true, handler });

        expect(registry.resolve('/x', 'GET')?.liveness).toBeUndefined();
        expect(registry.resolveLiveness('/x', 'GET')).toBeUndefined();
    });
});
