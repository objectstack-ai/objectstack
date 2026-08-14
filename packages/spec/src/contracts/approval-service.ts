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

// [#6523 / #6206 ruling default] Every method below ADJUDICATES access, so each
// takes the complete `resolveAuthzContext` envelope rather than the six-field
// context shape this contract used to borrow from `sharing-service`
// (`SharingExecutionContext`, retired in #7218 once every implementation had
// been re-annotated). That narrow type omitted `accessible_org_ids` (the
// `group`-posture Layer 0 wall, ADR-0105 D2), `org_user_ids`, `posture`
// (ADR-0095 D2) and `tabPermissions` — see item 3 of the module doc in
// `./sharing-service.js` for the boundary and the measured consequence.
import type { ExecutionContext } from '../kernel/execution-context.zod.js';

/**
 * Lifecycle states of an approval request, in the order the
 * `sys_approval_request.status` select presents them.
 *
 * A VALUE, not only a type, so `plugin-approvals` can spread it into that select
 * rather than re-typing the list (#3786). It used to be a bare union under a
 * "keep in sync with the `sys_approval_request` status select" comment, with the
 * plugin holding the second copy. The two agreed — but nothing made them, and
 * both directions of drift fail quietly: a status the column accepts and the
 * contract omits is invisible to every consumer typed against the contract,
 * while one the contract declares and the column rejects surfaces only at write
 * time, on whichever tenant first reaches that transition.
 *
 * `returned` (ADR-0044): the approver sent the request back for revision —
 * terminal for THIS request/round; the flow walks the `revise` edge to a wait
 * point, and a later resubmit opens a fresh `pending` request (next round).
 * Distinct from `recalled` (submitter-initiated withdrawal).
 */
export const APPROVAL_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'recalled',
  'returned',
] as const;

/** Lifecycle state of an approval request — derived from {@link APPROVAL_STATUSES}. */
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

/**
 * Authored English display label for each {@link APPROVAL_STATUSES} entry —
 * what an English reader sees in the `sys_approval_request.status` select,
 * badges, and the Approvals Inbox (#8543).
 *
 * These five strings used to live ONLY in `plugin-approvals`' generated `en`
 * bundle (#7232 humanized them there), which made the bundle the sole home of
 * deliberately-authored English — exactly what broke the "`en` is a copy of
 * the source" invariant the i18n extractor's default-locale channel relies on.
 * Promoting them here puts English in one place: the column derives its option
 * labels from this map (never re-typed at the column — #3786's rule extended
 * to labels), and the `en` bundle is regenerated from it verbatim.
 *
 * `satisfies` is exhaustive in both directions: a status added to
 * {@link APPROVAL_STATUSES} without a label — or a label for a status the
 * vocabulary dropped — fails to compile.
 */
