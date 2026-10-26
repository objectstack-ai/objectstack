/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import * as React from "react"
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  Area,
  AreaChart,
  ComposedChart,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Scatter,
  ScatterChart,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Funnel,
  FunnelChart,
  LabelList,
  Treemap,
  Sankey,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  Brush,
  type SankeyLinkProps,
  type SankeyNode,
  type SankeyNodeProps,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  ChartContainerConfig
} from './ChartContainerImpl';
import { mapScatterClick, mapTreemapClick, mapSankeyClick } from './chartDrillEvents';
import { formatterFor, domainFor, ticksFor, plotsWholeNumbers, RENDERABLE, SINGLE_VALUE_CHART_TYPES, TABULAR_CHART_TYPES, effectiveChartFamily, comboBaseFamily, placeYAxes, type DeclaredChartFamily, type NormalizedAxis, type NormalizedSeries, type ValueAxisSlot, type YAxisPlacement } from './normalizeChartSchema';
import { buildCategoryRank, chartRowBucketId, isRealCalendarDate, toDateInputValue, toDisplayDate, type ChartSegmentClickEvent } from '@object-ui/core';
import { createSafeTranslation, useDisplayLocale, useSafeTranslate } from '@object-ui/i18n';

// Default color fallback for chart series
const DEFAULT_CHART_COLOR = 'hsl(var(--primary))';

// Simple color map for Tailwind names (Mock - ideal would be computed styles)
const TW_COLORS: Record<string, string> = {
  slate: '#64748b',
  gray: '#6b7280',
  zinc: '#71717a',
  neutral: '#737373',
  stone: '#78716c',
  red: '#ef4444',
  orange: '#f97316',
  amber: '#f59e0b',
  yellow: '#eab308',
  lime: '#84cc16',
  green: '#22c55e',
  emerald: '#10b981',
  teal: '#14b8a6',
  cyan: '#06b6d4',
  sky: '#0ea5e9',
  blue: '#3b82f6',
  indigo: '#6366f1',
  violet: '#8b5cf6',
  purple: '#a855f7',
  fuchsia: '#d946ef',
  pink: '#ec4899',
  rose: '#f43f5e',
};

const resolveColor = (color: string) => TW_COLORS[color] || color;

/**
 * Per-series presentation overrides, in two halves that are deliberately NOT
 * gated the same way (objectui#7698).
 *
 * - The AUTHORED keys — `@objectstack/spec`'s `ChartSeries.opacity` ("Override
 *   series opacity") and `ChartSeries.dashArray` ("Override stroke dash
 *   pattern") — are declared with NO condition, so they apply on every series
 *   whatever its `variant`.
 * - The muted comparison treatment (lower opacity, a `'4 4'` dash) is a
 *   DEFAULT and stays gated on `variant: 'comparison'`, so the overlay still
 *   reads as muted while a primary series carrying neither key is untouched.
 *
 * This function used to return `null` for anything but a comparison series, so
 * an authored `opacity` / `dashArray` on a primary series was read by
 * `normalizeSeries` and then discarded here — the renderer honouring a
 * spec-declared unconditional override on one variant only. Narrowing the
 * published declaration to match would have been the renderer's tolerance
 * dictating the contract, which is the direction AGENTS.md #0.1 forbids.
 *
 * Comparison series keep every value they had. The authored branch already won
 * over the defaults, and the two STROKE defaults no mark ever consumed — bar
 * and scatter, neither of which this renderer strokes — are now spelled
 * `undefined` rather than reaching the Bar and Scatter marks that gained
 * `strokeOpacity` / `strokeDasharray` in the same change.
 *
 * `radar` joined the `kind` union later (objectui#8157): the radar arm was the
 * one mark that never called this helper at all, so all three declarations died
 * there. It takes the AREA defaults — see `areaLike` below — because it is the
 * other mark this renderer both strokes and fills. ⚠️ Its call site keeps its
 * own `?? 0.6` fill fallback: unlike a cartesian mark, a radar polygon with no
 * fill opacity at all is an unreadable overlay, so the literal that used to be
 * the whole story became the floor under it.
 */
const seriesStyle = (s: any, kind: 'line' | 'area' | 'bar' | 'scatter' | 'radar') => {
  const muted = s?.variant === 'comparison';
  // `radar` shares the AREA defaults rather than getting numbers of its own:
  // it is the other mark this renderer both strokes and fills, so the muted
  // treatment area already defines is the one that fits it. For every
  // cartesian kind `areaLike` is exactly `kind === 'area'`, so no cartesian
  // arm's result moves (objectui#8157).
  const areaLike = kind === 'area' || kind === 'radar';
  const authoredOpacity = typeof s?.opacity === 'number' ? s.opacity : undefined;
  const strokeOpacity = authoredOpacity ?? (muted ? (kind === 'line' ? 0.5 : areaLike ? 0.6 : undefined) : undefined);
  const fillOpacity = authoredOpacity ?? (muted ? (kind === 'bar' ? 0.4 : areaLike ? 0.2 : 0.5) : undefined);
  const strokeDasharray = s?.dashArray ?? (muted && (kind === 'line' || areaLike) ? '4 4' : undefined);
  return { strokeOpacity, fillOpacity, strokeDasharray };
};

/**
 * Which series did a CARTESIAN click land on? (objectui#4672)
 *
 * recharts 3 answers with `activeDataKey` on the chart-level click payload —
 * but only when the interaction was dispatched by a graphical ITEM, which is
 * the per-series cursor (`Tooltip shared={false}`). Under the SHARED (axis)
 * cursor these charts render, the click is an AXIS interaction, and recharts
 * dispatches those with `activeDataKey: undefined` hard-coded
 * (`recharts/lib/state/mouseEventsMiddleware.js`) — the cursor spans every
 * series at that tick, so the payload names no single one. Measured against
 * the installed recharts 3.10.1 for bar, line and area, clicking a mark and
 * empty plot area alike: the key is absent in every shared-cursor case.
 *
 * So take the payload's answer when it has one; failing that, the only click
 * with an unambiguous answer is on a chart plotting exactly ONE series, where
 * the clicked column can belong to nothing else. A multi-series chart under
 * the shared cursor is left UNRESOLVED rather than guessed: naming a series
 * the user did not click drills to the wrong records, which is worse than the
 * dead click. Resolving that half needs a different mechanism (an item-level
 * handler, which changes what a cartesian drill means) — it is the open half
 * of objectui#4672, deliberately not answered here.
 */
const resolveClickedSeriesKey = (
  activeDataKey: unknown,
  plotted: NormalizedSeries[],
): string | undefined => {
  if (typeof activeDataKey === 'string' || typeof activeDataKey === 'number') {
    const fromPayload = String(activeDataKey);
    if (fromPayload !== '') return fromPayload;
  }
  if (plotted.length === 1) {
    const only = plotted[0]?.dataKey;
    if (only != null && String(only) !== '') return String(only);
  }
  return undefined;
};

/**
 * The DOM event behind a React synthetic one — the IDENTITY of a single user
 * gesture (objectui#4672).
 *
 * Load-bearing rather than incidental: a click on a mark reaches the item-level
 * handler and the chart-level handler as two separate callbacks, and the only
 * thing that says they are ONE click is that both were handed the same
 * `nativeEvent` object. Measured on recharts 3.10.1 for bar, line and area
 * alike: identical object, item first, chart second. Matching on that object
 * rather than on a flag-and-timeout means a stale record can never be adopted
 * by a later click — a different gesture is a different object, always.
 */
const gestureIdOf = (value: unknown): unknown => {
  if (value && typeof value === 'object' && 'nativeEvent' in value) {
    return (value as { nativeEvent: unknown }).nativeEvent;
  }
  return undefined;
};

/**
 * The gesture identity out of an ITEM handler's arguments, whose shape differs
 * per mark family — measured, because recharts does not type two of the three.
 *
 *  - `Bar`:  `(item: BarRectangleItem, index: number, event)` — three args, and
 *    the item carries the row and the value.
 *  - `Line` / `Area`: `(curveProps, event)` — TWO args, and the first is the
 *    rendered curve's props, not a datum. A line/area mark click therefore
 *    knows WHICH SERIES it is (this component rendered it) and nothing about
 *    which category, which is exactly why the series is recorded here and the
 *    event is still composed by the chart-level handler, which does know.
 *
 * Scanning from the end takes the event in both shapes without branching on the
 * mark family, and returns `undefined` for any shape carrying no event at all —
 * an argument list this code has never seen cannot be mistaken for a gesture.
 */
const gestureIdOfArgs = (args: unknown[]): unknown => {
  for (let i = args.length - 1; i >= 0; i -= 1) {
    const id = gestureIdOf(args[i]);
    if (id !== undefined) return id;
  }
  return undefined;
};

/**
 * The DISPLAY LABEL of a plotted series, given the key a click resolved to
 * (objectui#4682).
 *
 * A series key is a `dataKey` — what the renderer binds and what the drill
 * lookup resolves back to a group. Its label is what the legend paints. For
 * every ordinary group those are the same string, which is why reading the key
 * as a title has passed unnoticed; they part company exactly when a group keys
 * by its IDENTITY because its label cannot name it (objectui#4673's
 * `pivotSeriesBuckets`, over objectui#4508's collision) — and then the drawer
 * title reads `[null]` at a segment the user saw labelled `(None)`.
 *
 * Keys are unique within a chart's series (`buildChartSeries` assigns them
 * injectively; the measure branch keys by measure name), so this lookup is
 * unambiguous and both arms — the clicked mark and the axis fallback — resolve
 * their label through this one path.
 */
const seriesLabelForKey = (
  key: string | undefined,
  plotted: NormalizedSeries[],
): string | undefined => {
  if (key == null) return undefined;
  const found = plotted.find((s) => String(s.dataKey) === key);
  return typeof found?.label === 'string' ? found.label : undefined;
};

export interface AdvancedChartImplProps {
  /**
   * Chart family, as the schema names it. `combo` is renderer-local and rarely
   * needs to be passed: series declaring different families derive it
   * (`effectiveChartFamily`), which is how `@objectstack/spec` expresses a
   * combo chart.
   *
   * Typed as the declared chart families ({@link DeclaredChartFamily}: the
   * spec's `ChartType` and the `object-chart` node's own union, by reference),
   * so a misspelled family does not compile. The family dispatch below is the
   * one place a family becomes a form: a chart for `RENDERABLE`, the number
   * card for the single-value families, the tabular notice for the tabular
   * ones, and a notice for anything else, which is how a value from unvalidated
   * JSON outside the type is answered at runtime. ⛔ There is no default family
   * (objectui#11520): an absent family is that notice too, never a bar. A
   * caller that means a bar passes `'bar'`.
   */
  chartType?: DeclaredChartFamily;
  data?: Array<Record<string, any>>;
  config?: ChartContainerConfig;
  xAxisKey?: string;
  /**
   * Plotted series, in the renderer's internal shape. Authors write the spec
   * `series: [{ name, stack, yAxis, … }]`; `normalizeChartSchema` translates.
   */
  series?: NormalizedSeries[];
  className?: string;
  /** Categorical/series colour palette. Overrides the theme's `--chart-1..n`
   *  defaults so a page/dashboard can brand its charts (data-screens). */
  colors?: string[];
  /**
   * Per-category colour map keyed by the category value OR its display label
   * (e.g. `{ green: '#10B981', Green: '#10B981' }`). When the chart's category
   * dimension is a select/lookup field, ObjectChart resolves the field's option
   * colours into this map so a "Red" health slice paints red instead of taking
   * the next positional palette slot. A category found here WINS over `colors`;
   * categories absent here fall back to the positional palette, then the theme.
   */
  categoryColors?: Record<string, string>;
  /**
   * Declared category order for ordered-sequence charts (funnel / pyramid),
   * keyed like {@link categoryColors} by the category VALUE or its display
   * LABEL, listed in domain order.
   *
   * A funnel's shape asserts a sequence, so without this the renderer can only
   * guess at one and sorts by value descending. That is right for a generic
   * "biggest first" funnel and wrong for a sales pipeline, where the stages
   * have a declared order (Qualification → Needs Analysis → Proposal →
   * Negotiation) that a healthy pipeline happens to narrow along — and an
   * unhealthy one does not. When supplied, this order wins; categories not
   * listed keep their incoming relative order after the listed ones.
   */
  categoryOrder?: string[];
  /**
   * Optional drill-down click handler. Fires when a chart segment is clicked
   * with `{ category, categoryId, series, value }`. Wired for
   * bar/horizontal-bar/line/area/pie/donut/funnel/scatter/treemap/sankey —
   * each has its own click handler attached to its mark(s) below — and for
   * `combo`, whose `Bar`/`Line`/`Area` marks are the same components the plain
   * cartesian branch renders and now emit the same event with the same
   * semantics (ruled on objectui#4692).
   *
   * `combo` differs from the plain cartesian branch in exactly ONE way, and
   * deliberately: **only its marks drill.** A click on the plot surface or an
   * axis stays silent there, where the plain branch would fall back to its
   * axis-level answer. A combo plots several measures on one plot, so a
   * surface click has no single series answer to give — the same reasoning
   * objectui#4672's ruling used for the pivoted case. The plain branch keeps
   * that fallback because its own marks share one measure, so its axis answer
   * is either unambiguous or explicitly named by recharts.
   *
   * That combo drills at all is what keeps its DERIVATION from costing an
   * interaction. The branch is reachable without authoring
   * `chartType: 'combo'`: `effectiveChartFamily` derives it whenever a series'
   * own family disagrees with the chart's own (see its doc comment), so giving
   * one series of a drillable chart a different `type` used to turn that
   * chart's drill off with nothing in the authored spec saying drill was
   * touched. It now changes the mark and nothing else.
   *
   * Radar is the one remaining no-op in L1 — its branch attaches no click
   * handler anywhere.
   */
  onChartClick?: (event: ChartSegmentClickEvent) => void;
  /**
   * Spec `ChartAxis` presentation for the category axis — `format` (tick
   * formatter), `title`, `showGridLines`, `position` (the side it is drawn
   * on — see `placeXAxis`), and on scatter's measure x axis `min` / `max` /
   * `stepSize` / `logarithmic` as well. Its `field` already arrived as
   * {@link AdvancedChartImplProps.xAxisKey}. Resolved by
   * `normalizeChartSchema`, so the renderer never parses the author shape.
   */
  xAxis?: NormalizedAxis;
  /**
   * Spec `ChartConfig.yAxis` — one entry per value axis, in declaration order.
   * Index 0 is the primary axis. A second entry turns on the second value
   * axis; each entry's `position` picks the slot it is drawn in, and
   * `series[].yAxis` binds a series to a slot (`placeYAxes` in
   * `normalizeChartSchema`). A lone entry is the chart's only value axis,
   * drawn on the side it names. Carries `min`/`max` (domain), `format`
   * (ticks), `logarithmic` (scale) and `title`. An entry after the second
   * (after the first on `scatter`, which draws one y axis) is drawn on no
   * axis, and the chart carries a note naming it (`yAxisUndrawnNotes`,
   * objectui#10691, objectui#10721).
   */
  yAxes?: NormalizedAxis[];
  /** Spec `ChartConfig.showLegend`. Omitted → shown (the schema default). */
  showLegend?: boolean;
  /** Spec `ChartConfig.showDataLabels` — print each point's value on the mark. */
  showDataLabels?: boolean;
  /** Spec `ChartConfig.title` / `.subtitle`, rendered above the plot. */
  title?: string;
  subtitle?: string;
  /**
   * Spec `ChartConfig.description` — the accessibility description. A chart is
   * a picture to a screen reader; without this it announces as an unlabelled
   * graphic, so the container carries it as `role="img"` + `aria-label`.
   */
  description?: string;
  /** Spec `ChartConfig.height` — fixed plot height in pixels. */
  height?: number;
  /** Spec `ChartConfig.annotations` — reference lines / bands. */
  annotations?: Array<Record<string, any>>;
  /** Spec `ChartConfig.interaction` — `tooltips`, `brush`. */
  interaction?: Record<string, any>;
  /**
   * Disable Recharts' entrance animation when `false`. Animations drive the
   * reveal via `requestAnimationFrame`, which browsers throttle/pause in
   * hidden/background tabs — so a chart rendered off-screen (analytics export,
   * a report opened in an inactive tab, headless capture) can freeze at frame 0
   * and look empty (esp. pie/donut: sectors at angle 0 = no ring, legend only).
   * Reports pass `false` for a deterministic, instant, export-safe render.
   * Omitted/true preserves the animated default everywhere else (dashboards).
   */
  isAnimationActive?: boolean;
}

/**
 * Chart types that plot a CATEGORY axis keyed by `xAxisKey`, and are therefore
 * unreadable when no row carries that key (see the guard in the component).
 *
 * `scatter` is excluded on purpose: both of its axes are numeric measures, so a
 * missing `xAxisKey` there is a different question. `treemap` and `sankey` are
 * excluded because they read hierarchy/link fields, not a category axis — a
 * guard that fired on them would be a false alarm on a working chart.
 */
const CATEGORY_AXIS_CHART_TYPES: ReadonlySet<string> = new Set([
  'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'radar', 'funnel', 'combo',
]);

/**
 * Bucket count at or below which a CATEGORICAL x axis draws EVERY label
 * (objectui#7247).
 *
 * On a band axis a tick is the bar's NAME, not a sample of a continuum: drop it
 * and the reader cannot recover it — there is nothing to interpolate between
 * neighbours, and a single-series bar chart has no legend to fall back on. On a
 * time axis the opposite holds (a reader reconstructs the skipped dates), which
 * is why `xAxisCommonProps`' thinning is right there and wrong here. Measured
 * in the dashboard shape — a 3-column grid in an ~800px console, so a widget
 * ≈200px wide: 3 bars drew 1 label, 5 bars drew 2, and the bars had no names.
 *
 * Where the bound comes from, so it is a derivation and not a taste:
 *
 *   plot width at the narrowest shipped widget
 *     = 200 (widget) − 48 (the `YAxis width` this file sets) − 5 − 5 (recharts'
 *       default left/right chart margin) = 142px
 *   rotated tick labels are PARALLEL lines, so two adjacent ones collide only
 *   once their PERPENDICULAR separation drops below one line box:
 *     separation = bandWidth · sin(35°) = 0.574 · (142 / buckets)
 *   a 12px line box ≈ 14px tall  ⇒  buckets ≤ 5.8
 *
 * At 5 buckets or fewer every label therefore fits at the narrowest width the
 * product ships, with nothing measured at runtime — which is what makes
 * `interval={0}` safe HERE though it was not safe as the blanket setting it
 * used to be (a hundreds-of-points series painted a dense black bar). Above the
 * bound nothing changes: recharts goes on thinning against its own measured
 * text widths, using the real rendered width rather than this worst case.
 */
const X_AXIS_ALL_LABELS_MAX_BUCKETS = 5;

/**
 * Longest rotated x-axis label kept before it is ellipsised (objectui#7247).
 *
 * It applies to EVERY rotated label, on both sides of the bound above
 * (objectui#11796): the axis band below is sized from the longest label it
 * draws, so an unbounded label would need an unbounded band, eating the plot.
 * A shortened name is still a name; a clipped one reads as a different
 * category. The full name stays on the bar's tooltip.
 */
const ROTATED_X_LABEL_MAX_CHARS = 12;

/** Degrees a rotated x-axis label is turned, away from the plot. */
const ROTATED_X_LABEL_ANGLE = 35;

/** The category x axis's `tickMargin`: the gap between a tick and its label. */
const X_AXIS_TICK_MARGIN = 10;

/**
 * recharts' default `tickSize`. The x axis hides its tick LINES
 * (`tickLine={false}`), but recharts still places each label `tickSize` +
 * `tickMargin` away from the axis line.
 */
const RECHARTS_TICK_SIZE = 6;

/**
 * The tick text style every axis this file draws shares (objectui#13129): the
 * theme's muted foreground, as `ChartImpl` paints its ticks. Without a `tick`
 * fill recharts paints tick text in the axis `stroke` default, #666, which on
 * a dark card is about 3:1. The container's
 * `[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground` class does
 * not reach it: recharts 3 renders the text under
 * `.recharts-cartesian-axis-tick-label`, not under
 * `.recharts-cartesian-axis-tick`, and polar axes match neither. Only the
 * fill: the font size stays `ChartContainer`'s `text-xs`.
 */
const AXIS_TICK_STYLE = { fill: 'hsl(var(--muted-foreground))' };

/** The axis tick text's font size: `ChartContainer`'s `text-xs`. */
const AXIS_TICK_FONT_PX = 12;

/**
 * The advance, in em, {@link estimateLabelWidthPx} charges one glyph that is
 * not wide: about the all-capitals advance of the sans fonts the tick text
 * inherits, so it over-charges a mixed-case label rather than under-charging
 * a capitalised one. A deliberate upper estimate, not a measurement of any
 * one font: the tick text has no width before it is painted, and recharts'
 * own measuring helper is not part of its public API.
 */
const NARROW_GLYPH_EM = 0.65;

/** Glyphs set a full em wide: CJK ideographs, kana, Hangul, full-width forms. */
const WIDE_GLYPH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

/** An upper estimate of one tick label's painted width, in px. */
function estimateLabelWidthPx(label: string): number {
  let ems = 0;
  for (const glyph of label) ems += WIDE_GLYPH.test(glyph) ? 1 : NARROW_GLYPH_EM;
  return ems * AXIS_TICK_FONT_PX;
}

/** recharts' default chart margin, left plus right (5px each side). */
const CHART_MARGIN_X_PX = 10;

/**
 * The inset, in px, a line or area chart's categorical x axis keeps at BOTH
 * ends of the plot (objectui#13390).
 *
 * ## What it fixes
 *
 * On a line or area chart recharts draws a categorical x axis as a POINT
 * scale: the first category sits ON the plot's left edge and the last ON its
 * right edge, and each tick label is centred on its point. With no value axis
 * beside it, the right edge has only recharts' 5px chart margin before the
 * chart surface ends, so the right half of the last label is cut off: the
 * showcase's monthly trend charts drew "2026-10" as "2026". The tick text in
 * the DOM is whole; only the painted part is lost. A bar chart's axis is a
 * BAND scale, which centres each category in its band, so it never had this.
 *
 * ## Why `padding`
 *
 * Recharts' axis `padding` insets the pixel range the points are laid along
 * (`[left + padding.left, right - padding.right]`) and leaves the categories
 * alone, the same mechanism the scatter axes use for their edge marks
 * (`SCATTER_AXIS_EDGE_PADDING`). It moves the edge points, and the lines and
 * dots drawn on them, inward together, so a label stays centred on its point.
 * Both ends, because a lone value axis declared on the right leaves the FIRST
 * label just as exposed on the left.
 *
 * ## Why this size
 *
 * Half of a `YYYY-MM` label, the bucket a monthly trend chart draws, at the
 * tick font, by the same upper estimate the rotated band is sized from
 * ({@link estimateLabelWidthPx}), less the chart margin already on that side.
 * A fixed figure, not one sized from each chart's labels, so every line and
 * area chart lays out the same way. It is not a bound on every label: a long
 * name drawn unrotated on the last point (its band was wide enough to hold
 * it) can still overhang by what it exceeds this. A rotated label hangs left
 * of its point, and above `X_AXIS_ALL_LABELS_MAX_BUCKETS` recharts' own
 * `preserveStartEnd` pulls the edge labels inside the plot. This figure is
 * derived from recharts' layout, not measured in a browser.
 */
