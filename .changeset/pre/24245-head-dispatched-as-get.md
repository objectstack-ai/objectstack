---
'@objectstack/hono': patch
'@objectstack/runtime': patch
---

fix(hono): on a `createHonoApp` host a `HEAD` is answered as its `GET` (no body), as the standalone server answers it; `HEAD /api/v1/mcp/skill` no longer answers `405` with `Allow: GET`

Clause-②: no

`createHonoApp`'s `${prefix}/*` catch-all handed the dispatcher the request's raw verb. Hono answers a `HEAD` from the `GET` route, but the verb still read `HEAD`, and the dispatcher's domains decide by comparing it with `GET`, so a `HEAD` was not answered as its `GET` on this host. Measured: `HEAD /api/v1/mcp/skill` answered `405 METHOD_NOT_ALLOWED` with `Allow: GET`; `/health`, `/ready` and the scoped root `/environments/:id` answered `404 ROUTE_NOT_FOUND`; signed in, `/analytics/meta` answered `404` and `/ai/agents` `501`; anonymous, the public `/share-links/:token/resolve` answered `401` where `GET` answers `501`. With an auth service, `HEAD /auth/config` answered `404` (it was forwarded to better-auth instead of answered as the `GET`).

- **`@objectstack/hono`.** The catch-all now dispatches a `HEAD` as `GET`, and the `/auth/config` branch answers a `HEAD` as its `GET`. Every dispatcher route answers `HEAD` with its `GET` answer's status and headers, and Hono drops the body. A path that serves no `GET` keeps its `GET` answer for `HEAD` (its `405` and `Allow`, or `401` to an anonymous caller). The standalone server (`HonoServerPlugin` with the dispatcher plugin) already answered `HEAD` this way. Only the verb changes: a domain that forwards the request (the `/mcp` transport, the `/approvals/act` page) is still handed the client's `HEAD` request.
- **`@objectstack/runtime`.** The `/approvals/act` domain decides whether a request is a `HEAD` from the forwarded request's own method, not from the dispatcher's verb. So a `HEAD` still reaches the approvals member as a `GET` and is answered with no body.
