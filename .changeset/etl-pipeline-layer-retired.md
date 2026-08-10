---
"@objectstack/spec": major
---

refactor(spec)!: retire the L2 ETL layer — `automation/etl.zod.ts` had no executor, and the sync architecture doc was recommending it (#6414)

`ETLPipeline`, `ETLPipelineRun`, `ETLSource`, `ETLDestination`, `ETLTransformation`,
the `ETLEndpointType` / `ETLTransformationType` / `ETLSyncMode` / `ETLRunStatus`
enums and the `ETL` factory are REMOVED under ADR-0049 enforce-or-remove. The whole
file goes, on the same reading #4738 used to retire L1 `DataSyncConfig` one layer up:
**narrative-only**. No engine ever parsed, scheduled or executed an `ETLPipeline`.

Measured on `origin/main` immediately before the removal: the only non-spec
references in this repo are two fumadocs-generated documentation sources
(`apps/docs/.source/*.ts`), not executors; objectui has no reference at all; and
there is no `packages/spec/liveness/etl.json`, so no ADR-0049 gate ever had a reading
on the surface — while the same file family's EXECUTED half does have one
(`liveness/mapping.json`), which is what makes that absence meaningful rather than an
oversight.

FROM → TO, layer by layer — with one gap stated plainly instead of redirected:

| removed | use instead |
|---|---|
| `ETLPipeline.source` + `syncMode` + `schedule` (scheduled extraction from an external system) | `ConnectorSchema.syncConfig` (`integration/connector.zod.ts`) — the live, parsed sync surface: strategy, direction, cron schedule, `conflictResolution`, batching, delete mode |
| `ETLTransformation` of type `map` / `cast`-like per-field work | `mapping.fieldMapping[].transform` (`data/mapping.zod.ts`) — `none`/`constant`/`map`/`split`/`join`/`lookup`, applied row by row by the REST import path |
| `ETLPipeline.schedule` alone | `system/job.zod.ts` |
| `ETLTransformation` of type `join` / `aggregate` / `script` / `merge` / `deduplicate` / … | **nothing.** There is no replacement because there was never an implementation — those ten transformation types named capabilities no runtime had. Do the work where it runs (the destination warehouse's ELT, a `flow`, a scheduled job), and let multi-stage movement return through ADR-0049's ENFORCE route: the engine first, the vocabulary second |

**The fix:** delete the import. Nothing was ever deployed under an `ETLPipeline` —
that is the finding, not a consolation — so there is no data migration; `tsc` reports
TS2724/TS2305 at every import of a retired name.

**`packages/spec/docs/SYNC_ARCHITECTURE.md` is rewritten in the same change**, and
that is not incidental. It named `ETLPipeline` as the recommended destination for
authors displaced by the L1 retirement and tabulated ten transformation types with
copyable examples down to `script | Custom JavaScript/Python`. Retiring the schema
while the doc still recommended it would have been self-contradictory, and
forwarding L1's authors to a second layer with no executor was the defect compounding
rather than closing.

**Absorbed:** the #4962 `etl-retry-converged-onto-retry-policy` entry (`retry.maxAttempts`
→ `maxRetries`, default 3 → 0) — both land in the unreleased protocol 17, so composed,
a rename on a shape that does not survive the major has no observable effect, and its
`retiredKey()` tombstone goes with the shape that carried it.

The retirement kit — route 3: no tombstone, no D2 conversion.
`RETIRED_DEFS_BY_MAJOR[17]` (9 defs) plus the D3 `SemanticMigration`
`etl-pipeline-layer-retired` are the declaration.

<!-- adr-0087: registered etl-pipeline-layer-retired -->
