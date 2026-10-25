/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { pickLocalized } from '@object-ui/i18n';
import { isIntegerAggregate } from '@object-ui/core';
import type { ObjectChartSchema } from '@object-ui/types';

/**
 * The ONE place the spec's author-facing chart shape is translated into the
 * renderer's internal pipeline contract (framework#3729 / objectui#2880).
 *
 * ## Why this exists
 *
 * `ChartConfigSchema` (`@objectstack/spec/ui`) is the chart protocol — axes are
 * `{ field, format, min, max, logarithmic, … }` objects and series are
 * `{ name, stack, yAxis, … }`. The renderer, however, grew a Recharts-flavoured
 * internal shape: `chartType`, `xAxisKey` (a bare string) and
 * `series[].dataKey`. Everything an author wrote in the SPEC shape reached the
 * renderer and was silently dropped — precisely what ADR-0078 forbids.
 *
 * This module closes that gap by NORMALIZING at the boundary, rather than by
 * sprinkling `??` fallbacks through the render tree. That distinction matters
 * (framework PD #12): a lone normalization layer is a translation from one
 * declared contract to another, whereas scattered fallbacks fossilize a second
 * de-facto dialect at every read site.
 *
 * **Internal props win.** `DashboardRenderer`, `ObjectView` and the dataset
 * path already speak the internal shape; passing `xAxisKey`/`series[].dataKey`
 * explicitly keeps working byte-for-byte, so there is no migration.
 *
 * ## The `type` collision
 *
 * `ChartConfig.type` is the chart family (`'bar' | 'line' | …`). But on every
 * surface that FLATTENS chart config into a component props bag — the react
 * tier's injected blocks especially — `type` is already taken: it is the SDUI
 * envelope's component discriminator (`{ type: 'object-chart', … }`). An author
 * writing `type="bar"` would replace the discriminator and the block would not
 * resolve at all.
 *
 * The collision is created by the flattening, so it is resolved there: the
 * react-page wrapper preserves an author-supplied `type` under `specType`
 * before stamping the discriminator (see `react-page.tsx`). This module reads
 * it back. Surfaces where chart config is properly NESTED (a dashboard
 * widget's `chartConfig`) never collide and pass `type` through untouched.
 */

/**
 * A chart family this renderer actually draws.
 *
 * Every member is a `@objectstack/spec` `ChartTypeSchema` value except
 * **`combo`**, which is renderer-local and is NOT a spec chart type (#2945).
 * The spec models a combo chart per-series instead — `ChartSeries.type`, whose
 * field comment reads *"Series type override (combo charts)"* — exactly as it
 * models stacking with `ChartSeries.stack` rather than a `stacked-bar` family:
 *
 * > stacking is not a chart family, it is a property of the series … One `bar`
 * > family plus a series-level stack group expresses all three without
 * > multiplying the taxonomy.  — `spec/src/ui/chart.zod.ts`
 *
 * So `combo` is not a name an author should have to reach for. It is what "the
 * series disagree about their family" looks like from the renderer's side, and
 * {@link effectiveChartFamily} derives it. It stays in the union because
 * internal-shape callers pass it explicitly today (`DatasetPreview`) and
 * because dropping a name that is already authored breaks those charts.
 */
export type ChartFamily =
  | 'bar' | 'column' | 'horizontal-bar'
  | 'line' | 'area'
  | 'pie' | 'donut' | 'funnel'
  | 'radar' | 'scatter'
  | 'treemap' | 'sankey'
  | 'combo';

/**
 * Every chart family a schema can name on this renderer's family channels, as
 * the faces DECLARE them (objectui#11520): the union of `object-chart`'s two
 * family keys, read off `ObjectChartSchema` by reference and ⛔ never restated.
 *
 * - `specType` is the spec's whole `ChartType` (the react tier's family; a bare
 *   `chart` node's `chartType` declares the same domain).
 * - `chartType` is the node's own union, the families this block draws
 *   (objectui#11513). It sits inside the spec's today, and is named anyway so
 *   the type says which two channels it covers.
 *
 * Wider than {@link ChartFamily} on purpose: it includes the single-value and
 * tabular families, which `AdvancedChartImpl`'s dispatch routes to the number
 * card and the tabular notice. Narrower than `string` on purpose: a misspelled
 * family is a compile error, not a runtime notice.
 */
export type DeclaredChartFamily = NonNullable<ObjectChartSchema['chartType'] | ObjectChartSchema['specType']>;

export const RENDERABLE = new Set<string>([
  'bar', 'column', 'horizontal-bar',
  'line', 'area',
  'pie', 'donut', 'funnel',
  'radar', 'scatter',
  'treemap', 'sankey',
  'combo',
]);

/**
 * Every value the spec's `ChartTypeSchema` admits — a superset of
 * {@link RENDERABLE}, because single-value families (`metric`, `kpi`, `gauge`,
 * …) and tabular ones render through other components entirely.
 *
 * Recognition is broader than rendering on purpose: this set is what decides
 * whether a bare `type` is a chart family or the SDUI envelope's component
 * discriminator, and getting THAT wrong would break the block outright.
 */
/**
 * The spec's single-value chart families (`ChartTypeSchema`, whose own
 * comment calls gauge/solid-gauge/bullet "honest single-value variants
 * pending a real dial/target renderer"). The chart draws these as a number —
 * they used to fall through the cartesian component map's `|| BarChart` into
 * a bar SHELL whose series marks all returned null: grid, axes, tooltip and
 * legend rendered with no data marks, indistinguishable from an empty
 * dataset (#2942). Exported for the dispatch and the spec-parity test.
 */
export const SINGLE_VALUE_CHART_TYPES: ReadonlySet<string> = new Set([
  'gauge', 'solid-gauge', 'metric', 'kpi', 'bullet',
]);

