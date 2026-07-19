// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { ChartTypeSchema, ChartConfigSchema } from './chart.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { ResponsiveConfigSchema, PerformanceConfigSchema } from './responsive.zod';

/**
 * Color variant for dashboard widgets (e.g., KPI cards).
 */
import { lazySchema } from '../shared/lazy-schema';
export const WidgetColorVariantSchema = lazySchema(() => z.enum([
  'default',
  'blue',
  'teal',
  'orange',
  'purple',
  'success',
  'warning',
  'danger',
]).describe('Widget color variant'));

/**
 * Action type for widget action buttons.
 */
export const WidgetActionTypeSchema = lazySchema(() => z.enum([
  'script',
  'url',
  'modal',
  'flow',
  'api',
]).describe('Widget action type'));

/**
 * Dashboard Header Action Schema
 * An action button displayed in the dashboard header area.
 */
export const DashboardHeaderActionSchema = lazySchema(() => z.object({
  /** Action label */
  label: I18nLabelSchema.describe('Action button label'),

  /** Action URL or target */
  actionUrl: z.string().describe('URL or target for the action'),

  /** Action type */
  actionType: WidgetActionTypeSchema.optional().describe('Type of action'),

  /** Icon identifier */
  icon: z.string().optional().describe('Icon identifier for the action button'),
}).describe('Dashboard header action'));

/**
 * Dashboard Header Schema
 * Structured header configuration for the dashboard.
 */
export const DashboardHeaderSchema = lazySchema(() => z.object({
  /** Whether to show the dashboard title in the header */
  showTitle: z.boolean().default(true).describe('Show dashboard title in header'),

  /** Whether to show the dashboard description in the header */
  showDescription: z.boolean().default(true).describe('Show dashboard description in header'),

  /** Action buttons displayed in the header */
  actions: z.array(DashboardHeaderActionSchema).optional().describe('Header action buttons'),
}).describe('Dashboard header configuration'));

/**
 * Legacy / quarantined widget keys that `.strict()` now rejects. Naming them
 * lets the error map hand the author a fixable message instead of a bare
 * "unrecognized key". Two families:
 *
 * - **Pre-ADR-0021 inline analytics** (`object`/`categoryField`/`valueField`/
 *   `aggregate`/`rowField`/`columnField`/…): removed from the authorable spec at
 *   `@objectstack/spec` 9.0.0 (the single-form cutover). Bind a `dataset` and
 *   select `dimensions`/`values` instead.
 * - **objectui-internal props** (`component`, inline `data`): renderer-only
 *   capabilities that are intentionally not modeled server-side (framework#3251
 *   decision tree) — they must not appear on AI-authored dashboard metadata.
 */
const LEGACY_WIDGET_ANALYTICS_KEYS = new Set([
  'object', 'categoryField', 'categoryGranularity', 'valueField', 'aggregate',
  'aggregation', 'rowField', 'columnField', 'xAxisField', 'yAxisFields', 'measures',
]);
const QUARANTINED_WIDGET_KEYS = new Set(['component', 'data']);

/**
 * Error map for the strict `DashboardWidgetSchema`. Turns an
 * `unrecognized_keys` rejection into a *fixable* message: it always names the
 * offending key(s), and when a key is a removed inline-analytics key or an
 * objectui-internal prop it points the author at the ADR-0021 dataset shape
 * (and `options` for renderer-specific extras). Mirrors `strictVisibilityError`
 * (ADR-0089 D3a); every other issue code defers to zod's default.
 */
const strictWidgetAnalyticsError: z.core.$ZodErrorMap = (issue) => {
  if (issue.code !== 'unrecognized_keys') return undefined;
  const keys = (issue as { keys?: readonly string[] }).keys ?? [];
  const list = keys.map((k) => `\`${k}\``).join(', ');
  const base =
    `Unrecognized key(s) on this dashboard widget: ${list}. ` +
    `Undeclared top-level keys were dropped silently before strict validation, ` +
    `shipping inert metadata; a stale or mis-layered key is now a loud parse error.`;
  if (keys.some((k) => LEGACY_WIDGET_ANALYTICS_KEYS.has(k))) {
    return (
      base +
      ' The pre-ADR-0021 inline analytics shape (`object` + `categoryField` + ' +
      '`valueField` + `aggregate`, pivot `rowField`/`columnField`) was removed — ' +
      'bind a `dataset` and select `dimensions` + `values` by name. Renderer-only ' +
      'settings belong under `options`.'
    );
  }
  if (keys.some((k) => QUARANTINED_WIDGET_KEYS.has(k))) {
    return (
      base +
      ' `component` and inline `data` are objectui-internal renderer capabilities, ' +
      'not part of the author-facing dashboard spec (framework#3251).'
    );
  }
  return base;
};

