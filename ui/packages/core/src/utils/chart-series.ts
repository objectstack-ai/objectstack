/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * chart-series — shape a semantic-layer `queryDataset` result into the
 * `{ data, xAxisKey, series }` triple a chart renderer consumes (ADR-0021, #1759).
 *
 * Shared by `ObjectChart` (plugin-charts) and `DatasetWidget` (plugin-dashboard)
 * so multi-dimension charts visualise identically across surfaces.
 *
 * Rules:
 *  - **2+ dimensions, single measure** → pivot the SECOND dimension into one
 *    series per distinct value (grouped/coloured bars). `xAxisKey` = first
 *    dimension; each output row is one first-dimension bucket with a column per
 *    second-dimension value holding the measure. This makes the second dimension
 *    visible instead of just repeating the x-axis label.
 *  - **otherwise** (single dimension, or multiple measures) → first dimension is
 *    the x-axis and each measure is its own series (long format passes through).
 *
 * BOTH branches map a NULL first-dimension VALUE to an explicit bucket label
 * ({@link NULL_CATEGORY_LABEL}) so the group renders instead of vanishing —
 * objectui#4466 for the single-dimension branch, objectui#4497 for the pivot.
 * One doctrine, one predicate (`isNullCategory`), two call sites.
 *
 * The pivot's SECOND dimension gets the same answer as of objectui#4673, where
 * it needed one more thing than an axis bucket does: a series bucket's key is a
 * renderer `dataKey` AND a column in the emitted row, so it has to be
 * collision-safe as well as drawable. See {@link pivotSeriesBuckets}.
 *
 * A bucket's IDENTITY is separate from that display label (objectui#4508). The
 * label used to serve as its own key, which conflated two pairs of genuinely
 * different groups; see {@link chartBucketId} for the identity, and
 * {@link CHART_BUCKET_ID_KEY} for how it reaches a click handler.
 *
 * Key ABSENCE survives the pivot as of objectui#4507: an emitted bucket carries
 * the x-axis key exactly when some row of it did. A first dimension that was
 * grouped by but never PROJECTED therefore still reaches the renderer key-less,
 * where `hasNoCategoryKey` (framework#4033) names it instead of drawing an axis
 * with no marks. "Known to be empty" draws under the bucket label, "cannot
 * know" refuses — one doctrine, and now BOTH branches state it.
 */
import { pivotBucketId, pivotDimensionValue } from './dataset-pivot.js';

export interface ChartResultField {
  name: string;
  label?: string;
  format?: string;
  /**
   * The aggregate the measure column carries — the spec's
   * `AnalyticsResult.fields[].aggregate`, which the dataset answer states on
   * every measure column whose measure declares one, labelled or not
   * (objectstack#21995). Absent on dimension columns and derived measures.
   *
   * Typed `string`, not the closed vocabulary, for the reason
   * {@link BuiltinAggregateCarrier} gives: a JSON response is handed here
   * as-is, so the value is judged at the read ({@link isIntegerAggregate}).
   * {@link buildChartSeries} copies it onto each series it derives from the
   * column, so a value axis can tell a count from a sum (objectui#11681).
   */
  aggregate?: string;
}

/**
 * The OPTIONAL wire discriminator naming which server-side BUILT-IN default
 * measure a result column is (objectui#7258; producer half objectstack#14492).
 * The analytics service sets it ONLY on the measures it minted itself with a
 * hard-coded English default label (`count` → `'Count'`, …); an author-declared
 * measure never carries it, so its `label` stays the author's verbatim text
 * (objectui#4106). {@link resolveMeasureLabel} is the one reader.
 *
 * Declared BESIDE {@link ChartResultField} rather than on it, deliberately:
 * `dataset-result-field-spec-parity` pins every key of `ChartResultField` as a
 * key of the spec's `AnalyticsResult.fields[]`, and the `@objectstack/spec`
 * this package is built against does not carry `builtinAggregate` yet. The
 * intersection {@link ChartMeasureField} is what the helpers accept, so a
 * spec-typed field flows in unchanged today and carries the key the moment
 * the spec does — structurally, with no cast at the call sites.
 *
 * Typed as `string` rather than the closed {@link BuiltinAggregate} union on
 * purpose: a JSON response is handed here as-is, so the value is validated at
 * the lookup ({@link isBuiltinAggregate}) instead of trusted at the type.
 *
 * TODO(objectstack#14492): once the spec dependency is bumped past the release
 * that adds `AnalyticsResult.fields[].builtinAggregate`, fold this key into
 * `ChartResultField` as `DatasetResultField['builtinAggregate']` (pinning the
 * two closed vocabularies to each other in the parity suite) and retire the
 * carrier.
 */
export interface BuiltinAggregateCarrier {
  builtinAggregate?: string;
}

/** A result field as the series helpers read it: the renderer shape plus the optional discriminator. */
export type ChartMeasureField = ChartResultField & BuiltinAggregateCarrier;

/**
 * One renderer-internal series binding produced by {@link buildChartSeries}:
 * WHICH result-set column to draw and what to call it.
 *
 * NOT the spec's `ChartSeries` (`@objectstack/spec/ui`), which this type was
 * named after until objectstack#4115. That one is the AUTHORED dataset-binding
 * descriptor — `{ name, label?, type?, color?, stack?, yAxis, variant?,
 * dashArray?, opacity? }`, where `name` is a measure and no `data` is carried.
 * A third shape, `ChartDataSeries` in `@object-ui/types` (renamed in the same
 * burn-down), is the inline static-data series of an SDUI `ChartSchema` node.
 * Three different concepts; this is the one the chart renderers consume.
 */
export interface ChartSeriesBinding {
  dataKey: string;
  label: string;
  /**
   * The aggregate of the measure this series plots, copied from its result
   * column's `aggregate` (objectui#11681). Renderer-internal: the chart's value
   * axis draws whole-number ticks when every series on it plots an
   * {@link isIntegerAggregate} measure. Absent when the column states none.
   */
  aggregate?: string;
}

export interface ChartSeriesResult {
  data: Array<Record<string, unknown>>;
  xAxisKey: string | undefined;
  series: ChartSeriesBinding[];
}

/**
 * The closed vocabulary of server-side built-in default measures a result field
 * can declare itself as (objectui#7258 / objectstack#14492) — the spec's own
 * measure-aggregate enum spelling (`count_distinct`, not `countDistinct`), so
 * there is exactly ONE spelling on the wire and this list never grows on its
 * own: a value outside it is not "a new aggregate", it is an unrecognised one,
 * and {@link resolveMeasureLabel} treats it as absent.
 */
export const BUILTIN_AGGREGATES = ['count', 'sum', 'avg', 'min', 'max', 'count_distinct'] as const;

/** One member of {@link BUILTIN_AGGREGATES}. */
export type BuiltinAggregate = (typeof BUILTIN_AGGREGATES)[number];

/**
 * The aggregates whose every value is a whole number: a count of rows, or of
 * distinct values (objectui#11681, triage ruling Q3 A on that card). `sum` /
 * `min` / `max` over an integer field would qualify too, but the answer does
 * not state the source field's scale, so they are not judged integer here.
 */
export const INTEGER_AGGREGATES = ['count', 'count_distinct'] as const;

/**
 * Whether a measure column's `aggregate` makes every value a whole number — a
 * value axis that plots only such measures takes integer ticks
 * (objectui#11681). Judged over an untrusted wire value; anything else,
 * absence included, answers `false`, so the axis keeps its default.
 */
export function isIntegerAggregate(value: unknown): boolean {
  return typeof value === 'string' && (INTEGER_AGGREGATES as readonly string[]).includes(value);
}

/** Runtime membership test for {@link BUILTIN_AGGREGATES}, over an untrusted wire value. */
export function isBuiltinAggregate(value: unknown): value is BuiltinAggregate {
  return typeof value === 'string' && (BUILTIN_AGGREGATES as readonly string[]).includes(value);
}

/**
 * The LOCALIZED display label per built-in aggregate, as the layer that holds
 * the i18n provider resolved them (`@object-ui/i18n`'s
 * `builtinAggregateLabels(tt)`). Partial on purpose: an aggregate the caller
 * did not resolve falls back to the wire `label`, exactly as if the field had
 * carried no discriminator.
 */
export type BuiltinAggregateLabels = Partial<Record<BuiltinAggregate, string>>;

/**
 * The display label of ONE result field, for a legend / axis / tooltip.
 *
 * Resolution order (objectui#7258, maintainer ruling B of 2026-09-02):
 *  1. the field declares itself a built-in default measure
 *     (`builtinAggregate` ∈ {@link BUILTIN_AGGREGATES}) AND the caller resolved
 *     a locale label for it → that label. This is the only path that can
 *     replace a wire `label`, and it is keyed by a STRUCTURAL discriminator —
 *     never by matching the label's text or the field's name, both of which
 *     the ruling rejected (a real author measure literally named `count`, or
 *     labelled `Count`, must keep its own label);
 *  2. otherwise the wire `label` verbatim — the objectui#4106 contract for an
 *     author-declared measure (`'Tasks'` reaches the legend untouched);
 *  3. otherwise the field's `name`.
 *
 * So a discriminator the caller has no label for (a provider-less host, or a
 * value outside the closed vocabulary) costs nothing: the field renders exactly
 * what it rendered before the discriminator existed.
 */
export function resolveMeasureLabel(field: ChartMeasureField, labels?: BuiltinAggregateLabels): string {
  const aggregate = field.builtinAggregate;
  if (isBuiltinAggregate(aggregate)) {
    const localized = labels?.[aggregate];
    if (typeof localized === 'string' && localized !== '') return localized;
  }
  return field.label ?? field.name;
}

/**
 * The bucket a NULL/undefined category VALUE renders under, when the caller
 * supplies no localized label of its own (objectui#4466).
 *
 * English by construction and deliberately so: this package is React-free and
 * i18n-free (see {@link OptionLabelTranslator} for the same reason stated one
 * layer down), so the locale bundle cannot be read here. Every renderer that
 * has an i18n provider passes its own resolved label through
 * {@link ChartSeriesOptions.nullCategoryLabel} — this constant is the floor
 * that keeps a provider-less host (or a caller that has not been wired yet)
 * drawing the group rather than dropping it.
 *
 * Exported so a consumer can recognise the bucket it will be handed —
 * {@link findChartSeriesRow} uses the same default, which is what makes a
 * clicked bucket bar resolve back to its (raw null) dataset row.
 */
export const NULL_CATEGORY_LABEL = '(None)';

/**
 * The IDENTITY of the chart bucket a first-dimension raw value falls in —
 * distinct from the string that bucket DISPLAYS (objectui#4508).
 *
 * Deliberately the SAME encoder the pivot TABLE already keys its buckets with
 * (`pivotBucketId` over a `pivotDimensionValue`-normalized value), because the
 * two surfaces answer the same question about the same dataset rows and were
 * answering it differently: `buildPivot` gives a null dimension value a bucket
 * id no string can spell, while the chart used the display label as its own
 * key. That gap is the whole of objectui#4508 — see `dataset-pivot.ts` for why
 * the encoding is JSON rather than a delimiter or a placeholder character.
 *
 * Two collisions follow from a label-as-key, and one encoder closes both:
 *  - `null` and `''` are different groups. `String(x ?? '')` made them one
 *    bucket, so two groups drew ONE bar and one of them lost its drill.
 *    `[null]` and `[""]` are different ids.
 *  - a stored value that literally spells the bucket label (`'(None)'`, or any
 *    localized `nullCategoryLabel` — `'(未指定)'` and the other nine packs) is
 *    not the null group. `["(None)"]` and `[null]` are different ids, so the
 *    click resolves to the rows its own bar was drawn from.
 */
export function chartBucketId(rawValue: unknown): string {
  return pivotBucketId([pivotDimensionValue(rawValue)]);
}

/**
 * The key an emitted chart row carries its {@link chartBucketId} under, when it
 * carries one — the "alongside the display label" half of objectui#4508.
 *
 * **Written exactly when the display string does not name one bucket**, i.e.
 * when two or more DISTINCT buckets render the same axis text. That is not a
 * cost-saving heuristic, it is the complete condition: with the reader's
 * matching made exact (see {@link findChartSeriesRow}), a display string that
 * one bucket alone produces already identifies it, and the rows a chart is
 * drawn from are also an authoring-visible surface (`data` on a `chart`
 * schema) that renderer-internal metadata should not appear in for every
 * ordinary chart. Rows that do not carry the category key at all never get one
 * — they have no bucket, and that shape belongs to `hasNoCategoryKey`
 * (framework#4033), not here.
 *
 * Read it with {@link chartRowBucketId} rather than the literal key.
 */
export const CHART_BUCKET_ID_KEY = '__bucketId';

/**
 * Read the bucket identity off a row a chart was drawn from, or `undefined`
 * when the row carries none (an unambiguous bucket, or rows a caller built
 * itself rather than through {@link buildChartSeries}).
 *
 * Takes `unknown` because its callers hold a click payload, not a typed row:
 * recharts hands a pie/funnel click a SPREAD COPY of the data item, which is
 * why the identity is an ordinary enumerable property and not a symbol or a
 * non-enumerable one — either of those would silently not survive the copy.
 */
export function chartRowBucketId(row: unknown): string | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const id = (row as Record<string, unknown>)[CHART_BUCKET_ID_KEY];
  return typeof id === 'string' && id !== '' ? id : undefined;
}

/** Per-call knobs shared by {@link buildChartSeries} / {@link findChartSeriesRow}. */
export interface ChartSeriesOptions {
  /**
   * Display label for a category whose value is `null`/`undefined`. Defaults to
   * {@link NULL_CATEGORY_LABEL}.
   *
   * Pass the SAME value to both helpers: `buildChartSeries` writes it into the
   * rendered rows and `findChartSeriesRow` matches a clicked category against
   * it, so a mismatch costs the null bucket its drill-through.
   */
  nullCategoryLabel?: string;
  /**
   * Locale labels for the server's BUILT-IN default measures, keyed by the
   * wire discriminator a result field carries as `builtinAggregate`
   * (objectui#7258). Same division of labour as `nullCategoryLabel`: this
   * package is React-free and i18n-free, so the renderer that holds the
   * provider resolves the strings (`builtinAggregateLabels(tt)` in
   * `@object-ui/i18n`) and passes them in. Absent ⇒ every measure keeps its
   * wire `label`, which for a built-in default is the server's English.
   */
  builtinAggregateLabels?: BuiltinAggregateLabels;
}

/** Per-CLICK knobs for {@link findChartSeriesRow}, on top of the shared ones. */
export interface ChartDrillLookupOptions extends ChartSeriesOptions {
  /**
   * The clicked bucket's {@link chartBucketId}, when the renderer could read one
   * off the row the segment was drawn from ({@link chartRowBucketId} over
   * {@link CHART_BUCKET_ID_KEY}) — objectui#4508.
   *
   * Supplied ⇒ AUTHORITATIVE: the lookup matches on identity and ignores
   * `category` entirely, which is what lets two bars painting the same axis
   * text drill to their own rows instead of both resolving to the first.
   * Absent ⇒ the bucket's display string identified it on its own (that is
   * exactly when `buildChartSeries` writes no id), or the rows were not built
   * by `buildChartSeries` at all, and the display match answers.
   */
  bucketId?: string;
}

/**
 * What a chart renderer hands a drill handler when a segment is clicked.
 *
 * Declared HERE, beside the two helpers that write and read a bucket, rather
 * than re-spelled inline in each of the three packages that pass it along
 * (`AdvancedChartImpl` builds it, `ChartRenderer` and `ObjectChart` forward it,
 * `DatasetWidget` consumes it). It was three inline literals when
 * {@link ChartDrillLookupOptions.bucketId} needed a carrier, and a field added
 * to one of three copies reaches the consumer as `undefined` with nothing red.
 */
export interface ChartSegmentClickEvent {
  /** The clicked bucket's axis TEXT — what the user sees on the tick. */
  category?: string;
  /**
   * The clicked bucket's IDENTITY, when its row carried one (objectui#4508).
   * Feed it straight to {@link ChartDrillLookupOptions.bucketId}; it is the
   * only field that survives two buckets painting the same `category`.
   */
  categoryId?: string;
  /** The clicked series' key — a measure, or a pivoted second-dimension value. */
  series?: string;
  /**
   * The clicked series' DISPLAY LABEL, when the renderer knew one
   * (objectui#4682) — `series[].label` as {@link buildChartSeries} assigned it.
   *
   * {@link ChartSegmentClickEvent.series} stays the LOOKUP key and this never
   * substitutes for it: {@link findChartSeriesRow} resolves a key through the
   * same assignment `buildChartSeries` made, and a label cannot be resolved
   * that way — it is not unique (that is precisely why the colliding groups key
   * by identity instead). This field exists for what a key cannot do: be SHOWN.
   *
   * The two strings are equal for every ordinary group, which is why reading
   * the key as a title went unnoticed. They part company when a group's label
   * cannot name it — objectui#4508's collision on the series axis — and the key
   * becomes an opaque `chartBucketId`. A drawer titled `Backlog / [null]` over
   * a segment the user saw labelled `(None)` reads as broken DATA rather than
   * as a broken title, which is why the label travels with the click rather
   * than being re-derived by the consumer.
   *
   * Absent when the renderer resolved no series, or when the series carries no
   * label distinct from its key; a consumer titles itself from
   * `seriesLabel ?? series` and so is unchanged wherever it is absent.
   */
  seriesLabel?: string;
  /** The measure value at the click point. */
  value?: number;
}

/**
 * Does this row carry `key` with a NULL/undefined value — the shape that gets
 * the bucket label (objectui#4466 / objectui#4497)?
 *
 * ONE predicate for both of `buildChartSeries`' branches, so the doctrine
 * cannot drift between them: the pivot inherited the single-dimension answer in
 * objectui#4497 and this is the whole of what "the same answer" means.
 *
 * The key must be PRESENT: a row that does not carry the category key at all is
 * a different defect with a different answer — the dimension was grouped by but
 * never projected — and it belongs to `hasNoCategoryKey` in plugin-charts'
 * `AdvancedChartImpl`, which names the unprojected key instead of drawing an
 * axis (framework#4033). Bucketing that shape would relabel "this dimension was
 * never projected" as "these records have no value", which is a different
 * sentence and a false one.
 */
function isNullCategory(row: unknown, key: string): boolean {
  return carriesKey(row, key) && (row as Record<string, unknown>)[key] == null;
}

/**
 * Does this row carry `key` AT ALL — the precondition {@link isNullCategory}
 * and every bucketing call site share.
 *
 * Stated once because the two halves of the doctrine hang off it and the
 * difference is invisible at a glance: `row[key] == null` is TRUE for a row
 * that simply has no such column, so reading the raw value alone silently
 * relabels "this dimension was never projected" as "these records have no
 * value" (framework#4033's signal, erased). Every place that decides whether a
 * row has a bucket asks THIS, never the raw value.
 */
function carriesKey(row: unknown, key: string): boolean {
  return !!row && typeof row === 'object' && key in (row as Record<string, unknown>);
}

/**
 * The axis text a bucket paints, from its ALREADY-RESOLVED display value — the
 * string a chart library puts on the tick and hands back as the clicked
 * category. Two buckets "look alike" exactly when these are equal: `1` and
 * `'1'` included (which is why this stringifies rather than comparing raw
 * values), and an absent display alongside `''` (both paint a blank tick).
 *
 * Takes the display value, never the raw one: in both branches a null category
 * has ALREADY become the bucket label by the time ambiguity is asked about, and
 * feeding the raw value here would ask the question about the wrong string.
 */
function bucketDisplayKey(displayValue: unknown): string {
  return displayValue == null ? '' : String(displayValue);
}

/**
 * Which display strings are produced by MORE THAN ONE distinct bucket — the
 * complete set of cases where the axis text cannot name the bucket a user
 * clicked, and therefore exactly the set that needs {@link CHART_BUCKET_ID_KEY}
 * written (objectui#4508).
 *
 * Counted over DISTINCT ids, not over rows: two rows of the same group share
 * one id and are one bucket, so an ordinary repeated category is not ambiguous
 * and its rows stay untouched.
 */
function ambiguousDisplays(buckets: Array<{ id: string; display: string }>): Set<string> {
  const idsByDisplay = new Map<string, Set<string>>();
  for (const { id, display } of buckets) {
    let ids = idsByDisplay.get(display);
    if (!ids) idsByDisplay.set(display, (ids = new Set()));
    ids.add(id);
  }
  const ambiguous = new Set<string>();
  for (const [display, ids] of idsByDisplay) if (ids.size > 1) ambiguous.add(display);
  return ambiguous;
}

/**
 * Map a null/undefined category VALUE to its bucket label, for the
 * single-dimension branch (objectui#4466), and give a bucket whose label is
 * shared with another bucket its own identity (objectui#4508).
 *
 * Returns the input array itself when neither applied, and copies only the
 * rows it rewrites, so the caller's rows are never mutated — dataset surfaces
 * drill through by index into the RAW rows, which must keep their null.
 *
 * A row that does not carry `key` at all is left ENTIRELY alone: it has no
 * bucket to label and none to identify, and adding either would erase the
 * signal `hasNoCategoryKey` (framework#4033) reads.
 */
function bucketNullCategories(
  rows: Array<Record<string, unknown>>,
  key: string,
  label: string,
): Array<Record<string, unknown>> {
  // The value this row's bar will PAINT — the label when its category is null,
  // its own value otherwise. Ambiguity is a question about that string.
  const displayOf = (row: Record<string, unknown>): unknown =>
    isNullCategory(row, key) ? label : row[key];
  const ambiguous = ambiguousDisplays(
    rows.filter((row) => carriesKey(row, key)).map((row) => ({
      id: chartBucketId(row[key]),
      display: bucketDisplayKey(displayOf(row)),
    })),
  );
  let changed = false;
  const next = rows.map((row) => {
    if (!carriesKey(row, key)) return row;
    const isNull = isNullCategory(row, key);
    const shared = ambiguous.has(bucketDisplayKey(displayOf(row)));
    if (!isNull && !shared) return row;
    changed = true;
    return {
      ...row,
      ...(isNull ? { [key]: label } : {}),
      ...(shared ? { [CHART_BUCKET_ID_KEY]: chartBucketId(row[key]) } : {}),
    };
  });
  return changed ? next : rows;
}

/**
 * One pivoted SECOND-dimension group: what it is, what it says, and which
 * column of the emitted row carries its measure.
 */
interface PivotSeriesBucket {
  /** The group's {@link chartBucketId} — what two groups are told apart by. */
  id: string;
  /** The text the legend paints: the null bucket's label, or the value itself. */
  label: string;
  /** The emitted row's column for this group, and the renderer's `dataKey`. */
  dataKey: string;
}

/**
 * The pivot's series buckets, in first-seen order — objectui#4673.
 *
 * The second dimension used to be bucketed by `String(row[groupKey] ?? '')`
 * behind a `gId !== ''` gate, which is the PRE-objectui#4466 answer one
 * dimension over: a null (or empty-string) group never joined the series list,
 * while the line below the gate still wrote its measure into the bucket. The
 * number was in the emitted row and bound to no mark — the chart understated
 * its own data without saying so, which is #4466's harm verbatim.
 *
 * A series bucket needs one thing an axis bucket does not, and that is the
 * whole reason this is a function rather than two more lines inline: its key is
 * a **row column and a renderer `dataKey`**, so it must be UNIQUE within the
 * emitted row, where an axis bucket's key is a private map key. Hence the
 * assignment below, which is injective by construction:
 *
 *  - a bucket keys its column by its own LABEL — so an ordinary pivot's rows
 *    and series are byte-identical to what they have always been, and the
 *    legend, the tooltip and the drill title read the group's own text;
 *  - unless that label cannot NAME it: shared with another bucket (the null
 *    bucket beside a stored value spelling its label — objectui#4508's second
 *    collision, on the series axis), reserved by the row itself (`xKey`, whose
 *    column IS the axis value, and {@link CHART_BUCKET_ID_KEY}), or equal to
 *    some bucket's identity;
 *  - in which case it keys by its own IDENTITY, which no other bucket has.
 *
 * The third exclusion is what makes the first two safe rather than merely
 * likely: identities are pairwise distinct, and no surviving label is one of
 * them, so the two key spaces cannot meet. That is the card's "collision-safe"
 * requirement discharged, not approximated — a record whose stored group value
 * literally spells `[null]` is a real value with a real bar, and it keeps it.
 *
 * The empty-string group keys by its own label, `''`, exactly as it paints a
 * blank legend entry (and a blank tick on the x-axis — objectui#4508 ruled `''`
 * and `null` two different groups, and this is that ruling on the series axis).
 * Measured, not assumed: recharts binds `dataKey=""` through the same
 * `getValueByDataKey` path as any other key and draws the bar at its true
 * height. That measurement is pinned at the DOM in plugin-charts.
 *
 * A row that does not carry `groupKey` at all gets NO bucket and contributes no
 * column — the other half of the doctrine, unchanged: "known to be empty" draws
 * and "cannot know" refuses (framework#4033). Inventing a group for it would
 * merge unprojected rows into the empty-string group and call it data.
 */
function pivotSeriesBuckets(
  rows: Array<Record<string, unknown>>,
  groupKey: string,
  nullLabel: string,
  xKey: string,
): PivotSeriesBucket[] {
  const byId = new Map<string, { id: string; label: string }>();
  for (const row of rows) {
    if (!carriesKey(row, groupKey)) continue;
    const id = chartBucketId(row[groupKey]);
    if (byId.has(id)) continue;
    byId.set(id, { id, label: isNullCategory(row, groupKey) ? nullLabel : String(row[groupKey]) });
  }
  const buckets = Array.from(byId.values());
  const shared = ambiguousDisplays(buckets.map(({ id, label }) => ({ id, display: label })));
  const reserved = new Set([xKey, CHART_BUCKET_ID_KEY]);
  const identities = new Set(buckets.map(({ id }) => id));
  return buckets.map(({ id, label }) => ({
    id,
    label,
    dataKey: shared.has(label) || reserved.has(label) || identities.has(label) ? id : label,
  }));
}

export function buildChartSeries(
  rows: Array<Record<string, unknown>> | null | undefined,
  dimensions: string[] | null | undefined,
  values: string[] | null | undefined,
  fields?: ChartMeasureField[] | null,
  options?: ChartSeriesOptions,
): ChartSeriesResult {
  const dims = (dimensions ?? []).filter(Boolean);
  const vals = (values ?? []).filter(Boolean);
  const safeRows = Array.isArray(rows) ? rows : [];
  // A measure's series label: the locale label when the field declares itself
  // a built-in default measure and the caller resolved one, else the wire
  // `label` verbatim (objectui#4106), else the name — see `resolveMeasureLabel`.
  const labelOf = (name: string): string => {
    const field = (fields ?? []).find((f) => f.name === name);
    return field ? resolveMeasureLabel(field, options?.builtinAggregateLabels) : name;
  };
  // The measure column's own `aggregate`, spread onto each series that plots
  // it (objectui#11681) — present only when the column states a string one.
  const aggregateOf = (name: string): { aggregate?: string } => {
    const aggregate = (fields ?? []).find((f) => f.name === name)?.aggregate;
    return typeof aggregate === 'string' ? { aggregate } : {};
  };

  // Multi-dimension, single-measure → pivot the second dimension into series.
  if (dims.length >= 2 && vals.length === 1) {
    const xKey = dims[0];
    const groupKey = dims[1];
    const measure = vals[0];
    const nullLabel = options?.nullCategoryLabel ?? NULL_CATEGORY_LABEL;
    // Every second-dimension group, INCLUDING the null and empty-string ones
    // the `gId !== ''` gate used to drop on the floor (objectui#4673), each
    // already carrying the column its measure lands in.
    const groups = pivotSeriesBuckets(safeRows, groupKey, nullLabel, xKey);
    const columnById = new Map(groups.map(({ id, dataKey }) => [id, dataKey]));
    const byX = new Map<string, Record<string, unknown>>();

    for (const row of safeRows) {
      const xRaw = row[xKey];
      // The bucket KEY is the bucket's IDENTITY, not its display string
      // (objectui#4508). It used to be `String(xRaw ?? '')`, which merged two
      // groups that are not the same group: a stored `null` and a stored `''`
      // encoded identically, so they drew ONE bar carrying both groups' series
      // and the segment belonging to the later one resolved to no row at all.
      // `chartBucketId` keeps them apart, and every value that can spell the
      // bucket LABEL apart from the null bucket with it.
      //
      // The DISPLAY value stays what objectui#4497 made it: a null
      // first-dimension value renders under the bucket label rather than
      // reaching the renderer raw (which drew no mark — the objectui#4466
      // defect, one branch below). Key and display value are two different
      // things here, and now they are two different KINDS of thing.
      //
      // The bucket takes its label from the first row that CARRIES the key,
      // exactly as it took the CREATING row's raw value before — the same row
      // in every bucket a projected dimension produces, because a row whose
      // `xKey` is absent reads `xRaw === undefined` and therefore lands in the
      // `[null]` bucket and nowhere else.
      //
      // A bucket carries `xKey` exactly when SOME row of it did, and that is
      // objectui#4507: the write used to be unconditional, so a first dimension
      // GROUPED BY BUT NEVER PROJECTED (framework#4033 — no row carries the key
      // at all) reached the renderer as `{ [xKey]: undefined }`, `key in row`
      // answered true, and `hasNoCategoryKey` could not fire for a pivoted
      // chart. The defence was dead exactly where the defect it guards against
      // lands: every row collapsed into one bucket painting a blank tick, which
      // is the silent shape the placeholder exists to replace. The single-
      // dimension branch never had the problem — it passes rows through, so
      // key-absent rows stay key-absent — and this is that same answer here.
      //
      // MEASURED end to end before it was written (objectui#4507): the strategy
      // that maps engine rows to result rows writes a dimension key only when
      // the engine actually returned that column (`if (shortName in row)`), the
      // native-SQL strategy returns driver rows that carry only the columns the
      // statement selected, and JSON cannot transport `undefined` in the first
      // place — so an unprojected dimension arrives as an ABSENT key, while an
      // explicit `null` means the column WAS projected and its value is null.
      // Those are the two shapes, they are cleanly separated at the source, and
      // this branch now keeps them apart instead of merging them.
      //
      // Why the bug was invisible to every pin that "saw" the emitted row: both
      // `JSON.stringify` and `toEqual` DROP an undefined-valued key, so the
      // pivot's output read as key-absent everywhere except in the one test
      // that decides the placeholder — `key in row`.
      //
      // The upgrade in the second clause is not cosmetic. `chartBucketId`
      // encodes an absent value and a stored `null` identically (`[null]`, by
      // ADR-0021's normalization), so ONE bucket can collect both key-absent
      // rows and rows whose category is genuinely null. If any of its rows
      // carried the key, the bucket is "known to be empty" and draws under the
      // label; refusing there would tell the author their query never projected
      // a dimension that it did project — a false sentence, and the mirror of
      // the false sentence objectui#4497 refused to print by NOT relabelling a
      // key-absent row `(None)`. Both halves of that doctrine are now live in
      // this branch: key absent everywhere → the framework#4033 placeholder;
      // key present with a null value → the bucket label.
      const xId = chartBucketId(xRaw);
      let bucket = byX.get(xId);
      if (!bucket) byX.set(xId, (bucket = {}));
      if (carriesKey(row, xKey) && !carriesKey(bucket, xKey)) {
        bucket[xKey] = isNullCategory(row, xKey) ? nullLabel : xRaw;
      }
      // The group's own column, or nothing at all when the row carries no
      // second dimension to be grouped BY. Nothing at all is the point: the
      // old code wrote such a row's measure under `''` — a column no series
      // bound to, and after objectui#4673 the empty-string GROUP's column,
      // which would hand an unprojected row's number to a real group's bar.
      const column = carriesKey(row, groupKey)
        ? columnById.get(chartBucketId(row[groupKey]))
        : undefined;
      if (column !== undefined) bucket[column] = row[measure];
    }

    // Two DISTINCT buckets can still render the same axis text — the null
    // bucket beside a stored value that literally spells its label. Those, and
    // only those, carry their identity to the click handler.
    const ambiguous = ambiguousDisplays(
      Array.from(byX.entries()).map(([id, bucket]) => ({
        id,
        display: bucketDisplayKey(bucket[xKey]),
      })),
    );

    return {
      data: Array.from(byX.entries()).map(([id, bucket]) =>
        ambiguous.has(bucketDisplayKey(bucket[xKey]))
          ? { ...bucket, [CHART_BUCKET_ID_KEY]: id }
          : bucket,
      ),
      xAxisKey: xKey,
      // Series labels are the second-dimension values themselves (already
      // server-resolved to display labels by queryDataset), except the null
      // group, which says so with the bucket label the renderer supplied. The
      // key is a separate question from the text — see `pivotSeriesBuckets`.
      // Every group plots the one measure, so each carries its aggregate.
      series: groups.map(({ dataKey, label }) => ({ dataKey, label, ...aggregateOf(measure) })),
    };
  }

  // Default: first dimension on the x-axis, one series per measure.
  //
  // A row whose category VALUE is null renders under an explicit bucket rather
  // than reaching the renderer with a null category, which draws no mark at all
  // (objectui#4466). The measured cost of passing it through was not an empty
  // chart but a quietly WRONG one: `[{user_id: null, event_count: 51},
  // {user_id: 'Dev Admin', event_count: 2}]` drew one bar, dropping the
  // dominant group while the y-axis scale still accommodated it.
  //
  // The pivot branch above answers this the SAME way as of objectui#4497 — it
  // was left alone here only until its own bucketing had been measured, which
  // is what that card did. The two branches differ in WHERE the label lands
  // (there: the bucket's display value, the map key untouched; here: the row
  // itself), never in what a null category means.
  const xKey = dims[0];
  return {
    data: xKey
      ? bucketNullCategories(safeRows, xKey, options?.nullCategoryLabel ?? NULL_CATEGORY_LABEL)
      : safeRows,
    xAxisKey: xKey,
    series: vals.map((v) => ({ dataKey: v, label: labelOf(v), ...aggregateOf(v) })),
  };
}

/**
 * Resolve select/enum dimension VALUES to display LABELS in chart rows.
 *
 * Analytics groups by a select field's stored `value` (e.g. `active`), but a
 * chart axis should read the option `label` (e.g. `合作中`). The server SHOULD
 * resolve this (ADR-0021), but when it can't — an AI-built select whose
 * `options` the analytics layer never sees, so its `resolveDimensionLabels`
 * silently no-ops — the rows arrive value-keyed. The axis then shows raw enum
 * values, and (worse) option-keyed colour / category wiring built from the
 * field `label`s no longer lines up with the value-keyed rows, so categories
 * read empty. This is the chart-layer safety net the legacy aggregate path
 * already gets from `resolveGroupByLabels`.
 *
 * Each row is rewritten by replacing `row[dim]` with `labelMaps[dim][value]`
 * when a mapping exists. Measure columns are untouched, so the grouped count
 * stays attached to its (now label-keyed) category — `value` is the matching
 * key, `label` is only the display. Values with no mapping (already a label
 * because the server resolved it, a lookup id, free text) pass through, so this
 * is safe to run unconditionally and is idempotent.
 *
 * Returns a NEW array; a row that needs no change keeps its identity, and the
 * input rows are never mutated, so the server's raw rows survive for
 * index-aligned drill-through (`drillRawRows`).
 */
export function relabelDimensions(
  rows: Array<Record<string, unknown>> | null | undefined,
  labelMaps: Record<string, Record<string, string>> | null | undefined,
): Array<Record<string, unknown>> {
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!labelMaps) return safeRows;
  const dims = Object.keys(labelMaps).filter(
    (d) => labelMaps[d] && Object.keys(labelMaps[d]).length > 0,
  );
  if (dims.length === 0) return safeRows;
  return safeRows.map((row) => {
    let next: Record<string, unknown> | null = null;
    for (const dim of dims) {
      const raw = row[dim];
      if (raw == null) continue;
      const label = labelMaps[dim][String(raw)];
      if (label != null && label !== raw) {
        if (!next) next = { ...row };
        next[dim] = label;
      }
    }
    return next ?? row;
  });
}

