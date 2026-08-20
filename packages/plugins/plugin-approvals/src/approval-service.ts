// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, randomBytes } from 'node:crypto';
import {
  APPROVAL_BRANCH_LABELS,
  APPROVAL_REVISE_NODE_TYPE,
  approverTypeIsOrgScoped,
  canonicalApproverType,
  normalizeDecisionOutputs,
  type ApprovalNodeConfig,
} from '@objectstack/spec/automation';
import { ExpressionEngine, collectCelRootIdentifiers } from '@objectstack/formula';
import { keysetWalk } from '@objectstack/types';
import {
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN_GRANTS,
  BUILTIN_IDENTITY_PLATFORM_ADMIN,
  BUILTIN_IDENTITY_ORG_OWNER,
  BUILTIN_IDENTITY_ORG_ADMIN,
} from '@objectstack/spec/identity';
import type {
  IApprovalService,
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalActionAttachment,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalRecallInput,
  ApprovalRecallResult,
  ApprovalSendBackInput,
  ApprovalSendBackResult,
  ApprovalResubmitInput,
  ApprovalResubmitResult,
  ApprovalStatus,
} from '@objectstack/spec/contracts';
// [#7135] The full `resolveAuthzContext` envelope — what `IApprovalService`
// declares for every one of these context parameters since #6523 (the #6206
// ruling: enforcement adjudicates on the whole envelope, never a per-site
// subset). Annotating the implementation with the retired six-field shape is
// what forced this file to cast its way out of its own contract to read
// fields the caller had already supplied.
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { RESUME_AUTHORITY_SERVICE } from '@objectstack/spec/contracts';
import { isFileIdToken } from '@objectstack/spec/data';
import { isGrantActive } from '@objectstack/core';
import {
  filterApproversWhoCanRead,
  resolveApproverDirectoryOrg,
  type ApproverOrgScopeDeps,
  type ApproverOrgScopeEngine,
} from './approver-org-scope.js';

/**
 * Node-era approval runtime (ADR-0019).
 *
 * Approval is no longer a standalone engine — it is a **flow node**. A flow's
 * Approval node opens a request via {@link ApprovalService.openNodeRequest} and
 * the run suspends; a human decision via {@link ApprovalService.decide}
 * finalises the request and resumes the owning run down the matching
 * `approve` / `reject` edge.
 *
 * This service owns the durable approval *state* — `sys_approval_request` /
 * `sys_approval_action`, approver resolution (team / department / position /
 * role / manager graph), and the optional status-field mirror — plus the decision
 * API. It does not author processes, submit, or walk multi-step machinery
 * anymore; that orchestration lives on the one automation engine.
 */
export interface ApprovalEngine {
  find(object: string, options?: any): Promise<any[]>;
  insert(object: string, data: any, options?: any): Promise<any>;
  update(object: string, idOrData: any, dataOrOptions?: any, options?: any): Promise<any>;
  delete(object: string, options?: any): Promise<any>;
}

export interface ApprovalClock { now(): Date }

/**
 * Minimal automation surface the service uses to resume a suspended flow run
 * once a decision finalises a node-driven request. Optional — attached by the
 * plugin when an automation engine is present (see `approval-node.ts`).
 */
export interface ApprovalResumeSurface {
  resume?(runId: string, signal?: {
    output?: Record<string, unknown>;
    branchLabel?: string;
    /**
     * #3801: the engine refuses a resume of an `approval` suspension unless
     * the signal carries this marker — the proof that the resume is the tail
     * of a decision THIS service already authorized and recorded, not a raw
     * `POST …/runs/:runId/resume` around it. Every resume below stamps it via
     * {@link ApprovalService.serviceResume}.
     */
    [RESUME_AUTHORITY_SERVICE]?: true;
  }): Promise<unknown>;
  /** Flow definition lookup, used to derive step-progress display data. */
  getFlow?(name: string): Promise<any | null>;
  /**
   * Terminally cancel a suspended run (ADR-0044). Used when a recall lands
   * during a revision window — the run is paused at the revise-window node,
   * which has no reject edge to resume down.
   */
  cancelRun?(runId: string, reason?: string): Promise<unknown>;
  /**
   * Look up a run's recorded outcome (#3456). Used by the dead-run sweep to ask
   * "is the run behind this pending request still alive?".
   *
   * The contract that makes the sweep safe is the answer for a run that is
   * merely SUSPENDED (the normal state of a run waiting on an approval): the
   * engine writes no execution-log entry until a run reaches a terminal state,
   * so a suspended run resolves to `null`, never to a status. The sweep
   * therefore acts only on an explicit terminal-failure status and treats
   * `null` — unknown run, evicted log, no durable store, no automation engine —
   * as "still alive".
   */
  getRun?(runId: string): Promise<{ status?: string } | null>;
  /**
   * Whether a suspension still exists for `runId` — the pre-flight that keeps
   * a decision from being recorded against a run that can never advance
   * (#4420). Read-only; it never consumes the suspension.
   *
   * Still distinct from {@link getRun}, but no longer on the axis this comment
   * used to name: since #8050 `getRun` also sees a run suspended by a PREVIOUS
   * process (it resolved `null` there before, unable to tell "waiting for a
   * human" from "dead"). The difference that remains is the one a pre-flight
   * turns on — this asks the suspension store and REJECTS when it cannot be
   * read, where `getRun` degrades an outage to `null`. A caller about to WRITE
   * must not accept a degraded read.
   *
   * Rejects when the durable store cannot be read — existence is then
   * unknown, and callers must not read an outage as a dead run. Optional: an
   * engine that does not implement it simply gets no pre-flight.
   */
  hasSuspendedRun?(runId: string): Promise<boolean>;
}

/**
 * Optional messaging surface (ADR-0012 `messaging` service). When attached,
 * thread interactions (reassign / remind / request-info / comment) notify the
 * affected users; without it they degrade to audit-only.
 */
export interface ApprovalMessagingSurface {
  emit(input: {
    topic: string;
    audience: string[];
    payload?: Record<string, unknown>;
    severity?: string;
    dedupKey?: string;
    source?: { object: string; id: string };
    actorId?: string;
  }): Promise<unknown>;
}

/** Minimum time between submitter reminders on one request. */
export const REMIND_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/** Named job under which the SLA escalation scan is registered (ADR-0042). */
export const ESCALATION_JOB_NAME = 'approvals-sla-escalation';
/** Default interval between SLA escalation scans. */
export const ESCALATION_SCAN_INTERVAL_MS = 5 * 60 * 1000;
/** Reserved actor id for machine decisions made by the SLA scanner. */
export const SLA_ACTOR_ID = 'system:sla';
/** Reserved actor id for requests abandoned because their run died (#3456). */
export const DEAD_RUN_ACTOR_ID = 'system:dead-run';
/**
 * Run statuses that mean "this run will never resume", so a request still
 * pending on it is orphaned (#3456). A CLOSED set, deliberately: the dead-run
 * sweep treats every other answer — `paused` (a run waiting on its approval,
 * the normal case), `running`, an unknown status, or no answer at all — as
 * alive, so an unrecognised state can never cost someone a live approval.
 *
 * `completed` belongs here with the failure states. The approval node only
 * writes a request row on the path where it also suspends the run, and every
 * in-band transition (decide / recall / send-back / resubmit) finalises the
 * request *before* it resumes the run — so a completed run with a still-pending
 * request means the run was resumed out of band and left the request behind.
 */
const TERMINAL_RUN_STATUSES: ReadonlySet<string> = new Set([
  'completed', 'failed', 'cancelled', 'timed_out',
]);

/**
 * Request statuses that can leave a ZOMBIE behind (#4469) — the terminal states
 * a decision reaches only by ALSO resuming the owning run.
 *
 * `recalled` is deliberately absent: a recall ABANDONS the request on purpose,
 * and {@link ApprovalService.recall} explicitly tolerates a run it cannot
 * resume (the withdrawal and the lock release are the point). Reporting those
 * would bury the real findings under expected ones.
 */
const STRANDABLE_REQUEST_STATUSES = ['approved', 'rejected', 'returned'] as const;

/**
 * One terminal request whose owning flow run is unrecoverable (#4469) — the
 * decision was recorded and the flow never moved. Reporting shape only: the
 * sweep never rewrites these rows (see
 * {@link ApprovalService.inspectStrandedRequests}).
 */
export interface StrandedApprovalRequest {
  requestId: string;
  /** Terminal status the request reached — the decision that WAS recorded. */
  status: string;
  /** The `flow_run_id` that resolves to neither a suspension nor a run history row. */
  runId: string;
  flowName?: string;
  /** Approval node the run should have continued from. */
  nodeId?: string;
  objectName: string;
  recordId: string;
  organizationId?: string | null;
  completedAt?: string;
  /** `config.approvalStatusField`, when the node mirrors status onto the record. */
  mirrorField?: string;
  /** What that mirror field currently reads — usually the stale value an operator sees. */
  mirroredStatus?: string;
}

/** Default lifetime of an actionable-link token (ADR-0043). */
export const ACTION_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

