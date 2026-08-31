// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13905] The async service-resolution discriminator.
 *
 * `Kernel.getServiceAsync` used to answer "nothing ever registered this
 * service" and "the service IS registered and could not be built" with the same
 * bare `Error`, so a caller holding only the rejection could not tell an
 * UNWIRED embedder from a BROKEN one. These pins hold the two facts apart, and
 * hold the SUPPORTED no-data-plane composition on the quiet side of the line.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectKernel } from './kernel';
import { PluginLoader, ServiceLifecycle } from './plugin-loader';
import { createLogger } from './logger';
import type { PluginContext } from './types';
import {
    isServiceNotRegisteredError,
    SERVICE_NOT_REGISTERED_CODE,
} from './service-not-registered';

function makeLoader(withContext = true): PluginLoader {
    const logger = createLogger({ level: 'error' });
    const loader = new PluginLoader(logger);
    if (withContext) {
        loader.setContext({
            registerService: () => {},
            getService: () => { throw new Error('Mock service not found'); },
            hook: () => {},
            trigger: async () => {},
            getServices: () => new Map(),
            logger,
            getKernel: () => ({}) as any,
        } as PluginContext);
    }
    return loader;
}

/** The rejection, or a loud failure if the call unexpectedly resolved. */
async function rejectionOf(call: () => Promise<unknown>): Promise<any> {
    try {
        await call();
    } catch (err) {
        return err;
    }
    throw new Error('expected the call to reject, but it resolved');
}

describe('[#13905] the two service-resolution facts are distinguishable', () => {
    let loader: PluginLoader;

    beforeEach(() => {
        loader = makeLoader();
    });

    it('brands "never registered" with an ADR-0112 code and the service name', async () => {
        const err = await rejectionOf(() => loader.getService('ghost'));

        expect(isServiceNotRegisteredError(err)).toBe(true);
        expect(err.code).toBe(SERVICE_NOT_REGISTERED_CODE);
        expect(err.code).toBe('SERVICE_NOT_REGISTERED');
        expect(err.serviceName).toBe('ghost');
    });

    it('leaves a factory that THREW unbranded — the other fact', async () => {
        loader.registerServiceFactory({
            name: 'exploding',
            factory: () => { throw new Error('driver connect failed'); },
            lifecycle: ServiceLifecycle.SINGLETON,
        });

        const err = await rejectionOf(() => loader.getService('exploding'));

        // The factory's own diagnostic survives — it is not replaced by ours…
        expect(err.message).toBe('driver connect failed');
        // …and it is NOT the "never registered" fact.
        expect(isServiceNotRegisteredError(err)).toBe(false);
        expect(err.code).toBeUndefined();
    });

    it('the two rejections for the same name are distinguishable from each other', async () => {
        const absent = await rejectionOf(() => makeLoader().getService('objectql'));

        const broken = makeLoader();
        broken.registerServiceFactory({
            name: 'objectql',
            factory: () => { throw new Error('connection refused'); },
            lifecycle: ServiceLifecycle.SINGLETON,
        });
        const failed = await rejectionOf(() => broken.getService('objectql'));

        // Both are rejections about the SAME service name — the discriminator
        // is the only thing that tells them apart, and it does.
        expect(isServiceNotRegisteredError(absent)).toBe(true);
        expect(isServiceNotRegisteredError(failed)).toBe(false);
    });
});

describe('[#13905] the discriminator is a CLOSED test that defaults loud', () => {
    it('does not brand a registered service that could not be produced', async () => {
        // Every one of these is "registered, but you cannot have it" — the
        // opposite fact from "nothing registered this name". If a later
        // rejection is added to `getService` it lands here too, unbranded,
        // which is the safe side.
        const scoped = makeLoader();
        scoped.registerServiceFactory({
            name: 'needs-scope',
            factory: () => ({}),
            lifecycle: ServiceLifecycle.SCOPED,
        });
        const noScopeId = await rejectionOf(() => scoped.getService('needs-scope'));
        expect(noScopeId.message).toContain('Scope ID required');
        expect(isServiceNotRegisteredError(noScopeId)).toBe(false);

        const contextless = makeLoader(false);
        contextless.registerServiceFactory({
            name: 'no-context',
            factory: () => ({}),
            lifecycle: ServiceLifecycle.SINGLETON,
        });
        const unset = await rejectionOf(() => contextless.getService('no-context'));
        expect(unset.message).toContain('Context not set');
        expect(isServiceNotRegisteredError(unset)).toBe(false);

        const circular = makeLoader();
        circular.registerServiceFactory({
            name: 'circ',
            factory: async () => await circular.getService('circ'),
            lifecycle: ServiceLifecycle.TRANSIENT,
        });
        const cycle = await rejectionOf(() => circular.getService('circ'));
        expect(cycle.message).toContain('Circular dependency detected');
        expect(isServiceNotRegisteredError(cycle)).toBe(false);
    });

    it('answers false for non-errors and for a bare Error', () => {
        expect(isServiceNotRegisteredError(undefined)).toBe(false);
        expect(isServiceNotRegisteredError(null)).toBe(false);
        expect(isServiceNotRegisteredError('Service \'x\' not found')).toBe(false);
        expect(isServiceNotRegisteredError(new Error("Service 'x' not found"))).toBe(false);
    });
});

