// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Plugin ordering + init-service contract (ADR-0116, #4131).
 *
 * The unit half exercises `plugin-order.ts` directly; the kernel half boots
 * real LiteKernel / ObjectKernel instances in the exact #4085 shape —
 * a consumer plugin registered BEFORE its provider — and proves the contract
 * either fixes the order (optionalDependencies) or names the fault
 * (requiresServices), instead of dying inside the victim's init.
 */

import { describe, it, expect } from 'vitest';
import {
    resolvePluginOrder,
    validateInitServiceContract,
    assertInitServiceRequirements,
    type OrderablePlugin,
} from './plugin-order';
import { LiteKernel } from './lite-kernel';
import { ObjectKernel } from './kernel';
import type { Plugin, PluginContext } from './types';

const toMap = (plugins: OrderablePlugin[]) =>
    new Map(plugins.map((p) => [p.name, p]));

describe('resolvePluginOrder', () => {
    it('preserves insertion order when no edges exist', () => {
        const order = resolvePluginOrder(toMap([{ name: 'a' }, { name: 'b' }, { name: 'c' }]));
        expect(order.map((p) => p.name)).toEqual(['a', 'b', 'c']);
    });

    it('hoists hard dependencies ahead of the dependent', () => {
        const order = resolvePluginOrder(toMap([
            { name: 'consumer', dependencies: ['provider'] },
            { name: 'provider' },
        ]));
        expect(order.map((p) => p.name)).toEqual(['provider', 'consumer']);
    });

    it('throws on a missing hard dependency', () => {
        expect(() =>
            resolvePluginOrder(toMap([{ name: 'consumer', dependencies: ['ghost'] }])),
        ).toThrow("Dependency 'ghost' not found for plugin 'consumer'");
    });

    it('hoists an optional dependency when it is composed', () => {
        const order = resolvePluginOrder(toMap([
            { name: 'consumer', optionalDependencies: ['provider'] },
            { name: 'provider' },
        ]));
        expect(order.map((p) => p.name)).toEqual(['provider', 'consumer']);
    });

    it('skips an optional dependency that is absent — no error', () => {
        const order = resolvePluginOrder(toMap([
            { name: 'consumer', optionalDependencies: ['ghost'] },
            { name: 'other' },
        ]));
        expect(order.map((p) => p.name)).toEqual(['consumer', 'other']);
    });

    it('detects cycles through optional edges', () => {
        expect(() =>
            resolvePluginOrder(toMap([
                { name: 'a', optionalDependencies: ['b'] },
                { name: 'b', dependencies: ['a'] },
            ])),
        ).toThrow('Circular dependency detected');
    });
});

describe('validateInitServiceContract', () => {
    it('passes when the provider initializes earlier', () => {
        expect(() =>
            validateInitServiceContract(
                [
                    { name: 'provider', providesServices: ['svc'] },
                    { name: 'consumer', requiresServices: ['svc'] },
                ],
                () => false,
            ),
        ).not.toThrow();
    });

    it('names both plugins when the only declared provider initializes later', () => {
        expect(() =>
            validateInitServiceContract(
                [
                    { name: 'consumer', requiresServices: ['svc'] },
                    { name: 'provider', providesServices: ['svc'] },
                ],
                () => false,
            ),
        ).toThrow(/'consumer' requires service 'svc' during init, but 'svc' is provided by 'provider'/);
    });

    it('passes when the service is already registered on the kernel', () => {
        expect(() =>
            validateInitServiceContract(
                [
                    { name: 'consumer', requiresServices: ['svc'] },
                    { name: 'provider', providesServices: ['svc'] },
                ],
                (name) => name === 'svc',
            ),
        ).not.toThrow();
    });

    it('does not fail on an undeclared provider — that verdict belongs to the init-time check', () => {
        expect(() =>
            validateInitServiceContract(
                [{ name: 'consumer', requiresServices: ['svc'] }],
                () => false,
            ),
        ).not.toThrow();
    });
});

describe('assertInitServiceRequirements', () => {
    it('passes when every required service is registered', () => {
        expect(() =>
            assertInitServiceRequirements(
                { name: 'consumer', requiresServices: ['svc'] },
                (name) => name === 'svc',
            ),
        ).not.toThrow();
    });

    it('names the plugin and the missing service', () => {
        expect(() =>
            assertInitServiceRequirements(
                { name: 'consumer', requiresServices: ['svc'] },
                () => false,
            ),
        ).toThrow(/Plugin 'consumer' requires service 'svc' at init/);
    });
});

