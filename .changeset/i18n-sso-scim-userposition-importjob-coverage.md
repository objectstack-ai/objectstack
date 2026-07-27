---
"@objectstack/platform-objects": patch
"@objectstack/plugin-security": patch
---

fix(i18n): translate the SSO / SCIM / user-position / import-job admin objects

Four live, UI-facing system objects were registered but never added to their
package's i18n extract config, so non-English admins saw raw English `label`
metadata:

- `sys_sso_provider`, `sys_scim_provider` (platform-objects) — identity-provider
  admin grids plus the register / verify-domain actions.
- `sys_user_position` (plugin-security) — delegated position assignment
  (`userActions` create/edit/delete); its sibling `sys_user_permission_set` was
  already translated, so this closes an inconsistency.
- `sys_import_job` (platform-objects) — import history / progress, alongside the
  already-translated `sys_job` / `sys_job_run`.

Adds each object to its package's `scripts/i18n-extract.config.ts` and supplies
real zh-CN / ja-JP / es-ES translations across all four locale bundles, and
extends the bundle-ownership guards' `OWNED_OBJECTS` to cover them. The
orphan-only guards from #3502 could not catch this "owned-and-live-but-never-
extracted" gap.
