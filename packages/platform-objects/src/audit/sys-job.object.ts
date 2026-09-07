// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_job — Registered Background Jobs
 *
 * Catalogue row for every job currently scheduled by an `IJobService`
 * implementation. Lets ops see the full list of recurring/one-off tasks
 * (cron, interval, once) running on this ObjectStack instance, when each
 * last ran, and whether it is currently active.
 *
 * Writers: the active job adapter (`DbJobAdapter` upserts on `schedule()`).
 * Readers: Studio "Background Jobs" view, ops dashboards.
 *
 * @namespace sys
 */
export const SysJob = ObjectSchema.create({
  name: 'sys_job',
  label: 'Background Job',
  pluralLabel: 'Background Jobs',
  icon: 'clock',
  isSystem: true,
  managedBy: 'engine-owned',
  description: 'Catalogue of registered background jobs',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{name}',
  highlightFields: ['name', 'schedule_type', 'active', 'last_run_at', 'last_status'],

  fields: {
    id: Field.text({ label: 'Job ID', required: true, readonly: true, group: 'System' }),

    name: Field.text({
      label: 'Job Name',
      required: true,
      maxLength: 255,
      searchable: true,
      // [#8578] "unique across the whole installation", not bare "unique". The
      // bare wording published the boundary as an open question while the
      // declared index below already materialized the installation-wide one —
      // and here that materialization is CORRECT (see the index comment), so
      // the text is corrected to match the constraint rather than the reverse.
      description:
        'Unique job identifier (snake_case), unique across the whole installation — ' +
        'the job catalogue is a property of the deployment, not of an organization',
      group: 'Identity',
    }),

    schedule_type: Field.select(['cron', 'interval', 'once'], {
      label: 'Schedule Type',
      required: true,
      group: 'Schedule',
    }),

    schedule_expression: Field.text({
      label: 'Expression',
      required: false,
      maxLength: 200,
      description: 'Cron expression / interval ms / ISO datetime',
      group: 'Schedule',
    }),

    // [#15872] Validated on write by `valueDomain: 'iana_time_zone'` — the same
    // declaration `sys_business_unit.timezone` / `sys_organization.timezone`
    // carry (#14238), and the same shared `Intl.DateTimeFormat` probe, never the
    // `Intl.supportedValuesOf('timeZone')` enumeration (which omits `UTC`).
    // Written values only: the `min`/`max`/`maxLength` transition-gate class, so
    // a stored non-member is never re-read and no migration is owed.
    //
    // WHAT READS THIS COLUMN, measured on #15872 before the declaration was
    // added, because it decides what the declaration is worth: NOTHING does.
    // `DbJobAdapter` writes it (`upsertJobRow`, `schedule.timezone ?? null`) and
    // its three `sys_job` read sites take `id` / `run_count` / `failure_count`
    // only — the tree's one `row.timezone` read belongs to `sys_report_schedule`.
    // The value the scheduler actually honours travels in memory
    // (`toBoundaryJobSchedule` -> `CronJobAdapter.schedule` -> croner), and
    // `DbJobAdapter.schedule` awaits that call BEFORE `upsertJobRow`, so a
    // non-member cannot reach this column through the scheduler at all: croner
    // constructed WITH a callback throws on a non-member zone, `AppPlugin`
    // catches it per job as `Background job FAILED TO SCHEDULE — it will never
    // run` (error + `jobScheduleFailuresTotal`), and the row is never written.
    // The door this declaration actually closes is the OTHER one: a direct write
    // to the object (Studio, REST, a script), which had no validation whatever.
    //
    // ⚠️ `maxLength` deliberately still says 100 while `sys_report_schedule`
    // says 64. Converging it is the card's third dimension and is NOT landed
    // here: `maxLength` is not only a write bound, it reaches DDL — narrowing a
    // physical `varchar(100)` produces `driver-sql`'s `narrow_varchar` op at
    // severity `error`, category destructive ("narrowing may truncate",
    // `os migrate apply --allow-destructive`). What this column physically holds
    // in a deployment cannot be read from the repo, and 「IANA names are short」
    // is an argument about the domain, not a reading of the data. Left to a
    // separate decision (#15872 stays open on that row). Note what the line
    // above already costs it: no `valueDomain` member is longer than 32
    // characters on this Node baseline, so 100 now admits nothing 64 would not.
    timezone: Field.text({
      label: 'Timezone',
      required: false,
      maxLength: 100,
      valueDomain: 'iana_time_zone',
      group: 'Schedule',
    }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      description: 'Whether the scheduler is currently running this job',
      group: 'State',
    }),

    last_run_at: Field.datetime({ label: 'Last Run At', required: false, group: 'State' }),
    // [#7072] `degraded` mirrors `sys_job_run.status` (#5548's ruling: one
    // additional outcome meaning "completed without accomplishing the work").
    // Enforced by ObjectQL's record validator, so it must stay in step with
    // `JobExecutionStatus` in `@objectstack/spec` and with `sys_job_run.status`.
    // A degraded run leaves `failure_count` below untouched and puts its reason
    // in `last_error` — that column may therefore carry a non-error note.
    last_status: Field.select(
      ['success', 'failed', 'timeout', 'running', 'degraded'],
      { label: 'Last Status', required: false, group: 'State' },
    ),
    last_error: Field.textarea({ label: 'Last Error', required: false, group: 'State' }),
    run_count: Field.number({ label: 'Run Count', required: false, defaultValue: 0, group: 'State' }),
    failure_count: Field.number({ label: 'Failure Count', required: false, defaultValue: 0, group: 'State' }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),
    updated_at: Field.datetime({ label: 'Updated At', required: false, group: 'System' }),
  },

  indexes: [
    // [#8578, ADR-0120 D1/S5] `'global'` — one holder across the whole
    // installation. This is the EXPLICIT spelling of what bare `true` already
    // materialized, so the physical index is byte-identical (ADR-0120 D2, zero
    // drift); what changes is that the boundary is now stated instead of being
    // a positional accident (#4986/#5082).
    //
    // Why `'global'` and not `'organization'` (the #8323 class this object was
    // screened against): nothing writes `sys_job` per organization. The sole
    // writer is `DbJobAdapter`, which upserts under a SYSTEM context and looks
    // its rows up by `where: { name }` with no organization dimension — a
    // per-organization key would make that lookup ambiguous rather than fix
    // anything. The `job` metadata type is closed to tenants on all three
    // flags (`allowOrgOverride: false` — "no per-org job fork" — plus
    // `allowRuntimeCreate: false` and `supportsOverlay: false`), and `enable`
    // below advertises no generic write verb at all. ADR-0120's S5 inventory
    // names `sys_job.name` outright as one of the engine idempotency keys that
    // are platform-wide by construction.
    //
    // The reading is PINNED in `sys-job.global-unique.test.ts`: if a
    // per-organization write path is ever opened, that test goes red rather
    // than this constraint silently becoming wrong.
    { fields: ['name'], unique: 'global' },
    { fields: ['active'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the job runner (SYSTEM_CTX),
    // never the generic data API. Reads stay open for the Setup grid.
    apiMethods: ['get', 'list'],
  },
});
