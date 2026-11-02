---
'@objectstack/spec': patch
---

docs(spec): a typed approval decision output's `type` and `multiple` are documented as enforced at the decision, not as a widget hint

Clause-②: no
Metadata-protocol: none

The `DecisionOutputDefSchema` docblock, its `required` docblock and the `decisionOutputs` docblock on the approval node config said `type` and `multiple` only shape the decision dialog's input widget and that the runtime accepts whatever value shape arrives. They now state the contract (ADR-0104 as amended 2026-10-30): `multiple: true` takes a list with no entry twice, and an absent or false `multiple` takes one value, for every entry (`text` and bare-string entries included, judged by shape only); a picker output's values are also resolved, `user`, `department` and `team` by record id and `position` by the machine name of a position someone holds; a mismatch is refused with `400 VALIDATION_FAILED` naming `outputs.KEY`, before any write. The approvals guide (`content/docs/automation/approvals.mdx`) says the same, and its "previous approver picks the next step's approvers" example now declares `{ key: 'next_reviewers', multiple: true }`, since the list it sends is refused under a bare key. Comment and docs text only: no schema key, `.describe()` string, export or type changes.
