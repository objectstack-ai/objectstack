// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi } from 'vitest';
import { OtpSendGuard, type OtpGuardStorage } from './otp-send-guard.js';
import { createLazyCounterStore } from './rate-limit-storage.js';

const PHONE = '+8613800000000';

function clock(start = 1_000_000) {
  let now = start;
  return { now: () => now, advance: (ms: number) => { now += ms; } };
}

describe('OtpSendGuard', () => {
  it('allows the first send and enforces the cooldown on the second', async () => {
    const c = clock();
    const guard = new OtpSendGuard({ cooldownSeconds: 60, maxPerHour: 5, now: c.now });

    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    const denied = await guard.checkAndRecord(PHONE);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.retryAfterSeconds).toBeLessThanOrEqual(60);

    c.advance(61_000);
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
  });

  it('tracks numbers independently', async () => {
    const c = clock();
    const guard = new OtpSendGuard({ cooldownSeconds: 60, now: c.now });
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    expect((await guard.checkAndRecord('+15005550006')).ok).toBe(true);
  });

  it('enforces the rolling hourly cap even outside the cooldown', async () => {
    const c = clock();
    const guard = new OtpSendGuard({ cooldownSeconds: 1, maxPerHour: 3, now: c.now });
    for (let i = 0; i < 3; i++) {
      expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
      c.advance(2_000);
    }
    const denied = await guard.checkAndRecord(PHONE);
    expect(denied.ok).toBe(false);

    // The window rolls: an hour after the FIRST send, one slot frees up.
    c.advance(3_600_000 - 4_000);
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
  });

  it('0 disables both dimensions', async () => {
    const guard = new OtpSendGuard({ cooldownSeconds: 0, maxPerHour: 0 });
    for (let i = 0; i < 10; i++) {
      expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    }
  });

  it('uses the shared storage when provided (cross-node)', async () => {
    const c = clock();
    const kv = new Map<string, string>();
    const storage: OtpGuardStorage = {
      get: (k) => kv.get(k) ?? null,
      set: (k, v) => { kv.set(k, v); },
    };
    const nodeA = new OtpSendGuard({ cooldownSeconds: 60, storage, now: c.now });
    const nodeB = new OtpSendGuard({ cooldownSeconds: 60, storage, now: c.now });

    expect((await nodeA.checkAndRecord(PHONE)).ok).toBe(true);
    // A different node sees the same budget.
    expect((await nodeB.checkAndRecord(PHONE)).ok).toBe(false);
  });

  it('fails OPEN when the storage breaks (throttle must not take sign-in down)', async () => {
    const storage: OtpGuardStorage = {
      get: () => { throw new Error('redis down'); },
      set: () => { throw new Error('redis down'); },
    };
    const guard = new OtpSendGuard({ cooldownSeconds: 60, storage });
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
  });
});

