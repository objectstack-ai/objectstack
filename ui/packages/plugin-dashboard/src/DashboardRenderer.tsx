/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import type { BaseSchema, DashboardComponentSchema, DataSource, ObjectChartSchema, ObjectDataTableSchema } from '@object-ui/types';
import { SchemaRenderer, useActionEngine, useObjectLabel, PageVariablesProvider, usePageVariables, useResolvedDataSource, type SchemaRendererProps } from '@object-ui/react';
import { useObjectTranslation, useSafeTranslate, pickLocalized, useDisplayLocale } from '@object-ui/i18n';
import type { ActionDef, ActionResult, ActionContext, ModalHandler, SduiDomPassThroughKey } from '@object-ui/core';
import {
  resolveDashboardFilterDefs,
  dashboardFilterVariableDefs,
  buildWidgetScopedFilter,
  mergeFilters,
  toDomProps,
  chartCategoryKey,
  chartMeasureKey,
  chartConfigPresentation,
} from '@object-ui/core';
import { cn, Card, CardHeader, CardTitle, CardContent, Button, getLazyIcon } from '@object-ui/components';
import { forwardRef, useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo, Fragment } from 'react';
import type { HTMLAttributes } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { isObjectProvider, deriveStaticTableColumns, composeSeriesLabel } from './utils';
import { classifyWidgetType, METRIC_LIKE_TYPES, DASHBOARD_NODE_TYPES, toDashboardNodeType, resolveWidgetType, isSlotComponentEntry, unsupportedWidgetSchema, entryComponent, withoutRetiredSubCaption, type DashboardWidgetSlotEntry } from './widgetDispatch';
import { LEGACY_RETIRED_WIDGET_SCHEMA, isLegacyRetiredWidget, isRetiredEnvelopeNode } from './legacyRetiredWidget';
import { DatasetWidget } from './DatasetWidget';
import type { DashboardChartRenderSchema } from './chartRenderHandoff';
import { useDashboardAutoRefresh, type DashboardAutoRefresh } from './useDashboardAutoRefresh';
import { DashboardFilterBar } from './DashboardFilterBar';

/**
 * One `header.actions[]` entry, as the node's declaration types it: the spec's
 * `DashboardHeaderAction` by reference since objectui#7759, so `label` is an
 * `I18nLabel` and `actionUrl` is required. Named for the node, not the spec
 * type, because it is read off `DashboardComponentSchema` and a local alias may
 * not wear a spec export's name (`check:spec-symbols`).
 */
type DashboardNodeHeaderAction = NonNullable<NonNullable<DashboardComponentSchema['header']>['actions']>[number];

interface SortableWidgetWrapperProps {
  id: string;
  disabled?: boolean;
  gridSpan?: { w: number; h: number };
  className?: string;
  children: React.ReactNode;
}

function SortableWidgetWrapper({ id, disabled, gridSpan, className, children }: SortableWidgetWrapperProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver } = useSortable({
    id,
    disabled,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    ...(gridSpan ? { gridColumn: `span ${gridSpan.w}`, gridRow: `span ${gridSpan.h}` } : {}),
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'h-full w-full',
        className,
        !disabled && 'cursor-grab active:cursor-grabbing',
        isOver && !isDragging && 'ring-2 ring-primary ring-offset-2 rounded-lg'
      )}
      data-sortable-widget-id={id}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
}

/**
 * Resolve a Lucide icon by name (PascalCase or kebab-case).
 * Delegates to the shared lazy resolver so each icon ships as its own
 * micro-chunk instead of pulling in the full lucide-react namespace.
 */
function resolveLucideIcon(name?: string): React.ElementType | null {
  if (!name) return null;
  return getLazyIcon(name);
}

// Color palette for charts
const CHART_COLORS = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
];

/**
 * Chart-family vocabularies live in `./widgetDispatch`, shared with
 * `DashboardGridLayout` and asserted against `ChartTypeSchema` — the three
 * dashboard surfaces used to restate them independently and disagree (#2943).
 */

/**
 * Chart sub-types that have a meaningful drill-down interaction.
 * Mirrors WidgetConfigPanel.DRILL_DOWN_TYPES and the click-handler wiring
 * in plugin-charts/AdvancedChartImpl. Radar is excluded because a polar
 * polygon has no single clickable category point (the interaction would be
 * ambiguous); every cartesian / part-to-whole / flow family is covered.
 */
const DRILLABLE_CHART_TYPES = new Set([
  'bar', 'horizontal-bar', 'line', 'area', 'pie', 'donut', 'funnel',
  'scatter', 'treemap', 'sankey',
]);

/**
 * Default-on policy for charts: object-backed widgets get drill-down
 * enabled by default when the chart type supports it. Authors can
 * disable explicitly with `drillDown: { enabled: false }`.
 */
function defaultChartDrill(chartType: string): { enabled: true } | undefined {
  return DRILLABLE_CHART_TYPES.has(chartType) ? { enabled: true } : undefined;
}

/**
 * Object-backed child schema types whose `filter` reaches the data source —
 * the injection surface for dashboard-level filters. Static-data widgets
 * (`chart`, `data-table` with inline `data`) have no query to scope and are
 * intentionally not filtered.
 */
type FilterableComponentType = 'object-chart' | 'object-data-table';
const FILTERABLE_COMPONENT_TYPES: ReadonlySet<string> = new Set<FilterableComponentType>([
  'object-chart',
  'object-data-table',
]);

/**
 * A child node of one of the {@link FILTERABLE_COMPONENT_TYPES}, as
 * `getComponentSchema` hands it to `SchemaRenderer` — typed by the node schema
 * that DECLARES its `filter` (objectui#11348), so the filter broadcast reads
 * that key where it is declared instead of off `BaseSchema`, which declares no
 * `filter` and only reached it through its index signature.
 *
 * Both are the `@object-ui/types` node schemas, by reference, each declaring
 * `filter`. The broadcast covers the `object-chart` and `object-data-table`
 * nodes this renderer builds for a `provider: 'object'` series or table
 * widget. It no longer covers a node an author placed in a widget's legacy
 * `component` envelope: since objectui#12254 that envelope draws a
 * `metric-card` and nothing else, and any other node in it draws the
 * retired-format placeholder (`isRetiredEnvelopeNode`).
 *
 * `object-metric` LEFT the set under objectui#11466 (the maintainer's ruling A,
 * extending ruling C on objectui#11525). objectui#11525 had kept it for one
 * input, an `object-metric` node in that envelope, after this renderer stopped
 * building one; it wrote a flat `filter` that the declared `object-metric`
 * node (the spec's `properties` bag) refuses by name. That envelope node drew
 * the retired-format placeholder from then on, so no `object-metric` node
 * reaches the merge.
 *
 * The value is not host state: the renderer wrote it from the widget's own
 * spec-declared `filter` (or the provider's), and the dashboard's filter-bar
 * values arrive separately, as the `scopedFilter` merged into it.
 */
type FilterableComponentSchema = ObjectChartSchema | ObjectDataTableSchema;

/** Narrows a child node to {@link FilterableComponentSchema} by its `type`. */
function isFilterableComponentSchema(cs: BaseSchema): cs is FilterableComponentSchema {
  return FILTERABLE_COMPONENT_TYPES.has(cs.type);
}

/*
 * The retired-widget placeholder and its detector used to be declared right
 * here, private to this file — and that is the whole reason objectui#4612
 * existed: the sibling surface `DashboardGridLayout` could not consume what it
 * could not see, so the graceful fallback covered one of the two surfaces and
 * the other rendered a silent blank chart for the identical stored metadata.
 * Both now import the single declaration from `./legacyRetiredWidget`; the
 * behaviour on this surface is unchanged (pinned by
 * `__tests__/DashboardRenderer.legacyRetired.test.tsx`).
 */

/**
 * The dashboard renderer's props.
 *
 * ## Why there is no `[key: string]: any` here (objectui#4528)
 *
 * There used to be one, and it erased this entire interface. A string index
 * signature puts `string` into `keyof Props`, so `'ref' extends keyof Props` is
 * always true and React's `PropsWithoutRef` takes its `Omit` branch —  and
 * `Omit` over a type carrying a string index signature keeps ONLY the index
 * signature. Every declared property above was dropped from the resolved type:
 * `keyof React.ComponentProps< typeof DashboardRenderer >` measured as
 * `string | number`, and `onWidgetClick` measured as `any` at every JSX call
 * site, while this interface went on declaring
 * `(widgetId: string | null) => void`. The declaration was right and no
 * consumer was held to it — a prop typo or a wrong-arity handler type-checked.
 *
 * The same trap, in `packages/components`, is objectui#4422 / PR #4438; this is
 * the sweep of the two packages that issue left unswept.
 *
 * ## How the DOM pass-through survives without it
 *
 * `SchemaRenderer` hands this component the authored node's own keys, so the
 * render function still collects an open rest object — but what may reach the
 * element is decided by `toDomProps`' WHITELIST (objectui#4432), not by this
 * type. The keys that whitelist forwards are therefore declared here BY NAME,
 * derived from the whitelist constant itself so the two cannot drift, which is
 * exactly what `@object-ui/core`'s `dom-props` doctrine asks for: "Deliberate
 * DOM pass-through beyond this set stays available the objectui#4435 way —
 * DECLARE it and forward it by name. Do not reopen the spread."
 */
