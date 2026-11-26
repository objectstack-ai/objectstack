---
'@objectstack/core': patch
'@objectstack/runtime': patch
'@objectstack/plugin-hono-server': patch
---

fix(core): a signed-in request reads its session once with the inbound rate limiter armed or an ADR-0069 gate active on REST

Clause-②: no
Metadata-protocol: none

With `server.security.rateLimit` armed, or on the REST door while a session gate is active, one signed-in request read its session (a `sys_session` lookup by token and a `sys_user` lookup by id) two or three times; it now reads it once, on the dispatcher and REST alike. Who is admitted or refused, and with which status, does not change.

The inbound rate limiter, the identity step of every door (`resolveRequestExecutionContext`) and REST's `reread-when-active` gate now read the session through one request-scoped carrier (`openRequestSessionRead` / `withRequestSessionRead` / `withoutRequestSessionRead` / `readRequestSession`, exported from `@objectstack/core`). The Hono transport runs its middleware chain in a scope and hands that scope to a route it registered only when every middleware between the two is a whole-server one; a route behind a path-scoped middleware (plugin-auth's door under the auth base path, where the organization's IP list is judged on the read) and a raw-app route read for themselves, and `resolveRequestExecutionContext` opens a scope for its own call where none is open. A read is handed to a later reader of the same request only while no write has landed on the data engine since it was read and the session has not expired; a read that throws is never handed on, so each reader keeps its own outage answer. Nothing is kept across requests. The Hono middleware seam now hands a middleware the same headers a route receives, `host` backfilled from the URL included.