/**
 * Inverse of {@link buildChartSeries}: map a clicked chart segment back to the
 * index of its source dataset row, so a chart click can drill through to the
 * same records a table/pivot row would.
 *
 * Mirrors `buildChartSeries`' pivot rule:
 *  - **2+ dimensions, single measure** (second dim pivoted into series) → match
 *    BOTH the x-axis dimension (`category`) and the series dimension (`seriesKey`).
 *  - **otherwise** → match the x-axis (first) dimension only.
 *
 * The x-axis comparison is string-wise on the rows' display values (which is
 * what the chart surfaces as `category`), unless the click carried a bucket
 * IDENTITY — {@link ChartDrillLookupOptions.bucketId} — in which case that is
 * authoritative and the display string is not consulted at all. Returns `-1`
 * when nothing matches.
 *
 * The SERIES comparison is not string-wise at all as of objectui#4673: a series
 * key is a `dataKey` {@link buildChartSeries} assigned, so it is resolved back
 * through the same {@link pivotSeriesBuckets} assignment (same rows, same
 * `nullCategoryLabel`) to the group IDENTITY it names, and rows are matched on
 * that. A null-valued second dimension had no series at all before, so its
 * segment could not be clicked; now it can, and `String(r[gDim] ?? '')` would
 * have answered that click with an empty-string group's rows — the same
 * conflation objectui#4508 removed on the x-axis.
 *
 * The NULL-category bucket {@link buildChartSeries} renders (objectui#4466) is
 * matched back to its row here, and it has to be: the caller passes the rows it
 * charted FROM (still carrying the raw null) while the click event carries the
 * bucket LABEL, so without this the one bar the fix made visible would resolve
 * to `-1` and its drill-through would silently no-op. Pass the same
 * `nullCategoryLabel` both helpers were given.
 *
 * **A null category reads as its bucket LABEL and nothing else** (objectui#4508).
 * It used to read as the label OR the empty string, on the stated grounds that
 * `''` is the drill layer's own spelling of "no group value" — but no producer
 * of this function's `category` argument writes that spelling (the one
 * production caller feeds it a chart click's category, and `computeDrillFilter`
 * is downstream of the drill, not upstream of this lookup), while `''` IS what
 * a genuine empty-string group paints. So the tolerance cost that group its own
 * drill and gave it a null group's records instead — a WRONG click, not a dead
 * one. `''` now means the empty-string group, which is what it says.
 *
 * **`xOf` covers BOTH arms, which is what let objectui#4497 bucket the pivot
 * branch without touching this function.** Worth stating because the reverse
 * would be silent: the pivot's emitted rows are AGGREGATED (`byX` collapses N
 * raw rows into one bucket per first-dimension value), so they are NOT
 * index-aligned with anything, and a caller cannot drill by the emitted row's
 * position. It drills by SEARCHING the raw rows here and indexing
 * `drillRawRows` with what this returns — see `DatasetWidget.handleChartDrill`,
 * the one production caller. So the pivot's map key and its emitted display
 * value being two different things never reached the drill: the raw rows this
 * searches still carry their null either way, and `xOf` reads the label back to
 * them in the multi-dimension arm exactly as in the single-dimension one.
 */
