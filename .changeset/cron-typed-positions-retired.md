---
"@objectstack/spec": minor
---

feat(spec)!: retire the seven cron-typed positions nothing evaluated — export schedules, `ScheduleState.cronExpression`, `DataSyncConfig.schedule`, `CacheWarmup.schedule`, backup / DR-test schedules (ADR-0049)

<!-- adr-0087: registered connector-sync-schedule-removed, connector-sync-schedule-retired, export-schedule-cron-retired, schedule-state-cron-expression-retired, cache-warmup-schedule-retired, disaster-recovery-schedules-retired -->

**BREAKING** — an accept-set narrowing on seven authorable positions. Executes the
maintainer ruling of 2026-09-06 (director decision batch #56, 「其他同意」 on the per-family
recommendation: option A — retire — per family) under ADR-0049 enforce-or-remove: seven
positions across five schemas declared a `CronExpressionInputSchema` slot that the parse
normalized into the `{ dialect: 'cron', source }` envelope and that NOTHING evaluated — the
ADR-0058 D7 ledger row `cron-declared-unwired` had every one of them `unevaluated`. None of
the five schemas is `.strict()`, so each key is a `retiredKey()` tombstone rather than a bare
deletion (a deletion would have stripped it in silence): authoring it is a `tsc` error
(`never`) and a parse error carrying the prescription (`invalid_type` at the path of the key).

| family | schema | retired position | reachable from a stack manifest |
|:--|:--|:--|:--|
| export schedules | `ScheduledExport`, `ScheduleExportRequest` (`api/export.zod.ts`) | `schedule.cronExpression` (both) | no — API contract nothing serves |
| flow schedule state | `ScheduleState` (`automation/execution.zod.ts`) | `cronExpression` (was REQUIRED) | no — runtime state |
| connector sync | `DataSyncConfig` (`integration/connector.zod.ts`) | `schedule` | **yes** — `Connector.syncConfig`, `defineStack({ connectors })` |
| cache warmup | `CacheWarmup` (`system/cache.zod.ts`) | `schedule` | no |
| backup / DR testing | `BackupConfig`, `DisasterRecoveryPlan.testing` (`system/disaster-recovery.zod.ts`) | `schedule` (both) | no |

**What stays, byte-identical:** every other key of the five schemas and every export — no def
leaves the public surface. `ScheduledExport.schedule` / `ScheduleExportRequest.schedule` keep
their `timezone` (still defaulting to `UTC`); `ScheduleState` keeps `timezone`, `status` and
`nextRunAt`, and a state without `cronExpression` now PARSES (a tombstone accepts only absence,
so the requiredness left with the key); `CacheWarmup.strategy` keeps its `scheduled` member —
a value, not a position the ruling names, and exactly as inert as before.

**Not in scope, deliberately:** `CronSchedule.expression` (`system/job.zod.ts`, read by
`croner` — the ONE cron slot the platform evaluates), `KnowledgeRefreshPolicy.cron`
(experimental by design), `Object.titleFormat`, and the `PromptTemplate` pair (marked, not
retired, on its sibling card).

## FROM → TO

```ts
// before — parsed green; no engine ever evaluated a single one of these crons
const sched: ScheduledExport = {
  name: 'weekly_account_export', object: 'account',
  schedule: { cronExpression: '0 6 * * MON', timezone: 'America/New_York' },
  delivery: { method: 'email', recipients: ['admin@example.com'] },
};
const state: ScheduleState = {
  id: 'sched_001', flowName: 'daily_report', cronExpression: '0 9 * * MON-FRI',
  createdAt: '2026-01-01T00:00:00Z',
};
const connector: Connector = {
  name: 'sap_erp', label: 'SAP ERP', type: 'saas',
  syncConfig: { strategy: 'incremental', schedule: '*/15 * * * *' },
};
const warmup: CacheWarmup = { enabled: true, strategy: 'scheduled', schedule: '0 0 * * *' };
const backup: BackupConfig = {
  schedule: '0 2 * * *', retention: { days: 30 }, destination: { type: 's3', bucket: 'backups' },
};
const plan: DisasterRecoveryPlan = {
  rpo: { value: 15 }, rto: { value: 1, unit: 'hours' }, backup,
  testing: { enabled: true, schedule: '0 3 1 * *' },
};

// after — delete the key. There is no replacement on any of the five schemas,
// because no export scheduler, flow-state scheduler, connector-sync scheduler,
// cache-warmup engine, backup engine or DR-test runner exists to declare a
// cadence to. The one cron slot the platform evaluates is
// `Job.schedule.expression` (`system/job.zod.ts`): work on a cadence is a `job`
// whose handler you write.
const sched: ScheduledExport = {
  name: 'weekly_account_export', object: 'account',
  schedule: { timezone: 'America/New_York' },
  delivery: { method: 'email', recipients: ['admin@example.com'] },
};
const state: ScheduleState = {
  id: 'sched_001', flowName: 'daily_report', createdAt: '2026-01-01T00:00:00Z',
};
const connector: Connector = {
  name: 'sap_erp', label: 'SAP ERP', type: 'saas',
  syncConfig: { strategy: 'incremental' },
};
const warmup: CacheWarmup = { enabled: true, strategy: 'scheduled' };
const backup: BackupConfig = {
  retention: { days: 30 }, destination: { type: 's3', bucket: 'backups' },
};
const plan: DisasterRecoveryPlan = {
  rpo: { value: 15 }, rto: { value: 1, unit: 'hours' }, backup,
  testing: { enabled: true },
};
```

