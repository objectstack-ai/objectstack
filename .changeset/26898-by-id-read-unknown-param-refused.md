---
'@objectstack/runtime': patch
'@objectstack/rest': patch
---

fix(runtime)!: the runtime dispatcher's `GET /data/:object/:id` refuses a query parameter other than `select` / `expand` with `400 VALIDATION_ERROR`, as `RestServer` does, instead of dropping it and answering `200`

Clause-②: yes (narrowing) — the dispatcher's by-id read refuses a query parameter it dropped before, and `@objectstack/rest` gains one export (`DATA_RECORD_READ_PARAMS`) so both hosts read one set.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed. `@objectstack/rest` gains one export, `DATA_RECORD_READ_PARAMS`, the closed set its own route already asked. What narrows is one runtime door's query accept set: a parameter the dispatcher's by-id read dropped now answers a located `400 VALIDATION_ERROR`, and the remedy is in the request a caller sends, never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** accept-set narrowing at one runtime dispatcher door, the by-id record read served by the `@objectstack/hono` catch-all and `dispatcher-plugin`.

- **Before.** `GET /api/v1/data/:object/:id?selct=name` answered `200` with every column on the dispatcher: the branch kept `select` and `expand` and silently dropped every other name. `RestServer` refused the same request `400 VALIDATION_ERROR`, so a typo was ignored on one host and refused on the other.
- **Now.** The dispatcher asks the route's closed set, `DATA_RECORD_READ_PARAMS`, imported from `@objectstack/rest`, the same set `RestServer` asks, and refuses any other name `400 VALIDATION_ERROR` with `RestServer`'s sentence: it names each refused parameter and lists `expand, select`. The refusal comes before the read, so it is the same answer for an existing record, a missing id and a row the caller may not read.
- **Unchanged.** `select` and `expand` are read as before. An object the API does not expose is answered its exposure refusal first, before the query is judged: the dispatcher's `404 OBJECT_API_DISABLED` with or without the unknown name, and `RestServer` likewise asks its closed set only after `enforceApiAccess`. The other `/data` routes are not touched.

**The remedy.** Send only `select` and `expand` to the by-id read. `fields` and `populate` are not synonyms on this route (#8039): spell them `select` and `expand`.
