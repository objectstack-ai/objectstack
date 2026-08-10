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
 * A compile-time pin could not fail in this package when this was written
 * (#4642): `tsconfig.json` excluded `**\/*.test.ts` so `pnpm typecheck` never
 * compiled this file, and vitest transpiles without typechecking — a
 * conditional-type assertion here was inert. #5286 fixed the tsconfig half.
 * The second reason stands unchanged and is why these assertions do not move:
 * `keyof typeof import(...)` enumerates only VALUE exports, so a bare type name
 * cannot be asserted that way at all. These are
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

  // The tombstone STRING is not documentation. `shared/retired-key.ts` says so
  // in its own words — "an agent bumping `@objectstack/spec` sees THIS string,
  // not our docs site" — which makes its enumeration of carrying surfaces
  // contract, not prose. It went stale exactly once and in the worst direction:
  // it kept listing "an ETL pipeline's `retry`" after #6414 deleted the whole L2
  // layer, so the one message guaranteed to reach an upgrading author named a
  // fourth place to write `backoffMs` on which `tsc` now reports TS2724/TS2305
  // (#6630). Nothing could see that: every pre-existing assertion on this string
  // matched `/backoffMs/` or `/retryDelayMs/`, i.e. the prescription, never the
  // enumeration. Pin the enumeration in BOTH directions.
  //
  // Note on the assertion shape: there is no ADR-0112 `code`/`status` envelope
  // to assert here. `retiredKey()` is a Zod `never` whose issue carries the
  // guidance as its `message`, so for this rejection class the wording IS the
  // whole contract (#5240) and the message is the only thing worth asserting.
  it('the tombstone enumerates exactly the surfaces that still carry the policy (#6630)', () => {
    const result = RetryPolicySchema.safeParse({ retryDelayMs: 500 });
    expect(result.success).toBe(false);
    const message = result.error!.issues.map((issue) => issue.message).join('\n');

    // Every surface that builds from `retryPolicyShape()` today, spelled the way
    // an author writes it. A prescription naming a scope NARROWER than the truth
    // is the #4964 defect (a real surface left out reads as "not converged").
    for (const live of ['`job.retryPolicy`', "`try_catch` node's `retry`", '`flow.errorHandling`']) {
      expect(message, `the prescription must still name ${live}`).toContain(live);
    }

    // ...and nothing retired. Wider than the truth is the #6630 defect: the
    // export absence is pinned in `automation/sync-retirement.test.ts`, so a
    // surface named here that cannot be imported there is a signpost to a
    // compile error.
    expect(
      message,
      'the prescription must not point at a surface #6414 retired',
    ).not.toMatch(/\bETL\b/i);

    // None of the above may be bought by weakening the prescription itself.
    expect(message).toContain('Rename the key to `backoffMs`');
    expect(message).toContain('os migrate meta --from 16');
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

/**
 * The assertion class that would have caught #4964 and #4962 — and the reason
 * it did not exist before them.
 *
 * #4661 converged the two declarations that shared an exported NAME, because
 * that is the question `check:dual-source-exports` asks. It cannot ask "how
 * many shapes does this one CONCEPT have?", so the two encodings with no
 * exported name at all — `Flow.errorHandling` and `ETLPipeline.retry`, both
 * anonymous inline `z.object`s — were outside its vision by construction, and
 * a surviving dialect after a completed convergence reads as reviewed-and-kept
 * rather than missed.
 *
 * `ETLPipeline.retry` no longer exists: the whole L2 ETL layer was retired at
 * #6414 for having no executor. Its convergence is kept in this history
 * deliberately — the two dialects were found by asking the concept-level
 * question, and that is the instrument this block still is, whatever it happens
 * to be pointed at today.
 *
 * This block asks the concept-level question directly, against the four
 * surfaces that carry a retry policy. It is deliberately a PARSE comparison
 * rather than a source or `.shape` inspection: it is blind to how a surface
 * obtains the contract (spread, reference, or — the failure it exists to
 * catch — a fresh hand-copied key list), and sees only whether an author gets
 * the same keys and the same numbers on all four.
 *
 * Adding a fifth retry surface without wiring `retryPolicyShape()` fails here.
 */
describe('every retry surface carries ONE contract (#4661, #4964, #4962)', () => {
  const POLICY_KEYS = ['maxRetries', 'backoffMs', 'backoffMultiplier', 'maxRetryDelayMs', 'jitter'];
  const POLICY_DEFAULTS = {
    maxRetries: 0, backoffMs: 1000, backoffMultiplier: 1, maxRetryDelayMs: 30000, jitter: false,
  };

  const minimalFlow = {
    name: 'f', label: 'F', type: 'autolaunched' as const,
    nodes: [{ id: 'n1', type: 'start', label: 'S' }], edges: [],
  };
  // ⚠️ THREE surfaces became TWO at #6414, and the subtraction is the reason
  // this comment exists. `etlPipeline.retry` — the third encoding this block was
  // written to catch (#4962) — left with the whole L2 ETL layer, retired for
  // having no executor at all. The remaining two are the real ones, and the
  // block's guarantee is unchanged: a FOURTH surface added without wiring
  // `retryPolicyShape()` still fails here. What would NOT be caught, and is
  // worth stating rather than discovering: a surface that never gets added,
  // because a vocabulary with no engine behind it is invisible to a parse
  // comparison. That is the ADR-0049 question, not this block's.
  const surfaces = (): ReadonlyArray<readonly [string, Record<string, unknown>]> => [
    ['job.retryPolicy / try_catch retry', RetryPolicySchema.parse({}) as Record<string, unknown>],
    [
      'flow.errorHandling',
      Automation.FlowSchema.parse({ ...minimalFlow, errorHandling: {} }).errorHandling as Record<string, unknown>,
    ],
  ];

  it('declares the same key set everywhere (modulo flow-only `strategy`)', () => {
    for (const [label, parsed] of surfaces()) {
      // `strategy` selects WHETHER the policy runs; it is not part of it.
      const keys = Object.keys(parsed).filter((k) => k !== 'strategy').sort();
      expect(keys, `${label} must carry exactly the converged key set`).toEqual([...POLICY_KEYS].sort());
    }
  });

  it('applies the same defaults everywhere — including the opt-in count of 0', () => {
    // The half no gate can see: `authorable-surface.json` compares key sets and
    // a default is not a key. `ETLPipeline.retry` defaulted the count to 3
    // until #4962 while every sibling defaulted 0, and nothing failed. (That
    // surface is gone as of #6414; the blind spot it demonstrated is not.)
    for (const [label, parsed] of surfaces()) {
      for (const [key, value] of Object.entries(POLICY_DEFAULTS)) {
        expect(parsed[key], `${label}.${key} must default to ${value}`).toBe(value);
      }
    }
  });

  it('retires the pre-17 spelling wherever it was legal', () => {
    // `retryDelayMs`, the automation base delay: tombstoned rather than
    // deleted, so the rejection carries the rename instead of a bare
    // "unrecognized key" — or, on the non-strict surfaces, a silent strip back
    // to the default.
    //
    // The ETL half of this test asserted the `maxAttempts` -> `maxRetries`
    // tombstone on `ETLPipeline.retry`. It is deleted rather than re-pointed at
    // another surface, because the tombstone went with the shape that carried
    // it (#6414 absorbed #4962's conversion entry for exactly this reason): with
    // no `retry` block to author the key INTO, a prescription for it is a
    // message nobody can receive. Re-spelling this case onto `flow` would have
    // duplicated the assertion above while looking like preserved coverage.
    const flowRetired = Automation.FlowSchema.safeParse({
      ...minimalFlow, errorHandling: { strategy: 'retry', maxRetries: 2, retryDelayMs: 500 },
    });
    expect(flowRetired.success).toBe(false);
    expect(JSON.stringify(flowRetired.error!.issues)).toMatch(/backoffMs/);
  });

  it('accepts a policy authored once and pasted onto any surface', () => {
    // The whole point, stated as the author experiences it: learn the words on
    // one surface, write them on any other. Before #4964 this exact object was
    // REJECTED by `flow.errorHandling` (which demanded `retryDelayMs`) and by
    // `ETLPipeline.retry` (which demanded `maxAttempts` and declared none of
    // the last three keys).
    const policy = {
      maxRetries: 3, backoffMs: 5000, backoffMultiplier: 2, maxRetryDelayMs: 60000, jitter: true,
    };

    expect(RetryPolicySchema.safeParse(policy).success).toBe(true);
    expect(Automation.FlowSchema.safeParse({
      ...minimalFlow, errorHandling: { strategy: 'retry', ...policy },
    }).success).toBe(true);
  });
});
