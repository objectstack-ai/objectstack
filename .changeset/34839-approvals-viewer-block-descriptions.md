---
'@objectstack/skills': patch
---

docs(skills): the automation skill says who an `admin_rescue` request opens on

Clause-②: no
Metadata-protocol: none

objectstack-automation's `references/state-machines-and-approvals.md` no longer says that under `onEmptyApprovers: 'admin_rescue'` "only a privileged admin can act via Reassign". The row now says what the runtime does: the request opens on the organization's administrators. Nothing else in the row changes.

No runtime change. In-code descriptions of the approval request's served `viewer` block now name its four leaves (`can_act`, `is_submitter`, `can_override`, `can_override_approve`) and say that Approve reads `can_override_approve` while Reject, Reassign and Recall read `can_override`.
