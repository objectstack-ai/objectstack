---
'@objectstack/spec': patch
---

docs(spec): the admin-plugin descriptions no longer say ban, unban, unlock and set-password need the plugin

Clause-②: no
Metadata-protocol: none

`POST {routes.auth}/admin/ban-user`, `/admin/unban-user`, `/admin/unlock-user` and `/admin/set-user-password` are ObjectStack mounts, served whether or not the better-auth admin plugin is on. Three descriptions still said otherwise, and now say this:

- `AuthFamiliesSchema.admin` (`@objectstack/spec/api`, served as `authFamilies.admin` on discovery): the family whose routes answer a plain `404` when the flag is false is `list-users`, `set-role`, `update-user`, `impersonate-user` and the other better-auth routes. `ban-user` and `unban-user` are not in it.
- `features.admin` on `GET {routes.auth}/config`: creating and impersonating users are the operations that need the plugin. Banning, unbanning, unlocking and setting a password answer without it (the console still shows its unlock and set-password actions only when the flag is true).
- `plugins.admin` in the auth config: its description and JSDoc list what needs the plugin (`create-user`, which answers `501` without it, impersonation and the vendor routes such as `set-role` and `list-users`) apart from the ObjectStack mounts served without it (`ban-user`, `unban-user`, `unlock-user`, `set-user-password`). The JSDoc no longer says better-auth enforces the admin check on every route: the ObjectStack mounts, `create-user`, `remove-user` and `impersonate-user` run the ADR-0068 platform-admin gate, and only the vendor routes keep better-auth's legacy-role check.

The `requiresFeature` example in the actions guide gates `impersonate_user` on `admin`, in place of `ban_user`. Nothing a schema accepts or refuses changes.