export const APPROVAL_STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  recalled: 'Recalled',
  returned: 'Returned',
} as const satisfies Record<ApprovalStatus, string>;

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
  /**
   * #3447 P2: the node's author-declared decision-output keys
   * (`config.decisionOutputs`), surfaced from the config snapshot so a
   * decision UI can render one input per key and POST `outputs` with the
   * decision. Absent when the node declares none. Kept as the bare KEY list
   * for version skew — an older console renders these as text inputs.
   */
  decision_outputs?: string[];
  /**
   * #3447 P2 follow-up: the normalized TYPED declarations behind
   * `decision_outputs` — `{ key, label?, type?, multiple? }` — so a
   * picker-aware decision UI renders a sys_user / department / position /
   * team record picker (id values; `multiple` → id array) instead of free
   * text. Always parallel to `decision_outputs`; consumers prefer this and
   * fall back to the key list.
   */
  decision_output_defs?: Array<{
    key: string;
    label?: string;
    type?: 'text' | 'user' | 'department' | 'position' | 'team';
    multiple?: boolean;
    /**
     * The approver must supply this one to APPROVE (objectui#2955) — enforced
     * by `decide()`, so a decision UI should block the approve action on a
     * blank value rather than letting the server reject the round trip.
     * Never enforced on reject.
     */
    required?: boolean;
  }>;
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
   * Group membership of each STILL-PENDING approver, for `per_group` (会签)
   * requests only (objectui#2807). Maps an approver id in `pending_approvers`
   * to the group key(s) it fills — e.g. `{ "u_devadmin": ["finance", "legal"] }`
   * — so a client can label each "waiting on" chip with the group it represents
   * instead of showing duplicate, context-free names. Resolved from the same
   * open-time `__approverGroups` snapshot the `decision_progress` groups use, so
   * the two never disagree. Absent for non-`per_group` behaviors and for slots
   * whose group was synthetic (unnamed). Display-only.
   */
  pending_approver_groups?: Record<string, string[]>;
  /**
   * Display values for lookup fields in `payload` (field key → referenced
   * record's display name), so inbox summaries never show foreign-key ids.
   */
  payload_display?: Record<string, string>;
  /**
   * Display labels for `payload` fields (field key → target object's field
   * label), so inbox summaries show the human field name (e.g. "考核状态")
   * instead of a title-cased machine key ("Assessment Status"). Resolved from
   * the target object's schema — for a single-locale project the schema label
   * IS the localized string; symmetric with `payload_display` (which resolves
   * the values). Absent keys fall back to the client's prettified key.
   */
  payload_labels?: Record<string, string>;
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
  /**
   * Whether THIS node's pending request locks the target record from edits
   * (objectui#2902). Mirrors the `lockRecord` policy the record-lock
   * `beforeUpdate` hook enforces, read from the same `node_config_json`
   * snapshot the hook reads — so a client never has to guess, and never
   * disagrees with the server.
   *
   * `lockRecord` defaults to `true` (see `ApprovalNodeConfigSchema`), so this
   * is `false` only when the node explicitly opted out. Always present on a
   * service read; a client that gets `undefined` is talking to a pre-#3814
   * backend and should fail closed (assume locked) rather than offer an edit
   * the server will reject with `RECORD_LOCKED`.
   *
   * Node-scoped, not request-scoped in spirit: a flow chaining several
   * approval nodes with different policies produces one request per node, and
   * each carries its own value.
   */
  lock_record?: boolean;
  /**
   * Server-computed decision aggregation progress (#3266, single-request reads
   * of PENDING requests only). Present when the node's behavior aggregates
   * multiple approvals: `unanimous` (got/need = approvals of total),
   * `quorum` (got/need = approvals of the M threshold), `per_group`
   * (got/need = satisfied groups of total groups, plus per-group detail).
   * Absent for `first_response`. Display-only — the engine's finalization
   * tally in decideNode stays authoritative.
   */
  decision_progress?: {
    behavior: 'unanimous' | 'quorum' | 'per_group';
    got: number;
    need: number;
    groups?: Array<{ group: string; got: number; need: number; satisfied: boolean }>;
  };

  /**
   * Server-computed capability for THE CURRENT VIEWER (#3310), attached by
   * `getRequest` / `listRequests` from the caller's context. Lets a client gate
   * decision actions precisely without re-deriving identity resolution:
   * declared approver actions use `record.viewer.can_act`, submitter actions use
   * `record.viewer.is_submitter`.
   *
   * - `can_act` — the caller is a *current pending approver* (their user id is in
   *   the request's resolved `pending_approvers` while it is still `pending`).
   *   This mirrors the exact check the service uses to authorize a decision, so
   *   it is strictly more accurate than a client-side identity guess (it already
   *   reflects position/team/manager resolution baked into `pending_approvers`).
   * - `is_submitter` — the caller submitted the request.
   * - `can_override` (#3424) — the caller is a platform/tenant admin who may act
   *   on a *pending* request (approve / reject / reassign / recall it) despite
   *   holding no approver slot. The in-product recovery path for an approval
   *   routed to an unstaffed position, or whose approvers have all since left,
   *   which would otherwise leave the request undecidable and the record locked
   *   forever. Clients OR it into the decision actions' `visible` gate; the
   *   service re-checks the same privilege before applying any override.
   *
   * Absent when the row is surfaced outside a service read with a user context
   * (e.g. a raw data-API grid); a `record.viewer.*` predicate then fails closed.
   */
  viewer?: {
    can_act: boolean;
    is_submitter: boolean;
    can_override: boolean;
  };
}

