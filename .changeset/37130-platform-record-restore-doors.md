---
'@objectstack/metadata': patch
'@objectstack/metadata-protocol': patch
---

fix(metadata-protocol)!: the protocol's restore doors refuse a restore whose row is the platform's own record, and the history selector never addresses the package-less row for a package that neither holds nor ships the name

Clause-②: yes (narrowing)
Metadata-protocol: none
Skills-docs: none — no `skills/` page teaches the protocol's restore doors, the history `?package=` selector or `listPackageBindings`

<!-- adr-0087: not-required (no-migration-prescription) No schema key, accepted value or metadata type is added, removed, renamed or re-shaped, and no stored row is rewritten. What moves is that two restore doors and the history selector refuse requests they wrote or answered before, and that the metadata service files and reports a stored row's binding by its package column; there is nothing for a migration to rewrite and no tombstone. -->

**BREAKING**, in two places, each a refusal of a request that was answered before:

- **The metadata protocol's `rollbackMetaItem` and the restore limb of `revertCommit` refuse a restore whose row is the platform's own record** (the row `MetadataManager.register(…, { origin: 'platform' })` writes), with the refusal the metadata service's `rollback` gives: `409 RESOURCE_CONFLICT`, naming the fix, nothing written. `revertCommit` reports that item in `failed[]` and still reverts the commit's other items. Before, both doors wrote the version back without the platform's mark, so the row stopped being the platform's record, and a process primed from the rows answered a read naming the name's one package holder with the platform's old body until the platform registered again.
  What to do: nothing for a package's or the environment's own item. To restore an earlier version of a package's item of the name, name that package; to make an earlier version the environment's own item of the name, save that version's body again.
- **The history, diff and rollback doors' `?package=` selector refuses a package that neither holds a row of the name nor ships it** with `409 RESOURCE_CONFLICT` `not-held-by-qualifier`, naming every holder, as its description states, also when the name's package-less row is stored. Before, such a package addressed the package-less row a read naming it falls back to, and read or restored that row's versions. The package-less row is a package's slot only when the package ships the name.
  What to do: address the package-less row through the package that ships the name, or bare when no other row of the name is stored.

Also in `@objectstack/metadata`:

- `refusePlatformRecordRestore(type, name, row)` is exported: the one refusal the service's `rollback` and the protocol's two restore doors ask, so the three cannot disagree.
- `list()` lists a stored row whose body's `_packageId` stamp differs from its package column once, under the column, after the boot priming pass, where it listed the row twice (the primed copy under the stamp). A read naming the column's package answers it, as on a process that never primed it.
- `listPackageBindings` is `degraded`, naming the loader in `errors`, when a loader of stored rows (`datasource:`) offers no `loadRowBindings`: the items it holds answer their registration's binding, which is not their rows'. No such loader ships in this repository.
- A node whose boot priming pass finds a legacy row already bound by another node answers the bound package for that row's item, where it answered `null` (fail-closed) until it restarted.

Also in `@objectstack/metadata-protocol`:

- `SysMetadataRepository.restoreVersion` takes `refusePlatformRecord: true` to ask `refusePlatformRecordRestore` (`@objectstack/metadata`) on the row it writes; the undo writes do not pass it.
