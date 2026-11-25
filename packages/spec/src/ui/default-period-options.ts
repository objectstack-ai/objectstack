// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Default Period choices (`dateRange.defaultRange`) the report and
 * dashboard authoring forms offer, each with the name it reads by. One table
 * serves both forms, so the two selects name a period the same way.
 *
 * Form text only: the module is not re-exported from the `ui` barrel.
 */

import { DATE_RANGE_DEFAULT_RANGES, type DateRangeDefaultRange } from './dashboard.zod';

/**
 * The name each Default Period choice reads by — one per member of the shared
 * preset table, so a preset added there fails to compile here until it is named.
 * The words are the ones the report and dashboard period chip shows for the
 * same presets (the console's `dashboard.filters.range.*` and
 * `dashboard.filters.custom` rows), so the period an author picks reads the
 * same as the period a viewer sees. `custom` names no window: it opens the
 * picker with no preset applied.
 */
const DEFAULT_PERIOD_LABELS: Record<DateRangeDefaultRange, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  next_month: 'Next month',
  this_quarter: 'This quarter',
  last_quarter: 'Last quarter',
  next_quarter: 'Next quarter',
  this_year: 'This year',
  last_year: 'Last year',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  last_90_days: 'Last 90 days',
  next_30_days: 'Next 30 days',
  custom: 'Custom…',
};

/**
 * The Default Period select's options: the preset table in its order, each
 * named. A fresh array per call, so no two forms share an option object.
 */
export function defaultPeriodOptions(): Array<{ label: string; value: DateRangeDefaultRange }> {
  return DATE_RANGE_DEFAULT_RANGES.map((value) => ({ label: DEFAULT_PERIOD_LABELS[value], value }));
}