// ── #4790 — WHERE the budget is counted ─────────────────────────────────────
//
// The budget was shared across nodes only when a host supplied better-auth's
// `secondaryStorage`, which the standard `serve` composition never does — so
// the declared per-number cap was really cap×N in an N-node deployment, and
// nothing said so. Same defect class as #4772's rate-limit counters, and now
// the same cure: the store is resolved lazily, per check, from the kernel
// `cache` service.
describe('OtpSendGuard — where the budget is counted (#4790)', () => {
  /** Minimal in-memory ICacheService stand-in (no TTL eviction — tests drive the clock). */
  const makeCache = () => {
    const store = new Map<string, unknown>();
    return {
      store,
      get: vi.fn(async (k: string) => (store.has(k) ? store.get(k) : undefined)),
      set: vi.fn(async (k: string, v: unknown, _ttl?: number) => { store.set(k, v); }),
    };
  };
  const makeLogger = () => ({ info: vi.fn(), warn: vi.fn() });
  const OTP_SUBJECT = 'per-number OTP send budget (#2780)';

  it('resolves the store at CHECK time — a cache registered AFTER the guard is still used', async () => {
    // The exact ordering that made #4772 permanent: plugin-auth builds the
    // guard during init(), CacheServicePlugin registers `cache` afterwards.
    const c = clock();
    const cache = makeCache();
    let registered = false;
    const logger = makeLogger();
    const guard = new OtpSendGuard({
      cooldownSeconds: 60,
      now: c.now,
      resolveStore: createLazyCounterStore({
        resolveCache: async () => (registered ? (cache as any) : undefined),
        logger,
        subject: OTP_SUBJECT,
      }),
    });

    registered = true; // …21ms later, in a showcase cold start.

    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    // The send really was recorded in the shared store, not in this process.
    expect(cache.store.size).toBe(1);
    expect([...cache.store.keys()][0]).toBe(`phone-otp-sends:${PHONE}`);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.info.mock.calls[0][0]).toContain(`${OTP_SUBJECT} bound to the kernel cache service`);
  });

  it('is ONE budget across nodes when the cache is shared', async () => {
    const c = clock();
    const cache = makeCache();
    // Two nodes = two processes = two resolvers over one cache.
    const nodeStore = () =>
      createLazyCounterStore({ resolveCache: async () => cache as any, subject: OTP_SUBJECT });
    const nodeA = new OtpSendGuard({ cooldownSeconds: 60, maxPerHour: 5, now: c.now, resolveStore: nodeStore() });
    const nodeB = new OtpSendGuard({ cooldownSeconds: 60, maxPerHour: 5, now: c.now, resolveStore: nodeStore() });

    expect((await nodeA.checkAndRecord(PHONE)).ok).toBe(true);
    // Rotating to another node does NOT buy a fresh cooldown — the point of #4790.
    const denied = await nodeB.checkAndRecord(PHONE);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);

    // …and the hourly cap is one cap, spent from either node.
    c.advance(61_000);
    for (const node of [nodeA, nodeB, nodeA, nodeB]) {
      expect((await node.checkAndRecord(PHONE)).ok).toBe(true);
      c.advance(61_000);
    }
    expect((await nodeA.checkAndRecord(PHONE)).ok).toBe(false);
    expect(cache.store.size).toBe(1);
  });

  it('without any cache service the budget is DEGRADED, not disabled — and said out loud', async () => {
    const c = clock();
    const logger = makeLogger();
    const guard = new OtpSendGuard({
      cooldownSeconds: 60,
      now: c.now,
      resolveStore: createLazyCounterStore({
        resolveCache: async () => undefined,
        logger,
        subject: OTP_SUBJECT,
        degradedImpact: 'up to N× the configured number of PAID SMS (#4790)',
      }),
    });

    // Nothing is logged until a send is actually checked.
    expect(logger.warn).not.toHaveBeenCalled();

    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(false); // still enforced, in-process
    expect((await guard.checkAndRecord('+15005550006')).ok).toBe(true);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = logger.warn.mock.calls[0][0] as string;
    expect(msg).toContain(OTP_SUBJECT);
    expect(msg).toContain('per-process store');
    expect(msg).toContain('PAID SMS');
    // The two cases must be distinguishable: bound → info, degraded → warn.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('an explicit resolveStore wins over a host KV, as the option documents', async () => {
    const c = clock();
    const cache = makeCache();
    const kv = new Map<string, string>();
    const storage: OtpGuardStorage = {
      get: (k) => kv.get(k) ?? null,
      set: (k, v) => { kv.set(k, v); },
    };
    const guard = new OtpSendGuard({
      cooldownSeconds: 60,
      storage,
      resolveStore: async () => cache as any,
      now: c.now,
    });
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    expect(cache.store.size).toBe(1);
    expect(kv.size).toBe(0);
  });

  it('fails OPEN when the resolved store breaks mid-flight', async () => {
    const guard = new OtpSendGuard({
      cooldownSeconds: 60,
      resolveStore: async () => ({
        get: async () => { throw new Error('redis down'); },
        set: async () => { throw new Error('redis down'); },
      }),
    });
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(true);
  });

  it('reads a history handed back as an array (memory cache) as well as a string (Redis)', async () => {
    const c = clock();
    const cache = makeCache();
    // The memory cache adapter returns the stored value as-is.
    cache.store.set(`phone-otp-sends:${PHONE}`, [c.now() - 1_000]);
    const guard = new OtpSendGuard({
      cooldownSeconds: 60,
      now: c.now,
      resolveStore: async () => cache as any,
    });
    expect((await guard.checkAndRecord(PHONE)).ok).toBe(false);
  });
});
