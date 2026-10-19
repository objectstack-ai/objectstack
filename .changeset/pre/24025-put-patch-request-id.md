---
'@objectstack/runtime': patch
---

fix(runtime): every PUT and PATCH route the dispatcher mounts answers with an `X-Request-Id` and reports its 5xx to the error reporter, as its GET, POST and DELETE routes always did

Clause-②: no

The dispatcher wraps each route it mounts in its observability instrumentation. That wrapper echoes a valid inbound `X-Request-Id` (and mints a `req_`-prefixed hex id otherwise), sets `req.requestId`, hands a 5xx to the configured `observability.errorReporter`, and gives the `[5xx]` log line its method, route and request id. It wrapped routes registered through `get`, `post` and `delete` only, so every route mounted through `put` or `patch` answered without any of that: `PUT` and `PATCH /api/v1/keys`, the `PUT` and `PATCH` mounts of the three `/notifications` paths, `PATCH /packages/:id` (and its `/enable` and `/disable`), `PUT /automation/:name`, the `PUT` and `PATCH /ai/*` wildcards, and PATCH routes a service emits on `ai:routes`. It now wraps all five verbs.

- **On the wire:** a `PUT` or `PATCH` answer from these routes now carries the `X-Request-Id` header (or the header `observability.requestIdHeader` names), as "Debugging with Request IDs" in the error-handling guide describes.
- **For an operator:** a 5xx on one of these routes now reaches `observability.errorReporter`, and its `[5xx]` log line now carries the method, route and request id.
- **Metrics:** on the standalone Hono server nothing changes. The transport already counted and timed these requests through `afterResponse`, and it still does, once per request. On a transport without `afterResponse`, `PUT` and `PATCH` requests on these routes are now counted in `http_requests_total` and timed in `http_request_duration_ms`, as the other three verbs were.

What changes for you: nothing to rewrite.
