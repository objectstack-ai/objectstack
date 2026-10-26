/**
 * useRecordApprovals
 *
 * Resolves the approval state for a single record — the READ half only: the
 * status badge, the record lock (`lock_record`), and the request rows the
 * record page's approvals panel renders.
 *
 * Since ADR-0019 an approval is a **flow node** (`type: 'approval'`), not a
 * standalone process: the flow opens the request when it reaches the node,
 * and a decision resumes the run down its `approve` / `reject` edge.
 *
 * ⛔ This hook does NOT decide (objectui#3055). It used to own a second,
 * hand-written decision path — an `approve()` / `reject()` pair plus a
 * CLIENT-side `canDecide` (`pending_approvers.includes(currentUserId)`) — that
 * the record page injected as two hard-coded header buttons. That fork covered
 * two of the nine approval routes: reassign / send-back / request-info had zero
 * entry point on a business record, decision attachments were impossible, and
 * the copy was maintained separately from the approvals list's. Decisions now
 * go through the SAME server-declared `sys_approval_request` actions the
 * approvals list runs (`DeclaredActionsBar`), gated by the server-computed
 * `viewer` block rather than by a second client-side opinion — so a new
 * decision action is metadata, not console code.
 *
 * Talks directly to the framework REST endpoints under
 * `/api/v1/approvals/*`. Fails open: if the approvals route is absent
 * (404 / 501) or the user has no identity, returns inert state so the detail
 * view continues to render normally. A framework composition WITHOUT the
 * approvals service still mounts the list route and answers it
 * `200 { data: [] }`: that is an answered read with no request, not an absent
 * route, and the result's `answered` says which one happened (objectui#12220).
 */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { bearerAuthHeaders } from '../utils/authToken.js';
import type { DecisionOutputDef } from '../utils/decisionOutputParams.js';

export interface ApprovalRequestLite {
  id: string;
  process_name: string;
  object_name: string;
  record_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'recalled' | string;
  submitter_id?: string | null;
  current_step?: string | null;
  pending_approvers?: string[] | null;
  submitted_at?: string;
  completed_at?: string | null;
  /**
   * Whether THIS pending node locks the record from edits (objectui#2902).
   * The approval node's `lockRecord` policy, surfaced by the server from the
   * same `node_config_json` snapshot its record-lock `beforeUpdate` hook reads
   * — so the badge we render and the rule the server applies agree.
   *
   * `undefined` on a pre-framework#3814 backend, which never sent the flag.
   * Callers must fail CLOSED there (treat as locked): offering an edit the
   * server then rejects with `RECORD_LOCKED` is worse than hiding one it would
   * have allowed. See {@link recordLockedByApproval}.
   */
  lock_record?: boolean;
  /**
   * Structured data THIS pending node asks the approver to submit with their
   * decision (framework#3447 P2) — the flow reads it back as
   * `vars.<nodeId>.<key>`, typically to route the next node's approvers.
   *
   * `decision_output_defs` carries the typed declaration (`type` /`multiple`),
   * `decision_outputs` the bare key list a pre-typed backend sends; both are
   * absent on a backend that predates the feature. The record header collects
   * them exactly like the Approval Center does — a decision that silently
   * skipped them left the next node reading a missing key (objectui#2955).
   */
  decision_outputs?: string[] | null;
  decision_output_defs?: DecisionOutputDef[] | null;
  /**
   * Server-computed decision tally of THIS pending node (framework#3266),
   * present only for behaviors that aggregate more than one decision:
   * `unanimous` / `quorum` (`got` / `need` approvals) and `per_group` (satisfied
   * groups, plus `groups[]` detail). `first_response` nodes carry none — one
   * decision finalizes them, so there is nothing to count.
   *
   * The server derives it from the node's own `node_config_json` snapshot
   * (`behavior`, `minApprovals`, the `__approverGroups` slate), so the count
   * the record header shows is the one the engine will enforce. See
   * {@link fetchProgressEnrichment} for why it takes a second request.
   */
  decision_progress?: ApprovalDecisionProgress;
  /**
   * Group membership of each still-pending approver on a `per_group` (会签)
   * node — approver id → the named group(s) the slot fills. Lets a surface that
   * lists pending approvers label each one; absent for other behaviors.
   */
  pending_approver_groups?: Record<string, string[]> | null;
  /** Display names for the ids in `pending_approvers` (id → name). */
  pending_approver_names?: Record<string, string> | null;
  /** Human label of the originating flow (e.g. "Project Budget Approval"). */
  process_label?: string;
  /** Human label of the pending approval step (e.g. "Manager Review"). */
  step_label?: string;
  /** Display name of the submitter (`sys_user.name`), when resolvable. */
  submitter_name?: string;
  /** Owning flow's approval steps for progress display (single reads only). */
  flow_steps?: Array<{ id: string; label: string; state: 'done' | 'current' | 'upcoming' }>;
  /**
   * Server-computed capability of the current viewer (framework#3310), attached
   * by `getRequest`. `is_submitter` gates the record page's remind affordance
   * the same way the Approval Center gates its submitter levers — the server
   * resolved the identity, so the panel never re-derives it client-side.
   */
  viewer?: {
    can_act: boolean;
    is_submitter: boolean;
    can_override?: boolean;
  };
  /** ADR-0044 revision round on this (run, node): absent/1 = first round. */
  round?: number;
}

