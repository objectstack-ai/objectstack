// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { ProtectionSchema } from '../shared/protection.zod';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { SharingConfigSchema } from './sharing.zod';
import { ResponsiveConfigSchema, PerformanceConfigSchema } from './responsive.zod';
import { FieldType, SelectOptionSchema } from '../data/field.zod';

/**
 * HTTP Method Enum & HTTP Request Schema
 * Migrated to shared/http.zod.ts. Re-exported here for backward compatibility.
 */
import { HttpMethodSchema, HttpRequestSchema } from '../shared/http.zod';
import { lazySchema } from '../shared/lazy-schema';
export { HttpMethodSchema, HttpRequestSchema };

/**
 * View Data Source Configuration
 * Supports three modes:
 * 1. 'object': Standard Protocol - Auto-connects to ObjectStack Metadata and Data APIs
 * 2. 'api': Custom API - Explicitly provided API URLs
 * 3. 'value': Static Data - Hardcoded data array
 */
export const ViewDataSchema = lazySchema(() => z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('object'),
    object: z.string().describe('Target object name'),
  }),
  z.object({
    provider: z.literal('api'),
    read: HttpRequestSchema.optional().describe('Configuration for fetching data'),
    write: HttpRequestSchema.optional().describe('Configuration for submitting data (for forms/editable tables)'),
  }),
  z.object({
    provider: z.literal('value'),
    items: z.array(z.unknown()).describe('Static data array'),
  }),
  /**
   * Schema-bound data source — used by standalone forms whose data is
   * shaped by a JSON Schema (or Zod-derived schema) rather than by an
   * ObjectQL object. Powers the metadata editor, action input dialogs,
   * and any Form that is not bound to a CRUD object.
   */
  z.object({
    provider: z.literal('schema'),
    /** Schema identifier (e.g. metadata type name "report"). Resolved at runtime against /meta entries. */
    schemaId: z.string().describe('Schema identifier — typically the metadata type name'),
    /** Optional inline JSON Schema; when omitted the runtime resolves schemaId from the server. */
    schema: z.record(z.string(), z.unknown()).optional().describe('Inline JSON Schema (Draft 2020-12). Optional when schemaId is resolvable.'),
  }),
]));

/**
 * View Filter Rule Schema
 * Standardized filter condition used in list views, tabs, and page-level filters.
 * Uses a declarative array-of-objects format: [{ field, operator, value }].
 *
 * @example
 * ```ts
 * filter: [
 *   { field: 'status', operator: 'equals', value: 'active' },
 *   { field: 'close_date', operator: 'this_quarter' },
 * ]
 * ```
 */
export const ViewFilterRuleSchema = lazySchema(() => z.object({
  /** Field name to filter on */
  field: z.string().describe('Field name to filter on'),
  /** Filter operator */
  operator: z.string().describe('Filter operator (e.g. equals, not_equals, contains, this_quarter)'),
  /** Filter value (optional for unary operators like is_null, this_quarter) */
  value: z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])
    .optional().describe('Filter value'),
}).describe('View filter rule'));

export type ViewFilterRule = z.infer<typeof ViewFilterRuleSchema>;

/**
 * Column Summary Function Schema
 * Aggregation function for column footer (Airtable-style column summaries)
 */
export const ColumnSummarySchema = lazySchema(() => z.enum([
  'none',
  'count',
  'count_empty',
  'count_filled',
  'count_unique',
  'percent_empty',
  'percent_filled',
  'sum',
  'avg',
  'min',
  'max',
]).describe('Aggregation function for column footer summary'));

/**
 * List Column Configuration Schema
 * Detailed configuration for individual list view columns
 */
export const ListColumnSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name (snake_case)'),
  label: I18nLabelSchema.optional().describe('Display label override'),
  width: z.number().positive().optional().describe('Column width in pixels'),
  align: z.enum(['left', 'center', 'right']).optional().describe('Text alignment'),
  hidden: z.boolean().optional().describe('Hide column by default'),
  sortable: z.boolean().optional().describe('Allow sorting by this column'),
  resizable: z.boolean().optional().describe('Allow resizing this column'),
  wrap: z.boolean().optional().describe('Allow text wrapping'),
  type: z.string().optional().describe('Renderer type override (e.g., "currency", "date")'),

  /** Pinning (Airtable-style frozen columns) */
  pinned: z.enum(['left', 'right']).optional().describe('Pin/freeze column to left or right side'),

  /** Column Footer Summary (Airtable-style aggregation) */
  summary: ColumnSummarySchema.optional().describe('Footer aggregation function for this column'),

  /** Interaction */
  link: z.boolean().optional().describe('Functions as the primary navigation link (triggers View navigation)'),
  action: z.string().optional().describe('Registered Action ID to execute when clicked'),
}));

/**
 * List View Selection Configuration
 */
export const SelectionConfigSchema = lazySchema(() => z.object({
  type: z.enum(['none', 'single', 'multiple']).default('none').describe('Selection mode'),
}));

/**
 * List View Pagination Configuration
 */
export const PaginationConfigSchema = lazySchema(() => z.object({
  pageSize: z.number().int().positive().default(25).describe('Number of records per page'),
  pageSizeOptions: z.array(z.number().int().positive()).optional().describe('Available page size options'),
}));

/**
 * Row Height / Density Schema (Airtable-style)
 * Controls the visual density of rows in a list view.
 */
export const RowHeightSchema = lazySchema(() => z.enum([
  'compact',     // Minimal padding, single line
  'short',       // Reduced padding
  'medium',      // Default padding
  'tall',        // Extra padding, multi-line preview
  'extra_tall',  // Maximum padding, rich content preview
]).describe('Row height / density setting for list view'));

/**
 * Grouping Field Configuration
 * Defines a single grouping level for record grouping.
 */
export const GroupingFieldSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name to group by'),
  order: z.enum(['asc', 'desc']).default('asc').describe('Group sort order'),
  collapsed: z.boolean().default(false).describe('Collapse groups by default'),
}));

/**
 * Grouping Configuration Schema (Airtable-style)
 * Supports multi-level grouping for grid/gallery views.
 */
export const GroupingConfigSchema = lazySchema(() => z.object({
  fields: z.array(GroupingFieldSchema).min(1).describe('Fields to group by (supports up to 3 levels)'),
}).describe('Record grouping configuration'));

/**
 * Gallery View Configuration (Airtable-style)
 * Configures card layout for gallery/card views.
 */
export const GalleryConfigSchema = lazySchema(() => z.object({
  coverField: z.string().optional().describe('Attachment/image field to display as card cover'),
  coverFit: z.enum(['cover', 'contain']).default('cover').describe('Image fit mode for card cover'),
  cardSize: z.enum(['small', 'medium', 'large']).default('medium').describe('Card size in gallery view'),
  titleField: z.string().optional().describe('Field to display as card title'),
  visibleFields: z.array(z.string()).optional().describe('Fields to display on card body'),
}).describe('Gallery/card view configuration'));

/**
 * Timeline View Configuration (Airtable-style)
 * Configures timeline/chronological views.
 */
export const TimelineConfigSchema = lazySchema(() => z.object({
  startDateField: z.string().describe('Field for timeline item start date'),
  endDateField: z.string().optional().describe('Field for timeline item end date'),
  titleField: z.string().describe('Field to display as timeline item title'),
  groupByField: z.string().optional().describe('Field to group timeline rows'),
  colorField: z.string().optional().describe('Field to determine item color'),
  scale: z.enum(['hour', 'day', 'week', 'month', 'quarter', 'year']).default('week').describe('Default timeline scale'),
}).describe('Timeline view configuration'));

/**
 * View Sharing Configuration (Airtable-style)
 * Defines who can see and modify a view.
 */
export const ViewSharingSchema = lazySchema(() => z.object({
  type: z.enum(['personal', 'collaborative']).default('collaborative').describe('View ownership type'),
  lockedBy: z.string().optional().describe('User who locked the view configuration'),
}).describe('View sharing and access configuration'));

