/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { useMemo } from 'react';
import type { ListColumn } from '@object-ui/types';
import type { ColumnSummary, ListViewGroupHeaderRow } from '@objectstack/spec/ui';
import { deriveColumnSummary } from '@objectstack/spec/ui';
import type { CurrencyConfig } from '@objectstack/spec/data';
import { resolveFieldScale } from '@objectstack/spec/data';
import { useLocalization, useDisplayLocale, resolveFieldCurrency, createSafeTranslation } from '@object-ui/i18n';
import { formatCurrency, formatPercent, percentCellScale } from '@object-ui/fields';

/**
 * Aggregation functions for the column footer — the spec's `ColumnSummary`
 * vocabulary itself, not a copy of it (objectui#3161, objectstack#4115 ledger
 * batch 7).
 *
 * The eleven members used to be spelled out here under a comment promising they
 * were "kept in lockstep with the spec enum" — a promise nothing enforced. They
 * are the enum now, which turns `TYPE_LABEL_KEYS` below into the thing that
 * reports a divergence: it is a total `Record<ColumnSummaryType, string>`, so a
 * member the spec adds is a compile error naming the missing label key instead
 * of a footer cell that renders blank.
 */
export type ColumnSummaryType = ColumnSummary;

/**
 * What a column's `summary` may be: the string shorthand (`summary: 'sum'`,
 * aggregating the column's own field) or the object form carrying a per-column
 * `field` override.
 *
 * Taken straight off `ListColumn['summary']` rather than restated. It was
 * called `ColumnSummaryConfig`, which is a name the spec owns for only HALF of
 * this union — `ColumnSummaryConfig` there is the OBJECT form alone
 * (`{ type, field? }`), while the shorthand is `ColumnSummary`. So the local
 * declaration wore the spec's name for a strictly wider type: code written
 * against `ColumnSummaryConfig` here accepted `'sum'`, and the same name
 * imported from the spec rejects it. Binding to `ListColumn['summary']` makes
 * the spec's own union the definition, so a third accepted form would arrive
 * here automatically.
 */
export type ColumnSummarySetting = NonNullable<ListColumn['summary']>;

export interface ColumnSummaryResult {
  field: string;
  value: number | null;
  label: string;
}

/** A data row as the aggregations read it — cells are untyped until inspected. */
type SummaryRow = Record<string, unknown>;

/**
 * Aggregations that read raw cell values instead of parsed numbers, so they
 * work on text, select and lookup columns rather than numeric ones only.
 */
const NON_NUMERIC_TYPES = new Set<string>([
  'count',
  'count_empty',
  'count_filled',
  'count_unique',
  'percent_empty',
  'percent_filled',
]);

/** Aggregations whose result is a percentage (0-100), not a value in the column's unit. */
const PERCENT_TYPES = new Set<string>(['percent_empty', 'percent_filled']);

/**
 * Bundle key per aggregation — objectui#4024.
 *
 * The footer's NUMBER was already locale-formatted while the PREFIX in front of
 * it was a hardcoded English literal, so a zh-CN console read `Avg: 39%` with a
 * correctly formatted `39%`. The aggregate kind is known here, so the prefix was
 * one bundle lookup away.
 *
 * Still a total `Record<ColumnSummaryType, string>`, which is the property the
 * header above describes: a member the spec adds is a compile error naming the
 * missing key, rather than a footer cell that renders blank.
 *
 * `none` maps to the empty string, not to a key — it is the spec's explicit
 * opt-out and never reaches a label (`useColumnSummary` skips it), so giving it
 * a key would put an unreachable entry in ten packs.
 */
