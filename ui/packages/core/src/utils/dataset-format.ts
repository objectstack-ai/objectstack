/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * dataset-format — shared value formatting for semantic-layer `queryDataset`
 * results (ADR-0021). Used by every dataset-bound surface (dashboard widgets,
 * reports, the dataset preview) so a measure renders identically everywhere:
 * a currency amount carries its declared currency symbol, a plain number stays
 * a plain number, and a dimension label passes through untouched.
 *
 * Pure (no React / i18n) so it can live in `@object-ui/core` and be imported
 * by both `@object-ui/plugin-dashboard` and `@object-ui/plugin-report`.
 */

import type { AnalyticsResult } from '@objectstack/spec/contracts';
import type { PercentScale } from '@objectstack/spec/data';

import { formatDisplayNumber, type DisplayNumberFormatOptions } from './number-display.js';
import { formatDate, formatDateTime, formatRelativeDate } from './date-display.js';
import { resolveMeasureLabel, type BuiltinAggregateLabels } from './chart-series.js';
import { composeDrillFilter } from './drill-down.js';

/**
 * Column metadata the analytics server returns alongside the rows — the spec's
 * `AnalyticsResult.fields[]` element BY REFERENCE, never a local restatement of
 * it (objectui#3815). Read `@objectstack/spec` for what a column carries; this
 * comment deliberately does not re-list the keys, because the enumeration it
 * replaced was the latent bug: a hand-written interface stops at the contract
 * of the day it was written and cannot grow with the spec, and here it would
 * not even fail to compile — three surfaces (`plugin-dashboard`'s
 * `DatasetWidget`, `plugin-report`'s `DatasetReportRenderer`, app-shell's
 * `DatasetPreview`) consume this name AS the real thing, so a spec column key
 * they never learn about is one they can never render. The same derive-don't-
 * restate fix as the parameter side (#3613/#3753) and the adapter return side
 * (#3752); this was the last surviving restatement of the family.
 *
 * `type` is REQUIRED, as the contract has it. The restatement had relaxed it to
 * optional, which was a promise the server never asked for: nothing in this repo
 * constructs a result column (every value originates in
 * `ObjectStackAdapter.queryDataset`, which already declares the spec element),
 * and nothing reads `.type` — so the widening bought no caller anything and only
 * offered future readers a `string | undefined` the wire never produces.
 *
 * Still a superset of {@link ChartResultField} (which needs only
 * name/label/format) — pinned, not merely asserted, in
 * `__tests__/dataset-result-field-spec-parity.test.ts`.
 */
export type DatasetResultField = AnalyticsResult['fields'][number];

/**
 * How a percentage column's stored number relates to its displayed percentage —
 * the server's answer to a question a `%` format string cannot express:
 * `fraction` is a 0–1 ratio (`1` ⇒ "100%"), `whole` is already percentage
 * points (`1` ⇒ "1%"). Resolved from metadata server-side (a `ratio` measure is
 * a fraction by definition; a measure over a `percent` field inherits that
 * field's scale) and carried on the result column, so display never has to
 * infer it from the value's magnitude — the inference that printed a ratio of
 * exactly 1 as "1.0%" (#3136).
 *
 * Spec-owned since 17.0.0-rc.2 (`@objectstack/spec/data` exports the identical
 * union); re-exported here so existing `@object-ui/core` consumers keep their
 * import path.
 */
export type { PercentScale } from '@objectstack/spec/data';

/**
 * Scale a stored percentage to its DISPLAY magnitude (percentage points), at
 * the storage the caller STATES.
 *
 * `percentScale` is the spec's `PercentScale`: `fraction` is a 0–1 ratio
 * (`0.75` ⇒ 75, `1` ⇒ 100), `whole` is already in percentage points (`75` ⇒
 * 75, `1` ⇒ 1). A caller holding a field definition reads it with the spec's
 * `percentScaleOf` (`@objectstack/spec/data`): a `percent` field stores a
 * fraction unless it declares a `max` above 1. A caller with no field (a
 * computed ratio, a server measure column) states the storage it knows: a
 * `derived: { op: 'ratio' }` measure is a fraction by definition, and the
 * server annotates a measure column with its `percentScale`.
 *
 * ⛔ No storage is inferred from the VALUE any more (objectui#11475). This
 * function used to be `value > -1 && value < 1 ? value * 100 : value`, a guess
 * from the magnitude that read neither the field nor its `max`. A fraction-
 * stored `1` (100%) therefore read `1%` in the list cell while the read-only
 * form, which reads the declaration, read `100%`; a whole-stored `0.5` read
 * `50%`. objectui#3136 was the same guess on a dashboard measure. The
 * parameter is REQUIRED, so every caller says which storage it holds, and a
 * value outside the union throws rather than falling to a branch silently.
 *
 * ⭐ The contract a third percent surface still owes is BOTH halves: this
 * scaling, at the stored scale, AND the locale's percent convention
 * (`style: 'percentPoints'`, see {@link formatMeasure} and `formatPercent` in
 * `@object-ui/fields`). Between objectui#4553 and objectui#4576 the two ends
 * shared the scaling and not the convention, so a German session read
 * `1.234,5 %` in a list cell and `1.234,5%` in a dashboard measure.
 */
