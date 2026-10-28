---
'@objectstack/metadata-protocol': patch
'@objectstack/runtime': patch
'@object-ui/app-shell': patch
---

**BREAKING** fix(metadata)!: a save or a draft publish naming a package that is not installed is refused, for every metadata type; Studio shows "package not found"

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) What is refused is a REQUEST, never a stored shape: a `/meta` save naming a package id no installed package has, and `publish-drafts` on such an id. No metadata document changes meaning or validity, no key or value is retired, and rows already stored under such an id still read, list and discard exactly as before, so there is nothing for `objectstack migrate meta` to rewrite. The remedy is a different request (name an installed package, create one first, or name none), not a conversion between two metadata versions. The other categories are closed on facts: all three packages publish (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no spec or Zod face moves (not type-surface-only, not runtime-interface-only); and no export is retired (not runtime-export-retired). -->

`PUT /api/v1/meta/:type/:name?package=ID` used to store the item bound to `ID` even when no installed package has that id, as a draft (`?mode=draft`) or live. With no manifest there was no namespace, so the object prefix rule was skipped too, and `POST /api/v1/packages/ID/publish-drafts` then put those drafts live, owned by a package that cannot be uninstalled or exported. Only `flow` refused it.

- **`@objectstack/metadata-protocol`**: the flow-only named-base rule is now one helper that `saveMetaItem` asks for every type, draft and active, on authoring saves. A save naming an id the package registry does not hold is refused `422 WRITABLE_PACKAGE_REQUIRED`, with the id as `packageId`, and nothing is written. The flow refusal is unchanged, byte for byte, and other types get the same sentence with their type name. Saves naming no package, the `sys_metadata` sentinel or an installed package are unchanged, and so are the two server-side rewrites of stored rows (`migrate-stored` and package duplication).
- **`@objectstack/runtime`**: `POST /packages/:id/publish-drafts` on an id the registry does not hold answers `404 RESOURCE_NOT_FOUND` (the answer `GET /packages/:id` gives) before anything is published, even when drafts are stored under that id. Those drafts are not migrated or deleted. `POST /packages/:id/discard-drafts` still removes them.
- **`@object-ui/app-shell`**: `/studio/ID/…` for an id the package list does not hold shows "package not found", with a way back to the Studio landing, instead of a builder whose saves the server refuses. A pillar segment Studio does not have shows a not-found state instead of the Interfaces pillar. Kernel packages the switcher hides are still opened. If the package list fails to load, the builder shows as before.

**What to do.** Save into a package that is installed: create it first (`POST /api/v1/packages`, or **New package** in Studio), or save without `?package=`. To clean up drafts saved under a mistyped id before this change, call `POST /api/v1/packages/ID/discard-drafts`.