export function findChartSeriesRow(
  rows: Array<Record<string, unknown>> | null | undefined,
  dimensions: string[] | null | undefined,
  values: string[] | null | undefined,
  category: string | undefined,
  seriesKey?: string,
  options?: ChartDrillLookupOptions,
): number {
  const dims = (dimensions ?? []).filter(Boolean);
  const vals = (values ?? []).filter(Boolean);
  const safeRows = Array.isArray(rows) ? rows : [];
  const xDim = dims[0];
  if (!xDim) return -1;
  const c = String(category ?? '');
  const nullLabel = options?.nullCategoryLabel ?? NULL_CATEGORY_LABEL;
  const bucketId = options?.bucketId;
  // Identity wins outright when the click carried one: it is the ONE thing that
  // survives two buckets painting the same axis text, which is the case the
  // display string provably cannot answer.
  const matchesX =
    typeof bucketId === 'string' && bucketId !== ''
      ? (r: Record<string, unknown>): boolean => chartBucketId(r[xDim]) === bucketId
      // Otherwise the bucket's own display string, exactly: a null category
      // reads as its rendered label, every other value as itself.
      : (r: Record<string, unknown>): boolean => (r[xDim] == null ? nullLabel : String(r[xDim])) === c;
  if (dims.length >= 2 && vals.length === 1) {
    const gDim = dims[1];
    // The clicked series key is a `dataKey` `buildChartSeries` ASSIGNED, so it
    // is resolved the way it was assigned — through the same buckets, rebuilt
    // from the same raw rows (`DatasetWidget.handleChartDrill`, the one
    // production caller, hands both helpers the same array and the same
    // `nullCategoryLabel`). Matching then compares IDENTITIES, which is
    // objectui#4508's answer extended to the series axis: `String(r[gDim] ?? '')`
    // was display-string matching, and it spelled a null group and an
    // empty-string group alike — the tolerance #4508 removed one dimension over.
    const groups = pivotSeriesBuckets(safeRows, gDim, nullLabel, xDim);
    const gId = groups.find(({ dataKey }) => dataKey === String(seriesKey ?? ''))?.id;
    // No bucket answers to that key: these rows have no such group, so no row
    // can belong to it. `-1` is the documented "nothing matched" — widening to
    // a string comparison here would put back exactly what #4508 measured out.
    if (gId === undefined) return -1;
    return safeRows.findIndex(
      (r) => matchesX(r) && carriesKey(r, gDim) && chartBucketId(r[gDim]) === gId,
    );
  }
  return safeRows.findIndex((r) => matchesX(r));
}

