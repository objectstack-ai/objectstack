---
'@objectstack/plugin-auth': patch
'@objectstack/platform-objects': patch
---

feat(auth)!: a managed environment adds pending, SSO-only people with their positions, permission sets and manager, and ban works without the admin plugin

Clause-②: yes (narrowing) — narrowed: ban works without the admin plugin — `admin/ban-user` now works without the admin plugin, and a banned row is refused a session, with the admin plugin's own `403 BANNED_USER` answer; both ban doors answered `501 NOT_IMPLEMENTED` there. Widened: two doors, `POST /admin/add-sso-user` and `POST /admin/import-sso-users` (cloud-managed environments only; `409 RESOURCE_CONFLICT` elsewhere); the `idp_pending` value of `sys_user.source`, which every password door and every session refuses; the auth plugin's optional `environmentUserHost` option; `AuthManager#isAdminPluginMounted()`; and the exports of `pending-sso-marker`, `environment-user-host` and `pending-sso-users`. The cloud-managed refusals of `create-user`, `import-users` and the invitation doors point to Setup → Users.
Metadata-protocol: none
Skills-docs: none — no skill under `skills/**` teaches the admin user doors, the ban doors or the cloud-managed refusals; `content/docs/permissions/authentication.mdx` gains the two doors, the pending state, the host option and the ban change in this change.

<!-- adr-0087: not-required (no-migration-prescription) No schema key or metadata type is added, removed, renamed or re-shaped. `sys_user.source` gains one select option, `idp_pending`, which no existing row carries; the narrowed answer is a runtime refusal at session creation for a row already marked banned, so there is nothing stored for a migration to rewrite and no tombstone. -->

**BREAKING** for a deployment that runs without the better-auth admin plugin (`auth.plugins.admin` off, and SCIM off): `admin/ban-user` now works without the admin plugin, and a banned row is refused a session, with the admin plugin's own `403 BANNED_USER` code and sentence. `admin/unban-user` lifts the ban there too. A ban with an expiry that has passed is lifted at the next sign-in, as the admin plugin does. A deployment with the admin plugin on answers exactly as before: the plugin still decides.

Unchanged: the admin plugin's own ban enforcement where it is mounted; `create-user` and `import-users` off a managed environment; every row whose `source` is `env_native` or `idp_provisioned`.

What to do: nothing. A user who should not be banned is unbanned with `POST /admin/unban-user`.

New on a cloud-managed environment (`OS_CLOUD_MANAGED=1`): a platform administrator adds a person ahead of their first sign-in with `POST /admin/add-sso-user` (email, name, and optionally positions, permission sets and the manager's email address), or many with `POST /admin/import-sso-users` (CSV or rows, at most 500, a result per row, a bad row failing alone). The person is stored with `sys_user.source` = `idp_pending`: no password, refused by `set-user-password`, `set-initial-password`, `reset-password` and `phone-number/reset-password`, and refused a session on every channel, until their first sign-in through the platform identity provider attaches to the row and moves it to `idp_provisioned`. Positions, permission sets and the manager apply from the moment the person is added. A host passed as `environmentUserHost` is told after a person is added, and asked before a person is deactivated (`ban-user`) or reactivated (`unban-user`), never inside a transaction; the event names the administrator's cloud user id from their linked `objectstack-cloud` account. A host may refuse with `EnvironmentUserHostRefusal` (`409` or `403`, such as `DEVELOPER_ORGANIZATION_MEMBER_LIMIT_REACHED`): the door answers with it, a refused deactivation or reactivation writes nothing, and a refused add takes that person back out (one import row fails alone). Any other host failure never undoes the change, and the answer says so on the row.

`@objectstack/platform-objects`: `sys_user.source` gains the option `idp_pending` ("Pending SSO Sign-In").
