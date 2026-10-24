
import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { useDataScope, SchemaRendererContext, SchemaRenderer, useDrillNavigation, useFilterScope, ElementDataSourceGate, useDataInvalidation, type ElementDataSourceMapping } from '@object-ui/react';
import { ChartRenderer } from './ChartRenderer';
import { normalizeChartSchema } from './normalizeChartSchema';
import { ComponentRegistry, chartMeasureKey, isStructuredGroupBy, objectAggregateSpecQuery, humanizeLabel, extractRecords, computeDrillFilter, composeDrillFilter, FilterOperatorError, isDrillEnabled, resolveDrillTitle, resolveFilterPlaceholders, resolveContextTokens, shiftFilterByCompareTo, compareToTrendLabelKey, chartTypeIgnoresCompareTo, buildChartSeries, buildOptionColorMap, buildCategoryOrder, buildCategoryRank, deriveDimensionLabelMaps, dimensionOptionTranslator, loadDimensionFieldMeta, relabelDimensions, localizeFieldOptions, elementDataSourceBlock, type DimensionFieldMeta, type CompareToConfig, type DrillEvent, type ChartResultField, type ChartSegmentClickEvent } from '@object-ui/core';
import { Sheet, SheetContent, SheetHeader, SheetTitle, Dialog, DialogContent, DialogHeader, DialogTitle, RefreshIndicator, Button, ChartSkeleton, DataEmptyState } from '@object-ui/components';
import { AlertCircle, ArrowUpRight, Inbox } from 'lucide-react';
import { builtinAggregateLabels, useSafeFieldLabel, useSafeTranslate, useObjectTranslation, pickLocalized } from '@object-ui/i18n';
import type { BaseSchema, DrillDownConfig, ObjectChartSchema, ObjectDataTableSchema } from '@object-ui/types';

/**
 * Humanize a snake_case or kebab-case string into Title Case.
 *
 * Was a local implementation here "to avoid a dependency on
 * `@object-ui/fields`" — byte-identical to that package's export, which
 * `plugin-grid` / `plugin-gantt` / `plugin-detail` read, so the two could drift
 * into a live disagreement (one dashboard can hold a chart and a grid over the
 * same stored value). objectui#5444 moved the single implementation to
 * `@object-ui/core`, which this package already depends on: the dependency the
 * copy existed to avoid is still avoided, and there is now one function rather
 * than two. Re-exported at module scope because that is the surface this file
 * has always offered.
 */
export { humanizeLabel };

/**
 * The result column an object-bound `aggregate` projects its value under
 * (framework#3701, `chartAggregateValueKey` in `@objectstack/spec/ui`).
 *
 * The raw `field` name — an object-bound aggregate does NOT decorate it the way
 * a dataset measure is named (`sum_amount`). Only `count` may omit `field`, and
 * it then lands under the literal `'count'`, which is the alias the engine
 * projects `COUNT(*)` under. Exported so every path that builds these rows
 * agrees on one key instead of each re-deriving it.
 */
export function aggregateValueKey(aggregate: { field?: string; function?: string }): string {
  // The contract's own derivation answers every aggregate `ChartAggregateSchema`
  // ADMITS; the tail is this renderer's floor for shapes it REJECTS (a
  // non-count aggregate that names no field, or an empty bag), which reach this
  // function only from unvalidated metadata and must still key a column rather
  // than the string "undefined". Byte-identical to the three-rung `field ||
  // function || 'count'` it replaces — the two extra rungs are unreachable for
  // any aggregate the spec answers for. Delegated rather than restated so this
  // cannot drift from the SERIES binding the dashboard relays compose, which is
  // exactly how a fieldless count came to project `'count'` and be plotted as
  // `'value'` (objectui#8266).
  return chartMeasureKey(aggregate, aggregate.function || 'count');
}

/**
 * Every category-axis binding this component READS, spelled as an author writes
 * it, in the precedence order {@link resolveChartCategoryField} applies them.
 *
 * Module-local for the reason `ObjectTimeline`'s twin list is: the refusal's
 * message renders THIS list rather than restating it in prose, so a rung added
 * to (or retired from) the resolver cannot leave the diagnostic naming a
 * vocabulary the resolver no longer has. (Also not a new public export — an
 * exported array literal trips `react-refresh/only-export-components`.)
 *
 * Ordered canonical-first: the message tells the author which to prefer by
 * position rather than by a second prose sentence that could drift from it.
 */
const OBJECT_BOUND_CHART_CATEGORY_BINDINGS = [
  'aggregate.groupBy',
  'xAxisKey',
  'xAxis.field',
] as const;

/**
 * The category axis this chart plots BY — resolved ONCE, for every reader.
 *
 * ## Why this is a function and not three inline reads
 *
 * "Which column is the category?" was spelled three times in this file, at
 * three fidelities, and the refusal below would have been a fourth. That is the
 * objectui#5042 / objectui#7544 drift shape — a second opinion of one question
 * that nothing keeps in agreement — and objectui#7544's fix
 * (`resolveListChartBinding` in `plugin-list/src/ListView.tsx`) is the same move
 * one layer up, on the AUTHORED list-view chart block.
 *
 * ⚠️ It is one layer up, not this layer. `resolveListChartBinding` reads
 * `{ chart, options.chart }` — the block an author writes on a LIST VIEW, whose
 * only binding since objectui#6152 round 15 is an ADR-0021 `dataset` (its
 * pre-ADR-0021 `xAxisField` / `categoryField` / `yAxisFields` leg retired). By
 * the time a schema reaches this component the relays have already translated
 * that block into `{ dataset, dimensions, values }`, or, for a block naming no
 * dataset, into an object-bound node naming no category, and the producers that never
 * had such a block at all (the two dashboard surfaces, and directly authored
 * `object-chart` metadata) compose the translated shape straight away. So the
 * upstream resolver cannot be CALLED here — asked for `schema.chart` it would
 * read `undefined` off every chart this component renders and answer
 * "unresolvable" for all of them. What is shared is the QUESTION and the rule
 * for answering it; the vocabulary is necessarily this layer's.
 *
 * ## The three legs, in the order the render pipeline applies them
 *
 * 1. A structured `GroupBy` node (`{ field, dateGranularity }`) — its `field`
 *    IS the category, and nothing substitutes for it: `runAggregate` sends the
 *    node itself as the server's `groupBy`, so a node naming no field has no
 *    other spelling that could rescue it.
 * 2. A legacy string `aggregate.groupBy`.
 * 3. Otherwise the chart plots rows as fetched, and the category is whatever
 *    `normalizeChartSchema` — this package's ONE translation of the spec's
 *    author-facing chart shape into the renderer's internal contract — resolves
 *    for the x axis: `xAxisKey`, else spec `xAxis.field`, else a bare string
 *    `xAxis`. Reading `schema.xAxisKey` alone here would have refused a chart
 *    that authored the spec spelling and renders correctly today, because
 *    `ChartRenderer` normalizes DOWNSTREAM of this component.
 *
 * Returns `undefined` only when the schema names no category by any declared
 * spelling — a real answer, and what {@link ObjectChart}'s refusal keys on.
 *
 * ⚠️ LEDGERED, on purpose: this is the one `normalizeChartSchema` call in the
 * package that passes NO language (objectui#8943). It is safe here and only
 * here — the call reads `.xAxisKey`, a COLUMN NAME, and nothing else. No
 * `I18nLabel` slot on the result is ever read through this path, so there is no
 * label for a language to resolve. Keeping the function pure (it is called from
 * plain module scope, outside any component) is worth more than a language
 * argument that would change no byte of its answer. ⛔ If this ever starts
 * reading `title` / `subtitle` / `description` / an axis `title` / a series
 * `label`, it needs the viewer's language and can no longer be called from
 * outside a component.
 */
export function resolveChartCategoryField(schema: {
  aggregate?: { groupBy?: unknown } | undefined;
  xAxisKey?: unknown;
  xAxis?: unknown;
} | undefined | null): string | undefined {
  const gb = schema?.aggregate?.groupBy;
  if (gb && typeof gb === 'object' && !Array.isArray(gb)) {
    const field = (gb as { field?: unknown }).field;
    return typeof field === 'string' && field ? field : undefined;
  }
  if (typeof gb === 'string' && gb) return gb;
  return normalizeChartSchema(schema).xAxisKey;
}

/** Suffix the previous-window value carries under a compareTo overlay. */
export const COMPARISON_SUFFIX = '__comparison';

/**
 * The COLUMN an inline `aggregate` projects its group under — the string every
 * column lookup in this file needs.
 *
 * `groupBy` is a union: a bare field name, or the structured date-bucketing
 * node `{ field, dateGranularity, alias }` the engine takes, in which case the
 * projected column is the `alias` (or the `field` it defaults to). This is that
 * normalisation, hoisted out of the comparison-merge leg below, which has
 * spelled it inline since the structured node arrived — "Normalise to the
 * underlying string field name so all column lookups work".
 *
 * ⚠️ Module-local on purpose: it is a spelling this file already owned twice,
 * not a new published export. It is also NOT a fourth answer to "what is the
 * category axis" — {@link resolveChartCategoryField} remains that one, and it
 * answers a wider question (it also resolves the spec's `xAxis` through
 * `normalizeChartSchema`). This one answers only "which column did the
 * aggregate project the group under", which is what a row lookup needs — and
 * an axis binding is one: it is also the key `ObjectChart` forwards to
 * `ChartRenderer` when the author named the category through `groupBy` alone
 * (objectui#10634, `groupByCategoryKey`).
 */
function aggregateGroupByKey(
  aggregate: ObjectChartSchema['aggregate'],
): string | undefined {
  const gb = aggregate?.groupBy;
  if (gb && typeof gb === 'object' && !Array.isArray(gb)) return gb.alias || gb.field;
  return typeof gb === 'string' ? gb : undefined;
}

/**
 * Where a dataset chart's category sits in the order its dimension field
 * DECLARES its options (objectui#13403), read off a `buildCategoryRank` map,
 * which keys the stored value and the display label alike: a declared option
 * at its declared position, then any value the options do not declare, then
 * the empty bucket. The caller sorts STABLY on it, so undeclared values keep
 * the dataset's order among themselves.
 *
 * The same reading as `declaredOptionPosition` in the dashboard's
 * `DatasetWidget` (objectui#11809), which charts the same dataset rows, so a
 * page block and a dashboard widget over one dimension draw one order.
 */
function declaredOptionPosition(value: unknown, rank: ReadonlyMap<string, number>): number {
  const declared = value == null ? undefined : rank.get(String(value));
  if (declared !== undefined) return declared;
  if (value == null || value === '') return Number.MAX_SAFE_INTEGER;
  return Number.MAX_SAFE_INTEGER - 1;
}

/**
 * Client-side aggregation for fetched records.
 * Groups records by `groupBy` field and applies the aggregation function
 * to the `field` values in each group.
 *
 * `function` is optional because the `switch` below already implements that:
 * an absent (or unknown) function falls through to `sum`. The parameter used to
 * say `function: string`, which was a claim about the CALLER rather than about
 * this body — and no caller could satisfy it once `ObjectChartSchema.aggregate`
 * was declared with the requiredness its own reads have (objectui#7946).
 */
