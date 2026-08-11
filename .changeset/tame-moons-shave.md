---
'@objectstack/metadata-protocol': patch
'@objectstack/metadata': patch
---

Fix commit-revert answering `VERSION_NOT_FOUND` over a row `/history` lists, and the package-level revert route answering 500

**Revert (`revertCommit` / `rollbackMetaItem`).** Both revert callers resolved their overlay repository from the caller's *active organization*, while the publish that recorded the commit routes each draft to the draft's **own** scope (the ADR-0005 / #3115 rule `SysMetadataRepository.listDrafts` states, and `publishPackageDrafts` already follows). So an env-wide artifact — what Studio and AI authoring write — published from a console request carrying an active org stored its `sys_metadata_history` rows at `organization_id = NULL` and was then read back at `organization_id = <org>`: no match, and the revert answered `VERSION_NOT_FOUND: No history row at version 2` for a version the history endpoint lists. The revert now resolves the scope the item's lineage actually lives in (the caller's own overlay first, env-wide second), per item for a batch revert. The same resolution reaches the `#6602` registry heal and the `#4636` package-binding read, which an org-scoped revert of an env-wide row was previously skipping while reporting success.

**`POST /packages/:id/revert`.** The route now answers a declared 4xx instead of 500 (ADR-0112). The cause was entirely in the thrown shape, not the route: `MetadataManager.revertPackage` threw bare `Error`s carrying no `code` or `status`, and `errorFromThrown` — which the route's handler already reaches through one enclosing `catch` — falls back to 500 only when it finds neither. An unknown package id now answers `RESOURCE_NOT_FOUND` / 404 and a never-published package `RESOURCE_CONFLICT` / 409; 500 remains only as the fallback for a genuinely unexpected throw.
