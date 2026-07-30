---
"@objectstack/runtime": minor
---

feat(runtime): mount /analytics routes only when the capability exists (#3891 follow-through, ADR-0076 D11)

`createDispatcherPlugin` used to mount `POST /analytics/query`,
`GET /analytics/meta` and `POST /analytics/sql` on the `IHttpServer`
unconditionally — so a deployment without `@objectstack/service-analytics`
still had the routes in its table: a `PUT` answered `405` with
`Allow: POST`, advertising a method on an API that wasn't there (the `POST`
itself answered 404 since #3989).

The mounts are now capability-conditional. Plugin `start()` runs after the
kernel's Phase-1 init, so service presence is authoritative:

- **single-kernel mode, `analytics` not registered** — the three routes are
  NOT mounted; every method on `/api/v1/analytics/*` answers the adapter's
  shared not-found contract (`404 { "error": "Not found" }`), and a boot log
  names the fix (`Install @objectstack/service-analytics`);
- **single-kernel mode, `analytics` registered** — unchanged;
- **multi-tenant host** (a `kernel-resolver` is wired) — mounted
  unconditionally, because mounts are host-global while the analytics service
  lives in each per-project kernel: capability presence is a per-request
  question, answered by the analytics domain's existing `handled:false` → 404
  (new public `HttpDispatcher.isMultiTenantHost()` exposes the mode).

With this, the `/analytics` API surface exists exactly when the capability is
installed — completing the #3891 arc: #3989 emptied the slot (no more
unscoped-aggregate shim), #4010 made the body contract strict at the entry,
and this change removes the last wire-level residue of the uninstalled API.