/** Outcome of redeeming (or peeking) an actionable-link token. */
export type ActionTokenOutcome =
  | { ok: true; action: 'approve' | 'reject'; request: ApprovalRequestRow; approverId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' | 'not_pending' | 'not_approver'; request?: ApprovalRequestRow };

/**
 * System-elevated context for this service's own metadata reads and writes.
 *
 * [#7135] Typed as the full envelope so it is passed AS ITSELF. It used to be
 * declared `as const` and forced through `as unknown as
 * SharingExecutionContext` at the three sites that handed it to a CONTRACT
 * method — a double cast on an enforcement input, which switches checking off
 * for the whole argument rather than for the readonly-array mismatch that
 * provoked it.
 */
const SYSTEM_CTX: ExecutionContext = { isSystem: true, positions: [], permissions: [] };

/**
 * Who is acting, for the purpose of a data write made on their behalf (#3783).
 *
 * Reads the AUTHENTICATED principal off the execution context — deliberately not
 * `input.actorId`. When this was written the two could still disagree: every
 * public entrypoint took `actorId` from the request body (`body.actorId ??
 * context.userId`, see the REST approval routes) and the service only checked
 * that it named a pending approver, never that it was the caller. That was
 * called tolerable on an audit row — but the same unchecked value was the
 * authorization key, so it was in fact impersonation, and #3800 closed it:
 * {@link ApprovalService.resolveActor} now pins the actor to an identity the
 * server can prove belongs to the caller. This helper stays the separate,
 * stricter answer for a DATA WRITE, which wants the bare human id and never a
 * `type:value` slot literal or a machine sentinel.
 *
 * A caller holding a trustworthy actor with no session behind it — the ADR-0043
 * action link, whose token cryptographically binds exactly one approver — puts
 * that actor ON the context instead of relying on this.
 *
 * `null` for a machine caller (the SLA sweep passes {@link SYSTEM_CTX}), so a
 * reserved sentinel like {@link SLA_ACTOR_ID} can never surface as a `userId`.
 */
function actingUserId(context: ExecutionContext | undefined): string | null {
  const userId = context?.userId;
  return typeof userId === 'string' && userId ? userId : null;
}

/**
 * Max hops when following an OOO delegation chain (#1322 M1): A out → B, B out
 * → C, … Bounds the walk so a mis-configured chain can't loop or resolve
 * unboundedly; a cycle or self-reference also stops it early.
 */
const OOO_MAX_CHAIN = 8;

/**
 * Approver types resolved by QUERYING a graph rather than by taking `value`
 * literally (#3807). Each can legitimately come back empty — an unstaffed
 * position, an emptied team, a mis-pointed unit — and the caller then falls
 * back to a `type:value` literal that no user can act on. They are listed here
 * so that dead end gets one warning instead of passing in silence.
 *
 * `user` / `field` are deliberately absent: they resolve to the id they were
 * given without a lookup, so there is no "expanded to nobody" state to report.
 * `business_unit` / `bu` are the accepted dialects of `department`.
 */
const GRAPH_APPROVER_TYPES: ReadonlySet<string> = new Set([
  'team', 'department', 'business_unit', 'bu', 'position', 'org_membership_level', 'manager',
]);

/** One OOO delegation hop applied while resolving an approver (#1322 M1/M4). */
interface OooSubstitution {
  /** The approver who was skipped (out of office). */
  from: string;
  /** The delegate the slot was routed to. */
  to: string;
  /** The delegator's declared reason, if any. */
  reason: string | null;
}

/**
 * The CLOSED set of namespace roots an `expression` approver may reference
 * (#3447 P2). Three explicit times/sources, no `record`, no bare field names:
 * `record` means "the record at event time" everywhere else on the platform
 * (flow conditions: trigger snapshot; hooks: the write payload), so binding it
 * here — to either time — would silently alias one meaning to the other. The
 * runtime CEL env treats unknown roots as `dyn` (→ `null` → an empty slate),
 * so out-of-contract roots MUST be rejected before evaluation; both this
 * pre-check and the lint rule read the roots via
 * {@link collectCelRootIdentifiers} so they can never drift.
 */
const APPROVER_EXPRESSION_ROOTS = new Set(['current', 'trigger', 'vars']);

/**
 * Evaluation context an approval node hands to `expression` approvers
 * (#3447 P2). `current` (the live record) is supplied by openNodeRequest's
 * re-read; these two carry the other roots.
 */
export interface ApproverExpressionContext {
  /** Submit-time snapshot (the flow's `$record`) — bound as `trigger.*`. */
  trigger?: Record<string, unknown> | null;
  /** Flow variables at node entry (nested by dotted key) — bound as `vars.*`. */
  vars?: Record<string, unknown> | null;
}

/**
 * Non-request outcome of {@link ApprovalService.openNodeRequest}: the node
 * resolved an empty approver slate and its `onEmptyApprovers: 'auto_approve'`
 * policy waved it through (#3447 P2). No `sys_approval_request` row exists —
 * nobody was ever asked — so the node must complete down its `approve` edge
 * instead of suspending.
 */
export interface ApprovalNodeAutoOutcome {
  autoApproved: true;
  reason: 'empty_approvers';
}

function uid(prefix: string): string {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `${prefix}_${g.crypto.randomUUID()}`;
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseJson<T = any>(raw: unknown, fallback: T): T {
  if (raw == null || raw === '') return fallback;
  if (typeof raw === 'string') {
    try { return JSON.parse(raw) as T; } catch { return fallback; }
  }
  return raw as T;
}

function csvSplit(raw: unknown): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  return String(raw).split(',').map(s => s.trim()).filter(Boolean);
}

/**
 * Is a submitted decision output blank — i.e. does it fail a `required`
 * declaration (objectui#2955)?
 *
 * "Present but empty" has to count as missing: a decision UI sends whatever
 * its widget holds, and an untouched picker/text box is `''` or `[]`. Letting
 * those through would satisfy `required` with a value the downstream
 * `expression` approver then resolves to nobody — the exact stall the flag
 * exists to prevent. `false` and `0` are real values and pass.
 */
function isBlankDecisionOutput(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.filter(v => v !== null && v !== undefined && String(v).trim() !== '').length === 0;
  return false;
}

/**
 * Humanize a machine name for display fallback: strips a `flow:` prefix and
 * title-cases underscore/dash segments (`flow:manager_review` → "Manager
 * Review"). Used only when no authored label was snapshotted on the row.
 */
function prettifyMachineName(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const base = String(raw).replace(/^flow:/, '').trim();
  if (!base) return undefined;
  return base
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function rowFromRequest(row: any): ApprovalRequestRow {
  // Authored display labels ride the node-config snapshot (`__flowLabel` /
  // `__nodeLabel`) so they survive without a schema migration; fall back to a
  // prettified machine name for rows written before labels were captured.
  const cfg = parseJson<any>(row.node_config_json, undefined);
  return {
    id: String(row.id),
    organization_id: row.organization_id ?? undefined,
    process_name: String(row.process_name ?? ''),
    object_name: String(row.object_name ?? ''),
    record_id: String(row.record_id ?? ''),
    submitter_id: row.submitter_id ?? undefined,
    submitter_comment: row.submitter_comment ?? undefined,
    status: (row.status as ApprovalStatus) ?? 'pending',
    current_step: row.current_step ?? undefined,
    current_step_index: row.current_step_index ?? undefined,
    pending_approvers: csvSplit(row.pending_approvers),
    payload: parseJson(row.payload_json, undefined),
    flow_run_id: row.flow_run_id ?? undefined,
    flow_node_id: row.flow_node_id ?? undefined,
    completed_at: row.completed_at ?? undefined,
    created_at: row.created_at ?? undefined,
    updated_at: row.updated_at ?? undefined,
    // The row is created at submission time; expose the stable inbox-facing name.
    submitted_at: row.created_at ?? undefined,
    process_label: cfg?.__flowLabel ?? prettifyMachineName(row.process_name),
    step_label: cfg?.__nodeLabel ?? prettifyMachineName(row.current_step),
    sla_due_at: slaDueAt(row.created_at, cfg),
    // ADR-0044 revision round (rides the config snapshot; absent ⇒ round 1).
    round: typeof cfg?.__round === 'number' ? cfg.__round : undefined,
    // objectui#2902: the node's record-lock policy. The lock is enforced
    // server-side in `lifecycle-hooks.ts` off THIS SAME snapshot with the
    // same `!== false` default, so the flag a client renders and the rule the
    // server applies can never drift. Without it a console can only see
    // "a pending request exists" and has to assume the record is locked —
    // which mislabels every `lockRecord: false` node as locked and hides an
    // edit the server would have accepted.
    lock_record: cfg?.lockRecord !== false,
    // #3447 P2: the node's author-declared decision outputs, surfaced so a
    // decision UI can render input fields for them and POST `outputs` on
    // approve/reject. Per-request (each node declares its own), which is why
    // this rides the row instead of the static action params. Two shapes for
    // version skew: `decision_outputs` stays the bare KEY list an older
    // console renders as text inputs; `decision_output_defs` carries the
    // normalized typed declarations a picker-aware console prefers.
    ...(() => {
      const defs = normalizeDecisionOutputs(cfg?.decisionOutputs);
      return defs.length
        ? { decision_outputs: defs.map(d => d.key), decision_output_defs: defs }
        : {};
    })(),
  } as any;
}

/** `created_at + escalation.timeoutHours`, when the node declares an SLA. */
function slaDueAt(createdAt: unknown, cfg: any): string | undefined {
  const hours = cfg?.escalation?.timeoutHours;
  if (typeof hours !== 'number' || hours <= 0 || !createdAt) return undefined;
  const t = Date.parse(String(createdAt));
  if (Number.isNaN(t)) return undefined;
  return new Date(t + hours * 3600_000).toISOString();
}

/**
 * Normalize one raw `attachments` entry into an {@link ApprovalActionAttachment}.
 *
 * `sys_approval_action.attachments` is a `Field.file` (multiple), so the column
 * **stores opaque `sys_file` ids** — that is the stored form of every media
 * field (ADR-0104 D3). What arrives here is whichever of three forms the read
 * path produced:
 *
 *  1. the **expanded** `{ id, name, size, mimeType, url }` the ObjectQL read
 *     path resolves a stored id into — the normal case;
 *  2. a **bare id**, when there was nothing to expand it into (storage service
 *     absent, file not committed);
 *  3. a **legacy inline blob** (`{ file_id, name, mime_type, url, … }`) written
 *     before file-as-reference, until the backfill converts it.
 *
 * The original mapping did `String(entry)`, which turned form 1 into the
 * literal `"[object Object]"` — so the inbox timeline showed a nameless,
 * un-openable attachment chip (#3266 follow-up; caught by browser verification).
 *
 * Note the casing: the expanded form carries `mimeType`, the legacy blob
 * `mime_type`. Both are accepted for the duration of the migration window.
 */
function normalizeActionAttachment(entry: any): ApprovalActionAttachment | undefined {
  if (entry == null) return undefined;
  // Form 2 — a bare reference. `isFileIdToken` is the platform's single arbiter
  // of "is this string an opaque file id, or a URL?", shared with the engine's
  // read resolver, so the two cannot disagree about what counts as an id.
  if (typeof entry === 'string') {
    const id = entry.trim();
    if (!id) return undefined;
    return isFileIdToken(id) ? { id } : { id, url: id };
  }
  if (typeof entry === 'object') {
    // Forms 1 and 3 — `file_id` is the legacy blob's key for the same thing.
    const id = entry.id ?? entry.file_id;
    if (id == null || String(id) === '') return undefined;
    const mimeType = entry.mimeType ?? entry.mime_type;
    return {
      id: String(id),
      name: typeof entry.name === 'string' ? entry.name : undefined,
      url: typeof entry.url === 'string' ? entry.url : undefined,
      mimeType: typeof mimeType === 'string' ? mimeType : undefined,
      size: typeof entry.size === 'number' ? entry.size : undefined,
    };
  }
  return undefined;
}

function rowFromAction(row: any): ApprovalActionRow {
  const attachments = Array.isArray(row.attachments)
    ? row.attachments.map(normalizeActionAttachment).filter((a: ApprovalActionAttachment | undefined): a is ApprovalActionAttachment => !!a)
    : [];
  return {
    id: String(row.id),
    request_id: String(row.request_id),
    step_name: row.step_name ?? undefined,
    step_index: row.step_index ?? undefined,
    action: row.action,
    actor_id: row.actor_id ?? undefined,
    comment: row.comment ?? undefined,
    // Structured reassign hand-off parties (#4365).
    reassign_from: row.reassign_from ?? undefined,
    reassign_to: row.reassign_to ?? undefined,
    // #4466 — surfaced so a timeline can SAY "overridden the approver slate"
    // rather than render an override identically to an ordinary approval.
    // `null` (a row written before the column existed) stays `undefined`:
    // "not recorded" is not the same claim as "not an override".
    via_override: row.via_override == null ? undefined : row.via_override === true,
    // Decision attachments (#3266): rich descriptors carrying the display name +
    // download URL, so consumers label/open them without reading `sys_file`.
    attachments: attachments.length ? attachments : undefined,
    created_at: row.created_at ?? undefined,
  };
}

export interface ApprovalServiceOptions {
  engine: ApprovalEngine;
  clock?: ApprovalClock;
  logger?: { info?: (msg: any, ...rest: any[]) => void; warn?: (msg: any, ...rest: any[]) => void; error?: (msg: any, ...rest: any[]) => void; debug?: (msg: any, ...rest: any[]) => void };
  /**
   * Optional automation surface used to resume a suspended flow run when a
   * decision finalises a request. Usually attached after construction via
   * {@link ApprovalService.attachAutomation} once the automation engine is
   * available.
   */
  automation?: ApprovalResumeSurface;
  /** Optional messaging service for thread notifications. */
  messaging?: ApprovalMessagingSurface;
  /**
   * Absolute origin prefixed onto actionable links (ADR-0043), e.g.
   * `https://app.example.com`. Defaults to relative URLs, which work inside
   * the Console and IM webviews; outbound email needs the absolute form.
   */
  publicBaseUrl?: string;
  /**
   * [ADR-0105 D9] The tenancy posture in force. Cross-organization approver
   * targeting is a `group`-posture capability; the resolver refuses the
   * declaration under any other posture rather than silently ignoring it.
   * Absent (a stack booted with no tenancy service) reads as "unknown" and the
   * guard stands down.
   */
  tenancyPosture?: () => string | undefined;
  /**
   * [#8652] Objects on which a user holding READ access to the target business
   * record may also see that record's approval requests and action history —
   * read-only. Empty or absent (the default) leaves visibility exactly as it
   * was. See {@link ApprovalService.recordReaderVisibleIds} for the rule and
   * its boundaries.
   */
  recordReaderVisibleObjects?: string[];
}

export class ApprovalService implements IApprovalService {
  private readonly engine: ApprovalEngine;
  private readonly clock: ApprovalClock;
  private readonly logger?: ApprovalServiceOptions['logger'];
  private automation?: ApprovalResumeSurface;
  private messaging?: ApprovalMessagingSurface;
  private publicBaseUrl: string;
  private tenancyPosture?: () => string | undefined;
  /**
   * [#8652] The enabled object set for the record-reader visibility tier.
   * EMPTY means the tier is off — the default, and the shape every existing
   * deployment gets on upgrade.
   */
  private readonly recordReaderVisibleObjects: ReadonlySet<string>;

  constructor(opts: ApprovalServiceOptions) {
    this.engine = opts.engine;
    this.clock = opts.clock ?? { now: () => new Date() };
    this.logger = opts.logger;
    this.automation = opts.automation;
    this.messaging = opts.messaging;
    this.publicBaseUrl = (opts.publicBaseUrl ?? '').replace(/\/$/, '');
    this.tenancyPosture = opts.tenancyPosture;
    this.recordReaderVisibleObjects = new Set(
      (Array.isArray(opts.recordReaderVisibleObjects) ? opts.recordReaderVisibleObjects : [])
        .map((n) => String(n ?? '').trim())
        .filter(Boolean),
    );
  }

  /** Attach (or replace) the ADR-0105 D9 posture provider. */
  attachTenancyPosture(provider: () => string | undefined): void {
    this.tenancyPosture = provider;
  }

  /** Deps bundle for the ADR-0105 D9 org-scope helpers. */
  private get orgScopeDeps(): ApproverOrgScopeDeps {
    return {
      engine: this.engine as unknown as ApproverOrgScopeEngine,
      posture: this.tenancyPosture,
      logger: this.logger,
    };
  }

  /**
   * [ADR-0105 D9] Which organization's directory resolves ONE approver spec.
   * Absent declaration ⇒ the request's own organization (unchanged, no reads).
   */
  private async directoryOrgFor(a: any, requestOrgId: string | null | undefined): Promise<string | null | undefined> {
    const rawType = String(a?.type ?? '');
    return resolveApproverDirectoryOrg(
      this.orgScopeDeps,
      a?.organization,
      requestOrgId,
      rawType,
      approverTypeIsOrgScoped(rawType),
    );
  }

  /** Attach (or replace) the automation surface used to resume flow runs. */
  attachAutomation(automation: ApprovalResumeSurface): void {
    this.automation = automation;
  }

  /** Attach (or replace) the messaging surface used for thread notifications. */
  attachMessaging(messaging: ApprovalMessagingSurface): void {
    this.messaging = messaging;
  }

  /** Best-effort notification fan-out — failures only log. */
  private async notify(input: {
    topic: string;
    audience: string[];
    payload?: Record<string, unknown>;
    dedupKey?: string;
    source?: { object: string; id: string };
    actorId?: string;
  }): Promise<number> {
    const audience = input.audience.filter(a => a && !a.includes(':'));
    if (!this.messaging || !audience.length) return 0;
    // Deep-link the inbox (#2678 P1.5): a notification about one request should
    // land on that request, not the bare inbox. Rewritten centrally so every
    // call site — and any future one — inherits it; the query param is read by
    // the console inbox to auto-open the drawer.
    let payload = input.payload;
    if (
      payload?.actionUrl === '/system/approvals'
      && input.source?.object === 'sys_approval_request'
      && input.source.id
    ) {
      payload = { ...payload, actionUrl: `/system/approvals?request=${encodeURIComponent(input.source.id)}` };
    }
    try {
      await this.messaging.emit({ severity: 'info', ...input, payload, audience });
      return audience.length;
    } catch (err: any) {
      this.logger?.warn?.('[approvals] notification failed', {
        topic: input.topic, error: err?.message ?? String(err),
      });
      return 0;
    }
  }

  /** Load a request row and assert it is still pending. */
  private async loadPendingRow(requestId: string): Promise<any> {
    if (!requestId) throw new Error('VALIDATION_FAILED: requestId is required');
    const rows = await this.engine.find('sys_approval_request', {
      where: { id: requestId }, limit: 1, context: SYSTEM_CTX,
    });
    const raw: any = Array.isArray(rows) ? rows[0] : null;
    if (!raw) throw new Error(`REQUEST_NOT_FOUND: ${requestId}`);
    if (raw.status !== 'pending') throw new Error(`INVALID_STATE: request is ${raw.status}`);
    return raw;
  }

  /**
   * Privileged-override gate (#3424). A stuck approval — one routed to a
   * position/team with no holders (so its `pending_approvers` is only an
   * unresolvable `type:value` literal) or to approvers who have all since left —
   * is otherwise undecidable: no concrete user is in the slate, so every normal
   * `decide` / `reassign` / `recall` is `FORBIDDEN` and (with `lockRecord`) the
   * record stays locked forever with no in-product recovery. A platform or
   * tenant admin — the same posture the engine's superuser bypass already
   * trusts — may always act on a PENDING request to release it: approve, reject,
   * reassign it to a real approver, or recall it.
   *
   * A platform admin crosses the tenant wall (matching the unscoped
   * `admin_full_access` evidence); a tenant admin may override only within their
   * own org (or an org-less request). A system context always passes. Signals are
   * read defensively off the resolved exec context (`permissions` / `positions` /
   * the derived `posture`, ADR-0095) so any transport that resolves through the
   * shared authz resolver lights this up without extra wiring.
   */
  private isOverrideActor(context: ExecutionContext, requestOrg?: string | null): boolean {
    if (!context) return false;
    if (context.isSystem) return true;
    const perms = Array.isArray(context.permissions) ? context.permissions : [];
    const positions = Array.isArray(context.positions) ? context.positions : [];
    // [#7135] A DECLARED read. `posture` (ADR-0095 D2) is resolved by
    // `resolveAuthzContext` and is a field of the envelope the contract has
    // named here since #6523 — the doc block above already says it is the
    // intended signal. Until this parameter widened, reading it meant an
    // unchecked `as any` on an enforcement input: a typo (`postures`,
    // `'PLATFORM-ADMIN'`) would have compiled and silently denied every
    // override, leaving a stuck approval with no in-product recovery.
    const posture = context.posture;
    const isPlatformAdmin = posture === 'PLATFORM_ADMIN'
      || perms.includes(ADMIN_FULL_ACCESS)
      || positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    if (isPlatformAdmin) return true;
    const isTenantAdmin = posture === 'TENANT_ADMIN'
      || ORGANIZATION_ADMIN_GRANTS.some((n) => perms.includes(n))
      || positions.includes(BUILTIN_IDENTITY_ORG_OWNER)
      || positions.includes(BUILTIN_IDENTITY_ORG_ADMIN);
    if (!isTenantAdmin) return false;
    // A tenant admin's authority stops at their own org; a null-org request is
    // global and any admin may release it.
    // Only the `tenantId` half of this read lost its cast: `tenantId` is a
    // declared field of the envelope, `organizationId` is not a field of it at
    // ALL. That spelling has its own history (#5858 / `check:org-identifier`)
    // and was explicitly held out of this change (#7070) — so it stays cast,
    // and the asymmetry is now the visible marker of which of the two names
    // the contract actually knows.
    const actorTenant = context.tenantId ?? (context as any).organizationId ?? null;
    return requestOrg == null || (actorTenant != null && String(requestOrg) === String(actorTenant));
  }

  /**
   * Pin the acting identity to the AUTHENTICATED CALLER (#3800).
   *
   * Every public entrypoint accepts an `actorId`, and the REST routes fill it
   * from `body.actorId ?? body.actor_id ?? context.userId` — so before this
   * gate the body won. The authorization checks downstream all read that value
   * (`pending_approvers.includes(input.actorId)`, `submitter_id === actorId`),
   * which made the body-supplied string not merely the audit label but the key
   * that opens the door: any authenticated user could name a pending approver
   * and have that approver's decision recorded and the owning flow resumed.
   * #3783 drew this line for the data-write identity ({@link actingUserId});
   * this closes the authorization half.
   *
   * A caller may still name an identity OTHER than their bare user id, because
   * a slot legitimately can be keyed by one: `resolveApproverSpec` stores the
   * `type:value` literal when a graph lookup yields nothing, and an author may
   * write an email as a `user` approver. So the rule is not "actorId must equal
   * userId" — it is **"actorId must be an identity the SERVER can prove belongs
   * to the caller"**. Anything else is `FORBIDDEN`.
   *
   * A system context is exempt and keeps its explicit actor: the SLA sweep
   * passes the reserved {@link SLA_ACTOR_ID} sentinel, and the ADR-0043 action
   * link passes the approver its single-use token is cryptographically bound to
   * (having also put them on the context). Those are the only two callers that
   * hold a trustworthy actor with no session behind them.
   *
   * A caller with NO identity at all cannot act. Belt-and-suspenders: the REST
   * anonymous-deny now denies every anonymous request (#3963), but this service
   * must not rely on a caller upstream — an anonymous actor could otherwise
   * decide approvals outright by naming one.
   */
  private async resolveActor(
    actorId: string | undefined,
    context: ExecutionContext,
  ): Promise<string> {
    // The machine callers — their actor is server-minted, not caller-supplied.
    if (context?.isSystem) {
      if (!actorId) throw new Error('VALIDATION_FAILED: actorId is required');
      return actorId;
    }
    const uid = actingUserId(context);
    if (!uid) {
      throw new Error('FORBIDDEN: an approval action requires an authenticated caller');
    }
    // The common case: no actor named, or the caller named themselves.
    if (!actorId || String(actorId) === uid) return uid;

    // Named something else — allow it ONLY if the server can prove the caller
    // holds that identity. `positions` is resolved by the shared authz resolver
    // (never client-supplied); `role:` is the ADR-0090 D3 deprecated spelling
    // that 15.x-era slots and the Console's own identity list still carry.
    const named = String(actorId);
    for (const position of context.positions ?? []) {
      if (named === `position:${position}` || named === `role:${position}`) return named;
    }
    // Email last — it costs a read, so only when nothing cheaper matched.
    if (named.includes('@') && await this.callerHasEmail(uid, named)) return named;

    throw new Error(
      `FORBIDDEN: cannot act as '${named}' — an approval action is recorded against the authenticated caller`,
    );
  }

  /** Does `userId`'s own account carry `email`? (Slots keyed by email, #3800.) */
  private async callerHasEmail(userId: string, email: string): Promise<boolean> {
    try {
      const rows = await this.engine.find('sys_user', {
        where: { id: userId }, limit: 1, context: SYSTEM_CTX,
      });
      const row: any = Array.isArray(rows) ? rows[0] : null;
      return !!row?.email && String(row.email).toLowerCase() === email.toLowerCase();
    } catch {
      return false;
    }
  }

  /**
   * Expand the approvers on an Approval node into user IDs by querying the
   * graph tables for `team:` / `department:` / `position:` /
   * `org_membership_level:` / `manager:` approver types. Falls back to a
   * prefixed literal (`type:value`) when graph lookups produce nothing — so
   * existing fixtures and flows that rely on substring matching keep working.
   *
   * **Graph semantics:**
   *   - `team`       → flat members of `sys_team` (better-auth; no BFS)
   *   - `department` → recursive BFS of `sys_business_unit.parent_business_unit_id`
   *                    → members of every descendant via `sys_business_unit_member`
   *   - `position`   → holders via `sys_user_position` ∪ `sys_member.role`
   *                    transition source (ADR-0090 D3 / ADR-0057 D4)
   *   - `org_membership_level`
   *                  → users with `sys_member.role = value` in tenant — the
   *                    better-auth MEMBERSHIP TIER (owner/admin/member), not a
   *                    position; author `position` for org positions
   *   - `manager`    → `sys_user.manager_id` of `record[value] ?? record.owner_id`
   *   - `field`      → literal user id stored in `record[value]`
   *   - `user`       → literal value
   *
   * `role` is accepted as the deprecated spelling of `org_membership_level`
   * (ADR-0090 D3) for one window: it resolves identically and logs a warning.
   *
   * **Out-of-office (#1322 M1):** individually-routed approvers — the ones that
   * resolve to a specific person (`user` / `field` / `manager`) — are passed
   * through {@link ApprovalService.applyOooDelegation}, which reroutes them onto
   * an active delegate when the resolved user has declared OOO. Group/graph
   * approvers (`team` / `department` / `position` / `org_membership_level`) are
   * left untouched: a group still has its other members, and position-routed
   * leave is already covered by ADR-0091 job delegation. Pass an `opts.now` /
   * `opts.substitutions` collector to record the hops for audit + notification.
   */
  private async expandApprovers(
    step: any,
    record?: any,
    organizationId?: string | null,
    opts?: {
      now?: number;
      substitutions?: OooSubstitution[];
      groups?: Record<string, string[]>;
      /** #3447 P2: `trigger`/`vars` roots for `expression` approvers. */
      exprCtx?: ApproverExpressionContext;
      /**
       * #3447 P2 audit collector: what each dynamic spec resolved FROM (the
       * live field value / the expression's intermediate values), snapshotted
       * as `__resolvedFrom` so "why these people" stays answerable later.
       */
      resolvedFrom?: Record<string, unknown>;
    },
  ): Promise<string[]> {
    if (!step || !Array.isArray(step.approvers)) return [];
    const now = opts?.now ?? this.clock.now().getTime();
    const out: string[] = [];
    const specs: any[] = step.approvers;
    for (let idx = 0; idx < specs.length; idx++) {
      const a = specs[idx];
      if (!a) continue;
      // Approvers without an explicit `group` each form their own group keyed
      // by position (#3266), so a plain per-approver list behaves predictably.
      const groupKey = a.group != null && String(a.group) !== '' ? String(a.group) : `#${idx}`;

      // #3447 P2: `expression` approvers resolve OUTSIDE resolveApproverSpec —
      // a graph-expanded expression (resolveAs: department/…) must key each
      // intermediate value as its own per_group group, which the flat string[]
      // contract of resolveApproverSpec cannot carry.
      if (canonicalApproverType(String(a.type)) === 'expression') {
        const resolved = await this.resolveExpressionApprovers(
          a, record, organizationId, now, opts?.substitutions, opts?.exprCtx,
        );
        if (opts?.resolvedFrom) opts.resolvedFrom[`expression#${idx}`] = resolved.raw;
        for (const entry of resolved.slots) {
          if (!entry.id) continue;
          out.push(entry.id);
          if (opts?.groups) {
            (opts.groups[entry.id] ??= []).push(entry.subGroup ? `${groupKey}:${entry.subGroup}` : groupKey);
          }
        }
        continue;
      }

      if (opts?.resolvedFrom && canonicalApproverType(String(a.type)) === 'field' && a.value != null) {
        opts.resolvedFrom[`field:${a.value}`] = (record as any)?.[a.value] ?? null;
      }
      const ids = await this.resolveApproverSpec(a, record, organizationId, now, opts?.substitutions);
      // per_group (#3266): tag each resolved id with this spec's group.
      for (const u of ids) {
        if (!u) continue;
        out.push(u);
        if (opts?.groups) (opts.groups[u] ??= []).push(groupKey);
      }
    }
    return out.filter(Boolean);
  }

  /**
   * Resolve ONE approver spec to concrete approver identities, applying OOO
   * substitution (#1322) to individually-routed types. Extracted from
   * {@link ApprovalService.expandApprovers} so the caller can tag each spec's
   * resolved ids with a group (#3266) without duplicating the resolution logic.
   * Returns the `type:value` literal as a single-element fallback when a graph
   * lookup yields nothing — same behaviour as before the extraction.
   */
  private async resolveApproverSpec(
    a: any,
    record: any,
    organizationId: string | null | undefined,
    now: number,
    substitutions?: OooSubstitution[],
  ): Promise<string[]> {
    // ADR-0090 D3: `role` is the deprecated spelling of `org_membership_level`.
    // Resolve on the canonical type, but keep the AUTHORED spelling in the
    // `type:value` fallback below — stored `sys_approval_approver` rows and
    // `pending_approvers` slots from 15.x carry the old literal.
    const type = canonicalApproverType(String(a.type));
    if (type !== a.type) {
      this.logger?.warn?.(
        `[approvals] approver type '${a.type}' is deprecated (ADR-0090 D3) — author '${type}' instead`,
        { deprecated: a.type, canonical: type },
      );
    }
    // [ADR-0105 D9] WHERE this approver is looked up — the request's own
    // organization unless the spec targets another one in the same group.
    //
    // Resolved HERE, above the `user` / `field` / `manager` early returns,
    // because refusing a declaration on a directory-less type is one of the
    // things this resolution DOES (those types name a person outright, so
    // `organization` on them cannot narrow anything and an author who wrote it
    // misunderstood the field). Resolving it after those returns made the
    // refusal unreachable and the declaration silently inert — exactly the
    // "ignored, not refused" behaviour ADR-0105 D9 rules out, and what the
    // cloud group-posture dogfood caught.
    //
    // Costs nothing on the overwhelmingly common path: with no `organization`
    // declared, the resolver returns the request org without reading anything.
    const directoryOrg = await this.directoryOrgFor(a, organizationId);
    const crossOrg = directoryOrg !== organizationId;

    if (type === 'user') {
      return this.applyOooDelegation(String(a.value), now, organizationId, substitutions);
    }
    if (type === 'field' && record) {
      // #3447: a record field can name MANY approvers — a multi-select user
      // field arrives as an array (or a legacy CSV string). Fan each out into
      // its own slot and OOO-substitute per person; collapsing to `String(...)`
      // (→ `'u1,u2'`) would mint one bogus approver id and skip every delegate.
      const out: string[] = [];
      for (const id of csvSplit((record as any)[a.value])) {
        out.push(...await this.applyOooDelegation(id, now, organizationId, substitutions));
      }
      return out;
    }
    // `directoryOrg` / `crossOrg` were resolved at the TOP of this method, so
    // the refusal reaches directory-less types too. Resolution failures
    // propagate: they are routing bugs, and that call sits OUTSIDE the
    // swallowing try below on purpose (see the catch's comment).
    //
    // A cross-org slate is filtered to the people who can actually READ the
    // request (D2 union); same-org routing is untouched and does no extra read.
    const bounded = async (users: string[]): Promise<string[]> => (
      crossOrg
        ? filterApproversWhoCanRead(this.orgScopeDeps, users, organizationId, {
          approverType: type, value: a.value != null ? String(a.value) : undefined,
          directoryOrgId: directoryOrg,
        })
        : users
    );

    try {
      if (type === 'team') {
        const users = await this.expandTeamUsers(String(a.value));
        if (users.length) return users;
      } else if (type === 'department' || type === 'business_unit' || type === 'bu') {
        const users = await bounded(await this.expandBusinessUnitUsers(String(a.value), directoryOrg));
        if (users.length) return users;
      } else if (type === 'position') {
        const users = await bounded(await this.expandPositionUsers(String(a.value), directoryOrg));
        if (users.length) return users;
      } else if (type === 'org_membership_level') {
        const users = await bounded(await this.expandMembershipTierUsers(String(a.value), directoryOrg));
        if (users.length) return users;
      } else if (type === 'manager' && record) {
        const subject = (record as any)[a.value] ?? (record as any).owner_id;
        if (subject) {
          // #10153: the request's OWN organization, not `directoryOrg`. They are
          // provably equal on this branch (`manager` is not org-scoped, so a
          // `organization` declaration is refused above), and naming the request
          // org says what the screen asserts: tenancy of the request, never an
          // ADR-0105 D9 retarget this type does not have.
          const mgr = await this.lookupManager(String(subject), organizationId);
          if (mgr) return this.applyOooDelegation(mgr, now, organizationId, substitutions);
        }
      }
    } catch { /* a directory lookup failed → fall through to the literal slot */ }
    // #3508: `queue` is declared-but-unenforced — there is no queue branch
    // above, so a queue approver always lands here and the `queue:<id>` slot
    // routes to nobody. The spec marks it non-authorable
    // (NON_AUTHORABLE_APPROVER_TYPES) so designers stop offering it; warn for
    // the stored flows that still carry one, so the silent dead slot is at
    // least visible to operators.
    if (type === 'queue') {
      this.logger?.warn?.(
        `[approvals] approver type 'queue' is not implemented — the slot resolves to nobody (#3508)`,
        { value: a.value },
      );
    } else if (GRAPH_APPROVER_TYPES.has(type)) {
      // #3807 follow-up — every OTHER way to land here is a graph type whose
      // lookup produced nobody, and the literal below is a slot no user can
      // ever act on. That silence is what let #3807 hide: a `department`
      // approver pointing at a seeded (env-wide) unit resolved to
      // `department:<id>` on every request, the request opened with an empty
      // slate, and nothing in the logs said so — the first symptom was a
      // permanently stuck approval (#3424). The fallback itself stays (a
      // literal keeps 15.x slots and substring fixtures working); it just
      // stops being invisible.
      this.logger?.warn?.(
        `[approvals] approver '${type}:${a.value}' expanded to nobody — the slot routes to no one `
        + `and the request cannot advance until someone is added or the approver is re-pointed (#3807)`,
        { type, value: a.value, organizationId: organizationId ?? null },
      );
    }
    return [`${a.type}:${a.value}`];
  }

  /**
   * Resolve an `expression` approver (#3447 P2): evaluate its CEL source at
   * node entry against the three explicit roots — `current` (live record),
   * `trigger` (submit snapshot), `vars` (flow variables) — then expand the
   * result into people per `resolveAs`.
   *
   * Every failure here THROWS (config/parse errors as `VALIDATION_FAILED`,
   * evaluation faults as `EXPRESSION_FAILED`) so the approval node fails
   * loudly instead of opening a request routed to nobody — an approver
   * expression that cannot run is a routing bug, never "condition not met".
   * Error messages carry the correct spelling because their primary reader is
   * the AI author fixing the flow on the next validate pass.
   *
   * Returns `slots` (approver id + optional per_group sub-key) and `raw` (the
   * expression's own values, pre-expansion) for the `__resolvedFrom` audit.
   */
  private async resolveExpressionApprovers(
    a: any,
    liveRecord: any,
    organizationId: string | null | undefined,
    now: number,
    substitutions?: OooSubstitution[],
    exprCtx?: ApproverExpressionContext,
  ): Promise<{ slots: Array<{ id: string; subGroup?: string }>; raw: string[] }> {
    const source = String(a.value ?? '').trim();
    if (!source) {
      throw new Error('VALIDATION_FAILED: expression approver has an empty expression');
    }

    // Closed-root pre-check. The runtime env resolves ANY unknown root as dyn →
    // null, so `record.x` / a bare field would silently yield an empty slate;
    // reject it here with the correct spelling instead.
    const parsed = collectCelRootIdentifiers(source);
    if (!parsed.ok) {
      throw new Error(`VALIDATION_FAILED: expression approver does not parse: ${parsed.error} — source: \`${source}\``);
    }
    const illegal = parsed.roots.filter(r => !APPROVER_EXPRESSION_ROOTS.has(r));
    if (illegal.length) {
      const hint = illegal.includes('record') || illegal.includes('previous')
        ? `\`record\`/\`previous\` are not bound here — write \`current.<field>\` for the record's live state `
          + `at node entry, or \`trigger.<field>\` for the submit-time snapshot (\`vars.previous\` carries the pre-update row)`
        : `did you mean \`current.<field>\` (live record), \`trigger.<field>\` (submit snapshot), or \`vars.<name>\` (flow variable)?`;
      throw new Error(
        `VALIDATION_FAILED: expression approver references \`${illegal.join('`, `')}\` — `
        + `only \`current.*\`, \`trigger.*\` and \`vars.*\` are available; ${hint}. Source: \`${source}\``,
      );
    }

    const result = ExpressionEngine.evaluate(
      { dialect: 'cel', source },
      { extra: { current: liveRecord ?? {}, trigger: exprCtx?.trigger ?? {}, vars: exprCtx?.vars ?? {} } },
    );
    if (!result.ok) {
      throw new Error(
        `EXPRESSION_FAILED: expression approver failed to evaluate (${result.error.kind}): `
        + `${result.error.message} — source: \`${source}\``,
      );
    }

    // Normalize to a string list: a user-id/CSV string, an array of ids, or
    // null/empty (an EMPTY slate — legal, handled by onEmptyApprovers). Any
    // other shape is a config bug, rejected loudly.
    const value = result.value as unknown;
    let raw: string[];
    if (value == null || value === '') {
      raw = [];
    } else if (typeof value === 'string') {
      raw = csvSplit(value);
    } else if (Array.isArray(value)) {
      const bad = value.find(v => v != null && typeof v !== 'string' && typeof v !== 'number');
      if (bad !== undefined) {
        throw new Error(
          `EXPRESSION_FAILED: expression approver must yield ids (string / CSV / string array), `
          + `got an array containing ${typeof bad} — source: \`${source}\``,
        );
      }
      raw = value.map(v => String(v ?? '').trim()).filter(Boolean);
    } else {
      throw new Error(
        `EXPRESSION_FAILED: expression approver must yield ids (string / CSV / string array), `
        + `got ${typeof value} — source: \`${source}\``,
      );
    }

    // `resolveAs` expansion. `user` (default): each value IS a person —
    // individually routed, so OOO delegation applies (#1322). Graph kinds
    // re-expand each value through the same lookups the static types use; a
    // group still has its other members, so like the static graph types they
    // are NOT OOO-substituted, and with per_group each intermediate value
    // forms its own sub-group (one sign-off per returned department). A value
    // whose expansion is empty keeps a `<kind>:<value>` literal slot — same
    // unstaffed-target behaviour (and #3424 admin rescue) as the static types.
    const resolveAs = String(a.resolveAs ?? 'user');
    if (resolveAs === 'user') {
      const slots: Array<{ id: string }> = [];
      for (const id of raw) {
        for (const routed of await this.applyOooDelegation(id, now, organizationId, substitutions)) {
          slots.push({ id: routed });
        }
      }
      return { slots, raw };
    }
    // [ADR-0105 D9] An expression that re-expands into a graph kind consults the
    // same org-scoped directories the static types do, so it honours the same
    // targeting. Resolved once for the whole slate, before the per-value loop —
    // the declaration is a property of the spec, not of what the CEL returned.
    const directoryOrg = await this.directoryOrgFor(a, organizationId);
    const crossOrg = directoryOrg !== organizationId;
    const slots: Array<{ id: string; subGroup: string }> = [];
    for (const key of raw) {
      let users: string[] = [];
      try {
        if (resolveAs === 'department') users = await this.expandBusinessUnitUsers(key, directoryOrg);
        else if (resolveAs === 'position') users = await this.expandPositionUsers(key, directoryOrg);
        else if (resolveAs === 'team') users = await this.expandTeamUsers(key);
        else {
          throw new Error(
            `VALIDATION_FAILED: expression approver has unknown resolveAs '${resolveAs}' — `
            + `use 'user', 'department', 'position', or 'team'`,
          );
        }
      } catch (err: any) {
        if (String(err?.message ?? '').startsWith('VALIDATION_FAILED')) throw err;
        users = [];
      }
      if (crossOrg && users.length) {
        users = await filterApproversWhoCanRead(this.orgScopeDeps, users, organizationId, {
          approverType: resolveAs, value: key, directoryOrgId: directoryOrg,
        });
      }
      if (!users.length) {
        slots.push({ id: `${resolveAs}:${key}`, subGroup: key });
        continue;
      }
      for (const u of users) slots.push({ id: u, subGroup: key });
    }
    return { slots, raw };
  }

  /** Flat team — `sys_team` is better-auth's collaboration grouping (no hierarchy). */
  private async expandTeamUsers(teamId: string): Promise<string[]> {
    if (!teamId) return [];
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_team_member', {
        where: { team_id: teamId },
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      } as any);
    } catch { rows = []; }
    return Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)));
  }

  /**
   * Tenant scope for a `sys_business_unit` read that may legitimately be
   * env-wide (#3807).
   *
   * `organization_id = null` on a platform object means "owned by no
   * organization" — a row written by a seed, the file layer, or bootstrap,
   * i.e. before (or outside) any org exists. A strict
   * `organization_id = <request org>` equality made every such row invisible:
   * the seed check below found nothing, the whole expansion returned `[]`, and
   * the approver fell back to the dead `department:<id>` literal that routes to
   * nobody. That is not an edge case — an app's org tree is normally seeded
   * (a seed cannot know the org id the runtime mints at boot) while the
   * approval request always carries one, so EVERY department approver a
   * designer could pick resolved to nobody.
   *
   * Widen to "this org ∪ env-wide", the same predicate `sys_metadata`'s
   * pending-draft listing settled on for the identical reason. Another org's
   * unit still fails the match, so the wall between two organizations is
   * unchanged — only rows belonging to no org at all become visible.
   */
  private businessUnitOrgScope(
    filter: Record<string, unknown>,
    organizationId?: string | null,
  ): Record<string, unknown> {
    if (!organizationId) return filter;
    return { ...filter, $or: [{ organization_id: organizationId }, { organization_id: null }] };
  }

  /** Recursive department — walks `sys_business_unit.parent_business_unit_id`. */
  private async expandBusinessUnitUsers(businessUnitId: string, organizationId?: string | null): Promise<string[]> {
    if (!businessUnitId) return [];
    // Seed sanity check: skip if dept doesn't exist or is inactive within tenant.
    try {
      const seed = await this.engine.find('sys_business_unit', {
        where: this.businessUnitOrgScope({ id: businessUnitId }, organizationId),
        fields: ['id', 'active'],
        limit: 1,
        context: SYSTEM_CTX,
      } as any);
      const seedRow: any = Array.isArray(seed) ? seed[0] : null;
      if (!seedRow || seedRow.active === false) return [];
    } catch { return []; }

    const seen = new Set<string>([businessUnitId]);
    const queue: string[] = [businessUnitId];
    while (queue.length) {
      const parent = queue.shift()!;
      let kids: any[] = [];
      try {
        const filter = this.businessUnitOrgScope(
          { parent_business_unit_id: parent, active: { $ne: false } },
          organizationId,
        );
        kids = await this.engine.find('sys_business_unit', { filter, fields: ['id'], limit: 1000, context: SYSTEM_CTX } as any);
      } catch { kids = []; }
      for (const k of kids ?? []) {
        const kid = String((k as any).id ?? '');
        if (kid && !seen.has(kid)) { seen.add(kid); queue.push(kid); }
      }
    }
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_business_unit_member', {
        where: { business_unit_id: { $in: Array.from(seen) } },
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      } as any);
    } catch { rows = []; }
    return Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)));
  }

  /**
   * Position holders (ADR-0090 D3): `sys_user_position` is the platform-owned
   * assignment table, keyed by the position's machine name (ADR-0057 D4),
   * unioned with the better-auth membership string (`sys_member.role`) as a
   * transition source.
   *
   * ⚠️ This is a ROUTING read (approver slates and escalation targets), and it
   * is deliberately NOT the same read as `PositionGraphService` in
   * `plugin-sharing`, whatever the shared method name suggests. Both answer
   * "who holds position P"; this one reads the directory RAW — neither the
   * ADR-0091 D2 validity window nor the `sys_position.active` catalogue flag is
   * applied. Maintainer ruling, 2026-08-15 (#8710, inheriting #8613), verbatim:
   *
   * > Access-conferring paths filter deactivated positions; addressing paths
   * > do not.
   *
   * Routing is an addressing path, so dropping a holder here is fail-OPEN, not
   * fail-closed: an expansion that comes back empty does not narrow the slate,
   * it falls through to the literal `position:` slot no user can ever act on —
   * the permanently stuck request of #3807 / #3424. A step routing to nobody is
   * worse than one routing to a lapsed holder, so the lapsed holder stays.
   *
   * Where the two implementations actually stand, per source. Both limbs are
   * listed because a statement about one of them is not a statement about this
   * method:
   *
   *  1. `sys_user_position` — sharing projects `valid_from` / `valid_until` and
   *     drops rows on `isGrantActive` inside its own helper; we project
   *     `user_id` alone, so an assignment that expired last month still routes.
   *     This is the one real divergence, and it is the intended one.
   *  2. `sys_member.role` — raw on BOTH sides (`TeamGraphService.expandRoleUsers`
   *     projects `user_id` too). The table carries no window columns at all and
   *     `isGrantActive` reads an absent bound as unbounded, so there is nothing
   *     a filter could do here; membership tier names have no `sys_position`
   *     row either (#8710's "a name with no row is untouched" fallback), so no
   *     catalogue flag either. This limb cannot be brought into parity by
   *     adding a filter — see {@link expandMembershipTierUsers}.
   *  3. `sys_position.active` — the sharing engine's gate for it lives at the
   *     RULE EVALUATOR's call site (`positionConfersAccess` in
   *     `sharing-rule-service.ts`), not inside `PositionGraphService`; the same
   *     ruling gives it no counterpart on this path.
   *
   * The omission is per-READ, not a missing dependency: `isGrantActive` is
   * imported in this file and IS applied to `sys_approval_delegation` in
   * {@link lookupActiveDelegation}. ⛔ So do not "fix" this by adding the window
   * filter here — that is the option #8710 rejected, on the reasoning above.
   */
  private async expandPositionUsers(positionName: string, organizationId?: string | null): Promise<string[]> {
    if (!positionName) return [];
    const users = new Set<string>();
    const filter: any = { position: positionName };
    if (organizationId) filter.organization_id = organizationId;
    try {
      const rows = await this.engine.find('sys_user_position', {
        filter, fields: ['user_id'], limit: 10000, context: SYSTEM_CTX,
      } as any);
      for (const r of (rows ?? []) as any[]) {
        const uid = String(r.user_id ?? '');
        if (uid) users.add(uid);
      }
    } catch { /* table may not exist on minimal stacks — union source below still applies */ }
    // ADR-0057 D4 transition source: pre-migration stacks still carry the
    // position name in better-auth's `sys_member.role` column, so the same
    // lookup serves a position name here and a membership tier for
    // `org_membership_level` — the column is one, the two concepts are not.
    for (const uid of await this.expandMembershipTierUsers(positionName, organizationId)) users.add(uid);
    return Array.from(users);
  }

  /**
   * better-auth org-membership tier (`sys_member.role`: owner/admin/member) —
   * NOT positions. Named for the projection (`org_membership_level`, ADR-0057
   * D7 / ADR-0090 D3), not for better-auth's column: the column name is theirs
   * and stays, the platform-facing word does not.
   *
   * Read RAW, like every routing read here, and with nothing available to
   * filter even if it were not: `sys_member` carries no ADR-0091 D2 window
   * columns, and a tier name has no `sys_position` row to read `active` off.
   * {@link expandPositionUsers} carries the ruling both reads inherit
   * (#8613 / #8710) — this method is also the second limb of that union, so a
   * change here changes position routing too.
   */
  private async expandMembershipTierUsers(tier: string, organizationId?: string | null): Promise<string[]> {
    if (!tier) return [];
    const filter: any = { role: tier };
    if (organizationId) filter.organization_id = organizationId;
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_member', { filter, fields: ['user_id'], limit: 10000, context: SYSTEM_CTX } as any);
    } catch { rows = []; }
    return Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)));
  }

  /**
   * `sys_user.manager_id`, screened to the request's organization (#10153).
   *
   * Takes an organization argument for the same reason its siblings do
   * ({@link expandPositionUsers}, {@link expandMembershipTierUsers}): an
   * approver expansion answers "who, in THIS organization". Before #10153 this
   * one did not ask, and it was the only expansion that did not — a
   * `manager_id` pointing at a person in another organization routed that
   * person an approval over a record they are not a tenant of.
   *
   * ⚠️ The screen reads `sys_member`, which LOOKS like the D2 read-visibility
   * filter next to it ({@link filterApproversWhoCanRead}). It is not, and this
   * comment exists so the next reader does not conclude that #7497 (does
   * approver routing imply record read visibility?) was settled here. It was
   * not. Two facts make this the SIBLING treatment rather than a
   * read-visibility ruling:
   *
   *   1. Two of the three org-scoped expansions already screen on exactly this
   *      column — `expandMembershipTierUsers` filters `sys_member.organization_id`
   *      outright, and it is also the second limb of `expandPositionUsers`. So
   *      `sys_member.organization_id` is already this file's answer to "which
   *      organization is this person in", independent of what they may read.
   *   2. `sys_user` carries no `organization_id` at all. It is a GLOBAL identity
   *      table, so a membership row is the only tenancy fact that exists for a
   *      user — there is no other read this screen could have been written with.
   *
   * This change grants no reads and applies no read screen to any type that
   * lacks one today, so it decides nothing #7497 asks.
   */
  private async lookupManager(userId: string, organizationId?: string | null): Promise<string | null> {
    try {
      const rows = await this.engine.find('sys_user', {
        where: { id: userId }, fields: ['id', 'manager_id'], limit: 1, context: SYSTEM_CTX,
      } as any);
      const row: any = Array.isArray(rows) ? rows[0] : null;
      const managerId = row?.manager_id ? String(row.manager_id) : null;
      if (!managerId) return null;
      if (await this.managerIsProvablyOutsideOrg(managerId, organizationId)) return null;
      return managerId;
    } catch { return null; }
  }

  /**
   * Is `managerId` PROVABLY a member of other organizations and not of
   * `organizationId`? (#10153)
   *
   * "Provably" is the whole shape of this screen, and it is deliberate rather
   * than a weaker version of "must prove membership":
   *
   *   - membership rows exist for this user, none in the request's org
   *       ⇒ the tenancy fact is present and NEGATIVE ⇒ screen him out;
   *   - no membership rows at all, or the read failed
   *       ⇒ the tenancy fact is ABSENT ⇒ leave routing exactly as it was.
   *
   * The fail-open half is not timidity, it is this file's ruled posture on
   * addressing paths, stated twice already: {@link filterApproversWhoCanRead}
   * refuses to empty a live slate on an infrastructure hiccup, and
   * {@link expandPositionUsers} carries "a step routing to nobody is worse than
   * one routing to a lapsed holder". It is also load-bearing in practice — a
   * stack that stamps an organization on its requests but does not materialize
   * `sys_member` rows would otherwise lose every manager approver at once,
   * which is a bigger behaviour change than the hole being closed. Measured:
   * this repo's own `type:manager` out-of-office fixture is such a stack.
   *
   * Screening the MANAGER only, before OOO delegation, is deliberate too: the
   * delegate arrives from `sys_approval_delegation`, whose rows already carry
   * (and are already filtered by) an `organization_id` in
   * {@link lookupActiveDelegation}. This card is about `sys_user.manager_id`.
   */
  private async managerIsProvablyOutsideOrg(
    managerId: string,
    organizationId?: string | null,
  ): Promise<boolean> {
    const requestOrg = organizationId ? String(organizationId) : '';
    // No organization on the request ⇒ nothing to screen against, and no read.
    // The ordinary single-organization / embedded stack costs nothing here.
    if (!requestOrg) return false;
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_member', {
        where: { user_id: managerId },
        fields: ['user_id', 'organization_id'],
        limit: 1000,
        context: SYSTEM_CTX,
      } as any);
    } catch { return false; } // membership unreadable — see the fail-open note above
    const orgs = (rows ?? [])
      .map((r: any) => String(r?.organization_id ?? ''))
      .filter(Boolean);
    if (!orgs.length) return false;          // no tenancy fact recorded for this user
    if (orgs.includes(requestOrg)) return false; // he is a member here — route as before
    this.logger?.warn?.(
      `[approvals] #10153: manager '${managerId}' was dropped from the approver slate — `
      + `'sys_user.manager_id' points across an organization boundary. He holds membership in `
      + `${orgs.length} organization(s), none of them the request's organization '${requestOrg}', `
      + `so routing this approval to him would put approval authority over the record outside its `
      + `tenant. Fix the 'manager_id' link, grant him a membership in this organization, or route `
      + `this step with an approver type that names someone in it.`,
      { managerId, requestOrganizationId: requestOrg, managerOrganizationIds: orgs },
    );
    return true;
  }

  /**
   * Out-of-office auto-skip (#1322 M1). Given an individually-routed approver
   * id, follow any active `sys_approval_delegation` chain and return the id the
   * slot should actually go to — the delegate acts under their own identity, so
   * no impersonation is involved. Returns `[userId]` unchanged when there is no
   * active delegation. Each hop is appended to `collector` (when supplied) so
   * the caller can audit + notify (M4).
   *
   * The chain (A out → B, B out → C, …) is bounded by {@link OOO_MAX_CHAIN} and
   * stops on a self-reference or a cycle, so a mis-declared loop degrades to the
   * last reachable delegate rather than hanging.
   */
  private async applyOooDelegation(
    userId: string,
    now: number,
    organizationId?: string | null,
    collector?: OooSubstitution[],
  ): Promise<string[]> {
    const start = String(userId ?? '').trim();
    if (!start) return [];
    let current = start;
    const visited = new Set<string>([current]);
    for (let hop = 0; hop < OOO_MAX_CHAIN; hop++) {
      const del = await this.lookupActiveDelegation(current, now, organizationId);
      if (!del) break;
      const to = String(del.delegate_id ?? '').trim();
      if (!to || to === current || visited.has(to)) break; // no-op / self / cycle
      collector?.push({ from: current, to, reason: del.reason != null ? String(del.reason) : null });
      visited.add(to);
      current = to;
    }
    return [current];
  }

  /**
   * The active OOO delegation for a delegator at `now`, or null. Validity is the
   * shared `isGrantActive` half-open window (ADR-0091 D2), enforced here at
   * resolution time — never by a background job. When several rows are active,
   * the one expiring soonest wins (the most specific coverage window).
   */
  private async lookupActiveDelegation(
    delegatorId: string,
    now: number,
    organizationId?: string | null,
  ): Promise<any | null> {
    if (!delegatorId) return null;
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_approval_delegation', {
        where: { delegator_id: delegatorId },
        fields: ['id', 'delegator_id', 'delegate_id', 'valid_from', 'valid_until', 'reason', 'organization_id'],
        limit: 50,
        context: SYSTEM_CTX,
      } as any);
    } catch { return null; } // table absent on minimal stacks — no OOO, resolve as-is
    const active = (rows ?? []).filter((r: any) =>
      isGrantActive(r, now)
      // A null-org rule applies across tenants; a scoped rule only within its tenant.
      && (organizationId == null || r.organization_id == null || String(r.organization_id) === String(organizationId)));
    if (!active.length) return null;
    active.sort((a: any, b: any) => {
      const au = a.valid_until ? Date.parse(String(a.valid_until)) : Number.POSITIVE_INFINITY;
      const bu = b.valid_until ? Date.parse(String(b.valid_until)) : Number.POSITIVE_INFINITY;
      return au - bu;
    });
    return active[0];
  }

  /**
   * Mirror a request status onto a business-object field, if configured.
   *
   * **Elevated, but not anonymous (#3783).** The write stays `isSystem`: the
   * record is normally LOCKED while its approval is live and the submitter
   * cannot edit it, so only a platform write can land the status — that is what
   * the lock hook's system exemption (`lifecycle-hooks.ts`) is for. What it must
   * NOT do is throw away *who* caused the transition. Every status below is
   * something a specific human just did — a submitter submitting or recalling,
   * an approver deciding or sending back — and this write is what fires the
   * target object's record-change flows. With no `userId` on it those cascades
   * inherit no trigger user, and since #3760 a `runAs:'user'` run with no trigger
   * user has its data ops REFUSED — so "when the invoice is approved, do X", the
   * most natural approvals automation there is, had to declare `runAs:'system'`
   * and take blanket elevation for a case where a perfectly good scoped identity
   * existed. Re-attaching the actor lets those cascades run as the deciding user
   * with RLS enforced. Same shape the approval node already uses when it calls
   * into this service (`approval-node.ts`).
   *
   * `actorId` is `null` for the genuinely machine-driven transitions (the SLA
   * escalation's auto-decision, the dead-run sweep). There is no human to name
   * there, and naming a sentinel would put a non-user in `updated_by` and in
   * every downstream flow's identity. Those cascades stay user-less — a flow
   * that wants to react to them still has to declare `runAs:'system'`, which is
   * the honest answer rather than an oversight.
   *
   * Deliberately carries `userId` ONLY, not the request's org. On an
   * ExecutionContext `tenantId` is a driver-scoping knob, not attribution
   * (`buildDriverOptions` turns it into a tenant predicate on the update), so
   * passing it would newly org-scope this write and silently no-op the mirror on
   * a record whose org differs from the request's — while buying nothing: the
   * automation engine back-fills the run's `tenantId` from the resolved user's
   * own grants.
   */
  private async mirrorStatusField(
    object: string,
    recordId: string,
    field: string,
    status: string,
    actorId: string | null,
  ): Promise<void> {
    try {
      const context = actorId ? { ...SYSTEM_CTX, userId: actorId } : SYSTEM_CTX;
      await this.engine.update(object, { id: recordId, [field]: status }, { context });
    } catch (err: any) {
      this.logger?.warn?.(`[approvals] mirrorStatusField failed: ${err?.message ?? err}`);
    }
  }

  /**
   * Re-read a business record's CURRENT state by id so approver resolution binds
   * to live data at node entry, not the trigger snapshot the flow froze into
   * `$record` at submit time (#3447). A `field` / `manager` approver names *who*
   * decides, and an earlier node — or the approver of an earlier step — may have
   * written that routing field after submit (e.g. a lead reviewer picking which
   * departments co-review). Graph approvers (team / position / …) already query
   * live; this brings the in-record types into line.
   *
   * Read under system identity: approver routing is a platform concern and the
   * record is the flow's own subject, so the submitter's RLS/FLS must not narrow
   * it. Degrades to `fallback` (the snapshot) when the record can't be re-read —
   * hard-deleted between submit and node entry, or an object whose backend can't
   * serve a point read — warning rather than throwing so a transient miss can't
   * wedge an approval. That "warn but proceed" stance matches the
   * no-concrete-approver guard (#3424) and the "record is gone" enrichment path
   * that already falls back to the payload snapshot.
   */
  private async loadLiveRecord(object: string, recordId: string, fallback?: any): Promise<any> {
    try {
      const rows = await this.engine.find(object, {
        where: { id: recordId }, limit: 1, context: SYSTEM_CTX,
      } as any);
      const live = Array.isArray(rows) ? rows[0] : rows;
      if (live) return live;
      this.logger?.warn?.(
        `[approvals] live record ${object}/${recordId} not found at node entry — `
        + 'resolving approvers against the trigger snapshot (#3447 fallback).',
        { object, recordId },
      );
    } catch (err: any) {
      this.logger?.warn?.(
        `[approvals] live record re-read failed for ${object}/${recordId}: ${err?.message ?? err} — `
        + 'resolving approvers against the trigger snapshot (#3447 fallback).',
      );
    }
    return fallback ?? {};
  }

  // ── ADR-0019: Approval-as-flow-node ──────────────────────────
  //
  // A flow's Approval node opens a request via `openNodeRequest` (carrying its
  // own approvers/behavior config and the suspended run id), then suspends. A
  // later `decide` finalizes it and resumes the flow run down the matching
  // `approve`/`reject` edge. The record lock is enforced by a beforeUpdate hook
  // keyed on a *pending* request, so finalizing auto-releases it.

  /**
   * Open a pending approval request on behalf of a flow's Approval node. The
   * node config (approvers / behavior / status field) is snapshotted on the row
   * so a decision can be made without any process to resolve against.
   *
   * #3447 P2: may instead return an {@link ApprovalNodeAutoOutcome} — no
   * request opened — when the slate resolves empty and the node's
   * `onEmptyApprovers` policy is `auto_approve`.
   */
  async openNodeRequest(
    input: {
      object: string;
      recordId: string;
      runId: string;
      nodeId: string;
      config: ApprovalNodeConfig;
      flowName?: string;
      /** Authored flow label, snapshotted for inbox display. */
      flowLabel?: string;
      /** Authored node label, snapshotted for inbox display. */
      nodeLabel?: string;
      submitterId?: string | null;
      record?: any;
      organizationId?: string | null;
      /**
       * #3447 P2: flow variables at node entry (nested by dotted key, as the
       * engine's CEL conditions see them) — the `vars.*` root for `expression`
       * approvers. `input.record` doubles as their `trigger.*` root.
       */
      variables?: Record<string, unknown> | null;
    },
    context: ExecutionContext,
  ): Promise<ApprovalRequestRow | ApprovalNodeAutoOutcome> {
    if (!input.object) throw new Error('VALIDATION_FAILED: object is required');
    if (!input.recordId) throw new Error('VALIDATION_FAILED: recordId is required');
    if (!input.runId) throw new Error('VALIDATION_FAILED: runId is required');

    // One pending request per (object, record).
    const existing = await this.engine.find('sys_approval_request', {
      where: { object_name: input.object, record_id: input.recordId, status: 'pending' },
      limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(existing) && existing[0]) {
      throw new Error(`DUPLICATE_REQUEST: a pending approval already exists for ${input.object}/${input.recordId}`);
    }

    // `organizationId` is not on the envelope — see isOverrideActor().
    const ctxOrg = (context as any)?.organizationId ?? context?.tenantId ?? input.organizationId ?? null;
    const nowDate = this.clock.now();
    // OOO auto-skip (#1322 M1): reroute individually-routed approvers who are
    // out of office. Collected hops drive the audit + notification below (M4).
    const substitutions: OooSubstitution[] = [];
    // Group membership per resolved approver (#3266) — snapshotted so quorum /
    // per_group finalization is decided against the slate resolved at OPEN time
    // (OOO-substituted), not re-resolved live at each decision.
    const groups: Record<string, string[]> = {};
    // #3447: resolve approvers against the record's LIVE state at node entry, not
    // the trigger snapshot carried in `input.record`. This is the whole fix — an
    // earlier step may have written the field this node routes on.
    const liveRecord = await this.loadLiveRecord(input.object, input.recordId, input.record);
    const resolvedFrom: Record<string, unknown> = {};
    const approvers = await this.expandApprovers(
      { approvers: input.config.approvers }, liveRecord, ctxOrg, {
        now: nowDate.getTime(), substitutions, groups,
        exprCtx: { trigger: input.record ?? null, vars: input.variables ?? null },
        resolvedFrom,
      },
    );

    // Empty-slate policy (#3447 P2). "Empty" = no CONCRETE person — an
    // unstaffed position / empty expression result leaves only `type:value`
    // literal slots, decidable by nobody.
    if (!approvers.some(a => a && !a.includes(':'))) {
      const emptyPolicy = (input.config as any).onEmptyApprovers ?? 'admin_rescue';
      if (emptyPolicy === 'fail') {
        throw new Error(
          `NO_APPROVERS: approval node '${input.nodeId}' on ${input.object}/${input.recordId} resolved to no `
          + `concrete approver and its onEmptyApprovers policy is 'fail'. Check that the approver target(s) `
          + `are staffed / the routing field or expression yields user ids at node entry.`,
        );
      }
      if (emptyPolicy === 'auto_approve') {
        this.logger?.warn?.(
          `[approvals] approval node '${input.nodeId}' on ${input.object}/${input.recordId} resolved to no `
          + `concrete approver — auto-approving per onEmptyApprovers: 'auto_approve' (no request opened).`,
          { object: input.object, recordId: input.recordId, node: input.nodeId, resolved: approvers },
        );
        return { autoApproved: true, reason: 'empty_approvers' };
      }
      // #3424 admin_rescue (default): the request is still opened (a privileged
      // admin can override it, and legacy 15.x literal slots stay queryable) —
      // the only option that neither waves the record through nor kills the
      // run — but warn loudly so the misconfiguration surfaces instead of
      // silently locking the record with no obvious cause.
      this.logger?.warn?.(
        `[approvals] approval node '${input.nodeId}' on ${input.object}/${input.recordId} resolved to no concrete approver`
        + ' — the request is decidable only by a privileged admin. Check that the approver target(s) are staffed.',
        { object: input.object, recordId: input.recordId, node: input.nodeId, resolved: approvers },
      );
    }

    const now = nowDate.toISOString();
    const id = uid('areq');
    const processName = `flow:${input.flowName ?? input.nodeId}`;
    // Display labels ride the config snapshot (no schema migration needed);
    // `rowFromRequest` surfaces them as `process_label` / `step_label`.
    const configSnapshot: any = { ...input.config };
    if (input.flowLabel) configSnapshot.__flowLabel = input.flowLabel;
    if (input.nodeLabel) configSnapshot.__nodeLabel = input.nodeLabel;
    // Snapshot the resolved approver→group map for EVERY multi-approver
    // behavior (was quorum/per_group only). #3447 P2 makes this load-bearing
    // for unanimous too: an `expression` approver can only resolve at OPEN
    // time (decide has no flow variables to evaluate against), so the tally
    // must read the open-time slate — which also pins unanimous+field to the
    // slate the approvers actually saw, instead of re-reading a field that may
    // have changed again since.
    if (input.config.behavior && input.config.behavior !== 'first_response') {
      configSnapshot.__approverGroups = groups;
    }
    // #3447 P2: snapshot what the dynamic approver sources resolved FROM (the
    // live routing-field value / the expression's intermediate values) so the
    // audit trail answers "why these people" — the resolution INPUT, pairing
    // the resolution RESULT already persisted as `pending_approvers`.
    if (Object.keys(resolvedFrom).length) {
      configSnapshot.__resolvedFrom = resolvedFrom;
    }
    // ADR-0044 round numbering: rounds of a revise loop share the run — count
    // this (run, node)'s prior requests; the new one is round N+1. Stamped on
    // the snapshot (precedent: __flowLabel), so no schema migration.
    try {
      const prior = await this.engine.find('sys_approval_request', {
        where: { flow_run_id: input.runId, flow_node_id: input.nodeId }, limit: 500, context: SYSTEM_CTX,
      });
      const n = Array.isArray(prior) ? prior.length : 0;
      if (n > 0) configSnapshot.__round = n + 1;
    } catch { /* round display is best-effort */ }
    const row: any = {
      id,
      process_name: processName,
      object_name: input.object,
      record_id: input.recordId,
      submitter_id: input.submitterId ?? context.userId ?? null,
      status: 'pending',
      current_step: input.nodeId,
      current_step_index: 0,
      pending_approvers: approvers.join(','),
      payload_json: input.record != null ? JSON.stringify(input.record) : null,
      flow_run_id: input.runId,
      flow_node_id: input.nodeId,
      node_config_json: JSON.stringify(configSnapshot),
      organization_id: ctxOrg,
      created_at: now,
      updated_at: now,
    };
    await this.engine.insert('sys_approval_request', row, { context: SYSTEM_CTX });
    await this.syncApproverIndex(id, approvers, ctxOrg, now);
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: id, organization_id: ctxOrg,
      step_name: input.nodeId, step_index: 0, action: 'submit',
      actor_id: input.submitterId ?? context.userId ?? null, comment: null, created_at: now,
    }, { context: SYSTEM_CTX });

    // OOO substitution audit + notification (#1322 M4). Each hop that rerouted
    // an approver away from an out-of-office user is recorded on the request's
    // audit trail (a system action, no human actor) and notified to both the
    // delegate — who now owns the slot — and the skipped approver.
    for (const sub of substitutions) {
      await this.engine.insert('sys_approval_action', {
        id: uid('aact'), request_id: id, organization_id: ctxOrg,
        step_name: input.nodeId, step_index: 0, action: 'ooo_substitute',
        actor_id: null,
        comment: `${sub.from} → ${sub.to}${sub.reason ? ` — ${sub.reason}` : ''}`,
        created_at: now,
      }, { context: SYSTEM_CTX });
      await this.notify({
        topic: 'approval.ooo_substituted',
        audience: [sub.to],
        source: { object: 'sys_approval_request', id },
        dedupKey: `approval-ooo-${id}-${sub.to}`,
        payload: {
          title: 'Approval routed to you (out-of-office cover)',
          message: `You are covering an approval on ${input.object}/${input.recordId} while ${sub.from} is out of office.`,
          actionUrl: '/system/approvals',
        },
      });
      await this.notify({
        topic: 'approval.ooo_skipped',
        audience: [sub.from],
        source: { object: 'sys_approval_request', id },
        dedupKey: `approval-ooo-skip-${id}-${sub.from}`,
        payload: {
          title: 'Approval routed to your delegate',
          message: `An approval on ${input.object}/${input.recordId} was routed to ${sub.to} while you are out of office.`,
          actionUrl: '/system/approvals',
        },
      });
    }

    // Record lock (when `lockRecord !== false`) is enforced by the beforeUpdate
    // hook keyed on the now-pending request; no extra write needed here.
    if (input.config.approvalStatusField) {
      // Attributed to whoever the row itself calls the submitter (#3783), so
      // there is exactly one answer to "who submitted this". Not the
      // {@link actingUserId} route: `submitterId` is server-supplied here (the
      // approval node passes the run's own trigger user) and unreachable from a
      // request body, so it carries none of the caller-controlled risk that rule
      // exists for — and it already resolves to `context.userId` in every
      // first-party path.
      await this.mirrorStatusField(
        input.object, input.recordId, input.config.approvalStatusField, 'pending',
        row.submitter_id ?? null,
      );
    }

    return rowFromRequest(row);
  }

  /**
   * True when the approve tally satisfies the node's `behavior` (#3266):
   *  - `unanimous` — every resolved approver approved.
   *  - `quorum` — at least `minApprovals` distinct approvals (default = all).
   *  - `per_group` — every group reached `minApprovals` approvals (default 1).
   * Thresholds are clamped to the resolvable count / group size, so a mis-set
   * value can never deadlock a request.
   */
  private isApprovalSatisfied(
    behavior: string,
    config: ApprovalNodeConfig,
    original: string[],
    groupMap: Record<string, string[]>,
    approved: Set<string>,
  ): boolean {
    if (behavior === 'unanimous') {
      return original.length > 0 && original.every(a => approved.has(a));
    }
    if (behavior === 'quorum') {
      const n = original.length || 1;
      const need = Math.min(Math.max(1, config.minApprovals ?? n), n);
      // Count distinct approvals (robust to OOO/reassign changing who holds a slot).
      return approved.size >= need;
    }
    if (behavior === 'per_group') {
      const perGroupNeed = Math.max(1, config.minApprovals ?? 1);
      const size: Record<string, number> = {};
      for (const gs of Object.values(groupMap)) for (const g of gs) size[g] = (size[g] ?? 0) + 1;
      const groups = Object.keys(size);
      if (!groups.length) return true; // nothing to gate
      const got: Record<string, number> = {};
      for (const a of approved) for (const g of (groupMap[a] ?? [])) got[g] = (got[g] ?? 0) + 1;
      return groups.every(g => (got[g] ?? 0) >= Math.min(perGroupNeed, size[g]));
    }
    return true; // first_response and unknown → first approval finalizes
  }

  /**
   * Record a decision on a node-driven request. Honours the node's `behavior`
   * (#3266): `first_response` finalizes on the first approval; `unanimous`,
   * `quorum`, and `per_group` hold the request open until their tally is met
   * (see {@link ApprovalService.isApprovalSatisfied}). A rejection always
   * finalizes the node (one veto). When the request finalizes, returns the
   * suspended run id + node id so the caller (or {@link ApprovalService.decide})
   * can resume the flow down the matching branch.
   */
  async decideNode(
    requestId: string,
    input: { decision: 'approve' | 'reject'; actorId: string; comment?: string; attachments?: string[]; outputs?: Record<string, unknown> },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow; runId: string | null; nodeId: string | null; finalized: boolean; decision: 'approve' | 'reject'; outputs?: Record<string, unknown> }> {
    if (!requestId) throw new Error('VALIDATION_FAILED: requestId is required');
    const actorId = await this.resolveActor(input?.actorId, context);
    if (input.decision !== 'approve' && input.decision !== 'reject') {
      throw new Error('VALIDATION_FAILED: decision must be approve|reject');
    }

    // Read the raw row to reach flow_* correlation + the node config snapshot.
    const rawRows = await this.engine.find('sys_approval_request', {
      where: { id: requestId }, limit: 1, context: SYSTEM_CTX,
    });
    const raw: any = Array.isArray(rawRows) ? rawRows[0] : null;
    if (!raw) throw new Error(`REQUEST_NOT_FOUND: ${requestId}`);
    if (raw.status !== 'pending') throw new Error(`INVALID_STATE: request is ${raw.status}`);

    const pendingApprovers = csvSplit(raw.pending_approvers);
    // A privileged admin may override a stuck request (#3424) even when they
    // hold no slot — the escape hatch for an approval routed to an unstaffed
    // position or to approvers who have all left.
    const isOverride = this.isOverrideActor(context, raw.organization_id ?? null);
    const isSlotHolder = pendingApprovers.includes(actorId);
    if (!isSlotHolder && !isOverride) {
      throw new Error(`FORBIDDEN: actor '${actorId}' is not a pending approver`);
    }
    // #4466 — the audit fact this decision would otherwise drop: the actor was
    // admitted ONLY by the override branch, holding no slot in the staffed
    // slate. An admin who IS a slot holder is approving normally, so the two
    // conditions are recorded apart rather than collapsed into "actor is admin".
    const viaOverride = isOverride && !isSlotHolder;

    const config = parseJson<ApprovalNodeConfig>(raw.node_config_json, { approvers: [], behavior: 'first_response' } as any);
    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const runId: string | null = raw.flow_run_id ?? null;
    const now = this.clock.now().toISOString();

    // #3447 P2: decision outputs — validated BEFORE any write (audit included)
    // so an out-of-contract payload rejects atomically. The trust model is a
    // `screen` node's: the AUTHOR declares the keys (`config.decisionOutputs`),
    // the approver only fills values. A decision carrying undeclared keys is a
    // caller bug; `decision`/`requestId` are reserved by the resume envelope.
    const outputKeys = input.outputs ? Object.keys(input.outputs) : [];
    let acceptedOutputs: Record<string, unknown> | undefined;
    // Typed declarations and bare keys whitelist identically — one normalizer
    // (spec) is the single reader of the union shape.
    const declaredDefs = normalizeDecisionOutputs((config as any).decisionOutputs);
    if (outputKeys.length) {
      const declared = declaredDefs.map(d => d.key);
      if (!declared.length) {
        throw new Error(
          `VALIDATION_FAILED: this approval node declares no decisionOutputs — outputs are not accepted. `
          + `Declare the keys on the node config (decisionOutputs: [${outputKeys.map(k => `'${k}'`).join(', ')}]) `
          + `to let approvers hand them to the flow.`,
        );
      }
      const reserved = outputKeys.filter(k => k === 'decision' || k === 'requestId');
      if (reserved.length) {
        throw new Error(
          `VALIDATION_FAILED: decision output key(s) \`${reserved.join('`, `')}\` are reserved by the resume `
          + `envelope — pick different names.`,
        );
      }
      const undeclared = outputKeys.filter(k => !declared.includes(k));
      if (undeclared.length) {
        throw new Error(
          `VALIDATION_FAILED: decision output key(s) \`${undeclared.join('`, `')}\` are not declared on this `
          + `node — declared keys: ${declared.map(k => `'${k}'`).join(', ') || '(none)'}.`,
        );
      }
      acceptedOutputs = { ...input.outputs };
    }

    // objectui#2955: `required` outputs. Unlike `type`/`multiple` — which only
    // shape the input widget — this one is a runtime contract: the flow must
    // never resume past this node with a required key missing, because that is
    // precisely what a downstream `expression` approver reads. Before this,
    // an author's only backstop was `onEmptyApprovers` (the next node opens,
    // resolves nobody, and stalls for an admin rescue).
    //
    // APPROVE only. A reject leaves down the reject edge, where the outputs
    // are not read — demanding routing data to say "no" would block the
    // rejection. Outputs still ride a reject when the approver filled them.
    //
    // Enforced for EVERY approve path, with no elevation bypass: a one-click
    // email action link cannot fill a form, and an `auto_approve` SLA
    // escalation has nobody to ask — both must fail rather than resume the run
    // with the key missing. The escalation sweep already isolates a throwing
    // request (it catches per-request), so that decision simply stays pending
    // and visibly overdue instead of advancing into a broken node.
    if (input.decision === 'approve') {
      const missing = declaredDefs
        .filter(d => d.required === true && isBlankDecisionOutput(input.outputs?.[d.key]))
        .map(d => d.key);
      if (missing.length) {
        throw new Error(
          `VALIDATION_FAILED: decision output(s) \`${missing.join('`, `')}\` are required to approve this `
          + `request — open the approval and fill them in before approving.`,
        );
      }
    }

    // The run behind this request must still be resumable before ANY of it is
    // written down (#4420). Last of the refusals, first before the writes: a
    // decision recorded against a dead run is a zombie nothing later can undo,
    // and the approver is told it succeeded.
    //
    // Non-finalizing votes are checked too — a co-sign that can never reach a
    // resume is just as stuck, and catching it here keeps the tally honest.
    await this.assertRunResumable(runId, requestId);

    // Audit the decision first so the quorum/per_group tally below sees it.
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: org,
      step_name: nodeId, step_index: 0, action: input.decision,
      actor_id: actorId, comment: input.comment ?? null,
      // #4466: the override is recorded on the DECISION, not inferred later.
      // Written as an explicit `false` for an ordinary decision so a reader can
      // tell "checked, and it was not an override" from a legacy row's `null`.
      via_override: viaOverride,
      attachments: input.attachments?.length ? input.attachments : null,
      created_at: now,
    }, { context: SYSTEM_CTX });

    // Multi-approver aggregation on approve (#3266). A rejection always
    // finalizes the node (one veto), so only the approve path can hold it open.
    // `first_response` finalizes on the first approval (falls straight through).
    const behavior = config.behavior ?? 'first_response';
    // A privileged override (an admin rescuing a stuck request, #3424) is an
    // authoritative decision, not one vote among the resolved slate — it
    // finalizes the node immediately, regardless of `unanimous`/`quorum`/
    // `per_group`. Only a real slot holder's approval feeds the multi-approver
    // tally below.
    if (input.decision === 'approve' && behavior !== 'first_response' && isSlotHolder) {
      const acts = await this.engine.find('sys_approval_action', {
        where: { request_id: requestId, step_index: 0, action: 'approve' }, limit: 1000, context: SYSTEM_CTX,
      });
      const approved = new Set<string>((acts ?? []).map((a: any) => String(a.actor_id ?? '')).filter(Boolean));

      // Tally against the OPEN-time snapshot (already OOO-substituted) for
      // every behavior that carries one. Re-resolution survives ONLY as the
      // back-compat path for requests opened before the snapshot existed —
      // it cannot ever run for an `expression` approver (#3447 P2: decide has
      // no flow variables to evaluate against; open time is the only
      // resolution point), and those always have a snapshot.
      const snapshotGroups = (config as any).__approverGroups as Record<string, string[]> | undefined;
      let original: string[];
      let groupMap: Record<string, string[]>;
      if (snapshotGroups) {
        groupMap = snapshotGroups;
        original = Object.keys(snapshotGroups);
      } else {
        original = await this.expandApprovers(
          { approvers: config.approvers }, parseJson(raw.payload_json, undefined), org,
        );
        groupMap = {};
      }

      if (!this.isApprovalSatisfied(behavior, config, original, groupMap, approved)) {
        const stillPending = original.filter(a => !approved.has(a));
        await this.engine.update('sys_approval_request', {
          id: requestId, pending_approvers: stillPending.join(','), updated_at: now,
          // #3447 P2: a mid-tally approval may carry outputs too (unanimous /
          // per_group co-sign, each approver contributing their declared keys)
          // — accumulate them on the snapshot so the FINALIZING decision hands
          // the merged set to the flow.
          ...(acceptedOutputs ? {
            node_config_json: JSON.stringify({
              ...config,
              __decisionOutputs: { ...((config as any).__decisionOutputs ?? {}), ...acceptedOutputs },
            }),
          } : {}),
        }, { context: SYSTEM_CTX });
        await this.syncApproverIndex(requestId, stillPending, org, now);
        const fresh = await this.readBackRequest(requestId, context);
        return { request: fresh!, runId, nodeId, finalized: false, decision: input.decision };
      }
    }

    const finalStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    // #3447 P2: the full accumulated output set — earlier co-sign votes' plus
    // this finalizing decision's — resumes the run and stays snapshotted for
    // the audit trail ("what did the approvers hand the flow").
    const mergedOutputs: Record<string, unknown> | undefined =
      acceptedOutputs || (config as any).__decisionOutputs
        ? { ...((config as any).__decisionOutputs ?? {}), ...(acceptedOutputs ?? {}) }
        : undefined;
    await this.engine.update('sys_approval_request', {
      id: requestId, status: finalStatus, pending_approvers: null, completed_at: now, updated_at: now,
      ...(mergedOutputs ? {
        node_config_json: JSON.stringify({ ...config, __decisionOutputs: mergedOutputs }),
      } : {}),
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, [], org, now);
    if (config.approvalStatusField) {
      await this.mirrorStatusField(
        raw.object_name, raw.record_id, config.approvalStatusField, finalStatus,
        actingUserId(context),
      );
    }
    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh!, runId, nodeId, finalized: true, decision: input.decision, outputs: mergedOutputs };
  }

  /**
   * Continue the owning flow run after an outcome this service has already
   * authorized and written down (#3801).
   *
   * The `approval` node declares `resumeAuthority: 'service'`, so the engine
   * refuses any resume of an approval suspension that does not carry
   * {@link RESUME_AUTHORITY_SERVICE}. Every approvals-side resume goes through
   * here so the marker is stamped in ONE place — a new outcome path cannot
   * quietly ship a resume that the gate then rejects at runtime, and nothing
   * in this file hands the marker to a caller-supplied signal.
   *
   * Callers still guard on `typeof this.automation?.resume === 'function'`
   * (approvals runs fine with no automation attached) and keep their own
   * try/catch, because what a failed resume means differs per path.
   *
   * Throws when the engine REPORTS failure, not only when it throws one. The
   * engine answers a lost run with `{ success: false, code: 'RUN_NOT_FOUND' }`
   * — a plain return value that every caller here used to discard, which is
   * how an approval could be recorded, reported as resumed, and leave its flow
   * stranded forever (#4420). The thrown error carries {@link resumeCodeOf}'s
   * `resumeCode` so callers can tell a benign duplicate from a dead run.
   */
  private async serviceResume(
    runId: string,
    signal: { output?: Record<string, unknown>; branchLabel?: string },
  ): Promise<void> {
    const result = await this.automation!.resume!(runId, { ...signal, [RESUME_AUTHORITY_SERVICE]: true });
    const reported = result as { success?: boolean; code?: string; error?: string } | undefined;
    // Only an explicit `success: false` is a failure. An engine (or a test
    // double) that returns nothing is reporting nothing, and has always meant
    // "it ran".
    if (reported && typeof reported === 'object' && reported.success === false) {
      const err = new Error(
        `resume of run '${runId}' failed${reported.code ? ` [${reported.code}]` : ''}: ${reported.error ?? 'unknown error'}`,
      ) as Error & { resumeCode?: string };
      err.resumeCode = reported.code;
      throw err;
    }
  }

  /** The engine failure code behind a {@link serviceResume} rejection, if any. */
  private static resumeCodeOf(err: unknown): string | undefined {
    return (err as { resumeCode?: string } | undefined)?.resumeCode;
  }

  /**
   * Refuse an operation whose whole point is to advance a flow run when that
   * run no longer exists — BEFORE anything is written down (#4420).
   *
   * The half-state this prevents is the one the issue reported: a request
   * flipped to `approved`, a success toast, and a flow that never moves. Once
   * the decision row is written there is nothing left to fail cleanly.
   *
   * Deliberately permissive at the edges:
   *  - no automation attached, or an engine without `hasSuspendedRun` → no
   *    pre-flight at all (standalone approvals compositions are unaffected);
   *  - the store cannot be READ → fail OPEN. A transient outage must not block
   *    every decision in the tenant; the post-resume check still catches a real
   *    failure and reports it loudly.
   */
  private async assertRunResumable(runId: string | null | undefined, requestId: string): Promise<void> {
    if (!runId) return;
    if (typeof this.automation?.resume !== 'function') return;
    if (typeof this.automation?.hasSuspendedRun !== 'function') return;
    let alive: boolean;
    try {
      alive = await this.automation.hasSuspendedRun(runId);
    } catch (err: any) {
      this.logger?.warn?.('[approvals] could not verify the flow run is resumable — proceeding', {
        request: requestId, run: runId, error: err?.message ?? String(err),
      });
      return;
    }
    if (!alive) {
      throw new Error(
        `RESUME_TARGET_LOST: the flow run '${runId}' behind request ${requestId} no longer exists ` +
        `(it was cancelled, or it paused in a process that did not persist suspended runs). ` +
        `Nothing was recorded. An administrator can recall the request to release the record.`,
      );
    }
  }

  /**
   * The run named by a recorded outcome cannot be advanced at all, because no
   * automation engine in THIS process implements the capability it needs
   * (#4420). Returns the reason, or `undefined` when the capability is there
   * and the caller should proceed.
   *
   * **Why this is not simply "not our problem".** Approvals is legitimately
   * usable with no engine attached, and {@link assertRunResumable} deliberately
   * stays out of the way for that reason. But "no engine is attached" and "no
   * run is waiting" are different facts, and only the second is benign: a
   * `flow_run_id` on the row is the request's OWN declaration that a run is
   * parked on this decision. Deciding it in a process that cannot resume it
   * reproduces #4420's reported half-state exactly — a durable decision, a
   * mirrored status field frozen mid-workflow, a flow parked forever — while
   * the caller is answered HTTP 200. The engine-less composition is the one
   * path the #4420 fix left silent, because every guard it added hangs off an
   * engine that is not there.
   *
   * **So the outcome stands, but it is never silent.** Rolling the decision
   * back is not on the table (a human really did decide, and the row is
   * already durable), and refusing every such call would break the standalone
   * compositions the pre-flight protects. What is owed is the report: `error`
   * level per AGENTS.md's durability rule — persisted state and runtime state
   * disagree and nothing looks broken from the outside — plus a `resumeError`
   * on the response, so `resumed: false` carries its reason instead of leaving
   * the caller to guess whether a resume was even attempted.
   *
   * Reuses the registered `RESUME_FAILED` code (ADR-0112 ledger) and
   * {@link serviceResume}'s message shape: the fact being reported — an
   * outcome recorded whose run did not advance — is the same one, and this
   * needs no new vocabulary of its own.
   */
  private missingRunCapability(
    runId: string,
    requestId: string,
    what: string,
    capability: 'resume' | 'cancelRun',
  ): string | undefined {
    const fn = capability === 'resume' ? this.automation?.resume : this.automation?.cancelRun;
    if (typeof fn === 'function') return undefined;
    this.logger?.error?.(
      '[approvals] no automation engine to advance the recorded outcome — the run is stranded',
      { request: requestId, run: runId, outcome: what, capability },
    );
    return (
      `${capability} of run '${runId}' failed [RESUME_FAILED]: ${what} was recorded on request ${requestId}, ` +
      `but no automation engine in this process can ${capability} its flow run — the run stays parked and the ` +
      `record's mirrored status will not advance. Compose the automation service in this host, or recall the ` +
      `request to release the record.`
    );
  }

  /**
   * Resume the run behind an outcome that has ALREADY been written down, and
   * fail loudly when it cannot be (#4420).
   *
   * For the operations whose product is the resume — a finalised decision, a
   * send-back, a resubmit. Their rows are durable by the time this runs, so a
   * failure here cannot be undone; the one thing left worth doing is refusing
   * to call it success. {@link assertRunResumable} is what keeps this rare:
   * everything it catches never reaches a write.
   *
   * `RESUME_IN_PROGRESS` is the exception — a concurrent resume is already
   * advancing the run, so the outcome stands and only `resumed` is false. So
   * is a composition with no engine at all ({@link missingRunCapability}),
   * which cannot throw without breaking every standalone deployment — it
   * reports through `resumeError` instead.
   *
   * @param what - how the recorded outcome reads in the error, e.g.
   *   `"the approve decision"`.
   */
  private async resumeRecordedOutcome(
    runId: string,
    requestId: string,
    what: string,
    signal: { output?: Record<string, unknown>; branchLabel?: string },
  ): Promise<{ resumed: boolean; resumeError?: string }> {
    const missing = this.missingRunCapability(runId, requestId, what, 'resume');
    if (missing) return { resumed: false, resumeError: missing };
    try {
      await this.serviceResume(runId, signal);
      return { resumed: true };
    } catch (err: any) {
      const reason = err?.message ?? String(err);
      if (ApprovalService.resumeCodeOf(err) === 'RESUME_IN_PROGRESS') {
        this.logger?.warn?.('[approvals] resume skipped — already in progress', {
          request: requestId, run: runId, outcome: what,
        });
        return { resumed: false, resumeError: reason };
      }
      this.logger?.error?.('[approvals] resume failed — the run is stranded', {
        request: requestId, run: runId, outcome: what, error: reason,
      });
      throw new Error(
        `RESUME_FAILED: ${what} was recorded on request ${requestId}, but its flow run '${runId}' ` +
        `could not be resumed and is now stranded: ${reason}`,
      );
    }
  }

  /**
   * Public contract entrypoint (ADR-0019). Records a decision on a node-driven
   * request via {@link ApprovalService.decideNode} and, when it finalizes,
   * resumes the owning flow run down the matching `approve` / `reject` edge.
   *
   * A finalising decision whose run cannot be resumed FAILS (#4420). The
   * decision is already durable by then, so the failure cannot be rolled back
   * — but it must not be reported as success either: this used to answer HTTP
   * 200 with `resumed: true` while the flow stayed parked forever, which left
   * the approver with no signal and the record mirroring a stage it never
   * reached. `decideNode`'s pre-flight means the common case (the run died
   * before the decision) never gets this far; what survives here is a genuine
   * race, and it names the stranded run.
   */
  async decide(
    requestId: string,
    input: ApprovalDecisionInput,
    context: ExecutionContext,
  ): Promise<ApprovalDecisionResult> {
    const result = await this.decideNode(requestId, input, context);

    let resumed = false;
    let resumeError: string | undefined;
    // No `typeof this.automation?.resume === 'function'` guard here (#4420):
    // skipping the call when no engine is attached is precisely how a decision
    // against a parked run returned 200 / `resumed: false` with nothing logged.
    // `resumeRecordedOutcome` reports that composition gap instead of hiding it.
    if (result.finalized && result.runId) {
      const branchLabel = result.decision === 'approve'
        ? APPROVAL_BRANCH_LABELS.approve
        : APPROVAL_BRANCH_LABELS.reject;
      const outcome = await this.resumeRecordedOutcome(
        result.runId, requestId, `the ${result.decision} decision`,
        {
          branchLabel,
          // #3447 P2: accepted decision outputs ride the resume envelope and
          // land as `<nodeId>.<key>` flow variables — a later approval node's
          // `expression` approver reads them as `vars.<nodeId>.<key>`.
          // Reserved keys are spread LAST so no output can shadow them (the
          // whitelist already rejects them; this is defense in depth).
          output: { ...(result.outputs ?? {}), decision: result.decision, requestId },
        },
      );
      resumed = outcome.resumed;
      resumeError = outcome.resumeError;
    }

    return {
      request: result.request,
      finalized: result.finalized,
      decision: result.decision,
      runId: result.runId,
      resumed,
      ...(resumeError ? { resumeError } : {}),
    };
  }

  /**
   * Withdraw a pending request (submitter only). Finalises the row as
   * `recalled`, releases the record lock (keyed on pending status), mirrors
   * the status field when configured, and resumes the owning flow run down
   * the `reject` branch with `output.decision = 'recall'` — leaving the run
   * suspended forever would leak it.
   *
   * ADR-0044: also valid on the LATEST `returned` request of its run — the
   * submitter abandons the revision window instead of resubmitting. The run
   * is then paused at the revise-window node (no reject edge), so it is
   * terminally cancelled via {@link ApprovalResumeSurface.cancelRun} rather
   * than resumed.
   */
  async recall(
    requestId: string,
    input: ApprovalRecallInput,
    context: ExecutionContext,
  ): Promise<ApprovalRecallResult> {
    if (!requestId) throw new Error('VALIDATION_FAILED: requestId is required');
    const actorId = await this.resolveActor(input?.actorId, context);

    const rawRows = await this.engine.find('sys_approval_request', {
      where: { id: requestId }, limit: 1, context: SYSTEM_CTX,
    });
    const raw: any = Array.isArray(rawRows) ? rawRows[0] : null;
    if (!raw) throw new Error(`REQUEST_NOT_FOUND: ${requestId}`);
    const inReviseWindow = raw.status === 'returned';
    if (raw.status !== 'pending' && !inReviseWindow) {
      throw new Error(`INVALID_STATE: request is ${raw.status}`);
    }
    // The submitter withdraws their own request; a privileged admin may recall
    // any pending request to release a stuck record (#3424).
    if (!this.isOverrideActor(context, raw.organization_id ?? null)
      && raw.submitter_id && String(raw.submitter_id) !== String(actorId)) {
      throw new Error(`FORBIDDEN: only the submitter may recall this request`);
    }
    // A returned request is only recallable while it is still the run's live
    // frontier — a resubmitted (or later-node) request supersedes it.
    if (inReviseWindow) await this.assertLatestForRun(raw);

    const config = parseJson<ApprovalNodeConfig>(raw.node_config_json, { approvers: [], behavior: 'first_response' } as any);
    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const runId: string | null = raw.flow_run_id ?? null;
    const now = this.clock.now().toISOString();

    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: org,
      step_name: nodeId, step_index: 0, action: 'recall',
      actor_id: actorId, comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });

    await this.engine.update('sys_approval_request', {
      id: requestId, status: 'recalled', pending_approvers: null, completed_at: now, updated_at: now,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, [], org, now);
    if (config.approvalStatusField) {
      await this.mirrorStatusField(
        raw.object_name, raw.record_id, config.approvalStatusField, 'recalled',
        actingUserId(context),
      );
    }

    // A recall ABANDONS the request, so a run that cannot be resumed must not
    // fail the call — the withdrawal and the record-lock release are the point,
    // and they have already happened. It is still reported rather than
    // swallowed: `resumed: false` plus a reason, logged at error (#4420).
    let resumed = false;
    let resumeError: string | undefined;
    if (inReviseWindow) {
      // ADR-0044: the run is paused at the revise-window node, which has no
      // reject out-edge to resume down — terminally cancel it instead.
      if (runId) {
        resumeError = this.missingRunCapability(runId, requestId, 'the recall', 'cancelRun');
        if (!resumeError) {
          try {
            await this.automation!.cancelRun!(runId, `approval request ${requestId} recalled during revision`);
          } catch (err: any) {
            resumeError = err?.message ?? String(err);
            this.logger?.error?.('[approvals] cancelRun after revise-window recall failed — the run may be stranded', {
              request: requestId, run: runId, error: resumeError,
            });
          }
        }
      }
    } else if (runId) {
      resumeError = this.missingRunCapability(runId, requestId, 'the recall', 'resume');
      if (!resumeError) {
        try {
          await this.serviceResume(runId, {
            branchLabel: APPROVAL_BRANCH_LABELS.reject,
            output: { decision: 'recall', requestId },
          });
          resumed = true;
        } catch (err: any) {
          resumeError = err?.message ?? String(err);
          this.logger?.error?.('[approvals] resume after recall failed — the run may be stranded', {
            request: requestId, run: runId, error: resumeError,
          });
        }
      }
    }

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh!, runId, resumed, ...(resumeError ? { resumeError } : {}) };
  }

  // ── Send back for revision / resubmit (ADR-0044) ─────────────

  /**
   * ADR-0044 send back for revision. Finalises the pending request as
   * `returned` (a third terminal state — approver-initiated rework, distinct
   * from submitter-initiated `recalled`) and resumes the owning flow run down
   * its `revise` edge to the revise window: the record lock (keyed on `pending`)
   * releases, the submitter reworks the data, then {@link resubmit}s.
   *
   * Requires the approval node to declare a `revise` out-edge — validated
   * BEFORE any mutation, because resuming with an unmatched `branchLabel`
   * falls back to *all* out-edges. Past the node's `maxRevisions` budget the
   * request auto-rejects instead (resumes down `reject` with
   * `output.autoRejected = true`) so instances cannot orbit forever.
   */
  async sendBack(
    requestId: string,
    input: ApprovalSendBackInput,
    context: ExecutionContext,
  ): Promise<ApprovalSendBackResult> {
    const actorId = await this.resolveActor(input?.actorId, context);
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    if (!context.isSystem && !pending.includes(actorId)) {
      throw new Error(`FORBIDDEN: actor '${actorId}' is not a pending approver`);
    }

    const config = parseJson<ApprovalNodeConfig>(raw.node_config_json, { approvers: [], behavior: 'first_response' } as any);
    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const runId: string | null = raw.flow_run_id ?? null;

    await this.assertReviseEdge(raw, nodeId);
    // A send-back exists to move the run to its revise window. If the run
    // is gone there is nothing to send back TO, so refuse before writing —
    // same reasoning as decideNode's pre-flight (#4420).
    await this.assertRunResumable(runId, requestId);

    const now = this.clock.now().toISOString();
    const maxRevisions = typeof (config as any).maxRevisions === 'number' ? (config as any).maxRevisions : 3;
    let priorSendBacks = 0;
    if (runId && nodeId) {
      const siblings = await this.engine.find('sys_approval_request', {
        where: { flow_run_id: runId, flow_node_id: nodeId, status: 'returned' }, limit: 500, context: SYSTEM_CTX,
      });
      priorSendBacks = Array.isArray(siblings) ? siblings.length : 0;
    }

    // Audit the revise intent first (audit-first, like decideNode) — on the
    // auto-reject path the trail then reads `revise → reject`, preserving
    // what the approver actually asked for.
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: org,
      step_name: nodeId, step_index: 0, action: 'revise',
      actor_id: actorId, comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });

    if (priorSendBacks >= maxRevisions) {
      // Revision budget exhausted — auto-reject (ADR-0044 loop guard).
      await this.engine.insert('sys_approval_action', {
        id: uid('aact'), request_id: requestId, organization_id: org,
        step_name: nodeId, step_index: 0, action: 'reject',
        actor_id: actorId,
        comment: `Auto-rejected: revision limit (${maxRevisions}) exceeded`, created_at: now,
      }, { context: SYSTEM_CTX });
      await this.engine.update('sys_approval_request', {
        id: requestId, status: 'rejected', pending_approvers: null, completed_at: now, updated_at: now,
      }, { context: SYSTEM_CTX });
      await this.syncApproverIndex(requestId, [], org, now);
      if (config.approvalStatusField) {
        await this.mirrorStatusField(
          raw.object_name, raw.record_id, config.approvalStatusField, 'rejected',
          actingUserId(context),
        );
      }
      let resumed = false;
      let resumeError: string | undefined;
      if (runId) {
        const outcome = await this.resumeRecordedOutcome(
          runId, requestId, 'the auto-rejection',
          {
            branchLabel: APPROVAL_BRANCH_LABELS.reject,
            output: { decision: 'reject', autoRejected: true, requestId },
          },
        );
        resumed = outcome.resumed;
        resumeError = outcome.resumeError;
      }
      if (raw.submitter_id) {
        await this.notify({
          topic: 'approval.returned',
          audience: [String(raw.submitter_id)],
          actorId: actorId,
          source: { object: 'sys_approval_request', id: requestId },
          payload: {
            title: 'Approval auto-rejected',
            message: `Your ${raw.object_name}/${raw.record_id} exceeded the revision limit (${maxRevisions}) and was rejected.`,
            actionUrl: '/system/approvals',
          },
        });
      }
      const fresh = await this.readBackRequest(requestId, context);
      return { request: fresh!, runId, resumed, autoRejected: true, ...(resumeError ? { resumeError } : {}) };
    }

    await this.engine.update('sys_approval_request', {
      id: requestId, status: 'returned', pending_approvers: null, completed_at: now, updated_at: now,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, [], org, now);
    if (config.approvalStatusField) {
      await this.mirrorStatusField(
        raw.object_name, raw.record_id, config.approvalStatusField, 'returned',
        actingUserId(context),
      );
    }

    let resumed = false;
    let resumeError: string | undefined;
    if (runId) {
      const outcome = await this.resumeRecordedOutcome(
        runId, requestId, 'the send-back',
        {
          branchLabel: APPROVAL_BRANCH_LABELS.revise,
          output: { decision: 'revise', requestId },
        },
      );
      resumed = outcome.resumed;
      resumeError = outcome.resumeError;
    }

    if (raw.submitter_id) {
      await this.notify({
        topic: 'approval.returned',
        audience: [String(raw.submitter_id)],
        actorId: actorId,
        source: { object: 'sys_approval_request', id: requestId },
        payload: {
          title: 'Sent back for revision',
          message: input.comment?.trim() || `Your ${raw.object_name}/${raw.record_id} needs rework before it can be approved.`,
          actionUrl: '/system/approvals',
        },
      });
    }

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh!, runId, resumed, ...(resumeError ? { resumeError } : {}) };
  }

  /**
   * ADR-0044 resubmit after rework. Valid on the LATEST `returned` request of
   * its run, submitter-only. Audits `resubmit` on the returned (round-N)
   * request and resumes the run from the revise-window node; traversal walks
   * the declared back-edge into the approval node, whose executor opens the
   * round-N+1 request — fresh approver slate, record re-locks.
   */
  async resubmit(
    requestId: string,
    input: ApprovalResubmitInput,
    context: ExecutionContext,
  ): Promise<ApprovalResubmitResult> {
    const actorId = await this.resolveActor(input?.actorId, context);
    const rawRows = await this.engine.find('sys_approval_request', {
      where: { id: requestId }, limit: 1, context: SYSTEM_CTX,
    });
    const raw: any = Array.isArray(rawRows) ? rawRows[0] : null;
    if (!raw) throw new Error(`REQUEST_NOT_FOUND: ${requestId}`);
    if (raw.status !== 'returned') {
      throw new Error(`INVALID_STATE: request is ${raw.status} (resubmit applies to returned requests)`);
    }
    if (!context.isSystem && raw.submitter_id && String(raw.submitter_id) !== String(actorId)) {
      throw new Error('FORBIDDEN: only the submitter may resubmit');
    }
    await this.assertLatestForRun(raw);

    // A colliding pending request on the same record (e.g. a record-change
    // trigger re-fired off an edit made inside the revise window) would make
    // the approval node's re-entry fail AFTER the engine consumed the
    // suspension — permanently killing the run. Refuse up front instead; the
    // submitter resolves the collision (recall the other request) first.
    const colliding = await this.engine.find('sys_approval_request', {
      where: { object_name: raw.object_name, record_id: raw.record_id, status: 'pending' },
      limit: 1, context: SYSTEM_CTX,
    });
    if (Array.isArray(colliding) && colliding[0]) {
      throw new Error(
        `DUPLICATE_REQUEST: another approval request is already pending on ${raw.object_name}/${raw.record_id} — resolve it before resubmitting`,
      );
    }

    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const runId: string | null = raw.flow_run_id ?? null;
    const now = this.clock.now().toISOString();

    // The next round only exists if the resume lands, so a run that is already
    // gone fails the resubmit outright rather than recording a round that can
    // never open (#4420).
    await this.assertRunResumable(runId, requestId);

    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: org,
      step_name: nodeId, step_index: 0, action: 'resubmit',
      actor_id: actorId, comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });

    let resumed = false;
    let resumeError: string | undefined;
    if (runId) {
      const outcome = await this.resumeRecordedOutcome(
        runId, requestId, 'the resubmit',
        {
          branchLabel: APPROVAL_BRANCH_LABELS.resubmit,
          output: { resubmitted: true, requestId },
        },
      );
      resumed = outcome.resumed;
      resumeError = outcome.resumeError;
    }

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh!, runId, resumed, ...(resumeError ? { resumeError } : {}) };
  }

  /**
   * ADR-0044 guard: the flow's approval node must declare a `revise`
   * out-edge before send-back is allowed — the engine's branch-label fallback
   * (no matching label ⇒ ALL out-edges) must never be reachable from a user
   * action.
   *
   * Since #3823 it also checks WHAT that edge targets: the revise window must
   * be an `approval_revise` node, the pause this service owns. ADR-0044 D3
   * pointed the edge at an ordinary `wait`, which is `resumeAuthority: 'any'`,
   * so a raw engine resume walked the resubmit back-edge with no submitter
   * check, no `resubmit` audit row, and — with a pending request colliding on
   * the record — destroyed the run by consuming the suspension before the
   * re-entry failed. Refused HERE, before any mutation, for the same reason the
   * missing-edge check is: a run must never be parked in a revise window that
   * something other than {@link resubmit} can advance.
   *
   * Also refused at authoring time — `flow-approval-revise-target-not-service-owned`
   * in `@objectstack/lint` gates `os build` / `os validate` / `os lint` and the
   * runtime metadata publish path — so a flow reaching this check at all is one
   * published before that gate existed.
   */
  private async assertReviseEdge(raw: any, nodeId: string | null): Promise<void> {
    const processName = String(raw.process_name ?? '');
    const flowName = processName.startsWith('flow:') ? processName.slice('flow:'.length) : undefined;
    if (!flowName || !nodeId || typeof this.automation?.getFlow !== 'function') {
      throw new Error('VALIDATION_FAILED: send-back requires the owning flow definition (automation engine unavailable)');
    }
    const flow: any = await this.automation.getFlow(flowName);
    const reviseEdges = Array.isArray(flow?.edges)
      ? flow.edges.filter((e: any) => e?.source === nodeId && e?.label === APPROVAL_BRANCH_LABELS.revise)
      : [];
    if (reviseEdges.length === 0) {
      throw new Error(
        `VALIDATION_FAILED: approval node '${nodeId}' has no '${APPROVAL_BRANCH_LABELS.revise}' out-edge — ` +
        'the flow does not support send-back for revision',
      );
    }
    const nodeTypeById = new Map<string, string>(
      (Array.isArray(flow?.nodes) ? flow.nodes : [])
        .filter((n: any) => typeof n?.id === 'string')
        .map((n: any) => [n.id as string, typeof n.type === 'string' ? n.type : '']),
    );
    for (const edge of reviseEdges) {
      const target = typeof edge?.target === 'string' ? edge.target : '';
      const targetType = nodeTypeById.get(target);
      if (targetType === APPROVAL_REVISE_NODE_TYPE) continue;
      throw new Error(
        `VALIDATION_FAILED: approval node '${nodeId}' has a '${APPROVAL_BRANCH_LABELS.revise}' out-edge into ` +
        `node '${target || '(unknown)'}'` +
        (targetType === undefined ? ' which the flow does not declare' : ` of type '${targetType || '(untyped)'}'`) +
        `, but the revise window must be an '${APPROVAL_REVISE_NODE_TYPE}' node — that pause continues only ` +
        'through this service (submitter-only, audited, and refusing a colliding pending request), and any ' +
        `other node type there is resumable by anyone with the run id (amended ADR-0044, #3823). Fix the flow: ` +
        `set node '${target || '<revise target>'}' to type '${APPROVAL_REVISE_NODE_TYPE}'.`,
      );
    }
  }

  /**
   * ADR-0044 guard: a `returned` request is only actionable (resubmit /
   * recall) while it is still the newest request on its run — a later round
   * or a later node's request supersedes it.
   */
  private async assertLatestForRun(raw: any): Promise<void> {
    const runId = raw.flow_run_id;
    if (!runId) return;
    // SortNode's key is `order` (spec/data/query.zod.ts) — `direction` would
    // silently default to ascending and return the OLDEST row.
    const rows = await this.engine.find('sys_approval_request', {
      where: { flow_run_id: runId },
      orderBy: [{ field: 'created_at', order: 'desc' }], limit: 1, context: SYSTEM_CTX,
    });
    const latest: any = Array.isArray(rows) ? rows[0] : null;
    if (latest && String(latest.id) !== String(raw.id)) {
      throw new Error('INVALID_STATE: a newer approval request supersedes this one');
    }
  }

  // ── Thread interactions (no flow movement) ───────────────────

  /**
   * Hand a pending-approver slot to someone else. `from` defaults to the
   * actor itself; the actor must hold the slot being handed over (or be a
   * system caller). A privileged admin (#3424) may reassign a request whose
   * slate holds no real user — an unstaffed-position literal — by handing the
   * whole request to a real approver, rescuing it from the locked dead-end.
   * Audits `reassign` and notifies the new approver.
   */
  async reassign(
    requestId: string,
    input: { actorId: string; to: string; from?: string; comment?: string },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }> {
    const actorId = await this.resolveActor(input?.actorId, context);
    const to = String(input?.to ?? '').trim();
    if (!to) throw new Error('VALIDATION_FAILED: `to` (new approver) is required');
    const raw = await this.loadPendingRow(requestId);

    const pending = csvSplit(raw.pending_approvers);
    if (pending.includes(to)) {
      throw new Error(`VALIDATION_FAILED: '${to}' is already a pending approver`);
    }
    const isOverride = this.isOverrideActor(context, raw.organization_id ?? null);
    const from = String(input.from ?? actorId).trim();
    // #4466 — same rule as `decideNode`: the marker records that the actor was
    // admitted only by the privileged branch, holding no slot themselves. A
    // reassign is the other action #3424 lets an admin take over a slate they
    // are not on, so it carries the same fact.
    const viaOverride = isOverride && !pending.includes(actorId);
    let next: string[];
    if (pending.includes(from)) {
      // Normal hand-off: the actor holds the slot being moved (or is a
      // system/admin caller acting on a real holder's slot).
      if (!context.isSystem && !isOverride && actorId !== from && !pending.includes(actorId)) {
        throw new Error(`FORBIDDEN: actor '${actorId}' is not a pending approver`);
      }
      next = pending.map(a => (a === from ? to : a));
    } else if (isOverride) {
      // Admin rescue (#3424): the caller holds no slot — the slate is an
      // unstaffed-position literal or a set of departed approvers. Reassign the
      // whole request to a real approver so the normal decision flow can resume.
      next = [to];
    } else {
      throw new Error(`FORBIDDEN: '${from}' is not a pending approver on this request`);
    }
    const now = this.clock.now().toISOString();
    // Audit first, then mutate — mirrors decideNode(), so a failed audit
    // write can never leave a moved slot without a trail.
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'reassign',
      // The hand-off parties are STRUCTURED fields (#4365) — the old default
      // comment (`"<from> → <to>"`) baked raw user ids into user-facing text.
      // `comment` is pure user input: absent unless the actor wrote one.
      actor_id: actorId, reassign_from: from, reassign_to: to,
      via_override: viaOverride,
      comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });
    // per_group / quorum (#3266): carry the delegated slot's group membership to
    // the new approver in the snapshot, so their approval still counts for the
    // original group.
    let configPatch: Record<string, unknown> = {};
    try {
      const cfg = parseJson<any>(raw.node_config_json, null);
      const groups = cfg?.__approverGroups as Record<string, string[]> | undefined;
      if (groups && groups[from] && !groups[to]) {
        groups[to] = groups[from];
        delete groups[from];
        configPatch = { node_config_json: JSON.stringify(cfg) };
      }
    } catch { /* snapshot left untouched on parse failure */ }
    await this.engine.update('sys_approval_request', {
      id: requestId, pending_approvers: next.join(','), updated_at: now, ...configPatch,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, next, raw.organization_id ?? null, now);

    await this.notify({
      topic: 'approval.reassigned',
      audience: [to],
      actorId: actorId,
      source: { object: 'sys_approval_request', id: requestId },
      dedupKey: `approval-reassign-${requestId}-${to}`,
      payload: {
        title: 'Approval handed to you',
        message: `You are now an approver on ${raw.object_name}/${raw.record_id}.`,
        actionUrl: '/system/approvals',
      },
    });

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh! };
  }

  /**
   * Submitter nudge — notify every pending approver. Throttled to one
   * reminder per {@link REMIND_COOLDOWN_MS} per request.
   */
  async remind(
    requestId: string,
    input: { actorId: string; comment?: string },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow; notified: number }> {
    const actorId = await this.resolveActor(input?.actorId, context);
    const raw = await this.loadPendingRow(requestId);
    if (!context.isSystem && raw.submitter_id && String(raw.submitter_id) !== String(actorId)) {
      throw new Error('FORBIDDEN: only the submitter may send reminders');
    }

    const acts = await this.engine.find('sys_approval_action', {
      where: { request_id: requestId, action: 'remind' },
      orderBy: [{ field: 'created_at', order: 'desc' }], limit: 1, context: SYSTEM_CTX,
    });
    const last: any = Array.isArray(acts) ? acts[0] : null;
    const now = this.clock.now();
    if (last?.created_at && now.getTime() - Date.parse(last.created_at) < REMIND_COOLDOWN_MS) {
      throw new Error('THROTTLED: a reminder was already sent recently');
    }

    const pending = csvSplit(raw.pending_approvers);
    const nowIso = now.toISOString();
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'remind',
      actor_id: actorId, comment: input.comment ?? null, created_at: nowIso,
    }, { context: SYSTEM_CTX });

    // Per-approver fan-out: concrete identities (user ids / emails) each get
    // their OWN one-tap approve/reject links (ADR-0043); `role:*`-style
    // literals can't carry a personal token and fall back to a plain nudge.
    let notified = 0;
    const concrete = pending.filter(a => a && !a.includes(':'));
    const literals = pending.filter(a => a && a.includes(':'));
    for (const approver of concrete) {
      try {
        const tokens = await this.issueActionTokens(requestId, approver);
        notified += await this.notify({
          topic: 'approval.reminder',
          audience: [approver],
          actorId: actorId,
          source: { object: 'sys_approval_request', id: requestId },
          dedupKey: `approval-remind-${requestId}-${nowIso}-${approver}`,
          payload: {
            title: 'Approval reminder',
            message: `A decision on ${raw.object_name}/${raw.record_id} is still waiting on you.`,
            actionUrl: '/system/approvals',
            actions: [
              { label: 'Approve', url: this.actionLinkUrl(tokens.approve) },
              { label: 'Reject', url: this.actionLinkUrl(tokens.reject) },
            ],
          },
        });
      } catch (err: any) {
        this.logger?.warn?.('[approvals] reminder with action links failed', {
          request: requestId, approver, error: err?.message ?? String(err),
        });
      }
    }
    if (literals.length) {
      notified += await this.notify({
        topic: 'approval.reminder',
        audience: literals,
        actorId: actorId,
        source: { object: 'sys_approval_request', id: requestId },
        dedupKey: `approval-remind-${requestId}-${nowIso}`,
        payload: {
          title: 'Approval reminder',
          message: `A decision on ${raw.object_name}/${raw.record_id} is still waiting on you.`,
          actionUrl: '/system/approvals',
        },
      });
    }

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh!, notified };
  }

  // ── Actionable links (ADR-0043) ──────────────────────────────

  /** Build the session-less confirm-page URL for a raw token. */
  actionLinkUrl(rawToken: string): string {
    return `${this.publicBaseUrl}/api/v1/approvals/act?token=${encodeURIComponent(rawToken)}`;
  }

  /**
   * Issue one-tap approve/reject tokens for one approver on one pending
   * request. Raw tokens are returned ONCE; only SHA-256 hashes are stored
   * (`sys_approval_token`), so a DB leak yields no usable links.
   */
  async issueActionTokens(
    requestId: string,
    approverId: string,
    opts?: { ttlMs?: number },
  ): Promise<{ approve: string; reject: string }> {
    if (!approverId?.trim()) throw new Error('VALIDATION_FAILED: approverId is required');
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    if (!pending.includes(approverId)) {
      throw new Error(`FORBIDDEN: '${approverId}' is not a pending approver on this request`);
    }
    const now = this.clock.now();
    const expires = new Date(now.getTime() + (opts?.ttlMs ?? ACTION_TOKEN_TTL_MS)).toISOString();
    const out = { approve: '', reject: '' };
    for (const action of ['approve', 'reject'] as const) {
      const rawToken = randomBytes(32).toString('base64url');
      await this.engine.insert('sys_approval_token', {
        id: uid('atok'),
        organization_id: raw.organization_id ?? null,
        token_hash: createHash('sha256').update(rawToken).digest('hex'),
        request_id: requestId,
        action,
        approver_id: approverId,
        expires_at: expires,
        consumed_at: null,
        created_at: now.toISOString(),
      }, { context: SYSTEM_CTX });
      out[action] = rawToken;
    }
    return out;
  }

  /** Shared validation chain for peek/redeem. Returns the token row when live. */
  private async resolveActionToken(rawToken: string): Promise<
    { ok: true; token: any; request: ApprovalRequestRow } | Extract<ActionTokenOutcome, { ok: false }>
  > {
    const trimmed = rawToken?.trim();
    if (!trimmed) return { ok: false, reason: 'invalid' };
    const hash = createHash('sha256').update(trimmed).digest('hex');
    const rows = await this.engine.find('sys_approval_token', {
      where: { token_hash: hash }, limit: 1, context: SYSTEM_CTX,
    });
    const token: any = Array.isArray(rows) ? rows[0] : null;
    if (!token) return { ok: false, reason: 'invalid' };
    if (token.consumed_at) return { ok: false, reason: 'consumed' };
    if (Date.parse(token.expires_at) < this.clock.now().getTime()) {
      return { ok: false, reason: 'expired' };
    }
    const request = await this.getRequest(token.request_id, SYSTEM_CTX);
    if (!request || request.status !== 'pending') {
      return { ok: false, reason: 'not_pending', request: request ?? undefined };
    }
    if (!(request.pending_approvers ?? []).includes(token.approver_id)) {
      // Reassigned away / slot consumed by a unanimous round — the link died
      // with the slot (ADR-0043 invalidation row).
      return { ok: false, reason: 'not_approver', request };
    }
    return { ok: true, token, request };
  }

  /** GET confirm page: validate WITHOUT consuming — never mutates. */
  async peekActionToken(rawToken: string): Promise<ActionTokenOutcome> {
    const res = await this.resolveActionToken(rawToken);
    if (!res.ok) return res;
    return { ok: true, action: res.token.action, request: res.request, approverId: res.token.approver_id };
  }

  /**
   * POST redemption: consume the token FIRST (a failed decide still burns
   * it — replay-safe), then decide as the bound approver.
   */
  async redeemActionToken(rawToken: string): Promise<ActionTokenOutcome> {
    const res = await this.resolveActionToken(rawToken);
    if (!res.ok) return res;
    await this.engine.update('sys_approval_token', {
      id: res.token.id, consumed_at: this.clock.now().toISOString(),
    }, { context: SYSTEM_CTX });
    const out = await this.decide(res.token.request_id, {
      decision: res.token.action,
      actorId: res.token.approver_id,
      comment: 'Via action link',
      // The token IS the authentication (#3783): it is single-use, hashed at
      // rest and bound to one approver, who `resolveActionToken` has just
      // re-checked still holds a pending slot. So this decision has a real
      // acting user even though no session carried it — name them on the
      // context, so the status mirror and every flow it cascades into are
      // attributed exactly like a decision made through the UI. Elevation is
      // unchanged: `isSystem` still stands in for the missing session.
    }, { ...SYSTEM_CTX, userId: res.token.approver_id });
    return { ok: true, action: res.token.action, request: out.request, approverId: res.token.approver_id };
  }

  /**
   * Approver asks the submitter for more information. The request stays
   * pending — a thread interaction, not a flow decision.
   */
  async requestInfo(
    requestId: string,
    input: { actorId: string; comment: string },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }> {
    const actorId = await this.resolveActor(input?.actorId, context);
    if (!input?.comment?.trim()) throw new Error('VALIDATION_FAILED: comment is required');
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    if (!context.isSystem && !pending.includes(actorId)) {
      throw new Error(`FORBIDDEN: actor '${actorId}' is not a pending approver`);
    }

    const now = this.clock.now().toISOString();
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'request_info',
      actor_id: actorId, comment: input.comment.trim(), created_at: now,
    }, { context: SYSTEM_CTX });

    if (raw.submitter_id) {
      await this.notify({
        topic: 'approval.request_info',
        audience: [String(raw.submitter_id)],
        actorId: actorId,
        source: { object: 'sys_approval_request', id: requestId },
        payload: {
          title: 'More information requested',
          message: input.comment.trim(),
          actionUrl: '/system/approvals',
        },
      });
    }

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh! };
  }

  /** Free-form reply on the thread (submitter or any pending approver). */
  async comment(
    requestId: string,
    input: { actorId: string; comment: string; attachments?: string[] },
    context: ExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }> {
    const actorId = await this.resolveActor(input?.actorId, context);
    if (!input?.comment?.trim()) throw new Error('VALIDATION_FAILED: comment is required');
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    const isSubmitter = raw.submitter_id && String(raw.submitter_id) === String(actorId);
    if (!context.isSystem && !isSubmitter && !pending.includes(actorId)) {
      throw new Error(`FORBIDDEN: actor '${actorId}' is not on this request`);
    }

    const now = this.clock.now().toISOString();
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'comment',
      actor_id: actorId, comment: input.comment.trim(),
      attachments: input.attachments?.length ? input.attachments : null,
      created_at: now,
    }, { context: SYSTEM_CTX });

    // Notify the other side of the thread.
    const audience = isSubmitter ? pending : [String(raw.submitter_id ?? '')].filter(Boolean);
    await this.notify({
      topic: 'approval.comment',
      audience,
      actorId: actorId,
      source: { object: 'sys_approval_request', id: requestId },
      payload: {
        title: 'New comment on an approval',
        message: input.comment.trim(),
        actionUrl: '/system/approvals',
      },
    });

    const fresh = await this.readBackRequest(requestId, context);
    return { request: fresh! };
  }

  // ── SLA escalation (ADR-0042) ─────────────────────────────────

  /**
   * One escalation sweep: every *pending* request whose node config declares
   * `escalation.timeoutHours` and whose deadline has passed is escalated
   * **at most once, ever** — the `escalate` audit row is the idempotency
   * marker, written before any mutation (audit-first, like reassign). One
   * bad row never stops the sweep.
   */
  async runEscalations(): Promise<{ scanned: number; escalated: number }> {
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_approval_request', {
        where: { status: 'pending' }, limit: 500, context: SYSTEM_CTX,
      }) ?? [];
    } catch (err: any) {
      this.logger?.warn?.('[approvals] escalation scan failed to list requests', {
        error: err?.message ?? String(err),
      });
      return { scanned: 0, escalated: 0 };
    }

    let escalated = 0;
    for (const raw of rows) {
      try {
        const cfg = parseJson<any>(raw.node_config_json, undefined);
        const esc = cfg?.escalation;
        if (!esc || typeof esc.timeoutHours !== 'number' || esc.timeoutHours <= 0) continue;
        const due = slaDueAt(raw.created_at, cfg);
        if (!due || Date.parse(due) > this.clock.now().getTime()) continue;

        // Single-shot: a prior 'escalate' action means this request is done.
        const prior = await this.engine.find('sys_approval_action', {
          where: { request_id: raw.id, action: 'escalate' }, limit: 1, context: SYSTEM_CTX,
        });
        if (Array.isArray(prior) && prior[0]) continue;

        await this.escalateRequest(raw, esc);
        escalated++;
      } catch (err: any) {
        this.logger?.warn?.('[approvals] escalation failed for request', {
          request: raw?.id, error: err?.message ?? String(err),
        });
      }
    }
    if (escalated > 0) {
      this.logger?.info?.('[approvals] SLA escalation sweep', { scanned: rows.length, escalated });
    }
    return { scanned: rows.length, escalated };
  }

  // ── Dead-run release (#3456) ──────────────────────────────────

  /**
   * One dead-run sweep: a pending request whose owning flow run has reached a
   * TERMINAL state can never be decided — nothing is left to resume — so the
   * request is finalised as `recalled` and, with `lockRecord`, the record it was
   * holding is released.
   *
   * This is the recovery half of #3456. The prevention half is the record lock's
   * owning-run exemption (`lifecycle-hooks.ts`), which stops a run from killing
   * itself on its own lock in the first place; this sweep cleans up the runs that
   * still die — for any reason, including a process crash, which no in-band
   * handler can catch because the process that would have run it is gone.
   *
   * **Fail-safe by construction.** It acts only on an explicit terminal status
   * from a closed set. Every other answer — `paused` (the normal state of a run
   * waiting on its approval), `running`, an unrecognised status, `null` (unknown
   * run, evicted log, no durable store), a `getRun` that throws, or no automation
   * engine at all — is read as "still alive" and left strictly alone. The failure
   * mode is therefore "a dead run's lock survives until an admin recalls it"
   * (today's behaviour, #3424), never "a live approval is destroyed".
   *
   * `recalled` is the finalisation because it is the platform's existing terminal
   * state for *a live request that ended without a decision*; the audit row names
   * the real cause and {@link DEAD_RUN_ACTOR_ID} the real actor, so a dead-run
   * release is never mistaken for a submitter's withdrawal.
   */
  /**
   * Read-only inspection for the OTHER dead-run shape: a request that is
   * already TERMINAL while its `flow_run_id` points at nothing (#4469).
   *
   * #4460 stopped new ones being produced; nothing found the ones already
   * stuck. The failure mode (#4420) is a request row flipped to `approved` /
   * `rejected` / `returned` whose owning run no longer exists — the decision
   * landed, the flow never moved. Any deployment on 17.0.0-rc.1 that hit the
   * wiring hole and crossed a restart mid-approval can be carrying these rows.
   *
   * {@link releaseDeadRunRequests} cannot see them, for a reason worth naming:
   * it scans `status: 'pending'`, and the very step that zombified the request
   * is the one that took it OUT of `pending`. The act of breaking it removed it
   * from the only sweeper's field of view — which is a large part of why this
   * class of failure stayed silent.
   *
   * It also could not have answered the question even if it looked: its
   * liveness oracle is `getRun`, which treats both `null` and `paused` as alive
   * (conservative, correct) — so it has no way to say "this run is really
   * gone". (Until #8050 that oracle was weaker still: after a restart it
   * returned `null` for a perfectly ALIVE suspended run, so "alive" and
   * "unknown" were the same answer. It now reports such a run as `paused`,
   * which does not change any branch here — both already meant "leave alone" —
   * but it is why the sweep below needs `hasSuspendedRun` as a second oracle
   * rather than a sharper reading of the first.)
   *
   * So this uses BOTH oracles, and a row must fail both to be reported:
   *
   *  - `hasSuspendedRun(runId) === false` — the suspension store itself says no
   *    live pause exists. It THROWS when the store cannot be read, and that
   *    case is SKIPPED, never counted as dead: an unreadable store means
   *    "unknown", and a storage outage must not be published as a lost run.
   *  - `getRun(runId) == null` — no terminal history row either (the `run_`
   *    prefixed rows in `sys_automation_run`). A run that merely finished is
   *    not stranded; a request whose run neither waits nor ever completed is.
   *
   * **Reports; never rewrites.** No status is changed and no run is cancelled.
   * The decision genuinely happened — a human approved or rejected — and
   * silently rolling it back would make the audit trail disagree with the
   * facts. What an operator needs first is visibility: which requests are stuck
   * at which step, and what the mirrored status field on the business record
   * still says. Whether to re-run the downstream actions or re-open the
   * approval is a judgement call this cannot make.
   */
  async inspectStrandedRequests(options?: { limit?: number }): Promise<{
    scanned: number;
    stranded: StrandedApprovalRequest[];
    /** Rows skipped because the suspension store could not be read — NOT healthy, just unknown. */
    undetermined: number;
  }> {
    const empty = { scanned: 0, stranded: [] as StrandedApprovalRequest[], undetermined: 0 };
    // Both oracles are required. Without `hasSuspendedRun` there is no way to
    // tell a live cross-restart pause from a dead run, and reporting on
    // `getRun` alone would name every healthy paused approval as stranded.
    if (typeof this.automation?.hasSuspendedRun !== 'function') return empty;
    if (typeof this.automation?.getRun !== 'function') return empty;

    const limit = options?.limit ?? 500;
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_approval_request', {
        where: { status: { $in: [...STRANDABLE_REQUEST_STATUSES] } }, limit, context: SYSTEM_CTX,
      }) ?? [];
    } catch (err: any) {
      this.logger?.warn?.('[approvals] stranded-request scan failed to list requests', {
        error: err?.message ?? String(err),
      });
      return empty;
    }

    const stranded: StrandedApprovalRequest[] = [];
    let undetermined = 0;
    for (const raw of rows) {
      const runId = raw?.flow_run_id ? String(raw.flow_run_id) : '';
      if (!runId) continue;   // not node-driven — no run was ever supposed to move

      let suspended: boolean;
      try {
        suspended = await this.automation.hasSuspendedRun!(runId);
      } catch (err: any) {
        // Store unreadable ⇒ existence unknown. Skipping is the only safe
        // answer; counted so "0 stranded" can never be read as "all clear"
        // when nothing could actually be checked.
        undetermined++;
        this.logger?.warn?.('[approvals] stranded-request scan could not read the suspension store', {
          request: raw?.id, run: runId, error: err?.message ?? String(err),
        });
        continue;
      }
      if (suspended) continue;   // still parked — the run is alive and resumable

      let terminal: { status?: string } | null = null;
      try {
        terminal = await this.automation.getRun!(runId);
      } catch (err: any) {
        undetermined++;
        this.logger?.warn?.('[approvals] stranded-request scan could not read the run history', {
          request: raw?.id, run: runId, error: err?.message ?? String(err),
        });
        continue;
      }
      if (terminal) continue;    // the run ran to a terminal state — it is not dangling

      // Neither suspended nor ever finished: the run this decision was supposed
      // to advance is genuinely gone.
      const config = parseJson<ApprovalNodeConfig>(
        raw.node_config_json, { approvers: [], behavior: 'first_response' } as any,
      );
      const mirrorField = config.approvalStatusField;
      let mirroredStatus: string | undefined;
      if (mirrorField) {
        try {
          const recs = await this.engine.find(raw.object_name, {
            where: { id: raw.record_id }, limit: 1, context: SYSTEM_CTX,
          });
          const rec: any = Array.isArray(recs) ? recs[0] : null;
          if (rec) mirroredStatus = rec[mirrorField] ?? undefined;
        } catch { /* display-only — a mirror read must never fail the scan */ }
      }
      stranded.push({
        requestId: String(raw.id),
        status: raw.status,
        runId,
        flowName: typeof raw.process_name === 'string' ? raw.process_name.replace(/^flow:/, '') : undefined,
        nodeId: raw.flow_node_id ?? raw.current_step ?? undefined,
        objectName: raw.object_name,
        recordId: raw.record_id,
        organizationId: raw.organization_id ?? null,
        completedAt: raw.completed_at ?? undefined,
        mirrorField,
        mirroredStatus,
      });
    }

    if (stranded.length || undetermined) {
      this.logger?.warn?.('[approvals] stranded terminal requests (decision recorded, flow run gone)', {
        scanned: rows.length, stranded: stranded.length, undetermined,
        requests: stranded.map(s => `${s.requestId}@${s.nodeId ?? '?'} → run ${s.runId}`),
      });
    }
    return { scanned: rows.length, stranded, undetermined };
  }

  async releaseDeadRunRequests(): Promise<{ scanned: number; released: number }> {
    // No liveness oracle → no basis to declare anything dead.
    if (typeof this.automation?.getRun !== 'function') return { scanned: 0, released: 0 };

    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_approval_request', {
        where: { status: 'pending' }, limit: 500, context: SYSTEM_CTX,
      }) ?? [];
    } catch (err: any) {
      this.logger?.warn?.('[approvals] dead-run sweep failed to list requests', {
        error: err?.message ?? String(err),
      });
      return { scanned: 0, released: 0 };
    }

    let released = 0;
    for (const raw of rows) {
      try {
        const runId = raw?.flow_run_id ? String(raw.flow_run_id) : '';
        if (!runId) continue;   // not node-driven — no run owns it, nothing to check

        let status: string | undefined;
        try {
          const run = await this.automation.getRun!(runId);
          status = typeof run?.status === 'string' ? run.status : undefined;
        } catch (err: any) {
          // Unknown liveness is NOT death — leave the request pending.
          this.logger?.warn?.('[approvals] dead-run sweep could not read run status', {
            request: raw?.id, run: runId, error: err?.message ?? String(err),
          });
          continue;
        }
        if (!status || !TERMINAL_RUN_STATUSES.has(status)) continue;

        await this.abandonForDeadRun(raw, runId, status);
        released++;
      } catch (err: any) {
        // One bad row never stops the sweep (mirrors runEscalations).
        this.logger?.warn?.('[approvals] dead-run release failed for request', {
          request: raw?.id, error: err?.message ?? String(err),
        });
      }
    }
    if (released > 0) {
      this.logger?.info?.('[approvals] dead-run sweep', { scanned: rows.length, released });
    }
    return { scanned: rows.length, released };
  }

  /**
   * Finalise one pending request whose owning run is terminal. Mirrors the
   * shape of {@link recall} — audit row first (so a crash mid-release leaves a
   * trace of the intent), then the status transition, approver-index sync and
   * the optional status-field mirror. No resume/cancel of the run: it is already
   * terminal, which is precisely why we are here.
   */
  private async abandonForDeadRun(raw: any, runId: string, runStatus: string): Promise<void> {
    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const now = this.clock.now().toISOString();

    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: raw.id, organization_id: org,
      step_name: nodeId, step_index: 0, action: 'recall',
      actor_id: DEAD_RUN_ACTOR_ID,
      comment: `owning flow run ${runId} is ${runStatus} — request abandoned and record lock released`,
      created_at: now,
    }, { context: SYSTEM_CTX });

    await this.engine.update('sys_approval_request', {
      id: raw.id, status: 'recalled', pending_approvers: null, completed_at: now, updated_at: now,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(raw.id, [], org, now);

    const config = parseJson<ApprovalNodeConfig>(
      raw.node_config_json, { approvers: [], behavior: 'first_response' } as any,
    );
    if (config.approvalStatusField) {
      // No human did this — a sweep did. Left user-less on purpose (#3783): a
      // flow that wants to react to a dead-run release declares runAs:'system'.
      await this.mirrorStatusField(
        raw.object_name, raw.record_id, config.approvalStatusField, 'recalled', null,
      );
    }

    this.logger?.warn?.('[approvals] released a record held by a dead approval run', {
      request: raw.id, run: runId, runStatus, object: raw.object_name, record: raw.record_id,
    });
  }

  /** Execute the configured escalation action for one overdue request. */
  private async escalateRequest(raw: any, esc: any): Promise<void> {
    const action: string = esc.action ?? 'notify';
    const escalateTo: string | undefined =
      typeof esc.escalateTo === 'string' && esc.escalateTo.trim() ? esc.escalateTo.trim() : undefined;
    const now = this.clock.now().toISOString();
    const pending = csvSplit(raw.pending_approvers);

    // `escalateTo` is a position machine name or a user id (same contract as
    // the `position` ApproverType, ADR-0090 D3). Position holders win; an
    // empty expansion falls back to the literal, so a config naming a
    // specific user id keeps working unchanged.
    let escalatees: string[] = [];
    if (escalateTo) {
      try {
        escalatees = await this.expandPositionUsers(escalateTo, raw.organization_id ?? null);
      } catch { escalatees = []; }
      if (!escalatees.length) escalatees = [escalateTo];
    }

    // Audit first — this row IS the idempotency marker (ADR-0042 §1).
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: raw.id, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'escalate',
      actor_id: SLA_ACTOR_ID,
      comment: `${action}${escalateTo ? ` → ${escalateTo}` : ''}`,
      created_at: now,
    }, { context: SYSTEM_CTX });

    if (action === 'reassign' && escalatees.length) {
      await this.engine.update('sys_approval_request', {
        id: raw.id, pending_approvers: escalatees.join(','), updated_at: now,
      }, { context: SYSTEM_CTX });
      await this.syncApproverIndex(raw.id, escalatees, raw.organization_id ?? null, now);
      await this.notify({
        topic: 'approval.escalated',
        audience: escalatees,
        actorId: SLA_ACTOR_ID,
        source: { object: 'sys_approval_request', id: raw.id },
        payload: {
          title: 'Approval escalated to you',
          message: `An overdue approval on ${raw.object_name}/${raw.record_id} was escalated to you.`,
          actionUrl: '/system/approvals',
        },
      });
    } else if (action === 'auto_approve' || action === 'auto_reject') {
      await this.decide(raw.id, {
        decision: action === 'auto_approve' ? 'approve' : 'reject',
        actorId: SLA_ACTOR_ID,
        comment: 'SLA escalation',
      }, SYSTEM_CTX);
    } else {
      // 'notify' (and the reassign-without-target fallback)
      await this.notify({
        topic: 'approval.sla_breached',
        audience: [...pending, ...escalatees],
        actorId: SLA_ACTOR_ID,
        source: { object: 'sys_approval_request', id: raw.id },
        payload: {
          title: 'Approval SLA breached',
          message: `A decision on ${raw.object_name}/${raw.record_id} is overdue.`,
          actionUrl: '/system/approvals',
        },
      });
    }

    if (esc.notifySubmitter !== false && raw.submitter_id) {
      await this.notify({
        topic: 'approval.sla_breached',
        audience: [String(raw.submitter_id)],
        actorId: SLA_ACTOR_ID,
        source: { object: 'sys_approval_request', id: raw.id },
        payload: {
          title: 'Your approval request breached its SLA',
          message: `${raw.object_name}/${raw.record_id}: escalation action '${action}' was taken.`,
          actionUrl: '/system/approvals',
        },
      });
    }
  }

  // ── Display enrichment ───────────────────────────────────────

  /**
   * Resolve the schema-declared display field for an object, when the engine
   * exposes schema metadata (`getSchema`). Falls back to common title-ish
   * field names so plain `ApprovalEngine` fakes still enrich sensibly.
   */
  private resolveDisplayField(object: string): string | undefined {
    try {
      const schema: any = (this.engine as any).getSchema?.(object);
      const fields = schema?.fields ?? {};
      // [ADR-0079] `nameField` is the canonical primary-title pointer;
      // `displayNameField` is the deprecated alias (still honored).
      const declared = schema?.nameField ?? schema?.displayNameField;
      if (declared && declared !== 'id' && fields[declared]) return declared;
      for (const cand of ['name', 'title', 'subject', 'label']) {
        if (fields[cand]) return cand;
      }
    } catch { /* schema unavailable — heuristics below still apply */ }
    return undefined;
  }

  private static pickTitle(rec: any, displayField?: string): string | undefined {
    const candidates = displayField
      ? [displayField, 'name', 'title', 'subject', 'label']
      : ['name', 'title', 'subject', 'label'];
    for (const f of candidates) {
      const v = rec?.[f];
      if (v != null && String(v).trim() && f !== 'id') return String(v);
    }
    return undefined;
  }

  /**
   * Batch-resolve `sys_user` display names for identifiers that may be user
   * ids or emails. Best-effort — failures leave entries unresolved.
   */
  private async resolveUserNames(identifiers: Array<string | null | undefined>): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    const targets = Array.from(new Set(identifiers.filter(Boolean))) as string[];
    if (!targets.length) return names;
    try {
      const users = await this.engine.find('sys_user', {
        where: { id: { $in: targets } }, fields: ['id', 'name', 'email'],
        limit: targets.length, context: SYSTEM_CTX,
      });
      for (const u of (users ?? []) as any[]) {
        if (u?.id && (u.name || u.email)) names.set(String(u.id), String(u.name ?? u.email));
      }
    } catch { /* best-effort */ }
    const unresolvedEmails = targets.filter(t => !names.has(t) && t.includes('@'));
    if (unresolvedEmails.length) {
      try {
        const users = await this.engine.find('sys_user', {
          where: { email: { $in: unresolvedEmails } }, fields: ['email', 'name'],
          limit: unresolvedEmails.length, context: SYSTEM_CTX,
        });
        for (const u of (users ?? []) as any[]) {
          if (u?.email && u.name) names.set(String(u.email), String(u.name));
        }
      } catch { /* best-effort */ }
    }
    return names;
  }

  /** Lookup-typed fields (key + referenced object) of an object's schema. */
  private resolveLookupFields(object: string): Array<{ key: string; reference: string }> {
    try {
      const schema: any = (this.engine as any).getSchema?.(object);
      const fields = schema?.fields ?? {};
      const out: Array<{ key: string; reference: string }> = [];
      for (const [key, f] of Object.entries<any>(fields)) {
        if ((f?.type === 'lookup' || f?.type === 'master_detail' || f?.type === 'user') && f?.reference) {
          out.push({ key, reference: String(f.reference) });
        }
      }
      return out;
    } catch { return []; }
  }

  /**
   * Field key → display label for an object's schema. Lets the inbox summary
   * show a human field name ("考核状态") instead of a title-cased machine key
   * ("Assessment Status"). For a single-locale project the schema label already
   * IS the localized string; symmetric with `resolveDisplayField`/lookup
   * resolution that power `payload_display`.
   */
  private resolveFieldLabels(object: string): Record<string, string> {
    try {
      const schema: any = (this.engine as any).getSchema?.(object);
      const fields = schema?.fields ?? {};
      const out: Record<string, string> = {};
      for (const [key, f] of Object.entries<any>(fields)) {
        if (f?.label) out[key] = String(f.label);
      }
      return out;
    } catch { return {}; }
  }

  /**
   * Attach inbox display fields to rows so clients never render a raw
   * identifier: `record_title`, `submitter_name`, `object_label`,
   * `pending_approver_names` (user-id approvers), `payload_display`
   * (lookup foreign keys in the snapshot → referenced record titles), and
   * `payload_labels` (snapshot field keys → the target object's field labels).
   * Batched: one query per distinct object (target + referenced) plus one
   * `sys_user` lookup. Best-effort — a deleted record falls back to the
   * payload snapshot, and any failure leaves the field unset rather than
   * failing the list.
   */
  private async enrichRows(rows: ApprovalRequestRow[]): Promise<void> {
    if (!rows.length) return;

    // Record titles + object labels, batched per object.
    const byObject = new Map<string, Set<string>>();
    for (const r of rows) {
      if (!r.object_name || !r.record_id) continue;
      let set = byObject.get(r.object_name);
      if (!set) { set = new Set(); byObject.set(r.object_name, set); }
      set.add(r.record_id);
    }
    const titles = new Map<string, string>();
    const objectLabels = new Map<string, string>();
    for (const [object, idSet] of byObject) {
      try {
        const schema: any = (this.engine as any).getSchema?.(object);
        if (schema?.label) objectLabels.set(object, String(schema.label));
      } catch { /* label optional */ }
      const ids = Array.from(idSet);
      const displayField = this.resolveDisplayField(object);
      try {
        const recs = await this.engine.find(object, {
          where: { id: { $in: ids } }, limit: ids.length, context: SYSTEM_CTX,
        });
        for (const rec of (recs ?? []) as any[]) {
          const title = ApprovalService.pickTitle(rec, displayField);
          if (rec?.id && title) titles.set(`${object} ${rec.id}`, title);
        }
      } catch { /* object may be unregistered — payload fallback below */ }
    }

    // Lookup foreign keys inside payload snapshots → referenced record titles.
    const lookupFieldsByObject = new Map<string, Array<{ key: string; reference: string }>>();
    // Field key → label per object, for the snapshot summary's field names.
    const fieldLabelsByObject = new Map<string, Record<string, string>>();
    for (const object of byObject.keys()) {
      const lookups = this.resolveLookupFields(object);
      if (lookups.length) lookupFieldsByObject.set(object, lookups);
      const labels = this.resolveFieldLabels(object);
      if (Object.keys(labels).length) fieldLabelsByObject.set(object, labels);
    }
    const refIds = new Map<string, Set<string>>();
    for (const r of rows) {
      const lookups = lookupFieldsByObject.get(r.object_name);
      const payload: any = r.payload;
      if (!lookups || !payload || typeof payload !== 'object') continue;
      for (const { key, reference } of lookups) {
        const v = payload[key];
        if (v == null || typeof v === 'object' || !String(v).trim()) continue;
        let set = refIds.get(reference);
        if (!set) { set = new Set(); refIds.set(reference, set); }
        set.add(String(v));
      }
    }
    const refTitles = new Map<string, string>();
    for (const [object, idSet] of refIds) {
      const ids = Array.from(idSet);
      const displayField = this.resolveDisplayField(object);
      try {
        const recs = await this.engine.find(object, {
          where: { id: { $in: ids } }, limit: ids.length, context: SYSTEM_CTX,
        });
        for (const rec of (recs ?? []) as any[]) {
          const title = ApprovalService.pickTitle(rec, displayField);
          if (rec?.id && title) refTitles.set(`${object} ${rec.id}`, title);
        }
      } catch { /* referenced object unreadable — leave unresolved */ }
    }

    // Display names for submitters AND user-id approvers in one lookup.
    // `role:<r>` (and other `type:value` literals) are already readable.
    const userIdentifiers: Array<string | null | undefined> = [];
    for (const r of rows) {
      userIdentifiers.push(r.submitter_id);
      for (const a of r.pending_approvers ?? []) {
        if (a && !a.includes(':')) userIdentifiers.push(a);
      }
    }
    const names = await this.resolveUserNames(userIdentifiers);

    for (const r of rows as any[]) {
      const title = titles.get(`${r.object_name} ${r.record_id}`)
        ?? ApprovalService.pickTitle(r.payload, undefined);
      if (title) r.record_title = title;
      const name = r.submitter_id ? names.get(String(r.submitter_id)) : undefined;
      if (name) r.submitter_name = name;
      const label = objectLabels.get(r.object_name);
      if (label) r.object_label = label;

      const approverNames: Record<string, string> = {};
      for (const a of r.pending_approvers ?? []) {
        const n = names.get(String(a));
        if (n) approverNames[a] = n;
      }
      if (Object.keys(approverNames).length) r.pending_approver_names = approverNames;

      const lookups = lookupFieldsByObject.get(r.object_name);
      if (lookups && r.payload && typeof r.payload === 'object') {
        const display: Record<string, string> = {};
        for (const { key, reference } of lookups) {
          const v = (r.payload as any)[key];
          if (v == null) continue;
          const t = refTitles.get(`${reference} ${String(v)}`);
          if (t) display[key] = t;
        }
        if (Object.keys(display).length) r.payload_display = display;
      }

      // Field labels for the snapshot keys the summary renders (only keys
      // actually present in the payload — a deleted field's label is noise).
      const fieldLabels = fieldLabelsByObject.get(r.object_name);
      if (fieldLabels && r.payload && typeof r.payload === 'object') {
        const labels: Record<string, string> = {};
        for (const key of Object.keys(r.payload as Record<string, unknown>)) {
          const l = fieldLabels[key];
          if (l) labels[key] = l;
        }
        if (Object.keys(labels).length) r.payload_labels = labels;
      }
    }
  }

  // ── Pending-approver index (issue #1745) ─────────────────────

  /**
   * Mirror one request's `pending_approvers` CSV into the normalized
   * `sys_approval_approver` index. Called by every write path that changes
   * the approver set; an empty `approvers` clears the request's rows (the
   * request left `pending`). Diff-based so reassign/unanimous churn doesn't
   * rewrite untouched rows.
   */
  private async syncApproverIndex(
    requestId: string,
    approvers: string[],
    org: string | null,
    now: string,
  ): Promise<void> {
    const desired = new Set(approvers.map(a => String(a).trim()).filter(Boolean));
    const existing = await this.engine.find('sys_approval_approver', {
      where: { request_id: requestId }, limit: 500, context: SYSTEM_CTX,
    });
    const rows: any[] = Array.isArray(existing) ? existing : [];
    for (const row of rows) {
      if (desired.has(String(row.approver))) desired.delete(String(row.approver));
      else await this.engine.delete('sys_approval_approver', { where: { id: row.id }, context: SYSTEM_CTX });
    }
    for (const approver of desired) {
      await this.engine.insert('sys_approval_approver', {
        id: uid('aapr'), request_id: requestId, approver,
        organization_id: org, created_at: now,
      }, { context: SYSTEM_CTX });
    }
  }

  /**
   * Rebuild the whole `sys_approval_approver` index from the CSV source of
   * truth. Idempotent; run at plugin start so rows written before the index
   * existed (or drifted past a crashed sync) become queryable. Cost tracks
   * the number of *pending* requests, not the request history.
   */
  async rebuildApproverIndex(): Promise<{ requests: number; inserted: number; deleted: number }> {
    // Both walks seek by `id` rather than counting from the start (#4363).
    // The desired-state walk fed the deletion pass below, so a row it skipped
    // was not a slow page — it was an approver silently dropped from someone's
    // queue. An offset walk over `status = 'pending'` has no such guarantee:
    // it slices an arrangement nothing holds steady, and this method is itself
    // a writer against the same tables.
    const desired = new Map<string, { approvers: Set<string>; org: string | null }>();
    const PAGE = 500;
    const requests = keysetWalk<Record<string, any>>(
      (q) => this.engine.find('sys_approval_request', {
        ...q,
        fields: ['id', 'pending_approvers', 'organization_id'],
        context: SYSTEM_CTX,
      }),
      { where: { status: 'pending' }, pageSize: PAGE },
    );
    for await (const rows of requests.pages()) {
      for (const r of rows) {
        desired.set(String(r.id), {
          approvers: new Set(csvSplit(r.pending_approvers)),
          org: r.organization_id ?? null,
        });
      }
    }

    // Current state: read the whole index first, THEN mutate. The seek makes
    // that separation a belt rather than the only brace — `created_at` is not
    // unique, so the previous ORDER BY could not make these pages a partition
    // even before the deletes below shifted the rows underneath them.
    const indexRows: any[] = [];
    const index = keysetWalk<Record<string, any>>(
      (q) => this.engine.find('sys_approval_approver', { ...q, context: SYSTEM_CTX }),
      { pageSize: PAGE },
    );
    for await (const rows of index.pages()) indexRows.push(...rows);
    let inserted = 0; let deleted = 0;
    const seen = new Map<string, Set<string>>();
    for (const row of indexRows) {
      const reqId = String(row.request_id);
      const want = desired.get(reqId);
      const have = seen.get(reqId) ?? seen.set(reqId, new Set()).get(reqId)!;
      // Orphan (request no longer pending), stale entry, or duplicate → drop.
      if (!want || !want.approvers.has(String(row.approver)) || have.has(String(row.approver))) {
        await this.engine.delete('sys_approval_approver', { where: { id: row.id }, context: SYSTEM_CTX });
        deleted++;
        continue;
      }
      have.add(String(row.approver));
    }

    const now = this.clock.now().toISOString();
    for (const [reqId, want] of desired) {
      const have = seen.get(reqId);
      for (const approver of want.approvers) {
        if (have?.has(approver)) continue;
        await this.engine.insert('sys_approval_approver', {
          id: uid('aapr'), request_id: reqId, approver,
          organization_id: want.org, created_at: now,
        }, { context: SYSTEM_CTX });
        inserted++;
      }
    }
    return { requests: desired.size, inserted, deleted };
  }

  // ── Read API ─────────────────────────────────────────────────

  /** Filter type accepted by {@link listRequests} / {@link countRequests}. */
  private buildRequestWhere(
    filter: {
      object?: string;
      recordId?: string;
      status?: ApprovalStatus | ApprovalStatus[];
      submitterId?: string;
      q?: string;
    } | undefined,
    context: ExecutionContext,
  ): { where: any; tenantOrg: string | null } {
    const f: any = {};
    if (filter?.object) f.object_name = filter.object;
    if (filter?.recordId) f.record_id = filter.recordId;
    if (filter?.submitterId) f.submitter_id = filter.submitterId;
    // Tenant isolation: when a caller context carries a tenant identifier
    // (organizationId / tenantId), scope the query to that tenant. SYSTEM
    // callers (no tenant) see all rows. This prevents the bespoke endpoint
    // from leaking other-tenant rows since we deliberately query with
    // SYSTEM_CTX to bypass RLS on the engine (the approver-visibility rule
    // spans three identity forms, which RLS can't model cleanly).
    // `organizationId` is not on the envelope — see isOverrideActor().
    const tenantOrg = (context as any)?.organizationId ?? context?.tenantId ?? null;
    if (tenantOrg) f.organization_id = tenantOrg;
    // Free-text search, pushed down: `payload_json` carries the record
    // snapshot, so record titles match without any join. `$contains` is the
    // driver's escaped-LIKE operator.
    const q = filter?.q?.trim();
    if (q) {
      f.$or = [
        { process_name: { $contains: q } },
        { object_name: { $contains: q } },
        { record_id: { $contains: q } },
        { submitter_id: { $contains: q } },
        { payload_json: { $contains: q } },
      ];
    }
    // Status pushes down whole: `$in` for arrays (all bundled drivers
    // support it), equality for a single value.
    if (Array.isArray(filter?.status)) {
      const statuses = (filter!.status as ApprovalStatus[]).filter(Boolean);
      if (statuses.length === 1) f.status = statuses[0];
      else if (statuses.length > 1) f.status = { $in: statuses };
    } else if (filter?.status) {
      f.status = filter.status;
    }
    return { where: f, tenantOrg };
  }

  /** Window the approver-index probe — pending queues live far below this. */
  private static readonly APPROVER_INDEX_CAP = 10_000;

  /**
   * Resolve an approver filter to matching request ids via the normalized
   * `sys_approval_approver` index — the indexed replacement for the old
   * in-memory CSV scan, and what makes approver-filtered pagination correct
   * past any scan window (issue #1745). A request matches when ANY of the
   * caller's identities (user id / email / role:<r>) holds a pending slot.
   * Returns null when the filter is absent (callers skip the id constraint).
   */
  private async approverRequestIds(
    targets: string[],
    tenantOrg: string | null,
  ): Promise<string[] | null> {
    if (!targets.length) return null;
    const where: any = targets.length === 1
      ? { approver: targets[0] }
      : { approver: { $in: targets } };
    if (tenantOrg) where.organization_id = tenantOrg;
    const rows = await this.engine.find('sys_approval_approver', {
      where, fields: ['request_id'],
      limit: ApprovalService.APPROVER_INDEX_CAP, context: SYSTEM_CTX,
    });
    const list: any[] = Array.isArray(rows) ? rows : [];
    if (list.length >= ApprovalService.APPROVER_INDEX_CAP) {
      this.logger?.warn?.('[approvals] approver index probe hit its window — results may be truncated', {
        cap: ApprovalService.APPROVER_INDEX_CAP, targets: targets.length,
      });
    }
    return [...new Set<string>(list.map(r => String(r.request_id)))];
  }

  /**
   * The request ids this caller is a PARTICIPANT of, or `null` for a caller
   * who may see everything in scope (#3590).
   *
   * These reads deliberately run with `SYSTEM_CTX` to bypass RLS — the
   * approver-visibility rule spans several identity forms that RLS cannot model
   * cleanly, which is why it has to be expressed here. Until now only the
   * TENANT half of that rule was applied, so any authenticated user could read
   * any request in their tenant (and, once attachments derived their access
   * from the request, its files too). This adds the participant half.
   *
   * A participant is the submitter, a current approver, or someone who has
   * already acted on the request (a past approver whose slot has moved on, a
   * commenter). Admins with override authority keep the unrestricted view the
   * "all requests" console surface depends on.
   *
   * Keying on the concrete user id is sufficient rather than an approximation:
   * position/team/manager/field approvers are resolved to concrete user ids at
   * open time, and the `type:value` literal is only the fallback for a spec
   * that resolved to NOBODY — a slot no one can act on either way (`can_act`
   * is a plain membership test over the resolved ids). So this cannot hide a
   * request from someone who could actually act on it.
   */
  private async visibleRequestIds(
    context: ExecutionContext,
    tenantOrg: string | null,
    target?: { object?: string | null; recordId?: string | null },
  ): Promise<Set<string> | null> {
    if (this.isOverrideActor(context, tenantOrg)) return null;
    const uid = context?.userId != null ? String(context.userId) : '';
    // A tokenless/anonymous caller participates in nothing. Fail closed.
    if (!uid) return new Set<string>();

    const ids = new Set<string>();
    const cap = ApprovalService.APPROVER_INDEX_CAP;
    const add = (rows: unknown, key: string) => {
      const list: any[] = Array.isArray(rows) ? rows : [];
      for (const r of list) if (r?.[key] != null) ids.add(String(r[key]));
      if (list.length >= cap) {
        this.logger?.warn?.(
          '[approvals] participant-visibility probe hit its window — some requests may be hidden from a legitimate participant',
          { cap, key },
        );
      }
    };

    try {
      // Current approver — via the normalized index, so every identity form
      // the write path recorded is covered.
      for (const id of (await this.approverRequestIds([uid], tenantOrg)) ?? []) ids.add(id);

      const orgWhere = tenantOrg ? { organization_id: tenantOrg } : {};
      add(
        await this.engine.find('sys_approval_request', {
          where: { submitter_id: uid, ...orgWhere },
          fields: ['id'], limit: cap, context: SYSTEM_CTX,
        }),
        'id',
      );
      // Already acted on it: a past approver whose slot has moved on, or a
      // commenter. They saw it legitimately; keep it that way.
      add(
        await this.engine.find('sys_approval_action', {
          where: { actor_id: uid },
          fields: ['request_id'], limit: cap, context: SYSTEM_CTX,
        }),
        'request_id',
      );
    } catch (err) {
      // Never widen on error: a failed probe yields whatever was collected.
      this.logger?.warn?.('[approvals] participant-visibility probe failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // [#8652] The read-only record-reader tier, applied STRICTLY ON TOP of the
    // participant set above. It only ever adds ids; it can never return `null`
    // (the "sees everything" verdict) and never removes a constraint, so the
    // worst it can do is the thing it is for.
    await this.addRecordReaderVisibleIds(ids, context, tenantOrg, target);
    return ids;
  }

  /**
   * [#8652] Read-only approval visibility derived from READ ACCESS TO THE
   * TARGET BUSINESS RECORD.
   *
   * Maintainer ruling 2026-08-15: a user who can read the target record may
   * view that record's approval requests and full action history, read-only,
   * behind a switch that is default OFF, anchored on the EXISTING record-read
   * permission. The rejected alternative was a host-injected visibility hook —
   * a security predicate the platform could neither constrain nor audit.
   *
   * ## How the anchor is evaluated
   *
   * By asking the engine to read the record AS THE CALLER. That is the whole
   * check: `engine.find(object, { where: { id }, context })` runs the ordinary
   * ObjectQL middleware — object CRUD read, then RLS — so a denial throws and a
   * row the caller may not see comes back empty. Both mean "no". No new
   * permission, role or grant type is invented, and no second copy of the
   * access rule exists to drift from the first.
   *
   * ⚠️ The caller's context is load-bearing. Probing with {@link SYSTEM_CTX} —
   * the context every other read in this service uses — would read exactly like
   * a permission check while admitting every authenticated user in the tenant.
   *
   * ## Why it needs a NAMED TARGET, and what that deliberately excludes
   *
   * The rule is anchored on one record, so it can only be evaluated where a
   * record is named: a list filtered by `object` + `recordId` (what a record
   * page's approval tab sends), or a request loaded by id (whose own row names
   * its target). An UNTARGETED list — the inbox — is left exactly as it was:
   * answering it under this tier would mean probing every request in the tenant
   * for read access, which is unbounded, and would turn a work queue into a
   * browse surface. The confirmed consumer is the record page; the inbox is not
   * part of the ruling and is not widened here.
   *
   * ## What becomes visible (stated plainly, because the switch is an opt-in)
   *
   * The request row — including its `payload` snapshot of the record at
   * submission time — plus the full action history: actor, decision, timestamp,
   * the action's COMMENT text, and (through the same gate, via
   * {@link ApprovalService.authorizeFileRead}) any decision attachments. The
   * comment text is the ruling's "full action history" read literally; it is
   * flagged on the card as the one granularity edge worth a second look.
   *
   * Read-only is not enforced here and must not be: the decision paths
   * (`decideNode` / `reassign` / `recall` / `comment`) authorize on the pending
   * approver slate, the submitter, or {@link ApprovalService.isOverrideActor},
   * none of which this tier touches. Seeing a request confers nothing.
   */
  private async addRecordReaderVisibleIds(
    ids: Set<string>,
    context: ExecutionContext,
    tenantOrg: string | null,
    target?: { object?: string | null; recordId?: string | null },
  ): Promise<void> {
    // Default OFF: a deployment that declares nothing must see no behaviour
    // change at all — not even a probe whose answer is discarded.
    if (this.recordReaderVisibleObjects.size === 0) return;
    const object = String(target?.object ?? '').trim();
    const recordId = String(target?.recordId ?? '').trim();
    if (!object || !recordId) return;
    if (!this.recordReaderVisibleObjects.has(object)) return;
    // A tokenless/anonymous caller reads nothing. Fail closed, as above.
    const uid = context?.userId != null ? String(context.userId) : '';
    if (!uid) return;

    try {
      // The anchor. As the CALLER — see the warning in the doc block.
      const readable = await this.engine.find(object, {
        where: { id: recordId }, fields: ['id'], limit: 1, context,
      });
      if (!Array.isArray(readable) || readable.length === 0) return;

      // Admitted: every request on that record, inside the caller's tenant.
      const orgWhere = tenantOrg ? { organization_id: tenantOrg } : {};
      const rows = await this.engine.find('sys_approval_request', {
        where: { object_name: object, record_id: recordId, ...orgWhere },
        fields: ['id'], limit: ApprovalService.APPROVER_INDEX_CAP, context: SYSTEM_CTX,
      });
      for (const r of Array.isArray(rows) ? rows : []) {
        if (r?.id != null) ids.add(String(r.id));
      }
    } catch (err) {
      // Never widen on error — a failed or refused probe adds nothing. A CRUD
      // denial arrives here as a throw and is the ordinary "no", so this is
      // logged at debug rather than warn: on a deployment with the tier on it
      // is a routine answer, not a degradation.
      this.logger?.debug?.('[approvals] record-reader visibility probe declined', {
        object, error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Intersect an existing `where.id` constraint with the participant set. */
  private applyVisibility(where: any, visible: Set<string> | null): boolean {
    if (!visible) return true;
    if (visible.size === 0) return false;
    let allowed = [...visible];
    const current = where.id;
    if (typeof current === 'string') allowed = allowed.filter((x) => x === current);
    else if (current && typeof current === 'object' && Array.isArray(current.$in)) {
      const set = new Set(current.$in.map((v: unknown) => String(v)));
      allowed = allowed.filter((x) => set.has(x));
    }
    if (allowed.length === 0) return false;
    where.id = allowed.length === 1 ? allowed[0] : { $in: allowed };
    return true;
  }

  async listRequests(
    filter: {
      object?: string;
      recordId?: string;
      status?: ApprovalStatus | ApprovalStatus[];
      approverId?: string | string[];
      submitterId?: string;
      q?: string;
      limit?: number;
      offset?: number;
    } | undefined,
    context: ExecutionContext,
  ): Promise<ApprovalRequestRow[]> {
    const { where, tenantOrg } = this.buildRequestWhere(filter, context);
    const approverTargets = (Array.isArray(filter?.approverId) ? filter!.approverId : filter?.approverId ? [filter.approverId] : [])
      .map(t => String(t).trim())
      .filter(Boolean);

    // Every filter now pushes into the engine (issue #1745): approver via
    // the normalized index, status arrays via $in — so the page window is
    // always engine-side and correct at any table size.
    const ids = await this.approverRequestIds(approverTargets, tenantOrg);
    if (ids) {
      if (ids.length === 0) return [];
      where.id = ids.length === 1 ? ids[0] : { $in: ids };
    }

    // #3590: the caller-supplied `approverId` is a FILTER, not authorization —
    // omitting it used to return every request in the tenant. Intersect with
    // what this caller actually participates in.
    // [#8652] The filter's own `object`/`recordId` is what names the target
    // record the read-only tier anchors on; without them nothing is widened.
    if (!this.applyVisibility(where, await this.visibleRequestIds(context, tenantOrg, {
      object: filter?.object, recordId: filter?.recordId,
    }))) return [];

    const findOpts: any = {
      where,
      orderBy: [{ field: 'created_at', order: 'desc' }],
      context: SYSTEM_CTX,
    };
    if (filter?.limit != null || filter?.offset != null) {
      findOpts.limit = Math.min(Math.max(filter?.limit ?? 50, 1), 200);
      if (filter?.offset) findOpts.offset = Math.max(filter.offset, 0);
    } else {
      // Unpaginated callers keep the legacy bounded window.
      findOpts.limit = 500;
    }

    const rows = await this.engine.find('sys_approval_request', findOpts);
    const list = Array.isArray(rows) ? rows.map(rowFromRequest) : [];
    await this.enrichRows(list);
    this.attachViewers(list, context);
    return list;
  }

  async countRequests(
    filter: Parameters<IApprovalService['listRequests']>[0],
    context: ExecutionContext,
  ): Promise<number> {
    const { where, tenantOrg } = this.buildRequestWhere(filter, context);
    const approverTargets = (Array.isArray(filter?.approverId) ? filter!.approverId : filter?.approverId ? [filter.approverId] : [])
      .map(t => String(t).trim())
      .filter(Boolean);

    const ids = await this.approverRequestIds(approverTargets, tenantOrg);
    if (ids) {
      if (ids.length === 0) return 0;
      where.id = ids.length === 1 ? ids[0] : { $in: ids };
    }

    // #3590 — the count must agree with the list it paginates, so it reads the
    // same target (#8652) as `listRequests` above.
    if (!this.applyVisibility(where, await this.visibleRequestIds(context, tenantOrg, {
      object: filter?.object, recordId: filter?.recordId,
    }))) return 0;

    const countFn = (this.engine as any).count;
    if (typeof countFn === 'function') {
      try {
        const n = await countFn.call(this.engine, 'sys_approval_request', { where, context: SYSTEM_CTX });
        if (typeof n === 'number') return n;
      } catch { /* fall through to scan */ }
    }
    // Engine without count(): bounded scan. The approver-filtered case is
    // exact (the id set bounds it); the unfiltered case keeps the legacy
    // 500 window.
    const rows = await this.engine.find('sys_approval_request', {
      where, fields: ['id'], limit: ids ? Math.max(500, ids.length) : 500, context: SYSTEM_CTX,
    });
    return Array.isArray(rows) ? rows.length : 0;
  }

  /**
   * Read the request a write path just changed, to echo back as its result.
   *
   * NOT participant-gated (#3590), deliberately: the operation authorized
   * itself by its own rule before writing, so re-asking "may you see this?"
   * for the echo answers a question that has already been settled — and would
   * answer it WRONG for a caller context that carries no `userId` (a
   * flow-driven resume, a service-to-service call), turning a successful write
   * into a `null` result. Gating belongs on the read API, not on an
   * operation's own return value.
   */
  private async readBackRequest(
    requestId: string,
    context: ExecutionContext,
  ): Promise<ApprovalRequestRow | null> {
    return this.loadRequest(requestId, context, false);
  }

  async getRequest(requestId: string, context: ExecutionContext): Promise<ApprovalRequestRow | null> {
    return this.loadRequest(requestId, context, true);
  }

  private async loadRequest(
    requestId: string,
    context: ExecutionContext,
    enforceVisibility: boolean,
  ): Promise<ApprovalRequestRow | null> {
    if (!requestId) return null;
    const where: any = { id: requestId };
    // `organizationId` is not on the envelope — see isOverrideActor().
    const tenantOrg = (context as any)?.organizationId ?? context?.tenantId;
    if (tenantOrg) where.organization_id = tenantOrg;
    const rows = await this.engine.find('sys_approval_request', {
      where, limit: 1, context: SYSTEM_CTX,
    });
    if (!Array.isArray(rows) || !rows[0]) return null;
    // #3590: tenant scoping alone let any authenticated user read any request
    // — and, once decision attachments derived their access from the request
    // (#3580), its files too. Participation is the rest of the rule.
    if (enforceVisibility) {
      // [#8652] The row itself names the target record, so a request loaded by
      // id carries its own anchor — which is what makes `listActions` and the
      // decision-attachment gate follow this rule without a second copy of it.
      const visible = await this.visibleRequestIds(context, tenantOrg ?? null, {
        object: rows[0].object_name, recordId: rows[0].record_id,
      });
      if (visible && !visible.has(String(rows[0].id))) return null;
    }
    const row = rowFromRequest(rows[0]);
    await this.enrichRows([row]);
    await this.attachFlowSteps(row);
    await this.attachDecisionProgress(row, rows[0]);
    this.attachViewers([row], context);
    return row;
  }

  /**
   * Server-computed decision aggregation progress (#3266 / objectui#2678 P1.5).
   * Single-read enrichment only (like {@link ApprovalService.attachFlowSteps}):
   * for a PENDING request whose behavior aggregates multiple approvals
   * (`unanimous` / `quorum` / `per_group`), expose
   * `decision_progress: { behavior, got, need, groups? }` so any client renders
   * "2 of 3" or per-group ticks without re-deriving the engine's tally rules.
   * `first_response` requests carry no progress (one approval finalizes).
   * Display-only and best-effort — errors leave the row untouched.
   */
  private async attachDecisionProgress(row: ApprovalRequestRow, raw: any): Promise<void> {
    try {
      if (row.status !== 'pending') return;
      const cfg = parseJson<any>(raw.node_config_json, undefined);
      const behavior = cfg?.behavior ?? 'first_response';
      if (behavior !== 'unanimous' && behavior !== 'quorum' && behavior !== 'per_group') return;

      const acts = await this.engine.find('sys_approval_action', {
        where: { request_id: row.id, step_index: 0, action: 'approve' }, limit: 1000, context: SYSTEM_CTX,
      });
      const approved = new Set<string>((acts ?? []).map((a: any) => String(a.actor_id ?? '')).filter(Boolean));

      const snapshot = cfg?.__approverGroups as Record<string, string[]> | undefined;
      const slate = snapshot ? Object.keys(snapshot) : [...approved, ...(row.pending_approvers ?? [])];
      const total = slate.length || 1;

      const progress: any = { behavior, got: approved.size, need: total };
      if (behavior === 'quorum') {
        progress.need = Math.min(Math.max(1, cfg?.minApprovals ?? total), total);
      } else if (behavior === 'per_group' && snapshot) {
        const perGroupNeed = Math.max(1, cfg?.minApprovals ?? 1);
        const size: Record<string, number> = {};
        for (const gs of Object.values(snapshot)) for (const g of gs) size[g] = (size[g] ?? 0) + 1;
        const got: Record<string, number> = {};
        for (const a of approved) for (const g of (snapshot[a] ?? [])) got[g] = (got[g] ?? 0) + 1;
        progress.groups = Object.keys(size).sort().map(g => {
          const need = Math.min(perGroupNeed, size[g]);
          return { group: g, got: Math.min(got[g] ?? 0, need), need, satisfied: (got[g] ?? 0) >= need };
        });
        progress.got = progress.groups.filter((g: any) => g.satisfied).length;
        progress.need = progress.groups.length;

        // Approver→group(s) for the STILL-PENDING slots (objectui#2807), so the
        // console can label each "waiting on" chip with the group it represents
        // rather than showing duplicate, context-free names. Only pending slots
        // matter — a resolved approver has dropped out of `pending_approvers`.
        // Synthetic (unnamed, `#N`) group keys are dropped: a `· #0` sub-tag is
        // noise, and the client would have to filter it anyway.
        const pendingGroups: Record<string, string[]> = {};
        for (const a of (row.pending_approvers ?? [])) {
          const named = (snapshot[a] ?? []).filter((g) => !/^#\d+$/.test(g));
          if (named.length) pendingGroups[a] = named;
        }
        if (Object.keys(pendingGroups).length) {
          (row as any).pending_approver_groups = pendingGroups;
        }
      }
      (row as any).decision_progress = progress;
    } catch { /* display-only enrichment */ }
  }

  /**
   * Attach the per-viewer capability block (#3310) from the caller's context.
   * `can_act` mirrors the exact authorization the decision methods enforce — the
   * caller's user id is in the resolved `pending_approvers` while the request is
   * still `pending` (position/team/manager approvers are already resolved to
   * concrete user ids at open time, so a plain membership test is faithful).
   * `is_submitter` is a straight owner check. `can_override` (#3424) is true for
   * a platform/tenant admin on a PENDING request — the recovery path for an
   * approval routed to an unstaffed position or to approvers who have all left;
   * clients OR it into the decision actions' `visible` gate so an admin can act
   * even when they hold no slot. System/tokenless contexts get a both-false
   * `can_act`/`is_submitter` block (system gets `can_override` too — it may act
   * on anything). Cheap + synchronous — safe on list reads.
   */
  private attachViewers(rows: ApprovalRequestRow[], context: ExecutionContext): void {
    const uid = context?.userId != null ? String(context.userId) : null;
    for (const row of rows) {
      const pending = row.pending_approvers ?? [];
      (row as any).viewer = {
        can_act: row.status === 'pending' && !!uid && pending.includes(uid),
        is_submitter: !!uid && row.submitter_id != null && String(row.submitter_id) === uid,
        can_override: row.status === 'pending'
          && this.isOverrideActor(context, (row as any).organization_id ?? null),
      };
    }
  }

  /**
   * Derive approval-step progress from the owning flow's graph (single-read
   * enrichment only — list reads skip it). Walks from the start node
   * preferring `approve`/`true` edges, so the result is the flow's main
   * approval trunk; conditional side-steps show as part of the potential
   * path. Display-only and best-effort.
   */
  private async attachFlowSteps(row: ApprovalRequestRow): Promise<void> {
    try {
      const flowName = row.process_name?.startsWith('flow:') ? row.process_name.slice(5) : undefined;
      if (!flowName || typeof this.automation?.getFlow !== 'function') return;
      const flow: any = await this.automation.getFlow(flowName);
      if (!flow?.nodes?.length) return;
      const nodesById = new Map<string, any>(flow.nodes.map((n: any) => [n.id, n]));
      const steps: Array<{ id: string; label: string }> = [];
      const seen = new Set<string>();
      let cur: any = flow.nodes.find((n: any) => n.type === 'start');
      while (cur && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (cur.type === 'approval') steps.push({ id: cur.id, label: cur.label || cur.id });
        const out = (flow.edges ?? []).filter((e: any) => e.source === cur.id);
        if (!out.length) break;
        const pick = out.find((e: any) => e.label === 'approve')
          ?? out.find((e: any) => e.label === 'true')
          ?? out[0];
        cur = nodesById.get(pick.target);
      }
      if (steps.length === 0) return;
      const currentId = row.flow_node_id ?? row.current_step;
      const currentIdx = steps.findIndex(s => s.id === currentId);
      (row as any).flow_steps = steps.map((s, i) => ({
        ...s,
        state: currentIdx < 0 ? 'upcoming'
          : i < currentIdx ? 'done'
          : i === currentIdx ? (row.status === 'approved' ? 'done' : 'current')
          : 'upcoming',
      }));
    } catch { /* display-only — never fail the read */ }
  }

  async listActions(requestId: string, context: ExecutionContext): Promise<ApprovalActionRow[]> {
    if (!requestId) return [];
    // Tenant gate: ensure the caller can see the parent request before
    // returning its action history. Skipping this would leak history rows
    // across tenants the same way the unscoped list-requests path did.
    const req = await this.getRequest(requestId, context);
    if (!req) return [];
    const rows = await this.engine.find('sys_approval_action', {
      where: { request_id: requestId },
      limit: 500,
      orderBy: [{ field: 'created_at', order: 'asc' }],
      context: SYSTEM_CTX,
    });
    const actions = Array.isArray(rows) ? rows.map(rowFromAction) : [];
    // Timeline display: resolve actor ids to names so the audit trail never
    // shows a raw identifier. Role/team literals are already readable. The
    // reassign hand-off parties (#4365) resolve through the same batch.
    const names = await this.resolveUserNames(
      actions
        .flatMap(a => [a.actor_id, a.reassign_from, a.reassign_to])
        .filter(id => id && !id.includes(':')),
    );
    for (const a of actions as any[]) {
      const n = a.actor_id ? names.get(String(a.actor_id)) : undefined;
      if (n) a.actor_name = n;
      const fromName = a.reassign_from ? names.get(String(a.reassign_from)) : undefined;
      if (fromName) a.reassign_from_name = fromName;
      const toName = a.reassign_to ? names.get(String(a.reassign_to)) : undefined;
      if (toName) a.reassign_to_name = toName;
    }
    return actions;
  }

  /**
   * `IFileAccessDelegate` — may this caller download a decision attachment?
   * (ADR-0104 D3 wave 2; declared by `sys_approval_action.fileAccessDelegate`.)
   *
   * A file referenced by `sys_approval_action.attachments` is owned by that
   * audit row, so the storage service would otherwise authorize the download by
   * testing whether the caller can READ the row. It cannot: `sys_approval_action`
   * is deliberately closed to ordinary approver positions, so that test denies
   * the very approver the attachment was filed for.
   *
   * The rule that actually governs seeing a decision is the one `listActions`
   * applies — can the caller see the PARENT REQUEST? — so this reuses it
   * exactly, rather than inventing a second, looser rule for the bytes. Fails
   * closed on any error.
   */
  async authorizeFileRead(actionId: string, context: ExecutionContext): Promise<boolean> {
    if (!actionId) return false;
    try {
      const rows = await this.engine.find('sys_approval_action', {
        where: { id: actionId },
        limit: 1,
        context: SYSTEM_CTX,
      });
      const requestId = (Array.isArray(rows) ? rows[0] : undefined)?.request_id;
      if (!requestId) return false;
      // Same gate as listActions: visibility of the decision's parent request.
      return !!(await this.getRequest(String(requestId), context));
    } catch {
      return false;
    }
  }
}