const POINT_X_AXIS_EDGE_PADDING_PX =
  Math.ceil(estimateLabelWidthPx('0000-00') / 2) - CHART_MARGIN_X_PX / 2;
/** A module constant so recharts' axis settings memo is not defeated per render. */
const POINT_X_AXIS_PADDING = {
  left: POINT_X_AXIS_EDGE_PADDING_PX,
  right: POINT_X_AXIS_EDGE_PADDING_PX,
} as const;

/** The width every value axis of the vertical cartesian families draws (`YAxis width={48}`). */
const VALUE_AXIS_WIDTH_PX = 48;

/**
 * Clear space a horizontal x-axis label keeps inside its band, so two
 * neighbouring names never touch (objectui#13241).
 */
const X_LABEL_BAND_GAP_PX = 8;

/**
 * Whether every drawn category label fits its band unrotated (objectui#13241).
 *
 * A band axis gives each category `plotWidth / categories` px. A label fits
 * when its estimated width (the same upper estimate the rotated band is sized
 * from, {@link estimateLabelWidthPx}) plus {@link X_LABEL_BAND_GAP_PX} is no
 * wider than that. Rotation and the 12-character cut are for a band that
 * cannot hold the name — not for a long name on a chart wide enough for it.
 */
function categoryLabelsFitBand(labels: readonly string[], plotWidthPx: number): boolean {
  if (labels.length === 0 || plotWidthPx <= 0) return false;
  const band = plotWidthPx / labels.length;
  const widest = labels.reduce((max, label) => Math.max(max, estimateLabelWidthPx(label)), 0);
  return widest + X_LABEL_BAND_GAP_PX <= band;
}

/**
 * The height the x axis reserves for its rotated labels (objectui#11796),
 * derived from the longest label it draws.
 *
 * A rotated label is anchored at its END (`textAnchor: 'end'`), `tickSize` +
 * `tickMargin` from the axis line, and turned away from the plot, so its
 * START is the part farthest from the plot: the text drops
 * `width · sin(angle)`, plus its line box below the anchor (about 1em: the
 * baseline offset recharts gives a tick's first line, and the descent), turned
 * by the same angle, `1em · cos(angle)`.
 *
 * The fixed 60px this replaced counted the text width alone, so the longest
 * labels the cap above lets through ran past it, and the chart surface cut off
 * the START of each label ("acklog" for Backlog). What the band reserves
 * against what Chromium paints is the harness reading recorded on
 * objectui#11796's pull request, taken once and not re-derived here;
 * `AdvancedChartImpl.rotatedLabelBand-11796.test.tsx` pins the band itself.
 */
function rotatedXAxisHeight(labels: readonly string[]): number {
  const rad = (ROTATED_X_LABEL_ANGLE * Math.PI) / 180;
  const widest = labels.reduce((max, label) => Math.max(max, estimateLabelWidthPx(label)), 0);
  return Math.ceil(
    RECHARTS_TICK_SIZE + X_AXIS_TICK_MARGIN + AXIS_TICK_FONT_PX * Math.cos(rad) + widest * Math.sin(rad),
  );
}

/**
 * Symbol AREA budget the scatter's edge margin below is sized against, in px².
 *
 * ⚠️ A HEADROOM figure, ⛔ NOT a reading of what the chart paints. Recharts
 * paints a scatter mark as a circle of `sqrt(area / PI)` and chooses that area
 * itself: nothing in this file and no authored metadata sets it, so every mark
 * is drawn at recharts' own implicit default and the budget here is
 * deliberately well above it. The size actually painted is measured off the
 * rendered symbol by `AdvancedChartImpl.scatterSymbolSize-9681.test.tsx` —
 * read that, never this number, for what the marks are.
 *
 * Kept as a named number because the padding below is derived from it rather
 * than guessed, and kept at THIS value rather than lowered to what is painted:
 * it is the envelope a variable-area scatter would have to stay inside, so the
 * margin already survives the day mark area becomes variable (objectui#9681).
 */
const SCATTER_SYMBOL_MAX_AREA = 400;

/**
 * Margin, in px, that each scatter numeric axis reserves at BOTH ends so an
 * extreme mark is drawn WHOLLY inside the plot area (objectui#7396).
 *
 * ## What it fixes
 *
 * Both scatter axes are numeric with no explicit domain, so recharts fits the
 * domain to `[dataMin, dataMax]` and maps it across the WHOLE plot box. A row
 * at either extreme is therefore CENTRED on the boundary and half its symbol
 * paints outside the plot area. Measured on the Chart Gallery scatter
 * ("Estimate vs Progress") in real Chromium — viewport 1440, widget svg
 * 510x350, plot area x 53..505 / y 5..296 — marks landed at cx 53, 256.4,
 * 301.6, 414.6, 459.8, 505 and the y-max row at cy 5: the first and last on the
 * x boundary, the y-max one on the top boundary, each overhanging by its own
 * radius. It is BOTH axes, not just the x the card measured.
 *
 * ## Why `padding` and not `domain`
 *
 * Recharts' axis `padding` insets the pixel RANGE the scale maps into — the
 * axis range becomes `[left + padding.left, right - padding.right]` — and
 * leaves the domain alone, so every tick VALUE is unchanged and only the
 * mapping moves. Moving the domain instead would both invent unround tick
 * endpoints and spend the very prop the scatter's spec-axis derivation needs
 * (objectui#9675): a spec-derived domain and a padding domain would be one
 * recharts prop, and whichever landed second would shadow the other. Reserving
 * the margin kept that prop free — objectui#9675 has since landed and spends
 * `domain` on both scatter axes, so the two are live at once and compose.
 *
 * ## Why this size
 *
 * `sqrt(SCATTER_SYMBOL_MAX_AREA / PI)`, rounded up — the largest radius that
 * budget admits. It is deliberately the budget and ⛔ not the radius observed
 * today: recharts chooses the symbol area itself and nothing here or in
 * authored metadata moves it, so sizing this margin to what is painted would
 * tie the fix to a third-party default AND reopen the defect the day mark area
 * becomes variable. That the painted radius still fits inside this margin is
 * asserted, not assumed — `AdvancedChartImpl.scatterSymbolSize-9681.test.tsx`
 * reads both off the same render, so the two cannot drift apart in silence.
 *
 * ## Why these are module constants and not inline objects
 *
 * Recharts memoises each axis's settings object on its props and dispatches a
 * `replaceXAxis` / `replaceYAxis` when that object changes; a fresh literal per
 * render would defeat the memo and re-register the axis on every render.
 */
const SCATTER_AXIS_EDGE_PADDING = Math.ceil(Math.sqrt(SCATTER_SYMBOL_MAX_AREA / Math.PI));
const SCATTER_X_AXIS_PADDING = {
  left: SCATTER_AXIS_EDGE_PADDING,
  right: SCATTER_AXIS_EDGE_PADDING,
} as const;
const SCATTER_Y_AXIS_PADDING = {
  top: SCATTER_AXIS_EDGE_PADDING,
  bottom: SCATTER_AXIS_EDGE_PADDING,
} as const;

/**
 * How a spec `ChartAxis.title` is laid out, per axis orientation.
 *
 * Both are a recharts `label` object minus its `value`. A y-axis title reads up
 * the left edge, an x-axis title along the bottom — the same two layouts this
 * file already used, named here because one derivation now serves both
 * orientations (objectui#9675).
 */
const Y_AXIS_TITLE_LAYOUT = { angle: -90, position: 'insideLeft' } as const;
const X_AXIS_TITLE_LAYOUT = { position: 'insideBottom', offset: -4 } as const;
/**
 * The x-axis title of an axis drawn along the TOP (objectui#10587): the
 * bottom layout mirrored, so the title sits on the far side of the tick labels
 * from the plot, as it does below a bottom axis. `insideBottom` on a top axis
 * would put it between the ticks and the plot.
 */
const X_AXIS_TOP_TITLE_LAYOUT = { position: 'insideTop', offset: -4 } as const;

/** The x-axis title layout for the side {@link placeXAxis} put the axis on. */
function xAxisTitleLayoutFor(across: 'top' | 'bottom' | undefined) {
  return across === 'top' ? X_AXIS_TOP_TITLE_LAYOUT : X_AXIS_TITLE_LAYOUT;
}
/**
 * The title of an axis running up the plot and drawn on the RIGHT
 * (objectui#10654): the left layout mirrored, as a top x axis mirrors the
 * bottom one, so the title sits on the far side of the tick labels from the
 * plot. `insideLeft` on a right-hand axis put it between the plot and the tick
 * labels (measured in the DOM test env: the title at x=462, the right-hand
 * tick labels starting at x=465).
 */
const Y_AXIS_RIGHT_TITLE_LAYOUT = { angle: 90, position: 'insideRight' } as const;

/** The title layout for an axis running up the plot, on the side it is drawn. */
function yAxisTitleLayoutFor(side: 'left' | 'right' | undefined) {
  return side === 'right' ? Y_AXIS_RIGHT_TITLE_LAYOUT : Y_AXIS_TITLE_LAYOUT;
}

/** Every title layout this file hands a recharts axis `label`. */
type AxisTitleLayout =
  | typeof Y_AXIS_TITLE_LAYOUT
  | typeof Y_AXIS_RIGHT_TITLE_LAYOUT
  | typeof X_AXIS_TITLE_LAYOUT
  | typeof X_AXIS_TOP_TITLE_LAYOUT;

/** The four sides the spec `ChartAxis.position` enumerates. */
type AxisSide = 'left' | 'right' | 'top' | 'bottom';

/**
 * Where the spec `xAxis` is drawn, read from its `position` (objectui#10587).
 *
 * The spec declares `position` on `ChartAxisSchema` for both axes, and the
 * docs row says it names "the side of the chart the axis belongs to". Which two
 * sides are open to the x axis depends on which way that axis runs, and the
 * answer is read off the branches below rather than decided here:
 *
 *   - **bar / line / area / combo / scatter** draw the spec `xAxis` as a
 *     recharts `<XAxis>` running ACROSS the plot (scatter's is a number axis,
 *     the rest a category band), so `top` / `bottom` are its sides.
 *   - **horizontal-bar** swaps the axis roles. Its categories run DOWN the plot
 *     on a `<YAxis type="category">`, and the spec `yAxis` configures its
 *     number `<XAxis>` (`yAxisSpecProps(primaryY)` in that branch). The `xAxis`
 *     object already follows the categories there — its `format` is that
 *     `<YAxis>`'s tick formatter — so its `position` follows them too, and
 *     `left` / `right` are its sides. Reading it as "the horizontal axis"
 *     instead would split one axis object across two drawn axes.
 *
 * A side the axis cannot take is REFUSED, not dropped and not guessed at: the
 * axis draws at its default side (the bottom; the left on horizontal-bar) and
 * the chart carries {@link xAxisPositionNote}. ⛔ Never mapped to a "nearest"
 * open side: `left` names no side of an axis that runs across the plot, and
 * any side chosen for it would be one the author did not write.
 *
 * No `position` returns nothing, so no `orientation` prop is emitted and a chart
 * that declares none renders exactly as it did before.
 */
function placeXAxis(
  position: AxisSide | undefined,
  categoriesRunDown: boolean,
): { across?: 'top' | 'bottom'; down?: 'left' | 'right'; refused?: AxisSide } {
  if (!position) return {};
  if (categoriesRunDown) {
    return position === 'left' || position === 'right' ? { down: position } : { refused: position };
  }
  return position === 'top' || position === 'bottom' ? { across: position } : { refused: position };
}

/**
 * The note a cartesian chart carries when its `xAxis.position` names a side
 * that axis cannot take — see {@link placeXAxis}. `null` otherwise, which keeps
 * every other chart's DOM unchanged (`ChartFootnote` with no note returns its
 * children as they are).
 *
 * The chart still draws: the axis sits at its default side, and every other
 * key on the axis object is honoured. That is why this is a note in the
 * `ChartFootnote` channel the file's other partial answers use, and not a
 * `ChartRefusal`, which replaces the whole tile — a refusal there would blank a
 * chart that plots correctly over one presentation key. No console warning
 * either, for the reason the other notes give: the sentence already names the
 * key, the value and the side the axis was drawn on.
 */
function xAxisPositionNote(refused: AxisSide | undefined, categoriesRunDown: boolean): React.ReactNode {
  if (!refused) return null;
  return (
    <p role="note" data-chart-note="x-axis-position" className="px-1 text-xs text-muted-foreground">
      <code className="font-mono">xAxis.position</code> is{' '}
      <code className="font-mono">{refused}</code> &mdash;{' '}
      {categoriesRunDown ? (
        <>this chart&apos;s categories run down its side, so its x axis sits on the left or the right. It is drawn on the left.</>
      ) : (
        <>this chart&apos;s x axis runs across it, so it sits at the top or the bottom. It is drawn at the bottom.</>
      )}
    </p>
  );
}

/**
 * The side a value-axis slot is drawn on — the slot itself up the side of the
 * plot, the transposed side on `horizontal-bar` (see `ValueAxisSlot`).
 */
function valueAxisSide(slot: ValueAxisSlot, valueAxesRunAcross: boolean): 'left' | 'right' | 'top' | 'bottom' {
  if (!valueAxesRunAcross) return slot;
  return slot === 'left' ? 'bottom' : 'top';
}

/** "on the left" / "at the bottom" — how the notes below say where an axis sits. */
function onSide(side: 'left' | 'right' | 'top' | 'bottom'): string {
  return side === 'left' || side === 'right' ? `on the ${side}` : `at the ${side}`;
}

/**
 * The value axis a chart's grid and annotations are measured against
 * (objectui#10654).
 *
 * Recharts binds a `<CartesianGrid>`, `<ReferenceLine>` or `<ReferenceArea>`
 * to axis id `0` on both sides unless told otherwise. A branch that renders
 * its value axes WITH ids — a combo always, bar / line / area /
 * horizontal-bar when two `yAxis` entries are declared — renders no value axis
 * `0`, and what was bound to it did not draw as bound. Measured before this
 * binding (a historical reading; row 11 of
 * `ChartRenderer.yAxisPosition-10654.test.tsx` is the instrument): on a
 * two-entry bar chart the horizontal grid drew 2 lines instead of one per
 * value tick, and an `axis: 'x'` annotation was dropped; on a combo with fewer
 * than two entries every annotation was dropped; on a two-entry horizontal-bar
 * an `axis: 'y'` annotation, bound to a `yAxisId` its category axis does not
 * carry, was dropped. They bind to the `'left'` slot: a `<YAxis>` up the side
 * of the plot, an `<XAxis>` across it on horizontal-bar, whose category axis
 * carries no id. A lone value axis carries no id, so nothing is bound.
 *
 * Module constants, so a caller that spreads the answer is handed the same
 * object every render.
 */
const NO_VALUE_AXIS_ID = {} as const;
const LEFT_Y_VALUE_AXIS_ID = { yAxisId: 'left' } as const;
const LEFT_X_VALUE_AXIS_ID = { xAxisId: 'left' } as const;
function valueAxisIdFor(valueAxesHaveIds: boolean, valueAxesRunAcross: boolean) {
  if (!valueAxesHaveIds) return NO_VALUE_AXIS_ID;
  return valueAxesRunAcross ? LEFT_X_VALUE_AXIS_ID : LEFT_Y_VALUE_AXIS_ID;
}

/**
 * The notes a cartesian chart carries for each `yAxis` entry whose `position`
 * was not honoured — see `placeYAxes`. `null` when every entry was drawn where
 * it asked (or asked nothing), which keeps that chart's DOM unchanged.
 *
 * The x-axis note's channel and reasoning, applied to the y side
 * (objectui#10654): the chart still draws with every entry on an axis, so
 * this is a `ChartFootnote` note and not a `ChartRefusal`, and it names the
 * key, the value and the side the axis was drawn on instead.
 */
function yAxisPositionNotes(placement: YAxisPlacement, valueAxesRunAcross: boolean): React.ReactNode {
  if (placement.notes.length === 0) return null;
  const open = valueAxesRunAcross
    ? "this chart's value axes run across it, so each sits at the bottom or the top."
    : "this chart's value axes run up its side, so each sits on the left or the right.";
  return joinNotes(
    ...placement.notes.map((note) => {
      const drawn = onSide(valueAxisSide(note.drawn, valueAxesRunAcross));
      return (
        <p key={note.index} role="note" data-chart-note="y-axis-position" className="px-1 text-xs text-muted-foreground">
          <code className="font-mono">{`yAxis[${note.index}].position`}</code> is{' '}
          <code className="font-mono">{note.position}</code> &mdash;{' '}
          {note.reason === 'side' ? (
            <>{open} It is drawn {drawn}.</>
          ) : (
            <>
              <code className="font-mono">yAxis[0]</code> already sits {onSide(note.position)}, so this axis is
              drawn {drawn}.
            </>
          )}
        </p>
      );
    }),
  );
}

/**
 * The notes a cartesian chart carries for each `yAxis` entry drawn on no axis
 * — every entry after the second (after the first on `scatter`),
 * `placeYAxes`'s `undrawn` list (objectui#10691, objectui#10721). `null` when
 * there is none, which keeps every chart of two entries or fewer (one on
 * `scatter`), and every family that places no value axis, unchanged.
 *
 * The spec declares `yAxis` uncapped, so the entry is valid and the count is
 * not narrowed; the chart draws with its value axes, so this is a
 * `ChartFootnote` note like the position notes above, not a `ChartRefusal`.
 * It names the entry and, from the same placement the normalizer binds with,
 * the axis a series derived from it is plotted against — the entry drawn in
 * that slot. A field-less entry derives no series, so its note says only that
 * it is not drawn.
 *
 * On `scatter` the note names the entry and the one axis drawn, and nothing
 * about a derived series: a scatter plots one measure, so with neither
 * `series` nor `categories` two fielded entries are refused whole
 * (`SeriesArityRefusal`) rather than plotted, and the two-slot sentence's
 * "its field is plotted against" would be false there.
 */
function yAxisUndrawnNotes(
  placement: YAxisPlacement,
  yAxes: readonly NormalizedAxis[] | undefined,
  valueAxesRunAcross: boolean,
): React.ReactNode {
  if (placement.undrawn.length === 0) return null;
  // An entry is undrawn only once every slot is taken, so `slotOf` holds
  // exactly the value axes this chart draws: one on `scatter`, two elsewhere.
  const oneValueAxis = placement.slotOf.length === 1;
  const sides = valueAxesRunAcross ? 'one at the bottom and one at the top' : 'one on each side';
  return joinNotes(
    ...placement.undrawn.map((note) => {
      const against = placement[note.boundTo];
      if (oneValueAxis) {
        return (
          <p key={note.index} role="note" data-chart-note="y-axis-undrawn" className="px-1 text-xs text-muted-foreground">
            <code className="font-mono">{`yAxis[${note.index}]`}</code> is not drawn &mdash; this chart draws one
            value axis
            {against !== undefined ? (
              <>
                , <code className="font-mono">{`yAxis[${against}]`}</code>
              </>
            ) : null}
            .
          </p>
        );
      }
      const field = yAxes?.[note.index]?.field;
      return (
        <p key={note.index} role="note" data-chart-note="y-axis-undrawn" className="px-1 text-xs text-muted-foreground">
          <code className="font-mono">{`yAxis[${note.index}]`}</code> is not drawn &mdash; this chart draws at most two
          value axes, {sides}.
          {field ? (
            <>
              {' '}When the chart declares neither <code className="font-mono">series</code> nor{' '}
              <code className="font-mono">categories</code>, its field <code className="font-mono">{field}</code> is
              plotted against the axis {onSide(valueAxisSide(note.boundTo, valueAxesRunAcross))}
              {against !== undefined ? (
                <>
                  , <code className="font-mono">{`yAxis[${against}]`}</code>
                </>
              ) : null}
              .
            </>
          ) : null}
        </p>
      );
    }),
  );
}

/**
 * Several notes for one `ChartFootnote`. With one note (or none) it returns that
 * note itself, so a chart that already carried a single note keeps its exact DOM.
 */
function joinNotes(...notes: React.ReactNode[]): React.ReactNode {
  const present = notes.filter((n) => n != null && n !== false);
  if (present.length <= 1) return present[0] ?? null;
  return <>{present.map((n, i) => <React.Fragment key={i}>{n}</React.Fragment>)}</>;
}

/**
 * Recharts props derived from one spec axis that plots NUMBERS — the domain
 * from `min`/`max`, the ticks from `stepSize`, the scale from `logarithmic`
 * and the label from `title`.
 *
 * `values` is every number plotted on that axis: the population `stepSize`
 * lays its ticks over. It is a parameter rather than derived here because the
 * callers read different columns — a y-axis's numbers come from the series
 * bound to its side, and the scatter x-axis's from `xAxisKey`, which is a
 * measure on that one family (objectui#9675).
 *
 * At module scope, and a plain function: it closes over nothing, so there is
 * no identity for a caller to depend on and nothing for a hook to recompute.
 */
function numericAxisSpecProps(
  axis: NormalizedAxis | undefined,
  values: number[],
  labelLayout: AxisTitleLayout,
) {
  if (!axis) return {};
  const domain = domainFor(axis);
  const ticks = ticksFor(axis, values);
  return {
    ...(ticks ? { ticks } : {}),
    ...(domain ? { domain } : {}),
    // `allowDataOverflow` is what makes an explicit domain actually clip
    // rather than being silently widened to fit the data.
    ...(domain ? { allowDataOverflow: true } : {}),
    ...(axis.logarithmic ? { scale: 'log' as const, domain: domain ?? ([1, 'auto'] as any) } : {}),
    ...(axis.title ? { label: { value: axis.title, ...labelLayout } } : {}),
  };
}

