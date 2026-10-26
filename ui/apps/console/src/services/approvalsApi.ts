/**
 * Approvals REST helper.
 *
 * Thin fetch wrapper around the framework's approval endpoints
 * (`/api/v1/approvals/*`). Auth mirrors the rest of the console: the stored
 * Bearer token when present, plus cookies. Cookie-only auth silently lost
 * the approvals surface on split-origin deployments (custom-domain console ↔
 * API, or a dev console pointed at a remote backend) where the SameSite
 * cookie never flows — every other console call already sends the Bearer.
 *
 * Mirrors the shape exposed by `@objectstack/plugin-approvals` /
 * `packages/rest/src/rest-server.ts`.
 */
import { TokenStorage } from '@object-ui/auth';
import type { ApprovalCancelReason } from '@objectstack/spec/contracts';

const SERVER_URL = (import.meta.env.VITE_SERVER_URL || '').replace(/\/$/, '');
/**
 * The API root every approvals read and write goes to. Exported so the
 * standard-renderer data source (`approvalRequestsDataSource.ts`) reaches the
 * same routes without a second spelling of where they live (objectui#12032).
 */
export const API_BASE = `${SERVER_URL}/api/v1`;

export interface ApprovalProcessRow {
  id: string;
  name: string;
  object_name: string;
  status: 'active' | 'inactive' | string;
  definition: unknown;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ApprovalRequestRow {
  id: string;
  process_name: string;
  object_name: string;
  record_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'recalled' | 'returned' | 'cancelled' | string;
  /**
   * Why the platform voided this request (objectstack#13568). Present only on
   * rows whose `status` is `cancelled`, absent everywhere else — so a value on
   * any other status is a row this console does not understand, never a cause
   * to act on.
   *
   * The union is IMPORTED from `@objectstack/spec` rather than re-spelled here:
   * the contract calls it a reason CLASS whose next platform-initiated cause
   * extends the same list, and a hand-copied union would go stale the day it
   * does. Optional-nullable exactly as the contract declares it — a row written
   * before the column existed reads as "not recorded", never as "cancelled for
   * no reason".
   */
  cancel_reason?: ApprovalCancelReason | null;
  current_step?: string | null;
  current_step_index?: number | null;
  pending_approvers?: string[] | null;
  submitter_id?: string | null;
  submitted_at?: string;
  created_at?: string;
  completed_at?: string | null;
  payload?: Record<string, unknown> | null;
  // Display enrichment, resolved server-side (plugin-approvals).
  /** Human label of the originating flow (e.g. "Project Budget Approval"). */
  process_label?: string;
  /** Human label of the approval step (e.g. "Manager Review"). */
  step_label?: string;
  /** Display name of the target record, when resolvable. */
  record_title?: string;
  /** Display name of the submitter (`sys_user.name`), when resolvable. */
  submitter_name?: string;
  /** Schema label of the target object (e.g. "Project"). */
  object_label?: string;
  /** Display names for user-id entries in `pending_approvers` (id → name). */
  pending_approver_names?: Record<string, string>;
  /**
   * Group membership of each still-pending approver, `per_group` (会签) requests
   * only (objectui#2807): approver id → the group key(s) it fills, e.g.
   * `{ u_devadmin: ['finance', 'legal'] }`. Lets the drawer label each "waiting
   * on" chip with its group. Absent for non-`per_group` behaviors and for slots
   * whose group was unnamed.
   */
  pending_approver_groups?: Record<string, string[]>;
  /** Display values for lookup fields in `payload` (field key → record title). */
  payload_display?: Record<string, string>;
  /** Display labels for `payload` fields (field key → target object's field label). */
  payload_labels?: Record<string, string>;
  /** SLA deadline (`created_at + escalation.timeoutHours`), display-only. */
  sla_due_at?: string;
  /** Owning flow's approval steps for progress display (single reads only). */
  flow_steps?: Array<{ id: string; label: string; state: 'done' | 'current' | 'upcoming' }>;
  /**
   * Server-computed aggregation progress (#3266) for pending multi-approver
   * requests: unanimous/quorum = approvals got/need; per_group = satisfied
   * groups got/need plus per-group detail. Absent for first_response.
   */
  decision_progress?: {
    behavior: 'unanimous' | 'quorum' | 'per_group';
    got: number;
    need: number;
    groups?: Array<{ group: string; got: number; need: number; satisfied: boolean }>;
  };
  /**
   * Server-computed capability for the current viewer (framework#3310), attached
   * by getRequest/listRequests. Declared decision actions gate their `visible`
   * CEL on it — approver actions on `viewer.can_act`, submitter levers on
   * `viewer.is_submitter` — so the drawer never offers a decision the caller
   * can't make. Absent on rows not read through the approvals service.
   */
  viewer?: {
    /** The caller is a current pending approver (mirrors the service's authz). */
    can_act: boolean;
    /** The caller submitted this request. */
    is_submitter: boolean;
    /**
     * framework#3424 — the caller is a platform/tenant admin who may OVERRIDE a
     * stuck pending request (approve / reject / reassign it) despite holding no
     * approver slot: the recovery path for an approval routed to an unstaffed
     * position, which would otherwise lock the record forever. Optional so a
     * response from an older backend (no `can_override`) reads as `false`.
     */
    can_override?: boolean;
  };
  /** ADR-0044 revision round on this (run, node): absent/1 = first round. */
  round?: number;
  /**
   * framework#3447 — the node's author-declared decision-output keys
   * (`config.decisionOutputs`). DeclaredActionsBar synthesizes one input per
   * key on the approve/reject dialogs (`outputs.<key>` params, folded into a
   * nested `outputs` body by the api handler); the flow receives them as
   * `<nodeId>.<key>` variables. Absent when the node declares none.
   */
  decision_outputs?: string[];
  /**
   * framework#3447 follow-up: the normalized TYPED declarations behind
   * `decision_outputs` — `{ key, label?, type?, multiple? }` — so the decide
   * dialog renders a picker instead of free text: user / department / team
   * pick records and commit ids, position lists the position registry and
   * commits machine names (objectui#7611); `multiple` → an array of them.
   * Prefer this and fall back to the bare key list (older backend).
   */
  decision_output_defs?: Array<{
    key: string;
    label?: string;
    type?: 'text' | 'user' | 'department' | 'position' | 'team';
    multiple?: boolean;
  }>;
}

/**
 * A file attached to a decision action (#3266). The server resolves the
 * `sys_approval_action.attachments` file field into rich descriptors, so the
 * chip has the display name + download URL without any `sys_file` lookup.
 */
export interface ApprovalActionAttachment {
  id: string;
  name?: string;
  /** Stable download URL (`/api/v1/storage/files/:id`); may be server-relative. */
  url?: string;
  mimeType?: string;
  size?: number;
}

export interface ApprovalActionRow {
  id: string;
  request_id: string;
  step_index?: number | null;
  step_name?: string | null;
  actor_id?: string | null;
  action: 'submit' | 'approve' | 'reject' | 'recall' | string;
  comment?: string | null;
  /** Files attached to this action (decision attachments, #3266). */
  attachments?: ApprovalActionAttachment[] | null;
  created_at?: string;
  /** Display name of the actor, resolved server-side. */
  actor_name?: string;
  /**
   * Whether the actor was admitted to this action ONLY by the privileged
   * admin-override path (framework#3424) — they held no slot in the request's
   * pending-approver slate (framework#4466). Declared here so the Approval
   * Center's timeline can SAY so; before objectui#5178 the column was written
   * by the server, sent on the wire, and read by nothing.
   *
   * Tri-state, mirroring the column: `true` = override, `false` = checked and
   * NOT an override, `undefined` = a row written before the column existed.
   */
  via_override?: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const token = TokenStorage.get();
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers || {}),
    },
    ...init,
  });
  let payload: any = null;
  try { payload = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    const code = payload?.code ?? `HTTP_${res.status}`;
    const msg = payload?.message ?? payload?.error ?? res.statusText;
    const err = new Error(`${code}: ${msg}`) as Error & { code?: string; status?: number; details?: unknown };
    err.code = code;
    err.status = res.status;
    err.details = payload;
    throw err;
  }
  return payload as T;
}

