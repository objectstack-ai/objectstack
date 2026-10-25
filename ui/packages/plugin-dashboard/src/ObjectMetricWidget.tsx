/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import React, { useState, useEffect, useContext, useCallback, useMemo } from 'react';
import { SchemaRendererContext, useFilterScope, useDataInvalidation } from '@object-ui/react';
import { isDrillEnabled, resolveDrillTitle, isStructuredGroupBy, objectAggregateSpecQuery, toFilterNode } from '@object-ui/core';
import type { I18nLabel, ObjectChartSchema, ObjectMetricDrillDownConfig } from '@object-ui/types';
import {
  useLocalization,
  useDisplayLocale,
  resolveFieldCurrency,
  useObjectTranslation,
  pickLocalized,
} from '@object-ui/i18n';
import { formatCurrency, formatPercent, percentCellScale } from '@object-ui/fields';
import { isFilterAST, parseFilterAST, resolveFieldScale } from '@objectstack/spec/data';
import { MetricWidget, metricPatternDecimals } from './MetricWidget';
import { DrillDownDrawer } from './DrillDownDrawer';
import {
  resolveFilterPlaceholders,
  shiftFilterByCompareTo,
  compareToTrendLabelKey,
  computeMetricDelta,
  type CompareToConfig,
} from './utils';

/**
 * Page size the drilled record list falls back to when the author declared no
 * `drillDown.maxRows`. It is the value the hand-rolled panel this block used to
 * carry hard-coded, kept so that routing through the shared `DrillDownDrawer`
 * (objectui#8970) changes nothing for a config that never named the member —
 * the shared drawer's own fallback is `data-table`'s default of 10.
 */
const METRIC_DRILL_PAGE_SIZE = 25;

/**
 * The tile's aggregate vocabulary, BY REFERENCE: `ChartAggregate['function']`
 * from `@objectstack/spec/ui`, reached through `ObjectChartSchema` exactly as
 * `ObjectMetricWidgetProps.aggregate.groupBy` is — both dashboard relays
 * compose this node and the `object-chart` node out of one provider block.
 */
type TileAggregateFunction = NonNullable<ObjectChartSchema['aggregate']>['function'];

/**
 * Does the aggregate answer IN the aggregated field's unit (objectui#10356)?
 *
 * The field's display unit — a currency code, a percent pattern — dresses the
 * tile's number only when the number is a value of that field: `sum` / `avg`
 * are amounts of it, and `min` / `max` "return a value of the field's OWN
 * type" (the notes on `AGGREGATE_FIELD_TYPE_COMPATIBILITY` in
 * `@objectstack/spec/data`). A `count` is a number of rows, which "reads no
 * arithmetic off the value", so a count over a currency field reads `3`, never
 * `$3` — the rule the grid footer already applies to a currency or percent
 * column (`formatSummaryLabel` in `plugin-grid`'s `useColumnSummary`). That
 * rule is keyed on its own vocabulary (`ColumnSummary`), so the two surfaces
 * share a reading rather than a table.
 *
 * A total `Record` over the vocabulary, so a function the spec adds to it is a
 * compile error here rather than a silent guess. Anything outside it — the
 * engine-level `count_distinct`, another cardinality — answers `false`: a
 * unit is only ever withheld on a word this table does not know, never lent.
 */
const ANSWERS_IN_FIELD_UNIT: Record<TileAggregateFunction, boolean> = {
  sum: true,
  avg: true,
  min: true,
  max: true,
  count: false,
};

function answersInFieldUnit(fn: string | undefined): boolean {
  return (
    typeof fn === 'string' &&
    Object.prototype.hasOwnProperty.call(ANSWERS_IN_FIELD_UNIT, fn) &&
    ANSWERS_IN_FIELD_UNIT[fn as TileAggregateFunction]
  );
}

/**
 * The numeral pattern `MetricWidget` reads a fixed width of `width` decimal
 * places from: `'0,0'`, `'0,0.00'`, and with `percent` the same pattern ending
 * in `%`. The tile's formatter takes its width from the pattern alone, so this
 * is how a width resolved here reaches it.
 */
function widthPattern(width: number, percent: boolean): string {
  return `0,0${width > 0 ? `.${'0'.repeat(width)}` : ''}${percent ? '%' : ''}`;
}

/**
 * The decimal places `value` carries in its own shortest spelling, exponent
 * included (`1e-7` counts seven). The same reading `plugin-grid`'s column
 * footer takes of each value in `widestFractionDigits`, over one value, and
 * capped at 20 for the same reason: the most a no-fixed-width list cell
 * renders.
 */
