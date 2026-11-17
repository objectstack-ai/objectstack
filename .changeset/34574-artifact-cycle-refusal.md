---
'@objectstack/core': patch
'@objectstack/spec': patch
'@objectstack/cloud-connection': patch
---

fix(core): a composed artifact whose packages depend on each other in a cycle is refused as `422 CYCLIC_ARTIFACT_PACKAGES` naming the cycle, and install-local answers every artifact-resolver refusal instead of a 500

Clause-②: yes (widening)
Metadata-protocol: none

- `@objectstack/core`: `resolveArtifactPackageEntries` / `resolveArtifactPackageOrder` refuse packages that depend on each other in a cycle with the ADR-0112 envelope their other refusals carry: `code: 'CYCLIC_ARTIFACT_PACKAGES'`, `status: 422`, and `details.cycle` listing the package ids along the cycle (each depends on the next, the first repeated last). Before, the cycle was a bare `Error` with no `code` or `status`. A caller that matched on the old message still finds `Circular dependency detected` in it. `resolvePluginOrder` now throws its cycle as `PluginOrderCycleError`, a new exported `Error` subclass that carries `cycle`. Its message is unchanged and it carries no `code`, so a kernel boot that hits a plugin cycle reads exactly as before.
- `@objectstack/spec`: `CYCLIC_ARTIFACT_PACKAGES` is registered in `ERROR_CODE_LEDGER` under `@objectstack/core`, so `ErrorCode` accepts it.
- `@objectstack/cloud-connection`: `POST /api/v1/marketplace/install-local` answered `500 INTERNAL_ERROR` with no reason for a composed artifact the resolver refuses: a `packages` that is not a list, a malformed entry, a duplicate package id, or a dependency cycle. On a real runtime, the step that judges the package's jobs and hooks reads the packages first and let the refusal escape. That step now answers the refusal itself, with its own status, code and `details`, and nothing is written. Every other step that reads the packages already did.
