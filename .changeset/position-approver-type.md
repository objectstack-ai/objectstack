---
'@objectstack/spec': minor
'@objectstack/plugin-approvals': minor
'@objectstack/lint': minor
'@objectstack/cli': patch
---

Add a `position` approver type so approvals can route to org positions (ADR-0090 D3 fallout).

Post ADR-0090 D3 the `role` approver type resolves against the better-auth org-membership
tier (`sys_member.role`: `owner`/`admin`/`member`) — it was never a position. Downstream
apps that authored `{ type: 'role', value: 'sales_manager' }` silently routed approvals to
nobody. Now:

- **spec**: `ApproverType` gains `'position'` — `value` is the position machine name; the
  approver expands to its holders via `sys_user_position`. Authoring guidance: keep
  `type: 'role'` ONLY for membership tiers; for org positions use
  `{ type: 'position', value: '<position_name>' }` (one-line fix for the mismatch above).
- **plugin-approvals**: the engine resolves `position` approvers via `sys_user_position` ∪
  the `sys_member.role` transition source (same semantics as `PositionGraphService` in
  plugin-sharing). The `department` approver type is now honored by its spec spelling
  (previously only the off-spec `business_unit`/`bu` dialect matched).
- **lint**: new `validateApprovalApprovers` rule — `approval-role-not-membership-tier`
  warns when a `role` approver's value is not a membership tier and prescribes the
  `position` rewrite; `approval-approver-type-unknown` flags off-spec approver types
  (with a `business_unit` → `department` fix-it). Wired into `os lint`.
