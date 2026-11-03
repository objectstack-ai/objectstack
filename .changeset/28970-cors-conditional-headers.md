---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): the default CORS policy lets `If-None-Match` through and exposes `ETag`, so a cross-origin browser client can make the conditional requests the metadata doors speak

Clause-②: yes (widening)
Metadata-protocol: none

The `/meta` draft save reads `If-Match` and `If-None-Match: *` (the first-write pin the console's `DraftConflictDialog` and Studio's first-draft saves send), and the metadata reads answer an `ETag` that `@objectstack/client`'s cached reads send back as `If-None-Match`. The default CORS policy allowed `If-Match` but not `If-None-Match`, and exposed no `ETag`. From another origin, the first-draft save and every cached read failed in the browser with a bare `Failed to fetch` (the preflight refused them, so nothing reached the server), and cross-origin JS read the `ETag` as `null`.

- **`DEFAULT_CORS_ALLOW_HEADERS`** gains `If-None-Match`.
- **`DEFAULT_CORS_EXPOSE_HEADERS`** gains `ETag`.

Both constants are applied by `@objectstack/plugin-hono-server` and by the `@objectstack/hono` adapter's `createHonoApp`. Allowed origins are unchanged: a request from an origin the policy does not admit still gets no `Access-Control-Allow-Origin`.

A deployment that passes its own `allowHeaders` replaces the default, as before: add `If-None-Match` to that list to let a cross-origin client send it. `exposeHeaders` still merges with the default, so `ETag` is exposed either way.