/**
 * The spec's tabular chart families — a table is not a series chart; these
 * render through the data-table / pivot components, and the chart block says
 * so instead of drawing the same silent empty plot (#2942).
 */
export const TABULAR_CHART_TYPES: ReadonlySet<string> = new Set(['table', 'pivot']);

const CHART_TYPES = new Set<string>([
  ...RENDERABLE,
  ...SINGLE_VALUE_CHART_TYPES,
  ...TABULAR_CHART_TYPES,
]);

/**
 * The component keywords this package registers for ONE named chart family,
 * mapped to the family each keyword names (objectui#7401).
 *
 * ## Why these are not just more members of {@link CHART_TYPES}
 *
 * `CHART_TYPES` answers "is this bare `type` a chart FAMILY" — `'pie'`,
 * `'scatter'`, the spec's own vocabulary. These are something else: they are
 * SDUI component discriminators, the keys `index.tsx` hands
 * `ComponentRegistry.register`. `type: 'chart:bar'` does not name a family in
 * any spec; it names a registration whose whole purpose is to draw one.
 *
 * Since objectui#10859 batch 8 the table holds that one row: the
 * `pie-chart`, `donut-chart`, `radar-chart` (phase 2c) and `scatter-chart`
 * (phase 2b) keys were retired with their rows, and those families are reached
 * as `{ type: 'chart', chartType: … }`. The history below is why the table
 * exists at all.
 *
 * ## Why the derivation exists at all (objectui#7401)
 *
 * Each of these registrations declared its family as
 * `defaultProps: { chartType: … }` — and **nothing on the SDUI path has ever
 * read a registration's `defaultProps`**. `SchemaRenderer` does not; the one
 * consumer in the tree, `WidgetRegistry.ts`, WRITES manifest defaults INTO the
 * registry rather than reading them back out. So `pie-chart`, `donut-chart`,
 * `radar-chart` and `scatter-chart` all arrived here with no family at all and
 * fell to `AdvancedChartImpl`'s `'bar'` default: valid data, a confidently
 * wrong picture, and no refusal that could fire. Ruled route C (director seat,
 * 2026-09-06, on maintainer authorisation): derive the family from the
 * schema's own `type`, and the inert `defaultProps` go with it — a second
 * declaration nothing reads is the `AGENTS.md` #0.1 hazard, and leaving it
 * beside a derivation that works would fossilize exactly the wrong convention.
 *
 * ## Why a table and not a `-chart` suffix rule
 *
 * A suffix rule accepts the whole cross product of {@link RENDERABLE} — it
 * would answer `'funnel'` for `type: 'funnel-chart'`, a keyword this package
 * does not register and the SDUI path therefore never resolves. That answer is
 * unreachable today and would silently become load-bearing the day someone
 * registers the keyword with a different family in mind. The table names
 * exactly the keywords that exist, and
 * `__tests__/chart-family-from-type-7401.test.tsx` pins it against the live
 * registry in both directions, so adding a registration without a family entry
 * (or an entry without a registration) is what goes red.
 *
 * ⛔ `bar-chart` is deliberately ABSENT: it is registered to
 * `ChartBarRenderer`, a different component that never calls this function.
 * An entry for it would be inert in precisely the way this card removed.
 */
export const CHART_TYPE_KEYWORD_FAMILIES: ReadonlyMap<string, ChartFamily> = new Map<string, ChartFamily>([
  ['chart:bar', 'bar'],
  // ⛔ `pie-chart`, `donut-chart`, `radar-chart` (objectui#10859 batch 8,
  // phase 2c) and `scatter-chart` (phase 2b) are RETIRED: each registration
  // left `index.tsx` with its row, and objectui#7401's pin fails on a row with
  // no registration. Those families are drawn by
  // `{ type: 'chart', chartType: 'pie' | 'donut' | 'radar' | 'scatter' }`.
]);

/**
 * The namespace `index.tsx` registers every keyword above under. The SDUI path
 * reaches a registration by either spelling — bare (`chart:bar`) or namespaced
 * (`plugin-charts:chart:bar`; objectui#7401 measured the retired `pie-chart` /
 * `plugin-charts:pie-chart` pair) — and objectui#7401 measured BOTH drawing a bar,
 * so both are resolved here.
 */
const PLUGIN_CHARTS_NAMESPACE = 'plugin-charts:';

/**
 * The family a registered chart-type keyword names, or `undefined` for a
 * `type` that is not one of them.
 *
 * `undefined` is the honest answer for every other discriminator that reaches
 * a chart — `object-chart`, `chart`, a dashboard widget's own type — and the
 * caller's own default is a better answer than a guess.
 */
export function familyFromComponentType(rawType: string | undefined): ChartFamily | undefined {
  if (!rawType) return undefined;
  const bare = rawType.startsWith(PLUGIN_CHARTS_NAMESPACE)
    ? rawType.slice(PLUGIN_CHARTS_NAMESPACE.length)
    : rawType;
  return CHART_TYPE_KEYWORD_FAMILIES.get(bare);
}

export type AnyRec = Record<string, any>;

/** A y-axis (or the x-axis) after normalization — spec `ChartAxis`, resolved. */
export interface NormalizedAxis {
  /** Result column this axis reads (y-axis only; the x-axis field becomes `xAxisKey`). */
  field?: string;
  /** d3-style format string, e.g. `"$0,0.00"` / `"0.0%"`. */
  format?: string;
  min?: number;
  max?: number;
  /** Distance between ticks on this axis. */
  stepSize?: number;
  /** Default true, per the spec schema. */
  showGridLines?: boolean;
  logarithmic?: boolean;
  position?: 'left' | 'right' | 'top' | 'bottom';
  /** Axis title (already resolved to a plain string). */
  title?: string;
}

/** The families that compose on one cartesian plot — see {@link SeriesFamily}. */
export type SeriesFamily = 'bar' | 'line' | 'area';

