// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18110 — a `subflow` child that ends `refused` must STOP the parent.
 *
 * `subflow-node.ts` branched only on `child.status === 'paused'` and
 * `!child.success`. A refused child is neither: `finishRefusedRun` answers
 * `{ success: true, status: 'refused' }` — *a refusal is a successful
 * evaluation that says no* — so it fell through the ordinary success exit. The
 * parent walked this node's out-edges, recorded `completed` and fired its OWN
 * `successMessage` over the child's refusal: the author got the exact opposite
 * of what they wrote, and got it FAIL-OPEN. A refusing gate (an approval, an
 * eligibility check, a precondition) that lets the run through is the one kind
 * of wrong nobody notices, because the flow finishes green.
 *
 * ⚠️ Direction, predicted before running. The tests under "the defect" FAIL
 * against the unfixed executor — `undefined` where `'refused'` is expected,
 * the parent's toast where silence is expected, and the downstream node in
 * `ran`. The CONTROL is green on both sides on purpose: a green that only
 * proved the refusal path would pass equally over a broken ordinary path.
 *
 * ⚠️ `refused` here is the run OUTCOME, ⛔ NOT this package's other `refused`.
 * A GUARD refusal (`guard-refusal.ts`, `refuseNode`, the resume-authority gate)
 * means "the engine declined to execute" and is a kind of FAILURE; the two
 * senses are distinguished at `engine.ts`'s `FlowRefusalSignal` docblock.
 * `subflow-child-refusal.test.ts` in this directory is about a THIRD thing
 * again (#14379's retryable resume-bag codes) — same word, different subject.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerSubflowNode } from './subflow-node.js';
import type { AutomationContext } from '@objectstack/spec/contracts';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

/** The parent's own completion toast — it must never ride a child's refusal. */
const PARENT_TOAST = 'Parent completed!';
/** The authored refusal template. `{record.name}` is what makes it per-record. */
const REFUSAL_TEMPLATE = 'Refused: {record.name} is a confirmed duplicate';
const ACME = { id: 'rec_1', name: 'Acme Corp' } as const;

/**
 * The child's pre-refusal work, reported as #4354 metrics. Its whole job is to
 * make the rollup assertion possible: a child that refuses really can have
 * written rows before it said no, and those counts must survive the refusal
 * unwind — the property option B was rejected for losing.
 */
const CHILD_METRICS = { selected: 3, acted: 2, unmeasuredEffect: true } as const;

function triggerCtx(): AutomationContext {
  return { event: 'manual', object: 'account', record: { ...ACME } } as unknown as AutomationContext;
}

/** A child flow whose `end` carries `endConfig` (absent = a plain completion). */
function childFlow(name: string, endConfig?: Record<string, unknown>) {
  return {
    name, label: name, type: 'autolaunched',
    nodes: [
      { id: 'c_start', type: 'start', label: 'Start' },
      { id: 'c_work', type: 'childwork', label: 'Work' },
      { id: 'c_end', type: 'end', label: 'End', ...(endConfig ? { config: endConfig } : {}) },
    ],
    edges: [
      { id: 'ce0', source: 'c_start', target: 'c_work' },
      { id: 'ce1', source: 'c_work', target: 'c_end' },
    ],
  };
}

/** start -> subflow(child) -> recorder -> end, with the parent's own toast. */
function parentFlow(childName: string) {
  return {
    name: 'parent', label: 'parent', type: 'autolaunched',
    successMessage: PARENT_TOAST,
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'sub', type: 'subflow', label: 'Sub', config: { flowName: childName, outputVariable: 'subResult' } },
      { id: 'after', type: 'downstream', label: 'After' },
      { id: 'fin', type: 'end', label: 'Fin' },
    ],
    edges: [
      { id: 'e0', source: 'start', target: 'sub' },
      { id: 'e1', source: 'sub', target: 'after' },
      { id: 'e2', source: 'after', target: 'fin' },
    ],
  };
}

