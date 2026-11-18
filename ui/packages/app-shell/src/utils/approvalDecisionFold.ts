/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * approvalDecisionFold — which of a pending request's declared actions the
 * APPROVER's band draws as buttons, and which go behind its one menu
 * (objectstack#34361, ruling A).
 *
 * The band keeps the step's two decisions in view and folds every other lever
 * (reassign, send back, request info, reply, and the submitter's own levers
 * for a viewer who is both). Which actions are "the decisions" is read off the
 * metadata each action already declares — its `variant` — never off an
 * action-name list, so an action shipped as metadata alone lands in the menu
 * unless its author marks it `primary` or `danger`. That is the same principle
 * the admin-override fold follows (`actionAdmittedByOverride` reads each
 * action's own `visible` gate).
 *
 * Placement only: nothing here decides who may act. The server's `viewer`
 * block and each action's own `visible` / `disabled` / capability gates stay
 * the authority, unchanged.
 */

/** The spec action `variant` values that keep an action out of the fold. */
const LEAD_VARIANTS: ReadonlySet<string> = new Set(['primary', 'danger']);

/**
 * Does this declared action stay a button on the approver's band?
 *
 * True for an action whose declared `variant` is `primary` or `danger`
 * (today `approval_approve` and `approval_reject`); every other action,
 * including one that declares no variant, belongs in the menu.
 */
export function isLeadDecision(action: unknown): boolean {
  if (!action || typeof action !== 'object') return false;
  const variant = (action as { variant?: unknown }).variant;
  return typeof variant === 'string' && LEAD_VARIANTS.has(variant);
}

/**
 * May this viewer act on the request as one of its approvers?
 *
 * Reads the server's `viewer.can_act` and nothing else, strictly: a backend
 * that sent no `viewer` block, or one without `can_act`, cannot tell, and
 * "cannot tell" keeps today's unfolded bar. The override-only administrator
 * (`can_act: false`) and the submitter who holds no slot both read `false`.
 */
export function isActingApprover(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const viewer = (record as { viewer?: unknown }).viewer;
  if (!viewer || typeof viewer !== 'object') return false;
  return (viewer as { can_act?: unknown }).can_act === true;
}

/**
 * The 1-based number of the request's current step on its served route
 * (`flow_route.steps`, the list every step line draws), or `undefined` when
 * the route is absent or names no current step.
 */
export function currentStepNumber(record: unknown): number | undefined {
  if (!record || typeof record !== 'object') return undefined;
  const route = (record as { flow_route?: unknown }).flow_route;
  if (!route || typeof route !== 'object') return undefined;
  const steps = (route as { steps?: unknown }).steps;
  if (!Array.isArray(steps)) return undefined;
  const index = steps.findIndex(
    (step) => !!step && typeof step === 'object' && (step as { state?: unknown }).state === 'current',
  );
  return index >= 0 ? index + 1 : undefined;
}