export function aggregateRecords(
  records: any[],
  aggregate: { field?: string; function?: string; groupBy: string }
): any[] {
  const { field, function: aggFn, groupBy } = aggregate;
  const valueKey = aggregateValueKey(aggregate);
  const groups: Record<string, any[]> = {};

  for (const record of records) {
    const key = String(record[groupBy] ?? 'Unknown');
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }

  return Object.entries(groups).map(([key, group]) => {
    const values = field ? group.map(r => Number(r[field]) || 0) : [];
    let result: number;

    switch (aggFn) {
      case 'count':
        result = group.length;
        break;
      case 'avg':
        result = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        break;
      case 'min':
        result = values.length > 0 ? Math.min(...values) : 0;
        break;
      case 'max':
        result = values.length > 0 ? Math.max(...values) : 0;
        break;
      case 'sum':
      default:
        result = values.reduce((a, b) => a + b, 0);
        break;
    }

    return { [groupBy]: key, [valueKey]: result };
  });
}

/**
 * Resolve groupBy field values to human-readable labels using field metadata.
 *
 * - **select/picklist** fields: maps value→label via `field.options`.
 * - **lookup/master_detail** fields: batch-fetches referenced records
 *   via `dataSource.find()` and maps id→name.
 * - **fallback**: applies `humanizeLabel()` to convert snake_case/kebab-case
 *   values into Title Case.
 *
 * The resolved data is a new array with the groupBy key replaced by its label.
 * This function is pure data-layer logic — the rendering layer does not need
 * to perform any value→label conversion.
 */
export async function resolveGroupByLabels(
  data: any[],
  groupByField: string,
  objectSchema: any,
  dataSource?: any,
  translateOption?: (value: string, fallbackLabel: string) => string,
): Promise<any[]> {
  if (!data.length || !groupByField) return data;

  const t = translateOption || ((_v: string, fallback: string) => fallback);
  // Stash the original raw value under a side-channel key so click handlers
  // can recover it for filter computation. Display-side rendering keeps using
  // `groupByField` as before.
  const rawKey = `__raw_${groupByField}`;

  const fieldDef = objectSchema?.fields?.[groupByField];
  if (!fieldDef) {
    // No metadata available — apply humanizeLabel as fallback, but pass
    // ISO-date-like values through untouched so date chart axes can format them.
    const isoLike = /^\d{4}-\d{2}-\d{2}/;
    return data.map(row => {
      const raw = row[groupByField];
      const rawStr = String(raw ?? '');
      const humanized = isoLike.test(rawStr) ? rawStr : humanizeLabel(rawStr);
      return {
        ...row,
        [groupByField]: t(rawStr, humanized),
        [rawKey]: raw,
      };
    });
  }

  const fieldType = fieldDef.type;

  // --- select / picklist / dropdown fields ---
  if (fieldType === 'select' || fieldType === 'picklist' || fieldType === 'dropdown') {
    const options: Array<{ value: string; label: string } | string> = fieldDef.options || [];
    if (options.length === 0) {
      return data.map(row => {
        const raw = row[groupByField];
        const rawStr = String(raw ?? '');
        const humanized = humanizeLabel(rawStr);
        return {
          ...row,
          [groupByField]: t(rawStr, humanized),
          [rawKey]: raw,
        };
      });
    }

    // Build value→label map (options can be {value,label} objects or plain strings)
    const labelMap: Record<string, string> = {};
    for (const opt of options) {
      if (typeof opt === 'string') {
        labelMap[opt] = opt;
      } else if (opt && typeof opt === 'object') {
        labelMap[String(opt.value)] = opt.label || String(opt.value);
      }
    }

    return data.map(row => {
      const raw = row[groupByField];
      const rawValue = String(raw ?? '');
      const fallback = labelMap[rawValue] || humanizeLabel(rawValue);
      return {
        ...row,
        [groupByField]: t(rawValue, fallback),
        [rawKey]: raw,
      };
    });
  }

  // --- lookup / master_detail fields ---
  if (fieldType === 'lookup' || fieldType === 'master_detail') {
    // --- lookup / master_detail fields ---
    // objectui#6837 half 2 — maintainer 2026-08-31: protocol normalization
    // belongs on the SERVER, the front end just executes the protocol.
    // `reference` is the only target spelling `@objectstack/spec`'s
    // `FieldSchema` declares; it refuses `reference_to` by name with its own
    // "did you mean -> `reference`?" rename. objectstack#13847 rewrites
    // stored `reference_to` on the serve path and in `os migrate meta`. A
    // legacy-only def is canonicalised ONCE at the ingestion choke point
    // (`normalizeSchemaReferenceKeys`, which warns in dev) — never here.
    const referenceTo = fieldDef.reference;
    if (!referenceTo || !dataSource || typeof dataSource.find !== 'function') {
      // Cannot resolve — return as-is but still attach the rawKey so the
      // click handler can recover the FK id.
      return data.map(row => ({ ...row, [rawKey]: row[groupByField] }));
    }

    // Collect unique IDs to fetch
    const ids = [...new Set(data.map(row => row[groupByField]).filter(v => v != null))];
    if (ids.length === 0) return data.map(row => ({ ...row, [rawKey]: row[groupByField] }));

    // Derive the ID field from metadata (fallback to 'id')
    // objectui#7642 CENSUS — verdict KEEP (bag traced: `objectSchema` is
    // `ds.getObjectSchema(schema.objectName)`, so this IS the object-schema def).
    // `FieldSchema` refuses `id_field`/`display_field` on the AUTHORING path, but
    // the SERVE path runs no parse — `ObjectStackAdapter.getObjectSchema` returns
    // the server document plus only `normalizeSchemaReferenceKeys` — so a stored
    // pre-strict def still arrives here.
    // ⛔ `idField` is NOT a leg this read may gain, and the carve-out is
    // RE-MEASURED on the pin actually resolved here (`@objectstack/spec@17.4.0`,
    // not the 17.2.0 the note used to cite): `FieldSchema` refuses `idField`
    // with `unrecognized_keys` exactly as it refuses `id_field` (the spec's only
    // `idField` sits on `InlineGridColumnSchema`, a different shape), so the id
    // read has no declared spelling to re-point to. Adding one would fossilise
    // an undeclared spelling. Routed to objectui#7650 option A.
    const idField: string = fieldDef.id_field || 'id';

    try {
      const results = await dataSource.find(referenceTo, {
        $filter: { [idField]: { $in: ids } },
        $top: ids.length,
      });
      const records = extractRecords(results);

      // Build id→label map using display field from metadata with sensible fallbacks.
      //
      // ⭐ objectui#7435 — the DECLARED spelling is ranked FIRST. Until that
      // change the chain had no `FieldSchema` leg at all, so `displayField` —
      // the only display spelling a spec-compliant author can emit, and the one
      // `getObjectSchema` serves — could not reach this reader in any shape. The
      // chart fell through to the generic `'name'` heuristic and drew the wrong
      // axis label.
      //
      // MEASURED on the pin resolved then, `@objectstack/spec@17.4.0`:
      // `FieldSchema.safeParse` ACCEPTS `displayField` and REFUSES
      // `reference_field` / `display_field` with `unrecognized_keys` (controls
      // lit in the same run — a minimal lookup def ACCEPTED, `zzz_not_a_real_key`
      // REJECTED).
      //
      // ⭐ objectui#11070 round 6 — the `display_field` leg is RETIRED, with no
      // alias. objectui#7435 kept it for two producers its sweep did not cover.
      // The first, a document stored before the key was tightened, is now
      // covered by the ingestion fold: `ObjectStackAdapter.getObjectSchema`
      // runs `normalizeSchemaReferenceKeys`, which stamps a stored
      // `display_field` onto `displayField` (objectui#7650 ruling A), so a
      // served def reaches this read under the declared key. The second, a
      // HOST `DataSource` whose `getObjectSchema` is not `ObjectStackAdapter`'s,
      // is not folded, and its `display_field` now falls through to `'name'`;
      // the round's changeset states that break.
      //
      // ⚠️ `reference_field` STAYS. `FieldSchema` declares no twin the fold
      // could stamp it onto, so the fold leaves it on the def as served, and
      // retiring it here is a decision with its own evidence, not this one.
      // It is graded `no-producer` by this repo's own register
      // (`plugin-grid/src/relationalMetaKeys.ts`).
      const displayField: string =
        fieldDef.displayField
        || fieldDef.reference_field
        || 'name';
      const idToName: Record<string, string> = {};
      for (const rec of records) {
        const id = String(rec[idField] ?? rec.id ?? rec._id ?? '');
        const name = rec[displayField] || rec.name || rec.label || rec.title || id;
        if (id) idToName[id] = String(name);
      }

      return data.map(row => {
        const raw = row[groupByField];
        const rawValue = String(raw ?? '');
        return {
          ...row,
          [groupByField]: idToName[rawValue] || rawValue,
          [rawKey]: raw,
        };
      });
    } catch (e) {
      console.warn('[ObjectChart] Failed to resolve lookup labels:', e);
      return data.map(row => ({ ...row, [rawKey]: row[groupByField] }));
    }
  }

  // --- date / datetime / timestamp fields ---
  // Preserve the raw ISO string so the chart layer can format it (e.g. "May 23").
  // humanizeLabel would replace hyphens with spaces and break date parsing.
  if (
    fieldType === 'date' ||
    fieldType === 'datetime' ||
    fieldType === 'date_time' ||
    fieldType === 'timestamp' ||
    fieldType === 'time'
  ) {
    return data.map(row => ({ ...row, [rawKey]: row[groupByField] }));
  }

  // --- fallback for other field types ---
  // Detect ISO 8601-like date strings and pass them through untouched so the
  // chart's tickFormatter can present them nicely. Otherwise humanize.
  const isoLike = /^\d{4}-\d{2}-\d{2}/;
  return data.map(row => {
    const raw = row[groupByField];
    const rawValue = String(raw ?? '');
    return {
      ...row,
      [groupByField]: isoLike.test(rawValue) ? rawValue : humanizeLabel(rawValue),
      [rawKey]: raw,
    };
  });
}

// Re-export extractRecords from @object-ui/core for backward compatibility
export { extractRecords } from '@object-ui/core';

/**
 * Props of {@link ObjectChart} — anchored to the published `ObjectChartSchema`
 * (objectui#7946, maintainer ruling 2026-09-09 option A), as objectui#6576 did
 * for `ObjectGalleryProps.schema`.
 *
 * ## What this replaces, and what it buys
 *
 * This component was published as `(props: any)`, so every `schema={{ … }}`
 * literal handed to it — including the two in `app-shell`'s `ObjectView` — was
 * type-checked against NOTHING. That is the mechanism that let objectui#7891's
 * undeclared `config` rung live from the day it was written until someone read
 * the spec by hand, and it is why the two `as any` casts on those literals
 * measured INERT: an `any` consumer accepts a cast and its absence alike.
 *
 * With the anchor, a wrong VALUE TYPE on a declared key is a compile error at
 * the producer (`xAxisKey: 42`, `series: 'x'`, `type: 'chart'`, and every
 * `BaseSchema` member — `visible: 42`). ⚠️ A MISSPELLED key was still accepted
 * while `BaseSchema` carried `[key: string]: any` (objectui#5155), the same
 * ceiling objectui#6576 accepted knowingly; objectui#8347 removed it, so a
 * misspelled key in a fresh literal is refused now.
 * `__tests__/ObjectChart.schemaAnchor-7946.test.ts` pins both halves, the
 * flipped ceiling row included, so the anchor is not read as more than it is.
 */
export interface ObjectChartProps {
  /**
   * The `object-chart` node — anchored to the exported schema type. Every
   * `BaseSchema` member is writable, `bind` / `className` / `data` included;
   * the widget's own keys are declared there.
   */
  schema: ObjectChartSchema;
  /**
   * Host data source. `any` deliberately, and it is NOT a residue of the shape
   * this card removed: it is the type `SchemaRendererContext.dataSource`
   * itself carries, and this component falls back to that context value, so a
   * narrower declaration here would claim a guarantee the fallback cannot
   * keep. Narrowing it is a repo-wide `dataSource` interface, not this card.
   */
  dataSource?: any;
  /**
   * Optional host-owned segment click. When provided (e.g. a dataset widget
   * that owns precise drill-through), it takes over the chart click and the
   * widget's own object-drill drawer is suppressed.
   */
  onSegmentClick?: (ev: ChartSegmentClickEvent) => void;
}

