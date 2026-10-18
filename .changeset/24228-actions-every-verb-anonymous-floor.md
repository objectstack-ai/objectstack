---
'@objectstack/runtime': patch
---

fix(runtime): on the standalone server, every verb on `/api/v1/actions/...` reaches the `actions` domain, so an anonymous caller is answered `401`; and an `Allow` header no longer lists verbs a route mounts only to refuse

Clause-②: no

On the standalone server (`os dev`, `os serve`: `HonoServerPlugin` with the dispatcher plugin), a request that matched no route under its verb was answered by the HTTP adapter: `405 METHOD_NOT_ALLOWED` with an `Allow` header built from the verbs registered on the path. Two answers were wrong.

- **`/api/v1/actions/...` (all three path shapes, unscoped and `/environments/:environmentId`-scoped).** Only `POST` is mounted, so an anonymous `GET`, `HEAD`, `PUT`, `PATCH`, `DELETE` or `TRACE` was answered `405` + `Allow: POST` instead of the published `401 UNAUTHENTICATED`. Every such request now reaches the `actions` domain, as it does on a `createHonoApp` host: an anonymous caller gets `401 UNAUTHENTICATED` with no `Allow`, and a signed-in caller gets the domain's `405` + `Allow: POST`. An anonymous `OPTIONS` (only reachable with CORS off) gets the domain's `405` + `Allow: POST` on both hosts, because the shared anonymous decision lets a CORS preflight through.
- **`Allow` on `/api/v1/keys`, the three `/api/v1/notifications` faces and `/api/v1/mcp/skill`.** These paths mount verbs that exist only so the domain can refuse them. A verb that cannot be mounted (`OPTIONS` with CORS off, `TRACE`, an extension method), and `PUT`/`PATCH` on `/mcp/skill`, got the adapter's `405` with those refusal-only verbs listed as supported (`/keys`: `Allow: DELETE, GET, HEAD, PATCH, POST, PUT`). They now reach the domain too: `/keys` answers `401` anonymous and `405` + `Allow: POST` signed in, `/notifications` answers `401` anonymous and `404 ROUTE_NOT_FOUND` signed in, and `/mcp/skill` answers `405` + `Allow: GET`.

Every request that was served is served as before, and no route is added: the dispatcher's existing fallback seam hands these requests to the domain. A transport that implements `setFallbackHandler` but not `resolveMountedRoute` keeps the adapter's answer, and the dispatcher says so once at boot, at `warn`.
