// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * In-memory token-bucket rate limiter.
 *
 * Designed to be adapter-agnostic — the dispatcher calls `consume(key)`
 * with a request fingerprint (IP, IP+route bucket, or user id) and
 * short-circuits with 429 if the bucket is empty.
 *
 * For production multi-instance deploys, swap the in-memory store via
 * `RateLimitStore`. The shape is intentionally narrow so a Redis-backed
 * implementation is straightforward.
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

interface BucketState {
  tokens: number;
  /** Last refill timestamp (ms). */
  lastRefill: number;
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
    const { capacity, refillPerSec } = this.config;

    let state = this.store.get(key);
    if (!state) {
      state = { tokens: capacity, lastRefill: now };
    } else {
      const elapsedSec = (now - state.lastRefill) / 1000;
      if (elapsedSec > 0) {
        state = {
          tokens: Math.min(capacity, state.tokens + elapsedSec * refillPerSec),
          lastRefill: now,
        };
      }
    }

    if (state.tokens >= cost) {
      state.tokens -= cost;
      this.store.set(key, state);
      return {
        allowed: true,
        remaining: Math.floor(state.tokens),
        retryAfterMs: 0,
        resetAt: now + Math.ceil(((capacity - state.tokens) / refillPerSec) * 1000),
      };
    }

    const tokensNeeded = cost - state.tokens;
    const retryAfterMs = Math.ceil((tokensNeeded / refillPerSec) * 1000);
    this.store.set(key, state);
    return {
      allowed: false,
      remaining: Math.floor(state.tokens),
      retryAfterMs,
      resetAt: now + retryAfterMs,
    };
  }

  /** Force-reset a key (e.g. after a successful auth flow). */
  reset(key: string): void {
    this.store.set(key, { tokens: this.config.capacity, lastRefill: this.now() });
  }
}

/**
 * Curated default buckets for the three traffic classes ObjectStack
 * dispatches. Conservative — tune via `DispatcherPluginConfig.rateLimit`
 * for your deployment.
 *
 *   - auth: 10 req / minute / IP — guards /auth/* against credential
 *     stuffing and password-spray.
 *   - write: 60 req / minute / IP — POST/PUT/PATCH/DELETE.
 *   - read:  600 req / minute / IP — GET, including discovery and
 *     metadata.
 *
 * "Per-IP" is just the suggested key shape; the dispatcher constructs
 * the key from `${ip}:${bucket}` so a single noisy IP can saturate
 * one bucket without blocking the others.
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