/**
 * Row Color Configuration (Airtable-style)
 * Defines how rows are colored based on field values.
 */
export const RowColorConfigSchema = lazySchema(() => z.object({
  field: z.string().describe('Field to derive color from (typically a select/status field)'),
  colors: z.record(z.string(), z.string()).optional().describe('Map of field value to color (hex/token)'),
}).describe('Row color configuration based on field values'));

/**
 * Visualization Type Schema
 * Whitelist of visualization types the user can switch between.
 * Maps to Airtable's "Visualizations" setting in Appearance panel.
 */
export const VisualizationTypeSchema = lazySchema(() => z.enum([
  'grid',
  'kanban',
  'gallery',
  'calendar',
  'timeline',
  'gantt',
  'map',
  'chart',
  'tree',
]).describe('Visualization type that users can switch to'));

/**
 * User Actions Configuration Schema (Airtable Interface parity)
 * Controls which interactive actions are available to users in the view toolbar.
 * Each boolean toggles the corresponding toolbar element on/off.
 *
 * @see Airtable Interface → "User actions" panel
 */
export const UserActionsConfigSchema = lazySchema(() => z.object({
  sort: z.boolean().default(true).describe('Allow users to sort records'),
  search: z.boolean().default(true).describe('Allow users to search records'),
  filter: z.boolean().default(true).describe('Allow users to filter records'),
  rowHeight: z.boolean().default(true).describe('Allow users to toggle row height/density'),
  addRecordForm: z.boolean().default(false).describe('Add records through a form instead of inline'),
  editInline: z.boolean().default(false).describe('Allow users to edit records inline — click a cell to edit it with the field\'s type-aware widget (the same control the form uses). Off by default: the list is read-only unless the author opts in.'),
  buttons: z.array(z.string()).optional().describe('Custom action button IDs to show in the toolbar'),
}).describe('User action toggles for the view toolbar'));

/**
 * Appearance Configuration Schema (Airtable Interface parity)
 * Controls visual presentation options for the view.
 *
 * @see Airtable Interface → "Appearance" panel
 */
export const AppearanceConfigSchema = lazySchema(() => z.object({
  showDescription: z.boolean().default(true).describe('Show the view description text'),
  allowedVisualizations: z.array(VisualizationTypeSchema).optional()
    .describe('Whitelist of visualization types users can switch between (e.g. ["grid", "gallery", "kanban"])'),
}).describe('Appearance and visualization configuration'));

/**
 * View Tab Schema (Airtable Interface parity)
 * Defines a tab in a multi-tab view interface.
 * Each tab references a named list view and can be ordered, pinned, or set as default.
 *
 * @see Airtable Interface → "Tabs" panel
 */
export const ViewTabSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.describe('Tab identifier (snake_case)'),
  label: I18nLabelSchema.optional().describe('Display label'),
  icon: z.string().optional().describe('Tab icon name'),
  view: z.string().optional().describe('Referenced list view name from listViews'),
  filter: z.array(ViewFilterRuleSchema).optional().describe('Tab-specific filter criteria'),
  order: z.number().int().min(0).optional().describe('Tab display order'),
  pinned: z.boolean().default(false).describe('Pin tab (cannot be removed by users)'),
  isDefault: z.boolean().default(false).describe('Set as the default active tab'),
  visible: z.boolean().default(true).describe('Tab visibility'),
}).describe('Tab configuration for multi-tab view interface'));

/**
 * User Filter Field Schema (ADR-0047)
 * One field exposed as a quick-filter control in the end-user filter bar.
 * Rendering details (widget, options) default to inference from the field
 * definition on the source object — authors only override when needed.
 *
 * @see Airtable Interface → "User filters" panel (Dropdowns element)
 */
export const UserFilterFieldSchema = lazySchema(() => z.object({
  field: z.string().describe('Field name on the source object (must exist — checked by reference diagnostics)'),
  label: I18nLabelSchema.optional().describe('Display label override (defaults to the field label)'),
  type: z.enum(['select', 'multi-select', 'boolean', 'date-range', 'text']).optional()
    .describe('Filter control type. Omit to infer from the field definition'),
  options: z.array(z.object({
    value: z.union([z.string(), z.number(), z.boolean()]).describe('Option value'),
    label: I18nLabelSchema.describe('Option label'),
    color: z.string().optional().describe('Option color token/hex'),
  })).optional().describe('Static options. Omit to derive from the field definition (select options / lookup records)'),
  showCount: z.boolean().optional().describe('Show per-option record counts'),
  defaultValues: z.array(z.union([z.string(), z.number(), z.boolean()])).optional()
    .describe('Pre-selected values when the view loads'),
}).describe('Quick-filter field configuration'));

/**
 * User Filters Schema (ADR-0047, Airtable Interface parity)
 * The end-user-facing quick-filter surface above a list. The author picks the
 * element style and which fields/presets are exposed; end users combine them
 * at runtime (session-scoped — selections never persist as metadata).
 *
 * Distinct from `ListView.filter` (the always-on base criteria) and from the
 * advanced filter builder (`userActions.filter` toggle).
 *
 * @see Airtable Interface → "User filters" panel (Elements: tabs / dropdowns)
 */
export const UserFiltersSchema = lazySchema(() => z.object({
  // `toggle` is DEPRECATED (ADR-0047 §3.4a): it overlaps `tabs` (presets) and
  // `dropdown` (per-field values) without adding expressive power, needs
  // per-field defaultValues to be useful, and authoring tooling no longer
  // offers it (None / Tabs / Dropdown only). Kept in the enum so existing
  // configs keep rendering; do not author new `toggle` filters.
  element: z.enum(['dropdown', 'tabs', 'toggle']).default('dropdown')
    .describe('Filter control style: "dropdown" (per-field value selectors) or "tabs" (named presets). "toggle" is deprecated.'),
  fields: z.array(UserFilterFieldSchema).optional()
    .describe('Fields exposed as quick filters (dropdown/toggle elements)'),
  tabs: z.array(ViewTabSchema).optional()
    .describe('Named filter presets rendered as tabs (tabs element). Reuses ViewTabSchema'),
  showAllRecords: z.boolean().optional()
    .describe('Show an "All records" tab before the presets (tabs element)'),
}).describe('End-user quick-filter configuration (Airtable "User filters" parity)'));

/**
 * Add Record Configuration Schema (Airtable Interface parity)
 * Configures the "Add Record" entry point for a list view.
 *
 * @see Airtable Interface → "+ Add record" button
 */
export const AddRecordConfigSchema = lazySchema(() => z.object({
  enabled: z.boolean().default(true).describe('Show the add record entry point'),
  position: z.enum(['top', 'bottom', 'both']).default('bottom').describe('Position of the add record button'),
  mode: z.enum(['inline', 'form', 'modal']).default('inline').describe('How to add a new record'),
  formView: z.string().optional().describe('Named form view to use when mode is "form" or "modal"'),
}).describe('Add record entry point configuration'));

/**
 * Kanban Settings
 */
export const KanbanConfigSchema = lazySchema(() => z.object({
  groupByField: z.string().describe('Field to group columns by (usually status/select)'),
  summarizeField: z.string().optional().describe('Field to sum at top of column (e.g. amount)'),
  columns: z.array(z.string()).describe('Fields to show on cards'),
}));

/**
 * List Chart View Configuration (Airtable-style)
 * Configures aggregate chart visualizations (bar/line/pie/area/scatter)
 * when used as a `type: 'chart'` ListView. Distinct from the full-featured
 * `ChartConfigSchema` in `chart.zod.ts` (which is for embedded reports).
 */