function ownFractionDigits(value: number): number {
  const [mantissa, exponent] = String(value).split('e');
  const point = mantissa.indexOf('.');
  const fraction = point === -1 ? 0 : mantissa.length - point - 1;
  return Math.min(Math.max(fraction - (exponent ? Number(exponent) : 0), 0), 20);
}

/**
 * The spec-shape query's `where`, lowered from the tile's filter
 * (objectui#11526).
 *
 * The authored bag's `filter` is a `ViewFilterRule[]`: `ObjectMetricPropsSchema`
 * in `@objectstack/spec/ui` declares it so. The two wires take it differently:
 *
 *   - the legacy bag carries it raw as `filter`, and `ObjectStackAdapter`
 *     lowers it there (`lowerAnalyticsFilterForWire`: the rule list becomes
 *     filter AST through `translateFilterArray`, then a `FilterCondition`
 *     through `parseFilterAST`);
 *   - the spec-shape query posts `where` VERBATIM, and the adapter refuses a
 *     rule list there with `UnloweredAggregateWhereError` (objectui#6825,
 *     ruling A: refuse, never lower). The producer lowers it.
 *
 * The adapter's lowering is module-private to `@object-ui/data-objectstack`,
 * which this plugin does not depend on (it reads any `DataSource`), and
 * `@object-ui/core` cannot re-export it: the adapter package depends on core.
 * So the same two stages are taken from where they are public. `toFilterNode`
 * is core's sink for a `ViewFilterRule[]` (the one `object-grid` lowers its own
 * rule-list `filter` through, via `toFilterNodeSafely`), and `parseFilterAST`
 * is the spec's single sink, the call the adapter makes. The result is the
 * `FilterCondition` that `QuerySchema.where` declares; the pin
 * `ObjectMetricWidget.ruleFilterSpecShape-11526` checks that every operator the
 * spec's rule vocabulary declares lowers to one. That it equals the legacy
 * wire's `where` was measured once, on objectui#11526's pull request, against
 * the real adapter; nothing in this repo re-derives that equality.
 *
 * Three inputs keep what they had:
 *
 *   - a NON-array filter is already a `FilterCondition` (the flat record form),
 *     so it is returned untouched;
 *   - an EMPTY array lowers to `undefined`, so no `where` is posted, as the
 *     legacy wire posts none;
 *   - an array the lowering could not turn into a filter (`isFilterAST` says
 *     no) is returned unparsed. `parseFilterAST` answers `undefined` for such
 *     an array, which would post an UNFILTERED aggregate under a filtered
 *     question; handed on, it meets the adapter's refusal and nothing is sent.
 *
 * A rule either sink refuses throws here, and `fetchMetric` shows it as the
 * tile's error.
 */
function specShapeWhere(filter: unknown): unknown {
  if (!Array.isArray(filter)) return filter;
  const node = toFilterNode(filter);
  return node !== undefined && isFilterAST(node) ? parseFilterAST(node) : node;
}

/**
 * ObjectMetricWidget — Data-bound metric widget.
 *
 * When a metric widget has an `object` binding and a `dataSource` is available,
 * this component attempts to fetch the metric value from the server using
 * aggregation. If the fetch fails, it shows an error state instead of
 * silently displaying stale/hardcoded data.
 *
 * Lifecycle states:
 * - **Loading** → spinner placeholder
 * - **Error** → error message (API failure is surfaced, not hidden)
 * - **Data** → actual metric value from server
 * - **Fallback** → when no dataSource is available, renders the static
 *   `options.value` as provided in the widget config (demo/fallback mode)
 */
