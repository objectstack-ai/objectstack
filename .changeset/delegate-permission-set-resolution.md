---
'@objectstack/plugin-hono-server': patch
---

`/auth/me/permissions` and `/me/apps` now resolve the caller's permission sets by
calling `ISecurityService.resolvePermissionSetsForContext` on the `security`
service, instead of re-implementing that resolution twice locally.

The endpoints previously composed the requested set names themselves (positions ∪
explicit sets ∪ the deployment baseline), built their own `sys_permission_set` DB
loader, and called the permission evaluator directly — one rule in three copies,
which diverged from the enforcement path three times, each divergence found only
after it reached a user. They now project a single resolution owned by the
enforcement path.

Behaviour is unchanged on the ordinary paths, measured on the wire. Three states
change, all of them states where the UI plane previously disagreed with the data
plane:

- A deactivated `sys_permission_set` row whose name matches a live position name
  no longer grants capabilities, tabs or object access on these endpoints. It
  already granted nothing on the data plane.
- A permission set with a malformed JSON column is no longer dropped whole by
  `/auth/me/permissions`; the malformed column degrades on its own, as it already
  did for the data plane and for `/me/apps`.
- A stack whose SecurityPlugin started in degraded mode (no middleware-capable
  engine, so the `security` service is never registered and nothing is enforced)
  now takes the endpoints' documented degraded branch instead of reporting a
  restrictive map computed against enforcement that does not exist.

`plugin-hono-server` still takes no runtime dependency on `plugin-security`: the
resolution is reached through the service locator, and the degraded branches for
a stack with no SecurityPlugin are unchanged.