// ─── Kernel-level behaviour ─────────────────────────────────────────

/** A provider/consumer pair in the #4085 shape: consumer registered FIRST. */
function misorderedPair(initLog: string[]): { provider: Plugin; consumer: Plugin } {
    const provider: Plugin = {
        name: 'test.provider',
        version: '1.0.0',
        providesServices: ['svc'],
        init: (ctx: PluginContext) => {
            initLog.push('provider');
            ctx.registerService('svc', { ok: true });
        },
    };
    const consumer: Plugin = {
        name: 'test.consumer',
        version: '1.0.0',
        optionalDependencies: ['test.provider'],
        requiresServices: ['svc'],
        init: (ctx: PluginContext) => {
            initLog.push('consumer');
            ctx.getService('svc');
        },
    };
    return { provider, consumer };
}

describe('LiteKernel ordering contract', () => {
    it('optionalDependencies fixes the #4085 shape: consumer used first still inits after provider', async () => {
        const initLog: string[] = [];
        const { provider, consumer } = misorderedPair(initLog);
        const kernel = new LiteKernel();
        kernel.use(consumer); // deliberately BEFORE the provider
        kernel.use(provider);
        await kernel.bootstrap();
        expect(initLog).toEqual(['provider', 'consumer']);
        await kernel.shutdown();
    });

    it('optionalDependencies of an absent plugin does not fail the boot', async () => {
        const kernel = new LiteKernel();
        kernel.use({
            name: 'test.lonely',
            version: '1.0.0',
            optionalDependencies: ['test.not-composed'],
            init: () => { /* degrades */ },
        });
        await expect(kernel.bootstrap()).resolves.toBeUndefined();
        await kernel.shutdown();
    });

    it('a misordered requiresServices consumer without the ordering declaration fails NAMED, before any init', async () => {
        const initLog: string[] = [];
        const { provider, consumer } = misorderedPair(initLog);
        delete (consumer as any).optionalDependencies; // forget the ordering declaration
        const kernel = new LiteKernel();
        kernel.use(consumer);
        kernel.use(provider);
        await expect(kernel.bootstrap()).rejects.toThrow(
            /'test\.consumer' requires service 'svc' during init, but 'svc' is provided by 'test\.provider'/,
        );
        expect(initLog).toEqual([]); // pre-Phase-1: no init side effects
    });

    it('a requiresServices consumer with no provider at all fails named at its init slot', async () => {
        const kernel = new LiteKernel();
        kernel.use({
            name: 'test.consumer',
            version: '1.0.0',
            requiresServices: ['svc'],
            init: () => { /* never reached */ },
        });
        await expect(kernel.bootstrap()).rejects.toThrow(
            /Plugin 'test\.consumer' requires service 'svc' at init/,
        );
    });

    it('an UNDECLARED getService miss during init is diagnosed with the initializing plugin and provider', async () => {
        const kernel = new LiteKernel();
        kernel.use({
            name: 'test.undeclared-consumer',
            version: '1.0.0',
            init: (ctx: PluginContext) => {
                ctx.getService('svc'); // no requiresServices declared
            },
        });
        kernel.use({
            name: 'test.provider',
            version: '1.0.0',
            providesServices: ['svc'],
            init: (ctx: PluginContext) => ctx.registerService('svc', {}),
        });
        await expect(kernel.bootstrap()).rejects.toThrow(
            /Service 'svc' not found \(while plugin 'test\.undeclared-consumer' was initializing[\s\S]*provided by composed plugin 'test\.provider'/,
        );
    });
});

describe('ObjectKernel ordering contract', () => {
    it('optionalDependencies fixes the #4085 shape on the production kernel too', async () => {
        const initLog: string[] = [];
        const { provider, consumer } = misorderedPair(initLog);
        const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false });
        await kernel.use(consumer);
        await kernel.use(provider);
        await kernel.bootstrap();
        expect(initLog).toEqual(['provider', 'consumer']);
    });

    it('a misordered requiresServices consumer fails NAMED before any init', async () => {
        const initLog: string[] = [];
        const { provider, consumer } = misorderedPair(initLog);
        delete (consumer as any).optionalDependencies;
        const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false });
        await kernel.use(consumer);
        await kernel.use(provider);
        await expect(kernel.bootstrap()).rejects.toThrow(
            /'test\.consumer' requires service 'svc' during init, but 'svc' is provided by 'test\.provider'/,
        );
        expect(initLog).toEqual([]);
    });
});
