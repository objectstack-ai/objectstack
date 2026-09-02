---
"@objectstack/plugin-approvals": patch
---

fix(approvals): the #3424 override reaches a `pending` request only — override-recall of a `returned` request is now refused (#12775)

**Behaviour change, declared explicitly (maintainer ruling 2026-09-02) so that
one revert of this changeset's PR restores the previous behaviour.**

`ApprovalService.recall` admits two callers: the submitter, and a platform or
tenant admin releasing a stuck request (the #3424 privileged override). Recall
is also valid on the LATEST `returned` request of a run — the ADR-0044 revise
window, where the submitter abandons the revision instead of resubmitting.
Those two rules met above the state check: the override short-circuit carried
no status test of its own, so an override actor could recall a `returned`
request too. Nothing else on the platform said so — `isOverrideActor`'s doc
block names a PENDING request, `attachViewers` computes
`viewer.can_override` as `status === 'pending' && isOverrideActor(...)`, and
the `approval_recall` action's override arm reads that flag — so the reach was
API-only, never offered by any UI, and pinned by nothing.

What changes:

- **Override-recall of a `returned` request is refused.** The override
  short-circuit in `recall` now applies only while the request is `pending`,
  spelled exactly as the viewer flag is computed. On `returned` an override
  actor is judged exactly as any other non-submitter and receives the existing
  refusal: `403 FORBIDDEN` over REST, with the operation catalog's
  `approval_recall_not_submitter` sentence. No new error code, no new envelope.
- **Only `pending` requests are override-recallable** — the same scope as the
  other three override levers (approve / reject / reassign are pending-only at
  their endpoints), and the same scope the viewer flag has always declared.

What does not change:

- The submitter's own recall of a `returned` request (the ADR-0044 revise
  window) is untouched; so is the submitter's recall of a `pending` one.
- The override actor's recall of a `pending` request — the #3424 rescue of a
  request routed to an unstaffed position — is untouched, lock release and all.
- The refusal's message, wire code and developer log line keep their shape; the
  log line now also names the request status it refused on.

Why: the gate now agrees with the viewer flag and the documented contract at
one point instead of disagreeing with both. If a real operator workflow
depended on override-recalling a `returned` request, this is the change to
revert; the `returned` record lock is already released, so the stuck-record
rescue motive that justifies the override does not apply on that status.
