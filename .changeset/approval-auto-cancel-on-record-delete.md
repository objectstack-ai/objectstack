---
'@objectstack/spec': minor
'@objectstack/plugin-approvals': minor
---

fix(approvals): a deleted record's pending approvals auto-cancel instead of stranding in the inbox (#13568)

Deleting a record left every `pending` approval it had opened sitting in the
approvers' inbox — counted in the pending total, openable, and pointing at a
`record_id` that resolves to nothing. Nothing about it was module-specific:
an approval node that declares `lockRecord` blocks the EDIT, so "delete and
recreate" is the only route left to an author who needs to fix a submitted
record, and every such delete added another orphan. Maintainer ruling
2026-08-31 (`总监席第 5 场决裁批 #5`, verbatim 「同意」): pending requests
auto-cancel on record delete — status `cancelled` plus a machine-readable
reason, rows KEPT for audit, out of the pending count and the inbox's default
view.

**Graded `minor`, and deliberately not `patch`.** The repair itself is a
defect fix, but it lands by WIDENING two published vocabularies and adding a
declared column, and this repo's convention grades a shipped service's
accept-set/behaviour move as `minor`. **No `BREAKING` banner**: nothing is
narrowed and no metadata that used to be accepted is now refused — the one
consequence a consumer can feel is that `ApprovalStatus` and
`ApprovalActionKind` each gained a member, so an exhaustive `switch` with no
default, or a `satisfies Record<ApprovalStatus, …>` map outside this repo,
now has a case to add. That is the same shape `returned` had when ADR-0044
landed it.

**Spec (`@objectstack/spec/contracts/approval-service`)**

- `APPROVAL_STATUSES` gains `cancelled` (+ its `APPROVAL_STATUS_LABELS`
  entry). Its own terminal state rather than a re-use of `recalled`: a recall
  is an ACT by the submitter, and filing a platform-initiated void as one
  attributes a withdrawal to a person who never performed it.
- New `APPROVAL_CANCEL_REASONS` / `ApprovalCancelReason` /
  `APPROVAL_CANCEL_REASON_LABELS`, single entry `record_deleted`. A
  VOCABULARY, not free text, because the reason has a non-human consumer (the
  inbox and the tombstone presentation branch on it) — and a CLASS, per the
  ruling's wording, so the next platform-initiated cancellation cause extends
  this list instead of minting a second terminal status for itself.
- `APPROVAL_ACTION_KINDS` gains `cancel` — the only kind with no human actor,
  by construction.
- `ApprovalRequestRow.cancel_reason` declared, optional-nullable.

**Plugin (`@objectstack/plugin-approvals`)**

- `sys_approval_request.cancel_reason`, a select derived from the contract
  vocabulary and never re-typed (the #3786 rule the `status` column already
  follows). On the row rather than on the audit entry, so a plain list view
  can read WHY without joining the append-only action log.
- `bindRecordDeleteCancelHook` — a GLOBAL `afterDelete` registration beside
  the existing global record-lock hook, so one platform-level linkage covers
  every "approval + `lockRecord`" object at once. It needs no row-set
  plumbing: the engine binds the deleted row's pre-image on the by-id path
  and fans `afterDelete` out per matched row on a predicate delete, so a bulk
  delete is covered by the same handler. The approvals tables are excluded at
  registration, so they do not pay the delete-side pre-image read.
- `ApprovalService.cancelForDeletedRecord` writes the transition: one
  append-only `sys_approval_action` row (`action: 'cancel'`, no actor),
  `status: 'cancelled'` + `cancel_reason: 'record_deleted'` +
  `completed_at`, and a `sys_approval_approver` index clear — that last one
  is not optional garnish, it is what actually empties the inbox, because the
  approver filter resolves through that index rather than through `status`.
- The `Completed` list view now includes `cancelled`, so a kept audit row is
  visible in the one curated terminal view rather than only under `All`.
- ⛔ **No flow resume and no status mirror-back.** A cancellation is a status
  write plus a reason, not a decision, so there is no branch to resume down.
  The mirror-back is skipped by construction rather than by a swallowed
  error: it is an `update_record` against the row that was just deleted — the
  exact write this card's forensics caught failing elsewhere. The suspended
  run the request gated is reported at `warn` with its id and otherwise left
  alone; what becomes of it belongs to the automation service.
- ⛔ **The delete is never refused.** The "forbid delete while an approval is
  pending" direction was vetoed in the same ruling — `lockRecord` already
  blocks the edit, and blocking the delete too locks an author onto a record
  they cannot fix. Nothing in the hook throws; a failure degrades to the
  pre-existing state (the stale row) and is logged.
- Terminal rows are untouched. `approved` / `rejected` / `recalled` /
  `returned` requests about the deleted record keep their recorded outcome —
  history stays history, and rendering their now-dead record reference is a
  separate console-side change.

zh-CN / ja-JP / es-ES bundles carry authored translations for the new leaves
(已作废 / 無効化済み / Anulada), not source fills.
