// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { SortItemSchema } from '../shared/enums.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { ResponsiveConfigSchema } from './responsive.zod';
import {
  UserActionsConfigSchema,
  AppearanceConfigSchema,
  UserFiltersSchema,
  ViewFilterRuleSchema,
  AddRecordConfigSchema,
  ListColumnSchema,
} from './view.zod';

/**
 * Page Region Schema
 * A named region in the template where components are dropped.
 */
import { lazySchema } from '../shared/lazy-schema';
export const PageRegionSchema = lazySchema(() => z.object({
  name: z.string().describe('Region name (e.g. "sidebar", "main", "header")'),
  width: z.enum(['small', 'medium', 'large', 'full']).optional(),
  components: z.array(z.lazy(() => PageComponentSchema)).describe('Components in this region')
}));

/**
 * Standard Page Component Types
 */
export const PageComponentType = z.enum([
  // Structure
  'page:header', 'page:footer', 'page:sidebar', 'page:tabs', 'page:accordion', 'page:card', 'page:section',
  // Record Context
  'record:details', 'record:highlights', 'record:related_list', 'record:activity', 'record:chatter', 'record:path', 'record:alert', 'record:quick_actions', 'record:reference_rail', 'record:history',
  // Navigation
  'app:launcher', 'nav:menu', 'nav:breadcrumb',
  // Utility
  'global:search', 'global:notifications', 'user:profile',
  // AI
  'ai:chat_window', 'ai:suggestion',
  // Content Elements (Airtable Interface parity)
  'element:text', 'element:number', 'element:image', 'element:divider',
  // Interactive Elements (Phase B — Element Library)
  'element:button', 'element:filter', 'element:form', 'element:record_picker'
]);

/**
 * Element Data Source Schema
 * Per-element data binding for multi-object pages.
 * Overrides page-level object context so each element can query a different object.
 */
export const ElementDataSourceSchema = lazySchema(() => z.object({
  object: z.string().describe('Object to query'),
  view: z.string().optional().describe('Named view to apply'),
  filter: FilterConditionSchema.optional().describe('Additional filter criteria'),
  sort: z.array(SortItemSchema).optional().describe('Sort order'),
  limit: z.number().int().positive().optional().describe('Max records to display'),
}));

/**
 * Page Component Schema
 * A configured instance of a UI component.
 */
export const PageComponentSchema = lazySchema(() => z.object({
  /** Definition */
  type: z.union([
    PageComponentType,
    z.string()
  ]).describe('Component Type (Standard enum or custom string)'),
  id: z.string().optional().describe('Unique instance ID'),
  
  /** Configuration */
  label: I18nLabelSchema.optional(),
  properties: z.record(z.string(), z.unknown()).describe('Component props passed to the widget. See component.zod.ts for schemas.'),
  
  /** 
   * Event Handlers 
   * Map event names to Action expressions.
   * "onClick": "set_variable('userId', $event.id)"
   * "onRowSelect": "navigate_to('page_detail', { id: $event.id })"
   */
  events: z.record(z.string(), z.string()).optional().describe('Event handlers map'),

  /** Appearance */
  style: z.record(z.string(), z.string()).optional().describe('Inline styles or utility classes'),
  className: z.string().optional().describe('CSS class names'),

  /** Visibility Rule */
  visibility: ExpressionInputSchema.optional().describe('Visibility predicate (CEL).'),

  /** Per-element data binding, overrides page-level object context */
  dataSource: ElementDataSourceSchema.optional().describe('Per-element data binding for multi-object pages'),

  /** Responsive layout overrides per breakpoint */
  responsive: ResponsiveConfigSchema.optional().describe('Responsive layout configuration'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}));

/**
 * Page Variable Schema
 * Defines local state for the page.
 * Variables can be bound to interactive elements (e.g. element:record_picker, element:filter).
 */
export const PageVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name'),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'record_id']).default('string'),
  defaultValue: z.unknown().optional(),
  /** Source element binding (e.g. element:record_picker writes to this variable) */
  source: z.string().optional().describe('Component ID that writes to this variable'),
}));

/**
 * Blank Page Layout Item Schema
 * Positions a component on a free-form grid canvas.
 */
export const BlankPageLayoutItemSchema = lazySchema(() => z.object({
  componentId: z.string().describe('Reference to a PageComponent.id in the page'),
  x: z.number().int().min(0).describe('Grid column position (0-based)'),
  y: z.number().int().min(0).describe('Grid row position (0-based)'),
  width: z.number().int().min(1).describe('Width in grid columns'),
  height: z.number().int().min(1).describe('Height in grid rows'),
}));

