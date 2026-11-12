---
'@objectstack/spec': patch
---

docs(spec): the protocol upgrade guide names the two flow by-name reads that the flow-per-namespace change (ADR-0150 child B) now refuses, a bare read of a name two packages hold and a package's read of a flow it cannot reach

Clause-②: no
Metadata-protocol: none

- **What.** One new semantic migration entry in protocol 18's step of the upgrade guide and `os migrate meta`: `flow-by-name-read-shared-or-unreachable-refused`. The flow-per-namespace changeset (`31696-flow-names-per-namespace.md`) declared that narrowing with the `not-required (no-migration-prescription)` exemption, which the ADR-0087 gate no longer accepts on a declared `Metadata-protocol: narrowed`; its marker now reads `registered` with this entry.
- **What the entry says.** A bare read of a flow name two packages of two namespaces hold (`GET /api/v1/meta/flow/NAME`, `MetadataManager` for type flow with no package) answers `409 RESOURCE_CONFLICT` naming both, and a package's by-name read of a flow only the environment holds, or one a package outside its declared dependencies holds, is refused naming the holders (ADR-0150 D3). The fix: read each flow by its package (`?package=ID`, `/api/v1/meta/flow/NS/NAME`), or declare a dependency on the package that ships the flow (ADR-0141), or ship the flow in the reading package.
- **No automatic rewrite.** Which package a caller meant is a judgement only the caller can make; no schema key moves and no stored row changes shape.
- **Not changed.** No schema, export or accepted input moves: the refusals shipped with the flow-per-namespace change, and this is their guide entry.
