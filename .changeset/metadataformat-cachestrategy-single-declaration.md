---
"@objectstack/spec": major
---

feat(spec)!: converge the dual-source `MetadataFormat` and `CacheStrategy` enum declarations (#4537)

Two enum vocabularies were declared twice, on `./shared` and `./system`, and had
diverged on their **values** — which type (and which accepted value set) you got
depended on nothing but the import path (the #4411 trap; #4535/#4506 baseline).
Both converge on one declaration each; the three
`dual-source-exports.baseline.json` rows are deleted.

**`MetadataFormat` / `MetadataFormatSchema` — the shared declaration is the
single source.** `system/metadata-persistence.zod` no longer declares its own
7-member copy; it re-exports `shared/metadata-types.zod` (the
`MetadataManagerConfig` pattern — `kernel/metadata-loader.zod` already imported
the shared one since #4411). Breaking on the `./system` entry only: the
extension-style aliases `'yml'`/`'ts'`/`'js'` are no longer accepted. They had
zero producers in this repo, objectui and cloud — every loader normalizes at the
boundary (`FilesystemLoader.detectFormat` maps `.yml` → `'yaml'`, `.ts` →
`'typescript'`, `.js` → `'javascript'`; the database/remote/memory loaders
always emit `'json'`). Migration: write the canonical name —
`'yml'` → `'yaml'`, `'ts'` → `'typescript'`, `'js'` → `'javascript'`.

**`CacheStrategy` — `system/cache.zod` (`CacheStrategySchema`) is the single
declaration.** The `./shared` copy `CacheStrategyEnum` (and its `CacheStrategy`
type export) is removed: it had zero importers in all three repos, while the
system schema is the one `CacheTier.strategy` gates on — same disposition as
`AggregationFunctionEnum` (objectui#2945): removed rather than reconciled.
Migration: `import { CacheStrategySchema, type CacheStrategy } from
'@objectstack/spec/system'`. The value `'adaptive'`, declared only on the
system side with zero producers, is dropped — the enum carries the four values
both declarations agreed on (`'lru' | 'lfu' | 'fifo' | 'ttl'`); pick one of
those.

No ADR-0087 conversion / tombstone: loader envelope + config vocabulary with no
authorable-metadata producers (the #4411 / #4536 route), verified by three-repo
scan on the issue.