describe('#18110 — a refusing `subflow` child stops the parent', () => {
  let engine: AutomationEngine;
  let ran: string[];

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    ran = [];
    registerSubflowNode(engine, pluginCtx());

    engine.registerNodeExecutor({
      type: 'childwork',
      async execute() {
        ran.push('child-work');
        return { success: true, metrics: { ...CHILD_METRICS } };
      },
    } as NodeExecutor);
    // The node AFTER the subflow. Its presence in `ran` is the whole
    // "the parent walked on" assertion — ⛔ not a proxy for it.
    engine.registerNodeExecutor({
      type: 'downstream',
      async execute() {
        ran.push('downstream');
        return { success: true };
      },
    } as NodeExecutor);

    engine.registerFlow('gate_refuses', childFlow('gate_refuses', { outcome: 'refused', message: REFUSAL_TEMPLATE }) as never);
    engine.registerFlow('gate_allows', childFlow('gate_allows') as never);
  });

  /** The newest run row for a flow — a refused run carries no `runId`. */
  async function newestRun(flowName: string) {
    const runs = await engine.listRuns(flowName, { limit: 5 });
    expect(runs.length).toBeGreaterThan(0);
    return engine.getRun(runs[0]!.id);
  }

  describe('the defect', () => {
    it('the parent run REFUSES — it does not record `completed`', async () => {
      engine.registerFlow('parent', parentFlow('gate_refuses') as never);

      const result = await engine.execute('parent', triggerCtx());

      expect(result.success).toBe(true);           // a refusal is a successful evaluation
      expect(result.status).toBe('refused');
      expect((await newestRun('parent'))?.status).toBe('refused');
    });

    it("the child's rendered reason reaches the parent's caller", async () => {
      engine.registerFlow('parent', parentFlow('gate_refuses') as never);

      const result = await engine.execute('parent', triggerCtx());

      // Per-record, interpolated in the CHILD against the child's variables and
      // passed through — ⛔ not re-rendered and ⛔ not invented by the parent.
      expect(result.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
      expect((await newestRun('parent'))?.refusalMessage).toBe('Refused: Acme Corp is a confirmed duplicate');
    });

    it("the parent's own `successMessage` stays silent over the refusal", async () => {
      engine.registerFlow('parent', parentFlow('gate_refuses') as never);

      const result = await engine.execute('parent', triggerCtx());

      expect(result.successMessage).toBeUndefined();
    });

    it('downstream nodes do NOT run — the out-edges are not walked', async () => {
      engine.registerFlow('parent', parentFlow('gate_refuses') as never);

      await engine.execute('parent', triggerCtx());

      expect(ran).toEqual(['child-work']);
      expect(ran).not.toContain('downstream');
    });

    it("preserves the child's #4354 rollup on the refusal path (`selected` / `acted` / `unmeasuredEffect`)", async () => {
      // ⭐ The property the unwinding POSITION exists for: the signal is thrown
      // after this node's success step, its `childSteps` fold and its output
      // write-back, so the child's counts are already in the run log when the
      // run terminates. A refusing child really can have written rows before it
      // said no, and a summary that forgot them would read "nothing happened,
      // safe to re-run".
      engine.registerFlow('parent', parentFlow('gate_refuses') as never);

      const result = await engine.execute('parent', triggerCtx());

      expect(result.summary).toBeDefined();
      expect(result.summary).toMatchObject({ selected: 3, acted: 2, unmeasured: 1 });
      expect(result.summary!.nodes.find((n) => n.nodeId === 'sub')).toMatchObject({
        selected: 3, acted: 2, unmeasured: 1,
      });
    });
  });

  describe('the control — an ordinary child still rolls up as an ordinary success', () => {
    // ⛔ Mandatory, not decoration: every assertion above is also satisfied by
    // an executor that had started refusing EVERYTHING. This is the leg that
    // tells the fix apart from that.
    it('a non-refused child completes the parent, fires its toast, and walks on', async () => {
      engine.registerFlow('parent', parentFlow('gate_allows') as never);

      const result = await engine.execute('parent', triggerCtx());

      expect(result.success).toBe(true);
      expect(result.status).toBeUndefined();        // the terminal-success exit stamps none
      expect(result.refusalMessage).toBeUndefined();
      expect(result.successMessage).toBe(PARENT_TOAST);
      expect(ran).toEqual(['child-work', 'downstream']);
      expect((await newestRun('parent'))?.status).toBe('completed');
      // The same rollup, by the same route — the refusal arm added a branch,
      // ⛔ it did not move the totals.
      expect(result.summary).toMatchObject({ selected: 3, acted: 2, unmeasured: 1 });
    });
  });
});