/**
 * Build a per-category colour map from a select/lookup field's `options`.
 *
 * Keyed by BOTH the option `value` AND its display `label`, because a chart
 * row's category may carry either — the server resolves dataset select
 * dimensions value→label, while the legacy aggregate path keeps the raw value.
 * Returns `null` when the field has no options or none carry a colour, so the
 * caller can fall back to the positional palette.
 *
 * Shared by `ObjectChart` (plugin-charts) and `DatasetWidget` (plugin-dashboard)
 * so a select/lookup dimension's option colours (e.g. health green/red/yellow)
 * paint identically across the chart view and dashboard widgets.
 */
export function buildOptionColorMap(options: unknown): Record<string, string> | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const map: Record<string, string> = {};
  for (const opt of options) {
    if (opt && typeof opt === 'object') {
      const o = opt as { value?: unknown; label?: unknown; color?: unknown };
      if (typeof o.color === 'string' && o.color) {
        if (o.value != null) map[String(o.value)] = o.color;
        if (o.label != null) map[String(o.label)] = o.color;
      }
    }
  }
  return Object.keys(map).length > 0 ? map : null;
}

/**
 * Build the DECLARED category order from a select field's `options` — the
 * sequence the author wrote them in on the object (framework#3588).
 *
 * A picklist's option order is already the domain order: a sales `stage` field
 * lists Qualification → Needs Analysis → Proposal → Negotiation because that IS
 * the pipeline. Analytics groups by that field and returns buckets in whatever
 * order the GROUP BY produced (usually alphabetical), which for an
 * ordered-sequence chart — a funnel above all — draws a shape that reads as a
 * pipeline but isn't one.
 *
 * Emits BOTH the stored `value` and its display `label` per option, adjacent
 * and in declared order, for the same reason {@link buildOptionColorMap} keys
 * by both: a chart row's category may carry either, depending on whether the
 * server resolved the dimension's labels. Rank is "index of first match", so
 * either key ranks the option identically.
 *
 * Returns `null` for a field with no options, so callers keep their existing
 * ordering (a funnel falls back to descending by value).
 */