/**
 * Dashboard Widget Schema
 * A single component on the dashboard grid.
 */
export const DashboardWidgetSchema = lazySchema(() => z.object({
  /** Unique widget identifier (snake_case, used for targetWidgets references) */
  id: SnakeCaseIdentifierSchema.describe('Unique widget identifier (snake_case)'),

  /** Widget Title */
  title: I18nLabelSchema.optional().describe('Widget title'),

  /** Widget Description (displayed below the title) */
  description: I18nLabelSchema.optional().describe('Widget description text below the header'),
  
  /** Visualization Type */
  type: ChartTypeSchema.default('metric').describe('Visualization type'),
  
  /** Chart Configuration */
  chartConfig: ChartConfigSchema.optional().describe('Chart visualization configuration'),

  /** Color variant for the widget (e.g., KPI card accent color) */
  colorVariant: WidgetColorVariantSchema.optional().describe('Widget color variant for theming'),

  /**
   * Runtime capability gate — widget is hidden when the named object is
   * not registered in the runtime's SchemaRegistry. Mirrors
   * `NavigationItem.requiresObject` so cloud-only widgets (e.g. those
   * keyed on `sys_app` / `sys_package_installation`) silently disappear
   * in single-environment runtimes instead of rendering a 404 error.
   * Set explicitly to the dataset's base object when the widget should be
   * gated on that object's availability.
   */
  requiresObject: z.string().optional().describe('Hide the widget unless the named object is registered'),

  /**
   * Runtime capability gate — widget is hidden when the named kernel
   * service is not registered. Mirrors `NavigationItem.requiresService`.
   */
  requiresService: z.string().optional().describe('Hide the widget unless the named kernel service is registered'),

  /** Action URL for the widget header action button */
  actionUrl: z.string().optional().describe('URL or target for the widget action button'),

  /** Action type for the widget header action button */
  actionType: WidgetActionTypeSchema.optional().describe('Type of action for the widget action button'),

  /** Icon for the widget header action button */
  actionIcon: z.string().optional().describe('Icon identifier for the widget action button'),
  
  /** Presentation-scope filter (MongoDB-style), ANDed into the dataset query as `runtimeFilter`. */
  filter: FilterConditionSchema.optional().describe('Presentation-scope filter (runtimeFilter)'),

  /**
   * Period-over-period comparison primitive.
   *
   * When set, the renderer runs a second query against a shifted time
   * window and surfaces the delta (metric widgets show a secondary
   * value + arrow; chart widgets render a muted/dashed overlay series).
   *
   * - `'previousPeriod'` — auto-detect the comparison window from the
   *   widget's `filter` date macros (e.g. `{current_month_start}` →
   *   `{last_month_start}`). Falls back to no comparison when the
   *   filter contains no resolvable date range.
   * - `'previousYear'` — shift the resolved filter window back by one
   *   calendar year.
   * - `{ offset: '7d' | '1M' | '1y' }` — shift by an explicit
   *   ISO-8601-like duration. Units: `d` (days), `w` (weeks),
   *   `M` (months), `y` (years).
   */
  compareTo: z.union([
    z.literal('previousPeriod'),
    z.literal('previousYear'),
    z.object({
      offset: z.string().regex(/^\d+[dwMy]$/, 'Offset must match <N>(d|w|M|y), e.g. "7d", "1M", "1y"'),
    }),
  ]).optional().describe('Period-over-period comparison window'),

  /**
   * ADR-0021 — the semantic-layer `dataset` this widget binds to. The widget
   * selects the dataset's dimensions/measures BY NAME; the dataset owns the base
   * object, allowed joins, intrinsic filter, dimensions, and measures,
   * so numbers stay consistent across every surface. This is the single
   * author-facing analytics shape (the legacy inline `object` + `categoryField`
   * + `valueField` + `aggregate` query was removed in the single-form cutover).
   */
  dataset: SnakeCaseIdentifierSchema.describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) for X / group / split. */
  dimensions: z.array(z.string()).optional().describe('Dimension names — X/group/split'),
  /** Measure names (from the dataset) for the value axis. */
  values: z.array(z.string()).min(1).describe('Measure names — Y (at least one)'),

  /**
   * Layout Position (React-Grid-Layout style)
   * x: column (0-11)
   * y: row
   * w: width (1-12)
   * h: height
   *
   * OPTIONAL — when omitted, the renderer auto-flows the widget into the grid
   * (DashboardGridLayout falls back to `x: (i % 4) * 3, y: Math.floor(i/4) * 4,
   * w: 3, h: 4`). The Studio dashboard designer adds widgets WITHOUT a layout
   * and relies on this auto-flow; requiring `layout` here made every
   * designer-authored dashboard fail validation (422 on draft save, Publish
   * disabled) even though it rendered correctly. Authors may still pin an
   * explicit grid position; absence means "auto-place".
   */
  layout: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }).optional().describe('Grid layout position (auto-flowed when omitted)'),
  
  /** Widget specific options (colors, legend, etc.) */
  options: z.unknown().optional().describe('Widget specific configuration'),

  /**
   * Per-widget bindings from a dashboard-level filter (referenced by its
   * `name`, or the reserved name `"dateRange"` for the built-in date range)
   * to one of THIS widget's fields (framework#2501):
   * - string → apply the filter to that field (e.g. `{ dateRange: 'signed_at' }`)
   * - false  → opt this widget out of that filter
   * - absent → default binding: the filter's own `field`
   *   (dateRange: `dateRange.field ?? 'created_at'`)
   */
  filterBindings: z.record(z.string(), z.union([z.string(), z.literal(false)])).optional()
    .describe("Per-widget dashboard-filter bindings: filter name → this widget's field, or false to opt out"),

  /**
   * Rule ids of build diagnostics intentionally suppressed on this widget
   * (e.g. `'table-count-only'` when a single-row summary table is deliberate).
   * Consumed by `objectstack build` / `objectstack lint`; no runtime effect.
   */
  suppressWarnings: z.array(z.string()).optional().describe('Build diagnostic rule ids suppressed on this widget'),

  /** Responsive layout overrides per breakpoint */
  responsive: ResponsiveConfigSchema.optional().describe('Responsive layout configuration'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
  // ADR-0021 single-form: every widget binds a `dataset` and selects `values`
  // (both required above) — there is no inline-query shape to disambiguate.
}, { error: strictWidgetAnalyticsError })
  // ADR-0021 endpoint (framework#3251, protocol 16 `step16`): reject undeclared
  // top-level keys instead of silently stripping them. A hallucinated or legacy
  // key is now a deterministic author-time error (CI) rather than a silent
  // no-op a human reviewer would miss. `options` stays the free-form escape
  // hatch for renderer-specific extras.
  .strict());

