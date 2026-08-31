---
"@objectstack/plugin-security": patch
---

Say the position-name fold out loud: a permission set granted only because a POSITION of the same name resolved by name, with no `sys_position_permission_set` row behind it, now emits a `position_name_fold_grant` warning (#13419 执行要点 3, warning half).

Permission-set resolution requests `[...positions, ...explicitPermissionSets]`, so a position called `sales_rep` resolves a permission set called `sales_rep` — no junction row, no audit line, and nothing declaring that it happens. An operator inspecting `sys_position_permission_set` sees "no bindings" while bindings are in force. The maintainer ruling (2026-08-31) makes the junction table the one governed channel; this reports the ungoverned grants until the fold itself is retired.

The warning names the pair `(position N, set N)` **specifically**. A position bound to some *other* set is still folded onto its own name, so a report keyed on "is this position bound to anything?" would miss real folds while looking complete. It stays silent for a position already carrying that set through the governed channel (a junction row or a direct assignment), for baseline sets, and for any position with no same-named set — which is every built-in identity (`platform_admin`, `org_owner`, `org_admin`, `org_member`, `guest`). It is emitted once per position name per process, so it stays loud instead of becoming per-request volume operators filter away.

⛔ Resolution results are unchanged. Nothing is granted, revoked, accepted or rejected differently — the warning is purely additive, per the ruling's 「任何行为差异只能表现为拒绝/告警,永不静默改变解析结果」.
