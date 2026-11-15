---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(platform-objects): Setup → Users offers Unlock Account on environments without the better-auth admin plugin

Clause-②: no — offering an existing action in more kernels widens no accepted input set or public export
Metadata-protocol: none

`sys_user.unlock_user` no longer carries `requiresFeature: 'admin'`. Its door, `POST /api/v1/auth/admin/unlock-user`, already works without the better-auth admin plugin: the sign-in lockout is ObjectStack's own (`sys_user.locked_until` / `failed_login_count`), and the unlock clears it through the data engine. The action was still hidden wherever `features.admin` is off, so a platform administrator there could not release a locked-out person early and had to wait for the lock to expire.

It is now offered on every environment that runs without the admin plugin, self-hosted and cloud-managed alike, to a platform administrator only, and only on an account that has a lock stamp or two-factor enabled. Nothing else changes: `requiredPermissions` and the predicate stay as they were, environments with the admin plugin (or SCIM, which turns it on) see no difference, and `create_user`, `set_user_password` and `impersonate_user` keep their admin-plugin gate.

`PUBLIC_AUTH_FEATURES.admin.gatedInputs` in `@objectstack/spec/kernel` no longer lists `sys_user.actions.unlock_user`, since it is no longer gated on that flag.
