---
'@objectstack/spec': patch
---

docs(spec): `ApprovalRequestRow`'s display labels are documented as the reader's-locale label

Clause-②: no (ledger and docblock text only: no shape, key, default, accepted value or export moves)

The `ApprovalRequestRow` docblocks for `process_label`, `step_label`, `current_step_label` and `object_label` named the authored or schema label. Since plugin-approvals serves those members in the reader's locale, they now say so: the served value is the translation picked from `flows.<flow>.label`, `flows.<flow>.approvals.<node_id>.label` or `objects.<object>.label` in the read's `ExecutionContext.locale`, falling back to the stored snapshot (or the object's schema label). The stored `sys_approval_request` columns are unchanged. The `flows.approvals` translation liveness rows read `live`. No type, key or export changes.
