---
"@objectstack/runtime": patch
---

The runtime dispatcher's `PUT /meta/:type/:name` honours `If-Match`, `If-None-Match: *` and `?mode=draft`, so a host that mounts the `@objectstack/hono` catch-all no longer overwrites a pinned save or publishes a draft save

Clause-②: no

- Behind `createHonoApp`'s `${prefix}/*` catch-all, this door handed `saveMetaItem` no `parentVersion` and no `mode`. A stale `If-Match` wrote (`200`, not `409`), `If-None-Match: *` over an existing row wrote, and a `?mode=draft` save landed on the ACTIVE row with a receipt saying `state: 'active'`, so every draft edit went live without a publish. The door now reads the request through `metaSaveRequestOptions` from `@objectstack/rest`, the same mapping `RestServer`'s `PUT` door reads it through. It answers as that door does: `409 METADATA_CONFLICT` for a stale token or for `*` over an existing row, a draft row that leaves the active row alone, and `400 VALIDATION_ERROR` for `If-Match` sent beside `If-None-Match` or for an `If-None-Match` other than `*`. Each refusal writes nothing.
- A host whose protocol has no `saveMetaItem` falls back to the metadata service's `saveItem(type, name, item)`, which cannot carry a precondition or a lifecycle. A save that asks for one there is now refused `501 NOT_IMPLEMENTED` and is not written.
- Unchanged: a save that sends neither header and no `?mode=draft` writes the active row, last writer wins, as before. The refusal envelope is this transport's own (`{ success: false, error: { code, message, httpStatus } }`).
