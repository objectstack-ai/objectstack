---
'@objectstack/skills': patch
---

docs(skills): `objectstack-automation` spells an `expression` approver's `value` as the plain CEL string the schema accepts

Clause-②: no
Metadata-protocol: none

`skills/objectstack-automation/references/state-machines-and-approvals.md`, *Dynamic approvers*: the three fragments wrote the approver's `value` with the `cel` tag, which builds a `{ dialect, source }` object. `ApprovalNodeApproverSchema.value` is a string, so an approval node copied from them failed validation with `expected string, received object`. They now read `value: 'current.co_review_departments'`, `value: 'vars.lead_review.next_reviewers'` and `value: 'current.picked_departments'`, the spelling the end-to-end flow below them already used. The `expression` row of the approver table says `value` is the expression string. The file is two bytes shorter and its token ceiling is unchanged.
