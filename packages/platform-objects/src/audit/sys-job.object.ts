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
      description: 'Unique job identifier (snake_case)',
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

    timezone: Field.text({
      label: 'Timezone',
      required: false,
      maxLength: 100,
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
    { fields: ['name'], unique: true },
    { fields: ['active'] },
  ],

  enable: {
    // [ADR-0103] Engine-owned: written only by the job runner (SYSTEM_CTX),
    // never the generic data API. Reads stay open for the Setup grid.
    apiMethods: ['get', 'list'],
  },
});