export interface NormalizedSeries {
  dataKey: string;
  label?: string;
  /**
   * Per-series family override — spec `ChartSeries.type`.
   *
   * The spec types it as the full `ChartTypeSchema`, but only the cartesian
   * families compose on one plot (a `pie` series inside a bar chart names
   * nothing), so recognition stops at bar/line/area.
   */
  chartType?: SeriesFamily;
  variant?: 'current' | 'comparison' | 'primary';
  opacity?: number;
  dashArray?: string;
  /** Stack group id — series sharing one id stack together. */
  stack?: string;
  /** Which y-axis this series binds to (dual-axis charts). */
  yAxis?: 'left' | 'right';
  color?: string;
  /**
   * The aggregate of the measure this series plots — renderer-internal, the
   * dataset answer's `fields[].aggregate` carried by `buildChartSeries`
   * (objectui#11681). It decides one thing: a value axis whose series all plot
   * a count draws whole-number ticks ({@link plotsWholeNumbers}). On the
   * authoring face it is refused by name (`ChartDataSeriesSchema.aggregate`),
   * so an author cannot claim integer ticks for a currency sum.
   */
  aggregate?: string;
}

/**
 * Whether a value axis plotting `series` should draw whole-number ticks only
 * (objectui#11681): true exactly when at least one series is bound to it and
 * EVERY one plots an integer aggregate (`count` / `count_distinct`). One sum,
 * average or undeclared series on the axis keeps recharts' default ticks, so a
 * sum over currency keeps its decimals.
 */
export function plotsWholeNumbers(series: readonly NormalizedSeries[]): boolean {
  return series.length > 0 && series.every((s) => isIntegerAggregate(s.aggregate));
}

export interface NormalizedChartSchema {
  /**
   * The chart family the schema names, as named: `chartType`, else `specType`,
   * else a bare `type` that is a spec family, else a registered keyword's family
   * (objectui#11520). It is NOT narrowed to the families this renderer draws:
   * `AdvancedChartImpl`'s family dispatch decides the form (a chart, the number
   * card, the tabular notice, or a notice naming the value), so a family this
   * module dropped could only ever reach that dispatch as no family at all.
   *
   * Typed as the vocabulary the faces DECLARE ({@link DeclaredChartFamily}),
   * not as `string`, so a misspelled family is a compile error for every
   * producer. A value outside it can still arrive in unvalidated JSON; see the
   * JSON-boundary cast in {@link normalizeChartSchema}.
   */
  chartType?: DeclaredChartFamily;
  xAxisKey?: string;
  series?: NormalizedSeries[];
  /** X-axis presentation config (its `field` is hoisted to `xAxisKey`). */
  xAxis?: NormalizedAxis;
  /**
   * Y-axes, in declaration order. Index 0 is the primary axis; the side each
   * entry is drawn on is {@link placeYAxes}'s answer, not its index.
   */
  yAxes?: NormalizedAxis[];
  showLegend?: boolean;
  showDataLabels?: boolean;
  title?: string;
  subtitle?: string;
  /** Accessibility description — announced to screen readers. */
  description?: string;
  /** Fixed plot height in pixels. */
  height?: number;
  annotations?: AnyRec[];
  interaction?: AnyRec;
}

const isRec = (v: unknown): v is AnyRec => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * An i18n label may be a plain string or a `{ en, zh-CN, … }` record. Charts
 * render a string; resolve the one the VIEWER's language asks for.
 *
 * ## Why `pickLocalized` and not a local pick (objectui#8943)
 *
 * The map arm used to return `Object.values(v).find(isString)` — **the first
 * string in key order**. That is not a resolution, it is a transcription of how
 * the author happened to type the object literal: a `zh` viewer got `定价` only
 * if `zh-CN` was written first, and reordering the JSON — no other change —
 * showed the same viewer English. Deterministic, silent, and wrong.
 *
 * `pickLocalized` (`@object-ui/i18n`) is this repository's ONE answer for the
 * spec's `I18nLabel` union: exact tag -> base language -> a region-qualified
 * sibling -> `default` -> `en` -> first value. It is pinned as the twin of the
 * backend's `resolveI18nLabel` (`@objectstack/spec`) in
 * `plugin-list/src/__tests__/i18nLabel-resolver-parity.test.ts`. The sibling
 * read site in this package — `ObjectChart`'s drill-drawer heading — already
 * routes through it, and this function is what put the CHART heading beside it
 * on a different answer for the same union on the same node.
 *
 * ⛔ Do not reintroduce a module-local pick here, and ⛔ do not "improve" this
 * by preferring `default`/`en` inline: a hand-rolled preference order is how
 * this class recurs, and a second answer disagrees with the published one on
 * the same value.
 *
 * ## The admission test is unchanged, deliberately
 *
 * Only what `I18nLabel` actually admits gets here — a plain string or an inline
 * locale map. `pickLocalized` alone would also stringify a number or a boolean
 * (`String(value)`), which would make this a wider authoring surface than the
 * contract declares; per AGENTS.md #0.1 that widening belongs in the spec if it
 * is wanted at all, not in a renderer-side coercion. So the guard below refuses
 * everything else exactly as before, and `pickLocalized` decides only WHICH
 * entry of an admitted value wins.
 *
 * `pickLocalized` spells a miss `''` (it feeds text nodes); every caller here
 * treats an empty label as absent, which is what `|| undefined` restores.
 */
function label(v: unknown, language: string | null | undefined): string | undefined {
  if (typeof v !== 'string' && !isRec(v)) return undefined;
  return pickLocalized(v, language) || undefined;
}