/**
 * Kinds of entries on a request's audit trail, in the order the
 * `sys_approval_action.action` select presents them.
 *
 * A VALUE for the same reason as {@link APPROVAL_STATUSES}: `plugin-approvals`
 * spreads it into that select instead of holding a twelfth-entry copy of it
 * (#3786). Twelve hand-matched strings across a package boundary is the widest
 * of the sweep's remaining copies, and an audit vocabulary is the worst place
 * for a silent gap — a kind the column accepts but the contract omits produces
 * rows no typed consumer can narrow, and the audit trail is exactly what gets
 * read back when someone asks what happened.
 *
 * Only some entries need explaining; the first five are self-describing:
 *   reassign       a pending approver handed their slot to someone else
 *   remind         the submitter nudged the pending approvers
 *   request_info   an approver asked for more information (request stays pending)
 *   comment        a free-form reply on the thread (submitter or approver)
 *   revise         ADR-0044: sent back for revision (request finalizes `returned`)
 *   resubmit       ADR-0044: resubmitted after rework (the next round opens with
 *                  its own `submit`)
 *   ooo_substitute #1322 M1: an out-of-office approver's slot was auto-rerouted
 *                  to their delegate at resolution time
 *
 * `reassign` / `remind` / `request_info` / `comment` / `ooo_substitute` are
 * thread interactions and never move the flow; `revise` / `resubmit` do.
 */
export const APPROVAL_ACTION_KINDS = [
  'submit',
  'approve',
  'reject',
  'recall',
  'escalate',
  'reassign',
  'remind',
  'request_info',
  'comment',
  'revise',
  'resubmit',
  'ooo_substitute',
] as const;

/** Kinds of entries on a request's audit trail — derived from {@link APPROVAL_ACTION_KINDS}. */
export type ApprovalActionKind = (typeof APPROVAL_ACTION_KINDS)[number];

/**
 * Authored English display label for each {@link APPROVAL_ACTION_KINDS} entry —
 * what an English reader sees in the `sys_approval_action.action` column of a
 * request's audit trail (#8580).
 *
 * The #7232 humanization pass covered `sys_approval_request.status` and missed
 * this sibling field, so the shipped `en` bundle rendered the raw machine
 * values (`submit`, `request_info`, …) — `fieldOptionLabel` in
 * `@object-ui/i18n` falls back to the option's own label with no humanization
 * step, so what is in the bundle is what renders. Same contract-first shape as
 * {@link APPROVAL_STATUS_LABELS}: the column derives its option labels from
 * this map, and the `en` bundle is regenerated from it verbatim.
 *
 * `satisfies` is exhaustive in both directions, same as the status map.
 */
export const APPROVAL_ACTION_KIND_LABELS = {
  submit: 'Submit',
  approve: 'Approve',
  reject: 'Reject',
  recall: 'Recall',
  escalate: 'Escalate',
  reassign: 'Reassign',
  remind: 'Remind',
  request_info: 'Request Info',
  comment: 'Comment',
  revise: 'Revise',
  resubmit: 'Resubmit',
  ooo_substitute: 'Out-of-Office Substitution',
} as const satisfies Record<ApprovalActionKind, string>;

