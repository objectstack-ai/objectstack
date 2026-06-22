---
"@objectstack/platform-objects": patch
"@objectstack/plugin-sharing": patch
---

Single-tenant audit follow-ups (ADR-0057):

- **`sys_member` / `sys_invitation`**: make `organization_id` optional (same class as the
  sys_business_unit/sys_team fix #2178). Single-tenant has no org row and no auto-stamp;
  multi-tenant still auto-stamps via OrgScopingPlugin with null-org rows hidden by
  tenant-isolation RLS (fail-closed). Completes the org-scoped identity graph's
  single-tenant consistency.
- **`BusinessUnitGraphService.headOf()`**: add the missing `orgScope()` org filter (it
  queries under SYSTEM_CTX, bypassing RLS, so the scope is the only isolation). Previously
  `headOf(buId)` read a business unit's `manager_user_id` by id alone — a cross-organization
  leak in multi-tenant. Now consistent with `descendants()`. +regression test.
