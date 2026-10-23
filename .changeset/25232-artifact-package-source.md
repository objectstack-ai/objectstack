---
'@objectstack/spec': minor
'@objectstack/core': minor
'@objectstack/objectql': minor
---

feat(spec,core,objectql): one package entry of a release artifact may state its own `source`, and the registry records it

Clause-②: yes (widening)
Metadata-protocol: added

`ArtifactPackageSchema` (one `packages[]` entry of an assembled release artifact) gains an optional `source: 'code' | 'marketplace'` beside `manifest`. The values are the new `ArtifactPackageSourceSchema`, the subset of `InstalledPackageSourceSchema` a load path can register; `authored` and any other value are refused at the entry gate as `INVALID_ARTIFACT_PACKAGE_ENTRY` (422).

The `manifest` service registers each package with the `source` its entry states, so a merged artifact that carries marketplace installs beside the deployment's own code lists them as `marketplace` on `GET /api/v1/packages`. An entry that states nothing takes the registering door's statement as before (`register(artifact, { source })`, `code` when absent), so existing artifacts register unchanged. An entry's own statement wins over the door's.

`@objectstack/core` adds `resolveArtifactPackageEntries(artifact)`, which returns each package to register as `{ manifest, source? }` in dependency order. `resolveArtifactPackageOrder` is unchanged and still returns the bodies alone.
