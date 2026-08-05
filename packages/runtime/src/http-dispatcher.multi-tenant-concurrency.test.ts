// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5155 — per-request kernel isolation on a MULTI-TENANT host.
 *
 * One `HttpDispatcher` instance serves every route of a host
 * (`dispatcher-plugin.ts` `start()` constructs exactly one). The kernel a
 * request is served from is therefore PER REQUEST, not per dispatcher: the
 * host's `kernelResolver` picks it, and every service lookup the request makes
 * afterwards — identity resolution, the domain handler, `callData` — must land
 * on THAT kernel.
 *
 * Before this suite the resolved kernel lived on a mutable INSTANCE field
 * (`this.kernel`), written once per request and read across every subsequent
 * `await`. Node's single thread does not protect that: it protects code that
 * does not hold mutable shared state across an `await`, and this held it across
 * several. Two interleaved requests on two environments therefore produced
 * "request A reads request B's data source" — a cross-tenant read, not a
 * performance bug.
 *
 * The interleave here is DETERMINISTIC, not timing-dependent: request A parks
 * inside its own identity resolution (its kernel's `auth` lookup awaits a gate
 * the test controls), request B runs to completion while A is parked, then A is
 * released and finishes. That is exactly the sequence the issue describes, with
 * the scheduler taken out of the equation.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import type { KernelResolver, HttpProtocolContext } from './http-dispatcher.js';

interface Deferred { promise: Promise<void>; resolve: () => void }
function deferred(): Deferred {
    let resolve!: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    return { promise, resolve };
}

/**
 * A per-environment kernel whose every service is TAGGED with the environment
 * it belongs to, so "which tenant served this request" is readable off the
 * response body rather than inferred.
 *
 * `onLookup` is the test's interleaving gate: it runs before each async
 * service lookup on THIS kernel.
 */
function makeTenantKernel(
    tag: string,
    onLookup?: (name: string) => Promise<void> | void,
) {
    const objectql = {
        __tag: tag,
        find: vi.fn(async () => [{ tenant: tag }]),
        getObjects: vi.fn(() => ({})),
        registry: { getObject: vi.fn(() => null), getRegisteredTypes: vi.fn(() => []) },
    };
    // The `i18n` slot is the probe: `/i18n/locales` is anonymous-reachable
    // (no `shouldDenyAnonymous` gate) and reads the slot straight off the
    // request's kernel via `deps.getService('i18n')`.
    const i18n = {
        __tag: tag,
        getLocales: () => [`${tag}-locale`],
        getDefaultLocale: () => `${tag}-locale`,
        getTranslations: () => ({}),
        getFieldLabels: () => ({}),
    };
    const metadata = {
        __tag: tag,
        getObject: async () => undefined,
        getRegisteredTypes: async () => [tag],
    };
    const services: Record<string, any> = { objectql, i18n, metadata };
    const kernel: any = {
        __tag: tag,
        getServiceAsync: async (name: string) => {
            await onLookup?.(name);
            return services[name] ?? null;
        },
        getService: (name: string) => services[name] ?? null,
        context: { getService: (name: string) => services[name] ?? null },
    };
    return kernel;
}

/**
 * The host / control-plane kernel a multi-tenant deployment boots the
 * dispatcher with. It serves NO tenant slot — every scoped lookup falls
 * through to the request's own kernel, which is the whole point of the seam.
 */
function makeHostKernel() {
    const kernel: any = {
        __tag: 'host',
        getServiceAsync: async () => null,
        getService: () => null,
        context: { getService: () => null },
    };
    return kernel;
}

function makeMultiTenantDispatcher(kernels: Record<string, any>) {
    const host = makeHostKernel();
    const resolveKernel = vi.fn(async (ctx: HttpProtocolContext) => {
        const envId = (ctx.request?.headers ?? {})['x-environment-id'];
        if (!envId) return undefined;
        ctx.environmentId = envId;
        return kernels[envId];
    });
    const resolver: KernelResolver = { resolveKernel };
    const dispatcher = new HttpDispatcher(host, undefined, {
        kernelResolver: resolver,
        enforceProjectMembership: false,
    });
    return { dispatcher, host, resolveKernel };
}

const ctxFor = (envId: string): HttpProtocolContext =>
    ({ request: { headers: { 'x-environment-id': envId } } }) as HttpProtocolContext;