function normalizeAxis(raw: unknown, language: string | null | undefined): NormalizedAxis | undefined {
  if (!isRec(raw)) return undefined;
  const out: NormalizedAxis = {};
  const field = str(raw.field);
  if (field) out.field = field;
  const format = str(raw.format);
  if (format) out.format = format;
  const min = num(raw.min);
  if (min !== undefined) out.min = min;
  const max = num(raw.max);
  if (max !== undefined) out.max = max;
  const stepSize = num(raw.stepSize);
  if (stepSize !== undefined && stepSize > 0) out.stepSize = stepSize;
  if (typeof raw.showGridLines === 'boolean') out.showGridLines = raw.showGridLines;
  if (typeof raw.logarithmic === 'boolean') out.logarithmic = raw.logarithmic;
  const position = str(raw.position);
  if (position === 'left' || position === 'right' || position === 'top' || position === 'bottom') {
    out.position = position;
  }
  const title = label(raw.title, language);
  if (title) out.title = title;
  return out;
}

/**
 * Merge one series entry from either shape.
 *
 * Internal (`dataKey`) wins over spec (`name`) so a caller that already speaks
 * the internal contract is untouched.
 *
 * ## `chartType` is the INTERNAL spelling, and only that (objectui#7744)
 *
 * The two spellings of the per-series family are NOT two authoring keys:
 *
 * - `type` is the AUTHORING face's key — spec `ChartSeries.type`, declared on
 *   the mirror as `ChartDataSeriesSchema.type` (`'bar' | 'line' | 'area'`).
 * - `chartType` is the RENDERER-INTERNAL carrier. It rides on the `dataKey`-
 *   shaped series that `DashboardRenderer`, `ObjectView` and the dataset path
 *   hand straight to `ChartRenderer`, which is where it is declared
 *   (the internal `dataKey` arm of `ChartRendererProps.schema.series`) and where
 *   {@link NormalizedSeries.chartType} is the output half of the same
 *   contract. On the AUTHORING face it is not a member at all: it is a named
 *   alias refusal — `ChartDataSeriesSchema.chartType`
 *   (`packages/types/src/zod/data-display.zod.ts`, objectui#7694 / PR #7737),
 *   pinned in that package's
 *   `__tests__/chart-series-chart-type-alias-refusal-7694.test.ts`. Read the
 *   rule and its remedy THERE. Restating either here would be a second copy of
 *   a rule that only one of the two files is ever edited with.
 *
 * ## The split this limb carries, deliberately (objectui#7744)
 *
 * This function normalizes BOTH shapes, and the `family` limb below cannot
 * tell them apart: by the time `raw` arrives it is a bag of keys with nothing
 * on it naming its producer. So an AUTHORED series that skipped validation
 * still gets `chartType` honoured at runtime — and honoured OVER the declared
 * `type`, which the limb reads second — while the validator refuses that same
 * key by name. The two faces disagree, and that is the state this comment
 * exists to make legible rather than to fix: the objectui#7744 ruling was to
 * annotate and pin, NOT to retire the limb at the reader, because retiring it
 * would change what the internal producers above render — a reader-side
 * decision of its own.
 *
 * ⛔ Do not delete the limb on the strength of a green ablation. Deleting
 * `str(raw.chartType) ??` left the repo fully green when it was measured
 * (304 files / 5817 tests) while deleting its ` ?? str(raw.type)` sibling went
 * 2 red — green there means only that no test PINNED it, never that no
 * producer depends on it. Both halves of the split, and the precedence between
 * them, are now pinned in `__tests__/chartType-internal-only-7744.test.ts`;
 * that case is what goes red if the two faces are ever brought into agreement,
 * from either side.
 */
function normalizeSeries(raw: unknown, language: string | null | undefined): NormalizedSeries | undefined {
  if (!isRec(raw)) {
    // A bare string is accepted as a shorthand for `{ name }` — the entry form
    // the Tremor-ish `categories: ['a','b']` series list feeds in, one entry at
    // a time (the branch that reads `categories` is below, in this file).
    // ⚠️ THIS FILE is the only place that adapts it: `ChartRenderer` carried a
    // second, un-normalized read of `categories` until objectui#8650 retired
    // that branch, which leaves `normalizeChartSchema` the one translation
    // point it was always meant to be (objectui#2880 S1). ⛔ Do not restore a
    // reader-side `categories` branch to "help" — that is the second de-facto
    // contract AGENTS.md #0.1 exists to refuse.
    const bare = str(raw);
    return bare ? { dataKey: bare } : undefined;
  }
  const dataKey = str(raw.dataKey) ?? str(raw.name);
  if (!dataKey) return undefined;
  const out: NormalizedSeries = { dataKey };
  const lbl = label(raw.label, language);
  if (lbl) out.label = lbl;
  // INTERNAL spelling FIRST, authored `type` second — see the docblock above.
  // The order is load-bearing and pinned; neither limb is dead.
  const family = str(raw.chartType) ?? str(raw.type);
  if (family === 'bar' || family === 'line' || family === 'area') out.chartType = family;
  const variant = str(raw.variant);
  if (variant === 'comparison' || variant === 'current' || variant === 'primary') out.variant = variant;
  const opacity = num(raw.opacity);
  if (opacity !== undefined) out.opacity = opacity;
  const dash = str(raw.dashArray);
  if (dash) out.dashArray = dash;
  const stack = str(raw.stack);
  if (stack) out.stack = stack;
  const yAxis = str(raw.yAxis);
  if (yAxis === 'left' || yAxis === 'right') out.yAxis = yAxis;
  const color = str(raw.color);
  if (color) out.color = color;
  // Renderer-internal, like `chartType` on the internal shape (objectui#11681):
  // the authoring face refuses it by name, see `NormalizedSeries.aggregate`.
  const aggregate = str(raw.aggregate);
  if (aggregate) out.aggregate = aggregate;
  return out;
}

