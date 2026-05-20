// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { RateLimiter, DEFAULT_RATE_LIMITS } from './rate-limit.js';

/**
 * Deterministic clock for token-bucket tests. The limiter only ever
 * reads `now()` so injecting it gives us full control over time.
 */
function makeClock() {
  let t = 1_700_000_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('RateLimiter', () => {
  it('allows up to capacity, then denies once the bucket is empty', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ capacity: 3, refillPerSec: 1 }, { now: clock.now });

    expect(rl.consume('ip1').allowed).toBe(true);
    expect(rl.consume('ip1').allowed).toBe(true);
    expect(rl.consume('ip1').allowed).toBe(true);

    const denied = rl.consume('ip1');
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
    // ~1 token needed @ 1/s → ~1000ms.
    expect(denied.retryAfterMs).toBeGreaterThan(900);
    expect(denied.retryAfterMs).toBeLessThanOrEqual(1000);
  });

  it('refills tokens linearly over time', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ capacity: 5, refillPerSec: 2 }, { now: clock.now });

    // Drain the bucket.
    for (let i = 0; i < 5; i++) expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);

    // 1s @ 2/s → 2 tokens refilled.
    clock.advance(1000);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);
  });

  it('caps refill at capacity (no infinite accrual)', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 }, { now: clock.now });

    // Sit idle for an hour — bucket must not overflow.
    clock.advance(60 * 60 * 1000);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);
  });

  it('tracks independent buckets per key', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ capacity: 1, refillPerSec: 1 }, { now: clock.now });

    expect(rl.consume('a').allowed).toBe(true);
    // Different key has its own bucket.
    expect(rl.consume('b').allowed).toBe(true);
    // Same key denied.
    expect(rl.consume('a').allowed).toBe(false);
    expect(rl.consume('b').allowed).toBe(false);
  });

  it('supports variable cost per consume', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ capacity: 10, refillPerSec: 1 }, { now: clock.now });

    expect(rl.consume('k', 7).allowed).toBe(true);
    expect(rl.consume('k', 3).allowed).toBe(true);
    expect(rl.consume('k', 1).allowed).toBe(false);
  });

  it('reset() refills to capacity', () => {
    const clock = makeClock();
    const rl = new RateLimiter({ capacity: 2, refillPerSec: 1 }, { now: clock.now });

    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(true);
    expect(rl.consume('k').allowed).toBe(false);

    rl.reset('k');
    expect(rl.consume('k').allowed).toBe(true);
  });

  it('rejects invalid configuration', () => {
    expect(() => new RateLimiter({ capacity: 0, refillPerSec: 1 })).toThrow();
    expect(() => new RateLimiter({ capacity: 1, refillPerSec: 0 })).toThrow();
  });

  it('exposes sane defaults for auth/write/read traffic classes', () => {
    expect(DEFAULT_RATE_LIMITS.auth.capacity).toBe(10);
    expect(DEFAULT_RATE_LIMITS.write.capacity).toBe(60);
    expect(DEFAULT_RATE_LIMITS.read.capacity).toBe(600);
    // refillPerSec * 60s ≈ capacity → ~one-minute window.
    for (const cfg of Object.values(DEFAULT_RATE_LIMITS)) {
      expect(cfg.refillPerSec * 60).toBeCloseTo(cfg.capacity, 0);
    }
  });
});
