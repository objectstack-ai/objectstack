---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': minor
'@objectstack/rest': minor
'@objectstack/metadata': minor
'@object-ui/data-objectstack': minor
'@objectstack/metadata-core': patch
'@object-ui/app-shell': patch
---

fix(metadata-protocol)!: the history and rollback doors of a by-package name refuse the bare name two holders hold, and `?package=` addresses one holder's versions (ADR-0150 D3/D4, #32905)

Clause-②: yes (narrowing) — narrowed: for a type stored per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`), `GET /meta/:type/:name/history` and `POST /meta/:type/:name/rollback` naming no package, of a name whose active rows are held by two or more row slots (two packages', or a package's beside the package-less row), are refused `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`, `details.candidates` naming every holder) before any row is read or written, where the history answered every holder's versions as one log and the rollback wrote the chosen version into whichever row the bare read served. A rollback to a version of another holder's row, or to a version attributed to no package while two hold the name, is refused `404 VERSION_NOT_FOUND` saying whose it is, and nothing is restored. Widened: both doors accept `?package=` (the `/layers?package=` spelling), which reads or restores that holder's versions only. A name one holder holds answers bare exactly as before.
Metadata-protocol: added
Skills-docs: none — no skill under `skills/` names the history or rollback door, and the docs that do (`content/docs/api/metadata-api.mdx`, `content/docs/kernel/contracts/metadata-service.mdx`, `content/docs/plugins/adding-a-metadata-type.mdx`, `content/docs/permissions/system-context.mdx`) list the routes without teaching how a name two packages hold is addressed, so no sentence there turns false; the generated API reference (`content/docs/references/api/protocol.mdx`) carries the new `packageId` field.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is removed, renamed or re-shaped (one optional request key, `HistoryMetaItemRequest.packageId`, is added, so nothing written before needs rewriting), and no stored row changes shape: `sys_metadata_history.package_id` already existed and is now also written by the `/meta` doors. What moves is which versions a door answers and which row a rollback may write, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a bare history or rollback request of a by-package name two holders hold (two `.custom` pairs, or a package's row beside the environment's). The fix:

- FROM `GET /meta/TYPE/NAME/history` TO `GET /meta/TYPE/NAME/history?package=PKG`, once per holder the `409` names.
- FROM `POST /meta/TYPE/NAME/rollback` TO `POST /meta/TYPE/NAME/rollback?package=PKG`, with `toVersion` one of that holder's versions (its `?package=` history lists them).

`?package=` names a holder the way the item read does: a package's own row, or its `.custom` pair's declared override of it (so a base package addresses its customization pair), else the package's own slot when it ships the name and holds no row yet. A package that neither holds nor ships the name, while another slot holds it, is refused `409` (`not-held-by-qualifier`). `all` and the empty string name no package. For every other type, `?package=` is accepted and leaves the answer as it was.

The `/meta` doors' history rows now record whose row they snapshot (`sys_metadata_history.package_id`, the rule `DatabaseLoader` already applies; the package-less row is marked `sys_metadata`). A version recorded before this release carries no attribution: it is listed and restorable while the name has one holder, and never guessed once two hold it. `@objectstack/metadata` exports that rule as `historyRowAttribution` and `ENVIRONMENT_HISTORY_MARK`.

Levels: `minor` where the package carries the added surface — `@objectstack/spec` (`HistoryMetaItemRequestSchema.packageId`, the authorable-surface entry `api/HistoryMetaItemRequest:packageId`), `@objectstack/metadata-protocol` (`historyMetaItem` and `RollbackMetaItemRequest` take `packageId`), `@objectstack/rest` (both doors accept `?package=`), `@objectstack/metadata` (new exports `historyRowAttribution`, `ENVIRONMENT_HISTORY_MARK`) and `@object-ui/data-objectstack` (`history()` / `rollback()` take `packageId`); `patch` for `@objectstack/metadata-core` (a field description only) and `@object-ui/app-shell` (no exported signature changes: `HistoryPanel` and `StudioItemTools` are not exported, and `MetadataResourceHistoryPage` keeps its props).

The console follows: `MetadataClient.history()` and `rollback()` take `packageId` (sent as `?package=`), and the History item tool (routed page, the edit page's sheet and Studio's item tools) names the package its item page reads.
