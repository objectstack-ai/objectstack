---
'@objectstack/metadata-protocol': minor
'@objectstack/spec': minor
'@objectstack/rest': minor
---

fix(metadata-protocol)!: a metadata save or delete that names no package addresses the row of the one package the item belongs to, and a name two or more packages hold is refused `409 RESOURCE_CONFLICT`; the delete door can name its package (ADR-0048, ADR-0070)

Clause-②: yes (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no authorable spelling, export or stored shape is removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted, so there is nothing for `objectstack migrate meta` to rewrite. One optional request key is ADDED (`DeleteMetaItemRequestSchema.packageId`, with `?package=` on the REST reset door), a widening that asks nothing of an existing caller. What narrows is two runtime write doors: a save or a delete through the metadata API that names no package, of an item two or more packages hold, is refused, as is a package-less save of an item a read-only package holds; the remedy is in the request a caller sends (name the package), never a rewrite of a package source or a stored row. The other categories are closed on facts: the packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_metadata` row is keyed by its package (ADR-0048), so one item can hold one row per package. A save that names a package (`?package=` on the REST door, `packageId` in process) writes that package's row. A save that named none always wrote the package-unbound row, even for an item a package owns, and a delete named no package at all: it removed whichever row of the item the store returned first. The draft save already resolved this: a draft that names no package is stored in the package of the item's active row.

**FROM.** Save an item into a package (`PUT /api/v1/meta/app/my_app?package=com.acme.app`), then save it again without `?package=`: the second save answered `200` "Saved app 'my_app' (env-wide, state=active)" and wrote a second, package-less row beside the package's row. The item read kept serving the package's row, so nothing the save carried took effect, and a console "Disable" reported success while the app stayed enabled. The same held for the API, the CLI and agents, and for an overlay row bound to a code package. A `DELETE /api/v1/meta/app/my_app` of an item two packages hold removed one of the two rows, the other was then served, and the receipt said "it no longer exists". Uninstalling a package, or discarding its drafts, deleted each of its items by name the same way, so it could remove another package's row of the same name and leave its own.

**TO.** A direct save, or a delete, that names no package resolves its address from the item's rows (the active rows for a save and a delete, the draft rows for a draft discard):

- **Bound to one package.** The save writes that package's row, exactly as a save naming the package does, and the item read serves it next; the delete removes that row. The receipts name the package: "Saved app 'my_app' (env-wide, package=com.acme.app, state=active)" and "Deleted app 'my_app' (package=com.acme.app) — it no longer exists." Every check on the row the save writes reads that package: its stored lock, a stored credential carried forward, the optimistic lock, and the writable-base rule. The item read that names no package serves that row's `version`, so a read followed by a save or a delete with the served `If-Match` is accepted.
- **Bound to two or more packages.** The save or delete is refused `409 RESOURCE_CONFLICT` and changes nothing. The message names the packages and the remedy: name one with `?package=`.
- **Bound to none.** The save writes, and the delete removes, the package-unbound row, as before, and the receipts read as before.

The delete door gains the address a save has: `DELETE /api/v1/meta/:type/:name?package=<id>` (`packageId` in process, `DeleteMetaItemRequestSchema.packageId`) removes that package's row and no other; `all` and an empty value name no package, as on the save door. A repeated `?package=` is refused `400`. A delete receipt now says when another row of the item is still stored, naming it, instead of claiming the item is gone or back at its artifact default. Uninstalling a package and discarding its drafts name the package, so each removes only its own rows.

**Also refused now**, each as the same save naming the package is refused: a package-less save of an item held by a read-only package (a code package's runtime-only item, or an installed `system`/`cloud` package's) answers `422 WRITABLE_PACKAGE_REQUIRED`; and a package-less save asserting a create (`If-None-Match: *`) of an item a package holds answers `409 METADATA_CONFLICT`.

`packageId: null` in process names no package too, as the request contracts state. The server-side rewrites keep the row they name: `os migrate meta --stored --apply` and the stored flow credential move pass `null` for a package-unbound row they rewrite, and that row is still the one written; package duplication names its target package.

**Unchanged.** A save or a delete that names a package exactly. A draft save, which keeps its own inheritance. An item a code package ships with no stored row: the package-less save still writes the package-unbound overlay, and the read serves it. Package-less rows already stored beside a package's row stay as they are; none is converted. A package-less delete of such an item removes the package's row and its receipt says the package-less row remains.

**Remedy.** For an item two packages hold, send the save or the delete with `?package=` naming the package whose row it edits or removes. A receipt now names the package when the write addressed a package's row; a client that compares receipt text should expect `, package=<id>` after `env-wide` on a save and ` (package=<id>)` after the item on a delete.

`@objectstack/spec`: the `SaveMetaItemRequestSchema.packageId` description now states what an `active` save that names no package writes, where it said the env-local overlay; `DeleteMetaItemRequestSchema` declares the optional `packageId`. `@objectstack/rest`: `package` joins the reset door's closed query set (`META_ITEM_RESET_PARAMS`).
