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

/**
 * Lifecycle state of an approval request.
 *
 * `returned` (ADR-0044): the approver sent the request back for revision —
 * terminal for THIS request/round; the flow walks the `revise` edge to a wait
 * point, and a later resubmit opens a fresh `pending` request (next round).
 * Distinct from `recalled` (submitter-initiated withdrawal).
 *
 * Dual-source: keep in sync with the `sys_approval_request` status select.
 */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'recalled' | 'returned';

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
  /** Schema label of the target object (e.g. "Project" for `showcase_project`). */
  object_label?: string;
  /**
   * Display names for user-id entries in `pending_approvers`
   * (id → `sys_user.name`). Emails and `role:<r>` entries are not mapped —
   * they are already human-readable.
   */
  pending_approver_names?: Record<string, string>;
  /**
   * Display values for lookup fields in `payload` (field key → referenced
   * record's display name), so inbox summaries never show foreign-key ids.
   */
  payload_display?: Record<string, string>;
  /**
   * SLA deadline, when the node config carries `escalation.timeoutHours`:
   * `created_at + timeoutHours`. Display-only for now — automatic escalation
   * needs a scheduler pass and is not yet wired.
   */
  sla_due_at?: string;
  /**
   * The owning flow's approval steps in graph order, for progress display
   * (resolved on single-request reads when the automation engine is
   * attached). `state` is relative to this request's node.
   */
  flow_steps?: Array<{ id: string; label: string; state: 'done' | 'current' | 'upcoming' }>;
  /**
   * ADR-0044 revision round of this request on its (run, node): 1 (or absent)
   * for the first round, 2 after one send-back-and-resubmit, … Carried in the
   * `node_config_json` snapshot (`__round`), so no schema migration.
   */
  round?: number;
}

/** Kinds of entries on a request's audit trail. */
export type ApprovalActionKind =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'recall'
  | 'escalate'
  /** A pending approver handed their slot to someone else. */
  | 'reassign'
  /** The submitter nudged the pending approvers. */
  | 'remind'
  /** An approver asked the submitter for more information (request stays pending). */
  | 'request_info'
  /** A free-form reply on the thread (submitter or approver). */
  | 'comment'
  /** ADR-0044: an approver sent the request back for revision (request finalizes `returned`). */
  | 'revise'
  /** ADR-0044: the submitter resubmitted after rework (the next round's request opens with its own `submit`). */
  | 'resubmit';

/** Audit row. */
export interface ApprovalActionRow {
  id: string;
  request_id: string;
  step_name?: string;
  step_index?: number;
  action: ApprovalActionKind;
  actor_id?: string;
  comment?: string;
  created_at?: string;
  /** Display name of the actor (`sys_user.name`), when resolvable. */
  actor_name?: string;
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

/** Input for sending a pending request back for revision (ADR-0044). */
export interface ApprovalSendBackInput {
  /** Must be a pending approver on the request (or a system context). */
  actorId: string;
  /** Why the material needs rework — shown to the submitter. */
  comment?: string;
}

/** Result of a send-back (ADR-0044). */
export interface ApprovalSendBackResult {
  request: ApprovalRequestRow;
  /** The suspended flow run this request gated, if any. */
  runId?: string | null;
  /** True when the owning flow run was resumed (down `revise`, or `reject` on auto-reject). */
  resumed?: boolean;
  /**
   * True when the send-back exceeded the node's `maxRevisions` budget and the
   * request was auto-rejected instead (resumed down `reject` with
   * `output.autoRejected = true`).
   */
  autoRejected?: boolean;
}

/** Input for resubmitting a returned request after rework (ADR-0044). */
export interface ApprovalResubmitInput {
  /** Must be the request's submitter (or a system context). */
  actorId: string;
  comment?: string;
}

/** Result of a resubmit (ADR-0044). */
export interface ApprovalResubmitResult {
  /** The round-N request the resubmit was recorded on (stays `returned`). */
  request: ApprovalRequestRow;
  runId?: string | null;
  /** True when the owning flow run was resumed (it re-enters the approval node and opens round N+1). */
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
      /**
       * Free-text search, pushed into the engine query: matches the source
       * name, object, record id, submitter, and the payload snapshot (which
       * carries record titles), case behavior per the underlying driver.
       */
      q?: string;
      /**
       * Page window. Honoured as an engine-level window when the filter is
       * fully pushable; an `approverId` / status-array filter still
       * post-filters in memory (bounded personal queues), where the window
       * is applied after filtering.
       */
      limit?: number;
      offset?: number;
    } | undefined,
    context: SharingExecutionContext,
  ): Promise<ApprovalRequestRow[]>;

  /**
   * Total rows matching a {@link listRequests} filter (ignoring
   * `limit`/`offset`) — the pagination companion.
   */
  countRequests(
    filter: Parameters<IApprovalService['listRequests']>[0],
    context: SharingExecutionContext,
  ): Promise<number>;

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
   *
   * ADR-0044: also valid on the LATEST `returned` request of its (run, node)
   * — the submitter abandons the revision window instead of resubmitting; the
   * request flips `returned → recalled` and the run resumes down `reject` the
   * same way.
   */
  recall(requestId: string, input: ApprovalRecallInput, context: SharingExecutionContext): Promise<ApprovalRecallResult>;

  /**
   * ADR-0044 send back for revision. Finalises the pending request as
   * `returned` and resumes the owning flow run down its `revise` edge to a
   * wait point (record unlocks; the submitter reworks the data and
   * {@link resubmit}s). Requires the approval node to declare a `revise`
   * out-edge; past the node's `maxRevisions` budget the request auto-rejects
   * instead. Audited as `revise`.
   */
  sendBack(
    requestId: string,
    input: ApprovalSendBackInput,
    context: SharingExecutionContext,
  ): Promise<ApprovalSendBackResult>;

  /**
   * ADR-0044 resubmit after rework. Valid on the LATEST `returned` request of
   * its (run, node), submitter-only. Resumes the suspended run from the wait
   * point; traversal re-enters the approval node via the declared back-edge
   * and opens the next round's request (fresh approver slate, record
   * re-locks). Audited as `resubmit` on the returned request.
   */
  resubmit(
    requestId: string,
    input: ApprovalResubmitInput,
    context: SharingExecutionContext,
  ): Promise<ApprovalResubmitResult>;

  /**
   * Hand a pending-approver slot to someone else. The actor must currently
   * be a pending approver (or system); `from` defaults to the actor's own
   * matching identity. Audits a `reassign` action and notifies the new
   * approver when a messaging service is attached.
   */
  reassign(
    requestId: string,
    input: { actorId: string; to: string; from?: string; comment?: string },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }>;

  /**
   * Submitter nudge: notify every pending approver. Throttled — repeat
   * reminders inside the cool-down window are rejected (`THROTTLED`).
   * Audits a `remind` action.
   */
  remind(
    requestId: string,
    input: { actorId: string; comment?: string },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow; notified: number }>;

  /**
   * Approver asks the submitter for more information. The request STAYS
   * pending (no flow movement) — this is a thread interaction, audited as
   * `request_info`, with the submitter notified when messaging is attached.
   */
  requestInfo(
    requestId: string,
    input: { actorId: string; comment: string },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }>;

  /**
   * Free-form reply on the request thread (submitter or any pending
   * approver). Audited as `comment`.
   */
  comment(
    requestId: string,
    input: { actorId: string; comment: string },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }>;

  /** Audit trail for a request. */
  listActions(requestId: string, context: SharingExecutionContext): Promise<ApprovalActionRow[]>;
}
