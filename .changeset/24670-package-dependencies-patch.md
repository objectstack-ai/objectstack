---
'@objectstack/runtime': minor
'@objectstack/objectql': minor
'@objectstack/metadata-protocol': minor
---

feat(runtime): `PATCH /api/v1/packages/:id` edits a package's manifest `dependencies`

Clause-②: yes (widening)

- **The door.** `PATCH /api/v1/packages/:id` accepts `dependencies` beside `name`, `description` and `version`, flat or under the `manifest` wrapper. The row is judged by `ManifestSchema`'s own `dependencies` row (package ids mapped to version requirements), the row `POST /api/v1/packages` judges at create. A malformed row (a non-string version, a list, a bare string, `null`) is refused `400 VALIDATION_ERROR`, the envelope the create door answers for it, and nothing is written, a valid key sent beside it included.
- **The row replaces the stored one whole.** An entry the row leaves out is removed, and `{}` clears the declaration. On a host with the `package` service the edit is written to `sys_packages` and survives a restart; when that write is refused, the prior row is put back and the door answers the failure.
- **Why.** A save into a package is judged against the package's closure, its declared `dependencies` included, and a binding outside it is refused with the remedy "declare a dependency on the package that defines it in the `dependencies` of the package's manifest". Before this change `dependencies` could be set only at create, so for a package that already existed that remedy had no door. The closure is read per save, so the next save sees the edit.
- **Removing an entry is applied as given.** No in-use check is made. An item already stored that binds to an object the edit takes out of the closure keeps loading and serving after a restart; its next save is refused with the closure verdict (`422 INVALID_METADATA`; for a list view, `list-view-object-outside-closure`).
- **Published signatures.** `SchemaRegistry.updatePackageManifest` (`@objectstack/objectql`) and `ObjectStackProtocolImplementation.updatePackage` (`@objectstack/metadata-protocol`) each accept an optional `dependencies` row in their patch. No export is added, removed or renamed.