export function percentDisplayValue(value: number, percentScale: PercentScale): number {
  if (percentScale === 'fraction') return value * 100;
  if (percentScale === 'whole') return value;
  throw new TypeError(
    `percentDisplayValue: percentScale must be 'fraction' or 'whole' (the spec's PercentScale), got ${String(percentScale)}`,
  );
}

/**
 * Format one number in the DISPLAY locale, surviving a malformed locale tag.
 *
 * THE DUPLICATE IS GONE (objectui#4576). This used to be a hand-mirrored copy
 * of the `try`/`catch` retry inside `formatDisplayNumber` — the ONE
 * number-display formatter — kept in step by a comment at each end because a
 * PACKAGE BOUNDARY stood between them: `formatDisplayNumber` lived in
 * `@object-ui/i18n`, which depends on `i18next`/`react-i18next` and
 * peer-depends on React, and this package is the React-free engine. #4566
 * measured the option mapping LOSSLESS across 32,760 combinations and recorded
 * the duplication rather than crossing that boundary; #4576 removed the
 * boundary instead, by moving the pure function DOWN into this package
 * (`./number-display.ts`), where `@object-ui/i18n` now re-exports it.
 *
 * So this is a thin ADAPTER, not a second implementation: it converts the
 * `Intl`-shaped option bag these call sites already speak into
 * {@link DisplayNumberFormatOptions}, and every policy decision — grouping,
 * the malformed-locale retry, the percent convention — is made in the one
 * home. The retry is load-bearing rather than defensive: before #4566 these
 * sites passed a literal `undefined`, which never throws, but a THREADED tag
 * can be malformed and a bare `Intl.NumberFormat('en_US', …)` throws
 * `RangeError` (measured — underscore instead of hyphen is the likeliest
 * tenant-config typo), which would take the whole widget down. A bad
 * `currency` still throws out of both attempts, which is what lets
 * {@link formatMeasure}'s own `catch` fall through to plain-number formatting.
 *
 * ⚠️ `scale` is deliberately never passed. A measure carries no field `scale`
 * (its decimals come from a numeral format PATTERN), so the grouping policy
 * keyed on it must not fire here — which is exactly why #4566 measured the two
 * implementations byte-identical across all 32,760 combinations.
 */
function formatNumberInLocale(
  value: number,
  locale: string | undefined,
  options: Omit<DisplayNumberFormatOptions, 'locale' | 'scale'>,
): string {
  return formatDisplayNumber(value, { ...options, locale });
}

/**
 * ISO calendar date with NO time part — `2026-07-04`.
 *
 * Deliberately anchored at both ends and deliberately narrower than
 * `Date.parse`, which also accepts locale prose (`March 5, 2026`), bare years
 * (`2026`) and — the one that matters here — plain NUMERALS. A measure value
 * is untyped by the time it reaches {@link formatMeasure}, so the shape test
 * IS the type test, and a loose one would capture the numeric strings and
 * counts this formatter must leave exactly as they are.
 */
