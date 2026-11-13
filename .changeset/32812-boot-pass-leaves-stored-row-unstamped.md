---
'@objectstack/metadata': patch
---

fix(metadata)!: the boot priming pass leaves a package-less stored row of a type stored per `(package, name)` unstamped, so the host's package is never counted as a holder of its name (ADR-0150 D4)

Clause-②: no (narrowing) — on a host that declares its package (`MetadataPlugin`'s `packageId`) and wires a `DatabaseLoader`, a package-less `sys_metadata` row of `api`, `agent`, `skill`, `action`, `email_template`, `permission`, `flow`, `picklist`, `mapping` or `dataset` is no longer served as the host package's item after the boot priming pass: its body no longer carries `_packageId` set to the host's package or `_provenance: 'package'`, the metadata list filtered by the host's package (`?package=` naming it) no longer lists it, and `publishPackage`, `revertPackage` and `unregisterPackage` naming the host's package no longer take it as one of that package's items. The `409` this lifts (the bare read naming the host's package, which holds nothing, after a write that carries no package) is #32560's, which has not shipped.
Metadata-protocol: none — no key, value or metadata type an author writes changes; what moves is which package the boot pass gives a stored row that names none.

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type of the package root changes. What moves is the package the boot priming pass stamps on a stored row that names none, at every boot; nothing at rest is rewritten (the pass writes no row back), so there is nothing for objectstack migrate meta to rewrite and no tombstone. -->

**BREAKING** for a host that declares its package and stores rows that name no package for one of these ten types. Such a row is the environment's own item, or the customization of the one package that holds its name (ADR-0150 D4); it was never the host package's, but the boot pass stamped it so. To keep an item in the host's package, save it naming that package (`?package=` on the write, or `packageId` on `register`). A row whose stored body an earlier release's boot pass wrote the host's stamp into is still read as the host package's (its column is bound from that body), and is not moved. Every other type, and the host's own file items, are stamped as before. No first-party package, app or example declares a package and wires a `DatabaseLoader`.

Moved answers, all on such a host, each now the answer the same composition gives on a host that declares no package:

- One package's row and a package-less row saved last (`action`): after `register` with no package, or `registerInMemory` of a package-less item, the bare `get` and `getDiagnosed` go from `409 RESOURCE_CONFLICT` naming the host's package, the holder and the environment to the written item. The removal naming no package goes from that `409` to removing the package-less row, so it names the holders the bare read names.
- The same composition, every one of the ten types: the registry holds the package-less row in the name's bare slot, not the host's; a read naming the holder answers its customization (the package-less row) where it answered the holder's own row; on a host declaring the holder's package, a read naming another package that holds nothing answers the package-less row, as the bare read does.
- A package-less row and one package's `action` item registered in memory after the pass: the bare read answers that package's item, where it answered the package-less row (the by-host difference #32752 tracked).
- The package-less row deleted from the table behind the manager: the bare read answers the registry's copy, where it was refused naming the host's package and the holder.
- `email_template`, one package's row and a package-less row: the bare read after the pass is no longer refused naming the host's package.

This replaces #32791's read-time filing of the stamped row (`MetadataManager`'s record of stored package-less rows, its overwrite mark and the judged view's filing), which has nothing left to file and is removed; every #32791 pin marked CONTROL passes unchanged. Candidate order in a refusal is not promised.

Skills-docs: none — `skills/**` and `content/docs/**` do not teach that the boot pass gives a stored row the host's package; the migration step ships here and in the upgrade notes.
