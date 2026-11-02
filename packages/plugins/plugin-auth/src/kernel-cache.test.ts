// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2): when a `cache` service is registered — as
 * a value or as a factory — the auth counters count in it; only when none is
 * registered do they fall back to the per-process store.
 *
 * Measured against REAL kernels, never a hand-built context: a mocked context
 * can carry any member it likes, including one the kernel never hands a
 * plugin, and a test against it passes while production counts elsewhere.
 *
 * - `resolveKernelCache` against an `ObjectKernel` context (factory, value,
 *   none, not a store, the kernel's own `degraded` stand-in) and a
 *   `LiteKernel` context (value).
 * - The composed stack — SQL driver, ObjectQL, `AuthPlugin`, a `cache`
 *   registered by FACTORY — writes the rate-limit counter into that cache,
 *   admits exactly `max` of a concurrent burst against one key while counting
 *   there, and hands the OTP budget and the invitation preview the same store.
 * - The composed stack with NO cache plugin: the kernel injects its own
 *   in-memory stand-in, and the counters keep the package's bounded
 *   per-process store instead of counting in it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMemoryCache, LiteKernel, ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { readServiceSelfInfo } from '@objectstack/spec/api';
import { ObjectQLPlugin } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';

import { AuthPlugin } from './auth-plugin.js';
import type { AuthManager } from './auth-manager.js';
import { resolveKernelCache } from './kernel-cache.js';
import { InProcessCounterStore, type CounterStore } from './rate-limit-storage.js';

/** A counter-capable cache: an `InProcessCounterStore` is exactly the slice the counters use. */
const makeCache = (): CounterStore => new InProcessCounterStore();

/** A plugin that registers `cache` the way the test asks, and keeps the context it was handed. */
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
  // No data plane here, so the system-requirement pass (which also injects the
  // kernel's own `cache` stand-in) is skipped: "none" really is none.
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false, skipSystemValidation: true });
  const plugin = cachePlugin(mode, cache);
  await kernel.use(plugin);
  await kernel.bootstrap();
  return plugin.ctx!;
}

describe('resolveKernelCache — through the accessors a plugin context really carries', () => {
  it('ObjectKernel, `cache` registered by FACTORY: answers the factory-built cache', async () => {
    const cache = makeCache();
    const ctx = await objectKernelContext('factory', cache);
    // The synchronous accessor cannot answer a factory that has not been built.
    expect(() => ctx.getService('cache')).toThrow('is async');
    await expect(resolveKernelCache(ctx)).resolves.toBe(cache);
  });

  it('ObjectKernel, `cache` registered as a VALUE: answers that value', async () => {
    const cache = makeCache();
    const ctx = await objectKernelContext('value', cache);
    await expect(resolveKernelCache(ctx)).resolves.toBe(cache);
  });

  it('ObjectKernel, no `cache` registered: answers undefined (the per-process fallback is right)', async () => {
    const ctx = await objectKernelContext('none', undefined);
    await expect(resolveKernelCache(ctx)).resolves.toBeUndefined();
  });

  it("the kernel's own in-memory stand-in (self-described `degraded`): answers undefined", async () => {
    const standIn = createMemoryCache();
    expect(readServiceSelfInfo(standIn)?.status).toBe('degraded');
    const ctx = await objectKernelContext('value', standIn);
    await expect(resolveKernelCache(ctx)).resolves.toBeUndefined();
  });

  it('a registered `cache` without get/set is not a counter store: answers undefined', async () => {
    const ctx = await objectKernelContext('value', { stats: () => ({}) });
    await expect(resolveKernelCache(ctx)).resolves.toBeUndefined();
  });

  it('LiteKernel (no getServiceAsync, no factories), `cache` as a VALUE: answers that value', async () => {
    const cache = makeCache();
    const kernel = new LiteKernel({ logger: { level: 'silent' } });
    const plugin = cachePlugin('value', cache);
    kernel.use(plugin);
    await kernel.bootstrap();
    await expect(resolveKernelCache(plugin.ctx!)).resolves.toBe(cache);
  });
});

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