export const ListChartConfigSchema = lazySchema(() => z.object({
  chartType: z.enum(['bar', 'line', 'pie', 'area', 'scatter']).default('bar').describe('Chart visualisation type'),
  /**
   * ADR-0021 — the semantic-layer `dataset` this chart binds to. Selects
   * dimensions/measures BY NAME so the chart's numbers stay consistent with
   * every other surface using the same dataset. This is the single author-facing
   * shape (the legacy inline `xAxisField` + `yAxisFields` + `aggregation` query
   * was removed in the cutover).
   */
  dataset: SnakeCaseIdentifierSchema.describe('Dataset name to bind (ADR-0021)'),
  /** Dimension names (from the dataset) for X / group / split. */
  dimensions: z.array(z.string()).optional().describe('Dimension names — X/group/split'),
  /** Measure names (from the dataset) for the value axis. */
  values: z.array(z.string()).min(1).describe('Measure names — Y (at least one)'),
}).describe('List chart view configuration'));

/**
 * Calendar Settings
 */
export const CalendarConfigSchema = lazySchema(() => z.object({
  startDateField: z.string(),
  endDateField: z.string().optional(),
  titleField: z.string(),
  colorField: z.string().optional(),
}));

/**
 * Quick filter dimension for the Gantt toolbar.
 */
export const GanttQuickFilterSchema = lazySchema(() => z.object({
  field: z.string().describe('Record field / dot-path the dimension filters on'),
  label: z.string().optional().describe('Trigger label (falls back to the field label)'),
  options: z.array(z.union([
    z.string(),
    z.object({
      value: z.union([z.string(), z.number()]),
      label: z.string().optional(),
    }),
  ])).optional().describe('Explicit option override for fixed enums'),
}));

/**
 * Gantt Settings
 *
 * Beyond the core timeline fields, the renderer supports a two-level
 * parent/child hierarchy (parentField/typeField), planned-vs-actual baselines,
 * dynamic grouping, a resource/workload view, hover tooltips and quick filters.
 */
export const GanttConfigSchema = lazySchema(() => z.object({
  startDateField: z.string(),
  endDateField: z.string(),
  titleField: z.string(),
  progressField: z.string().optional(),
  dependenciesField: z.string().optional(),
  colorField: z.string().optional().describe('Field that drives the bar color'),
  // Two-level hierarchy: a parent task id (summary bar) and a row type.
  parentField: z.string().optional().describe('Field holding the parent task id (builds the summary → step tree)'),
  typeField: z.string().optional().describe('Field whose value maps to task/summary/milestone'),
  // Planned-vs-actual reference bars.
  baselineStartField: z.string().optional().describe('Baseline (planned) start field'),
  baselineEndField: z.string().optional().describe('Baseline (planned) end field'),
  // Dynamic grouping: bucket leaf tasks under one synthesized summary per value.
  groupByField: z.string().optional().describe('Field to group leaf tasks by (synthesized summary rows)'),
  // Resource / workload view.
  resourceView: z.boolean().optional().describe('Render a per-resource workload histogram instead of the timeline'),
  assigneeField: z.string().optional().describe('Resource field to bucket load by (resource view)'),
  effortField: z.string().optional().describe('Per-task load units (resource view; default 1)'),
  capacity: z.number().optional().describe('Per-resource capacity ceiling; loads above this flag overload'),
  // Hover tooltip + quick filters.
  tooltipFields: z.array(z.union([
    z.string(),
    z.object({ field: z.string(), label: z.string().optional() }),
  ])).optional().describe('Fields to surface in the hover tooltip, in display order'),
  quickFilters: z.array(GanttQuickFilterSchema).optional().describe('Multi-select filter dropdowns rendered above the chart'),
  autoZoomToFilter: z.boolean().optional().describe('When true (default), filtering zooms the range to the filtered tasks'),
// Forward-compatible: the gantt renderer (objectui plugin-gantt) keeps adding
// config knobs (e.g. lockField / defaultCollapsedDepth) ahead of this schema.
// Passthrough lets those extra fields reach the renderer instead of being
// stripped here, so a renderer release no longer has to wait on a spec release.
}).passthrough());

/**
 * Tree (tree-grid) Settings
 *
 * Renders a self-referencing object as an indented, expand/collapse tree-grid.
 * Flat records are nested via a single-parent pointer field (`parentField`).
 * Unlike a fixed-depth `grouping`, a tree handles arbitrary depth (org charts,
 * category trees, BOMs, nested comments). When `parentField` is omitted the
 * renderer auto-detects the object's `tree`/self-reference field.
 */
export const TreeConfigSchema = lazySchema(() => z.object({
  parentField: z.string().optional().describe('Single-parent pointer field (auto-detected from the object schema when omitted)'),
  labelField: z.string().optional().describe('Field rendered indented in the first column (defaults to "name")'),
  fields: z.array(z.string()).optional().describe('Additional fields rendered as flat columns alongside the label'),
  defaultExpandedDepth: z.number().int().min(0).optional().describe('Initial expansion depth (0 = roots only; omit = expand all)'),
// Forward-compatible: let renderer-ahead config knobs reach plugin-tree.
}).passthrough());

/**
 * Navigation Mode Enum
 * Defines how to navigate to the detail view from a list item.
 */
export const NavigationModeSchema = lazySchema(() => z.enum([
  'page',       // Navigate to a new route (default)
  'drawer',     // Open details in a side drawer/panel
  'modal',      // Open details in a modal dialog
  'split',      // Show details side-by-side with the list (master-detail)
  'popover',    // Show details in a popover (lightweight)
  'new_window', // Open in new browser tab/window
  'none'        // No navigation (read-only list)
]));

/**
 * Navigation Configuration Schema
 */
export const NavigationConfigSchema = lazySchema(() => z.object({
  mode: NavigationModeSchema.default('page'),
  
  /** Target View Config */
  view: z.string().optional().describe('Name of the form view to use for details (e.g. "summary_view", "edit_form")'),
  
  /** Interaction Triggers */
  preventNavigation: z.boolean().default(false).describe('Disable standard navigation entirely'),
  openNewTab: z.boolean().default(false).describe('Force open in new tab (applies to page mode)'),
  
  /**
   * [#2578] Overlay size for a drawer/modal detail — coarse T-shirt buckets,
   * aligned with `FormView.modalSize` (`page` mode ignores it). `'auto'`
   * (default): the renderer derives the size from the object's field count and
   * clamps it to the client viewport, so AI writes nothing — it cannot know the
   * client width. Explicit buckets are a coarse, viewport-independent override.
   */
  size: z.enum(['auto', 'sm', 'md', 'lg', 'xl', 'full']).default('auto')
    .describe("[#2578] Overlay size bucket for drawer/modal detail: 'auto' (default — renderer derives from field count + viewport; AI writes nothing) or a coarse override sm/md/lg/xl/full. Prefer this over the pixel `width`; page mode ignores it."),

  /**
   * @deprecated [#2578 → `size`] A pixel/percent width cannot be authored blind:
   * the author (often an AI) does not know the client viewport. Kept only as a
   * renderer fallback for pre-#2578 metadata; new metadata sets `size` (or omits
   * it for `auto`).
   */
  width: z.union([z.string(), z.number()]).optional().describe('[DEPRECATED → size] Pixel/percent width of the drawer/modal (e.g. "600px"). A pixel width cannot be chosen at authoring time without knowing the client viewport — use the `size` bucket.'),
}));

/**
 * List View Schema (Expanded)
 * Defines how a collection of records is displayed to the user.
 * 
 * **NAMING CONVENTION:**
 * View names (when provided) are machine identifiers and must be lowercase snake_case.
 * 
 * @example Standard Grid
 * {
 *   name: "all_active",
 *   label: "All Active",
 *   type: "grid",
 *   columns: ["name", "status", "created_at"],
 *   filter: [["status", "=", "active"]]
 * }
 * 
 * @example Kanban Board
 * {
 *   type: "kanban",
 *   columns: ["name", "amount"],
 *   kanban: {
 *     groupByField: "stage",
 *     summarizeField: "amount",
 *     columns: ["name", "close_date"]
 *   }
 * }
 */
