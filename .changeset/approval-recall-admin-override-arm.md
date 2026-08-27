---
"@objectstack/plugin-approvals": patch
---

fix(plugin-approvals): the `approval_recall` action shows for the #3424 admin override (#12716)

`ApprovalService.recall` has admitted two callers since #3424 — the submitter,
and a platform/tenant admin releasing a stuck request — and `isOverrideActor`'s
own doc block names recall as one of the four override levers in so many words.
The declared action that reaches that endpoint did not agree: `approval_recall`'s
`visible` predicate was submitter-only, while its three siblings
(`approval_approve` / `approval_reject` / `approval_reassign`) each OR in
`record.viewer.can_override`.

So recall was the one lever the override covers whose button never appeared. An
admin rescuing an approval routed to an unstaffed position could approve or
reject their way out — writing a decision nobody made — or reassign it, but
could not simply withdraw it. This is declared-vs-enforced drift in the less
usual direction: a capability the server grants that no UI entry exposed.

`approval_recall`'s `visible` now ORs in `record.viewer.can_override`, spelled
byte-identically to the three siblings.

Not a permission change: the service's authorisation set is untouched, and
`can_override` was already computed server-side for every viewer.

**Pending-only, and enforced rather than asserted.** The new arm carries no
status test of its own — neither do the siblings — because the flag is already
status-scoped where it is computed: `attachViewers` sets
`can_override: row.status === 'pending' && isOverrideActor(...)`, ANDed, so the
flag can never be true off `pending` and the arm is pending-only in effect
however CEL groups the expression. The submitter's own `returned` (revise
window) arm is unchanged. Pinned in both directions, with the flag's own scoping
pinned against the real service on a genuinely `returned` row.
