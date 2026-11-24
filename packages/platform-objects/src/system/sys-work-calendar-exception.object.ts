// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { WORK_CALENDAR_PERIODS_HELP } from './sys-work-calendar.object.js';

/**
 * sys_work_calendar_exception — Calendar Exception (ADR-0157 D1, D10)
 *
 * One dated override of a working calendar's weekly pattern. One table holds
 * public holidays, 调休 make-up workdays and plant shutdowns:
 *
 * - **`off`** — the whole date is off, and the row carries no periods.
 * - **`on`** — the date is worked, and the row carries that date's FULL
 *   periods (a half day is shortened periods). It never borrows its weekday's:
 *   with borrowing, a later edit to the weekday would silently rewrite every
 *   past make-up day (D10, 「每条写全时段」).
 *
 * One row per calendar and date (the unique key below). The date is a calendar
 * day, never an instant (ADR-0053). The period format and its validation are
 * the calendar's ({@link WORK_CALENDAR_PERIODS_HELP}, which the `periods` help reuses),
 * refused at write by the calendar service's hooks (`@objectstack/objectql`).
 * Tenancy, write grant and audit as `sys_work_calendar`. Deleting a calendar
 * deletes its exceptions.
 *
 * **Import** — opt-in on `system-data`, as `sys_exchange_rate` opts in: an
 * administrator loads a year of holidays in one file through the generic
 * import door (`sys_import_job`). The `calendar` column names the calendar by
 * its code or its name; a line repeating a (calendar, date) on file is refused
 * for that row alone by the unique key.
 *
 * @namespace sys
 */
export const SysWorkCalendarException = ObjectSchema.create({
  name: 'sys_work_calendar_exception',
  label: 'Calendar Exception',
  pluralLabel: 'Calendar Exceptions',
  icon: 'calendar-x',
  color: 'green',
  isSystem: true,
  // Platform-defined schema, organization-administered data.
  managedBy: 'system-data',
  userActions: { import: true },
  description:
    'Dated overrides of a working calendar: public holidays, make-up workdays and shutdowns. ' +
    'A working day carries its full working periods.',
  displayNameField: 'date',
  nameField: 'date', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['calendar', 'date', 'kind', 'periods'],

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    calendar: Field.lookup('sys_work_calendar', {
      label: 'Calendar',
      required: true,
      // A calendar's exceptions mean nothing without it.
      deleteBehavior: 'cascade',
      trackHistory: true,
      group: 'Exception',
    }),

    date: Field.date({
      label: 'Date',
      required: true,
      trackHistory: true,
      group: 'Exception',
    }),

    kind: Field.select(
      [
        { value: 'off', label: 'Day Off' },
        { value: 'on', label: 'Working Day' },
      ],
      {
        label: 'Kind',
        required: true,
        trackHistory: true,
        description: 'Day Off: the whole date is off. Working Day: the date is worked with the periods below, such as a make-up workday.',
        group: 'Exception',
      },
    ),

    periods: Field.text({
      label: 'Periods',
      maxLength: 255,
      trackHistory: true,
      description:
        "For a working day, all of that date's hours; they are never taken from the weekday. " + WORK_CALENDAR_PERIODS_HELP,
      group: 'Exception',
    }),

    note: Field.text({
      label: 'Note',
      maxLength: 255,
      trackHistory: true,
      description: 'What the date is, such as National Day or a make-up workday for Spring Festival.',
      group: 'Exception',
    }),
  },

  indexes: [
    { fields: ['calendar', 'date'], unique: 'organization' },
  ],

  listViews: {
    all_exceptions: {
      type: 'grid',
      name: 'all_exceptions',
      label: 'All',
      data: { provider: 'object', object: 'sys_work_calendar_exception' },
      columns: ['calendar', 'date', 'kind', 'periods', 'note'],
      sort: [{ field: 'date', order: 'desc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No calendar exceptions yet',
        message: 'Add one row per holiday or make-up workday, or import a year of them from a file.',
      },
    },
  },

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    feeds: false,
  },
});