export interface ObjectMetricWidgetProps {
  /** The object/resource name to query */
  objectName: string;
  /**
   * Aggregation config (field, function, groupBy).
   *
   * `groupBy` is the contract's own union — BY REFERENCE through
   * `ObjectChartSchema['aggregate']`, which holds `ChartAggregate` from
   * `@objectstack/spec/ui` by reference in turn, never a local near-copy of it
   * (`check:spec-symbols`). It is the same authored key the `object-chart` node
   * carries, so a second spelling here could only be a way for the two to
   * disagree. (Both dashboard relays used to compose this node and the chart's
   * out of one `provider: 'object'` block; since objectui#11525 a dataset-less
   * metric draws the retired-format placeholder, and this node is authored.)
   *
   * It used to say `string`, which was a claim about the AUTHOR that nothing
   * upstream backed: the value crosses two `any` seams on its way in
   * (`isObjectProvider` narrows the widget data to `aggregate?: any`, and
   * `computeOne` takes the datasource untyped), so the declaration refused the
   * structured `{ field, dateGranularity }` node at neither compile time nor
   * runtime — it merely hid it from the reader, and from anyone asking whether
   * `computeOne` handled it (objectui#8613). Optional here, unlike the chart's,
   * because a metric paints ONE number and floors an absent `groupBy` at
   * `'_all'`.
   */
  aggregate?: {
    field: string;
    function: string;
    groupBy?: NonNullable<ObjectChartSchema['aggregate']>['groupBy'];
  };
  /** Filter conditions */
  filter?: any;
  /**
   * The KPI's heading, in @objectstack/spec's `I18nLabel` vocabulary — a plain
   * string or an inline per-locale map (`{ en: 'Revenue', 'zh-CN': '收入' }`).
   *
   * Was `string | { key?, defaultValue? }` — the key-reference form
   * objectstack#5055 RETIRED at rc.6. The sibling `MetricWidgetProps` was
   * migrated for this reason in objectui#4358; this interface was missed in
   * that pass, and the omission was not inert (objectui#5264). This component
   * forwards `label` straight to `MetricWidget`, which resolves it with
   * `pickLocalized`. The retired object hits no locale limb, so resolution
   * falls through to the last resort — the FIRST string property in insertion
   * order — and `{ key, defaultValue }` written in that natural order paints
   * the raw dotted translation key onto the card as its visible label.
   *
   * The producer side already says so: `ObjectMetricPropsSchema.label` in
   * `@objectstack/spec/ui` is `I18nLabelSchema`, and its inline-map key regex
   * rejects `key`/`defaultValue` by name. This declaration now agrees with it.
   */
  label: string | I18nLabel;
  /** Fallback static value (used when no dataSource or in demo mode) */
  fallbackValue?: string | number;
  /** Trend info */
  trend?: {
    value: number;
    /** Trend caption, same `I18nLabel` vocabulary as {@link ObjectMetricWidgetProps.label}. */
    label?: string | I18nLabel;
    direction?: 'up' | 'down' | 'neutral';
  };
  /** Icon name or ReactNode */
  icon?: React.ReactNode | string;
  /** Additional CSS class */
  className?: string;
  /** Sub-caption under the value, same `I18nLabel` vocabulary as {@link ObjectMetricWidgetProps.label}. */
  description?: string | I18nLabel;
  /** External data source (overrides context) */
  dataSource?: any;
  /** Visual color variant for the icon container */
  colorVariant?: 'default' | 'blue' | 'teal' | 'orange' | 'purple' | 'success' | 'warning' | 'danger';
  /** Number format pattern (e.g. `'0,0'`, `'0,0.00'`, `'$0,0'`, `'0%'`). */
  format?: string;
  /** ISO currency code (e.g. `'USD'`); enables currency formatting on numeric values. */
  currency?: string;
  /** Static prefix appended in front of the formatted value (e.g. `'$'`, `'¥'`). */
  prefix?: string;
  /** Static suffix appended after the formatted value (e.g. `' /mo'`). */
  suffix?: string;
  /**
   * When true, the displayed value is `1 - value` (clamped to `[0, 1]`).
   * Useful for "compliance" / "uptime" style gauges that aggregate the
   * opposite signal (e.g. `avg(is_violated)` → display "compliance rate").
   * Only applied when the fetched value is a finite number in `[0, 1]`.
   */
  invert?: boolean;
  /**
   * Drill-down config. When enabled, clicking the metric card opens a drawer
   * (or dialog) listing the records behind the number, scoped by this
   * widget's own `filter`, the one the aggregate runs over.
   *
   * Typed `ObjectMetricDrillDownConfig`, not the shared `DrillDownConfig`:
   * `drillDown.filter` and `drillDown.mode` are refused by name on this block
   * (objectui#9002, ruling B). A metric has no click event for a drill filter
   * to interpolate against and no row to open as a record. The shared type
   * keeps both members for the blocks that read them.
   */
  drillDown?: ObjectMetricDrillDownConfig;
  /**
   * Title for the drill-down panel; defaults to the metric label. Same
   * `I18nLabel` vocabulary as {@link ObjectMetricWidgetProps.label}, and
   * resolved through the same `pickLocalized` — see `drawerTitle` below, which
   * used to read the retired form's `defaultValue` limb directly.
   */
  title?: string | I18nLabel;
  /**
   * Period-over-period comparison configuration — the executor's own
   * `{ kind, dimension? }` contract since objectstack#5011. When set, the
   * widget issues a parallel aggregate for the comparison window and derives a
   * trend (% delta + direction + i18n label like "vs last quarter").
   *
   * - `{ kind: 'previousPeriod' }`: same window length immediately before the current.
   * - `{ kind: 'previousYear' }`: same window shifted back one year.
   *
   * `dimension` is not read on this inline path — it names the dataset time
   * dimension the EXECUTOR shifts, and this path shifts the widget's own
   * `filter` instead. Has no effect when no `filter` (or no date filter) is
   * provided — the shift uses the filter's date range to compute the
   * comparison window.
   */
  compareTo?: CompareToConfig;
  /** Optional i18n translator used to localize the trend label. */
  t?: (key: string, defaultValue: string) => string;
  /** Layout variant forwarded to MetricWidget: 'card' (default) or 'bare'. */
  variant?: 'card' | 'bare';
}

