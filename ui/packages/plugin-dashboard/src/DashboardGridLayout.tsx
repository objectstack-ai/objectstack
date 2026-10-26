import * as React from 'react';
import { ResponsiveGridLayout, useContainerWidth, type LayoutItem as RGLLayout, type Layout, type ResponsiveLayouts } from 'react-grid-layout';
import 'react-grid-layout/css/styles.css';
import { cn, Card, CardHeader, CardTitle, CardContent, Button } from '@object-ui/components';
import { Edit, GripVertical, Save, X, RefreshCw } from 'lucide-react';
import { SchemaRenderer, useHasDndProvider, useDnd, type SchemaRendererProps } from '@object-ui/react';
import { useObjectTranslation, useObjectLabel, useSafeTranslate, pickLocalized } from '@object-ui/i18n';
import type { DashboardComponentSchema, ObjectChartSchema, PivotTableSchema } from '@object-ui/types';
import { completeWidgetLayout, defaultWidgetPlacement } from '@object-ui/types';
import { chartCategoryKey, chartConfigPresentation, chartMeasureKey } from '@object-ui/core';
import { isObjectProvider, deriveStaticTableColumns, composeSeriesLabel } from './utils';
import {
  classifyWidgetType,
  DASHBOARD_NODE_TYPES,
  entryComponent,
  isSlotComponentEntry,
  resolveWidgetType,
  toDashboardNodeType,
  unsupportedWidgetSchema,
  withoutRetiredSubCaption,
  type DashboardWidgetSlotEntry,
} from './widgetDispatch';
import { LEGACY_RETIRED_WIDGET_SCHEMA, isLegacyRetiredWidget, isRetiredEnvelopeNode } from './legacyRetiredWidget';
import { DatasetWidget } from './DatasetWidget';
import type { DashboardChartRenderSchema } from './chartRenderHandoff';
import { useDashboardAutoRefresh } from './useDashboardAutoRefresh';

/** Bridges editMode transitions to the ObjectUI DnD system when a DndProvider is present. */
function DndEditModeBridge({ editMode }: { editMode: boolean }) {
  const dnd = useDnd();

  React.useEffect(() => {
    if (editMode) {
      dnd.startDrag({ id: 'dashboard-layout', type: 'dashboard-widget', data: {} });
      return () => { dnd.endDrag(); };
    } else {
      dnd.endDrag('dashboard');
    }
  }, [editMode, dnd]);

  return null;
}

const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

export interface DashboardGridLayoutProps {
  schema: DashboardComponentSchema;
  className?: string;
  /**
   * Data-source adapter for the widgets this grid renders, handed to
   * `DatasetWidget` for ADR-0021 dataset-bound widgets (objectui#4614).
   *
   * Typed `unknown`, not `any`. The sibling declares `dataSource?: any`
   * (`DashboardRendererProps.dataSource`) for a reason that is explicitly historical —
   * "that is precisely what it resolved to before", via the index signature that
   * used to answer for it — and this is a NEW declaration with no prior
   * resolution to preserve. `unknown` is what the consumer itself declares
   * (`DatasetWidget`'s own parameter, `dataSource: unknown`), so the value is forwarded
   * to exactly the type that receives it, and no call site is held to anything
   * new: every value is assignable to `unknown`. Narrowing it further to a real
   * adapter type is a separate change with its own consumer sweep, on both
   * surfaces at once.
   *
   * Optional, and the omitted case is a SUPPORTED one rather than an oversight:
   * a host may mount this component with no adapter at all (until objectui#10859
   * batch 8 retired the `dashboard-grid` node key, its SDUI registration declared
   * only `title` / `className` inputs, so schema-driven hosts always did).
   * A dataset-bound widget arriving that way renders `DatasetWidget`'s own
   * no-capability diagnostic — a visible state, never a blank tile.
   *
   * `SchemaRenderer` forwards this as a React prop (its `...props` spread,
   * last). It cannot be shadowed by the spec's per-element `dataSource`
   * BINDING, which is stripped from the schema before that spread for exactly
   * this reason (the `dataSource: _dataSource` strip in `SchemaRenderer`'s
   * destructure, objectstack#5576).
   */
  dataSource?: unknown;
  /**
   * Fires on every drag/resize tick with the raw react-grid-layout payload.
   * Useful for live previews; NOT a persistence hook.
   */
  onLayoutChange?: (layout: RGLLayout[]) => void;
  /**
   * Canonical persistence hook. When the user clicks "Save Layout", the
   * grid coordinates are merged back into `schema.widgets[].layout` and the
   * resulting `DashboardSchema` is passed to this callback. The parent is
   * expected to forward it to its data adapter (e.g. `client.meta.saveItem`).
   *
   * If omitted, layout edits stay in memory only — the component does not
   * persist to localStorage or anywhere else (per Rule #1 Protocol Agnostic:
   * persistence is the parent's responsibility, not the renderer's).
   */
  onSchemaChange?: (schema: DashboardComponentSchema) => void;
  /** Callback invoked when dashboard refresh is triggered (manual or auto) */
  onRefresh?: () => void;
}