const TYPE_LABEL_KEYS: Record<ColumnSummaryType, string> = {
  none: '',
  count: 'grid.summary.count',
  count_empty: 'grid.summary.countEmpty',
  count_filled: 'grid.summary.countFilled',
  count_unique: 'grid.summary.countUnique',
  // The trailing `%` is what distinguishes these from the count-family pair —
  // which is why the two families deliberately share a word in every pack.
  percent_empty: 'grid.summary.percentEmpty',
  percent_filled: 'grid.summary.percentFilled',
  sum: 'grid.summary.sum',
  avg: 'grid.summary.avg',
  min: 'grid.summary.min',
  max: 'grid.summary.max',
};

/**
 * English fallbacks for the provider-less path (the objectui#4514 trap).
 *
 * `useColumnSummary` is a PUBLIC export of this package and its own sibling
 * suite (`useColumnSummary.test.tsx`) asserts `/Sum: /` with only a
 * `LocalizationProvider` mounted. `createSafeTranslation` is what keeps that —
 * and every downstream consumer's provider-less test — rendering English
 * instead of `grid.summary.sum`.
 */
const SUMMARY_DEFAULT_TRANSLATIONS: Record<string, string> = {
  'grid.summary.pattern': '{{label}}: {{value}}',
  'grid.summary.pagePattern': '{{label}} (this page): {{value}}',
  'grid.summary.count': 'Count',
  'grid.summary.countEmpty': 'Empty',
  'grid.summary.countFilled': 'Filled',
  'grid.summary.countUnique': 'Unique',
  'grid.summary.percentEmpty': 'Empty',
  'grid.summary.percentFilled': 'Filled',
  'grid.summary.sum': 'Sum',
  'grid.summary.avg': 'Avg',
  'grid.summary.min': 'Min',
  'grid.summary.max': 'Max',
};

const useSummaryTranslation = createSafeTranslation(
  SUMMARY_DEFAULT_TRANSLATIONS,
  'grid.summary.sum',
);

/** The translator shape `formatSummaryLabel` needs — i18next's `t`, narrowed. */
type SummaryTranslate = (key: string, options?: Record<string, unknown>) => string;

/**
 * Every aggregation name the renderer computes. A Set rather than an `in` check
 * against TYPE_LABEL_KEYS, because `in` also matches inherited keys — a column
 * configured with `summary: 'toString'` would otherwise read as supported.
 *
 * Exported so a test can assert it covers the spec's `ColumnSummarySchema`
 * exactly: a name the schema accepts but this set omits validates at authoring
 * time and then renders a blank footer cell.
 */
export const SUPPORTED_SUMMARY_TYPES: ReadonlySet<string> = new Set<string>(
  Object.keys(TYPE_LABEL_KEYS),
);

/**
 * Emptiness test for the count/percent aggregations. Matches the convention
 * used elsewhere in the codebase (audit history display, form dirty-checking):
 * null/undefined/empty-string, plus empty arrays so an unset multi-select or
 * lookup column counts as empty instead of as a filled `[]`.
 */
const isEmptyValue = (v: unknown): boolean =>
  v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * Stable identity for `count_unique`. Object and array cells (lookup and
 * multi-select columns) compare by value — a raw `Set` compares by reference
 * and would report every row as unique.
 */
function uniqueKey(v: unknown): unknown {
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v) ?? String(v);
    } catch {
      return String(v);
    }
  }
  return v;
}

/**
 * Normalize summary config from string or object to a standard shape.
 */
function normalizeSummary(summary: ColumnSummarySetting): { type: string; field?: string } {
  if (typeof summary === 'string') {
    return { type: summary };
  }
  return summary;
}

/**
 * Collect the numeric values of a field, parsing numeric strings so a column
 * backed by string-encoded decimals still aggregates.
 */
function numericValues(rows: SummaryRow[], field: string): number[] {
  const values: number[] = [];
  for (const row of rows) {
    const v = row[field];
    if (typeof v === 'number' && !isNaN(v)) {
      values.push(v);
    } else if (typeof v === 'string') {
      const parsed = parseFloat(v);
      if (!isNaN(parsed)) values.push(parsed);
    }
  }
  return values;
}

