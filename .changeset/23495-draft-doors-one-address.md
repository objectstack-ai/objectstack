---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': patch
---

fix(metadata-protocol)!: the per-item publish and the draft discard that name no package act on the draft a draft save that names no package writes, and are refused `409 RESOURCE_CONFLICT` where that save is; the draft save's receipt names the package it inherits (ADR-0048, ADR-0070)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted by this change itself, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is two runtime write doors: a per-item publish or a draft discard through the metadata API that names no package is refused `409 RESOURCE_CONFLICT` for an item whose active rows two or more packages hold, and a publish naming no package answers `404 NO_DRAFT` where the only draft is bound to a package other than the item's own; the remedy is in the request a caller sends (name the package with `?package=`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_metadata` row is keyed by its package (ADR-0048), so one item can hold a draft per package. A draft save that names no package (`PUT /api/v1/meta/TYPE/NAME?mode=draft`) writes the draft of the package the item's active rows are bound to, and the strict draft read and the draft preview that name no package serve that draft. The other two draft doors did not take that address.

**FROM.** Over an item whose active rows are bound to package `P`:

- With a package-unbound draft stored beside `P`'s draft, `POST /api/v1/meta/TYPE/NAME/publish` promoted whichever draft the database returned first. On SQLite that is the package-unbound one, and it was promoted into a package-unbound active row that no read naming no package serves. The publish answered `200`, and the item read kept serving `P`'s row unchanged.
- With the only draft bound to another package `Q` (saved with `?mode=draft&package=Q`), the strict draft read answered `404 NO_DRAFT`, but the publish promoted `Q`'s draft into a second package's active row. After that, every save and delete of the item that names no package was refused `409`. `DELETE …?state=draft` removed `Q`'s draft.
- With only a package-unbound draft, the publish promoted it into a package-unbound active row beside `P`'s, which no read naming no package serves.

Over an item whose active rows two packages hold, the publish naming no package promoted the first draft it met, and the discard removed the draft of the one package the drafts were bound to, while the draft save naming no package was refused `409`. A draft save naming no package that inherited `P` answered "Saved … (env-wide, state=draft)", without the package.

**TO.** A per-item publish and a draft discard that name no package act on the draft the draft save naming no package writes:

- **Active rows bound to one package `P`.** They act on `P`'s draft, else the package-unbound draft. A publish promotes either one into `P`'s active row, the row the read naming no package serves next. A package-unbound draft is adopted into `P`, as the draft save adopts it. When neither exists, the publish answers `404 NO_DRAFT`, as the strict draft read does. Its message names the other packages' drafts and the remedy, `?package=`. The discard removes nothing (`reset: false`) and its receipt names the drafts that remain.
- **Active rows bound to two or more packages.** Both are refused `409 RESOURCE_CONFLICT` and change nothing, as the draft save naming no package is. The message names the packages and the remedy, `?package=`.
- **An item never published into a package.** Both act on the package-unbound draft, the one the draft save writes. If there is none, they act on the one package's draft; when two or more packages hold drafts, both are refused `409 RESOURCE_CONFLICT`.

The draft save's receipt names the package the draft went into: "Saved view 'my_view' (env-wide, package=com.acme.app, state=draft)". A draft save into the package-unbound row reads as before.

**Unchanged.** A publish or a discard that names its package (`?package=`, `packageId` in process). A publish stating `packageId: null` in process, which still pins the package-unbound draft. The batch publish and discard of a package's drafts (`POST /packages/:id/publish-drafts`, the discard of a package's drafts). No stored row is rewritten or removed by the upgrade.

**Remedy.** For an item two or more packages hold, or to publish or discard a draft bound to a package other than the item's own, send the request with `?package=` naming that package (`packageId` in process). A client that compares draft-save receipt text should expect `, package=<id>` after `env-wide` when the draft inherits a package.

`@objectstack/spec`: the `PublishMetaItemRequestSchema.packageId` description now states what a publish naming no package promotes, where it said "match any package"; the `DeleteMetaItemRequestSchema.packageId` description states what a draft discard naming no package removes.