export const ObjectChart = (props: ObjectChartProps) => {
  const { schema } = props;
  const onSegmentClick: ((ev: ChartSegmentClickEvent) => void) | undefined = props.onSegmentClick;
  const context = useContext(SchemaRendererContext);
  const dataSource = props.dataSource || context?.dataSource;
  // Host-authenticated fetch for the metadata probes below (#4114). Read from
  // the context directly rather than `useSchemaContext()`, which throws with no
  // provider mounted: a standalone chart embed has no host fetch and must keep
  // degrading to the global one instead of crashing the render.
  const apiFetch = context?.apiFetch;
  const boundData = useDataScope(schema.bind);
  const { fieldOptionLabel } = useSafeFieldLabel();

  const [fetchedData, setFetchedData] = useState<any[]>([]);
  // Measure/dimension label metadata from a dataset-bound queryDataset()
  // response (e.g. { name: 'task_count', label: 'Tasks' }) — captured so
  // buildChartSeries() below can resolve a human series label instead of
  // falling back to the raw field name.
  const [datasetFields, setDatasetFields] = useState<ChartResultField[] | null>(null);
  // The dataset's BASE object, as the `queryDataset` answer names it (the same
  // `object` the dashboard's DatasetWidget reads for drill-through). A dataset
  // node carries no `objectName`, so this is the only object a dataset-bound
  // chart can key its data-invalidation subscription on (objectui#10035).
  const [datasetObject, setDatasetObject] = useState<string | undefined>(undefined);
  // Start in loading state when we will fetch, so the no-data / empty branch
  // doesn't flash before the fetch effect runs and flips loading to true.
  const [loading, setLoading] = useState<boolean>(() => {
    const hasInline = Array.isArray(schema.data) && schema.data.length > 0;
    return !hasInline && (!!schema.objectName || !!schema.dataset);
  });
  const [error, setError] = useState<string | null>(null);
  // Drill-down click event — must be declared with the other hooks (above
  // any conditional early return) to keep hook order stable between renders.
  const [drillEvent, setDrillEvent] = useState<DrillEvent | null>(null);
  // P3: semantic per-category colors. The category dimension is usually a
  // select field whose options carry colors (e.g. project health
  // green=#10B981 / red=#EF4444). Charts otherwise paint categories from the
  // generic --chart-1..5 palette, so a "Red" health slice renders teal. Resolve
  // the dimension field's option colors → {value|label → color} so the render
  // layer can use them. Keyed by BOTH value and label since the row category
  // may be either (server resolves dataset dimension labels).
  // ── The label net's INPUT: resolved field metadata, locale-free ───────────
  // `{ object, field, options }` per resolved dimension field path, exactly as
  // the metadata doc carries it. The colour map and the per-dimension
  // {value → label} maps are DERIVED from it during render (one memo below),
  // because that derivation is where the locale bundle applies — objectui#4030.
  // Keeping the fetched metadata locale-free is what makes a language switch a
  // re-render instead of a re-fetch.
  const [optionMeta, setOptionMeta] = useState<{
    metaByPath: Record<string, DimensionFieldMeta>;
    /** The colour dimension's field path — the aggregate groupBy / first dim. */
    colorPath: string;
    /** Dataset path only: dimension name → its underlying field path. */
    fieldByDim: Record<string, string> | null;
  } | null>(null);
  // Host-provided "open in list" navigation for the drill escape hatch.
  const { openRecordList } = useDrillNavigation();
  const tt = useSafeTranslate();
  // The active UI language, for `pickLocalized` on the drill heading below.
  // Read HERE rather than at the read site because that site lives inside
  // `drillDrawer`, which runs after this component's conditional early returns —
  // a hook called there would desync hook order between renders.
  //
  // `useObjectTranslation` is provider-safe (optional context read, falling back
  // to the react-i18next global instance), which is why it can sit beside
  // `useSafeTranslate` above without a provider in tests.
  //
  // Its `t` names the refresh bar below (`chart.refreshing`, objectui#10580).
  // Deliberately not `tt`: that hook takes an English fallback at every call,
  // and the bar's name carries no English literal anywhere — the pack is the
  // only source of it.
  const { t, language } = useObjectTranslation();

  /**
   * The chart family this block DRAWS, for the two `compareTo` gates below:
   * the comparison fetch in `fetchData` and the overlay series
   * (`enableComparisonSeries`), objectui#11530.
   *
   * Read through `normalizeChartSchema`, the translation `ChartRenderer`
   * dispatches on, so it is `chartType`, else `specType` (objectui#11520): a
   * family on either channel meets `chartTypeIgnoresCompareTo` as the value the
   * chart is drawn as. Both gates used to read `schema.chartType` alone, so a
   * family on `specType` (the react tier's channel) was invisible to them. A
   * `specType: scatter` then fetched the comparison window, got the overlay
   * series and refused its own two series; a `specType: pie` paid for a fetch
   * it never drew. ⛔ No compare decision in this file reads `schema.chartType`
   * or `schema.specType` directly: one family reader here, one family list in
   * `chartTypeIgnoresCompareTo`.
   *
   * `language` is passed although no label is read off the result, so the call
   * in `resolveChartCategoryField` stays the package's one call without it. The
   * memo is a cost hint only: the answer is a string, so nothing keys on an
   * identity (AGENTS.md #10).
   */
  const chartFamily = useMemo(() => normalizeChartSchema(schema, language).chartType, [schema, language]);

  // Stable JSON keys for aggregate/filter so that callers passing a fresh
  // object literal on each render (e.g. DashboardRenderer.getComponentSchema)
  // do not trigger infinite refetch loops.
  const aggregateKey = useMemo(
    () => (schema.aggregate ? JSON.stringify(schema.aggregate) : ''),
    [schema.aggregate],
  );
  const filterKey = useMemo(
    () => (schema.filter ? JSON.stringify(schema.filter) : ''),
    [schema.filter],
  );
  const compareToKey = useMemo(
    () => (schema.compareTo ? JSON.stringify(schema.compareTo) : ''),
    [schema.compareTo],
  );
  // ADR-0021 (objectstack-ai/objectstack#1890): a chart can bind to a semantic-layer `dataset` instead of
  // the legacy inline `objectName` + `aggregate` query. Stable key over the
  // dataset selection so a fresh object literal each render doesn't refetch-loop.
  const datasetKey = useMemo(
    () => (schema.dataset
      ? JSON.stringify({ d: schema.dataset, dim: schema.dimensions ?? [], val: schema.values ?? [] })
      : ''),
    [schema.dataset, schema.dimensions, schema.values],
  );

  // Resolve the category dimension's option colors (P3). Best-effort: any
  // failure leaves categoryColors null and the chart keeps the theme palette.
  //
  // Both metadata reads ride the host's AUTHENTICATED fetch (#4114) — the
  // `SchemaRendererProvider`'s `apiFetch` — falling back to the global one
  // only when no host supplies it. A bearer-token session carries its
  // credential in the `Authorization` header, not a cookie, so
  // `credentials: 'include'` alone left these two reads unauthenticated in a
  // hosted console; the effect swallows every failure, so the symptom was not
  // an error but semantic option colors and dataset dimension labels silently
  // never applying.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const doFetch = apiFetch ?? fetch;
        const reqOpts = { headers: { accept: 'application/json' }, credentials: 'include' as const };
        let objectName: string | undefined = schema.objectName;
        let fieldName: string | undefined;
        let datasetDef: any = null;
        if (objectName) {
          // The same question the refusal keys on, so the metadata probe and
          // the refusal can never disagree about what the category is.
          fieldName = resolveChartCategoryField(schema);
        } else if (schema.dataset) {
          // dataset path: dataset.object + first dimension's underlying field
          const dim0 = Array.isArray(schema.dimensions) && schema.dimensions.length ? schema.dimensions[0] : undefined;
          const defRes = await doFetch(`/api/v1/meta/dataset/${encodeURIComponent(schema.dataset)}`, reqOpts);
          const defJson = await defRes.json().catch(() => null);
          datasetDef = defJson?.item ?? defJson?.data ?? defJson;
          objectName = datasetDef?.object;
          const dim = (datasetDef?.dimensions || []).find((d: any) => d?.name === dim0) ?? (datasetDef?.dimensions || [])[0];
          fieldName = dim?.field ?? dim0;
        }
        if (!objectName || !fieldName) { if (!cancelled) setOptionMeta(null); return; }
        // objectui#13039 — the object read goes through the data source's
        // `getObjectSchema` whenever one is in scope, the same read this
        // component's own groupBy label leg (`fetchData`) and the dashboard's
        // metric widget make. That read is the data layer's shared request-key
        // cache, so N widgets over one object make ONE `meta/object/NAME`
        // request; a raw `fetch` per chart made one each (the measured ×N on a
        // dashboard). The data source answers the bare object document, which
        // is what the raw leg's unwrap below yields, so both legs hand
        // `loadDimensionFieldMeta` the same shape. The raw leg stays as the
        // fallback for a chart rendered with no data source, or with one that
        // cannot answer `getObjectSchema` (a host stub, a standalone embed).
        const loadObjectSchema = typeof dataSource?.getObjectSchema === 'function'
          ? (name: string): Promise<unknown> => dataSource.getObjectSchema(name)
          : async (name: string) => {
            const r = await doFetch(`/api/v1/meta/object/${encodeURIComponent(name)}`, reqOpts);
            const doc = await r.json().catch(() => null);
            return doc?.item ?? doc?.data ?? doc;
          };
        // Each dimension's underlying field, which for a dataset dimension may be
        // a DOTTED relationship path (`crm_account.industry`) — objectui#4053.
        const fieldByDim: Record<string, string> = {};
        if (schema.dataset && Array.isArray(schema.dimensions)) {
          for (const dimName of schema.dimensions) {
            const dimDef = (datasetDef?.dimensions || []).find((d: any) => d?.name === dimName);
            fieldByDim[dimName] = dimDef?.field ?? dimName;
          }
        }
        // Read the base object's schema, then resolve every path against it.
        // Core's `loadDimensionFieldMeta` (objectui#4389 / PR #4404) IS that
        // two-step composition, written once: a local field name reads straight
        // off the base schema as before, a dotted one walks to the object that
        // owns the terminal field. Unresolvable paths yield no entry → raw
        // value survives. `…Meta` keeps the OWNING object + terminal field
        // beside the options — the key the locale bundle is written under
        // (objectui#4030). The resolution is memoized per call and seeded with
        // the base schema, so the base object is read ONCE however many dotted
        // dimensions walk back through it — the read count the pins assert.
        const metaByPath = await loadDimensionFieldMeta(
          loadObjectSchema,
          objectName,
          [fieldName, ...Object.values(fieldByDim)],
        );
        if (!cancelled) {
          setOptionMeta({
            metaByPath,
            colorPath: fieldName,
            fieldByDim: schema.dataset && Array.isArray(schema.dimensions) ? fieldByDim : null,
          });
        }
      } catch { if (!cancelled) setOptionMeta(null); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.objectName, schema.dataset, datasetKey, aggregateKey, schema.xAxisKey, apiFetch, dataSource]);

  // ── The label net's OUTPUT, with the locale bundle applied (objectui#4030) ─
  // The net above RESOLVES a select dimension's option label; before this it
  // handed the object's authored ENGLISH label straight to the axis and the
  // legend, while the same page's related list showed the translation. The
  // bundle is applied once, here, on the shared option list every consumer
  // reads (colours AND the {value → label} relabel map) rather than per
  // surface, through `fieldOptionLabel` — the resolver list and form surfaces
  // already translate select options with
  // (`fieldOptions.<object>.<field>.<value>`).
  const { fieldOptionColors, dimensionLabels, categoryOrder } = useMemo(() => {
    if (!optionMeta) return { fieldOptionColors: null, dimensionLabels: null, categoryOrder: null };
    const { metaByPath, colorPath, fieldByDim } = optionMeta;
    // Colours read `option.label`, so they are fed the LOCALIZED options and
    // stay keyed by the string the rendered category actually carries — on the
    // aggregate path `resolveGroupByLabels` already translates it, so an
    // untranslated colour map missed every category in a localized app.
    //
    // `dimensionOptionTranslator` is core's binding of the resolver to ONE
    // resolved dimension field (objectui#4389 / PR #4404). It states the part
    // that is easy to get wrong: the translator is bound to the object that
    // OWNS the terminal field — `crm_account` for `crm_account.industry`, not
    // the dataset's base object — because that owner is the key the locale
    // bundle is written under.
    const colorOptions = localizeFieldOptions(
      metaByPath[colorPath]?.options,
      dimensionOptionTranslator(metaByPath[colorPath], fieldOptionLabel),
    );
    // Dataset path only: the same derivation the dashboard and report surfaces
    // take, written once in core. A null `fieldByDim` (the aggregate path)
    // yields null labels, exactly as the longhand loop did.
    const labels = deriveDimensionLabelMaps(
      metaByPath,
      fieldByDim ? Object.entries(fieldByDim).map(([dim, path]) => ({ dim, path })) : null,
      fieldOptionLabel,
    );
    // objectui#13403 — the first dimension's DECLARED option order, the reading
    // the dashboard's `DatasetWidget` takes for the same dataset (objectui#11809):
    // core's `buildCategoryOrder` over the same localized options the colours
    // read, so it keys the stored value and the display label alike. Dataset
    // path only (`fieldByDim` is null on the aggregate path), and only when the
    // chart names a dimension: with none, `colorPath` falls back to the
    // dataset's own first dimension, which this chart does not draw. A field
    // with no options yields null, so such a chart keeps its answered order.
    const order = fieldByDim && Array.isArray(schema.dimensions) && schema.dimensions.length > 0
      ? buildCategoryOrder(colorOptions)
      : null;
    return { fieldOptionColors: buildOptionColorMap(colorOptions), dimensionLabels: labels, categoryOrder: order };
  }, [optionMeta, fieldOptionLabel, schema.dimensions]);

  // Run a single aggregate query (used for both the current and comparison
  // windows). Extracted so the two queries share identical logic.
  const runAggregate = useCallback(async (ds: any, filterForRun: any): Promise<any[]> => {
    if (schema.aggregate && typeof ds.aggregate === 'function') {
      // ⚠️ The RAW union, deliberately — this is the one read in the file that
      // must NOT go through `aggregateGroupByKey`. The structured node is sent
      // to the server verbatim as the query's `groupBy`, so normalising it to
      // its projected column here would drop `dateGranularity` and turn a
      // date-bucketed query into an ungrouped one. Every read that indexes a ROW
      // or names a FIELD uses the helper instead. The `as any` this line used to
      // carry is gone with objectui#7946's by-reference `aggregate`: the union is
      // declared now, so `Array.isArray` narrows it without a cast.
      const gb = schema.aggregate.groupBy;
      // Structured GroupBy node (e.g. `{ field, dateGranularity: 'day' }`)
      // requires the spec-shape `{ groupBy: GroupByNode[], aggregations,
      // where }` payload so the server-side date-bucket engine kicks in.
      // The legacy `{ field, function, groupBy, filter }` cube/analytics
      // path does NOT honour `dateGranularity`.
      //
      // Both halves — the test and the payload — now live in
      // `objectAggregateSpecQuery` (`@object-ui/core`, objectui#8613), because
      // the metric family needs the identical call and a transcription there
      // was the second opinion that let the two wires disagree. The alias it
      // projects is `chartMeasureKey`'s answer, i.e. what `aggregateValueKey`
      // above already delegates to, so the column this branch produces is
      // unchanged.
      if (isStructuredGroupBy(gb)) {
        const results = await ds.aggregate(
          schema.objectName,
          objectAggregateSpecQuery(schema.aggregate, gb, filterForRun),
        );
        return Array.isArray(results) ? results : [];
      }
      const results = await ds.aggregate(schema.objectName, {
        field: schema.aggregate.field,
        function: schema.aggregate.function,
        groupBy: gb,
        filter: filterForRun,
      });
      return Array.isArray(results) ? results : [];
    }
    if (typeof ds.find === 'function') {
      const results = await ds.find(schema.objectName, { $filter: filterForRun });
      let data = extractRecords(results);
      // `aggregateRecords` buckets on `record[groupBy]`, so it needs the
      // projected COLUMN, not the raw union: a structured `groupBy` node used
      // as an index stringifies, and every row lands in one bucket keyed by
      // that stringification. Declaring the key (objectui#7946) is what made
      // that reachable to a compiler. When no column resolves there is nothing
      // to group by, and the chart is already refused for exactly that reason
      // by the absent-category screen below (objectui#8168).
      const clientGroupBy = aggregateGroupByKey(schema.aggregate);
      if (schema.aggregate && clientGroupBy && data.length > 0) {
        data = aggregateRecords(data, { ...schema.aggregate, groupBy: clientGroupBy });
      }
      return data;
    }
    return [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.objectName, aggregateKey]);

  // Session scope for `{current_user_id}` / `{current_org_id}` in the schema
  // filter. Read at component level — `fetchData` is async and a callback.
  const filterScope = useFilterScope();

  const fetchData = useCallback(async (ds: any, mounted: { current: boolean }) => {
      if (!ds || (!schema.objectName && !schema.dataset)) {
        // No way to fetch — clear loading so the no-datasource / empty state
        // can render instead of an indefinite "Loading chart data…".
        if (mounted.current) setLoading(false);
        return;
      }
      if (mounted.current) {
        setLoading(true);
        setError(null);
      }
      try {
          // ── Dataset-bound path (ADR-0021, objectstack-ai/objectstack#1890) ──────────────
          // When the chart binds to a semantic-layer `dataset`, run the same
          // governed `queryDataset` path the dashboard DatasetWidget and
          // dataset-bound reports use, so the numbers match everywhere. The
          // server resolves dimension labels + measure formats, so the legacy
          // client-side aggregate / groupBy-label resolution below is skipped.
          if (schema.dataset && typeof ds.queryDataset === 'function') {
              const runtimeFilter = resolveFilterPlaceholders(schema.filter, filterScope);
              const res = await ds.queryDataset(schema.dataset, {
                  dimensions: Array.isArray(schema.dimensions) ? schema.dimensions : [],
                  measures: Array.isArray(schema.values) ? schema.values : [],
                  ...(runtimeFilter ? { runtimeFilter } : {}),
              });
              if (mounted.current) {
                  setFetchedData(Array.isArray(res?.rows) ? res.rows : []);
                  setDatasetFields(Array.isArray(res?.fields) ? res.fields : null);
                  setDatasetObject(typeof res?.object === 'string' && res.object ? res.object : undefined);
              }
              return;
          }

          // Resolve every filter placeholder — relative-date macros (e.g.
          // "{current_quarter_start}") AND session tokens ("{current_user_id}")
          // — so both aggregate and find see real values and any drill-down
          // filter further down the line stays consistent.
          const resolvedFilter = resolveFilterPlaceholders(schema.filter, filterScope);
          // `{ kind, dimension? }` since objectstack#5011. Nothing here reads the
          // value apart from its presence: the ONE discriminator (`.kind`) is
          // read where the shift is computed — `shiftFilterByCompareTo` — so
          // this file has no second copy of the branch table to drift from it.
          const compareTo: CompareToConfig | undefined = schema.compareTo;
          // A chart family that IGNORES `compareTo` (pie / donut / funnel /
          // scatter) skips the comparison fetch entirely, so no
          // `<valueKey>__comparison` column is produced and no overlay series is
          // ever synthesised — which also keeps a compare-to scatter clear of
          // #7194's two-or-more-series scatter refusal. WHICH families is
          // `chartTypeIgnoresCompareTo` in `@object-ui/core`'s chart-presentation:
          // the one declaration the dashboard's DatasetWidget reads too
          // (objectui#7495). This file keeps no list of its own. WHICH family
          // this chart is, is `chartFamily`: the one it draws, on either family
          // channel (objectui#11530).
          const wantsComparison = !!compareTo && !chartTypeIgnoresCompareTo(chartFamily);
          // shiftFilterByCompareTo expects the raw filter (with date macros)
          // so it can substitute `{current_*}` tokens or re-resolve macros
          // against a shifted `now`. It only understands the date vocabulary,
          // so the session tokens still need their pass over the result —
          // otherwise the comparison series silently ignores the owner clause
          // that the primary series honours.
          const comparisonFilter = wantsComparison
            ? resolveContextTokens(shiftFilterByCompareTo(schema.filter, compareTo!), filterScope)
            : null;

          const [currentRowsRaw, comparisonRows] = await Promise.all([
            runAggregate(ds, resolvedFilter),
            comparisonFilter ? runAggregate(ds, comparisonFilter) : Promise.resolve([]),
          ]);

          // Merge comparison data BEFORE label resolution so we can match by
          // the raw groupBy value (server-side enums like 'closed_won'),
          // not by the humanized label ('Closed Won') which only exists
          // post-resolution. Otherwise comparison-only buckets appear as
          // duplicated raw rows alongside the humanized current rows.
          let data = currentRowsRaw;
          // groupBy may be a bare string or a structured `{field, dateGranularity}`
          // node (when categoryGranularity is configured upstream). Normalise
          // to the underlying string field name so all column lookups work.
          //
          // ⭐ Through {@link aggregateGroupByKey}, the SAME spelling the drill /
          // label leg below uses — the whole point of hoisting it (objectui#7946).
          // This site carried its own inline copy of the normalisation behind an
          // `as any`; while the two were spelled separately, one of them could
          // drift without the other, which is precisely how the drill leg came to
          // be missing it. One expression, two call sites, no cast.
          const groupByField: string | undefined =
            aggregateGroupByKey(schema.aggregate) || schema.xAxisKey;
          if (wantsComparison && comparisonRows.length > 0 && schema.aggregate) {
            const aggField = schema.aggregate.field;
            const aggFn = schema.aggregate.function;
            // The column this aggregate projects its value under — `field`,
            // or `count` for a fieldless count (framework#3701).
            const valueKey = aggregateValueKey(schema.aggregate);
            const readValue = (row: Record<string, any>): number | null => {
              if (row == null) return null;
              if (aggField) {
                const suffixed = `${aggField}_${aggFn}`;
                if (suffixed in row) return Number(row[suffixed]);
                if (aggFn === 'count' && `${aggField}_count` in row) return Number(row[`${aggField}_count`]);
              }
              if (valueKey in row) return Number(row[valueKey]);
              if ('value' in row) return Number(row.value);
              if ('count' in row) return Number(row.count);
              return null;
            };
            const comparisonKey = `${valueKey}${COMPARISON_SUFFIX}`;
            const gb = groupByField;
            if (gb && data.some((r: any) => r[gb] != null) && comparisonRows.some((r: any) => r[gb] != null)) {
              const cmpByKey = new Map<string, number | null>();
              for (const row of comparisonRows) {
                const k = String(row[gb] ?? '');
                cmpByKey.set(k, readValue(row));
              }
              data = data.map((row: any) => {
                const k = String(row[gb] ?? '');
                const v = cmpByKey.get(k);
                return v == null ? row : { ...row, [comparisonKey]: v };
              });
              const seen = new Set(data.map((r: any) => String(r[gb] ?? '')));
              for (const row of comparisonRows) {
                const k = String(row[gb] ?? '');
                if (!seen.has(k)) {
                  data.push({ [gb]: k, [comparisonKey]: readValue(row) });
                }
              }
            } else {
              const padded = Math.max(data.length, comparisonRows.length);
              const merged = [] as any[];
              for (let i = 0; i < padded; i++) {
                const cur = data[i] || {};
                const cmp = comparisonRows[i];
                merged.push(cmp ? { ...cur, [comparisonKey]: readValue(cmp) } : cur);
              }
              data = merged;
            }
          }

          // Resolve groupBy value→label using field metadata. Now that the
          // merge has happened on raw keys, the resolver can convert the
          // shared groupBy column (e.g. 'closed_won' → 'Closed Won') uniformly.
          // `schema.objectName` joins the guard rather than being asserted:
          // it is OPTIONAL since ADR-0021 (a chart may bind a `dataset`
          // instead), and every read in this leg — the metadata fetch and the
          // per-option label lookup — is keyed by an object NAME. Naming the
          // precondition is what `props: any` used to hide (objectui#7946);
          // the leg is on the object-bound path, so it is the shape it already
          // assumed.
          if (groupByField && schema.objectName && typeof ds.getObjectSchema === 'function') {
              const objectName = schema.objectName;
              try {
                  const objectSchema = await ds.getObjectSchema(objectName);
                  data = await resolveGroupByLabels(
                    data,
                    groupByField,
                    objectSchema,
                    ds,
                    (value, fallback) => fieldOptionLabel(objectName, groupByField, value, fallback),
                  );
              } catch {
                  // Schema fetch failed — continue with raw values
              }
          }

          if (mounted.current) {
              setFetchedData(data);
          }
      } catch (e) {
          console.error('[ObjectChart] Fetch error:', e);
          if (mounted.current) {
              setError(e instanceof Error ? e.message : 'Failed to load chart data');
          }
      } finally {
          if (mounted.current) setLoading(false);
      }
      // `fieldOptionLabel` is a REAL dependency, not a lint concession: the
      // groupBy label resolution above calls it, so a fetch that ran with a
      // stale resolver would render stale option labels. It used to be hidden
      // behind a ref because `useSafeFieldLabel()` returned a fresh object on
      // every render outside an i18next provider, which made this callback --
      // and therefore the effect below that depends on it -- fresh every
      // render too, i.e. an unbounded refetch loop. `useObjectLabel`'s memo now
      // holds on both paths (objectui#5564), so the identity changes only when
      // the resolver genuinely changes: once, when a provider mounts or the
      // language switches. The disable below stays for the OTHER omissions on
      // this list (`schema.aggregate`, `schema.dataset`, ...), which predate
      // this change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schema.objectName, datasetKey, aggregateKey, filterKey, compareToKey, schema.xAxisKey, chartFamily, runAggregate, filterScope, fieldOptionLabel]);

  // objectui#10035 — the refresh input this chart had none of, so a host could
  // show it a write only by remounting it (AGENTS.md #8's corollary: refresh
  // data, don't rebuild UI). The nonce moves when the data-invalidation bus
  // reports a change to the object this chart QUERIES, and the fetch effect
  // below names it, so both binding shapes re-run their own query in place:
  //   - object-bound (`aggregate` / `find` over `schema.objectName`) keys on
  //     that object;
  //   - dataset-bound (`queryDataset`) keys on the dataset's base object, which
  //     only the query's answer names (`datasetObject` above) — a dataset node
  //     carries no `objectName`.
  // A chart drawing bound or inline rows fetches nothing and is not subscribed.
  // The re-read keeps the chart mounted (`RefreshIndicator` over the current
  // rows, not the skeleton), so an open drill drawer and the chart's own state
  // survive a save.
  //
  // The path the objectui#8168 screen guards, as ONE predicate that screen,
  // the category forward (`groupByCategoryKey`) and the fetch gate below all
  // read: an object-bound chart (`objectName`, no `dataset`) drawing rows it
  // fetched itself, not rows the author handed over (`data`, or a `bind`
  // scope).
  const hasAuthoredRows = !!boundData || Array.isArray(schema.data);
  const drawsFetchedObjectRows = !!schema.objectName && !schema.dataset && !hasAuthoredRows;
  // objectui#12061 — the refusal is decided BEFORE the fetch, the shape
  // objectui#7390 gave `ObjectGallery`: decide the binding first, then fetch.
  // The refusal used to be a render-time return only, so the fetch effect
  // still issued the object-bound query (`find` with no `$top`, or
  // `aggregate` with no `groupBy`) and threw the rows away to draw the
  // refusal. Every chart list view naming no `dataset` composes exactly that
  // node since objectui#6152 round 15. This one value is what the refusal
  // below returns on and what keeps the fetch, and the invalidation
  // subscription that would re-run it, from starting — ⛔ never a second copy
  // of the rule, and ⛔ never a `$top` cap, which would shrink the read
  // rather than remove it.
  const refusesMissingCategoryAxis = drawsFetchedObjectRows && !resolveChartCategoryField(schema);
  const fetchesForItself =
    !!(schema.objectName || schema.dataset) && !boundData && !schema.data && !refusesMissingCategoryAxis;
  const invalidationNonce = useDataInvalidation(
    fetchesForItself ? (schema.dataset ? datasetObject : schema.objectName) : undefined,
  );

  useEffect(() => {
    const mounted = { current: true };

    if (fetchesForItself) {
        fetchData(dataSource, mounted);
    } else if (mounted.current) {
        // Have inline / bound data, or refused for a missing category axis —
        // won't fetch; clear loading.
        setLoading(false);
    }
    return () => { mounted.current = false; };
    // `fetchesForItself` is listed for the category half of its predicate: a
    // spec `xAxis` that arrives later moves no other dependency here, and a
    // chart refused at mount must fetch once a category is declared. Listing
    // it is also what made this list exhaustive, so it carries no lint
    // suppression.
  }, [schema.objectName, datasetKey, dataSource, boundData, schema.data, filterKey, aggregateKey, compareToKey, fetchData, invalidationNonce, fetchesForItself]);

  const rawData = boundData || schema.data || fetchedData;
  const finalData = Array.isArray(rawData) ? rawData : [];

  // --- Drill-down --------------------------------------------------------
  // Charts can opt into drill-down via `schema.drillDown`. Clicking a bar
  // segment / pie slice opens a Sheet rendering the underlying records,
  // filtered by the click context (category → groupBy field). The drilled
  // table is rendered via SchemaRenderer + the registered "object-data-table"
  // component (provided by plugin-dashboard).
  //
  // This read used to be `(schema as any).drillDown`, and framework#5022 is the
  // issue that untyped read produced: the block drove a real capability that
  // the PROTOCOL declared nowhere, so the spec's own migration prose ended up
  // prescribing a key no schema had. The protocol now declares it —
  // `ChartDrillDownSchema` in `@objectstack/spec/ui`, published on this block's
  // react contract — and the registry `inputs` below carry it, so the SDUI save
  // gate treats it as a contract prop instead of an unknown one.
  //
  // TODO(framework#5022): narrow this to the spec type once the pin advances.
  // `@objectstack/spec` is pinned at `^17.0.0-rc.2` here and the declaration
  // lands in the NEXT rc, so importing `ChartDrillDown` today would not compile
  // against the published package. Re-declaring the shape locally instead is
  // exactly the fork that would let the two drift, so the read stays on
  // `DrillDownConfig` — the renderer-side type five widgets already share —
  // until the bump. Note the two are not the same set on purpose: the spec type
  // is the CHART subset (`enabled`/`filter`/`title`/`target`/`columns`/
  // `maxRows`), while this one also carries the table/pivot/metric keys
  // (`mode`, `report`) that this component does not read.
  //
  // objectui#3354 shrank the gap from the other side: the whole `target` union
  // — including `'navigate'` — is honoured below, and the two keys no renderer
  // read at all (`view`, `sort`) are gone from `DrillDownConfig`.
  //
  // ⚠️ The asymmetry this paragraph used to describe IS GONE, and the correction
  // is recorded rather than quietly deleted because the stale claim outlived the
  // fact by two releases. It said `ChartDrillDownSchema` declares
  // `target: 'drawer' | 'dialog'`, so the protocol's union was narrower than
  // what this renderer delivers and `'navigate'` could not be advertised without
  // colliding with the publish gate. objectstack#5435 extended the union — the
  // spec now declares `['drawer', 'dialog', 'navigate']`
  // (`@objectstack/spec/ui`, `ChartDrillDownSchema.target`), and the publish
  // gate parses that same schema, so it accepts `'navigate'` today.
  //
  // ⇒ What is left is NOT a protocol gap: it is an unmade decision about the
  // designer palette. The `description` on the registry `inputs` below still
  // lists two arms, and `index.test.ts` pins that withholding by name. Widening
  // an advertised authoring vocabulary is a contract decision about `drillDown`,
  // a key objectui#7946 declares on NEITHER published face — it belongs to
  // objectui#8885, which owns `drillDown` there and already records these sites.
  // So this round corrects the false statement and leaves the advertisement
  // alone; see this PR's acceptance notes for the named successor.
  //
  // `'navigate'` works today for any host that composes an `object-chart`
  // schema directly.
  const drillDown = (schema as { drillDown?: DrillDownConfig }).drillDown;
  // Spelled through the shared normalisation rather than `aggregate?.groupBy`
  // raw: this value is used as a ROW INDEX (`row[groupByField]`), as a FIELD
  // NAME (`fieldOptionLabel`) and as a drill-filter key, and a structured
  // `groupBy` node is none of those. The comparison-merge leg above has always
  // normalised before its own column lookups; this site did not, and `props:
  // any` is why nothing said so (objectui#7946).
  const groupByField = aggregateGroupByKey(schema.aggregate) || schema.xAxisKey;

  // Build a label→raw map from the resolved chart data. resolveGroupByLabels
  // stashes the original raw enum/id under `__raw_${groupByField}`. The chart
  // event payload exposes the displayed label as `category`; we reverse-resolve
  // it so the drill filter compares against the value the backend actually
  // stores instead of the human-readable label (which would never match).
  // NOTE: declared above any conditional early returns to keep hook order stable.
  const labelToRaw = useMemo(() => {
    if (!groupByField) return new Map<string, unknown>();
    const map = new Map<string, unknown>();
    const rawKey = `__raw_${groupByField}`;
    for (const row of finalData) {
      const label = row?.[groupByField];
      if (label == null) continue;
      const raw = rawKey in (row || {}) ? row[rawKey] : label;
      map.set(String(label), raw);
    }
    return map;
  }, [finalData, groupByField]);

  // The filter the drilled list is scoped by: the widget's own filter narrowed
  // by the click context. Hoisted out of the drawer block below (which runs
  // after this component's conditional early returns) because the `'navigate'`
  // target needs it from an effect, and effects may not live after an early
  // return. The drawer reads the same value, so both targets drill by exactly
  // one filter.
  //
  // ⛔ Composed through `composeDrillFilter`, NOT by spreading the widget's
  // filter into an object literal. `schema.filter` admits two arms — a spec
  // `FilterArray` and the ObjectQL `$filter` object, both of them read (both go
  // to `ds.aggregate` / `ds.find` verbatim above) — and a spread is only correct
  // for the second. Spreading the ARRAY arm produced index keys
  // (`{ '0': ['stage','=','won'] }`), so the widget's own conditions were
  // dropped for a key the query layer ignores and the drilled list showed rows
  // this chart is scoped to exclude (objectui#8944). The seam's docblock names
  // the composition rule (`widget.filter ∧ drill.filter`, via the repo's single
  // filter sink `mergeFilterNodes`); it is not decided here.
  //
  // ⚠️ The composition lowers both filters through the throwing converter
  // form, inside this RENDER-time `useMemo` — objectui#10789. A widget filter
  // this layer refuses can still have drawn the chart (the ObjectStack
  // adapter's aggregate route hands an OBJECT filter to the server without
  // lowering it here), and the click then threw out of render into the error
  // boundary, taking the chart with it. The refusal is kept as a VALUE: no drawer opens and nothing is
  // navigated to (never with "no filter", which would list every record the
  // chart is scoped to exclude), and it is logged, naming the operator — the
  // channel a failed drill already reports on (`ReportView`'s drill handler)
  // and the one `ValueDataSource` logs a refused filter on. Only a
  // `FilterOperatorError` is caught, the rule `toFilterNodeSafely` states.
  const drillComposition = useMemo(():
    | { ok: true; filter: Record<string, unknown> | undefined }
    | { ok: false; refusal: FilterOperatorError }
    | undefined => {
    if (!drillEvent) return undefined;
    try {
      return {
        ok: true,
        filter: composeDrillFilter(
          schema.filter,
          computeDrillFilter(drillDown, drillEvent, { groupByField }),
        ),
      };
    } catch (error) {
      if (!(error instanceof FilterOperatorError)) throw error;
      return { ok: false, refusal: error };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drillEvent, drillDown, groupByField, filterKey]);
  const drillFilter = drillComposition?.ok ? drillComposition.filter : undefined;
  const drillRefused = drillComposition?.ok === false;
  // Keyed on the MESSAGE, a primitive: one warning per refused declaration,
  // from an effect rather than from render.
  const drillRefusalMessage = drillComposition?.ok === false ? drillComposition.refusal.message : undefined;
  useEffect(() => {
    if (drillRefusalMessage) {
      console.warn(`[ObjectChart] drill-down refused — the drilled list cannot be scoped: ${drillRefusalMessage}`);
    }
  }, [drillRefusalMessage]);

  // `target: 'navigate'` — skip the in-place peek and send the user straight to
  // the object's full list page, scoped by the same filter (objectui#3354).
  //
  // This mirrors `DrillDownDrawer`'s `navigateOnly` (plugin-dashboard), which
  // the table / pivot / metric widgets already honour. ObjectChart draws its own
  // drawer instead of using that component, and had only a `'dialog'` branch and
  // a default Sheet — so `'navigate'` silently rendered a Sheet, contradicting
  // the shared `DrillDownConfig.target` JSDoc for the one widget that did not
  // route through the drawer.
  //
  // Documented fallback, same as the drawer's: when the host wired no
  // `DrillNavigationContext.openRecordList` there is nowhere to navigate, so the
  // drill degrades to the in-place drawer exactly as the JSDoc promises. The
  // header's "Open in list" escape hatch stays independent of `target`.
  const navigateOnly =
    !onSegmentClick &&
    !!drillEvent &&
    !drillRefused &&
    !!schema.objectName &&
    drillDown?.target === 'navigate' &&
    !!openRecordList;
  useEffect(() => {
    if (!navigateOnly) return;
    openRecordList!(schema.objectName as string, drillFilter);
    setDrillEvent(null);
    // Fires on the transition into `navigateOnly` only — the drawer does the
    // same. Widening the deps would re-navigate on every unrelated re-render
    // that happens before `setDrillEvent(null)` lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigateOnly]);

  // Merge data if not provided in schema. When `compareTo` is configured
  // for a supported chart type, also synthesize a second series so the
  // chart implementation renders the comparison overlay (dashed / muted).
  // "Supported" is asked of the family the chart draws (`chartFamily`, either
  // family channel), exactly as the comparison fetch asks it (objectui#11530).
  const compareToConfig: CompareToConfig | undefined = schema.compareTo;
  // The result column this aggregate projects its value under, and the column
  // the comparison overlay arrives in (framework#3701).
  const valueKey = schema.aggregate ? aggregateValueKey(schema.aggregate) : undefined;
  const comparisonKey = valueKey ? `${valueKey}${COMPARISON_SUFFIX}` : undefined;
  const enableComparisonSeries =
    !!compareToConfig &&
    !chartTypeIgnoresCompareTo(chartFamily) &&
    !!comparisonKey &&
    finalData.some((row: Record<string, any>) => row[comparisonKey] != null);

  const augmentedSeries = useMemo(() => {
    const existing = Array.isArray(schema.series) ? schema.series : null;
    if (!enableComparisonSeries) return existing;
    const primary = existing || [{ dataKey: valueKey }];
    const labelMap: Record<string, string> = {
      vsLastWeek: 'Previous week',
      vsLastMonth: 'Previous month',
      vsLastQuarter: 'Previous quarter',
      vsLastYear: 'Previous year',
      vsYesterday: 'Yesterday',
      vsPreviousPeriod: 'Previous period',
    };
    const labelKey = compareToTrendLabelKey(compareToConfig!, schema.filter);
    const friendlyLabel = labelMap[labelKey] || 'Previous period';
    return [
      ...primary.map((s: any) => ({ ...s, variant: s.variant || 'current' })),
      {
        dataKey: comparisonKey,
        label: friendlyLabel,
        variant: 'comparison',
      },
    ];
  }, [enableComparisonSeries, schema.series, valueKey, comparisonKey, schema.filter, compareToConfig]);

  // ADR-0021 (#1759): when the chart binds to a dataset, derive data/xAxisKey/
  // series from its dimensions/measures via the shared buildChartSeries helper —
  // this pivots a second dimension into grouped series, matching DatasetWidget.
  //
  // `nullCategoryLabel` is this layer's half of objectui#4466: core maps a null
  // category value to a bucket so the group renders at all, and the LABEL comes
  // from here because `@object-ui/core` is React-free and cannot read the locale
  // bundle (same division as `dimensionOptionTranslator` above — core takes the
  // resolver, the renderer holds the provider).
  //
  // `builtinAggregateLabels` is the same division for a MEASURE's label
  // (objectui#7258): a result field the server minted as a built-in default
  // (`builtinAggregate: 'count'`, objectstack#14492) reads its legend / axis
  // text from the locale bundle here instead of the server's English `label`;
  // an author-declared measure carries no discriminator and keeps its label
  // verbatim (objectui#4106).
  //
  // objectui#13403 — the rows are charted in the first dimension's DECLARED
  // option order, as the dashboard's `DatasetWidget` charts them
  // (objectui#11809). The dataset answers its buckets in GROUP BY order, the
  // stored values' alphabetical order, so a priority axis read High, Low,
  // Medium, Urgent on a page block and Low, Medium, High, Urgent on a
  // dashboard. `categoryOrder` below reaches only the funnel inside the
  // renderer; a bar, line or pie draws its rows in the order it is handed
  // them, so the order is applied to the rows here, before they are charted.
  const categoryRank = schema.dataset ? buildCategoryRank(categoryOrder) : null;
  const datasetRows = schema.dataset ? relabelDimensions(finalData, dimensionLabels) : finalData;
  const firstDimension = Array.isArray(schema.dimensions) ? schema.dimensions[0] : undefined;
  const plotRows = categoryRank && firstDimension
    ? [...datasetRows].sort(
        (a, b) =>
          declaredOptionPosition(a?.[firstDimension], categoryRank) -
          declaredOptionPosition(b?.[firstDimension], categoryRank),
      )
    : datasetRows;
  const datasetChart = schema.dataset
    ? buildChartSeries(
        plotRows,
        schema.dimensions,
        schema.values,
        datasetFields,
        {
          nullCategoryLabel: tt('chart.nullCategory', '(None)'),
          builtinAggregateLabels: builtinAggregateLabels(tt),
        },
      )
    : null;

  // `drawsFetchedObjectRows` — the path the objectui#8168 screen further down
  // guards — is declared beside the fetch gate above, which reads it too.

  /**
   * objectui#10634 — the category column an object-bound chart forwards when
   * the author named its category with `aggregate.groupBy` ALONE.
   *
   * The objectui#8168 screen below accepts `aggregate.groupBy` as a category
   * (it is first in {@link OBJECT_BOUND_CHART_CATEGORY_BINDINGS}), but the
   * schema handed to `ChartRenderer` never carried it: the renderer resolves
   * its axis from `xAxisKey` / `xAxis` only, found none, and `AdvancedChartImpl`
   * floored the key on `'name'` and refused with `missing-category-key`. An
   * author who followed the refusal's own remedy was refused again, naming a
   * key they never wrote.
   *
   * ## Which key, and why not `resolveChartCategoryField`
   *
   * The axis binding is a ROW lookup, so it must name the COLUMN the aggregate
   * projects its group under — {@link aggregateGroupByKey}, which is the
   * contract's result-column convention (`chartAggregateCategoryKey` in
   * `@objectstack/spec/ui`: the `groupBy` string, or `alias ?? field` for the
   * structured node) and the same key `groupByField` relabels and drills by.
   * `resolveChartCategoryField` answers the FIELD instead (`groupBy.field`),
   * which is right for the screen and the metadata probe and names a column the
   * rows do not carry once an `alias` renames it — the distinction
   * `chartCategoryKey` in `@object-ui/core` records, and the column the
   * dashboard relays already bind (objectui#8269).
   *
   * ## When it applies
   *
   * Only to fill an ABSENT slot, and only on the path the screen guards:
   *   - an object-bound chart (`objectName`, no `dataset`) whose rows this
   *     component fetched — authored rows never went through the aggregate, so
   *     its `groupBy` says nothing about their columns;
   *   - and only when the renderer's own axis resolution answers nothing.
   *     That is asked of `normalizeChartSchema`, this package's ONE translation
   *     of `xAxisKey` / `xAxis.field` / a bare string `xAxis`, rather than of
   *     `schema.xAxisKey` alone, so a spec-shape `xAxis: { field }` is never
   *     shadowed. An authored category axis therefore always wins; ⛔ this never
   *     writes over one.
   *
   * The dataset path takes the other arm of `finalSchema` just below, which
   * sets `xAxisKey` from its own dimensions, and is untouched; so is a chart
   * drawing authored rows.
   */
  const groupByCategoryKey =
    drawsFetchedObjectRows && !normalizeChartSchema(schema, language).xAxisKey
      ? aggregateGroupByKey(schema.aggregate)
      : undefined;

  const finalSchema = datasetChart
    ? { ...schema, data: datasetChart.data, xAxisKey: datasetChart.xAxisKey, series: datasetChart.series }
    : {
        ...schema,
        data: finalData,
        ...(groupByCategoryKey ? { xAxisKey: groupByCategoryKey } : {}),
        ...(augmentedSeries ? { series: augmentedSeries } : {}),
      };

  // P3: per-category semantic colors. When the category dimension is a select/
  // lookup field, its option colors (resolved above into `fieldOptionColors`)
  // paint each slice/bar — a "Red" health category renders red, not the next
  // positional palette slot. The render layer looks each category up in
  // `categoryColors` first and only falls back to the positional palette, so an
  // explicit brand `colors` palette no longer suppresses the semantic colors.
  //
  // `colors` is overloaded kanban-style: a string[] is the positional palette
  // (fallback only); a Record<value, color> is an explicit author map that wins
  // over the field's option colors. We split the two and pass the palette as
  // `colors` and the merged map as `categoryColors`.
  const explicitColorMap: Record<string, string> | null =
    schema.colors && !Array.isArray(schema.colors) && typeof schema.colors === 'object'
      ? schema.colors
      : null;
  const paletteColors: string[] | undefined =
    Array.isArray(schema.colors) ? schema.colors : undefined;
  const mergedCategoryColors = (fieldOptionColors || explicitColorMap)
    ? { ...(fieldOptionColors || {}), ...(explicitColorMap || {}) }
    : undefined;
  const finalSchemaWithColors = {
    ...finalSchema,
    colors: paletteColors,
    ...(mergedCategoryColors ? { categoryColors: mergedCategoryColors } : {}),
    // objectui#13403 — the declared order, for the funnel the renderer orders
    // itself (the dashboard hands it the same key). Absent for a dimension
    // whose field declares no options, so that chart is untouched.
    ...(datasetChart && categoryOrder ? { categoryOrder } : {}),
  };

  /**
   * objectui#8168 — REFUSE an object-bound chart that declares no category axis.
   *
   * The twin of `ObjectTimeline`'s screen (objectui#7459), which is the settled
   * in-repo shape for this: an object-bound view that names no axis is told so
   * instead of being composed from a name nobody wrote. `ObjectCalendar` and
   * `ObjectGantt` carry the same answer for their own axes. This component was
   * the one of the four with no such screen at all.
   *
   * ## What it replaces
   *
   * `runAggregate` passes `schema.aggregate` to `ds.aggregate(objectName, {
   * field, function, groupBy, filter })` with no guard on `groupBy`, and the
   * `ds.find` leg hands the same bag to `aggregateRecords`, which buckets every
   * record on `record[groupBy] ?? 'Unknown'`. With no category declared, the
   * first asks a driver to group by `undefined` and the second collapses the
   * whole object into one `'Unknown'` bar. Which of those a reader saw was
   * decided by the data source, not by this component — and neither says the
   * binding is missing. The only loud states here are a fetch `error`
   * (`chart-error`) and a generic "No data yet"; neither is a statement about
   * an absent binding.
   *
   * ## Why it keys on the CATEGORY alone
   *
   * `resolveListChartBinding`'s `resolves` (the upstream gate, objectui#7544)
   * was `Boolean(categoryField && valueField)` on its legacy leg (retired in
   * objectui#6152 round 15), so its negation refused when EITHER was missing. That is the right question for a capability gate deciding
   * whether to OFFER a chart, and the wrong one for a renderer deciding whether
   * to DRAW one: a measure may legitimately be absent, because `count` takes no
   * field (`aggregateValueKey` projects it under the literal `'count'`), so
   * refusing on an absent measure would refuse `count` grouped by a declared
   * category — a chart that renders correctly today. The category has no such
   * out. This is `ObjectTimeline`'s clause 2 in this file's vocabulary: that
   * refusal "keys on the START axis alone", for the same reason.
   *
   * ## Three things this condition is careful about
   *
   * 1. `schema.dataset` — an ADR-0021 dataset chart selects dimensions and
   *    measures BY NAME and may legitimately declare no dimension (a single
   *    aggregate), exactly as `resolveListChartBinding`'s dataset leg says. It
   *    is a different shape with a different answer and is never refused here.
   * 2. Authored rows — `schema.data` or a `bind` scope. Those rows are handed
   *    to `ChartRenderer` as they are; no field NAME is read to fetch them, so
   *    a literal chart needs no object binding and must not be refused for
   *    lacking one. Same carve-out, same reason, as `hasAuthoredItems` in
   *    `ObjectTimeline` and as the `!boundData && !schema.data` guard on the
   *    empty state below.
   * 3. Placed above `error` and `loading`, because it is the same KIND of fact
   *    as the timeline's: a static authoring fact that no fetch outcome
   *    changes. A skeleton that resolves into a refusal, or a network error
   *    shown first, would both send the author to debug the wrong layer.
   *    And, since objectui#12061, decided before any fetch is issued: this
   *    return and the fetch gate read one value, `refusesMissingCategoryAxis`,
   *    so a chart that refuses reads nothing (no `find`, no `aggregate`).
   *
   * ## What this does NOT do
   *
   * It does not retire the six `'name'` / `'value'` floors at the three relay
   * faces — that was the remainder of objectui#7547, mechanical only once this
   * screen existed, and objectui#6152 round 15 did it with the legacy chart
   * axes. Since then a relay hands this component an object-bound node naming
   * no category whenever a chart view names no `dataset`, so this branch is
   * reached from the three relays as well as from a directly authored
   * `object-chart` that declares none. Pinned by
   * `ObjectChart.absentCategoryAxisRefusal-8168.test.tsx`, which measures both
   * halves: that the refusal fires (the relays' unbound node included), and
   * that it does NOT fire on the schema every producer composes for a chart
   * that declares a category.
   */
  if (refusesMissingCategoryAxis) {
      return (
        <div className={"p-4 text-destructive " + (schema.className || '')} data-testid="chart-missing-category-axis" role="alert">
            {tt(
              'chart.unconfigured.noCategoryAxis',
              'Chart category axis required — an object-bound chart will not invent one. Declare one of:',
            )}{' '}
            {OBJECT_BOUND_CHART_CATEGORY_BINDINGS.map((binding, i) => (
              <React.Fragment key={binding}>
                {i > 0 ? ', ' : ''}
                <code className="font-mono">{binding}</code>
              </React.Fragment>
            ))}
        </div>
      );
  }

  // Pending with nothing to draw yet → a chart-shaped skeleton (placeholder
  // bars), not a 0-value axis or a thin text line. Reads as "loading", never as
  // an empty/broken chart on the first paint. Once any data is present the chart
  // renders and a RefreshIndicator covers subsequent refetches.
  if (loading && finalData.length === 0) {
      return (
        <div
          className={"p-2 " + (schema.className || '')}
          data-testid="chart-loading"
          role="status"
          aria-busy="true"
          aria-live="polite"
        >
          <span className="sr-only">Loading chart data…</span>
          <ChartSkeleton className="h-full" />
        </div>
      );
  }

  // Error state — show the error prominently so issues are not hidden
  if (error) {
      return (
        <div className={"flex flex-col items-center justify-center gap-2 p-4 " + (schema.className || '')} data-testid="chart-error" role="alert">
          <AlertCircle className="h-6 w-6 text-destructive opacity-60" />
          <p className="text-xs text-destructive font-medium">Failed to load chart data</p>
          <p className="text-xs text-muted-foreground max-w-xs text-center">{error}</p>
        </div>
      );
  }

  if (!dataSource && schema.objectName && finalData.length === 0) {
      return <div className={"flex items-center justify-center text-muted-foreground text-sm p-4 " + (schema.className || '')} data-testid="chart-no-datasource">No data source available for &ldquo;{schema.objectName}&rdquo;</div>;
  }

  // Query succeeded and returned nothing → a self-describing empty state, NOT
  // the bare frame this used to fall through to (objectui#7130).
  //
  // ## What the bare frame actually rendered — measured, not assumed
  //
  // The card was filed on the hypothesis that "a chart frame with axes is
  // arguably self-describing": an empty table is a blank rectangle, but an
  // empty chart still draws labelled axes telling the reader what WOULD have
  // been plotted. Rendered in a real browser at 220c18d05, that is false.
  // Recharts derives its ticks FROM the data, so with `data: []` there is no
  // domain and no tick to label: the bar/line families emit an SVG containing
  // two hairline axis rules and ZERO `<text>` nodes, and pie/donut emit an
  // empty `<svg>` with no marks at all. Measured against a populated control
  // in the same render, which emitted eight `<text>` nodes. So the frame is
  // not self-describing — it is a blank tile beside a `chart-error` box that
  // at least says something, which is precisely the hotcrm#1212 failure:
  // nothing on screen says whether the chart failed or is simply young.
  //
  // ## Why this is not the KPI carve-out
  //
  // `DatasetWidget` deliberately exempts metric families — "a metric (single
  // value) over an empty dataset is 0, not an empty state" — and names charts
  // on the OTHER side of that line in the same comment: "Charts and tables
  // keep the empty state (there is genuinely nothing to plot)." A KPI's `0` is
  // a datum; a chart's blank frame is an absence. So a dataset-bound chart has
  // rendered this state since #7124 and the object-bound one did not: same
  // family, same empty result, two answers. This is the surface that ruling
  // did not reach, not a new judgement.
  //
  // ## Why `DataEmptyState` and not `WidgetEmptyState`
  //
  // The seam #7124 built is `plugin-dashboard`-local and unexported (absent
  // from that package's `index.tsx`), and `plugin-charts` does not depend on
  // `plugin-dashboard`. Reaching it would mean promoting it to public API for
  // a foreign plugin — the cross-surface abstraction objectui#7132 owns.
  // `DataEmptyState` is instead the primitive that is ALREADY shared and
  // already consumed by plugin-list / plugin-kanban / plugin-detail and by
  // `WidgetEmptyState` itself, out of `@object-ui/components`, which this
  // package already depends on. Nothing is promoted, no dependency edge is
  // added, and when #7132 converges the defaults this call site collapses the
  // same way the other four do.
  //
  // The copy is the keys #7124 landed in all ten packs — no new key, and no
  // promise of recovery: it states that the load SUCCEEDED, which is the one
  // fact the reader of a blank tile cannot otherwise get. `role="status"`
  // against the `role="alert"` on the `chart-error` box above is the machine
  // check that the two states are distinct.
  //
  // Gated on a QUERY-backed chart: a chart handed inline `data: []` by its
  // author never ran a query, so "its query returned no records" would be
  // false of it, and those charts render byte-for-byte as before.
  const isQueryBacked = !!(schema.objectName || schema.dataset);
  if (isQueryBacked && !boundData && !schema.data && finalData.length === 0) {
      return (
        <DataEmptyState
          role="status"
          data-testid="chart-empty-state"
          className={"h-full w-full gap-2 p-4 [&>h3]:text-sm [&>h3]:font-medium [&>p]:text-xs " + (schema.className || '')}
          icon={<Inbox className="h-5 w-5 text-muted-foreground/70" />}
          iconWrapperClassName="flex size-9 items-center justify-center rounded-lg bg-muted"
          title={tt('dashboard.empty.title', 'No data yet')}
          description={tt(
            'dashboard.empty.message',
            'This widget loaded successfully and its query returned no records yet.',
          )}
        >
          <p className="text-xs text-muted-foreground/80" data-testid="chart-empty-source">
            <span>{tt('dashboard.empty.sourceLabel', 'Source:')}</span>{' '}
            <span className="font-mono">{schema.dataset || schema.objectName}</span>
          </p>
        </DataEmptyState>
      );
  }

  const internalChartClick = isDrillEnabled(drillDown)
    ? (ev: ChartSegmentClickEvent) => {
        const labelCategory = ev.category;
        const rawCategory = labelCategory != null && labelToRaw.has(String(labelCategory))
          ? labelToRaw.get(String(labelCategory))
          : labelCategory;
        setDrillEvent({
          ...ev,
          // Use the raw value for filter matching; expose label separately for the title.
          category: rawCategory as any,
          categoryLabel: labelCategory,
          scope: 'cell',
        });
      }
    : undefined;
  // Host-owned click (dataset drill-through) wins over the widget's own object-drill.
  const onChartClick = onSegmentClick ?? internalChartClick;

  // `navigateOnly` renders nothing: the effect above has already handed the
  // drill to the host's list page, so the in-place drawer must not flash.
  const drillDrawer = !onSegmentClick && drillEvent && !drillRefused && schema.objectName && !navigateOnly ? (() => {
    const merged = drillFilter ?? {};
    // `schema.title` is the drill drawer's heading FALLBACK, and it is not a
    // plain string: `@objectstack/spec`'s `ChartConfigSchema.title` is
    // `I18nLabel` — a string OR an inline locale map — and this package's
    // `normalizeChartSchema` already resolves the chart's own heading through
    // `label()`, which accepts both. This site did not, so an author who wrote
    // the locale-map arm got the OBJECT here, stringified into the heading.
    //
    // ⛔ Resolved through `pickLocalized` from `@object-ui/i18n` — the published,
    // locale-aware resolver whose docblock names avoiding exactly this
    // stringification, and which is pinned as the twin of the spec's own
    // `resolveI18nLabel` (`i18nLabel-resolver-parity.test.ts`). ⛔ NOT through
    // this module's private `labelOf`-style helpers: those are not locale-aware,
    // and a second answer here would disagree with the published resolver on the
    // same value.
    //
    // `pickLocalized` answers `''` for an absent value, so `|| 'Details'` keeps
    // the pre-existing fallback exactly as it was for the string arm.
    //
    // The asymmetry this comment used to record — drill heading locale-aware,
    // chart heading beside it decided by key order — is CLOSED (objectui#8943).
    // `normalizeChartSchema`'s `label()` now delegates to this same
    // `pickLocalized`, and `ChartRenderer` hands it the same
    // `useObjectTranslation().language` read above. One union, one resolver, two
    // read sites that agree. ⛔ Do not reintroduce a local pick at either end.
    const title = resolveDrillTitle(drillDown, drillEvent, pickLocalized(schema.title, language) || 'Details');
    const target = drillDown?.target ?? 'drawer';
    const tableSchema: ObjectDataTableSchema = {
      type: 'object-data-table',
      objectName: schema.objectName,
      filter: merged,
      pagination: true,
      pageSize: drillDown?.maxRows,
      columns: drillDown?.columns?.map((c: string) => ({ accessorKey: c, header: c })),
      // Complete the drill chain: a row in the filtered list opens that record.
      // Rendered as a dialog so it stacks cleanly over this drill drawer.
      drillDown: { enabled: true, mode: 'record' as const, target: 'dialog' as const },
    };
    const body = (
      <div className="overflow-auto" data-testid="chart-drill-body">
        <SchemaRenderer schema={tableSchema} dataSource={dataSource} />
      </div>
    );
    // Escape hatch — escalate this segment peek to the object's full list page,
    // scoped by the same filter. Shown only when the host wired navigation.
    const escapeHatch = openRecordList && schema.objectName ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="drill-open-in-list"
        onClick={() => { openRecordList(schema.objectName!, merged); setDrillEvent(null); }}
      >
        {tt('dashboard.openInList', 'Open in list')}
        <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
      </Button>
    ) : null;
    if (target === 'dialog') {
      return (
        <Dialog open onOpenChange={(v) => !v && setDrillEvent(null)}>
          <DialogContent className="max-w-4xl">
            <DialogHeader className="flex-row items-center justify-between gap-4 pr-8">
              <DialogTitle>{title}</DialogTitle>
              {escapeHatch}
            </DialogHeader>
            {body}
          </DialogContent>
        </Dialog>
      );
    }
    return (
      <Sheet open onOpenChange={(v) => !v && setDrillEvent(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl md:max-w-3xl lg:max-w-4xl flex flex-col">
          <SheetHeader className="flex-row items-center justify-between gap-4 pr-8">
            <SheetTitle>{title}</SheetTitle>
            {escapeHatch}
          </SheetHeader>
          <div className="flex-1 overflow-hidden mt-2">{body}</div>
        </SheetContent>
      </Sheet>
    );
  })() : null;

  return (
    // `h-full` keeps the height chain intact: a dashboard grid cell declares a
    // definite height and passes `className: "h-full"` down the schema to
    // ChartContainer, whose `height: 100%` resolves against THIS div — a plain
    // auto-height block here computes that to `auto`, recharts measures a
    // permanent zero, and only the CHART_MIN_HEIGHT floor keeps the chart
    // visible at all (#5451). Under auto-height parents `h-full` itself
    // resolves to `auto`, so non-dashboard hosts are unchanged.
    <div className="relative h-full">
      <RefreshIndicator active={loading && finalData.length > 0} ariaLabel={t('chart.refreshing')} />
      <ChartRenderer {...props} schema={finalSchemaWithColors} onChartClick={onChartClick} />
      {drillDrawer}
    </div>
  );
};

/**
 * What `ObjectChart` reads for its own query: `objectName` and `filter` (the
 * `ds.aggregate` / `ds.find` calls above, both `$filter: schema.filter`).
 *
 * Neither `columns` nor `sort` nor a row cap is mapped, and the reason is the
 * shape of the block rather than an omission: a chart projects the
 * `aggregate` / `xAxisKey` fields it declares, the engine returns grouped rows
 * whose order the aggregation decides, and there is no page to cap. Writing a
 * saved view's column list or sort onto this schema would be a value accepted
 * and then dropped — the defect objectstack#6953 exists to remove.
 */
const OBJECT_CHART_DATA_SOURCE: ElementDataSourceMapping = {
  filter: true,
};

/**
 * Whether a chart node has no record source but its object (objectui#11605):
 * no inline `data`, no `dataset`, no `bind` path. `ObjectChart` fetches only by
 * `objectName` or `dataset`, and draws inline or bound rows without either.
 *
 * `data` and `bind` are read as the `BaseSchema` members they are. `dataset` is
 * this block's own key and no `BaseSchema` member, so it is read by name with
 * `Reflect.get` rather than through a second type literal that would re-declare
 * the base members beside it.
 */
const chartNeedsObject = (node: BaseSchema): boolean =>
  node.data == null && node.bind == null && Reflect.get(node, 'dataset') == null;

/**
 * Registry shell for `object-chart` — maps the spec's
 * `PageComponentSchema.dataSource` binding onto the keys {@link ObjectChart}
 * reads (objectstack#6953).
 *
 * Nothing used to map `dataSource.object` onto `objectName`, and this block gates
 * BOTH its fetch and its loading state on that key (`!schema.objectName &&
 * !schema.dataset` returns early) — so a chart authored with the binding the
 * spec documents rendered an empty frame with no error and no request. Lives
 * here, beside the registration, rather than in `ChartContainerImpl` — the
 * binding is a registry-boundary concern, not a rendering one.
 *
 * ## Its props type — the node BEFORE the gate (objectui#8885)
 *
 * This shell used to be published as `(props: any)`. `schema` is now
 * `BaseSchema`, the node `SchemaRenderer` hands every registered renderer, and
 * ⛔ NOT `ObjectChartSchema`. The node arrives here before the gate has mapped
 * its `dataSource` binding, and nothing has validated it as a chart. Typing it
 * post-gate would claim a validation that has not happened, and that type's
 * `type: 'object-chart'` literal is also false for the `chart` alias that
 * `index.tsx` registers this same shell under.
 *
 * Every other prop is `ObjectChart`'s own, taken from `ObjectChartProps`, so
 * the type is CLOSED: a misspelled prop name is an excess-property error, not
 * an `any` passed straight through. Both halves are existing exported names;
 * no new type is minted. Pinned by
 * `__tests__/ObjectChartBlock.props-8885.test.tsx`.
 */
export const ObjectChartBlock = elementDataSourceBlock(
  (props: Omit<ObjectChartProps, 'schema'> & { schema: BaseSchema }) => {
    // objectui#12920 — the unresolvable-view panel's title reads the bundle.
    const { t } = useObjectTranslation();
    return (
      <ElementDataSourceGate
        schema={props.schema}
        mapping={OBJECT_CHART_DATA_SOURCE}
        dataSource={props.dataSource}
        testId="object-chart"
        errorTitle={t('element.chart.sourceUnresolved', {
          defaultValue: 'This chart’s data source could not be resolved',
        })}
        // A chart that names its object in neither place has nothing to
        // aggregate, and drew an empty chart frame with no axis and no message
        // (objectui#11605). Inline `data`, a semantic-layer `dataset` and a `bind`
        // path are its other record sources, so any of them opts out.
        requiresObject={chartNeedsObject(props.schema)}
      >
        {(bound) => (
          // The ONE loose member of this signature, kept on purpose. This is
          // where the pre-gate node becomes the component's post-gate schema,
          // and `ObjectChart` is where the post-gate claim belongs. The gate
          // maps the binding and does not validate, so the claim has to be
          // made here, at one line, instead of on the published signature
          // above.
          <ObjectChart {...props} schema={bound as ObjectChartSchema} />
        )}
      </ElementDataSourceGate>
    );
  },
);

// Register it
ComponentRegistry.register('object-chart', ObjectChartBlock, {
    namespace: 'plugin-charts',
    label: 'Object Chart',
    category: 'view',
    inputs: [
        // NOT required (objectui#11605). This block has no `ComponentPropsMap`
        // row; the contract is the binding doc (`content/docs/guide/data-source.md`,
        // "a node bound this way needs no `objectName` of its own"), and
        // `ObjectChartBlock` lands `dataSource.object` here. The page compile
        // reads this list, so `required: true` refused a bound node the
        // renderer accepts. A node with neither is answered by the gate's hint.
        {
          name: 'objectName',
          type: 'string',
          description:
            'Object this chart aggregates. Not required: the node\'s `dataSource` binding can name the object instead, and `dataSource.object` lands on this key, outranking an authored value. With neither, and no inline `data`, the chart shows a hint naming this key instead of an empty frame.',
        },
        { name: 'data', type: 'array', description: 'Optional static data' },
        { name: 'filter', type: 'array' },
        { name: 'aggregate', type: 'object', description: 'Aggregation config: { field, function, groupBy }' },
        // framework#5022. The manifest built from these `inputs` is what the
        // SDUI save gate validates a page's JSX against, so an undeclared prop
        // is reported as `unknown-prop` — which is what an author writing the
        // segment drill got, for a prop this component has always read. The
        // spec now declares the shape (`ChartDrillDownSchema`), and this entry
        // is the half that makes the gate agree.
        //
        // Only the six keys the spec declares are advertised here; the wider
        // renderer-side `DrillDownConfig` (`mode`, `report`) belongs to the
        // table/pivot/metric widgets, and advertising it would re-open the gap
        // framework#5022 closed — one layer down, in the designer palette.
        //
        // `target: 'navigate'` is DELIVERED by this component since
        // objectui#3354 and is still NOT advertised here — but ⚠️ NOT for the
        // reason this comment used to give. It said `ChartDrillDownSchema`
        // "landed the chart drill as `target: 'drawer' | 'dialog'` — strict",
        // so listing `'navigate'` would hand an author a value
        // `validate-react-page-props` then rejects. That is FALSE as of
        // objectstack#5435: the spec declares `['drawer','dialog','navigate']`
        // and the publish gate parses that same schema, so it accepts the value.
        //
        // What remains is an unmade decision, not a protocol gap: widening an
        // ADVERTISED authoring vocabulary is a contract decision about
        // `drillDown` — a key objectui#7946 declares on neither published face
        // and objectui#8885 does. Until that card takes it, the description
        // below and the pin in `index.test.ts` stay as they are, with the reason
        // written down where the next reader will find it rather than
        // rediscovered from a claim that has already gone stale twice.
        //
        // `view` / `sort` are gone from `DrillDownConfig` entirely
        // (objectui#3354) — no renderer ever read them, so there is no longer a
        // key to advertise or withhold.
        { name: 'drillDown', type: 'object', description: "Segment drill config: { enabled?, filter?, title?, target?: 'drawer' | 'dialog', columns?, maxRows? }. Present = on; {} is enough. Clicking a segment opens the underlying records filtered by the clicked category." },
    ]
});