/**
 * The most decimal places any one of `values` carries — the width a computed
 * result over a column with NO fixed width is rounded to (objectstack#19628,
 * ruling A′, carried to this footer by objectui#9843).
 *
 * Read off each number's own shortest decimal spelling, exponent included, so
 * `1e-7` counts seven places and `1.5e-7` eight. A result rounded to this
 * width drops only digits no input had: a sum of `0.1` and `0.2` reads `0.3`,
 * never the `0.30000000000000004` binary arithmetic produced.
 *
 * Capped at 20, the maximum `NumberCellRenderer` renders a no-fixed-width
 * value to, so the footer never shows a digit the cells above it cannot — and
 * the bound engines before ES2023 accept for `maximumFractionDigits`.
 */
function widestFractionDigits(values: readonly number[]): number {
  let widest = 0;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const [mantissa, exponent] = String(v).split('e');
    const point = mantissa.indexOf('.');
    const fraction = point === -1 ? 0 : mantissa.length - point - 1;
    widest = Math.max(widest, fraction - (exponent ? Number(exponent) : 0));
  }
  return Math.min(widest, 20);
}

/**
 * Compute a single aggregation over the rows.
 *
 * The count and percent families are cardinalities over *raw* cell values, so
 * they are computed before the numeric parse — `count_unique` on a text column
 * has to work, and a row whose value does not parse as a number is still a
 * filled row.
 */
function computeAggregation(type: string, rows: SummaryRow[], field: string): number | null {
  if (NON_NUMERIC_TYPES.has(type)) {
    const total = rows.length;
    if (total === 0) return null;

    switch (type) {
      case 'count':
        // Every row, filled or not — `count_filled` is the non-empty variant.
        return total;
      case 'count_filled':
        return rows.filter((r) => !isEmptyValue(r[field])).length;
      case 'count_empty':
        return rows.filter((r) => isEmptyValue(r[field])).length;
      case 'count_unique': {
        // An empty cell is not a distinct value, it is the absence of one.
        const seen = new Set<unknown>();
        for (const row of rows) {
          const v = row[field];
          if (!isEmptyValue(v)) seen.add(uniqueKey(v));
        }
        return seen.size;
      }
      case 'percent_filled':
        return (rows.filter((r) => !isEmptyValue(r[field])).length / total) * 100;
      case 'percent_empty':
        return (rows.filter((r) => isEmptyValue(r[field])).length / total) * 100;
      default:
        return null;
    }
  }

  const values = numericValues(rows, field);
  if (values.length === 0) return null;

  switch (type) {
    case 'sum':
      return values.reduce((a, b) => a + b, 0);
    case 'avg':
      return values.reduce((a, b) => a + b, 0) / values.length;
    case 'min':
      return Math.min(...values);
    case 'max':
      return Math.max(...values);
    default:
      return null;
  }
}

/**
 * A currency code `Intl` accepts at all: ECMA-402's `IsWellFormedCurrencyCode`,
 * exactly three ASCII letters in any case. That is the only check
 * `Intl.NumberFormat` makes on a currency before it throws a `RangeError`; a
 * well-formed code CLDR does not know (`ZZZ`) is accepted and rendered with the
 * code itself, as the cell renders it.
 *
 * It exists for one arm: `formatCurrency` swallows a code `Intl` refuses into a
 * locale-less `CODE 1234.50`, and objectui#9294 keeps this footer's bad-code
 * fallback on the tenant locale, so a refused code must never reach it.
 *
 * Read off the spec rather than asked of `Intl`, because an `Intl` probe needs a
 * locale argument and neither choice asks only about the code. `undefined` is
 * the machine's locale, which the objectui#9909 census refuses. The display
 * locale would make a malformed TENANT tag read as a malformed code, and send a
 * valid amount to the fallback below, which throws on that same tag;
 * `formatCurrency` survives such a tag.
 */
const WELL_FORMED_CURRENCY_CODE = /^[A-Za-z]{3}$/;