/**
 * Treemap leaf cell — paints each leaf rect with its palette fill + label.
 * Hoisted to module scope so it is a stable component reference rather than one
 * re-created on every AdvancedChartImpl render (react-hooks/static-components).
 * It is purely props-driven: Recharts injects the cell geometry (x/y/width/
 * height) and datum (name/fill) as props, so no render-scope closure is needed.
 */
function TreemapCell(props: any) {
  const { x, y, width, height, name, fill } = props;
  if (width <= 0 || height <= 0) return null;
  return (
    <g>
      <rect x={x} y={y} width={width} height={height} fill={fill} stroke="hsl(var(--background))" strokeWidth={2} />
      {width > 48 && height > 18 ? (
        <text x={x + 6} y={y + 18} fill="#fff" fontSize={12} className="pointer-events-none">{name}</text>
      ) : null}
    </g>
  );
}

/**
 * Text that stays legible on a coloured mark AND on the bare chart background
 * (objectui#13404): foreground ink inside a background-coloured halo. The halo
 * is painted first (`paintOrder: stroke`), so the glyphs sit on top of it.
 *
 * A single contrasting fill cannot do this. A white label reads on a segment
 * and vanishes the moment it is wider than the segment, which the narrowest
 * funnel stage always is for a long stage name; a dark label vanishes on a
 * dark-theme segment. Both colours are theme tokens, so dark mode flips the
 * pair instead of keeping a light-mode colour.
 */
const HALO_LABEL_PROPS = {
  fill: 'hsl(var(--foreground))',
  stroke: 'hsl(var(--background))',
  strokeWidth: 3,
  strokeLinejoin: 'round' as const,
  paintOrder: 'stroke',
  fontSize: 12,
};

/** A sankey node's colour when it carries none: the root, which is the total, not a category. */
const SANKEY_ROOT_FILL = 'hsl(var(--muted-foreground))';
/** How far a sankey node's name sits from the node's edge. */
const SANKEY_LABEL_GAP = 6;
/** Links overlap where they leave the root, so each is translucent enough to show the one beneath. */
const SANKEY_LINK_OPACITY = 0.4;

/** A node of the sankey arm's data: its name, plus the palette colour the arm chose for it. */
type SankeyArmNode = SankeyNode & { fill?: string };

/**
 * Sankey node — the node's rect plus its NAME (objectui#13404).
 *
 * Recharts draws a node from a plain-object `node` prop as a bare rectangle
 * with no text, so a sankey could not be read without hovering every bar.
 * This draws the name beside the node: to its right, or to its LEFT for a node
 * with no outgoing link. With `align: 'justify'` (the default this arm keeps)
 * those are exactly the nodes in the last column, flush with the chart's right
 * edge, where a name drawn to the right would run off the surface.
 *
 * Module scope, like `TreemapCell`, for the same reason, and for one more:
 * Recharts lists `node` and `link` in the dependency array of the memo that
 * lays the whole chart out, so a function re-created on every render would
 * redo the layout on every render.
 */
function SankeyNodeShape(props: SankeyNodeProps) {
  const { x, y, width, height } = props;
  const node = props.payload as SankeyArmNode;
  const isLastColumn = !(node?.targetNodes?.length > 0);
  return (
    <g>
      <rect className="recharts-sankey-node" x={x} y={y} width={width} height={height} fill={node?.fill ?? SANKEY_ROOT_FILL} />
      <text
        className="recharts-sankey-node-label pointer-events-none"
        x={isLastColumn ? x - SANKEY_LABEL_GAP : x + width + SANKEY_LABEL_GAP}
        y={y + height / 2}
        textAnchor={isLastColumn ? 'end' : 'start'}
        dominantBaseline="central"
        {...HALO_LABEL_PROPS}
      >
        {node?.name}
      </text>
    </g>
  );
}

/**
 * Sankey link — the curve Recharts' default draws, stroked in the colour of the
 * node it flows INTO (objectui#13404).
 *
 * Every link used to be one `muted-foreground` grey, so a reader could not
 * follow a flow from the root to its category. The colour is the TARGET's
 * rather than the source's because of this arm's shape: every link leaves the
 * same root node, so a source colour would paint them all one colour again,
 * which is the defect. The target is the category the link carries, so a link
 * and the node it ends in share one palette colour.
 */
function SankeyLinkShape(props: SankeyLinkProps) {
  const { sourceX, sourceY, sourceControlX, targetX, targetY, targetControlX, linkWidth } = props;
  const target = props.payload?.target as SankeyArmNode | undefined;
  return (
    <path
      className="recharts-sankey-link"
      d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
      fill="none"
      stroke={target?.fill ?? SANKEY_ROOT_FILL}
      strokeWidth={linkWidth}
      strokeOpacity={SANKEY_LINK_OPACITY}
    />
  );
}

/**
 * The sankey's omitted-rows sentence, from the locale packs
 * (`chart.sankeyOmittedRows`, objectui#13404). It was JSX text, so a zh-CN
 * session read it in English.
 *
 * `createSafeTranslation` rather than the file's `useSafeTranslate`: the
 * sentence agrees with a COUNT ("1 row has" / "2 rows have"), so it is an
 * i18next count family and the call has to pass `count`, which
 * `useSafeTranslate` cannot. This defaults map is also what a host without an
 * `I18nProvider` renders, and it picks the `_one` / `_other` row the same way
 * i18next does, so that English agrees with itself too. Each row must stay
 * byte-identical to the `en` pack; `AdvancedChartImpl.sankeyFunnelLabels-13404.test.tsx`
 * holds them together.
 */
const useSankeyNoteTranslation = createSafeTranslation(
  {
    'chart.sankeyOmittedRows': 'Showing {{shown}} of {{total}} rows — {{count}} rows have no {{field}} above zero, which a flow cannot draw.',
    'chart.sankeyOmittedRows_one': 'Showing {{shown}} of {{total}} rows — {{count}} row has no {{field}} above zero, which a flow cannot draw.',
    'chart.sankeyOmittedRows_other': 'Showing {{shown}} of {{total}} rows — {{count}} rows have no {{field}} above zero, which a flow cannot draw.',
  },
  'chart.sankeyOmittedRows',
);

/**
 * The private-use mark interpolated into `{{field}}`. The measure key is drawn
 * as a `<code>` chip, which cannot be interpolated as text, and cutting the
 * sentence in two around it would fix every language to English word order.
 * So the translated sentence is split on this mark and the chip goes where the
 * language put it — the `withChips` construction `metadata-viewer` uses.
 */
const FIELD_CHIP_MARK = '';

function SankeyOmittedRowsNote({ shown, total, dataKey }: { shown: number; total: number; dataKey: string }) {
  const { t } = useSankeyNoteTranslation();
  const sentence = String(
    t('chart.sankeyOmittedRows', { count: total - shown, shown, total, field: FIELD_CHIP_MARK }),
  );
  return (
    <p role="note" data-chart-note="omitted-rows" className="px-1 text-xs text-muted-foreground">
      {sentence.split(FIELD_CHIP_MARK).map((part, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <code className="font-mono">{dataKey}</code> : null}
          {part}
        </React.Fragment>
      ))}
    </p>
  );
}

/**
 * Renders the spec's `ChartConfig.title` / `.subtitle` above the plot.
 *
 * Both were previously accepted by the contract and drawn by nothing — `title`
 * only ever reached the drill-down drawer's heading. With neither set this
 * returns the chart untouched, so no existing caller gains a wrapper element.
 */
