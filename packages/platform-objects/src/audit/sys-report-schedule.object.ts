// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_report_schedule — Recurring Report Delivery
 *
 * Joins a `sys_saved_report` to an interval and a recipient list so
 * the reports plugin can deliver "daily pipeline digest" / "weekly
 * lead summary" without a separate workflow.
 *
 * Scheduling: `interval_minutes` (1440 = daily, 10080 = weekly) or a
 * `cron_expression`. When a `cron_expression` is set it wins over
 * `interval_minutes` and is evaluated in `timezone` (default UTC) via
 * croner — so "every weekday 09:00 local" is expressible. `next_run_at`
 * is computed from whichever applies.
 *
 * Delivery: when the master dispatch job ticks (every minute by
 * default), every schedule with `next_run_at <= now` is loaded,
 * its report is executed, the result is rendered into the report's
 * `format`, and the rendered body is emailed to each address in
 * `recipients`. `next_run_at` is then advanced by `interval_minutes`.
 *
 * Conventions:
 *  - `recipients` is a comma-separated list of RFC-5322 addresses to
 *    keep the schema driver-agnostic. The reports plugin splits and
 *    trims before handing the list to IEmailService.
 *  - `active=false` disables the schedule without losing its history.
 *
 * @namespace sys
 */
export const SysReportSchedule = ObjectSchema.create({
  name: 'sys_report_schedule',
  label: 'Report Schedule',
  pluralLabel: 'Report Schedules',
  icon: 'clock',
  isSystem: true,
  managedBy: 'platform',
  description: 'Recurring delivery of a sys_saved_report via email',
  titleFormat: '{report_id} → {recipients}',
  highlightFields: ['report_id', 'recipients', 'interval_minutes', 'active', 'next_run_at'],

  fields: {
    id: Field.text({
      label: 'Schedule ID',
      required: true,
      readonly: true,
      group: 'System',
    }),

    report_id: Field.lookup('sys_saved_report', {
      label: 'Report',
      required: true,
      group: 'Schedule',
    }),

    name: Field.text({
      label: 'Name',
      required: false,
      maxLength: 200,
      description: 'Optional label for the digest — used in the email subject',
      group: 'Schedule',
    }),

    interval_minutes: Field.number({
      label: 'Interval (minutes)',
      required: false,
      defaultValue: 1440,
      description: 'How often to send (1440 = daily, 10080 = weekly)',
      group: 'Schedule',
    }),

    cron_expression: Field.text({
      label: 'Cron Expression',
      required: false,
      maxLength: 100,
      description: 'Optional 5/6-field cron — overrides interval_minutes when present',
      group: 'Schedule',
    }),

    // [#15872] Validated on write by `valueDomain: 'iana_time_zone'` — the same
    // declaration `sys_business_unit.timezone` / `sys_organization.timezone`
    // carry (#14238), and the same shared `Intl.DateTimeFormat` probe, never the
    // `Intl.supportedValuesOf('timeZone')` enumeration (which omits `UTC`, this
    // column's own default). Written values only (the `min`/`max`/`maxLength`
    // transition-gate class), so a stored non-member survives and no migration
    // is owed.
    //
    // WHY THIS COLUMN IS THE SHARP ONE, measured on #15872: unlike
    // `sys_job.timezone`, this value IS read back and handed to a scheduler.
    // `ReportService.rowFromSchedule` lifts it off the row and `nextRunAt` calls
    // `new Cron(cron, { timezone }).nextRun(from)`. croner (10.0.1) does not
    // reject a non-member zone when it is constructed WITHOUT a callback — it
    // throws from `nextRun()` — and `nextRunAt` CATCHES that throw and falls
    // back to `from + interval_minutes`. So before this line, a typo'd zone on a
    // cron schedule silently discarded the cron: an admin's "every weekday 09:00
    // Asia/Shanghai" became "every 1440 minutes, forever", logged only as
    // `invalid cron '<expr>'` — a warning that names the wrong input, since the
    // expression was fine. Neither a throw nor a fall back to UTC: the wrong
    // instant, permanently, which is the outcome this card was told to escalate
    // on. `scheduleReport`'s eager create-time guard does not catch it either;
    // it constructs a callback-less `Cron` and so is blind to exactly this half
    // of its own input. Refusing the write is what closes it.
    //
    // `maxLength: 64` and `defaultValue: 'UTC'` are BOTH unchanged. The bound is
    // already the value #14238 justified (twice the domain's real ceiling: the
    // enumeration's longest name is 30 characters on this Node baseline, the
    // longest tzdb link 32). The default is a consumer semantic — this reader
    // documents "default UTC" and falls back to `'UTC'` in four places — and is
    // deliberately NOT converged with `sys_job`, which has none.
    timezone: Field.text({
      label: 'Timezone',
      required: false,
      maxLength: 64,
      defaultValue: 'UTC',
      valueDomain: 'iana_time_zone',
      group: 'Schedule',
    }),

    active: Field.boolean({
      label: 'Active',
      required: true,
      defaultValue: true,
      group: 'Schedule',
    }),

    recipients: Field.text({
      label: 'Recipients',
      required: true,
      maxLength: 4000,
      description: 'Comma-separated email addresses',
      group: 'Delivery',
    }),

    format: Field.select(
      ['csv', 'html_table'],
      {
        label: 'Format',
        required: false,
        defaultValue: 'html_table',
        description: 'Render format — csv is attached, html_table is inlined',
        group: 'Delivery',
      },
    ),

    subject_template: Field.text({
      label: 'Subject Template',
      required: false,
      maxLength: 200,
      description: 'Email subject; {{name}} / {{date}} / {{rows}} are substituted',
      group: 'Delivery',
    }),

    owner_id: Field.lookup('sys_user', {
      label: 'Owner',
      required: false,
      group: 'Provenance',
    }),

    next_run_at: Field.datetime({
      label: 'Next Run',
      required: false,
      description: 'Dispatcher loads schedules where next_run_at <= now',
      group: 'State',
    }),

    last_sent_at: Field.datetime({
      label: 'Last Sent',
      required: false,
      group: 'State',
    }),

    last_status: Field.select(
      ['ok', 'failed', 'skipped'],
      {
        label: 'Last Status',
        required: false,
        group: 'State',
      },
    ),

    last_error: Field.textarea({
      label: 'Last Error',
      required: false,
      group: 'State',
    }),

    created_at: Field.datetime({
      label: 'Created At',
      required: true,
      defaultValue: 'NOW()',
      readonly: true,
      group: 'System',
    }),

    updated_at: Field.datetime({
      label: 'Updated At',
      required: false,
      group: 'System',
    }),
  },

  indexes: [
    // Hot path for the dispatch loop.
    { fields: ['active', 'next_run_at'] },
    { fields: ['report_id'] },
    { fields: ['owner_id'] },
  ],
});
