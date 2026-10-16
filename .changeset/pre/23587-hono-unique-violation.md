---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): a repeated unique value answered by either Hono door reports the wire code `UNIQUE_VIOLATION`, not the engine's in-process `DUPLICATE_RECORD`, with `developerMessage`, `object` and `field` (#23587)

**Wire change at these doors: `409 DUPLICATE_RECORD` becomes `409 UNIQUE_VIOLATION`.** A client of `@objectstack/hono`'s `createHonoApp` or of a route mounted on `@objectstack/plugin-hono-server`'s `HonoHttpServer` that matched `code === 'DUPLICATE_RECORD'` on a duplicate insert or update must match `code === 'UNIQUE_VIOLATION'` instead, which is what the standalone REST server already answers for the same refusal.

Why: the maintainer ruled one wire spelling for a unique-constraint refusal on every route, `UNIQUE_VIOLATION` (recorded in commit 65846bc46). The REST server, the batch rows of `POST /data/:object/batch` and the import runner's rows already report it; the two Hono doors reported the engine's own spelling.

- FROM `{"success":false,"error":{"code":"DUPLICATE_RECORD","message":"Duplicate record refused on 'udoc': …"}}`
- TO `{"success":false,"error":{"code":"UNIQUE_VIOLATION","message":"Duplicate record refused on 'udoc': …","details":{"developerMessage":"Duplicate record refused on 'udoc': …","object":"udoc"}}}`

`details` carries what the REST server's answer carries beside its code, each only when the producer stated it: `developerMessage`, `object`, and `field` when the driver named the conflicting column. The `message` is unchanged: it stays the engine's sentence, as on every other code at these doors. Only the engine's `DuplicateRecordError` is translated, recognised by its registered code and its class name together. A hook that throws the registered `DUPLICATE_RECORD` without being that class keeps its own code. Inside the engine, `DuplicateRecordError.code` is still `DUPLICATE_RECORD`, so an in-process caller (a hook, a flow node) is unaffected. The REST server's answer is unchanged.

Clause-②: no
