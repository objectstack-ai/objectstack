---
'@objectstack/metadata': patch
---

fix(metadata): a `packages[]` stack's top-level dataset that no package body declares is registered under the stack's own manifest id, like every other residual item

Clause-②: no
Metadata-protocol: none

A stack that carries `packages[]` registers each package body under its own id, and what its top level carries that no body declares (the residual, ADR-0130 D4) under the stack's `manifest.id`. The residual rule did not walk `datasets` (the ADR-0021 analytics datasets a dashboard or report names), so such a dataset was neither registered nor refused: the boot succeeded, `GET /meta/dataset` listed only the bodies' datasets, and a dashboard or report naming the missing one failed at run time, far from the cause.

- **What changes.** `datasets` now maps to the `dataset` metadata type at the artifact door. A residual dataset is registered under the stack's manifest id and version through both boot doors, in the metadata service and in the ObjectQL registry, and the boot's residual `warn` line counts it with the other residual items. A top-level dataset that a body repeats stays the body's, registered once.
- **What else the artifact door now registers.** Every package body's datasets also reach the metadata service from a compiled artifact, stamped with their package's provenance. A sealed (`bootstrap: 'artifact-only'`) runtime used to answer an empty `GET /meta/dataset` for a package that ships datasets; it now lists them. The seed `data:` collection is unchanged and still never registered as metadata items.
