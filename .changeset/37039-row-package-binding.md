---
'@objectstack/spec': patch
'@objectstack/metadata': patch
---

feat(metadata): `listPackageBindings` reads an item's package from its stored row's package column, never from its body

Clause-②: yes (widening)
Metadata-protocol: none

The protocol records which package an item belongs to on its stored row, in the package column the store's write path fills. No read answered that column: `list` returns bodies, so a caller had to take the binding off a body's `_packageId` stamp, which is whatever the row's author wrote.

- `IMetadataService.listPackageBindings?(type)` (new, optional, `@objectstack/spec/contracts`) answers every item `list(type)` answers, in its order, as a `MetadataPackageBinding`: `{ name, data, packageId, source }`, with `degraded` / `errors` as `listDiagnosed` reports them.
  - An item a stored row holds answers `source: 'row'` and that row's column. A row written before the column answers `packageId: null`, whatever package its body names. This includes the registry's copy of a row that the boot priming pass registered.
  - An item no stored row holds (registered by code, or held by a loader of no rows) answers `source: 'registration'` and the package its registration files it under, as before.
- `MetadataManager.listPackageBindings` implements it. `DatabaseLoader` gains `loadRowBindings(type)` (its `loadManySlots` entries, each with the row's column as `rowPackageId`) and `rowPackageIdOf(item)`. Both are declared optional on `MetadataLoader`, and the new entry type is exported as `MetadataRowBinding`.

Every existing read is unchanged.

What to do: nothing. A consumer that decides by an item's package (for example, which app a skill belongs to) can switch from the body stamp to `listPackageBindings` and treat a `degraded` answer as unknown.