export function buildCategoryOrder(options: unknown): string[] | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const keys: string[] = [];
  for (const opt of options) {
    if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
      keys.push(String(opt));
      continue;
    }
    if (opt && typeof opt === 'object') {
      const o = opt as { value?: unknown; label?: unknown };
      if (o.value != null) keys.push(String(o.value));
      if (o.label != null && String(o.label) !== String(o.value)) keys.push(String(o.label));
    }
  }
  return keys.length > 0 ? keys : null;
}

/**
 * Rank map for {@link buildCategoryOrder} keys — `category → position`, first
 * occurrence wins. Categories absent from the declared order get no entry; the
 * caller decides where those sort (see `AdvancedChartImpl`, which keeps them
 * after the declared ones rather than dropping them).
 */
export function buildCategoryRank(order: string[] | null | undefined): Map<string, number> | null {
  if (!Array.isArray(order) || order.length === 0) return null;
  const rank = new Map<string, number>();
  order.forEach((key, i) => {
    if (!rank.has(key)) rank.set(key, i);
  });
  return rank.size > 0 ? rank : null;
}

/**
 * The i18n seam of the analytics label net (objectui#4030).
 *
 * `(storedValue, authoredLabel) => displayLabel` — the SAME signature
 * `resolveGroupByLabels` (plugin-charts) already takes for the legacy aggregate
 * path, which callers bind to `useSafeFieldLabel().fieldOptionLabel(object,
 * field, …)`. That resolver reads `{ns}.fieldOptions.<object>.<field>.<value>`,
 * the one convention list and form surfaces already translate select options
 * through (`useObjectLabel.translateOptions`, and `@objectstack/spec` names
 * objectui as its reader). Analytics reuses that channel rather than growing a
 * chart-side per-locale dialect.
 *
 * Omitted everywhere it isn't available (no i18n provider, an unresolvable
 * owning object): every helper below then behaves exactly as it did before this
 * seam existed.
 */