type ConsumeStorage = { consume: (key: string, rule: { window: number; max: number }) => Promise<{ allowed: boolean }> };
type CounterConfig = { rateLimitStorage: ConsumeStorage; sharedCounterStore: () => Promise<CounterStore> };

/** Boot SQL driver + ObjectQL (+ the given cache plugin) + AuthPlugin, with the kernel's system pass ON. */
async function bootStack(extra: Plugin[]): Promise<{ kernel: ObjectKernel; auth: AuthPlugin; config: CounterConfig }> {
  const kernel = new ObjectKernel({ logger: { level: 'silent' }, gracefulShutdown: false });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  for (const p of extra) await kernel.use(p);
  const auth = new AuthPlugin({ secret: 'test-secret-at-least-32-chars-long-29053', baseUrl: 'http://localhost:3000' });
  await kernel.use(auth);
  await kernel.bootstrap();
  const manager = kernel.getService<AuthManager>('auth');
  return { kernel, auth, config: (manager as unknown as { config: CounterConfig }).config };
}

const previewCounters = (auth: AuthPlugin): (() => Promise<CounterStore>) =>
  (auth as unknown as { invitationPreviewCounters: () => Promise<CounterStore> }).invitationPreviewCounters;

describe('on the composed stack, the auth counters count in a cache registered by factory', () => {
  let kernel: ObjectKernel;
  let auth: AuthPlugin;
  let config: CounterConfig;
  const cache = makeCache();

  beforeAll(async () => {
    ({ kernel, auth, config } = await bootStack([cachePlugin('factory', cache)]));
  });

  afterAll(async () => {
    await kernel?.shutdown().catch(() => undefined);
  });

  it('the rate limiter writes its counter into the registered cache', async () => {
    await expect(config.rateLimitStorage.consume('wiring:first', { window: 10, max: 3 })).resolves.toMatchObject({ allowed: true });
    expect(await cache.get('wiring:first')).toBeDefined();
  });

  it('a concurrent burst against one key admits exactly `max` while counting in that cache', async () => {
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => config.rateLimitStorage.consume('wiring:burst', { window: 10, max: 3 })),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
    expect(JSON.parse((await cache.get<string>('wiring:burst'))!)).toMatchObject({ n: 20 });
  });

  it('the OTP send budget and the invitation preview resolve the same cache', async () => {
    await expect(config.sharedCounterStore()).resolves.toBe(cache);
    await expect(previewCounters(auth)()).resolves.toBe(cache);
  });
});

describe("on the composed stack with no cache plugin, the counters keep the bounded per-process store", () => {
  let kernel: ObjectKernel;
  let auth: AuthPlugin;
  let config: CounterConfig;

  beforeAll(async () => {
    ({ kernel, auth, config } = await bootStack([]));
  });

  afterAll(async () => {
    await kernel?.shutdown().catch(() => undefined);
  });

  it("the kernel's own `degraded` stand-in is there, and the counters do not count in it", async () => {
    // Control: the kernel really did inject a `cache` — this case is not vacuous.
    const standIn = await kernel.getServiceAsync<unknown>('cache');
    expect(readServiceSelfInfo(standIn)?.status).toBe('degraded');

    const store = await config.sharedCounterStore();
    expect(store).toBeInstanceOf(InProcessCounterStore);
    expect(store).not.toBe(standIn);
    await expect(previewCounters(auth)()).resolves.toBeInstanceOf(InProcessCounterStore);

    const decisions = await Promise.all(
      Array.from({ length: 20 }, () => config.rateLimitStorage.consume('fallback:burst', { window: 10, max: 3 })),
    );
    expect(decisions.filter((d) => d.allowed)).toHaveLength(3);
    expect(await (standIn as CounterStore).get('fallback:burst')).toBeUndefined();
  });
});