export const ListViewSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.optional().describe('Internal view name (lowercase snake_case)'),
  label: I18nLabelSchema.optional(), // Display label override (supports i18n)
  type: z.enum([
    'grid',       // Standard Data Table
    'kanban',     // Board / Columns
    'gallery',    // Card Deck / Masonry
    'calendar',   // Monthly/Weekly/Daily
    'timeline',   // Chronological Stream (Feed)
    'gantt',      // Project Timeline
    'map',        // Geospatial
    'chart',      // Aggregate visualisation
    'tree'        // Self-referencing hierarchy (tree-grid)
  ]).default('grid'),
  
  /** Data Source Configuration */
  data: ViewDataSchema.optional().describe('Data source configuration (defaults to "object" provider)'),
  
  /** Shared Query Config */
  columns: z.union([
    z.array(z.string()), // Legacy: simple field names
    z.array(ListColumnSchema), // Enhanced: detailed column config
  ]).describe('Fields to display as columns'),
  filter: z.array(ViewFilterRuleSchema).optional().describe('Filter criteria (JSON Rules)'),
  sort: z.union([
    z.string(), //Legacy "field desc"
    z.array(z.object({
      field: z.string(),
      order: z.enum(['asc', 'desc'])
    }))
  ]).optional(),
  
  /** Search & Filter */
  searchableFields: z.array(z.string()).optional().describe('Fields enabled for search'),
  filterableFields: z.array(z.string()).optional().describe('Legacy shorthand for userFilters.fields — bare field names enabled for end-user filtering. Prefer userFilters'),

  /** User Filters (ADR-0047, Airtable Interface parity) */
  userFilters: UserFiltersSchema.optional()
    .describe('End-user quick-filter bar: dropdown/toggle fields or tab presets. Omit to let the renderer derive filters from select/boolean fields'),

  /** Grid Features */
  resizable: z.boolean().optional().describe('Enable column resizing'),
  striped: z.boolean().optional().describe('Striped row styling'),
  bordered: z.boolean().optional().describe('Show borders'),
  compactToolbar: z.boolean().optional().describe('Collapse Group/Color/Density/Hide-fields into a single View settings popover'),

  /** Selection */
  selection: SelectionConfigSchema.optional().describe('Row selection configuration'),

  /** Navigation / Interaction */
  navigation: NavigationConfigSchema.optional().describe('Configuration for item click navigation (page, drawer, modal, etc.)'),

  /** Pagination */
  pagination: PaginationConfigSchema.optional().describe('Pagination configuration'),

  /** Type Specific Config */
  kanban: KanbanConfigSchema.optional(),
  calendar: CalendarConfigSchema.optional(),
  gantt: GanttConfigSchema.optional(),
  gallery: GalleryConfigSchema.optional(),
  timeline: TimelineConfigSchema.optional(),
  chart: ListChartConfigSchema.optional(),
  tree: TreeConfigSchema.optional(),

  /** View Metadata (Airtable-style view management) */
  description: I18nLabelSchema.optional().describe('View description for documentation/tooltips'),
  sharing: ViewSharingSchema.optional().describe('View sharing and access configuration'),

  /** Row Height / Density (Airtable-style) */
  rowHeight: RowHeightSchema.optional().describe('Row height / density setting'),

  /** Record Grouping (Airtable-style) */
  grouping: GroupingConfigSchema.optional().describe('Group records by one or more fields'),

  /** Row Color (Airtable-style) */
  rowColor: RowColorConfigSchema.optional().describe('Color rows based on field value'),

  /** Field Visibility & Ordering per View (Airtable-style) */
  hiddenFields: z.array(z.string()).optional().describe('Fields to hide in this specific view'),
  fieldOrder: z.array(z.string()).optional().describe('Explicit field display order for this view'),

  /** Row & Bulk Actions */
  rowActions: z.array(z.string()).optional().describe('Actions available for individual row items'),
  bulkActions: z.array(z.string()).optional().describe('Actions available when multiple rows are selected'),
  bulkActionDefs: z.array(z.record(z.string(), z.any())).optional().describe('Rich bulk action definitions (schema-driven, executed via BulkActionDialog)'),

  /** Performance */
  virtualScroll: z.boolean().optional().describe('Enable virtual scrolling for large datasets'),

  /** Conditional Formatting */
  conditionalFormatting: z.array(z.object({
    condition: ExpressionInputSchema.describe('Predicate (CEL) to evaluate.'),
    style: z.record(z.string(), z.string()).describe('CSS styles to apply when condition is true'),
  })).optional().describe('Conditional formatting rules for list rows'),

  /** Inline Edit */
  inlineEdit: z.boolean().optional().describe('Allow inline editing of records directly in the list view'),

  /** Export */
  exportOptions: z.array(z.enum(['csv', 'xlsx', 'pdf', 'json'])).optional().describe('Available export format options'),

  /** User Actions (Airtable Interface parity) */
  userActions: UserActionsConfigSchema.optional().describe('User action toggles for the view toolbar'),

  /** Appearance (Airtable Interface parity) */
  appearance: AppearanceConfigSchema.optional().describe('Appearance and visualization configuration'),

  /** Tabs (Airtable Interface parity) */
  tabs: z.array(ViewTabSchema).optional().describe('Tab definitions for multi-tab view interface'),

  /** Add Record (Airtable Interface parity) */
  addRecord: AddRecordConfigSchema.optional().describe('Add record entry point configuration'),

  /** Record Count Display (Airtable Interface parity) */
  showRecordCount: z.boolean().optional().describe('Show record count at the bottom of the list'),

  /** Advanced: Allow Printing (Airtable Interface parity) */
  allowPrinting: z.boolean().optional().describe('Allow users to print the view'),

  /** Empty State */
  emptyState: z.object({
    title: I18nLabelSchema.optional(),
    message: I18nLabelSchema.optional(),
    icon: z.string().optional(),
  }).optional().describe('Empty state configuration when no records found'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes for the list view'),

  /** Responsive layout overrides per breakpoint */
  responsive: ResponsiveConfigSchema.optional().describe('Responsive layout configuration'),

  /** Performance optimization settings */
  performance: PerformanceConfigSchema.optional().describe('Performance optimization settings'),
}));

/**
 * Form Field Configuration Schema
 * Detailed configuration for individual form fields.
 * 
 * Reuses Data.FieldType and related constraints from the Data protocol to avoid duplication.
 * The `type` field auto-infers widget rendering; explicit `widget` overrides are only needed
 * for custom components.
 * 
 * @example Auto-inferred select widget
 * { field: 'status', type: 'select', options: [{ label: 'Open', value: 'open' }] }
 * 
 * @example Lookup field with reference
 * { field: 'account_id', type: 'lookup', reference: 'account', label: 'Account' }
 * 
 * @example Custom widget override
 * { field: 'filter', widget: 'filter-builder' }
 */
