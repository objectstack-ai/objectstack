---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a draft of an object promoted into a second package after another package's runtime-authored row came to own the object is refused before any write, as its save is (ADR-0029 D9.9)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, no stored row is rewritten, converted or deleted by this change, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the two draft promotion doors for one shape: promoting an `object` draft into a package other than the one whose runtime-authored row now owns the object is refused, where it was written and then discarded by the registry. The remedy is in the request a caller sends (re-save the draft bound to the owner's package, discard it, or give the object its own name), never a rewrite of a package source or a stored row; the draft stays stored. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

An object has exactly one registry entry, so it has exactly one owning package (ADR-0029 D3), and `sys_metadata` must not describe a shape the registry cannot hold (D9.9). The save door refuses an `object` row bound to a package that does not own the object. A draft save is judged against the owner of its own moment, so package `Q`'s draft of an object that no row held yet was stored, correctly. When package `P`'s runtime-authored row of that object was saved after it, `P` owned the object. Promoting `Q`'s draft then wrote `Q`'s active row beside `P`'s and answered success, while the registry refused it into a warning and kept serving `P`'s schema. An uninstall of `P` then refused `409 RESOURCE_CONFLICT` until a row was removed by hand.

Both promotion doors now ask the save door's question of the row the promotion writes, and refuse it before any write, with the save door's code and prescription.

What changes for you, where package `P`'s runtime-authored row owns object `NAME`, `Q` is any other package, and `Q`'s draft of `NAME` was saved before `P`'s row existed:

- FROM `POST /api/v1/meta/object/NAME/publish?package=Q` (`publishMetaItem({ type: 'object', name: NAME, packageId: Q })`) answering `200` "Published draft …", with a `Q`-bound active row stored while the registry kept `P`'s schema, TO `422 OBJECT_OVERLAY_PACKAGE_MISMATCH` with nothing written and `Q`'s draft still stored: "Cannot layer object 'NAME': the overlay is bound to package 'Q', but the object is owned by package 'P'. …", the save door's text for the same row.
- FROM `POST /api/v1/packages/Q/publish-drafts` (`publishPackageDrafts({ packageId: Q })`) answering `200` with `outcome: 'published'` and `failed: []`, TO `200` with `success: false`, `outcome: 'refused'` and `publishedCount: 0`. `NAME` is in `failed[]` with `code: 'OBJECT_OVERLAY_PACKAGE_MISMATCH'` and that text. Every other draft of `Q` is in `failed[]` with `code: 'BATCH_ABORTED'`. Nothing is promoted (the batch is all-or-nothing, ADR-0067 D2).

**Remedy, in one line.** Re-save the draft bound to the owner (`PUT /api/v1/meta/object/NAME?package=P&mode=draft`) and publish it there, or give `Q`'s object its own name, and discard `Q`'s draft with `DELETE /api/v1/meta/object/NAME?package=Q&state=draft`.

**Unchanged.**

- A promotion of `Q`'s draft of an object no other package's row holds, and the owner `P`'s promotion of its own draft.
- A publish naming no package that promotes a package-unbound draft into the owner's package.
- A package-less owner (the `sys_metadata` sentinel). Its rule is decided separately.
- Every type except `object`. Two packages may still hold one name.
- Rows stored before ADR-0029 D9.9 stay as they are. Nothing is rewritten on upgrade.