export type OptionLabelTranslator = (value: string, authoredLabel: string) => string;

/** One option, normalized out of the `{value,label}` / bare-string spellings. */
function optionValueLabel(opt: unknown): { value: string; label: string } | null {
  if (typeof opt === 'string' || typeof opt === 'number' || typeof opt === 'boolean') {
    // A bare-string option IS its own label. Nothing to resolve, but there is
    // something to TRANSLATE — the bundle is keyed by the stored value.
    return { value: String(opt), label: String(opt) };
  }
  if (opt && typeof opt === 'object') {
    const o = opt as { value?: unknown; label?: unknown };
    if (o.value != null && o.label != null) return { value: String(o.value), label: String(o.label) };
  }
  return null;
}

/**
 * Run a select field's `options` through the locale bundle, returning options
 * whose `label` is the translated one (objectui#4030).
 *
 * The mirror of `useObjectLabel().translateOptions` — the channel list and form
 * surfaces localize select options through — kept pure and shape-tolerant so
 * the analytics net can apply it at the point the resolved options are read.
 * Everything downstream ({@link buildOptionColorMap},
 * {@link buildCategoryOrder}) keeps reading `option.label` and needs no
 * knowledge of i18n, exactly like `SelectCellRenderer` on the list side.
 *
 * Colour, order and every other option key survive untouched — only `label`
 * changes. Returns the input ARRAY ITSELF when there is no translator or
 * nothing translated, so an untranslated app keeps the identities (and the
 * memo/render behaviour) it had before.
 */
export function localizeFieldOptions(options: unknown, translate?: OptionLabelTranslator): unknown {
  if (!translate || !Array.isArray(options) || options.length === 0) return options;
  let changed = false;
  const next = options.map((opt) => {
    const vl = optionValueLabel(opt);
    if (!vl) return opt;
    const display = translate(vl.value, vl.label);
    if (display === vl.label) return opt;
    changed = true;
    // A bare-string option becomes an object so the translation has somewhere
    // to live; its value is preserved, which is the only identity that matters.
    return opt && typeof opt === 'object'
      ? { ...(opt as object), label: display }
      : { value: vl.value, label: display };
  });
  return changed ? next : options;
}

/**
 * Build a `{ value → label }` map from a select/enum field's `options`, for
 * resolving a grouped dimension's stored value to its display label (fed to
 * {@link relabelDimensions}). Mirrors {@link buildOptionColorMap}.
 *
 * Options may be `{ value, label }` objects or bare strings (value == label —
 * nothing to relabel). Only entries whose display label actually differs from
 * the key are kept, so the map is empty (→ `null`) when relabeling would be a
 * no-op and the caller can skip it entirely.
 *
 * **With a `translate` seam (objectui#4030) the map gains a SECOND key per
 * option: the AUTHORED label.** A dimension's rows reach this net keyed either
 * way — value-keyed when the server did not resolve the dimension (the whole
 * reason this net exists), already label-keyed when it did (ADR-0021) — and
 * the reported symptom is the second case: a chart legend showing the object's
 * English `label` verbatim beside a related list showing the translation. One
 * key resolves `orion`, the other re-translates `Orion Engineered Carbons`;
 * `relabelDimensions` is value-wise and idempotent, so whichever the row
 * carries lands on the same translated display.
 *
 * Value keys win over authored-label keys: a stored value that happens to
 * equal some other option's label is still that option's value.
 *
 * Without a translator this is byte-for-byte the pre-#4030 map — the authored
 * label then IS the display, so no second key is ever emitted.
 */
export function buildDimensionLabelMap(
  options: unknown,
  translate?: OptionLabelTranslator,
): Record<string, string> | null {
  if (!Array.isArray(options) || options.length === 0) return null;
  const byValue: Record<string, string> = {};
  const byAuthoredLabel: Record<string, string> = {};
  for (const opt of options) {
    const vl = optionValueLabel(opt);
    if (!vl) continue;
    const display = translate ? translate(vl.value, vl.label) : vl.label;
    if (display !== vl.value) byValue[vl.value] = display;
    if (display !== vl.label) byAuthoredLabel[vl.label] = display;
  }
  const map = { ...byAuthoredLabel, ...byValue };
  return Object.keys(map).length > 0 ? map : null;
}