export const approvalsApi = {
  listProcesses(params: { object?: string; activeOnly?: boolean } = {}) {
    const qs = new URLSearchParams();
    if (params.object) qs.set('object', params.object);
    if (params.activeOnly) qs.set('activeOnly', 'true');
    const q = qs.toString();
    return call<{ data: ApprovalProcessRow[] }>(`/approvals/processes${q ? `?${q}` : ''}`);
  },

  listRequests(params: {
    status?: string;
    object?: string;
    recordId?: string;
    /**
     * One identity or a list. The server matches a request when ANY identity
     * is a pending approver, so the caller resolves "my pending approvals"
     * in a single request (comma-separated) instead of one per identity.
     */
    approverId?: string | string[];
    submitterId?: string;
    /** Free-text search, matched server-side (incl. record titles via the payload snapshot). */
    q?: string;
    /** Page window; when `limit` is set the response carries `total`. */
    limit?: number;
    offset?: number;
  } = {}) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.object) qs.set('object', params.object);
    if (params.recordId) qs.set('recordId', params.recordId);
    const approver = Array.isArray(params.approverId)
      ? params.approverId.filter(Boolean).join(',')
      : params.approverId;
    if (approver) qs.set('approverId', approver);
    if (params.submitterId) qs.set('submitterId', params.submitterId);
    if (params.q?.trim()) qs.set('q', params.q.trim());
    if (params.limit != null) qs.set('limit', String(params.limit));
    if (params.offset != null) qs.set('offset', String(params.offset));
    const q = qs.toString();
    return call<{ data: ApprovalRequestRow[]; total?: number }>(`/approvals/requests${q ? `?${q}` : ''}`);
  },

  async getRequest(id: string) {
    // Server returns the row directly (not `{data: row}`). Normalize.
    const row = await call<ApprovalRequestRow>(`/approvals/requests/${encodeURIComponent(id)}`);
    return { data: row };
  },

  listActions(requestId: string) {
    return call<{ data: ApprovalActionRow[] }>(
      `/approvals/requests/${encodeURIComponent(requestId)}/actions`,
    );
  },

  async approve(id: string, body: { actorId?: string; actor_id?: string; comment?: string; attachments?: string[] }) {
    // Server returns `{request, finalized}`. Normalize to `{data, finalized}`.
    const out = await call<{ request: ApprovalRequestRow; finalized: boolean }>(
      `/approvals/requests/${encodeURIComponent(id)}/approve`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request, finalized: out.finalized };
  },

  async reject(id: string, body: { actorId?: string; actor_id?: string; comment?: string; attachments?: string[] }) {
    const out = await call<{ request: ApprovalRequestRow; finalized: boolean }>(
      `/approvals/requests/${encodeURIComponent(id)}/reject`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request, finalized: out.finalized };
  },

  async recall(id: string, body: { actorId?: string; actor_id?: string; comment?: string }) {
    // Server returns `{request, runId, resumed}` — a recall always finalizes.
    const out = await call<{ request: ApprovalRequestRow; resumed?: boolean }>(
      `/approvals/requests/${encodeURIComponent(id)}/recall`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request, finalized: true };
  },

  /** Hand a pending-approver slot to someone else (server: slot holder only). */
  async reassign(id: string, body: { actor_id?: string; to: string; comment?: string }) {
    const out = await call<{ request: ApprovalRequestRow }>(
      `/approvals/requests/${encodeURIComponent(id)}/reassign`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request };
  },

  /** Submitter nudge — notifies pending approvers (throttled server-side). */
  async remind(id: string, body: { actor_id?: string; comment?: string } = {}) {
    const out = await call<{ request: ApprovalRequestRow; notified: number }>(
      `/approvals/requests/${encodeURIComponent(id)}/remind`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request, notified: out.notified };
  },

  /** Approver asks the submitter for more info; the request stays pending. */
  async requestInfo(id: string, body: { actor_id?: string; comment: string }) {
    const out = await call<{ request: ApprovalRequestRow }>(
      `/approvals/requests/${encodeURIComponent(id)}/request-info`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request };
  },

  /**
   * Send back for revision (ADR-0044): the request finalizes `returned`, the
   * record unlocks, and the flow parks at a wait point until the submitter
   * resubmits. Past the node's `maxRevisions` budget the server auto-rejects
   * (`autoRejected: true`).
   */
  async sendBack(id: string, body: { actor_id?: string; comment?: string }) {
    const out = await call<{ request: ApprovalRequestRow; resumed?: boolean; autoRejected?: boolean }>(
      `/approvals/requests/${encodeURIComponent(id)}/revise`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request, autoRejected: out.autoRejected === true };
  },

  /**
   * Resubmit a returned request after rework (ADR-0044, submitter only): the
   * flow re-enters the approval node and opens the next round's request.
   */
  async resubmit(id: string, body: { actor_id?: string; comment?: string } = {}) {
    const out = await call<{ request: ApprovalRequestRow; resumed?: boolean }>(
      `/approvals/requests/${encodeURIComponent(id)}/resubmit`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request, resumed: out.resumed === true };
  },

  /** Free-form reply on the request thread (submitter or pending approver). */
  async comment(id: string, body: { actor_id?: string; comment: string; attachments?: string[] }) {
    const out = await call<{ request: ApprovalRequestRow }>(
      `/approvals/requests/${encodeURIComponent(id)}/comment`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    return { data: out.request };
  },

  async submit(body: {
    object: string;
    recordId: string;
    processName?: string;
    submitterId?: string;
    comment?: string;
    payload?: Record<string, unknown>;
  }) {
    return call<ApprovalRequestRow>(`/approvals/requests`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};

/**
 * Build the list of approver identifiers that should match the
 * signed-in user. Used to filter "My Pending", to decide whether
 * Approve/Reject buttons are enabled, and to pick the `actor_id` a decision
 * names — so every entry must be spelled the way the server STORES the slot.
 *
 * A position is `position:<p>`: a slot routed to a position nobody held when
 * the request opened keeps that literal (plugin-approvals'
 * `resolveApproverSpec` `type:value` fallback), and the server's
 * `approver-address.ts` names `position:` the canonical prefix. `role:<p>` is
 * the framework ADR-0090 D3 deprecated spelling, kept on the server only for
 * 15.x-era slots; an approve that names `role:<p>` on a `position:<p>` slot is
 * refused (objectui#11455). ⛔ No `role:<p>` is emitted for a position as a
 * fallback — the same rule `sharedUserFeeds.approverIdentities` follows.
 */
export function buildApproverIdentities(user: {
  id?: string;
  email?: string;
  /**
   * The session's assigned positions — the one published spelling for the
   * multi-value shape (spec `AuthUser.positions`).
   *
   * This was `roles?: string[]` until objectui#5424, described as the
   * "multi-role shape (some auth providers)", which is no longer the
   * distinction that matters: framework ADR-0090 D3 renamed `roles` →
   * `positions` with no deprecation window and the protocol-17 session face
   * emits no `roles` key at all. The old read therefore contributed nothing
   * and only the scalar below survived — so this builder still yielded
   * `role:user` while losing every business position name (`manager`,
   * `finance_approver`, …), which is what a role-addressed approval is
   * actually addressed to.
   *
   * Deliberately NOT paired with a `roles` fallback: reviving the retired
   * spelling as an alias is what ADR-0090 D3 forbids, and
   * `packages/auth/src/types.ts` says so on the declaration itself.
   */
  positions?: string[];
  /**
   * Single-role shape — better-auth sessions carry `role` as one string
   * (possibly comma-separated for multiple roles). Still emitted at protocol
   * 17 alongside `positions` (the measured payload carries both), so it stays
   * as a second identity source; it is not what objectui#5424 is about.
   *
   * It is NOT a position, which is why it keeps its own `role:<r>` spelling
   * rather than following `positions` to `position:` (objectui#11455): the
   * server's session payload states that the better-auth `user.role` scalar is
   * not a source of `positions[]` (plugin-auth's `customSession`), so naming
   * it `position:<r>` would claim a position the session never reported.
   */
  role?: string;
} | null | undefined): string[] {
  if (!user) return [];
  const ids = new Set<string>();
  if (user.id) ids.add(user.id);
  if (user.email) ids.add(user.email);
  for (const position of user.positions || []) {
    const p = String(position).trim();
    if (p) ids.add(`position:${p}`);
  }
  for (const role of typeof user.role === 'string' ? user.role.split(',') : []) {
    const r = role.trim();
    if (r) ids.add(`role:${r}`);
  }
  return Array.from(ids);
}
