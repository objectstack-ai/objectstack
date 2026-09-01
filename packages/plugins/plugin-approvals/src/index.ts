// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-approvals
 *
 * Approval-as-flow-node runtime (ADR-0019). Persists sys_approval_request /
 * sys_approval_action, resolves approvers, enforces the record lock, and
 * records decisions that resume the owning flow run. Approval orchestration
 * (when to pause, which branch to take) lives on the one automation engine via
 * the `approval` node.
 */

export { SysApprovalRequest } from './sys-approval-request.object.js';
export { SysApprovalAction } from './sys-approval-action.object.js';
export { SysApprovalApprover } from './sys-approval-approver.object.js';
export { SysApprovalDelegation } from './sys-approval-delegation.object.js';
export {
  ApprovalService,
  type ApprovalEngine,
  type ApprovalClock,
  type ApprovalServiceOptions,
  type ApprovalResumeSurface,
  // #3447 P2 — expression approvers + empty-slate auto-approve outcome.
  type ApproverExpressionContext,
  type ApprovalNodeAutoOutcome,
  // #4469 — the read-only stranded-request inspection's report shape.
  type StrandedApprovalRequest,
  // #13909 — which unrecoverable shape a reported row is in.
  type StrandedRunState,
} from './approval-service.js';
export {
  ApprovalsServicePlugin,
  type ApprovalsPluginOptions,
} from './approvals-plugin.js';
export {
  registerApprovalNode,
  type ApprovalAutomationSurface,
} from './approval-node.js';
// #3823 — the service-owned revise window. Registered by `registerApprovalNode`
// (the two are one feature); exported for hosts that compose node executors by
// hand and for tests that drive the send-back path.
export {
  registerApprovalReviseNode,
  APPROVAL_REVISE_CORRELATION_PREFIX,
} from './approval-revise-node.js';
export type {
  IApprovalService,
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalStatus,
} from '@objectstack/spec/contracts';
