---
'@objectstack/runtime': patch
---

fix(runtime): a job name a package body declares and the artifact's top level carries too is attributed to neither, never to the body (ADR-0150 D3)

Clause-②: no (narrowing)
Metadata-protocol: none

<!-- adr-0087: not-required (no-migration-prescription) no metadata shape, schema, stored row or registered node type changes: the change is which package a job's pull runs as when an artifact's top level and one of its package bodies both carry the job name, the stored metadata is read exactly as before, so there is nothing for `objectstack migrate meta` to rewrite -->

**BREAKING** (first-party count 0: no example app or first-party package declares a job `pull`, and the one first-party multi-package artifact, `examples/app-multi-package`, declares no jobs and composes no manifest-less stack).

`composeStacks(…, { manifest: 'preserve' })` with an input that has no `manifest` writes that input's jobs to the artifact's top level and to no package body (the ADR-0130 residual), beside the flattened copy of every body's jobs. When such a job shares its name with a body's job, an artifact loaded from JSON meets both by name, and the binder attributed the residual's job to the body: its pull ran as that body's package (`callerPackageId`) and read that package's mappings.

FROM → TO: each run of such a job was pulled as the declaring body's package. It is now refused before any call or write, `409 RESOURCE_CONFLICT` (`ambiguous-in-environment`), naming the declaring body and the residual, and the job run records the failure — unless the residual's own package (the body that carries the artifact's id) IS that one declaring body, which answers that package as before. The residual is recognised by count: the artifact carries more jobs of the name than its package bodies declare. A residual job with a name of its own, and a body's job no residual job shares a name with, run as before.

The fix: rename the top-level job, or the package body's, so each job name has one declaring holder.