/**
 * The two value-axis slots a cartesian chart draws, named in the spec's own
 * `ChartSeries.yAxis` vocabulary: a series binds to a slot by writing
 * `yAxis: 'left' | 'right'`, and `'left'` is the spec default.
 *
 * On a chart whose value axes run up its side (bar, line, area, combo,
 * scatter) the slot IS the side it is drawn on. On `horizontal-bar` the value
 * axes run across the plot, so the chart is the vertical one transposed: the
 * `'left'` slot is drawn along the bottom and the `'right'` slot along the
 * top — the same swap `placeXAxis` reads for the `xAxis` object there.
 */
export type ValueAxisSlot = 'left' | 'right';

/** A `yAxis` entry whose `position` was not honoured, and why. */
export interface YAxisPositionNote {
  /** Index of the entry in `yAxis`. */
  index: number;
  /** The side it named. */
  position: NonNullable<NormalizedAxis['position']>;
  /**
   * `'side'` — a side a value axis of this chart cannot take (`top` /
   * `bottom` up the side of the plot; `left` / `right` across it).
   * `'taken'` — an open side the first entry already holds.
   */
  reason: 'side' | 'taken';
  /** The slot the entry was drawn in instead. */
  drawn: ValueAxisSlot;
}

/**
 * A `yAxis` entry drawn on no axis — every entry after the ones the chart
 * places: after the second (objectui#10691), or after the first on `scatter`,
 * which draws one value axis (objectui#10721). The spec's `ChartConfig.yAxis`
 * is an uncapped list, so such an entry validates; a chart draws at most two
 * value axes, one per slot.
 */
export interface YAxisUndrawnNote {
  /** Index of the entry in `yAxis` — 2 or more; 1 or more on `scatter`. */
  index: number;
  /**
   * The slot a series derived from the entry binds to (the chart declares
   * neither `series` nor `categories`), and so the axis its `field` is
   * plotted against. On `scatter`, the one slot the chart draws.
   */
  boundTo: ValueAxisSlot;
}

export interface YAxisPlacement {
  /** Index of the `yAxis` entry drawn in each slot; absent when none is. */
  left?: number;
  right?: number;
  /**
   * The slot of each placed entry, by index (the first two entries; the first
   * on `scatter`).
   */
  slotOf: ValueAxisSlot[];
  notes: YAxisPositionNote[];
  /** Every entry after the placed ones, in index order: drawn on no axis. */
  undrawn: YAxisUndrawnNote[];
}

/**
 * Where each `yAxis` entry is drawn, read from its `position`
 * (objectui#10654, the y-side twin of objectui#10587).
 *
 * The ONE place a y side is resolved: `normalizeChartSchema` binds the series
 * it derives from the entries with it, and `AdvancedChartImpl` places the
 * axes and writes the notes from the same answer, so a derived series always
 * plots against its own entry's axis.
 *
 * Only the first two entries are placed — a chart draws at most two value
 * axes, one per slot — and on `scatter` only the first: it draws one y axis,
 * the primary's (objectui#10721). The rule, in order:
 *
 *   1. An entry whose `position` names a side a value axis of this chart
 *      cannot take is REFUSED: it is placed as if it named no side, and the
 *      chart carries a note naming `yAxis[N].position`. ⛔ Never mapped to a
 *      "nearest" open side — `top` names no side of an axis that runs up the
 *      plot.
 *   2. An entry that names an open side is drawn there.
 *   3. When BOTH entries name the same side, the first keeps it —
 *      `yAxis[0]` is the primary axis, the one declaration order already
 *      makes primary — and the second is drawn on the other side with a note
 *      naming `yAxis[1].position`.
 *   4. An entry that names no side takes the side the other entry left free;
 *      with neither naming one, the first is drawn in the `'left'` slot and
 *      the second in the `'right'` slot, exactly as before `position` was read.
 *
 * Every entry after the placed ones is listed in `undrawn` (objectui#10691,
 * and objectui#10721 for `scatter`): it is drawn on no axis, so none of its
 * keys — `position` included — is read, and the chart carries a note naming
 * `yAxis[N]`. A series derived from it binds to the `'right'` slot, as it did
 * before this list existed; on `scatter` to the one slot the chart draws,
 * because a scatter reads no series binding and measures every series it
 * plots against that axis. ⛔ The count is not narrowed: the spec declares
 * `yAxis` uncapped, so the entry stays valid and the note is the answer.
 *
 * `chartType` is the family the chart is drawn as, and every caller passes
 * its own, so the slice above is expressed here once rather than at each call
 * site. On `horizontal-bar` the value axes run across the plot (see
 * {@link ValueAxisSlot}): there `bottom` / `top` are the open sides.
 */
export function placeYAxes(
  yAxes: readonly NormalizedAxis[] | undefined,
  chartType: string | undefined,
): YAxisPlacement {
  const valueAxesRunAcross = chartType === 'horizontal-bar';
  const valueAxisCount = chartType === 'scatter' ? 1 : 2;
  const entries = (yAxes ?? []).slice(0, valueAxisCount);
  const notes: YAxisPositionNote[] = [];
  const openSlot = (position: NormalizedAxis['position']): ValueAxisSlot | undefined => {
    if (valueAxesRunAcross) return position === 'bottom' ? 'left' : position === 'top' ? 'right' : undefined;
    return position === 'left' || position === 'right' ? position : undefined;
  };
  const other = (slot: ValueAxisSlot): ValueAxisSlot => (slot === 'left' ? 'right' : 'left');
  // The slot each entry NAMED, once rule 1 has refused the ones it cannot take.
  const named = entries.map((entry) => openSlot(entry.position));
  const slotOf: ValueAxisSlot[] = [];
  if (entries.length === 1) {
    slotOf.push(named[0] ?? 'left');
  } else if (entries.length === 2) {
    const [a, b] = named;
    if (a && b) slotOf.push(a, a === b ? other(a) : b);
    else if (a) slotOf.push(a, other(a));
    else if (b) slotOf.push(other(b), b);
    else slotOf.push('left', 'right');
  }
  entries.forEach((entry, index) => {
    if (!entry.position) return;
    if (!named[index]) notes.push({ index, position: entry.position, reason: 'side', drawn: slotOf[index] });
    else if (named[index] !== slotOf[index]) {
      notes.push({ index, position: entry.position, reason: 'taken', drawn: slotOf[index] });
    }
  });
  // An entry is undrawn only once every slot is taken, so on `scatter` the one
  // slot is `slotOf[0]` whenever this list is not empty.
  const boundTo: ValueAxisSlot = valueAxisCount === 1 ? slotOf[0] : 'right';
  const undrawn = (yAxes ?? [])
    .slice(entries.length)
    .map<YAxisUndrawnNote>((_entry, offset) => ({ index: entries.length + offset, boundTo }));
  const placement: YAxisPlacement = { slotOf, notes, undrawn };
  slotOf.forEach((slot, index) => {
    placement[slot] = index;
  });
  return placement;
}