export interface DashboardRendererProps
  extends Pick<HTMLAttributes<HTMLDivElement>, SduiDomPassThroughKey> {
  schema: DashboardComponentSchema;
  className?: string;
  /**
   * Data-source adapter for the widgets this dashboard renders.
   *
   * Destructured by the render function and handed to `DatasetWidget` /
   * `SchemaRenderer`, and passed by both in-repo hosts (`DashboardView`,
   * `DashboardPreview`) — but never declared until objectui#4528, because the
   * index signature above was answering for it. Typed `any` deliberately: that
   * is precisely what it resolved to before, so declaring it changes what is
   * DECLARED without changing what any call site is held to. Narrowing it to a
   * real adapter type is a separate change with its own consumer sweep.
   *
   * Optional: when it is omitted, the adapter of the enclosing
   * `SchemaRendererProvider` is used, which is how a `dashboard` block held on
   * a page gets one (objectui#10815).
   */
  dataSource?: any;
  /** Callback invoked when dashboard refresh is triggered (manual or auto) */
  onRefresh?: () => void;
  /** Total record count to display */
  recordCount?: number;
  /** User actions configuration */
  userActions?: { sort?: boolean; search?: boolean; filter?: boolean };
  /** Enable design mode — shows selection affordances on widgets */
  designMode?: boolean;
  /** Currently selected widget ID (controlled) */
  selectedWidgetId?: string | null;
  /** Callback when a widget is clicked in design mode */
  onWidgetClick?: (widgetId: string | null) => void;
  /**
   * Callback when widgets are reordered via drag-and-drop in design mode.
   * Receives the next widgets array (with positions swapped). The parent
   * is expected to persist via its data adapter. When omitted, drag-and-
   * drop affordances are disabled even in design mode.
   *
   * Typed by the slot itself, `DashboardComponentSchema['widgets']`: the array
   * is `schema.widgets` reordered, so each entry is a widget or a component node
   * placed directly in the slot (objectui#11514; it read `DashboardWidgetSchema[]`
   * while the component arm was assignable to the widget arm).
   */
  onWidgetsReorder?: (widgets: DashboardComponentSchema['widgets']) => void;
  /** Optional handler for actionType="modal" header actions. Receives a schema and ActionContext. */
  modalHandler?: ModalHandler;
  /** Optional named handlers for actionType="script" header actions, keyed by action name (actionUrl). */
  scriptHandlers?: Record<string, (action: ActionDef, context: ActionContext) => Promise<ActionResult> | ActionResult>;
  /**
   * When true, suppress the built-in header title and description blocks.
   * Header actions (if any) are still rendered. Use this when the parent
   * page chrome (e.g. `DashboardView`) already renders the dashboard's
   * title/subtitle so we don't display them twice.
   */
  hideHeaderText?: boolean;
  /**
   * The host draws the "Refresh All" control, in its own chrome, and this is
   * how it learns what to draw (objectui#12554). Set it and the renderer draws
   * no refresh button of its own; leave it unset and the renderer draws one
   * whenever `onRefresh` is wired, exactly as before.
   *
   * The auto-refresh timer is untouched: it stays this renderer's, armed by
   * `onRefresh` and the authored `refreshIntervalSeconds`, so a host that
   * draws the button runs no timer of its own. What the renderer hands over is
   * the state of that one refresh implementation (`useDashboardAutoRefresh`):
   *
   * - `refreshing`, true while a run is in flight, manual or timed: spin the
   *   icon and disable the button on it, as the renderer's own control does;
   * - `handleRefresh`, the run the renderer's button calls: wire the host's
   *   button to it, so a click shows the same indicator and calls `onRefresh`.
   *
   * It is called on mount, again each time `refreshing` changes, and with
   * `null` when there is nothing to draw: no `onRefresh` is wired, or the
   * renderer unmounted. The renderer reads it through a ref, so a host may
   * pass a new function on every render (a `useState` setter is enough).
   *
   * The record-count badge (`recordCount`) is not part of the hand-over; it
   * stays where the renderer draws it. The console's dashboard page
   * (`DashboardView`) sets this, and draws the button among its page header's
   * actions.
   */
  onRefreshStateChange?: (state: DashboardAutoRefresh | null) => void;
  /**
   * The document arrives already translated for the active language: the host
   * read it from the server's `/meta` route, which resolves the packaged
   * catalog per request locale and keeps a published edit over it (an explicit
   * override beats the packaged default — `translateDashboard` in
   * `@objectstack/spec`). The console's dashboard page (`DashboardView`) sets
   * it.
   *
   * When true, the texts the server translated — the dashboard `label` and
   * `description`, and each widget's `title` and `description` — are drawn as
   * given: an inline per-locale map is
   * still collapsed to the active language, but no client bundle lookup runs
   * over them. A second pass over a served value is what let the packaged
   * catalog win again, client-side, over a published edit (objectui#11295).
   *
   * Leave it unset for a document the server never translated — an inline
   * block, a preview, a design surface: the client bundle is then its one
   * translation pass, exactly as before. Header-action labels keep their bundle
   * lookup either way: the server does not translate them.
   */
  localized?: boolean;
}