export const FormFieldSchema: z.ZodType<any> = lazySchema(() => z.object({
  /** Field name (snake_case) */
  field: z.string().describe('Field name (snake_case)'),
  
  /** Field type — reuses Data.FieldType. When set, widget is auto-inferred (can be overridden). */
  type: FieldType.optional().describe('Field type (auto-infers widget if omitted)'),
  
  /** Select/multiselect options — only needed when type=select/multiselect/radio/checkboxes */
  options: z.array(SelectOptionSchema).optional().describe('Options for select/multiselect/radio/checkboxes fields'),
  
  /** Reference object for lookup/master_detail fields */
  reference: z.string().optional().describe('Target object name for lookup/master_detail fields'),
  
  /** Text constraints */
  maxLength: z.number().optional().describe('Maximum character length (for text/textarea/email/url/phone)'),
  minLength: z.number().optional().describe('Minimum character length'),
  
  /** Number constraints */
  min: z.number().optional().describe('Minimum value (for number/currency/percent/slider)'),
  max: z.number().optional().describe('Maximum value'),
  precision: z.number().optional().describe('Total digits (for number/currency)'),
  scale: z.number().optional().describe('Decimal places'),
  
  /** Multi-value flag */
  multiple: z.boolean().optional().describe('Allow multiple values (for select/lookup/file/image)'),
  
  /** UI overrides */
  label: I18nLabelSchema.optional().describe('Display label override'),
  placeholder: I18nLabelSchema.optional().describe('Placeholder text'),
  helpText: I18nLabelSchema.optional().describe('Help/hint text'),
  readonly: z.boolean().optional().describe('Read-only override'),
  immutable: z.boolean().optional().describe('Editable on create, locked once the record exists (e.g. machine names).'),
  required: z.boolean().optional().describe('Required override'),
  hidden: z.boolean().optional().describe('Hidden override'),
  colSpan: z.number().int().min(1).max(4).optional().describe('[legacy — prefer `span`] Absolute column span (1-4). Fragile when the column count is derived per surface (mobile 1 / modal 2 / page 3-4): a fixed span only lines up at the width the author imagined. The renderer clamps it to the current column count. Prefer `span`.'),
  /**
   * [#2578] Relative field width — decoupled from the (often auto-derived)
   * column count, so it stays correct at 1/2/3/4 columns.
   */
  span: z.enum(['auto', 'full']).default('auto').describe("Relative field width. 'auto' (default — omit it): the renderer sizes the field from its widget type × the current column count (wide widgets like textarea/richtext/json/file/subform take the whole row). 'full': whole row at any column count. Prefer this over the absolute `colSpan`."),

  /** Custom widget override — only needed when auto-inference is insufficient */
  widget: z.string().optional().describe('Custom widget/component name (overrides type-based inference)'),

  /** For `code` fields: source language (e.g. 'javascript', 'sql', 'json', 'typescript', 'expression', 'cel'). Drives syntax highlighting. */
  language: z.string().optional().describe('Code editor language (for type=code)'),

  /**
   * Sub-fields for `composite` / `repeater` / `record` types — declares
   * the inner shape of an embedded sub-object (composite), each row of
   * an embedded sub-object array (repeater), or each entry of a name-keyed
   * map (record). Recursive: any of the three can nest.
   *
   * Use `lookup` / `master_detail` instead when the children are independent
   * records with their own IDs in a separate object/table.
   */
  fields: z.array(z.lazy(() => FormFieldSchema)).optional()
    .describe('Sub-fields for composite/repeater/record types'),

  /**
   * For `record`-typed fields only. Declares how the map key is sourced,
   * displayed, and validated when an admin creates a new entry.
   *
   * The same identifier is also stored as `name` on the inner value (so
   * `record.fields[k].name === k`). Most callers can omit this and accept
   * the defaults: `{ field: 'name', label: 'Name', regex: /^[a-z_][a-z0-9_]*$/, immutable: true }`.
   *
   * See ADR-0007 (record form field type).
   */
  keyField: z.object({
    field: z.string().default('name').describe('Property name that holds the key inside each item (defaults to "name")'),
    label: I18nLabelSchema.optional().describe('Display label for the key column'),
    placeholder: I18nLabelSchema.optional().describe('Placeholder when entering a new key'),
    helpText: I18nLabelSchema.optional().describe('Help text under the key input'),
    /** Validation pattern serialised as a regex source string (no flags). */
    regex: z.string().optional().describe('JS regex source string the key must match (no flags)'),
    /** Renamable after creation? Defaults to false — keys are usually identifiers. */
    immutable: z.boolean().default(true).describe('If true, the key is read-only after creation'),
  }).optional().describe('Key column config for record-typed fields'),

  dependsOn: z.string().optional().describe('Parent field name for cascading'),
  visibleOn: ExpressionInputSchema.optional().describe('Visibility predicate (CEL).'),
  disclosure: z.enum(['inline', 'popover']).optional().describe('Composite rendering: inline bordered box (default) or a summary line + gear popover (progressive disclosure).'),
}));

/**
 * Form Layout Section
 */
export const FormSectionSchema = lazySchema(() => z.object({
  /**
   * Stable identifier for translation lookup. snake_case convention.
   * When provided, translation bundles can target this section's `label`
   * and `description` via `metadataForms.<type>.sections.<name>`.
   * Optional for backward-compat with sections that only have a `label`.
   */
  name: z.string().optional().describe('Stable section identifier for i18n lookup (snake_case)'),
  label: I18nLabelSchema.optional(),
  description: z.string().optional().describe('Optional description rendered under the section header.'),
  collapsible: z.boolean().default(false),
  collapsed: z.boolean().default(false),
  visibleOn: ExpressionInputSchema.optional().describe('Visibility predicate (CEL). Hides the whole section when false.'),
  columns: z.union([
    z.enum(['1', '2', '3', '4']),
    z.literal(1),
    z.literal(2),
    z.literal(3),
    z.literal(4),
  ]).default(1).transform(val => (typeof val === 'string' ? parseInt(val) : val) as 1 | 2 | 3 | 4),
  fields: z.array(z.union([
    z.string(), // Legacy: simple field name
    FormFieldSchema, // Enhanced: detailed field config
  ])),
}));

/**
 * Form View Schema
 * Defines the layout for creating or editing a single record.
 * 
 * @example Simple Sectioned Form
 * {
 *   type: "simple",
 *   sections: [
 *     {
 *       label: "General Info",
 *       columns: 2,
 *       fields: ["name", "status"]
 *     },
 *     {
 *       label: "Details",
 *       fields: ["description", { field: "priority", widget: "rating" }]
 *     }
 *   ]
 * }
 */
