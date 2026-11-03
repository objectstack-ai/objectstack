// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The rule these pin (ADR-0069 D2): inside one process, a counter admits no
 * more than its limit however many requests for one key arrive at once.
 *
 * - The fixed-window limit of `max` admits exactly `max` of a concurrent burst
 *   against one key — in the per-process store AND in the kernel cache, whose
 *   read and write are separate awaited calls just the same.
 * - The OTP send history grants a number no more sends than its cooldown and
 *   hourly cap allow, however many checks for it arrive at once.
 * - Serialisation is per KEY: other keys keep counting concurrently, a failing
 *   update releases the next one, and nothing is left behind once a burst has
 *   drained.
 *
 * better-auth's own `consume` contract states the same rule ("N simultaneous
 * requests can no longer all pass a stale read before any increment lands").
 */

import { describe, expect, it } from 'vitest';
import type { BetterAuthRateLimitStorage } from '@better-auth/core';

import { OtpSendGuard } from './otp-send-guard.js';
import { serializePerKey, serializedKeysInFlight } from './per-key-serial.js';
import {
  createLazyCacheRateLimitStorage,
  incrementFixedWindow,
  InProcessCounterStore,
  type CounterStore,
} from './rate-limit-storage.js';

const BURST = 20;
const RULE = { window: 10, max: 3 } as const;

/** A cache stand-in whose reads and writes each cross a macrotask, as a networked store's do. */
function makeNetworkedCache(): CounterStore & { readonly store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  const hop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    store,
    async get<T = unknown>(key: string): Promise<T | undefined> {
      await hop();
      return store.get(key) as T | undefined;
    },
    async set<T = unknown>(key: string, value: T): Promise<void> {
      await hop();
      store.set(key, value);
    },
  };
}

/** Fire `BURST` concurrent consumes against one key; answer how many were admitted. */
async function admittedOfBurst(storage: BetterAuthRateLimitStorage, key: string): Promise<number> {
  const decisions = await Promise.all(Array.from({ length: BURST }, () => storage.consume(key, RULE)));
  return decisions.filter((d) => d.allowed).length;
}

describe('a concurrent burst against one key admits exactly the limit (one process)', () => {
  it('per-process store (no cache service): exactly `max` of the burst are admitted', async () => {
    const storage = createLazyCacheRateLimitStorage({ resolveCache: async () => undefined });
    expect(await admittedOfBurst(storage, 'burst:fallback')).toBe(RULE.max);
  });

  it('kernel cache: exactly `max` of the burst are admitted, and the stored count is the burst size', async () => {
    const cache = makeNetworkedCache();
    const storage = createLazyCacheRateLimitStorage({ resolveCache: async () => cache });
    expect(await admittedOfBurst(storage, 'burst:cache')).toBe(RULE.max);
    // Every request of the burst was counted — none was lost to a stale read.
    expect(JSON.parse(cache.store.get('burst:cache') as string)).toMatchObject({ n: BURST });
  });

  it('incrementFixedWindow hands a concurrent burst the counts 1…N, each exactly once', async () => {
    const store = new InProcessCounterStore();
    const t0 = 1_000_000;
    const counts = await Promise.all(
      Array.from({ length: BURST }, () => incrementFixedWindow(store, 'burst:counts', 60, t0)),
    );
    expect(counts.map((c) => c.count)).toEqual(Array.from({ length: BURST }, (_, i) => i + 1));
    expect(new Set(counts.map((c) => c.resetAt))).toEqual(new Set([t0 + 60_000]));
  });

  it('a burst against one key does not hold up another key', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const inner = new InProcessCounterStore();
    const store: CounterStore = {
      async get<T = unknown>(key: string): Promise<T | undefined> {
        if (key === 'held') await gate;
        return inner.get<T>(key);
      },
      set: (key, value, ttl) => inner.set(key, value, ttl),
    };
    const held = incrementFixedWindow(store, 'held', 60);
    // `free` completes while `held` is still parked inside its read.
    await expect(incrementFixedWindow(store, 'free', 60)).resolves.toMatchObject({ count: 1 });
    release();
    await expect(held).resolves.toMatchObject({ count: 1 });
  });
});

describe('the OTP send history holds its budget under a concurrent burst for one number', () => {
  it('cooldown: exactly one of a burst of sends to one number is granted', async () => {
    const guard = new OtpSendGuard({ cooldownSeconds: 60, maxPerHour: 0, now: () => 5_000_000 });
    const decisions = await Promise.all(Array.from({ length: BURST }, () => guard.checkAndRecord('+15550100')));
    expect(decisions.filter((d) => d.ok)).toHaveLength(1);
  });

  it('hourly cap: exactly `maxPerHour` of a burst are granted when there is no cooldown', async () => {
    let t = 5_000_000;
    const guard = new OtpSendGuard({ cooldownSeconds: 0, maxPerHour: 3, now: () => (t += 1) });
    const decisions = await Promise.all(Array.from({ length: BURST }, () => guard.checkAndRecord('+15550101')));
    expect(decisions.filter((d) => d.ok)).toHaveLength(3);
  });

  it('the shared cache path holds the cooldown too', async () => {
    const cache = makeNetworkedCache();
    const guard = new OtpSendGuard({ cooldownSeconds: 60, maxPerHour: 5, now: () => 5_000_000, resolveStore: async () => cache });
    const decisions = await Promise.all(Array.from({ length: BURST }, () => guard.checkAndRecord('+15550102')));
    expect(decisions.filter((d) => d.ok)).toHaveLength(1);
  });
});

describe('serializePerKey — ordering, failure release and bound', () => {
  it('a failing update reaches only its own caller and releases the next one', async () => {
    const order: string[] = [];
    const first = serializePerKey('k:fail', async () => {
      order.push('first');
      throw new Error('store unavailable');
    });
    const second = serializePerKey('k:fail', async () => {
      order.push('second');
      return 'ok';
    });
    await expect(first).rejects.toThrow('store unavailable');
    await expect(second).resolves.toBe('ok');
    expect(order).toEqual(['first', 'second']);
  });

  it('leaves no key behind once a burst has drained', async () => {
    const storage = createLazyCacheRateLimitStorage({ resolveCache: async () => undefined });
    await admittedOfBurst(storage, 'burst:drain');
    // The cleanup runs one microtask after the last update settles.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(serializedKeysInFlight()).toBe(0);
  });
});
