// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18555 — a refusing child inside a `map` unit must STOP the parent.
 *
 * The identical hole #18110 describes for `subflow`, in a second file:
 * `map-node.ts` branched on `child.status === 'paused'` and `!child.success`
 * and had no `refused` arm, so a refused child (`{ success: true, status:
 * 'refused' }`) fell through the synchronous-completion path — its output was
 * pushed into `state.results`, the batch carried on to the NEXT item, and the
 * parent recorded `completed` and fired its own `successMessage`.
 *
 * ⭐ For a `map` that is the worked "approve each row" shape answering *no* on
 * one row and approving every row after it anyway. Fail-open, and finishing
 * green.
 *
 * ⚠️ Pinned SEPARATELY from the `subflow` arm on purpose: one channel
 * (`NodeExecutionResult.refuse`), two call sites, and deleting either site must
 * fail a test by itself. `subflow-refused-rollup.test.ts` is the other half —
 * neither file's green covers the other's arm.
 *
 * ⚠️ Direction, predicted before running. "The defect" tests FAIL against the
 * unfixed executor; the CONTROL is green on both sides on purpose.
 *
 * ⚠️ `refused` here is the run OUTCOME — *a refusal is a successful evaluation
 * that says no* — ⛔ NOT this package's GUARD refusal, which is a FAILURE.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from '../engine.js';
import type { NodeExecutor } from '../engine.js';
import { registerMapNode } from './map-node.js';

function silentLogger(): any {
  return { info() {}, warn() {}, error() {}, debug() {}, child() { return silentLogger(); } };
}
function pluginCtx(): any {
  return { logger: silentLogger(), getService() { return undefined; } };
}

/** The parent's own completion toast — it must never ride an item's refusal. */
const PARENT_TOAST = 'Batch complete!';
/**
 * The authored refusal template. `{val}` is the child's own declared INPUT
 * variable (the mapped item, handed down as `params.val`) — what makes the
 * rendered reason per-item. ⛔ Not the parent's `{item}` iterator: that lives in
 * the PARENT's variable map and resolves to the empty string down here.
 */
const REFUSAL_TEMPLATE = 'Refused: {val} is not eligible';
/** Per-item #4354 work, so the rollup on the refusal path is assertable. */
const ITEM_METRICS = { selected: 2, acted: 1 } as const;

/**
 * Child flow: judge the item, then leave by one of TWO ends — a plain
 * completion, or an `end` declaring `outcome: 'refused'`. Routed by the
 * judge's `branchLabel`, so WHICH item refuses is a property of the data.
 */
function childFlow() {
  return {
    name: 'per_item', label: 'Per item', type: 'autolaunched',
    variables: [{ name: 'val', type: 'text', isInput: true }],
    nodes: [
      { id: 'c_start', type: 'start', label: 'Start' },
      { id: 'c_judge', type: 'judge', label: 'Judge' },
      { id: 'c_ok', type: 'end', label: 'Ok' },
      { id: 'c_no', type: 'end', label: 'No', config: { outcome: 'refused', message: REFUSAL_TEMPLATE } },
    ],
    edges: [
      { id: 'ce0', source: 'c_start', target: 'c_judge' },
      { id: 'ce1', source: 'c_judge', target: 'c_ok', label: 'allow' },
      { id: 'ce2', source: 'c_judge', target: 'c_no', label: 'deny' },
    ],
  };
}

/** start -> map(per_item over {items}) -> recorder -> end, with the parent toast. */
function parentFlow() {
  return {
    name: 'batch', label: 'batch', type: 'autolaunched',
    successMessage: PARENT_TOAST,
    variables: [{ name: 'items', type: 'list', isInput: true }],
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      {
        id: 'each', type: 'map', label: 'For each',
        config: {
          flowName: 'per_item', collection: '{items}',
          iteratorVariable: 'item', input: { val: '{item}' }, outputVariable: 'mapped',
        },
      },
      { id: 'after', type: 'downstream', label: 'After' },
      { id: 'fin', type: 'end', label: 'Fin' },
    ],
    edges: [
      { id: 'e0', source: 'start', target: 'each' },
      { id: 'e1', source: 'each', target: 'after' },
      { id: 'e2', source: 'after', target: 'fin' },
    ],
  };
}

