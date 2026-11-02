---
'@objectstack/spec': patch
---

docs(spec): a typed approval decision output's `type` and `multiple` are documented as enforced at the decision, not as a widget hint

Clause-②: no
Metadata-protocol: none

The `DecisionOutputDefSchema` docblock, its `required` docblock and the `decisionOutputs` docblock on the approval node config said `type` and `multiple` only shape the decision dialog's input widget and that the runtime accepts whatever value shape arrives. They now state the contract (ADR-0104 as amended 2026-10-30): a picker output is judged by record id (`user`, `department`, `team`) or by machine name (`position`); `multiple: true` takes a list with no entry twice, and an absent or false `multiple` takes one value; a mismatch is refused with `400 VALIDATION_FAILED` naming `outputs.KEY`, before any write. `text` outputs are not judged. The approvals guide (`content/docs/automation/approvals.mdx`) says the same. Comment and docs text only: no schema key, `.describe()` string, export or type changes.
