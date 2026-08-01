---
"@objectstack/spec": major
---

refactor(spec)!: remove the `kernel` metadata-loader envelope family — eleven names that each existed twice, with different shapes, on two subpath entries (#4411)

`MetadataFormat`, `MetadataStats`, `MetadataLoadOptions`, `MetadataSaveOptions`,
`MetadataExportOptions`, `MetadataImportOptions`, `MetadataLoadResult`,
`MetadataSaveResult`, `MetadataWatchEvent`, `MetadataCollectionInfo` and
`MetadataLoaderContract` (plus each one's `…Schema`) are removed from
`@objectstack/spec/kernel` (`kernel/metadata-loader.zod`). Every one of those
names *also* existed, with a **different shape**, in
`@objectstack/spec/system` (`system/metadata-persistence.zod`).

Which type you got depended on nothing but your import path:

```ts
import type { MetadataWatchEvent } from '@objectstack/spec/kernel';   // one shape
import type { MetadataWatchEvent } from '@objectstack/spec/system';   // another
```

- **The `kernel` copies had zero consumers.** Import-statement scans across this
  repo, `cloud` and `objectui` found every consumer importing from
  `./system` (or, for the export/import options, `./contracts`' own interface).
  Nothing but `kernel/metadata-loader.test.ts` ever parsed the `kernel` copies.
- **The naming intuition pointed the wrong way**, which is what made this worse
  than an ordinary duplicate. The `kernel` copies were the ones that *looked*
  canonical — normalized enums, required fields, a `.describe()` on every
  property — and they were the dead ones. The live copy is the loose superset,
  and `metadata-manager.ts` calls it "legacy" in its own comments. An
  auto-import or a model completion picking by name, or by which one reads as
  more rigorous, picked the dead one; because the shapes overlap heavily, that
  choice compiled and only failed later, at an edge value (`add` vs `added`) or
  on a field one copy made required.
- **No load path parsed them.** These are runtime envelope types, not authorable
  metadata — no authored source can carry them. So there is deliberately **no**
  `retiredKey()` tombstone and **no** ADR-0087 conversion: a prescription nobody
  can receive is noise, and there is nothing for `os migrate meta` to rewrite
  (the `plugin-runtime.zod.ts` / dev-plugin precedents, #3950, #4149).

**FROM → TO — change the import path, keep the name:**

```diff
-import type { MetadataWatchEvent, MetadataStats } from '@objectstack/spec/kernel';
+import type { MetadataWatchEvent, MetadataStats } from '@objectstack/spec/system';
```

The surviving `system` copy is the **looser** of the two, so a *reader* of these
types may need narrowing it did not need before; a *producer* needs nothing. The
differences that actually bite:

| Type | `kernel` (removed) | `system` (keep) |
| --- | --- | --- |
| `MetadataWatchEvent.type` | `'added' \| 'changed' \| 'deleted'` | also `'add' \| 'change' \| 'unlink'` — the raw watcher values the runtime really emits |
| `MetadataWatchEvent` | `metadataType` / `name` / `timestamp` required | all three optional; adds `stats` |
| `MetadataStats` | `size` / `modifiedAt` / `etag` / `format` required | all optional; adds `mtime`, `hash` |
| `MetadataFormat` | `json \| yaml \| typescript \| javascript` | also the `yml` / `ts` / `js` aliases |
| `MetadataSaveResult.path` | required | optional; adds `stats` |
| `MetadataImportOptions` | `conflictResolution` / `dryRun` / `continueOnError` / `transform` | `source` / `strategy` / `validate` |
| `MetadataCollectionInfo` | `formats: MetadataFormat[]` | `namespaces: string[]` |

No runtime behaviour changes: nothing read the removed copies. The `system`
shapes are **not** tightened here — they describe what `MetadataManager`
actually emits, and narrowing them would be a separate behaviour change.

`MetadataManagerConfig` and `MetadataFallbackStrategy` are **unaffected**. They
were never duplicated — `kernel` owns them and `system` re-exports them — and
that is the split that survives: manager *wiring* is kernel's, the loader/watch
*envelope* is system's, and nothing is declared twice.

The retirement kit: baselines dropped deliberately
(`json-schema.manifest.json` minus the 11 `kernel/Metadata*` entries;
`authorable-surface.json` minus the 65 matching lines — nothing can author
these, so no `[RETIRED]` markers); `api-surface.json` regenerated (22 exports
leave `./kernel`); `references/kernel/metadata-persistence.mdx` removed by
`gen:docs`; v17 release notes' dead-clusters table and upgrade checklist
extended. No liveness-ledger entries existed (the ledger tracks authorable
metadata types; these were never one).
