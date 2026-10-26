/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * InlineEditContext — record-level inline-edit session shared across the
 * `record:*` renderers of a record page (objectui#2407 P1). Lifting the
 * edit session out of `DetailView`'s private state lets the details body and
 * (P2) the highlights strip share ONE draft + ONE atomic Save.
 *
 * This is a *separate* context from `RecordContext` (mirrors
 * `HighlightFieldsContext`) on purpose: the draft mutates on every keystroke,
 * and routing that churn through `RecordContext` would re-render every
 * `record:*` consumer. Consumers that don't edit stay subscribed only to
 * `RecordContext` and never re-render on draft changes.
 *
 * The context holds PURE UI state — it knows nothing about the DataSource,
 * OCC, or how a draft is persisted. The atomic save + conflict handling live
 * in `<InlineEditSaveBar>` (@object-ui/plugin-detail), which reads this
 * context for the draft/editing flags and drives `saving`/`error`/`reset`.
 */

import React from 'react';

/**
 * Server-computed decision aggregation of the record's pending approval node
 * (framework#3266, `decision_progress` on `GET /approvals/requests/:id`).
 *
 * A multi-approver node does NOT finalize on the first decision: `unanimous`
 * needs everyone, `quorum` needs `minApprovals` of the slate, `per_group` (会签)
 * needs each named group to sign. Without the tally, an approver looking at the
 * record cannot tell whether their own click completes the step or is one of
 * three — the fact the whole node is about (objectstack#4478). The server does
 * the counting so every client renders the same "2 of 3" the engine enforces.
 *
 * Absent for `first_response` nodes (one decision finalizes, so there is no
 * progress to show) and for a backend that predates the enrichment.
 */
export interface ApprovalProgress {
  behavior: 'unanimous' | 'quorum' | 'per_group';
  /** Approvals recorded so far — satisfied GROUPS when `behavior` is `per_group`. */
  got: number;
  /** Approvals required to finalize — total GROUPS when `behavior` is `per_group`. */
  need: number;
  /** Per-group tally, `per_group` only. */
  groups?: Array<{ group: string; got: number; need: number; satisfied: boolean }>;
}

/**
 * The approval state a record surface shows (objectui#2902): whether an
 * approval is running on the record (`pending`, which drives the status band
 * and the recall lever) and whether it also forbids edits (`locked`).
 */
export interface ApprovalLockState {
  pending: boolean;
  locked: boolean;
}

/** Input to {@link resolveApprovalLock}. */
export interface ApprovalLockInput {
  /**
   * Whether the approvals read ANSWERED (a 2xx) for this record. When it did,
   * the open request is the whole answer and the record's `approval_status`
   * column is not consulted. `false` covers a route that is absent (404 /
   * 501), a read that has not landed yet, and a read that failed before it
   * ever answered.
   */
  readAnswered: boolean;
  /**
   * The open approval on the record, reduced to its lock policy, or `null`
   * when there is none. For a host this is the pending request it found
   * (`locked` from the node's `lock_record`); for a renderer it is the verdict
   * a host threaded through {@link InlineEditContextValue}.
   */
  openApproval: { locked: boolean } | null;
  /** The record's own `approval_status` value, read only as the fallback. */
  recordStatus: unknown;
}

/**
 * THE approval-lock rule of a record surface (objectui#12220). The record page
 * host (`@object-ui/app-shell` `RecordDetailView`) and the detail body's
 * approval band (`@object-ui/plugin-detail` `DetailView`) both call this, so
 * the two cannot disagree about when a record is locked.
 *
 * 1. An open approval decides: it is pending, and it locks exactly when its
 *    node's `lockRecord` policy says so (objectui#2902).
 * 2. With none, an approvals read that ANSWERED means no approval is running:
 *    not pending, not locked. The record's `approval_status` column is not a
 *    second opinion there. A composition without the approvals service answers
 *    the read `200 { data: [] }` and enforces no lock, so a `pending` left in
 *    the column by any writer would otherwise lock the record with nothing to
 *    recall and nothing the server refuses.
 * 3. Only when no read answered does the column stand in: `pending` or
 *    `in_approval` reads as pending AND locked. It carries no node granularity,
 *    so it can only mean "locked", the conservative read for a backend that
 *    mirrors the status but exposes no approvals API (objectui#2618).
 */
export function resolveApprovalLock({
  readAnswered,
  openApproval,
  recordStatus,
}: ApprovalLockInput): ApprovalLockState {
  if (openApproval) return { pending: true, locked: openApproval.locked };
  if (readAnswered) return { pending: false, locked: false };
  const columnPending = recordStatus === 'pending' || recordStatus === 'in_approval';
  return { pending: columnPending, locked: columnPending };
}

export interface InlineEditContextValue {
  /** True while the record is in inline-edit mode. */
  editing: boolean;
  /**
   * Whether inline editing is allowed at all for this record — the object
   * lifecycle / permission gate, decided by the host. When false, `enter()`
   * is a no-op and consumers must not surface the edit affordance.
   */
  canEdit: boolean;
  /**
   * Whether this record is *approval-locked* — a pending approval request has
   * the record locked for writes (the backend rejects updates with
   * `RECORD_LOCKED`). This is a DISTINCT signal from `!canEdit`: a record can
   * be non-editable for many reasons (no permission, wrong lifecycle stage),
   * but only an approval lock warrants the "Locked for approval" band + recall
   * affordance. The host computes it (objectui#2618) — typically from the
   * record's `approval_status` field OR an open request in the approvals API —
   * so the band renders from the same signal that gated `canEdit`, keeping the
   * renderer DataSource-agnostic. Defaults to `false`.
   */
  locked: boolean;
  /**
   * Whether an approval is in flight on this record, INDEPENDENT of whether it
   * locks the record (objectui#2902). An approval node may declare
   * `lockRecord: false`, in which case the backend accepts edits while the node
   * waits — `approvalPending` is true and `locked` is false.
   *
   * Kept separate because the two drive different affordances: the recall
   * button and the "an approval is running" status belong to `approvalPending`,
   * while only `locked` may suppress editing. Consumers that conflate them
   * either hide recall on an editable record or claim a lock that isn't there.
   *
   * `locked` implies an approval is pending, so hosts that thread only `locked`
   * still get a coherent band. Defaults to `false`.
   */
  approvalPending: boolean;
  /**
   * Whether the host's `locked` / `approvalPending` come from an approvals
   * read that ANSWERED (a 2xx) for this record (objectui#12220). When `true`,
   * the host's pair is the whole answer and a renderer must not fall back to
   * the record's `approval_status` column: `false` / `false` then means "no
   * approval is running", not "this host has no opinion". Feed it to
   * {@link resolveApprovalLock} as `readAnswered`.
   *
   * Omitted ⇒ `false` ⇒ unchanged: a renderer keeps the column as its
   * fallback, so a host that never learns of this prop renders as before.
   */
  approvalReadAnswered?: boolean;
  /**
   * Quorum / per-group tally of the pending approval node, when it aggregates
   * more than one decision (objectstack#4478). Threaded verbatim from the
   * host's approvals read so the band renders the server's count instead of
   * re-deriving the engine's tally rules. Undefined when no approval is
   * running, when the node finalizes on the first response, or when the host
   * doesn't resolve approvals at all.
   */
  approvalProgress?: ApprovalProgress;
  /**
   * Whether the viewer is the SUBMITTER of the pending approval request
   * (`830ed5803`). Recall is the submitter's lever and the server enforces
   * exactly that — a non-submitter's recall is refused — so a recall button
   * lit for everyone who can read the record is a button whose click must
   * fail. The host resolves the identity (server-resolved `viewer.is_submitter`
   * on the pending request, with an id comparison as the pre-framework#3310
   * fallback) for the same reason it resolves `locked`: the renderer stays
   * DataSource-agnostic and never re-derives who submitted what.
   *
   * TRI-STATE, and the third state is the load-bearing one:
   *   `true`      — the viewer submitted this approval; offer recall.
   *   `false`     — the host consulted the pending request and this viewer is
   *                 not its submitter; withdraw the recall affordance.
   *   `undefined` — the host does not resolve submitter identity at all
   *                 (no approvals API, band driven by the record's
   *                 `approval_status` mirror alone). Behaviour is UNCHANGED
   *                 from before this signal existed: recall stays offered.
   *
   * The `undefined` case defaults to *showing* on purpose, mirroring how
   * `approvalPending` falls back to `locked`: omission preserves a host's
   * previous behaviour. Defaulting it to "hide" would silently take the
   * submitter's only unlock lever away from every host that never learns of
   * this prop — trading a cosmetic defect for a functional loss.
   *
   * ⚠️ FEEDBACK ONLY. This decides who is SHOWN the entry, never who MAY
   * recall: the server authorizes the recall itself and rejects a
   * non-submitter regardless of what any client renders. Nothing may treat
   * this as an authorization verdict.
   */
  approvalIsSubmitter?: boolean;
  /**
   * Human-readable reason for the approval lock, surfaced as the band's
   * tooltip. Optional — consumers fall back to their own localized default
   * when omitted.
   */
  lockedReason?: string;
  /**
   * Draft of user-edited values. Holds ONLY the keys the user actually
   * changed, so the save path never writes computed / read-only / untouched
   * fields. Read a field's live value from the staged record
   * `{ ...data, ...draft }`, where `data` is the saved record: an OWN draft
   * key wins even when its value is empty (`null`, `undefined`, `''`), and
   * `data[name]` is read only when the key is absent. An own key with an
   * empty value is a field the user, or a cascade clear, emptied, not an
   * untouched one. A read that falls back to the saved value there shows the
   * value the user just removed, and hands an option widget that pruned it
   * the same value to prune again on every render (objectui#7190,
   * objectui#10466).
   */
  draft: Record<string, any>;
  /** Field to auto-focus when edit was entered from a specific field. */
  autoFocusField: string | null;
  /** True while an atomic save is in flight (driven by the save bar). */
  saving: boolean;
  /** Last save error message, or null (driven by the save bar). */
  error: string | null;
  /**
   * Per-field reasons from the last rejected save, keyed by field MACHINE NAME
   * — or `null` when the refusal was not field-scoped (objectui#6868).
   *
   * The record-level companion to `error`, and driven by the same component:
   * `<InlineEditSaveBar>` reads the server's `VALIDATION_FAILED` envelope
   * through `extractFieldErrors` and publishes the result here, so the field
   * renderers (`DetailSection`, `HeaderHighlight`) can draw the reason beside
   * the input the server actually refused. Before this slot existed the save
   * bar and the field rows had no channel between them — they are SIBLINGS
   * under this provider in both persistence modes — so an attributed refusal
   * could only be shown record-level, which is not the in-place hint the
   * objectui#6868 ruling asked for.
   *
   * ⚠️ PRESENTATION ONLY. These are the SERVER's verdicts, transported. The
   * ruling makes the server the validation authority on the inline-edit
   * surface: nothing may populate this slot from a client-side rule check, and
   * nothing may read it as an authorization or acceptance decision. It is text
   * to render beside an input, nothing more.
   *
   * Keyed by machine name because that is what both ends already use — the
   * draft key the field renderers set, and the `field` the server names — so
   * no spelling translation sits between the refusal and the input.
   *
   * Cleared by `enter()` and by teardown, exactly like `error`, so an
   * attribution can never outlive the session that produced it.
   */
  fieldErrors: Record<string, string> | null;
  /** Enter inline-edit mode, optionally focused on `field`. No-op when `!canEdit`. */
  enter: (field?: string) => void;
  /** Stage a single field edit into the draft. */
  setField: (field: string, value: any) => void;
  /** Exit edit mode and discard the draft (Cancel). */
  cancel: () => void;
  /** Exit edit mode and clear the draft — used after a successful save. */
  reset: () => void;
  /** Set the in-flight saving flag (used by the save bar). */
  setSaving: (saving: boolean) => void;
  /** Set or clear the save error message (used by the save bar). */
  setError: (error: string | null) => void;
  /**
   * Publish or clear the per-field reasons for a rejected save (used by the
   * save bar). Pass `null` when the refusal was not field-scoped.
   */
  setFieldErrors: (errors: Record<string, string> | null) => void;
}

const InlineEditContext = React.createContext<InlineEditContextValue | null>(null);

export interface InlineEditProviderProps {
  /**
   * Whether inline editing is allowed (object-lifecycle + permission gate).
   * Threaded into `canEdit` so `enter()` and the edit affordance are gated at
   * a single source. Defaults to `true`.
   */
  canEdit?: boolean;
  /**
   * Whether the record is approval-locked (objectui#2618). Surfaced verbatim
   * on the context so lock-aware consumers (the DetailView "Locked for
   * approval" band) render from the host's signal instead of re-deriving it
   * from a record field the backend may not materialize. Defaults to `false`.
   */
  locked?: boolean;
  /**
   * Whether an approval is pending on the record, whether or not it locks it
   * (objectui#2902). Omitted ⇒ falls back to `locked`, which keeps hosts that
   * only know about the lock rendering exactly as before.
   */
  approvalPending?: boolean;
  /**
   * Whether `locked` / `approvalPending` come from an approvals read that
   * answered (objectui#12220; see `InlineEditContextValue`). Omitted ⇒ `false`,
   * which keeps a renderer's `approval_status` column fallback exactly as
   * before.
   */
  approvalReadAnswered?: boolean;
  /**
   * The pending node's server-computed decision tally (objectstack#4478).
   * Surfaced verbatim so the band can show "2 of 3" / per-group ticks. Omitted
   * for `first_response` nodes and for hosts that don't read approvals.
   */
  approvalProgress?: ApprovalProgress;
  /**
   * Whether the viewer submitted the pending approval request
   * (`830ed5803`). Surfaced verbatim so the recall affordance is offered to
   * the submitter only. Omitted ⇒ `undefined` ⇒ recall is offered exactly as
   * it was before this prop existed (see `InlineEditContextValue`), so a host
   * that resolves no approval identity is unchanged.
   */
  approvalIsSubmitter?: boolean;
  /** Optional human-readable lock reason, surfaced as the band tooltip. */
  lockedReason?: string;
  children: React.ReactNode;
}

export const InlineEditProvider: React.FC<InlineEditProviderProps> = ({
  canEdit = true,
  locked = false,
  approvalPending,
  approvalReadAnswered = false,
  approvalProgress,
  approvalIsSubmitter,
  lockedReason,
  children,
}) => {
  // A locked record always has an approval running; the converse is what
  // #2902 added. Defaulting this way means an un-migrated host keeps its
  // previous behavior with no code change.
  const pending = approvalPending ?? locked;
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<Record<string, any>>({});
  const [autoFocusField, setAutoFocusField] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string> | null>(null);

  const enter = React.useCallback(
    (field?: string) => {
      // Object-lifecycle / permission gate: never enter edit on a record the
      // host has marked non-editable, even if a stray affordance fires.
      if (!canEdit) return;
      setAutoFocusField(field ?? null);
      setEditing(true);
      setError(null);
      setFieldErrors(null);
    },
    [canEdit],
  );

  const setField = React.useCallback((field: string, value: any) => {
    setDraft((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Cancel and reset share the same teardown (clear draft, exit edit, clear
  // transient state). They are named separately so call sites read
  // intentionally — `cancel()` on the Cancel button, `reset()` after a
  // successful save — and so the two can diverge later without touching callers.
  const teardown = React.useCallback(() => {
    setDraft({});
    setEditing(false);
    setAutoFocusField(null);
    setSaving(false);
    setError(null);
    setFieldErrors(null);
  }, []);

  const value = React.useMemo<InlineEditContextValue>(
    () => ({
      editing,
      canEdit,
      locked,
      approvalPending: pending,
      approvalReadAnswered,
      approvalProgress,
      approvalIsSubmitter,
      lockedReason,
      draft,
      autoFocusField,
      saving,
      error,
      fieldErrors,
      enter,
      setField,
      cancel: teardown,
      reset: teardown,
      setSaving,
      setError,
      setFieldErrors,
    }),
    [editing, canEdit, locked, pending, approvalReadAnswered, approvalProgress, approvalIsSubmitter, lockedReason, draft, autoFocusField, saving, error, fieldErrors, enter, setField, teardown],
  );

  return <InlineEditContext.Provider value={value}>{children}</InlineEditContext.Provider>;
};

/**
 * Read the current inline-edit session. Returns `null` when called outside an
 * `<InlineEditProvider>` — a `DetailView` rendered without a provider (bare /
 * legacy usage) simply treats the record as read-only rather than throwing.
 */
export function useInlineEdit(): InlineEditContextValue | null {
  return React.useContext(InlineEditContext);
}