function ChartFrame({ title, subtitle, children }: { title?: string; subtitle?: string; children: React.ReactNode }) {
  if (!title && !subtitle) return <>{children}</>;
  return (
    <div className="flex h-full w-full flex-col">
      <div className="mb-2 shrink-0">
        {title ? <div className="text-sm font-medium leading-tight text-foreground">{title}</div> : null}
        {subtitle ? <div className="text-xs leading-tight text-muted-foreground">{subtitle}</div> : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * `ChartFrame`'s mirror image: chrome BELOW the plot, for a chart that drew
 * something but did not draw all of it (objectui#7148).
 *
 * Same construction, and deliberately so, because the construction is the whole
 * difficulty. A footnote cannot simply be rendered as a SIBLING of
 * `ChartContainer`: measured in Chromium in the dashboard shape — a fixed,
 * clipping card whose chart carries `h-full` — the container takes the card's
 * full height and a following `<p>` lands at y=327 in a box that ends at y=316,
 * i.e. entirely outside the clip. A note invisible in dashboards is no note at
 * all, and dashboards are where these charts live.
 *
 * Nor can it be a plain wrapper `<div className={className}>` around the
 * container: the consumer's className is the chart's height contract and it has
 * to keep reaching the element Recharts measures (see `CHART_MIN_HEIGHT` in
 * `ChartContainerImpl` for the measurement of what happens when it does not —
 * a permanently zero box and an invisible chart, with no refusal and no empty
 * state).
 *
 * So the plot keeps its own `className` and gains a definite height through the
 * flex chain instead: `h-full` outer, `min-h-0 flex-1` around the plot,
 * `shrink-0` under it. With no footnote this returns the chart untouched, so no
 * existing caller gains a wrapper element — the same gate `ChartFrame` uses.
 */
function ChartFootnote({ note, children }: { note?: React.ReactNode; children: React.ReactNode }) {
  if (!note) return <>{children}</>;
  return (
    <div className="flex h-full w-full flex-col">
      <div className="min-h-0 flex-1">{children}</div>
      <div className="mt-1 shrink-0">{note}</div>
    </div>
  );
}

/**
 * How many rows a MAGNITUDE chart can actually give area to (objectui#7147).
 *
 * ## The third mechanism, and why neither landed answer reaches it
 *
 * Three distinct mechanisms on this surface produce ONE reader-facing symptom —
 * a tile that says nothing, or says something false, about rows it was handed:
 *
 *   - an early return that emits a bare `div`  — objectui#7140 / objectui#7146
 *   - a silent row DROP before the plot        — objectui#7148
 *   - DEGENERATE GEOMETRY, which is this one   — objectui#7147
 *
 * The rows here are never filtered. `data` reaches `<Pie>`, `<Funnel>` and
 * `<Treemap>` whole — the sankey arm's is the only row-dropping filter in this
 * file — and what happens instead is that a row whose measure is not above zero
 * is given no area. objectui#7148's count (`data.length - rows.length`) is
 * therefore exactly ZERO against these three families, so hoisting that
 * footnote here would render nothing at all while looking like coverage. Zero
 * area is not zero elements, and neither is a dropped row.
 *
 * ## The measurement that decided fix-over-decline, per family
 *
 * 56 tiles in real Chromium (`/opt/pw-browsers/chromium`) at `origin/main`
 * 40c4711d6 — six families x nine datasets — each tile screenshotted, MD5'd,
 * and pixel-diffed against a literally empty `div` of the same 520x240 box.
 * `measured-and-declined` was genuinely on the table for all three families,
 * as the card says, and survived for none of them:
 *
 *   - pie / donut, all-zero, all-null, all-negative: ZERO non-white pixels out
 *     of 124,800. Not blank-LOOKING — byte-identical to the empty div, while
 *     the DOM carried 31 descendants and a real `svg`.
 *   - pie / donut, `40` beside a `null`: a FULL circle in the first category's
 *     colour, 99.35% pixel-identical to a legitimately one-row dataset (diff
 *     0.654%, and that residue is the `paddingAngle` hairline, not
 *     information). The picture asserts "Alpha is 100%" of a dataset in which
 *     Beta was never measured at all.
 *   - funnel, `40` beside a `null`: 178 ink pixels — ZERO segments and ONE
 *     label, and the label is "Beta", the row with NO value. The row carrying
 *     40 draws nothing whatsoever.
 *   - funnel, all-negative: a large, healthy-looking two-band funnel whose mark
 *     area (220,320) EXCEEDS the all-positive control's (111,881).
 *   - treemap, `40` beside a `null`, `40` beside a `0`, and mixed-sign
 *     `40 / -25 / -12`: all three BYTE-IDENTICAL (diff 0.000%) to a genuinely
 *     one-row treemap — one full-bleed leaf labelled "Alpha". Four datasets,
 *     one image.
 *   - treemap, all-zero: one full-bleed leaf labelled "Beta" — the LAST
 *     category — asserting that one of two equal-zero categories is the entire
 *     composition.
 *
 * The controls are what make those zeros readable. On the same instrument an
 * all-zero BAR drew 5,128 ink pixels of axes and ticks — which is why bar is
 * deliberately NOT touched here: its reader can already tell. A two-row pie
 * differed from a one-row pie by 9.683% of its pixels and a two-row treemap
 * from a one-row treemap by 38.301%, so the instrument separates these datasets
 * easily whenever the renderer does.
 *
 * ## Why the predicate is `> 0`, and why the copy names it
 *
 * The reason `no-positive-flow`'s docstring gives. Five shapes reach here — a
 * genuine zero, a negative, `null`, an unparseable string, and a missing key —
 * and naming any ONE of them is a sentence that is false for the other four.
 * A strictly positive, finite measure is the single test all three families'
 * layouts effectively apply, so the copy names THAT.
 *
 * `Number.isFinite(v) && v > 0` rather than the sankey arm's `Number(...) || 0`
 * idiom: this predicate must also reject `Infinity`, which has no finite area
 * to occupy anywhere and which `|| 0` lets straight through.
 */
function countSizableRows(rows: unknown[], dataKey: string): { sizable: number; total: number } {
  let sizable = 0;
  for (const row of rows) {
    const v = Number((row as Record<string, unknown> | null | undefined)?.[dataKey]);
    if (Number.isFinite(v) && v > 0) sizable += 1;
  }
  return { sizable, total: rows.length };
}

/**
 * The refusal a magnitude chart renders when NO row can be sized.
 *
 * The same shell and the same shape of sentence as `no-positive-flow`, and
 * deliberately a DIFFERENT code: that one is the sankey arm's and answers rows
 * being DROPPED, this one answers geometry that collapses with every row still
 * present. Sharing a code would make the two indistinguishable to the pins that
 * exist to keep them apart.
 *
 * Callers gate it on `total > 0`, for the reason objectui#7146 gives: handed NO
 * rows, "no row's measure is above zero" is a sentence about rows that do not
 * exist. That is the empty-RESULT question (objectui#7130), answered upstream in
 * `ObjectChart` where the query outcome is known — so every no-rows tile is left
 * byte-for-byte as it was.
 */
function MagnitudeRefusal({ dataKey, className }: { dataKey: string; className?: string }) {
  return (
    <ChartRefusal code="no-positive-magnitude" className={className}>
      This chart has nothing to size: no row&apos;s{' '}
      <code className="font-mono">{dataKey}</code> is above zero.
    </ChartRefusal>
  );
}

/**
 * The note a magnitude chart carries when SOME rows can be sized and some cannot.
 *
 * Returns `null` when every row is sizable, and that is the gate which keeps
 * healthy charts byte-identical: `ChartFootnote` with no note renders its
 * children untouched, so no existing caller gains a wrapper element.
 *
 * ## Why it does NOT say "showing N of M rows"
 *
 * objectui#7148's sankey note can say that, because there the missing rows are
 * genuinely absent from the plot. Here they are not. A mixed-sign pie PAINTS a
 * sector for every row — measured: `40 / -25 / -12` drew 3 sectors — it just
 * paints them at a scale that means nothing, and a funnel handed the same rows
 * drew 3 trapezoids. "Showing 1 of 3" would be a false statement about what is
 * on the screen. What IS true of every one of them is that the chart sizes by
 * value and these rows carry no value it can size, so that is what the copy
 * says.
 *
 * `rows` is an unconditional plural because the note cannot render with fewer
 * than two: reaching it at all means at least one row was sized (otherwise the
 * refusal returned first) and at least one was not.
 *
 * No console warning, matching the two sankey answers and unlike the two guards
 * at the bottom of this file: those carry a diagnostic PAIR that does not fit on
 * screen, whereas this sentence already names the key, the test it failed, and
 * how many rows failed it.
 */
function unsizedRowsNote(sizable: number, total: number, dataKey: string): React.ReactNode {
  const unsized = total - sizable;
  if (unsized <= 0) return null;
  return (
    <p role="note" data-chart-note="unsized-rows" className="px-1 text-xs text-muted-foreground">
      {unsized} of {total} rows {unsized === 1 ? 'has' : 'have'} no{' '}
      <code className="font-mono">{dataKey}</code> above zero &mdash; this chart sizes by value, so{' '}
      {unsized === 1 ? 'that row is' : 'those rows are'} not drawn to scale.
    </p>
  );
}

/**
 * Whether a value can be PLACED on one of scatter's two numeric axes
 * (objectui#7171).
 *
 * ## Why this is NOT `countSizableRows` with a different name
 *
 * Pie, funnel and treemap size a mark BY its measure, so `> 0` is the whole
 * test there. Scatter plots POSITION: a negative or zero coordinate is
 * perfectly ordinary data — temperatures, profit deltas, a variance around a
 * mean — and mechanically reusing objectui#7147's predicate here would REFUSE
 * correct charts, which is worse than the silence this card was opened about.
 * Measured on the sweep below rather than argued: an all-negative scatter drew
 * 3 of 3 marks, an all-zero scatter drew 2 of 2, and a mixed-sign scatter drew
 * 3 of 3 — three datasets `no-positive-magnitude` would have blanked outright.
 *
 * ## Every clause here was forced by a measurement, not by `Number()`
 *
 * `Number(v)` alone gets three of these WRONG, in both directions, which is why
 * the two rejections below are spelled out and the acceptance is not:
 *
 *   - `null` — `Number(null) === 0`, which is finite, so `Number()` alone calls
 *     it plottable. Recharts draws NOTHING for it (measured: 0 of 2 marks, and
 *     the axis renders no scale at all). REJECTED here.
 *   - `''` — the mirror-image trap. It LOOKS like a null and reads like one,
 *     and `Number('') === 0`. Recharts DOES plot it, at zero (measured: 2 of 2
 *     marks, x ticks `0,1,2,3,4`). So it stays PLOTTABLE: rejecting it would
 *     blank a chart that draws, which is the failure mode this whole guard
 *     exists to avoid.
 *
 * `Number.isFinite` covers the rest as measured: `'10'` plots (2 of 2 marks),
 * `'n/a'` and `'Infinity'` and an absent key do not (0 of 2 each).
 *
 * ## The one shape this predicate deliberately does NOT reject, and why
 *
 * A BOOLEAN coordinate was rejected in the first draft of this function — the
 * browser sweep had measured an all-boolean x drawing 0 of 2 marks, so it
 * looked like a sibling of `null`. Pinning it turned that red: a boolean beside
 * a genuinely numeric row draws EVERY mark (measured: 3 of 3). Recharts needs
 * one real number to build the scale and then coerces the booleans onto it, so
 * whether a boolean places depends on the OTHER rows.
 *
 * Rejecting it is therefore the worse error of the two available. The all-
 * boolean tile would gain a correct refusal, but the mixed tile would gain a
 * footnote reading "2 of 3 rows ... are not drawn" while all three are on
 * screen — a sentence that is simply false about the picture, which is the
 * failure this whole family of answers exists to remove. So this predicate
 * accepts it, and the all-boolean case is answered on the whole dataset
 * instead — `anchorsNumericAxis` / `NumericValueRefusal` (objectui#7195): no
 * row gives the axis a scale, which is true there and never of the mixed tile.
 */
function isPlottableCoord(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  return Number.isFinite(Number(v));
}

/**
 * How many rows scatter can actually PLACE — a point needs BOTH coordinates
 * (objectui#7171).
 *
 * ## The fourth mechanism on this surface
 *
 * Four distinct mechanisms now produce one reader-facing symptom, a tile that
 * says nothing or says something false about the rows it was handed:
 *
 *   - an early return emitting a bare `div`  — objectui#7140 / objectui#7146
 *   - a silent row DROP before the plot      — objectui#7148
 *   - degenerate GEOMETRY, magnitude         — objectui#7147
 *   - an unplaceable POINT, position         — this one
 *
 * It is genuinely a fourth. objectui#7147's rows are never filtered and are
 * painted at a meaningless scale; scatter's unplaceable rows are simply ABSENT
 * from the picture — measured, a 3-row dataset with one plottable pair emitted
 * exactly ONE `path.recharts-symbols`. That difference is why this note can
 * honestly say the points are "not drawn" where objectui#7147's deliberately
 * cannot.
 *
 * ## The measurement that decided fix-over-decline
 *
 * 33 tiles in real Chromium (`/opt/pw-browsers/chromium`) at `origin/main`
 * 899730e0a, one page load each, screenshotted, MD5'd and pixel-diffed against
 * a literally empty `div` of the same 520x360 box — a box above the chart's own
 * `CHART_MIN_HEIGHT` floor of 280, without which no footnote is visible at all.
 * The whole reason this card exists is that objectui#7147's sweep read scatter
 * through a SINGLE-measure fixture, so its all-positive control drew zero marks
 * and none of its zeros carried information. This fixture binds both axes and
 * its control DREW: 3 of 3 marks, 245px of mark area. What it then found:
 *
 *   - rows whose x AND y are both unplaceable render BYTE-IDENTICALLY (diff
 *     0.000%) to a scatter handed NO ROWS AT ALL. The reader is shown the
 *     empty-result picture for a query that returned rows.
 *   - `null` x, absent x, `'n/a'` x, `'Infinity'` x, boolean x, and
 *     objectui#7147's own category-column fixture — SIX datasets, ONE image
 *     (`51957063d9c2`): an axis frame with a confident y scale and no marks.
 *     Five of those six are answered below; the boolean one is not answered
 *     HERE, for the reason `isPlottableCoord` gives — `NumericValueRefusal`
 *     answers it on the whole axis (objectui#7195).
 *   - one plottable row among three is 99.75% pixel-identical to a genuinely
 *     one-row scatter (diff 0.250%), the same shape of collision that decided
 *     pie in objectui#7147. Two rows vanish and the picture says "one point".
 *
 * ## Measured and DECLINED, so it is not guarded here
 *
 *   - ZERO VARIANCE — three rows at the same coordinate. A2.3 expected axis
 *     domain collapse; there is none. Recharts pads the domain exactly as it
 *     does for one row (x ticks `0,3,6,9,12` in both), draws 3 symbols, and the
 *     tile is 99.98% identical to a one-row scatter because three coincident
 *     points ARE one dot. That is overplotting, a property of the form itself,
 *     and the picture is TRUE — so there is nothing here to refuse.
 *   - a CONSTANT x or a constant y with the other varying: both draw every
 *     mark, with full scales on both axes.
 */
function countPlottablePoints(
  rows: unknown[],
  xKey: string,
  yKey: string,
): { plottable: number; total: number } {
  let plottable = 0;
  for (const row of rows) {
    const r = row as Record<string, unknown> | null | undefined;
    if (isPlottableCoord(r?.[xKey]) && isPlottableCoord(r?.[yKey])) plottable += 1;
  }
  return { plottable, total: rows.length };
}

/**
 * The refusal scatter renders when NO row can be placed.
 *
 * Its OWN code, for the reason objectui#7147 gives about its own: sharing one
 * with the magnitude families would make the two indistinguishable to the pins
 * that exist to keep them apart, and they answer different questions — that one
 * is about area, this one about position.
 *
 * It names BOTH keys because a point needs both, and it names the PREDICATE
 * rather than a cause: five shapes reach here (a `null`, an absent key, an
 * unparseable string, `Infinity`, and a category column on a numeric axis) and
 * naming any one of them is a sentence false for the other four.
 *
 * The caller gates it on `total > 0` — handed no rows, "no row carries a
 * number" is a sentence about rows that do not exist. That is the empty-RESULT
 * question (objectui#7130), answered upstream in `ObjectChart`.
 *
 * No console warning, matching all three landed answers in this file.
 */
function PositionRefusal({
  xKey,
  yKey,
  className,
}: { xKey: string; yKey: string; className?: string }) {
  return (
    <ChartRefusal code="no-plottable-points" className={className}>
      This chart has nothing to place: no row carries a number for both{' '}
      <code className="font-mono">{xKey}</code> and{' '}
      <code className="font-mono">{yKey}</code>.
    </ChartRefusal>
  );
}

/**
 * Whether a value can ANCHOR a numeric axis's scale (objectui#7195).
 *
 * ## Why this asks about the axis, not about the value's type
 *
 * `isPlottableCoord` above accepts a boolean on purpose: beside one real number
 * Recharts coerces `true`/`false` onto the scale and draws them (measured, 3 of
 * 3). What it cannot do is BUILD a scale out of booleans alone — every row
 * boolean and there is no domain, so nothing is drawn (0 of N). Whether a
 * boolean places is a property of its neighbours; whether the AXIS has anything
 * to build a scale from is a property of the whole dataset, and that is the
 * question this answers. A "reject booleans" predicate was measured to put a
 * false footnote over the mixed tile, so it is not what this is.
 *
 * ## Mirrors the two readers Recharts builds the domain with, not `Number.isFinite`
 *
 * A bare `Number.isFinite(v)` would refuse charts that draw. Recharts' numeric
 * domain reads a value through `makeDomain` in its axis selectors, which takes
 * a SCALAR through `makeNumber` — a number (primitive or `Number` object), a
 * string or a `Date` whose `Number()` is finite — and an ARRAY by its first two
 * elements `v[0]` / `v[1]` (a range bar or range area; any further elements
 * are ignored, so `[1, 2, 3]` draws) when both pass that same scalar rule.
 * Measured on this component, per family (bar / line / area / horizontal-bar /
 * combo / scatter):
 *
 *   - numeric strings (`'3'`) DRAW on every family — so they anchor;
 *   - `''` anchors at zero: a line / area / scatter draws it, while a bar /
 *     horizontal-bar / combo paints zero-height rectangles, the all-zero
 *     picture — finite data and silent, not this defect;
 *   - `Date` values anchor (scatter, 2 of 2);
 *   - a range `[1, 3]` anchors (a range bar drew 2 rectangles, a range area its
 *     path), and so does `[1, 2, 3]`; an unstacked range with a boolean or
 *     unparseable end does not (0 marks);
 *   - `new Number(3)` anchors (bar 2 rectangles, line a path);
 *   - booleans, `null`, an absent key, `NaN`, `'Infinity'` and `'n/a'` do not.
 *
 * ## A stacked series is not read here at all — its axis is live
 *
 * A STACKED bar or area is not read through `makeDomain`: d3's stack reads
 * every value as `Number(value)` and gives the axis a scale whatever the
 * values are (measured on the base tree: `'n/a'`, `NaN`, `{}`, `true` and
 * `[true, 3]` paint full-height bars; `null` stacks to a zero-height one). An
 * UNSTACKED sibling bound to the same axis is then coerced onto that scale and
 * draws — an all-boolean `w` beside a stacked all-`null` `v` painted a
 * rectangle. Four review rounds each found another way a per-series model of
 * that scale misses, so the rule is the one that errs to silence (seat ruling,
 * round 4): a series with a bar- or area-mode stack (`stackModeOf`) makes the
 * tile LIVE whatever its values, and this function is never asked about it.
 * A LINE spreads no `stackId` in this renderer, so its `stack` is inert and it
 * is read like any unstacked series.
 */
function anchorsNumericAxis(v: unknown): boolean {
  if (typeof v === 'boolean') return false;
  if (Array.isArray(v)) return isDomainScalar(v[0]) && isDomainScalar(v[1]);
  return isDomainScalar(v);
}

/**
 * Recharts' `makeNumber`: `isNumber` (a primitive number or a `Number`
 * object), a string or a `Date`, whose `Number()` is finite.
 */
function isDomainScalar(v: unknown): boolean {
  if (typeof v === 'number' || v instanceof Number || typeof v === 'string' || v instanceof Date) {
    return Number.isFinite(Number(v));
  }
  return false;
}

/**
 * Whether the author DECLARED enough of an axis for it to have a scale
 * without any row. Two shapes count:
 *
 *   - a finite numeric `min` AND `max`: Recharts builds the scale from the
 *     spec alone and d3 coerces booleans onto it, so the tile draws —
 *     measured, an all-boolean bar with `min: 0, max: 10` drew a rectangle, a
 *     line / area their path, and a scatter with `xAxis: { min: 0, max: 10 }`
 *     2 symbols;
 *   - ANY finite `stepSize`. `ticksFor` reads the rows through `Number()`, so
 *     booleans become 0 / 1 there, and with one declared bound it returns a
 *     tick array Recharts resolves the `'auto'` end from — measured,
 *     `{ stepSize: 2, min: 0 }` and `{ stepSize: 2, max: 10 }` each drew a
 *     rectangle over all-boolean rows (review round 5). Only the stepSize-plus-
 *     bound shape was measured drawing; ANY finite `stepSize` counts, `stepSize`
 *     alone included, because that is the rule that is simplest to keep true
 *     and it errs to silence (seat ruling, round 5).
 *
 * Such an axis is never refused. `min` alone, `max` alone, `logarithmic`
 * alone and annotations do not build a scale (0 marks, measured) and do not
 * count.
 */
function declaresScale(axis: NormalizedAxis | undefined): boolean {
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  return (finite(axis?.min) && finite(axis?.max)) || finite(axis?.stepSize);
}

/** Whether ANY row gives `key` a value that can anchor its axis. */
function axisHasScale(rows: unknown[], key: string): boolean {
  return rows.some((row) =>
    anchorsNumericAxis((row as Record<string, unknown> | null | undefined)?.[key]),
  );
}

/**
 * How the renderer stacks series `index`, read the way it draws it: the family
 * comes from `effectiveChartFamily` / `comboBaseFamily`, and inside a combo from
 * `series[].chartType`, then the base family, then the index default (first a
 * bar, the rest lines) — the same resolution the combo arm uses. Only a bar or
 * an area receives `stackId`; a line never does.
 */
type StackMode = 'none' | 'bar' | 'area';

function stackModeOf(chartType: string, series: NormalizedSeries[], index: number): StackMode {
  const s = series[index];
  if (!s?.stack) return 'none';
  const effective = effectiveChartFamily(chartType as any, series);
  const family = effective === 'combo'
    ? (s.chartType || comboBaseFamily(chartType) || (index === 0 ? 'bar' : 'line'))
    : effective;
  if (family === 'line') return 'none';
  if (family === 'area') return 'area';
  return 'bar';
}

/**
 * The refusal a cartesian tile renders when a numeric axis has rows but not one
 * of them carries a value that axis can build a scale from (objectui#7195,
 * ruled A).
 *
 * Its OWN code, `no-numeric-value`, rather than one of the neighbouring two:
 * `no-plottable-points` says no row carries a PAIR a point needs, and
 * `no-plottable-series` says nothing was bound at all. This one says the
 * binding is there and every row was read, and the axis still has no scale. One
 * code serves scatter and the series families alike because it is one
 * diagnosis with one fix — bind a numeric column — and the family is already
 * on the tile.
 *
 * The sentence is keyed on the whole dataset — "none of the N rows" — so it is
 * true exactly when nothing can be placed and cannot fire over a mixed tile
 * that draws. It names every dead key, and only those. English literal, no
 * locale key, matching the `no-plottable-series` sentences. No console warning,
 * matching the scatter answers above: the sentence already carries the key and
 * the count.
 */
function NumericValueRefusal({
  keys,
  total,
  className,
}: { keys: string[]; total: number; className?: string }) {
  return (
    <ChartRefusal code="no-numeric-value" className={className}>
      This chart has no scale to draw on:{' '}
      {total === 1 ? 'its only row has no' : `none of the ${total} rows has a`} numeric value for{' '}
      {keys.map((key, i) => (
        <React.Fragment key={`${i}-${key}`}>
          {i > 0 ? ' or ' : ''}
          <code className="font-mono">{key}</code>
        </React.Fragment>
      ))}
      .
    </ChartRefusal>
  );
}

/**
 * The refusal scatter renders when it is handed MORE THAN ONE series
 * (objectui#7194).
 *
 * Scatter binds ONE measure: `series[0].dataKey` is the `YAxis` key, and every
 * `<Scatter>` below reads the same rows through that one axis. A second series
 * therefore adds a palette colour and a legend entry and nothing else.
 * Measured: `series: [{ dataKey: 'ym' }, { dataKey: 'zm' }]` over two rows
 * painted FOUR symbols at TWO positions, each drawn twice, and `zm`'s values
 * (5 and 90) appeared nowhere on the plot. Unlike every other refusal in this
 * file the DATA is valid — the picture is what is wrong, and a reader cannot
 * tell: four symbols at two positions look exactly like coincident points, and
 * the legend is the only part of the tile that is true.
 *
 * Ruled B (maintainer, 2026-09-02): refuse loudly, do not project. Recharts
 * models a multi-series scatter as several elements each with its OWN `data`
 * array, so drawing two measures is a binding change that also moves what
 * `onClick` payloads carry — and nothing in-repo authors a two-series scatter,
 * so that capability waits for a real caller and reopens as one payment.
 *
 * Fires BEFORE `countPlottablePoints`: this is a fault in the BINDING, true of
 * the spec whatever the rows say, so it wins over the positional refusal the
 * same way the missing-category-key guard wins over the series guard. It also
 * fires whatever the series' `variant` — a `compareTo` overlay is a second
 * series, and it was painted at the primary's y values by the same mechanism.
 *
 * Render-time only. Authoring-time (zod) rejection follows objectui#7113's
 * shape when that card rules; nothing here pre-empts it.
 *
 * The sentence resolves through the locale packs (`chart.scatterOneMeasure`)
 * with the English as the provider-less fallback — `useSafeTranslate`, the hook
 * `ObjectChart` already uses, so no module-scope defaults map is added. It is
 * ONE short sentence on purpose: the packs are eagerly loaded and ship it ten
 * times. The series keys are data, not copy, and render outside it.
 *
 * No console warning, matching the three scatter/magnitude answers in this file.
 */
function SeriesArityRefusal({
  seriesKeys,
  className,
}: { seriesKeys: string[]; className?: string }) {
  const tt = useSafeTranslate();
  return (
    <ChartRefusal code="scatter-multi-series" className={className}>
      {tt('chart.scatterOneMeasure', 'A scatter plots one measure. Keep exactly one series:')}{' '}
      {seriesKeys.map((key, i) => (
        <React.Fragment key={`${i}-${key}`}>
          {i > 0 ? ', ' : ''}
          <code className="font-mono">{key}</code>
        </React.Fragment>
      ))}
    </ChartRefusal>
  );
}

/**
 * The note scatter carries when SOME rows can be placed and some cannot.
 *
 * Returns `null` when every row is plottable, and that gate is what keeps
 * healthy charts byte-identical: `ChartFootnote` with no note renders its
 * children untouched, so no existing caller gains a wrapper element.
 *
 * ## Why this one CAN say the points are not drawn
 *
 * objectui#7147's note deliberately does not, because a mixed-sign pie PAINTS a
 * sector for every row and only scales them meaninglessly. Scatter is the other
 * case and it was measured: a 3-row dataset with one plottable pair emitted
 * exactly ONE `path.recharts-symbols`, and the resulting tile was 99.75%
 * pixel-identical to a genuinely one-row scatter. The rows really are absent
 * from the picture, so saying so is a true statement about what is on screen —
 * and the COUNT is the half a reader cannot recover from it.
 */
function unplottedPointsNote(
  plottable: number,
  total: number,
  xKey: string,
  yKey: string,
): React.ReactNode {
  const unplotted = total - plottable;
  if (unplotted <= 0) return null;
  return (
    <p role="note" data-chart-note="unplotted-points" className="px-1 text-xs text-muted-foreground">
      {unplotted} of {total} rows {unplotted === 1 ? 'has' : 'have'} no number for both{' '}
      <code className="font-mono">{xKey}</code> and{' '}
      <code className="font-mono">{yKey}</code> &mdash; this chart plots by position, so{' '}
      {unplotted === 1 ? 'that point is' : 'those points are'} not drawn.
    </p>
  );
}

/**
 * AdvancedChartImpl - The heavy implementation that imports Recharts with full features
 * This component is lazy-loaded to avoid including Recharts in the initial bundle
 */
function AdvancedChartImplInner({
  // ⛔ No `= 'bar'` default (objectui#11520): it drew a bar for every family
  // that arrived unset, which is how a `specType: 'gauge'` chart became a bar
  // chart with no note. An absent family is the notice in the dispatch below.
  chartType: rawChartType,
  data: rawData = [],
  config = {},
  xAxisKey = 'name',
  series = [],
  className = '',
  colors,
  categoryColors,
  categoryOrder,
  onChartClick,
  isAnimationActive,
  xAxis: xAxisSpec,
  yAxes,
  showLegend,
  showDataLabels,
  title,
  subtitle,
  description,
  height,
  annotations,
  interaction,
}: AdvancedChartImplProps) {
  // Normalize 'column' → 'bar' (Recharts BarChart is already vertical).
  // 'column' is the spec-level alias for vertical bars; 'horizontal-bar' stays as-is.
  const baseChartType = rawChartType === 'column' ? 'bar' : rawChartType;
  // A chart whose series declare more than one family IS a combo, whatever its
  // own family says — `ChartSeries.type` is how the spec expresses that, and
  // reading it only under an explicit `combo` drew the overridden series as the
  // base family instead (#2945). `comboSeriesBase` is what an un-annotated
  // series draws, and `undefined` marks an explicitly-authored combo.
  const chartType = effectiveChartFamily(baseChartType, series);
  const comboSeriesBase = comboBaseFamily(baseChartType);
  const data = Array.isArray(rawData) ? rawData : [];
  // The ONE locale every number and date this chart draws is formatted in —
  // axis ticks, the single-value face and spec `format` strings alike. Each of
  // them used to pass `Intl` nothing or an explicit `undefined`, i.e. the
  // MACHINE's locale, which is neither of the repo's two locale channels
  // (objectui#9909); `useDisplayLocale()` is provider-safe and never answers
  // `undefined`.
  const displayLocale = useDisplayLocale();

  // Only emit the prop when explicitly disabled, so the default (animated)
  // behavior is byte-for-byte unchanged for every existing caller.
  const animProps = isAnimationActive === false ? { isAnimationActive: false as const } : {};
  // When the entrance animation is off there is no stuck-at-0 tween to heal, so
  // tell ChartContainer to skip its settle re-mount — avoids a needless 1-frame
  // reflow on the dashboard's first paint (#2756). Animated callers keep the
  // heal; this object is empty for them, leaving their markup unchanged.
  // Everything every ChartContainer call site needs, so a new container-level
  // spec prop lands on all eight chart families at once instead of one branch.
  const containerProps = {
    ...(isAnimationActive === false ? { disableSettleRemount: true as const } : {}),
    // An explicit height beats the container's default `h-[350px]` class
    // because an inline style wins over a utility class.
    ...(height ? { style: { height } } : {}),
    ...(description ? { role: 'img' as const, 'aria-label': description } : {}),
  };
  const [isMobile, setIsMobile] = React.useState(false);

  // objectui#13241 — the drawn width of the cartesian chart surface, so the x
  // axis rotates only labels that do not fit their band. `undefined` until a
  // real box is measured (first render, SSR, a layout-less test DOM): the
  // rotation decision then keeps its length-only rule, and switches to the fit
  // rule once a width arrives. The width only decides rotation, which changes
  // the axis HEIGHT, never the surface width, so a measurement cannot feed back
  // into itself. The surface element survives the container's settle re-mount
  // as a new node; the last width is kept across it, so nothing flickers.
  const [chartSurface, setChartSurface] = React.useState<SVGSVGElement | null>(null);
  const [measuredChartWidth, setMeasuredChartWidth] = React.useState<number | undefined>(undefined);
  React.useEffect(() => {
    if (chartSurface == null || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width != null && width > 0) setMeasuredChartWidth(Math.round(width));
    });
    observer.observe(chartSurface);
    return () => observer.disconnect();
  }, [chartSurface]);

  // Recharts' top-level onClick payload: { activeLabel, activeTooltipIndex, … }
  // — `MouseHandlerDataParam`, which carries an INDEX into this chart's `data`
  // and no row of its own. So the clicked bucket's row (and with it the
  // objectui#4508 identity) is read out of OUR OWN array rather than out of the
  // event: nothing in the payload can be stale or copied, because none of it
  // came from recharts.
  //
  // The measure VALUE is read the same way, off that row — for the same reason,
  // and because the payload has no value either. (recharts 2 carried both in an
  // `activePayload` array; recharts 3 dropped the field, so the objectui#4672
  // read of it was `undefined` on every click and every cartesian drill lost
  // its series and its value.)
  //
  // WHICH SERIES was clicked is the one thing the payload cannot always answer
  // — see `resolveClickedSeriesKey`, and the mark handler below it.
  //
  // ── The clicked mark (objectui#4672's ruled Option A) ──────────────────────
  // A chart-level cartesian click is an AXIS interaction, and recharts names no
  // series in one: several series sit under one shared cursor at a tick, so the
  // payload cannot say which of them the pointer was over. That left every
  // PIVOTED drill dead, because its lookup matches on the second dimension.
  //
  // The mark itself knows. This component renders the series, so a `Bar` /
  // `Line` / `Area` item handler closes over the very `dataKey` it was rendered
  // with — the answer is statically known, not inferred from tooltip state.
  //
  // Both handlers fire for one click (item first, chart second — measured), so
  // the item handler does NOT emit: it RECORDS its series, stamped with the
  // gesture, and the chart-level handler below emits the single event. That is
  // the double-fire answer and the additive property at once —
  //
  //  - exactly one `onChartClick` per gesture, because there is exactly one
  //    emit site, rather than a second event suppressed after the fact;
  //  - a click that lands on NO mark records nothing, so it falls through to
  //    the axis answer this handler already gave (category + identity, series
  //    when unambiguous) with not one byte changed. Nothing that resolved
  //    before stops resolving; a line's `dot={false}` stroke simply gains the
  //    exact series where the stroke itself is hit.
  //
  // It also has to be this way round for line and area, whose item handlers are
  // handed the curve's props and no datum: the mark knows its series and only
  // the chart-level payload knows the category. Each contributes what it has.
  const clickedMark = React.useRef<{ gesture: unknown; dataKey: string } | null>(null);

  const handleMarkClick = React.useCallback(
    (s: NormalizedSeries) => (...args: unknown[]) => {
      const gesture = gestureIdOfArgs(args);
      if (gesture === undefined) return;
      // Recorded EXACTLY as rendered, `''` included. The empty string is a real
      // second-dimension group as of objectui#4673 — it draws its own bar and
      // its key is its own label — and `''` is falsy, so any truthiness test on
      // the way out would send `series: undefined` and hand that bar's click to
      // whichever group an absent key happens to coerce to.
      clickedMark.current = { gesture, dataKey: String(s.dataKey) };
    },
    [],
  );

  const markClickProps = onChartClick
    ? (s: NormalizedSeries) => ({ onClick: handleMarkClick(s) })
    : () => ({});

  // Compose-and-emit for a chart-level cartesian click. TWO branches reach it,
  // and they differ in one rule only — `requireMark` (objectui#4692):
  //
  //  - the plain branch (bar / horizontal-bar / line / area) emits for EVERY
  //    click, falling back to the axis answer described above when the gesture
  //    landed on no mark;
  //  - `combo` emits ONLY for a gesture that landed on a mark. Its plot carries
  //    several measures, so a surface/axis click there has no single series to
  //    report and the fallback would have to invent one — the same reasoning
  //    objectui#4672's ruling gave the pivoted case.
  //
  // Sharing the composer rather than writing combo its own is the point: a
  // combo mark's click IS a cartesian mark's click (same components, same
  // recorded series identity), so there is one event shape and one emit site,
  // and the two branches disagree about reachability alone.
  const emitCartesianClick = React.useCallback((payload: any, event: any, requireMark: boolean) => {
    if (!onChartClick || !payload) return;
    // A click with no active tick (the plot margins, an axis label) reports a
    // NULL index, not an absent one — and `Number(null)` is 0, which would
    // resolve to bucket ZERO and drill the wrong bucket. Only a real index
    // selects a row.
    const rawIdx = payload.activeTooltipIndex ?? payload.activeIndex;
    const idx = rawIdx == null ? Number.NaN : Number(rawIdx);
    const row = Number.isInteger(idx) && idx >= 0 ? data[idx] : undefined;
    // The mark handler runs first and only for THIS gesture; anything left over
    // from a click that never reached here belongs to a different DOM event and
    // can never be adopted by this one.
    const mark = clickedMark.current;
    clickedMark.current = null;
    const gesture = gestureIdOf(event);
    const onMark = mark != null && gesture !== undefined && mark.gesture === gesture;
    // The record is cleared above whether or not it is used, so a combo's
    // silent surface click cannot leave a stale series behind for the next one.
    if (requireMark && !onMark) return;
    const clickedKey = onMark
      ? mark!.dataKey
      : resolveClickedSeriesKey(payload.activeDataKey, series);
    const cell = clickedKey != null && row ? (row as Record<string, any>)[clickedKey] : undefined;
    onChartClick({
      category: payload.activeLabel != null ? String(payload.activeLabel) : undefined,
      categoryId: chartRowBucketId(row),
      series: clickedKey,
      // The KEY stays the lookup's answer; the LABEL rides alongside it so the
      // drill title can read what the segment actually said (objectui#4682).
      seriesLabel: seriesLabelForKey(clickedKey, series),
      value: typeof cell === 'number' ? cell : undefined,
    });
  }, [onChartClick, data, series]);

  const handleCartesianClick = React.useCallback((payload: any, event?: any) => {
    emitCartesianClick(payload, event, false);
  }, [emitCartesianClick]);

  const handleComboClick = React.useCallback((payload: any, event?: any) => {
    emitCartesianClick(payload, event, true);
  }, [emitCartesianClick]);

  // A pie sector's `payload` is a SPREAD COPY of the data row (recharts builds
  // it as `{...entry, ...cellProps}`), which is precisely why the bucket
  // identity is an ordinary enumerable property — see `CHART_BUCKET_ID_KEY`.
  const handlePieClick = React.useCallback((entry: any) => {
    if (!onChartClick || !entry) return;
    const cat = entry.payload?.[xAxisKey];
    const dk = series[0]?.dataKey || 'value';
    onChartClick({
      category: cat != null ? String(cat) : undefined,
      categoryId: chartRowBucketId(entry.payload),
      series: dk,
      // Measured for objectui#4682: this path sends only the KEY, so a pie over
      // a pivot whose first group keys by identity titles its drawer with that
      // identity. The funnel path is untouched — it sends no series at all.
      seriesLabel: seriesLabelForKey(dk, series),
      value: typeof entry.payload?.[dk] === 'number' ? entry.payload[dk] : undefined,
    });
  }, [onChartClick, xAxisKey, series]);

  const cartesianClickProps = onChartClick ? { onClick: handleCartesianClick, style: { cursor: 'pointer' as const } } : {};
  // Combo carries NO chart-wide pointer cursor, unlike every other wired
  // family: on this plot only the marks answer a click, and a surface-wide
  // pointer would promise a drill the axis deliberately does not perform. The
  // affordance rides on the marks instead — see `comboMarkClickProps`.
  const comboClickProps = onChartClick ? { onClick: handleComboClick } : {};
  const comboMarkClickProps = onChartClick
    ? (s: NormalizedSeries) => ({ ...markClickProps(s), cursor: 'pointer' as const })
    : () => ({});
  const pieClickProps = onChartClick ? { onClick: handlePieClick, style: { cursor: 'pointer' as const } } : {};

  // Per-category colour: a select/lookup dimension's option colour (passed via
  // `categoryColors`, keyed by value OR label) wins per slice/bar; categories
  // with no option colour fall back to the `palette` the caller passes — the
  // positional palette for pie/donut slices, the one series colour for
  // single-series bars — so semantic colours (health green/red/yellow)
  // survive even when a generic brand palette is also set.
  const colorForCategory = React.useCallback((rawKey: any, index: number, palette: string[]): string => {
    const mapped = categoryColors && categoryColors[rawKey == null ? '' : String(rawKey)];
    return mapped || palette[index % palette.length];
  }, [categoryColors]);

  // Scatter / treemap / sankey element clicks map to the same
  // { category, series, value } drill event via pure mappers (see
  // chartDrillEvents). Each returns null for non-drillable targets (e.g. a
  // sankey link or root node), in which case we don't fire.
  const handleScatterClick = React.useCallback((node: any) => {
    if (!onChartClick) return;
    const ev = mapScatterClick(node, xAxisKey, series);
    if (ev) onChartClick(ev);
  }, [onChartClick, xAxisKey, series]);

  const handleTreemapClick = React.useCallback((node: any) => {
    if (!onChartClick) return;
    const ev = mapTreemapClick(node, series);
    if (ev) onChartClick(ev);
  }, [onChartClick, series]);

  const handleSankeyClick = React.useCallback((payload: any) => {
    if (!onChartClick) return;
    const ev = mapSankeyClick(payload, series);
    if (ev) onChartClick(ev);
  }, [onChartClick, series]);

  const scatterClickProps = onChartClick ? { onClick: handleScatterClick, cursor: 'pointer' } : {};
  const treemapClickProps = onChartClick ? { onClick: handleTreemapClick, style: { cursor: 'pointer' as const } } : {};
  const sankeyClickProps = onChartClick ? { onClick: handleSankeyClick, style: { cursor: 'pointer' as const } } : {};

  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 640);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Format ISO date strings into compact "MMM D" / "MMM YYYY" labels for X-axis ticks.
  // Falls back to the raw value when not parseable as a date.
  const formatTick = React.useCallback((value: any): string => {
    if (value == null || value === '') return '';
    // A resolved display label for this exact category value — the same
    // `config[key]?.label` convention already used for series names (below)
    // and pie/donut legend entries. Wins over the raw value so an
    // analytics-response-shaped `config` (value → { label }) reaches the
    // axis too, not just series/legend text.
    const resolved = config?.[String(value)]?.label;
    if (resolved != null) return String(resolved);
    const str = typeof value === 'string' ? value : String(value);
    // Detect ISO 8601 date / datetime strings (YYYY-MM-DD or with time component)
    const isoLike = /^\d{4}-\d{2}-\d{2}/.test(str);
    if (isoLike) {
      // The shared step, `toDisplayDate` (`@object-ui/core`, objectui#10866):
      // the engine's own parse read a date-only `2026-09-01` as UTC midnight,
      // so every viewer west of UTC read `Aug 31` on the axis. The shared step
      // tells the two shapes apart by the value: a date-only category is
      // local midnight of the day it names, and one with a time part keeps its
      // instant. A value it refuses (a day its month does not have,
      // objectui#10026) falls through to the raw category below.
      const d = toDisplayDate(str);
      if (!Number.isNaN(d.getTime())) {
        // Choose granularity based on data span: <= 62 days → MMM D, otherwise MMM YYYY.
        // The span is a DURATION between two categories of one axis, so it
        // keeps the engine parse: two date-only values are then both UTC
        // midnights and a whole number of days apart, where two local
        // midnights would be an hour off across a DST change.
        const span = data.length > 1
          ? Math.abs(new Date(String(data[data.length - 1][xAxisKey] ?? '')).getTime() -
                     new Date(String(data[0][xAxisKey] ?? '')).getTime())
          : 0;
        const days = span / (1000 * 60 * 60 * 24);
        try {
          if (days <= 62) {
            return d.toLocaleDateString(displayLocale, { month: 'short', day: 'numeric' });
          }
          return d.toLocaleDateString(displayLocale, { month: 'short', year: 'numeric' });
        } catch {
          // A locale `Intl` refuses. A date-only category prints its day from
          // LOCAL getters (`toISOString()` of its local midnight would name
          // the day before east of UTC); an instant keeps its UTC day.
          return isRealCalendarDate(str) ? toDateInputValue(d) : d.toISOString().slice(0, 10);
        }
      }
    }
    if (isMobile && str.length > 8) return str.slice(0, 8) + '…';
    return str;
  }, [data, xAxisKey, isMobile, config, displayLocale]);

  // Memoize whether any X-axis label is long enough to warrant angle rotation
  const hasLongLabels = React.useMemo(
    () => data.some((d: any) => String(d[xAxisKey] || '').length > 5),
    [data, xAxisKey],
  );

  // objectui#7247 — see X_AXIS_ALL_LABELS_MAX_BUCKETS for why a short
  // categorical axis draws every label instead of thinning like a time axis.
  const labelEveryBucket = data.length > 0 && data.length <= X_AXIS_ALL_LABELS_MAX_BUCKETS;

  // Helper function to get color palette. An explicit `colors` prop (set by the
  // page/dashboard) wins; otherwise fall back to the theme's --chart-1..5 vars.
  const getPalette = () => (Array.isArray(colors) && colors.length > 0 ? colors : [
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))'
  ]);

  // Compact numeric formatter for Y-axis ticks (1,200,000 → 1.2M).
  // Keeps the axis readable when bar/area series have large values.
  const formatYTick = React.useCallback((value: any): string => {
    if (value == null || value === '') return '';
    const num = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(num)) return String(value);
    try {
      return new Intl.NumberFormat(displayLocale, { notation: 'compact', maximumFractionDigits: 1 }).format(num);
    } catch {
      return String(num);
    }
  }, [displayLocale]);

  // ── Spec ChartAxis presentation (objectui#2880 S2) ──────────────────────
  // The author's `format` wins over the compact default; `min`/`max` pin the
  // domain; `logarithmic` swaps the scale; `title` labels the axis. All three
  // arrive already parsed from `normalizeChartSchema`, so nothing here has to
  // know the author-facing shape.
  //
  // `primaryY` is the entry declaration order makes primary: the only value
  // axis when it is the only entry, the one whose `showGridLines` governs the
  // horizontal grid, and scatter's y axis.
  const primaryY: NormalizedAxis | undefined = yAxes?.[0];
  // Spec `yAxis[].position` — which slot each entry is drawn in (objectui#10654;
  // see `placeYAxes`, the one place a y side is resolved — the normalizer binds
  // the series it derives from the entries with the same call). `chartType` is
  // the EFFECTIVE family, and `comboBaseFamily` never widens a horizontal-bar,
  // so `categoriesRunDown` is exactly "the value axes run across the plot".
  // Scatter draws one y axis, the primary's: `placeYAxes` places only that
  // entry and lists the rest as undrawn (objectui#10721), so the footnote
  // names them.
  const categoriesRunDown = chartType === 'horizontal-bar';
  const yPlacement = placeYAxes(yAxes, chartType);
  const leftY: NormalizedAxis | undefined = yPlacement.left !== undefined ? yAxes?.[yPlacement.left] : undefined;
  const rightY: NormalizedAxis | undefined = yPlacement.right !== undefined ? yAxes?.[yPlacement.right] : undefined;
  // Two value axes exactly when two entries are declared, one per slot, and
  // `series[].yAxis` binds a series to a slot. A lone entry is the only value
  // axis, drawn in the slot it named (`soleYSlot`) — `position: 'right'` on it
  // moves the axis, it does not add a second one.
  const hasDualAxis = !!leftY && !!rightY;
  // A combo always renders both value axes with ids; the other cartesian
  // branches do only when two entries are declared (see `valueAxisIdFor`).
  const valueAxesHaveIds = chartType === 'combo' || hasDualAxis;
  const soleYSlot: ValueAxisSlot = yPlacement.slotOf[0] ?? 'left';
  // The position notes, then one per entry drawn on no axis (objectui#10691) —
  // both from `yPlacement`, in the same footnote.
  const yPositionNote = joinNotes(
    yAxisPositionNotes(yPlacement, categoriesRunDown),
    yAxisUndrawnNotes(yPlacement, yAxes, categoriesRunDown),
  );
  /** The entry a series' marks are measured against — for its value labels. */
  const axisOfSeries = (s: { yAxis?: string }): NormalizedAxis | undefined =>
    hasDualAxis ? (s.yAxis === 'right' ? rightY : leftY) : primaryY;

  const xTickFormatter = React.useMemo(
    () => formatterFor(xAxisSpec?.format, displayLocale) ?? formatTick,
    [xAxisSpec?.format, displayLocale, formatTick],
  );

  // objectui#13241 — whether the drawn labels fit their bands unrotated, read
  // only once the surface width is measured (`undefined` before). The plot is
  // the surface less recharts' side margins and the value axes drawn beside
  // it: two for a combo or a dual-axis chart, one otherwise.
  const xLabelsFitBand = measuredChartWidth === undefined
    ? undefined
    : categoryLabelsFitBand(
      data.map((d) => String(xTickFormatter(d?.[xAxisKey]) ?? '')),
      measuredChartWidth - CHART_MARGIN_X_PX
        - (chartType === 'combo' || hasDualAxis ? 2 : 1) * VALUE_AXIS_WIDTH_PX,
    );

  // Rotation is what BUYS the complete axis, so in the forced branch it applies
  // on mobile too: drawing every label without rotating is the horizontal
  // overlap the old thinning avoided. Above the bound the trigger is unchanged.
  // A long label rotates only when the measured band cannot hold it
  // (objectui#13241); before a width is measured, its length alone decides.
  const labelsWantRotation = hasLongLabels && xLabelsFitBand !== true;
  const rotateXLabels = labelEveryBucket ? labelsWantRotation : (!isMobile && labelsWantRotation);

  /**
   * The x-axis formatter, plus the ellipsis step a rotated label owes
   * (objectui#7247, every rotated label since objectui#11796): the axis band
   * is sized from the longest label drawn, so the cap is what keeps that band
   * bounded. See `ROTATED_X_LABEL_MAX_CHARS`.
   *
   * Kept separate from `xTickFormatter` on purpose — that one also formats the
   * horizontal-bar family's CATEGORY axis, which is the y axis, sizes its own
   * width from the longest label, and already draws all of them.
   */
  const xAxisTickFormatter = React.useMemo(() => {
    if (!rotateXLabels) return xTickFormatter;
    return (value: any): string => {
      const label = String(xTickFormatter(value) ?? '');
      return label.length > ROTATED_X_LABEL_MAX_CHARS
        ? `${label.slice(0, ROTATED_X_LABEL_MAX_CHARS - 1)}…`
        : label;
    };
  }, [rotateXLabels, xTickFormatter]);

  // objectui#11796 — the band a rotated x axis reserves, from the longest
  // label it draws (see `rotatedXAxisHeight`). A number, so the axis props
  // below key on the value rather than on this render's formatter.
  const rotatedXAxisBand = rotateXLabels
    ? rotatedXAxisHeight(data.map((d) => String(xAxisTickFormatter(d?.[xAxisKey]) ?? '')))
    : undefined;
  const yTickFormatter = React.useMemo(
    () => formatterFor(primaryY?.format, displayLocale) ?? formatYTick,
    [primaryY?.format, displayLocale, formatYTick],
  );
  // Per slot, for the charts that draw both value axes.
  const leftYTickFormatter = React.useMemo(
    () => formatterFor(leftY?.format, displayLocale) ?? formatYTick,
    [leftY?.format, displayLocale, formatYTick],
  );
  const rightYTickFormatter = React.useMemo(
    () => formatterFor(rightY?.format, displayLocale) ?? formatYTick,
    [rightY?.format, displayLocale, formatYTick],
  );

  /**
   * Every number plotted in one slot of a dual axis (or on the only axis,
   * whichever slot it sits in) — the range `stepSize` lays its ticks over.
   */
  const slotSeries = React.useCallback(
    (side: ValueAxisSlot): NormalizedSeries[] =>
      series.filter((s) => (hasDualAxis ? (s.yAxis === 'right' ? 'right' : 'left') === side : true)),
    [series, hasDualAxis],
  );
  const axisValues = React.useCallback((side: ValueAxisSlot) => {
    const keys = slotSeries(side).map((s) => s.dataKey);
    const out: number[] = [];
    for (const row of data) {
      for (const k of keys) {
        const n = Number(row?.[k]);
        if (Number.isFinite(n)) out.push(n);
      }
    }
    return out;
  }, [data, slotSeries]);

  /**
   * Recharts props derived from one spec y-axis (domain / scale / ticks /
   * label). The title is laid out for an axis running up the plot on the
   * `side` slot unless a caller drawing it ACROSS the plot (horizontal-bar's
   * value axes) passes the x-axis layout for the side it sits on.
   */
  //
  // A slot whose series all plot a count draws whole-number ticks
  // (objectui#11681): recharts otherwise lays 0.5 / 0.75 steps over a small
  // count domain. Every value axis takes its props here, the horizontal-bar
  // number `<XAxis>` included, so each side of a dual axis decides for itself;
  // a slot with any other measure gets no `allowDecimals` at all, so it renders
  // exactly as before.
  const yAxisSpecProps = React.useCallback(
    (axis: NormalizedAxis | undefined, side: ValueAxisSlot = 'left', titleLayout?: AxisTitleLayout) => ({
      ...(plotsWholeNumbers(slotSeries(side)) ? { allowDecimals: false } : {}),
      ...numericAxisSpecProps(axis, axisValues(side), titleLayout ?? yAxisTitleLayoutFor(side)),
    }),
    [axisValues, slotSeries],
  );

  // `showGridLines` is per-axis in the spec; the renderer draws one grid, so
  // an explicit `false` on EITHER axis turns off that axis's lines.
  const showYGrid = primaryY?.showGridLines !== false;
  // The default grid draws horizontal lines only (`vertical={false}`), which is
  // the right default for a categorical x-axis; honour an explicit opt-in.
  const gridProps = {
    vertical: xAxisSpec?.showGridLines === true,
    horizontal: showYGrid,
  };

  // Spec `xAxis.position` — which side the category axis sits on, or the side
  // it was refused (objectui#10587; see `placeXAxis`). `chartType` is the
  // EFFECTIVE family: a bar / line / area whose series disagree is placed as
  // the vertical combo it became; `comboBaseFamily` never widens a
  // horizontal-bar, so one with mixed series stays horizontal and keeps the
  // `left` / `right` reading (`categoriesRunDown`, above).
  const {
    across: xAxisAcross,
    down: xAxisDown,
    refused: xAxisPositionRefused,
  } = placeXAxis(xAxisSpec?.position, categoriesRunDown);
  const xPositionNote = xAxisPositionNote(xAxisPositionRefused, categoriesRunDown);

  // Legend is on unless the author turned it off (spec default `true`).
  const legendVisible = showLegend !== false;

  // ── Spec ChartConfig.annotations (objectui#2880 S3) ─────────────────────
  // `type: 'line'` → ReferenceLine at `value`; `type: 'region'` → ReferenceArea
  // spanning `value`..`endValue`. `axis` picks which axis the value belongs to.
  const annotationEls = React.useMemo(() => {
    if (!Array.isArray(annotations) || annotations.length === 0) return null;
    const DASH: Record<string, string | undefined> = { solid: undefined, dashed: '4 4', dotted: '1 4' };
    // Measured against the rendered `'left'` value axis — see `valueAxisIdFor`.
    const axisId = valueAxisIdFor(valueAxesHaveIds, categoriesRunDown);
    return annotations.map((a, i) => {
      const onX = a?.axis === 'x';
      const stroke = resolveColor(String(a?.color || 'hsl(var(--muted-foreground))'));
      const strokeDasharray = DASH[String(a?.style ?? 'dashed')];
      const text = typeof a?.label === 'string' ? a.label : undefined;
      const labelProp = text ? { label: { value: text, position: 'insideTopRight' as const, fill: stroke, fontSize: 11 } } : {};
      if (a?.type === 'region') {
        const range = onX ? { x1: a.value, x2: a.endValue } : { y1: a.value, y2: a.endValue };
        return (
          <ReferenceArea
            key={`ann-${i}`}
            {...range}
            {...axisId}
            fill={stroke}
            fillOpacity={0.12}
            stroke={stroke}
            strokeOpacity={0.35}
            {...labelProp}
          />
        );
      }
      return (
        <ReferenceLine
          key={`ann-${i}`}
          {...(onX ? { x: a?.value } : { y: a?.value })}
          {...axisId}
          stroke={stroke}
          strokeDasharray={strokeDasharray}
          {...labelProp}
        />
      );
    });
  }, [annotations, valueAxesHaveIds, categoriesRunDown]);

  // ── Spec ChartConfig.interaction (objectui#2880 S3) ─────────────────────
  // `tooltips: false` suppresses the hover card; `brush: true` adds the range
  // selector under the plot. `zoom` has no Recharts primitive behind it and is
  // deliberately not faked — see the note in ChartConfigSchema.
  const tooltipsEnabled = interaction?.tooltips !== false;
  const brushEnabled = interaction?.brush === true;
  const brushEl = brushEnabled
    ? <Brush dataKey={xAxisKey} height={24} travellerWidth={8} stroke="hsl(var(--muted-foreground))" />
    : null;

  /** `showDataLabels` prints each point's value on the mark itself. */
  const dataLabel = (formatter?: (v: any) => string) =>
    showDataLabels
      ? <LabelList position="top" className="fill-foreground" fontSize={11} {...(formatter ? { formatter } : {})} />
      : null;

  // Shared X-axis props for time/categorical axes, in two branches.
  //
  // Above X_AXIS_ALL_LABELS_MAX_BUCKETS, `interval={0}` is NOT hard-coded,
  // because forcing every label painted a dense black bar when the data
  // spanned hundreds of points (`interval: 'preserveStartEnd'` is what keeps
  // that safe — it, not `minTickGap`, is what still lets recharts drop
  // interior ticks; see objectui#7386 below for why `minTickGap` itself no
  // longer does any of that thinning). At or below the bound the reverse is
  // true and thinning is the bug (objectui#7247): the axis is short enough
  // that every label is provably drawable, and each one is a bar's only name.
  //
  // objectui#7386 — `minTickGap: 0`, not a re-tuned nonzero density.
  // `minTickGap` is ADDED on top of each tick's own measured (angled) box —
  // recharts' `getTicks`, per tick: `start = tickCoord + size/2 + minTickGap`
  // — so the 32/48px this branch used to charge was mandatory whitespace
  // beyond what real overlap avoidance already required, borrowed from a
  // time-series budget and charged to every band axis above 5 buckets too
  // (a 7-status pipeline at 290px, ~33px/band, dropped 4 of 7 names — the
  // labels were never actually so wide they'd collide). `interval:
  // 'preserveStartEnd'` plus recharts' own measured-width collision check
  // (`getStringSize` against each tick's real rendered font) is the
  // mechanism that has to do ALL the work now, same as it always has for the
  // ticks it keeps — `minTickGap: 0` removes only the extra margin, not the
  // check itself, so the "hundreds of points" case above stays protected by
  // the SAME measured-overlap logic, just without the added tax. Verified in
  // real Chromium (this repo's DOM test env reports zero text metrics, so it
  // cannot exercise this at all — see the PR for the harness and counts):
  // at 290px, 7/7 and 8/8 bucket labels now draw with zero measured overlap
  // (rotated labels checked via their true rotated rectangles, not an
  // axis-aligned box — an axis-aligned check over-reports collisions for
  // diagonal text, which is the same conservatism recharts' own angled-tick
  // model (`getAngledRectangleWidth`) accepts rather than reimplements: real
  // collision is on PERPENDICULAR separation between parallel slanted lines,
  // and neither this file nor recharts computes that; both accept the
  // more-conservative projected-width model instead of bypassing it, as this
  // scale (a handful of buckets, not hundreds) does not warrant taking on
  // untested custom collision geometry with no local way to verify it); a
  // 180-point daily series at 800px still thinned to 11 ticks with zero
  // overlap, unchanged in kind from before this change.
  const xAxisCommonProps = React.useMemo(() => ({
    tick: AXIS_TICK_STYLE,
    tickLine: false as const,
    tickMargin: X_AXIS_TICK_MARGIN,
    axisLine: false as const,
    // A short categorical axis names every bucket; everything above the
    // bound now leans on recharts' own measured-overlap check with no added
    // margin — see the `objectui#7386` comment above.
    ...(labelEveryBucket
      ? { interval: 0 as const }
      : { interval: 'preserveStartEnd' as const, minTickGap: 0 }),
    tickFormatter: xAxisTickFormatter,
    // objectui#10587 — the declared side, emitted only when one was declared
    // and is open to this axis (see `placeXAxis`).
    ...(xAxisAcross ? { orientation: xAxisAcross } : {}),
    ...(xAxisSpec?.title ? { label: { value: xAxisSpec.title, ...xAxisTitleLayoutFor(xAxisAcross) } } : {}),
    // A rotated label hangs AWAY from the plot: down-left under a bottom axis
    // (`-35`), and up-left over a top one (`35`) — the same `-35` above the
    // plot would slant every label down into the marks. Its band is sized
    // from the longest label drawn (objectui#11796, `rotatedXAxisHeight`).
    ...(rotateXLabels && {
      angle: xAxisAcross === 'top' ? ROTATED_X_LABEL_ANGLE : -ROTATED_X_LABEL_ANGLE,
      textAnchor: 'end' as const,
      height: rotatedXAxisBand,
    }),
  }), [labelEveryBucket, rotateXLabels, xAxisTickFormatter, xAxisSpec?.title, xAxisAcross, rotatedXAxisBand]);

  // #2942 — the non-series spec families used to fall through the component
  // map's `|| BarChart` into a bar shell whose series marks all returned
  // null: grid, axes, tooltip and legend rendered with NO data marks,
  // indistinguishable from an empty dataset. Single-value families render
  // the measure as a number (the spec's own framing for them); tabular ones
  // say which component owns the rendering; unknown values are named instead
  // of guessed at.
  //
  // objectui#11520 — this is the ONE family → form dispatch, and every channel
  // reaches it with the family as named: `chartType` straight from
  // `ChartRenderer`, and `specType` (the react tier's family) through
  // `normalizeChartSchema`, which no longer drops the families this block
  // draws no chart of. A chart that arrives with no family at all is the
  // unknown-type notice below, not a bar.
  if (chartType && SINGLE_VALUE_CHART_TYPES.has(chartType)) {
    const dataKey = series[0]?.dataKey || 'value';
    const raw = data[0]?.[dataKey];
    const num = typeof raw === 'number' ? raw : Number(raw);
    const label = series[0]?.label ?? (config?.[dataKey] as { label?: unknown } | undefined)?.label ?? dataKey;
    return (
      <div className={className} data-testid="advanced-chart-single-value">
        <div className="flex flex-col gap-1 py-4">
          <span className="text-3xl font-semibold tabular-nums">
            {Number.isFinite(num) ? new Intl.NumberFormat(displayLocale).format(num) : String(raw ?? '—')}
          </span>
          <span className="text-xs text-muted-foreground">{String(label)}</span>
        </div>
      </div>
    );
  }
  if (chartType && TABULAR_CHART_TYPES.has(chartType)) {
    return (
      <div
        className={`rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground ${className ?? ''}`}
        data-testid="advanced-chart-tabular-notice"
        role="note"
      >
        Chart type &ldquo;{chartType}&rdquo; is tabular — render it with the data-table / pivot components; a chart block draws series charts.
      </div>
    );
  }
  if (!chartType || !RENDERABLE.has(chartType)) {
    return (
      <div
        className={`rounded-md border border-dashed bg-muted/20 px-3 py-2 text-xs text-muted-foreground ${className ?? ''}`}
        data-testid="advanced-chart-unknown-type"
        role="note"
      >
        {chartType ? (
          <>Chart type &ldquo;{chartType}&rdquo; is not a spec chart type — nothing was drawn.</>
        ) : (
          <>This chart names no chart type — nothing was drawn.</>
        )}
      </div>
    );
  }

  // The recharts root the cartesian tail at the end draws in. It is read
  // only past the dispatch above, which returns for every family outside
  // `RENDERABLE` and for none (objectui#11520), so `chartType` is a drawn
  // family here. combo/treemap/sankey return from their own branches below;
  // they are mapped only so every drawn family has a row.
  const cartesianRoots = {
    bar: BarChart,
    'horizontal-bar': BarChart,
    line: LineChart,
    area: AreaChart,
    pie: PieChart,
    donut: PieChart,
    radar: RadarChart,
    scatter: ScatterChart,
    funnel: FunnelChart as any,
    combo: ComposedChart,
    treemap: BarChart,
    sankey: BarChart,
  };
  const ChartComponent = cartesianRoots[chartType as keyof typeof cartesianRoots] || BarChart;

  // Pie and Donut charts
  if (chartType === 'pie' || chartType === 'donut') {
    const innerRadius = chartType === 'donut' ? '52%' : 0;
    const palette = getPalette();
    // objectui#7147 — see `countSizableRows`. A slice's angle is its share of
    // the positive total, so a row that is zero, negative, null or unparseable
    // is drawn as nothing at all while staying in `data`. Measured: all-zero,
    // all-null and all-negative pies each put ZERO non-white pixels on a
    // 520x240 tile, byte-identical to an empty div.
    const pieDataKey = series[0]?.dataKey || 'value';
    const pieSizable = countSizableRows(data, pieDataKey);
    if (pieSizable.total > 0 && pieSizable.sizable === 0) {
      return <MagnitudeRefusal dataKey={pieDataKey} className={className} />;
    }
    // Augment the chart config with one entry per category value so that
    // `ChartLegendContent` (which resolves item labels via `config[key]`)
    // can render the slice labels next to the color swatches. Without
    // this the legend showed colored dots with no text, because the
    // upstream config only contained entries for series dataKeys.
    const pieConfig: ChartContainerConfig = { ...(config as ChartContainerConfig) };
    data.forEach((entry, index) => {
      const rawKey = entry?.[xAxisKey];
      if (rawKey == null || rawKey === '') return;
      const key = String(rawKey);
      if (!pieConfig[key]) {
        pieConfig[key] = {
          label: key,
          color: colorForCategory(rawKey, index, palette),
        };
      }
    });
    const pieChart = (
      <ChartContainer config={pieConfig} className={className} {...containerProps}>
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
          <Pie
            data={data}
            dataKey={pieDataKey}
            nameKey={xAxisKey || 'name'}
            innerRadius={innerRadius}
            strokeWidth={5}
            paddingAngle={2}
            outerRadius="85%"
            {...animProps}
            {...pieClickProps}
          >
             {data.map((entry, index) => {
                // Per-category option colour wins; otherwise the positional
                // palette slot (kept identical to the legend swatch above).
                const c = colorForCategory(entry?.[xAxisKey], index, palette);
                return <Cell key={`cell-${index}`} fill={resolveColor(c)} />;
             })}
          </Pie>
          {legendVisible ? (
            <ChartLegend
              verticalAlign="bottom"
              wrapperStyle={{ fontSize: isMobile ? '11px' : '12px', paddingTop: '8px' }}
              content={<ChartLegendContent nameKey={xAxisKey} className="flex-wrap" />}
            />
          ) : null}
        </PieChart>
      </ChartContainer>
    );
    // A pie that drew SOME of its rows says how many it could not size. With
    // every row sizable the note is `null` and `ChartFootnote` returns the
    // container untouched, so healthy pies keep their exact DOM.
    return (
      <ChartFootnote note={unsizedRowsNote(pieSizable.sizable, pieSizable.total, pieDataKey)}>
        {pieChart}
      </ChartFootnote>
    );
  }

  // Funnel chart — uses recharts FunnelChart (single series only)
  if (chartType === 'funnel') {
    const dataKey = series[0]?.dataKey || 'value';
    const palette = getPalette();
    // objectui#7147 — see `countSizableRows`. Recharts derives each segment's
    // upper and lower width from ITS value and the NEXT one, so a single
    // unsizable row does not merely omit itself: measured, `40` beside a `null`
    // drew ZERO segments and one label reading "Beta" — the row with no value —
    // while the row carrying 40 drew nothing at all. All-negative is the mirror
    // image: a confident two-band funnel with MORE mark area than the
    // all-positive control.
    const funnelSizable = countSizableRows(data, dataKey);
    if (funnelSizable.total > 0 && funnelSizable.sizable === 0) {
      return <MagnitudeRefusal dataKey={dataKey} className={className} />;
    }
    const handleFunnelClick = onChartClick
      ? (entry: any) => {
          if (!entry) return;
          onChartClick({
            category: entry?.payload?.[xAxisKey] ?? entry?.[xAxisKey],
            categoryId: chartRowBucketId(entry?.payload) ?? chartRowBucketId(entry),
            value: entry?.payload?.[dataKey] ?? entry?.[dataKey],
          });
        }
      : undefined;
    const funnelClickProps = handleFunnelClick
      ? { onClick: handleFunnelClick, style: { cursor: 'pointer' as const } }
      : {};
    // Recharts <Funnel> draws segments in source order, so this decides the
    // sequence the funnel asserts.
    //
    // With a DECLARED order (framework#3588) — a stage picklist's own option
    // order, or an explicit `stageOrder` — that order wins: a sales funnel must
    // read Qualification → Needs Analysis → Proposal → Negotiation whether or
    // not each stage happens to hold more value than the next. Sorting such a
    // pipeline by value would manufacture a tidy narrowing shape and hide the
    // very anomaly (a bulge at Proposal) the chart exists to reveal. Categories
    // missing from the declared order keep their incoming relative order,
    // after the declared ones — never dropped.
    //
    // Without one, keep the long-standing default: descending by value, so a
    // generic funnel still narrows downward without authors pre-sorting.
    const categoryRank = buildCategoryRank(categoryOrder);
    const funnelData = categoryRank
      ? [...data].sort((a, b) => {
          const ar = categoryRank.get(String(a?.[xAxisKey] ?? '')) ?? Number.MAX_SAFE_INTEGER;
          const br = categoryRank.get(String(b?.[xAxisKey] ?? '')) ?? Number.MAX_SAFE_INTEGER;
          return ar - br;
        })
      : [...data].sort((a, b) => {
          const av = Number(a?.[dataKey] ?? 0);
          const bv = Number(b?.[dataKey] ?? 0);
          return bv - av;
        });
    const funnelChart = (
      <ChartContainer config={config} className={className} {...containerProps}>
        <FunnelChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Funnel
            dataKey={dataKey}
            data={funnelData}
            nameKey={xAxisKey}
            {...animProps}
            {...funnelClickProps}
          >
            {/* objectui#13404 — the stage name sits INSIDE its segment. At
                `position="right"` every label started past its trapezoid's right
                edge, and the widest segment's edge IS the plot's, so all but the
                narrowest stage drew outside the surface and were clipped.
                Centred, a label is anchored on the funnel's axis, which runs
                down the middle of the chart, so no stage name can be pushed off
                it; and the halo keeps a name legible where it is wider than the
                narrowest segment and spills onto the background. Reserving a
                right margin instead would shrink every funnel by its longest
                stage name and still clip a name longer than the reserve. */}
            <LabelList position="center" dataKey={xAxisKey} {...HALO_LABEL_PROPS} />
            {funnelData.map((_entry, idx) => (
              <Cell key={`funnel-cell-${idx}`} fill={resolveColor(palette[idx % palette.length])} />
            ))}
          </Funnel>
        </FunnelChart>
      </ChartContainer>
    );
    return (
      <ChartFootnote note={unsizedRowsNote(funnelSizable.sizable, funnelSizable.total, dataKey)}>
        {funnelChart}
      </ChartFootnote>
    );
  }

  // Treemap — composition by relative size. Recharts <Treemap> is itself the
  // chart root (no wrapping cartesian chart); a custom content paints each
  // leaf with a palette color + label.
  if (chartType === 'treemap') {
    const dataKey = series[0]?.dataKey || 'value';
    const palette = getPalette();
    // objectui#7147 — see `countSizableRows`. A treemap's leaf area IS its
    // value, so an unsizable row collapses to nothing and its neighbours expand
    // to fill the box. Measured: `40 / null`, `40 / 0` and `40 / -25 / -12` all
    // rendered ONE full-bleed leaf labelled "Alpha", byte-identical to each
    // other AND to a genuinely one-row treemap. All-zero rows paint one
    // full-bleed leaf labelled with the LAST category.
    const treemapSizable = countSizableRows(data, dataKey);
    if (treemapSizable.total > 0 && treemapSizable.sizable === 0) {
      return <MagnitudeRefusal dataKey={dataKey} className={className} />;
    }
    const tmData = data.map((row, idx) => ({
      name: String(row?.[xAxisKey] ?? ''),
      size: Number(row?.[dataKey]) || 0,
      fill: resolveColor(palette[idx % palette.length]),
    }));
    const treemapChart = (
      <ChartContainer config={config} className={className} {...containerProps}>
        <Treemap data={tmData} dataKey="size" nameKey="name" {...animProps} content={<TreemapCell />} {...treemapClickProps}>
          <Tooltip />
        </Treemap>
      </ChartContainer>
    );
    return (
      <ChartFootnote note={unsizedRowsNote(treemapSizable.sizable, treemapSizable.total, dataKey)}>
        {treemapChart}
      </ChartFootnote>
    );
  }

  // Sankey — flow from a single root node to each category, weighted by value.
  // (The dashboard aggregate yields one value per category; a real multi-stage
  // flow needs richer data, but this honestly renders the sankey family.)
  if (chartType === 'sankey') {
    const dataKey = series[0]?.dataKey || 'value';
    const rootName = series[0]?.label || dataKey;
    const rows = data.filter((r) => (Number(r?.[dataKey]) || 0) > 0);
    // objectui#13404 — each category node carries its positional palette
    // colour, the same `palette[idx % palette.length]` the funnel and treemap
    // arms use. Recharts copies a node's own keys onto the laid-out node, so
    // `SankeyNodeShape` fills from it and `SankeyLinkShape` strokes the link
    // into it with the same colour. The root carries none: it is the total,
    // not a category, and draws in `SANKEY_ROOT_FILL`.
    const palette = getPalette();
    const nodes = [
      { name: rootName },
      ...rows.map((r, idx) => ({
        name: String(r?.[xAxisKey] ?? ''),
        fill: resolveColor(palette[idx % palette.length]),
      })),
    ];
    const links = rows.map((r, i) => ({ source: 0, target: i + 1, value: Number(r?.[dataKey]) || 0 }));
    if (links.length === 0) {
      // Rows ARRIVED and the filter above kept none of them, so there is no
      // flow to draw. This used to return a bare `<div>` — objectui#7140.
      //
      // Measured in Chromium before it was changed, against a populated
      // control that drew 1 `<svg>` / 7 `<path>`: the all-zero, all-null,
      // all-negative and unparseable-measure tiles each rendered ONE element
      // and nothing else (`descendantCount: 1`, `svg: 0`, `textContent: ''`),
      // and their screenshots were byte-identical to each other. No marks, no
      // text, no `role` — the one path in this file that put nothing at all on
      // the page, and pixel-identical to a render that crashed. A reader could
      // not tell a genuinely all-zero flow from a broken widget, which is the
      // distinction every other refusal here exists to make.
      //
      // Gated on rows being present for the same reason `hasNoCategoryKey` and
      // `hasNoPlottableSeries` are: handed NO rows the sentence below would be
      // false — there is no row whose measure could be anything. That is the
      // empty-RESULT question (objectui#7130), answered upstream in
      // `ObjectChart` where the query outcome is known, so this arm leaves the
      // no-rows case byte-for-byte as it was.
      //
      // ONE code and ONE sentence, for the reason `hasNoPlottableSeries`'
      // docstring gives: three causes reach here — a genuinely all-zero flow,
      // values a flow cannot represent because they are negative, and
      // unparseable measures that `Number(…) || 0` folds to zero — and naming
      // any ONE of them is a sentence that is false for the other two. The
      // predicate the filter actually applies is true for all three, so the
      // copy names THAT. No console warning either, unlike the two refusals
      // below: those carry a diagnostic pair that does not fit on screen,
      // whereas this message already names the key and the exact test it
      // failed.
      if (data.length === 0) {
        return <div className={className} />;
      }
      return (
        <ChartRefusal code="no-positive-flow" className={className}>
          This chart has no flow to draw: no row&apos;s{' '}
          <code className="font-mono">{dataKey}</code> is above zero.
        </ChartRefusal>
      );
    }
    // A PARTIAL flow SAYS it is partial — objectui#7148, the branch next door
    // to the refusal above.
    //
    // The filter is unconditional, so a dataset where only SOME rows survive it
    // draws a normal, healthy, confident sankey of a fraction of itself, and
    // nothing in the output carried that fact. Measured in Chromium at
    // origin/main fd11e1644 across 27 tiles: the card's own dataset
    // (`New business 40 / Refunds -25 / Chargebacks -12`) rendered `svg: 1`,
    // `path: 3`, 18 descendants, no `role`, no text, and — against a live
    // console control that did fire on the same instrument — ZERO console
    // output. Its screenshot hashed `13237e6e19a7072a`, BYTE-IDENTICAL to a
    // genuinely one-row dataset `[{ New business: 40 }]` and to three other
    // thinned shapes (one positive among zeros, positive + nulls, positive +
    // unparseable). Six datasets, one image. A reader had no bit of information
    // distinguishing a complete flow from a third of one, and nobody re-reads a
    // dataset that renders fine.
    //
    // ## Why a note beside the chart, and not a refusal
    //
    // Not a style preference — a refusal is unavailable here. objectui#7146
    // pins "one positive row among zeros still draws", and that fixture
    // (`0 / 7 / 0`) is ITSELF a thinned dataset: it lands in this branch, and
    // hashes identical to the mixed-sign tile above. Refusing on a thinned flow
    // would blank the chart that pin requires drawn.
    //
    // The drop is also not the defect. A flow has no negative width, so
    // discarding those rows is the only thing this arm CAN do with them. What
    // was missing was saying so — which is the whole change: the plot is the
    // element this arm already returned, unchanged, with one line of prose
    // under it.
    //
    // ## Why the copy names the PREDICATE and a COUNT, not a cause
    //
    // The reason the refusal above gives, and this branch is where that family
    // actually lives: `Number(…) || 0` folds negatives, zeros, `null`,
    // unparseable strings and a missing key into ONE discard, and all five were
    // measured reaching here beside a survivor. Naming any one of them is a
    // sentence that is false for the other four, so the copy names the
    // predicate the filter actually applies, which is true of all of them.
    //
    // The COUNT is the half a reader cannot recover from the picture. "Some
    // rows were dropped" still leaves a thinned flow indistinguishable from a
    // complete one; `1 of 3` is the bit that was missing.
    //
    // No console warning, matching the refusal above and unlike the two guards
    // at the bottom of this file: those carry a diagnostic PAIR that does not
    // fit on screen, whereas this sentence already names the key, the test it
    // failed, and how many rows failed it.
    const omittedRowCount = data.length - rows.length;
    return (
      <ChartFootnote
        note={
          omittedRowCount > 0 ? (
            <SankeyOmittedRowsNote shown={rows.length} total={data.length} dataKey={dataKey} />
          ) : null
        }
      >
        <ChartContainer config={config} className={className} {...containerProps}>
          <Sankey
            data={{ nodes, links }}
            nodePadding={24}
            link={SankeyLinkShape}
            node={SankeyNodeShape}
            {...sankeyClickProps}
          >
            <Tooltip />
          </Sankey>
        </ChartContainer>
      </ChartFootnote>
    );
  }

  // Radar chart
  if (chartType === 'radar') {
    return (
      <ChartContainer config={config} className={className} {...containerProps}>
        <RadarChart data={data}>
          <PolarGrid />
          <PolarAngleAxis dataKey={xAxisKey} tick={AXIS_TICK_STYLE} />
          <PolarRadiusAxis tick={AXIS_TICK_STYLE} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <ChartLegend
            content={<ChartLegendContent />}
            {...(isMobile && { verticalAlign: "bottom", wrapperStyle: { fontSize: '11px', paddingTop: '8px' } })}
          />
          {series.map((s: any) => {
            const color = resolveColor(config[s.dataKey]?.color || DEFAULT_CHART_COLOR);
            // objectui#8157 — this arm used to render a bare `fillOpacity={0.6}`
            // and read nothing off the series, so an authored `opacity` /
            // `dashArray` and the whole `variant: 'comparison'` treatment were
            // inert on `chartType: 'radar'` while every cartesian arm honoured
            // them. The `0.6` is a DEFAULT, not merely a bug — a radar fill
            // needs some opacity or an overlay is unreadable — so it stays, as
            // the fallback a series that declares nothing still lands on.
            const pres = seriesStyle(s, 'radar');
            return (
              <Radar
                key={s.dataKey}
                dataKey={s.dataKey}
                stroke={color}
                fill={color}
                fillOpacity={pres.fillOpacity ?? 0.6}
                strokeOpacity={pres.strokeOpacity}
                strokeDasharray={pres.strokeDasharray}
                {...animProps}
              />
            );
          })}
        </RadarChart>
      </ChartContainer>
    );
  }

  // Scatter chart
  if (chartType === 'scatter') {
    // objectui#7194 — see `SeriesArityRefusal`. Checked first: a binding fault
    // is true of the spec whatever the rows carry, so it outranks the
    // positional refusal below.
    if (series.length > 1) {
      return (
        <SeriesArityRefusal
          seriesKeys={series.map((s) => String(s.dataKey))}
          className={className}
        />
      );
    }
    // objectui#7171 — see `countPlottablePoints`. Scatter is the file's only
    // two-measure POSITIONAL family: `xAxisKey` feeds a `type="number"` XAxis
    // and `series[0]` a `type="number"` YAxis, so a point exists only if BOTH
    // are numbers. The y key is bound once here and handed to both the
    // predicate and the axis below, so the two cannot drift apart.
    const scatterYKey = series[0]?.dataKey || 'value';
    const points = countPlottablePoints(data, xAxisKey, scatterYKey);
    // Every number plotted on the x axis — the population a spec `stepSize`
    // lays its x ticks over, and scatter's alone to compute: on every other
    // family x is a category band, so `axisValues` reads the SERIES columns.
    const scatterXValues = data
      .map((row: any) => Number(row?.[xAxisKey]))
      .filter((n: number) => Number.isFinite(n));
    // The spec `format` for that same axis. Not `xAxisTickFormatter`, which is
    // the CATEGORY formatter (it resolves `config[value].label` and ISO dates)
    // and would be wrong on a measure; and omitted entirely when the author
    // declared no recognisable format, so the default render is untouched.
    const scatterXTickFormatter = formatterFor(xAxisSpec?.format, displayLocale);
    if (points.total > 0 && points.plottable === 0) {
      return <PositionRefusal xKey={xAxisKey} yKey={scatterYKey} className={className} />;
    }
    // objectui#7195 — see `NumericValueRefusal`. After the positional refusal,
    // which already answers every row lacking a placeable pair; this catches
    // what `isPlottableCoord` accepts on purpose — booleans — once the WHOLE
    // axis carries nothing else, so there is no scale to coerce them onto
    // (measured: 0 of N marks, silent, or under a footnote claiming some drew).
    // Before the footnote, which would otherwise count booleans as placed.
    if (points.total > 0) {
      // An axis whose spec declares both ends, or any `stepSize`, has a scale
      // without any row (`declaresScale`), so it is never dead: x reads the spec `xAxis`, y the primary `yAxes[0]` —
      // the same specs the two `<XAxis>` / `<YAxis>` below are handed.
      const deadAxes = (
        [[xAxisKey, xAxisSpec], [scatterYKey, yAxes?.[0]]] as Array<[string, NormalizedAxis | undefined]>
      )
        .filter(([key, axis]) => !declaresScale(axis) && !axisHasScale(data, key))
        .map(([key]) => key)
        .filter((key, i, all) => all.indexOf(key) === i);
      if (deadAxes.length > 0) {
        return <NumericValueRefusal keys={deadAxes} total={points.total} className={className} />;
      }
    }
    return (
      <ChartFootnote
        note={joinNotes(unplottedPointsNote(points.plottable, points.total, xAxisKey, scatterYKey), xPositionNote, yPositionNote)}
      >
      <ChartContainer config={config} className={className} {...containerProps}>
        <ScatterChart>
          {/* The same derived grid every cartesian sibling spreads, so a spec
              `showGridLines` on either axis is honoured (objectui#9792). With
              no axis declaring it this is horizontal lines only — what the
              literal `vertical={false}` it replaces drew. */}
          <CartesianGrid {...gridProps} />
          {/* Both axes carry the spec `ChartAxis` derivation every other
              family's numeric axis gets — `min`/`max` as the domain,
              `stepSize` as the ticks, `logarithmic` as the scale, `title` as
              the label and `format` as the tick text (objectui#9675). Scatter
              is this file's only family whose X is a MEASURE rather than a
              category band, which is why the x axis takes the same derivation
              here and the categorical `xAxisCommonProps` everywhere else.

              This composes with the edge margin objectui#7396 reserved rather
              than shadowing it: that card deliberately spent `padding`, which
              insets the pixel RANGE and leaves the domain alone, so both props
              are live at once — the domain is the author's, and no extreme
              mark is half-painted outside the plot box. */}
          <XAxis
            type="number"
            dataKey={xAxisKey}
            name={String(config[xAxisKey]?.label || xAxisKey)}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={false}
            minTickGap={isMobile ? 32 : 48}
            padding={SCATTER_X_AXIS_PADDING}
            {...(scatterXTickFormatter ? { tickFormatter: scatterXTickFormatter } : {})}
            // objectui#10587 — scatter's measure axis runs across the plot like
            // every category x axis, so `top` / `bottom` are its sides too
            // (see `placeXAxis`).
            {...(xAxisAcross ? { orientation: xAxisAcross } : {})}
            {...numericAxisSpecProps(xAxisSpec, scatterXValues, xAxisTitleLayoutFor(xAxisAcross))}
          />
          <YAxis
            type="number"
            dataKey={scatterYKey}
            name={String(config[series[0]?.dataKey]?.label || series[0]?.dataKey)}
            tick={AXIS_TICK_STYLE}
            tickLine={false}
            axisLine={false}
            tickFormatter={yTickFormatter}
            width={48}
            padding={SCATTER_Y_AXIS_PADDING}
            // objectui#10654 — the primary entry's `position`: `right` draws the
            // y axis on the right (see `placeYAxes`).
            {...(soleYSlot === 'right' ? { orientation: 'right' as const } : {})}
            {...yAxisSpecProps(primaryY, soleYSlot)}
          />
          {/* ⛔ No `<ZAxis>` here, deliberately — scatter mark AREA is recharts'
              own implicit default and is not configurable in this product
              today. This branch used to declare `<ZAxis type="number"
              range={[60, 400]} />`, which painted NOTHING: recharts'
              `selectZAxisWithScale` drops a z axis that carries no `dataKey`
              before it reaches a mark, so the declared envelope never applied
              and every mark came out at the implicit default size. Its only
              effect was on readers — and it did mislead one, in writing, on
              this repository: the triage comment on objectui#7396 derived a
              variable-bubble-size prediction from it whose every clause was
              false. ⭐ A DECLARATION IS NOT A READING: an inert declaration and
              a live one look identical in the source, so what this branch
              paints is stated by a test that reads the rendered symbol
              (`AdvancedChartImpl.scatterSymbolSize-9681.test.tsx`), never by a
              prop sitting here. Variable-area marks remain possible — they need
              a `dataKey` and a schema key to feed it, which is a new capability
              and its own card, not a prop restored here (objectui#9681). */}
          <ChartTooltip content={<ChartTooltipContent />} />
          {/* `nameKey` is REQUIRED here, for a reason unique to scatter
              (objectui#7248). `ChartLegendContent` resolves a label as
              `config[nameKey || item.dataKey || 'value']`, and a `<Scatter>`
              carries NO `dataKey` — scatter's keys live on the two axes, not on
              the mark. So the key collapsed to the literal `'value'`, missed a
              config keyed by measure name, and the entry rendered its colour
              swatch with NO TEXT beside it.

              What that looks like on screen is the whole card: an 8x8 dot in
              `--chart-1` — the SAME colour as the marks — sitting under the
              x-axis, which reads as a seventh data point plotted outside the
              plot area. Measured on the showcase Chart Gallery in real
              Chromium: swatch at cy 341 against a plot area ending at cy 295,
              on a y scale of 4.835 px per unit, i.e. y = -9.5 — which is
              exactly the "x≈40, y≈-10" the card reported as a stray point.

              The y DOMAIN was never the defect and is deliberately not touched:
              the same run measured all six marks inside the plot area, and
              mixed-sign and all-negative fixtures draw every mark inside too,
              because recharts extends the domain to cover negatives. */}
          <ChartLegend
            content={<ChartLegendContent nameKey={scatterYKey} />}
            {...(isMobile && { verticalAlign: "bottom", wrapperStyle: { fontSize: '11px', paddingTop: '8px' } })}
          />
          {series.map((s: any, index: number) => {
            const palette = getPalette();
            const color = resolveColor(config[s.dataKey]?.color || palette[index % palette.length]);
            const pres = seriesStyle(s, 'scatter');
            return (
              <Scatter
                key={s.dataKey}
                name={config[s.dataKey]?.label || s.dataKey}
                data={data}
                fill={color}
                fillOpacity={pres.fillOpacity}
                strokeOpacity={pres.strokeOpacity}
                strokeDasharray={pres.strokeDasharray}
                {...animProps}
                {...scatterClickProps}
              />
            );
          })}
        </ScatterChart>
      </ChartContainer>
      </ChartFootnote>
    );
  }

  // Combo chart (mixed families on one plot). Reached either by an explicit
  // `chartType: 'combo'` or by series that declare different families — see
  // `effectiveChartFamily`.
  if (chartType === 'combo') {
    return (
      <ChartFrame title={title} subtitle={subtitle}>
      <ChartFootnote note={joinNotes(xPositionNote, yPositionNote)}>
      <ChartContainer config={config} className={className} {...containerProps}>
        {/* `ComposedChart`, not `BarChart`, is the Recharts container built to
            host mixed marks. Under `BarChart` an `<Area>` child renders nothing
            at all, so the `seriesType === 'area'` arm below was unreachable —
            an authored combo with an `area` series drew a blank series. */}
        {/* `comboClickProps`, not `cartesianClickProps`: the chart-level
            handler here emits ONLY for a gesture a mark recorded, so an axis /
            surface click stays silent (objectui#4692's ruling). The emit still
            happens at chart level because that is the only place the CATEGORY
            is known — a line/area item handler is handed the curve's props and
            no datum. */}
        <ComposedChart ref={setChartSurface} data={data} {...comboClickProps}>
          <CartesianGrid {...gridProps} {...valueAxisIdFor(valueAxesHaveIds, categoriesRunDown)} />
          <XAxis dataKey={xAxisKey} {...xAxisCommonProps} />
          {/* A combo always draws both value axes (an authored combo binds an
              un-annotated line to the right one). Each carries the entry
              `placeYAxes` drew in its slot, or no spec config when none was —
              so a lone entry at `position: 'right'` configures the right axis
              only, and its title is not drawn on both sides (objectui#10654). */}
          <YAxis yAxisId="left" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={leftYTickFormatter} width={48} {...yAxisSpecProps(leftY, 'left')} />
          <YAxis yAxisId="right" orientation="right" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={rightYTickFormatter} width={48} {...yAxisSpecProps(rightY, 'right')} />
          {tooltipsEnabled ? <ChartTooltip content={<ChartTooltipContent />} /> : null}
          {legendVisible ? (
            <ChartLegend
              content={<ChartLegendContent />}
              {...(isMobile && { verticalAlign: "bottom", wrapperStyle: { fontSize: '11px', paddingTop: '8px' } })}
            />
          ) : null}
          {annotationEls}
          {brushEl}
          {series.map((s: any, index: number) => {
            const color = resolveColor(config[s.dataKey]?.color || DEFAULT_CHART_COLOR);
            // A derived combo knows what an un-annotated series is: the chart's
            // own family. Only an explicitly-authored `combo` has no base, and
            // there the index heuristic stands so those charts are unchanged.
            const seriesType = s.chartType || comboSeriesBase || (index === 0 ? 'bar' : 'line');
            // An explicit spec `series[].yAxis` wins over any default. Where
            // there is no `yAxis`, a DERIVED combo follows the spec, which
            // defaults `ChartSeries.yAxis` to 'left' — so widening a bar chart
            // into a combo changes the series' mark and nothing else. The
            // bar→left / line→right guess is kept only for an authored `combo`,
            // where historically it was the sole way to reach a second axis.
            const yAxisId = s.yAxis === 'right' || s.yAxis === 'left'
              ? s.yAxis
              : comboSeriesBase
                ? 'left'
                : (seriesType === 'bar' ? 'left' : 'right');
            const pres = seriesStyle(s, seriesType as any);
            const stackProps = s.stack ? { stackId: String(s.stack) } : {};
            const valueFormatter = formatterFor((yAxisId === 'right' ? rightY : leftY)?.format, displayLocale);

            if (seriesType === 'line') {
              return (
                <Line key={s.dataKey} yAxisId={yAxisId} type="monotone" dataKey={s.dataKey} stroke={color} strokeWidth={2} dot={false} strokeOpacity={pres.strokeOpacity} strokeDasharray={pres.strokeDasharray} {...animProps} {...comboMarkClickProps(s)}>
                  {dataLabel(valueFormatter)}
                </Line>
              );
            }
            if (seriesType === 'area') {
              return (
                <Area key={s.dataKey} yAxisId={yAxisId} type="monotone" dataKey={s.dataKey} fill={color} stroke={color} fillOpacity={pres.fillOpacity ?? 0.4} strokeOpacity={pres.strokeOpacity} strokeDasharray={pres.strokeDasharray} {...stackProps} {...animProps} {...comboMarkClickProps(s)}>
                  {dataLabel(valueFormatter)}
                </Area>
              );
            }
            return (
              <Bar key={s.dataKey} yAxisId={yAxisId} dataKey={s.dataKey} fill={color} radius={4} fillOpacity={pres.fillOpacity} strokeOpacity={pres.strokeOpacity} strokeDasharray={pres.strokeDasharray} {...stackProps} {...animProps} {...comboMarkClickProps(s)}>
                {dataLabel(valueFormatter)}
              </Bar>
            );
          })}
        </ComposedChart>
      </ChartContainer>
      </ChartFootnote>
      </ChartFrame>
    );
  }

  // Horizontal bar — swap X/Y axis types and orientation.
  const isHorizontal = chartType === 'horizontal-bar';

  // Build vertical fill gradients (bar + area) for every colour in play, so
  // fills read as a polished ramp instead of flat blocks (大屏 look). Inline
  // `style` on the stops makes the `--chart-*` CSS vars resolve.
  const _gpal = getPalette();
  // Per-category bars fill from a gradient keyed by the resolved colour, so any
  // semantic option colour (categoryColors) needs its own gradient def too.
  const _catColors = categoryColors ? Object.values(categoryColors).map((c) => resolveColor(String(c))) : [];
  const gradColors = Array.from(new Set<string>([
    ..._gpal,
    ..._catColors,
    ...series.map((s: any, i: number) => resolveColor(((config[s.dataKey] as any)?.color) || _gpal[i % _gpal.length] || DEFAULT_CHART_COLOR)),
  ]));
  const gslug = (c: string) => 'g' + c.replace(/[^a-zA-Z0-9]/g, '');

  return (
    <ChartFrame title={title} subtitle={subtitle}>
    <ChartFootnote note={joinNotes(xPositionNote, yPositionNote)}>
    <ChartContainer config={config} className={className} {...containerProps}>
      <ChartComponent ref={setChartSurface} data={data} layout={isHorizontal ? 'vertical' : 'horizontal'} {...cartesianClickProps}>
        <defs>
          {gradColors.map((c) => (
            <React.Fragment key={gslug(c)}>
              <linearGradient id={`bg-${gslug(c)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: c }} stopOpacity={0.95} />
                <stop offset="100%" style={{ stopColor: c }} stopOpacity={0.5} />
              </linearGradient>
              <linearGradient id={`ag-${gslug(c)}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: c }} stopOpacity={0.5} />
                <stop offset="95%" style={{ stopColor: c }} stopOpacity={0.05} />
              </linearGradient>
            </React.Fragment>
          ))}
        </defs>
        <CartesianGrid {...gridProps} {...valueAxisIdFor(valueAxesHaveIds, categoriesRunDown)} />
        {isHorizontal ? (
          <>
            {/* Horizontal bars swap the axis roles: the VALUE axes are x, so the
                spec y-axis config (domain/format/scale/title) applies to them.
                Each is drawn in the slot `placeYAxes` put its entry in — the
                `'left'` slot along the bottom, the `'right'` slot along the
                top — and its title is laid out for an axis running across the
                plot, under it at the bottom and over it at the top
                (objectui#10654). Two entries draw two value axes, each with its
                own id, and the bars below bind to those ids; the category axis
                carries none. */}
            {hasDualAxis ? (
              <>
                <XAxis xAxisId="left" type="number" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={leftYTickFormatter} {...yAxisSpecProps(leftY, 'left', X_AXIS_TITLE_LAYOUT)} />
                <XAxis xAxisId="right" orientation="top" type="number" tick={AXIS_TICK_STYLE} tickLine={false} axisLine={false} tickFormatter={rightYTickFormatter} {...yAxisSpecProps(rightY, 'right', X_AXIS_TOP_TITLE_LAYOUT)} />
              </>
            ) : (
              <XAxis
                type="number"
                tick={AXIS_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                tickFormatter={yTickFormatter}
                {...(soleYSlot === 'right' ? { orientation: 'top' as const } : {})}
                {...yAxisSpecProps(primaryY, soleYSlot, xAxisTitleLayoutFor(soleYSlot === 'right' ? 'top' : 'bottom'))}
              />
            )}
            {/* The spec `xAxis` follows the categories onto this axis, its
                `position` included: `left` / `right` are its sides here
                (objectui#10587, see `placeXAxis`). Its `title` follows them too,
                laid out for an axis running down the plot (objectui#10654). */}
            <YAxis
              type="category"
              dataKey={xAxisKey}
              tick={AXIS_TICK_STYLE}
              tickLine={false}
              axisLine={false}
              width={Math.min(140, Math.max(60, Math.max(...data.map(d => String(d[xAxisKey] ?? '').length)) * 7))}
              tickFormatter={xTickFormatter}
              {...(xAxisDown ? { orientation: xAxisDown } : {})}
              {...(xAxisSpec?.title ? { label: { value: xAxisSpec.title, ...yAxisTitleLayoutFor(xAxisDown) } } : {})}
            />
          </>
        ) : (
          <>
            {/* objectui#13390: line and area draw this axis as a point scale,
                which puts the edge categories on the plot edges, so it is
                inset (see `POINT_X_AXIS_PADDING`). Bar's band scale already
                centres them, and the combo branch above draws a value axis on
                each side of its plot, so neither is padded. */}
            <XAxis
              dataKey={xAxisKey}
              {...xAxisCommonProps}
              {...(chartType === 'line' || chartType === 'area' ? { padding: POINT_X_AXIS_PADDING } : {})}
            />
            {/* Each value axis carries the entry `placeYAxes` drew in its slot
                (objectui#10654): with two entries, one per side; with one, the
                only axis, on the side that entry named. */}
            {hasDualAxis ? (
              <>
                <YAxis
                  yAxisId="left"
                  tick={AXIS_TICK_STYLE}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={leftYTickFormatter}
                  width={48}
                  {...yAxisSpecProps(leftY, 'left')}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tick={AXIS_TICK_STYLE}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={rightYTickFormatter}
                  width={48}
                  {...yAxisSpecProps(rightY, 'right')}
                />
              </>
            ) : (
              <YAxis
                tick={AXIS_TICK_STYLE}
                tickLine={false}
                axisLine={false}
                tickFormatter={yTickFormatter}
                width={48}
                {...(soleYSlot === 'right' ? { orientation: 'right' as const } : {})}
                {...yAxisSpecProps(primaryY, soleYSlot)}
              />
            )}
          </>
        )}
        {tooltipsEnabled ? <ChartTooltip content={<ChartTooltipContent />} /> : null}
        {legendVisible ? (
          <ChartLegend
            content={<ChartLegendContent />}
            {...(isMobile && { verticalAlign: "bottom", wrapperStyle: { fontSize: '11px', paddingTop: '8px' } })}
          />
        ) : null}
        {annotationEls}
        {brushEl}
        {series.map((s: any, sIdx: number) => {
          const palette = getPalette();
          // Comparison series should mirror the color of the primary series
          // they overlay, not be assigned a fresh palette color. Find the
          // first non-comparison series above this one and reuse its color.
          const isComparison = s.variant === 'comparison';
          const baseSeries = isComparison
            ? (series.slice(0, sIdx).find((p: any) => p.variant !== 'comparison') || series[0])
            : s;
          const baseIdx = isComparison ? series.indexOf(baseSeries) : sIdx;
          const seriesColor = resolveColor(config[baseSeries.dataKey]?.color || palette[baseIdx % palette.length] || DEFAULT_CHART_COLOR);

          // Spec `series[].yAxis` binds this series to a value-axis slot. Only
          // meaningful once a second axis is declared, and bound to the id the
          // branch above rendered for that slot: a `<YAxis>` up the side of
          // the plot, an `<XAxis>` on horizontal-bar (objectui#10654 — a
          // `yAxisId` there named no rendered axis, and the bars were dropped).
          const slot: ValueAxisSlot = s.yAxis === 'right' ? 'right' : 'left';
          const axisProps = !hasDualAxis ? {} : isHorizontal ? { xAxisId: slot } : { yAxisId: slot };
          // Spec `series[].stack` — series sharing a group id stack together.
          // Recharts keys stacking off `stackId`, so the author's group name
          // passes through unchanged.
          const stackProps = s.stack ? { stackId: String(s.stack) } : {};
          const valueFormatter = formatterFor(axisOfSeries(s)?.format, displayLocale);

          if (chartType === 'bar' || chartType === 'horizontal-bar') {
            // One series, one colour: a bar's colour names its SERIES, so a
            // single-series bar chart draws every bar in the series colour.
            // A positional palette slot per bar carried no meaning — the
            // System Overview "Events by User" board drew each user in a
            // different hue (objectstack#25330). The one per-bar colour that
            // does carry meaning is a dimension's semantic option colour
            // (`categoryColors`, e.g. health green/red/yellow): a category
            // that has one keeps it, every other bar takes the series colour.
            // With a comparison overlay the chart has two series, so each
            // keeps its own series colour.
            const primaryCount = series.filter((p: any) => p.variant !== 'comparison').length;
            const semanticPerCategory = !!categoryColors && primaryCount === 1 && !isComparison && series.length === 1 && data.length > 1;
            const pres = seriesStyle(s, 'bar');
            return (
              <Bar key={s.dataKey} dataKey={s.dataKey} fill={`url(#bg-${gslug(seriesColor)})`} radius={4} fillOpacity={pres.fillOpacity} strokeOpacity={pres.strokeOpacity} strokeDasharray={pres.strokeDasharray} {...stackProps} {...axisProps} {...animProps} {...markClickProps(s)}>
                {semanticPerCategory && data.map((entry, idx) => (
                  <Cell key={`cell-${idx}`} fill={`url(#bg-${gslug(resolveColor(colorForCategory(entry?.[xAxisKey], idx, [seriesColor])))})`} />
                ))}
                {dataLabel(valueFormatter)}
              </Bar>
            );
          }
          if (chartType === 'line') {
            const pres = seriesStyle(s, 'line');
            return (
              <Line key={s.dataKey} type="monotone" dataKey={s.dataKey} stroke={seriesColor} strokeWidth={2} dot={false} strokeOpacity={pres.strokeOpacity} strokeDasharray={pres.strokeDasharray} {...axisProps} {...animProps} {...markClickProps(s)}>
                {dataLabel(valueFormatter)}
              </Line>
            );
          }
          if (chartType === 'area') {
            const pres = seriesStyle(s, 'area');
            return (
              <Area key={s.dataKey} type="monotone" dataKey={s.dataKey} fill={`url(#ag-${gslug(seriesColor)})`} stroke={seriesColor} strokeWidth={2} fillOpacity={pres.fillOpacity ?? 1} strokeOpacity={pres.strokeOpacity} strokeDasharray={pres.strokeDasharray} {...stackProps} {...axisProps} {...animProps} {...markClickProps(s)}>
                {dataLabel(valueFormatter)}
              </Area>
            );
          }
          return null;
        })}
      </ChartComponent>
    </ChartContainer>
    </ChartFootnote>
    </ChartFrame>
  );
}


