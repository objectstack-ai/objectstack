---
'@objectstack/plugin-hono-server': patch
'@objectstack/hono': patch
---

fix(plugin-hono-server): a `409 CONCURRENT_UPDATE` answered by either Hono door carries `currentRecord` as well, the caller's own read of the row, as the standalone REST server's does (#23531)

The two Hono doors are `@objectstack/hono`'s `createHonoApp` and a route mounted on `@objectstack/plugin-hono-server`'s `HonoHttpServer`. Their answer to a stale `If-Match` (or `expectedVersion`) on `PATCH` or `DELETE /data/:object/:id` carried `code` and `message` only. On a version mismatch the protocol now re-reads the row under the caller's own context (#23586), so the record holds only what the caller may read, and these doors forward it beside the server's `currentVersion`.

- FROM `{"success":false,"error":{"code":"CONCURRENT_UPDATE","message":"…"}}`
- TO `{"success":false,"error":{"code":"CONCURRENT_UPDATE","message":"…","details":{"currentVersion":"…","currentRecord":{…}}}}`

`currentRecord` is the row as the caller reads it. A field the caller's field-level rules hide is absent from it, and a row the caller's row-level rules hide answers `404 RECORD_NOT_FOUND` with neither field, as the REST server answers. It is read from the classification the REST server applies (`structuredCodeAnswer` in `@objectstack/types`), so it appears only when the conflict stated it, and `@objectstack/client` reads it as `err.details.currentRecord` on these hosts. Status, `code` and `message` are unchanged, and no other answer changes.

Nothing changes in `@objectstack/hono`'s own code: `createHonoApp` renders through `declaredEnvelopeForThrow` from `@objectstack/plugin-hono-server`.

Clause-②: no
