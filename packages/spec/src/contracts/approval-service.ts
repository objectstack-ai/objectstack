// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/approval-service
 *
 * Cross-package contract for the multi-step approval engine. The
 * default implementation lives in `@objectstack/plugin-approvals` and
 * is registered as the `approvals` service.
 *
 * Sits on top of (but does not depend on) `IWorkflowService`: a
 * workflow is a single state machine on a record; an approval process
 * is a *cycle* — submit → review → approve/reject → effects — driven
 * by humans rather than transition rules.
 */

import type { SharingExecutionContext } from './sharing-service.js';

/** Lifecycle state of an approval request. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'recalled';

/** Stored process definition row. */
export interface ApprovalProcessRow {
  id: string;
  name: string;
  label: string;
  object_name: string;
  description?: string;
  active: boolean;
  definition: any;
  created_at?: string;
  updated_at?: string;
}

/** Live request row. */
export interface ApprovalRequestRow {
  id: string;
  process_name: string;
  object_name: string;
  record_id: string;
  submitter_id?: string;
  submitter_comment?: string;
  status: ApprovalStatus;
  current_step?: string;
  current_step_index?: number;
  pending_approvers?: string[];
  payload?: unknown;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
}

/** Audit row. */
export interface ApprovalActionRow {
  id: string;
  request_id: string;
  step_name?: string;
  step_index?: number;
  action: 'submit' | 'approve' | 'reject' | 'recall' | 'escalate';
  actor_id?: string;
  comment?: string;
  created_at?: string;
}

/** Input for `IApprovalService.defineProcess`. */
export interface DefineApprovalProcessInput {
  id?: string;
  name: string;
  label: string;
  object: string;
  description?: string;
  active?: boolean;
  /** The full ApprovalProcess JSON envelope. */
  definition: any;
}

/** Input for `IApprovalService.submit`. */
export interface SubmitApprovalInput {
  object: string;
  recordId: string;
  /** Optional — when omitted the engine picks the active process for the object. */
  processName?: string;
  submitterId?: string;
  comment?: string;
  /** Snapshot of the record at submission time. Optional but useful for emails. */
  payload?: unknown;
}

/** Input for approve / reject / recall. */
export interface ApprovalDecisionInput {
  actorId: string;
  comment?: string;
}

/** Result of a single decision call. */
export interface ApprovalDecisionResult {
  request: ApprovalRequestRow;
  /** True when this call moved the request to a terminal state. */
  finalized: boolean;
}

/**
 * Public contract.
 */
export interface IApprovalService {
  // ── Process definitions ──────────────────────────────────────
  defineProcess(input: DefineApprovalProcessInput, context: SharingExecutionContext): Promise<ApprovalProcessRow>;
  listProcesses(filter: { object?: string; activeOnly?: boolean } | undefined, context: SharingExecutionContext): Promise<ApprovalProcessRow[]>;
  getProcess(idOrName: string, context: SharingExecutionContext): Promise<ApprovalProcessRow | null>;
  deleteProcess(idOrName: string, context: SharingExecutionContext): Promise<void>;

  // ── Requests ─────────────────────────────────────────────────
  submit(input: SubmitApprovalInput, context: SharingExecutionContext): Promise<ApprovalRequestRow>;

  /**
   * "My approvals" inbox. Supports filtering by status, target object,
   * record id, or by the user expected to act next.
   */
  listRequests(
    filter: {
      object?: string;
      recordId?: string;
      status?: ApprovalStatus | ApprovalStatus[];
      approverId?: string;
      submitterId?: string;
    } | undefined,
    context: SharingExecutionContext,
  ): Promise<ApprovalRequestRow[]>;

  getRequest(requestId: string, context: SharingExecutionContext): Promise<ApprovalRequestRow | null>;

  /** Approve the current step. Advances to the next, or finalises. */
  approve(requestId: string, input: ApprovalDecisionInput, context: SharingExecutionContext): Promise<ApprovalDecisionResult>;

  /** Reject the current step. Finalises (or rolls back, per step config). */
  reject(requestId: string, input: ApprovalDecisionInput, context: SharingExecutionContext): Promise<ApprovalDecisionResult>;

  /** Submitter or admin cancels a pending request. */
  recall(requestId: string, input: ApprovalDecisionInput, context: SharingExecutionContext): Promise<ApprovalDecisionResult>;

  /** Audit trail for a request. */
  listActions(requestId: string, context: SharingExecutionContext): Promise<ApprovalActionRow[]>;
}
