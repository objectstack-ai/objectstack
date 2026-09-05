---
"@objectstack/spec": patch
---

`IApprovalService.recall`'s contract prose names every actor who may recall, and scopes each one by status (#14670)

**Documentation only — no key, no accepted value, no runtime behaviour moves.** The implementation has been correct since #12775; only the contract's description of it was stale.

The docstring said *"Only the submitter (or a system context) may recall"*, then widened to `returned` requests in a second paragraph. Both halves were wrong, in opposite directions:

- **The list was not exhaustive.** A #3424 override actor — a platform or tenant admin holding no approver slot — may recall a `pending` request. That is the in-product recovery path for an approval routed to an unstaffed position, and this same file already documented it 387 lines above the sentence denying it: the docblock on `ApprovalRequestRow.viewer.can_override` spells the override's levers as `(approve / reject / reassign / recall it)`. One file, two contradicting sentences about the same verb.
- **The ADR-0044 widening read as though it applied to that whole list.** It does not. The override and system arms are ANDed with `status === 'pending'` where they are computed, so neither reaches a `returned` request; an override actor is refused there exactly as any other non-submitter (#12775, maintainer ruling 2026-09-02). Abandoning a revision window is the submitter's alone.

The rewrite makes **status** the axis instead of appending a caveat, so the second defect cannot come back on a re-read: each status carries its own admitted set, and the `returned` bullet says outright that the submitter is alone in it.

`ApprovalRecallInput.actorId` carried the same stale sentence (*"Must be the request's submitter (or a system context)"*) and is corrected with it. Fixing only the method docstring would have left the contradiction alive on the very input type the corrected method takes.

The two sibling docstrings sharing that phrasing are **correct and unchanged**: `ApprovalSendBackInput.actorId` and `ApprovalResubmitInput.actorId`. `isOverrideActor` is called from exactly five places in `plugin-approvals` — `decideNode`, `reassign`, `recall`, `attachViewers` and `visibleRequestIds` — and neither `sendBack` nor `resubmit` is among them, so no override actor reaches either.

The published prose already described the corrected rule (`content/docs/automation/approvals.mdx`: an admin "may act on any `pending` request — approve, reject, reassign it to a real approver, or recall it"). This docstring was the one surface that had not kept up.