/**
 * Dynamic options binding for global filters.
 * Allows dropdown options to be fetched from an object at runtime.
 */
export const GlobalFilterOptionsFromSchema = lazySchema(() => z.object({
  /** Source object name to fetch options from */
  object: z.string().describe('Source object name'),

  /** Field to use as option value */
  valueField: z.string().describe('Field to use as option value'),

  /** Field to use as option label */
  labelField: z.string().describe('Field to use as option label'),

  /** Optional filter to apply when fetching options */
  filter: FilterConditionSchema.optional().describe('Filter to apply to source object'),
}).describe('Dynamic filter options from object'));

/**
 * Global Filter Schema
 * Defines a single global filter control for the dashboard filter bar.
 */
export const GlobalFilterSchema = lazySchema(() => z.object({
  /**
   * Stable filter name (framework#2501) — the dashboard-variable key under
   * which the filter's value is published (readable in widget expressions as
   * `page.<name>`) and the key widgets reference in `filterBindings`.
   * Defaults to `field`. The name `"dateRange"` is reserved for the built-in
   * dashboard date range.
   */
  name: z.string().optional().describe('Stable filter name (variable key); defaults to field'),

  /** Field name to filter on */
  field: z.string().describe('Field name to filter on'),

  /** Display label for the filter */
  label: I18nLabelSchema.optional().describe('Display label for the filter'),

  /** Filter input type */
  type: z.enum(['text', 'select', 'date', 'number', 'lookup']).optional().describe('Filter input type'),

  /** Static options for select/lookup filters */
  options: z.array(z.object({
    value: z.union([z.string(), z.number(), z.boolean()]).describe('Option value'),
    label: I18nLabelSchema,
  })).optional().describe('Static filter options'),

  /** Dynamic data binding for filter options */
  optionsFrom: GlobalFilterOptionsFromSchema.optional().describe('Dynamic filter options from object'),

  /** Default filter value */
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional().describe('Default filter value'),

  /** Filter application scope */
  scope: z.enum(['dashboard', 'widget']).default('dashboard').describe('Filter application scope'),

  /** Widget IDs to apply this filter to (when scope is widget) */
  targetWidgets: z.array(z.string()).optional().describe('Widget IDs to apply this filter to'),
}));

