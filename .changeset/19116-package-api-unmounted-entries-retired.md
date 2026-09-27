---
'@objectstack/spec': minor
---

**BREAKING** — `PackageApiContracts` loses its three entries that named routes nothing serves: `upgradePackage`, `resolveDependencies` and `uploadArtifact` (#19116).

A `major`-class change, recorded as `minor` under the launch-window convention. Maintainer ruling 2026-09-23, director seat decision batch #217 item 4, letter A, 「217 同意」; ADR-0049 enforce-or-remove.

**Why.** Each entry bound a path the composed runtime mounts nowhere — `POST /api/v1/packages/upgrade`, `POST /api/v1/packages/resolve-dependencies` and `POST /api/v1/packages/upload`. The package dispatcher has no route for any of them and `@objectstack/rest` mounts only `/packages/publish` under `/packages`, so a request to any of the three was never answered, while the generated API reference printed all three as live endpoints. Unlike `installPackage`, which was rebound onto the serving `POST /api/v1/packages`, there was no serving door to rebind these onto, and mounting three new capabilities nobody has asked for was ruled out.

### FROM → TO

| removed | what to write instead |
| --- | --- |
| `PackageApiContracts.upgradePackage` (`POST /api/v1/packages/upgrade`) | nothing — delete the read and any URL built from it. No route serves a package upgrade. |
| `PackageApiContracts.resolveDependencies` (`POST /api/v1/packages/resolve-dependencies`) | nothing — delete the read and any URL built from it. No route serves dependency resolution. |
| `PackageApiContracts.uploadArtifact` (`POST /api/v1/packages/upload`) | nothing — delete the read and any URL built from it. No route serves an artifact upload. |

**The one-line fix: delete every read of the three keys, and every request to the three paths.** The compiler finds the reads (`TS2339: Property 'upgradePackage' does not exist`); a hard-coded path has to be searched for. No behaviour is lost — none of those requests was ever answered.

**What stays.** The four entries whose doors serve — `listPackages`, `getPackage`, `installPackage`, `uninstallPackage` — are unchanged. The per-route request/response schemas (`PackageUpgradeRequestSchema`, `PackageUpgradeResponseSchema`, `ResolveDependenciesRequestSchema`, `ResolveDependenciesResponseSchema`, `UploadArtifactRequestSchema`, `UploadArtifactResponseSchema`, with their types) stay published, now bound to no route; their docblocks no longer name a route. If the platform later serves a package upgrade, dependency-resolution or upload route, its contract entry is declared in the same change that mounts it.

⚠️ Runtime behaviour is deliberately **unchanged**: nothing ever mounted the three paths or built a route, client or SDK method from the entries, so every request answers exactly as before. The removal retracts a false claim, not a capability. **No deprecation window** (maintainer 2026-08-27: 「项目在创业阶段,用户也很少,短期不考虑渐进」).

⚠️ **The out-of-repo consumer population is NOT MEASURED.** Inside this repository the three paths occurred only in the declaring file, its unit test and the generated reference page, and the pinned objectui checkout names none of the keys, none of the paths and not `PackageApiContracts`; `@objectstack/spec` is published, so readers elsewhere were not measured.

The ADR-0087 D3 semantic entry `package-api-contracts-unmounted-entries-retired` carries the judgement: a contract-map entry is not metadata, so there is no source for a D2 conversion to rewrite.

Clause-②: no

<!-- adr-0087: registered package-api-contracts-unmounted-entries-retired -->
