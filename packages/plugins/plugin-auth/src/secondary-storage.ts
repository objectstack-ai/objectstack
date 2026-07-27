// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { BetterAuthOptions } from 'better-auth';
import type { ICacheService } from '@objectstack/spec/contracts';

type SecondaryStorage = NonNullable<BetterAuthOptions['secondaryStorage']>;

/**
 * ADR-0069 D2 — adapt the kernel `cache` service into a better-auth
 * `secondaryStorage`. When wired, better-auth uses it for **rate-limit
 * counters** (`rateLimit.storage: 'secondary-storage'`) and session caching —
 * so both become **shared across nodes iff the cache service is shared**.
 *
 * In a single-node deployment the cache is memory-backed and this behaves like
 * the default per-process store. In a multi-node deployment the operator
 * configures the cache service with the Redis adapter (already supported by
 * `@objectstack/service-cache`), and rate limiting is then enforced against a
 * single shared counter — closing the "each node counts independently, so an
 * attacker rotates nodes to bypass the limit" hole (ADR-0069 D2).
 *
 * better-auth's `secondaryStorage` contract is string-valued: `get` returns the
 * stored string (or null), `set` takes a string value + optional TTL (seconds),
 * `delete` removes it. We map straight onto `ICacheService`, translating
 * `undefined` (miss) → `null`.
 *
 * NOTE on atomicity: `ICacheService` exposes no atomic primitives (no INCR, no
 * GETDEL), so `increment` and `getAndDelete` below are read-then-write pairs.
 * Both are documented at their definitions with the exact race they leave open
 * and why it is acceptable today. A cache adapter that grows atomic INCR /
 * GETDEL should be plumbed through `ICacheService` and used here — that is the
 * one change that closes both windows.
 */
export function cacheSecondaryStorage(cache: ICacheService): SecondaryStorage {
  return {
    get: async (key: string): Promise<string | null> => {
      const v = await cache.get<string>(key);
      return v === undefined ? null : v;
    },
    /**
     * Single-use read: better-auth consumes verification values (magic links,
     * OTPs, reset tokens) through this when they live in secondary storage, so
     * that a value cannot be read and deleted as two separately-replayable
     * steps.
     *
     * `ICacheService` has no GETDEL, so this is get-then-delete: two requests
     * that arrive within the same event-loop turn can both observe the value
     * before either delete lands, and both would be honoured. The window is
     * sub-millisecond and the follow-up state change is still gated on the
     * value's own `expiresAt`, but it is a real window — a cache adapter with
     * an atomic GETDEL closes it.
     */
    getAndDelete: async (key: string): Promise<string | null> => {
      const v = await cache.get<string>(key);
      await cache.delete(key);
      return v === undefined ? null : v;
    },
    /**
     * Fixed-window counter, required by better-auth 1.7 for
     * `rateLimit.storage: 'secondary-storage'` (it throws at boot without it).
     *
     * Contract: return the POST-increment count; create the key at 1 with
     * `ttl` SECONDS when absent; never extend the TTL on later increments, so
     * the counter expires a fixed window after it was first created rather
     * than sliding forward on every request.
     *
     * `ICacheService.set` always (re)sets the TTL, so the window end is stored
     * alongside the count and each re-set is given only the REMAINING seconds.
     * The envelope is private to this function — better-auth reads rate-limit
     * counters exclusively through `increment`.
     *
     * Without an atomic INCR this stays read-modify-write: two nodes can read
     * the same count and both admit a request, so the limit can over-admit
     * slightly under concurrency. That is the same trade the previous
     * get→compute→set path made, and still strictly better than the per-node
     * independent counters it replaces (ADR-0069 D2).
     */
    increment: async (key: string, ttl: number): Promise<number> => {
      const now = Date.now();
      const current = parseCounter(await cache.get<unknown>(key));

      if (!current || current.exp <= now) {
        const exp = now + Math.max(1, ttl) * 1000;
        await cache.set(key, JSON.stringify({ n: 1, exp }), Math.max(1, ttl));
        return 1;
      }

      const n = current.n + 1;
      const remaining = Math.max(1, Math.ceil((current.exp - now) / 1000));
      await cache.set(key, JSON.stringify({ n, exp: current.exp }), remaining);
      return n;
    },
    set: async (key: string, value: string, ttl?: number): Promise<void> => {
      await cache.set(key, value, ttl);
    },
    delete: async (key: string): Promise<void> => {
      await cache.delete(key);
    },
  };
}

/** The window envelope `increment` stores: `n` requests so far, window ends at `exp` (epoch ms). */
interface Counter {
  n: number;
  exp: number;
}

/**
 * Read back an `increment` envelope. Cache adapters differ on whether they
 * hand values back as the stored string (Redis) or as the original object
 * (memory), so both are accepted. Anything else — a legacy or foreign value
 * under the key — is treated as absent, which restarts the window rather than
 * throwing on an auth request.
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
