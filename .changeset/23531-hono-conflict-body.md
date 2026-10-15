---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
---

fix(plugin-hono-server): a `409 CONCURRENT_UPDATE` answered by either Hono door carries `currentVersion` and `currentRecord`, as the standalone REST server's does (#23531)

A stale `If-Match` (or `expectedVersion`) on `PATCH` or `DELETE /data/:object/:id` is refused by the protocol with `409 CONCURRENT_UPDATE`. The standalone REST server's answer carries the server's `currentVersion` and `currentRecord`, which `wire-format.mdx` documents and a conflict dialog needs ("Reload latest" / "Overwrite anyway"). The two Hono doors, `@objectstack/hono`'s `createHonoApp` and a route mounted on `@objectstack/plugin-hono-server`'s `HonoHttpServer`, answered the same refusal with `code` and `message` only.

- FROM `{"success":false,"error":{"code":"CONCURRENT_UPDATE","message":"…"}}`
- TO `{"success":false,"error":{"code":"CONCURRENT_UPDATE","message":"…","details":{"currentVersion":"…","currentRecord":{…}}}}`

The two fields ride `error.details`, the wrapped envelope's declared context slot. That is where `@objectstack/client` reads a wrapped body's context from, so `err.details.currentVersion` and `err.details.currentRecord` now carry them on these hosts too. They are read from the same classification the REST server applies (`structuredCodeAnswer` in `@objectstack/types`), so each field appears only when the conflict stated it. Status, `code` and `message` are unchanged, and no other answer changes.

The `@objectstack/hono` entry for #23365 names this as a known gap. This change closes it. Nothing changes in `@objectstack/hono`'s own code: `createHonoApp` renders through `declaredEnvelopeForThrow` from `@objectstack/plugin-hono-server`.

Clause-②: no
