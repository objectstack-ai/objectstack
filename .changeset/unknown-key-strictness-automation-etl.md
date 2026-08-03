---
"@objectstack/spec": major
---

feat(spec)!: reject unknown keys on the ETL authoring contracts (#4001 批 12)

The final `automation/` wave of the 2026-08-03 "necessary-and-complete" ruling.
Seven strip sites in `automation/etl.zod.ts` close, and `automation/`'s
remaining-strip count drops 53 → 46 (authorable 27 → 20).

Now strict: `ETLSourceSchema` (and its `incremental` block),
`ETLDestinationSchema`, `ETLTransformationSchema`, `ETLPipelineSchema` (and its
`retry` and `notifications` blocks).

**Deliberately still open: `ETLPipelineRunSchema`, `.stats` and `.error`.**
Every key on those is a fact the engine produces about a run that already
happened — an id it minted, a status it reached, counters it accumulated.
Nobody authors a run result, so strictness buys no author protection there,
while it would turn a future engine reporting one more counter into a parse
crash for every existing reader. Same disposition, same reason, as
`FlowVersionHistorySchema` and all of `execution.zod.ts`.

**Migration.** Every key now rejected was previously stripped and had no
runtime effect, so removing or renaming one never changes behaviour. No
ADR-0087 conversion is needed: the three shipped example apps' built artifacts
were walked (3930 nodes) with 0 shapes newly rejected, the probe proven red
first on an injected control, and all three `objectstack validate` runs pass.

The rejections carry their own prescriptions:

- **source / destination / transformation**: the common mistake here is not a
  typo but a MISPLACEMENT. `table`, `schema`, `endpoint`, `path`, `format`,
  `condition`, `groupBy` are real settings that belong one level down, inside
  the open `config` record; every message on these three surfaces says so.
- `source.incremental`: `timestampField` → `cursorField` (the connector layer's
  `DataSyncConfig` spells the same thing `timestampField`).
- `destination`: `strategy` → `writeMode`; on the **pipeline** the same word is
  `strategy` → `syncMode`. The connector's one `strategy` enum
  (`full | incremental | upsert | append_only`) splits across those two keys —
  the write half on the destination, the extraction half on the pipeline.
- pipeline `direction`: not a key at all, by design. An ETL pipeline states
  direction structurally, by which endpoint is `source` and which is
  `destination`; to reverse one, swap the two endpoints.
- `retry`: `maxRetries` → `maxAttempts`, and `retryDelayMs` → `backoffMs` (the
  pre-17 spelling retired in #4661). `backoffMultiplier`, `maxRetryDelayMs` and
  `jitter` are declared on the converged `RetryPolicySchema` and **deliberately
  absent** here — a documented absence, not a typo. Converging the two retry
  vocabularies is tracked as #4962.
- `notifications`: `onError` → `onFailure`.

**One published-artifact change, not a no-op.** The campaign's standing claim
that strictness does not move the published JSON Schema holds per direction:
`build-schemas.ts` prefers `io: 'output'`, where a stripping object already
emits `additionalProperties: false`. `ETLPipelineSchema` is the case where that
does not apply — it cannot convert in output mode at all (`schedule` is
`CronExpressionInputSchema`, a transform), so the build falls back to input
mode, and there strip emits nothing while strict emits
`additionalProperties: false`. The published pipeline schema therefore narrows
from "unspecified" to "closed", which is the intended direction — the
publication now matches the parse instead of being quieter than it.
`ETLPipelineRun` publishes under output mode and did not move.
