// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * What an OPERATOR sees when `os serve` publishes the multi-node licence
 * reading as telemetry (#12667 — maintainer ruling 2026-08-27, verbatim
 * 「其他接受」, adopting option C on the `max_nodes` decision: make a licensed
 * oversell VISIBLE; the atomic slot-claim enforcement mechanism is deliberately
 * not built).
 *
 * These assertions are about the published SURFACE — the exact series, values
 * and labels a dashboard receives — not about a value having been computed.
 * The distinction matters here more than usual: the deliverable of this card is
 * a reading that is honest about what the process can and cannot know, so a
 * test that only checked "a number came out" would pass over every regression
 * worth catching.
 *
 * ⚠️ The three facts that make this visibility and not enforcement, re-measured
 * on the tree this landed against:
 *
 *   - the gate is consulted ONCE PER PROCESS at boot (`serve.ts`);
 *   - there is NO cluster membership view — `generateNodeId` is random per
 *     process and there is no join/leave registry (`cluster.ts`);
 *   - `OS_CLUSTER_REPLICAS` is an operator-DECLARED count, identical in every
 *     replica (`split-brain-guard.ts`).
 *
 * So nothing in the process knows how many peers exist, and the surface must
 * not read as though it does. The "honest naming" block at the bottom pins
 * that, because it is the regression most likely to arrive later as a helpful
 * wording change.
 */

import { describe, it, expect } from 'vitest';
import {
  describeMultiNodeCapTelemetry,
  type MultiNodeCapMetric,
  type MultiNodeGateVerdict,
} from './serve.js';

/**
 * The four verdicts the producer can hand this consumer, spelled the way
 * `checkMultiNodeAllowed` builds them (`multi-node-gate.ts`). Same fixtures as
 * `serve-multi-node-cap-advisory.test.ts`, deliberately: the two reaches of one
 * advisory must be tested against one set of inputs, or they can drift into
 * telling an operator two different stories about the same boot.
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

/** `NaN` is what `Number(process.env.OS_CLUSTER_REPLICAS)` yields when unset. */
const NOT_DECLARED = Number(undefined);

describe('describeMultiNodeCapTelemetry — the series an operator receives', () => {
  it('a licensed overflow publishes the declared count, the admitted count and the boot event', () => {
    expect(describeMultiNodeCapTelemetry(VERDICTS.overflow, 5)).toEqual<MultiNodeCapMetric[]>([
      { name: 'cluster_node_cap_verdicts_total', kind: 'counter', value: 1, labels: { verdict: 'capped' } },
      { name: 'cluster_declared_nodes', kind: 'gauge', value: 5, labels: { verdict: 'capped' } },
      { name: 'cluster_admitted_nodes', kind: 'gauge', value: 3, labels: { verdict: 'capped' } },
    ]);
  });

  it('a topology that fits reads `admitted`, with declared and admitted agreeing', () => {
    expect(describeMultiNodeCapTelemetry(VERDICTS.withinCap, 3)).toEqual<MultiNodeCapMetric[]>([
      { name: 'cluster_node_cap_verdicts_total', kind: 'counter', value: 1, labels: { verdict: 'admitted' } },
      { name: 'cluster_declared_nodes', kind: 'gauge', value: 3, labels: { verdict: 'admitted' } },
      { name: 'cluster_admitted_nodes', kind: 'gauge', value: 3, labels: { verdict: 'admitted' } },
    ]);
  });

  it('an outright denial reads `refused`, NOT `capped` — the two are different facts', () => {
    const samples = describeMultiNodeCapTelemetry(VERDICTS.denied, 5);
    expect(samples.every((s) => s.labels.verdict === 'refused')).toBe(true);
    expect(samples).toEqual<MultiNodeCapMetric[]>([
      { name: 'cluster_node_cap_verdicts_total', kind: 'counter', value: 1, labels: { verdict: 'refused' } },
      { name: 'cluster_declared_nodes', kind: 'gauge', value: 5, labels: { verdict: 'refused' } },
      { name: 'cluster_admitted_nodes', kind: 'gauge', value: 0, labels: { verdict: 'refused' } },
    ]);
  });

  it('an uncapped gate publishes NO admitted series — a number there would invent a limit', () => {
    const samples = describeMultiNodeCapTelemetry(VERDICTS.uncapped, 4);
    expect(samples.map((s) => s.name)).toEqual([
      'cluster_node_cap_verdicts_total',
      'cluster_declared_nodes',
    ]);
    // Specifically NOT `cluster_admitted_nodes 0`, which would read as "your
    // licence admits zero nodes" on a deployment with no cap at all.
    expect(samples.find((s) => s.name === 'cluster_admitted_nodes')).toBeUndefined();
  });

  it('publishes NO declared series when nothing was declared — `0` would be a declaration of zero', () => {
    const samples = describeMultiNodeCapTelemetry(VERDICTS.withinCap, NOT_DECLARED);
    expect(samples.map((s) => s.name)).toEqual([
      'cluster_node_cap_verdicts_total',
      'cluster_admitted_nodes',
    ]);
    expect(samples.find((s) => s.name === 'cluster_declared_nodes')).toBeUndefined();
  });

  it('the boot event is emitted for every verdict, so a silent series is a CONFIGURATION answer', () => {
    // An operator reading a dashboard has to be able to tell "gate consulted,
    // everything fine" from "nothing here is instrumented". The counter is
    // present in all four cases; absence therefore means the gate was never
    // consulted (single-node boot) or no metrics backend is configured.
    for (const verdict of Object.values(VERDICTS)) {
      const counters = describeMultiNodeCapTelemetry(verdict, 5)
        .filter((s) => s.kind === 'counter');
      expect(counters).toHaveLength(1);
      expect(counters[0]!.name).toBe('cluster_node_cap_verdicts_total');
      expect(counters[0]!.value).toBe(1);
    }
  });
});