/**
 * Field types that JOIN to another object, so they can be a hop in a dotted
 * dimension path. Mirrors the dataset designer's allowlist
 * (`useDatasetFields.ts`), matched case-insensitively so `masterDetail` and
 * `master_detail` both resolve.
 */
const RELATIONSHIP_FIELD_TYPES = new Set(['lookup', 'master_detail', 'masterdetail', 'master-detail']);

/** The `fields` map of an object metadata doc, or null when it isn't one. */
function fieldDefsOf(schema: unknown): Record<string, unknown> | null {
  const fields = (schema as { fields?: unknown } | null | undefined)?.fields;
  return fields && typeof fields === 'object' && !Array.isArray(fields)
    ? (fields as Record<string, unknown>)
    : null;
}

/**
 * The object a relationship field points at, or `undefined` when the field is
 * not a relationship (or names no target).
 *
 * The target lives under `reference` — the ONLY spelling read here, and the same
 * canonicalization as the dataset designer's `resolveReferenceTo`, which is
 * narrowed to match in the same pass (objectui#6528). As of objectui#6648 the
 * CARRIER matches too: a bare string and nothing else. The two helpers are one
 * doctrine in two files and must never drift — a divergence recreates the
 * defect one file over.
 *
 * The three legacy spellings this dropped (`reference_to` / `referenceTo` /
 * `reference_to_object`) were censused against every producer, with `reference`
 * itself as the positive control (445 of 565 lookup / master_detail defs in the
 * framework tree; ACCEPTED by `ObjectSchema.safeParse` on spec 17.2.0, which
 * REFUSES all three others BY NAME). No producer emits any of them onto an
 * object metadata document: `reference_to` was then live only on ObjectUI's own
 * view/field schema (a different contract, translated INTO from `reference`;
 * objectui#11070 round 4 moved that contract to `reference` as well),
 * `referenceTo`'s two producers were retired by objectui#6041, and
 * `reference_to_object` occurs nowhere in either tree outside this chain and the
 * test that called it.
 *
 * ⚠ Unlike `resolveReferenceTo`, this helper reads the `GET /meta/object/:name`
 * document DIRECTLY — no `readFields` door strips retired keys on this path. So
 * the narrowing is load-bearing rather than cosmetic: a stored pre-objectui#6041
 * row spelling the target `referenceTo` now resolves to `undefined` here, the
 * walk yields no entry, and the caller keeps the raw value (best-effort by
 * construction — see {@link resolveDimensionFieldMeta}). That is the intended
 * outcome: per AGENTS.md #0.1 such a row is a PRODUCER-side defect, and a
 * lenient consumer here is exactly where it would have stayed hidden. Note
 * `reference` was already HEAD of the old chain, so any doc carrying both is
 * unaffected.
 *
 * The array and `{ object }` CARRIERS this used to accept were censused on the
 * same standard and removed with the same reasoning (objectui#6648).
 * `FieldSchema.reference` is a plain `z.string()`; `ObjectSchema.safeParse`
 * (spec 17.2.0) ACCEPTS `reference: 'crm_account'` and REFUSES both
 * `['crm_account']` and `{ object: 'crm_account' }` as `invalid_type`. A
 * structure-walking, key-position-aware census of both trees found 587
 * bare-string carriers at the field-def key position and ZERO array or
 * `{ object }` carriers from any producer — the only ones in either tree were
 * the green pins asserting this very tolerance. See `resolveReferenceTo` for
 * the full census, including why a multi-target lookup is NOT what the array
 * branch was serving: it returned `raw[0]` and discarded the rest, and
 * polymorphic lookup remains an undeclared, open spec gap.
 *
 * This path matters MORE than the designer's for the same reason the spelling
 * narrowing did: it reads the metadata document directly, with no `readFields`
 * door in between, so a non-string carrier now degrades visibly (the walk
 * yields no entry and the caller keeps the raw value) instead of being absorbed
 * here.
 *
 * The **type gate is deliberate**: only a declared relationship is walked, so a
 * path segment naming a plain field can never be turned into an object name and
 * fetched speculatively.
 */
export function resolveRelationshipTarget(fieldDef: unknown): string | undefined {
  if (!fieldDef || typeof fieldDef !== 'object') return undefined;
  const def = fieldDef as {
    type?: unknown;
    reference?: unknown;
  };
  const type = typeof def.type === 'string' ? def.type.toLowerCase() : '';
  if (!RELATIONSHIP_FIELD_TYPES.has(type)) return undefined;
  const raw = def.reference;
  return typeof raw === 'string' && raw ? raw : undefined;
}

/**
 * Resolve each dataset dimension's underlying `field` to that field's select
 * `options`, following DOTTED relationship paths to the object that actually
 * owns the terminal field (objectui#4053).
 *
 * A dimension's `field` is either a local field name (`industry`) or a
 * relationship path (`crm_account.industry`, and — per ADR-0071, which the
 * dataset designer emits — `crm_account.owner.department`). Reading the options
 * as `baseSchema.fields[path]` only ever works for the local spelling: for a
 * dotted path the options live on the RELATED object, the lookup missed
 * silently, and the chart fell through to the raw stored enum while the same
 * field as a local dimension rendered its labels beside it.
 *
 * This is the object-resolution step of that ONE lookup, not a dotted-path
 * variant beside it: a single-segment path never enters the walk and resolves
 * exactly as before, so the local path cannot drift away from the joined one.
 *
 * `loadObjectSchema` supplies each hop's object metadata doc — the caller's
 * existing channel (the same `GET /meta/object/:name` read that produced
 * `baseSchema`), so no new fetch layer is introduced. It is memoized per call,
 * because sibling dimensions routinely share a prefix (`crm_account.industry`
 * alongside `crm_account.type` fetches `crm_account` once), and seeded with
 * `baseSchema` under its own `name` so the base is never re-fetched.
 *
 * Best-effort by construction: a hop that is not a relationship, a target that
 * cannot be loaded, or a terminal field that carries no `options` simply yields
 * no entry, and the caller keeps the raw value. Returns `{ fieldPath → options }`
 * for the paths that did resolve.
 *
 * Thin wrapper over {@link resolveDimensionFieldMeta}, which is the same ONE
 * walk keeping the identity of what it found. Callers that translate option
 * labels need that identity (the i18n key is
 * `fieldOptions.<owningObject>.<terminalField>.<value>`, and for a dotted path
 * the owner is the RELATIONSHIP TARGET, not the dataset's base object) — see
 * objectui#4030.
 */
export async function resolveDimensionFieldOptions(
  baseSchema: unknown,
  fieldPaths: Array<string | undefined | null>,
  loadObjectSchema: (objectName: string) => Promise<unknown>,
): Promise<Record<string, unknown>> {
  const meta = await resolveDimensionFieldMeta(baseSchema, fieldPaths, loadObjectSchema);
  const out: Record<string, unknown> = {};
  for (const [path, entry] of Object.entries(meta)) out[path] = entry.options;
  return out;
}

/**
 * What {@link resolveDimensionFieldOptions} found for ONE dimension field path
 * — the options AND the identity of the field they belong to.
 */
export interface DimensionFieldMeta {
  /**
   * The object that OWNS the terminal field: the dataset's base object for a
   * local path, the last relationship's TARGET for a dotted one. `undefined`
   * only when the base schema carries no `name` and the path is local.
   */
  object: string | undefined;
  /** The terminal field's own name — the LAST path segment, never the path. */
  field: string;
  /** The terminal field's `options`, exactly as the metadata doc carries them. */
  options: unknown;
}

/**
 * {@link resolveDimensionFieldOptions} keeping what it walked THROUGH.
 *
 * Same single walk, same best-effort tolerance, same memoized loader — it just
 * returns `{ object, field, options }` per resolved path instead of the options
 * alone. Split out for objectui#4030: applying the locale bundle to a resolved
 * option label needs the key the bundle is written under
 * (`fieldOptions.<object>.<field>.<value>`), and for `crm_account.industry`
 * that object is `crm_account` — the walk already knows it and used to drop it
 * on the floor. Deriving it at the call site would mean re-walking the
 * relationship chain a second time, i.e. two derivations of one fact.
 */