/**
 * A file attached to a decision action. The server resolves the
 * `sys_approval_action.attachments` file field into rich descriptors, so a
 * consumer has the display name without any `sys_file` lookup; opening one
 * still goes through the signed-URL storage route.
 */
export interface ApprovalActionAttachmentLite {
  id: string;
  name?: string;
  url?: string;
  mimeType?: string;
  size?: number;
}

/**
 * One `sys_approval_action` row — a submit/approve/reject/… event on a
 * request's thread, as `GET /approvals/requests/:id/actions` sends it.
 * The approval timeline the Approval Center draws is made of these; the
 * record page's approval panel reads the same rows (objectui#3461).
 */
export interface ApprovalActionLite {
  id: string;
  request_id: string;
  step_index?: number | null;
  step_name?: string | null;
  actor_id?: string | null;
  /** Display name of the actor, resolved server-side. */
  actor_name?: string;
  action: 'submit' | 'approve' | 'reject' | 'recall' | string;
  comment?: string | null;
  attachments?: ApprovalActionAttachmentLite[] | null;
  created_at?: string;
  /** Structured reassign hand-off parties (framework#4365), reassign rows only. */
  reassign_from?: string;
  reassign_to?: string;
  reassign_from_name?: string;
  reassign_to_name?: string;
  /**
   * Whether the actor was admitted to this action ONLY by the privileged
   * admin-override path (framework#3424) — they held no slot in the request's
   * pending-approver slate (framework#4466).
   *
   * The server has written this since framework#4466 and `rowFromAction` puts
   * it on the wire, but no console surface declared or read it, so every
   * timeline rendered an override byte-for-byte like an ordinary approval —
   * objectui#5178, the unlanded half of framework#4466's own *Expected*.
   *
   * Tri-state, mirroring the column: `true` = override, `false` = checked and
   * NOT an override, `undefined` = a row written before the column existed.
   * Read it through {@link isViaOverrideRow}, which marks only an explicit
   * `true` — "not recorded" is not the same claim as "not an override".
   */
  via_override?: boolean;
}

/**
 * Decision aggregation progress of a pending approval node — the `2 of 3` the
 * approver needs in order to know whether their own decision closes the step.
 * Mirrors the framework's `decision_progress` enrichment verbatim.
 */
export interface ApprovalDecisionProgress {
  behavior: 'unanimous' | 'quorum' | 'per_group';
  /** Approvals recorded — satisfied GROUPS when `behavior` is `per_group`. */
  got: number;
  /** Approvals required — total GROUPS when `behavior` is `per_group`. */
  need: number;
  /** Per-group tally, `per_group` only. */
  groups?: Array<{ group: string; got: number; need: number; satisfied: boolean }>;
}

