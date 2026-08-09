// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ADR-0044 **revise window** as its own flow node (amended ADR-0044, #3823).
 *
 * A send-back resumes the run down the approval node's `revise` edge; the run
 * parks on the node that edge targets while the record is unlocked and the
 * submitter reworks it, and `ApprovalService.resubmit` drives it back into the
 * approval node over the declared back-edge (round N+1).
 *
 * That pause is **service-owned**: `resubmit` is the thing that authorizes
 * (submitter-only), orders (latest request for the run) and records (a
 * `resubmit` audit row) the continuation, and refuses up front when another
 * request is pending on the record — the guard that keeps the run alive,
 * because the approval node's re-entry would otherwise fail *after* the engine
 * consumed the suspension and leave the run terminally dead.
 *
 * ADR-0044 D3 originally parked it on an ordinary `wait` node, which is
 * `resumeAuthority: 'any'` — correctly so for a signal wait, and exactly wrong
 * here: a raw `POST /automation/:name/runs/:runId/resume` (empty body suffices)
 * walked the back-edge around every one of those checks. The #3801 resume gate
 * keys on the node type that produced the suspension, so the fix is a node type
 * that declares itself service-owned. Nothing about the gate changes.
 *
 * Why a dedicated type rather than re-suspending inside the approval node: the
 * revise window stays *visible flow state* — a box on the canvas, a step in the
 * run log, a row in the suspended-run store — which is the property ADR-0044
 * chose the generic `wait` for in the first place. Only the reuse was wrong.
 */

import {
  defineActionDescriptor,
  APPROVAL_REVISE_NODE_TYPE,
} from '@objectstack/spec/automation';
import type { ApprovalAutomationSurface } from './approval-node.js';

interface MinimalLogger {
  info?: (msg: any, ...rest: any[]) => void;
  warn?: (msg: any, ...rest: any[]) => void;
}

/**
 * Correlation prefix for a revise-window suspension — what the suspended-run
 * record carries so an operator (or `listSuspendedRuns`) can tell a revise
 * window from a timer or signal wait at a glance.
 *
 * Deliberately NOT one of the engine's linked-run prefixes (`subflow:` /
 * `map:`): those mean "this run is waiting on another run", and the resume gate
 * follows them to judge the child's node. A revise window waits on a person.
 */
export const APPROVAL_REVISE_CORRELATION_PREFIX = 'approval_revise:';

/**
 * Register the `approval_revise` node executor. Called from
 * {@link registerApprovalNode} rather than wired separately on purpose: a
 * deployment that has the `approval` node must have this one too, or every
 * send-back in it is refused at runtime — there is no half of this feature
 * worth installing.
 */
export function registerApprovalReviseNode(
  automation: ApprovalAutomationSurface,
  logger?: MinimalLogger,
): void {
  automation.registerNodeExecutor({
    type: APPROVAL_REVISE_NODE_TYPE,
    descriptor: defineActionDescriptor({
      type: APPROVAL_REVISE_NODE_TYPE,
      version: '1.0.0',
      name: 'Revise Window',
      description:
        'Durable pause an approval send-back parks the run on while the submitter reworks the '
        + 'record. Continues only through the approvals service (resubmit), which re-enters the '
        + 'approval node over the declared back-edge.',
      icon: 'pencil',
      // Waits on a human — the same category as `approval` and `screen`.
      category: 'human',
      paradigms: ['flow'],
      source: 'plugin',
      supportsPause: true,  // (`isAsync` stood here — retired in #6748, ADR-0049: nothing read it)
      // #3823 / amended ADR-0044: THE point of this node type. The revise
      // window is a service-owned continuation, so the #3801 gate must refuse
      // a raw resume of it — which it does for any node type declaring this.
      resumeAuthority: 'service',
      // No config: the window is pure position in the graph. Left schemaless
      // (like `wait` / `subflow` / `decision`) rather than declaring an empty
      // object, so nothing invents an authorable surface that has no reader.
    }),
    async execute(node) {
      // Arms nothing on entry — no timer, no job, no external subscription — so
      // there is deliberately no `onSuspensionReleased` hook to pair with it
      // (contrast the wait node's timer one-shot, #5529). The only thing that
      // ends this pause is `ApprovalService.resubmit` (or a `recall`, which
      // cancels the run).
      return {
        success: true,
        suspend: true,
        correlation: `${APPROVAL_REVISE_CORRELATION_PREFIX}${node.id}`,
      };
    },
  });

  logger?.info?.('[approvals] approval revise-window node executor registered');
}