/**
 * Translate a chart schema — spec shape, internal shape, or a mix — into the
 * renderer's internal contract. Only keys that resolve to something are
 * present on the result, so callers can spread it over their own defaults.
 *
 * @param language the VIEWER's active language, for every `I18nLabel` slot this
 *   resolves — the chart's `title` / `subtitle` / `description`, an axis
 *   `title`, and a series `label`. Pure on purpose: this module cannot call a
 *   hook, so a React caller reads the language once
 *   (`useObjectTranslation().language`) and hands it down. See {@link label}.
 *
 *   ⚠️ OMITTING IT IS NOT NEUTRAL. `pickLocalized` reads an absent language as
 *   `'en'`, so a locale map resolves through `default` -> `en` -> first value.
 *   That is the right answer for a caller with no viewer (a build-time or
 *   server-side normalisation) and the WRONG one for a rendering caller — which
 *   is why `ChartRenderer` passes it. A caller that reads only structural keys
 *   off the result (`resolveChartCategoryField` reads `xAxisKey` and nothing
 *   else) resolves no label at all and may omit it.
 *
 *   The parameter is optional so that every existing caller keeps compiling and
 *   every non-label key keeps its byte-for-byte behaviour; it is NOT optional
 *   in the sense of "safe to skip when a heading is on screen".
 */
