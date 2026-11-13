---
'@objectstack/metadata': patch
---

fix(metadata): a write that rewrites an environment row the boot pass stamped with the host keeps it the environment's, so unregistering the host package keeps it in this process and after a restart

Clause-②: no — no released answer moves: `@objectstack/metadata@18.3.0`'s `unregisterPackage` never removed an item named only by the `_packageId` stamp, so these rows were kept there too; #32198 (unreleased) is what turned the rewrite into a deletion. The registry entry keeps the stamp, so the ObjectQL owner of such an object does not move.
Metadata-protocol: none

On a host that declares its package and stores metadata in a database, the boot pass stamps each stored row that names no package with the host's package, and `unregisterPackage(host)` leaves such a row (#32986). That held only until something rewrote the row: a write that registered a copy still stamped with the host dropped the mark and stored the stamp in the row's body, so the row then read as the host's own, in that process and after a restart, and `unregisterPackage(host)` deleted it. The writers that do this: ObjectQL's late-manifest bridge when another package extends the environment's object (and its restore when that package is withdrawn), ObjectQL's object-copy follow, `publishPackage` and `revertPackage` of the host, and `importMetadata` with `conflictResolution: 'merge'`.

Now a copy that replaces such a row and still carries the host's stamp keeps the row's mark, and the row is stored without the host stamp (at the top and in the publish envelope's `metadata` body), so the next boot reads it as the environment's own again. The host's own rows, a copy that names the host by its own `packageId` or `package` key, a copy stamped with another package, and a stored row another writer re-saved naming the host are removed as before. A `draft` row is treated like an `active` one. Types stored per `(package, name)` are unchanged here.
