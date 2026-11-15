---
'@objectstack/spec': patch
---

docs(spec): `PositionSchema.renamedFrom` counts the runtime package install, the enable of a disabled package and a hot upgrade among the cases carried at once

Clause-②: no
Metadata-protocol: none

The `renamedFrom` description listed a hot upgrade over a version the kernel still serves, and a package install or enable that does not announce, among the cases carried at the next restart. Both are now carried at once: the runtime package install and the enable of a disabled package announce the package, and a hot upgrade's re-register withdraws the position the new version no longer ships. A package still disabled when it is announced is carried when it is enabled; an artifact reload that names only its file is still carried at the next restart. No schema, accepted value or behaviour changes.
