---
"@objectstack/runtime": patch
"@objectstack/driver-memory": patch
---

docs: align hardening / driver docs with the Hono-only adapter surface (12.0)

Follow-up to the adapter trim (#2391): the hardening guide's rate-limit/CORS
recipes are rewritten from Fastify to **Hono** (the shipped adapter; the old
`@objectstack/fastify` import was broken), CSRF guidance points at `hono/csrf`,
and stale `@objectstack/plugin-msw` references are dropped from the driver-memory
and driver-turso docs. README framework lists narrowed to Hono.