export const FormViewSchema = lazySchema(() => z.object({
  type: z.enum([
    'simple',  // Single column or sections
    'tabbed',  // Tabs
    'wizard',  // Step by step
    'split',   // Master-Detail split
    'drawer',  // Side panel
    'modal'    // Dialog
  ]).default('simple'),

  // --- Presentation options (per `type` variant). These mirror what the
  // ObjectForm component accepts so the protocol declares them; all optional. ---
  /** Field layout within the form body. */
  layout: z.enum(['vertical', 'horizontal', 'inline', 'grid']).optional().describe('Field layout direction'),
  /** Number of columns for the form body (grid/multi-column layouts). */
  columns: z.number().int().min(1).optional().describe('Number of columns for the form body'),
  /** Optional form title / description (for embedded or standalone forms). */
  title: z.string().optional().describe('Form title'),
  description: z.string().optional().describe('Form description'),
  /** Tabbed (`type: 'tabbed'`). */
  defaultTab: z.string().optional().describe('Initially active tab (tabbed forms)'),
  tabPosition: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Tab strip position (tabbed forms)'),
  /** Wizard (`type: 'wizard'`). */
  allowSkip: z.boolean().optional().describe('Allow skipping steps (wizard forms)'),
  showStepIndicator: z.boolean().optional().describe('Show the step indicator (wizard forms)'),
  /** Split (`type: 'split'`). */
  splitDirection: z.enum(['horizontal', 'vertical']).optional().describe('Split orientation (split forms)'),
  splitSize: z.number().optional().describe('Primary split panel size, % (split forms)'),
  splitResizable: z.boolean().optional().describe('Whether the split is resizable (split forms)'),
  /** Drawer (`type: 'drawer'`). */
  drawerSide: z.enum(['top', 'bottom', 'left', 'right']).optional().describe('Drawer side (drawer forms)'),
  /** @deprecated [#2578 → `modalSize` / size buckets] A pixel width can't be authored blind (unknown client viewport); the renderer derives width from content + viewport. */
  drawerWidth: z.string().optional().describe('[DEPRECATED → size buckets] Drawer width, e.g. "480px". A pixel width cannot be chosen without knowing the client viewport — the renderer derives it.'),
  /** Modal (`type: 'modal'`). */
  modalSize: z.enum(['sm', 'default', 'lg', 'xl', 'full']).optional().describe('Modal size (modal forms)'),

  /** Data Source Configuration */
  data: ViewDataSchema.optional().describe('Data source configuration (defaults to "object" provider)'),
  
  sections: z.array(FormSectionSchema).optional(), // For simple layout
  groups: z.array(FormSectionSchema).optional(), // Legacy support -> alias to sections

  /**
   * Inline child collections (master-detail). When present, the standard
   * create/edit form for this object renders as a master-detail form — the
   * object's own fields on top, an editable grid per child collection below,
   * persisted together in ONE atomic transaction — with no bespoke page. Each
   * entry needs only `childObject`; the relationship FK and grid columns are
   * derived from the child object's metadata (override via
   * `relationshipField` / `columns`).
   */
  subforms: z.array(z.object({
    childObject: z.string().describe('Child object whose records are entered inline'),
    relationshipField: z.string().optional().describe('FK on the child pointing back to the parent (auto-detected when omitted)'),
    columns: z.array(z.any()).optional().describe('Editable grid columns (derived from the child object when omitted)'),
    amountField: z.string().optional().describe('Numeric child column summed for the running total'),
    totalField: z.string().optional().describe('Parent field to receive the rolled-up sum'),
    title: z.string().optional().describe('Section title'),
    addLabel: z.string().optional().describe('Add-row button label'),
    minRows: z.number().optional(),
    maxRows: z.number().optional(),
  })).optional().describe('Inline master-detail child collections'),

  /** Default Sort for Related Lists (e.g., sort child records by date) */
  defaultSort: z.array(z.object({
    field: z.string().describe('Field name to sort by'),
    order: z.enum(['asc', 'desc']).default('desc').describe('Sort direction'),
  })).optional().describe('Default sort order for related list views within this form'),

  /** Public form sharing configuration */
  sharing: SharingConfigSchema.optional().describe('Public sharing configuration for this form'),

  /**
   * What happens after a successful submit.
   *
   * - `thank-you` (default) — show a confirmation panel
   * - `redirect` — send the browser to a URL
   * - `continue` — reset the form so another response can be entered
   * - `next-record` — advance to the next record (internal queues only)
   */
  submitBehavior: z.union([
    z.object({
      kind: z.literal('thank-you'),
      title: z.string().optional(),
      message: z.string().optional(),
    }),
    z.object({
      kind: z.literal('redirect'),
      url: z.string(),
      delayMs: z.number().int().min(0).optional(),
    }),
    z.object({ kind: z.literal('continue') }),
    z.object({ kind: z.literal('next-record') }),
  ]).optional().describe('Post-submit behavior'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes for the form view'),
}));

/**
 * ADR-0053 "views" mode — an object's default list + named list views.
 *
 * Structurally a {@link ListViewSchema} MINUS the page-only control `userFilters`:
 * that field belongs to a page list (`InterfaceListPage`, "filters" mode), never an
 * object list view, whose only nav control is the `ViewTabBar`. Omitting the field
 * makes the wrong-context state untypable at author time (tsc). Runtime parse still
 * STRIPS an authored `userFilters` silently (default strip, no throw) for back-compat,
 * and the CLI `validate` list-view-mode rule reports it pre-parse. See objectui #2219
 * and ADR-0053 phase 4.
 */
export const ObjectListViewSchema = lazySchema(() => ListViewSchema.omit({ userFilters: true }));

/**
 * Master View Schema
 * Can define multiple named views.
 */
/**
 * View Container Schema
 * Aggregates all view definitions for a specific object or context.
 * 
 * @example
 * {
 *   list: { type: "grid", columns: ["name"] },
 *   form: { type: "simple", fields: ["name"] },
 *   listViews: {
 *     "all": { label: "All", filter: [] },
 *     "my": { label: "Mine", filter: [["owner", "=", "{user_id}"]] }
 *   }
 * }
 */
export const ViewSchema = lazySchema(() => z.object({
    list: ObjectListViewSchema.optional(), // Default list view (views mode — no userFilters, ADR-0053)
    form: FormViewSchema.optional(), // Default form view
    listViews: z.record(z.string(), ObjectListViewSchema).optional().describe('Additional named list views (views mode — no userFilters, ADR-0053)'),
    formViews: z.record(z.string(), FormViewSchema).optional().describe('Additional named form views'),
  /**
   * ADR-0010 §3.7 — Package-level protection envelope. Package
   * authors declare lock policy here; the loader translates it
   * into the private `_lock` envelope at registration time and
   * strips this block before persistence. See
   * `shared/protection.zod.ts`.
   */
  protection: ProtectionSchema.optional().describe(
    'Package author protection block — lock policy for this view.',
  ),

  // ADR-0010 — runtime protection envelope (internal — set by loader).
  ...MetadataProtectionFields,

}));

/**
 * Type-safe factory for creating view definitions.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const taskViews = defineView({
 *   list: {
 *     type: 'grid',
 *     data: { provider: 'object', object: 'task' },
 *     columns: ['subject', 'status', 'priority', 'due_date'],
 *   },
 *   form: {
 *     type: 'simple',
 *     sections: [{ label: 'Details', fields: [{ field: 'subject' }] }],
 *   },
 * });
 * ```
 */
export function defineView(config: z.input<typeof ViewSchema>): View {
  return ViewSchema.parse(config);
}

// ───────────────────────────────────────────────────────────────────────────
// Independent View Item model (Object has-many View)
// ───────────────────────────────────────────────────────────────────────────
//
// The {@link ViewSchema} *container* above aggregates every view of an object
// into one document. That model cannot express runtime-authored views (a user
// adding "My high-value leads" at runtime cannot append to a developer's source
// file), and it forces multiple distinct views into a single designer.
//
// {@link ViewItemSchema} promotes each named view to a first-class, independently
// addressable entity bound to its object by a foreign key. The object↔view
// switcher is then a *query* (`getViewsByObject`) rather than embedded storage —
// mirroring Airtable / Salesforce / Notion, where a table/object has-many views.
//
// `defineView` is retained as authoring sugar: the backend loader expands an
// aggregated document into N ViewItems at registration time, so existing
// `*.view.ts` files and the published spec keep working unchanged.

/**
 * Qualified view-item identity: `<object>.<viewKey>` — dotted snake_case
 * segments, e.g. `crm_lead.pipeline`. Globally unique, and the object can be
 * recovered from the prefix, so the registry key never collides across objects.
 */
export const ViewItemNameSchema = z
  .string()
  .regex(
    /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/,
    'View item name must be a dotted snake_case qualified name, e.g. "crm_lead.pipeline".',
  )
  .describe('Globally-unique view id, `<object>.<viewKey>`.');

/**
 * Identity layer for a view item — its visibility scope and ownership.
 *
 * - `package`  — shipped from `*.view.ts` source / an installed package.
 *                Not deletable (reinstall restores it); customisable via an
 *                override layer; hideable from the switcher.
 * - `shared`   — authored at runtime, visible org-wide. Creating one is gated
 *                by the `view.manageShared` capability.
 * - `personal` — authored at runtime, scoped to `owner`. Any user with read
 *                access to the object may create one.
 *
 * Named `scope` (not `provenance`) to avoid colliding with the loader-set
 * `_provenance` envelope field, which tracks a different axis
 * (package | org | env-forced).
 */
export const ViewScopeSchema = z
  .enum(['package', 'shared', 'personal'])
  .describe('View identity layer: package | shared | personal.');

/** Discriminator for the kind of view a {@link ViewItemSchema} carries. */
export const ViewKindSchema = z
  .enum(['list', 'form'])
  .describe('Whether `config` is a ListView (list family) or a FormView.');

/**
 * Fields shared by every independent view item, regardless of kind. Returned
 * as a raw Zod shape so it composes into each discriminated-union member
 * without forcing eager schema construction.
 */
function viewItemBaseShape() {
  return {
    name: ViewItemNameSchema,
    object: z
      .string()
      .describe('Bound object name — the foreign key used to aggregate views.'),
    label: I18nLabelSchema.optional().describe('Display label (supports i18n).'),
    isDefault: z
      .boolean()
      .optional()
      .describe("Whether this is the object's default view in the switcher."),
    order: z
      .number()
      .int()
      .optional()
      .describe("Sort order within the object's view switcher / left rail."),
    scope: ViewScopeSchema.optional().describe(
      'Identity layer (defaults to `package` for source-loaded views).',
    ),
    owner: z
      .string()
      .optional()
      .describe('Owner user id — set when `scope` is `personal`.'),
    hidden: z
      .boolean()
      .optional()
      .describe('Hidden from the switcher (per-user / per-org declutter).'),
    /**
     * Package author protection block — same envelope as {@link ViewSchema};
     * the loader translates it into the private `_lock` envelope.
     */
    protection: ProtectionSchema.optional().describe(
      'Package author protection block — lock policy for this view.',
    ),
    // ADR-0010 — runtime protection envelope (internal — set by loader).
    ...MetadataProtectionFields,
  };
}

/**
 * Independent View Item — a single named view bound to one object.
 *
 * Discriminated on `viewKind`: a `list` item carries a {@link ListViewSchema}
 * config (grid / kanban / calendar / …), a `form` item carries a
 * {@link FormViewSchema} config.
 *
 * @example
 * ```ts
 * const pipeline = defineViewItem({
 *   name: 'crm_lead.pipeline',
 *   object: 'crm_lead',
 *   viewKind: 'list',
 *   label: 'Pipeline',
 *   config: {
 *     type: 'kanban',
 *     data: { provider: 'object', object: 'crm_lead' },
 *     columns: ['name', 'stage', 'amount'],
 *   },
 * });
 * ```
 */
export const ViewItemSchema = lazySchema(() =>
  z.discriminatedUnion('viewKind', [
    z.object({
      viewKind: z.literal('list'),
      config: ListViewSchema.describe('List-family view configuration.'),
      ...viewItemBaseShape(),
    }),
    z.object({
      viewKind: z.literal('form'),
      config: FormViewSchema.describe('Form view configuration.'),
      ...viewItemBaseShape(),
    }),
  ]),
);

/**
 * Type-safe factory for an independent {@link ViewItem}.
 *
 * Validates the config at creation time using Zod `.parse()`.
 *
 * @example
 * ```ts
 * const allLeads = defineViewItem({
 *   name: 'crm_lead.all',
 *   object: 'crm_lead',
 *   viewKind: 'list',
 *   isDefault: true,
 *   config: { type: 'grid', data: { provider: 'object', object: 'crm_lead' }, columns: ['name'] },
 * });
 * ```
 */
export function defineViewItem(config: z.input<typeof ViewItemSchema>): ViewItem {
  return ViewItemSchema.parse(config);
}

// ───────────────────────────────────────────────────────────────────────────
// defineView container → ViewItem expansion (shared by every loader)
//
// `defineView({ list, form, listViews, formViews })` aggregates an object's
// views into one document. Each registration path that ingests such a
// container (the ObjectQL engine boot loop AND the metadata HMR plugin) must
// expand it into N independent ViewItems registered under `<object>.<viewKey>`,
// so each view is individually addressable and `getViewsByObject()` can rebuild
// the switcher. The original container is ALSO kept under the bare `<object>`
// key for backward-compatible reads. This logic lives in `@objectstack/spec`
// (depended on by both objectql and metadata) so the two loaders cannot drift.

/** A ViewItem materialised from an aggregated container (always `package`). */
export interface ExpandedViewItem {
  name: string;
  object: string;
  viewKind: 'list' | 'form';
  label?: unknown;
  config: any;
  isDefault?: boolean;
  order: number;
  scope: 'package';
  /** Non-blocking expansion diagnostics (MetadataValidationResult wire shape).
   *  Present only when the item's name had to be rewritten to avoid a
   *  collision — loaders surface `warnings` in their boot/HMR logs and
   *  Studio can badge the view. */
  _diagnostics?: { valid: boolean; warnings: Array<{ path: string; message: string }> };
}

/** True when a raw view artifact still uses the aggregated container shape
 *  (and is not already an independent ViewItem, which carries `viewKind`). */
export function isAggregatedViewContainer(item: any): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.viewKind) return false; // already an independent ViewItem
  return Boolean(item.list || item.form || item.listViews || item.formViews);
}