/**
 * Blank Page Layout Schema
 * Free-form canvas composition with grid-based positioning.
 * Used when page type is 'blank' to enable drag-and-drop element placement.
 */
export const BlankPageLayoutSchema = lazySchema(() => z.object({
  columns: z.number().int().min(1).default(12).describe('Number of grid columns'),
  rowHeight: z.number().int().min(1).default(40).describe('Height of each grid row in pixels'),
  gap: z.number().int().min(0).default(8).describe('Gap between grid items in pixels'),
  items: z.array(BlankPageLayoutItemSchema).describe('Positioned components on the canvas'),
}));

/**
 * Page Type Schema
 * Unified page type enum covering both platform pages (Salesforce FlexiPage style)
 * and Airtable-inspired interface page types.
 *
 * **Page type is the page KIND, NOT a visualization.** How an interface (`list`)
 * page displays its records — grid / kanban / calendar / gallery / timeline — is a
 * *visualization*, configured via `interfaceConfig.appearance.allowedVisualizations`
 * and switched at runtime. Those are deliberately NOT page types: a kanban is a `list`
 * page shown as a board, not a distinct page kind. (Historically grid/kanban/calendar/
 * gallery/timeline appeared here; the runtime never branched on them — it always read
 * the visualization from `interfaceConfig` — so they were removed to stop misleading authors.)
 *
 * **Disambiguation of similar types:**
 * - `record` vs `record_detail`: `record` is a component-based layout page (FlexiPage style with regions),
 *   `record_detail` is a field-display page showing all fields of a single record (Airtable style).
 *   Use `record` for custom record pages with regions/components, `record_detail` for auto-generated detail views.
 * - `home` vs `overview`: `home` is the platform-level landing page (tab landing),
 *   `overview` is an interface-level navigation hub with links/instructions.
 *   Use `home` for app-level landing, `overview` for in-interface navigation hubs.
 * - `app` vs `utility` vs `blank`: `app` is an app-level page with navigation context,
 *   `utility` is a floating utility panel (e.g. notes, phone), `blank` is a free-form canvas
 *   for custom composition. They serve distinct layout purposes.
 *
 * **Implementation status:** only `record`, `home`, `app`, `utility`, and `list` have
 * dedicated renderers today; the remaining interface types (`dashboard`, `form`,
 * `record_detail`, `record_review`, `overview`, `blank`) are declared for roadmap parity
 * but currently fall back to the list renderer. The authoring form only offers the
 * implemented set (see `page.form.ts`) to avoid presenting dead options.
 */
export const PageTypeSchema = lazySchema(() => z.enum([
  // Platform page types (Salesforce FlexiPage style) — region/component composition
  'record',         // Component-based record layout page with regions
  'home',           // Platform-level home/landing page
  'app',            // App-level page with navigation context
  'utility',        // Floating utility panel (e.g. notes, phone dialer)
  // Interface page types (Airtable Interface parity) — data-driven surfaces.
  // NOTE: grid/kanban/calendar/gallery/timeline are NOT here — they are visualizations
  // of a `list` page (interfaceConfig.appearance.allowedVisualizations), not page types.
  'list',           // Record list/grid surface with switchable visualizations + quick actions
  'dashboard',      // [roadmap] KPI summary with charts/metrics
  'form',           // [roadmap] Data entry form
  'record_detail',  // [roadmap] Auto-generated single record field display
  'record_review',  // [roadmap] Sequential record review/approval
  'overview',       // [roadmap] Interface-level navigation/landing hub
  'blank',          // [roadmap] Free-form canvas for custom composition
]).describe('Page type — the page KIND (platform or interface). Visualizations of a list page live in interfaceConfig, not here.'));

/**
 * Record Review Config Schema
 * Configuration for a sequential record review/approval page.
 * Users navigate through records one-by-one, taking actions (approve/reject/skip).
 * Only applicable when page type is 'record_review'.
 */
