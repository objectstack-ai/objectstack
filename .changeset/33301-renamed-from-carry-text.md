---
'@objectstack/spec': patch
---

docs(spec): `PositionSchema.renamedFrom` and its liveness evidence say when the holder carry runs

Clause-②: no
Metadata-protocol: none

The `renamedFrom` description said the holders of an old position name move at boot only. Since the carry also runs after a running kernel announces a reload, the description now says both: holders move at boot, and again when a running kernel announces the position or its package as registered (a hot install, a per-item publish of the position, a publish of drafts). A hot upgrade over a version the kernel still serves, a package install or enable that does not announce, and an artifact reload that names only its file are carried at the next restart. The `renamedFrom` row in `liveness/position.json` names the same two runs. No schema, accepted value or behaviour changes.
