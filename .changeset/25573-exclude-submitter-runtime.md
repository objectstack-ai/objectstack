---
'@objectstack/plugin-approvals': patch
'@objectstack/spec': patch
---

feat(plugin-approvals): an approval step's `excludeSubmitter: true` keeps the submitter from approving their own request

Clause-②: no
Metadata-protocol: none

- **Before.** `excludeSubmitter` was declared on the approval node config and its describe opened with `[PLANNED — not yet enforced]`: the approval engine parsed it and read nothing, so a category manager who submitted their own admission was step 1's `field` approver and approved it.
- **At the open.** The submitter (the run's trigger user, `sys_approval_request.submitter_id`) is taken off the resolved slate, whatever approver type produced them, by their user id or their account's email, an out-of-office hop that lands on them included. Everyone else stays on it, per_group tags included. A slate this empties takes the node's `onEmptyApprovers` route: the organization's administrators by default, the declared `fallbackApprovers` under `'fallback'`, or the `NO_APPROVERS` refusal under `'fail'`, which now names the exclusion. The fallback slate and the administrators' slate are screened the same way, so an organization whose only administrator is the submitter opens the request on the slate that names no one.
- **On the record.** A request whose slate lost its submitter carries a system note on its timeline naming the route it took (the remaining approvers, the fallback approvers, the administrators, or no one), rendered in the reader's language by the approvals door. The administrators' routing note says the only approver was the submitter instead of "no approver resolved to a person".
- **After the open.** An approval decided by the submitter is refused with `FORBIDDEN`, the privileged override included; their rejection stands. A reassign to the submitter, or to a position only they hold, is refused with `VALIDATION_FAILED`. An SLA escalation that reassigns leaves them off the new slate, and one whose only target is the submitter is not applied: the pending approvers keep the request and are told the SLA lapsed.
- **Spec.** The describe drops the `[PLANNED — not yet enforced]` marker and its last sentence; nothing else in the schema changes.
- **Unchanged.** With the option off or omitted (the default), every slate, timeline, decision, reassign and escalation behaves as before.

What to do: nothing to migrate. A step that set `excludeSubmitter: true` now enforces it; an `expression` approver or validation rule added by hand to keep the submitter off can be removed.