/**
 * Dashboard Schema
 * Represents a page containing multiple visualizations.
 * 
 * @example Sales Executive Dashboard (ADR-0021: widgets bind a `dataset` and
 * select `dimensions`/`values` BY NAME — each metric/measure is defined once in
 * `defineDataset`, never inline on the widget)
 * {
 *   name: "sales_overview",
 *   label: "Sales Executive Overview",
 *   widgets: [
 *     {
 *       title: "Total Pipe",
 *       type: "metric",
 *       dataset: "opportunity_metrics",
 *       values: ["amount_sum"],
 *       layout: { x: 0, y: 0, w: 3, h: 2 }
 *     },
 *     {
 *       title: "Revenue by Region",
 *       type: "bar",
 *       dataset: "order_metrics",
 *       dimensions: ["region"],
 *       values: ["total_sum"],
 *       layout: { x: 3, y: 0, w: 6, h: 4 }
 *     }
 *   ]
 * }
 */
export const DashboardSchema = lazySchema(() => z.object({
  /** Machine name */
  name: SnakeCaseIdentifierSchema.describe('Dashboard unique name'),
  
  /** Display label */
  label: I18nLabelSchema.describe('Dashboard label'),
  
  /** Description */
  description: I18nLabelSchema.optional().describe('Dashboard description'),

  /** Structured header configuration */
  header: DashboardHeaderSchema.optional().describe('Dashboard header configuration'),
  
  /** Collection of widgets */
  widgets: z.array(DashboardWidgetSchema).describe('Widgets to display'),

  /** Grid column count — defaults to 12 for a standard 12-column grid */
  columns: z.number().int().min(1).max(24).optional().describe('Number of grid columns (default 12)'),

  /** Grid gap in Tailwind spacing units (e.g. 4 = 1rem) */
  gap: z.number().int().min(0).optional().describe('Grid gap in Tailwind spacing units'),

  /** Auto-refresh */
  refreshInterval: z.number().optional().describe('Auto-refresh interval in seconds'),

  /** Dashboard Date Range (Global time filter) */
  dateRange: z.object({
    field: z.string().optional().describe('Default date field name for time-based filtering'),
    defaultRange: z.enum(['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'this_quarter', 'last_quarter', 'this_year', 'last_year', 'last_7_days', 'last_30_days', 'last_90_days', 'custom']).default('this_month').describe('Default date range preset'),
    allowCustomRange: z.boolean().default(true).describe('Allow users to pick a custom date range'),
  }).optional().describe('Global dashboard date range filter configuration'),

  /** Global Filters */
  globalFilters: z.array(GlobalFilterSchema).optional().describe('Global filters that apply to all widgets in the dashboard'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),

  /** Performance optimization settings */
  performance: PerformanceConfigSchema.optional().describe('Performance optimization settings'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this dashboard.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

export type Dashboard = z.infer<typeof DashboardSchema>;
export type DashboardInput = z.input<typeof DashboardSchema>;
export type DashboardWidget = z.infer<typeof DashboardWidgetSchema>;
export type DashboardHeader = z.infer<typeof DashboardHeaderSchema>;
export type DashboardHeaderAction = z.infer<typeof DashboardHeaderActionSchema>;
export type WidgetColorVariant = z.infer<typeof WidgetColorVariantSchema>;
export type WidgetActionType = z.infer<typeof WidgetActionTypeSchema>;
export type GlobalFilter = z.infer<typeof GlobalFilterSchema>;
export type GlobalFilterOptionsFrom = z.infer<typeof GlobalFilterOptionsFromSchema>;

/**
 * Dashboard Factory Helper
 */
export const Dashboard = {
  create: (config: z.input<typeof DashboardSchema>): Dashboard => DashboardSchema.parse(config),
} as const;