/**
 * Format a summary value for display.
 *
 * When a `column` carries type metadata (e.g. `type: 'currency'` or
 * `'percent'`) we route the numeric result through the matching
 * formatter so currency columns render as `$1,234.56` and percent
 * columns as `12%` instead of falling back to a bare `toLocaleString()`.
 * The currency code is resolved by the same `resolveFieldCurrency` the
 * CurrencyCellRenderer uses (tenant default last), and a column with no code
 * renders a plain number, never a guessed symbol — so cells and footer agree.
 *
 * That column formatting applies to the numeric family only. Count
 * aggregations are plain cardinalities and percent aggregations carry their own
 * unit, so neither may inherit the column's currency or percent formatting —
 * `count_unique` on a currency column reads "3", not "$3.00".
 *
 * ## The label/value JOIN is a bundle key too (objectui#4024)
 *
 * The three arms below used to build `` `${label}: ${formatted}` ``, which hands
 * the locale the WORD and keeps the PUNCTUATION in English. ja/zh set a
 * fullwidth colon and ar runs right-to-left, so the separator is translatable
 * content: `grid.summary.pattern` owns the whole shape and a pack is free to
 * spell it 「合计:119,200」. Same reasoning as `collaboration.resolvedSuffix`
 * in the packs — "separator included, so a translator owns the whole phrase
 * rather than inheriting an English-shaped glue".
 *
 * ## Which LOCALE the number is formatted in (objectui#9294)
 *
 * Separate from the join above and separate from #4589's surface below: every
 * `Intl` call here takes `displayLocale`. The WIDTHS and the choice of
 * formatter are untouched and stay #4589's — the only thing this file claims
 * is the tag.
 *
 * These calls used to pass no locale at all, which is not "no opinion" — an
 * omitted or `undefined` locale is the MACHINE's, which is neither of this
 * renderer's two channels, and is named by `useDisplayLocale`'s own doc
 * comment as the one thing a caller must not do. It is also worse here than at
 * the percent arm its parent card repaired: a percent sign changing sides is
 * visible, a decimal separator changing is not. `1,234.5` is a perfectly
 * ordinary German number — for a value three orders of magnitude away — and
 * the arms below include a currency total.
 */
