// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { createHash, randomBytes } from 'node:crypto';
import {
  APPROVAL_BRANCH_LABELS,
  canonicalApproverType,
  type ApprovalNodeConfig,
} from '@objectstack/spec/automation';
import {
  ADMIN_FULL_ACCESS,
  ORGANIZATION_ADMIN,
  BUILTIN_IDENTITY_PLATFORM_ADMIN,
  BUILTIN_IDENTITY_ORG_OWNER,
  BUILTIN_IDENTITY_ORG_ADMIN,
} from '@objectstack/spec/identity';
import type {
  IApprovalService,
  ApprovalRequestRow,
  ApprovalActionRow,
  ApprovalDecisionInput,
  ApprovalDecisionResult,
  ApprovalRecallInput,
  ApprovalRecallResult,
  ApprovalSendBackInput,
  ApprovalSendBackResult,
  ApprovalResubmitInput,
  ApprovalResubmitResult,
  ApprovalStatus,
  SharingExecutionContext,
} from '@objectstack/spec/contracts';
import { isGrantActive } from '@objectstack/core';

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
  resume?(runId: string, signal?: { output?: Record<string, unknown>; branchLabel?: string }): Promise<unknown>;
  /** Flow definition lookup, used to derive step-progress display data. */
  getFlow?(name: string): Promise<any | null>;
  /**
   * Terminally cancel a suspended run (ADR-0044). Used when a recall lands
   * during a revision window — the run is paused at the revise wait node,
   * which has no reject edge to resume down.
   */
  cancelRun?(runId: string, reason?: string): Promise<unknown>;
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

/** Default lifetime of an actionable-link token (ADR-0043). */
export const ACTION_TOKEN_TTL_MS = 72 * 60 * 60 * 1000;

/** Outcome of redeeming (or peeking) an actionable-link token. */
export type ActionTokenOutcome =
  | { ok: true; action: 'approve' | 'reject'; request: ApprovalRequestRow; approverId: string }
  | { ok: false; reason: 'invalid' | 'expired' | 'consumed' | 'not_pending' | 'not_approver'; request?: ApprovalRequestRow };

const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] } as const;

/**
 * Max hops when following an OOO delegation chain (#1322 M1): A out → B, B out
 * → C, … Bounds the walk so a mis-configured chain can't loop or resolve
 * unboundedly; a cycle or self-reference also stops it early.
 */
const OOO_MAX_CHAIN = 8;

