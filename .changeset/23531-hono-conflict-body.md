---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
---

fix(plugin-hono-server): a `409 CONCURRENT_UPDATE` answered by either Hono door carries `currentVersion`, as the standalone REST server's does (#23531)

A stale `If-Match` (or `expectedVersion`) on `PATCH` or `DELETE /data/:object/:id` is refused by the protocol with `409 CONCURRENT_UPDATE`. The standalone REST server's answer carries the server's `currentVersion`, which `wire-format.mdx` documents and a conflict dialog needs: it is the token "Overwrite anyway" sends back as the next `If-Match`. The two Hono doors answered the same refusal without it. They are `@objectstack/hono`'s `createHonoApp`, which answered it `500 INTERNAL_ERROR` (the `@objectstack/hono` entry for #23365 makes it a `409`), and a route mounted on `@objectstack/plugin-hono-server`'s `HonoHttpServer`, which answered it with `code` and `message` only.

- FROM `{"success":false,"error":{"code":"CONCURRENT_UPDATE","message":"…"}}` on a `HonoHttpServer` route, and `500` `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"…"}}` on `createHonoApp`
- TO `{"success":false,"error":{"code":"CONCURRENT_UPDATE","message":"…","details":{"currentVersion":"…","currentRecord":{…}}}}`

The field rides `error.details`, the wrapped envelope's declared context slot. `@objectstack/client` reads a wrapped body's context from there, so `err.details.currentVersion` now carries it on these hosts too. It is read from the classification the REST server applies (`structuredCodeAnswer` in `@objectstack/types`), so it appears only when the conflict stated it. On a `HonoHttpServer` route, status, `code` and `message` are unchanged; on `createHonoApp` they are the `409` the `@objectstack/hono` entry for #23365 states. No other answer changes.

`currentRecord` rides beside it, as on the REST server: the row as the caller reads it, which the protocol re-reads under the caller's own context on a version mismatch (#23586).

Nothing changes in `@objectstack/hono`'s own code: `createHonoApp` renders through `declaredEnvelopeForThrow` from `@objectstack/plugin-hono-server`.

Clause-②: no
