---
'@objectstack/platform-objects': patch
'@objectstack/spec': patch
---

fix(platform-objects): Setup → Users offers Set Password on self-hosted environments without the better-auth admin plugin

Clause-②: no (as #33989 and #34124 judge a gate drop)
Metadata-protocol: none

`sys_user.set_user_password` no longer carries `requiresFeature: 'admin'`. Its door, `POST /api/v1/auth/admin/set-user-password`, is ObjectStack's own wrapper and already works without the better-auth admin plugin: it hashes and writes the password through better-auth's core, which every environment carries. The action was still hidden wherever `features.admin` is off, so a platform administrator there could not set or reset a person's password from the console.

It is now offered to a platform administrator on every environment that runs without the admin plugin and is not cloud-managed. Its other rule is unchanged: it stays hidden on a cloud-managed environment, whose door refuses every target, and the door's own refusals (a pending person, SSO-only mode) answer as before. `create_user` and `impersonate_user` keep their admin-plugin gate.

`PUBLIC_AUTH_FEATURES.admin.gatedInputs` in `@objectstack/spec/kernel` no longer lists `sys_user.actions.set_user_password`, since it is no longer gated on that flag.

The `features.admin` description in `@objectstack/spec` (`AuthFeaturesConfigSchema`, and the generated auth-endpoints reference page) no longer says the console shows Unlock Account and Set Password only when it is true: whether the console offers banning, unbanning, unlocking or setting a password does not depend on it.
