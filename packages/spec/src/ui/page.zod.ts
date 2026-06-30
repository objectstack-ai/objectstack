// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { SortItemSchema } from '../shared/enums.zod';
import { FilterConditionSchema } from '../data/filter.zod';
import { I18nLabelSchema, AriaPropsSchema } from './i18n.zod';
import { ResponsiveConfigSchema, ResponsiveStylesSchema } from './responsive.zod';
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
  'element:button', 'element:filter', 'element:form', 'element:record_picker', 'element:text_input'
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
  // Optional with an empty-object default. Many components carry no props
  // (record:activity, element:divider, …), and the platform's own default-page
  // synthesizer (buildDefaultPageSchema) emits nodes with props at the top
  // level rather than under `properties`. Requiring `properties` forced
  // `properties: {}` boilerplate and — worse — made every Studio attempt to
  // seed a record page from its object's synthesized default layout fail
  // validation ("regions.N.components.M.properties: expected record"), which
  // was the real reason record/home/app pages couldn't be created in Studio.
  properties: z.record(z.string(), z.unknown()).optional().default({}).describe('Component props passed to the widget. See component.zod.ts for schemas.'),
  
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

  /**
   * SDUI scoped responsive styles (ADR-0065). Per-breakpoint CSS-property maps
   * compiled to id-scoped CSS at render. The preferred styling channel for
   * metadata-authored pages — build-independent and collision-free, unlike raw
   * `className`. Prefer design-token values (`var(--space-6)`, `var(--surface)`).
   */
  responsiveStyles: ResponsiveStylesSchema.optional()
    .describe('Per-breakpoint scoped style maps (ADR-0065)'),

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
 * Local, in-memory page state. Runtime-live (ADR-0049): the renderer mounts the
 * declared variables, exposes them to expressions as `page.<name>`, and lets an
 * interactive element write one via `source`. A write re-evaluates dependent
 * `visibility` / binding predicates immediately — the master/detail and
 * filtered-dashboard pattern with no custom code.
 *
 * Binding direction: a variable names the **writer** component, not the other
 * way round. `{ name: 'selectedProjectId', source: 'project_picker' }` means the
 * component whose `id` is `project_picker` (e.g. an `element:record_picker`)
 * writes the user's selection into `selectedProjectId`; predicates then read it
 * as `page.selectedProjectId`.
 */
export const PageVariableSchema = lazySchema(() => z.object({
  name: z.string().describe('Variable name. Exposed to expressions as `page.<name>`.'),
  type: z.enum(['string', 'number', 'boolean', 'object', 'array', 'record_id']).default('string'),
  defaultValue: z.unknown().optional()
    .describe('Initial value. Defaults to a type-appropriate empty value when omitted.'),
  /** Source element binding — the component id that writes this variable. */
  source: z.string().optional()
    .describe('Component id that writes this variable (e.g. an element:record_picker whose `id` matches).'),
}));

