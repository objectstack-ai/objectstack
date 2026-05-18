// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/plugin-approvals
 *
 * Multi-step approval engine for ObjectStack.
 * Persists sys_approval_process / sys_approval_request / sys_approval_action
 * and drives the cycle: submit → review → approve/reject → effects.
 */

export {
  SysApprovalProcess,
  SysApprovalRequest,
  SysApprovalAction,
} from '@objectstack/platform-objects/audit';
export {
  ApprovalService,
  type ApprovalEngine,
  type ApprovalClock,
  type ApprovalServiceOptions,
} from './approval-service.js';
export {
  ApprovalsServicePlugin,
  type ApprovalsPluginOptions,
} from './approvals-plugin.js';
export type {
  IApprovalService,
  ApprovalProcessRow,
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalStatus,
  DefineApprovalProcessInput,
  SubmitApprovalInput,
} from '@objectstack/spec/contracts';
