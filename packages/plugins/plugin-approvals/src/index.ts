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
export {
  ApprovalService,
  type ApprovalEngine,
  type ApprovalClock,
  type ApprovalServiceOptions,
  type ApprovalResumeSurface,
} from './approval-service.js';
export {
  ApprovalsServicePlugin,
  type ApprovalsPluginOptions,
} from './approvals-plugin.js';
export {
  registerApprovalNode,
  type ApprovalAutomationSurface,
} from './approval-node.js';
export type {
  IApprovalService,
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalStatus,
} from '@objectstack/spec/contracts';