describe('#18555 — a refusing child inside a `map` stops the parent', () => {
  let engine: AutomationEngine;
  let judged: string[];
  let ran: string[];
  /** The item value the judge refuses. `null` = refuse nothing (the control). */
  let deny: string | null;

  beforeEach(() => {
    engine = new AutomationEngine(silentLogger());
    judged = [];
    ran = [];
    deny = 'b';
    registerMapNode(engine, pluginCtx());

    engine.registerNodeExecutor({
      type: 'judge',
      async execute(_node, _variables, context) {
        const val = String((context as any)?.params?.val);
        judged.push(val);
        return {
          success: true,
          branchLabel: deny !== null && val === deny ? 'deny' : 'allow',
          metrics: { ...ITEM_METRICS },
        };
      },
    } as NodeExecutor);
    // The node AFTER the map. Its presence in `ran` IS the "the parent walked
    // on" assertion — ⛔ not a proxy for it.
    engine.registerNodeExecutor({
      type: 'downstream',
      async execute() {
        ran.push('downstream');
        return { success: true };
      },
    } as NodeExecutor);

    engine.registerFlow('per_item', childFlow() as never);
    engine.registerFlow('batch', parentFlow() as never);
  });

  const runBatch = () => engine.execute('batch', { params: { items: ['a', 'b', 'c'] } } as never);

  async function newestRun(flowName: string) {
    const runs = await engine.listRuns(flowName, { limit: 5 });
    expect(runs.length).toBeGreaterThan(0);
    return engine.getRun(runs[0]!.id);
  }

  describe('the defect', () => {
    it('the parent run REFUSES — it does not record `completed`', async () => {
      const result = await runBatch();

      expect(result.success).toBe(true);           // a refusal is a successful evaluation
      expect(result.status).toBe('refused');
      expect((await newestRun('batch'))?.status).toBe('refused');
    });

    it("the refusing item's rendered reason reaches the parent's caller", async () => {
      const result = await runBatch();

      // Interpolated in the CHILD against the child's own variables (the
      // iterator value), passed through — ⛔ not re-rendered by the map node.
      expect(result.refusalMessage).toBe('Refused: b is not eligible');
      expect((await newestRun('batch'))?.refusalMessage).toBe('Refused: b is not eligible');
    });

    it("the parent's own `successMessage` stays silent over the refusal", async () => {
      const result = await runBatch();

      expect(result.successMessage).toBeUndefined();
    });

    it('the batch STOPS at the refusing item — later items never run', async () => {
      // ⭐ The `map`-specific half of the defect: "approve each row" answering
      // no on row 2 and approving row 3 anyway.
      await runBatch();

      expect(judged).toEqual(['a', 'b']);
      expect(judged).not.toContain('c');
    });

    it('downstream nodes do NOT run — the map node is not walked past', async () => {
      await runBatch();

      expect(ran).toEqual([]);
    });

    it("preserves the batch's #4354 rollup on the refusal path (`selected` / `acted`)", async () => {
      // ⭐ The property the unwinding POSITION exists for: the signal is thrown
      // after this node's success step and its metrics are already in the run
      // log. Items that already ran really did write rows, and so did the
      // refusing item before it said no — both count. Two items x {2,1}.
      const result = await runBatch();

      // ⛔ The refusal assertion belongs IN this test, not next door: without it
      // the totals below are equally true of the unfixed engine, which rolled
      // the same metrics up and then carried on to the next item.
      expect(result.status).toBe('refused');
      expect(result.summary).toBeDefined();
      expect(result.summary).toMatchObject({ selected: 4, acted: 2 });
      expect(result.summary!.nodes.find((n) => n.nodeId === 'each')).toMatchObject({
        selected: 4, acted: 2,
      });
    });
  });

  describe('the control — an ordinary batch still rolls up as an ordinary success', () => {
    // ⛔ Mandatory, not decoration: every assertion above is also satisfied by
    // a map that had started refusing EVERY batch.
    it('a batch with no refusing item completes, fires the toast, and walks on', async () => {
      deny = null;

      const result = await runBatch();

      expect(result.success).toBe(true);
      expect(result.status).toBeUndefined();        // the terminal-success exit stamps none
      expect(result.refusalMessage).toBeUndefined();
      expect(result.successMessage).toBe(PARENT_TOAST);
      expect(judged).toEqual(['a', 'b', 'c']);      // every item ran
      expect(ran).toEqual(['downstream']);
      expect((await newestRun('batch'))?.status).toBe('completed');
      // Three items this time — the refusal arm added a branch, ⛔ it did not
      // move the totals.
      expect(result.summary).toMatchObject({ selected: 6, acted: 3 });
    });
  });
});
