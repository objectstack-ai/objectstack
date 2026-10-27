---
'@objectstack/runtime': patch
---

fix(runtime)!: the package draft doors refuse a query parameter they do not read, so `publish-drafts?dryRun=true` no longer publishes for real

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition, stored row or stored shape is added, removed, renamed or re-shaped, and no exported declaration is removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What changes is the answer two HTTP doors give a request that carries a query parameter they never read: it is refused instead of ignored. The remedy is a request edit (send no query parameters), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** accept-set narrowing at two runtime dispatcher doors: `POST /api/v1/packages/:id/publish-drafts` and `POST /api/v1/packages/:id/discard-drafts`.

- **Before.** Both doors read nothing from the query string and ignored whatever was on it. `POST /packages/:id/publish-drafts?dryRun=true` answered `200 outcome: "published"` and the drafts went live; the same parameter on `discard-drafts` dropped every pending draft. A caller asking for a preview got the irreversible act, answered like a success.
- **Now.** Any query parameter on either door is refused `400 VALIDATION_ERROR` before anything is published or discarded. The message is the one every closed-query door answers (`unknownQueryParamRefusalMessage`, `@objectstack/rest`): it names each parameter it did not understand and says the door takes none. The capability gate still answers first, so a caller without `manage_metadata` keeps its `403`.
- **Unchanged.** A call with no query parameters, which is how the Console, `MetadataClient.publishPackageDrafts` and the client SDK's `packages.publishDrafts` / `packages.discardDrafts` call both doors. The body (`actor`, `backfill`) is read as before.
- **Who sees it.** A script, tool or AI agent that adds a query parameter to either door now gets `400` instead of a publish or a discard. Neither door has a dry run; a preview of what a publish would do is not offered yet.

**The remedy.** Send the request without query parameters.