export const ObjectMetricWidget: React.FC<ObjectMetricWidgetProps> = ({
  objectName,
  aggregate,
  filter,
  label,
  fallbackValue,
  trend,
  icon,
  className,
  description,
  dataSource: propDataSource,
  colorVariant,
  format,
  currency,
  prefix,
  suffix,
  invert,
  drillDown,
  title,
  compareTo,
  t: tProp,
  variant,
}) => {
  const context = useContext(SchemaRendererContext);
  const dataSource = propDataSource || context?.dataSource;
  const [drillOpen, setDrillOpen] = useState(false);

  const [fetchedValue, setFetchedValue] = useState<string | number | null>(null);
  const [previousValue, setPreviousValue] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objectSchema, setObjectSchema] = useState<any>(null);

  // Fetch object schema so we can derive currency/precision from the
  // aggregated field's metadata. This lets dashboard configs omit the
  // redundant `format: '$0,0'` / `prefix: '$'` for `Field.currency()` fields.
  useEffect(() => {
    let mounted = true;
    if (!dataSource || !objectName || typeof dataSource.getObjectSchema !== 'function') return;
    dataSource.getObjectSchema(objectName)
      .then((s: any) => { if (mounted) setObjectSchema(s); })
      .catch(() => { /* metadata lookup is best-effort */ });
    return () => { mounted = false; };
  }, [dataSource, objectName]);

  // Resolve the field definition for the aggregated field (e.g. 'amount').
  const valueFieldDef = useMemo(() => {
    const fieldName = aggregate?.field;
    if (!fieldName || !objectSchema?.fields) return null;
    const fields = objectSchema.fields;
    if (Array.isArray(fields)) return fields.find((f: any) => f?.name === fieldName) || null;
    return fields[fieldName] || null;
  }, [objectSchema, aggregate?.field]);

  // The field's unit applies only to an aggregate that answers in it
  // (objectui#10356, `answersInFieldUnit` above). A primitive, so the memos
  // below key on the answer rather than on any object's identity.
  const fieldUnitApplies = answersInFieldUnit(aggregate?.function);

  // Derive format/currency from the field metadata when the dashboard config
  // doesn't override them. A currency field has no pattern here: its amount is
  // rendered by the list cell's formatter below (`tileValue`).
  //
  // objectui#11254 (ruling A′ on objectstack-ai/objectstack#19628): a
  // `percent` or `number` aggregate is shown at the field's WIDTH, read through
  // `resolveFieldScale` from `@objectstack/spec/data` — the declared `scale`
  // when it is well-formed, otherwise the protocol's own answer for the type.
  // The list cell, the detail chip, the grid footer and the edit widget ask
  // the same function, so a `percent` declaring `scale: 2` reads `12.34%` here
  // as it does in the cell, and a declared `number` keeps its decimals. This
  // memo used to infer `'0,0%'` / `'0,0'` from the TYPE alone, so a `number`
  // declaring `scale: 2` whose average is 3.75 showed `4`.
  //
  // `percent` has an absent-width row, so it always gets a number. `number`
  // has none: with no declaration it has no fixed width, and A′ rounds a
  // COMPUTED result to the widest decimal count among the values that entered
  // it, ⛔ never to a constant. This tile reads a server aggregate, not its
  // inputs:
  //  - a `min` / `max` IS one of those inputs, so its own decimal count is
  //    that reading, and the grid footer prints the same bytes over the same
  //    rows. With `invert`, the values that entered `1 - v` are `1` and `v`,
  //    so the width is still `v`'s, read before the inversion;
  //  - a `sum` / `avg` needs the inputs' widths, and the aggregate answer
  //    carries none: `AnalyticsResultResponseSchema`'s column metadata in
  //    `@objectstack/spec/api` has no width member. Every reading that would
  //    honour A′ there needs the query or the spec to report one, so this arm
  //    keeps the whole-number pattern it already had, and the question is
  //    returned on objectui#11254 rather than answered here.
  const inferredFormat = useMemo(() => {
    if (format) return format;
    if (!valueFieldDef || !fieldUnitApplies) return undefined;
    const type = valueFieldDef.type;
    const percent = type === 'percent';
    if (!percent && type !== 'number' && type !== 'integer') return undefined;
    const width = resolveFieldScale({ type, scale: valueFieldDef.scale });
    if (width !== undefined) return widthPattern(width, percent);
    const fn = aggregate?.function;
    if (fn === 'min' || fn === 'max') {
      const entered =
        typeof fetchedValue === 'number'
          ? fetchedValue
          : typeof fetchedValue === 'string' && fetchedValue.trim() !== ''
            ? Number(fetchedValue)
            : NaN;
      if (Number.isFinite(entered)) return widthPattern(ownFractionDigits(entered), false);
    }
    return '0,0';
  }, [format, valueFieldDef, fieldUnitApplies, aggregate?.function, fetchedValue]);

  // Tenant default currency (localization.currency, ADR-0053) backstops a
  // currency field that declares no explicit code of its own.
  const { currency: tenantCurrency } = useLocalization();
  // The UI language — what label TEXT follows (distinct from the tenant's
  // number/currency locale above). Same source `MetricWidget` resolves its own
  // heading against, so the drill-down drawer cannot disagree with the tile.
  const { language } = useObjectTranslation();
  // The NUMBER locale — the same hook `MetricWidget` formats every other tile
  // value with, so a currency amount formatted here reads under one convention
  // with the rest of the dashboard.
  const displayLocale = useDisplayLocale();
  // An authored `currency` is the dashboard author's declaration and stands as
  // written; only the code INFERRED from the field waits on the aggregate.
  const inferredCurrency = useMemo(() => {
    if (currency) return currency;
    if (!fieldUnitApplies || valueFieldDef?.type !== 'currency') return undefined;
    return resolveFieldCurrency(valueFieldDef, tenantCurrency);
  }, [currency, valueFieldDef, tenantCurrency, fieldUnitApplies]);

  // Stable JSON keys to prevent infinite refetch loops when callers
  // pass fresh `aggregate` / `filter` object references each render
  // (e.g. DashboardRenderer.getComponentSchema rebuilds these on every render).
  const aggregateKey = useMemo(() => (aggregate ? JSON.stringify(aggregate) : ''), [aggregate]);

  // Resolve every filter placeholder — relative-date macros (e.g.
  // "{current_quarter_start}") AND session tokens ("{current_user_id}") — so
  // the server sees real values and the drill-down `find()` later sees the
  // exact same filter as the aggregate query. Resolving only date macros here
  // left user-scoped metrics silently rendering 0 (objectstack-ai/objectstack#3574).
  const filterScope = useFilterScope();
  const resolvedFilter = useMemo(
    () => resolveFilterPlaceholders(filter, filterScope),
    [filter, filterScope],
  );
  const resolvedFilterKey = useMemo(
    () => (resolvedFilter ? JSON.stringify(resolvedFilter) : ''),
    [resolvedFilter],
  );

  const compareToKey = useMemo(
    () => (compareTo ? JSON.stringify(compareTo) : ''),
    [compareTo],
  );

  // Compute the single-bucket aggregate value for a given filter. Shared
  // between the current-period and comparison-period queries.
  const computeOne = useCallback(async (ds: any, filterForRun: any): Promise<number | string | null> => {
    if (aggregate && typeof ds.aggregate === 'function') {
      const groupBy = aggregate.groupBy;
      // Two authored `groupBy` shapes, two wires — the SAME routing the chart
      // family has had since objectui#7946, shared out of `@object-ui/core` so
      // there is one answer rather than two (objectui#8613).
      //
      // A structured node (`{ field, dateGranularity }`) needs the spec-shape
      // `{ groupBy: GroupByNode[], aggregations, where }` query, because that
      // is the one the server's date-bucket engine runs. Forwarded on the
      // legacy bag below it became `dimensions: [ <the node> ]` on the
      // analytics wire, where the contract declares dimension NAMES and
      // `dateGranularity` is not honoured at all: the author asked for monthly
      // buckets and got a different question answered, silently.
      //
      // The readback below is unchanged and needs no branch of its own: the
      // measure is projected under `chartMeasureKey`'s alias — the raw `field`,
      // or the literal `'count'` for a fieldless count — and both are limbs the
      // two chains already try (`row[field]`, `r.count`).
      //
      // The filter is lowered for the spec-shape query only (`specShapeWhere`,
      // objectui#11526): its `where` is posted verbatim, while the legacy bag's
      // `filter` is lowered by the adapter. The drill drawer below still gets
      // `resolvedFilter` as it was.
      const results = isStructuredGroupBy(groupBy)
        ? await ds.aggregate(objectName, objectAggregateSpecQuery(aggregate, groupBy, specShapeWhere(filterForRun)))
        : await ds.aggregate(objectName, {
            field: aggregate.field,
            function: aggregate.function,
            groupBy: groupBy || '_all',
            filter: filterForRun,
          });
      const data = Array.isArray(results) ? results : [];
      if (data.length === 0) return 0;
      if (aggregate.function === 'count') {
        const suffixedKey = `${aggregate.field}_count`;
        return data.reduce((sum: number, r: any) => sum + (
          Number(r[suffixedKey]) ||
          Number(r[aggregate.field]) ||
          Number(r.count) ||
          0
        ), 0);
      }
      const row = data[0] as Record<string, any>;
      const suffixedKey = `${aggregate.field}_${aggregate.function}`;
      return row[suffixedKey] ?? row[aggregate.field] ?? row.value ?? 0;
    }
    if (typeof ds.find === 'function') {
      const results = await ds.find(objectName, { $filter: filterForRun });
      const records = Array.isArray(results) ? results : results?.data || results?.records || [];
      return records.length;
    }
    return null;
  }, [objectName, aggregateKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchMetric = useCallback(async (ds: any, mounted: { current: boolean }) => {
    if (!ds || !objectName) return;
    if (mounted.current) {
      setLoading(true);
      setError(null);
    }

    try {
      // Run current and (optional) comparison aggregates in parallel so
      // a slow backend doesn't double the perceived load time.
      // Pass the RAW (unresolved) filter so `shiftFilterByCompareTo` can
      // substitute `{current_*}` tokens with their `{last_*}` counterparts
      // (`kind: 'previousPeriod'`) or re-resolve macros against a shifted `now`
      // (`kind: 'previousYear'`). Passing the already-resolved filter would
      // produce an identical query with no period shift.
      const comparisonFilter = compareTo
        ? shiftFilterByCompareTo(filter, compareTo)
        : null;

      const [current, previous] = await Promise.all([
        computeOne(ds, resolvedFilter),
        comparisonFilter ? computeOne(ds, comparisonFilter) : Promise.resolve(null),
      ]);

      if (current === null) return;

      if (mounted.current) {
        setFetchedValue(current);
        setPreviousValue(typeof previous === 'number' && Number.isFinite(previous) ? previous : null);
      }
    } catch (e) {
      console.error('[ObjectMetricWidget] Fetch error:', e);
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Failed to load metric');
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objectName, aggregateKey, resolvedFilterKey, compareToKey, computeOne]);

  // objectui#10572 — the data-invalidation bus (`notifyDataChanged` from
  // `@object-ui/react`), read the objectui#10494 way: the nonce moves when a
  // write to the object this metric AGGREGATES is declared, and the fetch
  // effect below names it, so the value is re-read in place. Without it a page
  // action over raw HTTP left the tile stale unless the page was remounted.
  const invalidationNonce = useDataInvalidation(dataSource ? objectName || undefined : undefined);

  useEffect(() => {
    const mounted = { current: true };

    if (dataSource && objectName) {
      fetchMetric(dataSource, mounted);
    } else {
      // Reset state when dataSource becomes unavailable so we fall back
      // to the static fallbackValue instead of showing stale server data.
      setFetchedValue(null);
      setError(null);
    }

    return () => { mounted.current = false; };
  }, [dataSource, objectName, fetchMetric, invalidationNonce]);

  // Determine the display value:
  // - If we fetched a value from the server, use it
  // - If there's no data source, use the fallback (demo/static value)
  let displayValue: string | number = fetchedValue !== null
    ? fetchedValue
    : (!dataSource ? (fallbackValue ?? '—') : '—');

  // Apply `invert` for compliance-style gauges (display 1 - rate).
  if (invert && typeof displayValue === 'number' && isFinite(displayValue) && displayValue >= 0 && displayValue <= 1) {
    displayValue = 1 - displayValue;
  }

  // The currency face (objectui#10221): no authored `format`, and the
  // aggregated field is a currency. A currency's decimal places are the
  // currency's, not a setting (ruling 乙 on objectstack-ai/objectstack#19910;
  // `scale` is retired from the currency type by ruling B on
  // objectstack-ai/objectstack#19629).
  //
  // This face used to build a numeral pattern out of `valueFieldDef.scale ?? 0`,
  // so a USD field declaring no `scale` showed `$1,235` for `1234.5` and a JPY
  // field carrying a stale `scale: 2` showed yen cents. With a code resolved,
  // the amount now goes to `formatCurrency` — the list cell's own formatter
  // (`CurrencyCellRenderer`), the same one the grid footer takes — so tile,
  // footer and cell agree by reference: the currency's ISO 4217 minor-unit
  // count, a whole amount included (objectui#11444 retired the whole-amount
  // trimming). The finished string is not a number, so `MetricWidget` shows it
  // as given.
  //
  // With NO code resolved the cell renders a plain number, and that one case
  // is restated rather than referenced: `MetricWidget` re-parses a string that
  // reads as a number (`12.50`) and re-formats it at its pattern's width, so a
  // pre-formatted plain amount would be rounded again. The pattern therefore
  // carries the cell's own no-currency width, two decimals, and the tile's pin
  // compares it against the cell in one run. It was `0,0` for a whole amount
  // while the cell trimmed one; that trimming retired with objectui#11444
  // (triage comment 5946462862), so the restated width moved with it.
  //
  // The face is for an aggregate that answers in the field's unit; a count
  // over a currency field is a plain number (objectui#10356).
  let tileValue: string | number = displayValue;
  let tileFormat = inferredFormat;
  if (!format && fieldUnitApplies && valueFieldDef?.type === 'currency') {
    const amount =
      typeof displayValue === 'number'
        ? displayValue
        : displayValue.trim() === ''
          ? NaN
          : Number(displayValue);
    if (Number.isFinite(amount)) {
      if (inferredCurrency) {
        tileValue = formatCurrency(amount, inferredCurrency, displayLocale);
      } else {
        tileFormat = '0,0.00';
      }
    }
  }

  // The percent face (objectui#11475): the aggregated field is a `percent`,
  // and the aggregate answers in its unit, so the value is stored the way the
  // FIELD stores it — a `sum` / `avg` / `min` / `max` of fractions is a
  // fraction, of percentage points is points. `MetricWidget` holds no field,
  // only a value and a pattern, and reads a `%` pattern by numeral's own
  // convention (a fraction), so a whole-stored field (`max: 100`, as every
  // shipped percent field declares) averaging `50` would read `5000%` there.
  // The tile is therefore rendered HERE, the way the currency face above is:
  // through the list cell's formatter, at the storage the cell reads
  // (`percentCellScale`, the spec's `percentScaleOf`), and the finished string
  // is not a number, so `MetricWidget` shows it as given.
  //
  // The width is the one the tile would have read: an authored `%` pattern's
  // decimals (`metricPatternDecimals`, `MetricWidget`'s own parse), otherwise
  // the field's width as `inferredFormat` resolved it. An authored pattern that
  // is not a percent pattern asked for a plain number and keeps that face.
  // ⚠️ `invert` above stays the magnitude-gated `1 - v` it was; it is not this
  // card's subject.
  if (
    fieldUnitApplies
    && valueFieldDef?.type === 'percent'
    && (!format || format.trim().endsWith('%'))
  ) {
    const stored =
      typeof displayValue === 'number'
        ? displayValue
        : displayValue.trim() === ''
          ? NaN
          : Number(displayValue);
    if (Number.isFinite(stored)) {
      const width = format
        ? metricPatternDecimals(format)
        : (resolveFieldScale({ type: 'percent', scale: valueFieldDef.scale }) as number);
      tileValue = formatPercent(stored, percentCellScale(valueFieldDef), width, displayLocale);
    }
  }

  // Derive a trend descriptor from the parallel comparison aggregate. When
  // `compareTo` is set and both values are finite numbers, this synthesizes
  // a `{ value, direction, label }` trend that overrides any static `trend`
  // prop passed in. The label uses the i18n key derived from `compareTo`
  // (e.g. `dashboard.trend.vsLastQuarter`). It reaches `MetricWidget` as the
  // host-only `derivedTrend`, never as `trend`: from a zero baseline its
  // `value` is `null` — no percentage is defined (objectui#12677) — which the
  // authored `trend.value` number does not admit.
  const derivedTrend = useMemo(() => {
    if (!compareTo) return undefined;
    if (typeof fetchedValue !== 'number' || !Number.isFinite(fetchedValue)) return undefined;
    if (previousValue === null) return undefined;
    const delta = computeMetricDelta(fetchedValue, previousValue);
    if (!delta) return undefined;
    const labelKey = compareToTrendLabelKey(compareTo, filter);
    const fullKey = `dashboard.trend.${labelKey}`;
    const defaults: Record<string, string> = {
      vsPreviousPeriod: 'vs previous period',
      vsLastWeek: 'vs last week',
      vsLastMonth: 'vs last month',
      vsLastQuarter: 'vs last quarter',
      vsLastYear: 'vs last year',
      vsYesterday: 'vs yesterday',
    };
    const labelText = tProp ? tProp(fullKey, defaults[labelKey] || labelKey) : (defaults[labelKey] || labelKey);
    return { value: delta.value, direction: delta.direction, label: labelText };
  }, [compareTo, fetchedValue, previousValue, filter, tProp]);

  // --- Drill-down --------------------------------------------------------
  // KPI cards drill into the underlying records they aggregate. The drill
  // table reuses the metric's own `filter` (no additional category narrowing
  // — the whole metric is the slice). Falls back to the metric label as
  // drawer title when no explicit `drillDown.title` template is set.
  const drillEnabled = isDrillEnabled(drillDown) && !!objectName && !!dataSource;
  //
  // `title` and `label` are `I18nLabel` (see the interface above), so they are
  // resolved with `pickLocalized` — the same seam `MetricWidget` uses for the
  // tile's own heading, so the drawer and the card it opened from agree on one
  // locale. These two reads previously destructured `defaultValue` off the
  // RETIRED key-reference form: an inline per-locale map has no such limb, so
  // an authored `title` resolved to `''` and the drawer silently fell back to
  // the literal word "Details" (objectui#5264).
  const drawerTitle = useMemo(() => {
    const labelText = pickLocalized(label, language);
    const titleText = pickLocalized(title, language);
    return resolveDrillTitle(drillDown, {}, titleText || labelText || 'Details');
  }, [drillDown, label, title, language]);

  // Routed through the shared `DrillDownDrawer` — the component every other
  // widget in this package drills through (objectui#8970). This block used to
  // hand-roll its own Sheet/Dialog panel, which read `enabled`, `target`'s two
  // in-place arms, `title` and `report` and silently discarded the rest of the
  // config an author is offered: `columns`, `maxRows` and `target: 'navigate'`
  // acted on every other block sharing `DrillDownConfig` and did nothing here.
  // Two implementations of one drawer was the defect — teaching the copy three
  // more members would only have guaranteed a fourth divergence.
  //
  // `maxRows` now chooses the drilled list's page size, defaulting to the 25
  // the inline panel hard-coded, so a config that never authored the member
  // keeps the page size it had. `className` reproduces the height the inline
  // body wrapper carried.
  //
  // `drillDown.filter` and `drillDown.mode` are refused on this block by its
  // prop type (`ObjectMetricDrillDownConfig`, objectui#9002 ruling B), so
  // neither is forwarded. The drilled list is scoped by the METRIC's own
  // resolved filter, which is the registration's promise that the number and
  // the records behind it agree, and a metric has no row for `mode` to open as
  // a record.
  const drillDrawer = drillEnabled ? (
    <DrillDownDrawer
      open
      onClose={() => setDrillOpen(false)}
      title={drawerTitle}
      target={drillDown?.target}
      objectName={objectName as string}
      filter={resolvedFilter}
      dataSource={dataSource}
      columns={drillDown?.columns}
      maxRows={drillDown?.maxRows ?? METRIC_DRILL_PAGE_SIZE}
      report={drillDown?.report as Record<string, unknown> | undefined}
      className="h-full"
    />
  ) : null;

  return (
    <>
      <MetricWidget
        label={label}
        value={tileValue}
        trend={trend}
        derivedTrend={derivedTrend}
        icon={icon}
        className={className}
        description={description}
        loading={loading}
        error={error}
        colorVariant={colorVariant}
        format={tileFormat}
        currency={inferredCurrency}
        prefix={prefix}
        suffix={suffix}
        variant={variant}
        onClick={drillEnabled ? () => setDrillOpen(true) : undefined}
      />
      {drillOpen && drillDrawer}
    </>
  );
};
