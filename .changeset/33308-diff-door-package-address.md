---
'@objectstack/spec': minor
'@objectstack/metadata-protocol': patch
'@objectstack/rest': patch
---

fix(metadata-protocol)!: the diff door of a by-package name refuses the bare name two holders hold, and `?package=` compares one holder's versions (ADR-0150 D3/D4, #33308)

Clause-②: yes (narrowing) — narrowed: for a type stored per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES`), `GET /meta/:type/:name/diff` naming no package is refused `409 RESOURCE_CONFLICT` before any version is read wherever the history and rollback doors refuse the name (two or more row slots hold it, `details.candidates` naming every holder, or the bare plain read refuses it), where it answered one holder's version compared against another holder's as one item's change; an addressed diff (`?package=`) naming a version of another holder, or a version attributed to no package while two hold the name, is refused `404 VERSION_NOT_FOUND` saying whose it is, and nothing is compared. Widened: the door accepts `?package=` on a by-package type (the `/layers?package=` spelling), which compares that holder's versions only, its own active row as the default `to` side and its own nearest earlier differing version as the default `from` side; on any other type it stays refused `400` (now `VALIDATION_ERROR` on param `package`, saying the type is not stored per package), never accepted and dropped. A name one holder holds diffs bare exactly as on `main`.
Metadata-protocol: added
Skills-docs: none — no skill under `skills/` names the diff door, and the docs that do (`content/docs/api/client-sdk.mdx`, `content/docs/permissions/system-context.mdx`, `content/docs/ui/apps.mdx`) name the route without teaching how a name two packages hold is addressed, so no sentence there turns false; the generated API reference (`content/docs/references/api/protocol.mdx`) carries the new `DiffMetaItemRequest` with its `packageId`.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is removed, renamed or re-shaped (`DiffMetaItemRequestSchema` is a new schema declaring a request the door already took, its two bounds read as the same whole numbers as before, plus the optional `packageId`), and no stored row changes shape. What moves is which versions the door compares, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a bare diff request of a by-package name two holders hold (two `.custom` pairs, a package's row beside the environment's, one package's row while a second package ships the name, or a name two packages ship with no stored row). The fix:

- FROM `GET /meta/TYPE/NAME/diff?from=N&to=M` TO `GET /meta/TYPE/NAME/diff?package=PKG&from=N&to=M`, with both versions that holder's (its `?package=` history lists them), once per holder the `409` names. The SDK's `client.meta.diffItem` sends no `package`, so for an SDK caller the TO request is a raw request.

`?package=` names a holder exactly as the history and rollback doors read it (`historySlotOf`): the row a read naming that package serves, else the package's own slot when it ships the name; a package that neither holds nor ships the name is refused `409` (`not-held-by-qualifier`) while another row slot holds the name; with no stored row of the name it answers an empty comparison. `all` and the empty string name no package.

Levels follow the metadata protocol alone (maintainer ruling A, 2026-10-21): `minor` for `@objectstack/spec`, the one package that carries the added protocol surface (the new `DiffMetaItemRequestSchema`, declaring the diff door's request with its two whole-number bounds and `packageId`), and the level `Check Changeset` demands for `Metadata-protocol: added`. Every other package is `patch` under the BREAKING banner above: `@objectstack/metadata-protocol` (`diffMetaItem` takes `packageId`) and `@objectstack/rest` (the diff door accepts `?package=` and reads its bounds through the declaration).
