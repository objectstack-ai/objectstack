// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { BetterAuthRateLimitStorage } from '@better-auth/core';

/**
 * The slice of `ICacheService` a fixed-window counter needs. Declared
 * structurally so the in-process fallback below satisfies the SAME contract
 * the kernel cache does — one counting algorithm, two backing stores, no
 * second code path that can drift.
 */
export interface CounterStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T, ttl?: number): Promise<void>;
}

/** The window envelope a counter stores: `n` requests so far, window ends at `exp` (epoch ms). */
interface Counter {
  n: number;
  exp: number;
}

/** Outcome of one increment: the POST-increment count and when the window frees up. */
export interface FixedWindowCount {
  count: number;
  /** Epoch ms at which the current window expires. */
  resetAt: number;
}

/**
 * Read back a counter envelope. Cache adapters differ on whether they hand
 * values back as the stored string (Redis) or as the original object (memory),
 * so both are accepted. Anything else — a legacy or foreign value under the
 * key — is treated as absent, which restarts the window rather than throwing
 * on an auth request.
 */
function parseCounter(raw: unknown): Counter | null {
  if (raw === undefined || raw === null) return null;
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const { n, exp } = value as Partial<Counter>;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  return { n, exp };
}

/**
 * Fixed-window counter over any {@link CounterStore}.
 *
 * Contract: return the POST-increment count; create the key at 1 with
 * `windowSeconds` when absent or expired; never extend the window on later
 * increments, so the counter expires a fixed window after it was FIRST
 * created rather than sliding forward on every request.
 *
 * `set` always (re)sets the TTL, so the window end travels with the value and
 * each re-set is given only the REMAINING seconds. The envelope is private to
 * this module — every reader goes through {@link parseCounter}.
 *
 * Without an atomic INCR this stays read-modify-write: two nodes can read the
 * same count and both admit a request, so a limit can over-admit slightly
 * under concurrency. That is strictly better than per-node independent
 * counters (ADR-0069 D2); a cache adapter that grows an atomic INCR should be
 * plumbed through `ICacheService` and used here.
 */
export async function incrementFixedWindow(
  store: CounterStore,
  key: string,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<FixedWindowCount> {
  const ttl = Math.max(1, Math.floor(windowSeconds) || 1);
  const current = parseCounter(await store.get<unknown>(key));

  if (!current || current.exp <= now) {
    const exp = now + ttl * 1000;
    await store.set(key, JSON.stringify({ n: 1, exp }), ttl);
    return { count: 1, resetAt: exp };
  }

  const n = current.n + 1;
  const remaining = Math.max(1, Math.ceil((current.exp - now) / 1000));
  await store.set(key, JSON.stringify({ n, exp: current.exp }), remaining);
  return { count: n, resetAt: current.exp };
}

/**
 * The per-process fallback store. Deliberately NOT better-auth's own memory
 * storage: `customStorage` replaces better-auth's storage selection wholesale,
 * so the degraded path has to count somewhere, and counting here keeps ONE
 * algorithm across both stores (a divergent fallback is how "it works in
 * tests, not in prod" happens).
 *
 * Bounded: expired entries are pruned on write, and the map is cleared if it
 * ever exceeds {@link MAX_FALLBACK_KEYS} live keys — an unbounded per-IP map is
 * a memory-exhaustion vector on exactly the endpoint being attacked.
 */
const MAX_FALLBACK_KEYS = 10_000;

export class InProcessCounterStore implements CounterStore {
  private readonly entries = new Map<string, { value: unknown; exp: number }>();

  async get<T = unknown>(key: string): Promise<T | undefined> {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.exp <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value as T;
  }

  async set<T = unknown>(key: string, value: T, ttl?: number): Promise<void> {
    this.prune();
    this.entries.set(key, { value, exp: Date.now() + Math.max(1, Math.floor(ttl ?? 60)) * 1000 });
  }

  private prune(): void {
    const now = Date.now();
    for (const [k, v] of this.entries) if (v.exp <= now) this.entries.delete(k);
    if (this.entries.size > MAX_FALLBACK_KEYS) this.entries.clear();
  }

  /** @internal test seam */
  get size(): number {
    return this.entries.size;
  }
}

type LoggerLike = {
  info?(msg: string): void;
  warn?(msg: string): void;
};

export interface LazyCacheRateLimitStorageOptions {
  /**
   * Resolve the kernel `cache` service. Called at COUNTING time, not at plugin
   * init — see the class comment on {@link createLazyCacheRateLimitStorage}.
   * Returning `undefined` (or throwing) means "no shared cache right now".
   */
  resolveCache: () => Promise<CounterStore | undefined>;
  logger?: LoggerLike;
}

/**
 * ADR-0069 D2 — better-auth `rateLimit.customStorage` backed by the kernel
 * `cache` service, resolved **lazily, at the moment a counter is consumed**.
 *
 * Why lazy (#4772): `AuthPlugin.init()` runs BEFORE `CacheServicePlugin`
 * registers the `cache` service (21ms earlier in a showcase cold start), so a
 * probe taken at init resolves `undefined` in a deployment that HAS a cache
 * configured. The old code cached that answer for the life of the process:
 * the warning it printed was a misdiagnosis ("you need Redis" — the operator
 * already had a cache plugin), and the degradation was real — rate-limit
 * counters never reached the shared store even after it came up, so a
 * multi-node deployment counted per node and its limits were never enforced
 * globally. Resolving at consume time removes the ordering dependency
 * entirely: whichever plugin registers `cache` and whenever, the first counter
 * consumed after that point uses it.
 *
 * The warning is kept, but it now fires only when a counter ACTUALLY needs a
 * shared store and there genuinely is none — at which point it is a true
 * signal, and "add a shared cache" is the right advice. It is emitted once per
 * process.
 *
 * Scope note: this wires the RATE-LIMIT COUNTERS only. better-auth's
 * `secondaryStorage` (session snapshots) is a separate, deliberately untouched
 * decision — see the comment in `auth-plugin.ts` and `secondary-storage.ts`.
 */
export function createLazyCacheRateLimitStorage(
  opts: LazyCacheRateLimitStorageOptions,
): BetterAuthRateLimitStorage {
  const fallback = new InProcessCounterStore();
  let cache: CounterStore | undefined;
  let boundAnnounced = false;
  let degradedWarned = false;

  const resolveStore = async (): Promise<CounterStore> => {
    if (!cache) {
      try {
        cache = (await opts.resolveCache()) ?? undefined;
      } catch {
        cache = undefined;
      }
      if (cache && !boundAnnounced) {
        boundAnnounced = true;
        opts.logger?.info?.(
          '[auth] rate-limit counters bound to the kernel cache service — enforced against ONE store across nodes iff the cache is shared (ADR-0069 D2)',
        );
      }
    }
    if (cache) return cache;
    if (!degradedWarned) {
      degradedWarned = true;
      opts.logger?.warn?.(
        '[auth] rate-limit counters have no cache service to count in — falling back to a per-process store. ' +
          'This deployment has no `cache` service registered at all; a multi-node deployment needs a shared cache ' +
          '(Redis via @objectstack/service-cache) or each node enforces the limit independently (ADR-0069 D2)',
      );
    }
    return fallback;
  };

  return {
    consume: async (key, rule) => {
      const store = await resolveStore();
      const now = Date.now();
      const { count, resetAt } = await incrementFixedWindow(store, key, rule.window, now);
      if (count <= rule.max) return { allowed: true, retryAfter: null };
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((resetAt - now) / 1000)) };
    },
  };
}
