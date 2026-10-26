/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ONE formatting call every display face of a `number` field makes:
 * `NumberCellRenderer` in a table, and `NumberField`'s read-only branch in a
 * form (objectui#11431).
 *
 * The read-only branch used to print the raw stored value, so a field
 * declaring `scale: 2` and holding `1234.5` read `1234.5` in a read-only form
 * and `1,234.50` in its table cell. A second copy of the cell's assembly next
 * to the widget would agree only until one of the two moved, so the assembly
 * lives here and both faces call it: they agree by construction.
 *
 * Deliberately pure, with no React and no component imports, for the reason
 * `address-format.ts` gives: the eager `@object-ui/fields` barrel calls it for
 * cell rendering, the lazily loaded widget calls it for its read-only face, and
 * neither may import the other (the widget importing the barrel would be a
 * runtime cycle and would pull it out of its chunk).
 *
 * The same module holds the family's other members for the same reason:
 * `formatCurrency` and `formatPercentPoints`, each called by a cell and by its
 * widget's read-only branch (objectui#11444).
 */

import type { FieldMetadata } from '@object-ui/types';
import { resolveFieldScale, percentScaleOf, type PercentScale } from '@objectstack/spec/data';
import { formatDisplayNumber } from '@object-ui/i18n';
import { currencyFractionDigits } from '../currency.js';

/**
 * Format a numeric value the way the `number` field declaring it says to
 * display it.
 *
 * @param value  the numeric value. Callers decide what counts as empty or as
 *               not a number before calling: this formats a number, it does
 *               not judge one.
 * @param field  the field metadata; its `type`, `scale` and `useGrouping` are
 *               the inputs read.
 * @param locale the display locale tag, from `useDisplayLocale()`.
 */
export function formatNumberFieldValue(value: number, field: FieldMetadata, locale: string): string {
  // Decimal places come from `scale` (the `s` in a `decimal(p, s)` column),
  // NOT `precision`: `precision` is the TOTAL digit count (`p`), and reading
  // it padded every value out to that width (e.g. `1` from a decimal(10, 0)
  // column rendered as "1.0000000000"). When `scale` is declared the value is
  // padded to it so a fixed display is honoured (e.g. an amount with scale 2
  // reads "16.00", a field with scale 3 reads "3.140"); when it is absent the
  // minimum stays at 0 so trailing zeros are trimmed, and only the maximum is
  // capped (20 = Intl max) to preserve the value's natural precision.
  //
  // `scale` is also the grouping POLICY input (objectui#4033): a declared
  // `scale: 0` with no currency is a discrete integer (a year, a fiscal period,
  // an ordinal), and those are rendered ungrouped, so a `Field.number` year
  // shows `2026` instead of `2,026`. An ABSENT scale keeps grouping: absent
  // means "decimals unknown", not "integer". The policy and its interim status
  // live in `formatDisplayNumber`, not here.
  //
  // No clamp: the objectui#10071 one retired at the objectui#9808 SUNSET
  // (objectui#11073), since `@objectstack/spec` 17.5.0 refuses a `scale` above
  // 100.
  //
  // objectui#11254: the width is read through `resolveFieldScale` (ruling A′
  // on objectstack-ai/objectstack#19628), the function the percent cell, the
  // detail chip, the grid footer and the gantt tooltip ask. For `number` the
  // protocol has no absent-`scale` row, so an undeclared field answers
  // `undefined`: no fixed width. A malformed declaration that is still a JS
  // number (`1.5`, `-1`) is "no declaration" too, because the resolver's door
  // is the record validator's own (`Number.isInteger` and `>= 0`); before,
  // `1.5` reached `Intl` to be floored to a width nobody declared and `-1`
  // reached it to throw. The resolved value feeds the grouping policy exactly
  // as the raw one did: a declared `0` stays `0`.
  // ⛔ No `?? N` beside this call: `undefined` is the protocol's answer.
  const scale = resolveFieldScale({ type: field.type, scale: 'scale' in field ? field.scale : undefined });
  // The author's digit-grouping hint (objectui#11026): `FieldSchema.useGrouping`,
  // declared on `NumberFieldMetadata`, read off the typed `field`. An authored
  // boolean overrides the `scale` heuristic above in either direction; the
  // decision is `formatDisplayNumber`'s, this only hands the declaration over.
  // Booleans only: the spec's door refuses anything else, and a value that is
  // not one is not a declaration.
  const useGrouping =
    'useGrouping' in field && typeof field.useGrouping === 'boolean'
      ? field.useGrouping
      : undefined;
  // Two arms, spelled out: a resolved width is fixed at both bounds; no width
  // is the value's natural precision (the minimum 0 / maximum 20 described
  // above), which is not a width of its own.
  return formatDisplayNumber(value, {
    locale,
    scale,
    useGrouping,
    ...(scale === undefined
      ? { minimumFractionDigits: 0, maximumFractionDigits: 20 }
      : { minimumFractionDigits: scale, maximumFractionDigits: scale }),
  });
}

/**
 * The display width of a currency amount: the resolved currency's own ISO 4217
 * minor-unit count (2 for USD / CNY, 0 for JPY, 3 for KWD), or the historical 2
 * when no currency is resolved, since there is then no minor unit to ask about.
 *
 * A currency's decimal places are the CURRENCY's, not a field setting: the
 * maintainer ruling recorded on objectstack-ai/objectstack#19910 (batch #218
 * item 2), executed by objectui#10276. ⛔ Not the field-level `precision` (the
 * TOTAL digit count of a decimal(p, s) column), ⛔ not `scale` (taken off the
 * `currency` type by ruling B on objectstack-ai/objectstack#19629) and ⛔ not
 * `currencyConfig.precision`. `CurrencyField`'s comment beside its call carries
 * the full reasoning.
 *
 * One function, so the width a currency amount is DISPLAYED at
 * ({@link formatCurrency}) and the width `CurrencyField` EDITS it at (its
 * `step` and its blur rounding) cannot part.
 */
export function currencyDisplayWidth(currency: string | undefined): number {
  return currency ? currencyFractionDigits(currency) : 2;
}

/**
 * Format a currency amount: the ONE call every display face of a `currency`
 * field makes. `CurrencyCellRenderer` in a table, `CurrencyField`'s read-only
 * branch in a form, and every face that takes the cell's formatter by
 * reference all reach it, so they agree by construction (objectui#11444).
 *
 * When `currency` is undefined the amount is a plain number with thousands
 * separators and no symbol. Silently assuming USD for unconfigured currency
 * fields was the #1 source of "why is my RMB amount showing as dollars?" bug
 * reports.
 *
 * The width is the DECLARED one, {@link currencyDisplayWidth}, for every
 * amount: `$3,456.00`, `$3,456.50`, `¥3,456`, `KWD 3,456.000`. Triage ruled
 * that the protocol's convention is the declared width (objectui#11444, comment
 * 5946462862), the family's one width source (ruling A′, `resolveFieldScale`),
 * and retired the objectui#4033 whole-amount trimming this function used to
 * apply: a whole amount dropped its fraction (`$3,456`, `KWD 3,456`) while the
 * read-only form showed the same amount at the currency's width (`$3,456.00`),
 * so one stored value read two ways.
 *
 * ONE width for both `Intl` bounds, never a range (objectui#4332). The symbol
 * branch once passed `minimumFractionDigits: 0` against a larger maximum, and
 * `Intl` then emits the SHORTEST representation in range, so a genuine cents
 * value of `.50` printed as `.5` (`$1,234.5`).
 *
 * The width is the CURRENCY's own minor-unit count, not a literal 2
 * (objectui#4361). Passing 2 for every currency on earth overrode what `Intl`
 * already knows: a yen amount was printed with cents it does not have
 * (`¥1,234.50`) and a dinar amount one digit short (`KWD 1.50`).
 *
 * Deliberately passes NO `scale` to `formatDisplayNumber`: `scale: 0` without a
 * currency reads as an ordinal there and drops the grouping separators
 * (objectui#4033), and an amount is never an ordinal.
 */
export function formatCurrency(value: number, currency?: string, locale?: string): string {
  const fractionDigits = currencyDisplayWidth(currency);
  try {
    return formatDisplayNumber(value, {
      locale,
      ...(currency ? { currency } : {}),
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
  } catch {
    // A code `Intl` refuses (or a runtime with no `Intl` data): the amount at
    // its width, with the code as given beside it when there is one.
    return currency ? `${currency} ${value.toFixed(fractionDigits)}` : value.toFixed(fractionDigits);
  }
}

/**
 * The storage scale a percent FACE reads a field's stored number at: the
 * spec's `percentScaleOf` (`@objectstack/spec/data`) by reference, plus the
 * one type the percent cell draws that the spec does not answer for
 * (objectui#11475).
 *
 * `PercentCellRenderer` reads it, and so does every face that renders the
 * cell's number for the same field (the grid footer, the record detail chip,
 * the gantt tooltip, the mobile card, the object metric tile), so one stored
 * value reads one magnitude on all of them. ⛔ None of them reads the storage
 * off the VALUE: a magnitude guess cannot tell a fraction-stored `1` (100%)
 * from one percentage point.
 *
 * - **`percent`, and a textual field the `format: 'percent'` hint promotes to
 *   the percent cell:** `percentScaleOf` asked about `percent`, the face's own
 *   type, with the field's declared `max`. A percent field stores a fraction
 *   unless it declares a `max` above 1. Asking about `percent` rather than the
 *   bag's own `type` is what lets a promoted textual field, or a bag whose
 *   `type` was rewritten to the renderer key, read by the percent convention
 *   too; it is the same reason `PercentField` asks `resolveFieldScale` about
 *   `percent`. `percentScaleOf` answers every percent field, so the result is
 *   never `undefined`.
 * - **`progress`: `whole`, stated here.** The spec's `percentScaleOf` answers
 *   `undefined` for it (it keys on `percent` alone), so the spec states no
 *   percent storage for a `progress` field, and an undeclared key follows the
 *   implementation: the one editor a `progress` field has, `SliderField`,
 *   stores the slider's position on a `0`–`100` range unless the field
 *   declares other bounds, and every first-party `progress` field declares
 *   `min: 0, max: 100`. So its number IS percentage points.
 *
 * @param field the field definition the face holds. Only `type` and `max`
 *              are read, and a `max` that is not a number is not a
 *              declaration.
 */
export function percentCellScale(
  field: { type?: string; max?: unknown } | null | undefined,
): PercentScale {
  if (field?.type === 'progress') return 'whole';
  const max = typeof field?.max === 'number' ? field.max : undefined;
  return percentScaleOf({ type: 'percent', max }) as PercentScale;
}

/**
 * Render a percent on a value ALREADY in display magnitude (`80` means 80%):
 * the ONE rendering call every display face of a `percent` field makes.
 * `formatPercent` (the table cell, and every face that takes the cell's
 * formatter by reference) and `PercentField`'s read-only branch in a form both
 * end here, so
 * the locale's percent convention, the grouping and the width cannot part
 * between them (objectui#11444). The read-only face printed
 * `toDisplay(value).toFixed(scale)` plus a literal `%`: a `scale: 2` field
 * holding `0.25` read `25.00%` in a `de` form while its cell read `25,00 %`.
 *
 * The SCALING is the caller's, and it is a separate statement on purpose:
 * both callers scale at the storage the field DECLARES, read through the
 * spec's `percentScaleOf` (a fraction unless the field declares a `max` above
 * 1, the rule the edit input writes by). `formatPercent` takes it as its
 * `percentScale` argument, which the cell answers with
 * {@link percentCellScale}; `PercentField` asks `percentScaleOf` itself, so
 * its read-only text and its input never show one stored value at two
 * magnitudes. Until objectui#11475 the cell guessed the storage from the
 * value's magnitude instead, so a fraction-stored `1` (100%) read `100%` in a
 * read-only form and `1%` in its cell, and a whole-stored `0.5` read `0.5%`
 * and `50%`.
 * ⛔ Do not add a caller with a scaling rule of its own, and ⛔ never one keyed
 * on the column's NAME: objectui#9452 removed exactly that from
 * `PercentCellRenderer`.
 *
 * @param displayValue the percentage points to render.
 * @param precision    the decimal places, fixed at both bounds: the width the
 *                     caller resolved (`resolveFieldScale`, ruling A′).
 * @param locale       the display locale tag, from `useDisplayLocale()`.
 */
export function formatPercentPoints(displayValue: number, precision: number, locale?: string): string {
  try {
    // `style: 'percentPoints'` renders a value that is ALREADY in percentage
    // points, so there is no `/ 100` here. Going through `Intl` rather than
    // appending a literal '%' is what buys the locale's percent CONVENTION and
    // not merely its separators: German writes `1.235 %` with a no-break space
    // before the sign, English `1,235%` with none, Turkish puts the sign in
    // FRONT. Both bounds are set to `precision` so the width is exactly the one
    // the caller asked for — the same contract `toFixed` gave.
    //
    // ⚠️ NOT `style: 'percent'` (objectui#4590). That style wants a FRACTION, so
    // this used to divide by 100 for `Intl` to multiply straight back — and the
    // round trip is not value-preserving. `Intl` formats from the SHORTEST
    // decimal representation of the double it is handed, and the quotient's is
    // not the authored one: `1.005` is `1.005`, but `1.005 / 100` is
    // `0.010049999999999999`, which percent-scales to `1.0049999999999999` and
    // rounds DOWN — so a stored 1.005 rendered `1.00%` where half-up is `1.01%`.
    // The DIVISION lost the digit, not the rounding, which is why it reproduced
    // in every locale and why 27,577 of 1,200,003 ordinary en-US forms moved
    // (0.005-step grid to 2,000, precisions 0/1/2), every one a last-digit
    // off-by-one. The same artefact reached the top of the double range:
    // `MAX_SAFE_INTEGER` points rendered `…740,990%` for `…740,991%`.
    //
    // The affix is unchanged by the switch: `'percentPoints'` is `Intl`'s
    // `style: 'unit'` / `unit: 'percent'` / `unitDisplay: 'narrow'`, measured
    // byte-identical to `style: 'percent'` across all 171 locale tags in #4576
    // and re-measured on THIS call shape in #4590 — 720 combinations (10 locales
    // x 18 values x 4 precisions), 0 convention diffs, 130 numeral diffs.
    // `formatMeasure` renders through the same option, so a percentage point
    // reads identically in a list cell and in a dashboard measure.
    return formatDisplayNumber(displayValue, {
      locale,
      style: 'percentPoints',
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
  } catch {
    return `${displayValue.toFixed(precision)}%`;
  }
}
