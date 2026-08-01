---
"@objectstack/spec": patch
"@objectstack/plugin-approvals": patch
---

fix(approvals): record an admin override of a staffed approver slate AS an override (#4466)

An admin who is not in a request's `pending_approvers` may still act on it — the
`#3424` privileged-override path exists so a request routed to an unstaffed
position, or to approvers who have all left, is not undecidable forever. The
override is defensible; what was not is what the audit trail recorded.

`sys_approval_action` had no override column at all. So an admin overriding a
properly-staffed slate wrote a row **byte-for-byte identical** to the designated
approver approving normally: a reader of the timeline saw `approve` by the admin
and could not tell whether the admin *was* an approver or *overrode* the ones who
were, and the bypassed approver's later `409 INVALID_STATE` was the only trace —
existing only if they happened to try. The platform knows at decision time (it
took the `isOverrideActor` branch to admit the call at all), so this was dropped
information, not unavailable information. The whole point of an approval record
is to answer "who authorized this, and were they entitled to?".

`sys_approval_action` now carries **`via_override`** (boolean, optional), set on
exactly the actions admitted by that branch — `decideNode`'s approve/reject and
`reassign`'s admin rescue. It is surfaced on `ApprovalActionRow.via_override`
(`@objectstack/spec/contracts`), returned by `listActions`, and added to the
object's `highlightFields` and two grid list views so a timeline can say
"overrode the approver slate" instead of rendering it as an ordinary approval.

Three distinctions the column keeps apart deliberately:

- **`true`** — the actor held no slot in the slate and was admitted only by the
  override branch.
- **`false`** — checked, and it was not an override. An admin who *is* a
  designated approver is approving normally and records `false`: the marker is
  about which branch admitted the call, not about whether the actor holds admin
  rights.
- **absent** — a row written before this column existed. "Not recorded" is not
  the same claim as "not an override", so `rowFromAction` maps `null` to
  `undefined` rather than to `false`.

Additive and nullable, so this needs no data migration: existing rows keep
working and simply read as unrecorded. Levelled `patch` rather than `minor`
because nothing an author writes changes — but note it *is* an observable
behaviour change on a read surface: `listActions` responses and the
`sys_approval_action` grid views now carry a field consumers did not see before,
and `sys_approval_action` gains a column on next schema sync.
