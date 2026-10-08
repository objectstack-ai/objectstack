---
"@objectstack/rest": minor
---

`metaSaveRequestOptions` is exported: the one mapping from a `PUT /meta/:type/:name` request's `If-Match`, `If-None-Match` and `?mode=draft` to `saveMetaItem`'s `parentVersion` and `mode`

Clause-②: yes (widening)

- `RestServer`'s `PUT /api/v1/meta/:type/:name` door now reads its precondition and its lifecycle through this function. The runtime dispatcher's `/meta` door, the one behind the `@objectstack/hono` catch-all, reads them through it too, so the two doors cannot answer the same save differently. It accepts a `Headers`-like object (`get`) or a plain header record, plus the query. It answers `{ ok: true, request }`, where `request` holds only the members the caller asked for, or `{ ok: false, message }`, the sentence of a `400`.
- Unchanged: `RestServer`'s answers. The token still has ETag quotes stripped, `If-None-Match: *` still pins "no row of this lifecycle", and the two `400` refusals keep their wording. `?mode=draft`, matched case-insensitively, still stages a draft. Any other `mode` value is still an active save.