/** Merge react-grid-layout coordinates back into a DashboardSchema's widgets. */
export function mergeLayoutIntoSchema(
  schema: DashboardComponentSchema,
  layout: RGLLayout[],
): DashboardComponentSchema {
  if (!schema.widgets?.length) return schema;
  const byId = new Map(layout.map((l) => [l.i, l]));
  const widgets = schema.widgets.map((w, index) => {
    const id = w.id || `widget-${index}`;
    const l = byId.get(id);
    if (!l) return w;
    return {
      ...w,
      layout: { x: l.x, y: l.y, w: l.w, h: l.h },
    };
  });
  return { ...schema, widgets };
}

/**
 * The grid's box for every widget. A widget with no `layout` is auto-placed by
 * `defaultWidgetPlacement` — the fallback the spec's widget `layout` states,
 * and the one the widget width / height editors seed a new box from
 * (objectui#11388), so this grid and those editors place it in the same spot.
 */
function buildDefaultLayouts(schema: DashboardComponentSchema): { lg: RGLLayout[] } {
  return {
    lg: schema.widgets?.map((widget: DashboardWidgetSlotEntry, index: number) => ({
      i: widget.id || `widget-${index}`,
      ...completeWidgetLayout(widget.layout, {}, defaultWidgetPlacement(index)),
    })) || [],
  };
}

