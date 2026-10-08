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
import { ScriptBodySchema } from '../data/hook-body.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ScheduleOrganizationSchema } from '../automation/schedule-organization.zod';
import { bannedKeys, requiredOneOf } from '../shared/refinement-projection';

/**
 * The cron zone's authoring door — `iana_time_zone` membership, judged by the
 * package's own shared predicate (#16292).
 *
 * The same concept is judged by the same predicate at three columns already
 * (`sys_business_unit.timezone`, `sys_organization.timezone`, `sys_job.timezone`,
 * all via `valueDomain: 'iana_time_zone'`), and
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
  + 'Run `os migrate meta --from 16` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

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
  + 'Run `os migrate meta --from 17` to list the mechanical edits for existing sources; `--write` applies the ones it can prove, and you apply the rest by hand.';

/**
 * A job with nothing to run. Before `body` existed `handler` was required, so
 * this shape could not parse; once either key may be omitted the pair needs a
 * rule of its own, or a job that runs nothing parses green and is skipped at
 * every boot.
 */
const JOB_RUNS_NOTHING =
  'A job needs something to run: declare `body` (a sandboxed JS body, `{ language: "js", source, '
  + 'capabilities }` — the preferred form for code), `pull` (`{ mapping: "<mapping name>" }` — pull '
  + 'that mapping\'s `connectorSource` on this job\'s schedule, no code) or `handler` (the name of a '
  + '`defineStack({ functions })` entry — deprecated). This job declares none of them, so no boot '
  + 'could ever schedule it.';

/**
 * A job's `pull` is a run form of its own, the declarative one (ruling Q1-B on
 * the connector-sync card): the platform binds it and calls the automation
 * service's pull, so there is no code beside it to run. `body` + `handler`
 * stays legal (the body wins, the deprecated handler beside it is never run);
 * `pull` + either is refused, because one of the two would silently never run.
 */
const JOB_PULL_EXCLUSIVE =
  'A job with `pull` runs that pull and nothing else: `pull` cannot be declared beside `body` or '
  + '`handler`, because the platform binds the pull itself and one of the two run forms would never '
  + 'run. Keep `pull` and delete the code, or keep the code (`body`) and delete `pull` — a body cannot '
  + 'call a pull; a pull on a schedule is this declaration.';

/**
 * The organization a job runs as — its `body`'s `ctx.api`, the execution
 * context its `handler` is handed, and its `pull`'s target read and writes
 * alike. The value shape is the scheduled flow's
 * ({@link ScheduleOrganizationSchema}, `sys_organization.id`), reused, and so
 * is the deployment-posture rule that judges it: the maintainer's 2026-09-08
 * ruling on scheduled work across organizations, extended from scheduled flows
 * to jobs by ruling Q2-O1 on the connector-sync card. That rule is
 * `resolveScheduledWorkPolicy` (`@objectstack/types`), read by the job binder
 * at BIND — never here: whether the key is required depends on the
 * deployment's tenancy posture and its scheduled-work switch, and neither is
 * knowable at authoring time (`automation/schedule-organization.zod.ts` says
 * why an authoring-time rule for it must not exist).
 */
const JOB_ORGANIZATION_DESCRIPTION =
  'Organization id (sys_organization.id) this job runs as — its `body`\'s `ctx.api`, the execution '
  + 'context its `handler` is handed, and its `pull`\'s reads and writes alike, as a system run '
  + 'carrying that organization. A scheduled run has no session to inherit one from. Judged at bind '
  + 'by the posture rule scheduled flows use: required under the isolated tenancy posture (a job that '
  + 'declares none is not scheduled); optional under group (undeclared, the run carries no '
  + 'organization and a tenant-scoped write it makes is refused); not required under single (the '
  + 'install\'s one organization is resolved beneath each write). Where declared, it is the '
  + 'organization the run acts as on every posture.';