describe('the declared count is normalized exactly as the gate normalizes its own input', () => {
  // `checkMultiNodeAllowed` treats meaningless values (unset, zero, negative,
  // non-finite) as "not declared" and floors a fractional one. The reading has
  // to agree, or the surface reports a declaration the gate never saw.
  const cases: Array<[number, number | undefined]> = [
    [NOT_DECLARED, undefined],
    [0, undefined],
    [-1, undefined],
    [Number.POSITIVE_INFINITY, undefined],
    [2.7, 2],
    [3, 3],
  ];

  for (const [input, expected] of cases) {
    it(`OS_CLUSTER_REPLICAS=${String(input)} → ${expected === undefined ? 'no declared series' : `declared ${expected}`}`, () => {
      const declared = describeMultiNodeCapTelemetry(VERDICTS.uncapped, input)
        .find((s) => s.name === 'cluster_declared_nodes');
      expect(declared?.value).toBe(expected);
    });
  }
});

describe('⚠️ the surface never claims observed membership', () => {
  /**
   * THE assertion this card exists to protect. Every fact the process holds at
   * this moment is a DECLARATION or a LICENCE verdict; it has no membership
   * view whatsoever. A later "helpful" rename — `cluster_nodes`,
   * `cluster_active_nodes`, a label `state="running"` — would turn a true
   * reading into a false one while every other test here stayed green, because
   * the numbers would not change at all. Only the words would.
   */
  //
  // ⚠️ The segment anchors are `[^a-z0-9]`, NOT `\b`. This regex was first
  // written with `\b` and the vacuity proof at the bottom caught it
  // immediately: `_` is a WORD character, so `\bactive\b` does not match
  // inside `cluster_active_nodes` — the exact rename this guard exists to
  // reject would have sailed through while all three sweeps below reported
  // green. Metric names are snake_case, so the separator has to be treated as
  // a boundary explicitly.
  const MEMBERSHIP_CLAIMS =
    /(?:^|[^a-z0-9])(?:running|active|live|alive|online|healthy|current|observed|actual|joined|members?|membership|peers?|connected|up)(?:[^a-z0-9]|$)/i;

  const ALL_SAMPLES = Object.values(VERDICTS).flatMap((v) => [
    ...describeMultiNodeCapTelemetry(v, 5),
    ...describeMultiNodeCapTelemetry(v, NOT_DECLARED),
  ]);

  it('guards itself: the sweep actually has samples to inspect', () => {
    expect(ALL_SAMPLES.length).toBeGreaterThan(8);
  });

  it('no metric NAME claims an observed count', () => {
    for (const sample of ALL_SAMPLES) {
      expect(
        sample.name,
        `"${sample.name}" reads as a count of what is RUNNING. This process has no `
        + 'cluster membership view — nodeId is random per process and there is no '
        + 'join/leave registry — so such a series would be false. Name it for what '
        + 'is known: what the operator DECLARED, and what the licence ADMITS.',
      ).not.toMatch(MEMBERSHIP_CLAIMS);
    }
  });

  it('no LABEL name or value claims an observed count', () => {
    for (const sample of ALL_SAMPLES) {
      for (const [key, value] of Object.entries(sample.labels)) {
        expect(key).not.toMatch(MEMBERSHIP_CLAIMS);
        expect(value).not.toMatch(MEMBERSHIP_CLAIMS);
      }
    }
  });

  it('the names that ARE published say declared / admitted, and use the gate\'s own vocabulary', () => {
    const names = new Set(ALL_SAMPLES.map((s) => s.name));
    expect(names).toEqual(new Set([
      'cluster_node_cap_verdicts_total',
      'cluster_declared_nodes',
      'cluster_admitted_nodes',
    ]));

    // The verdict label is the vocabulary #8367 / PR #8503 landed — not a
    // second one invented for the display.
    const words = new Set(ALL_SAMPLES.map((s) => s.labels.verdict));
    expect(words).toEqual(new Set(['admitted', 'capped', 'refused']));
  });

  it('vacuity proof: the sweep DOES reject a membership-flavoured rename', () => {
    // Without this, a regex that silently stopped matching would leave the
    // three tests above green over exactly the rename they exist to catch.
    expect('cluster_active_nodes').toMatch(MEMBERSHIP_CLAIMS);
    expect('cluster_nodes_running').toMatch(MEMBERSHIP_CLAIMS);
    expect('cluster_live_members').toMatch(MEMBERSHIP_CLAIMS);
    expect('members').toMatch(MEMBERSHIP_CLAIMS);
    // ...and does not reject the honest ones.
    expect('cluster_declared_nodes').not.toMatch(MEMBERSHIP_CLAIMS);
    expect('cluster_admitted_nodes').not.toMatch(MEMBERSHIP_CLAIMS);
  });
});