export const DashboardGridLayout: React.FC<DashboardGridLayoutProps> = ({
  schema,
  className,
  dataSource,
  onLayoutChange,
  onSchemaChange,
  onRefresh,
}) => {
  const { width, containerRef, mounted } = useContainerWidth();
  const [editMode, setEditMode] = React.useState(false);
  const hasDndProvider = useHasDndProvider();
  // Active UI language, for resolving inline per-locale widget titles below.
  // `useObjectTranslation` is provider-safe (react-i18next falls back to its
  // global instance and never throws), so a standalone grid still renders.
  const { t, language } = useObjectTranslation();
  // The refresh button's copy is three pack keys (`dashboard.refreshAll`,
  // `dashboard.refreshDashboard`, `dashboard.refreshing`), the same three
  // `DashboardRenderer` reads, each through `tt` like the package's other one-off labels.
  const tt = useSafeTranslate();
  // `fieldLabel` — the bundle lookup `composeSeriesLabel` (below) consults
  // before falling back to the humanized key. Same provider-safe contract as
  // `useObjectTranslation` above: a bundle miss degrades to the fallback
  // argument rather than throwing.
  const { fieldLabel } = useObjectLabel();
  /**
   * Resolve a chart series label — objectui#9172. This relay used to compose
   * `series: [{ dataKey }]` on both chart branches below with NO `label` key
   * at all, so `ChartRenderer`'s `s.label || s.dataKey` fallback rendered the
   * raw field key in the legend/tooltip while `DashboardRenderer`, the sibling
   * relay composing a chart node for the same stored widget, rendered the
   * humanized one (objectui#9055). `composeSeriesLabel` (`./utils`) is that
   * sibling's three-arm decision moved to a single shared authority rather
   * than grown a second time here — see its docblock for the arms. This
   * `useCallback` only binds it to THIS component's own `t` / `fieldLabel`.
   */
  const resolveSeriesLabel = React.useCallback(
    (objectName: string | undefined, yField: string, aggFn: string | undefined) =>
      composeSeriesLabel(t, fieldLabel, objectName, yField, aggFn),
    [t, fieldLabel],
  );
  // The refresh indicator, the manual handler and the auto-refresh timer come
  // from the one implementation this component shares with `DashboardRenderer`
  // (objectui#8820), which is also the only place `refreshIntervalSeconds` is
  // read.
  const { refreshing, handleRefresh } = useDashboardAutoRefresh(schema, onRefresh);
  const [layouts, setLayouts] = React.useState<{ lg: RGLLayout[] }>(
    () => buildDefaultLayouts(schema),
  );

  // Re-derive layouts whenever the underlying schema changes (e.g. parent
  // re-fetches after a save, widgets are added/removed). Previously the
  // useState initializer ran once and the grid drifted from the schema.
  //
  // `w` is annotated by the slot's element type, as `buildDefaultLayouts` above
  // is (objectui#11514). A `widgets[]` entry is either arm of a union, and both
  // arms declare `layout` as the spec's `DashboardWidget` member: the widget arm
  // through the spec row, the component arm (`DashboardWidgetSlotComponentSchema`)
  // by reference to it, because `mergeLayoutIntoSchema` below writes it onto
  // every entry, a component node included (objectui#11070 round 11). So
  // `layout` reads with the spec's type off either arm.
  const widgetsSignature = React.useMemo(
    () => JSON.stringify(schema.widgets?.map((w: DashboardWidgetSlotEntry, i: number) => ({
      i: w.id || `widget-${i}`,
      x: w.layout?.x, y: w.layout?.y, w: w.layout?.w, h: w.layout?.h,
    })) ?? []),
    [schema.widgets],
  );
  React.useEffect(() => {
    setLayouts(buildDefaultLayouts(schema));
    // widgetsSignature captures the only fields we care about for re-sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [widgetsSignature]);

  const handleLayoutChange = React.useCallback(
    (layout: Layout, allLayouts: ResponsiveLayouts) => {
      setLayouts(allLayouts as { lg: RGLLayout[] });
      onLayoutChange?.(layout as RGLLayout[]);
    },
    [onLayoutChange]
  );

  const handleSaveLayout = React.useCallback(() => {
    // Hand the merged schema back to the parent so it can persist via its
    // injected data adapter (server / file / etc.). If no handler is wired,
    // edits live only in component state — warn in dev so the integrator
    // knows to wire `onSchemaChange`.
    if (onSchemaChange) {
      onSchemaChange(mergeLayoutIntoSchema(schema, layouts.lg));
    } else {
      // Dev-time hint (process may not exist in pure browser bundles, hence the guard).
      const g = globalThis as { process?: { env?: { NODE_ENV?: string } } };
      if (g.process?.env?.NODE_ENV !== 'production') {
        console.warn(
          '[DashboardGridLayout] Layout edits are in-memory only. ' +
          'Wire `onSchemaChange` to persist via your data adapter.'
        );
      }
    }
    setEditMode(false);
  }, [onSchemaChange, schema, layouts]);

  const handleResetLayout = React.useCallback(() => {
    setLayouts(buildDefaultLayouts(schema));
  }, [schema]);

  // Every branch returns a node `SchemaRenderer` takes, so the return type is
  // that prop's (objectui#11466): each node is checked against its declared
  // type where it is built, and the render sites below take it with no cast.
  const getComponentSchema = React.useCallback((widget: DashboardWidgetSlotEntry): SchemaRendererProps['schema'] => {
    // The slot-component passthrough serves the slot's component arm alone and
    // takes the namespaced node key too (`toDashboardNodeType`, objectui#10859
    // batch 8; objectui#11514, Q2 A). Decided FIRST, as `DashboardRenderer`
    // decides it, and reading no widget key (objectui#11598, N2 A): below it
    // `widget` is the widget arm, so every widget key is read off the arm that
    // declares it.
    if (isSlotComponentEntry(widget)) return toDashboardNodeType({ ...widget });

    // Same boundary as `DashboardRenderer`: the author's node keeps its
    // spelling except a `metric` / `metric-card` node key, which moves onto its
    // namespaced registration (`toDashboardNodeType`, objectui#10859 batch 8).
    const authoredComponent = entryComponent(widget);
    // The envelope draws a `metric-card` and nothing else (objectui#12254):
    // any other node draws the rebind prompt, by the rule `DashboardRenderer`
    // reads too (`isRetiredEnvelopeNode`).
    if (isRetiredEnvelopeNode(authoredComponent)) return LEGACY_RETIRED_WIDGET_SCHEMA;
    if (authoredComponent) return toDashboardNodeType(authoredComponent);

    // Retired legacy inline-analytics widget (framework#3320) — the SAME
    // detector `DashboardRenderer` uses, imported rather than restated
    // (objectui#4612). Without it this stored shape reached the branches below
    // with no data at all and rendered a silent blank chart / empty table /
    // em-dash metric: no diagnostic and no path to fix, which is worse for the
    // author than the pre-retirement state. It must be tested BEFORE the
    // dispatch branches, exactly as on the sibling surface, because those
    // branches are what swallow it.
    if (isLegacyRetiredWidget(widget)) return LEGACY_RETIRED_WIDGET_SCHEMA;

    // The authored `type`, or the spec's default (`metric`) when the entry
    // names none (objectui#11514, Q2 A), as `DashboardRenderer` resolves it.
    const widgetType = resolveWidgetType(widget);
    const options = (widget.options || {}) as Record<string, any>;
    // One shared classification (./widgetDispatch) — this surface used to name
    // 8 chart families by hand while DatasetWidget covered all 19, so radar /
    // treemap / sankey and the single-value families fell through to a red
    // "Unknown component type" box (#2943).
    const dispatch = classifyWidgetType(widgetType);
    if (dispatch.family === 'series' && dispatch.chartType) {
      const widgetData = (widget as any).data || options.data;
      const xAxisKey = options.xField || 'name';
      const yField = options.yField || 'value';

      // The widget's declared `chartConfig`, lowered onto the chart schema —
      // objectui#4044, and the twin of the block in `DashboardRenderer`. This
      // surface is the EDITABLE dashboard grid over the same stored widget
      // metadata, so an author whose `chartConfig` drew nothing here but drew
      // on the read-only renderer would read the difference as a bug in the
      // editor. `isLegacyRetiredWidget` above is the settled precedent for the
      // pair (objectui#4612): one shared implementation, imported rather than
      // restated — here that shared implementation is core's
      // `chartConfigPresentation`, the same whitelist `DatasetWidget` lowers
      // through.
      const chartPresentation = chartConfigPresentation(widget.chartConfig);

      // provider: 'object' — delegate to ObjectChart for async data loading.
      // Field/aggregate config comes from the nested data provider (the
      // pre-ADR-0021 top-level analytics keys were retired in framework#3320).
      if (isObjectProvider(widgetData)) {
        const providerAgg = widgetData.aggregate;
        const effectiveAggregate = providerAgg ? {
          field: providerAgg.field,
          function: providerAgg.function,
          groupBy: providerAgg.groupBy,
        } : undefined;
        // Which column carries the measure is the CONTRACT's question, not this
        // relay's: a fieldless `count` projects its value under the literal
        // `'count'` (the engine's `COUNT(*)` alias), so `aggregate?.field ||
        // yField` bound `'value'` against rows that carry `'count'` and the
        // chart plotted nothing, silently (objectui#8266). `yField` survives as
        // the floor for a provider with NO aggregate, whose rows are raw
        // records — there the author's `yField` really is the key.
        const effectiveYField = chartMeasureKey(effectiveAggregate, yField);
        // Which column carries the CATEGORY is the same question on the other
        // axis, and this relay was answering it with a literal it never checked
        // against the aggregate that decides it: `xField || 'name'` bound
        // `'name'` against the rows a `groupBy: 'status'` aggregate returns, so
        // `hasNoCategoryKey` refused the widget by the name of a key its author
        // never wrote (objectui#8269). `xAxisKey` survives as the floor for the
        // shapes the contract has no answer for — a provider with NO aggregate
        // (rows are raw records) and an UNGROUPED one (a single row with no
        // category column at all).
        const effectiveXAxisKey = chartCategoryKey(effectiveAggregate, xAxisKey);
        // The declared node type, `ObjectChartSchema` (objectui#11514), as
        // `DashboardRenderer` builds it: `chartType` is the dispatch's
        // `SeriesChartFamily`, one of the families that type declares
        // (objectui#11513), with no cast.
        return {
          type: 'object-chart',
          chartType: dispatch.chartType,
          objectName: widgetData.object,
          aggregate: effectiveAggregate,
          xAxisKey: effectiveXAxisKey,
          series: [{
            dataKey: effectiveYField,
            label: resolveSeriesLabel(widgetData.object, effectiveYField, effectiveAggregate?.function),
          }],
          colors: CHART_COLORS,
          // Deterministic first paint inside the grid (#2756).
          isAnimationActive: false,
          className: "h-full",
          ...chartPresentation,
        } satisfies ObjectChartSchema;
      }

      const dataItems = Array.isArray(widgetData) ? widgetData : widgetData?.items || [];

      // Checked against the dashboard's chart hand-off, `ChartSchema` plus the
      // two render keys this producer composes (`./chartRenderHandoff`,
      // objectui#11598), as `DashboardRenderer` builds it; handed on with no
      // cast.
      const chartNode: DashboardChartRenderSchema = {
        type: 'chart',
        chartType: dispatch.chartType,
        data: dataItems,
        xAxisKey: xAxisKey,
        series: [{
          dataKey: yField,
          label: resolveSeriesLabel(undefined, yField, undefined),
        }],
        colors: CHART_COLORS,
        // Deterministic first paint inside the grid (#2756).
        isAnimationActive: false,
        className: "h-full",
        ...chartPresentation,
      };
      return chartNode;
    }

    // Single-value families render as a metric card, not a chart (#2943).
    // `classifyWidgetType` answers `metric` only for a named type, so the
    // `widgetType` test narrows for the compiler and changes no verdict: the
    // card's label falls back to that type, and the node's declared type
    // requires a label (objectui#11466).
    if (dispatch.family === 'metric' && widgetType !== undefined) {
      const widgetData = (widget as any).data || options.data;
      // provider: 'object' — RETIRED (objectui#11525, maintainer ruling C), with
      // the same placeholder object this surface's pivot arm and
      // `DashboardRenderer`'s metric arm return, imported rather than restated.
      // A metric binds a `dataset` (ADR-0021); this branch used to build a flat
      // `object-metric` node in a filter dialect no node type declares. A
      // typeless widget resolves to `metric` (objectui#11514) and answers here
      // too. The chart and table arms keep their `provider: 'object'` branches.
      if (isObjectProvider(widgetData)) return LEGACY_RETIRED_WIDGET_SCHEMA;
      const label = widget.title || widgetType;
      const rows = Array.isArray(widgetData) ? widgetData : widgetData?.items || [];
      const valueField = options.yField || 'value';
      return {
        // The namespaced node key, as `DashboardRenderer` emits it: the
        // registration passes `skipFallback: true` (objectui#10859 batch 8).
        // Its declared type is `DashboardMetricNodeSchema`, the
        // `CustomNodeRegistry` entry `./widgetDispatch` adds (objectui#11466).
        type: DASHBOARD_NODE_TYPES.metric,
        // The card draws no sub-caption from `options` (objectui#11389, ruling
        // C): the spread drops the retired `description` key, the same way
        // `DashboardRenderer`'s metric arm does.
        ...withoutRetiredSubCaption(options),
        label,
        value: options.value ?? rows[0]?.[valueField] ?? '—',
      };
    }

    if (dispatch.family === 'table') {
      const widgetData = (widget as any).data || options.data;

      // provider: 'object' — ObjectDataTable fetches the rows (objectui#10528).
      // This arm used to emit a STATIC `data-table` with `data: []` and an
      // `objectName` that `data-table` never reads, so the tile drew an empty
      // table and issued no query, while `DashboardRenderer` fetched and drew
      // the same stored widget. It now emits the node that renderer's table arm
      // emits, prop for prop: the self-fetching `object-data-table`, the
      // provider's `filter`, the declared `searchable` / `pagination` (never on
      // a `list`), and default-on drill-to-record. The drill cannot fight the
      // editor: dragging starts only from the `.drag-handle` element (see
      // `dragConfig` below), and this grid has no widget selection. The two
      // copies are held equal by
      // `DashboardGridLayout.objectProviderFetch-10528.test.tsx`.
      if (isObjectProvider(widgetData)) {
        const isList = widgetType === 'list';
        const { data: _data, ...restOptions } = options;
        return {
          type: 'object-data-table',
          ...restOptions,
          objectName: widgetData.object,
          filter: widgetData.filter || widget.filter,
          searchable: isList ? false : (widget.searchable ?? false),
          pagination: isList ? false : (widget.pagination ?? false),
          drillDown: options.drillDown ?? { enabled: true, mode: 'record' as const },
          className: "border-0"
        };
      }

      // Static (data-array) table. The `Array.isArray` arm is not decoration:
      // `options.data` for this widget is authored as a plain ARRAY, and
      // `widgetData?.items` is `undefined` for one — so this branch resolved
      // every authored static table to `[]` while `DashboardRenderer`'s mirror
      // of it read the array all along (objectui#4618).
      const staticRows = Array.isArray(widgetData) ? widgetData : widgetData?.items || [];
      return {
        type: 'data-table',
        ...options,
        data: staticRows,
        // See DashboardRenderer: `columns` is required, and an author who
        // declared none got a table of empty rows. Explicit columns win.
        columns: Array.isArray(options.columns) && options.columns.length > 0
          ? options.columns
          : deriveStaticTableColumns(staticRows),
        searchable: false,
        pagination: false,
        className: "border-0"
      };
    }

    if (dispatch.family === 'pivot') {
      const widgetData = (widget as any).data || options.data;

      // provider: 'object' — RETIRED, with the same placeholder object
      // `DashboardRenderer`'s pivot arm returns (objectui#10528). A pivot is a
      // cross-tab, and ADR-0021 puts cross-tabs on the dataset layer only: the
      // shared dispatch types this family "dataset-bound only; a non-dataset
      // pivot is stale metadata" (`widgetDispatch.ts`). This branch used to emit
      // a static `pivot` node with `data: []` and an `objectName` that
      // `PivotTable` never reads, so the tile drew an empty cross-tab and sent
      // no query, while the read dashboard showed this placeholder for the same
      // widget. Mapping it to the self-fetching `object-pivot` instead would
      // have revived the removed inline analytics shape in the editor alone.
      // A dataset-bound pivot still renders through `DatasetWidget` (the fork
      // at the render site below), and the static-data pivot under this branch
      // is unchanged.
      if (isObjectProvider(widgetData)) return LEGACY_RETIRED_WIDGET_SCHEMA;

      // The declared node type, `PivotTableSchema` (objectui#11466). It used to
      // spread `options` whole, which named no declared type: the required
      // `rowField` / `columnField` / `valueField` were not stated, so the node
      // reached `SchemaRenderer` only through a cast. The node now states each
      // key `PivotTable` draws (its `PivotTableSchema` keys, and `className`),
      // read from `options`; no other option key rides along.
      return {
        type: 'pivot',
        title: options.title,
        rowField: options.rowField,
        columnField: options.columnField,
        valueField: options.valueField,
        aggregation: options.aggregation,
        showRowTotals: options.showRowTotals,
        showColumnTotals: options.showColumnTotals,
        format: options.format,
        columnColors: options.columnColors,
        className: options.className,
        data: Array.isArray(widgetData) ? widgetData : widgetData?.items || [],
      } satisfies PivotTableSchema;
    }

    if (dispatch.family === 'unsupported') {
      return unsupportedWidgetSchema(widgetType);
    }

    // An entry here names no family and is no component node (the passthrough
    // above took those): stale metadata, drawn as the labelled placeholder, as
    // `DashboardRenderer` draws it.
    return unsupportedWidgetSchema(widgetType);
  }, [resolveSeriesLabel]);

  return (
    <div ref={containerRef} className={cn("w-full", className)} data-testid="grid-layout">
      {hasDndProvider && <DndEditModeBridge editMode={editMode} />}
      <div className="mb-4 flex items-center justify-between">
        {/*
          `schema.label` accepts the spec's INLINE locale map since objectui#4580's
          revised Q1-A ruling, and rendering the map straight into this text node
          THREW "Objects are not valid as a React child (found: object with keys
          {en, zh-CN})". Resolved with `pickLocalized` against the ACTIVE UI
          LANGUAGE, matching the widget-title resolution ~70 lines below rather
          than introducing a second resolver and a second locale channel into one
          component: `pickLocalized` is objectui's limb-for-limb twin of the spec's
          `resolveI18nLabel` (objectstack#6765), differing only in how it spells a
          miss (`''` vs `undefined`) — pinned in
          `plugin-list/src/__tests__/i18nLabel-resolver-parity.test.ts`. A miss
          yields `''`, which is falsy, so `'Dashboard'` still backstops it.

          `schema.label` is the ONLY header source. A legacy root `title` used
          to be read ahead of it; that arm RETIRED under ADR-0049
          (objectui#7509, maintainer ruling 2026-09-04) together with the four
          sibling root arms in `DashboardView`, `DashboardRenderer`,
          `DashboardEditor` and `DashboardDesignPage` — @objectstack/spec's
          `DashboardSchema` refuses root `title` BY NAME
          (`unrecognized_keys(title)`) and requires `label`, so what retired is
          legacy-document compatibility, not an authoring surface.

          ⛔ NOT the widget arm: `widget.title` is `DashboardWidget.title`, the
          spec's `I18nLabel` — a different DECLARED key, read ~100 lines below
          and untouched. The two are told apart by RECEIVER; this one's receiver
          is the dashboard ROOT.
        */}
        <h2 className="text-2xl font-bold">
          {pickLocalized(schema.label, language) || 'Dashboard'}
        </h2>
        <div className="flex gap-2">
          {editMode ? (
            <>
              <Button onClick={handleSaveLayout} size="sm" variant="default">
                <Save className="h-4 w-4 mr-2" />
                Save Layout
              </Button>
              <Button onClick={handleResetLayout} size="sm" variant="outline">
                <X className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button onClick={() => setEditMode(false)} size="sm" variant="ghost">
                Cancel
              </Button>
            </>
          ) : (
            <>
              {onRefresh && (
                <Button
                  onClick={handleRefresh}
                  size="sm"
                  variant="outline"
                  disabled={refreshing}
                  aria-label={tt('dashboard.refreshDashboard', 'Refresh dashboard')}
                >
                  <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
                  {refreshing ? tt('dashboard.refreshing', 'Refreshing…') : tt('dashboard.refreshAll', 'Refresh All')}
                </Button>
              )}
              <Button onClick={() => setEditMode(true)} size="sm" variant="outline">
                <Edit className="h-4 w-4 mr-2" />
                Edit Layout
              </Button>
            </>
          )}
        </div>
      </div>

      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
          rowHeight={60}
          dragConfig={{ enabled: editMode, handle: ".drag-handle" }}
          resizeConfig={{ enabled: editMode }}
          onLayoutChange={handleLayoutChange}
        >
          {/* The slot's element type, for the reason `widgetsSignature` states
              (objectui#11514). `title` below is declared on both arms: the
              widget's spec row, and the card's heading on the component arm. */}
          {schema.widgets?.map((widget: DashboardWidgetSlotEntry, index: number) => {
            const widgetId = widget.id || `widget-${index}`;
            // `getComponentSchema` returns `SchemaRenderer`'s own prop type,
            // and every branch builds a declared node (objectui#11466): the
            // metric card as `plugin-dashboard:metric`, which
            // `CustomNodeRegistry` declares, and the static pivot as
            // `PivotTableSchema`. So both render sites below take it as it is.
            const componentSchema = getComponentSchema(widget);
            // ADR-0021 — a widget bound to a semantic-layer dataset renders
            // through the governed queryDataset path (DatasetWidget) instead of
            // the inline object-aggregate schema. Decided per widget AT THE
            // RENDER SITE, which is `DashboardRenderer`'s own mechanic rather
            // than a second dispatch idiom invented here: this surface had NO
            // dataset path at all, so every current-shape widget fell through
            // `getComponentSchema` to the static-data branch and drew
            // `data: []` — a blank chart, an em-dash metric or an empty table
            // depending on the family, with no diagnostic (objectui#4614).
            //
            // `dataset` is a widget key, read on the widget arm alone
            // (objectui#11598, N2 A), as `DashboardRenderer` reads it: a
            // component node in the slot (a `metric-card`) draws itself,
            // whatever else it carries. The read used to be a cast naming the
            // one key, so a `metric-card` the strict face refuses for its
            // `dataset` drew `DatasetWidget` in the card's place.
            //
            // Position relative to the objectui#4612 legacy sentinel (which
            // stays where it is, inside `getComponentSchema` BEFORE the dispatch
            // branches): the two conditions are MUTUALLY EXCLUSIVE by
            // construction, because `isLegacyRetiredWidget` returns false the
            // moment a widget carries `dataset` (its step 1). Neither can capture
            // the other's widget, so their relative order cannot change a verdict
            // on either surface — the same arrangement `DashboardRenderer` has
            // carried since #4612, and the reason that module states step 1 on
            // its own terms instead of inheriting it from a caller's fork.
            const datasetWidget = !isSlotComponentEntry(widget) && widget.dataset ? widget : undefined;
            const datasetBound = datasetWidget !== undefined;
            // A `metric` widget renders its own card chrome ONLY in the inline
            // path (the `plugin-dashboard:metric` card, or a retired
            // `provider: 'object'` metric's placeholder, objectui#11525). A
            // dataset-bound metric uses DatasetWidget, which renders just
            // the value — so it must take the shared Card wrapper to get a title
            // and border like its neighbours, instead of showing as bare text
            // (`DashboardRenderer`'s `isSelfContained`, same rule, same reason).
            const isSelfContained = resolveWidgetType(widget) === 'metric' && !datasetBound;
            // objectui#12573 — a dataset-bound METRIC tile draws no card
            // header, as on `DashboardRenderer` (objectui#12528): the header
            // (title) over the tile (value, then the measure label) stacked
            // three lines for one number. The surface hands `DatasetWidget` a
            // `heading` instead, and `DatasetWidget` draws the title and the
            // measure label on one line above the value — the one derivation
            // of that line for both surfaces. In edit mode the drag handle the
            // header carried sits over the tile's top-right corner.
            const datasetMetric = datasetBound && resolveWidgetType(widget) === 'metric';
            // `DashboardWidget.title` is the spec's `I18nLabel`: since
            // 17.0.0-rc.6 an author may inline a per-locale map
            // (`{ en: 'Pipeline', 'zh-CN': '销售漏斗' }`) instead of a string.
            // Resolve it for the active UI language before it reaches the
            // `title` attribute (a `string` slot) and the card heading (a text
            // node) — both of which stringify a map to `[object Object]`.
            const widgetTitle = pickLocalized(widget.title, language);

            return (
              <div key={widgetId} className="h-full">
                {isSelfContained ? (
                  <div className="h-full w-full relative">
                    {editMode && (
                      <div className="drag-handle absolute top-2 right-2 z-10 cursor-move p-1 bg-background/80 rounded border border-border">
                        <GripVertical className="h-4 w-4" />
                      </div>
                    )}
                    <SchemaRenderer schema={componentSchema} className="h-full w-full" />
                  </div>
                ) : (
                  <Card className={cn(
                    "h-full overflow-hidden border-border/50 shadow-sm transition-all",
                    "bg-card/50 backdrop-blur-sm",
                    editMode && "ring-2 ring-primary/20",
                    datasetMetric && "relative"
                  )}>
                    {datasetMetric && editMode && (
                      <div className="drag-handle absolute top-2 right-2 z-10 cursor-move p-1 bg-background/80 rounded border border-border">
                        <GripVertical className="h-4 w-4" />
                      </div>
                    )}
                    {widgetTitle && !datasetMetric && (
                      <CardHeader className="pb-2 border-b border-border/40 bg-muted/20 flex flex-row items-center justify-between">
                        <CardTitle className="text-base font-medium tracking-tight truncate" title={widgetTitle}>
                          {widgetTitle}
                        </CardTitle>
                        {editMode && (
                          <div className="drag-handle cursor-move p-1 hover:bg-muted/40 rounded">
                            <GripVertical className="h-4 w-4" />
                          </div>
                        )}
                      </CardHeader>
                    )}
                    <CardContent className="p-0 h-full">
                      <div className={cn("h-full w-full overflow-auto p-4", datasetMetric && editMode && "pr-10")}>
                        {/*
                          The fork itself, mirroring `DashboardRenderer`'s.
                          The widget arm is passed whole: DatasetWidget reads
                          `widget.filter` and forwards it to the query as
                          `runtimeFilter`, so an authored per-widget filter still
                          applies. The sibling copies it as its `datasetWidget`
                          only to merge in the dashboard FILTER BAR's scoped filter,
                          which this surface does not have — there is no
                          `scopedFilter` here to merge, so re-creating the wrapper
                          would state a dependency that does not exist.

                          This is the ONLY fork: the self-contained branch above
                          cannot be reached by a dataset-bound widget, since
                          `isSelfContained` now requires `!datasetBound`.
                        */}
                        {datasetWidget
                          ? <DatasetWidget
                              widget={datasetWidget}
                              dataSource={dataSource}
                              heading={datasetMetric
                                ? {
                                    title: widgetTitle,
                                    description: pickLocalized(datasetWidget.description, language) || undefined,
                                  }
                                : undefined}
                            />
                          : <SchemaRenderer schema={componentSchema} />}
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            );
          })}
        </ResponsiveGridLayout>
      )}
    </div>
  );
};
