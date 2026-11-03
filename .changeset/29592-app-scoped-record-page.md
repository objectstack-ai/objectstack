---
'@object-ui/react': patch
'@object-ui/app-shell': patch
'@objectstack/spec': patch
---

fix(console): a record opens the record page scoped to the app it is opened in (`PageSchema.apps`)

Clause-②: no
Metadata-protocol: none

A record page that names apps in `apps` now opens for its object inside those apps: in the Duly app a user record opens Duly's own `sys_user` page, while Setup → Users still opens the platform's `sys_user_detail`. Everywhere else, and wherever no page names `apps`, the object's `isDefault` record page opens exactly as before.

- `usePageAssignment` (`@object-ui/react`) now reads its existing `app` option, which names the owning app by its name (`AppSchema.name`): the record page whose `apps` lists that app opens before the object's default record page. The option's type is unchanged; it was reserved and read by nothing until now. Pass the app's name, never a route segment.
- The console's record view resolves the route's app segment to its app (package id first, then name) and passes the app's name, on the record route and in the record drawer. Where a package ships two apps, its package-id segment opens the first app, so the second app's scoped page opens under that app's name segment.
- The record route's object scope picks the same page, so the route reads the objects of the page it renders.
- `@objectstack/spec`: the `PageSchema.apps` description drops its "planned, not yet rendered" marker, and the key's liveness verdict is now live, citing the console reader.