// BlankPageLayoutItemSchema / BlankPageLayoutSchema removed — the `blank` page
// type has no renderer and was dropped from PageTypeSchema (framework#2265,
// enforce-or-remove); objectui dropped all references in objectui#1949.

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
 * **Liveness (ADR-0049 enforce-or-remove):** only types with a dedicated
 * renderer are authorizable. `record`, `home`, `app`, `utility`, and `list` are
 * live. Types once declared for "roadmap parity" but never given a renderer
 * (`dashboard`, `form`, `record_detail`, `record_review`, `overview`, `blank`)
 * have been REMOVED from this enum — a schema-valid-but-unrendered page type is
 * a false affordance: it passes validation, then breaks at runtime ("Unknown
 * component type"), which is especially dangerous when templates are AI-authored.
 * They are tracked in {@link PAGE_TYPE_ROADMAP} and re-enter the enum only when a
 * renderer ships. The `page-type-liveness` gate test asserts the enum never
 * re-grows a roadmap type.
 */
export const PageTypeSchema = lazySchema(() => z.enum([
  // Platform page types (Salesforce FlexiPage style) — region/component composition
  'record',         // Component-based record layout page with regions
  'home',           // Platform-level home/landing page
  'app',            // App-level page with navigation context
  'utility',        // Floating utility panel (e.g. notes, phone dialer)
  // Interface page type (Airtable parity). NOTE: grid/kanban/calendar/gallery/
  // timeline are NOT page types — they are visualizations of a `list` page
  // (interfaceConfig.appearance.allowedVisualizations).
  'list',           // Record list/grid surface with switchable visualizations + quick actions
]).describe('Page type — the page KIND. Only types with a dedicated renderer are authorizable; visualizations of a list page live in interfaceConfig, not here.'));

/**
 * Page types declared in the past for "roadmap parity" but removed from
 * {@link PageTypeSchema} because they never shipped a renderer (authoring one
 * produced a broken page at runtime). Kept here so the intent isn't lost: when a
 * renderer lands, move the type back into the enum (and, for high-risk surfaces,
 * add a liveness proof). ADR-0049 enforce-or-remove / spec liveness gate.
 */
export const PAGE_TYPE_ROADMAP = [
  'dashboard',      // KPI summary with charts/metrics
  'form',           // Data entry form
  'record_detail',  // Auto-generated single record field display
  'record_review',  // Sequential record review/approval (config: RecordReviewConfigSchema)
  'overview',       // Interface-level navigation/landing hub
  'blank',          // Free-form canvas (config: BlankPageLayoutSchema)
] as const;

// RecordReviewConfigSchema removed — the `record_review` page type has no
// renderer and was dropped from PageTypeSchema (framework#2265, enforce-or-remove);
// objectui dropped all references in objectui#1949.

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
  
  /**
   * Page-local state variables (ADR-0049). Runtime-live: the renderer mounts the
   * declared variables, exposes each to expressions as `page.<name>`, and lets an
   * interactive element write one via its `source` binding (e.g.
   * `element:record_picker` → `source`). A write re-evaluates dependent
   * `visibility` / binding predicates immediately — the master/detail and
   * filtered-dashboard pattern, with no custom code. See {@link PageVariableSchema}.
   */
  variables: z.array(PageVariableSchema).optional()
    .describe('Local page state, exposed to expressions as `page.<name>` and writable by interactive elements via `source` (master/detail, filtered dashboards).'),

  /** Context */
  object: z.string().optional().describe('Bound object (for Record pages)'),

  // recordReview / blankLayout fields removed — the record_review/blank page
  // types have no renderer and were dropped from PageTypeSchema (framework#2265);
  // objectui dropped all references in objectui#1949.

  /** Layout Template */
  template: z.string().default('default').describe('Layout template name (e.g. "header-sidebar-main")'),
  
  /** Regions & Content */
  // Optional with an empty-array default. Not every page authors regions:
  //   • list/interface pages render via `interfaceConfig` (regions unused);
  //   • `kind: 'slotted'` record pages render via `slots`;
  //   • a `kind: 'full'` record/home/app page with no regions falls back to
  //     the synthesized default layout (same surface a slotted page starts from).
  // Requiring it forced `regions: []` boilerplate on every list page and made
  // the Studio "New Page" form a dead-end for record/home/app pages (the form
  // has no region editor, so the required field could never be satisfied).
  regions: z.array(PageRegionSchema).optional().default([])
    .describe('Layout regions (header, main, sidebar, footer) with their components. Optional — list pages use interfaceConfig, slotted pages use slots, and an empty full page falls back to the synthesized default layout.'),
  
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
  kind: z.enum(['full', 'slotted', 'html', 'react', 'jsx']).default('full')
    .describe(
      "Page override mode. full | slotted = structured authoring; " +
      "html = author-written constrained JSX/HTML+Tailwind compiled (parsed, never " +
      "executed) to the tree (ADR-0080; the legacy value 'jsx' is a deprecated alias); " +
      "react = real-React source executed at render by the runtime (ADR-0081); it " +
      "runs author JS, so it is gated by a host capability that defaults ON and is " +
      "disabled server-side via the OS_PAGE_REACT=off env toggle.",
    ),

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

  /**
   * JSX-source authoring (ADR-0080). When `kind === 'jsx'`, `source` is the
   * source-of-truth: a constrained JSX/HTML+Tailwind text compiled by
   * `@objectstack/sdui-parser` into the SchemaNode tree at SAVE time — parse,
   * never execute. `regions` then hold the DERIVED tree (a cache; the source
   * wins on any mismatch). For `full`/`slotted` pages `source` is unused.
   */
  source: z.string().optional()
    .describe("Page source text. For kind==='html' (alias 'jsx') it is constrained JSX/HTML+Tailwind compiled to the tree by @objectstack/sdui-parser at save time (parse, never execute). For kind==='react' it is real React/JSX executed at render by @object-ui/react-runtime (trusted tier). Authoritative over `regions` in both."),
  /** Plugin namespaces the JSX source references — inferred at compile, checked at save AND load (ADR-0048 provenance). */
  requires: z.array(z.string()).optional()
    .describe('Plugin namespaces the JSX source references (validated at save and load)'),
}).superRefine((page, ctx) => {
  // ADR-0080/0081 + ADR-0078 (completeness): an html/react/jsx page with no
  // `source` is silently inert — fail loudly at author time, never render empty.
  const sourceKinds = ['html', 'react', 'jsx'];
  if (sourceKinds.includes(page.kind) && !(typeof page.source === 'string' && page.source.trim().length > 0)) {
    ctx.addIssue({
      code: 'custom',
      path: ['source'],
      message: `A ${page.kind} page requires a non-empty \`source\` (the source is the source-of-truth).`,
    });
  }
}));
// PageSchema's only cross-field rule is the ADR-0080 jsx-source completeness
// check above. It once also required `recordReview`/`blankLayout` and `slots`
// (all removed — unrendered roadmap / "required-but-unauthorable" Studio traps).

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
export type InterfacePageConfig = z.infer<typeof InterfacePageConfigSchema>;