describe('#5155 — HttpDispatcher serves each request from ITS OWN resolved kernel', () => {
    it('an interleaved request does not move the first request onto the other tenant\'s kernel', async () => {
        const gate = deferred();
        let parked = false;
        const envOne = makeTenantKernel('env-1', async (name) => {
            // Park request A exactly once, inside its own identity
            // resolution — after its kernel was resolved, before its domain
            // handler looks anything up. Every later lookup A makes happens
            // after request B has resolved a DIFFERENT kernel.
            if (name === 'auth' && !parked) {
                parked = true;
                await gate.promise;
            }
        });
        const envTwo = makeTenantKernel('env-2');
        const { dispatcher } = makeMultiTenantDispatcher({ 'env-1': envOne, 'env-2': envTwo });

        const ctxA = ctxFor('env-1');
        const ctxB = ctxFor('env-2');

        const requestA = dispatcher.dispatch('GET', '/i18n/locales', undefined, {}, ctxA);
        // Let A reach the gate before B starts.
        await vi.waitFor(() => expect(parked).toBe(true));

        const responseB = await dispatcher.dispatch('GET', '/i18n/locales', undefined, {}, ctxB);
        gate.resolve();
        const responseA = await requestA;

        const localesOf = (r: any) => r?.response?.body?.data?.locales?.map((l: any) => l.code ?? l);

        // B is uncontested — it must see its own environment either way.
        expect(localesOf(responseB)).toEqual(['env-2-locale']);
        // A resumed AFTER B resolved a different kernel. It must still be
        // served from env-1: a request never inherits another request's
        // environment.
        expect(localesOf(responseA)).toEqual(['env-1-locale']);
    });

    it('the endpoint fallback path resolves services on the scope it resolved, not the latest one', async () => {
        // The shape `dispatcher-plugin.ts`'s `setFallbackHandler` runs for a
        // declarative endpoint (#5040 E5b): `resolveRequestScope(...)` and then
        // `actionExecutionDeps.resolveService('metadata', …)`, with at least
        // one `await` in between. Two concurrent endpoint requests interleave
        // there exactly like two `dispatch()` calls do.
        const envOne = makeTenantKernel('env-1');
        const envTwo = makeTenantKernel('env-2');
        const { dispatcher } = makeMultiTenantDispatcher({ 'env-1': envOne, 'env-2': envTwo });

        const ctxA = ctxFor('env-1');
        const ctxB = ctxFor('env-2');

        await dispatcher.resolveRequestScope(ctxA, '/app/orders');
        // …request A yields here (any `await` will do — a session lookup, a
        // driver query). Request B arrives and resolves its own scope.
        await dispatcher.resolveRequestScope(ctxB, '/app/invoices');

        // Request A resumes and asks for the service its own call needs.
        const metadataForA = await dispatcher.actionExecutionDeps
            .resolveService(ctxA, 'metadata', ctxA.environmentId);
        expect((metadataForA as any)?.__tag).toBe('env-1');

        const metadataForB = await dispatcher.actionExecutionDeps
            .resolveService(ctxB, 'metadata', ctxB.environmentId);
        expect((metadataForB as any)?.__tag).toBe('env-2');
    });

    it('records the resolved kernel on the request context, not on the dispatcher', async () => {
        const envOne = makeTenantKernel('env-1');
        const envTwo = makeTenantKernel('env-2');
        const { dispatcher, host } = makeMultiTenantDispatcher({ 'env-1': envOne, 'env-2': envTwo });

        const ctxA = ctxFor('env-1');
        const ctxB = ctxFor('env-2');
        await dispatcher.resolveRequestScope(ctxA, '/data/orders');
        await dispatcher.resolveRequestScope(ctxB, '/data/invoices');

        // Each context carries ITS OWN kernel — the second resolution cannot
        // reach back and rewrite the first.
        expect((ctxA.kernel as any)?.__tag).toBe('env-1');
        expect((ctxB.kernel as any)?.__tag).toBe('env-2');

        // …and an unresolvable request falls back to the host kernel without
        // borrowing whichever tenant resolved last.
        const ctxC: HttpProtocolContext = { request: { headers: {} } } as HttpProtocolContext;
        await dispatcher.resolveRequestScope(ctxC, '/discovery');
        expect(ctxC.kernel).toBe(host);
    });
});
