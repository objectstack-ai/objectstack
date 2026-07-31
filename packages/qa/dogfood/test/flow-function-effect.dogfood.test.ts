// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// FLOW FUNCTION EFFECT proof (#4396), through the real HTTP + automation stack.
//
// The claim under test is a counting claim, and it spans four packages: an
// author writes `functions: { syncBilling: { handler, effect: 'writes' } }` in
// `defineStack`; AppPlugin collects it; ObjectQL's function registry stores it
// beside the handler; the automation service bridges it into the engine; and
// the `script` executor turns it into `unmeasuredEffect` on the step, which
// #4354's summary folds into the run's `unmeasured` tally.
//
// Any one of those seams can drop the declaration silently — the run still
// succeeds, it just reports `acted: 0, unmeasured: 0` on a run that wrote, which
// is indistinguishable from a dead sweep and is the whole defect #4396 is
// about. Only an end-to-end assertion can tell the difference, so this boots the
// app, triggers both flows over HTTP, and reads the summary the run reports.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { flowFunctionEffectStack } from './fixtures/flow-function-effect-fixture.js';

interface RunSummary {
  selected: number;
  acted: number;
  unmeasured?: number;
  nodes: Array<{ nodeId: string; unmeasured?: number; acted?: number; selected?: number }>;
}

describe('objectstack verify FLOW: a function\'s declared effect reaches the run summary (#4396)', () => {
  let stack: VerifyStack;
  let token: string;

  beforeAll(async () => {
    stack = await bootStack(flowFunctionEffectStack, { automation: true });
    token = await stack.signIn();
    // Two open invoices, so `selected > 0` — the first half of the
    // broken-sweep signal the `unmeasured` tally has to keep honest.
    for (const name of ['inv-1', 'inv-2']) {
      const res = await stack.apiAs(token, 'POST', '/data/fxn_invoice', { name, status: 'open' });
      expect(res.status, `seed ${name} failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    }
  }, 60_000);

  afterAll(async () => {
    await stack?.stop();
  });

  async function runSummaryOf(flow: string): Promise<RunSummary> {
    const res = await stack.apiAs(token, 'POST', `/automation/${flow}/trigger`, {});
    expect(res.status, `trigger ${flow} failed: ${res.status} ${await res.clone().text()}`).toBeLessThan(300);
    const body = (await res.json()) as { data?: { success?: boolean; error?: string; summary?: RunSummary } };
    // A `script` node whose function never registered fails LOUDLY (#1870), so
    // this assertion is also the proof that `defineStack({ functions })`
    // reached the engine at all.
    expect(body.data?.success, `run failed: ${body.data?.error}`).toBe(true);
    expect(body.data?.summary, 'run reported no summary').toBeTruthy();
    return body.data!.summary!;
  }

  it('a PURE function leaves the run fully measured — `acted: 0` means zero', async () => {
    const summary = await runSummaryOf('fxn_pure_sweep');
    expect(summary.selected).toBeGreaterThan(0);
    expect(summary.acted).toBe(0);
    // Nothing uncountable happened, so the broken-sweep query
    // (`selected > 0 AND acted = 0 AND unmeasured = 0`) is free to fire on this
    // run — which is correct: a pure function that writes nothing IS a sweep
    // that did nothing.
    expect(summary.unmeasured).toBe(0);
    expect(summary.nodes.find((n) => n.nodeId === 'run')?.unmeasured).toBeUndefined();
  });

  it("a DECLARED writer's run says the count is incomplete instead of claiming zero", async () => {
    const summary = await runSummaryOf('fxn_writing_sweep');
    expect(summary.selected).toBeGreaterThan(0);
    expect(summary.acted).toBe(0);
    // The one bit that must survive all four seams.
    expect(summary.unmeasured).toBe(1);
    expect(summary.nodes.find((n) => n.nodeId === 'run')?.unmeasured).toBe(1);
  });
});
