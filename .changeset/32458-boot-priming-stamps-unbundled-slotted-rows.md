---
'@objectstack/metadata': patch
---

fix(metadata)!: the boot priming pass hands an unbundled slotted type's row on stamped with its row's package, so a save never inserts a package-less row (#32458)

Clause-②: yes (narrowing) — on a host that wires a `DatabaseLoader` (none in the workspace), after the boot priming pass a `MetadataManager.get(type, name, packageId)` of an `agent`, `skill`, `action` (object-less), `api` or `permission` whose name is held by stored rows bound to their packages by the `package_id` column alone, naming a package that holds no row of the name (the host's own `packageId` included), answers nothing, where it served another package's body. The other moved answers correct an attribution and refuse nothing: the same read naming a package that holds a row of the name answers that package's own body, where it served the body of the row saved last.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes: what moves is the package a stored body is handed on with and registered under at boot, and no stored row records that, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for one caller: a host that wires a `DatabaseLoader` and reads a by-package type at boot naming a package that holds none of its rows of the name now gets nothing instead of another package's item. Name the package that holds it, or read with no package. Nothing in the workspace wires the loader.

This applies #31699's shape (already in place for `email_template`) to every type stored per `(package, name)`: `api`, `agent`, `skill`, `action` and `permission`, the unbundled members of `PACKAGE_SLOTTED_STORE_TYPES`.

- `MetadataManager.loadMany` reads these types through a loader's keyed entries. A row bound to its package by the `package_id` column alone is handed on stamped with that package (`_packageId`), FROM unstamped. One item per name is still answered, the row saved last.
- `DatabaseLoader.loadManyKeyed` entries carry the row's `packageId` for these types (FROM only for `email_template`). The entries themselves are unchanged: one per name, the row saved last.
- `DatabaseLoader.save` of these types, when the body differs from its row only by a `_packageId` stamp naming that row's own package, writes nothing (no update, no new version, no history row). Before, it wrote a new version.
- So with two packages' rows of one name, a body registered back from `loadMany` without the boot pass's source skip (`skipSourceLoader`) no longer inserts a package-less row (FROM a new package-less row at the next version). The boot pass itself already wrote nothing. Now it registers the row under its own package's slot, FROM the name's package-less slot, or the host's slot on a host that declares a `packageId`. With one holder, a bare read still answers that holder, now stamped with its package.

Not changed, and declared: the boot pass still primes one row per name for these types, so a bare read of a name two packages hold answers the row saved last, as before. Reported as a separate finding, not changed here.