describe('[#13905] the rejection renders exactly as it did before', () => {
    it('keeps the message and the error name byte-identical', async () => {
        const err = await rejectionOf(() => makeLoader().getService('ghost'));

        // A2.3: nothing may move for a caller that renders or asserts on this
        // text. The discriminator rides BESIDE the message, never replaces it.
        expect(err.message).toBe("Service 'ghost' not found");
        expect(err.name).toBe('Error');
        expect(String(err)).toBe("Error: Service 'ghost' not found");
        expect(err instanceof Error).toBe(true);
    });
});

describe('[#13905] the SUPPORTED no-data-plane kernel stays quiet, the broken one goes loud', () => {
    /**
     * The shape a transport seam can now write — absorb ONLY "not wired",
     * re-raise everything else.
     *
     * ⚠️ Test-local on purpose. This card ships the discriminator; rebinding
     * `RestServer.computeExecCtx`'s kernel branch to it is a separate card
     * (#13476's remainder). This helper exists to prove the discriminator can
     * carry that repair, not to perform it.
     */
    async function engineOrUndefined(kernel: ObjectKernel): Promise<unknown> {
        try {
            return await kernel.getServiceAsync('objectql');
        } catch (err) {
            if (isServiceNotRegisteredError(err)) return undefined;
            throw err;
        }
    }

    function makeKernel(): ObjectKernel {
        return new ObjectKernel({
            logger: { level: 'error' },
            gracefulShutdown: false,
            skipSystemValidation: true,
        });
    }

    it('a kernel with NO data plane resolves as "not wired", not as an outage', async () => {
        // The composition `rest-api-plugin.ts` declares as supported:
        // `optionalDependencies: ['com.objectstack.engine.objectql']` — nothing
        // registers `objectql`. Making this loud is the breakage #13476
        // refused to ship, so it must stay quiet.
        const kernel = makeKernel();
        await kernel.bootstrap();

        await expect(engineOrUndefined(kernel)).resolves.toBeUndefined();

        const err = await rejectionOf(() => kernel.getServiceAsync('objectql'));
        expect(isServiceNotRegisteredError(err)).toBe(true);

        await kernel.shutdown();
    });

    it('a kernel whose engine FAILED TO CONSTRUCT is loud instead of degrading', async () => {
        // The multi-tenant host from the filing: the engine IS wired and broke.
        // Before the discriminator this reached the resolver as "no engine is
        // wired" — indistinguishable from the supported case above.
        const kernel = makeKernel();
        kernel.registerServiceFactory(
            'objectql',
            () => { throw new Error('driver handshake failed'); },
            ServiceLifecycle.SINGLETON,
        );
        await kernel.bootstrap();

        await expect(engineOrUndefined(kernel)).rejects.toThrow('driver handshake failed');

        await kernel.shutdown();
    });
});

describe('[#13905] the published increment', () => {
    it('reaches consumers through the package entry point, and is exactly two symbols', async () => {
        const core: Record<string, unknown> = await import('./index');

        expect(typeof core.isServiceNotRegisteredError).toBe('function');
        expect(core.SERVICE_NOT_REGISTERED_CODE).toBe('SERVICE_NOT_REGISTERED');
        expect(core.isServiceNotRegisteredError).toBe(isServiceNotRegisteredError);

        // The construction site is `PluginLoader.getService` alone, so the
        // factory stays package-internal. Publishing it would invite a second
        // producer of a fact that must have one.
        expect(core.serviceNotRegisteredError).toBeUndefined();
    });
});