function formatSummaryLabel(
  type: string,
  value: number | null,
  t: SummaryTranslate,
  column: { type?: string; currency?: string; defaultCurrency?: string; currencyConfig?: { defaultCurrency?: string }; precision?: number | null; scale?: number | null; max?: number } | undefined,
  tenantDefault: string | undefined,
  // The BCP-47 tag from `useDisplayLocale()` — tenant locale, then UI
  // language, then a concrete `'en'`, never `undefined`.
  //
  // ⭐ Required and non-optional `string` on purpose (objectui#9294). The two
  // parameters in front of it are spelled `T | undefined` rather than `T?`
  // only so this one is allowed to be mandatory. Under the `displayLocale?:`
  // it replaces, dropping the argument type-checks and the result renders as a
  // plausible number rather than as an error — the same failure shape as the
  // omitted locale this card repaired, one layer up, and the reason that
  // defect was invisible in review for as long as it was. The function is
  // module-private with a single call site, so nothing outside pays for this.
  //
  // ⛔ And no `?? 'en'` backstop here: that would be a renderer-side default
  // papering over an absent channel (Commandment #0.1). The concrete fallback
  // belongs to `useDisplayLocale`, which already owns it.
  displayLocale: string,
  // The widest decimal count among the numeric values the aggregation read
  // (`widestFractionDigits`; 0 when it read none). Only the `number` arm reads
  // it, and only for a column with no fixed width. Required for the reason
  // `displayLocale` is: a dropped argument must not type-check into a width.
  inputFractionDigits: number,
  // objectui#12081 item 3 — the figure covers only the page on screen of a
  // larger matched set (see `ColumnSummaryScope`), so the label says so.
  // Required for the reason the two above are: a dropped argument must not
  // type-check into a label that reads as the whole set's total.
  pageOnly: boolean,
): string {
  if (value === null) return '';
  const labelKey = TYPE_LABEL_KEYS[type as ColumnSummaryType];
  // `|| type` is the backstop for an aggregation with no key — it echoes the
  // raw kind, as before, never a half-resolved `grid.summary.<junk>`.
  const label = labelKey ? t(labelKey) : type;
  // The page scope is its own whole pattern, not a suffix glued onto the
  // label: where the scope sits, and its brackets, are the translator's, as
  // the separator is (objectui#4024).
  const join = (formatted: string): string =>
    t(pageOnly ? 'grid.summary.pagePattern' : 'grid.summary.pattern', { label, value: formatted });

  if (PERCENT_TYPES.has(type)) {
    return join(`${value.toLocaleString(displayLocale, { maximumFractionDigits: 1 })}%`);
  }
  if (NON_NUMERIC_TYPES.has(type)) {
    return join(value.toLocaleString(displayLocale));
  }

  const colType = column?.type;
  let formatted: string;
  if (colType === 'currency') {
    // objectui#10221 — a currency's decimal places are the currency's, not a
    // setting (ruling 乙 on objectstack-ai/objectstack#19910; `scale` is retired
    // from the currency type by ruling B on objectstack-ai/objectstack#19629).
    //
    // This arm read `column.scale ?? 0`. That made the footer's width a second
    // opinion beside the list cell's: a USD column declaring no `scale` summed
    // `1234.5` to `$1,235` under cells reading `$1,234.50`, and a JPY column
    // carrying a stale `scale: 4` summed to `¥1,234.5000`, cents a yen does not
    // have. `precision` was never the answer either — it is the TOTAL digit
    // count of a decimal(p, s) column (#2131 removed that read).
    //
    // The amount now goes to `formatCurrency` — the list cell's own formatter
    // (`CurrencyCellRenderer`), the same way the percent arm below takes
    // `formatPercent` — so footer and cell agree by reference, not by a copy
    // of the rule. It reads neither `scale` nor `precision`: the width is the
    // currency's ISO 4217 minor-unit count, a whole amount included
    // (`$1,234.00`; objectui#11444 retired the whole-amount trimming), and with
    // no code resolved it is a plain number at two decimals, as the cell
    // renders it.
    const currency = resolveFieldCurrency(column, tenantDefault);
    formatted =
      currency && !WELL_FORMED_CURRENCY_CODE.test(currency)
        ? // A malformed code: keep objectui#9294's fallback on the tenant tag.
          // Degrading to the machine's locale here would reintroduce that
          // defect on precisely the rows that already went wrong once.
          value.toLocaleString(displayLocale)
        : formatCurrency(value, currency, displayLocale);
  } else if (colType === 'percent') {
    // objectui#9269 — the percent decision is NOT made here any more.
    //
    // This arm held a hand-inlined copy of `percentDisplayValue`'s body plus a
    // literal ASCII sign:
    //
    //   const pct = (value > -1 && value < 1) ? value * 100 : value;
    //   formatted = `${pct.toFixed(decimals)}%`;
    //
    // Line 1 is `percentDisplayValue` in `@object-ui/core` character for
    // character, so the SCALING agreed by DUPLICATION rather than by
    // reference. The CONVENTION was not taken at all, and that is the half a
    // reader saw: measured against the list cell in the same run, a stored
    // `0.25` read `25%` in this footer and `25 %` in the cell directly above
    // it in a German session, and `%25` in a Turkish one — where the sign sits
    // on the OTHER SIDE of the number. A four-digit value read `1235%` against
    // `1,235%` even in `en`.
    //
    // `formatPercent` is the list-cell path (`PercentCellRenderer`), and it
    // carries BOTH halves `percentDisplayValue`'s doc comment demands of a
    // third surface: the SCALING, so the fraction/points boundary has one
    // home, and the CONVENTION, via `style: 'percentPoints'`, so the affix is
    // the LOCALE's rather than a literal. Taking only the first is precisely
    // the drift objectui#4576 already paid for once.
    //
    // objectui#9295 — that unmeasured question is ANSWERED, and the answer is
    // `scale`. `@objectstack/spec` declares the pair on the column face in its
    // own words: `precision` is "Total digits (non-negative integer; for
    // number/currency)" — percent is not even in that list — and `scale` is
    // "Decimal places (non-negative integer)". Reading `precision` padded this
    // footer out to the column's TOTAL width, so a decimal(10, 2) percent
    // column summed to `Sum: 25.0000000000%` under a cell reading
    // `25.0000000000%`: the identical defect #2131 removed from the currency
    // arm above, one type over. Both percent surfaces move together, or this
    // footer and the cell above it disagree.
    //
    // objectui#9843 — an ABSENT `scale` is the PROTOCOL's to answer.
    // `resolveFieldScale` in `@objectstack/spec/data` returns the declared
    // width when it is well-formed and otherwise the platform's own value for
    // a percent column, and the list cell, the detail chip and the edit widget
    // ask the same function — so the footer and the cell above it agree by
    // reference, ⛔ not by each spelling a matching `?? 0`. (The currency arm
    // above no longer reads `scale` at all — objectui#10221 — which is a
    // currency-only retirement; `scale` stays the percent width.)
    //
    // objectui#11475 — and the STORAGE is the field's. A `sum` / `avg` /
    // `min` / `max` of a percent column is stored the way its field stores,
    // so the footer reads `percentCellScale` (the spec's `percentScaleOf`
    // over the field's `max`), the answer the cell above reads. The shared
    // scaling used to guess from the magnitude, so a fraction-stored column
    // summing to `1` (100%) read `Sum: 1%` under cells reading the same rows.
    const decimals = resolveFieldScale(column);
    formatted = formatPercent(value, percentCellScale(column), decimals, displayLocale);
  } else if (colType === 'number') {
    // objectstack#19628, ruled A′ and carried to this footer by objectui#9843:
    // a `number` column's width is `resolveFieldScale`'s answer too, and for a
    // `number` that declares no `scale` the answer is `undefined` — NO fixed
    // width, the value's natural precision, which is how the list cell above
    // renders it. The protocol deliberately gives `number` no absent-width row.
    //
    // A declared width is fixed (`Sum: 3.00` under cells reading `1.50`). With
    // none, a COMPUTED result is rounded to the widest decimal count among the
    // values that entered it — derived from the data, ⛔ never a constant. This
    // arm used to reach `avg` / the plain default below, whose widths (2 and
    // `Intl`'s 3) were this file's own: an `avg` of `1`, `2`, `2` read
    // `1.67`, and a `min` over `1.2345` read `1.235`, a value no row held.
    const width = resolveFieldScale(column);
    formatted = value.toLocaleString(
      displayLocale,
      width === undefined
        ? { maximumFractionDigits: inputFractionDigits }
        : { minimumFractionDigits: width, maximumFractionDigits: width },
    );
  } else if (type === 'avg') {
    formatted = value.toLocaleString(displayLocale, { maximumFractionDigits: 2 });
  } else {
    formatted = value.toLocaleString(displayLocale);
  }
  return join(formatted);
}

