---
"@objectstack/spec": minor
---

feat(spec)!: delete the seven cron-typed positions nothing evaluated — export schedules, `ScheduleState.cronExpression`, `DataSyncConfig.schedule`, `CacheWarmup.schedule`, backup / DR-test schedules (ADR-0049)

<!-- adr-0087: not-required (no-migration-prescription) a bare deletion on a non-strict schema refuses nothing and converts nothing, so no metadata upgrader has an edit to make and `os migrate meta` has nothing to list; nothing is registered, by the maintainer ruling of 2026-09-10 -->

**BREAKING** — seven authorable positions across five schemas are DELETED. Executes the
maintainer ruling of 2026-09-06 (director decision batch #56, 「其他同意」 on the per-family
recommendation: option A — retire — per family) under ADR-0049 enforce-or-remove, by the
route the maintainer ruled on 2026-09-10: **直接删** — a bare deletion, with no
`retiredKey()` tombstone, no ADR-0087 D2 conversion and no D3 semantic entry.

Seven positions declared a `CronExpressionInputSchema` slot that the parse normalized into
the `{ dialect: 'cron', source }` envelope and that NOTHING evaluated — the ADR-0058 D7
ledger row `cron-declared-unwired` had every one of them `unevaluated`.

| family | schema | deleted position | reachable from a stack manifest |
|:--|:--|:--|:--|
| export schedules | `ScheduledExport`, `ScheduleExportRequest` (`api/export.zod.ts`) | `schedule.cronExpression` (both) | no — API contract nothing serves |
| flow schedule state | `ScheduleState` (`automation/execution.zod.ts`) | `cronExpression` (was REQUIRED) | no — runtime state |
| connector sync | `DataSyncConfig` (`integration/connector.zod.ts`) | `schedule` | **yes** — `Connector.syncConfig`, `defineStack({ connectors })` |
| cache warmup | `CacheWarmup` (`system/cache.zod.ts`) | `schedule` | no |
| backup / DR testing | `BackupConfig`, `DisasterRecoveryPlan.testing` (`system/disaster-recovery.zod.ts`) | `schedule` (both) | no |

**What an upgrading author actually observes.** None of the five schemas is `.strict()`, so
a bare deletion means Zod DROPS the key: an existing document still parses, still loads, and
the value is discarded without a word. Nothing refuses it, so there is nothing for
`objectstack migrate meta` to list and nothing for the ADR-0087 chain to replay — the value
was already inert before this change, and it is inert after. The one channel that speaks is
`tsc`: a TypeScript author annotating with `Connector`, `ScheduledExport`, `ScheduleState`,
`CacheWarmup`, `BackupConfig` or `DisasterRecoveryPlan` gets an excess-property error at the
key and deletes it.

**What stays, byte-identical:** every other key of the five schemas and every export — no def
leaves the public surface. `ScheduledExport.schedule` / `ScheduleExportRequest.schedule` keep
their `timezone` (still defaulting to `UTC`); `ScheduleState` keeps `timezone`, `status` and
`nextRunAt`, and a state without `cronExpression` now parses (the requiredness left with the
key); `CacheWarmup.strategy` keeps its `scheduled` member — a value, not a position the
ruling names, and exactly as inert as before.

**Not in scope, deliberately:** `CronSchedule.expression` (`system/job.zod.ts`, read by
`croner` — the ONE cron slot the platform evaluates), `KnowledgeRefreshPolicy.cron`
(experimental by design), `Object.titleFormat`, and the `PromptTemplate` pair (marked, not
retired, on its sibling card).

## This change states no before/after rewrite, because there is none

A breaking changeset in this repo normally states the old spelling beside the new one.
This one has no such pair to state: the same document parses before and after, the value
was inert in both, and nothing refuses it — so a metadata upgrader has no edit to make and
`os migrate meta` has nothing to list. The one party with work to do is a TypeScript
author, and the compiler names the key and the line for them. What follows is guidance for
authoring a cadence going forward, not a rewrite of an existing document.

## What to write instead

There is no replacement on any of the five schemas: no export scheduler, flow-state
scheduler, connector-sync scheduler, cache-warmup engine, backup engine or DR-test runner
exists to declare a cadence to. The one cron slot the platform evaluates is
`Job.schedule.expression` (`system/job.zod.ts`) — work on a cadence is a `job` whose handler
you write:

```ts
// A connector that used to carry `syncConfig.schedule: '*/15 * * * *'` declares
// the cadence as a job instead; the handler drives the connector.
defineStack({
  connectors: [{ name: 'sap_erp', label: 'SAP ERP', type: 'saas', syncConfig: { strategy: 'incremental' } }],
  jobs: [{ name: 'sap_erp_sync', schedule: { expression: '*/15 * * * *' }, handler: 'syncSapErp' }],
});
```

The retirement kit, in the shape the 2026-09-10 ruling prescribes:

- the key is DELETED at all seven sites (`api/export.zod.ts` ×2,
  `automation/execution.zod.ts`, `integration/connector.zod.ts`, `system/cache.zod.ts`,
  `system/disaster-recovery.zod.ts` ×2). Each site keeps a source comment recording what
  left, why nothing ever read it, and what does work instead
- **no ADR-0087 registration at all** — no `RETIRED_KEYS_BY_MAJOR[18]` entry, no D2
  conversion, no D3 semantic entry, and nothing added to the protocol-18 chain step. That is
  the ruling: 「直接删」, taken over the seat's written recommendation to keep the connector
  family's D2, on the reading 「我们的客户也不会按照你的设想的版本按顺序升级」
- the four baseline rows that existed (`automation/ScheduleState:cronExpression`,
  `integration/DataSyncConfig:schedule`, `system/BackupConfig:schedule`,
  `system/CacheWarmup:schedule`) are deleted from `authorable-surface/` in this same commit,
  each carrying the #4650 proof the build computes for itself: the def is not reachable from
  the 26 metadata-type roots. The three nested positions never had a row of their own
- no liveness-ledger row: none of the five schemas is an enrolled ledger type
- the ADR-0058 D7 expression-conformance ledger loses its `cron-declared-unwired` row (every
  position it covered is gone, so discovery by roster name no longer sees them); the cron
  dialect is now exactly the one evaluated slot plus the one experimental-by-design slot
- pin tests (`cron-typed-positions-retirement.test.ts`): per site, the authored value is
  accepted and stripped and the enclosing block still parses, on the base schema and through
  every nesting carrier (`Connector.syncConfig`, `stack.connectors[]`, the `/meta/connector`
  door, `DisasterRecoveryPlan.backup`, `DistributedCacheConfig.warmup`); the `tsc` channel;
  and — with lit and dark controls — that no `RETIRED_KEYS_BY_MAJOR` entry, no D2 conversion
  and no D3 semantic entry names any of the seven
- generated baselines and docs follow the schema: the five reference pages are regenerated,
  the published `objectstack-formula` skill's `cron` row drops the retired carriers and keeps
  `Job.schedule.expression`, and `packages/spec/docs/SYNC_ARCHITECTURE.md` stops teaching
  `syncConfig.schedule`
- `json-schema.manifest/` and `api-surface/` are unchanged, and correctly so: the first
  ratchets def *names* and the second export *existence*; deleting keys removes neither
