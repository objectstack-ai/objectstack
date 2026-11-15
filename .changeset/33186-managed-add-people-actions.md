---
'@objectstack/platform-objects': patch
---

feat(platform-objects): Setup → Users on a cloud-managed environment offers Add User and Import Users again, through the pending-person doors

Clause-②: yes (widening) — two new `sys_user` actions, `add_sso_user` (target `POST /api/v1/auth/admin/add-sso-user`) and `import_sso_users` (target `POST /api/v1/auth/admin/import-sso-users`), each offered only to a platform administrator on a cloud-managed environment (`current_user.isPlatformAdmin == true && has(features.cloudManaged) && features.cloudManaged == true`) and declaring `requiredPermissions: ['manage_users']`; their labels, descriptions, params and result dialogs are new translation keys in the `sys_user` bundles. Nothing that was offered before is hidden: off a managed environment both new actions are hidden and every existing action answers as before.
Metadata-protocol: none

On a cloud-managed environment (`OS_CLOUD_MANAGED=1`) the password and invitation actions stay hidden, as before: `create_user`, `set_user_password` and the four `invite_user` mirrors. In their place a platform administrator now sees **Add User** (email, name, and optionally a position, a permission set and the manager's email address) and **Import Users** (CSV text with the columns `email`, `name`, `positions`, `permission_sets` and `manager_id`, at most 500 rows). Each adds a pending person ahead of their first sign-in, stored with `sys_user.source` = `idp_pending` and no password, who then signs in through the hosting organisation's identity provider. The Add User result names an address that was already pending (the hosting organisation is told again, and the position, permission set or manager sent with it is not applied), a manager that could not be linked, and an invitation the hosting organisation was not told about. The Import Users result shows how many rows were added, already pending or not added, and the answer for each row.

Neither action is exposed to AI agents (no `ai` block): both are human-only until assessed.
