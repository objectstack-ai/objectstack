---
'@objectstack/metadata': patch
---

fix(metadata): unregistering the host package keeps the environment's own object, view, app, hook and dashboard rows

Clause-②: no — no released answer moves: `unregisterPackage` reads the `_packageId` stamp since #32198, which has not shipped, and with this change it leaves the environment's own rows as the released version does. The boot pass's stamp, and every reader of it, answer as before.
Metadata-protocol: none

On a host that declares its package and stores metadata in a database, the boot pass stamps each stored row that names no package with the host's package. For a type not stored per `(package, name)` — `object`, `view`, `app`, `hook`, `dashboard` and the rest — that stamp stays, so ObjectQL still registers such an object as the host package's contribution. But `MetadataManager.unregisterPackage(host)` took the stamp as membership and deleted those rows, from memory and from the database: the environment's own items were lost when the host package was unregistered.

`unregisterPackage` now leaves an item that a stored-row loader handed on naming no package and that names the package only by the stamp. The host's own items (a row whose stored body carries the host's stamp, an item registered for the host in memory or from files) are removed as before. Types stored per `(package, name)` are unchanged here.
