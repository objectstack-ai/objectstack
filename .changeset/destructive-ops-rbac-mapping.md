---
"@objectstack/plugin-security": minor
"@objectstack/spec": patch
---

feat(security): pre-map `transfer`/`restore`/`purge` to their RBAC bits (#1883)

The permission evaluator now maps the destructive record-lifecycle operations
to their spec permission bits (`transfer` → `allowTransfer`, `restore` →
`allowRestore`, `purge` → `allowPurge`) and extends the `modifyAllRecords`
super-user bypass to cover them. The ObjectQL operations themselves are still
roadmap M2 — but the gate now exists ahead of them: the moment such an
operation is dispatched through the security middleware it is denied unless a
resolved permission set grants the matching bit. Unmapped destructive
operations continue to fail closed (ADR-0049). Spec descriptions updated from
`[EXPERIMENTAL — not enforced]` to `[RBAC-gated; operation pending M2]`.
