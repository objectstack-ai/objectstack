// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The retry policy is ONE declaration (#4661 — the #4535 C8 dual-source cluster).
 *
 * `@objectstack/spec/automation` and `@objectstack/spec/system` both publish
 * `RetryPolicySchema` / `RetryPolicy`. Until 17 those names resolved to two
 * different declarations, so the shape a consumer got depended only on which
 * entry they imported (the #4411 trap) — and the two disagreed on the base
 * delay's spelling (`retryDelayMs` vs `backoffMs`), on two keys only one side
 * had, and on the defaults for `maxRetries` / `backoffMultiplier`.
 *
 * ## Why these assertions run at RUNTIME
 *
 * A compile-time pin cannot fail in this package (#4642): `tsconfig.json`
 * excludes `**\/*.test.ts` so `pnpm typecheck` never compiles this file, and
 * vitest transpiles without typechecking — a conditional-type assertion here
 * would be inert. Worse, `keyof typeof import(...)` enumerates only VALUE
 * exports, so a bare type name cannot be asserted that way at all. These are
 * reference-identity and shape checks on the loaded module namespaces, which
 * actually execute.
 *
 * The reference-identity check is the load-bearing one: `check:dual-source-exports`
 * judges by symbol identity, so `Automation.RetryPolicySchema ===
 * System.RetryPolicySchema` is exactly the invariant whose loss would put the
 * two baseline rows back.
 */

import { describe, it, expect } from 'vitest';
import * as Automation from '../automation';
import * as System from '../system';
import { RetryPolicySchema } from './retry-policy.zod';

describe('RetryPolicy is a single declaration across entries (#4661)', () => {
  it('./automation and ./system export the SAME RetryPolicySchema object', () => {
    expect(Automation.RetryPolicySchema).toBe(System.RetryPolicySchema);
  });

  it('both entries re-export the canonical shared declaration', () => {
    expect(Automation.RetryPolicySchema).toBe(RetryPolicySchema);
    expect(System.RetryPolicySchema).toBe(RetryPolicySchema);
  });

  // Identity alone would still pass if someone converged the two onto a NEW
  // shape that quietly dropped a key. Pin the authorable key set too — this is
  // the same list `authorable-surface.json` carries for both def keys.
  it('publishes exactly the converged key set from both entries', () => {
    const expected = ['maxRetries', 'backoffMs', 'backoffMultiplier', 'maxRetryDelayMs', 'jitter'];

    for (const entry of [Automation.RetryPolicySchema, System.RetryPolicySchema]) {
      const parsed = entry.parse({});
      expect(Object.keys(parsed).sort()).toEqual([...expected].sort());
    }
  });

  // The defaults are the half of this convergence NO gate can see: the
  // authorable-surface ratchet compares key sets, and a default is not a key.
  // If they are ever flipped back, deployed jobs silently start retrying again
  // (or try_catch regions silently start replaying their side effects), so pin
  // the numbers explicitly.
  it('pins the opt-in defaults that no gate can observe', () => {
    const parsed = RetryPolicySchema.parse({});

    expect(parsed.maxRetries).toBe(0);
    expect(parsed.backoffMs).toBe(1000);
    expect(parsed.backoffMultiplier).toBe(1);
    expect(parsed.maxRetryDelayMs).toBe(30000);
    expect(parsed.jitter).toBe(false);
  });

  it('keeps the `retryDelayMs` tombstone loud from both entries', () => {
    for (const entry of [Automation.RetryPolicySchema, System.RetryPolicySchema]) {
      const parse = () => entry.parse({ retryDelayMs: 500 });
      expect(parse).toThrow(/backoffMs/);
    }
  });
});

describe('RetryPolicySchema — converged shape', () => {
  it('computes a bounded exponential backoff', () => {
    const policy = RetryPolicySchema.parse({
      maxRetries: 5,
      backoffMs: 1000,
      backoffMultiplier: 2,
      maxRetryDelayMs: 5000,
    });

    // The formula both executors run: min(base * multiplier^(n-1), ceiling).
    const delays = [1, 2, 3, 4, 5].map((n) =>
      Math.min(policy.backoffMs * Math.pow(policy.backoffMultiplier, n - 1), policy.maxRetryDelayMs),
    );

    expect(delays).toEqual([1000, 2000, 4000, 5000, 5000]);
  });

  it('rejects a shrinking backoff (multiplier below 1)', () => {
    expect(() => RetryPolicySchema.parse({ backoffMultiplier: 0.5 })).toThrow();
  });

  it('caps maxRetries at 10', () => {
    expect(() => RetryPolicySchema.parse({ maxRetries: 10 })).not.toThrow();
    expect(() => RetryPolicySchema.parse({ maxRetries: 11 })).toThrow();
  });
});
