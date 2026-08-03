// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import {
  createLazyCacheRateLimitStorage,
  createLazyCounterStore,
  incrementFixedWindow,
  InProcessCounterStore,
} from './rate-limit-storage.js';

/** Minimal in-memory ICacheService stand-in (no TTL eviction — tests drive the clock). */
function makeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : undefined)),
    set: vi.fn(async (k: string, v: unknown, _ttl?: number) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => store.delete(k)),
    has: vi.fn(async (k: string) => store.has(k)),
    clear: vi.fn(async () => store.clear()),
    stats: vi.fn(async () => ({ hits: 0, misses: 0, keys: store.size })),
  };
}

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn() });

describe('incrementFixedWindow (ADR-0069 D2 — one counting algorithm, any store)', () => {
  it('creates the window at 1 and reports when it resets', async () => {
    const cache = makeCache();
    const t0 = 1_000_000;
    const r = await incrementFixedWindow(cache as any, 'ip:1', 60, t0);
    expect(r.count).toBe(1);
    expect(r.resetAt).toBe(t0 + 60_000);
    expect(cache.set).toHaveBeenCalledWith('ip:1', JSON.stringify({ n: 1, exp: t0 + 60_000 }), 60);
  });

  it('does NOT slide the window forward on later increments', async () => {
    const cache = makeCache();
    const t0 = 1_000_000;
    await incrementFixedWindow(cache as any, 'ip:1', 60, t0);
    const second = await incrementFixedWindow(cache as any, 'ip:1', 60, t0 + 30_000);
    expect(second.count).toBe(2);
    // Window end unchanged; only the REMAINING seconds are handed to the store.
    expect(second.resetAt).toBe(t0 + 60_000);
    expect(cache.set).toHaveBeenLastCalledWith('ip:1', JSON.stringify({ n: 2, exp: t0 + 60_000 }), 30);
  });

  it('restarts the window once it has elapsed', async () => {
    const cache = makeCache();
    const t0 = 1_000_000;
    await incrementFixedWindow(cache as any, 'ip:1', 60, t0);
    const later = await incrementFixedWindow(cache as any, 'ip:1', 60, t0 + 60_001);
    expect(later.count).toBe(1);
  });

  it('treats a foreign / unparseable value under the key as absent', async () => {
    const cache = makeCache();
    cache.store.set('ip:1', 'not json');
    const r = await incrementFixedWindow(cache as any, 'ip:1', 60, 1_000_000);
    expect(r.count).toBe(1);
  });

  it('accepts an object-valued read back (memory adapter) as well as a string (Redis)', async () => {
    const cache = makeCache();
    const t0 = 1_000_000;
    cache.store.set('ip:1', { n: 4, exp: t0 + 60_000 });
    const r = await incrementFixedWindow(cache as any, 'ip:1', 60, t0);
    expect(r.count).toBe(5);
  });
});

describe('createLazyCacheRateLimitStorage — cache present (#4772 acceptance 1)', () => {
  it('counts in the kernel cache and never warns', async () => {
    const cache = makeCache();
    const logger = makeLogger();
    const storage = createLazyCacheRateLimitStorage({
      resolveCache: async () => cache as any,
      logger,
    });

    const first = await storage.consume('ip:203.0.113.7', { window: 60, max: 2 });
    expect(first).toEqual({ allowed: true, retryAfter: null });
    // The counter really lives in the shared store, not in this process.
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);

    await storage.consume('ip:203.0.113.7', { window: 60, max: 2 });
    const third = await storage.consume('ip:203.0.113.7', { window: 60, max: 2 });
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain('rate-limit counters bound to the kernel cache service');
  });

  it('resolves the cache once and reuses the handle', async () => {
    const cache = makeCache();
    const resolveCache = vi.fn(async () => cache as any);
    const storage = createLazyCacheRateLimitStorage({ resolveCache });
    await storage.consume('k', { window: 60, max: 10 });
    await storage.consume('k', { window: 60, max: 10 });
    expect(resolveCache).toHaveBeenCalledTimes(1);
  });
});

