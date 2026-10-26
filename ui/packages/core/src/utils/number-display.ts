/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `formatDisplayNumber` — the ONE number-display formatter behind every field
 * cell, field widget, metric renderer and dataset measure in the console.
 *
 * It exists because the same `new Intl.NumberFormat('en-US', …)` construction
 * had been copied into the number cell renderer, the currency cell renderer,
 * the currency widget, the compact `formatNumber` helper and the dashboard
 * metric widget. Two defects therefore had five homes each, and fixing "the"
 * renderer never changed the answer (objectui#4033, source thread
 * objectstack#5067):
 *
 *  1. the locale was hardcoded to `en-US`, so a `zh-CN` / `de-DE` console still
 *     grouped and pointed decimals the US way; and
 *  2. `useGrouping` was never set, so a four-digit YEAR stored as
 *     `Field.number({ scale: 0 })` rendered as `2,026` — in every locale, with
 *     no field property able to turn it off. (That property now exists: the
 *     spec's `FieldSchema.useGrouping`, read here since objectui#11026.)
 *
 * Both policies now live here and nowhere else. Call sites bring the value, the
 * display width and whatever the FIELD declared (`scale`, `useGrouping`); they
 * do not bring a locale default and they do not decide grouping.
 *
 * ── Why this module lives in `@object-ui/core` (objectui#4576) ──
 * It used to live in `@object-ui/i18n`, and that home cost the repo a real
 * defect. `@object-ui/core`'s `utils/dataset-format.ts` could not import it —
 * `core` is the React-free engine (AGENTS.md §3: "No UI-lib deps. Logic only.")
 * and is a runtime dependency of React-FREE consumers (the `object-ui` VS Code
 * extension, `@object-ui/data-objectstack`), while `i18n` depends on
 * `i18next`/`react-i18next` and peer-depends on React. So `formatMeasure` kept
 * a parallel `Intl` implementation, the two drifted, and a German session read
 * `1.234,5 %` from a list cell beside `1.234,5%` from a dashboard measure
 * (objectui#4576). #4577 measured the option mapping LOSSLESS across 32,760
 * combinations and recorded the duplication at both ends rather than routing
 * through a boundary it could not cross.
 *
 * The function is pure — no React, no i18next, no DOM — so the boundary was
 * never a property of the CODE, only of where the code sat. Moving it DOWN to
 * the lower layer removes the obstacle instead of working around it:
 * `@object-ui/i18n` now RE-EXPORTS these three names, so every existing import
 * path keeps compiling and `import { formatDisplayNumber } from '@object-ui/i18n'`
 * and `from '@object-ui/core'` are the SAME symbol (pinned in
 * `packages/i18n/src/__tests__/number-display.reexport-identity.test.ts`).
 * `core` imports `i18n` nowhere, so the new edge introduces no cycle.
 */

export interface DisplayNumberFormatOptions {
  /**
   * BCP-47 tag for the ACTIVE display locale — in React, whatever
   * `useDisplayLocale()` returns.
   *
   * `undefined` means "follow the runtime default", which is the honest answer
   * for a non-React caller that has no locale in hand. It never means `en-US`:
   * assuming US conventions for the whole world is the defect this module was
   * created to remove.
   *
   * ── The caller this rule governs (objectui#10098) ──
   * The `undefined` rule above is written for a NON-REACT display caller with
   * no tag in hand: a plain formatter, an exporter, engine code — anything that
   * cannot call a hook. For that caller the runtime default is the viewer's
   * own environment, and the viewer's own environment is the honest locale for
   * a user-facing display. A malformed tag ends in the same place, whoever the
   * caller: {@link formatDisplayNumber} retries without it rather than
   * throwing, so the number renders in the runtime default instead of taking
   * the cell down.
   *
   * A React renderer is governed by a different rule, and the two do not
   * contradict each other. It passes what `useDisplayLocale` returns, and that
   * hook — `@object-ui/i18n`, `packages/i18n/src/useDisplayLocale.ts` — ends
   * its provider chain on the concrete `'en'`, for determinism, when the chain
   * yields no tag at all. That hook's docblock names this one in return.
   */
  locale?: string;

  /**
   * ISO 4217 code. When present the value is formatted as money — which also
   * means grouping is kept, because a grouped amount is what every currency
   * convention expects and an ordinal amount of money is not a thing.
   *
   * Money wins over {@link DisplayNumberFormatOptions.style}: a call that sets
   * both gets a currency rendering. Nothing in the repo does that, and the
   * combination has no meaning to express.
   */
  currency?: string;

  /**
   * The FIELD's declared `scale` — the `s` of a `decimal(p, s)` column — and
   * nothing else. This is a POLICY input, not a display width: pass it only
   * when a field declaration actually said so.
   *
   * `scale: 0` with no currency declares a discrete integer (a year, a fiscal
   * period, an ordinal), and those are not grouped. Leave `scale` undefined and
   * grouping is kept — which is correct for the two cases that look similar but
   * are not:
   *
   *   - an UNDECLARED scale (`scale` is optional in the spec, so absent means
   *     "decimals unknown", not "integer"); and
   *   - a caller whose zero-decimal display comes from something other than a
   *     field declaration — e.g. the dashboard `MetricWidget`, whose decimals
   *     come from a numeral.js format pattern and whose large KPI aggregates
   *     are *documented* to want separators ("`1,930,000` not `1930000`").
   *
   * ⚠️ INTERIM DEFAULT (objectui#4033, PM ruling 2026-08-11). Suppressing
   * grouping for every scale-0 number is a transitional policy with a known,
   * accepted cost: a large scale-0 COUNT loses its separators too. The
   * authorable hint it was waiting for has landed as
   * {@link DisplayNumberFormatOptions.useGrouping} (objectui#11026): an
   * authored boolean OVERRIDES this default, and the heuristic is now only the
   * fallback for a field that declares nothing.
   */
  scale?: number;

  /**
   * The FIELD's authored `useGrouping` — `FieldSchema.useGrouping` in
   * `@objectstack/spec`, the author's digit-grouping hint — and nothing else.
   * Like `scale` it is a POLICY input: pass it only when a field declaration
   * actually said so (objectui#11026).
   *
   * Three-valued, and the spec's own reading of each value is the one this
   * option implements:
   *
   *   - `undefined` — the author made no judgement, so the renderer decides:
   *     the `scale`/`currency` heuristic in {@link shouldGroupDisplayNumber},
   *     unchanged.
   *   - `false` — the author's explicit opt-out (a year, an ID, a zip code).
   *     Never grouped, whatever `scale` or `currency` would have suggested.
   *   - `true` — the author pins grouping ON, overriding the heuristic the
   *     other way (a scale-0 count that should read `2,026`).
   *
   * The spec maps the key 1:1 onto `Intl.NumberFormat`'s `useGrouping`, so an
   * authored `true` reaches `Intl` as `true`, which means "always". That is
   * deliberately NOT what the heuristic's own "group" answer does: it omits
   * the key and keeps the locale's "auto" (see the `Intl` note inside
   * {@link formatDisplayNumber}). The two differ where a locale leaves a
   * four-digit number alone under "auto" (es-ES and pl-PL render `1234`); an
   * author who pinned grouping on gets `1.234` / `1 234` there, because that
   * is what they declared.
   */
  useGrouping?: boolean;

  /**
   * How the number relates to a percentage — the ONE place that distinction is
   * expressed, because getting it wrong is the whole of objectui#4576.
   *
   *  - `'decimal'` (default) — a plain number, no percent sign.
   *  - `'percent'` — the value is a FRACTION. `Intl` multiplies it by 100 and
   *    appends the locale's percent convention, so `0.8` renders as `80%`.
   *  - `'percentPoints'` — the value is ALREADY in percentage points, so `80`
   *    renders as `80%`. Same locale convention, NO re-scaling.
   *
   * The third one exists because "divide by 100 so `Intl` can multiply it back"
   * is not free, and the round trip is lossy at rounding TIES: measured on this
   * repo's runner, `80.175` percentage points formatted to 2 decimals renders
   * `80.18%` when formatted directly and `80.17%` after the divide-and-remultiply
   * — 27,581 of 1,200,013 ordinary-magnitude en-US forms move, plus every
   * value at the top of the double range (`MAX_SAFE_INTEGER`, `1e23`). That
   * count is objectui#4576's tie-dense grid — 0.005 steps to 2,000, precisions
   * 0/1/2 — measured on `formatDisplayNumber` / `formatMeasure`'s call shape.
   * objectui#4590 re-measured the same route through `formatPercent` and
   * reports 27,577 of 1,200,003: a different form set, not a correction of this
   * one. A caller holding percentage points must therefore NOT reach for
   * `'percent'`; that is exactly the trap this option removes.
   *
   * `'percentPoints'` is implemented with `Intl`'s `style: 'unit'` /
   * `unit: 'percent'`, which was measured to produce a BYTE-IDENTICAL percent
   * affix to `style: 'percent'` across all 171 locale tags tested — including
   * the German/French/Russian no-break space before the sign, Turkish's PREFIX
   * position (`%1.234,5`), Arabic's own percent sign plus U+061C, and the
   * Bengali/Marathi percent patterns that group Western-style where their
   * decimal patterns group by lakh. It is the same CONVENTION by a route that
   * does not touch the value.
   */
  style?: 'decimal' | 'percent' | 'percentPoints';
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  notation?: 'standard' | 'compact';
}

/**
 * The grouping policy, alone and testable: does this number get thousands
 * separators?
 *
 * This is the ONE place the decision is made. An authored `useGrouping`
 * answers it outright; only when the field declared nothing does the
 * `scale`/`currency` heuristic below get a say (objectui#11026).
 *
 * @param scale       the field's declared `scale`, or `undefined` when the
 *                    caller has no field declaration behind it
 * @param currency    ISO 4217 code when the number is money
 * @param useGrouping the field's authored `useGrouping`, or `undefined` when
 *                    the author declared none
 */
export function shouldGroupDisplayNumber(
  scale?: number,
  currency?: string,
  useGrouping?: boolean,
): boolean {
  // The author's explicit declaration beats every guess below, money included:
  // the spec reads `false` as "never grouped, regardless of what the
  // renderer's heuristic would have guessed", and `true` as the same override
  // in the other direction.
  if (typeof useGrouping === 'boolean') return useGrouping;
  // Money always groups — including money whose currency code could not be
  // resolved, which still renders as an amount (just without a symbol).
  if (currency) return true;
  // Only an explicitly declared scale of 0 is an ordinal. `undefined !== 0`.
  return scale !== 0;
}

/**
 * Format a number for DISPLAY, in the active locale, under the grouping policy
 * above.
 *
 * Throws for a bad `currency` code exactly as `Intl.NumberFormat` does, so the
 * fallbacks call sites already had (`${currency} ${value.toFixed(n)}`) keep
 * working unchanged. A bad LOCALE is handled here instead of throwing: `locale`
 * arrives from a server response (ADR-0053 `localization.locale`), and a
 * malformed tag from a tenant config must never take a grid cell down.
 */
export function formatDisplayNumber(
  value: number,
  options: DisplayNumberFormatOptions = {},
): string {
  const { locale, currency, scale, useGrouping, style, ...passthrough } = options;

  const intlOptions: Intl.NumberFormatOptions = { ...passthrough };
  if (style === 'percentPoints') {
    // The locale's percent convention WITHOUT `style: 'percent'`'s ×100 — see
    // the option's doc above for the measurement that separates the two.
    intlOptions.style = 'unit';
    intlOptions.unit = 'percent';
    intlOptions.unitDisplay = 'narrow';
  } else if (style) {
    intlOptions.style = style;
  }
  if (currency) {
    intlOptions.style = 'currency';
    intlOptions.currency = currency;
    delete intlOptions.unit;
    delete intlOptions.unitDisplay;
  }

  // ⚠️ Never write `useGrouping: true` on the renderer's own behalf.
  // `useGrouping: true` is NOT the same as omitting the key: `true` means
  // "always", while omitting it means "auto" (and "min2" under compact
  // notation), which is the locale's own preference. Measured — for 1234:
  // es-ES "auto" → `1234` but "always" → `1.234`; pl-PL "auto" → `1234` but
  // "always" → `1 234`. Writing `true` for a field that declared nothing would
  // silently override those locales' conventions in the name of preserving
  // en-US output.
  //
  // The ONE `true` this function writes is the author's own (objectui#11026):
  // `FieldSchema.useGrouping` maps 1:1 onto this `Intl` option, and an author
  // who pinned grouping on asked for "always". The decision itself is made
  // once, above, by `shouldGroupDisplayNumber`; this only spells it for `Intl`.
  if (!shouldGroupDisplayNumber(scale, currency, useGrouping)) {
    intlOptions.useGrouping = false;
  } else if (useGrouping === true) {
    intlOptions.useGrouping = true;
  }

  try {
    return new Intl.NumberFormat(locale, intlOptions).format(value);
  } catch {
    // Retry WITHOUT the locale, keeping every other option: this rescues a
    // malformed tag while still surfacing a genuinely bad `currency` to the
    // caller's own catch.
    return new Intl.NumberFormat(undefined, intlOptions).format(value);
  }
}
