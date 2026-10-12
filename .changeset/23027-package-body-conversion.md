---
'@objectstack/metadata-core': patch
---

fix(metadata-core): the artifact forward conversion walks every `packages[].manifest` body of a multi-package artifact, so a retired key inside a package body is converted instead of refused at the metadata door

Clause-②: no

**What an operator saw.** A multi-package release artifact (ADR-0130 D4: `os build` of a `composeStacks(…, { manifest: 'preserve' })` project) carries its collections in `packages[i].manifest`. When such an artifact was built before a retirement, for example a dashboard still spelled `refreshInterval`, the metadata plugin's artifact door refused it at the strict parse (`invalid_type` at `packages.1.manifest.dashboards.0.refreshInterval`). The ADR-0087 conversion converted the same dashboard when it sat in the artifact's own `dashboards`, but it never read a package body.

**What an operator sees now.** `applyArtifactForwardConversions` runs the same conversion over each package body as over the artifact's own collections: the same registry, and the same window, decided once from the artifact's own `engines.protocol` (a body's own `engines.protocol` is not read). The metadata plugin's artifact door registers the converted body, each item still owned by its own package, and its one-per-conversion warning names the body: `… converted 2 site(s) forward via ADR-0087 conversion 'dashboard-refresh-interval-to-refresh-interval-seconds' (first at packages[0].manifest.dashboards[0].refreshIntervalSeconds) …`. A body built after the retirement converts nothing and logs nothing. An artifact authored past every retirement still meets the tombstone inside its body.

**Not yet.** The default host (`os dev -a`, `os start` from an artifact) reads `packages[]` raw in `@objectstack/runtime` before the metadata door runs, so such an artifact is still refused there with "`packages[N]` is not a package entry (ADR-0130 D4)". That reader is not changed here.

**Unchanged.** An artifact without `packages[]` converts exactly as before, with the same notices, paths and messages.