/** The `objectSchema.fields` slice the footer formats with. */
type SummaryFieldMetadata = Record<string, { type?: string; currency?: string; defaultCurrency?: string; currencyConfig?: CurrencyConfig; precision?: number | null; scale?: number | null; max?: number }>;

/**
 * Which rows the footer's figures describe (objectui#12081 item 3).
 *
 * The footer is drawn beside a count, and its figures read as that count's
 * rows' figures. Under server paging the rows a grid holds are ONE page of the
 * matched set, so a figure computed from them is the page's, and drawn beside
 * the set's count it read as the set's total — "Sum: 3,685,900.00 · 300
 * records" where the 300 rows sum to 40,607,000 (objectstack-ai/hotclm#87).
 *
 *   - `rows` — the rows handed in ARE the set: inline rows, a host's whole
 *     result, a grid whose one page holds every match. Computed from them, as
 *     the footer always has been.
 *   - `whole` — the rows are one page of more, and the server answered the
 *     whole matched set's figures (`useWholeSetSummary`): each figure is read
 *     off that answer through the spec's `deriveColumnSummary`.
 *   - `page` — the rows are one page of more and no whole-set answer is in
 *     hand (no door, a refusal, a query that cannot be repeated, or the answer
 *     still on its way). The figure is the page's, and the label says so
 *     (`grid.summary.pagePattern`). ⛔ Never a page figure under the plain
 *     label beside the set's count.
 */