One-line fix: delete the key wherever it is authored. For a connector — the one
position a stack manifest reaches — `os migrate meta --from 17` lists the mechanical
edit for every `connectors[]` entry that authored `syncConfig.schedule` (conversion
`connector-sync-schedule-removed`, `retiredFromLoadPath`: the tombstone owns the live
refusal, the conversion replays stored 17.x rows and the `migrate meta` edit list). For
the other six positions there is no `os migrate meta` edit list — none of those schemas
is a stack collection member or a metadata type, so the conversion chain has no seam to
walk (the `MetadataPluginConfig.additionalTypes` precedent); the tombstone prescription and
the protocol-18 upgrade guide are the channels.

The retirement kit — one shape per family, as the ruling says:

- `retiredKey()` tombstones at all seven sites (`api/export.zod.ts` ×2,
  `automation/execution.zod.ts`, `integration/connector.zod.ts`, `system/cache.zod.ts`,
  `system/disaster-recovery.zod.ts` ×2; each file's section comment records why no
  engine ever read the key and, per family, why it does or does not convert)
- ADR-0087 registration: seven `RETIRED_KEYS_BY_MAJOR[18]` entries (the three nested
  sites spelled `api/ScheduledExport:schedule.cronExpression`,
  `api/ScheduleExportRequest:schedule.cronExpression`,
  `system/DisasterRecoveryPlan:testing.schedule`); ONE D2 conversion for the connector
  family (`connector-sync-schedule-removed`, one strip per `connectors[]` entry, wired
  into the step-18 chain) plus its D3 twin `connector-sync-schedule-retired`, which
  carries the measured author population — zero in-repo authors, out-of-repo stacks NOT
  MEASURED from this repo — on the fields the upgrade guide, `spec-changes.json` and
  `os migrate meta` project, as the #15954 ruling's letter requires; four D3 semantic
  entries for the other four families
- no liveness-ledger row: none of the five schemas is an enrolled ledger type
- the ADR-0058 D7 expression-conformance ledger loses its `cron-declared-unwired` row
  (every position it covered is a tombstone now, so discovery by roster name no longer
  sees them); the cron dialect is now exactly the one evaluated slot plus the one
  experimental-by-design slot
- pin tests (`cron-typed-positions-retirement.test.ts`): a refusal pin per site
  asserting the issue path, code and prescription on the base schema and through every
  nesting carrier (`Connector.syncConfig`, `stack.connectors[]`, the `/meta/connector`
  door, `DisasterRecoveryPlan.backup`, `DistributedCacheConfig.warmup`); the tsc `never`
  channel; no-materialize pins; the migrate sentence present on the connector prescription
  and absent from the six others; and the ADR-0087 registration per family
- generated baselines and docs follow the schema: `authorable-surface/` flips four rows
  to `[RETIRED]` (the three nested positions have no row of their own), the five
  reference pages are regenerated, the published `objectstack-formula` skill's `cron`
  row drops the three retired carriers and keeps `Job.schedule.expression`, and
  `packages/spec/docs/SYNC_ARCHITECTURE.md` stops teaching `syncConfig.schedule`
- `json-schema.manifest/` and `api-surface/` are unchanged, and correctly so: the first
  ratchets def *names* and the second export *existence*; retiring keys removes neither
