// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2): the daily SMS send quota counts in the
 * registered `cache` service — registered as a value or as a factory — and
 * falls back to the bounded per-process store only when none is registered,
 * the kernel's own `degraded` stand-in included.
 *
 * Measured against a REAL `ObjectKernel`, never a hand-built context: a mocked
 * context can carry any member it likes, including one the kernel never hands
 * a plugin.
 */

import { describe, expect, it } from 'vitest';
import { createMemoryCache, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import type { CounterStore } from '@objectstack/plugin-auth/rate-limit-storage';

import { resolveKernelCache } from './kernel-cache.js';
import { SmsServicePlugin } from './sms-plugin.js';
import type { SmsService } from './sms-service.js';

const QUOTA = 3;

/** A counter-capable cache that keeps what it is handed in a readable map. */
function makeCache(): CounterStore & { readonly store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T = unknown>(key: string): Promise<T | undefined> { return store.get(key) as T | undefined; },
    async set<T = unknown>(key: string, value: T): Promise<void> { store.set(key, value); },
  };
}
const BURST = 10;

/** Registers `cache` the way the test asks, and an `sms` settings namespace carrying the quota. */
function hostPlugin(mode: 'factory' | 'value', cache: unknown): Plugin & { ctx?: PluginContext } {
  const plugin: Plugin & { ctx?: PluginContext } = {
    name: `test.host.${mode}`,
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      plugin.ctx = ctx;
      if (mode === 'factory') ctx.registerServiceFactory('cache', () => cache);
      else ctx.registerService('cache', cache);
      ctx.registerService('settings', {
        async getNamespace(ns: string) {
          return ns === 'sms' ? { values: { daily_quota: { value: QUOTA, source: 'global' } } } : { values: {} };
        },
      });
    },
  };
  return plugin;
}

async function boot(mode: 'factory' | 'value', cache: unknown) {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true });
  const host = hostPlugin(mode, cache);
  await kernel.use(host);
  await kernel.use(new SmsServicePlugin());
  await kernel.bootstrap();
  return { kernel, ctx: host.ctx!, sms: kernel.getService<SmsService>('sms') };
}

const dayKeys = (store: Map<string, unknown>): string[] => [...store.keys()].filter((k) => k.startsWith('sms-daily-sends:'));

describe('daily SMS quota — counts in the registered cache', () => {
  it('`cache` registered by FACTORY: the day counter lives in it, and a concurrent burst spends exactly the quota', async () => {
    const cache = makeCache();
    const { ctx, sms } = await boot('factory', cache);
    await expect(resolveKernelCache(ctx)).resolves.toBe(cache);

    const results = await Promise.all(
      Array.from({ length: BURST }, () => sms.send({ to: '+15550000001', body: 'code 123456' })),
    );
    expect(results.filter((r) => r.status !== 'failed')).toHaveLength(QUOTA);
    const [dayKey] = dayKeys(cache.store);
    expect(dayKey).toBeDefined();
    // Every send of the burst was counted in the cache, none lost to a stale read.
    expect(JSON.parse(cache.store.get(dayKey!) as string)).toMatchObject({ n: BURST });
  });

  it("the kernel's own `degraded` stand-in is not counted in: the counter keeps the bounded fallback", async () => {
    const standIn = createMemoryCache();
    const { ctx, sms } = await boot('value', standIn);
    await expect(resolveKernelCache(ctx)).resolves.toBeUndefined();

    const results = await Promise.all(
      Array.from({ length: BURST }, () => sms.send({ to: '+15550000002', body: 'code 123456' })),
    );
    expect(results.filter((r) => r.status !== 'failed')).toHaveLength(QUOTA);
    expect((await standIn.stats()).keyCount).toBe(0);
  });
});
