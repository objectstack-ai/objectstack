---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a draft save that names no package, of an item never published into a package, writes the draft the publish and the discard naming none act on, and is refused `409 RESOURCE_CONFLICT` where they are; the draft discard's receipt names the package (ADR-0048, ADR-0070)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, export or stored shape is added, removed, renamed or re-shaped, and no stored row is rewritten, converted or deleted by this change itself, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is one runtime write door: a draft save through the metadata API that names no package, of an item with no active row bound to a package and no package-unbound draft, is refused `409 RESOURCE_CONFLICT` when two or more packages hold drafts of it; the remedy is in the request a caller sends (name the package with `?package=`), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and no exported declaration is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

A `sys_metadata` row is keyed by its package (ADR-0048), so an item can hold a draft per package. Over an item never published into a package (no active row bound to one), the per-item publish (`POST /api/v1/meta/TYPE/NAME/publish`) and the draft discard (`DELETE /api/v1/meta/TYPE/NAME?state=draft`) that name no package act on the package-unbound draft, else on the one package's draft, and are refused `409 RESOURCE_CONFLICT` when two or more packages hold drafts. The draft save naming no package did not take that address.

**FROM.** Over such an item, `PUT /api/v1/meta/TYPE/NAME?mode=draft` with no `?package=`:

- With the only draft bound to package `Q` (saved with `?mode=draft&package=Q`), the save wrote a package-unbound draft beside `Q`'s and answered `200` ("Saved … (env-wide, state=draft)"). The drafts became `[package-unbound, Q]`, and from then on the publish and the discard naming no package acted on the package-unbound one, while `Q`'s draft stayed pending.
- With drafts bound to two or more packages and no package-unbound draft, the save wrote a package-unbound draft beside them and answered `200`, while the publish and the discard naming no package were refused `409`.
- `DELETE …?state=draft` of a package's draft answered "Draft discarded — TYPE/NAME", without the package.

**TO.**

- With the only draft bound to `Q`, the save updates `Q`'s draft and its receipt names the package ("Saved view 'my_view' (env-wide, package=Q, state=draft)"). The strict draft read's `version` (`GET …?state=draft`) is that draft's, so a save pinned to it with `If-Match` is accepted; the publish and the discard naming no package act on the same draft.
- With drafts bound to two or more packages and no package-unbound draft, the save is refused `409 RESOURCE_CONFLICT` and writes nothing, as the publish and the discard are. The message names the packages and the remedy, `?package=`.
- A draft discard of a package's draft names the package: "Draft discarded (package=Q) — TYPE/NAME. [seq=N]". The discard of a package-unbound draft reads as before.

**Unchanged.** A draft save that names its package (`?package=`, `packageId` in process). An item with an active row bound to a package, whose draft save naming no package still inherits that package. An item with a package-unbound draft, which a draft save naming no package still updates, whatever packages' drafts sit beside it. A brand-new item with no draft at all, whose first draft save naming no package writes the package-unbound draft. No stored row is rewritten or removed by the upgrade.

**Remedy.** For an item two or more packages hold drafts of, send the draft save with `?package=` naming the package (`packageId` in process). A client that compares draft-discard receipt text should expect ` (package=ID)` after `Draft discarded` when the draft discarded is bound to a package.