/**
 * Detect the framework#4033 shape from props alone: rows are present, the chart
 * plots a category axis, and NOT ONE row carries the key it was told to plot.
 *
 * **Key ABSENT is what this asks, and only that** — `key in row` — which is the
 * line dividing it from objectui#4466's null bucket. The two failures look
 * identical on screen (an axis frame with no marks) and have different causes
 * and different answers:
 *
 *   - **key absent** — the dataset query grouped by a dimension it never
 *     PROJECTED, so no value for it exists anywhere. Nothing can be plotted and
 *     nothing can be labelled; this guard says so, naming the missing key.
 *   - **key present, value null** — a real group whose key happens to be NULL
 *     (`{user_id: null, event_count: 50}`, the shipped first-boot state of
 *     System Overview's "Events by User"). The data IS there, so it is drawn:
 *     `buildChartSeries` maps it to an explicit bucket label upstream of this
 *     component, and that guard never fires because `'user_id' in row` is true.
 *
 * That upstream mapping deliberately does not ADD the key to a row that lacks
 * it (see `bucketNullCategories` in `@object-ui/core`), which is what keeps this
 * predicate meaning what it says.
 */
/**
 * The family the refusal guards below judge, `column` read as the bar it draws.
 *
 * ⛔ No `'bar'` default (objectui#11520). Each guard used to restate the
 * component's own `= 'bar'`, so a chart that named no family was judged as a
 * bar here before it was drawn as one. It now names no family to them either:
 * none of them refuses it, and the component draws the unknown-type notice.
 */
