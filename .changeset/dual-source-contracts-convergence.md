---
"@objectstack/spec": major
"@objectstack/service-analytics": major
"@objectstack/metadata": patch
---

feat(spec)!: converge the 11 contracts-vs-domain dual-source type names (#4538)

`packages/spec/src/contracts/` hand-wrote parameter/result interfaces whose
names collided with same-named zod-derived types in the domains — the #4411
trap, tracked as 11 rows of `dual-source-exports.baseline.json`. Each name was
judged individually against a three-repo import-level scan (framework, cloud,
objectui): which declaration actually flows at runtime decides the direction.
All 11 rows are deleted from the baseline; no name below is exported twice
anymore.

**Converged — `./contracts` now re-exports the domain zod type (same
declaration on both entries, imports keep compiling from either):**

- `NotificationChannel` → `system/notification.zod`'s
  `z.infer<NotificationChannelSchema>` (member sets were identical).
- `ValidationResult` → `kernel/plugin-validator.zod` (shapes were identical).
- `HealthStatus` → `kernel/startup-orchestrator.zod` (`details` narrows
  `Record<string, any>` → `Record<string, unknown>`).
- `PluginStartupResult` → `kernel/startup-orchestrator.zod`. FROM `plugin:
  Plugin` (live object) and `error?: Error` TO the serializable projection
  (`plugin: { name, version? }`-passthrough, `error?: { name, message,
  stack?, code? }`). Neither side had any consumer outside spec; the
  zod-validatable shape wins.
- `StartupOptions` → `kernel/startup-orchestrator.zod` — the PARSED tier
  (defaults applied). `IStartupOrchestrator.orchestrateStartup` now takes
  `StartupOptionsInput` (the caller-authored all-optional tier, also
  re-exported from `./contracts`). Fix for callers typed to the old
  all-optional `StartupOptions`: rename to `StartupOptionsInput`.
- `JobExecution` → `system/job.zod`. The system schema's `duration` field is
  RENAMED `durationMs` — that is what every job adapter produces and what the
  `sys_job_run.duration_ms` column round-trips; the schema described records
  nothing ever wrote. Fix: `duration` → `durationMs` when parsing
  `JobExecutionSchema` payloads.
- `AnalyticsQuery` → `data/analytics.zod`. The domain schema aligned to the
  contract's semantics first: `timezone` LOST its `.default('UTC')` — absence
  is meaningful (the engine resolves org timezone, #1982/#2018; the
  `/analytics` entry always refused to apply that default). The schema is now
  transform-free, so `AnalyticsQuery` ≡ `AnalyticsQueryInput` (both kept
  exported). Fix for code that relied on `.parse()` injecting `timezone:
  'UTC'`: pass the timezone explicitly or resolve it via the engine chain
  (`selection.timezone ?? context.timezone ?? 'UTC'`).

**Renamed — two genuinely different concepts were sharing one name (both
flow at runtime):**

- `./contracts` `DriverCapabilities` → **`AnalyticsDriverCapabilities`**
  (`{ nativeSql, objectqlAggregate, inMemory }`, the analytics strategy-chain
  execution-path probe). The `DriverCapabilities` name now belongs solely to
  the data domain's driver feature-flag record (`DriverCapabilitiesSchema`,
  what `IDataDriver.supports` declares). Fix: importers of the trio from
  `@objectstack/spec/contracts` (or `@objectstack/service-analytics`, whose
  re-export is renamed in lockstep) rename the import; importers who meant
  the driver flags import `DriverCapabilities` from `@objectstack/spec/data`.

**Removed — the domain-side declaration was dead (zero import-level consumers
in framework/cloud/objectui; the #4411 family's last survivors):**

- `system` `MetadataExportOptionsSchema` / `MetadataExportOptions` and
  `MetadataImportOptionsSchema` / `MetadataImportOptions` (the
  `output`/`source`-directory bags). The names now have ONE declaration each:
  the `IMetadataService.exportMetadata` / `importMetadata` parameter
  interfaces on `./contracts` (`types`/`namespaces`/`format` and
  `conflictResolution`/`validate`/`dryRun`), which `MetadataManager`
  implements. No tombstone/D2 conversion, deliberately — these are runtime
  option-bag types, not authorable metadata (same reasoning as #4458).
  `@objectstack/metadata` re-exports the two names from `./contracts` now
  (it previously re-exported the dead system-side shapes its own manager
  did not accept).
- `system` `JobSchedule` (the `= Schedule` back-compat alias). The name's one
  declaration is the `IJobService.schedule` boundary shape on `./contracts`
  (plain-string cron `expression`); the authored metadata type keeps its real
  name `Schedule`. Fix: `import type { JobSchedule } from
  '@objectstack/spec/system'` → `Schedule` (authoring tier) or the
  `./contracts` `JobSchedule` (service boundary), whichever you meant.