export function normalizeChartSchema(
  schema: unknown,
  language?: string | null,
): NormalizedChartSchema {
  if (!isRec(schema)) return {};
  const out: NormalizedChartSchema = {};

  // ── chart family ────────────────────────────────────────────────────────
  // `chartType` (internal) → `specType` (an author `type` rescued from the
  // envelope collision) → `type` (only when it is unambiguously a chart family
  // and not a component discriminator).
  // A registered chart-type keyword (`chart:bar`) is read LAST, after both
  // explicit spellings: an author who writes `chartType: 'line'` on a
  // `chart:bar` node still gets a line, exactly as objectui#7401's ruling
  // requires, and `plugin-charts:chart` with an explicit `chartType` — the
  // card's control row — is untouched.
  const rawType = str(schema.type);
  const chartType =
    str(schema.chartType) ??
    str(schema.specType) ??
    (rawType && CHART_TYPES.has(rawType) ? rawType : undefined) ??
    familyFromComponentType(rawType);
  // The named family goes to `AdvancedChartImpl`'s family dispatch AS NAMED,
  // drawn or not (objectui#11520). That dispatch is the one place a family
  // becomes a form: a chart for `RENDERABLE`, the number card for
  // `SINGLE_VALUE_CHART_TYPES`, the tabular notice for `TABULAR_CHART_TYPES`,
  // and a notice naming anything else. This used to keep only `RENDERABLE`
  // families, on the theory that the caller's own default was the more honest
  // answer; the caller's default was `'bar'`, so a `specType: 'gauge'` chart
  // (the react tier's `<ObjectChart type="gauge">`) drew a bar with no note,
  // while the same family on `chartType`, which `ChartRenderer` hands over
  // without this module, drew the number card. Both channels now reach the
  // same branch with the same value.
  //
  // ⚠️ The JSON-boundary cast (the one place the family is asserted rather than
  // proven). `schema` is unvalidated JSON, so the string read above is a
  // `DeclaredChartFamily` only when a face validated the document. The cast
  // states the declared vocabulary for every typed consumer downstream; a value
  // outside it (an off-spec `specType`, a stale stored node) still reaches the
  // dispatch as named, and the dispatch's unknown-type notice is the runtime
  // guard for it.
  if (chartType) out.chartType = chartType as DeclaredChartFamily;

  // ── axes ────────────────────────────────────────────────────────────────
  // Spec `xAxis` is an object; the report surface narrows it to a bare string.
  // Both mean "the column on the category axis".
  //
  // The x-axis object is kept whenever it carries ANY presentation key — every
  // key `normalizeAxis` kept except `field`, the data key hoisted to `xAxisKey`
  // below (objectui#10516). The set is what `normalizeAxis` read, so it is the
  // spec's `ChartAxisSchema` key set by construction
  // (`normalizeChartSchema.specAxisKeys-7690.test.ts` ties the two), and ⛔ it
  // is not restated here: this gate used to name `format` / `title` /
  // `showGridLines` by hand, so an axis carrying only `min` / `max` /
  // `stepSize` / `logarithmic` / `position` was dropped whole and a scatter's
  // authored x scale never reached its axis. The test asks which keys
  // survived, never how truthy their values are: `min: 0` counts.
  const xAxisRaw = schema.xAxis;
  const xAxisSpec = normalizeAxis(xAxisRaw, language);
  if (xAxisSpec && Object.keys(xAxisSpec).some((key) => key !== 'field')) {
    out.xAxis = xAxisSpec;
  }
  const xAxisKey = str(schema.xAxisKey) ?? xAxisSpec?.field ?? str(xAxisRaw);
  if (xAxisKey) out.xAxisKey = xAxisKey;

  const yAxes = (Array.isArray(schema.yAxis) ? schema.yAxis : schema.yAxis !== undefined ? [schema.yAxis] : [])
    .map((a: unknown) => normalizeAxis(a, language) ?? (str(a) ? { field: str(a) } : undefined))
    .filter((a): a is NormalizedAxis => !!a);
  if (yAxes.length) out.yAxes = yAxes;

  // ── series ──────────────────────────────────────────────────────────────
  // ⚠️ `categories` is an ALTERNATIVE SERIES LIST here, not axis labels, and
  // this branch is the whole of its meaning: it is consulted only when `series`
  // is absent, and each entry then goes through `normalizeSeries`, whose bare-
  // string branch reads it as `{ dataKey }` — a COLUMN NAME. The category axis
  // is resolved separately, from `xAxisKey` / `xAxis` above.
  //
  // `@object-ui/types` documented this key as "X-axis labels/categories" until
  // `b0d308da9`; the declaration was corrected to this reading rather than
  // this reading to the declaration (maintainer ruling 2026-08-31 — prose
  // follows machine). Pinned in `normalizeChartSchema.test.ts`; if you change
  // what `categories` means here, that docblock is the other half of the edit.
  const rawSeries = Array.isArray(schema.series)
    ? schema.series
    : Array.isArray(schema.categories)
      ? schema.categories
      : undefined;
  // ⚠️ NOT point-free (`.map(normalizeSeries)`): `Array#map` hands the callback
  // the INDEX as its second argument, which since objectui#8943 is
  // `normalizeSeries`' `language` parameter — every series after the first
  // would resolve its label against the numbers `1`, `2`, … as locale tags.
  let series = rawSeries
    ?.map((entry: unknown) => normalizeSeries(entry, language))
    .filter((s): s is NormalizedSeries => !!s);
  // No series at all: the y-axes name the plotted columns, so a chart written
  // purely in spec shape (`yAxis: [{ field: 'total' }]`) still plots.
  //
  // Each derived series binds to the slot `placeYAxes` draws ITS entry in — the
  // same call the renderer places the axes with (objectui#10654) — so a first
  // entry at `position: 'right'` takes its own series to the right and leaves
  // the second entry's series on the left, instead of binding both to the
  // right-hand axis. An entry drawn in the `'left'` slot after the first says
  // so explicitly, because an authored `combo` reads an unbound series by its
  // index. Entries past the second (past the first on `scatter`) are drawn on
  // no axis; the slot a series derived from one binds to is `placeYAxes`'s
  // answer too (its `undrawn` list, objectui#10691 / objectui#10721), so the
  // note the chart carries for that entry names the axis this series is
  // plotted against.
  if (!series?.length) {
    const placement = placeYAxes(yAxes, chartType);
    // One slot per entry, by index: `undrawn` lists every entry after the
    // placed ones, in index order.
    const slotOfEntry = [...placement.slotOf, ...placement.undrawn.map((note) => note.boundTo)];
    const fromAxes = yAxes
      .map((a, i) => ({ a, slot: slotOfEntry[i], i }))
      .filter(({ a }) => a.field)
      .map<NormalizedSeries>(({ a, slot, i }) => ({
        dataKey: a.field!,
        ...(a.title ? { label: a.title } : {}),
        ...(slot === 'right' || i > 0 ? { yAxis: slot } : {}),
      }));
    if (fromAxes.length) series = fromAxes;
  }
  if (series?.length) out.series = series;

  // ── chrome ──────────────────────────────────────────────────────────────
  if (typeof schema.showLegend === 'boolean') out.showLegend = schema.showLegend;
  if (typeof schema.showDataLabels === 'boolean') out.showDataLabels = schema.showDataLabels;
  const title = label(schema.title, language);
  if (title) out.title = title;
  const subtitle = label(schema.subtitle, language);
  if (subtitle) out.subtitle = subtitle;
  const description = label(schema.description, language);
  if (description) out.description = description;
  const height = num(schema.height);
  if (height !== undefined && height > 0) out.height = height;
  if (Array.isArray(schema.annotations) && schema.annotations.length) {
    out.annotations = schema.annotations.filter(isRec);
  }
  if (isRec(schema.interaction)) out.interaction = schema.interaction;

  return out;
}

/**
 * Which family an un-annotated series takes when the chart is drawn as a combo,
 * or `undefined` when the chart's own family has no per-series meaning.
 *
 * `undefined` therefore doubles as "this combo was authored, not derived":
 * only a cartesian family can be widened into a combo, so a chart that reaches
 * the combo renderer with no base family got there by being named `combo`.
 */
export function comboBaseFamily(chartType: string | undefined): SeriesFamily | undefined {
  if (chartType === 'bar' || chartType === 'column') return 'bar';
  if (chartType === 'line') return 'line';
  if (chartType === 'area') return 'area';
  return undefined;
}

/**
 * The family the renderer should actually draw.
 *
 * `ChartSeries.type` is the spec's own way to say "this series is a line on an
 * otherwise-bar chart", and until now it was parsed, carried through
 * normalization, and then dropped: only the renderer's `chartType === 'combo'`
 * branch reads `series[].chartType`, so a chart authored in the spec shape
 *
 * ```ts
 * { type: 'bar', series: [{ name: 'revenue' }, { name: 'margin', type: 'line' }] }
 * ```
 *
 * drew `margin` as a bar. Silently — the value was right at every layer except
 * the last. That is the failure this widens: an author writing the protocol got
 * the wrong picture unless they also knew to write objectui's non-spec `combo`.
 *
 * Only a disagreement derives a combo. A chart whose series all resolve to the
 * same family keeps its own family, so nothing that renders correctly today
 * changes; and an explicit `combo` is returned untouched.
 *
 * Pass the chart's EFFECTIVE family — the answer depends on what an
 * un-annotated series would otherwise have drawn. A chart that names no family
 * gets `undefined` back: there is no default family to widen (objectui#11520).
 */