/**
 * Does an open approval request lock its record from edits?
 *
 * A pending request is NOT the same thing as a locked record: an approval node
 * may declare `lockRecord: false`, and the server then lets the record be
 * edited while that node waits (a single-approver step where the approver is
 * meant to fill in the missing detail is the motivating case). Treating "has a
 * pending request" as "locked" mislabels those nodes and hides an edit the
 * server would have accepted — objectui#2902.
 *
 * Fails closed on both unknowns: no request at all is not a lock, but a request
 * from a backend too old to report the policy is.
 */
export function recordLockedByApproval(request: ApprovalRequestLite | null | undefined): boolean {
  if (!request) return false;
  return request.lock_record !== false;
}

/**
 * Did the current viewer submit this approval request?
 *
 * The submitter's levers — Remind on the approvals panel, Recall on the record
 * band (`830ed5803`) — are the ones the server authorizes on submitter
 * identity and refuses to anyone else. This is the ONE place that answer is
 * derived, so the two surfaces cannot drift into disagreeing about who the
 * submitter is (the identical hazard `utils/approverIdentity` exists for on the
 * display side).
 *
 * Source order, and it matters: the server-resolved `viewer.is_submitter`
 * (framework#3310) wins, because the server already did the resolution the
 * recall endpoint will enforce. The id comparison is the FALLBACK for backends
 * that predate the `viewer` block — `??` and not `||`, so a server that
 * resolved `false` is believed rather than being re-litigated client-side.
 *
 * Returns `undefined` — "unknown", not "no" — when there is no request to
 * consult. A caller feeding a feedback gate must keep its prior behaviour on
 * `undefined` rather than reading it as a denial; a caller that needs a plain
 * boolean coerces explicitly. With a request in hand, an unresolvable viewer is
 * a definite `false`: the authoritative row is present and nothing in it
 * identifies this viewer as the submitter.
 *
 * ⚠️ FEEDBACK ONLY — this decides which affordances are SHOWN, never who MAY
 * act. Every lever it gates is authorized server-side independently.
 */
export function isSubmitterOf(
  request: ApprovalRequestLite | null | undefined,
  currentUserId: string | null | undefined,
): boolean | undefined {
  if (!request) return undefined;
  return (
    request.viewer?.is_submitter
    ?? (!!currentUserId && request.submitter_id === currentUserId)
  );
}

interface UseRecordApprovalsResult {
  loading: boolean;
  /**
   * `false` once the approvals route answered 404 / 501 (no approvals API on
   * this backend). ⚠️ It starts `true` and keeps its last value on any other
   * failure, so `true` does NOT mean a read answered: read {@link answered}
   * for that.
   */
  available: boolean;
  /**
   * Whether the approvals read ANSWERED (a 2xx) for the current
   * object + record (objectui#12220). `false` before the first read lands,
   * after a 404 / 501, when the first read failed any other way, and again
   * while the read for a newly opened record is in flight. Once a read has
   * answered, a later transient failure keeps it `true`, with the last rows.
   *
   * This is the input the record page's approval-lock rule
   * (`resolveApprovalLock` in `@object-ui/react`) keys its fallback on: an
   * answered read with no pending request means no approval is running, and
   * the record's `approval_status` column only stands in while no read has
   * answered.
   */
  answered: boolean;
  /**
   * Every approval request on the record, newest first — one per approval
   * node the flow has reached (and per ADR-0044 revision round), so a
   * multi-level flow accumulates several. The record page's approval panel
   * renders them all (objectui#3461); `pendingRequest` / `latestRequest`
   * remain the derived single-row reads the status badge and the decision
   * bar's record consume.
   */
  requests: ApprovalRequestLite[];
  /**
   * The one still-`pending` request, enriched by `getRequest` — so it carries
   * the server-computed `viewer` block the declared decision actions gate on
   * (objectui#3055) as well as the `decision_progress` tally.
   */
  pendingRequest: ApprovalRequestLite | null;
  latestRequest: ApprovalRequestLite | null;
  refresh: () => Promise<void>;
}

/** Test seam: forget every record's shared approvals state (objectui#12701). */
export function __resetRecordApprovalsStore(): void {
  entries.clear();
  inFlight.clear();
  listeners.clear();
  latestSeq.clear();
}

