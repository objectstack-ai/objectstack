// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declarative-endpoint fallback on a MULTI-TENANT host (#5040 E5b, #5399).
 *
 * ## The branch this file exists for
 *
 * `dispatcher-plugin.ts`'s `setFallbackHandler` asks the host's resolver to
 * place each request in an environment BEFORE it probes `matchEndpoint`. When
 * that placement fails on a multi-tenant host it DECLINES — writes nothing, so
 * the transport's own 404 stands — and warns. Serving it from the default
 * kernel instead would answer one tenant's URL out of another tenant's data.
 *
 * Until #5399 that branch had zero test references anywhere in the repo, for a
 * structural reason rather than an oversight: the `kernel-resolver` PROVIDER
 * ships in the cloud distribution, so this repo holds only consumers and no
 * real boot here ever resolves a second environment. A stub resolver is the
 * only way to reach it — the same posture
 * `http-dispatcher.multi-tenant-concurrency.test.ts` (#5155) takes, moved up a
 * layer: that file drives `HttpDispatcher` directly, this one drives the
 * composed plugin over a real socket, because the branch under test lives in
 * the plugin's fallback closure and not in the dispatcher at all.
 *
 * ## Why a real boot rather than calling the closure
 *
 * The handler is a closure created inside `start()`; no seam hands it to a
 * caller. Reaching it any other way would mean re-implementing the
 * composition, which is the shortcut ADR-0076's "who serves this path" note
 * (and #4073, answered wrongly three times) says not to take.
 *
 * ## The topology, and why the HOST also declares the endpoint
 *
 * Every kernel here — the two tenants AND the host — carries a `metadata` slot
 * declaring the same path, and an `automation` slot tagged with its owner. The
 * host's copy is what gives the decline branch something to prevent: a request
 * that cannot be placed keeps `context.kernel` as the DEFAULT kernel, so
 * without the branch the fallback would probe the host's declaration, match it,
 * and answer 200 out of the host — one tenant's URL served from another
 * kernel's data.
 *
 * That second copy is not decoration; it is the difference between a test and a
 * tautology. The first draft of this file declared the endpoint on the tenants
 * only, and reverse-verification (branch deleted, suite re-run) showed the
 * decline cases stayed GREEN: with nothing declared on the host the step simply
 * declined again for an unrelated reason — no `metadata` slot on the request's
 * kernel — so the 404 and the never-probed assertions proved nothing, and only
 * the `warn` moved. The topology below is the one in which every assertion
 * moves.
 *
 * Service resolution reaches those copies by two different routes, which is
 * also why both cases are meaningful:
 *
 *  - `metadata` is resolved WITH the environment id. The host-scoped lookup it
 *    tries first answers nothing on a LiteKernel (no scoped factory is
 *    registered, unlike the cloud host this models), so it falls through to the
 *    request's own kernel — the tenant's copy on a placed request, the host's
 *    copy on an unplaced one.
 *  - `automation` is resolved WITHOUT one and reads `context.kernel` directly.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { LiteKernel, Plugin, PluginContext } from '@objectstack/core';
import { HonoServerPlugin } from '@objectstack/plugin-hono-server';
import { ApiEndpointSchema, type ApiEndpoint } from '@objectstack/spec/api';
import type { ApiEndpointMatch, IHttpServer } from '@objectstack/spec/contracts';

import { createDispatcherPlugin } from './dispatcher-plugin.js';

const PATH = '/api/v1/apps/showcase/tenant-probe';
const FLOW = 'tenant_probe_flow';

/**
 * The one declared endpoint.
 *
 * `authRequired: false` + an ARMED `rateLimit` is the single anonymous shape
 * ADR-0121 D6 permits (an unarmed budget meters nothing, so the gate requires
 * `enabled: true`). Declared that way here so the fixture is a shape publish
 * would actually accept, rather than one that survives only because a stub
 * matcher skips the gates.
 */
const ENDPOINT: ApiEndpoint = ApiEndpointSchema.parse({
    name: 'tenant_probe',
    path: PATH,
    method: 'GET',
    type: 'flow',
    target: FLOW,
    authRequired: false,
    rateLimit: { enabled: true, windowMs: 60_000, maxRequests: 1_000 },
});

/** Every `matchEndpoint` query the boot made, tagged with who answered it. */
const matchQueries: Array<{ owner: string; path: string; method: string }> = [];

/** One matcher body, so host and tenants differ only by their tag. */
function makeMatcher(owner: string) {
    return async (q: { path: string; method: string }): Promise<ApiEndpointMatch | undefined> => {
        matchQueries.push({ owner, path: q.path, method: q.method });
        const hit = q.path.replace(/\/$/, '') === ENDPOINT.path && q.method.toUpperCase() === ENDPOINT.method;
        return hit ? { endpoint: ENDPOINT, params: {} } : undefined;
    };
}

/**
 * The HOST's `metadata` + `automation` slots — the counterfactual.
 *
 * A placed request must never reach these; an unplaced one would reach both if
 * the decline branch were gone, and would come back 200 saying `servedBy:
 * 'host'`. Occupying `automation` too is what makes that failure mode a plain
 * wrong answer rather than a 501 that could be mistaken for an unrelated gap.
 */
function hostSlotsPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.host-slots',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('metadata', { list: async () => [], matchEndpoint: makeMatcher('host') });
            ctx.registerService('automation', {
                execute: async (flow: string) => ({ servedBy: 'host', flow }),
            });
        },
    };
}

