// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * @objectstack/spec/contracts/approval-service
 *
 * Cross-package contract for the approval runtime. The default
 * implementation lives in `@objectstack/plugin-approvals` and is registered
 * as the `approvals` service.
 *
 * ADR-0019: approval is no longer a standalone engine. An approval is a
 * **flow node** (`type: 'approval'`) — the flow opens a request on the node
 * and suspends; a human decision finalises it and resumes the flow down the
 * matching `approve` / `reject` edge. This service owns the runtime state
 * (`sys_approval_request` / `sys_approval_action`, approver resolution, record
 * lock, status mirror) and the decision API. There is no standalone process
 * authoring type, submit, or step machinery anymore.
 */

import type { SharingExecutionContext } from './sharing-service.js';

/** Lifecycle state of an approval request. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'recalled';

/** Live request row. */
export interface ApprovalRequestRow {
  id: string;
  /** Origin of the request — `flow:<flowName|nodeId>` for node-driven approvals. */
  process_name: string;
  object_name: string;
  record_id: string;
  submitter_id?: string;
  submitter_comment?: string;
  status: ApprovalStatus;
  /** The flow node id that opened the request (mirrors `flow_node_id`). */
  current_step?: string;
  current_step_index?: number;
  pending_approvers?: string[];
  payload?: unknown;
  /** ADR-0019 correlation: the suspended flow run this request belongs to. */
  flow_run_id?: string;
  flow_node_id?: string;
  completed_at?: string;
  created_at?: string;
  updated_at?: string;
  /**
   * When the request was opened. Alias of `created_at` — the row is created
   * at submission time. Kept as its own field so inbox clients have a stable
   * name that survives any future split between row-creation and submission.
   */
  submitted_at?: string;
  // ── Display enrichment (inbox-facing; resolved by the service) ─────
  /** Human label of the originating flow (e.g. "Project Budget Approval"). */
  process_label?: string;
  /** Human label of the approval step / node (e.g. "Manager Review"). */
  step_label?: string;
  /** Display name of the target record (its name/title field), when resolvable. */
  record_title?: string;
  /** Display name of the submitter (`sys_user.name`), when resolvable. */
  submitter_name?: string;
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

/** Input for a decision on an approval request. */
export interface ApprovalDecisionInput {
  decision: 'approve' | 'reject';
  actorId: string;
  comment?: string;
}

/** Input for recalling (withdrawing) a pending request. */
export interface ApprovalRecallInput {
  /** Must be the request's submitter (or a system context). */
  actorId: string;
  comment?: string;
}

/** Result of a recall. */
export interface ApprovalRecallResult {
  request: ApprovalRequestRow;
  /** The suspended flow run this request gated, if any. */
  runId?: string | null;
  /**
   * True when the owning flow run was resumed (down the `reject` branch with
   * `output.decision = 'recall'`) so it doesn't stay suspended forever. The
   * engine has no run-cancel primitive yet; the reject edge is the closest
   * "did not pass" semantics.
   */
  resumed?: boolean;
}

/** Result of a decision that resumes the owning flow when finalised. */
export interface ApprovalDecisionResult {
  request: ApprovalRequestRow;
  /** True when this call moved the request to a terminal state. */
  finalized: boolean;
  decision: 'approve' | 'reject';
  /** The suspended flow run that was (or will be) resumed, if any. */
  runId?: string | null;
  /** True when the owning flow run was resumed as a result of this decision. */
  resumed?: boolean;
}

/**
 * Public contract — the node-era approval runtime.
 */
export interface IApprovalService {
  /**
   * "My approvals" inbox. Supports filtering by status, target object,
   * record id, or by the user expected to act next.
   */
  listRequests(
    filter: {
      object?: string;
      recordId?: string;
      status?: ApprovalStatus | ApprovalStatus[];
      /**
       * Match requests where ANY of these identities is a pending approver.
       * Accepts a single id or a list (a user typically has several
       * identities: their user id, email, and `role:<r>` entries). Passing
       * the list lets a caller resolve "my pending approvals" in ONE request
       * instead of one request per identity.
       */
      approverId?: string | string[];
      submitterId?: string;
    } | undefined,
    context: SharingExecutionContext,
  ): Promise<ApprovalRequestRow[]>;

  getRequest(requestId: string, context: SharingExecutionContext): Promise<ApprovalRequestRow | null>;

  /**
   * Record a decision on a node-driven request. Honours the node's
   * `unanimous` behaviour, finalises the request when satisfied, and resumes
   * the owning flow run down the matching `approve` / `reject` edge.
   */
  decide(requestId: string, input: ApprovalDecisionInput, context: SharingExecutionContext): Promise<ApprovalDecisionResult>;

  /**
   * Withdraw a pending request. Only the submitter (or a system context) may
   * recall. Finalises the request as `recalled` and resumes the owning flow
   * run down the `reject` branch with `output.decision = 'recall'`.
   */
  recall(requestId: string, input: ApprovalRecallInput, context: SharingExecutionContext): Promise<ApprovalRecallResult>;

  /** Audit trail for a request. */
  listActions(requestId: string, context: SharingExecutionContext): Promise<ApprovalActionRow[]>;
}