function apiBase() {
  const url = (import.meta as any).env?.VITE_SERVER_URL || '';
  return `${String(url).replace(/\/$/, '')}/api/v1`;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      // Bearer too — cookie-only auth loses this surface on split-origin
      // deployments where the SameSite cookie doesn't flow (#2548).
      ...bearerAuthHeaders(),
      ...(init?.headers || {}),
    },
    ...init,
  });
  let payload: any = null;
  try { payload = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const err: any = new Error(payload?.error || `HTTP ${res.status}`);
    err.code = payload?.code ?? `HTTP_${res.status}`;
    err.status = res.status;
    throw err;
  }
  return payload as T;
}

/**
 * Pull the pending request's single-read enrichment and fold it onto the row.
 *
 * `decision_progress` (and the `pending_approver_groups` that ride with it) are
 * attached by the framework's `getRequest` ONLY — `listRequests` deliberately
 * skips them, because each one costs a `sys_approval_action` tally per row and
 * a list read may return hundreds. So `GET /approvals/requests?object=…` — the
 * call this hook makes — never carries the quorum data, and the record header
 * had nothing to render even though the node's config had it all along
 * (objectstack#4478: `minApprovals: 2` over a 3-approver slate showed no
 * progress at all). One extra request for the ONE pending row is the shape the
 * server contract asks for.
 *
 * Best-effort and non-fatal: a failure, or a payload that isn't the row we
 * asked for, leaves the list row exactly as it came. Never invent a tally —
 * a wrong "1 of 2" is worse than none.
 */
async function fetchProgressEnrichment(
  request: ApprovalRequestLite,
): Promise<ApprovalRequestLite> {
  try {
    // `getRequest` answers with the row itself, not `{ data: row }`.
    const row = await fetchJson<ApprovalRequestLite>(
      `/approvals/requests/${encodeURIComponent(request.id)}`,
    );
    if (!row || row.id !== request.id) return request;
    return { ...request, ...row };
  } catch {
    return request;
  }
}

/**
 * Read a request's action thread (`sys_approval_action`) — who decided what,
 * when, with which comment/attachments. Same rows the Approval Center's
 * timeline draws; the record page's approval panel merges them across the
 * record's requests (objectui#3461). Empty array on any shape mismatch.
 */
export async function listApprovalActions(requestId: string): Promise<ApprovalActionLite[]> {
  const out = await fetchJson<{ data: ApprovalActionLite[] }>(
    `/approvals/requests/${encodeURIComponent(requestId)}/actions`,
  );
  return Array.isArray(out?.data) ? out.data : [];
}

/**
 * Submitter nudge — notifies the pending approvers (throttled server-side,
 * 429/THROTTLED when sent too recently). `notified` is how many were pinged.
 */
export async function remindApprovalRequest(
  requestId: string,
): Promise<{ notified?: number }> {
  const out = await fetchJson<{ notified?: number }>(
    `/approvals/requests/${encodeURIComponent(requestId)}/remind`,
    { method: 'POST', body: JSON.stringify({}) },
  );
  return out ?? {};
}

// ─── One read per record, however many consumers mount (objectui#12701) ───
//
// A record page has more than one reader of this state: the page host
// (`RecordDetailView`: status band, edit lock, the declared decision bar), the
// `record:approvals` block an authored page places, and the fallback panel.
// Each used to own its own `useState` + effect, so each mount was its own
// `GET /approvals/requests?object=…&recordId=…`. React's StrictMode, which the
// console renders under, replays every mount effect once in development, and
// that doubled each of them; one HotCRM lead open measured three identical
// reads.
//
// So the read and its answer live here, keyed by object + record, rather than
// in each hook instance — the same structural choice as `sharedUserFeeds.ts`
// (a module-scoped store needs no provider above every call site, so no
// consumer can opt out by mounting somewhere unexpected), without that
// module's polling: this read has no cadence, only mounts and refreshes.
//
//   - A record's entry exists while at least one consumer has it mounted. The
//     first mount reads; a consumer that mounts later (a tab opened after the
//     page settled) is served the entry's answer and reads nothing.
//   - The last consumer unmounting drops the entry, so opening the record
//     again reads it again: the answer is shared across one open, never cached
//     across opens.
//   - A read in flight is shared by key, outside the entry, so StrictMode's
//     replayed mount (unmount, then mount again, in one commit) joins the read
//     its first mount started instead of sending a second.
//   - `refresh()` always reads. It is what a write (a decision, a saved edit
//     that may start a flow) calls, and a read that began before the write
//     must not answer for after it. Every consumer of the record sees the
//     refreshed answer.

