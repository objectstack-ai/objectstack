---
'@objectstack/plugin-hono-server': patch
---

fix(plugin-hono-server): a structured refusal answered by either Hono door carries the fields the standalone REST server's answer carries, such as `409 DELETE_RESTRICTED`'s `developerMessage`, `dependentObject` and `dependentCount` (#23587)

Deleting a record that a `deleteBehavior: 'restrict'` lookup still references is refused by the engine with `409 DELETE_RESTRICTED`. The standalone REST server's answer carries the engine's `developerMessage` (the API names and the `deleteBehavior: 'cascade'` remedy), `dependentObject` and, when the caller may see it, `dependentCount`. The two Hono doors answered the same refusal without them. They are `@objectstack/hono`'s `createHonoApp`, which answered it `500 INTERNAL_ERROR` (the `@objectstack/hono` entry for #23365 makes it a `409`), and a route mounted on `@objectstack/plugin-hono-server`'s `HonoHttpServer`, which answered it with `code` and `message` only.

- FROM `{"success":false,"error":{"code":"DELETE_RESTRICTED","message":"…"}}` on a `HonoHttpServer` route, and `500` `{"success":false,"error":{"code":"INTERNAL_ERROR","message":"…"}}` on `createHonoApp`
- TO `{"success":false,"error":{"code":"DELETE_RESTRICTED","message":"…","details":{"developerMessage":"…","dependentObject":"…","dependentCount":1}}}`

The same rule now covers every refusal the REST server answers with structured fields, not only `409 CONCURRENT_UPDATE`'s `currentVersion`: `400 INVALID_FIELD` carries `field` and `object`, `404 OBJECT_NOT_FOUND` carries `object`, the `403` capability and access refusals (`FEEDS_DISABLED`, `FILES_DISABLED`, `ATTACHMENT_PARENT_ACCESS`, `ATTACHMENT_DELETE_DENIED`, `RECORD_NOT_ACCESSIBLE`) carry `object`, and a `409 METADATA_CONFLICT` thrown out of a direct-mount route carries `currentVersion` (on `createHonoApp` the `/meta` save is answered by the dispatcher itself, which this does not change). The fields ride `error.details`, where `@objectstack/client` reads a wrapped body's context, so `err.details.developerMessage` and its siblings carry them on these hosts too. They are read from the classification the REST server applies (`structuredCodeAnswer` in `@objectstack/types`), so each appears only when the producer stated it. On a `HonoHttpServer` route, status, `code` and `message` are unchanged; on `createHonoApp` they are the declared envelope the `@objectstack/hono` entry for #23365 states. A refusal whose classification answers a different status or code gains nothing. The engine's duplicate insert is the one envelope these doors translate first: its `DUPLICATE_RECORD` is answered `409 UNIQUE_VIOLATION`, the REST server's code, so the classification agrees and its fields ride `details`, as this package's `UNIQUE_VIOLATION` entry states.

One field stays off these doors: `object` on `DELETE_RESTRICTED`, `CONCURRENT_UPDATE` and `METADATA_CONFLICT` is the object the request's route named, and these doors answer without a route. The REST server's answer is unchanged.

Clause-②: no
