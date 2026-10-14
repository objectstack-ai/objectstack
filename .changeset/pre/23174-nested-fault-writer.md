---
'@objectstack/types': minor
'@objectstack/service-storage': patch
'@objectstack/service-settings': patch
'@objectstack/service-i18n': patch
'@objectstack/plugin-sharing': patch
---

fix: a route's catch-all `500` answers its own generic text, never the caught error's message, and `@objectstack/types` exports the writer that does it, `sendServerFault`

Clause-②: yes (widening) — `@objectstack/types` gains one export, `sendServerFault`; nothing is removed, renamed or narrowed, and no response field changes shape.

A declared 5xx does not carry the text of the error it caught: that text can name server internals, such as a path, a host or a table. The REST layer already withheld it. The storage, settings and i18n route families and the share-link routes answer in the nested `{ success: false, error: { code, message } }` envelope and did not: their catch-all `500` sent the caught error's message to the caller.

- **What a caller now reads.** The same `status` and `code` as before, with the route's own generic text as `error.message`: `Internal error` on the storage and i18n routes, the route's message on the settings routes (`Failed to list manifests`, `Failed to read namespace`, `Failed to write namespace`, `Action failed`), and the route's `Failed to …` message on the share-link routes. On the storage routes this includes the metadata store's outage sentence, which an operator now reads in the server log.
- **What the operator reads.** The original error, stack included, in one `[5xx]` server-fault line. The storage byte routes, which already withheld the text, logged two lines per fault and now log one. A line names the mounted route pattern when the route passes one, never the request URL.
- **Unchanged.** Every `4xx` answer. The settings `SETTINGS_CRYPTO_UNAVAILABLE` refusal, which keeps its prescription. The authorization-store outage `503`, which keeps its declared code and message. The storage `501 NOT_IMPLEMENTED` answers. On the share-link routes, any error that declares its own `status` keeps the envelope it declares.
- **`sendServerFault(res, status, code, message, thrown, request?)`** (new, `@objectstack/types`): writes `message` in the declared envelope, and hands `thrown` to the server-fault log with its stack, as the fault's one line. Use it for an arm that answers a caught fault. Keep `sendError` for a `4xx` and for a `5xx` whose text you wrote for the reader. `request` is the mounted route pattern, never the request URL.
