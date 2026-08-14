// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The operator-facing half of the 2026-08-13 `max_nodes` ruling (cloud#1275).
 *
 * The ruling has three clauses — refuse the excess, run up to the paid limit,
 * warn loudly. The first two need an atomic slot claim across replicas and are
 * tracked as their own mechanism. The third needs nothing but the verdict the
 * gate already returns, and had no owner: `os serve` is the sole runtime
 * consumer of that gate, and it neither asked for a count nor rendered one.
 *
 * ⚠️ These assertions are about **wording**, and that is deliberate. While
 * enforcement is open, nothing is actually refused — the gate is consulted once
 * per process at boot, every replica computes the same verdict, and none can
 * tell whether it is one of the admitted ones, so all of them join. A message
 * claiming "2 replicas refused" would be false in exactly the
 * declared-vs-delivered way this warning exists to close. The tests below pin
 * the honest shape: the cap is advisory, and the excess replicas still join.
 */

import { describe, it, expect } from 'vitest';
import { formatMultiNodeCapAdvisory, type MultiNodeGateVerdict } from './serve.js';

/**
 * The four verdicts the producer can hand this consumer, spelled the way
 * `checkMultiNodeAllowed` builds them (`multi-node-gate.ts`). The pin test
 * beside this one is what keeps that claim true; here they are fixtures.
 */
const VERDICTS = {
  /** No gate registered, or an allowing gate that declared no cap. */
  uncapped: { allowed: true, refused: 0, capped: false },
  /** A cap exists and the declared topology fits inside it. */
  withinCap: { allowed: true, admitted: 3, refused: 0, capped: false },
  /** The licensed-overflow case: 5 declared, 3 paid for. */
  overflow: { allowed: true, admitted: 3, refused: 2, capped: true },
  /** Unlicensed: the whole cluster is denied. `capped` stays false by design. */
  denied: { allowed: false, reason: 'no clustering entitlement', admitted: 0, refused: 5, capped: false },
} satisfies Record<string, MultiNodeGateVerdict>;

describe('formatMultiNodeCapAdvisory', () => {
  it('says nothing when no cap is configured', () => {
    expect(formatMultiNodeCapAdvisory(VERDICTS.uncapped)).toBeNull();
  });

  it('says nothing when a cap is configured and the declared topology fits', () => {
    expect(formatMultiNodeCapAdvisory(VERDICTS.withinCap)).toBeNull();
  });

  it('warns on a licensed overflow, naming both numbers', () => {
    expect(formatMultiNodeCapAdvisory(VERDICTS.overflow)).toBe(
      '[cluster] licensed node cap exceeded: the licence admits 3 node(s), '
      + 'but OS_CLUSTER_REPLICAS declares 5 — 2 beyond the cap.\n'
      + '[cluster] This cap is ADVISORY and is not enforced yet: nothing is refused, '
      + 'and all 5 replicas will still join the cluster.\n'
      + '[cluster] Reduce OS_CLUSTER_REPLICAS to 3, or raise the licensed node limit.',
    );
  });

  it('⚠️ never claims replicas were refused — nothing is refused today', () => {
    const text = formatMultiNodeCapAdvisory(VERDICTS.overflow) ?? '';

    // The false sentences, in the shapes they would plausibly be written.
    expect(text).not.toMatch(/\d+\s+(replicas?\s+)?(were\s+|was\s+|are\s+)?refused/i);
    expect(text).not.toMatch(/refus(ed|ing)\s+\d+/i);
    expect(text).not.toMatch(/(rejected|denied|dropped|will not join|won't join)/i);

    // ...and the true ones it must carry instead.
    expect(text).toMatch(/advisory/i);
    expect(text).toMatch(/not enforced/i);
    expect(text).toMatch(/nothing is refused/i);
    expect(text).toMatch(/still join/i);
  });

  it('names the declared count, the admitted count and the remedy', () => {
    const text = formatMultiNodeCapAdvisory(VERDICTS.overflow) ?? '';
    expect(text).toContain('admits 3');
    expect(text).toContain('declares 5');
    expect(text).toContain('2 beyond the cap');
    expect(text).toContain('OS_CLUSTER_REPLICAS');
    expect(text).toContain('Reduce OS_CLUSTER_REPLICAS to 3');
  });

  it('stays silent on an outright denial — that one is a downgrade, not a cap', () => {
    // `capped: false` on a denial is the producer's deliberate choice so the
    // unlicensed case cannot be conflated with the licensed-overflow one. The
    // call site already prints its own downgrade warning; a second message here
    // would report one event twice, and would call a full denial a partial cap.
    expect(formatMultiNodeCapAdvisory(VERDICTS.denied)).toBeNull();
  });

  it('surfaces the gate reason when the cap carries one', () => {
    const text = formatMultiNodeCapAdvisory({
      allowed: true,
      reason: 'plan: team (3 nodes)',
      admitted: 3,
      refused: 2,
      capped: true,
    });
    expect(text).toContain('(plan: team (3 nodes))');
  });

  it('scales with the numbers rather than hard-coding the 3/5 case', () => {
    const text = formatMultiNodeCapAdvisory({ allowed: true, admitted: 10, refused: 7, capped: true }) ?? '';
    expect(text).toContain('admits 10');
    expect(text).toContain('declares 17');
    expect(text).toContain('7 beyond the cap');
  });

  it('prints no number it was not given: a countless `capped` verdict stays silent', () => {
    // Unreachable from the shipped producer (`capped: true` always arrives with
    // a numeric `admitted`), so this pins the choice rather than a behaviour:
    // faced with a stale or foreign build, silence beats a warning with an
    // invented count in it.
    expect(formatMultiNodeCapAdvisory({ allowed: true, refused: 2, capped: true })).toBeNull();
    expect(formatMultiNodeCapAdvisory({ allowed: true, admitted: 3, refused: 0, capped: true })).toBeNull();
  });
});
