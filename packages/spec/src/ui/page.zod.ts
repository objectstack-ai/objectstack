// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';
import { ExpressionInputSchema } from '../shared/expression.zod';
import { normalizeVisibleWhen } from '../shared/visibility';
import { VISIBILITY_ONLY_STRICT_OPTIONS } from '../shared/editability-boundary';
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
import { strictObject } from '../shared/strict-object';
import { MetadataProtectionFields } from '../kernel/metadata-protection.zod';

/**
 * Shared history for this file (#4001).
 *
 * A page's failure mode is visual, and therefore easy to misread. A dropped key
 * renders a page — just not the one that was authored. The author sees output,
 * assumes the schema was understood, and goes looking for the mistake in their
 * layout rather than in their spelling.
 */
const PAGE_HISTORY =
  'Until #4001 closed this shape these were dropped silently — the page still rendered, '
  + 'without whatever the key was meant to configure.';

export const PageRegionSchema = lazySchema(() => strictObject({
  surface: 'this page region',
  history: PAGE_HISTORY,
  aliases: { id: 'name', region: 'name', children: 'components', items: 'components', content: 'components', size: 'width', span: 'width' },
}, {
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
  // `record:discussion` is `record:chatter`'s registration-preferred twin
  // (#8744): same renderer, same inputs, same `ComponentPropsMap` row, and the
  // default-page synthesizer emits it — it was authorable only through the
  // open string arm below, which is what let its props bag dodge the #5068
  // gate's dispatch.
  'record:details', 'record:highlights', 'record:related_list', 'record:activity', 'record:chatter', 'record:discussion', 'record:path', 'record:alert', 'record:quick_actions', 'record:reference_rail', 'record:history',
  // Navigation
  'app:launcher', 'nav:menu', 'nav:breadcrumb',
  // Utility
  'global:search', 'global:notifications', 'user:profile',
  // AI
  'ai:chat_window', 'ai:suggestion',
  // Content Elements (Airtable Interface parity)
  'element:text', 'element:number', 'element:image', 'element:divider',
  // Interactive Elements (Phase B — Element Library)
  // `element:filter` REMOVED (#9220, ADR-0049): retired at element grain — no
  // renderer ever shipped anywhere. Dropping the enum value is de-advertisement
  // only (the `type` union's open string arm still accepts any string); the
  // LOUD half of the retirement is `ElementFilterPropsSchema`'s retiredKey
  // tombstones, dispatched through the kept `ComponentPropsMap` row.
  'element:button', 'element:form', 'element:record_picker', 'element:text_input'
]);

/**
 * Element Data Source Schema
 * Per-element data binding for multi-object pages.
 * Overrides page-level object context so each element can query a different object.
 */
export const ElementDataSourceSchema = lazySchema(() => strictObject({
  surface: 'this element data source',
  history: PAGE_HISTORY,
  aliases: {
    objectName: 'object', from: 'object', source: 'object', entity: 'object',
    viewName: 'view', listView: 'view',
    filters: 'filter', where: 'filter', criteria: 'filter',
    orderBy: 'sort', sortBy: 'sort',
    top: 'limit', pageSize: 'limit', maxRecords: 'limit', count: 'limit',
  },
}, {
  object: z.string().describe('Object to query'),
  view: z.string().optional().describe('Named view to apply'),
  filter: FilterConditionSchema.optional().describe('Additional filter criteria'),
  sort: z.array(SortItemSchema).optional().describe('Sort order'),
  limit: z.number().int().positive().optional().describe('Max records to display'),
}));

/**
 * Page Component Schema
 * A configured instance of a UI component.
 *
 * Closed under ADR-0089 D3a. Its unknown-key error came from the bespoke
 * `strictVisibilityError` until #6619 folded that map into the shared
 * `strictObject` template's set-keyed `guidance` channel — same prescription,
 * now under `alias-integrity.test.ts` and with an edit-distance rename for the
 * page-component keys the hand-written map had no channel for (`classNam` →
 * `className`).
 *
 * ## A component gates VISIBILITY, not editability (#7887 — boundary, not gap)
 *
 * There is no `disabled`, `readonly` or `readonlyWhen` on a page component, and
 * that is a **deliberate boundary** ruled on 2026-08-12, not a slot nobody got
 * round to adding: **editability lives on fields.** A component decides whether
 * it renders at all (`visibleWhen`); whether an input inside it can be edited is
 * the field's own `readonly` / `readonlyWhen`, enforced by the field renderer
 * that owns the input. Nothing in the platform reads a component-level read-only
 * flag, so declaring one would ship the ADR-0049 declared-but-unenforced shape
 * this repo is retiring elsewhere.
 *
 * Writing one anyway stays a loud parse error — unchanged — and since #7887 that
 * error carries `EDITABILITY_BOUNDARY_KEYS`' prescription naming the field-level
 * keys, so the author is redirected instead of merely refused. A widget with its
 * own enabled/disabled notion expresses it inside {@link
 * PageComponentSchema.properties}, which is that widget's own contract
 * (`component.zod.ts`) and not this shape's.
 */
export const PageComponentSchema = lazySchema(() => strictObject({
  ...VISIBILITY_ONLY_STRICT_OPTIONS,
  // #8202 — the shape names ITSELF rather than inheriting the shared
  // `'this view/page schema'`. Since #7887 a `disabled` written here gets the
  // editability-boundary prescription while the same key on a form field gets
  // a rename pointer toward `readonly`; the two answers contradict each other
  // by design, so the message has to say which shape refused the key. Filed
  // per-shape because a table shared by three shapes cannot carry one shape's
  // name (#8199's placement rule).
  surface: 'this page component',
}, {
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

  /**
   * Conditional-visibility predicate (CEL) — the component is rendered only when
   * TRUE (ADR-0089, canonical `*When` name). Page predicates bind the live page
   * surface: `record` + `current_user` plus page state as `page.<var>`.
   */
  visibleWhen: ExpressionInputSchema.optional().describe("Visibility predicate (CEL) — component rendered only when TRUE. Binds `record`, `current_user`, `page.<var>`. e.g. \"page.selectedProjectId != ''\""),
  /** @deprecated ADR-0089 — use `visibleWhen`. Accepted and normalized to `visibleWhen` at parse. */
  visibility: ExpressionInputSchema.optional().describe('[DEPRECATED → `visibleWhen`] Visibility predicate (CEL). Normalized to `visibleWhen` at parse.'),

  /** Per-element data binding, overrides page-level object context */
  dataSource: ElementDataSourceSchema.optional().describe('Per-element data binding for multi-object pages'),

  /** Responsive layout overrides per breakpoint */
  responsive: ResponsiveConfigSchema.optional().describe('Responsive layout configuration'),

  /** ARIA accessibility attributes */
  aria: AriaPropsSchema.optional().describe('ARIA accessibility attributes'),
}).transform(normalizeVisibleWhen));

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
export const PageVariableSchema = lazySchema(() => strictObject({
  surface: 'this page variable',
  history: PAGE_HISTORY,
  aliases: { default: 'defaultValue', initial: 'defaultValue', initialValue: 'defaultValue', value: 'defaultValue', boundTo: 'source', writer: 'source', from: 'source', component: 'source' },
  guidance: {
    // The binding direction is the one thing authors reverse here, and the
    // JSDoc above spells it out — so say it at the point of the mistake too.
    target: 'the binding names the WRITER, not a target — `source` is the id of the component that writes this variable; readers reference it as `page.<name>`',
    bindTo: 'the binding names the WRITER, not a target — `source` is the id of the component that writes this variable; readers reference it as `page.<name>`',
  },
}, {
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
export const InterfacePageConfigSchema = lazySchema(() => strictObject({
  surface: 'this interface page configuration',
  history: PAGE_HISTORY,
  aliases: {
    object: 'source', objectName: 'source', sourceObject: 'source',
    fields: 'columns', columnList: 'columns',
    orderBy: 'sort', sortBy: 'sort',
    filter: 'filterBy', filters: 'filterBy', where: 'filterBy', baseFilter: 'filterBy',
    view: 'sourceView',
    actions: 'userActions', toolbar: 'buttons', toolbarButtons: 'buttons',
    quickFilters: 'userFilters', filterBar: 'userFilters',
    onRecordClick: 'recordAction', rowAction: 'recordAction', openIn: 'recordAction',
    createRecord: 'addRecord', newRecord: 'addRecord',
    showCount: 'showRecordCount', recordCount: 'showRecordCount',
    printable: 'allowPrinting', printing: 'allowPrinting',
  },
  guidance: {
    // The doc block on PageTypeSchema makes this point at length: the display
    // mode is a VISUALIZATION, not a page type, and it is configured here.
    visualization: "the display mode is chosen at runtime from `appearance.allowedVisualizations` (grid | kanban | calendar | gallery | timeline) — it is not a page-level key, and it is not a page `type`",
    visualizations: "use `appearance.allowedVisualizations` — the whitelist lives under `appearance`",
    kanban: "kanban is a VISUALIZATION of a `list` page, not a setting — allow it via `appearance.allowedVisualizations`",
    groupBy: 'grouping belongs to the visualization — configure it under `appearance`',
  },
}, {
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
export const PageSchema = lazySchema(() => strictObject({
  surface: 'this page',
  history: PAGE_HISTORY,
  aliases: {
    title: 'label', displayName: 'label',
    objectName: 'object', entity: 'object',
    pageType: 'type', kindType: 'type',
    layout: 'template', layoutTemplate: 'template',
    sections: 'regions', areas: 'regions', zones: 'regions',
    components: 'regions', children: 'regions',
    state: 'variables', params: 'variables', vars: 'variables',
    config: 'interfaceConfig', interface: 'interfaceConfig',
    profiles: 'assignedProfiles', assignedTo: 'assignedProfiles',
    default: 'isDefault',
    jsx: 'source', html: 'source', code: 'source', content: 'source',
    dependencies: 'requires', plugins: 'requires',
  },
  guidance: {
    // The removals this file's own comments record. Each was a page type or a
    // block with no renderer; deleting them left an author writing something
    // that had never worked and, until now, was not told so.
    recordReview:
      '`recordReview` was removed with the `record_review` page type (framework#2265) — it had '
      + 'no renderer, so the page validated and then failed at runtime. Use `type: \'record\'` with '
      + '`regions`, or `kind: \'slotted\'` to override individual slots.',
    blankLayout:
      '`blankLayout` was removed with the `blank` page type (framework#2265) — it had no renderer. '
      + 'A free-form page is `kind: \'html\'` with `source` (ADR-0080).',
    // `route` is the key an author reaches for first, and it has never existed.
    // The page's `name` IS its routing identity — this file's own naming
    // convention says so ("Page names are used in routing") — so a page that
    // declared `route: '/landing'` was routed by its name regardless, and the
    // author's chosen URL silently did nothing. The platform's own test suite
    // authored one for years; see `stack.test.ts`.
    route: '`route` is not a page key — a page is routed by its `name` (lowercase snake_case). Rename the page rather than declaring a path.',
    path: '`path` is not a page key — a page is routed by its `name` (lowercase snake_case).',
    url: '`url` is not a page key — a page is routed by its `name`. To link OUT to an address, use a navigation node on the app.',
    visibleWhen: 'page-level conditional rendering does not exist — put `visibleWhen` on the COMPONENT inside a region, or gate the page with `assignedProfiles`',
    permissions: 'a page is not permission-gated by a field — reach it through `assignedProfiles`, and gate the DATA it shows with the object\'s permission sets (which is what actually protects the records)',
  },
}, {
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
  slots: strictObject({
    surface: 'this slot map',
    history: PAGE_HISTORY,
    // The slot menu is a CLOSED v1 set (each slot has a `buildDefault*`
    // sub-builder behind it), so an unknown slot name is not a slot that will
    // start working later — it is content that never renders.
    aliases: { activity: 'discussion', chatter: 'discussion', comments: 'discussion', related: 'tabs', relatedLists: 'tabs', fields: 'details', body: 'details', banner: 'alerts', toolbar: 'actions', buttons: 'actions', summary: 'highlights' },
  }, {
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

  // ADR-0010 — runtime protection envelope (internal — set by the loader).
  // `page` is a registered metadata type, so `MetadataPlugin`'s loader stamps
  // `_packageId` / `_provenance` on it. Undeclared, they were dropped on every
  // parse — protection metadata lost on round-trip, and a hard 422 the day this
  // shape closed.
  ...MetadataProtectionFields,
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

export type Page = z.input<typeof PageSchema>;
/** Post-parse shape of {@link Page} — defaults applied, transforms run (ADR-0122). */
export type PageParsed = z.infer<typeof PageSchema>;

/**
 * Type-safe factory for a custom page. Validates at authoring time via
 * `.parse()` and accepts input-shape config (optional defaults, CEL
 * shorthand) — preferred over a bare `: Page` literal.
 */
export function definePage(config: z.input<typeof PageSchema>): PageParsed {
  return PageSchema.parse(config);
}
export type PageType = z.input<typeof PageTypeSchema>;
export type PageComponent = z.input<typeof PageComponentSchema>;
/** Post-parse shape of {@link PageComponent} — defaults applied, transforms run (ADR-0122). */
export type PageComponentParsed = z.infer<typeof PageComponentSchema>;
export type PageRegion = z.input<typeof PageRegionSchema>;
/** Post-parse shape of {@link PageRegion} — defaults applied, transforms run (ADR-0122). */
export type PageRegionParsed = z.infer<typeof PageRegionSchema>;
export type PageVariable = z.input<typeof PageVariableSchema>;
/** Post-parse shape of {@link PageVariable} — defaults applied, transforms run (ADR-0122). */
export type PageVariableParsed = z.infer<typeof PageVariableSchema>;
export type ElementDataSource = z.input<typeof ElementDataSourceSchema>;
export type InterfacePageConfig = z.input<typeof InterfacePageConfigSchema>;
/** Post-parse shape of {@link InterfacePageConfig} — defaults applied, transforms run (ADR-0122). */
export type InterfacePageConfigParsed = z.infer<typeof InterfacePageConfigSchema>;
export type PageComponentType = z.input<typeof PageComponentType>;
