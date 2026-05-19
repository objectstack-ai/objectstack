// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * sys_report_schedule — Recurring Report Delivery
 *
 * Joins a `sys_saved_report` to an interval and a recipient list so
 * the reports plugin can deliver "daily pipeline digest" / "weekly
 * lead summary" without a separate workflow.
 *
 * Scheduling: MVP supports `interval_minutes` only (1440 = daily,
 * 10080 = weekly). The `cron_expression` field is reserved for the
 * follow-up that wires `CronJobAdapter` — when present and the
 * adapter is available, it wins over `interval_minutes`.
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
  compactLayout: ['report_id', 'recipients', 'interval_minutes', 'active', 'next_run_at'],

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

    timezone: Field.text({
      label: 'Timezone',
      required: false,
      maxLength: 64,
      defaultValue: 'UTC',
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