export function effectiveChartFamily<T extends DeclaredChartFamily | undefined>(
  chartType: T,
  series: readonly Pick<NormalizedSeries, 'chartType'>[] | undefined,
): T | 'combo' {
  if (chartType === 'combo') return 'combo';
  const base = comboBaseFamily(chartType);
  if (!base || !series || series.length < 2) return chartType;
  const resolved = series.map((s) => s.chartType ?? base);
  return new Set(resolved).size > 1 ? 'combo' : chartType;
}

/**
 * Build a tick formatter from a spec `ChartAxis.format` string.
 *
 * The spec documents "d3-format or similar" (`"$0,0.00"`, `"0.0%"`). Rather
 * than pull in d3-format for a handful of patterns, this reads the shape of
 * the string — currency prefix, percent suffix, thousands separator, decimal
 * places — and drives `Intl.NumberFormat`, which is already loaded and
 * locale-aware. An unrecognized format returns `undefined`, so the caller
 * keeps its own default formatting rather than rendering something wrong.
 *
 * `locale` is the chart's DISPLAY locale (`useDisplayLocale()` in the caller)
 * and it is REQUIRED on purpose: this is a plain function with no hook to read
 * it from, and the version that took no locale handed `Intl` an explicit
 * `undefined` — the MACHINE's locale, neither of the repo's two locale
 * channels (objectui#9909). A required parameter is the one shape a caller
 * cannot forget.
 */
export function formatterFor(format: string | undefined, locale: string): ((value: any) => string) | undefined {
  if (!format) return undefined;
  const isPercent = format.includes('%');
  const currencyMatch = /^([$£€¥₹])/.exec(format);
  const grouped = format.includes(',');
  const decimals = /\.(0+)/.exec(format)?.[1].length ?? 0;
  const CURRENCY_BY_SYMBOL: Record<string, string> = {
    $: 'USD', '£': 'GBP', '€': 'EUR', '¥': 'CNY', '₹': 'INR',
  };
  // Nothing recognizable to act on — don't guess.
  if (!isPercent && !currencyMatch && !grouped && decimals === 0) return undefined;

  const opts: Intl.NumberFormatOptions = {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouped,
  };
  if (isPercent) opts.style = 'percent';
  else if (currencyMatch) {
    opts.style = 'currency';
    opts.currency = CURRENCY_BY_SYMBOL[currencyMatch[1]] ?? 'USD';
  }
  return (value: any) => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return value == null ? '' : String(value);
    try {
      return new Intl.NumberFormat(locale, opts).format(n);
    } catch {
      return String(n);
    }
  };
}

/**
 * Explicit tick positions for an axis that declares a `stepSize`, or
 * `undefined` to keep Recharts' automatic ticks.
 *
 * Recharts has no "every N units" prop — `tickCount` is a hint it may ignore
 * and `interval` is for categorical axes — so honoring `stepSize` means
 * handing it the tick array outright. The range comes from the axis's own
 * `min`/`max` where declared and from the plotted values otherwise, so a step
 * works with or without a pinned domain.
 *
 * `values` should be every number plotted on this axis. An empty range, a
 * non-finite one, or a step that would produce an absurd number of ticks
 * (>`MAX_TICKS`) yields `undefined` — a 10,000-tick axis is a wrong config,
 * and drawing it would hang the page rather than report the mistake.
 */
const MAX_TICKS = 200;

export function ticksFor(axis: NormalizedAxis | undefined, values: number[]): number[] | undefined {
  const step = axis?.stepSize;
  if (!step || step <= 0) return undefined;

  const finite = values.filter((v) => Number.isFinite(v));
  const dataMin = finite.length ? Math.min(...finite) : undefined;
  const dataMax = finite.length ? Math.max(...finite) : undefined;
  // A value axis conventionally starts at zero unless told otherwise, which is
  // also what Recharts' own auto domain does for bars/areas.
  const lo = axis.min ?? Math.min(0, dataMin ?? 0);
  const hi = axis.max ?? dataMax;
  if (hi === undefined || !Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) return undefined;

  const start = Math.floor(lo / step) * step;
  // An explicit `max` pins the domain, so the last tick must not overshoot it
  // (Recharts would place a tick outside the plot). A data-derived max is not
  // pinned, so round UP to the next step — otherwise the topmost value sits
  // above the last gridline and the axis reads as truncated.
  const end = axis.max !== undefined ? axis.max : Math.ceil(hi / step) * step;
  // `(end - start) / step` is exact in decimal but not in binary: 0.5 / 0.1 is
  // 5.000000000000001 one way and 4.999999999999999 the other, and a bare
  // floor() drops a whole tick in the second case.
  const count = Math.floor((end - start) / step + 1e-9) + 1;
  if (count < 1 || count > MAX_TICKS) return undefined;

  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    // Re-derive from the index rather than accumulating, so a fractional step
    // (0.1) does not drift into 0.30000000000000004 territory across the axis.
    out.push(Number((start + i * step).toPrecision(12)));
  }
  // Make sure an explicit max is actually reachable as a tick.
  if (axis.max !== undefined && out[out.length - 1] < axis.max) out.push(axis.max);
  return out;
}

/**
 * Recharts `domain` for an axis, or `undefined` to keep the auto domain.
 * A half-open range (only `min`, only `max`) pins that end and leaves the
 * other automatic.
 */
export function domainFor(axis: NormalizedAxis | undefined): [any, any] | undefined {
  if (!axis) return undefined;
  const { min, max } = axis;
  if (min === undefined && max === undefined) return undefined;
  return [min ?? 'auto', max ?? 'auto'];
}