// The bug this module exists for: AuthPlugin.init() runs BEFORE
// CacheServicePlugin registers `cache`. The old eager probe froze the "no
// cache" answer for the process, so the counters never reached the shared
// store even after it came up.
describe('createLazyCacheRateLimitStorage — cache registered AFTER auth (#4772 acceptance 3)', () => {
  it('picks the shared cache up on the first consume that follows registration', async () => {
    const cache = makeCache();
    let registered = false;
    const logger = makeLogger();
    const storage = createLazyCacheRateLimitStorage({
      resolveCache: async () => (registered ? (cache as any) : undefined),
      logger,
    });

    // Counter consumed while `cache` is still unregistered → per-process fallback.
    await storage.consume('ip:198.51.100.9', { window: 60, max: 5 });
    expect(cache.store.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledTimes(1);

    // CacheServicePlugin registers the service.
    registered = true;

    // The very next counter is consumed from the SHARED store — this is the
    // assertion the eager probe could never satisfy.
    const after = await storage.consume('ip:198.51.100.9', { window: 60, max: 5 });
    expect(after.allowed).toBe(true);
    expect(cache.set).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toContain('bound to the kernel cache service');

    // …and it stays there.
    await storage.consume('ip:198.51.100.9', { window: 60, max: 5 });
    expect(JSON.parse(cache.store.get('ip:198.51.100.9') as string).n).toBe(2);
  });

  it('stops warning once the cache is there (the warn is a live signal, not a boot artifact)', async () => {
    const cache = makeCache();
    let registered = false;
    const logger = makeLogger();
    const storage = createLazyCacheRateLimitStorage({
      resolveCache: async () => (registered ? (cache as any) : undefined),
      logger,
    });
    await storage.consume('k', { window: 60, max: 10 });
    registered = true;
    await storage.consume('k', { window: 60, max: 10 });
    await storage.consume('k', { window: 60, max: 10 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe('createLazyCacheRateLimitStorage — no cache service at all (#4772 acceptance 2)', () => {
  it('warns exactly once, at counting time, and says what is actually wrong', async () => {
    const logger = makeLogger();
    const storage = createLazyCacheRateLimitStorage({
      resolveCache: async () => undefined,
      logger,
    });

    // Nothing is logged until a counter is actually consumed — a deployment
    // that never rate-limits is not warned about a store it never needs.
    expect(logger.warn).not.toHaveBeenCalled();

    await storage.consume('k', { window: 60, max: 10 });
    await storage.consume('k', { window: 60, max: 10 });
    await storage.consume('other', { window: 60, max: 10 });

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = logger.warn.mock.calls[0][0] as string;
    expect(msg).toContain('no `cache` service registered at all');
    expect(msg).toContain('per-process store');
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('still enforces the limit in-process — degraded, never disabled', async () => {
    const storage = createLazyCacheRateLimitStorage({ resolveCache: async () => undefined });
    expect((await storage.consume('ip:a', { window: 60, max: 2 })).allowed).toBe(true);
    expect((await storage.consume('ip:a', { window: 60, max: 2 })).allowed).toBe(true);
    const third = await storage.consume('ip:a', { window: 60, max: 2 });
    expect(third.allowed).toBe(false);
    expect(third.retryAfter).toBeGreaterThan(0);
    // Independent keys keep independent windows.
    expect((await storage.consume('ip:b', { window: 60, max: 2 })).allowed).toBe(true);
  });

  it('treats a throwing resolver as "no cache right now" rather than failing the request', async () => {
    const logger = makeLogger();
    const storage = createLazyCacheRateLimitStorage({
      resolveCache: async () => { throw new Error('service registry exploded'); },
      logger,
    });
    await expect(storage.consume('k', { window: 60, max: 10 })).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('survives a logger with no warn/info methods', async () => {
    const storage = createLazyCacheRateLimitStorage({
      resolveCache: async () => undefined,
      logger: {},
    });
    await expect(storage.consume('k', { window: 1, max: 1 })).resolves.toBeTruthy();
  });
});

// #4790 — the resolution half, extracted so ObjectStack's OWN counters (the
// #2780 per-number OTP send budget) reach the shared cache through the same
// path as better-auth's, instead of a second copy of it.
describe('createLazyCounterStore (#4790 — one lazy resolution, many counters)', () => {
  it('names the subject in both log lines, so two degraded budgets are distinguishable', async () => {
    const logger = makeLogger();
    const resolve = createLazyCounterStore({
      resolveCache: async () => undefined,
      logger,
      subject: 'per-number OTP send budget (#2780)',
      degradedImpact: 'an N-node deployment can send N× the configured PAID SMS',
    });
    await resolve();
    const warned = logger.warn.mock.calls[0][0] as string;
    expect(warned).toContain('per-number OTP send budget (#2780)');
    expect(warned).toContain('no `cache` service registered at all');
    expect(warned).toContain('N× the configured PAID SMS');

    const bound = createLazyCounterStore({
      resolveCache: async () => makeCache() as any,
      logger,
      subject: 'per-number OTP send budget (#2780)',
    });
    await bound();
    expect(logger.info.mock.calls[0][0]).toContain(
      'per-number OTP send budget (#2780) bound to the kernel cache service',
    );
  });

  it('hands back ONE fallback instance, so the degraded path still counts per node', async () => {
    const resolve = createLazyCounterStore({ resolveCache: async () => undefined, subject: 'x' });
    const first = await resolve();
    const second = await resolve();
    expect(first).toBe(second);
    expect(first).toBeInstanceOf(InProcessCounterStore);
  });

  it('keeps asking until the cache is there, then memoises it', async () => {
    const cache = makeCache();
    let registered = false;
    const resolveCache = vi.fn(async () => (registered ? (cache as any) : undefined));
    const resolve = createLazyCounterStore({ resolveCache, subject: 'x' });

    expect(await resolve()).toBeInstanceOf(InProcessCounterStore);
    registered = true;
    expect(await resolve()).toBe(cache);
    await resolve();
    // One miss + one hit; once resolved the handle is never looked up again.
    expect(resolveCache).toHaveBeenCalledTimes(2);
  });

  it('warns once and survives a logger without warn/info', async () => {
    const logger = makeLogger();
    const resolve = createLazyCounterStore({ resolveCache: async () => undefined, logger, subject: 'x' });
    await resolve();
    await resolve();
    expect(logger.warn).toHaveBeenCalledTimes(1);

    const bare = createLazyCounterStore({ resolveCache: async () => undefined, logger: {}, subject: 'x' });
    await expect(bare()).resolves.toBeInstanceOf(InProcessCounterStore);
  });

  it('treats a throwing resolver as "no shared store right now"', async () => {
    const resolve = createLazyCounterStore({
      resolveCache: async () => { throw new Error('service registry exploded'); },
      subject: 'x',
    });
    await expect(resolve()).resolves.toBeInstanceOf(InProcessCounterStore);
  });
});

describe('InProcessCounterStore (the degraded path)', () => {
  it('expires entries on read', async () => {
    const store = new InProcessCounterStore();
    await store.set('k', 'v', 1);
    expect(await store.get('k')).toBe('v');
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2000);
      expect(await store.get('k')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('prunes expired entries instead of growing without bound', async () => {
    const store = new InProcessCounterStore();
    await store.set('a', 1, 1);
    expect(store.size).toBe(1);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(Date.now() + 2000);
      await store.set('b', 2, 60);
      expect(store.size).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
