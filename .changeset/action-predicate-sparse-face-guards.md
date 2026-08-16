---
'@objectstack/platform-objects': patch
'@objectstack/plugin-approvals': patch
---

Guard every authored record-scoped action predicate for the sparse action face, so a list row that did not project the gated column no longer silently drops the button.

An action's `visible` / `disabled` predicate binds whatever record the client already fetched — a record-detail read, or a list row carrying only the view's `$select` projection. That binding stays sparse by decision (it is the one record binding the platform does not make total), and CEL aborts the whole expression at key resolution when a key is absent. The abort is fail-closed, so the button is simply not offered — indistinguishable to the user from the gate having said no, and reported nowhere.

Every authored predicate on `sys_user`, `sys_invitation`, `sys_member`, `sys_oauth_application` and `sys_approval_request` now opens each `record.*` read with `has()`. The guard is the minimal measured form per predicate, not one blanket rewrite: a bare equality against a literal needs `has()` alone, because CEL compares heterogeneously and answers `false` on a projected-null column rather than faulting.

Two predicates change what a user sees, both on `sys_oauth_application`, whose `disabled` column is nullable upstream and therefore null on every application nobody has ever toggled:

- `disable_oauth_application` was `!record.disabled`, which faulted on a projected-null row (`!` needs a bool) — so the Disable button was missing from every never-toggled application in the list. It is now `has(record.disabled) && record.disabled != true` and is offered.
- `enable_oauth_application` was `record.disabled`, which answered `null` rather than a boolean and left the decision to the renderer. It is now `has(record.disabled) && record.disabled == true`.

`sys_approval_request`'s decision levers gate on the attached `record.viewer` block and traverse, so they are guarded at the leaf (`has(record.viewer) && has(record.viewer.can_act) && record.viewer.can_act == true`). Measured, that is the minimal safe form for a nested read: the canonical `has(x) && x != null` conjunction still faults when the block is present but the flag is absent or null, while a leaf `has()` subsumes the parent `!= null` half. Their intended fail-closed behaviour is unchanged — it is now a real `false` instead of an evaluation fault.
