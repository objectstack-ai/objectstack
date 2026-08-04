// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Token-bucket rate limiting — the algorithm, and its synchronous
 * in-process front end.
 *
 * ## Read this before trusting a comment in this file (#4937)
 *
 * Until #4910 the header here asserted, in the present tense, that "the
 * dispatcher calls `consume(key)` … and short-circuits with 429", that a
 * deployment could "tune via `DispatcherPluginConfig.rateLimit`", and that "the
 * dispatcher constructs the key from `${ip}:${bucket}`". **None of it was true.**
 * `RateLimiter` had exactly zero call sites outside its own unit test, no
 * inbound path answered 429 anywhere in the repo, and `DispatcherPluginConfig`
 * had no `rateLimit` field. The file described a design, in the tense reserved
 * for behaviour, and cost a full investigation to disprove (#4937).
 *
 * It is true now, and the sentences below are worded so a future reader can
 * check each one against a call site rather than take it on faith:
 *
 *  - `createDispatcherPlugin({ rateLimit })` (`../dispatcher-plugin.ts`) builds
 *    a limiter and installs it as global middleware on the `http.server`
 *    service, so every request that server routes passes through it.
 *  - the key is built by `resolveRateLimitKey` in `./inbound-rate-limit.ts` —
 *    resolved principal first, caller IP for anonymous traffic — NOT
 *    `${ip}:${bucket}`.
 *  - the budget comes from the authored `server.security.rateLimit` block
 *    (`@objectstack/spec` `StackServerConfigSchema`), forwarded by
 *    `objectstack serve`.
 *
 * ## This module vs `./inbound-rate-limit.ts`
 *
 * The bucket ARITHMETIC lives here, in {@link applyTokenBucket}, and has two
 * front ends over it so there is one algorithm and no second code path to
 * drift: {@link RateLimiter} (synchronous, in-process — used by embedders and
 * by the tests that pin the maths) and the async, shared-store limiter in
 * `./inbound-rate-limit.ts` (counters in the kernel cache, ADR-0069 D2).
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Remaining tokens in the bucket after this consume. */
  remaining: number;
  /** Wall-clock ms until next token is available (when not allowed). */
  retryAfterMs: number;
  /** UNIX ms when the limit window resets. */
  resetAt: number;
}

export interface RateLimitBucketConfig {
  /** Max tokens (bucket capacity). */
  capacity: number;
  /** Tokens added per second. */
  refillPerSec: number;
  /** Optional cost override for the consume operation. @default 1 */
  defaultCost?: number;
}

export interface BucketState {
  tokens: number;
  /** Last refill timestamp (ms). */
  lastRefill: number;
}

/**
 * The token-bucket step, as a pure function: refill for elapsed time, then
 * spend `cost` if the bucket can afford it.
 *
 * Extracted (#4910) so the synchronous {@link RateLimiter} and the async
 * shared-store limiter in `./inbound-rate-limit.ts` cannot disagree about what
 * a bucket does. A divergent second implementation is how "the limit works in
 * tests but not in production" happens — the same reasoning
 * `plugin-auth/rate-limit-storage.ts` records for its fixed-window counter.
 *
 * @param state    current bucket state, or `undefined` for a bucket that has
 *                 never been touched (starts full).
 * @param config   capacity + refill rate.
 * @param now      wall-clock ms.
 * @param cost     tokens this request wants to spend.
 * @returns the state to persist and the decision to answer with. The state is
 *          returned in BOTH branches on purpose: a denied request must still
 *          write back its refill, or a caller that retries in a tight loop
 *          never accrues tokens.
 */
export function applyTokenBucket(
  state: BucketState | undefined,
  config: RateLimitBucketConfig,
  now: number,
  cost: number,
): { state: BucketState; decision: RateLimitDecision } {
  const { capacity, refillPerSec } = config;

  let next: BucketState;
  if (!state) {
    next = { tokens: capacity, lastRefill: now };
  } else {
    const elapsedSec = (now - state.lastRefill) / 1000;
    next = elapsedSec > 0
      ? { tokens: Math.min(capacity, state.tokens + elapsedSec * refillPerSec), lastRefill: now }
      : { tokens: state.tokens, lastRefill: state.lastRefill };
  }

  if (next.tokens >= cost) {
    next.tokens -= cost;
    return {
      state: next,
      decision: {
        allowed: true,
        remaining: Math.floor(next.tokens),
        retryAfterMs: 0,
        resetAt: now + Math.ceil(((capacity - next.tokens) / refillPerSec) * 1000),
      },
    };
  }

  const retryAfterMs = Math.ceil(((cost - next.tokens) / refillPerSec) * 1000);
  return {
    state: next,
    decision: {
      allowed: false,
      remaining: Math.floor(next.tokens),
      retryAfterMs,
      resetAt: now + retryAfterMs,
    },
  };
}

