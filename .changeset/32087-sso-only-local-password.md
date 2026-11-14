---
'@objectstack/plugin-auth': patch
'@objectstack/spec': patch
---

fix(auth)!: with SSO-only mode on, the server gives an IdP-provisioned user no local password at any door; a platform administrator may still set their own

Clause-②: yes (narrowing) — narrowed: with SSO-only mode on (`ssoOnlyMode`, or `OS_AUTH_SSO_ONLY=true`), the four doors that write a local password, `POST /set-initial-password`, `POST /admin/set-user-password`, `POST /reset-password` and `POST /phone-number/reset-password`, answer `409 RESOURCE_CONFLICT` to a user whose `sys_user.source` is `idp_provisioned`, where they set the password; and the two reset doors answer `503 SERVICE_UNAVAILABLE` when the reset record they would judge cannot be read. Widened: two public members, `AuthManager#isSsoOnlyMode()` (the read of the SSO-only switch the manager already resolves) and the optional `ssoOnlyMode?(): boolean` on `AdminUserEndpointDeps`. No first-party composition in this repository turns SSO-only mode on.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches SSO-only mode or these four doors; `content/docs/permissions/authentication.mdx` gains the rule in this change, and `content/docs/deployment/self-hosting.mdx` names SSO-only mode only for the missing-credential log level, which does not move.

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped: `ssoOnlyMode` keeps its key, type and default, and only its description changes. The moved answers are runtime refusals at four auth doors under a deployment switch, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment already running with SSO-only mode on: a user the identity provider provisioned can no longer be given a local password at `POST /set-initial-password`, by an administrator at `POST /admin/set-user-password` (the Set Password action on a user), or through `POST /reset-password` (the emailed link) or `POST /phone-number/reset-password` (the texted code). Each answers `409 RESOURCE_CONFLICT` with a message that names SSO-only mode, and writes nothing. The one exception keeps break-glass reachable: a platform administrator setting their own local password. An administrator setting one for another IdP-provisioned user, another administrator included, is refused. The reset doors judge only a reset token or code they would accept, so any other request answers as before; when the reset record cannot be read they fail closed with `503 SERVICE_UNAVAILABLE`.

Unchanged: SSO-only mode off; environment-native users at every door; a local password a user already holds (it still signs in, and `/change-password` still changes it); the cloud-managed rules, which answer first on a cloud-managed environment; and the guards that keep the last local password and the last administrator.

What to do: nothing, unless an IdP-provisioned user relies on setting or resetting a local password while SSO-only mode is on. Such a user signs in through the identity provider instead. A platform administrator can still set their own break-glass password. A deployment that needs a managed user to hold a local password turns SSO-only mode off.

`@objectstack/spec`: the `ssoOnlyMode` description says what the server now enforces. No key, value or export changes.
