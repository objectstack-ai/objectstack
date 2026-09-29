---
'@objectstack/spec': minor
---

feat(spec)!: the ADR-0087 migration chain leaves the package root for the new `@objectstack/spec/migrations` entry (#20646)

**BREAKING** — the migration chain and change-manifest names (ADR-0087 D3/D4), with their types, are no longer exported from the package root `@objectstack/spec`. They are exported, unchanged, from the new entry `@objectstack/spec/migrations`.

A `major`-class change — an existing import path stops resolving for these names — recorded as `minor` under the launch-window convention.

**Why.** The migration registry is mostly the guidance text `objectstack migrate meta` prints, and the root re-exported it. The registry does work when its module loads (the list of majors and each step's rationale are computed then), so no bundler could prove it unused, and all of that text rode in every bundle of the root, whatever the consumer imported. This is the source-side payback of the Studio console's first-screen ceiling raise that the maintainer ruled on the 17.5.0 upgrade. Measured on the splitting PR against its merge base `1a75e39d4a` (tsup build, gzip -9):

| | before | after |
| --- | --- | --- |
| `dist/index.js` (CommonJS root) | 3,780,033 B / 1,067,061 B gzip | 2,009,810 B / 565,386 B gzip |
| `dist/browser/index.mjs` (the ESM root a browser bundler pulls) | 3,764,293 B / 1,065,388 B gzip | 1,994,748 B / 563,787 B gzip |
| a browser bundle of the ten names the Studio console imports from the root (rolldown, minified) | 700,884 B gzip | 301,287 B gzip |

The ADR-0087 **conversion layer stays on the root**: `defineStack` and `normalizeStackInput` read it at run time, so its names (`ALL_CONVERSIONS`, `CONVERSIONS_BY_MAJOR`, `applyConversions`, `applyConversionsToFlow`, `applyConversionsToStoredItem`, `collectConversionNotices`, the `CONVERSION_*_CODE` constants and their types) import from `@objectstack/spec` exactly as before.

### FROM → TO

| removed from `@objectstack/spec` | import instead from |
| --- | --- |
| `MIGRATIONS_BY_MAJOR`, `MIGRATION_MAJORS`, `MIGRATION_SUPPORT_FLOOR` | `@objectstack/spec/migrations` |
| `RETIRED_KEYS_BY_MAJOR`, `RETIRED_DEFS_BY_MAJOR` | `@objectstack/spec/migrations` |
| `applyMetaMigrations`, `composeMigrationChain`, `MigrationFloorError` | `@objectstack/spec/migrations` |
| `composeSpecChanges`, `composeReleaseChanges` | `@objectstack/spec/migrations` |
| `SpecChangesSchema`, `SpecConvertedSchema`, `SpecMigratedSchema`, `SpecSurfaceAddSchema`, `SpecSurfaceRemoveSchema`, `SpecReleaseChangesSchema`, `SpecReleaseSurfaceSchema` | `@objectstack/spec/migrations` |
| types `MigrationStep`, `MigrationApplication`, `MigrationChainResult`, `MigrationHopResult`, `MigrationTodo`, `SemanticMigration`, `SpecChanges`, `SpecConverted`, `SpecMigrated`, `SpecSurfaceAdd`, `SpecSurfaceRemove`, `SpecReleaseChanges`, `SpecReleaseSurface`, `SurfaceDiff`, `ReleaseSurfaceDiff`, `PreviousReleaseRegistries` | `@objectstack/spec/migrations` |

**The one-line fix: change the import path.**

```ts
// before
import { applyMetaMigrations, MIGRATION_SUPPORT_FLOOR } from '@objectstack/spec';
// after
import { applyMetaMigrations, MIGRATION_SUPPORT_FLOOR } from '@objectstack/spec/migrations';
```

The compiler finds every site: `TS2305` ("Module '"@objectstack/spec"' has no exported member …"); at run time the binding is `undefined`. Nothing else changes: the chain, its steps and semantic entries, the retired-key and retired-def tables and the change-manifest schemas are the same objects, and `objectstack migrate meta` replays the same chain.

⚠️ **Out-of-repo consumers are NOT MEASURED beyond objectui.** Inside this repository the moved names had five importers — `os migrate meta` (the only runtime one) and four tests — all moved in the same PR. objectui at the pinned `.objectui-sha` imports none of the moved names from anywhere. The `cloud` repository was not measured.

The ADR-0087 D3 semantic entry `migrations-entry-split` carries the judgement: an import path is TypeScript source, not metadata, so there is no source a D2 conversion could rewrite.

Clause-②: yes (narrowing)

<!-- adr-0087: registered migrations-entry-split -->