/**
 * A file attached to a decision action (#3266) — the READ shape of one
 * `sys_approval_action.attachments` entry.
 *
 * The column **stores an opaque `sys_file` id** (ADR-0104 D3: that is the
 * stored form of every media field). The name, size, MIME type and URL are not
 * stored alongside it — the ObjectQL read path resolves the id into its
 * expanded `FileValueSchema` form on the way out, and this interface is that
 * form plus the id. So a consumer gets everything it needs to label and open an
 * attachment without read access to the system `sys_file` object, while the
 * write side stays a plain id (see `ApprovalDecisionInput.attachments`).
 *
 * Field names follow the expanded form — `mimeType`, not `mime_type`.
 */
export interface ApprovalActionAttachment {
  /** The `sys_file` id — pass to `GET /storage/files/:id/url` for a signed URL. */
  id: string;
  /** Original filename, for the chip label. */
  name?: string;
  /** Stable download URL (`/api/v1/storage/files/:id`); may be relative. */
  url?: string;
  mimeType?: string;
  size?: number;
}

/** Audit row. */
export interface ApprovalActionRow {
  id: string;
  request_id: string;
  step_name?: string;
  step_index?: number;
  action: ApprovalActionKind;
  actor_id?: string;
  comment?: string;
  /** Files attached to this action (decision attachments, #3266). */
  attachments?: ApprovalActionAttachment[];
  created_at?: string;
  /** Display name of the actor (`sys_user.name`), when resolvable. */
  actor_name?: string;
  /**
   * Structured hand-off parties on a `reassign` action (#4365): the user whose
   * pending-approver slot was moved, and the user who received it. Previously
   * the pair existed only inside a default free-text `comment`
   * (`"<from_id> → <to_id>"`), which clients could neither parse nor render
   * readably. `comment` is now pure user input; consumers render the hand-off
   * from these fields (via the resolved `*_name` companions below).
   */
  reassign_from?: string;
  /** See {@link ApprovalActionRow.reassign_from}. */
  reassign_to?: string;
  /** Display name of `reassign_from` (`sys_user.name`), when resolvable. */
  reassign_from_name?: string;
  /** Display name of `reassign_to` (`sys_user.name`), when resolvable. */
  reassign_to_name?: string;
  /**
   * Whether the actor was admitted to this action ONLY by the privileged
   * admin-override path (#3424) — they held no slot in the request's
   * pending-approver slate (#4466).
   *
   * Before this the two were indistinguishable in the audit trail: an admin
   * overriding a properly-staffed slate wrote byte-for-byte the same row as the
   * designated approver approving normally, and the bypassed approver's later
   * `409 INVALID_STATE` was the only trace — existing only if they happened to
   * try. The platform knows at decision time (it took the override branch to
   * admit the call), so this was dropped information, not unavailable
   * information. Consumers render the distinction; the whole point of an
   * approval record is to answer "who authorized this, and were they entitled
   * to?".
   *
   * `false` means checked and NOT an override. `undefined` means the row
   * predates the column — "not recorded", which is not the same claim.
   */
  via_override?: boolean;
}

