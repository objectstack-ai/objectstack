---
"@objectstack/metadata-protocol": minor
"@objectstack/objectql": minor
"@objectstack/runtime": patch
---

feat(objectql,metadata-protocol)!: single-source the protocol assembly; drop objectql's protocol re-exports — ADR-0076 Step 2 PR-C (#2462)

The ONE assembly now lives in `@objectstack/metadata-protocol` as
`assembleMetadataProtocol()` — `createMetadataProtocolPlugin()` (delegated
mode, cloud) and `ObjectQLPlugin`'s built-in convenience mode
(`registerProtocol !== false`, single-kernel/dev boots) both mount the same
code path (~112 inline lines deleted from the engine plugin). objectql's six
protocol re-exports (`ObjectStackProtocolImplementation`,
`SysMetadataRepository`, `SeedLoaderService`, `runBuildProbes` + types) are
removed — import them from `@objectstack/metadata-protocol` directly
(breaking, shipped as minor per the launch-window convention; the only known
importers were five test files, repointed). Scope note vs the original Step-2
recipe: the objectql→metadata-protocol dependency is deliberately KEPT for
the convenience mount — `@objectstack/objectql/core` was already
protocol-free, and forcing 20 framework boot sites to mount two plugins buys
no runtime win. "Zero protocol dependency" lands as "zero assembly ownership,
single source".
