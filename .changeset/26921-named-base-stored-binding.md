---
'@objectstack/metadata-protocol': patch
---

**BREAKING** fix(metadata)!: the per-item publish and a save naming no package no longer extend a row bound to a package that is not installed

Clause-②: yes (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) What is refused is a REQUEST, never a stored shape: a per-item publish whose draft would go live in a package id no installed package has, and a save naming no package whose address the item's stored rows give in such an id. No metadata document changes meaning or validity, no key or value is retired, and rows already stored under such an id still read, list, delete and discard exactly as before, so there is nothing for `objectstack migrate meta` to rewrite. The remedy is a different request (create the package first, or remove the rows bound to it and save again), not a conversion between two metadata versions. The other categories are closed on facts: the package publishes (not unpublished); no ADR-0087 id is named or touched (not registered or already-registered); no spec or Zod face moves (not type-surface-only, not runtime-interface-only); and no export is retired (not runtime-export-retired). -->

A save or a `publish-drafts` naming a package id that is not installed is already refused. Two doors still extended rows bound to such an id, stored before that refusal existed: a save naming no package kept the binding the item's rows gave it, and `POST /api/v1/meta/:type/:name/publish` (with `?package=ID` or without) put the draft live, owned by a package that cannot be uninstalled or exported.

- **`@objectstack/metadata-protocol`**: both doors now ask the same named-base rule the save door asks. `PUT /api/v1/meta/:type/:name` naming no package, draft or active, on an item whose stored rows are bound to an id the package registry does not hold, is refused `422 WRITABLE_PACKAGE_REQUIRED` with the id as `packageId`, and nothing is written. The per-item publish whose draft would go live in such an id, named or given by the item's rows, is refused the same way, and nothing is published. Rows bound to an installed package, rows bound to no package, and saves naming a package are unchanged. Stored rows are not migrated or deleted.

**What to do.** For an item bound to a package id that is not installed: create a package with that id (`POST /api/v1/packages`), after which its rows save and publish again; or remove its rows bound to that id (`DELETE /api/v1/meta/:type/:name?package=ID` for the active row, `POST /api/v1/packages/ID/discard-drafts` for drafts) and save the item again into an installed package or with no package.