/**
 * A per-environment kernel carrying only the two slots the chain reads.
 *
 * Smaller than a kernel on purpose: anything else it grew could be read by
 * accident and would weaken the "served by THIS kernel" claim.
 */
function makeTenantKernel(tenant: string) {
    const services: Record<string, unknown> = {
        metadata: { __tag: tenant, list: async () => [], matchEndpoint: makeMatcher(tenant) },
        automation: { __tag: tenant, execute: async (flow: string) => ({ servedBy: tenant, flow }) },
    };
    return {
        __tag: tenant,
        getServiceAsync: async (name: string) => services[name] ?? null,
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    };
}

const TENANTS: Record<string, ReturnType<typeof makeTenantKernel>> = {
    'env-1': makeTenantKernel('env-1'),
    'env-2': makeTenantKernel('env-2'),
};

/** Every environment id the resolver was asked to place. */
const resolverCalls: Array<string | undefined> = [];

/**
 * The host's `kernel-resolver` — the ADR-0006 Phase 5 seam the cloud
 * distribution fills. Registering it at all is what makes
 * `HttpDispatcher.isMultiTenantHost()` true, which is the branch's guard.
 *
 * Registered in `init()` because the dispatcher plugin resolves it during
 * `start()` when it constructs the `HttpDispatcher`; a `start()`-registered
 * resolver would be visible or not depending on plugin order.
 *
 * The decline is expressed exactly as the contract says: return `undefined`
 * and leave `context.environmentId` unset.
 */
function tenantResolverPlugin(): Plugin {
    return {
        name: 'com.objectstack.test.kernel-resolver',
        version: '1.0.0',
        init: async (ctx: PluginContext) => {
            ctx.registerService('kernel-resolver', {
                resolveKernel: async (context: any) => {
                    const headers = (context?.request?.headers ?? {}) as Record<string, string | undefined>;
                    const envId = headers['x-environment-id'];
                    resolverCalls.push(envId);
                    const kernel = envId ? TENANTS[envId] : undefined;
                    if (!kernel) return undefined;
                    context.environmentId = envId;
                    return kernel;
                },
            });
        },
    };
}

let kernel: LiteKernel | undefined;
let baseUrl = '';

/** Capture the boot's log lines without swallowing them. */
let stdoutLines: string[] = [];
let restoreStdout: (() => void) | undefined;

function captureStdout() {
    const original = process.stdout.write.bind(process.stdout);
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: any, ...rest: any[]) => {
        stdoutLines.push(String(chunk));
        return (original as any)(chunk, ...rest);
    }) as any);
    restoreStdout = () => spy.mockRestore();
}

