---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(platform-objects): Setup → Users offers Ban User and Unban User on environments without the better-auth admin plugin

Clause-②: no — offering an existing action in more kernels widens no accepted input set or public export; the dev measures the gaining kernels and the seat amends if the diff reads otherwise
Metadata-protocol: none

`sys_user.ban_user` and `sys_user.unban_user` no longer carry `requiresFeature: 'admin'`. Their doors, `POST /api/v1/auth/admin/ban-user` and `POST /api/v1/auth/admin/unban-user`, already work without the better-auth admin plugin: the ban is written through the data engine and the banned person's next session is refused with `403 BANNED_USER`. The two actions were still hidden wherever `features.admin` is off, so a platform administrator could not deactivate or reactivate a person from the console there.

They are now offered on every environment that runs without the admin plugin, self-hosted and cloud-managed alike, to a platform administrator only, and still one at a time by the row's `banned` state. Nothing else changes: `requiredPermissions` and the predicates stay as they were, environments with the admin plugin (or SCIM, which turns it on) see no difference, and `unlock_user`, `create_user`, `set_user_password` and `impersonate_user` keep their admin-plugin gate.

`PUBLIC_AUTH_FEATURES.admin.gatedInputs` in `@objectstack/spec/kernel` no longer lists `sys_user.actions.ban_user` and `sys_user.actions.unban_user`, since neither is gated on that flag any more.
