// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { DateGranularity } from '../data/query.zod';
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
 * Widget Measure Schema
 * A single measure definition for multi-measure pivot/matrix widgets.
 */
export const WidgetMeasureSchema = lazySchema(() => z.object({
  /** Value field to aggregate */
  valueField: z.string().describe('Field to aggregate'),

  /** Aggregate function */
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']).default('count').describe('Aggregate function'),

  /** Display label for the measure */
  label: I18nLabelSchema.optional().describe('Measure display label'),

  /** Number format string (e.g., "$0,0.00", "0.0%") */
  format: z.string().optional().describe('Number format string'),
}).describe('Widget measure definition'));

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
   *
   * Defaults to the widget's `object` field when not explicitly set —
   * any widget that targets an object will be gated on that object's
   * registration. Set this to a different value (or empty string to
   * disable) when the widget should appear even if its `object` is
   * unavailable.
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
  
  /** Data Source Object */
  object: z.string().optional().describe('Data source object name'),
  
  /** Data Filter (MongoDB-style FilterCondition) */
  filter: FilterConditionSchema.optional().describe('Data filter criteria'),

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

  /** Category Field (X-Axis / Group By) */
  categoryField: z.string().optional().describe('Field for grouping (X-Axis)'),

  /**
   * Date Bucketing Granularity for `categoryField`
   *
   * When set and `categoryField` references a date/datetime field, the engine
   * buckets values into uniform `day` / `week` / `month` / `quarter` / `year`
   * periods server-side (PostgreSQL `date_trunc`, MySQL `date_format`, SQLite
   * `strftime`, MongoDB `$dateTrunc`; falls back to in-memory ISO-8601
   * bucketing otherwise). Without this, raw timestamps are grouped verbatim
   * which typically yields one bucket per row — making time-series charts
   * appear flat.
   *
   * Mirrors the `dateGranularity` shape of {@link GroupByNodeSchema}.
   */
  categoryGranularity: DateGranularity.optional().describe('Bucket categoryField date values into day/week/month/quarter/year periods'),

  /** Value Field (Y-Axis) */
  valueField: z.string().optional().describe('Field for values (Y-Axis)'),
  
  /** Aggregate operation */
  aggregate: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional().default('count').describe('Aggregate function'),
  
  /** Multi-measure definitions for pivot/matrix widgets */
  measures: z.array(WidgetMeasureSchema).optional().describe('Multiple measures for pivot/matrix analysis'),
  
  /** 
   * Layout Position (React-Grid-Layout style)
   * x: column (0-11)
   * y: row
   * w: width (1-12)
   * h: height
   */
  layout: z.object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  }).describe('Grid layout position'),
  
  /** Widget specific options (colors, legend, etc.) */
  options: z.unknown().optional().describe('Widget specific configuration'),

  /** Responsive layout overrides per breakpoint */
  responsive: ResponsiveConfigSchema.optional().describe('Responsive layout configuration'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

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
 * @example Sales Executive Dashboard
 * {
 *   name: "sales_overview",
 *   label: "Sales Executive Overview",
 *   widgets: [
 *     {
 *       title: "Total Pipe",
 *       type: "metric",
 *       object: "opportunity",
 *       valueField: "amount",
 *       aggregate: "sum",
 *       layout: { x: 0, y: 0, w: 3, h: 2 }
 *     },
 *     {
 *       title: "Revenue by Region",
 *       type: "bar",
 *       object: "order",
 *       categoryField: "region",
 *       valueField: "total",
 *       aggregate: "sum",
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
export type WidgetMeasure = z.infer<typeof WidgetMeasureSchema>;
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
