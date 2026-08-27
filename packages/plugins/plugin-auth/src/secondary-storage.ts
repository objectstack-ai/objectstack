// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { BetterAuthOptions } from 'better-auth';
import type { ICacheService } from '@objectstack/spec/contracts';
import { incrementFixedWindow } from './rate-limit-storage.js';

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
 * ⚠️ `secondaryStorage` is NOT the seam the shared rate-limit counter uses any
 * more (#4772). It cannot be: handing better-auth a `secondaryStorage` also
 * moves the SESSION of record into it — `internalAdapter.createSession` skips
 * the `sys_session` row unless `session.storeSessionInDatabase` is set, and
 * `findSession` answers from the cached snapshot without consulting the
 * database at all. ObjectStack revokes sessions by writing the row
 * (`enforceSessionControls` / `enforceConcurrentCap` stamp `revoked_at` +
 * a past `expires_at`, ADR-0069 D4), so a cache-backed session store makes
 * idle-timeout, absolute-max and concurrent-cap revocation silently stop
 * taking effect. The counters therefore ride `rateLimit.customStorage`
 * instead (see `rate-limit-storage.ts`), which touches counters only. This
 * adapter stays for a host that supplies `secondaryStorage` deliberately and
 * accepts that trade; it is no longer wired automatically from the cache
 * service. Whether ObjectStack should move the session of record into the
 * cache at all (and rewrite D4's revocation to match) is #4785 — a decision,
 * not a bug fix.
 *
 * ⚠️ **`session.cookieCache` is the sibling key, and its cost is NOT the same
 * size.** It reaches the same read-path failure direction — a revoked session
 * keeps authenticating, silently — but the session of record stays in
 * `sys_session`, the window is bounded by `cookieCache.maxAge` (default 300s)
 * rather than unbounded, and better-auth's own sensitive-operation path
 * re-reads with the cookie cache disabled. It is also not reachable through
 * `AuthManagerOptions`. The measurement, with the better-auth files each claim
 * was read out of, is at `auth-manager.ts`'s `session:` block — the place a
 * future author would plumb it. ⛔ Neither door is boot-refused by
 * ObjectStack, and that is the ruled posture, not a gap: opt-in with the cost
 * stated. Adding a refusal to either needs a new maintainer ruling.
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
     * The envelope is private to `incrementFixedWindow` — better-auth reads
     * rate-limit counters exclusively through `increment`.
     *
     * Shares ONE implementation with `rateLimit.customStorage`
     * ({@link incrementFixedWindow}) so the two seams that count auth requests
     * cannot drift apart in window semantics.
     *
     * Without an atomic INCR this stays read-modify-write: two nodes can read
     * the same count and both admit a request, so the limit can over-admit
     * slightly under concurrency. That is the same trade the previous
     * get→compute→set path made, and still strictly better than the per-node
     * independent counters it replaces (ADR-0069 D2).
     */
    increment: async (key: string, ttl: number): Promise<number> => {
      const { count } = await incrementFixedWindow(cache, key, ttl);
      return count;
    },
    set: async (key: string, value: string, ttl?: number): Promise<void> => {
      await cache.set(key, value, ttl);
    },
    delete: async (key: string): Promise<void> => {
      await cache.delete(key);
    },
  };
}