/** Structural signature used to collapse a container's default `list`/`form`
 *  with a redundant `listViews`/`formViews` restatement of the same view (the
 *  common "default == listViews.all" authoring pattern). */
function viewSignature(v: any): string {
  if (!v || typeof v !== 'object') return '';
  try {
    return JSON.stringify({ type: v.type ?? null, label: v.label ?? null, columns: v.columns ?? null });
  } catch {
    return '';
  }
}

/** Allocate a collision-free `<object>.<key>` name within one expansion. */
function uniqueViewName(base: string, used: Set<string>): string {
  let name = base;
  let i = 2;
  while (used.has(name)) name = `${base}_${i++}`;
  used.add(name);
  return name;
}

/** Stamp a rename warning on an expanded item whose `<object>.<key>` name was
 *  already taken (e.g. `formViews.default` vs the implicit default `list`).
 *  The rename itself is kept for backward compatibility — this makes it LOUD:
 *  loaders log the warning and Studio can render it, so authors discover that
 *  references to the requested name (form action `target`s, navigation
 *  `viewName`s) resolve to a DIFFERENT view. */
function stampRenameWarning(item: ExpandedViewItem, requestedName: string): void {
  if (item.name === requestedName) return;
  item._diagnostics = {
    valid: true,
    warnings: [{
      path: 'name',
      message:
        `View key collision: '${requestedName}' is already registered by another view in this `
        + `defineView container (list and form views share one '<object>.<key>' namespace, and the `
        + `default 'list' implicitly claims '<object>.default'). This ${item.viewKind} view was `
        + `renamed to '${item.name}'. References targeting '${requestedName}' — form action `
        + `targets, navigation viewNames — will resolve to the OTHER view. Rename the view key `
        + `to something unique to remove this warning.`,
    }],
  };
}

function cloneViewConfig(v: any): any {
  try {
    return structuredClone(v);
  } catch {
    return JSON.parse(JSON.stringify(v));
  }
}

/**
 * A view-key collision detected while expanding one `defineView` container.
 *
 * List and form views share a single `<object>.<key>` namespace during
 * expansion (see {@link expandViewContainer}), and the default `list`
 * implicitly claims `<object>.default`. When a later view competes for a name
 * already taken, it is renamed (`<object>.<key>` → `<object>.<key>_2`) to keep
 * the runtime registry key unique. That rename is a silent footgun: references
 * to the requested name (form action `target`s, navigation `viewName`s) resolve
 * to the OTHER view. The build-time view-ref lint turns each collision into a
 * hard error so the author fixes the key instead of shipping a broken reference.
 */
export interface ViewKeyCollision {
  /** The `<object>.<key>` name that was already registered by an earlier view. */
  requested: string;
  /** The disambiguated name the colliding view was renamed to (e.g. `…_2`). */
  renamedTo: string;
  /** Which family the renamed (losing) view belongs to. */
  viewKind: 'list' | 'form';
  /** The raw author-supplied key that collided. */
  key: string;
}

/** Result of {@link expandViewContainerWithDiagnostics}. */
export interface ExpandViewResult {
  items: ExpandedViewItem[];
  collisions: ViewKeyCollision[];
}

/**
 * Expand an aggregated view container into independent ViewItems, ALSO reporting
 * every name collision that forced a rename.
 *
 * List family: `listViews` entries first (keys taken from the author), then the
 * default `list` — deduped by structural signature so a `listViews.all` that
 * merely restates `list` collapses into one item. The view matching the
 * declared default is flagged `isDefault`. Form family: `formViews` entries,
 * then the default `form`.
 *
 * Collisions are captured at the exact points the shared `used` set forces a
 * rename, so the diagnostic can never drift from the expansion it describes.
 */
