---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

fix(auth): with SSO-only mode on, the server gives an IdP-provisioned user no local password at any door; a platform administrator may still set their own

Clause-②: no
Metadata-protocol: none

With `ssoOnlyMode` (or `OS_AUTH_SSO_ONLY=true`) on, a user whose `sys_user.source` is `idp_provisioned` is given no local password by `POST /set-initial-password`, `POST /admin/set-user-password` (the Set Password action on a user), `POST /reset-password` or `POST /phone-number/reset-password`. Each answers `409 RESOURCE_CONFLICT` with a message that names SSO-only mode, and writes nothing. The one exception keeps break-glass reachable: a platform administrator setting their own local password. An administrator setting one for another IdP-provisioned user, another administrator included, is refused. The reset doors judge only a reset token or code they would accept, so any other request answers as before.

Unchanged: SSO-only mode off; environment-native users at every door; a local password a user already holds (it still signs in, and `/change-password` still changes it); the cloud-managed rules, which answer first on a cloud-managed environment; and the guards that keep the last local password and the last administrator.

What to do: nothing, unless an IdP-provisioned user relies on setting or resetting a local password while SSO-only mode is on. They sign in through the identity provider; a platform administrator can still set their own break-glass password.

`@objectstack/spec`: the `ssoOnlyMode` description says what the server now enforces. No key, value or export changes.
