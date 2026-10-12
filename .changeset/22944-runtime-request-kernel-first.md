---
'@objectstack/runtime': patch
---

fix(runtime): on a `kernel-resolver` host, a dispatcher door resolves a service on the request's own environment kernel before the host kernel. `HttpDispatcher.resolveService` used to ask the host kernel's scoped lookup first, and the host kernel's singleton `protocol` / `metadata` / `objectql` answered it whatever the scope. So `POST /api/v1/actions/:object/:action` loaded its subject row through a protocol that registers none of the environment's objects, and it answered `404 RECORD_NOT_FOUND` for a row the caller can read. Hosts with no request kernel of their own (single-environment, SharedProjectPlugin) resolve exactly as before, and an id that names nothing is still refused with 404.

Clause-②: no
