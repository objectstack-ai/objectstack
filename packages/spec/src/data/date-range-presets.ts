// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Dashboard date-range presets — the named windows a dashboard date filter may
 * select, in the display order the filter bar offers them.
 *
 * **This is the vocabulary's single source of truth (#4614).** It used to exist
 * three times: inline in `dashboard.dateRange.defaultRange`, as `PRESET_RANGES`
 * in objectui's `dashboard-filters` (the module that maps each name to its
 * date-macro bounds), and as a hand-written table in
 * `content/docs/ui/dashboards.mdx`. Three copies of one enum drift in the
 * direction nobody notices: a name the renderer knows but the schema does not
 * is rejected from metadata that would have rendered, and a name the schema
 * knows but the renderer does not validates clean and then resolves to nothing.
 *
 * ## Why it lives in `data/` (#8793)
 *
 * The list was declared in `ui/dashboard.zod.ts` from #4614 until #8793 moved
 * it here (the `ui` module re-exports it, so both import paths keep working).
 * The move exists because the vocabulary is read on BOTH sides of a boundary:
 *
 * - the UI half — `dashboard.dateRange.defaultRange` and a date global
 *   filter's `defaultValue` accept these names; the shipped console lowers
 *   them to `{date-macro}` bounds before any query is sent;
 * - the DATA half — `data/filter.zod.ts` refuses these very names when one is
 *   authored as a bare ordering comparand (`{ $gte: 'last_30_days' }`), where
 *   no layer of the platform can interpret it (#8690's C half). That refusal
 *   cannot import from `ui/` without a cycle (`ui/dashboard.zod.ts` already
 *   imports `data/filter.zod.ts`), so the shared vocabulary sits on the
 *   `data/` side, exactly like its sibling `date-macros.zod.ts`.
 *
 * Each preset resolves to a pair of date-macro token bounds at query time (see
 * `DATE_MACRO_TOKENS` in `./date-macros.zod.ts`). That is why the two
 * vocabularies live one import apart and neither restates the other's grammar
 * — and why {@link DATE_RANGE_PRESET_MACRO_WINDOWS} below spells its windows
 * in macro tokens rather than in dates.
 */

/**
 * The declared preset names, in the display order the filter bar offers them.
 */
export const DATE_RANGE_PRESETS = [
  'today',        'yesterday',
  'this_week',    'last_week',
  'this_month',   'last_month',
  'this_quarter', 'last_quarter',
  'this_year',    'last_year',
  'last_7_days',  'last_30_days', 'last_90_days',
] as const;

export type DateRangePreset = (typeof DATE_RANGE_PRESETS)[number];

/**
 * Is `value` exactly one of the declared preset names?
 *
 * Exact, case-sensitive membership — the declared vocabulary and nothing else.
 * A near-miss (`last_60_days`, `Last 7 Days`) is deliberately NOT matched:
 * this predicate feeds a REFUSAL (#8793), and refusing a guessed superset of
 * the declared list would judge strings the platform never declared. Near-miss
 * spellings in positions that accept presets are already refused by those
 * positions' own vocabulary checks (`GlobalFilterSchema`'s date-filter guard).
 */
export function isDateRangePresetName(value: unknown): value is DateRangePreset {
  return typeof value === 'string' && (DATE_RANGE_PRESETS as readonly string[]).includes(value);
}

/**
 * The `{date-macro}` window each preset resolves to — `[start, end]`, in the
 * WRAPPED spelling a filter author writes; `end: null` means "now" (the
 * rolling `last_N_days` windows have no upper macro — the resolver's clock is
 * the bound).
 *
 * This exists for one purpose: PRESCRIPTION. When a preset name is refused as
 * a bare filter comparand (#8793), the refusal must name the spelling that
 * works — that is the difference between a dead end and a one-edit fix,
 * especially for an AI author whose correction loop only sees the error text.
 * It is deliberately NOT a resolver: the console's own preset-to-bounds
 * lowering (objectui `dashboard-filters`) stays the executable mapping, and
 * `date-range-presets.test.ts` pins every token here as a member of the macro
 * vocabulary so the two cannot drift silently.
 */
export const DATE_RANGE_PRESET_MACRO_WINDOWS: Readonly<
  Record<DateRangePreset, readonly [start: string, end: string | null]>
> = {
  today:        ['{today}', null],
  yesterday:    ['{yesterday}', '{today}'],
  this_week:    ['{week_start}', '{week_end}'],
  last_week:    ['{last_week_start}', '{last_week_end}'],
  this_month:   ['{month_start}', '{month_end}'],
  last_month:   ['{last_month_start}', '{last_month_end}'],
  this_quarter: ['{quarter_start}', '{quarter_end}'],
  last_quarter: ['{last_quarter_start}', '{last_quarter_end}'],
  this_year:    ['{year_start}', '{year_end}'],
  last_year:    ['{last_year_start}', '{last_year_end}'],
  last_7_days:  ['{7_days_ago}', null],
  last_30_days: ['{30_days_ago}', null],
  last_90_days: ['{90_days_ago}', null],
};

/**
 * The one refusal wording for "a declared preset name authored as a bare
 * ordering comparand", shared by the two moments it can be reported — the
 * schema door in `data/filter.zod.ts` and `@objectstack/lint`'s
 * `filter-preset-comparand` rule — so one condition keeps one wording
 * (the #5240 convention).
 *
 * Why this is refused at all (#8690, C half, maintainer-ruled 2026-08-15):
 * `last_30_days` and its siblings are REAL declared names — but only for the
 * dashboard date-filter positions, where the console lowers them to
 * `{date-macro}` bounds before any query is sent. As a bare filter comparand
 * no layer interprets them: on a declared temporal field the engine door
 * refuses the query (`INVALID_FILTER` / 400, #8808), and on any other column
 * the string reaches the driver as written and orders lexicographically
 * against the platform's own vocabulary word. The authoring layer is where an
 * AI-authored dashboard is actually produced, so the refusal lands here too —
 * loud, located, and prescriptive.
 */
export function bareDateRangePresetComparandMessage(
  preset: DateRangePreset,
  operator: string,
): string {
  const [start, end] = DATE_RANGE_PRESET_MACRO_WINDOWS[preset];
  const window = end === null
    ? `{ $gte: '${start}' }`
    : `{ $between: ['${start}', '${end}'] }`;
  return (
    `"${preset}" is a dashboard date-range PRESET name, not a filter value. It is only `
    + `understood by the dashboard date-filter positions (dateRange.defaultRange, a date `
    + `global filter's defaultValue), where the console lowers it to {date-macro} bounds `
    + `before querying. As a bare "${operator}" comparand nothing resolves it: a declared `
    + `datetime/date field refuses the query at the engine (INVALID_FILTER / 400, #8690), `
    + `and any other column compares the literal string. Write the date-macro window `
    + `instead — e.g. ${window} — or an ISO date such as "2026-01-15". `
    + `Refused at authoring time so the error surfaces where the filter is written (#8793).`
  );
}