/**
 * The time limit of a body job has ONE spelling: the job's own `timeoutMs`.
 *
 * `ScriptBodySchema` carries its own per-invocation `timeoutMs` (capped at
 * 30 s) because a hook or an action body has no other place to say it. A job
 * does: one attempt of a body job IS one sandbox invocation, so a second
 * spelling would be the same limit written twice, and the two would disagree
 * the first time an author changed one of them. The relation is stated once,
 * on `timeoutMs` below; this is the refusal that keeps it one statement.
 */
const JOB_BODY_TIMEOUT_REFUSED =
  "`body.timeoutMs` is not accepted on a job. A job's time limit is the job's own `timeoutMs`: one "
  + 'attempt of a body job is one sandbox invocation, so the job-level key is the one limit and the '
  + 'runtime bounds the sandbox run by it. Move the value to `timeoutMs` on the job (milliseconds, '
  + 'unchanged).';

export const JobSchema = lazySchema(() => strictObject({
  surface: 'this job',
  history:
    'Until this shape was closed these were dropped silently — the item still registered, minus whatever the key was meant to configure.',
  aliases: {
    cron: 'schedule', interval: 'schedule', fn: 'handler', function: 'handler', retry: 'retryPolicy', enabled_: 'enabled',
    // A pull written as a bare mapping name, or under the binding's own word.
    mapping: 'pull', sync: 'pull', connectorSource: 'pull',
    // The organization under the near-miss spellings the scheduled flow's
    // refusal names — on this closed shape they are refused at parse, by name.
    // One spelling per probe: the probe folds case and `_`, so `organization_id`,
    // `org_id` and `tenant_id` are caught by the camelCase entries.
    organizationId: 'organization', orgId: 'organization', tenantId: 'organization', tenant: 'organization',
  },
  guidance: { id: JOB_ID_RETIRED },
}, {
  // `id` removed in 17.0.0 (#4667) — see JOB_ID_RETIRED. `name` is the identity.
  name: z.string().regex(/^[a-z_][a-z0-9_]*$/).describe('Job name (snake_case)'),
  label: z.string().optional().describe('Human-readable label'),
  description: z.string().optional().describe('Job description / purpose'),
  schedule: ScheduleSchema.describe('Job schedule configuration'),
  /**
   * Handler Logic — DEPRECATED, prefer {@link body}.
   *
   * The name of a `defineStack({ functions })` entry. A function is code, never
   * a metadata row (ADR-0088), so a JSON artifact carries only this name and the
   * callable travels in the artifact's runtime module — which only a door that
   * imports that module can bind. `body` is the form that travels with the
   * metadata itself, exactly as it did for hooks.
   *
   * Optional since `body` exists, but not all three of `body` / `handler` /
   * `pull` absent: {@link JOB_RUNS_NOTHING}. When both `body` and `handler` are
   * present `body` wins, as for hooks; beside `pull` it is refused
   * ({@link JOB_PULL_EXCLUSIVE}).
   */
  handler: z.string().optional().describe('Handler function name (must match a key in `defineStack({ functions })`) — DEPRECATED, prefer `body`. When both are present `body` wins; refused beside `pull`. A job must declare one of `body`, `handler` or `pull`.'),
  /**
   * Job Body (L2 sandboxed JS) — the hook body shape, reused by reference.
   *
   * Only the L2 member of `HookBodySchema`: an L1 expression is a pure formula
   * whose only effect is its returned value, and a job runs for its effects —
   * the one reader of a job's return value is the `{ outcome }` report
   * (`JobRunOutcome`, `contracts/job-service.ts`), which reports on work an
   * expression cannot do. The refusal text lives on `ScriptBodySchema.language`
   * (`data/hook-body.zod.ts`), where it fires only for a slot like this one.
   *
   * The body runs in the QuickJS sandbox: no module scope, data only through
   * `ctx.api` under its declared `capabilities`, logging through `ctx.log`.
   * The in-process `JobHandlerContext` (`ql`, `logger`, `bundle` —
   * `@objectstack/runtime`) does not exist there. Its time limit is the job's
   * {@link timeoutMs}; the body's own `timeoutMs` is refused on a job
   * ({@link JOB_BODY_TIMEOUT_REFUSED}).
   *
   * Authored as data. `objectstack build` does not mint it from the function a
   * `handler` names: `defineStack` parses `functions` through `z.function()`,
   * which replaces each callable with a wrapper whose source is not the
   * author's, and the documented handler form reads `ql` / `logger` off a
   * destructured `JobHandlerContext` that no sandbox `ctx` carries.
   */
  //
  // `ScriptBodySchema` by reference; the one job-specific rule is a refinement
  // on this slot, declared through the closed projection list so the published
  // JSON Schema bans the key too (`propertyNames`), not only the parse.
  body: ScriptBodySchema.refine(bannedKeys(['timeoutMs']), {
    message: JOB_BODY_TIMEOUT_REFUSED,
    path: ['timeoutMs'],
  }).optional().describe(
    'Job body — a sandboxed JS (L2) body, the same shape hooks and actions use; an expression (L1) body is refused, because a job runs for its effects and an expression has none. '
      + 'Preferred over `handler`: when both are present `body` wins. '
      + 'It runs in the QuickJS sandbox with no module scope (no imports, no helpers or constants from the surrounding file): it reaches data only through `ctx.api` under its declared `capabilities` (`api.read` / `api.write` / `api.transaction`) and logs through `ctx.log` (`log`); the in-process handler context (`ql`, `logger`, `bundle`) does not exist there. '
      + "Its time limit is the job's `timeoutMs` (see there): long-running work declares a `timeoutMs` that covers it, or splits into bounded runs that each finish within it. "
      + "Every door that brings an artifact in schedules a job's `body` — the boot, and `os package install` on install and on every restart — while a `handler` is code that travels only in the artifact's runtime module and runs only on a boot that loads it (a config, or `os start --artifact`); `os package install` therefore refuses an enabled job with no `body`. "
      + 'A `pull` is data too, so an enabled `pull` job is judged by its `pull` instead: it installs when the `pull` binds (it names a mapping the package declares, with a `connectorSource`) and is refused when it does not, as is a job whose `body` the declaration refuses. '
      + 'Refused beside `pull`.',
  ),
  /**
   * Job Pull — the declarative run form (ruling Q1-B on the connector-sync
   * card): on each tick the platform pulls the named `mapping`'s
   * `connectorSource` through the automation service
   * (`IAutomationService.pullConnectorSource`) and writes the rows through
   * the import runner. No code: the job says WHAT it does, so "which job pulls
   * mapping M" is a metadata query, and the run's outcome is mapped once, by
   * the binder — a refused pull is a `failed` run (retried per `retryPolicy`),
   * a pull whose rows the import runner refused is `degraded`.
   *
   * A third run form beside `body` and `handler`, exclusive with both
   * ({@link JOB_PULL_EXCLUSIVE}). It is data, so it travels with the artifact
   * and binds on every door, as a `body` does. ⛔ Not a second code mechanism —
   * a job carries code only as a `body` (the hook body shape, one binder) —
   * and not a precedent for further task kinds: a second declarative member
   * needs its own pull.
   *
   * `mapping` names a `mapping` the same stack declares, with a
   * `connectorSource`: `defineStack` (and so `os validate`) refuses a name that
   * resolves to neither.
   */
  pull: strictObject({
    surface: 'this job’s pull',
    history:
      'Declared closed from its first day: an unrecognized key is refused, never dropped.',
    aliases: { name: 'mapping', mappingName: 'mapping', source: 'mapping', connectorSource: 'mapping', from: 'mapping' },
  }, {
    mapping: SnakeCaseIdentifierSchema.describe(
      'Name of the `mapping` whose `connectorSource` this job pulls on its schedule — a mapping the same '
      + 'stack declares, with a `connectorSource` (refused at `defineStack` / `os validate` otherwise). The '
      + 'mapping says where the rows come from, the field map, the write mode and the match key; the job '
      + 'says when.',
    ),
  }).optional().describe(
    'Pull run form: on each run the platform pulls the named mapping\'s `connectorSource` (one action call, '
    + 'one response) and writes the rows through the import runner — no code. A refused pull records the run '
    + '`failed` (retried per `retryPolicy`); a pull whose rows the import runner refused records it '
    + '`degraded`. Data like `body`, so every door schedules it. Refused beside `body` or `handler`.',
  ),
  organization: ScheduleOrganizationSchema.optional().describe(JOB_ORGANIZATION_DESCRIPTION),
  retryPolicy: RetryPolicySchema.optional().describe('Retry policy: failed runs (including timeouts) are retried with exponential backoff (delay = min(backoffMs * backoffMultiplier^(retry-1), maxRetryDelayMs), optionally jittered) up to maxRetries retries after the initial attempt. Omit the block for a single attempt; declaring it without `maxRetries` also means no retry since 17.0.0 — state a count to opt in.'),
  // Renamed from `timeout` (#14478): the unit (milliseconds) lived only in the
  // description while the sibling `retryPolicy.backoffMs` spells its own.
  // Tombstoned rather than deleted so the rejection carries the rename.
  //
  // ⚠️ THE ONE STATEMENT of how a job body's time limit relates to the body
  // shape's own `timeoutMs` lives in this describe; `body`'s describe and
  // JOB_BODY_TIMEOUT_REFUSED point here. Two spellings of one limit is the
  // defect this keeps out.
  timeoutMs: z.number().int().positive().optional().describe('Per-attempt time limit in milliseconds; an over-limit run is recorded with execution status "timeout". A `handler` run is abandoned, not forcibly cancelled. For a job with a `body` this is the ONE time limit: one attempt is one sandbox invocation, the runtime bounds that invocation by this value, and the body shape\'s own `timeoutMs` (capped at 30000 for hooks and actions) is refused on a job — so this key, which has no such cap, is where long-running work states how long it needs. Omit for no per-attempt limit; a `body` run is then still bounded by the sandbox\'s own default invocation limits.'),
  timeout: retiredKey(JOB_TIMEOUT_RETIRED),
  enabled: z.boolean().default(true).describe('Whether the job is enabled'),

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `job` is a registered metadata type, so `MetadataPlugin`'s artifact loader
  // stamps `_packageId` / `_provenance` on it like every sibling. Undeclared,
  // they were dropped on every parse: protection metadata lost on round-trip,
  // and a hard 422 waiting for the day this shape is closed (see
  // `metadata-type-schemas.test.ts` for the invariant and how it was hollow).
  ...MetadataProtectionFields,
// Declared through the closed projection list, so the published JSON Schema
// states the rule (`anyOf` of one `required` per key) instead of being wider
// than the parse.
}).refine(requiredOneOf(['body', 'handler', 'pull']), { message: JOB_RUNS_NOTHING, path: ['body'] })
// "`pull` excludes `body` and `handler`" has no arm in the closed projection
// list, so the published JSON Schema stays wider than this rule; the site is
// recorded in `dropped-refinements.baseline.json`, beside every other
// mutual-exclusion refinement in this package.
  .refine((job) => job.pull === undefined || (job.body === undefined && job.handler === undefined), {
    message: JOB_PULL_EXCLUSIVE,
    path: ['pull'],
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
 *   // The preferred form: sandboxed source that travels with the metadata.
 *   body: {
 *     language: 'js',
 *     source: "const open = await ctx.api.object('task').find({ where: { status: 'open' } }); ctx.log.info('open tasks', { count: open.length });",
 *     capabilities: ['api.read', 'log'],
 *   },
 *   // Deprecated and optional beside `body`, which wins when both are present. It
 *   // names a defineStack({ functions }) entry, which only a boot that loads the
 *   // artifact's runtime module (a config, or `os start --artifact`) can run.
 *   handler: 'syncMetadata',
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
