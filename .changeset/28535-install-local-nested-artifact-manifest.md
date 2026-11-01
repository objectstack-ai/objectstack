---
'@objectstack/cloud-connection': patch
---

fix(cloud-connection)!: install-local reads the manifest of a compiled artifact as `os package install <file>` sends it, so the protocol handshake and the dependency check run on it (#28535)

Clause-②: no (narrowing) — `POST /api/v1/marketplace/install-local` refuses, with the 422 `OS_PROTOCOL_INCOMPATIBLE` (or `DEPENDENCY_MISSING`) the flat manifest already got, a compiled artifact sent with `id` and `version` lifted beside its nested `manifest`, whose `engines.protocol` excludes this runtime or whose `dependencies` this runtime does not satisfy. That body installed before. Nothing is widened.
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes: the install door's existing ADR-0087 handshake and ADR-0141 dependency check now read the keys of a compiled artifact the CLI sends, as they already read a flat manifest and a bare compiled artifact. The refusals are the existing shared answers, so there is nothing for a migration to rewrite. -->

**BREAKING** accept-set narrowing at `POST /api/v1/marketplace/install-local` (`@objectstack/cloud-connection`), reached by `os package install ./dist/objectstack.json`.

The door flattened a compiled artifact (`{ manifest: { … }, objects, … }`) only when the body had no top-level `id` or `name`. Every published CLI lifts `id` and `version` to the top beside the nested `manifest`, so that body was never flattened and the keys the install checks read at the manifest top level stayed one level down: an artifact built for another protocol installed with a "declares no engines.protocol range" warning, and an unmet dependency was never judged. The door now detects a compiled artifact by its nested `manifest` object alone, through the one flatten it already uses for the unmanaged import, so every sender's body is judged the same way. A compatible artifact installs as before, without the false warning.
