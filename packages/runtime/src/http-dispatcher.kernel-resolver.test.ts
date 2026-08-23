// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0006 — the generic `kernelResolver` seam (Phase 5 semantics).
 *
 * The host's resolver owns per-request ENVIRONMENT RESOLUTION + kernel
 * selection: the dispatcher contributes parsing hints (`context.routePath`,
 * `context.urlEnvironmentId`), expects the resolver to set
 * `context.environmentId` / `context.dataDriver`, and serves from
 * `defaultKernel` when the resolver returns undefined or none is registered.
 * The framework ships no multi-tenant resolver — strategy coverage lives in
 * cloud `packages/objectos-runtime/src/kernel-resolver.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { HttpDispatcher } from './http-dispatcher.js';
import type { KernelResolver, HttpProtocolContext } from './http-dispatcher.js';

/** Minimal kernel whose objectql records which instance served the request. */
function makeKernel(tag: string) {
    const objectql = {
        find: vi.fn().mockResolvedValue([]),
        getObjects: vi.fn().mockReturnValue({}),
        registry: { getObject: vi.fn().mockReturnValue(null), getRegisteredTypes: vi.fn().mockReturnValue([]) },
        __tag: tag,
    };
    const kernel: any = {
        __tag: tag,
        getService: (name: string) => (name === 'objectql' ? objectql : null),
        getServiceAsync: async (name: string) => (name === 'objectql' ? objectql : null),
        context: { getService: (name: string) => (name === 'objectql' ? objectql : null) },
    };
    return kernel;
}

describe('HttpDispatcher — ADR-0006 kernelResolver seam', () => {
    it('delegates kernel selection to the resolver with parsing hints attached', async () => {
        const defaultKernel = makeKernel('default');
        const envKernel = makeKernel('env');

        const resolveKernel = vi.fn(async (ctx: HttpProtocolContext) => {
            // Phase 5 contract: the resolver sets the environment context.
            ctx.environmentId = 'env-from-resolver';
            return envKernel;
        });
        const dispatcher = new HttpDispatcher(defaultKernel, undefined, {
            kernelResolver: { resolveKernel },
            enforceProjectMembership: false,
        });

        const context: any = { request: { headers: { host: 'tenant.example.com' } } };
        await dispatcher.dispatch('GET', '/environments/env-123/data/widget', undefined, {}, context);

        expect(resolveKernel).toHaveBeenCalledTimes(1);
        const passed = resolveKernel.mock.calls[0][0] as HttpProtocolContext;
        // Dispatcher-provided hints (pure parsing, unvalidated):
        expect(passed.routePath).toBe('/environments/env-123/data/widget');
        expect(passed.urlEnvironmentId).toBe('env-123');
        // Resolver-set environment context survives for downstream stages:
        expect(context.environmentId).toBe('env-from-resolver');
        expect(resolveKernel.mock.calls[0][1]).toBe(defaultKernel);
    });

    it('does not parse /cloud/environments/:id as a scoped-path candidate', async () => {
        const defaultKernel = makeKernel('default');
        const resolveKernel = vi.fn(async () => undefined);
        const dispatcher = new HttpDispatcher(defaultKernel, undefined, {
            kernelResolver: { resolveKernel },
            enforceProjectMembership: false,
        });

        const context: any = { request: {} };
        await dispatcher.dispatch('GET', '/cloud/environments/env-9', undefined, {}, context);
        const passed = resolveKernel.mock.calls[0][0] as HttpProtocolContext;
        expect(passed.urlEnvironmentId).toBeUndefined();
    });

    it('falls back to defaultKernel when the resolver returns undefined', async () => {
        const defaultKernel = makeKernel('default');
        const resolveKernel = vi.fn(async () => undefined);

        const dispatcher = new HttpDispatcher(defaultKernel, undefined, {
            kernelResolver: { resolveKernel },
            enforceProjectMembership: false,
        });

        const result = await dispatcher.dispatch('GET', '/data/widget', undefined, {}, { request: {} } as any);
        expect(resolveKernel).toHaveBeenCalledTimes(1);
        expect(result).toBeDefined();
    });

    it('serves single-environment hosts (no resolver) from defaultKernel without env context', async () => {
        const defaultKernel = makeKernel('default');
        const dispatcher = new HttpDispatcher(defaultKernel, undefined, {
            enforceProjectMembership: false,
        });

        const context: any = { request: { headers: { host: 'localhost' } } };
        const result = await dispatcher.dispatch('GET', '/data/widget', undefined, {}, context);
        expect(result).toBeDefined();
        // No resolver registered → nothing resolves an environment.
        expect(context.environmentId).toBeUndefined();
    });
});

/**
 * The optional environment-only member (`resolveEnvironment`) exists for
 * consumers that want the ID and nothing else — `@objectstack/rest`'s
 * `resolveRequestEnvironmentId` wrapper, which used to buy a kernel through
 * `resolveKernel` and discard it, paying a whole waiter window for an id.
 *
 * The dispatcher is NOT such a consumer: `resolveRequestScope` serves the
 * request FROM the resolved kernel, so it must keep asking the acquisition
 * method. Pinned here because "prefer the cheaper method everywhere" is the
 * obvious-looking follow-up edit, and here it would leave `context.kernel` on
 * `defaultKernel` — every multi-tenant request silently served from the host
 * kernel, which is the class of defect ADR-0006 Phase 5 exists to prevent.
 */
describe('HttpDispatcher — resolveEnvironment is not the dispatcher\'s question', () => {
    it('still acquires through resolveKernel when the host implements both', async () => {
        const defaultKernel = makeKernel('default');
        const envKernel = makeKernel('env');

        const resolveEnvironment = vi.fn((ctx: HttpProtocolContext) => {
            ctx.environmentId = 'env-from-resolver';
        });
        const resolveKernel = vi.fn(async (ctx: HttpProtocolContext) => {
            ctx.environmentId = 'env-from-resolver';
            return envKernel;
        });
        // Typed as the contract, so this also pins that a resolver carrying the
        // new member satisfies `KernelResolver`.
        const resolver: KernelResolver = { resolveKernel, resolveEnvironment };
        const dispatcher = new HttpDispatcher(defaultKernel, undefined, {
            kernelResolver: resolver,
            enforceProjectMembership: false,
        });

        const context: any = { request: { headers: { host: 'tenant.example.com' } } };
        await dispatcher.dispatch('GET', '/data/widget', undefined, {}, context);

        expect(resolveKernel).toHaveBeenCalledTimes(1);
        expect(resolveEnvironment).not.toHaveBeenCalled();
        // The request is served from the kernel the resolver handed back — the
        // whole reason the dispatcher may not take the cheap door.
        expect(context.kernel).toBe(envKernel);
        expect(context.environmentId).toBe('env-from-resolver');
    });

    it('is unaffected by a resolver that omits the optional member', async () => {
        const defaultKernel = makeKernel('default');
        const envKernel = makeKernel('env');
        const resolver: KernelResolver = { resolveKernel: vi.fn(async () => envKernel) };
        const dispatcher = new HttpDispatcher(defaultKernel, undefined, {
            kernelResolver: resolver,
            enforceProjectMembership: false,
        });

        const context: any = { request: { headers: {} } };
        await dispatcher.dispatch('GET', '/data/widget', undefined, {}, context);

        expect(context.kernel).toBe(envKernel);
    });
});