interface ApprovalsSnapshot {
  loading: boolean;
  /** `false` once the route answered 404 / 501 for this record's reads. */
  available: boolean;
  /** Whether a read for this record answered (a 2xx). */
  answered: boolean;
  /** Rows as the server sent them, the pending one enriched. Unsorted. */
  rows: ApprovalRequestLite[];
}

const EMPTY_ROWS: ApprovalRequestLite[] = [];
const INITIAL_SNAPSHOT: ApprovalsSnapshot = Object.freeze({
  loading: false,
  available: true,
  answered: false,
  rows: EMPTY_ROWS,
}) as ApprovalsSnapshot;

interface ApprovalsEntry {
  snapshot: ApprovalsSnapshot;
  /** Mounted consumers holding this record's entry. */
  holders: number;
  /** A read was started for this entry, so a later mount reads nothing. */
  read: boolean;
}

/** One entry per record, while a consumer holds it. */
const entries = new Map<string, ApprovalsEntry>();
/** The read on the wire per record, shared by every caller that joins it. */
const inFlight = new Map<string, { seq: number; promise: Promise<void> }>();
/** Listeners per record; kept apart from the entry so a re-mount keeps them. */
const listeners = new Map<string, Set<() => void>>();
/** Read sequence, so a slower older read never overwrites a newer answer. */
let readSeq = 0;
const latestSeq = new Map<string, number>();

function publish(key: string, patch: Partial<ApprovalsSnapshot>): void {
  const entry = entries.get(key);
  if (!entry) return;
  entry.snapshot = { ...entry.snapshot, ...patch };
  listeners.get(key)?.forEach((l) => l());
}

function holdEntry(key: string): () => void {
  let entry = entries.get(key);
  if (!entry) {
    entry = { snapshot: INITIAL_SNAPSHOT, holders: 0, read: false };
    entries.set(key, entry);
  }
  entry.holders += 1;
  const held = entry;
  return () => {
    held.holders -= 1;
    if (held.holders <= 0 && entries.get(key) === held) {
      entries.delete(key);
      if (!inFlight.has(key)) latestSeq.delete(key);
    }
  };
}

/** Send the record's read and publish its answer to every consumer of the key. */
function startRead(key: string, objectName: string, recordId: string): Promise<void> {
  const seq = ++readSeq;
  latestSeq.set(key, seq);
  const entry = entries.get(key);
  if (entry) entry.read = true;
  publish(key, { loading: true });
  const promise = (async () => {
    try {
      const reqResp = await fetchJson<{ data: ApprovalRequestLite[] }>(
        `/approvals/requests?object=${encodeURIComponent(objectName)}&recordId=${encodeURIComponent(recordId)}`,
      );
      const rows = reqResp?.data ?? [];
      // Only the pending row can have a live tally, and only it drives the
      // header — so exactly one follow-up read, never one per row.
      const pending = rows.find((r) => r.status === 'pending');
      const full = pending ? await fetchProgressEnrichment(pending) : null;
      if (latestSeq.get(key) !== seq) return;
      publish(key, {
        rows: full ? rows.map((r) => (r === pending ? full : r)) : rows,
        available: true,
        answered: true,
      });
    } catch (err: any) {
      if (latestSeq.get(key) !== seq) return;
      if (err?.status === 404 || err?.status === 501) {
        publish(key, { available: false, answered: false });
      }
      // Other errors are transient — silently keep last state.
    } finally {
      if (inFlight.get(key)?.seq === seq) inFlight.delete(key);
      if (latestSeq.get(key) === seq) publish(key, { loading: false });
      if (!entries.has(key) && !inFlight.has(key)) latestSeq.delete(key);
    }
  })();
  inFlight.set(key, { seq, promise });
  return promise;
}

