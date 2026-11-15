---
'@objectstack/spec': patch
---

docs(spec): the admin-plugin descriptions no longer say ban-user and unban-user need the plugin

Clause-②: no
Metadata-protocol: none

`POST {routes.auth}/admin/ban-user` and `/admin/unban-user` are ObjectStack mounts, served whether or not the better-auth admin plugin is on. Three descriptions still said otherwise, and now say this:

- `AuthFamiliesSchema.admin` (`@objectstack/spec/api`, served as `authFamilies.admin` on discovery): the family whose routes answer a plain `404` when the flag is false is `list-users`, `set-role`, `update-user`, `impersonate-user` and the other better-auth routes. `ban-user` and `unban-user` are not in it.
- `features.admin` on `GET {routes.auth}/config`: banning and unbanning no longer appear among the operations that need the plugin. The console offers them either way.
- `plugins.admin` in the auth config: its description and JSDoc no longer list ban / unban among what the plugin turns on.

The `requiresFeature` example in the actions guide gates `impersonate_user` on `admin`, in place of `ban_user`. Nothing a schema accepts or refuses changes.