/**
 * Seconds after which a bucket for `config` is indistinguishable from an
 * untouched one (it has refilled to capacity), plus one second of slack.
 *
 * This is the TTL a shared store should give a bucket entry: past it, dropping
 * the row and re-creating it full is not an approximation, it is the same
 * answer — which is what keeps a per-principal keyspace from growing without
 * bound in Redis.
 */
export function bucketIdleTtlSeconds(config: RateLimitBucketConfig): number {
  return Math.max(1, Math.ceil(config.capacity / config.refillPerSec) + 1);
}

/**
 * Storage interface — swap for Redis/Memcached in clustered deploys.
 * Implementations MUST be safe under concurrent access.
 */
export interface RateLimitStore {
  get(key: string): BucketState | undefined;
  set(key: string, state: BucketState): void;
  /** Cleanup hint — implementations may evict idle entries. */
  prune?(olderThanMs: number): void;
}

class MemoryStore implements RateLimitStore {
  private buckets = new Map<string, BucketState>();
  private maxEntries: number;

  constructor(maxEntries = 100_000) {
    this.maxEntries = maxEntries;
  }

  get(key: string): BucketState | undefined {
    return this.buckets.get(key);
  }

  set(key: string, state: BucketState): void {
    // Crude LRU eviction — drop the oldest 10% when we hit the cap.
    // Good enough for an in-memory store; replace with Redis if you
    // need precision under load.
    if (this.buckets.size >= this.maxEntries) {
      const dropCount = Math.max(1, Math.floor(this.maxEntries / 10));
      const iter = this.buckets.keys();
      for (let i = 0; i < dropCount; i++) {
        const k = iter.next().value;
        if (!k) break;
        this.buckets.delete(k);
      }
    }
    this.buckets.set(key, state);
  }

  prune(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;
    for (const [k, v] of this.buckets) {
      if (v.lastRefill < cutoff) this.buckets.delete(k);
    }
  }
}

export class RateLimiter {
  private config: RateLimitBucketConfig;
  private store: RateLimitStore;
  private now: () => number;

  constructor(config: RateLimitBucketConfig, opts: { store?: RateLimitStore; now?: () => number } = {}) {
    if (config.capacity <= 0) throw new Error('RateLimiter: capacity must be > 0');
    if (config.refillPerSec <= 0) throw new Error('RateLimiter: refillPerSec must be > 0');
    this.config = config;
    this.store = opts.store ?? new MemoryStore();
    // Injectable clock keeps tests deterministic.
    this.now = opts.now ?? Date.now;
  }

  /**
   * Attempt to consume `cost` tokens for `key`. Returns a decision
   * describing whether the request should proceed and, if not, how
   * long the caller should wait before retrying.
   */
  consume(key: string, cost = this.config.defaultCost ?? 1): RateLimitDecision {
    const now = this.now();
    const { state, decision } = applyTokenBucket(this.store.get(key), this.config, now, cost);
    this.store.set(key, state);
    return decision;
  }

  /** Force-reset a key (e.g. after a successful auth flow). */
  reset(key: string): void {
    this.store.set(key, { tokens: this.config.capacity, lastRefill: this.now() });
  }
}

/**
 * Reference budgets for three traffic classes, as ORDERS OF MAGNITUDE to size
 * an authored `server.security.rateLimit` against — not a live configuration.
 *
 *   - auth: 10 req / minute — the scale that inconveniences credential-stuffing
 *     and password-spray without troubling a human logging in.
 *   - write: 60 req / minute — POST/PUT/PATCH/DELETE.
 *   - read: 600 req / minute — GET, including discovery and metadata.
 *
 * ⚠️ **Nothing in the repo reads this constant.** It is exported reference
 * material, and this comment says so in the tense that matches (#4937: the
 * previous version described per-class dispatcher buckets keyed `${ip}:${bucket}`
 * as if they existed — they never did, and the seam #4910 built is a SINGLE
 * bucket per caller, not one per traffic class). Per-class budgets are a real
 * and reasonable want; when one is implemented it should arrive with its
 * executor and its authoring key, at which point this constant either becomes
 * that feature's default or is deleted.
 */
export interface RateLimitDefaults {
  auth: RateLimitBucketConfig;
  write: RateLimitBucketConfig;
  read: RateLimitBucketConfig;
}

export const DEFAULT_RATE_LIMITS: RateLimitDefaults = {
  auth: { capacity: 10, refillPerSec: 10 / 60 },
  write: { capacity: 60, refillPerSec: 60 / 60 },
  read: { capacity: 600, refillPerSec: 600 / 60 },
};