export const RecordReviewConfigSchema = lazySchema(() => z.object({
  object: z.string().describe('Target object for review'),
  filter: FilterConditionSchema.optional().describe('Filter criteria for review queue'),
  sort: z.array(SortItemSchema).optional().describe('Sort order for review queue'),
  displayFields: z.array(z.string()).optional()
    .describe('Fields to display on the review page'),
  actions: z.array(z.object({
    label: z.string().describe('Action button label'),
    type: z.enum(['approve', 'reject', 'skip', 'custom'])
      .describe('Action type'),
    field: z.string().optional()
      .describe('Field to update on action'),
    value: z.union([z.string(), z.number(), z.boolean()]).optional()
      .describe('Value to set on action'),
    nextRecord: z.boolean().optional().default(true)
      .describe('Auto-advance to next record after action'),
  })).describe('Review actions'),
  navigation: z.enum(['sequential', 'random', 'filtered'])
    .optional().default('sequential')
    .describe('Record navigation mode'),
  showProgress: z.boolean().optional().default(true)
    .describe('Show review progress indicator'),
}));

/**
 * Interface Page Configuration Schema (Airtable Interface parity)
 * Page-level declarative configuration for Airtable-style interface pages.
 * Covers title/data binding, levels, filter by, appearance, user actions,
 * tabs, record count, add record, and advanced options (printing).
 *
 * @see Airtable Interface → right panel (Page / Data / Appearance / User filters / User actions / Advanced)
 */
export const InterfacePageConfigSchema = lazySchema(() => z.object({
  /** Data binding (ADR-0047: pages REFERENCE views, never restate them) */
  source: z.string().optional().describe('Source object name for the page'),

  // ADR-0047 (revised): the page carries its OWN view metadata — columns, sort
  // and base filter are defined directly here (Airtable parity: there is no
  // "inherit from a named view" concept). The page IS the view definition.
  columns: z.union([z.array(z.string()), z.array(ListColumnSchema)]).optional()
    .describe('Columns shown by the page. Blank = all object fields. Defined directly on the page (no view inheritance).'),
  sort: z.array(SortItemSchema).optional()
    .describe('Default sort order for the page, defined directly on the page.'),
  filterBy: z.array(ViewFilterRuleSchema).optional().describe('Always-on page filter (base filter).'),
  levels: z.number().int().min(1).optional().describe('Number of hierarchy levels to display'),

  /** @deprecated Back-compat only. Pre-revision pages inherited columns/filter/sort
   * from a named object view; new pages define `columns`/`sort`/`filterBy` directly.
   * Still honored at runtime as a fallback when the page has no own `columns`. */
  sourceView: z.string().optional()
    .describe('@deprecated Legacy named-view inheritance. Define columns/sort/filterBy on the page instead.'),

  /** Appearance — `appearance.allowedVisualizations` is the runtime visualization whitelist */
  appearance: AppearanceConfigSchema.optional().describe('Appearance and visualization configuration'),

  /** User filters (ADR-0047) */
  userFilters: UserFiltersSchema.optional()
    .describe('End-user quick-filter bar for this page (overrides the source view\'s userFilters)'),

  /** User actions */
  userActions: UserActionsConfigSchema.optional().describe('User action toggles'),

  /** Add record */
  addRecord: AddRecordConfigSchema.optional().describe('Add record entry point configuration'),

  /** Toolbar buttons — references to the source object's actions (ActionSchema).
   * Buttons ARE object actions (not free text): correct-by-construction. */
  buttons: z.array(z.string()).optional().describe("Toolbar buttons — names of the source object's actions to surface in the page toolbar"),

  /** How clicking a record opens its detail: 'drawer' (right-side peek panel,
   * default), 'page' (full-page navigate to the record route), 'modal', or
   * 'none' (rows not clickable). */
  recordAction: z.enum(['drawer', 'page', 'modal', 'none']).optional()
    .describe("How clicking a record opens its detail (drawer | page | modal | none). Default: drawer"),

  /** Record count */
  showRecordCount: z.boolean().optional().describe('Show record count at page bottom'),

  /** Advanced */
  allowPrinting: z.boolean().optional().describe('Allow users to print the page'),
}).describe('Interface-level page configuration (Airtable parity)'));

/**
 * Page Schema
 * Defines a composition of components for a specific context.
 * Supports both platform pages (Salesforce FlexiPage style: record, home, app, utility)
 * and interface pages (Airtable Interface style: dashboard, grid, kanban, record_review, etc.).
 * 
 * **NAMING CONVENTION:**
 * Page names are used in routing and must be lowercase snake_case.
 * Prefix with 'page_' is recommended for clarity.
 * 
 * @example Good page names
 * - 'page_dashboard'
 * - 'page_settings'
 * - 'home_page'
 * - 'record_detail'
 * 
 * @example Bad page names (will be rejected)
 * - 'PageDashboard' (PascalCase)
 * - 'Settings Page' (spaces)
 */
