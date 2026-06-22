---
"@objectstack/platform-objects": patch
---

Fix: `sys_business_unit` / `sys_team` could not be created in single-tenant deployments.

`organization_id` was `required`, but single-tenant has no `sys_organization` row and
nothing auto-stamps one (OrgScopingPlugin is multi-tenant-only), so every create failed
with `VALIDATION_FAILED: organization_id (required)`. Make `organization_id` optional on
both objects: single-tenant leaves it null; multi-tenant still auto-stamps it via
OrgScopingPlugin and tenant-isolation RLS hides any null-org row (fail-closed), so there is
no cross-tenant exposure. (sys_member / sys_invitation carry the same `required` flag but are
created only through better-auth org flows, which always supply an org — left unchanged.)
