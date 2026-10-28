---
'@objectstack/runtime': patch
'@objectstack/rest': patch
---

fix(runtime)!: the package write doors refuse a query parameter they do not read, so `DELETE /packages/:id?keepdata=true` no longer drops the tables the caller asked to keep

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer the package write doors give a request that carries a query parameter they never read: it is refused instead of ignored. The remedy is a request edit (spell the declared flag exactly, or send no query parameter), never a rewrite of a package source or a stored row. The other categories are closed on facts: both packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** accept-set narrowing at the package write doors of the runtime dispatcher, and at `RestServer`'s `POST /api/v1/packages/publish`.

- **Before.** Each door read the query names it knew and ignored every other one. `DELETE /api/v1/packages/:id?keepdata=true` (or `?keep_data=true`) was not `?keepData=true`, so the uninstall dropped the package's object tables, the ones the caller asked to keep, and answered `200`. Every other write door performed its act whatever names rode on the query string.
- **Now.** Each door declares the names it reads and refuses any other `400 VALIDATION_ERROR` before anything is deleted, installed or changed. The message is the one every closed-query door answers (`unknownQueryParamRefusalMessage`, `@objectstack/rest`): it names each parameter it did not understand and lists the ones the door supports. The capability gate still answers first, so a caller without `manage_metadata` keeps its `403`, and a repeated declared flag keeps its `supplied N times` refusal.
- **The declared names.** `DELETE /packages/:id`: `keepData`. `POST /packages` (install): `overwrite`. Every other write door takes none: `PATCH /packages/:id`, `PATCH …/enable`, `PATCH …/disable`, `POST …/publish`, `…/publish-drafts`, `…/discard-drafts`, `…/revert`, `…/rollback`, `…/commits/:commitId/revert`, `…/adopt-orphans`, `…/duplicate`, and `RestServer`'s `POST /packages/publish`.
- **Unchanged.** A call with no query parameter, and the declared flags (`?keepData=true` / `?keepData=1`, `?overwrite=true`), which is how the Console and the client SDK call these doors. Read-only `GET` doors are not touched.
- **Who sees it.** A script, tool or AI agent that misspells a flag or adds any other query parameter to a package write door now gets `400` instead of the act.

**The remedy.** Spell the declared flag exactly (`keepData`, `overwrite`), or send the request without query parameters.