/** Input for a decision on an approval request. */
export interface ApprovalDecisionInput {
  decision: 'approve' | 'reject';
  actorId: string;
  comment?: string;
  /**
   * File references (already stored via the storage service) to attach to this
   * decision — e.g. a signed contract or an evidence PDF (#3266). Recorded on
   * the `sys_approval_action` audit row's `attachments` field.
   */
  attachments?: string[];
  /**
   * #3447 P2: structured outputs the approver hands to the flow with their
   * decision. Keys MUST be declared on the node's `decisionOutputs` config —
   * the author declares keys, approvers only fill values (a `screen` node's
   * trust model); a decision carrying undeclared keys is rejected, and
   * `decision` / `requestId` are reserved. Accepted outputs resume the run as
   * `<nodeId>.<key>` flow variables, where a later approval node's
   * `expression` approver can read them (`vars.<nodeId>.picked_departments`).
   *
   * An output declared `required` must carry a non-blank value on an APPROVE
   * (objectui#2955); the decision is rejected before any write otherwise. A
   * reject never requires them.
   */
  outputs?: Record<string, unknown>;
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
  /**
   * Why the run was not resumed, when `resumed` is false but the recall itself
   * succeeded. A recall abandons the request, so a lost run does not fail the
   * call — but it must not read as a clean resume either (#4420).
   */
  resumeError?: string;
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
   * Why the run was not resumed, on the paths that tolerate it (a concurrent
   * duplicate resume). A resume failure that strands the run throws instead —
   * see `RESUME_TARGET_LOST` / `RESUME_FAILED` (#4420).
   */
  resumeError?: string;
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
  /**
   * Why the run was not resumed, on the paths that tolerate it (a concurrent
   * duplicate resume). A resume failure that strands the run throws instead —
   * see `RESUME_TARGET_LOST` / `RESUME_FAILED` (#4420).
   */
  resumeError?: string;
}

/** Result of a decision that resumes the owning flow when finalised. */
export interface ApprovalDecisionResult {
  request: ApprovalRequestRow;
  /** True when this call moved the request to a terminal state. */
  finalized: boolean;
  decision: 'approve' | 'reject';
  /** The suspended flow run that was (or will be) resumed, if any. */
  runId?: string | null;
  /**
   * True when the owning flow run was resumed as a result of this decision.
   *
   * A decision that finalises a flow-bound request and CANNOT resume its run
   * throws rather than returning `resumed: false` — a recorded decision whose
   * flow never advances is the zombie half-state of #4420. `false` here means
   * either there was nothing to resume (no run, not finalised, no automation
   * attached) or a benign duplicate, in which case see {@link resumeError}.
   */
  resumed?: boolean;
  /**
   * Why the run was not resumed, on the one path that tolerates it: a
   * concurrent duplicate resume (`RESUME_IN_PROGRESS`) — the other caller is
   * already advancing the run, so this decision is complete and correct.
   */
  resumeError?: string;
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
    context: ExecutionContext,
  ): Promise<ApprovalRequestRow[]>;

  /**
   * Total rows matching a {@link listRequests} filter (ignoring
   * `limit`/`offset`) — the pagination companion.
   */
  countRequests(
    filter: Parameters<IApprovalService['listRequests']>[0],
    context: ExecutionContext,
  ): Promise<number>;

  getRequest(requestId: string, context: ExecutionContext): Promise<ApprovalRequestRow | null>;

  /**
   * Record a decision on a node-driven request. Honours the node's
   * `unanimous` behaviour, finalises the request when satisfied, and resumes
   * the owning flow run down the matching `approve` / `reject` edge.
   */
  decide(requestId: string, input: ApprovalDecisionInput, context: ExecutionContext): Promise<ApprovalDecisionResult>;

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
  recall(requestId: string, input: ApprovalRecallInput, context: ExecutionContext): Promise<ApprovalRecallResult>;

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
    context: ExecutionContext,
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
    context: ExecutionContext,
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
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }>;

  /**
   * Submitter nudge: notify every pending approver. Throttled — repeat
   * reminders inside the cool-down window are rejected (`THROTTLED`).
   * Audits a `remind` action.
   */
  remind(
    requestId: string,
    input: { actorId: string; comment?: string },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow; notified: number }>;

  /**
   * Approver asks the submitter for more information. The request STAYS
   * pending (no flow movement) — this is a thread interaction, audited as
   * `request_info`, with the submitter notified when messaging is attached.
   */
  requestInfo(
    requestId: string,
    input: { actorId: string; comment: string },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }>;

  /**
   * Free-form reply on the request thread (submitter or any pending
   * approver). Audited as `comment`.
   */
  comment(
    requestId: string,
    input: { actorId: string; comment: string },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }>;

  /** Audit trail for a request. */
  listActions(requestId: string, context: ExecutionContext): Promise<ApprovalActionRow[]>;
}
