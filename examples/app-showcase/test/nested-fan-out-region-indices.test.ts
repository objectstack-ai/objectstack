// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16356] The `loop { parallel }` fixture, pinned by RUNNING it.
 *
 * `docs/qa/platform-checklist/areas/automation.json` →
 * `automation.flow-run-step-nesting` carries a `loop { parallel }` acceptance
 * clause (item revision 3, from #15230). Until this flow landed the item's own
 * `fixtures.requires` recorded that showcase nests neither construct in the
 * other, so that clause could only ever score `blocked(fixture)`: there was no
 * flow to trigger.
 *
 * What makes the shape load-bearing, so nobody simplifies it back: the
 * maintainer ruling of 2026-09-03 made `ExecutionStepLog.iteration`
 * single-valued (the enclosing loop's row, carried through nesting) and gave
 * the parallel branch position its own `branch` key. **A step inside a parallel
 * branch that is itself inside a loop body is the ONLY shape where both index
 * keys are populated on one record.** One row, or one branch, and the clause
 * cannot discriminate — which is why the assertions below are written over
 * TWO rows and TWO branches.
 *
 * This is a RUN pin, not a structural one. A structural assertion ("the body
 * holds a parallel with two branches") passes on an engine that tags the steps
 * wrong, and the clause is about the tags. So the real flow — read out of
 * `src/automation/flows/index.ts`, not a copy — is executed on a real
 * `AutomationEngine` with the real built-in node executors, and the three
 * things the clause asks for are asserted off the resulting step log:
 *
 *   (a) every `parallel-branch` step carries a `branch` equal to its branch
 *       position, `branch: 0` INCLUDED — a falsy check anywhere on the way
 *       silently drops the first branch;
 *   (b) every `(iteration, branch)` pair appears exactly once across the run —
 *       the pre-ruling engine wrote a CONSTANT iteration per branch, so
 *       counting distinct values is not enough on its own;
 *   (c) the enclosing `parallel` container step itself reads
 *       `regionKind: 'loop-body'` with the row on `iteration` and NO `branch`.
 *
 * Plus the guard the clause's own `verify` names: every recorded step still
 * parses under `ExecutionStepLogSchema` at this head.
 *
 * No messaging service is registered here, so `notify` takes its documented
 * "no messaging service registered" path and returns success without
 * delivering. That is deliberate: this pin is about the region tags the engine
 * writes around the node, not about delivery, which
 * `notify-delivery-outcome.integration.test.ts` owns.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine, installBuiltinNodes } from '@objectstack/service-automation';
import { ExecutionStepLogSchema } from '@objectstack/spec/automation';

import { NestedFanOutRemindersFlow, allFlows } from '../src/automation/flows/index.js';

function silentLogger(): any {
  const logger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  logger.child = () => logger;
  return logger;
}

/**
 * A plugin context with no services at all. `getService` answers `undefined`
 * rather than throwing, which is what an unprovisioned optional service looks
 * like to a node executor.
 */
function bareContext(): any {
  return { logger: silentLogger(), getService: () => undefined };
}

/** Two rows, each carrying both recipients the flow's branches interpolate. */
const ROWS = [
  { id: 't1', title: 'Ship the release notes', owner: 'usr_owner_1', watcher: 'usr_watch_1' },
  { id: 't2', title: 'Close the audit finding', owner: 'usr_owner_2', watcher: 'usr_watch_2' },
];

/** Branch position → the leaf node id authored in that branch. */
const BRANCH_LEAF = ['notify_owner', 'notify_watcher'] as const;

async function runFixture() {
  const engine = new AutomationEngine(silentLogger());
  installBuiltinNodes(engine, bareContext());
  engine.registerFlow(NestedFanOutRemindersFlow.name, NestedFanOutRemindersFlow as never);

  const result = await engine.execute(NestedFanOutRemindersFlow.name, { params: { tasks: ROWS } });
  const runs = await engine.listRuns(NestedFanOutRemindersFlow.name);
  return { result, steps: (runs[0]?.steps ?? []) as any[] };
}

describe('#16356 — showcase_nested_fan_out_reminders is the loop { parallel } fixture', () => {
  it('is part of the app, not an orphan export', () => {
    // A fixture the app never loads is a fixture the checklist cannot trigger.
    expect(allFlows).toContain(NestedFanOutRemindersFlow);
  });

  it('a branch step carries BOTH indices — the loop row on `iteration`, its own position on `branch`', async () => {
    const { result, steps } = await runFixture();
    expect(result.success).toBe(true);

    const branchSteps = steps.filter((s) => s.regionKind === 'parallel-branch');
    // 2 rows x 2 branches. A flattened fixture (no parallel in the body, or one
    // branch) cannot produce this population at all.
    expect(branchSteps).toHaveLength(4);

    // (a) + (b): every (iteration, branch) pair exactly once, and each pair
    // names the leaf the branch actually authors. `branch: 0` is spelled out
    // rather than counted, so a falsy check that drops it fails here.
    expect(
      branchSteps.map((s) => `${s.nodeId}@iteration=${s.iteration}/branch=${s.branch}`).sort(),
    ).toEqual([
      `${BRANCH_LEAF[0]}@iteration=0/branch=0`,
      `${BRANCH_LEAF[0]}@iteration=1/branch=0`,
      `${BRANCH_LEAF[1]}@iteration=0/branch=1`,
      `${BRANCH_LEAF[1]}@iteration=1/branch=1`,
    ]);

    // The innermost region still wins the identity field.
    for (const s of branchSteps) expect(s.parentNodeId).toBe('fan_out_audiences');

    // (c) The `parallel` container step is a loop-body step: the row on
    // `iteration`, no `branch` of its own.
    const containerSteps = steps.filter((s) => s.nodeId === 'fan_out_audiences');
    expect(containerSteps).toHaveLength(ROWS.length);
    for (const s of containerSteps) {
      expect(s.regionKind).toBe('loop-body');
      expect(s.parentNodeId).toBe('each_task');
      expect(s.branch).toBeUndefined();
    }
    expect(containerSteps.map((s) => s.iteration)).toEqual([0, 1]);

    // The clause's cross-check: every recorded step is a legal step log.
    expect(steps.length).toBeGreaterThan(0);
    for (const step of steps) {
      const parsed = ExecutionStepLogSchema.safeParse(step);
      if (!parsed.success) {
        throw new Error(
          `step ${step.nodeId} does not parse under ExecutionStepLogSchema: `
          + JSON.stringify(parsed.error.issues),
        );
      }
    }
  });
});