function guardFamily(props: AdvancedChartImplProps): DeclaredChartFamily | undefined {
  return props.chartType === 'column' ? 'bar' : props.chartType;
}

function hasNoCategoryKey(props: AdvancedChartImplProps): boolean {
  const chartType = guardFamily(props);
  const rows = Array.isArray(props.data) ? props.data : [];
  const key = props.xAxisKey ?? 'name';
  return (
    chartType !== undefined &&
    CATEGORY_AXIS_CHART_TYPES.has(chartType) &&
    rows.length > 0 &&
    !rows.some((row) => row != null && typeof row === 'object' && key in row)
  );
}

/**
 * Chart families whose marks come from `series` AND NOTHING ELSE — the set the
 * series-axis guard below is allowed to refuse for.
 *
 * MEASURED in this file, not assumed, and deliberately NARROWER than
 * {@link CATEGORY_AXIS_CHART_TYPES}: `bar` / `horizontal-bar` / `line` / `area`
 * share one cartesian tail that renders `series.map(…)` and nothing else, and
 * `combo`'s `ComposedChart` does the same. Every other family reads
 * `series[0]?.dataKey || 'value'` — pie, donut, funnel, radar, scatter,
 * treemap, sankey all fall back to a `value` column and draw a perfectly good
 * chart with no series declared at all, so a refusal there would blank a
 * WORKING chart rather than explain a broken one.
 */
