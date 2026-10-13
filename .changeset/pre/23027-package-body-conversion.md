---
'@objectstack/metadata-core': patch
'@objectstack/runtime': patch
---

fix(metadata-core, runtime): a multi-package artifact built before a retirement boots at `os dev -a` and `os start`. The ADR-0087 forward conversion walks every `packages[].manifest` body, and the runtime's artifact load converts the bundle once, before any reader sees it

Clause-②: no

**What an operator saw.** A multi-package release artifact (ADR-0130 D4: `os build` of a `composeStacks(…, { manifest: 'preserve' })` project) carries its collections in `packages[i].manifest`. Take such an artifact built before a retirement, for example with a dashboard still spelled `refreshInterval`. `os dev -a dist/objectstack.json` and `os start` exited at boot with "`packages[1]` is not a package entry (ADR-0130 D4): manifest.dashboards.0.refreshInterval: `dashboard.refreshInterval` was renamed to `refreshIntervalSeconds`…". The metadata plugin's artifact door refused the same artifact at its strict parse. The ADR-0087 conversion converted that dashboard when it sat in the artifact's own `dashboards`, but it never read a package body, and the runtime read the bundle raw before any conversion ran.

**What an operator sees now.** The same artifact boots at `os dev -a` and at `os start`. Each body's items are served converted (`refreshIntervalSeconds: 300`, valid), each owned by its own package. The boot log names each conversion once, with the body it found it in: `[MetadataPlugin] artifact '…' … converted 2 site(s) forward via ADR-0087 conversion 'dashboard-refresh-interval-to-refresh-interval-seconds' (first at packages[0].manifest.dashboards[0].refreshIntervalSeconds) …`. The artifact file itself is unchanged, so it converts again on every boot until it is rebuilt with `os build`. A body built after the retirement converts nothing and logs nothing. An artifact authored past every retirement is still refused with the tombstone inside its body.

- **`@objectstack/metadata-core`.** `applyArtifactForwardConversions` runs the same conversion over each package body as over the artifact's own collections. It uses the same registry and the same window, decided once from the artifact's own `engines.protocol`; a body's own `engines.protocol` is not read. A notice from a body is located from the artifact root (`packages[1].manifest.…`).
- **`@objectstack/runtime`.** `loadArtifactBundle` converts the loaded artifact once, before it merges the runtime module and before the stack, `AppPlugin` or the `manifest` service read it. The database resolver reads the artifact file itself, and it runs the same conversion on what it reads. So a multi-package artifact that declares its default datasource in a package body opens that database, not the unified default.

**Unchanged.** An artifact without `packages[]` converts exactly as before, with the same notices, paths and messages, and it is served the same way.