/** One OOO delegation hop applied while resolving an approver (#1322 M1/M4). */
interface OooSubstitution {
  /** The approver who was skipped (out of office). */
  from: string;
  /** The delegate the slot was routed to. */
  to: string;
  /** The delegator's declared reason, if any. */
  reason: string | null;
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

function rowFromAction(row: any): ApprovalActionRow {
  return {
    id: String(row.id),
    request_id: String(row.request_id),
    step_name: row.step_name ?? undefined,
    step_index: row.step_index ?? undefined,
    action: row.action,
    actor_id: row.actor_id ?? undefined,
    comment: row.comment ?? undefined,
    // Decision attachments (#3266). The column shipped in #3268 but this
    // contract mapping didn't — the raw engine row carried the fileIds while
    // every consumer of listActions saw none (caught by browser verification).
    attachments: Array.isArray(row.attachments) && row.attachments.length ? row.attachments.map(String) : undefined,
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
}

export class ApprovalService implements IApprovalService {
  private readonly engine: ApprovalEngine;
  private readonly clock: ApprovalClock;
  private readonly logger?: ApprovalServiceOptions['logger'];
  private automation?: ApprovalResumeSurface;
  private messaging?: ApprovalMessagingSurface;
  private publicBaseUrl: string;

  constructor(opts: ApprovalServiceOptions) {
    this.engine = opts.engine;
    this.clock = opts.clock ?? { now: () => new Date() };
    this.logger = opts.logger;
    this.automation = opts.automation;
    this.messaging = opts.messaging;
    this.publicBaseUrl = (opts.publicBaseUrl ?? '').replace(/\/$/, '');
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
  private isOverrideActor(context: SharingExecutionContext, requestOrg?: string | null): boolean {
    if (!context) return false;
    if (context.isSystem) return true;
    const perms = Array.isArray(context.permissions) ? context.permissions : [];
    const positions = Array.isArray(context.positions) ? context.positions : [];
    const posture = (context as any).posture;
    const isPlatformAdmin = posture === 'PLATFORM_ADMIN'
      || perms.includes(ADMIN_FULL_ACCESS)
      || positions.includes(BUILTIN_IDENTITY_PLATFORM_ADMIN);
    if (isPlatformAdmin) return true;
    const isTenantAdmin = posture === 'TENANT_ADMIN'
      || perms.includes(ORGANIZATION_ADMIN)
      || positions.includes(BUILTIN_IDENTITY_ORG_OWNER)
      || positions.includes(BUILTIN_IDENTITY_ORG_ADMIN);
    if (!isTenantAdmin) return false;
    // A tenant admin's authority stops at their own org; a null-org request is
    // global and any admin may release it.
    const actorTenant = (context as any).tenantId ?? (context as any).organizationId ?? null;
    return requestOrg == null || (actorTenant != null && String(requestOrg) === String(actorTenant));
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
    opts?: { now?: number; substitutions?: OooSubstitution[]; groups?: Record<string, string[]> },
  ): Promise<string[]> {
    if (!step || !Array.isArray(step.approvers)) return [];
    const now = opts?.now ?? this.clock.now().getTime();
    const out: string[] = [];
    const specs: any[] = step.approvers;
    for (let idx = 0; idx < specs.length; idx++) {
      const a = specs[idx];
      if (!a) continue;
      const ids = await this.resolveApproverSpec(a, record, organizationId, now, opts?.substitutions);
      // per_group (#3266): tag each resolved id with this spec's group. An
      // approver without an explicit `group` forms its own group keyed by
      // position, so a plain per-approver list still behaves predictably.
      const groupKey = a.group != null && String(a.group) !== '' ? String(a.group) : `#${idx}`;
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
    if (type === 'user') {
      return this.applyOooDelegation(String(a.value), now, organizationId, substitutions);
    }
    if (type === 'field' && record) {
      return this.applyOooDelegation(String((record as any)[a.value] ?? ''), now, organizationId, substitutions);
    }
    try {
      if (type === 'team') {
        const users = await this.expandTeamUsers(String(a.value));
        if (users.length) return users;
      } else if (type === 'department' || type === 'business_unit' || type === 'bu') {
        const users = await this.expandBusinessUnitUsers(String(a.value), organizationId);
        if (users.length) return users;
      } else if (type === 'position') {
        const users = await this.expandPositionUsers(String(a.value), organizationId);
        if (users.length) return users;
      } else if (type === 'org_membership_level') {
        const users = await this.expandMembershipTierUsers(String(a.value), organizationId);
        if (users.length) return users;
      } else if (type === 'manager' && record) {
        const subject = (record as any)[a.value] ?? (record as any).owner_id;
        if (subject) {
          const mgr = await this.lookupManager(String(subject));
          if (mgr) return this.applyOooDelegation(mgr, now, organizationId, substitutions);
        }
      }
    } catch { /* fall through */ }
    return [`${a.type}:${a.value}`];
  }

  /** Flat team — `sys_team` is better-auth's collaboration grouping (no hierarchy). */
  private async expandTeamUsers(teamId: string): Promise<string[]> {
    if (!teamId) return [];
    let rows: any[] = [];
    try {
      rows = await this.engine.find('sys_team_member', {
        filter: { team_id: teamId },
        fields: ['user_id'],
        limit: 10000,
        context: SYSTEM_CTX,
      } as any);
    } catch { rows = []; }
    return Array.from(new Set((rows ?? []).map((r: any) => String(r.user_id ?? '')).filter(Boolean)));
  }

  /** Recursive department — walks `sys_business_unit.parent_business_unit_id`. */
  private async expandBusinessUnitUsers(businessUnitId: string, organizationId?: string | null): Promise<string[]> {
    if (!businessUnitId) return [];
    // Seed sanity check: skip if dept doesn't exist or is inactive within tenant.
    try {
      const seed = await this.engine.find('sys_business_unit', {
        filter: organizationId
          ? { id: businessUnitId, organization_id: organizationId }
          : { id: businessUnitId },
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
        const filter: any = { parent_business_unit_id: parent, active: { $ne: false } };
        if (organizationId) filter.organization_id = organizationId;
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
        filter: { business_unit_id: { $in: Array.from(seen) } },
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
   * transition source — the same semantics as `PositionGraphService` in
   * `plugin-sharing`, so an approval routes to exactly the users the sharing
   * engine would expand for the same position.
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

  private async lookupManager(userId: string): Promise<string | null> {
    try {
      const rows = await this.engine.find('sys_user', {
        filter: { id: userId }, fields: ['id', 'manager_id'], limit: 1, context: SYSTEM_CTX,
      } as any);
      const row: any = Array.isArray(rows) ? rows[0] : null;
      return row?.manager_id ? String(row.manager_id) : null;
    } catch { return null; }
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
        filter: { delegator_id: delegatorId },
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

  /** Mirror a request status onto a business-object field, if configured. */
  private async mirrorStatusField(object: string, recordId: string, field: string, status: string): Promise<void> {
    try {
      await this.engine.update(object, { id: recordId, [field]: status }, { context: SYSTEM_CTX });
    } catch (err: any) {
      this.logger?.warn?.(`[approvals] mirrorStatusField failed: ${err?.message ?? err}`);
    }
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
    },
    context: SharingExecutionContext,
  ): Promise<ApprovalRequestRow> {
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

    const ctxOrg = (context as any)?.organizationId ?? (context as any)?.tenantId ?? input.organizationId ?? null;
    const nowDate = this.clock.now();
    // OOO auto-skip (#1322 M1): reroute individually-routed approvers who are
    // out of office. Collected hops drive the audit + notification below (M4).
    const substitutions: OooSubstitution[] = [];
    // Group membership per resolved approver (#3266) — snapshotted so quorum /
    // per_group finalization is decided against the slate resolved at OPEN time
    // (OOO-substituted), not re-resolved live at each decision.
    const groups: Record<string, string[]> = {};
    const approvers = await this.expandApprovers(
      { approvers: input.config.approvers }, input.record, ctxOrg, { now: nowDate.getTime(), substitutions, groups },
    );

    // #3424: an approval routed to a target with no holders (e.g. an unstaffed
    // `position`) resolves to only unresolvable `type:value` literals — no
    // concrete user can act. The request is still opened (a privileged admin can
    // override it, and legacy 15.x literal slots stay queryable), but warn
    // loudly so the misconfiguration surfaces instead of silently locking the
    // record with no obvious cause.
    if (!approvers.some(a => a && !a.includes(':'))) {
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
    // Snapshot the resolved approver→group map for quorum/per_group tallying.
    if (input.config.behavior === 'quorum' || input.config.behavior === 'per_group') {
      configSnapshot.__approverGroups = groups;
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
      await this.mirrorStatusField(input.object, input.recordId, input.config.approvalStatusField, 'pending');
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
    input: { decision: 'approve' | 'reject'; actorId: string; comment?: string; attachments?: string[] },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow; runId: string | null; nodeId: string | null; finalized: boolean; decision: 'approve' | 'reject' }> {
    if (!requestId) throw new Error('VALIDATION_FAILED: requestId is required');
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
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
    const isSlotHolder = pendingApprovers.includes(input.actorId);
    if (!isSlotHolder && !isOverride) {
      throw new Error(`FORBIDDEN: actor '${input.actorId}' is not a pending approver`);
    }

    const config = parseJson<ApprovalNodeConfig>(raw.node_config_json, { approvers: [], behavior: 'first_response' } as any);
    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const runId: string | null = raw.flow_run_id ?? null;
    const now = this.clock.now().toISOString();

    // Audit the decision first so the quorum/per_group tally below sees it.
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: org,
      step_name: nodeId, step_index: 0, action: input.decision,
      actor_id: input.actorId, comment: input.comment ?? null,
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

      // quorum / per_group tally against the OPEN-time snapshot (already
      // OOO-substituted). unanimous re-resolves for back-compat with requests
      // opened before the snapshot existed.
      const snapshotGroups = (config as any).__approverGroups as Record<string, string[]> | undefined;
      let original: string[];
      let groupMap: Record<string, string[]>;
      if (snapshotGroups && (behavior === 'quorum' || behavior === 'per_group')) {
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
        }, { context: SYSTEM_CTX });
        await this.syncApproverIndex(requestId, stillPending, org, now);
        const fresh = await this.getRequest(requestId, context);
        return { request: fresh!, runId, nodeId, finalized: false, decision: input.decision };
      }
    }

    const finalStatus = input.decision === 'approve' ? 'approved' : 'rejected';
    await this.engine.update('sys_approval_request', {
      id: requestId, status: finalStatus, pending_approvers: null, completed_at: now, updated_at: now,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, [], org, now);
    if (config.approvalStatusField) {
      await this.mirrorStatusField(raw.object_name, raw.record_id, config.approvalStatusField, finalStatus);
    }
    const fresh = await this.getRequest(requestId, context);
    return { request: fresh!, runId, nodeId, finalized: true, decision: input.decision };
  }

  /**
   * Public contract entrypoint (ADR-0019). Records a decision on a node-driven
   * request via {@link ApprovalService.decideNode} and, when it finalizes,
   * resumes the owning flow run down the matching `approve` / `reject` edge.
   */
  async decide(
    requestId: string,
    input: ApprovalDecisionInput,
    context: SharingExecutionContext,
  ): Promise<ApprovalDecisionResult> {
    const result = await this.decideNode(requestId, input, context);

    let resumed = false;
    if (result.finalized && result.runId && typeof this.automation?.resume === 'function') {
      const branchLabel = result.decision === 'approve'
        ? APPROVAL_BRANCH_LABELS.approve
        : APPROVAL_BRANCH_LABELS.reject;
      try {
        await this.automation.resume(result.runId, {
          branchLabel,
          output: { decision: result.decision, requestId },
        });
        resumed = true;
      } catch (err: any) {
        this.logger?.warn?.('[approvals] resume after decision failed', {
          request: requestId, run: result.runId, error: err?.message ?? String(err),
        });
      }
    }

    return {
      request: result.request,
      finalized: result.finalized,
      decision: result.decision,
      runId: result.runId,
      resumed,
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
   * is then paused at the revise wait node (no reject edge), so it is
   * terminally cancelled via {@link ApprovalResumeSurface.cancelRun} rather
   * than resumed.
   */
  async recall(
    requestId: string,
    input: ApprovalRecallInput,
    context: SharingExecutionContext,
  ): Promise<ApprovalRecallResult> {
    if (!requestId) throw new Error('VALIDATION_FAILED: requestId is required');
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');

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
      && raw.submitter_id && String(raw.submitter_id) !== String(input.actorId)) {
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
      actor_id: input.actorId, comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });

    await this.engine.update('sys_approval_request', {
      id: requestId, status: 'recalled', pending_approvers: null, completed_at: now, updated_at: now,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, [], org, now);
    if (config.approvalStatusField) {
      await this.mirrorStatusField(raw.object_name, raw.record_id, config.approvalStatusField, 'recalled');
    }

    let resumed = false;
    if (inReviseWindow) {
      // ADR-0044: the run is paused at the revise wait node, which has no
      // reject out-edge to resume down — terminally cancel it instead.
      if (runId && typeof this.automation?.cancelRun === 'function') {
        try {
          await this.automation.cancelRun(runId, `approval request ${requestId} recalled during revision`);
        } catch (err: any) {
          this.logger?.warn?.('[approvals] cancelRun after revise-window recall failed', {
            request: requestId, run: runId, error: err?.message ?? String(err),
          });
        }
      }
    } else if (runId && typeof this.automation?.resume === 'function') {
      try {
        await this.automation.resume(runId, {
          branchLabel: APPROVAL_BRANCH_LABELS.reject,
          output: { decision: 'recall', requestId },
        });
        resumed = true;
      } catch (err: any) {
        this.logger?.warn?.('[approvals] resume after recall failed', {
          request: requestId, run: runId, error: err?.message ?? String(err),
        });
      }
    }

    const fresh = await this.getRequest(requestId, context);
    return { request: fresh!, runId, resumed };
  }

  // ── Send back for revision / resubmit (ADR-0044) ─────────────

  /**
   * ADR-0044 send back for revision. Finalises the pending request as
   * `returned` (a third terminal state — approver-initiated rework, distinct
   * from submitter-initiated `recalled`) and resumes the owning flow run down
   * its `revise` edge to a wait point: the record lock (keyed on `pending`)
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
    context: SharingExecutionContext,
  ): Promise<ApprovalSendBackResult> {
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    if (!context.isSystem && !pending.includes(input.actorId)) {
      throw new Error(`FORBIDDEN: actor '${input.actorId}' is not a pending approver`);
    }

    const config = parseJson<ApprovalNodeConfig>(raw.node_config_json, { approvers: [], behavior: 'first_response' } as any);
    const org = raw.organization_id ?? null;
    const nodeId: string | null = raw.flow_node_id ?? raw.current_step ?? null;
    const runId: string | null = raw.flow_run_id ?? null;

    await this.assertReviseEdge(raw, nodeId);

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
      actor_id: input.actorId, comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });

    if (priorSendBacks >= maxRevisions) {
      // Revision budget exhausted — auto-reject (ADR-0044 loop guard).
      await this.engine.insert('sys_approval_action', {
        id: uid('aact'), request_id: requestId, organization_id: org,
        step_name: nodeId, step_index: 0, action: 'reject',
        actor_id: input.actorId,
        comment: `Auto-rejected: revision limit (${maxRevisions}) exceeded`, created_at: now,
      }, { context: SYSTEM_CTX });
      await this.engine.update('sys_approval_request', {
        id: requestId, status: 'rejected', pending_approvers: null, completed_at: now, updated_at: now,
      }, { context: SYSTEM_CTX });
      await this.syncApproverIndex(requestId, [], org, now);
      if (config.approvalStatusField) {
        await this.mirrorStatusField(raw.object_name, raw.record_id, config.approvalStatusField, 'rejected');
      }
      let resumed = false;
      if (runId && typeof this.automation?.resume === 'function') {
        try {
          await this.automation.resume(runId, {
            branchLabel: APPROVAL_BRANCH_LABELS.reject,
            output: { decision: 'reject', autoRejected: true, requestId },
          });
          resumed = true;
        } catch (err: any) {
          this.logger?.warn?.('[approvals] resume after auto-reject failed', {
            request: requestId, run: runId, error: err?.message ?? String(err),
          });
        }
      }
      if (raw.submitter_id) {
        await this.notify({
          topic: 'approval.returned',
          audience: [String(raw.submitter_id)],
          actorId: input.actorId,
          source: { object: 'sys_approval_request', id: requestId },
          payload: {
            title: 'Approval auto-rejected',
            message: `Your ${raw.object_name}/${raw.record_id} exceeded the revision limit (${maxRevisions}) and was rejected.`,
            actionUrl: '/system/approvals',
          },
        });
      }
      const fresh = await this.getRequest(requestId, context);
      return { request: fresh!, runId, resumed, autoRejected: true };
    }

    await this.engine.update('sys_approval_request', {
      id: requestId, status: 'returned', pending_approvers: null, completed_at: now, updated_at: now,
    }, { context: SYSTEM_CTX });
    await this.syncApproverIndex(requestId, [], org, now);
    if (config.approvalStatusField) {
      await this.mirrorStatusField(raw.object_name, raw.record_id, config.approvalStatusField, 'returned');
    }

    let resumed = false;
    if (runId && typeof this.automation?.resume === 'function') {
      try {
        await this.automation.resume(runId, {
          branchLabel: APPROVAL_BRANCH_LABELS.revise,
          output: { decision: 'revise', requestId },
        });
        resumed = true;
      } catch (err: any) {
        this.logger?.warn?.('[approvals] resume after send-back failed', {
          request: requestId, run: runId, error: err?.message ?? String(err),
        });
      }
    }

    if (raw.submitter_id) {
      await this.notify({
        topic: 'approval.returned',
        audience: [String(raw.submitter_id)],
        actorId: input.actorId,
        source: { object: 'sys_approval_request', id: requestId },
        payload: {
          title: 'Sent back for revision',
          message: input.comment?.trim() || `Your ${raw.object_name}/${raw.record_id} needs rework before it can be approved.`,
          actionUrl: '/system/approvals',
        },
      });
    }

    const fresh = await this.getRequest(requestId, context);
    return { request: fresh!, runId, resumed };
  }

  /**
   * ADR-0044 resubmit after rework. Valid on the LATEST `returned` request of
   * its run, submitter-only. Audits `resubmit` on the returned (round-N)
   * request and resumes the run from the revise wait node; traversal walks
   * the declared back-edge into the approval node, whose executor opens the
   * round-N+1 request — fresh approver slate, record re-locks.
   */
  async resubmit(
    requestId: string,
    input: ApprovalResubmitInput,
    context: SharingExecutionContext,
  ): Promise<ApprovalResubmitResult> {
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
    const rawRows = await this.engine.find('sys_approval_request', {
      where: { id: requestId }, limit: 1, context: SYSTEM_CTX,
    });
    const raw: any = Array.isArray(rawRows) ? rawRows[0] : null;
    if (!raw) throw new Error(`REQUEST_NOT_FOUND: ${requestId}`);
    if (raw.status !== 'returned') {
      throw new Error(`INVALID_STATE: request is ${raw.status} (resubmit applies to returned requests)`);
    }
    if (!context.isSystem && raw.submitter_id && String(raw.submitter_id) !== String(input.actorId)) {
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

    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: org,
      step_name: nodeId, step_index: 0, action: 'resubmit',
      actor_id: input.actorId, comment: input.comment ?? null, created_at: now,
    }, { context: SYSTEM_CTX });

    // The next round only exists if this resume lands — surface `resumed`
    // honestly so a stuck run is visible instead of silently swallowed.
    let resumed = false;
    if (runId && typeof this.automation?.resume === 'function') {
      try {
        await this.automation.resume(runId, {
          branchLabel: APPROVAL_BRANCH_LABELS.resubmit,
          output: { resubmitted: true, requestId },
        });
        resumed = true;
      } catch (err: any) {
        this.logger?.warn?.('[approvals] resume after resubmit failed', {
          request: requestId, run: runId, error: err?.message ?? String(err),
        });
      }
    }

    const fresh = await this.getRequest(requestId, context);
    return { request: fresh!, runId, resumed };
  }

  /**
   * ADR-0044 guard: the flow's approval node must declare a `revise`
   * out-edge before send-back is allowed — the engine's branch-label fallback
   * (no matching label ⇒ ALL out-edges) must never be reachable from a user
   * action.
   */
  private async assertReviseEdge(raw: any, nodeId: string | null): Promise<void> {
    const processName = String(raw.process_name ?? '');
    const flowName = processName.startsWith('flow:') ? processName.slice('flow:'.length) : undefined;
    if (!flowName || !nodeId || typeof this.automation?.getFlow !== 'function') {
      throw new Error('VALIDATION_FAILED: send-back requires the owning flow definition (automation engine unavailable)');
    }
    const flow: any = await this.automation.getFlow(flowName);
    const hasRevise = Array.isArray(flow?.edges)
      && flow.edges.some((e: any) => e?.source === nodeId && e?.label === APPROVAL_BRANCH_LABELS.revise);
    if (!hasRevise) {
      throw new Error(
        `VALIDATION_FAILED: approval node '${nodeId}' has no '${APPROVAL_BRANCH_LABELS.revise}' out-edge — ` +
        'the flow does not support send-back for revision',
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
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }> {
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
    const to = String(input?.to ?? '').trim();
    if (!to) throw new Error('VALIDATION_FAILED: `to` (new approver) is required');
    const raw = await this.loadPendingRow(requestId);

    const pending = csvSplit(raw.pending_approvers);
    if (pending.includes(to)) {
      throw new Error(`VALIDATION_FAILED: '${to}' is already a pending approver`);
    }
    const isOverride = this.isOverrideActor(context, raw.organization_id ?? null);
    const from = String(input.from ?? input.actorId).trim();
    let next: string[];
    if (pending.includes(from)) {
      // Normal hand-off: the actor holds the slot being moved (or is a
      // system/admin caller acting on a real holder's slot).
      if (!context.isSystem && !isOverride && input.actorId !== from && !pending.includes(input.actorId)) {
        throw new Error(`FORBIDDEN: actor '${input.actorId}' is not a pending approver`);
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
      actor_id: input.actorId, comment: input.comment ?? `${from} → ${to}`, created_at: now,
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
      actorId: input.actorId,
      source: { object: 'sys_approval_request', id: requestId },
      dedupKey: `approval-reassign-${requestId}-${to}`,
      payload: {
        title: 'Approval handed to you',
        message: `You are now an approver on ${raw.object_name}/${raw.record_id}.`,
        actionUrl: '/system/approvals',
      },
    });

    const fresh = await this.getRequest(requestId, context);
    return { request: fresh! };
  }

  /**
   * Submitter nudge — notify every pending approver. Throttled to one
   * reminder per {@link REMIND_COOLDOWN_MS} per request.
   */
  async remind(
    requestId: string,
    input: { actorId: string; comment?: string },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow; notified: number }> {
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
    const raw = await this.loadPendingRow(requestId);
    if (!context.isSystem && raw.submitter_id && String(raw.submitter_id) !== String(input.actorId)) {
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
      actor_id: input.actorId, comment: input.comment ?? null, created_at: nowIso,
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
          actorId: input.actorId,
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
        actorId: input.actorId,
        source: { object: 'sys_approval_request', id: requestId },
        dedupKey: `approval-remind-${requestId}-${nowIso}`,
        payload: {
          title: 'Approval reminder',
          message: `A decision on ${raw.object_name}/${raw.record_id} is still waiting on you.`,
          actionUrl: '/system/approvals',
        },
      });
    }

    const fresh = await this.getRequest(requestId, context);
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
    const request = await this.getRequest(token.request_id, SYSTEM_CTX as unknown as SharingExecutionContext);
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
    }, SYSTEM_CTX as unknown as SharingExecutionContext);
    return { ok: true, action: res.token.action, request: out.request, approverId: res.token.approver_id };
  }

  /**
   * Approver asks the submitter for more information. The request stays
   * pending — a thread interaction, not a flow decision.
   */
  async requestInfo(
    requestId: string,
    input: { actorId: string; comment: string },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }> {
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
    if (!input?.comment?.trim()) throw new Error('VALIDATION_FAILED: comment is required');
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    if (!context.isSystem && !pending.includes(input.actorId)) {
      throw new Error(`FORBIDDEN: actor '${input.actorId}' is not a pending approver`);
    }

    const now = this.clock.now().toISOString();
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'request_info',
      actor_id: input.actorId, comment: input.comment.trim(), created_at: now,
    }, { context: SYSTEM_CTX });

    if (raw.submitter_id) {
      await this.notify({
        topic: 'approval.request_info',
        audience: [String(raw.submitter_id)],
        actorId: input.actorId,
        source: { object: 'sys_approval_request', id: requestId },
        payload: {
          title: 'More information requested',
          message: input.comment.trim(),
          actionUrl: '/system/approvals',
        },
      });
    }

    const fresh = await this.getRequest(requestId, context);
    return { request: fresh! };
  }

  /** Free-form reply on the thread (submitter or any pending approver). */
  async comment(
    requestId: string,
    input: { actorId: string; comment: string; attachments?: string[] },
    context: SharingExecutionContext,
  ): Promise<{ request: ApprovalRequestRow }> {
    if (!input?.actorId) throw new Error('VALIDATION_FAILED: actorId is required');
    if (!input?.comment?.trim()) throw new Error('VALIDATION_FAILED: comment is required');
    const raw = await this.loadPendingRow(requestId);
    const pending = csvSplit(raw.pending_approvers);
    const isSubmitter = raw.submitter_id && String(raw.submitter_id) === String(input.actorId);
    if (!context.isSystem && !isSubmitter && !pending.includes(input.actorId)) {
      throw new Error(`FORBIDDEN: actor '${input.actorId}' is not on this request`);
    }

    const now = this.clock.now().toISOString();
    await this.engine.insert('sys_approval_action', {
      id: uid('aact'), request_id: requestId, organization_id: raw.organization_id ?? null,
      step_name: raw.flow_node_id ?? raw.current_step ?? null, step_index: 0, action: 'comment',
      actor_id: input.actorId, comment: input.comment.trim(),
      attachments: input.attachments?.length ? input.attachments : null,
      created_at: now,
    }, { context: SYSTEM_CTX });

    // Notify the other side of the thread.
    const audience = isSubmitter ? pending : [String(raw.submitter_id ?? '')].filter(Boolean);
    await this.notify({
      topic: 'approval.comment',
      audience,
      actorId: input.actorId,
      source: { object: 'sys_approval_request', id: requestId },
      payload: {
        title: 'New comment on an approval',
        message: input.comment.trim(),
        actionUrl: '/system/approvals',
      },
    });

    const fresh = await this.getRequest(requestId, context);
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
      }, SYSTEM_CTX as unknown as SharingExecutionContext);
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
   * Attach inbox display fields to rows so clients never render a raw
   * identifier: `record_title`, `submitter_name`, `object_label`,
   * `pending_approver_names` (user-id approvers), and `payload_display`
   * (lookup foreign keys in the snapshot → referenced record titles).
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
    for (const object of byObject.keys()) {
      const lookups = this.resolveLookupFields(object);
      if (lookups.length) lookupFieldsByObject.set(object, lookups);
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
    // Desired state: every pending request's CSV entries.
    const desired = new Map<string, { approvers: Set<string>; org: string | null }>();
    const PAGE = 500;
    for (let offset = 0; ; offset += PAGE) {
      const batch = await this.engine.find('sys_approval_request', {
        where: { status: 'pending' },
        fields: ['id', 'pending_approvers', 'organization_id'],
        limit: PAGE, offset, context: SYSTEM_CTX,
      });
      const rows: any[] = Array.isArray(batch) ? batch : [];
      for (const r of rows) {
        desired.set(String(r.id), {
          approvers: new Set(csvSplit(r.pending_approvers)),
          org: r.organization_id ?? null,
        });
      }
      if (rows.length < PAGE) break;
    }

    // Current state: read the whole index first (bounded by the live work
    // queue), THEN mutate — deleting while paginating would shift the cursor.
    const indexRows: any[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const batch = await this.engine.find('sys_approval_approver', {
        orderBy: [{ field: 'created_at', order: 'asc' }],
        limit: PAGE, offset, context: SYSTEM_CTX,
      });
      const rows: any[] = Array.isArray(batch) ? batch : [];
      indexRows.push(...rows);
      if (rows.length < PAGE) break;
    }
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
    context: SharingExecutionContext,
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
    const tenantOrg = (context as any)?.organizationId ?? (context as any)?.tenantId ?? null;
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
    context: SharingExecutionContext,
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
    context: SharingExecutionContext,
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

  async getRequest(requestId: string, context: SharingExecutionContext): Promise<ApprovalRequestRow | null> {
    if (!requestId) return null;
    const where: any = { id: requestId };
    const tenantOrg = (context as any)?.organizationId ?? (context as any)?.tenantId;
    if (tenantOrg) where.organization_id = tenantOrg;
    const rows = await this.engine.find('sys_approval_request', {
      where, limit: 1, context: SYSTEM_CTX,
    });
    if (!Array.isArray(rows) || !rows[0]) return null;
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
  private attachViewers(rows: ApprovalRequestRow[], context: SharingExecutionContext): void {
    const uid = (context as any)?.userId != null ? String((context as any).userId) : null;
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

  async listActions(requestId: string, context: SharingExecutionContext): Promise<ApprovalActionRow[]> {
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
    // shows a raw identifier. Role/team literals are already readable.
    const names = await this.resolveUserNames(
      actions.map(a => a.actor_id).filter(id => id && !id.includes(':')),
    );
    for (const a of actions as any[]) {
      const n = a.actor_id ? names.get(String(a.actor_id)) : undefined;
      if (n) a.actor_name = n;
    }
    return actions;
  }
}