const SERIES_ONLY_CHART_TYPES: ReadonlySet<string> = new Set([
  'bar', 'horizontal-bar', 'line', 'area', 'combo',
]);

/**
 * The series-axis half of the same doctrine — objectui#4683.
 *
 * `hasNoCategoryKey` above answers "cannot know refuses loudly" for the FIRST
 * dimension. A pivoted chart has a second one, and it had no answer at all: a
 * pivot whose SECOND dimension was never projected produces
 * `series: []` with one bucket row per category, so the renderer drew axes,
 * grid, tooltip and legend around ZERO marks and said nothing. To the author
 * that reads as "no data matched", when what happened is that a dimension they
 * grouped BY never arrived.
 *
 * ## What this reads, and what it deliberately does NOT read
 *
 * The signal is `series: []` — {@link buildChartSeries}' own output — plus rows
 * to draw it against. NOT `groupKey in row`, which is the objectui#4507 trap
 * INVERTED: this component is handed the PIVOTED bucket rows, whose columns are
 * the group's VALUES, so the second dimension's own key is a column of no pivot
 * ever, ordinary ones included. A `key in row` test here would refuse every
 * grouped chart in the product.
 *
 * That keeps the three-way distinction intact, and each arm is pinned by a test:
 *
 *   - **null / `''` group values DRAW** (objectui#4673) — they are real groups,
 *     they get real buckets, so `series` is non-empty and this never fires;
 *   - **an unprojected group key REFUSES** — no row carries it, so no bucket
 *     exists, so `series` is `[]`: this fires;
 *   - **an ordinary pivot renders unchanged**, and so does a PARTIALLY
 *     projected one. That last is the mirror of `hasNoCategoryKey`'s own
 *     `!rows.some(…)`: the first dimension refuses only when NOT ONE row
 *     carries the key, and draws what projects otherwise. A pivot where some
 *     rows carry the group key yields those groups' series, so this stays
 *     silent and the chart draws what projected.
 *
 * ## Why the message cannot name the group key, and why that is honest
 *
 * `hasNoCategoryKey` names the key it could not find. This cannot, because the
 * renderer is not told which dimension the pivot grouped by — and the two
 * upstream shapes that reach it are byte-identical. Measured:
 * `buildChartSeries(rows, ['status','priority'], ['est_hours'])` with `priority`
 * unprojected and `buildChartSeries(rows, ['status'], [])` with no measure
 * selected BOTH return `{data:[{status:'Backlog'},…], xAxisKey:'status',
 * series:[]}`. Naming one cause would be a sentence that is false half the time,
 * which is worse than the silence this replaces — so the copy names the failure
 * and BOTH authoring causes, and the console warning carries the diagnostic pair
 * (`xAxisKey` + the keys the rows actually carry) exactly as the model does.
 *
 * ## Both "empty" and "never declared" refuse — and they say different things
 *
 * Two shapes reach here with rows and nothing to plot, and both refuse
 * (objectui#4695, maintainer ruling A):
 *
 *   - **`'empty'`** — `Array.isArray(series) && series.length === 0`: a binding
 *     was COMPUTED and came out empty, which is what both `buildChartSeries`
 *     call paths hand over for the objectui#4683 shape above.
 *   - **`'undeclared'`** — `series === undefined`: no binding was ever computed.
 *     The caller never went through the helper, and the schema declared no
 *     `series`, no `categories` and no y-axis field for `normalizeChartSchema`
 *     to derive one from. `AdvancedChartImplInner` defaults `series` to `[]`,
 *     so this used to draw the very same frame of zero marks, silently — the
 *     author (often an AI) wrote a chart with nothing to draw and was never
 *     told. That is an authoring mistake, so it is refused, not tolerated.
 *
 * The distinction has to be read HERE, on the raw props: past the inner
 * component's `series = []` default the two are the same array. They share one
 * placeholder and one `data-chart-error` code (the chart cannot plot a series
 * either way) and differ only in the sentence, because the fix differs —
 * project a dimension or select a measure for `'empty'`, declare a series at
 * all for `'undeclared'`.
 *
 * Only {@link SERIES_ONLY_CHART_TYPES} are refused, for the reason given on
 * that set: every other family falls back to a `value` column and draws.
 */
