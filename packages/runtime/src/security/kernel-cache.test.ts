// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2): when a `cache` service is registered — as
 * a value or as a factory — the dispatcher's token buckets count in it; only
 * when none is registered (the kernel's own `degraded` stand-in included) do
 * they fall back to the bounded per-process store.
 *
 * Measured against REAL kernels, never a hand-built context: a mocked context
 * can carry any member it likes, including one the kernel never hands a plugin.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryCache, LiteKernel, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { readServiceSelfInfo } from '@objectstack/spec/api';
import { createLazyCounterStore, InProcessCounterStore } from '@objectstack/plugin-auth/rate-limit-storage';

import { resolveKernelCache } from './kernel-cache.js';
import { SharedTokenBucketLimiter } from './inbound-rate-limit.js';

function cachePlugin(mode: 'factory' | 'value' | 'none', cache: unknown): Plugin & { ctx?: PluginContext } {
    const plugin: Plugin & { ctx?: PluginContext } = {
        name: `test.cache.${mode}`,
        type: 'standard',
        version: '1.0.0',
        async init(ctx: PluginContext) {
            plugin.ctx = ctx;
            if (mode === 'factory') ctx.registerServiceFactory('cache', () => cache);
            if (mode === 'value') ctx.registerService('cache', cache);
        },
    };
    return plugin;
}

async function objectKernelContext(mode: 'factory' | 'value' | 'none', cache: unknown): Promise<PluginContext> {
    // No data plane here, so the system pass (which also injects the kernel's
    // own `cache` stand-in) is skipped: "none" really is none.
    const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true });
    const plugin = cachePlugin(mode, cache);
    await kernel.use(plugin);
    await kernel.bootstrap();
    return plugin.ctx!;
}

describe('resolveKernelCache (runtime) — through the accessors a plugin context really carries', () => {
    it('ObjectKernel, `cache` registered by FACTORY: answers the factory-built cache', async () => {
        const cache = new InProcessCounterStore();
        const ctx = await objectKernelContext('factory', cache);
        expect(() => ctx.getService('cache')).toThrow('is async');
        await expect(resolveKernelCache(ctx)).resolves.toBe(cache);
    });

    it('ObjectKernel, `cache` registered as a VALUE: answers that value', async () => {
        const cache = new InProcessCounterStore();
        await expect(resolveKernelCache(await objectKernelContext('value', cache))).resolves.toBe(cache);
    });

    it('ObjectKernel, no `cache` registered: answers undefined', async () => {
        await expect(resolveKernelCache(await objectKernelContext('none', undefined))).resolves.toBeUndefined();
    });

    it("the kernel's own in-memory stand-in (self-described `degraded`): answers undefined", async () => {
        const standIn = createMemoryCache();
        expect(readServiceSelfInfo(standIn)?.status).toBe('degraded');
        await expect(resolveKernelCache(await objectKernelContext('value', standIn))).resolves.toBeUndefined();
    });

    it('a registered `cache` without get/set is not a counter store: answers undefined', async () => {
        await expect(resolveKernelCache(await objectKernelContext('value', { stats: () => ({}) }))).resolves.toBeUndefined();
    });

    it('LiteKernel (no getServiceAsync, no factories), `cache` as a VALUE: answers that value', async () => {
        const cache = new InProcessCounterStore();
        const kernel = new LiteKernel({ logger: { level: 'silent' } });
        const plugin = cachePlugin('value', cache);
        kernel.use(plugin);
        await kernel.bootstrap();
        await expect(resolveKernelCache(plugin.ctx!)).resolves.toBe(cache);
    });

    it('a bucket counted through it lives in the factory-registered cache', async () => {
        const cache = new InProcessCounterStore();
        const ctx = await objectKernelContext('factory', cache);
        const resolveStore = createLazyCounterStore({ resolveCache: () => resolveKernelCache(ctx), subject: 'test buckets' });
        const limiter = new SharedTokenBucketLimiter({ capacity: 2, refillPerSec: 1 }, resolveStore, () => 1_000_000);
        await limiter.consume('principal:u1');
        expect(await cache.get('principal:u1')).toBeDefined();
    });
});
