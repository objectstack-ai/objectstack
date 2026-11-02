---
'@objectstack/metadata': minor
'@objectstack/spec': minor
---

fix(metadata): a `packages[]` stack's top-level dataset that no package body declares is registered under the stack's own manifest id, like every other residual item

Clause-②: no (narrowing)
Metadata-protocol: narrowed
Skills-docs: none — no file under `skills/**` teaches a `packages[]` stack's top level, its residual, or a `_packageId` stamp on a top-level dataset; every taught dataset sits in a single-package stack, which has no residual, so every taught use stays true.
<!-- adr-0087: not-required (no-migration-prescription) No key of any schema is added, removed, renamed or re-shaped, and no export or type changes. The narrowed face is the existing owner-stamp judge now reaching one more collection of a `packages[]` stack's top level: a residual dataset wearing another package's `_packageId`. No conversion can rewrite it, because which package owns the dataset is the author's decision (drop the stamp, or move the dataset into the `packages[]` entry of its owner), and the stack that carries it used to lose the dataset at boot anyway, so there is no working stored state for a migration to preserve. -->

A stack that carries `packages[]` registers each package body under its own id, and what its top level carries that no body declares (the residual, ADR-0130 D4) under the stack's `manifest.id`. The residual rule did not walk `datasets` (the ADR-0021 analytics datasets a dashboard or report names), so such a dataset was neither registered nor refused: the boot succeeded, `GET /meta/dataset` listed only the bodies' datasets, and a dashboard or report naming the missing one failed at run time, far from the cause.

- **What changes.** `datasets` now maps to the `dataset` metadata type at the artifact door. A residual dataset is registered under the stack's manifest id and version through both boot doors, in the metadata service and in the ObjectQL registry, and the boot's residual `warn` line counts it with the other residual items. A top-level dataset that a body repeats stays the body's, registered once.
- **What is refused now (narrowed).** A residual dataset wearing a `_packageId` other than the stack's own `manifest.id` is refused, at the build door (`ObjectStackDefinitionSchema`, so `defineStack` / `os build` / `os validate`, with an issue at `datasets.N._packageId`) and at the boot (`VALIDATION_ERROR` 400, the owner-stamp refusal both residual registrars already apply to every other residual item). It used to parse and then be dropped at boot with nothing said. Fix: drop the stamp, or declare the dataset inside the `packages[]` entry of the package that owns it. The build-door mirror `TOP_LEVEL_COLLECTIONS_NEVER_RESIDUAL` (`@objectstack/spec`, not exported) loses `datasets` and keeps `data` and `jobs`.
- **What else the artifact door now registers.** Every package body's datasets also reach the metadata service from a compiled artifact, stamped with their package's provenance. A sealed (`bootstrap: 'artifact-only'`) runtime used to answer an empty `GET /meta/dataset` for a package that ships datasets; it now lists them. The seed `data:` collection is unchanged and still never registered as metadata items.