function subscribeKey(key: string | null, listener: () => void): () => void {
  if (key === null) return () => {};
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(key);
    if (!current) return;
    current.delete(listener);
    if (current.size === 0) listeners.delete(key);
  };
}

/**
 * ⛔ No `currentUserId` parameter (objectui#3055). It existed only to feed the
 * retired client-side `canDecide`; every remaining question about the viewer —
 * may they act, are they the submitter, may they override — is answered by the
 * server on the row itself (`viewer`, framework#3310 / objectstack-ai/objectstack#3424). A surface that
 * still needs the signed-in id for a pre-`viewer` fallback (the panel's remind)
 * reads it from `useAuth()` where it renders.
 *
 * Every instance mounted for the same object + record shares ONE read and one
 * answer (objectui#12701, see the store above).
 */
export function useRecordApprovals(
  objectName: string | undefined,
  recordId: string | undefined,
): UseRecordApprovalsResult {
  const readKey = objectName && recordId ? JSON.stringify([objectName, recordId]) : null;
  // Once this instance has seen the approvals route absent (404 / 501), it
  // asks no more, for this record or the next one it is handed: sticky state
  // for the render, mirrored into a ref the mount effect and `refresh` read.
  const [unavailable, setUnavailable] = useState(false);
  const unavailableRef = useRef(false);

  const subscribe = useCallback((l: () => void) => subscribeKey(readKey, l), [readKey]);
  const getSnapshot = useCallback(
    () => (readKey === null ? INITIAL_SNAPSHOT : entries.get(readKey)?.snapshot ?? INITIAL_SNAPSHOT),
    [readKey],
  );
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // Adjusting state while rendering, on a value the render just read — React's
  // documented alternative to an effect that only copies one value to state.
  if (!snapshot.available && !unavailable) setUnavailable(true);
  useEffect(() => {
    unavailableRef.current = unavailable;
  }, [unavailable]);

  useEffect(() => {
    if (!readKey || !objectName || !recordId) return;
    const release = holdEntry(readKey);
    const entry = entries.get(readKey);
    // Join the read on the wire, or the answer another consumer already has;
    // read only when neither exists. The entry may be new while a read is in
    // flight (StrictMode's replayed mount): that read publishes into it.
    if (entry && !entry.read && !inFlight.has(readKey) && !unavailableRef.current) {
      void startRead(readKey, objectName, recordId);
    } else if (entry && inFlight.has(readKey)) {
      entry.read = true;
      if (!entry.snapshot.loading) publish(readKey, { loading: true });
    }
    return release;
  }, [readKey, objectName, recordId]);

  const refresh = useCallback(async () => {
    if (!objectName || !recordId || !readKey) return;
    if (unavailableRef.current) return;
    await startRead(readKey, objectName, recordId);
  }, [objectName, recordId, readKey]);

  const requests = readKey === null ? EMPTY_ROWS : snapshot.rows;
  const loading = snapshot.loading;
  const available = !unavailable && snapshot.available;

  const pendingRequest = useMemo(
    () => requests.find((r) => r.status === 'pending') ?? null,
    [requests],
  );

  const sortedRequests = useMemo(
    () =>
      [...requests].sort((a, b) => {
        const at = a.submitted_at || a.completed_at || '';
        const bt = b.submitted_at || b.completed_at || '';
        return bt.localeCompare(at);
      }),
    [requests],
  );

  const latestRequest = sortedRequests[0] ?? null;

  // ⛔ No `canDecide` / `approve` / `reject` here (objectui#3055). Whether the
  // viewer may act is the SERVER's answer (`pendingRequest.viewer`), read by
  // the declared actions' own `visible` gate; recording the decision is the
  // declared `type:'api'` action's POST. A client-side second opinion on the
  // same question is what let the record page and the approvals list disagree.

  return {
    loading,
    available,
    answered: readKey !== null && snapshot.answered,
    requests: sortedRequests,
    pendingRequest,
    latestRequest,
    refresh,
  };
}