export function expandViewContainerWithDiagnostics(object: string, container: any): ExpandViewResult {
  const out: ExpandedViewItem[] = [];
  const collisions: ViewKeyCollision[] = [];
  const used = new Set<string>();
  let order = 0;

  // ---- list family ----
  const listSigToName = new Map<string, string>();
  const listViews =
    container.listViews && typeof container.listViews === 'object' ? container.listViews : {};
  for (const [k, v] of Object.entries<any>(listViews)) {
    if (!v || typeof v !== 'object') continue;
    const requested = `${object}.${k}`;
    const name = uniqueViewName(requested, used);
    if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'list', key: k });
    listSigToName.set(viewSignature(v), name);
    const item: ExpandedViewItem = { name, object, viewKind: 'list', label: v.label, config: cloneViewConfig(v), order: order++, scope: 'package' };
    stampRenameWarning(item, requested);
    out.push(item);
  }
  const defaultList = container.list;
  let defaultListName: string | undefined;
  if (defaultList && typeof defaultList === 'object') {
    const dup = listSigToName.get(viewSignature(defaultList));
    if (dup) {
      defaultListName = dup; // already represented by a named listViews entry
    } else {
      const key = typeof defaultList.name === 'string' && defaultList.name ? defaultList.name : 'default';
      const requested = `${object}.${key}`;
      const name = uniqueViewName(requested, used);
      if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'list', key });
      const item: ExpandedViewItem = { name, object, viewKind: 'list', label: defaultList.label, config: cloneViewConfig(defaultList), order: order++, scope: 'package' };
      stampRenameWarning(item, requested);
      out.push(item);
      defaultListName = name;
    }
  }
  if (!defaultListName && out.length) defaultListName = out[0].name;
  for (const item of out) {
    if (item.viewKind === 'list' && item.name === defaultListName) item.isDefault = true;
  }

  // ---- form family ----
  const formStart = out.length;
  const formSigSeen = new Set<string>();
  const formViews =
    container.formViews && typeof container.formViews === 'object' ? container.formViews : {};
  for (const [k, v] of Object.entries<any>(formViews)) {
    if (!v || typeof v !== 'object') continue;
    const requested = `${object}.${k}`;
    const name = uniqueViewName(requested, used);
    if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'form', key: k });
    formSigSeen.add(viewSignature(v));
    const item: ExpandedViewItem = { name, object, viewKind: 'form', label: v.label, config: cloneViewConfig(v), order: order++, scope: 'package' };
    stampRenameWarning(item, requested);
    out.push(item);
  }
  const defaultForm = container.form;
  let defaultFormName: string | undefined;
  if (defaultForm && typeof defaultForm === 'object' && !formSigSeen.has(viewSignature(defaultForm))) {
    const key = typeof defaultForm.name === 'string' && defaultForm.name ? defaultForm.name : 'form';
    const requested = `${object}.${key}`;
    const name = uniqueViewName(requested, used);
    if (name !== requested) collisions.push({ requested, renamedTo: name, viewKind: 'form', key });
    const item: ExpandedViewItem = { name, object, viewKind: 'form', label: defaultForm.label, config: cloneViewConfig(defaultForm), order: order++, scope: 'package' };
    stampRenameWarning(item, requested);
    out.push(item);
    defaultFormName = name;
  }
  if (!defaultFormName && out.length > formStart) defaultFormName = out[formStart].name;
  for (let i = formStart; i < out.length; i++) {
    if (out[i].name === defaultFormName) out[i].isDefault = true;
  }

  return { items: out, collisions };
}

/**
 * Expand an aggregated view container into independent ViewItems.
 *
 * Thin wrapper over {@link expandViewContainerWithDiagnostics} that discards the
 * collision diagnostics — the shape every runtime loader consumes. Behaviour is
 * unchanged: colliding names are still renamed so the registry key stays unique.
 */
export function expandViewContainer(object: string, container: any): ExpandedViewItem[] {
  return expandViewContainerWithDiagnostics(object, container).items;
}

/**
 * Type-safe factory for a standalone {@link FormView} bound to a JSON Schema
 * rather than to an ObjectQL object.
 *
 * Use this for forms that edit **metadata** (e.g. `report.form.ts`,
 * `dashboard.form.ts`), **action inputs**, or **flow screens** — anywhere the
 * data shape is described by a Zod-derived JSON Schema instead of an Object
 * field set.
 *
 * The returned FormView is validated at definition time; the runtime form
 * renderer (`@object-ui/plugin-form`) inspects `data.provider === 'schema'`
 * and pulls field metadata from the resolved JSON Schema instead of from
 * ObjectQL.
 *
 * @example
 * ```ts
 * export const reportForm = defineForm({
 *   schemaId: 'report',
 *   type: 'tabbed',
 *   sections: [
 *     { label: 'Basics', columns: 2, fields: [
 *       { field: 'name' },
 *       { field: 'label' },
 *       { field: 'objectName', widget: 'ref:object' },
 *       { field: 'type' },
 *     ]},
 *     { label: 'Columns', fields: [{ field: 'columns', widget: 'master-detail' }] },
 *     { label: 'Advanced', collapsible: true, collapsed: true, fields: [
 *       { field: 'filter', widget: 'filter-builder' },
 *       { field: 'chart', widget: 'chart-config' },
 *     ]},
 *   ],
 * });
 * ```
 */
export function defineForm(
  config: Omit<z.input<typeof FormViewSchema>, 'data'> & { schemaId: string },
): FormView {
  const { schemaId, ...rest } = config;
  return FormViewSchema.parse({
    ...rest,
    data: { provider: 'schema', schemaId },
  });
}

export type View = z.infer<typeof ViewSchema>;
export type ViewItem = z.infer<typeof ViewItemSchema>;
export type ViewScope = z.infer<typeof ViewScopeSchema>;
export type ViewKind = z.infer<typeof ViewKindSchema>;
export type ListView = z.infer<typeof ListViewSchema>;
export type FormView = z.infer<typeof FormViewSchema>;
export type FormSection = z.infer<typeof FormSectionSchema>;
export type ListColumn = z.infer<typeof ListColumnSchema>;
export type FormField = z.infer<typeof FormFieldSchema>;
export type SelectionConfig = z.infer<typeof SelectionConfigSchema>;
export type NavigationConfig = z.infer<typeof NavigationConfigSchema>;
export type PaginationConfig = z.infer<typeof PaginationConfigSchema>;
export type ViewData = z.infer<typeof ViewDataSchema>;
export type HttpRequest = z.infer<typeof HttpRequestSchema>;
export type HttpMethod = z.infer<typeof HttpMethodSchema>;
export type ColumnSummary = z.infer<typeof ColumnSummarySchema>;
export type RowHeight = z.infer<typeof RowHeightSchema>;
export type GroupingConfig = z.infer<typeof GroupingConfigSchema>;
export type GalleryConfig = z.infer<typeof GalleryConfigSchema>;
export type TimelineConfig = z.infer<typeof TimelineConfigSchema>;
export type ListChartConfig = z.infer<typeof ListChartConfigSchema>;
export type ViewSharing = z.infer<typeof ViewSharingSchema>;
export type RowColorConfig = z.infer<typeof RowColorConfigSchema>;
export type VisualizationType = z.infer<typeof VisualizationTypeSchema>;
export type UserActionsConfig = z.infer<typeof UserActionsConfigSchema>;
export type AppearanceConfig = z.infer<typeof AppearanceConfigSchema>;
export type ViewTab = z.infer<typeof ViewTabSchema>;
export type UserFilterField = z.infer<typeof UserFilterFieldSchema>;
export type UserFilters = z.infer<typeof UserFiltersSchema>;
export type AddRecordConfig = z.infer<typeof AddRecordConfigSchema>;