export async function resolveDimensionFieldMeta(
  baseSchema: unknown,
  fieldPaths: Array<string | undefined | null>,
  loadObjectSchema: (objectName: string) => Promise<unknown>,
): Promise<Record<string, DimensionFieldMeta>> {
  const out: Record<string, DimensionFieldMeta> = {};
  const paths = Array.from(new Set((fieldPaths ?? []).filter((p): p is string => !!p)));
  if (paths.length === 0) return out;

  const cache = new Map<string, Promise<unknown>>();
  const baseName = (baseSchema as { name?: unknown } | null | undefined)?.name;
  if (typeof baseName === 'string' && baseName) cache.set(baseName, Promise.resolve(baseSchema));
  const load = (name: string): Promise<unknown> => {
    let hit = cache.get(name);
    if (!hit) {
      // A rejected hop resolves to null rather than throwing, so one unreachable
      // relationship costs its own dimension's labels and not the whole chart's.
      hit = Promise.resolve().then(() => loadObjectSchema(name)).catch(() => null);
      cache.set(name, hit);
    }
    return hit;
  };

  for (const path of paths) {
    const segments = path.split('.');
    let schema: unknown = baseSchema;
    // The object owning the CURRENT schema — walked forward with it, so the
    // terminal field's owner is whatever it holds when the walk ends.
    let owner = typeof baseName === 'string' && baseName ? baseName : undefined;
    let walked = true;
    // Every segment but the last must be a relationship; walk to its target.
    // Hops are sequential by nature — hop N's object is only known once hop
    // N-1 has been read.
    for (let i = 0; i < segments.length - 1; i += 1) {
      const target = resolveRelationshipTarget(fieldDefsOf(schema)?.[segments[i]]);
      if (!target) { walked = false; break; }
      schema = await load(target);
      if (!schema) { walked = false; break; }
      // Prefer the loaded doc's own `name` over the reference's spelling, so a
      // reference written against an alias still keys the bundle canonically.
      const loadedName = (schema as { name?: unknown }).name;
      owner = typeof loadedName === 'string' && loadedName ? loadedName : target;
    }
    if (!walked) continue;
    const field = segments[segments.length - 1];
    const terminal = fieldDefsOf(schema)?.[field] as { options?: unknown } | undefined;
    if (terminal?.options !== undefined) out[path] = { object: owner, field, options: terminal.options };
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────────
 * The analytics label net's REACT-FREE half (objectui#4389)
 *
 * Everything below composes the helpers above into the two steps every dataset
 * surface takes: LOAD the metadata for a query's dimensions, then DERIVE the
 * `{dimension → {value|authoredLabel → displayLabel}}` maps from it. Both were
 * written out longhand twice — once in `plugin-dashboard`'s `DatasetWidget` and
 * once in `plugin-report`'s `useDatasetDimensionLabels` (objectui#4330 / PR
 * #4388) — and the duplication was filed as objectui#4389.
 *
 * The card's first ruling named `@object-ui/core` as the whole glue's home;
 * that half of it was retired by measurement (PM RULING #2 on the card):
 * `SchemaRendererContext` is defined in `@object-ui/react`, which DEPENDS on
 * this package, so core importing it back is a cycle — and core is React-free
 * by declaration, by content, and by AGENTS.md §3. The layering was already
 * ruled in this exact direction by objectui#3367 (core-canonical logic, react
 * re-exports; never core importing react).
 *
 * So the split is: the parts that are just data — a load composition and a
 * pure derivation — live HERE, beside the helpers they call. The React wiring
 * that cannot (useState / useEffect / useMemo / the context read) lives once in
 * `@object-ui/react`'s `useDatasetDimensionLabels`, which both plugins consume.
 * Neither half knows about the other's layer, and neither is written twice.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The locale-bundle resolver a caller supplies to translate one option label —
 * `useSafeFieldLabel().fieldOptionLabel` in every current caller, i.e. the
 * `{ns}.fieldOptions.<object>.<field>.<value>` convention list and form
 * surfaces already translate select options through (objectui#4030).
 *
 * Taken as a plain function so this package needs no knowledge of i18n, React,
 * or which provider is mounted — the same reason {@link OptionLabelTranslator}
 * is a bare function type.
 */
export type FieldOptionLabelResolver = (
  object: string,
  field: string,
  value: string,
  authoredLabel: string,
) => string;

/**
 * Bind a {@link FieldOptionLabelResolver} to ONE resolved dimension field,
 * yielding the {@link OptionLabelTranslator} the option helpers take.
 *
 * The binding is the part that is easy to get wrong, which is why it is stated
 * once here rather than at each call site: the translator must be bound to the
 * object that OWNS the terminal field — `crm_account` for `crm_account.industry`,
 * NOT the dataset's base object — because that owner is the key the locale
 * bundle is written under. {@link resolveDimensionFieldMeta} already walked the
 * relationship chain and kept that owner; this just reads it.
 *
 * Returns `undefined` — i.e. "no translation, keep the authored labels" — when
 * the owner could not be resolved or no resolver was supplied. Every helper
 * downstream then behaves exactly as it did before the #4030 seam existed.
 */
export function dimensionOptionTranslator(
  meta: DimensionFieldMeta | undefined,
  fieldOptionLabel?: FieldOptionLabelResolver,
): OptionLabelTranslator | undefined {
  const owner = meta?.object;
  if (!owner || !fieldOptionLabel) return undefined;
  const field = meta.field;
  return (value, authoredLabel) => fieldOptionLabel(owner, field, value, authoredLabel);
}

/** One dimension paired with the field path its values resolve through. */
export interface DimensionRelabelTarget {
  /** The dimension name as the surface renders it (the row key). */
  dim: string;
  /** That dimension's underlying field path, as the dataset query reported it. */
  path: string;
}

/**
 * Derive the `{ dimension → { value|authoredLabel → displayLabel } }` maps that
 * {@link relabelDimensions} consumes, from metadata {@link loadDimensionFieldMeta}
 * (or {@link resolveDimensionFieldMeta}) already resolved.
 *
 * This is the LOCALE-APPLYING step, and keeping it separate from the load is
 * the whole point of the split (objectui#4030 / PR #4324): the fetched metadata
 * stays locale-free, so switching language re-derives these maps in a render
 * memo instead of re-issuing the metadata read. A caller that folds the two
 * together reintroduces a refetch on every language switch — the defect #4324
 * fixed, and the property objectui#4389 lifted here so it is stated once.
 *
 * Best-effort per dimension, exactly as the longhand copies were: a path that
 * resolved no metadata, or whose field carries no `options`, contributes no
 * entry, and `relabelDimensions` then returns the caller's rows by identity.
 * Returns `null` — never an empty object — when nothing resolved, so callers
 * can skip the relabel entirely.
 */
export function deriveDimensionLabelMaps(
  metaByPath: Record<string, DimensionFieldMeta> | null | undefined,
  relabel: readonly DimensionRelabelTarget[] | null | undefined,
  fieldOptionLabel?: FieldOptionLabelResolver,
): Record<string, Record<string, string>> | null {
  if (!metaByPath || !relabel || relabel.length === 0) return null;
  const labels: Record<string, Record<string, string>> = {};
  for (const { dim, path } of relabel) {
    const meta = metaByPath[path];
    const map = buildDimensionLabelMap(meta?.options, dimensionOptionTranslator(meta, fieldOptionLabel));
    if (map) labels[dim] = map;
  }
  return Object.keys(labels).length > 0 ? labels : null;
}

/**
 * Load one dataset query's dimension field metadata: fetch the base object's
 * schema, then resolve every dimension's field path against it.
 *
 * The two-step composition every caller wrote out by hand. `loadObjectSchema`
 * stays the CALLER's channel — this package issues no reads of its own and has
 * no opinion about transport, which is what keeps it free of React, of
 * `SchemaRendererContext`, and of the authenticated-`apiFetch` concern
 * (objectui#4121) that belongs to the layer holding the host context.
 *
 * The same loader serves both steps by design: {@link resolveDimensionFieldMeta}
 * memoizes it per call and seeds the cache with the base schema under its own
 * `name`, so the base object is read ONCE even when several dotted dimensions
 * walk back through it. That read count is pinned on both consuming surfaces.
 */
export async function loadDimensionFieldMeta(
  loadObjectSchema: (objectName: string) => Promise<unknown>,
  object: string,
  fieldPaths: Array<string | undefined | null>,
): Promise<Record<string, DimensionFieldMeta>> {
  const baseSchema = await loadObjectSchema(object);
  return resolveDimensionFieldMeta(baseSchema, fieldPaths, loadObjectSchema);
}
