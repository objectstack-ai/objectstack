---
'@objectstack/metadata': patch
---

fix(metadata): `unregisterPackage` keeps and reports the stored rows that name the package by the `_packageId` stamp alone unless forced, the boot and the operator migration bind no `package_id` column from such a row, and `detectStampOnlyRows` reports each with its history evidence (#32985)

Clause-②: yes (widening) — additive in-process surface: `MetadataManager.unregisterPackage` takes an optional second argument `{ force }` and answers a result where it answered nothing; `@objectstack/metadata` exports the types `MetadataUnregisterPackageOptions`, `MetadataUnregisterPackageResult` and `MetadataStampOnlyRow`; the optional loader method `MetadataLoader.stampOnlyRows` is new (`DatabaseLoader` implements it); `@objectstack/metadata/migrations` exports `detectStampOnlyRows` and its types; `DatabaseLoaderRowLeftReason` gains `'stamp-only'`. No metadata an author writes is accepted or refused differently.
Metadata-protocol: none

**Upgrade note — environment rows stamped with the host by 17.0.0–18.3.0.** Every `@objectstack/metadata` from 17.0.0 through 18.3.0, in one composition — a `MetadataPlugin` that declares its `packageId`, an eager bootstrap with no `artifactSource`, and a `DatabaseLoader` on the metadata service — saved each package-less row its boot pass read back into the database stamped with the host's package (`_packageId`, `_provenance: 'package'`), with a new version and a history row. Those rows are the environment's own, but read as the host's: listed as the host's items; a phantom holder of a name a package also holds (a bare read of such a name refused `409`); and deleted, row and registry entry, by `unregisterPackage(host)` until this release. An 18.4.0 boot also bound the `package_id` column of each such row of a type stored per `(package, name)` (`agent`, `flow`, `tool`, `action` …) to the host. From the row alone such a row cannot be told from a row of the host's own item, which carries the same stamp; its history can. Measured on a database an 18.3.0 boot built (37 rows): 34 deleted by `unregisterPackage(host)` before this change, 0 after; a never-stamped control 0 both ways.

- **Find them:** `detectStampOnlyRows(driver, { packageId: 'com.acme.host' })` from `@objectstack/metadata/migrations` is read-only (`find` only). It lists each row whose body names a package by `_packageId` alone, its column empty or naming that package, with a verdict from the row's own history: `stamp-added` (a version that named no package, then one that added the stamp — the environment's row; `onlyStampAdded` marks the boot's signature), `stamped-since-create` (the package's own row), or `undetermined` (no history reaching back far enough).
- **Repair one by hand,** for a row reported `stamp-added`, on a backup: remove `_packageId` and `_provenance` from its stored body and, if an 18.4.0 boot bound it, set its `package_id` back to empty, in one update. No migration rewrites these rows yet; one is deferred until an install reports a non-zero count.

**What moves.**

| Door | FROM | TO |
|:---|:---|:---|
| `unregisterPackage(P)` over an item a loader stores in a row whose `package_id` is empty and whose body names P by `_packageId` alone, any `source` | the item and its rows removed | kept — registry entry and rows — and reported in the result's `kept` (`reason: 'stamp-only-row'`, each row's loader, id and `source`) and in one `warn` naming the remedy; every row is checked before the first removal, so a failed check removes nothing |
| `unregisterPackage(P, { force: true })` | — | removes those items too, as before this change |
| `unregisterPackage(P)` over an item whose stored body names P by its own `packageId` (or the legacy `package`), or whose column is bound | removed | removed (unchanged) |
| The boot's column-only bind (`DatabaseLoader.bindReadRowPackage`) of a legacy row whose body names its package by `_packageId` alone | `package_id` bound to that package | left empty; a row of a package's item whose code still ships is bound by that item's own save, the column only, on the same boot |
| `migrateDatabaseLoaderRowPackages` over such a row | bound | left, reason `'stamp-only'` |

A false positive is the cost: a row of the package's own item stored with its stamp alone (an item the boot pass seeded from a file, a type not stored per `(package, name)`) is now kept by `unregisterPackage` until forced, and a legacy row whose package's code no longer ships it stays unbound; reads of both are unchanged. An environment row is never removed or bound to the host by its stamp.