beforeAll(async () => {
    kernel = new LiteKernel();
    kernel.use(new HonoServerPlugin({ port: 0, cors: false }));
    kernel.use(hostSlotsPlugin());
    kernel.use(tenantResolverPlugin());
    kernel.use(createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false }));
    await kernel.bootstrap();
    const httpServer = kernel.getService<IHttpServer>('http.server');
    baseUrl = `http://127.0.0.1:${httpServer.getPort!()}`;
}, 60_000);

afterAll(async () => {
    restoreStdout?.();
    if (!kernel) return;
    await Promise.race([
        kernel.shutdown(),
        new Promise<void>((resolve) => setTimeout(resolve, 10_000)),
    ]);
}, 60_000);

describe('#5040 E5b — a placed request executes on ITS OWN resolved kernel', () => {
    it('delegates to the resolved tenant\'s automation slot, not the host\'s', async () => {
        matchQueries.length = 0;

        const res = await fetch(`${baseUrl}${PATH}`, { headers: { 'X-Environment-Id': 'env-1' } });

        expect(res.status).toBe(200);
        // `servedBy` can only be 'env-1' if the delegation read env-1's kernel.
        // The host's own automation slot is occupied and must not answer.
        expect(await res.json()).toEqual({ success: true, data: { servedBy: 'env-1', flow: FLOW } });
        expect(matchQueries).toEqual([{ owner: 'env-1', path: PATH, method: 'GET' }]);
    }, 60_000);

    it('serves a second tenant the SAME path out of its own kernel', async () => {
        matchQueries.length = 0;

        const res = await fetch(`${baseUrl}${PATH}`, { headers: { 'X-Environment-Id': 'env-2' } });

        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ success: true, data: { servedBy: 'env-2', flow: FLOW } });
        expect(matchQueries).toEqual([{ owner: 'env-2', path: PATH, method: 'GET' }]);
    }, 60_000);
});

describe('#5040 E5b — multi-tenant resolution finds no environment: decline + warn', () => {
    it('answers the transport\'s own 404 and never probes the declaration', async () => {
        matchQueries.length = 0;
        resolverCalls.length = 0;
        stdoutLines = [];
        captureStdout();

        // No `X-Environment-Id`: the resolver cannot place the request, so it
        // returns undefined and leaves `environmentId` unset.
        const res = await fetch(`${baseUrl}${PATH}`);
        restoreStdout?.();

        // The resolver WAS asked — this is the decline branch, not a
        // single-environment host that never had a resolver.
        expect(resolverCalls).toEqual([undefined]);

        // Declining writes nothing, so the transport's own 404 stands. The host
        // DECLARES this path and could have served it: without the branch this
        // is a 200 carrying `servedBy: 'host'`.
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
        });

        // The decline happened BEFORE the probe. A declaration must never be
        // consulted for a request that was not placed in an environment.
        expect(matchQueries).toEqual([]);

        const warned = stdoutLines.filter(
            (line) => line.includes('WARN') && line.includes('resolved to no environment'),
        );
        expect(warned).toHaveLength(1);
        // The warning names the path, so an operator can tell WHICH request
        // was dropped rather than only that one was.
        expect(warned[0]).toContain(PATH);
        expect(warned[0]).toContain('declining rather than serving it from the default kernel');
    }, 60_000);

    it('declines an UNKNOWN environment the same way — a header is not a placement', async () => {
        matchQueries.length = 0;
        resolverCalls.length = 0;

        const res = await fetch(`${baseUrl}${PATH}`, { headers: { 'X-Environment-Id': 'env-does-not-exist' } });

        expect(resolverCalls).toEqual(['env-does-not-exist']);
        expect(res.status).toBe(404);
        expect(await res.json()).toEqual({
            success: false,
            error: { code: 'ENDPOINT_NOT_FOUND', message: 'Not found' },
        });
        expect(matchQueries).toEqual([]);
    }, 60_000);
});
