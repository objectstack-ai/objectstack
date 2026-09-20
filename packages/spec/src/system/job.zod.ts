// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { CronExpressionInputSchema } from '../shared/expression.zod';

/**
 * Cron Schedule Schema
 * Schedule jobs using cron expressions
 */
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { retiredKey } from '../shared/retired-key';
import { isValueDomainMember } from '../shared/value-domain.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/**
 * The cron zone's authoring door — `iana_time_zone` membership, judged by the
 * package's own shared predicate (#16292).
 *
 * The same concept is judged by the same predicate at four columns already
 * (`sys_business_unit.timezone`, `sys_organization.timezone`, `sys_job.timezone`,
 * `sys_report_schedule.timezone`, all via `valueDomain: 'iana_time_zone'`), and
 * `sys_job.timezone` is a WRITE-ONLY mirror — `DbJobAdapter.upsertJobRow` writes
 * it and nothing reads it back — so that column never judges the value the
 * scheduler actually honours. This is the separate, earlier door: the value an
 * author writes here is the one `toBoundaryJobSchedule` carries to
 * `CronJobAdapter.schedule`, where croner (constructed with a callback) throws on
 * a non-member and `AppPlugin` logs a per-job FAILED TO SCHEDULE at `error`. The
 * job is then declared and never runs. Refusing at parse moves that discovery
 * from "whichever environment boots first" to `defineJob` / `os build`.
 *
 * ⚠️ Membership is the runtime's ICU answer, not a checked-in list — the
 * `Intl.DateTimeFormat` probe the module header of `shared/value-domain.zod.ts`
 * argues for at length (the `Intl.supportedValuesOf('timeZone')` enumeration
 * omits `UTC`, this platform's own default). That is deliberate and is the SAME
 * exposure the four columns, the settings door and `resolveAuthzContext` already
 * carry: the accept set here is exactly what every `Intl`-based consumer
 * downstream accepts, so parse-time and schedule-time cannot disagree on one
 * host. ⛔ Do not substitute a pattern or a pinned zone list — both re-admit
 * `Europe/Munich`, a shape-valid zone that does not exist.
 */
const CronTimezoneSchema = z.string().refine(
  (value) => isValueDomainMember('iana_time_zone', value),
  {
    error: (issue) =>
      `'${String(issue.input)}' is not an IANA time zone identifier. `
      + `Write a zone the platform can honour — 'UTC', 'Asia/Shanghai', 'America/New_York' — `
      + `not a UTC offset ('UTC+8'), a Windows zone name ('China Standard Time') or a `
      + `zone that does not exist ('Europe/Munich'). Membership is the Intl.DateTimeFormat `
      + `probe, the same judge as valueDomain: 'iana_time_zone' on sys_job.timezone.`,
  },
);

export const CronScheduleSchema = lazySchema(() => z.object({
  type: z.literal('cron'),
  expression: CronExpressionInputSchema.describe('Cron expression — cron`0 0 * * *` for daily at midnight. Build emits {dialect:"cron",source} envelope.'),
  timezone: CronTimezoneSchema.optional().default('UTC').describe('IANA time zone the cron expression is evaluated in (e.g., "America/New_York"). Refused at parse unless it is a member of `iana_time_zone` — the same closed domain and the same `Intl.DateTimeFormat` membership probe `sys_job.timezone` is written against; a UTC offset such as "UTC+8" is not one.'),
}));

/**
 * Interval Schedule Schema
 * Schedule jobs at fixed intervals
 */
export const IntervalScheduleSchema = lazySchema(() => z.object({
  type: z.literal('interval'),
  intervalMs: z.number().int().positive().describe('Interval in milliseconds'),
}));

/**
 * Once Schedule Schema
 * Schedule a job to run once at a specific time
 */
export const OnceScheduleSchema = lazySchema(() => z.object({
  type: z.literal('once'),
  at: z.string().datetime().describe('ISO 8601 datetime when to execute'),
}));

/**
 * Schedule Schema
 * Discriminated union of all schedule types
 */
export const ScheduleSchema = lazySchema(() => z.discriminatedUnion('type', [
  CronScheduleSchema,
  IntervalScheduleSchema,
  OnceScheduleSchema,
]));

export type Schedule = z.input<typeof ScheduleSchema>;
/** Post-parse shape of {@link Schedule} — defaults applied, transforms run (ADR-0122). */
export type ScheduleParsed = z.infer<typeof ScheduleSchema>;
export type CronSchedule = z.input<typeof CronScheduleSchema>;
/** Post-parse shape of {@link CronSchedule} — defaults applied, transforms run (ADR-0122). */
export type CronScheduleParsed = z.infer<typeof CronScheduleSchema>;
export type IntervalSchedule = z.input<typeof IntervalScheduleSchema>;
export type OnceSchedule = z.input<typeof OnceScheduleSchema>;
// NOTE [#4538]: the legacy `export type JobSchedule = Schedule` alias was
// removed. It collided with the differently-shaped `JobSchedule` on
// `@objectstack/spec/contracts` — the IJobService boundary type every runtime
// caller (trigger-schedule, wait-node, the job adapters) imports — while this
// alias itself had zero consumers. The authored metadata type keeps its real
// name: `Schedule`.

/**
 * Retry Policy Schema — job retry behaviour with exponential backoff.
 *
 * The declaration moved to `shared/retry-policy.zod.ts` in 17.0.0 (#4661).
 * `@objectstack/spec/automation` exported an identically-named, differently
 * shaped `RetryPolicy` for the `try_catch` node's `retry` region, so which type
 * a consumer got depended only on the import path (the #4411 trap) — and they
 * were never two concepts: both compute
 * `delay = base * multiplier^(retry-1)`. Re-exported so `./system` keeps
 * publishing the name (and its `system/RetryPolicy` def, keyed by entry
 * namespace).
 *
 * Three things change for job authors, all covered by the
 * `retry-policy-converged` conversion:
 *
 *  - `maxRetryDelayMs` and `jitter` are now available here (they were
 *    automation-only). Both are honoured by `runWithPolicy`.
 *  - `maxRetries` now defaults to **0**, not 3, and `backoffMultiplier` to 1,
 *    not 2 — the conversion writes the old values into existing documents, so
 *    no deployed job changes behaviour; only a NEWLY authored omission means
 *    "no retry".
 *  - `maxRetries` is capped at 10 and `backoffMultiplier` floored at 1 (the
 *    automation constraints). Both reject loudly at parse time.
 */
export { RetryPolicySchema, type RetryPolicy, type RetryPolicyParsed } from '../shared/retry-policy.zod';
import { RetryPolicySchema } from '../shared/retry-policy.zod';

/**
 * Job Schema
 * Defines a scheduled job that executes background logic.
 * 
 * @example Metadata Sync Job (Cron)
 * {
 *   name: "sync_metadata_nightly",
 *   schedule: {
 *     type: "cron",
 *     expression: "0 0 * * *", // Midnight
 *     timezone: "UTC"
 *   },
 *   handler: "services/syncStatus.ts:syncAll", 
 *   retryPolicy: {
 *     maxRetries: 3,
 *     backoffMs: 5000
 *   }
 * }
 */
/**
 * `job.id`, retired in 17.0.0 (#4667, ADR-0049).
 *
 * The `describe()` did the damage: "defaults to `name` when omitted" implies an
 * identity OVERRIDE that never existed. Nothing read the key. `name` is the
 * job's identity at every layer that has one — the scheduling key, the `sys_job`
 * row key (the DB adapter upserts by `name` and mints its own row id), and the
 * `JobExecution.jobId` stamp — so two jobs differing only in `id` were never two
 * jobs, they were one job declared twice, with the second silently winning.
 */
const JOB_ID_RETIRED =
  '`job.id` was removed in @objectstack/spec 17.0.0 (ADR-0049) — nothing ever read '
  + 'it, and its own description ("defaults to `name` when omitted") advertised an identity '
  + 'override that did not exist. `name` IS the job\'s identity everywhere: the scheduling '
  + 'key, the `sys_job` row key, and the `JobExecution.jobId` stamp. Two jobs differing only '
  + 'in `id` were the same job. Delete the key; rename the job via `name` if you need a '
  + 'different identity. '
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; apply them by hand.';

/**
 * `job.timeout` → `job.timeoutMs` (#14478). The unit lived only in the
 * description; the sibling `retryPolicy.backoffMs` spells its own, so one
 * surface carried two conventions and an author copying a seconds value in
 * got a limit 1000× too short with no error anywhere.
 */
const JOB_TIMEOUT_RETIRED =
  '`job.timeout` was removed in @objectstack/spec 17 — its unit (milliseconds) lived only '
  + 'in the description while the sibling `retryPolicy.backoffMs` spells its own, so the same number '
  + 'read as two conventions on one surface. Rename the key to `timeoutMs`; the value (milliseconds) '
  + 'is unchanged. '
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; apply them by hand.';

export const JobSchema = lazySchema(() => strictObject({
  surface: 'this job',
  history:
    'Until this shape was closed these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  aliases: { cron: 'schedule', interval: 'schedule', fn: 'handler', function: 'handler', retry: 'retryPolicy', enabled_: 'enabled' },
  guidance: { id: JOB_ID_RETIRED },
}, {
  // `id` removed in 17.0.0 (#4667) — see JOB_ID_RETIRED. `name` is the identity.
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Job name (snake_case)'),
  label: z.string().optional().describe('Human-readable label'),
  description: z.string().optional().describe('Job description / purpose'),
  schedule: ScheduleSchema.describe('Job schedule configuration'),
  handler: z.string().describe('Handler function name (must match a key in `defineStack({ functions })`)'),
  retryPolicy: RetryPolicySchema.optional().describe('Retry policy: failed runs (including timeouts) are retried with exponential backoff (delay = min(backoffMs * backoffMultiplier^(retry-1), maxRetryDelayMs), optionally jittered) up to maxRetries retries after the initial attempt. Omit the block for a single attempt; declaring it without `maxRetries` also means no retry since 17.0.0 — state a count to opt in.'),
  // Renamed from `timeout` (#14478): the unit (milliseconds) lived only in the
  // description while the sibling `retryPolicy.backoffMs` spells its own.
  // Tombstoned rather than deleted so the rejection carries the rename.
  timeoutMs: z.number().int().positive().optional().describe('Per-attempt time limit in milliseconds; an over-limit run is recorded with execution status "timeout". The in-flight handler is abandoned, not forcibly cancelled. Omit for no time limit.'),
  timeout: retiredKey(JOB_TIMEOUT_RETIRED),
  enabled: z.boolean().default(true).describe('Whether the job is enabled'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `job` is a registered metadata type, so `MetadataPlugin`'s artifact loader
  // stamps `_packageId` / `_provenance` on it like every sibling. Undeclared,
  // they were dropped on every parse: protection metadata lost on round-trip,
  // and a hard 422 waiting for the day this shape is closed (see
  // `metadata-type-schemas.test.ts` for the invariant and how it was hollow).
  ...MetadataProtectionFields,
}));

export type Job = z.input<typeof JobSchema>;
/** Post-parse shape of {@link Job} — defaults applied, transforms run (ADR-0122). */
export type JobParsed = z.infer<typeof JobSchema>;

/**
 * Type-safe factory for declaring background jobs in metadata-as-code.
 *
 * @example
 * ```ts
 * export const nightlySync = defineJob({
 *   name: 'sync_metadata_nightly',
 *   schedule: { type: 'cron', expression: '0 0 * * *', timezone: 'UTC' },
 *   handler: 'syncMetadata', // must be registered in defineStack({ functions: { syncMetadata: () => ... } })
 * });
 * ```
 */
export function defineJob(config: z.input<typeof JobSchema>): JobParsed {
  return JobSchema.parse(config);
}

/**
 * Job Execution Status Enum
 * Status of job execution
 *
 * [#7072] `degraded` executes the 2026-08-08 maintainer ruling on #5548, quoted
 * verbatim: 「**Vocabulary stays minimal** — one additional outcome meaning
 * "completed without accomplishing the work". ⛔ Do not open an enum family; a
 * second key would need its own pull.」 It is the consumer-side half of the
 * `JobRunOutcome` producer shape #6617 shipped on `contracts/job-service.ts`,
 * and it is declared in exactly three places that must agree: this enum,
 * `sys_job_run.status` and `sys_job.last_status` (both in
 * `@objectstack/platform-objects`). The platform-object selects are *enforced*
 * — ObjectQL's record validator refuses an out-of-vocabulary `select` value
 * with `invalid_option` — so a value legal here and absent there is a silently
 * swallowed write, not a type error.
 *
 * ⚠️ **`degraded` is NOT a failure and never retries.** It means the run ran to
 * completion and its work did not happen (a store was unavailable, zero rows
 * matched a precondition). Retry and failure are driven exclusively by a
 * *rejected* handler promise; a resolved `{ outcome: 'degraded' }` never
 * re-runs the job. See {@link JobHandler} in `contracts/job-service.ts` for the
 * three-outcome table this mirrors.
 *
 * **Where the reason goes, and what that costs.** A degraded run's `reason`
 * rides the existing `error` column (`sys_job.last_error` for the job-level
 * mirror) and leaves `failure_count` flat — the ruling's minimal-vocabulary
 * spirit applied to columns as to enum members, decided at the `domain:services`
 * seat on #7072. The cost is stated here rather than left for the next reader: a
 * column labelled **"Error"** may carry a non-error operator note whenever
 * `status === 'degraded'`, so a reader must gate on the status before reading
 * that column as a failure. Adding a distinct `reason` column would be the
 * "second key" the ruling reserves for its own pull.
 */
export const JobExecutionStatus = z.enum([
  'running',
  'success',
  'failed',
  'timeout',
  'degraded',
]);

export type JobExecutionStatus = z.input<typeof JobExecutionStatus>;

/**
 * Job Execution Schema
 * Logs for job execution.
 *
 * [#4538] This is the ONE declaration of `JobExecution` — the contracts entry
 * re-exports it for `IJobService.getExecutions`. The duration field is
 * `durationMs`: that is what every job adapter produces (cron/interval set it
 * from `Date.now()` deltas; the DB adapter round-trips the `duration_ms`
 * column). The schema's earlier `duration` spelling described records nothing
 * ever wrote and was aligned to the runtime truth.
 */
export const JobExecutionSchema = lazySchema(() => z.object({
  jobId: z.string().describe('Job identifier'),
  startedAt: z.string().datetime().describe('ISO 8601 datetime when execution started'),
  completedAt: z.string().datetime().optional().describe('ISO 8601 datetime when execution completed'),
  status: JobExecutionStatus.describe('Execution status'),
  error: z.string().optional().describe('Error message if failed'),
  durationMs: z.number().int().optional().describe('Execution duration in milliseconds'),
}));

export type JobExecution = z.input<typeof JobExecutionSchema>;