const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ISO date carrying a time part — `2026-07-04T07:00:00.000Z`, or the same with
 * a space separator, with or without seconds/offset. Matched only as far as
 * `HH:mm`; `Date.parse` decides the rest. What it rejects is an out-of-range
 * MONTH or CLOCK reading (`2026-13-01T09:30`, `2024-07-04T99:99`), which this
 * pattern admits — such a value falls through untouched.
 *
 * ⛔ A DAY that overflows its month does NOT fall through. `2026-02-30T09:30`
 * parses and reaches the shared date path, which refuses it with the dash
 * `formatDateTime` renders for any unparsable value (objectui#10301, the
 * date-time half of objectui#10026). The refusal is that path's, not this
 * pattern's. See the note inside {@link formatMeasureDate}.
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/;

/**
 * Render a date-shaped measure value through the display path a list cell
 * already uses for that field, or return `undefined` to say "not a date" and
 * leave the caller's own fallthrough in charge.
 *
 * ── Why this is a ROUTE and not a formatter (objectui#7178) ──
 * Every line of date rendering below happens in `./date-display.ts`, which is
 * where `@object-ui/fields`' `formatDate` / `formatDateTime` now live and what
 * `DateCellRenderer`, `ObjectGrid`'s date cells and `ObjectGantt`'s tooltips
 * call. Writing the date convention HERE instead is the mistake this file's
 * own header is about: objectui#4576, where a percent convention had one copy
 * in a list cell and another in this function, both correct, and a German
 * session read `1.234,5 %` in the cell beside `1.234,5%` in the measure. One
 * date convention, one home, nothing to drift.
 *
 * The date/datetime split mirrors `ObjectGantt.tsx`'s sniffed-ISO dispatch
 * verbatim, because that site is already the repo's answer to this exact
 * situation: an ISO string arriving with NO field type attached. A measure is
 * that situation by construction — the analytics result carries a column, not
 * a field definition — so the absolute locale form is taken rather than
 * `DateCellRenderer`'s `|| 'relative'` default, which is keyed on knowing the
 * value is a `date` FIELD in a row.
 *
 * ── `format` is honoured on BOTH arms, by different means (objectui#8352) ──
 * The accepted vocabulary is `'short'` and `'relative'` on EITHER arm, and
 * every other string — including `'compact'`, including a date PATTERN such as
 * `'YYYY-MM-DD'` — falls to that arm's default face. The two arms reach that
 * one vocabulary differently, and the difference is the whole of #8352:
 *
 *   - The DATE arm threads `format` onward, into `formatDate`'s positional
 *     STYLE parameter. That is the same mapping `DateCellRenderer` makes from
 *     `field.format` and the same one `plugin-dashboard`'s `recordFields`
 *     makes for a date-shaped format.
 *   - The DATETIME arm SELECTS a formatter above, because it has nothing to
 *     thread into: `formatDateTime(value, options?)` has no style parameter,
 *     so before #8352 this arm could not honour `format` even in principle —
 *     it dropped it, and `format: 'relative'` on a `Field.datetime` measure
 *     rendered the absolute face with no diagnostic.
 *
 * ⚠️ Threading `format` into `formatDateTime`'s `options.style` is NOT the fix
 * and was measured before this one was written: that key's vocabulary is
 * `'compact'` alone, so the pass-through would honour the one word the date
 * arm does NOT honour while still ignoring both words it does — the defect
 * inverted, not closed. Widening the signature was refused separately: it is a
 * published one (see {@link formatDateTime}'s note on why the positional shape
 * was refused there), and the parity #8352 asks for is reachable from the call
 * site without touching it.
 *
 * Which FACE each honoured word selects is per-arm, because the two arms
 * render different types and a datetime's own resolution is part of its datum:
 *
 *   - `'relative'` → `formatRelativeDate` on both arms, the same function, so
 *     an in-window value reads `In 2 days` in either column. Its ±7-day
 *     fallback is inherited rather than re-decided here — an out-of-window
 *     value renders the absolute DATE face on both arms. Re-deciding that
 *     window at this call site would put a second copy of the convention in
 *     this file, which is objectui#4576 exactly.
 *   - `'short'` → the dense narrow-card face of the arm's own type:
 *     `formatDate`'s `'short'` (`Sep 11, '26`) for a date, `formatDateTime`'s
 *     `'compact'` (`9/11/2026 9:30 am`) for a datetime. The datetime face
 *     keeps the time, and it is byte-identical to what every `datetime` CELL
 *     paints, so a measure tile and a grid cell showing the same instant
 *     agree — objectui#4576's rule again, in the other direction.
 *
 * See the `format` note on {@link formatMeasure}.
 */
function formatMeasureDate(v: unknown, format: string | undefined, locale: string | undefined): string | undefined {
  if (typeof v !== 'string') return undefined;
  // `Date.parse` guards both arms, and what it rejects is an out-of-range
  // MONTH (`2026-13-01`) — which both patterns above admit — ⛔ NOT an
  // out-of-range DAY. ECMAScript's Date Time String Format accepts `DD` in
  // `01`-`31` syntactically and `MakeDay` rolls the surplus into the next
  // month, so a well-shaped impossible date (`2026-02-30`) is PARSEABLE on
  // both arms: it does not fall through to `String(v)`, it reaches the shared
  // date path. This paragraph once asserted the opposite — that such a value
  // keeps falling through — until objectui#8263 measured it.
  //
  // ⭐ What that path answers is ITS decision, never this guard's. Since
  // objectui#10026 it refuses a date-only nonexistent day with the dash it
  // renders for any unparsable value, so the measure shows that same dash —
  // agreeing with the list cell ON THE REFUSAL. This guard must not refuse
  // on its own (by letting the value fall through to `String(v)`, say): the
  // measure would then disagree with the list cell, the objectui#4576 split.
  // `agrees with the list cell on an impossible calendar day — on the refusal`
  // in this file's co-located date suite pins it; read that test for the
  // full argument.
  if (ISO_DATE_ONLY_RE.test(v)) {
    return Number.isNaN(Date.parse(v)) ? undefined : formatDate(v, format, { locale });
  }
  if (ISO_DATETIME_RE.test(v)) {
    if (Number.isNaN(Date.parse(v))) return undefined;
    // The datetime arm honours the SAME two words the date arm does, by
    // choosing a formatter here (objectui#8352). It cannot thread `format`
    // onward the way the date arm does, because `formatDateTime(value,
    // options?)` takes no style parameter — see this function's docblock for
    // why that is answered HERE and not by widening a published signature.
    if (format === 'relative') return formatRelativeDate(v, { locale });
    if (format === 'short') return formatDateTime(v, { locale, style: 'compact' });
    return formatDateTime(v, { locale });
  }
  return undefined;
}

/**
 * Format a MEASURE value. Currency comes from the field's declared `currency`
 * (locale-correct symbol via `Intl`), NOT from a "$" baked into the format
 * string — an amount with no declared currency must render as a plain number,
 * never a misleading "$". The numeral `format` hint (e.g. "0,0", "0.0%")
 * controls grouping / decimals / percent; it can't be baked into the row value
 * server-side (the same number feeds charts), so it is applied here.
 *
 * `locale` is the BCP-47 tag of the active display locale — in React, whatever
 * `useDisplayLocale()` returns. It is optional and LAST so every existing call
 * keeps compiling, and omitting it reproduces the previous output byte for
 * byte (the old code passed a literal `undefined` to `Intl`, which is exactly
 * what an omitted argument passes now).
 *
 * Before objectui#4566 there was no way to pass one: all three formatting sites
 * here hard-coded `undefined`, which is neither of the repo's two locale
 * channels — it is the MACHINE's locale. A German session read a KPI as
 * `1,234.5` beside a grid cell rendering the same number as `1.234,5`, and
 * inverted separators read as a different number, not an unstyled one.
 *
 * ── This routes through `formatDisplayNumber` (objectui#4576) ──
 * It did not always. #4566 measured the option mapping across 32,760
 * value × format × currency × percentScale × locale combinations and found it
 * LOSSLESS — routing changes no byte of output, because the policy layer
 * `formatDisplayNumber` adds over plain `Intl` is grouping suppression keyed on
 * a field's declared `scale`, and a measure has no `scale` to feed it (decimals
 * here come from a numeral format PATTERN, so grouping stays on and the two
 * agree everywhere). What blocked it was the PACKAGE BOUNDARY: the formatter
 * lived in `@object-ui/i18n`, which depends on `i18next`/`react-i18next` and
 * peer-depends on React, while this package is the React-free engine (AGENTS.md
 * §3: "No UI-lib deps. Logic only.") and a runtime dependency of React-FREE
 * consumers — the `object-ui` VS Code extension and `@object-ui/data-objectstack`.
 *
 * #4576 removed the boundary rather than working around it: `formatDisplayNumber`
 * is pure, so it moved DOWN into this package (`./number-display.ts`) and
 * `@object-ui/i18n` re-exports it. The duplicate implementation this file used
 * to carry is gone, and with it the drift that duplicate produced — see the
 * percent note in the body, and the both-halves contract
 * {@link percentDisplayValue}'s doc comment states.
 *
 * ── Date-valued measures (objectui#7178) ──
 * `min` / `max` over a date or datetime field is a legitimate measure, and it
 * used to render its stored value verbatim: the guard above returned
 * `String(v)` for anything non-numeric BEFORE `format` was read, so a KPI tile
 * showed `2026-07-04T07:00:00.000Z` in `text-2xl` and wrapped it over two
 * lines. A date-shaped value now routes through {@link formatMeasureDate} to
 * the display path list cells use; nothing about the numeric path moved.
 *
 * ⚠️ What `format` can and cannot say for those values, measured rather than
 * assumed, and stated PER ARM — a date-shaped measure takes one of two arms in
 * {@link formatMeasureDate}, and this paragraph used to describe only one of
 * them while reading as though it described both. That cost a card: an
 * objectui triage pass read the undifferentiated claim, concluded the defect
 * was already fixed, and downgraded objectui#8352, which a driven browser run
 * then refuted. The two arms agree TODAY, but only because #8352 made them; a
 * universal sentence here is what hid the disagreement before, so it is not
 * coming back even now that it would be true.
 *
 * The shared date path takes a named STYLE, not a date pattern. On BOTH arms
 * the honoured vocabulary is `'short'` and `'relative'`:
 *
 *   - `Field.date` (`2026-09-08`) — honoured by threading `format` into
 *     `formatDate`'s style parameter. The same words `DateCellRenderer`
 *     honours from `field.format` for the same field.
 *   - `Field.datetime` (`2026-09-01T00:00:00.000Z`) — honoured by SELECTING a
 *     formatter, because `formatDateTime` has no style parameter to thread
 *     into (objectui#8352). Before that card this arm honoured NOTHING: it
 *     dropped `format` entirely, so `'relative'` rendered the absolute face.
 *
 * Every other string falls to that arm's default face — a PATTERN like
 * `format: 'YYYY-MM-DD'` is accepted by the schema, reaches this function, and
 * renders the locale default, and so does `'compact'`, which is
 * `formatDateTime`'s own vocabulary but not this path's. The pattern part is
 * not new behaviour introduced here: `plugin-dashboard`'s `recordFields`
 * already routes a date-shaped `format` into the same style slot and gets the
 * same locale default. Closing it would mean teaching the shared path a
 * pattern grammar, which is a change to the path itself and to every list cell
 * that reads it — not a measure concern, and not either card.
 *
 * ⚠️ `'relative'` renders the ABSOLUTE face for a value more than ±7 days from
 * today, on both arms, by `formatRelativeDate`'s own design. That is correct
 * output, not a regression — but it also means an out-of-window value is
 * useless for testing this path, because it renders identically whether
 * `format` is honoured or dropped. Both readings that missed #8352 were taken
 * on 40–60-day-old data.
 */
export function formatMeasure(
  v: unknown,
  format?: string,
  currency?: string,
  percentScale?: PercentScale,
  locale?: string,
): string {
  if (v == null) return '—';
  if (typeof v !== 'number') {
    // Ahead of the `String(v)` short-circuit, which is what made `format` dead
    // on this path and printed a `min`/`max` over a datetime as a raw
    // 24-character ISO string (objectui#7178). Deliberately NOT ahead of the
    // `typeof` test itself: above that line the argument can be a bare number,
    // and any date test generous enough to consider one would have to decide
    // whether `1751612400000` is epoch milliseconds — which is how a measure
    // that counts things starts rendering as a date. Numbers reach the numeral
    // formatter below byte for byte as before.
    const asDate = formatMeasureDate(v, format, locale);
    return asDate ?? String(v);
  }

  const decimals = format ? (format.split('.')[1]?.match(/0/g)?.length ?? 0) : undefined;

  if (currency) {
    try {
      // No `style: 'currency'` here: `formatDisplayNumber` derives that from the
      // presence of `currency` itself, which is also what keeps its "money
      // always groups" policy in one place instead of two.
      return formatNumberInLocale(v, locale, {
        currency,
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 2,
      });
    } catch {
      // Unknown currency code → fall through to plain number formatting.
      // Still reachable with a locale threaded: `formatNumberInLocale` retries
      // without the LOCALE, and a bad currency throws out of that retry too.
    }
  }

  if (!format) {
    // No format hint → preserve the plain rendering (integers verbatim).
    //
    // The integer branch stays a bare `String(v)` and is deliberately NOT
    // localized: it is the one form here that renders no separator and no
    // decimal mark, so there is nothing for a locale to change — and routing it
    // through `Intl` WOULD change it, in two ways this card is not about
    // (measured): a locale with its own numbering system would re-digit it
    // (`ar-EG` 1234 → an Arabic-Indic spelling), and `1e21` would expand from
    // `1e+21` to its 22 digits. Only the fractional branch below ever produced
    // locale-dependent text, and that is the site #4566 fixes.
    return Number.isInteger(v) ? String(v) : formatNumberInLocale(v, locale, { maximumFractionDigits: 2 });
  }
  const isPercent = format.includes('%');
  // A legacy "$" literal in the format string is still honored (explicit author
  // choice) — but it is NOT how a real currency field gets its symbol.
  const legacyDollar = format.includes('$') ? '$' : '';
  // The column's storage is STATED, never read off the value (objectui#11475).
  //
  // The server annotates a percentage column with its `percentScale`: a
  // `derived: { op: 'ratio' }` measure is a fraction by definition, and a
  // measure over a `percent` field inherits that field's scale
  // (`AnalyticsResult.fields[].percentScale`). That annotation wins, which is
  // what fixed an SLA rate of full compliance reading "1.0%" instead of
  // "100.0%" (#3136).
  //
  // A column the server does NOT annotate is, in the contract's words, "not a
  // percentage", so the only statement left is the author's numeral PATTERN,
  // and numeral's `%` multiplies by 100: a `'0.0%'` pattern states a fraction.
  // That is the spec's own reading for a measure over a plain number ("keeps
  // whatever the author's format string implies", `percentScaleOf`'s doc). It
  // used to fall to a magnitude guess instead, which read an unannotated `57`
  // as 57% and an unannotated `0.57` as 57% alike.
  const display = isPercent
    ? percentDisplayValue(v, percentScale ?? 'fraction')
    : v;
  // The percent sign is the LOCALE's, not a literal '%' (objectui#4576).
  //
  // Until #4576 this appended a hard-coded '%' to a decimal-formatted body, so
  // a German session read `1.234,5%` from a dashboard measure beside
  // `1.234,5 %` (no-break space — the German percent convention) from a list
  // cell showing the SAME number, because `formatPercent` had gone through
  // `Intl` since #4553. That contradicted the promise {@link percentDisplayValue}
  // made then, that the two surfaces "can never drift": the SCALING had stopped
  // drifting, the CONVENTION had started. Measured to differ in de, fr, es, ru,
  // sv, cs, fi (no-break space), tr (the sign moves to the FRONT: `%1.234,5`)
  // and ar (its own sign plus U+061C); en, ja, zh were already identical.
  //
  // `style: 'percentPoints'` is what closes it, and the choice of route is
  // measured, not incidental. `display` is already in percentage POINTS, while
  // `Intl`'s `style: 'percent'` wants a fraction — so routing through that
  // would mean dividing by 100 for `Intl` to multiply straight back, and that
  // round trip is lossy at rounding TIES: 27,581 of 1,200,013
  // ordinary-magnitude en-US forms move (`0.175` at 2 decimals goes from
  // `0.18%` to `0.17%`), plus `MAX_SAFE_INTEGER` and everything from 1e23 up.
  // That count is #4576's tie-dense grid — 0.005 steps to 2,000, precisions
  // 0/1/2 — measured on THIS formatter's call shape. #4590 re-measured the same
  // route through `formatPercent` and reports 27,577 of 1,200,003: a different
  // form set, not a correction of this one.
  //
  // No caller in this repo takes the divide-by-100 route today. `formatPercent`
  // was the last one and moved to `style: 'percentPoints'` in #4590; the two
  // `style: 'percent'` sites left (`element:number`'s format options and the
  // report exporter's Excel options) hand `Intl` a FRACTION, which is that
  // style's own contract and not this trap. The route now survives only where a
  // test constructs it in order to show it disagreeing.
  //
  // Formatting the points directly with the percent UNIT was measured to
  // produce a byte-identical percent affix to `style: 'percent'` across all 171
  // locale tags tested, while moving ZERO of those 1,200,013 en forms — the
  // same convention by a route that does not touch the value.
  const body = formatNumberInLocale(display, locale, {
    style: isPercent ? 'percentPoints' : 'decimal',
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 0,
  });
  return `${legacyDollar}${body}`;
}

/**
 * Format a non-measure (dimension / label) value — the server already resolves
 * dimension display labels, so this only tidies numbers and nulls.
 *
 * `locale` follows {@link formatMeasure}: optional, last, and omitting it
 * reproduces the previous machine-locale output byte for byte. Integers stay
 * verbatim here for the same measured reason as there.
 */
export function formatDimensionValue(v: unknown, locale?: string): string {
  if (v == null) return '—';
  if (typeof v === 'number') {
    return Number.isInteger(v) ? String(v) : formatNumberInLocale(v, locale, { maximumFractionDigits: 2 });
  }
  return String(v);
}

/**
 * Resolve a column header / measure helper pair for one result set.
 * `headerLabel` maps a dimension/measure NAME to its display label — the
 * server-enriched field `label`, then (when `fieldLabel` is supplied) through
 * the i18n field-label convention so a translated label wins, then the raw name
 * as a last resort. `measureField` exposes a field's `format`/`currency`.
 *
 * `fieldLabel` is injected (rather than imported) so this stays React/i18n-free;
 * callers pass `useSafeFieldLabel().fieldLabel`.
 *
 * ## `builtinAggregateLabels` (objectui#7534, sibling of #7258)
 *
 * A result field the analytics service minted as a BUILT-IN default measure
 * carries `builtinAggregate` (objectstack#14492) and a hard-coded English
 * `label` ('Count'). {@link resolveMeasureLabel} is the ONE resolver for that —
 * #7258 wired it into `buildChartSeries()`, so a chart legend already read
 * `计数` on a zh console while the table underneath it, the KPI caption, the
 * pivot header and the dataset preview all still said `Count`, because they
 * resolve their titles through here instead.
 *
 * Passing the caller's resolved labels closes that gap without a second
 * resolution order: the discriminator is consulted FIRST (exactly as on the
 * chart seam), the existing `fieldLabel` convention still applies on top, and
 * the raw name is still the floor. Omitting the argument reproduces the
 * previous output byte for byte — an author-declared measure carries no
 * discriminator and keeps its wire `label` verbatim (objectui#4106), and a
 * provider-less host resolves no labels and so changes nothing.
 */
export function buildDatasetFieldHelpers(
  fields: DatasetResultField[] | undefined,
  object: string | undefined,
  fieldLabel?: (objectName: string, fieldName: string, fallback: string) => string,
  builtinAggregateLabels?: BuiltinAggregateLabels,
): {
  measureField: (name: string) => DatasetResultField | undefined;
  headerLabel: (name: string) => string;
} {
  const fieldByName = new Map((fields ?? []).map((f) => [f.name, f] as const));
  const measureField = (name: string) => fieldByName.get(name);
  const headerLabel = (name: string) => {
    const field = measureField(name);
    const fallback = field ? resolveMeasureLabel(field, builtinAggregateLabels) : name;
    return object && fieldLabel ? fieldLabel(object, name, fallback) : fallback;
  };
  return { measureField, headerLabel };
}

/**
 * A half-open date-range drill scope for one time-bucketed dimension (objectstack-ai/objectstack#1752):
 * the object FIELD to filter and its inclusive `gte` / exclusive `lt` bounds
 * (the server's `drillRanges` sidecar entry).
 */
export interface DatasetDrillRange {
  field: string;
  gte: unknown;
  lt: unknown;
}

/**
 * Build the record-list filter for a drilled dataset bucket (ADR-0021 D2).
 *
 * Each drillable dimension maps to its underlying object field, filtered by the
 * dimension's RAW grouped value (from the server's parallel `drillRawRows`, NOT
 * the visible row which carries the display LABEL — a select/lookup label would
 * mis-filter). The render-time `runtimeFilter` is ANDed in so the drilled list
 * stays within the same slice the aggregate was computed over.
 *
 * ## What the EMPTY bucket means, and why it is spelled `{ $null: true }`
 *
 * A drill must return exactly the rows the clicked bucket COUNTED. The empty
 * bucket is the one the aggregate grouped rows with NO VALUE for that dimension
 * into, so the drill means "this dimension has no value" — NOT "this dimension
 * holds the literal value null". Those are different row sets, and the
 * difference is measurable rather than theoretical: against `ValueDataSource`'s
 * matcher over rows `{owner:'alice'}` / `{owner:null}` / `{}` (no `owner` key),
 * `['owner','is_null',true]` selects the explicit-null row AND the missing-key
 * row, while an equality test against `null` selects only the explicit-null one
 * and drops the row that has no `owner` at all. The bucket counted both, so
 * is-null is the one that agrees with the number the user clicked.
 *
 * ⇒ every empty authoring — `''`, `null` and `undefined` alike — becomes ONE
 * spelling, `{ [field]: { $null: true } }`, which `convertFiltersToAST` lowers
 * to `[field, 'is_null', true]`. The three are not told apart because the
 * server already merged them into the single bucket the user clicked; there is
 * no second bucket here for a second spelling to address.
 *
 * ⚠️ This value used to be a bare `null`, and that is the defect objectui#9085
 * records: `convertFiltersToAST`'s OLDEST pinned behaviour is to SKIP a key
 * whose value is `null` / `undefined` (pinned as "should skip null and
 * undefined values"), so the constraint was dropped on the way to the wire and
 * the empty-bucket drill answered with a SUPERSET — every row, silently. The
 * repair is here at the PRODUCER and ⛔ not at that converter: the skip is
 * relied on by other producers, and changing it would move every caller's
 * meaning at once (objectui#9020 ruled it stays). `$null` is not a new
 * vocabulary either — it is a declared spec operator this dialect already
 * lowers, and the one spelling that says the same thing on BOTH of
 * `ValueDataSource`'s routes, where a bare `null` said "only an explicit null"
 * on the plain-object route and "no constraint at all" on the AST route.
 *
 * ⚠️ Known BOUNDARY, unchanged by this and deliberately not widened: the drill
 * "escape hatch" (the host's `openRecordList`, which serializes a drill filter
 * into `filter[...]` URL params) has NO spelling for is-null — its operator
 * vocabulary is equality plus four range bounds — so it drops this condition
 * exactly as it already dropped the bare `null`, byte-for-byte the same query
 * string. That surface is a superset today and stays one; closing it needs a
 * URL-dialect operator on both the write and the read side, which is its own
 * card.
 *
 * A time-bucketed date dimension (objectstack-ai/objectstack#1752) drills by RANGE, not equality — a
 * humanized bucket ("2026-Q2") can't be exact-matched, so the server sends a
 * half-open `[gte, lt)` per date dim in `rawRanges` instead of a raw value.
 * Each becomes an ObjectQL range operator object (`{ $gte, $lt }`) so the drill
 * scopes the list to the clicked time bucket instead of every bucket (which the
 * old date-dim skip degraded to — a superset).
 *
 * ## The widget filter is CONJOINED, not spread (objectui#9137)
 *
 * ⛔ `runtimeFilter` is composed through {@link composeDrillFilter}, never by
 * spreading it into the object literal below. Spreading is correct only for the
 * OBJECT arm; this parameter's declared producer sends the ARRAY arm. The
 * dashboard's `DashboardWidgetSchema.filter` docblock states it outright —
 * "objectui passes an ObjectQL FilterNode array here, not the spec's
 * `FilterCondition` envelope" — and `DatasetWidget`'s guard admits it
 * (`typeof [] === 'object'` and `Object.keys(['x']).length === 1` are both
 * true), so the array arm reached this line unfiltered. Spreading an ARRAY
 * yields INDEX keys: `[['region','=','emea']]` became
 * `{ '0': ['region','=','emea'] }`, which is not a condition anyone can honour.
 *
 * ⚠️ MEASURED, and it is NOT the silent superset the sibling sites had. An
 * index key is not dropped on the way to the wire — every sink in circulation
 * refuses it LOUDLY, because a bare array is not a legal equality comparand
 * (objectui#8530 / objectui#8514): `convertFiltersToAST` THROWS
 * `FilterOperatorError`, `driver-sql` answers `400 INVALID_FILTER`, and
 * `ValueDataSource`'s matcher selects NOTHING. Against rows scoped
 * `region = 'emea'`, drilling the `stage = 'won'` bucket returned `(none)`
 * where the widget alone returned three rows and the conjunction returns the
 * right two. So the widget's conditions were not merely lost — the drill was
 * dead in the array arm. The failure is fail-CLOSED here, and this is the third
 * site of the class objectui#8944 (chart) and objectui#9024 (pivot) removed.
 *
 * Three properties of THIS site, each confirmed rather than assumed — it is not
 * a copy-paste of the other two:
 *
 * 1. The return stays a NON-optional `Record<string, unknown>`, because callers
 *    do not expect `undefined`. `composeDrillFilter` answers `undefined` when
 *    both sources are empty, so that one case is spelled `?? {}` — the same
 *    empty object this function already returned for a bucket with no dims.
 * 2. Range operators SURVIVE. A time-bucketed dim contributes
 *    `{ $gte, $lt }`, and the composition re-spells it as two `$and` children
 *    on the same field (`[{d:{$gte}},{d:{$lt}}]`) rather than losing a bound;
 *    the selected rows are identical, and `serializeDrillFilterParams` walks
 *    `$and` (objectui#8944) so both bounds still reach `filter[d][gte|lt]`.
 * 3. `runtimeFilter` is declared `unknown`, which is what the two consumers
 *    actually hand it — `any` from the dashboard, `Record<string, unknown>`
 *    from `DatasetReportRenderer`. Widening the PARAMETER is what admits both
 *    without a cast; ⛔ neither consumer's own type is changed by this.
 *
 * ⚠️ Conjunction changes one behaviour deliberately: a field named by BOTH the
 * widget filter and the clicked bucket used to be overwritten by the bucket,
 * and now both conditions apply. That is the point — a drill may narrow the
 * widget's scope and may never widen it — and it is the posture the chart and
 * pivot sites already ship.
 *
 * ## ⭐ Only the COMPOSING leg moves; the identity leg is left byte-identical
 *
 * The sink is asked only when there IS a second source. That is this site's
 * one departure from `ObjectChart` / `ObjectPivotTable`, which call it
 * unconditionally, and it is deliberate rather than a shortcut: the spread
 * this replaces only ever ran when `runtimeFilter` was present, so the
 * no-widget-filter path carries no defect to repair.
 *
 * ⚠️ Routing it anyway was MEASURED and rejected. `composeDrillFilter`'s own
 * note — "a lone surviving source lowers back to exactly the flat object the
 * spread produced" — holds only for a source of ONE condition; with two it
 * lowers to `$and`, because `convertFiltersToAST` emits one node per condition
 * and `parseFilterAST` cannot fold two nodes back onto one key. A `{ $gte,
 * $lt }` range is two conditions on its own, so even a single date bucket
 * re-spells. Sending the identity leg through the sink therefore re-shaped
 * every multi-condition dataset drill — including the controls objectui#9085,
 * objectui#4056, objectstack#5473 and objectstack-ai/objectstack#1752 pin on paths this card does not
 * touch — for ZERO change in the rows selected or the `filter[...]` params
 * emitted. ⛔ Do not "simplify" this to an unconditional call without redoing
 * that measurement.
 *
 * Shared by the dashboard `DatasetWidget` and the report renderer so a drill
 * filters identically (and correctly, including lookups) on both surfaces.
 */
export function buildDatasetDrillFilter(
  rawRow: Record<string, unknown> | undefined,
  drillDims: string[],
  dimensionFields: Record<string, string>,
  runtimeFilter?: unknown,
  rawRanges?: Record<string, DatasetDrillRange>,
): Record<string, unknown> {
  const drillFilter: Record<string, unknown> = {};
  for (const d of drillDims) {
    const raw = rawRow?.[d];
    // `null` is in this test, not only `''` / `undefined`: JSON cannot carry
    // `undefined`, so a SQL NULL grouped value arrives over the wire AS `null`
    // — it is the empty bucket's most common shape, and leaving it out would
    // fix the defect for the spellings the wire rarely uses.
    drillFilter[dimensionFields[d]] =
      raw === '' || raw === null || raw === undefined ? { $null: true } : raw;
  }
  if (rawRanges) {
    for (const r of Object.values(rawRanges)) {
      if (r && r.field) drillFilter[r.field] = { $gte: r.gte, $lt: r.lt };
    }
  }
  // ⛔ The composition is `composeDrillFilter`'s, never a spread. The identity
  // leg is deliberately left alone — see "only the composing leg moves" above.
  // `?? {}` is property 1: the empty/empty answer stays an empty object.
  return runtimeFilter ? composeDrillFilter(runtimeFilter, drillFilter) ?? {} : drillFilter;
}
