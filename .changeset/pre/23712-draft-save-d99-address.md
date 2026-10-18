---
'@objectstack/metadata-protocol': minor
---

**Shipped in 18.0.0-next.2**, whose CHANGELOG missed this entry (#23818); listed here one prerelease late.

fix(metadata-protocol)!: a draft save naming no package of an object its package-less definition owns is refused when its draft address is a package's draft, with a way out to the package-less draft (ADR-0029 D9.9)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten, converted or deleted by this change, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the object save door for one shape: a draft save naming no package of an object whose registry owner is its package-less definition (the `sys_metadata` sentinel), when the draft address that save writes is a package's draft, is refused, where it wrote a draft no publish could serve. The remedy is in the requests a caller sends (a delete and draft discards through the same door, then the same save), never a rewrite of a package source or a stored row. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

The ADR-0029 D9.9 check of the object save door is now asked of the package the write lands in. A draft save naming no package (`PUT /api/v1/meta/object/NAME?mode=draft`, Studio's designer save) leaves the binding to the draft address, which is the item's one package `Q` when an active row is bound to `Q`, or `Q`'s draft when no active row is bound to a package and `Q`'s draft is the only one stored (ADR-0048). The check used to ask with the request's empty package, so an object whose owner is its package-less definition read as its own re-save, and the save wrote `Q`'s draft. It answered `200`, and the promote door then refused every publish of that draft.

What changes for you, where object `NAME` is owned by its package-less definition and `Q` is any package. Every refusal below is `422 OBJECT_OVERLAY_PACKAGE_MISMATCH` with nothing written, carrying `packageId: Q` and `ownerPackageId: null`. Only rows written before the save door refused a package's row beside the package-less one, or drafts bound to a package stored before that row existed, reach these states.

- Over a row bound to `Q` stored beside the package-less one, with no draft, with a draft bound to no package, or with both that draft and `Q`'s: FROM `PUT /api/v1/meta/object/NAME?mode=draft` answering `200` with `Q`'s draft written (a new one, or the draft bound to no package adopted into `Q`), TO the refusal "A draft save naming no package of object 'NAME' writes a draft bound to 'Q', which no publish can serve: the object is served by its package-less definition. First DELETE /api/v1/meta/object/NAME?package=Q, then send this save again: it writes the package-less draft. Nothing was written."
- The same row with `Q`'s draft and no draft bound to no package: FROM `200` into `Q`'s draft, TO the refusal naming `Q`'s draft discard after the row's delete: "First DELETE /api/v1/meta/object/NAME?package=Q, then ?state=draft&package=Q (the draft discard), then send this save again: …". Deleting the row alone leaves `Q`'s draft, which the address then still names. Each package's draft is named the same way when several are stored.
- No row bound to a package, and `Q`'s draft the only draft stored: FROM `200` into `Q`'s draft, TO the refusal "First DELETE /api/v1/meta/object/NAME?state=draft&package=Q (the draft discard), then send this save again: it writes the package-less draft. …".

**Remedy, in one line.** Send the requests the refusal names, in its order, then the same draft save: it writes the package-less draft, and the table, its records and the served definition stay as they are. A discard removes only that package's draft, which no publish could serve; the save sent again carries the edit. To move the object into `Q` instead, send the draft save naming `Q`: its refusal names that move.

**Unchanged.**

- A draft save naming no package where no package's row and no package's draft is stored: it writes the draft bound to no package.
- A draft save naming no package where the draft bound to no package is the address (no package's row, that draft stored): it is written, as before.
- A draft save naming no package over rows bound to two or more packages, or over two packages' drafts with no package row and no draft bound to no package: `409 RESOURCE_CONFLICT`, as before.
- Every save naming a package, every publish-mode save, and the promote doors: same answers and texts.
- An object a code package ships, an object owned by a runtime row bound to a real package, and every type except `object`.
- Stored rows are not rewritten on upgrade.
