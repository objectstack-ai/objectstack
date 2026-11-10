---
'@objectstack/runtime': patch
'@objectstack/service-automation': patch
'@objectstack/spec': patch
---

fix(runtime, service-automation): a job's connector pull reads its mapping from the package that declares the job (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which mapping a job's pull reads when it names its package, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

The job binder now hands each `pull` job's run the package that declares the job as `ConnectorSourcePullRequest.callerPackageId`: in an artifact of several packages, the package body that declares the job, never the top-level id the job service keys every job under; a top-level job no body declares, and every job of a single-package artifact, is the app's own. The connector pull reads the mapping from that package: its own mapping, else the one holder in its declared dependency closure plus `sys`, else a refusal naming every candidate (`409 RESOURCE_CONFLICT`, reason `mapping_name_refused`, before any call or write). A pull that names no package reads as before.

What moves (first-party count 0 for each: no example app or first-party package declares a job `pull`):

1. A mapping name two packages hold, one of them the job's package: the pull was refused with `409 RESOURCE_CONFLICT` naming both. It now pulls through the job's own package's mapping.
2. **BREAKING** — a job in one package body pulling a mapping only another body of the same artifact declares, where the job's body does not depend on it (ADR-0150 D3 (c)): it pulled through that mapping. It is now refused, `409 RESOURCE_CONFLICT` naming the holder, and the job run records the failure. The fix: declare the dependency in the job's package (`manifest.dependencies`), or move the job or the mapping so they share a package.
3. ADR-0150 D3 (a), a package caller whose mapping name only the environment holds, is refused naming the environment. No job reaches it: the binder schedules a pull only when the artifact itself declares the mapping. A direct `pullConnectorSource` call that passes a package can.

A runtime row stored under a package mapping's name is that mapping's overlay (ADR-0005) and is served as before, whichever caller asks.

Supersedes, in the same release: the `32071-mapping-name-by-package` entry's "the pull does not yet read the `callerPackageId` its request carries": it now reads it.
