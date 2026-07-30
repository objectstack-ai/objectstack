---
'@objectstack/runtime': major
---

A dispatcher domain whose route is mounted but whose implementation is absent answers **501**, not a 404 that blames the route (#4093 follow-up).

Two different facts were being answered with whatever each domain happened to reach for, and only `mcp` told them apart:

- **The route is not there.** `/mcp` when the server is disabled for the environment; `/analytics` when the service is unserveable, because `dispatcher-plugin` gates the *mount* and never registers those paths (#4000). A path the server does not expose is a **404** from the host's own router. **Unchanged** — that half was already right.
- **The route is there; the implementation is not.** Every unconditionally-mounted domain. The request reached a handler that had nothing to delegate to. That is **501**, and it is what changes here.

`/automation` and `/notifications` returned `{ handled: false }`, which looks neutral but lands on the dispatcher plugin's single exit: `404 ROUTE_NOT_FOUND` with the hint *"No handler matched this request. Check the API discovery endpoint for available routes."* Both halves were false — a handler did match, and discovery correctly does not list the route, so the hint pointed at a page that would never mention it. An operator reads that as a routing bug and goes looking for one that does not exist.

`/ui` answered **503**, which claims the condition is temporary. An uninstalled MetadataPlugin does not become installed by retrying.

`/ai` answered **404** for the same mounted-but-unimplemented case.

The refusal now carries the same remedy sentence discovery reports for that slot (`serviceUnavailableMessage`, shared via `@objectstack/spec/system`), so the wall and the discovery entry cannot drift into naming different fixes — `POST /api/v1/automation` on a stack without the service answers `501 Install @objectstack/service-automation to enable`. `/ai` keeps a local message: its real provider ships outside this workspace as a Cloud/EE package, so the shared table — verified against workspace packages — records no entry and would otherwise describe it as "nothing ships".

Deliberately unchanged: `analytics`'s route-mount gate (a genuinely absent path); `mcp`'s 404-vs-501 pair, which is the model; the `handled: false` at the END of each domain, which means "no sub-route matched" and is a true 404; `GET /ai/agents`'s empty-list 200, a deliberate courtesy for the console's per-navigation poll; and `/ai`'s `503 routes not yet initialized`, which is a different condition (service present, internal state unready) and may genuinely be transient.

FROM → TO: requests to `/automation`, `/notifications`, `/ui/*` and `/ai/*` on a deployment lacking the backing service now get `501` (with the package to install) instead of `404`/`503`. Anything branching on the old status should branch on `status >= 400` or read the error code; the capability was equally unavailable before, so no working flow changes. Discovery is unaffected — it already reported these slots `unavailable` and advertised no route for them.