const DashboardRendererInner = forwardRef<HTMLDivElement, DashboardRendererProps>(
  ({ schema, className, dataSource: dataSourceProp, onRefresh, recordCount, userActions, designMode, selectedWidgetId, onWidgetClick, onWidgetsReorder, modalHandler, scriptHandlers, hideHeaderText, onRefreshStateChange, localized, ...props }: DashboardRendererProps & { [key: string]: any }, ref) => {
    // objectui#10815 — the adapter every child of this dashboard reads, resolved
    // ONCE here the way the page-embeddable blocks of the family resolve theirs
    // (`useResolvedDataSource`, the `object-grid` / `object-form` /
    // `detail-view` rule): an explicit `dataSource` prop first, the
    // `SchemaRendererProvider` context second.
    //
    // A page holds its blocks through `SchemaRenderer`, which strips the node's
    // `dataSource` key (the spec's element BINDING, objectstack#5576) and
    // injects no adapter prop. Reading the prop alone, a `dashboard` block on a
    // page handed `undefined` to every dataset widget, which painted "This data
    // source does not support dataset queries." beside a page that held a
    // capable adapter. Resolved here rather than per widget so the widgets, the
    // filter bar's `optionsFrom` read and the drill drawers all see the same
    // source. A host that binds no capable adapter anywhere still gets
    // `DatasetWidget`'s visible alert: that state is deliberate and unchanged.
    const dataSource = useResolvedDataSource<DataSource>(dataSourceProp);
    // Auto-infer the grid column count when the dashboard schema doesn't
    // specify one. Spec convention is a 12-column grid (widgets use w: 3 for
    // quarter-row KPIs, w: 6 for half-row charts, etc.). If we always default
    // to 4 columns, a widget with `w: 3` claims 75% of a row and KPI rows
    // collapse into a vertical stack. Expand to fit the largest widget span.
    const inferredColumns = (() => {
      if (schema.columns != null) return schema.columns;
      // Typed by the slot's element type, the type `renderWidget` below takes
      // (objectui#11514). Both arms of the `widgets[]` union declare `layout` as
      // the spec's `DashboardWidget` member — the component arm
      // (`DashboardWidgetSlotComponentSchema`) by reference since objectui#11070
      // round 11 — so `layout` reads with the spec's type off either arm.
      const widgets: DashboardWidgetSlotEntry[] = schema.widgets ?? [];
      let maxSpan = 0;
      for (const w of widgets) {
        const span = (w.layout?.x ?? 0) + (w.layout?.w ?? 0);
        if (span > maxSpan) maxSpan = span;
        if ((w.layout?.w ?? 0) > maxSpan) maxSpan = w.layout!.w;
      }
      if (maxSpan > 4) return 12;
      return 4;
    })();
    const columns = inferredColumns;
    const gap = schema.gap || 4;
    // Positioned (explicit-columns) grid vs responsive auto-flow grid.
    // Defined here (not just above desktopBody) so renderWidget can give
    // layout-less widgets a sensible default span in the positioned grid.
    const hasExplicitColumns = schema.columns != null || inferredColumns !== 4;
    const [isMobile, setIsMobile] = useState(false);

    // Dashboard-level filters (framework#2501). Filter values live as
    // dashboard variables — the outer DashboardRenderer mounts a
    // PageVariablesProvider when the schema declares filters, so
    // usePageVariables() resolves them here (and gracefully no-ops when the
    // dashboard has no filters and no provider is mounted).
    const filterDefs = useMemo(
      () => resolveDashboardFilterDefs(schema),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [schema.globalFilters, schema.dateRange]
    );
    const { variables: filterValues, setVariable: setFilterValue, resetVariables: resetFilterValues } = usePageVariables();

    // ── i18n: convention-based label resolution for dashboard / widget /
    // action text. The dashboard name (`schema.name`) keys all lookups; when
    // it's missing we silently degrade to the raw English fallbacks.
    const { dashboardLabel, dashboardDescription, dashboardActionLabel, widgetTitle, widgetDescription, fieldLabel } = useObjectLabel();
    const { t, language } = useObjectTranslation();
    // The refresh button's copy is three pack keys (`dashboard.refreshAll`,
    // `dashboard.refreshDashboard`, `dashboard.refreshing`), the same three
    // `DashboardGridLayout` reads, each through `tt` like the package's other one-off labels.
    const tt = useSafeTranslate();
    // The record-count badge is a number face; it groups in the display locale,
    // not the MACHINE's (objectui#9909).
    const displayLocale = useDisplayLocale();

    /**
     * Collapse an authored `I18nLabel` to the active UI language.
     *
     * This replaces a private `resolveLabel` copy that read the RETIRED
     * `{ key, defaultValue }` key-reference form (objectstack#5055) and ended
     * `return label.defaultValue || label.key`. Handed the vocabulary the spec
     * actually admits today — an inline per-locale map — that copy answered
     * `undefined`, so the metric dispatch's `|| widgetType` fallback took over
     * and KPI cards rendered the literal string `"metric"` (objectui#4032).
     *
     * `pickLocalized` is the seam #4208 already landed for this vocabulary on
     * the sibling surface (`DashboardGridLayout`), pinned limb-for-limb against
     * the spec's own `resolveI18nLabel`. Reused rather than re-implemented: a
     * fourth dialect is what objectstack#4115 exists to prevent.
     */
    const resolveLabel = useCallback(
      (label: unknown): string | undefined => {
        if (label === undefined || label === null) return undefined;
        return pickLocalized(label, language) || undefined;
      },
      [language],
    );
    /**
     * Resolve a chart series label. The three-arm decision itself
     * (`composeSeriesLabel`, `./utils`) is shared with `DashboardGridLayout` —
     * see that function's docblock (objectui#9055 fixed arms 2/3 here,
     * objectui#9172 gave the sibling relay this same authority instead of a
     * second copy). This `useCallback` only binds it to THIS component's own
     * `t` / `fieldLabel` instances so its identity still tracks them.
     *
     * It stays distinct from `humanizeLabel`, the VALUE prefixer in
     * `@object-ui/core` — `utils/humanize-label.ts`'s docblock carries the
     * per-input difference table and rules that converging the two "is a
     * decision, not a refactor … it needs its own card".
     */
    const resolveSeriesLabel = useCallback(
      (objectName: string | undefined, yField: string, aggFn: string | undefined) =>
        composeSeriesLabel(t, fieldLabel, objectName, yField, aggFn),
      [t, fieldLabel],
    );
    const dashName = (schema as any).name as string | undefined;

    /**
     * Translate a header-action label using the
     * `{ns}.dashboards.{dashName}.actions.{actionKey}.label` convention.
     * Falls back to the action's authored label when no translation exists or
     * the dashboard schema has no `name`.
     *
     * The authored label is the spec's `I18nLabel` — a string or an inline
     * per-locale map — so it is collapsed to the active language BEFORE it is
     * used as the fallback or the button text (objectui#7759). This read used
     * to return the authored value as-is, typed `string` by a hand-written
     * restatement of `header`, and a map reached React as a button child.
     *
     * It runs for a `localized` document too (objectui#11295): the server's
     * `translateDashboard` does not translate header actions, so this lookup is
     * their only translation pass, not a second one.
     */
    const tActionLabel = useCallback(
      (action: DashboardNodeHeaderAction): string => {
        const authored = pickLocalized(action.label, language) || '';
        if (!dashName) return authored;
        const key = action.actionUrl || authored;
        return dashboardActionLabel(dashName, key, authored);
      },
      [dashName, dashboardActionLabel, language],
    );

    // Build ActionDef[] from header actions so useActionEngine can dispatch by
    // name. `ActionDef.label` is a `string`, so the def carries the label
    // resolved against the active language, exactly as the button shows it.
    // Keyed on `language`, not on a memoised resolver's identity (AGENTS.md #10).
    //
    // `type` is the ONE reading of an omitted `actionType`: `url`, as the
    // contract door reads it (objectui#12275). The click dispatches this def,
    // so it never re-reads the authored `actionType`.
    const headerActionDefs = useMemo<ActionDef[]>(() => {
      const actions = schema.header?.actions ?? [];
      return actions.map((a) => {
        const label = pickLocalized(a.label, language) || undefined;
        const type = (a.actionType as ActionDef['type']) || 'url';
        return {
          name: a.actionUrl || label,
          type,
          target: a.actionUrl,
          label,
          // Following a link is not a feedback-worthy action, so a `url` header
          // action raises no success toast, as it raised none before it went
          // through the runner (the html-tier anchor suppresses it the same
          // way). The error toast stays: a refused target is reported.
          ...(type === 'url' ? { toast: { showOnSuccess: false } } : {}),
        };
      });
    }, [schema.header?.actions, language]);

    const { executeAction, engine } = useActionEngine({ actions: headerActionDefs });

    /**
     * Translate a widget title / description using the
     * `{ns}.dashboards.{dashName}.widgets.{widgetId}.title|description`
     * convention. Falls back to the metadata-supplied string.
     *
     * The two channels compose in a fixed order, the same one
     * `useActionTextLocalizer` (objectui#4265) applies to declared actions: the
     * authored value is collapsed to the active language FIRST, and the plain
     * string that falls out is what the bundle receives as its fallback. So a
     * per-locale literal and a bundle entry can never disagree about what "the
     * authored title" is, and a bundle entry always wins over an inline map.
     *
     * That composition is for a document the server did NOT translate. A
     * `localized` document (objectui#11295) already carries the server's
     * answer, so only the inline-map collapse runs and the bundle is not
     * consulted: offered a served value as its fallback, the bundle would win
     * it, and a published edit would draw as the packaged string again.
     */
    const tWidgetTitle = useCallback(
      (widget: DashboardWidgetSlotEntry): string | undefined => {
        const fallback = resolveLabel(widget.title);
        if (localized || !dashName || !widget.id || fallback === undefined) return fallback;
        return widgetTitle(dashName, widget.id, fallback);
      },
      [localized, dashName, widgetTitle, resolveLabel],
    );

    const tWidgetDescription = useCallback(
      (widget: DashboardWidgetSlotEntry): string | undefined => {
        const fallback = resolveLabel(widget.description);
        if (localized || !dashName || !widget.id) return fallback;
        return widgetDescription(dashName, widget.id, fallback);
      },
      [localized, dashName, widgetDescription, resolveLabel],
    );

    // Install host-supplied modal/script handlers on the underlying ActionRunner.
    useEffect(() => {
      const runner = engine.getRunner();
      if (modalHandler) runner.setModalHandler(modalHandler);
      if (scriptHandlers) {
        for (const [name, fn] of Object.entries(scriptHandlers)) {
          runner.registerScript(name, fn as any);
        }
      }
    }, [engine, modalHandler, scriptHandlers]);

    useEffect(() => {
      const checkMobile = () => setIsMobile(window.innerWidth < 768);
      checkMobile();
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }, []);

    // The refresh indicator, the manual handler and the auto-refresh timer come
    // from the one implementation this component shares with
    // `DashboardGridLayout` (objectui#8820), which is also the only place
    // `refreshIntervalSeconds` is read.
    const { refreshing, handleRefresh } = useDashboardAutoRefresh(schema, onRefresh);

    // A host that draws the refresh control itself (`onRefreshStateChange`,
    // objectui#12554) is handed that same state; the timer above stays the one
    // timer. The reports are keyed on VALUES only: whether the host takes the
    // control, whether a handler is wired, and the indicator. The host's
    // callback and the hook's `handleRefresh` are read through refs, so a new
    // identity of either (an inline host arrow, a memo React discards) neither
    // re-reports nor loops a host that stores the report in state (AGENTS.md
    // #10). Layout effects, so a host's header draws the button in the same
    // paint as the dashboard, not one frame later.
    const hostDrawsRefresh = Boolean(onRefreshStateChange);
    const refreshWired = Boolean(onRefresh);
    const onRefreshStateChangeRef = useRef(onRefreshStateChange);
    const handleRefreshRef = useRef(handleRefresh);
    useLayoutEffect(() => {
      onRefreshStateChangeRef.current = onRefreshStateChange;
      handleRefreshRef.current = handleRefresh;
    });
    useLayoutEffect(() => {
      if (!hostDrawsRefresh) return;
      onRefreshStateChangeRef.current?.(
        refreshWired ? { refreshing, handleRefresh: () => handleRefreshRef.current() } : null,
      );
    }, [hostDrawsRefresh, refreshWired, refreshing]);
    // On unmount the host is told there is nothing left to draw, so it does not
    // keep a button wired to a dashboard that is gone.
    useLayoutEffect(() => () => onRefreshStateChangeRef.current?.(null), []);

    const handleWidgetClick = useCallback((e: React.MouseEvent, widgetId: string | undefined) => {
      if (!designMode || !onWidgetClick || !widgetId) return;
      e.stopPropagation();
      onWidgetClick(widgetId);
    }, [designMode, onWidgetClick]);

    const handleWidgetKeyDown = useCallback((e: React.KeyboardEvent, widgetId: string | undefined, index: number) => {
      if (!designMode || !onWidgetClick) return;
      const widgets = schema.widgets || [];
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onWidgetClick(widgetId ?? null);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = index + 1 < widgets.length ? widgets[index + 1] : null;
        if (next?.id) onWidgetClick(next.id);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = index - 1 >= 0 ? widgets[index - 1] : null;
        if (prev?.id) onWidgetClick(prev.id);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onWidgetClick(null);
      }
    }, [designMode, onWidgetClick, schema.widgets]);

    const handleBackgroundClick = useCallback((e: React.MouseEvent) => {
      if (!designMode || !onWidgetClick) return;
      if (e.target === e.currentTarget) {
        onWidgetClick(null);
      }
    }, [designMode, onWidgetClick]);

    /**
     * The click channel of the host element, with ONE carrier (objectui#4432).
     *
     * `onClick` is a declared DOM pass-through key of the SDUI widget contract,
     * and this container also computes its own background handler — so both
     * have a legitimate claim on the same prop. The old trailing `{...props}`
     * spread resolved that by letting the incoming handler REPLACE
     * `handleBackgroundClick` outright, which silently switched design-mode
     * background deselection off for any host that passed one. Dropping the
     * incoming handler instead would be the mirror failure: a whitelisted key
     * that type-checks, reads as supported, and never arrives.
     *
     * Both run, container affordance first. A non-function `onClick` (an
     * authored JSON string — SDUI spells click behaviour `events: { onClick }`,
     * which is DATA and is dropped by the whitelist) is ignored rather than
     * handed to React, which would throw on it.
     *
     * Deliberately NOT wrapped in `useCallback`: it closes over `props.onClick`
     * read out of the rest object, which the React Compiler cannot prove stable,
     * so a manual memo here is one it reports as unpreservable
     * (`Compilation Skipped: Existing memoization could not be preserved`) and
     * then declines to optimize the component around. It lands on a plain
     * element with no memoized child, so identity churn costs nothing.
     */
    const handleHostClick = (e: React.MouseEvent<HTMLDivElement>) => {
      handleBackgroundClick(e);
      if (typeof props.onClick === 'function') props.onClick(e);
    };

    // --- Drag-and-drop reordering (design mode only) ---------------------
    // Powered by @dnd-kit. Because each widget renders with
    // `gridColumn: span W` (no explicit x/y), array order *is* visual order,
    // so `arrayMove` on the widgets array yields an intuitive insertion-based
    // reorder (drop between widgets, not just swap).
    const dragEnabled = !!(designMode && onWidgetsReorder);

    const sensors = useSensors(
      useSensor(PointerSensor, {
        // Require a small drag distance so click-to-select still works.
        activationConstraint: { distance: 5 },
      })
    );

    const handleSortableDragEnd = useCallback(
      (event: DragEndEvent) => {
        if (!dragEnabled) return;
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const widgets = schema.widgets ?? [];
        const oldIndex = widgets.findIndex((w: DashboardWidgetSlotEntry) => w.id === active.id);
        const newIndex = widgets.findIndex((w: DashboardWidgetSlotEntry) => w.id === over.id);
        if (oldIndex < 0 || newIndex < 0) return;
        onWidgetsReorder?.(arrayMove(widgets, oldIndex, newIndex));
      },
      [dragEnabled, schema.widgets, onWidgetsReorder]
    );

    const renderWidget = (widget: DashboardWidgetSlotEntry, index: number, forceMobileFullWidth?: boolean) => {
        // Clamp widget span to grid columns to prevent overflow. A widget
        // with NO layout (e.g. authored in the Studio designer, which omits
        // it) would otherwise get a single column in the positioned grid and
        // cram the whole dashboard into one row (charts squeezed to a few px).
        // Give layout-less widgets a sensible default span so they auto-flow
        // into a readable grid — KPIs quarter-width, charts/tables half-width —
        // matching the editable DashboardGridLayout's auto-placement. A KPI is
        // ONE row, the height `DashboardEditor`'s `addWidget` gives a new
        // widget: a row floors at 5rem and grows to the tile's content, so two
        // rows left the tile's lower half empty (objectui#12704). Only the
        // positioned grid needs this; the responsive flow layout sizes each
        // widget as one cell.
        // The type this entry draws as: the authored `type`, or the spec's
        // default (`metric`) when it names none (objectui#11514, Q2 A).
        const entryType = resolveWidgetType(widget);
        const isMetricSpan = entryType === 'metric' || METRIC_LIKE_TYPES.has(entryType || '');
        const fallbackSpan = hasExplicitColumns
          ? { w: Math.min(isMetricSpan ? 3 : 6, columns), h: isMetricSpan ? 1 : 4 }
          : undefined;
        const effectiveLayout = widget.layout ?? fallbackSpan;
        const clampedLayout = effectiveLayout
          ? { ...effectiveLayout, w: Math.min(effectiveLayout.w, columns) }
          : undefined;

        // The widget arm, or `undefined` for a component node in the slot (a
        // `metric-card`). Every widget key this function reads off the entry
        // is read off this, or off `widget` after the same narrowing
        // (objectui#11598, N2 A): the component arm declares none of them.
        const widgetArm = isSlotComponentEntry(widget) ? undefined : widget;

        // ADR-0021 — a widget bound to a semantic-layer dataset renders through
        // the governed queryDataset path (DatasetWidget) instead of the inline
        // object-aggregate schema. `dataset` flows onto the widget arm,
        // `DashboardWidgetSchema`, from `@objectstack/spec`'s `DashboardWidget`,
        // and is read there alone: a component node in the slot draws itself,
        // whatever else it carries. The fork used to ignore the entry's `type`
        // and draw `DatasetWidget` for a `dataset` on either arm, which
        // type-checked only through `BaseSchema`'s index signature and reached
        // only a `metric-card` the strict face refuses (objectui#11598).
        const datasetBound = !!widgetArm?.dataset;

        // Every branch returns a node `SchemaRenderer` takes, so the return type
        // is that prop's (objectui#11466): each node is checked against its
        // declared type where it is built, and the render sites take it with no
        // cast.
        const getComponentSchema = (): SchemaRendererProps['schema'] => {
            // The slot-component passthrough (the 2026-08-14 `metric-card` slot
            // ruling) serves the slot's component arm alone (objectui#11514,
            // Q2 A): the entry keeps its `type`, the node it becomes takes the
            // namespaced key (`toDashboardNodeType`, objectui#10859 batch 8).
            // It is decided FIRST and reads no widget key (objectui#11598,
            // N2 A), so below it `widget` is the widget arm and every widget
            // key is read off the arm that declares it. A card used to take
            // `options` spread over its own keys here, a second spelling of
            // its props the strict face refuses (objectui#11483).
            if (isSlotComponentEntry(widget)) return toDashboardNodeType({ ...widget });

            // The author-supplied node keeps its spelling; only a `metric` /
            // `metric-card` node key moves onto its namespaced registration
            // (`toDashboardNodeType`, objectui#10859 batch 8).
            const authoredComponent = entryComponent(widget);
            // The envelope draws a `metric-card` and nothing else
            // (objectui#12254, the draw matching objectui#12163's authoring
            // rule): any other node draws the rebind prompt, the object the
            // metric and pivot arms below return, and sends no query. One rule
            // for both surfaces, `isRetiredEnvelopeNode`.
            if (isRetiredEnvelopeNode(authoredComponent)) return LEGACY_RETIRED_WIDGET_SCHEMA;
            if (authoredComponent) return toDashboardNodeType(authoredComponent);

            // Handle Shorthand Registry Mappings
            const widgetType = entryType;
            const options = (widget.options || {}) as Record<string, any>;
            // Renderer-internal data sources only (ADR-0021): the inline
            // `options.data` / `widget.data` array, or the `provider: 'object'`
            // async config (which carries its OWN nested `object`/`aggregate`).
            // The pre-ADR-0021 top-level analytics keys (`object`, `categoryField`,
            // `valueField`, `aggregate`, …) are no longer read — their renderer
            // branches were retired in framework#3320.
            const widgetData = (widget as any).data || options.data;

            // Retired legacy inline-analytics widget (framework#3320): still carries
            // the pre-ADR-0021 top-level `object` binding with no `dataset` and no
            // inline `options.data`. No authoring surface emits this anymore, so it
            // is stale stored metadata — render a visible error placeholder (not a
            // blank) prompting a rebind to a dataset. The condition itself lives in
            // `./legacyRetiredWidget` so `DashboardGridLayout` applies the SAME one
            // (objectui#4612) instead of a hand-copied twin.
            if (isLegacyRetiredWidget(widget)) {
                return LEGACY_RETIRED_WIDGET_SCHEMA;
            }

            // One shared classification (./widgetDispatch): resolves spec-level
            // aliases onto a renderer-supported base family (column→bar,
            // spline→line) and names the single-value / tabular / unsupported
            // families explicitly, so no widget type reaches the passthrough
            // return below and renders a red "Unknown component type" (#2943).
            const dispatch = classifyWidgetType(widgetType);

            if (dispatch.family === 'series' && dispatch.chartType) {
                const xAxisKey = options.xField || 'name';
                const yField = options.yField || 'value';

                // The widget's declared `chartConfig`, lowered onto the chart
                // schema — objectui#4044. `DashboardWidget.chartConfig` is
                // declared on EVERY dashboard widget (since `@objectstack/spec`
                // 17.5.0 as `DashboardWidgetChartConfigSchema`: the chart's
                // appearance keys, with `type` / `xAxis` / `yAxis` / `series`
                // refused at parse), but until this card only the ADR-0021
                // dataset path (`DatasetWidget`) read it: this inline path
                // mentioned `chartConfig` zero times, so an author who wrote
                // `chartConfig.title` / `.colors` / `.height` on a widget bound
                // to inline rows or to a `provider: 'object'` aggregate parsed
                // clean and got nothing.
                //
                // `chartConfigPresentation` is the SAME whitelist the dataset
                // path lowers through (`@object-ui/core`), not a second copy —
                // it admits a key only when the chart block measurably draws it
                // (see its docblock for the two criteria and for why `aria` is
                // refused). Spread AFTER the derived keys so an authored
                // `colors` / `height` overrides the defaults below, and BEFORE
                // nothing that would shadow the derived bindings: the whitelist
                // emits no `xAxisKey` and no `series`. Nor is there an authored
                // axis to weigh against them: spec 17.5.0 refuses
                // `chartConfig.xAxis` / `yAxis` / `series` on a dashboard
                // widget, which answered the precedence question (authored axes
                // vs derived) that objectstack#17385 carried.
                const chartPresentation = chartConfigPresentation(widget.chartConfig);

                // provider: 'object' — delegate to ObjectChart for async data loading.
                // Field/aggregate config comes from the nested data provider.
                if (isObjectProvider(widgetData)) {
                    const providerAgg = widgetData.aggregate;
                    const effectiveAggregate = providerAgg ? {
                        field: providerAgg.field,
                        function: providerAgg.function,
                        groupBy: providerAgg.groupBy,
                    } : undefined;
                    // The contract answers which column carries the measure —
                    // see the twin site in `DashboardGridLayout` and
                    // objectui#8266. Note `resolveSeriesLabel` below ALREADY
                    // knew about this duality (`yField === 'value' || 'count'`)
                    // while the dataKey did not: the legend read "Count" over a
                    // plot with nothing in it.
                    const effectiveYField = chartMeasureKey(effectiveAggregate, yField);
                    // The CATEGORY half of the same gap — see the twin site in
                    // `DashboardGridLayout` and objectui#8269. `xField ||
                    // 'name'` bound a literal against rows keyed by the raw
                    // `groupBy` field, and the refusal that produced named
                    // `name`: a wrong-CAUSE diagnostic, since nothing on screen
                    // named the `groupBy` that was actually ignored.
                    const effectiveXAxisKey = chartCategoryKey(effectiveAggregate, xAxisKey);
                    // The declared node type, `ObjectChartSchema` (objectui#11514):
                    // `chartType` is the dispatch's `SeriesChartFamily`, one of the
                    // families that type declares (objectui#11513), with no cast.
                    return {
                        type: 'object-chart',
                        chartType: dispatch.chartType,
                        objectName: widgetData.object,
                        aggregate: effectiveAggregate,
                        filter: widgetData.filter || widget.filter,
                        xAxisKey: effectiveXAxisKey,
                        series: [{
                            dataKey: effectiveYField,
                            label: resolveSeriesLabel(widgetData.object, effectiveYField, effectiveAggregate?.function),
                        }],
                        colors: CHART_COLORS,
                        // Deterministic first paint inside the grid — no entrance
                        // animation to freeze at height 0 (#2756).
                        isAnimationActive: false,
                        drillDown: options.drillDown ?? defaultChartDrill(dispatch.chartType),
                        // Passed through by value; its TYPE now comes from the
                        // spec's converged `{ kind, dimension? }` (objectstack#5011),
                        // which is what `CompareToConfig` projects — so the cast
                        // that used to bridge the skew is gone.
                        compareTo: widget.compareTo,
                        className: "h-[200px] sm:h-[250px] md:h-[300px]",
                        ...chartPresentation,
                    } satisfies ObjectChartSchema;
                }

                // Static inline data array.
                const dataItems = Array.isArray(widgetData) ? widgetData : widgetData?.items || [];

                // `chartType` is the dispatch's resolved family, as on the
                // `object-chart` node above: a `SeriesChartFamily`, which
                // `ChartSchema.chartType` (the spec's `ChartType`) declares.
                // The literal is checked against the dashboard's chart
                // hand-off, `ChartSchema` plus the two render keys this
                // producer composes (`./chartRenderHandoff`, objectui#11598),
                // and handed on with no cast.
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
                    className: "h-[200px] sm:h-[250px] md:h-[300px]",
                    ...chartPresentation,
                };
                return chartNode;
            }

            // Single-value families (gauge / solid-gauge / kpi / bullet, and the
            // `metric` widget spelling) render as a metric card. The knowledge
            // was already here as METRIC_LIKE_TYPES — it just picked a grid span
            // and never routed the widget, so four spec chart types fell through
            // to a red error box (#2943).
            //
            // `classifyWidgetType` answers `metric` only for a named type, so
            // the `widgetType` test narrows for the compiler and changes no
            // verdict: the card's label falls back to that type, and the node's
            // declared type requires a label (objectui#11466).
            if (dispatch.family === 'metric' && widgetType !== undefined) {
                // provider: 'object' — RETIRED for the single-value family
                // (objectui#11525, maintainer ruling C), with the same
                // placeholder object the pivot arm below returns
                // (objectui#10528), imported rather than restated. A metric
                // binds a semantic-layer `dataset` (ADR-0021), which both
                // validator faces require on every widget; a stored
                // dataset-less widget whose `options.data` (or widget-level
                // `data`) is `{ provider: 'object', … }` is stale metadata. This
                // branch used to build a flat `object-metric` node carrying an
                // ObjectQL-dialect `filter` that no node type declares, so the
                // tile drew a number through a second filter dialect beside the
                // dataset path. It now draws the visible rebind prompt instead.
                // A typeless widget resolves to `metric` (objectui#11514), so it
                // answers here too. The chart and table arms keep their
                // `provider: 'object'` branches. `DashboardGridLayout`'s metric
                // arm answers the same way.
                if (isObjectProvider(widgetData)) return LEGACY_RETIRED_WIDGET_SCHEMA;
                // objectui#4032 — the KPI card's heading comes from the SAME
                // convention channel every other widget's header uses
                // (`{ns}.dashboards.{dash}.widgets.{id}.title`), not from the
                // raw authored `widget.title`.
                //
                // A self-contained metric renders no shared Card header, so
                // `resolvedTitle` was computed below and then thrown away while
                // this line built its own untranslated label — which is exactly
                // why a `type: 'metric'` tile showed raw English on a dashboard
                // whose every other widget showed the translation.
                //
                // `|| widgetType` is kept as the last resort for an untitled
                // widget, but it is now genuinely last: it used to swallow the
                // spec-valid inline map that `resolveLabel` could not read, so
                // an authored title silently became the string `"metric"`.
                const label = tWidgetTitle(widget) || widgetType;
                // Static value: an inline `options.value`, else the first row's
                // measure from an inline data array.
                const rows = Array.isArray(widgetData) ? widgetData : widgetData?.items || [];
                const valueField = options.yField || 'value';
                return {
                    // The namespaced node key: the registration passes
                    // `skipFallback: true` (objectui#10859 batch 8, M3 option A).
                    // Its declared type is `DashboardMetricNodeSchema`, the
                    // `CustomNodeRegistry` entry `./widgetDispatch` adds
                    // (objectui#11466).
                    type: DASHBOARD_NODE_TYPES.metric,
                    // The card draws no sub-caption from `options` (objectui#11389,
                    // ruling C): the spread drops the retired `description` key,
                    // the same way `DashboardGridLayout`'s metric arm does.
                    ...withoutRetiredSubCaption(options),
                    label,
                    value: options.value ?? rows[0]?.[valueField] ?? '—',
                };
            }

            if (dispatch.family === 'table') {
                // `list` shares table semantics (raw records) but never carries
                // search / pagination chrome.
                const isList = widgetType === 'list';
                // provider: 'object' — use ObjectDataTable for async data loading.
                // Default-on drill-to-record: a click opens the record in a drawer.
                if (isObjectProvider(widgetData)) {
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

                // Static (data-array) table — drill-to-record stays opt-in.
                const staticRows = Array.isArray(widgetData) ? widgetData : widgetData?.items || [];
                return {
                    type: 'data-table',
                    ...options,
                    data: staticRows,
                    // `columns` is a REQUIRED key of `DataTableSchema`, and this
                    // branch used to omit it whenever the author declared none —
                    // a table of empty rows, no headers, no cells (objectui#4618).
                    // Derive from the rows, as the `provider: 'object'` half of
                    // this same family already does. An explicit list always wins:
                    // a declared column set is a whitelist, never a starting point.
                    columns: Array.isArray(options.columns) && options.columns.length > 0
                        ? options.columns
                        : deriveStaticTableColumns(staticRows),
                    searchable: false,
                    pagination: false,
                    className: "border-0"
                };
            }

            // Pivot widgets are authored as dataset-bound (ADR-0021) and render via
            // DatasetWidget (a grouped table / cross-tab). The dashboard renderer no
            // longer emits the `object-pivot` / `pivot` blocks (framework#3320); the
            // ObjectPivotTable / PivotTable components remain public SDUI blocks for
            // other surfaces. A non-dataset pivot reaching here is stale metadata —
            // show the retired placeholder rather than a blank grid.
            //
            // This arm stays surface-LOCAL and is deliberately not part of the
            // shared detector (objectui#4612): it is a statement about what THIS
            // surface can draw — nothing here emits a pivot block — not about the
            // widget being legacy. `DashboardGridLayout` still draws pivots from
            // static data, so exporting this family-wide arm would retire that
            // live branch over there. Its `provider: 'object'` pivot answers with
            // this same placeholder (objectui#10528), imported from the same
            // module rather than restated. The legacy pivot SHAPE is covered on
            // both surfaces by the shared sentinel above, which its top-level
            // `object` matches.
            if (dispatch.family === 'pivot') {
                return LEGACY_RETIRED_WIDGET_SCHEMA;
            }

            // A `custom` widget with no `component` reaches the labelled
            // placeholder below, as on `DashboardGridLayout`. It used to draw
            // its own prompt to "set `component` to a UIComponent schema",
            // which objectui#12254 made false: the envelope above draws a
            // `metric-card` and nothing else.

            // Known chart family with no dedicated renderer yet → clean labelled
            // placeholder instead of falling through to a raw "Unknown component
            // type" error box that dumps the widget JSON.
            if (dispatch.family === 'unsupported') {
                return unsupportedWidgetSchema(widgetType);
            }

            // A widget whose `type` names no family and no component type is
            // stale metadata both validator faces refuse at `type`. It draws the
            // labelled placeholder an unsupported family draws, not the
            // registry's red OBJUI-001 panel dumping the widget (objectui#11514,
            // Q2 A). A typeless widget never gets here: it resolved to `metric`.
            // Nor does a component node: the passthrough above took it.
            return unsupportedWidgetSchema(widgetType);
        };
        
        // Broadcast the dashboard filter values into this widget's inline
        // query: resolve the widget-scoped condition from the bindings and
        // AND-merge it with the widget's own filter. Object-backed child
        // schemas re-fetch on filter change, so no widget renderer changes
        // are needed downstream.
        // Widget arm only: `filterBindings` and `filter` are widget keys, and
        // the node a component entry becomes takes no filter (objectui#11598).
        const scopedFilter = widgetArm && filterDefs.length > 0
            ? buildWidgetScopedFilter(widgetArm, filterDefs, filterValues)
            : undefined;
        const componentSchema = ((): SchemaRendererProps['schema'] => {
            // No cast (objectui#11466): `getComponentSchema` returns
            // `SchemaRenderer`'s own prop type, and every branch builds a
            // declared node. It was `as BaseSchema` (objectui#4548, which
            // replaced an `as Record< string, any >` that dropped the `type`).
            // The `filter` read below does not lean on an index signature for
            // arbitrary key access: it narrows to the node schema that declares
            // `filter` first (`isFilterableComponentSchema`, objectui#11348).
            const cs = getComponentSchema();
            if (scopedFilter && cs && typeof cs === 'object' && isFilterableComponentSchema(cs)) {
                return { ...cs, filter: mergeFilters(cs.filter, scopedFilter) };
            }
            return cs;
        })();
        // Dataset-bound widgets render through DatasetWidget, which forwards
        // `widget.filter` to the dataset query as `runtimeFilter`. Built off
        // the widget arm, so it is defined exactly when `datasetBound` holds.
        const datasetWidget = widgetArm && datasetBound
            ? (scopedFilter ? { ...widgetArm, filter: mergeFilters(widgetArm.filter, scopedFilter) } : widgetArm)
            : undefined;
        // A `metric` widget renders its own card chrome ONLY in the inline
        // path: the `plugin-dashboard:metric` card, or, for a retired
        // `provider: 'object'` metric (objectui#11525), the placeholder, which
        // draws its own border, as the legacy metric shape's placeholder always
        // has here. A dataset-bound metric uses DatasetWidget, which
        // renders just the value — so it must take the shared Card wrapper to get
        // a title + border like the kpi/gauge widgets (otherwise it shows as bare
        // text with no title, inconsistent with its neighbours).
        const isSelfContained = entryType === 'metric' && !datasetBound;
        // objectui#12528 — a dataset-bound METRIC tile draws no card header:
        // the header (title, then a description paragraph under a rule) and
        // the tile (value, then the measure label) stacked four lines for one
        // number. The tile draws the title and the measure label on one line
        // above the value instead, and the description is the title's tooltip.
        // The spec declares no widget key to show it inline, so it shows
        // nowhere else. Every other widget keeps the frame as it was.
        const datasetMetric = datasetBound && entryType === 'metric';
        const resolvedTitle = tWidgetTitle(widget);
        const resolvedDescription = tWidgetDescription(widget);
        const widgetKey = widget.id || resolvedTitle || `widget-${index}`;
        const isSelected = designMode && selectedWidgetId === widget.id;

        const designModeProps = designMode ? {
            'data-testid': `dashboard-preview-widget-${widget.id}`,
            'data-widget-id': widget.id,
            role: 'button' as const,
            tabIndex: 0,
            'aria-selected': isSelected,
            'aria-label': `Widget: ${resolvedTitle || `Widget ${index + 1}`}`,
            onClick: (e: React.MouseEvent) => handleWidgetClick(e, widget.id),
            onKeyDown: (e: React.KeyboardEvent) => handleWidgetKeyDown(e, widget.id, index),
        } : {};

        const selectionClasses = designMode
          ? cn(
              "cursor-pointer rounded-lg transition-all outline-none",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              isSelected
                ? "ring-2 ring-primary shadow-md bg-primary/5 dark:bg-primary/10"
                : "hover:ring-2 hover:ring-primary/40 hover:shadow-sm"
            )
          : undefined;

        const innerGridSpanStyle = !isMobile && clampedLayout && !dragEnabled ? {
            gridColumn: `span ${clampedLayout.w}`,
            gridRow: `span ${clampedLayout.h}`,
        } : undefined;

        const renderedNode = isSelfContained ? (
            <div
                className={cn("h-full w-full", designMode && "relative", selectionClasses)}
                style={innerGridSpanStyle}
                {...designModeProps}
            >
                 {/* `isSelfContained` implies `!datasetBound` (see its definition above), so a
                     dataset-bound widget can never render here — it always takes the Card branch
                     below for its title + border chrome. Do not re-add a `datasetBound` fork
                     here: the arm is unreachable by construction (objectui#4620). */}
                 <SchemaRenderer schema={componentSchema} className={cn("h-full w-full", designMode && "pointer-events-none")} dataSource={dataSource} />
                 {designMode && <div className="absolute inset-0 z-10" aria-hidden="true" data-testid="widget-click-overlay" />}
            </div>
        ) : (
            <Card
                className={cn(
                    "overflow-hidden border-border/50 shadow-sm transition-all hover:shadow-md",
                    "bg-card/50 backdrop-blur-sm",
                    forceMobileFullWidth && "w-full",
                    designMode && "relative",
                    selectionClasses
                )}
                style={innerGridSpanStyle}
                {...designModeProps}
            >
                {resolvedTitle && !datasetMetric && (
                    <CardHeader className="pb-2 border-b border-border/40 bg-muted/20 px-3 sm:px-6">
                        <CardTitle className="text-sm sm:text-base font-medium tracking-tight truncate" title={resolvedTitle}>
                            {resolvedTitle}
                        </CardTitle>
                        {resolvedDescription && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{resolvedDescription}</p>
                        )}
                    </CardHeader>
                )}
                <CardContent className="p-0">
                    <div className={cn("h-full w-full", datasetMetric ? "p-3 sm:p-4" : "p-3 sm:p-4 md:p-6", designMode && "pointer-events-none")}>
                        {datasetWidget
                          ? <DatasetWidget
                              widget={datasetWidget}
                              dataSource={dataSource}
                              heading={datasetMetric
                                ? { title: resolvedTitle || '', description: resolvedDescription || undefined }
                                : undefined}
                            />
                          : <SchemaRenderer schema={componentSchema} dataSource={dataSource} />}
                    </div>
                </CardContent>
                {designMode && <div className="absolute inset-0 z-10" aria-hidden="true" data-testid="widget-click-overlay" />}
            </Card>
        );

        if (dragEnabled && widget.id) {
            return (
                <SortableWidgetWrapper
                    key={widgetKey}
                    id={widget.id}
                    gridSpan={!isMobile && clampedLayout ? { w: clampedLayout.w, h: clampedLayout.h } : undefined}
                >
                    {renderedNode}
                </SortableWidgetWrapper>
            );
        }

        return <Fragment key={widgetKey}>{renderedNode}</Fragment>;
    };

    // The dashboard display name is `label` (@objectstack/spec
    // `DashboardSchema`, where it is REQUIRED) and nothing else. The legacy
    // objectui `title` spelling used to be read first here; that arm RETIRED
    // under ADR-0049 (objectui#7509, maintainer ruling 2026-09-04) together
    // with the four sibling root arms in `DashboardView`,
    // `DashboardGridLayout`, `DashboardEditor` and `DashboardDesignPage`, so
    // the same stored document can no longer show one header in the console and
    // a different one in the designer (framework#1878/#1891 record where the
    // legacy spelling came from; #2666 is the fallback this mirrored).
    //
    // The spec refuses root `title` BY NAME (`unrecognized_keys(title)`), so no
    // authored document can acquire the key and only legacy-document
    // compatibility retires here.
    //
    // ⛔ NOT the widget arm: `widget.title` is `DashboardWidget.title`, the
    // spec's `I18nLabel`, a different DECLARED key that stays. The two are told
    // apart by RECEIVER — this one's receiver is the dashboard ROOT.
    const headerTitle = schema.label;

    const recordCountBadge = recordCount !== undefined && (
      <span className="text-xs text-muted-foreground">
        {recordCount.toLocaleString(displayLocale)} records
      </span>
    );

    /**
     * The refresh control (with its record-count badge) never takes a row of
     * its own when there is a row to share (objectui#11694).
     *
     * It used to be a `col-span-full` grid item of its own, between the filter
     * bar and the widgets. In the positioned grid every implicit row has the
     * `minmax(5rem, auto)` floor, so a button-high control claimed a 5rem row
     * plus the grid gap; the reading on objectui#11694 (1440x900, a filtered
     * dashboard) had that band push the first row of charts below the fold. So
     * it shares, in this order: the filter bar's row (right-aligned, the row
     * nearest the data it refreshes); else the header's row, when this
     * renderer draws one; else it stands alone, in a row sized to its content
     * (see `leadingRows` below).
     *
     * A host that draws the button itself (`onRefreshStateChange`,
     * objectui#12554) takes the button out of it; the record-count badge stays.
     * With no badge either there is no control, so the row it would have
     * shared or stood in costs nothing.
     */
    const refreshButton = onRefresh && !hostDrawsRefresh && (
      <Button
        variant="outline"
        size="sm"
        onClick={handleRefresh}
        disabled={refreshing}
        aria-label={tt('dashboard.refreshDashboard', 'Refresh dashboard')}
      >
        <RefreshCw className={cn("h-4 w-4 mr-2", refreshing && "animate-spin")} />
        {refreshing ? tt('dashboard.refreshing', 'Refreshing…') : tt('dashboard.refreshAll', 'Refresh All')}
      </Button>
    );
    const refreshControl = onRefresh && (refreshButton || recordCountBadge) && (
      <div className="ml-auto flex shrink-0 items-center gap-3">
        {recordCountBadge}
        {refreshButton}
      </div>
    );
    const refreshInHeader = !!refreshControl && filterDefs.length === 0;
    /**
     * Decide what the header would actually SHOW before deciding whether to
     * render its wrapper at all.
     *
     * Every child here is independently suppressible: the console page chrome
     * passes `hideHeaderText` because it already renders the dashboard's title
     * and description itself, and `showTitle` / `showDescription` can be
     * authored off. The wrapper, however, used to render whenever `header` was
     * merely *declared* — so with the chrome present and no `header.actions`,
     * every child evaluated falsy and the DOM still got
     * `<div class="col-span-full mb-4"></div>`: an empty node that claims a
     * full grid row (measured 64px) plus `mb-4`, opening every console
     * dashboard page with a blank band above the filter bar (objectui#5812,
     * measured on HotCRM 17.1.0). Authors had no lever — dropping `header`
     * would have traded this for the standalone embed's lost title, which is
     * the very thing `header` is for.
     *
     * So the contract is: the header costs zero pixels when it has nothing to
     * show, and is otherwise untouched. `header.actions` keep it alive even
     * under the chrome, since the chrome renders text only, not actions.
     */
    const header = schema.header;
    const showHeaderTitle = !hideHeaderText && header?.showTitle !== false && !!headerTitle;
    const showHeaderDescription = !hideHeaderText && header?.showDescription !== false && !!schema.description;
    const headerActions = header?.actions ?? [];
    const headerSection = header && (showHeaderTitle || showHeaderDescription || headerActions.length > 0) && (
      <div className={cn("col-span-full mb-4", refreshInHeader && "flex items-start justify-between gap-3")}>
        <div className="min-w-0">
          {/* A `localized` document's label and description are the server's
              answer and are drawn as given, as its widget texts are (objectui#11295). */}
          {showHeaderTitle && (
            <h2 className="text-lg font-semibold tracking-tight">
              {dashName && !localized
                ? dashboardLabel({ name: dashName, label: resolveLabel(headerTitle) })
                : resolveLabel(headerTitle)}
            </h2>
          )}
          {showHeaderDescription && (
            <p className="text-sm text-muted-foreground mt-1">
              {dashName && !localized
                ? dashboardDescription({ name: dashName, description: resolveLabel(schema.description) })
                : resolveLabel(schema.description)}
            </p>
          )}
          {headerActions.length > 0 && (
            <div className="flex gap-2 mt-3">
              {headerActions.map((action, i) => {
                const Icon = resolveLucideIcon(action.icon);
                const handleClick = async () => {
                  // Every header action goes through the ActionRunner, which
                  // owns the type registry. This used to allow-list `modal` /
                  // `script` only, so a `flow` header action (and `api` / `form`
                  // / `navigation`) fell through to a warn and never dispatched —
                  // a screen flow could not even be launched from a dashboard
                  // (framework#3528). The runner reports an unknown type itself,
                  // so there is nothing to second-guess here.
                  //
                  // `url` included (objectui#12275). It used to navigate here,
                  // by a url grammar of its own: a protocol-relative `//host`
                  // was assigned, `mailto:` threw in `pushState`, a bare
                  // relative value was pushed as a route, and an omitted
                  // `actionType` was dropped with a warning although the def
                  // above reads it as `url`. The runner's `classifyNavigationTarget`
                  // is the one answer to what a click may open (ruling A+ on
                  // objectui#12191). ⛔ No scheme test of its own here.
                  //
                  // `actionUrl` is the name the def registered under.
                  const result = await executeAction(action.actionUrl);
                  if (!result?.success) {
                    console.warn('[DashboardRenderer] action failed', result?.error);
                    return;
                  }
                  // With no navigation handler (no `ActionProvider` above, so
                  // no host router), the runner does not navigate to an
                  // admitted in-app path: it hands it back as `redirect`.
                  // Follow that hand-off for a `url` action, SPA-style, as this
                  // click did before: history API + popstate so a router that
                  // listens picks it up. `pushState` cannot leave the origin.
                  if (result.redirect && headerActionDefs[i]?.type === 'url') {
                    window.history.pushState({}, '', result.redirect);
                    window.dispatchEvent(new PopStateEvent('popstate'));
                  }
                };
                return (
                  <Button key={i} variant="outline" size="sm" onClick={handleClick}>
                    {Icon && <Icon className="w-4 h-4 mr-1.5" />}
                    {tActionLabel(action)}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
        {refreshInHeader && refreshControl}
      </div>
    );

    const filterBar = filterDefs.length > 0 && (
      <DashboardFilterBar
        defs={filterDefs}
        values={filterValues}
        onChange={setFilterValue}
        onReset={resetFilterValues}
        dataSource={dataSource}
        className={refreshControl ? 'min-w-0 grow' : undefined}
      />
    );

    // The row under the header (objectui#11694): the filter bar with the
    // refresh control at its right end; or the control alone, when there is no
    // filter bar and no header row of this renderer's to share.
    const toolbarRow = filterBar
      ? (refreshControl ? (
          <div className="col-span-full flex flex-wrap items-center gap-2">
            {filterBar}
            {refreshControl}
          </div>
        ) : filterBar)
      : (refreshControl && !headerSection && (
          <div className="col-span-full flex">{refreshControl}</div>
        ));
    /**
     * The full-width rows above the widgets: the header and the toolbar row.
     * In the positioned grid they are explicit `auto` tracks, sized to their
     * content, so the `minmax(5rem, auto)` floor stays on the widget rows that
     * need it (objectui#11694). Widgets are auto-placed by span only, so these
     * leading items always take the first rows.
     */
    const leadingRows = (headerSection ? 1 : 0) + (toolbarRow ? 1 : 0);

    const userActionsAttr = userActions ? JSON.stringify(userActions) : undefined;

    /**
     * What may legitimately become a DOM attribute on this container
     * (objectui#4432, migration step 2 of objectui#4425 phase 2).
     *
     * `plugin-dashboard:dashboard` resolves to this component (it was
     * `view:dashboard` until objectui#9533 converged the bare key), so
     * `SchemaRenderer` hands it
     * the dashboard node's OWN keys, the contents of the node's `props`
     * container, the ARIA it resolved, its evaluated `disabled` verdict and the
     * host's trailing props. Everything this component does not destructure
     * used to be spread raw onto the grid `<div>` below, and React writes
     * unknown lowercase attributes through in silence while stringifying object
     * values. Measured through the real SDUI path: **13 non-DOM attributes**,
     * including `events="[object Object]"`, `props="[object Object]"` and a
     * camelCase `arialabel` sitting next to the resolved `aria-label` — the same
     * value twice, one spelling of it meaningless to assistive technology.
     *
     * Per objectui#4425 phase 2 the answer is the whitelist, not another
     * deny-list: `toDomProps` keeps `id` / `className` / `role` / `tabIndex` /
     * `aria-*` / `data-*` and drops the rest. It is spread FIRST so this
     * component's own computed attributes (`className`, `style`,
     * `data-user-actions`, the click channel above) stay authoritative — the
     * old trailing spread let an incoming key overwrite each of them.
     *
     * `datasource` is absent from the 13 because this component destructures
     * the adapter and hands it to its own `SchemaRenderer` calls; that is the
     * one key objectui#4428 shipped a pass without, and it never reached this
     * spread.
     */
    const hostDomProps = toDomProps(props);

    const widgetIds = useMemo(
      () => (schema.widgets ?? []).map((w: DashboardWidgetSlotEntry) => w.id).filter((id: string | undefined): id is string => !!id),
      [schema.widgets]
    );

    const metricIds = useMemo(
      () => (schema.widgets ?? []).filter((w: DashboardWidgetSlotEntry) => resolveWidgetType(w) === 'metric').map((w: DashboardWidgetSlotEntry) => w.id).filter((id: string | undefined): id is string => !!id),
      [schema.widgets]
    );

    const otherIds = useMemo(
      () => (schema.widgets ?? []).filter((w: DashboardWidgetSlotEntry) => resolveWidgetType(w) !== 'metric').map((w: DashboardWidgetSlotEntry) => w.id).filter((id: string | undefined): id is string => !!id),
      [schema.widgets]
    );

    if (isMobile) {
      // Separate metric widgets from other widgets for better mobile layout
      // A typeless widget is a `metric` (the spec's default, objectui#11514).
      const metricWidgets = schema.widgets?.filter((w: DashboardWidgetSlotEntry) => resolveWidgetType(w) === 'metric') || [];
      const otherWidgets = schema.widgets?.filter((w: DashboardWidgetSlotEntry) => resolveWidgetType(w) !== 'metric') || [];

      const mobileBody = (
        <div ref={ref} {...hostDomProps} className={cn("flex flex-col gap-4 px-4", className)} data-user-actions={userActionsAttr} onClick={handleHostClick}>
          {headerSection}
          {toolbarRow}

          {/* Metric cards: 2-column grid */}
          {metricWidgets.length > 0 && (
            <div className="grid grid-cols-2 gap-3" onClick={handleBackgroundClick}>
              <SortableContext items={metricIds} strategy={rectSortingStrategy} disabled={!dragEnabled}>
                {metricWidgets.map((widget: DashboardWidgetSlotEntry, index: number) => renderWidget(widget, index))}
              </SortableContext>
            </div>
          )}

          {/* Other widgets (charts, tables): full-width vertical stack */}
          {otherWidgets.length > 0 && (
            <div className="flex flex-col gap-4" onClick={handleBackgroundClick}>
              <SortableContext items={otherIds} strategy={verticalListSortingStrategy} disabled={!dragEnabled}>
                {otherWidgets.map((widget: DashboardWidgetSlotEntry, index: number) => renderWidget(widget, index, true))}
              </SortableContext>
            </div>
          )}
        </div>
      );

      return dragEnabled ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSortableDragEnd}>
          {mobileBody}
        </DndContext>
      ) : mobileBody;
    }

    const desktopBody = (
      <div
        ref={ref}
        {...hostDomProps}
        className={cn(
          "grid",
          // Content-sized rows only for the responsive flow layout. The
          // positioned grid (explicit columns + per-widget layout.h) needs a
          // baseline row height instead: `auto-rows-min` collapses any widget
          // whose content has no intrinsic height — notably charts, whose
          // recharts ResponsiveContainer fills its parent and so reports
          // width/height -1 and draws nothing. `minmax(5rem, auto)` gives each
          // spanned row a floor (so `gridRow: span 4` => a real ~20rem box)
          // while still letting taller widgets (tables) grow.
          !hasExplicitColumns && "auto-rows-min grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4",
          // That floor is for widget rows only: the full-width rows above the
          // widgets (see `leadingRows`) are explicit `auto` tracks, sized to
          // their content (objectui#11694).
          hasExplicitColumns && leadingRows === 1 && "grid-rows-[auto]",
          hasExplicitColumns && leadingRows === 2 && "grid-rows-[auto_auto]",
          className
        )}
        style={{
            ...(hasExplicitColumns && {
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gridAutoRows: 'minmax(5rem, auto)',
            }),
            gap: `${gap * 0.25}rem`
        }}
        data-user-actions={userActionsAttr}
        onClick={handleHostClick}
      >
        {headerSection}
        {toolbarRow}
        <SortableContext items={widgetIds} strategy={rectSortingStrategy} disabled={!dragEnabled}>
          {schema.widgets?.map((widget: DashboardWidgetSlotEntry, index: number) => renderWidget(widget, index))}
        </SortableContext>
      </div>
    );

    return dragEnabled ? (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleSortableDragEnd}>
        {desktopBody}
      </DndContext>
    ) : desktopBody;
  }
);

DashboardRendererInner.displayName = 'DashboardRendererInner';

/**
 * DashboardRenderer — the public dashboard renderer.
 *
 * When the schema declares dashboard-level filters (`globalFilters` /
 * `dateRange`, framework#2501), their values are hosted as dashboard
 * variables in a `PageVariablesProvider` (the page/dashboard variables
 * primitive) so the filter bar can write them, the widget broadcast can read
 * them, and widget expressions can reference them as `page.<name>`.
 * Dashboards without filters render exactly as before — no provider mounted.
 *
 * When a filtered dashboard is embedded inside a Page with its own
 * variables, the nested providers MERGE (#2578 item 5): outer page variables
 * stay readable inside widget subtrees, and only a same-named filter shadows
 * the outer variable.
 */
export const DashboardRenderer = forwardRef<HTMLDivElement, DashboardRendererProps>(
  (props, ref) => {
    const { schema } = props;
    const filterDefs = useMemo(
      () => resolveDashboardFilterDefs(schema),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [schema.globalFilters, schema.dateRange]
    );
    if (filterDefs.length === 0) {
      return <DashboardRendererInner ref={ref} {...props} />;
    }
    return (
      <PageVariablesProvider definitions={dashboardFilterVariableDefs(filterDefs)}>
        <DashboardRendererInner ref={ref} {...props} />
      </PageVariablesProvider>
    );
  }
);

DashboardRenderer.displayName = 'DashboardRenderer';
