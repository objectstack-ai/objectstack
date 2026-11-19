---
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/plugin-hono-server': patch
---

fix(core): a signed-in request reads its session once with the inbound rate limiter armed or an ADR-0069 gate active on REST

Clause-②: no
Metadata-protocol: none

With `server.security.rateLimit` armed, or on the REST door while a session gate is active, one signed-in request read its session (a `sys_session` lookup by token and a `sys_user` lookup by id) two or three times; it now reads it once, on the dispatcher and REST alike. Who is admitted or refused, and with which status, does not change.

The inbound rate limiter, the identity step of every door (`resolveRequestExecutionContext`) and REST's `reread-when-active` gate now read the session through one request-scoped carrier (`withRequestSessionRead` / `readRequestSession`, exported from `@objectstack/core`). The Hono transport opens it per request around its middleware chain and the route, and `resolveRequestExecutionContext` opens one for its own call on a transport that opens none. A read is handed to a later reader of the same request only while no write has landed on the data engine since it was read and the session has not expired; a read that throws is never handed on, so each reader keeps its own outage answer. Nothing is kept across requests. The Hono middleware seam now hands a middleware the same headers a route receives, `host` backfilled from the URL included.