type NoPlottableSeries = 'empty' | 'undeclared';

function hasNoPlottableSeries(props: AdvancedChartImplProps): NoPlottableSeries | null {
  const chartType = guardFamily(props);
  const rows = Array.isArray(props.data) ? props.data : [];
  if (chartType === undefined || !SERIES_ONLY_CHART_TYPES.has(chartType) || rows.length === 0) return null;
  if (props.series === undefined) return 'undeclared';
  if (Array.isArray(props.series) && props.series.length === 0) return 'empty';
  return null;
}

/**
 * The series families' half of objectui#7195: series are bound and rows
 * arrived, but not one row carries a value any series' axis can build a scale
 * from. Returns the dead series keys, or `null` when anything can draw.
 *
 * Keyed on ALL series together, never per series, because that is what
 * measured as drawing nothing. A second series whose every value is boolean
 * beside a numeric one DRAWS (measured: bar 3 rectangles, line and area two
 * paths) — the numeric series gives the shared axis its scale and the booleans
 * are coerced onto it, the same neighbour effect as scatter's mixed tile. Only
 * when EVERY series is dead can the tile draw zero marks (bar, column,
 * horizontal-bar, line, area and combo alike) — and a series with a bar- or
 * area-mode stack is never dead: the stack gives its axis a scale whatever
 * its values, and every series on that axis is coerced onto it, so any such
 * series keeps the whole tile silent (seat ruling, round 4; see
 * `anchorsNumericAxis`). A whole-tile refusal needs every series dead, so the
 * axis each series binds to does not have to be resolved for this rule.
 *
 * That includes a dual-axis tile: one dead axis beside a live one still draws
 * the live axis's marks, so it is left drawing — measured and declined here,
 * because a whole-tile refusal would blank marks that are on screen.
 *
 * Only {@link SERIES_ONLY_CHART_TYPES}, for the reason given on that set; and
 * only once `hasNoPlottableSeries` has passed, since that is the guard that
 * owns "no series at all".
 *
 * ## Silent unless EVERY bound key resolves as a plain own property of a row
 *
 * This reads `row[key]`; Recharts reads `get(row, key)`, which also walks a
 * dotted path (`'a.b'` into `{ a: { b: 3 } }`). Rather than re-implement that
 * path grammar here — a second copy that could drift from the library's — a
 * bound key that is not an own property of any row is treated as UNRESOLVED,
 * and one unresolved key keeps the whole tile silent: this predicate cannot
 * tell whether that series draws, so it must not claim it does not (measured:
 * `a.b` beside an all-boolean `w` drew bar 3 rectangles / line 2 paths).
 * The same gate keeps a key NO row carries — the objectui#8266 shape — out of
 * this answer: when EVERY bound key is such a key, `hasNoCarriedSeriesKey`
 * refuses first with its own code (objectui#10396); when only SOME are, this
 * gate still errs to silence and neither refusal fires.
 *
 * ## A series on an axis with a declared scale is live
 *
 * See `declaresScale`: such an axis has a scale whatever the rows carry,
 * so booleans are coerced onto it and draw. A series' axis is read the way the
 * renderer binds it — through `placeYAxes`, the same call the renderer places
 * the entries with (objectui#10654) — over-approximated toward silence: on a
 * dual-axis tile `yAxis: 'left'` binds the entry drawn in the `'left'` slot;
 * anything else, and every series on a one-entry tile, may land on either
 * entry depending on the family and on whether the tile is a combo, so either
 * counts.
 */
function hasNoNumericSeriesValue(props: AdvancedChartImplProps): string[] | null {
  const chartType = guardFamily(props);
  const rows = Array.isArray(props.data) ? props.data : [];
  const series = Array.isArray(props.series) ? props.series : [];
  if (chartType === undefined || !SERIES_ONLY_CHART_TYPES.has(chartType) || rows.length === 0 || series.length === 0) return null;
  const keys = Array.from(new Set(series.map((s) => String(s.dataKey))));
  const resolved = keys.every((key) =>
    rows.some(
      (row) => row != null && typeof row === 'object' && Object.prototype.hasOwnProperty.call(row, key),
    ),
  );
  if (!resolved) return null;
  const yAxes = Array.isArray(props.yAxes) ? props.yAxes : [];
  const placement = placeYAxes(yAxes, chartType);
  const left = placement.left !== undefined ? yAxes[placement.left] : undefined;
  const right = placement.right !== undefined ? yAxes[placement.right] : undefined;
  const dual = !!left && !!right;
  const declared = (s: NormalizedSeries) =>
    declaresScale(left) || ((!dual || s.yAxis !== 'left') && declaresScale(right));
  const live = series.some(
    (s, i) =>
      stackModeOf(chartType, series, i) !== 'none' || declared(s) || axisHasScale(rows, String(s.dataKey)),
  );
  return live ? null : keys;
}

/**
 * The series half of the `missing-category-key` doctrine — objectui#10396, the
 * objectui#8266 shape: series are bound and rows arrived, but not one row
 * carries ANY bound series key. Returns those keys, or `null` when anything
 * can draw or this cannot tell.
 *
 * **Key ABSENT is what this asks, and only that** — `key in row`, the very
 * test `hasNoCategoryKey` makes for the category axis. A key that is present
 * with a `null`, boolean or unparseable value on every row is a different
 * diagnosis (the binding resolved, the axis has no scale) and belongs to
 * `hasNoNumericSeriesValue`'s `no-numeric-value`.
 *
 * ## Keyed on ALL series and ALL rows, like its siblings
 *
 *   - **One row carrying the key draws**, exactly as one row carrying the
 *     category key does (measured: bar 1 rectangle, line / area a path).
 *   - **One series whose key a row carries draws**, and a series beside it
 *     whose key no row carries is left silent: a whole-tile refusal would
 *     blank marks that are on screen (measured: bar 2 rectangles), the same
 *     reason `hasNoNumericSeriesValue` declines a dual-axis tile with one dead
 *     axis. An absent key beside a present-but-dead one (an all-boolean
 *     sibling) is left silent too — see that function's resolved-key gate.
 *   - **Every bound key absent refuses**, whatever else the tile declares: a
 *     stack, a declared `min` / `max` or `stepSize`, a second axis. None of
 *     them gives a mark a value to draw (measured on the base tree, bar /
 *     column / horizontal-bar / line / area / combo: 0 marks in every case).
 *
 * ## Only a plain key is judged
 *
 * Recharts reads a series through `get(row, key)` (es-toolkit's `compat/get`),
 * which returns `row[key]` for a key without a `.` or a `[`, and walks a path
 * otherwise (`'a.b'` into `{ a: { b: 3 } }` draws). Rather than re-implement
 * that path grammar, a path-shaped key is never judged absent, so one keeps
 * the whole tile silent — the same choice, for the same reason, as
 * `hasNoNumericSeriesValue`'s resolved-key gate. Erring to silence.
 *
 * Only {@link SERIES_ONLY_CHART_TYPES}, for the reason given on that set, and
 * only once `hasNoPlottableSeries` has passed, since that guard owns "no series
 * at all". Scatter's absent key is already refused by `no-plottable-points`.
 */
function hasNoCarriedSeriesKey(props: AdvancedChartImplProps): string[] | null {
  const chartType = guardFamily(props);
  const rows = Array.isArray(props.data) ? props.data : [];
  const series = Array.isArray(props.series) ? props.series : [];
  if (chartType === undefined || !SERIES_ONLY_CHART_TYPES.has(chartType) || rows.length === 0 || series.length === 0) return null;
  const keys: unknown[] = Array.from(new Set(series.map((s) => s.dataKey)));
  const absent = keys.every(
    (key) =>
      typeof key === 'string' &&
      /^[^.[]+$/.test(key) &&
      !rows.some((row) => row != null && typeof row === 'object' && key in row),
  );
  return absent ? (keys as string[]) : null;
}

/**
 * The refusal a series-only tile renders when not one row carries any bound
 * series key (objectui#10396). Worded after `missing-category-key`, whose
 * sentence it mirrors for the other half of the binding: it names every
 * missing key, joined with "or" as `NumericValueRefusal` joins its keys.
 * English literal, no locale key, matching every sibling sentence.
 */
function MissingSeriesKeyRefusal({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <ChartRefusal code="missing-series-key" className={className}>
      This chart cannot plot its series: no row has a{' '}
      {keys.map((key, i) => (
        <React.Fragment key={`${i}-${key}`}>
          {i > 0 ? ' or ' : ''}
          <code className="font-mono">{key}</code>
        </React.Fragment>
      ))}{' '}
      field.
    </ChartRefusal>
  );
}

/**
 * The shell both refusals render — one placeholder, two diagnoses.
 *
 * Stated once so the series-axis guard cannot drift from the framework#4033 one
 * it mirrors: same box, same `role="status"` (a refusal is a state, not an
 * alert), same muted centred type, and a `data-chart-error` code naming WHICH
 * refusal fired.
 */
function ChartRefusal({
  code,
  className,
  children,
}: {
  code: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex h-full min-h-[120px] w-full items-center justify-center p-4 text-center text-sm text-muted-foreground ${className ?? ''}`}
      role="status"
      data-chart-error={code}
    >
      <span>{children}</span>
    </div>
  );
}

/**
 * Public entry point. A THIN wrapper purely so the unreadable-data guard can
 * short-circuit without breaking the rules of hooks: the condition depends on
 * `data`, which arrives asynchronously, so an early return inside the renderer
 * would change its hook count between renders. The wrapper's own hook list is
 * fixed, and the renderer below is reached with data it can actually plot.
 */
export default function AdvancedChartImpl(props: AdvancedChartImplProps) {
  const missingCategoryKey = hasNoCategoryKey(props);
  // The x-axis refusal WINS when both apply: a chart whose rows carry no
  // category key at all cannot plot an axis, which is the more fundamental
  // failure and the more specific message. Without this gate such a chart would
  // also warn about its series, printing two diagnoses for one cause.
  const noPlottableSeries = missingCategoryKey ? null : hasNoPlottableSeries(props);
  // objectui#10396 comes THIRD: a series key no row carries needs a bound
  // series to be named, and when the category key is missing too, the axis
  // refusal above is the more fundamental answer (the objectui#8269 pin's
  // `name` / `value` pair). It is a BINDING diagnosis — the column is not
  // there — so it ranks above the scale diagnosis below.
  const missingSeriesKeys =
    missingCategoryKey || noPlottableSeries ? null : hasNoCarriedSeriesKey(props);
  // objectui#7195 comes FOURTH: it needs a category axis, a bound series and a
  // carried key to say anything true, so every guard above is the more
  // fundamental answer. Scatter's half of the same refusal lives in its own
  // arm, after the arity and positional refusals it ranks below.
  const noNumericSeriesValue =
    missingCategoryKey || noPlottableSeries || missingSeriesKeys ? null : hasNoNumericSeriesValue(props);
  const xAxisKey = props.xAxisKey ?? 'name';
  const firstRowKeys = React.useMemo(
    () => Object.keys((Array.isArray(props.data) ? props.data[0] : undefined) ?? {}),
    [props.data],
  );
  // Primitives, so the effect below re-runs on the diagnosis and never on the
  // identity of an array (AGENTS.md #10).
  const missingSeriesKeyList = missingSeriesKeys ? JSON.stringify(missingSeriesKeys) : null;
  const firstRowKeyList = JSON.stringify(firstRowKeys);

  React.useEffect(() => {
    if (!missingCategoryKey) return;
    // Names BOTH halves of the mismatch — the key the chart was told to plot and
    // the keys the rows actually carry. That pair is the whole diagnosis;
    // without it an author is left diffing a dataset against a chart spec by
    // hand, which is exactly what made framework#4033 expensive to find.
    console.warn(
      `[chart] no row has the category key "${xAxisKey}" — rendering an explanatory ` +
      `placeholder instead of an empty axis. Row keys: ${JSON.stringify(firstRowKeys)}. ` +
      `A dataset query must PROJECT the dimension it groups by (framework#4033).`,
    );
  }, [missingCategoryKey, xAxisKey, firstRowKeys]);

  React.useEffect(() => {
    if (!noPlottableSeries) return;
    // The same diagnostic PAIR the guard above prints, for the same reason: the
    // axis the chart did plot, and the keys its rows actually carry. In the
    // objectui#4683 shape that second half is the tell — bucket rows carrying
    // the category and NOTHING else say the group column was never written.
    // For the objectui#4695 shape the row keys are the other half of the fix:
    // they list the columns a series could have named.
    if (noPlottableSeries === 'undeclared') {
      console.warn(
        `[chart] no series binding was declared for the category axis "${xAxisKey}" — rendering an ` +
        `explanatory placeholder instead of an empty frame. Row keys: ${JSON.stringify(firstRowKeys)}. ` +
        `A bar / line / area / combo chart draws only the columns its \`series\` (or \`categories\`, ` +
        `or a y-axis \`field\`) names (objectui#4695).`,
      );
      return;
    }
    console.warn(
      `[chart] no series to plot against the category axis "${xAxisKey}" — rendering an ` +
      `explanatory placeholder instead of an empty frame. Row keys: ${JSON.stringify(firstRowKeys)}. ` +
      `A grouped chart's SECOND dimension must be PROJECTED by the dataset query, and a ` +
      `chart with no measure selected has nothing to draw either (objectui#4683, framework#4033).`,
    );
  }, [noPlottableSeries, xAxisKey, firstRowKeys]);

  React.useEffect(() => {
    if (!missingSeriesKeyList) return;
    // The diagnostic PAIR `missing-category-key` prints, for the series half:
    // the keys the series were told to plot and the keys the rows actually
    // carry. In the objectui#8266 shape the second half IS the fix — a
    // fieldless count's rows carry `count`, not `value`.
    console.warn(
      `[chart] no row has the series key(s) ${missingSeriesKeyList} — rendering an explanatory ` +
      `placeholder instead of an empty frame. Row keys: ${firstRowKeyList}. ` +
      `A series \`dataKey\` must name a column the rows carry (objectui#10396).`,
    );
  }, [missingSeriesKeyList, firstRowKeyList]);

  if (missingCategoryKey) {
    return (
      <ChartRefusal code="missing-category-key" className={props.className}>
        This chart cannot plot its category axis: no row has a{' '}
        <code className="font-mono">{xAxisKey}</code> field.
      </ChartRefusal>
    );
  }

  if (noPlottableSeries === 'undeclared') {
    return (
      <ChartRefusal code="no-plottable-series" className={props.className}>
        This chart cannot plot any series: none was declared to draw against its{' '}
        <code className="font-mono">{xAxisKey}</code> axis.
      </ChartRefusal>
    );
  }

  if (noPlottableSeries === 'empty') {
    return (
      <ChartRefusal code="no-plottable-series" className={props.className}>
        This chart cannot plot any series: no measure or group reached its{' '}
        <code className="font-mono">{xAxisKey}</code> axis.
      </ChartRefusal>
    );
  }

  if (missingSeriesKeys) {
    return <MissingSeriesKeyRefusal keys={missingSeriesKeys} className={props.className} />;
  }

  if (noNumericSeriesValue) {
    return (
      <NumericValueRefusal
        keys={noNumericSeriesValue}
        total={Array.isArray(props.data) ? props.data.length : 0}
        className={props.className}
      />
    );
  }

  return <AdvancedChartImplInner {...props} />;
}