export type ColumnSummaryScope = 'rows' | 'whole' | 'page';

/**
 * A server figure as a number: `null` is the aggregate's own "no value" (an
 * `avg` over no values), `undefined` is no figure at all. A driver may answer
 * a decimal or a 64-bit count as its string spelling, so a string is parsed;
 * anything that does not parse is no figure.
 */
function serverFigure(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : Number.NaN;
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Hook to compute column summary/aggregation values.
 *
 * @param columns - Column definitions (may include `summary` config). Of a
 *   column's members the hook reads `field`, `summary` and the declared
 *   `type`; every other formatting hint comes from `fieldMetadata`
 *   (objectui#11588).
 * @param data - Row data array
 * @param fieldMetadata - Optional `objectSchema.fields` map; when present
 *   the hook reads `type`/`currency`/`currencyConfig`/`defaultCurrency` and,
 *   for a percent or number column, `scale` (through `resolveFieldScale`) and,
 *   for a percent column, the storage its `max` declares, to
 *   format the summary in the column's native unit (currency → `$1,234.56`,
 *   percent → `12%`).
 * @returns Map of field name to summary result, and a flag if any summaries exist
 */
export function useColumnSummary(
  columns: ListColumn[] | undefined,
  data: any[],
  // `currencyConfig` is the spec's own type, not a restated subset, so a field
  // def written in the spec's shape (`currencyMode` included) is accepted as is.
  fieldMetadata?: SummaryFieldMetadata
): { summaries: Map<string, ColumnSummaryResult>; hasSummary: boolean } {
  // The rows a caller hands this public hook are the set it summarises, as
  // they always were. Only the grid knows when its rows are one page of more,
  // and it says so through `useScopedColumnSummary`.
  return useScopedColumnSummary(columns, data, fieldMetadata, 'rows', undefined);
}

/**
 * {@link useColumnSummary}, told which rows its figures describe — the grid's
 * entry (objectui#12081 item 3). `wholeRow` is the server's answer for the
 * whole matched set, read only under the `whole` scope.
 *
 * Module-internal: the package barrel exports `useColumnSummary` alone, so
 * its signature is unchanged for every caller outside this package.
 */
export function useScopedColumnSummary(
  columns: ListColumn[] | undefined,
  data: SummaryRow[],
  fieldMetadata: SummaryFieldMetadata | undefined,
  scope: ColumnSummaryScope,
  wholeRow: ListViewGroupHeaderRow | undefined,
): { summaries: Map<string, ColumnSummaryResult>; hasSummary: boolean } {
  // Tenant default currency (ADR-0053) backstops a currency column that
  // declares no explicit code, so the footer agrees with the cells above it.
  const { currency: tenantCurrency } = useLocalization();
  // The tag every field / cell / metric renderer formats `Intl` values with
  // (tenant locale, then UI language, then `'en'`) — never `undefined`, which
  // would be the MACHINE's locale. The percent footer took this path first
  // (objectui#9269); every other arm joined it at objectui#9294, so the whole
  // footer and the cells above it now read under one convention.
  const displayLocale = useDisplayLocale();
  // Aggregate-prefix bundle lookups (objectui#4024). Provider-safe: with no
  // I18nProvider this resolves the English defaults table, never a raw key.
  const { t } = useSummaryTranslation();
  return useMemo(() => {
    const summaries = new Map<string, ColumnSummaryResult>();

    if (!columns || columns.length === 0 || data.length === 0) {
      return { summaries, hasSummary: false };
    }

    for (const col of columns) {
      if (!col.summary) continue;

      const config = normalizeSummary(col.summary as ColumnSummarySetting);

      // `none` is the spec's explicit opt-out, and an unrecognized name has no
      // value to show. Both skip the entry entirely rather than registering a
      // blank one — otherwise a view whose columns all say `none` would render
      // an empty footer row.
      if (config.type === 'none' || !SUPPORTED_SUMMARY_TYPES.has(config.type)) continue;

      const targetField = config.field || col.field;

      // objectui#12081 item 3 — the whole matched set's figure, read off the
      // server's answer through the spec's own read-back (the four derived
      // members included). The two percents come back as a ratio in `0..1`;
      // this footer's percent unit is points, as `computeAggregation` answers
      // it. A figure the answer does not carry is NOT the whole set's: that
      // one column falls back to the page, labelled as the page's.
      let result: number | null;
      let pageOnly = scope === 'page';
      const fromServer = scope === 'whole' && wholeRow
        ? serverFigure(deriveColumnSummary(wholeRow, col.summary as ColumnSummarySetting, col.field))
        : undefined;
      if (fromServer !== undefined) {
        result = fromServer !== null && PERCENT_TYPES.has(config.type) ? fromServer * 100 : fromServer;
      } else {
        result = computeAggregation(config.type, data, targetField);
        if (scope === 'whole') pageOnly = true;
      }

      // The column contributes its declared `type` (a `ListColumn` member,
      // which outranks the field's); every other hint is read off the FIELD
      // (`fieldMetadata`) only, as the list cell above reads it.
      // objectui#10354, objectui#11475, objectui#11588 — `ListColumnSchema`
      // declares none of `currency`, `defaultCurrency`, `currencyConfig`,
      // `precision`, `scale` or `max`, and a column-level read would be a
      // second, undeclared spelling. `col` stays typed as `ListColumn`, so
      // such a read does not compile here.
      const meta = fieldMetadata?.[targetField];
      const columnHints = {
        type: col.type ?? meta?.type,
        currency: meta?.currency,
        defaultCurrency: meta?.defaultCurrency,
        // objectui#10354 — the spec's one fixed-currency spelling, handed to
        // `resolveFieldCurrency` verbatim, as the cell's bag carries it, so the
        // footer and the cell above it resolve the same code.
        currencyConfig: meta?.currencyConfig,
        precision: meta?.precision,
        scale: meta?.scale,
        // objectui#11475 — a percent field's declared `max`, its STORAGE
        // statement (`percentScaleOf`: a fraction unless `max` is above 1).
        max: meta?.max,
      };

      // The widest decimal count among the numeric values this aggregation
      // read — what a no-fixed-width `number` column rounds its result to.
      // The count and percent families read raw cells, not numbers. A
      // whole-set figure read values this grid never held, so the widest it
      // can know is the page's, and a `min` / `max` is itself one of the
      // values it read, so its own width counts too.
      const inputFractionDigits = NON_NUMERIC_TYPES.has(config.type)
        ? 0
        : widestFractionDigits([
          ...numericValues(data, targetField),
          ...(fromServer != null && (config.type === 'min' || config.type === 'max') ? [fromServer] : []),
        ]);

      summaries.set(col.field, {
        field: col.field,
        value: result,
        label: formatSummaryLabel(
          config.type,
          result,
          t,
          columnHints,
          tenantCurrency,
          displayLocale,
          inputFractionDigits,
          pageOnly,
        ),
      });
    }

    return { summaries, hasSummary: summaries.size > 0 };
  }, [columns, data, fieldMetadata, tenantCurrency, displayLocale, t, scope, wholeRow]);
}
