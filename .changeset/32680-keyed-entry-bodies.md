---
'@objectstack/metadata': patch
---

fix(metadata)!: `MetadataManager.loadMany` takes a by-package name's bodies and packages off the loader's keyed entries, so a boot no longer turns a name two packages hold into one body when another row's body says that name; `loadManyKeyed` entries carry their package (#32680)

Clause-②: yes (narrowing) — narrowed: on a host that wires a `DatabaseLoader` (none in the workspace), after the boot priming pass a read naming no package (`MetadataManager.get`, `getDiagnosed`) of an `api`, `agent`, `skill`, `action`, `permission`, `flow`, `picklist`, `mapping`, `dataset` or `tool` name two packages' rows hold, beside another row whose body says that name, is refused `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`, naming both packages), where it served one of those bodies; the same read without the pass already refused. Widened: `MetadataManager.loadManyKeyed` entries carry `packageId` (the package the loader holds the entry for), where they carried the key and the body only.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no stored row changes: what moves is which package a plural read stamps on a body it hands on, which the boot pass then registers, and a field a keyed entry carries beside its body, none of which a stored row records, so there is nothing for `objectstack migrate meta` to rewrite. -->

**BREAKING** for one kind of host: a host that wires a `DatabaseLoader` and, after the boot, reads with no package a name two packages' rows hold while a third row's body also says that name, now gets `409` naming both packages instead of one body. Name the package that holds it, or rename one of the two.

What moves, for every unbundled type in `PACKAGE_SLOTTED_STORE_TYPES`, on a loader that holds items per package (`loadManySlots`: `DatabaseLoader`, the artifact door's `MemoryLoader`):

- `MetadataManager.loadMany` hands on each of the loader's keyed entries' own bodies, stamped (`_packageId`) with the package the loader holds that entry for when the body carries the entry's key as its `name`, FROM `loader.loadMany`'s bodies paired to the keyed entries by their serialisation. A body the keyed read cannot name (a row whose `name` column is empty) is still handed on after them, unstamped.
  - A name two packages hold, beside another row whose body says that name: each holder is handed on stamped with its own row's package and the other row's body unstamped, FROM all of them unstamped and the first one alone handed on. The boot pass then fills each package's slot and files the other row's body in the name's bare slot, FROM filing the one body in the bare slot. After the pass a bare read is refused `409` naming both packages, FROM serving that body; for `action` the refusal also names `platform`, as an action name's package-less registry slot no loader stores under that name is counted (the other row is stored under its own key). A read naming either package answers that package's own body, as without the pass.
  - A name one package holds, beside another row whose body says that name: the holder is handed on stamped with its row's package, FROM unstamped. The boot pass fills the holder's slot, FROM the bare slot, so after the pass a read naming a package that holds no row of the name answers nothing, as without the pass, FROM the holder's body.
  - A loader whose `loadMany` and `loadManyKeyed` serialise a body differently (key order): both holders of a two-holder name are stamped, FROM neither.
- `MetadataManager.loadManyKeyed` entries carry `packageId` where the loader's entry carries one (every type stored per `(package, name)`, `email_template` included), FROM `{ name, data }` alone. objectql's action audit, which reads it, can now tell two packages' entries of one name apart.

Not changed: a name one package holds with no other row's body saying it, a name no package holds, and a loader that does not hold items per package (its bodies are handed on as its `loadMany` answers them). `loadMany` and `loadManyKeyed` hand on as many entries as before for every shape above but the two-holder one, where the other row's body is now kept beside both holders.
