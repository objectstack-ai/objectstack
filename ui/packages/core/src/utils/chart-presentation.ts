/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * chart-presentation — the AUTHORED half of a dataset-bound chart, lowered onto
 * the bindings {@link buildChartSeries} derived from the dataset selection.
 *
 * `chart-series.ts` beside this file owns the DATA half: which columns become
 * series, which rows, which buckets. This file owns everything the author gets
 * to say about how that data LOOKS — the ruled data/presentation split of
 * objectui#4229, stated once:
 *
 *  - **Data (derived, never forwarded)** — series MEMBERSHIP and the column each
 *    binding reads. Concretely `buildChartSeries`' `dataKey`s, `xAxisKey`, and
 *    the spec's two binding keys `ChartSeries.name` and `ChartAxis.field`.
 *  - **Presentation (authored, merged forward)** — everything else on those same
 *    objects: `series[].type` (the per-series mark), `series[].yAxis` (which
 *    axis it binds to), `label`/`color`/`stack`/`variant`/`dashArray`/`opacity`,
 *    the axis definitions' `title`/`format`/`min`/`max`/`stepSize`/
 *    `showGridLines`/`position`/`logarithmic`, and the chart chrome
 *    (`showLegend`, `showDataLabels`, `colors`, `annotations`, …).
 *
 * ⚠️ Which of those a surface may AUTHOR is its carrier's answer, not this
 * file's. Since `@objectstack/spec` 17.5.0 a dashboard widget's `chartConfig`
 * is `DashboardWidgetChartConfigSchema`, which refuses `type`, `xAxis`,
 * `yAxis` and `series` at parse (ADR-0021 · ADR-0049 D2): on that carrier the
 * dataset owns the structure and the author keeps the CHROME only. A report's
 * chart keeps its `series`, and the react `ObjectChart` tier keeps all four.
 *
 * ## Why it lives in `@object-ui/core` rather than in one plugin
 *
 * It was written for `plugin-dashboard`'s `DatasetWidget` (#3135 → objectstack#7016
 * → #4229) and lifted here by objectui#4877, when `plugin-report`'s embedded
 * report chart turned out to need the SAME merge over the same spec shapes: the
 * report was forwarding six keys and dropping every authored chrome key the
 * schema declares, and re-deriving this beside the dashboard's copy is exactly
 * the duplication objectui#4389 filed as a defect (two longhand copies of the
 * analytics label net, one per plugin, drifting apart).
 *
 * Everything here is a pure data transform over plain records, so it sits below
 * both plugins with no React and no i18n — the same layering `chart-series.ts`
 * already has (see {@link OptionLabelTranslator} there for why an i18n-resolved
 * string always arrives as an ARGUMENT rather than being read here).
 *
 * ## No axis is lowered here
 *
 * This module lowers series presentation ({@link mergeAuthoredSeries}) and the
 * chart chrome ({@link chartConfigPresentation}), and no axis. A report's
 * `chart.xAxis` / `chart.yAxis` are bare dimension/measure NAME strings — pure
 * DATA (they ARE the selection) with no presentation to lower — and the react
 * `ObjectChart` tier hands its own `ChartAxis` objects to `normalizeChartSchema`
 * in `@object-ui/plugin-charts`, which reads them off the chart schema
 * directly. The object-axis lowering that lived here served only the dashboard
 * widget's `chartConfig`, which carries no axes since spec 17.5.0
 * (objectui#11315); with no caller left it was removed (objectui#11372).
 */

import type { I18nLabel } from '@objectstack/spec/ui';

import type { ChartSeriesBinding } from './chart-series.js';

/** Authored spec `ChartSeries` presentation, in the renderer's internal spelling. */
export interface AuthoredSeriesPresentation {
  label?: string;
  /** Spec `ChartSeries.type`, narrowed — see {@link seriesPresentation}. */
  chartType?: 'bar' | 'line' | 'area';
  yAxis?: 'left' | 'right';
  color?: string;
  stack?: string;
  variant?: 'primary' | 'comparison';
  dashArray?: string;
  opacity?: number;
}

/** A derived series binding with the author's presentation merged onto it. */
export type MergedChartSeries = ChartSeriesBinding & AuthoredSeriesPresentation;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An i18n label is a plain string or a `{ en, zh-CN, … }` record; charts render
 * a string.
 *
 * ⚠️ Its one caller is {@link seriesPresentation}'s `label`. An axis `title`
 * read this too until `061f5e829` moved it off the pick, and the axis lowering
 * itself is gone since objectui#11372 (file header).
 *
 * **First-string-wins, deliberately, and deliberately NOT locale-aware** — this
 * package is React-free and holds no i18n provider, so it cannot know which
 * limb a console wants. A caller that CAN resolve the language (the report
 * renderer, via `pickLocalized`) resolves the label itself and overrides the
 * merged one; see objectui#4020, whose whole point is that picking the first
 * limb paints English on a zh console.
 */
function labelText(v: unknown): string | undefined {
  if (typeof v === 'string' && v) return v;
  if (isRecord(v)) {
    const first = Object.values(v).find((x) => typeof x === 'string' && x);
    return first as string | undefined;
  }
  return undefined;
}

/**
 * An authored `I18nLabel` that travels to the renderer **unresolved** — the
 * chart's own `title` / `subtitle` / `description` (objectui#9038).
 *
 * ## Why this does not resolve, and why that is not {@link labelText}'s answer
 *
 * These three keys are lowered onto a chart SCHEMA slot that already declares
 * the union: `normalizeChartSchema` (`@object-ui/plugin-charts`) resolves
 * `title`/`subtitle`/`description` through `pickLocalized` with the viewer's
 * language, which `ChartRenderer` reads from `useObjectTranslation` and hands
 * down (objectui#8943), and `ObjectChart` reads `schema.title` through the same
 * resolver for its drill heading. So the value's one resolution point is
 * already downstream of here, holding the one thing this package does not have
 * — the viewer. Forwarding is what lets that resolver see the value at all.
 *
 * Resolving here is not merely unnecessary, it is unavailable: `pickLocalized`
 * lives in `@object-ui/i18n`, which DEPENDS on this package. Declaring the
 * reverse edge makes the build graph cyclic (measured: `turbo run build
 * --filter=@object-ui/core` refuses with `Cyclic dependency detected`), and
 * that package's entry point is a React provider plus hooks — the layering
 * this file's header states, arrived at from the other side.
 *
 * ⛔ Do NOT "fix" this by reusing {@link labelText}. The two answer different
 * questions and only one of them is a choice:
 *
 *  - `labelText` is a locale-unaware PICK for a slot whose consumer takes a
 *    plain string. It is wrong for a zh console and is ledgered as such
 *    (objectui#4020) because a caller that CAN resolve the language overrides
 *    the merged label — the mitigation depends on the value still existing.
 *  - The guard this replaced (`typeof v === 'string' && v ? v : undefined`)
 *    offered no such route: it ERASED the map arm, the `if (title)` guard then
 *    skipped the assignment, and the chart drew **no heading at all**, in every
 *    language, with no diagnostic. Nothing downstream could override a key that
 *    never arrived.
 *
 * ## The admission test, and what it deliberately does not decide
 *
 * A plain string, or a record carrying at least one usable string entry. That
 * is the same "is there anything here" question the `if (title)` truthiness
 * guard always asked, extended to the map arm — it does NOT decide which limb
 * wins, which stays `pickLocalized`'s alone. Everything else (a number, a
 * boolean, an array, `''`, `{}`, a record with no string value) is refused
 * exactly as before, so no key reaches the caller that cannot render, and the
 * `@returns` contract below — only keys that resolved — still holds.
 *
 * The map is forwarded VERBATIM: `InlineLocaleMapSchema` is
 * `z.record(<tag>, z.string())` and enforcing that belongs at the parse, not in
 * a renderer-side coercion (AGENTS.md #0.1). A non-string entry falls through
 * `pickLocalized`'s limbs exactly as an absent one does, which is why admitting
 * the record on the strength of one usable entry cannot paint `[object
 * Object]`.
 */
function forwardedI18nLabel(v: unknown): I18nLabel | undefined {
  if (typeof v === 'string') return v || undefined;
  if (isRecord(v) && Object.values(v).some((x) => typeof x === 'string' && x)) {
    return v as I18nLabel;
  }
  return undefined;
}

/**
 * One authored `ChartSeries`, minus its `name` — i.e. everything about it that
 * is presentation rather than membership.
 *
 * `type` is narrowed to the three families that COMPOSE on one cartesian plot.
 * Without the narrowing a `type: 'pie'` would not merely be inert — it would
 * count as a family disagreement in `effectiveChartFamily`, flip the whole
 * chart into a combo, and then draw that series as a bar anyway.
 *
 * `ChartRenderer` now narrows the same way for every series it receives,
 * `dataKey`-shaped or not (`01c27c431` fixed the fast path that used to
 * forward a `dataKey`-shaped array straight through, so `normalizeChartSchema`'s
 * own identical narrowing never saw it) — so this module is no longer that
 * narrowing's only line of defense. It stays anyway:
 * `AuthoredSeriesPresentation.chartType` is a typed, narrower field
 * (`'bar' | 'line' | 'area'`) this module's own callers read directly, and the
 * double narrowing downstream is idempotent.
 */
export function seriesPresentation(raw: Record<string, unknown>): AuthoredSeriesPresentation {
  const out: AuthoredSeriesPresentation = {};
  const family = raw.type;
  if (family === 'bar' || family === 'line' || family === 'area') out.chartType = family;
  if (raw.yAxis === 'left' || raw.yAxis === 'right') out.yAxis = raw.yAxis;
  const label = labelText(raw.label);
  if (label) out.label = label;
  if (typeof raw.color === 'string' && raw.color) out.color = raw.color;
  if (typeof raw.stack === 'string' && raw.stack) out.stack = raw.stack;
  if (raw.variant === 'primary' || raw.variant === 'comparison') out.variant = raw.variant;
  if (typeof raw.dashArray === 'string' && raw.dashArray) out.dashArray = raw.dashArray;
  if (typeof raw.opacity === 'number' && Number.isFinite(raw.opacity)) out.opacity = raw.opacity;
  return out;
}

/**
 * Merge an authored `series[]` array's PRESENTATION onto the bindings the
 * dataset selection derived — the series half of #4229's split, and the only
 * half this module lowers (see the file header).
 *
 * The match rule is **by name/key**: an authored `series[].name` is paired with
 * the derived binding whose `dataKey` it equals, and the pairing decides
 * nothing but presentation:
 *
 *  - an authored entry naming a measure that is NOT in the dataset selection is
 *    **ignored** — membership belongs to the dataset, so an author cannot add,
 *    remove or re-point a series from the chart config;
 *  - a derived series with no authored entry keeps the family default, so every
 *    surface that never wrote `series` renders byte-for-byte as before;
 *  - where both exist the **explicit binding wins** (#2880 S2), which is the
 *    whole point: `type: 'line'` + `yAxis: 'right'` is how the spec says "this
 *    measure is a line on the secondary axis".
 *
 * Matching on `name` only is deliberate: `name` is the spec's authorable key
 * for a series (`dataKey` is a declared ALIAS of it, resolved where the
 * metadata is parsed), so reading a second spelling here would fossilize a
 * dialect this renderer has no business accepting (AGENTS.md #0.1).
 *
 * The FIRST entry naming a measure wins; a later duplicate cannot silently
 * reconfigure a series the author already described.
 *
 * @param derived the bindings {@link buildChartSeries} produced from the selection
 * @param authoredSeries the authored `series` array (anything, incl. absent)
 */
export function mergeAuthoredSeries(
  derived: ChartSeriesBinding[],
  authoredSeries: unknown,
): MergedChartSeries[] {
  const authored = new Map<string, Record<string, unknown>>();
  for (const entry of Array.isArray(authoredSeries) ? authoredSeries : []) {
    if (!isRecord(entry)) continue;
    const name = typeof entry.name === 'string' ? entry.name : undefined;
    if (name && !authored.has(name)) authored.set(name, entry);
  }
  return derived.map((s) => {
    const entry = authored.get(s.dataKey);
    return entry ? { ...s, ...seriesPresentation(entry) } : s;
  });
}

/**
 * Lower an authored chart config's CHROME (spec
 * `DashboardWidgetChartConfigSchema` / `ReportChartSchema`, both extensions of
 * `ChartConfigSchema` that keep its chrome keys unchanged) onto the chart
 * schema a dataset-bound surface hands the renderer.
 *
 * ## Why this is a whitelist and not a spread
 *
 * Until #3135 NONE of a dashboard widget's `chartConfig` reached the renderer:
 * the widget read `options` and nothing else, so an author who wrote
 * `showLegend: false` still got a legend and one who wrote `true` only got one
 * because "on" is the renderer's default. #3135 lowered that single flag and
 * left the rest declared and inert. objectstack#7016 lowered the rest of the
 * keys that are actually DELIVERED, admitting a key only when both of these
 * hold:
 *
 *  1. **The chart block draws it end to end.** `{ type: 'chart' }` resolves to
 *     `ChartRenderer` → `AdvancedChartImpl`, which draws `title`/`subtitle` in
 *     its ChartFrame, turns `description` into the chart container's
 *     `role="img"` + `aria-label`, applies `height` as that container's inline
 *     height, reads `colors` as the positional palette, prints
 *     `showDataLabels` as a Recharts `LabelList`, draws `annotations` as
 *     ReferenceLine/ReferenceArea and honours `interaction` as the tooltip
 *     toggle plus `Brush`. Forwarding a key the renderer ignores would only
 *     move declared-but-not-delivered one layer down, which is the failure this
 *     exists to remove.
 *  2. **It does not fight the dataset derivation.** `type` stays out: the
 *     calling surface's own type already picks the chart family, which is the
 *     dataset path's chart-family channel. The spec agrees on the dashboard
 *     carrier: since 17.5.0 `DashboardWidgetChartConfigSchema` refuses
 *     `chartConfig.type` at parse, with `xAxis` / `yAxis` / `series`, none of
 *     which this whitelist ever lowered (objectui#11315).
 *
 * `aria` is not lowered either. No renderer reads it: `AdvancedChartImpl` has
 * no `aria` prop, and `SchemaRenderer`'s ARIA injection reads the FLAT
 * `ariaLabel`/`ariaDescribedBy`/`role`, never a nested `aria` object (criterion
 * 1). And it is no longer declared: spec 17.5.0 retired `ChartConfig.aria` as
 * a `retiredKey` tombstone (objectstack#17751, objectui#4044), so an authored
 * one is refused at parse. The accessible name a chart applies is
 * `description`, above.
 *
 * `title` IS emitted here. A caller that paints the title itself (the report
 * renderer's own `h3` above the chart) must drop it from the result, or the
 * chart draws a second one.
 *
 * ## `title` / `subtitle` / `description` are `I18nLabel`, and travel as such
 *
 * `ChartConfigSchema` types all three as the spec's `I18nLabel` union — a plain
 * string OR an inline locale map — so all three are lowered by
 * {@link forwardedI18nLabel}, which hands the authored value on untouched for
 * the renderer to resolve against the viewer's language. Read that helper for
 * why resolving cannot happen in this package.
 *
 * ⚠️ LEDGERED, by name, as still unresolved after objectui#9038 — not in
 * that card's scope and not reached by the change above:
 *
 *  - **A series `label`** still goes through {@link labelText}'s
 *    first-string-wins pick, the design objectui#4020 ledgered and a caller
 *    can override. Not reopened here.
 *
 * ✓ CLEARED, objectui#9150 — **the report renderer's own heading.**
 * `DatasetReportChart` (`@object-ui/plugin-report`) still drops `title` from
 * this result and still paints its own `h3`, but that read site no longer
 * narrows `chart.title` to a plain string: it resolves the union through
 * `pickLocalized` against the viewer's language, like every other `I18nLabel`
 * on that surface. Kept here rather than deleted because the ledger entry is
 * what the fixing card was dispatched from, and because the FIRST half of it —
 * that a caller painting the title itself must drop `title` from this result —
 * is a live constraint on this whitelist, stated above.
 *
 * @param raw the authored chart config (anything, incl. absent)
 * @param fieldCategoryColors per-category colours resolved from the category
 *   dimension's own select/lookup option colours, merged UNDER an explicit
 *   author map (see the `colors` note below)
 * @returns only the keys that resolved, so the caller can spread it over the
 *   derived chart schema and every undeclared key keeps the renderer's default
 */
export function chartConfigPresentation(
  raw: unknown,
  fieldCategoryColors?: Record<string, string> | null,
): Record<string, unknown> {
  const config: Record<string, unknown> = isRecord(raw) ? raw : {};
  const out: Record<string, unknown> = {};

  if (typeof config.showLegend === 'boolean') out.showLegend = config.showLegend;
  if (typeof config.showDataLabels === 'boolean') out.showDataLabels = config.showDataLabels;
  // The three `I18nLabel` slots, carried through unresolved — see
  // {@link forwardedI18nLabel} for why this package forwards rather than picks,
  // and for what is still ledgered as unresolved on purpose.
  const title = forwardedI18nLabel(config.title);
  if (title) out.title = title;
  const subtitle = forwardedI18nLabel(config.subtitle);
  if (subtitle) out.subtitle = subtitle;
  const description = forwardedI18nLabel(config.description);
  if (description) out.description = description;
  // A non-positive height would collapse the plot; the container default is the
  // more honest answer than an invisible chart.
  if (typeof config.height === 'number' && Number.isFinite(config.height) && config.height > 0) {
    out.height = config.height;
  }
  if (Array.isArray(config.annotations) && config.annotations.length > 0) out.annotations = config.annotations;
  if (config.interaction && typeof config.interaction === 'object' && !Array.isArray(config.interaction)) {
    out.interaction = config.interaction;
  }

  // `colors` is overloaded kanban-style — and the two arms reach the renderer
  // through two DIFFERENT props, so the split has to happen here (the react
  // tier's ObjectChart splits it the same way): a `string[]` is the positional
  // palette (`colors`), a `{ value: color }` record is an explicit per-category
  // map (`categoryColors`). The author's map is merged OVER the dimension
  // field's own option colours, which is the precedence the spec field comment
  // states ("a value→color map — and a select/lookup dimension's option colors
  // — take precedence over the positional palette per category").
  const palette = Array.isArray(config.colors)
    ? config.colors.filter((c): c is string => typeof c === 'string' && !!c)
    : undefined;
  if (palette?.length) out.colors = palette;
  const authorCategoryColors =
    config.colors && typeof config.colors === 'object' && !Array.isArray(config.colors)
      ? (config.colors as Record<string, string>)
      : undefined;
  if (fieldCategoryColors || authorCategoryColors) {
    out.categoryColors = { ...(fieldCategoryColors ?? {}), ...(authorCategoryColors ?? {}) };
  }

  return out;
}

/** The families {@link chartTypeIgnoresCompareTo} answers `true` for. */
const CHART_TYPES_IGNORING_COMPARE_TO: ReadonlySet<string> = new Set(['pie', 'donut', 'funnel', 'scatter']);

/**
 * Whether a chart of this family IGNORES `compareTo` — the one declaration of
 * that rule (objectui#7495).
 *
 * Every surface that turns a `compareTo` into a comparison reads this; none
 * keeps a list of its own. The inline chart path (`@object-ui/plugin-charts`'
 * ObjectChart) skips the comparison fetch and synthesises no overlay series for
 * these families, and the dataset widget path (`@object-ui/plugin-dashboard`'s
 * DatasetWidget) forwards no `compareTo` to the executor for a chart of one of
 * them, so the comparison pass never runs and no overlay series is appended.
 *
 *  - `pie` / `donut` / `funnel` — single-distribution charts: a comparison
 *    overlay has no meaning on them, and the renderer's pie and funnel arms
 *    draw only `series[0]`.
 *  - `scatter` (objectui#7402) — a scatter binds ONE measure: the renderer reads
 *    y through the single `YAxis dataKey={series[0].dataKey}`, so an overlay was
 *    painted on the PRIMARY's y and "previous period" landed exactly on top of
 *    "current". Drawing it honestly needs the multi-measure projection declined
 *    as option A of objectui#7194; `compareTo` on a scatter returns WITH that
 *    projection.
 *
 * It reads the RENDERER's chart family (`bar`, `pie`, `scatter`, …), not a
 * dashboard widget type: a caller whose widget types alias a family (the
 * dashboard maps `bubble` to `scatter` and `pyramid` to `funnel`) maps first and
 * asks about the family. An absent or unrecognised family does NOT ignore
 * `compareTo` — the comparison runs.
 *
 * Why it lives here: the dashboard reaches `@object-ui/plugin-charts` only as a
 * devDependency, so this package — a runtime dependency of both — is the one
 * place both paths can read. Two copies were how the lists drifted apart: the
 * dashboard's said "scatter only" while the charts package said all four, so a
 * compare-to pie widget ran a comparison query whose overlay the renderer then
 * dropped (objectui#7495; objectui#4389 is the precedent that a second copy of
 * chart-presentation logic is a defect).
 *
 * @param chartType the chart family, or `undefined` when none is declared
 * @returns `true` for `pie`, `donut`, `funnel` and `scatter`; `false` otherwise
 */
export function chartTypeIgnoresCompareTo(chartType: string | undefined): boolean {
  return typeof chartType === 'string' && CHART_TYPES_IGNORING_COMPARE_TO.has(chartType);
}
