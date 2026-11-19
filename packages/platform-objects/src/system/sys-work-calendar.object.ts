// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field, WORK_CALENDAR_CODE_PATTERN, WORK_CALENDAR_MAINTENANCE_LEAD_DAYS } from '@objectstack/spec/data';

/**
 * The help every weekday's period column carries, stated once so the seven
 * columns can never disagree about the format (ADR-0157 D1, D7, D10).
 */
export const WORK_CALENDAR_PERIODS_HELP =
  'Working periods that day in the calendar\'s time zone, HH:mm-HH:mm separated by commas, such as 09:00-12:00, 13:00-18:00. ' +
  'A period ends later than it starts on the same day; 24:00 is the latest end. Leave blank for a day off.';

const weekday = (label: string) =>
  Field.text({ label, maxLength: 255, description: WORK_CALENDAR_PERIODS_HELP, group: 'Weekly Hours' });

/**
 * sys_work_calendar — Working Calendar (ADR-0157 D1)
 *
 * One row per working calendar per organization: a weekly pattern of local
 * working periods, the zone they are local to, and the span its exceptions
 * (`sys_work_calendar_exception`) are maintained for. Runtime data an
 * organization administrator keeps, never package metadata: holidays change
 * every year, and a holiday is a row, not a release (D1). The precedent is
 * `sys_exchange_rate` (ADR-0144), and every bullet of its tenancy, write-grant
 * and audit note holds here unchanged — organization-scoped through the
 * Layer 0 wall, written by organization administrators, every change audited.
 *
 * - **Code** — what a consumer names (a formula argument, the approval
 *   escalation's `calendar`), and what a package seeds a row under (D13: the
 *   existing seed contract, create-only unless the package declares a mode).
 *   Unique per organization, so a seeded code means one calendar in each.
 * - **Default** — the calendar a computation takes when it names none (D2).
 *   One per organization: a second is refused at write by the calendar
 *   service's hooks (`@objectstack/objectql`), and a read that still meets two
 *   refuses rather than picking one.
 * - **Time zone** — required (D7); the periods are local to it and the
 *   computation reads only it. A create that leaves it out takes the
 *   organization's `localization.timezone`, stored as the calendar's own.
 * - **Periods** — one column per weekday, validated by the calendar itself
 *   (D10: `24:00` is a legal end, which the platform's `time` value refuses);
 *   a period crossing midnight is refused (D7).
 * - **Maintained span** — `maintained_from` .. `maintained_through`, both
 *   required (open point 2): a blank must not read as "no holidays from here
 *   on". A computation needing a date outside the span is refused (D8, and the
 *   same refusal on the past side), and the `needs_maintenance` list marks a
 *   calendar {@link WORK_CALENDAR_MAINTENANCE_LEAD_DAYS} days ahead (D8).
 *
 * @namespace sys
 */
export const SysWorkCalendar = ObjectSchema.create({
  name: 'sys_work_calendar',
  label: 'Working Calendar',
  pluralLabel: 'Working Calendars',
  icon: 'calendar-clock',
  isSystem: true,
  // Platform-defined schema, organization-administered data.
  managedBy: 'system-data',
  description:
    'Working calendars: the weekly working hours, the time zone they are local to, and how far the holidays are maintained. ' +
    'Due dates counted in working time read them.',
  displayNameField: 'name',
  nameField: 'name', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['code', 'timezone', 'is_default', 'maintained_through'],

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    code: Field.text({
      label: 'Code',
      required: true,
      searchable: true,
      maxLength: 64,
      unique: 'organization',
      trackHistory: true,
      description:
        'Machine code formulas, approval escalations and packages name this calendar by, such as cn_standard: lowercase letters, digits and underscores.',
      group: 'Calendar',
    }),

    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 255,
      trackHistory: true,
      group: 'Calendar',
    }),

    timezone: Field.text({
      label: 'Time Zone',
      required: true,
      maxLength: 64,
      valueDomain: 'iana_time_zone',
      trackHistory: true,
      description:
        "IANA time zone the working periods are local to, such as Asia/Shanghai. Left out on create, it takes the organization's default time zone (Settings → Localization).",
      group: 'Calendar',
    }),

    is_default: Field.boolean({
      label: 'Default',
      defaultValue: false,
      trackHistory: true,
      description: 'The calendar a due date uses when it names none. One per organization.',
      group: 'Calendar',
    }),

    maintained_from: Field.date({
      label: 'Maintained From',
      required: true,
      trackHistory: true,
      description:
        'First date the holidays and make-up workdays are entered from. A computation that needs an earlier date is refused.',
      group: 'Maintenance',
    }),

    maintained_through: Field.date({
      label: 'Maintained Through',
      required: true,
      trackHistory: true,
      description:
        "Last date the holidays and make-up workdays are entered through. A computation that needs a later date is refused: enter next year's holidays, then move this date.",
      group: 'Maintenance',
    }),

    monday_periods: weekday('Monday'),
    tuesday_periods: weekday('Tuesday'),
    wednesday_periods: weekday('Wednesday'),
    thursday_periods: weekday('Thursday'),
    friday_periods: weekday('Friday'),
    saturday_periods: weekday('Saturday'),
    sunday_periods: weekday('Sunday'),
  },

  listViews: {
    all_calendars: {
      type: 'grid',
      name: 'all_calendars',
      label: 'All',
      data: { provider: 'object', object: 'sys_work_calendar' },
      columns: ['name', 'code', 'timezone', 'is_default', 'maintained_through'],
      sort: [{ field: 'name', order: 'asc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No working calendars yet',
        message: 'Add a calendar with its weekly hours and mark one as the default, then enter its holidays and make-up workdays.',
      },
    },
    // [ADR-0157 D8] The notice ahead of the refusals: every calendar whose
    // maintained span ends within the lead time.
    needs_maintenance: {
      type: 'grid',
      name: 'needs_maintenance',
      label: 'Needs Maintenance',
      data: { provider: 'object', object: 'sys_work_calendar' },
      columns: ['name', 'code', 'maintained_through'],
      filter: [{ field: 'maintained_through', operator: 'lte', value: `{${WORK_CALENDAR_MAINTENANCE_LEAD_DAYS}_days_from_now}` }],
      sort: [{ field: 'maintained_through', order: 'asc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'Every calendar is maintained ahead',
        message: `A calendar appears here when its holidays run out within the next ${WORK_CALENDAR_MAINTENANCE_LEAD_DAYS} days; due dates past that date are refused.`,
      },
    },
  },

  validations: [
    {
      type: 'format',
      name: 'work_calendar_code_shape',
      field: 'code',
      regex: WORK_CALENDAR_CODE_PATTERN,
      severity: 'error',
      message: 'Code must start with a lowercase letter and use only lowercase letters, digits and underscores, such as cn_standard.',
    },
  ],

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // A calendar is reference data, not a discussion surface.
    feeds: false,
  },
});
