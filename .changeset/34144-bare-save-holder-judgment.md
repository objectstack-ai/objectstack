---
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: a bare save or delete of a name only disabled packages hold is refused, naming no package (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export changes shape. The moved answers are write doors under a reversible package state: no stored row is rewritten, so there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING** for a writer that saves or deletes a name without naming a package (`PUT` or `DELETE /meta/:type/:name` with no `?package=`, or `saveMetaItem` / `deleteMetaItem` with no `packageId`) while every package that holds the name is disabled. A disabled package holds no name (ADR-0150 D3), so the bare read of such a name answers 404. The bare write now answers the same way: it is refused `409 RESOURCE_CONFLICT`, names no package, and points to `?package=` (the existing refusal family, no new code). Measured on a booted kernel through the runtime dispatcher and `RestServer`, in both registration orders:

- A publish-mode bare save of a name whose only holder D is disabled used to answer 200. Over D's row alone it updated D's row; over no stored row it wrote a package-unbound row that every read then withheld. It is now refused, and nothing is written.
- A draft-mode bare save (`?mode=draft`) of such a name used to write a package-unbound draft. It is now refused the same way.
- A bare delete of such a name used to remove D's row. It is now refused, and D's row stays.

**Not moved.** A write naming the package (`?package=D`, `packageId`) answers as before. So do a name one enabled package holds, a name an enabled and a disabled package both hold, a name no package holds (the environment's own item), and a package-unbound row stored at the address: the save edits that row and the delete removes it, as before. Once the package is enabled again, every bare write answers as before.

**No migration.** No schema key or stored row changes. To write a disabled package's item, name the package, or enable it again.
