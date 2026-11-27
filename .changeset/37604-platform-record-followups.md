---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
---

fix(metadata)!: a version the platform registered is never restored into a package's row, and adopting orphans leaves the platform's own record where the platform keeps it

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no `skills/` page teaches restoring a platform-registered version, adopting orphans over the platform's record, or `listPackageBindings`

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped, and no stored row is rewritten. What moves is that the three restore doors refuse a restore they wrote before, and that the adoption of orphans leaves one kind of row it rebound before; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING**, in two places, each a write that happened before and is now refused or left out:

- **A version the platform registered is never restored into a package's row**, at all three restore doors: the metadata service's `rollback`, and the metadata protocol's `rollbackMetaItem` and the restore limb of `revertCommit`. Refused with `409 RESOURCE_CONFLICT`, naming the fix, nothing written (`revertCommit` reports the item in `failed[]` and still reverts the commit's other items). Before, once the platform had withdrawn its record of a name, the name's one remaining holder was a package, a version attributed to the environment counted as that package's, and a rollback (naming the package or bare) wrote the platform's body into the package's row; `revertCommit` of a package's commit did the same wherever the commit's version was one the platform registered.
  What to do: to make that body the package's item, save it again naming the package.
- **`POST /api/v1/packages/:id/adopt-orphans` (`reassignOrphanedMetadata`) leaves the platform's own record**, the package-less row whose body carries the platform's mark: it is the record the platform registers at every boot, not an orphan. Before, the adoption rebound it to the target package, mark and all. Every other orphan is adopted as before.
  What to do: nothing.

Also in `@objectstack/metadata`:

- `isPlatformRecordRow(row)` is exported: the one reader of whether a stored row is the platform's own record (its package column names no package, its body carries the platform's mark and names none), asked by `refusePlatformRecordRestore`, the metadata protocol's overlay census and its adoption of orphans, so they cannot disagree. `refusePlatformRecordRestore` now reads a row bound to a package by its column as that package's, whatever its body keeps, and takes an optional fourth argument, the version a restore would write and the package whose row it writes.
- The refusal of a restore whose row is the platform's own record now says that re-saving a version's body as the environment's own item holds until the platform's next registration at boot writes its record back.
- `listPackageBindings` names a loader that the read lost once in `errors`, and does not read that loader's rows a second time.
