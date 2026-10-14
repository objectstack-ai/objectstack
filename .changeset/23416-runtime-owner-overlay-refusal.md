---
'@objectstack/metadata-protocol': minor
---

fix(metadata-protocol)!: a save into a second package of an object a runtime-authored row owns is refused before any write, as a code-owned object's is (ADR-0029 D9.9)

Clause-②: no (narrowing)

<!-- adr-0087: not-required (no-migration-prescription) No metadata moves: no spec key, authorable spelling, object definition or stored shape is added, removed, renamed or re-shaped, and no exported declaration is added, removed or narrowed, so there is nothing for `objectstack migrate meta` to rewrite. What narrows is the accept set of the metadata save door for one shape: an `object` save naming a package other than the one whose runtime-authored row already owns the object is now refused where it was written and then discarded by the registry. The remedy is in the request a caller sends (bind it to the owner's package, or name no package), never a rewrite of a package source or a stored row; a row of that shape stored before this change is not rewritten (the registry never held it) and leaves by an ordinary delete naming its package. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); and nothing exported is removed or narrowed (not runtime-interface-only, type-surface-only or runtime-export-retired). -->

**BREAKING** (an accept-set narrowing), shipped as `minor` under the launch-window convention for breaking changes.

An object has exactly one registry entry, so it has exactly one owning package (ADR-0029 D3), and `sys_metadata` must not describe a shape the registry cannot hold (D9.9). The save door enforced that against a CODE-shipped owner only. Against an object that a package's `sys_metadata` row created at runtime, a save naming a second package was stored, and the registry's single-owner rule then refused it into a warning. The save answered `200`, the data plane kept the first package's schema, and `sys_metadata` held a second-package row that nothing served.

`saveMetaItem` now refuses that save before any write, with the refusal and the prescription that the code-owner case gives.

## FROM → TO

Package `P`'s runtime-authored row owns object `NAME`; `Q` is any other package.

| request | FROM | TO |
|:--|:--|:--|
| `PUT /api/v1/meta/object/NAME?package=Q` (`saveMetaItem({ type: 'object', name: NAME, packageId: Q, … })`) | `200` "Saved object … package=Q"; a `Q`-bound row stored; the registry kept `P`'s schema and logged `registerObject failed … already owned by package "P"` | `422 OBJECT_OVERLAY_PACKAGE_MISMATCH`, nothing stored for `Q`: "Cannot layer object 'NAME': the overlay is bound to package 'Q', but the object is owned by package 'P'. …" |
| the same save with `?mode=draft` | success; a `Q`-bound draft row stored | the same `422`; no draft row |
| `duplicatePackage` from `P` to `Q`, for an object whose name does not carry `P`'s namespace prefix (so the copy keeps `NAME`) | the object listed in `copied`; a `Q`-bound row stored that the registry never held | the object listed in `failed` with the refusal's text; nothing stored for it |
| the same save naming `P`, or naming no package | `200` | `200`, unchanged |

**Remedy, in one line.** Save the object with `?package=P` (or with no package, which addresses `P`'s row), or give `Q`'s object its own name. A `Q`-bound row stored before this change is removed with `DELETE /api/v1/meta/object/NAME?package=Q`.

**Also changed, in a log line only.** At boot, `loadMetaFromDb` still counts a stored second-package row in its per-record `errors` and leaves `P` registered. Its `Failed to hydrate object/NAME` warning now carries the D9.9 refusal's text and `code=OBJECT_OVERLAY_PACKAGE_MISMATCH`, in place of the registry's ownership message and `code=OBJECT_OWNERSHIP_CONFLICT`.

**Unchanged.**

- A code-shipped owner. The package door still answers first (`403 NOT_OVERRIDABLE`).
- Every type except `object`. Two packages may still hold one name.