export const PageSchema = lazySchema(() => z.object({
  name: SnakeCaseIdentifierSchema.describe('Page unique name (lowercase snake_case)'),
  label: I18nLabelSchema,
  description: I18nLabelSchema.optional(),

  /** Icon (used in interface navigation) */
  icon: z.string().optional().describe('Page icon name'),
  
  /** Page Type */
  type: PageTypeSchema.default('record').describe('Page type'),
  
  /** Page State Definitions */
  variables: z.array(PageVariableSchema).optional().describe('Local page state variables'),

  /** Context */
  object: z.string().optional().describe('Bound object (for Record pages)'),

  /** Record Review Configuration (only for record_review pages) */
  recordReview: RecordReviewConfigSchema.optional()
    .describe('Record review configuration (required when type is "record_review")'),

  /** Blank Page Layout (only for blank pages) */
  blankLayout: BlankPageLayoutSchema.optional()
    .describe('Free-form grid layout for blank pages (used when type is "blank")'),
  
  /** Layout Template */
  template: z.string().default('default').describe('Layout template name (e.g. "header-sidebar-main")'),
  
  /** Regions & Content */
  regions: z.array(PageRegionSchema).describe('Defined regions with components'),
  
  /** Activation */
  isDefault: z.boolean().default(false),
  assignedProfiles: z.array(z.string()).optional(),

  /** Interface Page Configuration (Airtable Interface parity) */
  interfaceConfig: InterfacePageConfigSchema.optional()
    .describe('Interface-level page configuration (for Airtable-style interface pages)'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),

  /**
   * Override semantics for record pages.
   *
   * - `"full"` (default): the schema fully describes the page.
   * - `"slotted"`: the schema only provides overrides for one or more
   *   named slots (see `slots`). The default-page synthesizer fills
   *   in every slot the author did NOT override. Useful when you want
   *   to customize just the header / actions / one tab without
   *   re-authoring the rest of the page.
   *
   * Only meaningful when `type === 'record'`. Ignored otherwise.
   */
  kind: z.enum(['full', 'slotted']).default('full')
    .describe('Page override mode: full (default) or slotted (partial overrides)'),

  /**
   * Slot override map for slotted record pages.
   *
   * Each slot accepts a single PageComponent or an array. Slots not
   * provided fall through to the synthesized default.
   *
   * Slot menu (v1): header | actions | alerts | highlights | details |
   * tabs | discussion. Each slot is a full replacement at the slot
   * boundary — no deep merge, no patch operations. To compose default +
   * custom, call the corresponding `buildDefault*` sub-builder from the
   * renderer runtime (e.g. @object-ui/plugin-detail).
   *
   * Only honored when `kind === 'slotted'`.
   */
  slots: z.object({
    header: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
    actions: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
    alerts: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
    highlights: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
    details: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
    tabs: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
    discussion: z.union([PageComponentSchema, z.array(PageComponentSchema)]).optional(),
  }).optional().describe('Slot override map for slotted pages'),
}).superRefine((data, ctx) => {
  if (data.type === 'record_review' && !data.recordReview) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recordReview'],
      message: 'recordReview is required when type is "record_review"',
    });
  }
  if (data.type === 'blank' && !data.blankLayout) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['blankLayout'],
      message: 'blankLayout is required when type is "blank"',
    });
  }
  if (data.kind === 'slotted' && !data.slots) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['slots'],
      message: 'slots is required when kind is "slotted"',
    });
  }
}));

export type Page = z.infer<typeof PageSchema>;
/** Authoring input for {@link Page} — defaulted fields are optional. */
export type PageInput = z.input<typeof PageSchema>;

/**
 * Type-safe factory for a custom page. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Page` literal.
 */
export function definePage(config: z.input<typeof PageSchema>): Page {
  return PageSchema.parse(config);
}
export type PageType = z.infer<typeof PageTypeSchema>;
export type PageComponent = z.infer<typeof PageComponentSchema>;
export type PageRegion = z.infer<typeof PageRegionSchema>;
export type PageVariable = z.infer<typeof PageVariableSchema>;
export type ElementDataSource = z.infer<typeof ElementDataSourceSchema>;
export type RecordReviewConfig = z.infer<typeof RecordReviewConfigSchema>;
export type BlankPageLayoutItem = z.infer<typeof BlankPageLayoutItemSchema>;
export type BlankPageLayout = z.infer<typeof BlankPageLayoutSchema>;
export type InterfacePageConfig = z.infer<typeof InterfacePageConfigSchema>;
