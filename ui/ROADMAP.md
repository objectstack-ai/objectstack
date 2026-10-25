# ObjectUI Development Roadmap

> **Last Updated:** May 6, 2026
> **Current Published Version:** v3.3.2 (v3.3.0 was the first official release of all 39 packages)
> **Spec Version:** @objectstack/spec ^4.0.4 (UI sub-export remains backward compatible with the 3.3.x renderer)
> **Client Version:** @objectstack/client ^4.0.4
> **Target UX Benchmark:** 🎯 Airtable parity
> **Current Priority (next release window — end-user features first):**
> 1. **Mobile UX polish (round 3)** — finish Gantt/Map/Form mobile passes, dynamic widget widths (P1.9)
> 2. **Forms & data collection** — camera capture, image cropping, S3/Azure upload, dependent lookups (P1.2)
> 3. **Console — Import/Export** — field mapping UI, validation preview, async streaming export (P1.3)
> 4. **Cross-session undo persistence + visual undo timeline** (P1.4)
> 5. **Documentation refresh** — `content/docs/*` aligned with v4 spec & v3.3.2 package surface
>
> **Deferred (revisit after the end-user track ships):**
> - 🛑 **Console — Automation builder** (P1.6) — wait/timer UI, BPMN interop, execution dashboard. The v4 spec primitives are ready, but the visual builder is a power-user/admin surface; we are prioritising end-user CRUD/forms/views first.
> - 🛑 **Spec v4 native opt-ins** for the platform layer (CLI v4 plugin options, multi-tenant v4 resolver) — engine-level work, no immediate end-user impact.

> **Recently Completed (queued in `.changeset/` for next release):**
> - 🪟 Page-mode record forms — `editMode: 'page'` opens create/edit on a deep-linkable, refresh-safe full-screen route alongside the existing modal flow
> - 📱 Mobile UX rounds 1 & 2 — Kanban readability, Calendar mobile default, Timeline dot clipping, list/sidebar/record-detail polish
> - 🪟 `plugin-view` Manage Views dialog (replaces inline tab drag)
> - 🧭 App-shell view-tab strip for single-view objects + DropdownMenu propagation fix
> - ⚡ View metadata merging + request coalescing for duplicate `find()` queries
> - 🌐 Convention-based i18n for sidebars/breadcrumbs/charts/tables/dashboards
> - 🛠️ Lazy `MetadataProvider` (no full app/object/dashboard graph fetch at boot)
> - 🎨 Soft pill badge palette + class-based dark-mode variant centralisation

> **Previously Shipped Foundations:** AppShell Navigation · Designer Interaction · **View Config Live Preview Sync ✅** · Dashboard Config Panel · Airtable UX Polish · **Flow Designer ✅** · **App Creation & Editing Flow ✅** · **System Settings & App Management ✅** · **Right-Side Visual Editor Drawer ✅** · **Object Manager & Field Designer ✅** · **AI SDUI Chatbot (service-ai + vercel/ai) ✅** · **Unified Home Dashboard ✅** · **Unified Copilot Skills Architecture ✅**

---

## 📋 Executive Summary

ObjectUI is a universal Server-Driven UI (SDUI) engine built on React + Tailwind + Shadcn. It renders JSON metadata from the @objectstack/spec protocol into pixel-perfect, accessible, and interactive enterprise interfaces.

**Where We Are:** Foundation is **solid and shipping** — 39 packages published on npm, 99+ components, 6,700+ tests, 80 Storybook stories, 43/43 builds passing, ~85% protocol alignment. SpecBridge, Expression Engine, Action Engine, data binding, all view plugins (Grid/Kanban/Calendar/Gantt/Timeline/Map/Gallery), Record components, Report engine, Dashboard BI features, mobile UX, i18n (10 locales), WCAG AA accessibility, Console through Phase 20 (L3), **AppShell Navigation Renderer** (P0.1), **Flow Designer** (P2.4), **Feed/Chatter UI** (P1.5), **App Creation & Editing Flow** (P1.11), **System Settings & App Management** (P1.12), **Page/Dashboard Editor Console Integration** (P1.11), **Right-Side Visual Editor Drawer** (P1.11), **Console Engine Schema Integration** (P1.14), and **Unified Home Dashboard** (P1.7.1) — all ✅ complete. **ViewDesigner** has been removed — its capabilities (drag-to-reorder, undo/redo) are now provided by the ViewConfigPanel (right-side config panel).

**What Remains:** The gap to **Airtable-level UX** is primarily in:
1. ~~**AppShell** — No dynamic navigation renderer from spec JSON (last P0 blocker)~~ ✅ Complete
2. **Designer Interaction** — DataModelDesigner has undo/redo, field type selectors, inline editing, Ctrl+S save. ViewDesigner has been removed; its capabilities (drag-to-reorder columns via @dnd-kit, undo/redo via useConfigDraft history) are now integrated into ViewConfigPanel (right-side config panel) ✅
3. ~~**View Config Live Preview Sync** — Config panel changes sync in real-time for Grid, but `showSort`/`showSearch`/`showFilters`/`striped`/`bordered` not yet propagated to Kanban/Calendar/Timeline/Gallery/Map/Gantt (see P1.8.1)~~ ✅ Complete — all 7 phases of P1.8.1 done, 100% coverage across all view types
4. **Dashboard Config Panel** — Airtable-style right-side configuration panel for dashboards (data source, layout, widget properties, sub-editors, type definitions). Widget config live preview sync and scatter chart type switch ✅ fixed (P1.10 Phase 10). Dashboard save/refresh metadata sync ✅ fixed (P1.10 Phase 11). Data provider field override for live preview ✅ fixed (P1.10 Phase 12). Table/Pivot widget enhancements and context-aware config panel ✅ (P1.10 Phase 13).
5. **Console Advanced Polish** — Remaining upgrades for forms, import/export, automation, comments
6. **PWA Sync** — Background sync is simulated only

---

## 🔄 Spec v3.0.9 Upgrade Summary

> Upgraded from `@objectstack/spec v3.0.8` → `v3.0.9` on February 22, 2026. UI sub-export is unchanged; changes are in Automation, Kernel, Data, and API layers.

**New Protocol Capabilities (v3.0.9):**

| Area | What's New | Impact on ObjectUI |
|------|------------|-------------------|
| **Workflow Nodes** | `parallel_gateway`, `join_gateway`, `boundary_event` node types | ProcessDesigner (P2.1) & Automation builder (P1.6) |
| **BPMN Interop** | `BpmnImportOptions`, `BpmnExportOptions`, `BpmnInteropResult`, `BpmnElementMapping` | plugin-workflow BPMN import/export (P2.4) |
| **Wait/Timer Executors** | `WaitEventType` (condition/manual/webhook/timer/signal), `WaitExecutorConfig`, `WaitTimeoutBehavior` | Automation builder wait-step UI (P1.6) |
| **Execution Tracking** | `ExecutionLog`, `ExecutionStepLog`, `Checkpoint`, `ExecutionError`, `ExecutionStatus` | Automation execution history (P1.6) |
| **Flow Edges** | `conditional` edge type, `isDefault` flag | ProcessDesigner conditional routing (P2.1) |
| **Retry Config** | `backoffMultiplier`, `maxRetryDelayMs`, `jitter` on retry policy | Automation retry settings UI (P1.6) |
| **Flow Versioning** | `FlowVersionHistory`, `ConcurrencyPolicy`, `ScheduleState` | Flow version management & scheduling (P1.6) |
| **Data Export** | `ExportFormat`, `ExportJobStatus`, `CreateExportJobRequest` (export.zod) | Import/Export feature (P1.3) |
| **App Engine** | Optional `engine: { objectstack: string }` on App config | Version pinning support (P2.4) |
| **Package Upgrade** | `PackageArtifact`, `ArtifactChecksum`, `UpgradeContext`, `DependencyStatus` | Package management (P2.4) |
| **Kernel Enhancements** | `PluginBuildOptions`, `PluginPublishOptions`, `PluginValidateOptions`, `MetadataCategory`, `NamespaceConflictError` | Plugin development tooling (P2.4) |

**UI Sub-Export:** No breaking changes — `@objectstack/spec/ui` types are identical between v3.0.8 and v3.0.9.

---

## 🔄 Spec v4.0.x Upgrade Summary

> Upgraded `@objectstack/*` from `^3.3.1` → `^4.0.1` (currently `^4.0.4`) — see commit `e2cc613a`. ObjectUI packages remain on the `3.3.x` line because the **`@objectstack/spec/ui` sub-export is backward compatible**; the v4 changes land in Automation, Kernel, Data, Multi-Tenant, and API contracts (no UI breaking changes consumed yet).

**What this unlocks for ObjectUI (still TODO to surface in renderers):**

| Area | New in v4 | Where to surface |
|------|-----------|------------------|
| **Automation** | Refined `WaitEventConfig`, `ExecutionLog`/`Checkpoint` v4 shape, retry policy v4 (`backoffMultiplier`, `jitter`) | `plugin-workflow`, Automation builder (P1.6) |
| **Multi-Tenant** | Updated `TursoMultiTenantConfig`, `TenantResolverStrategy` v4 | `apps/console` tenant switch (server-enforced via `X-Tenant-ID`; the client-side `@object-ui/tenant` package was removed as dead surface, #2564) |
| **Data Export** | v4 `ExportJobStatus`/`CreateExportJobRequest` (streaming) | Console Import/Export (P1.3) |
| **Plugin Kernel** | `PluginBuildOptions`, `PluginPublishOptions`, `PluginValidateOptions`, `MetadataCategory`, `NamespaceConflictError` | `@object-ui/cli`, `@object-ui/create-plugin` (P2.4) |
| **Cloud Contracts** | `IAppLifecycleService`, `IDeployPipelineService`, `IProvisioningService` (refined) | `apps/console` deployment surface (P2.4) |

**Migration applied:**
- Bumped every direct dependency from `^3.3.1` → `^4.0.1` (later patched to `^4.0.4`).
- Fixed MSW discovery endpoint to match v4 protocol broker (commit `e2cc613a`).
- No UI metadata changes required — schemas authored against `@objectstack/spec/ui` keep working unchanged.

**Pending:**
- [ ] Surface v4 wait/timer executor in Automation builder UI (P1.6)
- [ ] Surface v4 streaming export status in Import/Export modal (P1.3)
- [ ] Adopt v4 `PluginBuildOptions`/`PluginPublishOptions` in `@object-ui/cli` (P2.4)

---

## 🔄 Spec v3.2.0 Upgrade Summary

> Upgraded from `@objectstack/spec v3.0.10` → `v3.2.0` on March 2, 2026. All `@objectstack/*` packages upgraded to v3.2.0.

**Breaking Changes Applied:**
- Actions with `type: 'api'` now require a `target` field (the API endpoint/handler name). Added `target` to all API actions across examples (CRM, todo, msw-todo, kitchen-sink).

---

## 🔄 Spec v3.0.10 Upgrade Summary

> Upgraded from `@objectstack/spec v3.0.9` → `v3.0.10` on February 25, 2026. UI sub-export adds new Zod schemas and `ViewFilterRule` type. Dashboard widgets now require `id` field. View filters must use object format.

**New Protocol Capabilities (v3.0.10):**

| Area | What's New | Impact on ObjectUI |
|------|------------|-------------------|
| **UI Schemas** | `DensityModeSchema`, `ThemeModeSchema`, `WcagContrastLevelSchema` Zod schemas | Re-exported from `@object-ui/types` for runtime validation |
| **View Filter Rules** | `ViewFilterRule`, `ViewFilterRuleSchema` — structured filter format `{ field, operator, value }` | All view filters migrated from tuple `['field', '=', 'value']` to object format |
| **Dashboard Widgets** | `id` field now required on `DashboardWidgetSchema` | All example dashboard widgets updated with explicit `id` |
| **Filter AST** | `isFilterAST`, `parseFilterAST`, `VALID_AST_OPERATORS` in data sub-export | Filter engine utilities (P2.4) |
| **Multi-Tenant** | `TursoMultiTenantConfig`, `TenantResolverStrategy`, `TenantDatabaseLifecycle` | Cloud multi-tenancy (P2.4) |
| **Contracts** | `IAppLifecycleService`, `IDeployPipelineService`, `IProvisioningService`, `ITenantRouter`, `ISchemaDiffService` | Cloud deployment & lifecycle (P2.4) |

**Breaking Changes Applied:**
- All CRM view filters converted from `['field', '=', 'value']` to `[{ field, operator: '=', value }]`
- All dashboard widgets (kitchen-sink, todo, CRM) given explicit `id` fields
- Todo active filter converted from `[['status', '!=', 'Done']]` to `[{ field: 'status', operator: '!=', value: 'Done' }]`

---

## 🎯 P0 — Must Ship (v1.0 Blockers)

### P0.1 AppShell & Navigation Renderer

> **Last remaining P0 blocker.** Without this, Console cannot render a sidebar from `AppSchema` JSON.

- [x] Implement `AppSchema` renderer consuming spec JSON (name, label, icon, branding)
- [x] Build navigation tree renderer (7 nav item types: object, dashboard, page, url, report, action, group)
- [x] Implement `NavigationAreaSchema` support (business domain partitioning)
- [x] Implement mobile navigation modes (drawer/bottom_nav — the third mode this line
      used to claim was declared but never had a read point, retired in objectui#3985)
- [x] Add permission guards (`requiredPermissions`, `visible`) on navigation items

---

## 🎯 P1 — UI-First: Airtable UX Parity

> **Priority #1.** All items below directly affect end-user experience. Target: indistinguishable from Airtable for core CRUD workflows.

### P1.1 Designer Interaction (DataModelDesigner)

> Source: ROADMAP_DESIGNER Phase 2. ViewDesigner has been removed — its capabilities (column reorder, undo/redo) are now provided by ViewConfigPanel.

**ViewDesigner:** _(Removed — replaced by ViewConfigPanel)_
- [x] Column drag-to-reorder via `@dnd-kit/core` (replace up/down buttons with drag handles)
- [x] Add `Ctrl+S`/`Cmd+S` keyboard shortcut to save
- [x] Add field type selector dropdown with icons from `DESIGNER_FIELD_TYPES`
- [x] Column width validation (min/max/pattern check)
- [x] Removed: ViewDesigner replaced by ViewConfigPanel (right-side config panel)
- [x] ViewConfigPanel upgraded: undo/redo integrated into `useConfigDraft` hook
- [x] ViewConfigPanel upgraded: drag-and-drop column sorting via `@dnd-kit/sortable`

**DataModelDesigner:**
- [x] Entity drag-to-move on canvas
- [x] Inline editing for entity labels (click to edit)
- [x] Field type selector dropdown (replaces hardcoded `'text'` type)
- [x] Confirmation dialogs for destructive actions (delete entity cascades to relationships)

**Shared Infrastructure:**
- [x] Implement `useDesignerHistory` hook (command pattern with undo/redo stacks)
- [x] Wire undo/redo to DataModelDesigner

### P1.2 Console — Forms & Data Collection

- [x] ModalForm responsive optimization: sections layout auto-upgrades modal size, slider for percent/progress fields, tablet 2-column layout
- [ ] Camera capture for mobile file upload
- [ ] Image cropping/rotation in file fields
- [ ] Cloud storage integration (S3, Azure Blob) for file upload
- [ ] Upload resume on network failure
- [ ] Advanced lookup: dependent lookups (filter based on other fields)
- [ ] Hierarchical lookups (parent-child relationships)
- [ ] Lookup result caching
- [x] Lookup field dynamic DataSource loading — popup fetches records via `DataSource.find()` with `$search` debounce, loading/error/empty states
- [x] Lookup field context DataSource — reads DataSource from SchemaRendererContext so forms work without explicit prop
- [x] Lookup field UX polish — arrow key navigation, description field display, quick-create entry, ARIA listbox roles
- [x] Enterprise Record Picker — `RecordPickerDialog` component with multi-column table, pagination, search; LookupField two-level interaction (quick-select + "Show All Results" → full picker); `lookup_columns` / `lookup_page_size` schema config
- [x] CRM Enterprise Lookup Metadata — all 14 lookup fields across 8 CRM objects configured with `lookup_columns` (type-aware cell rendering), `lookup_filters` (business-level base filters), `description_field`; uses post-create injection to bypass `ObjectSchema.create()` Zod stripping; 12 dedicated test cases
- [ ] Form conditional logic with branching
- [ ] Multi-page forms with progress indicator

### P1.3 Console — Import/Export Excellence

> **Spec v3.0.9** introduces a formal Data Export/Import Protocol (`export.zod`) with streaming export, import validation, field mapping templates, and scheduled export jobs.

- [ ] Excel (XLSX) export with formatting
- [ ] PDF export with custom formatting
- [ ] Export all data (not just visible rows)
- [ ] Custom column selection for export
- [ ] Scheduled exports via automation
- [ ] Export templates with custom formatting
- [ ] Import field mapping UI (map CSV columns to object fields)
- [ ] Import validation preview with error correction
- [ ] Duplicate detection during import
- [ ] Integrate spec v3.0.9 `ExportFormat` enum (json, csv, xlsx, jsonl, parquet)
- [ ] Integrate spec v3.0.9 `CreateExportJobRequest` / `ExportJobStatus` for async streaming exports
- [ ] Import template-based field mapping using spec protocol schemas

### P1.4 Console — Undo/Redo & History

- [ ] Cross-session undo stack persistence (survive page refresh)
- [ ] Undo grouping (batch multiple field changes as one undo step)
- [ ] Visual undo history panel (timeline of changes)
- [ ] Undo/redo for bulk operations

### P1.5 Console — Comments & Collaboration

- [x] @mention notification delivery (email/push)
- [x] Comment search across all records
- [x] Comment pinning/starring
- [x] Activity feed filtering (comments only / field changes only)
- [x] Airtable-style Feed/Chatter UI components (P0/P1/P2):
  - [x] `FeedItem`/`FieldChangeEntry`/`Mention`/`Reaction`/`RecordSubscription` types
  - [x] `RecordActivityTimeline` — unified timeline renderer (filter, pagination, actor display)
  - [x] `RecordChatterPanel` — sidebar/inline/drawer panel (collapsible)
  - [x] `CommentInput` — comment input with Ctrl+Enter submit
  - [x] `FieldChangeItem` — field change history (old→new display values)
  - [x] `MentionAutocomplete` — @mention autocomplete dropdown
  - [x] `SubscriptionToggle` — bell notification toggle
  - [x] `ReactionPicker` — emoji reaction selector
  - [x] `ThreadedReplies` — collapsible comment reply threading
  - [x] Comprehensive unit tests for all 6 core Feed/Chatter components (96 tests)
  - [x] Console `RecordDetailView` integration: `CommentThread` → `RecordChatterPanel` with `FeedItem[]` data model
  - [x] Documentation for Feed/Chatter plugin in `content/docs/plugins/plugin-detail.mdx` (purpose/use cases, JSON schema, props, and Console integration for `RecordChatterPanel`, `RecordActivityTimeline`, and related components)
### P1.6 Console — Automation

> **Spec v3.0.9** significantly expanded the automation/workflow protocol. New node types, BPMN interop, execution tracking, and wait/timer executors are now available in the spec.

- [ ] Multi-step automation builder (if-then chains)
- [ ] Scheduled automations (cron-based triggers)
- [ ] Webhook triggers and actions
- [ ] Email notification actions
- [ ] Automation execution history and logs
- [ ] Support new v3.0.9 workflow node types: `parallel_gateway`, `join_gateway`, `boundary_event`
- [ ] BPMN import/export interop (spec provides `BpmnImportOptions`, `BpmnExportOptions`, `BpmnInteropResult`)
- [ ] Wait/timer executor UI (`waitEventConfig`: condition, manual, webhook, timer, signal events)
- [ ] Execution tracking dashboard (`ExecutionLog`, `ExecutionStepLog`, `Checkpoint`, `ExecutionError`)
- [ ] Conditional edge support (`conditional` edge type, `isDefault` flag on edges)
- [ ] Enhanced retry configuration UI (`backoffMultiplier`, `maxRetryDelayMs`, `jitter`)
- [ ] Flow version history viewer (`FlowVersionHistory`)
- [ ] Concurrency policy configuration (`ConcurrencyPolicy`)

### P1.7 Console — Navigation Enhancements

- [x] AppShell `AppSchema` renderer (spec-driven sidebar from JSON)
- [x] Area switcher with grouped navigation
- [x] User-customizable sidebar (drag reorder, pin favorites)
- [x] Search within sidebar navigation
- [x] Console integration: Navigation search filtering (`filterNavigationItems` + `SidebarInput`)
- [x] Console integration: Badge indicators on navigation items (`badge` + `badgeVariant`)
- [x] Console integration: Drag reorder upgrade — replace HTML5 DnD with `@dnd-kit` via `NavigationRenderer`
- [x] Console integration: Navigation pin — `useNavPins` hook + `NavigationRenderer` `enablePinning`/`onPinToggle`
- [x] Console integration: `AppSchemaRenderer` slot system — `sidebarHeader`, `sidebarExtra`, `sidebarFooter` slots for Console customization
- [x] Navigation Sync Service — `useNavigationSync` hook auto-syncs App navigation tree on Page/Dashboard CRUD (create, delete, rename) with toast + undo
- [x] Navigation Sync auto-detection — `NavigationSyncEffect` component monitors metadata changes and auto-syncs navigation across ALL apps when pages/dashboards are added or removed
- [x] Navigation Sync all-apps convenience API — `sync*AllApps` methods iterate all apps without requiring explicit `appName`
- [x] **ListView Navigation Mode Fix** — All 6 navigation modes (page/drawer/modal/split/popover/new_window) now work correctly on row click:
  - ✅ `page` mode navigates to `/record/:recordId` detail page via React Router
  - ✅ `new_window` mode opens correct Console URL in a new browser tab (delegates to `onNavigate`)
  - ✅ `split` mode renders resizable split panels with main content + detail panel
  - ✅ `popover` mode falls back to compact dialog when no `popoverTrigger` is provided
  - ✅ `useNavigationOverlay` hook delegates `new_window` to `onNavigate` when available for app-specific URL control
  - ✅ plugin-view `handleRowClick` supports `split` and `popover` branches

### P1.7.1 Console — Unified Home Dashboard (Workspace) ✅

- [x] **HomePage component** — Unified landing page displaying all available applications
- [x] **Route integration** — `/home` route added with proper authentication guards
- [x] **App cards grid** — Responsive grid layout showing all active apps with icons, descriptions, and branding colors
- [x] **QuickActions section** — Quick access cards for creating apps, managing objects, and system settings
- [x] **Recent items** — Display recently accessed objects, dashboards, and pages using `useRecentItems` hook
- [x] **Starred items** — Display user-favorited items using `useFavorites` hook with star/unstar toggle
- [x] **Empty state** — Helpful guidance for new users with "Create First App" and "System Settings" CTAs
- [x] **i18n support** — All labels support internationalization via `useObjectTranslation`
- [x] **RootRedirect update** — Root path (`/`) now redirects to `/home` instead of first app
- [x] **Responsive design** — Mobile-friendly grid layouts that adapt to screen size
- [x] **Airtable/Notion UX pattern** — Inspired by industry-leading workspace home pages
- [x] **HomeLayout shell** — Lightweight layout wrapper with sticky top nav bar, Home branding, and user menu dropdown (Profile, Settings, Sign Out)
- [x] **Home page user menu** — Complete user menu dropdown in HomeLayout header with avatar, name, email, Profile/Settings/Sign Out actions
- [x] **Return-to-Home navigation** — "Home" entry in AppSidebar app switcher dropdown for navigating back to `/home` from any application

**Impact:** Users now have a unified workspace dashboard that provides overview of all applications, quick actions, and recent activity. This eliminates the previous behavior of auto-redirecting to the first app, giving users better control and visibility.

### P1.8 Console — View Config Panel (Phase 20)

- [x] Inline ViewConfigPanel for all view types (Airtable-style right sidebar)
- [x] Column visibility toggle from config panel
- [x] Column reorder (move up/down) from config panel with real-time preview
- [x] Sort/filter/group config from right sidebar
- [x] Type-specific options in config panel (kanban/calendar/map/gallery/timeline/gantt)
- [x] Unified create/edit mode (`mode="create"|"edit"`) — single panel entry point
- [x] Unified data model (`UnifiedViewConfig`) for view configuration
- [x] ViewDesigner removed — its capabilities replaced by ViewConfigPanel (right-side config panel)
- [x] Panel header breadcrumb navigation (Page > List/Kanban/Gallery)
- [x] Collapsible/expandable sections with chevron toggle
- [x] Data section: Sort by (summary), Group by, Prefix field, Fields (count visible)
- [x] Appearance section: Color, Field text color, Row height (icon toggle), Wrap headers, Show field descriptions, Collapse all by default
- [x] User actions section: Edit records inline (→ inlineEdit), Add/delete records inline, Navigation mode (page/drawer/modal/split/popover/new_window/none)
- [x] Calendar endDateField support
- [x] i18n for all 10 locales (en, zh, ja, de, fr, es, ar, ru, pt, ko)
- [x] **Live preview: ViewConfigPanel changes sync in real-time to all list types (Grid/Kanban/Calendar/Timeline/Gallery/Map)** _(all 7 phases complete — see P1.8.1 gap analysis below)_
  - ✅ `showSort` added to `ObjectViewSchema` and propagated through plugin-view (Grid only)
  - ✅ Appearance properties (`rowHeight`, `densityMode`) flow through `renderListView` schema for all view types
  - ✅ `gridSchema` in plugin-view includes `striped`/`bordered` from active view config (Grid only)
  - ✅ Plugin `renderContent` passes `rowHeight`, `densityMode`, `groupBy` to `renderListView` schema
  - ✅ `useMemo` dependency arrays expanded to cover full view config
  - ✅ `generateViewSchema` propagates `showSearch`/`showSort`/`showFilters`/`striped`/`bordered`/`color` from `activeView` for all view types (hardcoded `showSearch: false` removed)
  - ✅ Console `renderListView` passes `showSort`/`showSearch`/`showFilters`/`striped`/`bordered`/`color`/`filter`/`sort` to `fullSchema`
  - ✅ `NamedListView` type declares `showSearch`/`showSort`/`showFilters`/`striped`/`bordered`/`color` as first-class properties
  - ✅ `ListViewSchema` TypeScript interface and Zod schema include `showSearch`/`showSort`/`showFilters`/`color`
  - ✅ ViewConfigPanel refactored into Page Config (toolbar/shell) and ListView Config (data/appearance) sections
  - ✅ `NamedListView` type extended with 24 new properties: navigation, selection, pagination, searchableFields, filterableFields, resizable, densityMode, rowHeight, hiddenFields, exportOptions, rowActions, bulkActions, sharing, addRecord, conditionalFormatting, quickFilters, showRecordCount, allowPrinting, virtualScroll, emptyState, aria
  - ✅ `ListViewSchema` Zod schema extended with all new properties
  - ✅ ViewConfigPanel aligned to full `ListViewSchema` spec: navigation mode, selection, pagination, export sub-config, searchable/filterable/hidden fields, resizable, density mode, row/bulk actions, sharing, addRecord sub-editor, conditional formatting, quick filters, showRecordCount, allowPrinting, virtualScroll, empty state, ARIA accessibility
  - ✅ Semantic fix: `editRecordsInline` → `inlineEdit` field name alignment (i18n keys, data-testid, component label all unified to `inlineEdit`)
  - ✅ Semantic fix: `rowHeight` values aligned to full spec — all 5 RowHeight enum values (`compact`/`short`/`medium`/`tall`/`extra_tall`) now supported in NamedListView, ObjectGridSchema, ListViewSchema, Zod schema, UI, and ObjectGrid rendering (cell classes, cycle toggle, icon mapping)
  - ✅ `clickIntoRecordDetails` toggle added to UserActions section (NamedListView spec field — previously only implicit via navigation mode)
  - ✅ **Strict spec-order alignment**: All fields within each section reordered to match NamedListView property declaration order:
    - PageConfig: showSort before showFilters; allowExport before navigation (per spec)
    - Data: columns → filter → sort (per spec); prefixField after sort
    - Appearance: striped/bordered first, then color, wrapHeaders, etc. (per spec)
    - UserActions: inlineEdit before clickIntoRecordDetails (per spec)
  - ✅ **Spec source annotations**: Every field annotated with `// spec: NamedListView.*` or `// UI extension` comment
  - ✅ **Protocol suggestions documented**: description, _source, _groupBy, _typeOptions identified as UI extensions pending spec addition
  - ✅ **Comprehensive spec field coverage test**: All 44 NamedListView properties verified mapped to UI fields; field ordering validated per spec
  - ✅ i18n keys verified complete for en/zh and all 10 locale files
  - ✅ Console ObjectView fullSchema propagates all 18 new spec properties
  - ✅ PluginObjectView renderListView schema propagates all 18 new spec properties
  - ✅ Per-view-type integration tests added for Grid/Kanban/Calendar/Timeline/Gantt/Gallery/Map config sync (Phase 7 complete)
- [x] Conditional formatting rules (editor in Appearance section)

### P1.8.1 Live Preview — Gap Analysis & Phased Remediation

> **Ref:** Issue [#711](https://github.com/objectstack-ai/objectui/issues/711) — Right-side view config panel changes not syncing in real-time to all list types.

**Current Config Property Propagation Matrix:**

| Property | Grid | Kanban | Calendar | Timeline | Gallery | Map | Gantt |
|----------|:----:|:------:|:--------:|:--------:|:-------:|:---:|:-----:|
| `showSearch` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `showSort` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `showFilters` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `showHideFields` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `showGroup` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `showColor` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `showDensity` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `allowExport` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `rowHeight` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `densityMode` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `striped` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `bordered` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `groupBy` | N/A | ✅ | N/A | N/A | N/A | N/A | N/A |
| `color` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `filter`/`sort` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Type-specific options | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Root Causes (resolved):**
1. ~~**`generateViewSchema` (plugin-view):** Hardcodes `showSearch: false` for non-grid views~~ → Now propagates from `activeView`
2. ~~**Console `renderListView`:** Omits toolbar/display flags from `fullSchema`~~ → Now passes all config properties
3. ~~**`NamedListView` type:** Missing toolbar/display properties~~ → Added as first-class properties
4. ~~**Plugin `renderListView` schema missing toolbar flags:** `renderContent` → `renderListView` schema did not include `showSearch`/`showFilters`/`showSort`~~ → Now propagated (PR #771)
5. ~~**ListView toolbar unconditionally rendered:** Search/Filter/Sort buttons always visible regardless of schema flags~~ → Now conditionally rendered based on `schema.showSearch`/`showFilters`/`showSort` (PR #771); `userActions.sort`/`search`/`filter`/`rowHeight`/`addRecordForm` now override toolbar flags (Issue #737)
6. ~~**Hide Fields/Group/Color/Density buttons always visible:** No schema property to control visibility~~ → Added `showHideFields`/`showGroup`/`showColor`/`showDensity` with conditional rendering (Issue #719)
7. ~~**Export toggle broken:** ViewConfigPanel writes `allowExport: boolean` but ListView checks `exportOptions` object~~ → Export now checks both `exportOptions && allowExport !== false`; Console clears `exportOptions` when `allowExport === false` (Issue #719)
8. ~~**`hasExport` logic bug:** `draft.allowExport !== false` was always true when undefined~~ → Fixed to `draft.allowExport === true || draft.exportOptions != null` (Issue #719)
9. **No per-view-type integration tests:** Pending — tests verify config reaches `fullSchema`, but per-renderer integration tests still needed
10. ~~**`key={refreshKey}` on PluginObjectView:** Console wrapped PluginObjectView with `key={refreshKey}`, which only changed on save/create, preventing live preview of config changes~~ → Removed `key={refreshKey}`; props changes now flow naturally without remounting (Issue #784)
11. ~~**Navigation overlay not consuming `activeView.navigation`:** Detail overlay only read `objectDef.navigation`, ignoring view-level navigation config~~ → Navigation now uses priority: `activeView.navigation > objectDef.navigation > default drawer` (Issue #784)

**Phase 1 — Grid/Table View (baseline, already complete):**
- [x] `gridSchema` includes `striped`/`bordered` from `activeView`
- [x] `showSort`/`showSearch`/`showFilters` passed via `ObjectViewSchema`
- [x] `useMemo` dependency arrays cover all grid config
- [x] ListView toolbar buttons conditionally rendered based on `schema.showSearch`/`showFilters`/`showSort` (PR #771)
- [x] `renderListView` schema includes toolbar toggle flags (`showSearch`/`showFilters`/`showSort`) and display props (`striped`/`bordered`/`color`) (PR #771)
- [x] Hide Fields/Group/Color/Density toolbar buttons conditionally rendered via `showHideFields`/`showGroup`/`showColor`/`showDensity` (Issue #719)
- [x] Export button checks both `exportOptions` and `allowExport` (Issue #719)
- [x] `hasExport` logic fixed — no longer always true when `allowExport` is undefined (Issue #719)
- [x] ViewConfigPanel includes toggles for `showHideFields`/`showGroup`/`showColor`/`showDensity` (Issue #719)
- [x] `showHideFields`/`showGroup`/`showColor`/`showDensity`/`allowExport` propagated through Console `fullSchema` and PluginObjectView `renderListView` (Issue #719)
- [x] Full end-to-end data flow: all ViewConfigPanel props (`inlineEdit`/`wrapHeaders`/`clickIntoRecordDetails`/`addRecordViaForm`/`addDeleteRecordsInline`/`collapseAllByDefault`/`fieldTextColor`/`prefixField`/`showDescription`) propagated through Console `fullSchema` → PluginObjectView `renderListView` → ListView (Issue #719)
- [x] ListView forwards `striped`/`bordered`/`wrapHeaders` to child `viewComponentSchema` (grid gets `wrapHeaders`, all views get `striped`/`bordered`) (Issue #719)
- [x] ViewConfigPanel includes `striped`/`bordered` toggles in Appearance section (Issue #719)
- [x] Type definitions complete: `NamedListView` + `ListViewSchema` + Zod schema include all 22 view-config properties (Issue #719)

**Phase 2 — Kanban Live Preview:**
- [x] Propagate `showSort`/`showSearch`/`showFilters` through `generateViewSchema` kanban branch
- [x] Pass `color`/`striped`/`bordered` in `renderContent` → `renderListView` for kanban
- [x] Ensure `groupBy` config changes reflect immediately (currently ✅ via `renderListView`)
- [x] Add integration test: ViewConfigPanel kanban config change → Kanban renderer receives updated props

**Phase 3 — Calendar Live Preview:**
- [x] Propagate `showSort`/`showSearch`/`showFilters` through `generateViewSchema` calendar branch
- [x] Pass `filter`/`sort`/appearance properties to calendar renderer in real-time
- [x] Verify `startDateField`/`endDateField` config changes trigger re-render via `useMemo` deps
- [x] Add integration test: ViewConfigPanel calendar config change → Calendar renderer receives updated props

**Phase 4 — Timeline/Gantt Live Preview:**
- [x] Propagate `showSort`/`showSearch`/`showFilters` through `generateViewSchema` timeline/gantt branches
- [x] Pass appearance properties (`color`, `striped`, `bordered`) through `renderListView` schema
- [x] Ensure `dateField`/`startDateField`/`endDateField` config changes trigger re-render
- [x] Add integration tests for timeline and gantt config sync

**Phase 5 — Gallery & Map Live Preview:**
- [x] Propagate `showSort`/`showSearch`/`showFilters` through `generateViewSchema` gallery/map branches
- [x] Pass appearance properties through `renderListView` schema for gallery/map
- [x] Ensure gallery `imageField`/`titleField` and map `locationField`/`zoom`/`center` config changes trigger re-render
- [x] Add integration tests for gallery and map config sync

**Phase 6 — Data Flow & Dependency Refactor:**
- [x] Add `showSearch`/`showSort`/`showFilters`/`striped`/`bordered`/`color` to `NamedListView` type in `@object-ui/types`
- [x] Add `showHideFields`/`showGroup`/`showColor`/`showDensity`/`allowExport` to `NamedListView` and `ListViewSchema` types and Zod schema (Issue #719)
- [x] Add `inlineEdit`/`wrapHeaders`/`clickIntoRecordDetails`/`addRecordViaForm`/`addDeleteRecordsInline`/`collapseAllByDefault`/`fieldTextColor`/`prefixField`/`showDescription` to `NamedListView` and `ListViewSchema` types and Zod schema (Issue #719)
- [x] Update Console `renderListView` to pass all config properties in `fullSchema`
- [x] Audit all `useMemo`/`useEffect` dependency arrays in `plugin-view/ObjectView.tsx` for missing `activeView` sub-properties — all hooks correctly use whole `activeView` object reference; React shallow equality handles sub-property changes
- [x] Remove hardcoded `showSearch: false` from `generateViewSchema` — use `activeView.showSearch ?? schema.showSearch` instead

**Phase 7 — End-to-End Integration Tests:**
- [x] Per-view-type test: Grid config sync (showSort, showSearch, showFilters, striped, bordered)
- [x] Per-view-type test: Kanban config sync (groupBy, color, showSearch)
- [x] Per-view-type test: Calendar config sync (startDateField, endDateField, showFilters)
- [x] Per-view-type test: Timeline/Gantt config sync (dateField, appearance)
- [x] Per-view-type test: Gallery config sync (imageField, titleField, appearance)
- [x] Per-view-type test: Map config sync (locationField, zoom, center, appearance)
- [x] Cross-view-type test: Switch view type in ViewConfigPanel → verify config properties transfer correctly

### P1.10 Console — Dashboard Config Panel

> Airtable-style right-side configuration panel for dashboards. Phased rollout from shared infrastructure to full type-safe editing.

**Phase 0 — Component Infrastructure:**
- [x] Extract `ConfigRow` / `SectionHeader` from `ViewConfigPanel` into `@object-ui/components` as reusable primitives
- [x] Implement `useConfigDraft` generic hook for draft state management (dirty tracking, save/discard)
- [x] Define `ConfigPanelSchema` / `ConfigSection` / `ConfigField` types for schema-driven panel generation
- [x] Implement `ConfigFieldRenderer` supporting input/switch/select/checkbox/slider/color/icon-group/field-picker/filter/sort/custom
- [x] Implement `ConfigPanelRenderer` — schema-driven panel with header, breadcrumb, collapsible sections, sticky footer
- [x] Add `configPanel` i18n keys to all 10 locale files

**Phase 1 — Dashboard-Level Config Panel:**
- [x] Develop `DashboardConfigPanel` supporting layout (columns/gap/rowHeight), data (refreshInterval), appearance (title/description/theme)
- [x] Add Storybook stories for `ConfigPanelRenderer` and `DashboardConfigPanel`
- [x] Add Vitest tests (65 tests: useConfigDraft 10, ConfigFieldRenderer 22, ConfigPanelRenderer 21, DashboardConfigPanel 12)

**Phase 2 — Widget-Level Configuration:**
- [x] Support click-to-select widget → sidebar switches to widget property editor (title, type, data binding, layout)
- [x] Implement `WidgetConfigPanel` with schema-driven fields: general (title, description, type), data binding (object, categoryField, valueField, aggregate), layout (width, height), appearance (colorVariant, actionUrl)
- [x] Add Vitest tests (14 tests for WidgetConfigPanel)

**Phase 3 — Sub-Editor Integration:**
- [x] Integrate `FilterBuilder` for dashboard global filters (ConfigFieldRenderer `filter` type now renders inline FilterBuilder)
- [x] Integrate `SortBuilder` for sort configuration (ConfigFieldRenderer `sort` type now renders inline SortBuilder)
- [x] Add `fields` prop to `ConfigField` type for filter/sort field definitions
- [ ] Dropdown filter selector and action button sub-panel visual editing

**Phase 4 — Composition & Storybook:**
- [x] Build `DashboardWithConfig` composite component (dashboard + config sidebar)
- [x] Support widget selection → WidgetConfigPanel switch with back navigation
- [x] Add Storybook stories for `WidgetConfigPanel`, `DashboardWithConfig`, and `DashboardWithConfigClosed`
- [x] Add Vitest tests (9 tests for DashboardWithConfig)

**Phase 5 — Type Definitions & Validation:**
- [x] Add `DashboardConfig` types to `@object-ui/types`
- [x] Add Zod schema validation for `DashboardConfig`

**Phase 6 — Design Mode Preview Click-to-Select:**
- [x] Add `designMode`, `selectedWidgetId`, `onWidgetClick` props to `DashboardRenderer` for preview-area widget selection
- [x] Implement click-to-select with primary ring highlight (light/dark theme compatible, a11y focus-visible ring)
- [x] Click empty space to deselect; Escape key to deselect
- [x] Keyboard navigation: ArrowRight/ArrowDown to next widget, ArrowLeft/ArrowUp to previous, Enter/Space to select, Tab/Shift+Tab for focus
- [x] Add `selectedWidgetId` and `onWidgetSelect` props to `DashboardEditor` for external controlled selection
- [x] Sync selection between `DashboardRenderer` (preview) and `DashboardEditor` (drawer) via shared state in `DashboardView`
- [x] Property changes in editor panel instantly reflected in preview (live preview path verified end-to-end)
- [x] Auto-save property changes to backend via DesignDrawer
- [x] Add Vitest tests (15 DashboardRenderer design mode + 9 DashboardEditor external selection + 8 DashboardView integration = 32 new tests)

**Phase 7 — Non-Modal Drawer & Property Panel UX Fix:**
- [x] `SheetContent` — added `hideOverlay` prop to conditionally skip the full-screen backdrop overlay (retained, and declared as a patch family in `scripts/shadcn-local-patches.mjs` since objectui#6090, so an upstream `--force` sync cannot drop it silently)
- [x] `DesignDrawer` — `modal={false}` + `hideOverlay` so preview widgets are clickable while drawer is open — **superseded by Phase 8 below**: `DesignDrawer` was replaced by the inline config panels and no longer exists in this tree, so `hideOverlay` has **no current in-repo consumer**. It is retained regardless because `@object-ui/components` is published and external consumers of the prop are not visible from here.
- [x] `DashboardEditor` — property panel renders above widget grid (stacked `flex-col` layout) for immediate visibility in narrow drawer
- [x] `DashboardEditor` — property panel uses full width (removed fixed `w-72`) for better readability in drawer context
- [x] Preview click → editor property panel linkage now works end-to-end (select, switch, deselect)
- [x] Add 11 new tests (7 DashboardDesignInteraction integration + 4 DashboardEditor.propertyPanelLayout)

**Phase 8 — Inline Config Panel Refactor (ListView Parity):**
- [x] Replace `DesignDrawer` + `DashboardEditor` in `DashboardView` with inline `DashboardConfigPanel` / `WidgetConfigPanel`
- [x] Right-side panel shows `DashboardConfigPanel` when no widget selected (dashboard-level properties: columns, gap, refresh, theme)
- [x] Right-side panel switches to `WidgetConfigPanel` when a widget is selected (title, type, data binding, layout, appearance)
- [x] Config panels use standard `ConfigPanelRenderer` with save/discard/footer (matches ListView/PageDesigner pattern)
- [x] Add-widget toolbar moved to main area header (visible only in edit mode)
- [x] Main area remains WYSIWYG preview via `DashboardRenderer` with `designMode` click-to-select
- [x] Widget config flattening/unflattening (layout.w ↔ layoutW, layout.h ↔ layoutH)
- [x] Auto-save on config save via `useAdapter().update()`
- [x] Live preview updates via `onFieldChange` callback
- [x] Config draft stabilization via `configVersion` counter (matching ViewConfigPanel's `stableActiveView` pattern) — prevents `useConfigDraft` draft reset on live field changes
- [x] Widget delete via `headerExtra` delete button in WidgetConfigPanel header
- [x] `WidgetConfigPanel` — added `headerExtra` prop for custom header actions
- [x] Update 21 integration tests (10 DashboardDesignInteraction + 11 DashboardViewSelection) to verify inline config panel pattern, widget deletion, live preview sync

**Phase 9 — Design Mode Widget Selection Click-Through Fix:**
- [x] Fix: Widget content (charts, tables via `SchemaRenderer`) intercepted click events, preventing selection in edit mode
- [x] Defense layer 1: `pointer-events-none` on `SchemaRenderer` content wrappers disables chart/table hover and tooltip interactivity in design mode
- [x] Defense layer 2: Transparent click-capture overlay (`absolute inset-0 z-10`) renders on top of widget content in design mode — guarantees click reaches widget handler even if SVG children override `pointer-events`
- [x] Self-contained (metric) widgets: both `pointer-events-none` on SchemaRenderer + overlay inside `relative` wrapper
- [x] Card-based (chart/table) widgets: `pointer-events-none` on `CardContent` inner wrapper + overlay inside `relative` Card
- [x] No impact on non-design mode — widgets remain fully interactive when not editing
- [x] Updated SchemaRenderer mock to forward `className` and include interactive child button for more realistic testing
- [x] Add 9 new Vitest tests: pointer-events-none presence/absence, overlay presence/absence, relative positioning, click-to-select on Card-based widgets

**Phase 10 — Widget Config Live Preview Sync & Type Switch Fix:**
- [x] Fix: `DashboardWithConfig` did not pass `onFieldChange` to `WidgetConfigPanel`, preventing live preview of widget config changes
- [x] Add internal `liveSchema` state to `DashboardWithConfig` for real-time widget preview during editing
- [x] Add `configVersion` counter to stabilize `selectedWidgetConfig` and prevent `useConfigDraft` draft reset loops
- [x] Fix: `scatter` chart type was not handled in `DashboardRenderer` and `DashboardGridLayout` — switching to scatter caused errors
- [x] Add `scatter` to chart type conditions in both `DashboardRenderer.getComponentSchema()` and `DashboardGridLayout.getComponentSchema()`
- [x] Fix: Data binding fields (`categoryField`, `valueField`, `object`, `aggregate`) from config panel did not affect rendering — `getComponentSchema()` only read from `options.xField`/`options.yField`/`options.data`
- [x] Add widget-level field fallbacks: `widget.categoryField || options.xField`, `widget.valueField || options.yField` in both `DashboardRenderer` and `DashboardGridLayout`
- [x] Support object-chart construction from widget-level fields when no explicit data provider exists (e.g. newly created widgets via config panel)
- [x] Support data-table construction from `widget.object` when no data provider exists (table widgets created via config panel)
- [x] Add 7 new Vitest tests: scatter chart (2), widget-level field fallbacks (2), object-chart from widget fields, data-table from widget.object, DashboardWithConfig live preview

**Phase 11 — Dashboard Save/Refresh Metadata Sync:**
- [x] Fix: `saveSchema` in `DashboardView` did not call `metadata.refresh()` after PATCH — closing config panel showed stale data from cached metadata
- [x] Fix: `previewSchema` only used `editSchema` when `configPanelOpen=true` — changed to `editSchema || dashboard` so edits remain visible after panel close until metadata refreshes
- [x] Add `useEffect` to clear stale `editSchema` when metadata refreshes while config panel is closed (seamless transition)
- [x] Clear `editSchema` and config panel state on dashboard navigation (`dashboardName` change)
- [x] Fix: `DashboardDesignPage.saveSchema` did not call `metadata.refresh()` — other pages saw stale dashboard data after save
- [x] Add 5 new Vitest tests: metadata refresh after widget save (2), metadata refresh after widget delete (2), metadata refresh after DashboardDesignPage save (1)

**Phase 12 — Data Provider Field Override for Live Preview:**
- [x] Fix: Widget-level fields (`categoryField`, `valueField`, `aggregate`, `object`) did not override data provider config (`widget.data.aggregate`) — editing these fields in the config panel had no effect on the rendered chart when a data provider was present
- [x] `getComponentSchema()` in `DashboardRenderer` and `DashboardGridLayout` now merges widget-level fields with data provider aggregate config, with widget-level fields taking precedence
- [x] Fix: `objectName` for table/pivot widgets used `widgetData.object || widget.object` — reversed to `widget.object || widgetData.object` so config panel edits to data source are reflected immediately
- [x] Fix: `DashboardWithConfig` did not pass `designMode`, `selectedWidgetId`, or `onWidgetClick` to `DashboardRenderer` — widgets could not be selected or live-previewed in the plugin-level component
- [x] Add 10 new Vitest tests: widget-level field overrides for aggregate groupBy/field/function (3), objectName precedence for chart/table (2), simultaneous field overrides (1), DashboardWithConfig design mode and widget selection (2), existing live preview tests (2)

**Phase 13 — Table/Pivot Widget Enhancements & Context-Aware Config Panel:**
- [x] Add `pivot` to `DASHBOARD_WIDGET_TYPES` constant and `WidgetConfigPanel` type options dropdown
- [x] Context-aware `WidgetConfigPanel`: sections shown/hidden via `visibleWhen` based on widget type — Pivot shows Rows/Columns/Values/Totals, Chart shows Axis & Series, Table shows Columns config
- [x] Pivot-specific config: Row field, Column field, Value field, Sort by (Group/Value icon-group), Sort order (↑/↓ icon-group), Show label toggle, Show totals toggle for both rows and columns, Aggregation, Number format
- [x] Chart-specific config: X-axis label, Y-axis label, Show legend toggle
- [x] Table-specific config: Searchable toggle, Pagination toggle
- [x] Breadcrumb adapts to widget type ("Pivot table", "Table", "Chart", "Widget")
- [x] I18nLabel resolution: `WidgetConfigPanel` pre-processes `title` and `description` config values via `resolveLabel()` to prevent `[object Object]` display
- [x] `DashboardRenderer`: widget description rendered in card headers with `line-clamp-2`; I18nLabel resolved via `resolveLabel()`
- [x] `ObjectPivotTable`: new async-aware pivot wrapper (following ObjectChart pattern) — skeleton loading, error state, no-data-source message, empty state delegation to PivotTable
- [x] `ObjectDataTable`: new async-aware table wrapper — skeleton loading, error state, empty state, auto-column derivation from fetched data keys
- [x] `DashboardRenderer`: pivot widgets with `objectName` or `provider: 'object'` routed to `object-pivot` type (ObjectPivotTable) for async data loading
- [x] `DashboardRenderer`: table widgets with `objectName` or `provider: 'object'` routed to `object-data-table` type (ObjectDataTable) for async data loading
- [x] `DashboardRenderer`: grid column clamping — widget `layout.w` clamped to `Math.min(w, columns)` preventing layout overflow
- [x] `MetricWidget`: overflow protection — `overflow-hidden` on Card, `truncate` on label/value/description, `shrink-0` on icon/trend
- [x] `PivotTable`: friendly empty state with grid icon + "No data available" message instead of empty table body
- [x] `PivotTable`: improved total/subtotal row styling — `bg-muted/40` on tfoot, `bg-muted/20` on row-total column, `font-bold` on grand total
- [x] Add 29 new Vitest tests: ObjectPivotTable (8), ObjectDataTable (6), context-aware sections (6), I18nLabel resolution (2), pivot type option (1), pivot object binding (1), widget description rendering (2), grid column clamping (1), pivot empty state (2)

### P1.11 Console — Schema-Driven View Config Panel Migration

> Migrated the Console ViewConfigPanel from imperative implementation (~1655 lines) to Schema-Driven architecture using `ConfigPanelRenderer` + `useConfigDraft` + `ConfigPanelSchema`, reducing to ~170 lines declarative wrapper + schema factory.

**Phase 1 — Infrastructure & Utils Extraction:**
- [x] Extract operator mapping (`SPEC_TO_BUILDER_OP`, `BUILDER_TO_SPEC_OP`), `normalizeFieldType`, `parseSpecFilter`, `toSpecFilter` to shared `view-config-utils.ts`
- [x] Extract `parseCommaSeparated`, `parseNumberList`, `VIEW_TYPE_LABELS`, `ROW_HEIGHT_OPTIONS` to shared utils
- [x] Add `deriveFieldOptions`, `toFilterGroup`, `toSortItems` bridge helpers
- [x] Enhance `ConfigPanelRenderer` with accessibility props (`panelRef`, `role`, `ariaLabel`, `tabIndex`)
- [x] Enhance `ConfigPanelRenderer` with test ID override props (`testId`, `closeTitle`, `footerTestId`, `saveTestId`, `discardTestId`)

**Phase 2 — Schema Factory (All Sections):**
- [x] Page Config section: label, description, viewType, toolbar toggles (7 switches), navigation mode/width/openNewTab, selection, addRecord sub-editor, export + sub-config, showRecordCount, allowPrinting
- [x] Data section: source, sortBy (expandable), groupBy (grid/gallery), columns selector (expandable w/ reorder), filterBy (expandable), pagination, searchable/filterable/hidden fields (expandable), quickFilters (expandable), virtualScroll (grid only), type-specific options (kanban/calendar/map/gallery/timeline/gantt)
- [x] Appearance section: color (grid/calendar/timeline/gantt), rowHeight (icon group, grid only), wrapHeaders (grid only), showDescription, striped/bordered (grid only), resizable (grid only), conditionalFormatting (expandable, grid/kanban), emptyState (title/message/icon)
- [x] User Actions section: inlineEdit (grid only), addDeleteRecordsInline (grid only), rowActions/bulkActions (expandable, grid/kanban)
- [x] Sharing section: sharingEnabled, sharingVisibility (visibleWhen: sharing.enabled)
- [x] Accessibility section: ariaLabel, ariaDescribedBy, ariaLive
- [x] `ExpandableWidget` component for hook-safe expandable sub-sections within custom render functions

**Phase 3 — ViewConfigPanel Wrapper:**
- [x] Rewrite ViewConfigPanel as thin wrapper (~170 lines) using `useConfigDraft` + `buildViewConfigSchema` + `ConfigPanelRenderer`
- [x] Stabilize source reference with `useMemo` keyed to `activeView.id` (prevents draft reset on parent re-renders)
- [x] Create/edit mode support preserved (onCreate/onSave, discard behavior)
- [x] All spec format bridging preserved (filter/sort conversion)

**Phase 4 — Testing & Validation:**
- [x] All 122 existing ViewConfigPanel tests pass (test mock updated for ConfigPanelRenderer + useConfigDraft)
- [x] All 23 ObjectView integration tests pass (test ID and title props forwarded)
- [x] 53 new schema-driven tests (utils + schema factory coverage)
- [x] 14 new ObjectGrid rowHeight tests (all 5 enum values: initialization, cycle, label, toggle visibility)
- [x] Full affected test suite: 2457+ tests across 81+ files, all pass

**Phase 5 — Spec Alignment Completion (Issue #745):**
- [x] ObjectGrid rowHeight: full 5-enum rendering (cellClassName, cycleRowHeight, icon map) — was hardcoded to 3
- [x] 18 new ViewConfigPanel interaction tests: collapseAllByDefault, showDescription, clickIntoRecordDetails, addDeleteRecordsInline toggles; sharing visibility conditional hide; navigation width/openNewTab conditional rendering; all 5 rowHeight button clicks; boundary tests (empty actions, long labels, special chars); pageSizeOptions input; densityMode/ARIA live enums; addRecord conditional sub-editor; sharing visibility select
- [x] 8 new schema-driven spec tests: accessibility field ordering, emptyState compound field, switch field defaults, comprehensive visibleWhen predicates (sharing, navigation width, navigation openNewTab)
- [x] All spec fields verified: Appearance/UserActions/Sharing/Accessibility sections 100% covered with UI controls, defaults, ordering, and conditional visibility
- [x] Add `description` field to `NamedListView` protocol interface (spec alignment)
- [x] Add `disabledWhen` predicate to `ConfigField` type — grid-only fields (striped/bordered/wrapHeaders/resizable) disabled for non-grid views
- [x] Add `expandedSections` prop to `ConfigPanelRenderer` for external section collapse control (auto-focus/highlight)
- [x] Add `helpText` to navigation-dependent fields (width/openNewTab) with i18n hints (all 10 locales)
- [x] 24 new tests: expandedSections override (3), disabledWhen evaluation (2), grid-only disabledWhen predicates (16), helpText validation (2), description spec alignment (1)

**Phase 6 — Config Panel Cleanup (Invalid Items Fix):**
- [x] Remove `densityMode` field from appearance section (redundant with `rowHeight` which provides finer 5-value granularity)
- [x] Remove `prefixField` from data section (not consumed by any runtime renderer)
- [x] Remove `collapseAllByDefault` from appearance section (not consumed by any runtime renderer)
- [x] Remove `fieldTextColor` from appearance section (not consumed by any runtime renderer)
- [x] Remove `clickIntoRecordDetails` from userActions section (controlled implicitly via navigation mode, not directly consumed)
- [x] Add view-type-aware `visibleWhen` to toolbar toggles: `showGroup` (grid/kanban/gallery), `showColor` (grid/calendar/timeline/gantt), `showDensity` (grid only), `showRecordCount` (grid only), `allowPrinting` (grid only)
- [x] Add view-type-aware `visibleWhen` to data fields: `_groupBy` (grid/gallery — kanban uses dedicated type-specific option), `virtualScroll` (grid only)
- [x] Add view-type-aware `visibleWhen` to appearance fields: `striped`/`bordered`/`wrapHeaders`/`resizable`/`rowHeight` (grid only, changed from disabledWhen to visibleWhen), `color` (grid/calendar/timeline/gantt), `conditionalFormatting` (grid/kanban)
- [x] Add view-type-aware `visibleWhen` to userActions fields: `inlineEdit`/`addDeleteRecordsInline` (grid only), `rowActions`/`bulkActions` (grid/kanban)
- [x] Correct `searchableFields`/`filterableFields`/`quickFilters`/`showDescription` to universal (all view types) — data fetch/toolbar features not view-specific
- [x] Extend `buildSwitchField` and `buildFieldMultiSelect` helpers to accept `visibleWhen` parameter
- [x] Define semantic predicates: `supportsGrouping`, `supportsColorField`, `supportsConditionalFormatting`, `supportsRowActions`, `supportsGenericGroupBy`
- [x] 103 schema tests pass (updated field key lists, visibleWhen predicates for all view types, removed field verification)
- [x] 136 ViewConfigPanel interaction tests pass (removed tests for deleted fields)
- [x] 10 config-sync integration tests pass

**Phase 7 — Section Restructure & Field Selector Upgrade (Airtable UX Parity):**
- [x] Split monolithic `pageConfig` section into 5 clear sub-sections: General, Toolbar, Navigation, Records, Export & Print
- [x] General section: label, description, viewType (always expanded, non-collapsible)
- [x] Toolbar section: showSearch, showSort, showFilters, showHideFields, showGroup, showColor, showDensity (collapsible)
- [x] Navigation section: navigation mode, width, openNewTab (collapsible)
- [x] Records section: selection mode, addRecord sub-editor (collapsible)
- [x] Export & Print section: allowExport + sub-config, showRecordCount, allowPrinting (collapsible, defaultCollapsed)
- [x] Field selector upgrade: eye/eye-off toggle for visibility (replacing checkboxes), search input for field filtering, Show All/Hide All batch operations, grip handles for visual reorder hints
- [x] i18n keys added for all 10 locales (en, zh, ja, de, fr, es, ar, ru, pt, ko)
- [x] 110 schema tests pass (+7 new section tests)
- [x] 136 ViewConfigPanel interaction tests pass (updated for eye toggles, section expansion)
- [x] 31 ObjectView integration tests pass (updated for section expansion)
- [x] 10 config-sync integration tests pass

**Phase 8 — Tab Gear Icon, Panel Animation & UX Polish:**
- [x] Add `onConfigView` prop to ViewTabBar with Settings2 gear icon on active tab
- [x] Wire gear icon in ObjectView: click opens ViewConfigPanel for that view's settings
- [x] Panel slide-in/slide-out animation: CSS transition on max-width + opacity (300ms ease-in-out)
- [x] Auto-sync panel content on view tab switch (ViewConfigPanel resets draft when activeView.id changes)
- [x] 5 new ViewTabBar gear icon tests (show on active, hide on inactive, callback, event isolation)
- [x] 3 new ViewConfigPanel tests (search input, Show All, Hide All)
- [x] 49 ViewTabBar tests pass, 139 ViewConfigPanel tests pass, 31 ObjectView tests pass

**Code Reduction:** ~1655 lines imperative → ~170 lines declarative wrapper + ~1100 lines schema factory + ~180 lines shared utils = **>50% net reduction in component code** with significantly improved maintainability

### P1.9 Console — Content Area Layout & Responsiveness

- [x] Add `min-w-0` / `overflow-hidden` to flex layout chain (SidebarInset → AppShell → ObjectView → PluginObjectView) to prevent content overflow
- [x] Fix Gantt task list width — responsive sizing (120px mobile, 200px tablet, 300px desktop) instead of hardcoded 300px
- [x] Fix Kanban board overflow containment (`min-w-0` on swimlane and flat containers)
- [x] Fix Calendar header responsive wrapping and date label sizing
- [x] Fix Map container overflow containment via `cn()` merge
- [x] Fix Timeline container `min-w-0` to prevent overflow
- [x] Fix ListView container `min-w-0 overflow-hidden` to prevent overflow
- [x] **Mobile UX round 1** — list/sidebar/record-detail polish in `apps/console`; soft pill badge palette; DropdownMenu propagation fix
- [x] **Mobile UX round 2** — Kanban readability (drop `font-mono`, derive description/badges, ScrollArea height fix); Calendar mobile default view (force `month` < 768px); Timeline marker `ml-3` to prevent dot clipping
- [ ] Mobile/tablet end-to-end Playwright matrix for Grid / Kanban / Calendar / Timeline / Gallery / Map / Gantt
- [ ] **Mobile UX round 3** — Gantt mobile pass (collapsible task list, gesture zoom), Map mobile pass (bottom-sheet record card, geolocation prompt), Form mobile pass (sticky save bar, field stepper)
- [ ] Dynamic width calculation for Gantt task list and Kanban columns based on `useResizeObserver(containerRef)`
- [ ] Mobile-only "compact card" density for ListView/DetailView

### P1.11 App Creation & Editing Flow (Airtable Interface Designer UX)

> Full app creation & editing experience aligned with Airtable Interface Designer UX.
> Components live in `@object-ui/plugin-designer`, types in `@object-ui/types`.

**Types & Interfaces:**
- [x] `AppWizardDraft` / `AppWizardStep` / `BrandingConfig` / `ObjectSelection` / `EditorMode` types
- [x] `isValidAppName()` snake_case validator function
- [x] `wizardDraftToAppSchema()` draft-to-schema conversion function

**App Creation Wizard (4-step):**
- [x] Step 1: Basic Info — name (snake_case validated), title, description, icon, template (the layout selector it also carried was removed by objectui#10867: `@objectstack/spec` declares no app layout, so the choice was never saved)
- [x] Step 2: Object Selection — card grid with search, select all/none, toggle selection
- [x] Step 3: Navigation Builder — auto-generates NavigationItem[] from selected objects, add group/URL/separator, reorder up/down, remove
- [x] Step 4: Branding — logo URL, primary color, favicon, live preview card
- [x] Step indicator with connected progress dots
- [x] Step validation (step 1 requires valid snake_case name + title)
- [x] onComplete callback returns full AppWizardDraft

**Navigation Designer:**
- [x] Recursive NavigationItem tree renderer (supports infinite nesting)
- [x] Quick add buttons for all 7 nav item types (object, dashboard, page, report, group, URL, separator)
- [x] Inline label editing (double-click to edit, Enter/Escape to commit/discard)
- [x] Add child to groups (nested navigation)
- [x] Reorder items (up/down buttons)
- [x] Deep tree operations (remove/reorder works at any depth)
- [x] Live preview sidebar showing navigation as rendered
- [x] Type badges with color coding
- [x] Icon editing (inline icon name input with pencil button, Enter/Escape commit/discard)
- [x] Visibility toggle (eye/eye-off icon per node, hidden badge display)
- [x] Export/Import navigation JSON Schema (toolbar buttons with file I/O, custom callbacks)
- [x] Mobile responsive layout (flex-col on mobile, sm:flex-row on desktop)

**Page Canvas Editor:**
- [x] Component palette (Grid, Kanban, Calendar, Gallery, Dashboard, Form, Layout Grid)
- [x] Component list with drag handles, selection, reorder
- [x] Property panel for selected component (label, type, ID)
- [x] Add/remove/reorder components
- [x] Syncs PageSchema children on every change
- [x] Undo/Redo integration via `useUndoRedo` hook (Ctrl+Z / Ctrl+Y keyboard shortcuts)
- [x] JSON Schema export/import (Download/Upload toolbar buttons with `onExport`/`onImport` callbacks)
- [x] Preview mode toggle (Eye icon, renders PagePreview panel)
- [x] Page/Dashboard mode tab switching (role="tablist" with aria-selected)
- [x] i18n integration via `useDesignerTranslation` (all labels use translation keys)
- [x] Keyboard shortcuts (Delete/Backspace to remove selected component)
- [x] Mobile responsive layout (flex-col on mobile, sm:flex-row on desktop)

**Dashboard Editor:**
- [x] 6 widget types (KPI Metric, Bar Chart, Line Chart, Pie Chart, Table, Grid)
- [x] Widget card grid with selection, drag handles, reorder
- [x] Widget property panel (title, type, data source, value field, aggregate, color variant)
- [x] Add/remove/reorder widgets
- [x] Grid layout based on DashboardSchema columns
- [x] Undo/Redo integration via `useUndoRedo` hook (Ctrl+Z / Ctrl+Y keyboard shortcuts)
- [x] JSON Schema export/import (Download/Upload toolbar buttons with `onExport`/`onImport` callbacks)
- [x] Preview mode toggle (Eye icon, renders DashboardPreview panel)
- [x] Widget layout size editing (width/height inputs in property panel)
- [x] i18n integration via `useDesignerTranslation` (all labels use translation keys)
- [x] Keyboard shortcuts (Delete/Backspace to remove selected widget)
- [x] Mobile responsive layout (flex-col on mobile, sm:flex-row on desktop)

**Object View Configurator:**
- [x] 7 view type switcher (Grid, Kanban, Calendar, Gallery, Timeline, Map, Gantt)
- [x] Column visibility toggle with visible count
- [x] Column reorder (up/down)
- [x] Toolbar toggles (showSearch, showFilters, showSort)
- [x] Appearance section (row height, striped, bordered)
- [x] Collapsible sections

**Editor Mode Toggle:**
- [x] Three-way toggle (Edit / Preview / Code)
- [x] Radio group accessibility (role="radiogroup", aria-checked)
- [x] Disabled state support

**i18n:**
- [x] `appDesigner` section with 133 keys added to all 10 locales (en, zh, ja, de, fr, es, ar, ru, pt, ko)
- [x] `useDesignerTranslation` safe wrapper hook with English fallback (no I18nProvider required)
- [x] AppCreationWizard fully i18n-integrated (all labels, buttons, step names, validation messages)
- [x] NavigationDesigner fully i18n-integrated (type badges, quick-add labels, aria-labels, preview, icon editing, visibility, export/import)
- [x] DashboardEditor fully i18n-integrated (toolbar labels, preview text)
- [x] PageCanvasEditor fully i18n-integrated (toolbar labels, mode tabs, preview text)
- [x] BrandingEditor fully i18n-integrated (14 new keys: editor title, export/import, preview, palette, font, light/dark, mobile preview, sample text)

**UX Enhancements:**
- [x] Cancel confirmation dialog with unsaved-changes detection
- [x] `onSaveDraft` callback for partial progress save
- [x] `useConfirmDialog` hook integration for cancel workflow

**Testing:**
- [x] 11 type tests (isValidAppName, wizardDraftToAppSchema, type shapes)
- [x] 41 AppCreationWizard tests (rendering, steps 1-4, navigation, callbacks, cancel confirm, save draft, i18n, read-only)
- [x] 33 NavigationDesigner tests (rendering, add, remove, groups, badges, i18n, read-only, icon editing, visibility toggle, export/import, responsive)
- [x] 7 EditorModeToggle tests (render, active mode, onChange, accessibility, disabled)
- [x] 22 DashboardEditor tests (rendering, add/remove widgets, property panel, read-only, undo/redo, export/import, preview mode, widget layout)
- [x] 23 PageCanvasEditor tests (rendering, add/remove components, property panel, read-only, mode tabs, undo/redo, export/import, preview mode)
- [x] 12 ObjectViewConfigurator tests (rendering, view type switch, column visibility, toggles, read-only)
- [x] 29 BrandingEditor tests (rendering, editing, light/dark preview, read-only, undo/redo, export/import, keyboard shortcuts, preview content)
- [x] **Total: 238 tests across 10 files, all passing**

**ComponentRegistry:**
- [x] Registered: `app-creation-wizard`, `navigation-designer`, `dashboard-editor`, `page-canvas-editor`, `object-view-configurator`, `branding-editor`

**Branding Editor:**
- [x] Logo URL input with live preview (light/dark logo placeholders)
- [x] Visual color picker with native `<input type="color">` and text hex input
- [x] 16-color preset palette swatches (Blue, Indigo, Violet, Purple, Pink, Red, Orange, Amber, Yellow, Green, Teal, Cyan, Sky, Slate, Dark, Navy)
- [x] Favicon URL input with preview
- [x] Font family selector (9 common web fonts + system default)
- [x] Light/Dark mode preview toggle
- [x] Real-time preview panel (desktop + mobile)
- [x] Undo/Redo via `useUndoRedo` hook (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y keyboard shortcuts)
- [x] JSON Schema export/import (Download/Upload toolbar buttons with `onExport`/`onImport` callbacks)
- [x] Read-only mode support (disables all inputs, palette clicks, undo/redo, import)
- [x] Mobile responsive layout (flex-col on mobile, sm:flex-row on desktop)
- [x] i18n integration via `useDesignerTranslation` (14 new translation keys in all 10 locales)
- [x] Outputs to `BrandingConfig` type (AppSchema.branding protocol)
- [x] 29 unit tests (rendering, editing, light/dark preview, read-only, undo/redo, export/import, keyboard shortcuts, preview content)

**Console Integration:**
- [x] `CreateAppPage` — renders `AppCreationWizard` with `useMetadata()` objects, `onComplete`/`onCancel`/`onSaveDraft` callbacks
- [x] `EditAppPage` — reuses wizard with `initialDraft` from existing app config
- [x] Routes: `/apps/:appName/create-app`, `/apps/:appName/edit-app/:editAppName`
- [x] AppSidebar "Add App" button → navigates to `/create-app`
- [x] AppSidebar "Edit App" button → navigates to `/edit-app/:appName`
- [x] CommandPalette "Create New App" command (⌘+K → Actions group)
- [x] Empty state CTA "Create Your First App" when no apps configured
- [x] `wizardDraftToAppSchema()` conversion on completion — includes `icon`, `label`, `branding` fields
- [x] `EditAppPage` merges wizard output with original app config to preserve fields not in wizard (e.g. `active`)
- [x] `client.meta.saveItem('app', name, schema)` — persists app metadata to backend on create/edit
- [x] MSW PUT handler for `/meta/:type/:name` — dev/mock mode metadata persistence
- [x] MSW handler refactored to use `MSWPlugin` + protocol broker shim — filter/sort/top/pagination now work correctly in dev/mock mode (Issue #858)
- [x] Draft persistence to localStorage with auto-clear on success
- [x] `createApp` i18n key added to all 10 locales
- [x] 13 console integration tests (routes, wizard callbacks, draft persistence, saveItem, CommandPalette)
- [x] `PageDesignPage` — integrates `PageCanvasEditor` at `/design/page/:pageName` route with auto-save, JSON export/import
- [x] `DashboardDesignPage` — integrates `DashboardEditor` at `/design/dashboard/:dashboardName` route with auto-save, JSON export/import
- [x] "Edit" button on `PageView` and `DashboardView` — opens right-side `DesignDrawer` with real-time preview (no page navigation)
- [x] `DesignDrawer` component — reusable right-side Sheet panel hosting editors with auto-save, Ctrl+S shortcut, and live schema sync
- [x] Ctrl+S/Cmd+S keyboard shortcut to explicitly save in both design pages (with toast confirmation)
- [x] Storybook stories for `PageCanvasEditor` and `DashboardEditor` (Designers/PageCanvasEditor, Designers/DashboardEditor)
- [x] 12 console design page tests (PageDesignPage + DashboardDesignPage: routes, 404 handling, editor rendering, onChange, Ctrl+S save)
- [x] 7 DesignDrawer tests (drawer open/close, editor rendering, real-time preview sync, auto-save, Ctrl+S, no navigation)

### P1.12 System Settings & App Management Center

> Unified system settings hub, app management page, and permission management page.

**System Hub Page (`/system/`):**
- [x] Card-based overview linking to all system administration sections
- [x] Live statistics for each section (users, orgs, roles, permissions, audit logs, apps)
- [x] Navigation to Apps, Users, Organizations, Roles, Permissions, Audit Log, Profile

**App Management Page (`/system/apps`):**
- [x] Full app list with search/filter
- [x] Enable/disable toggle per app
- [x] Set default app
- [x] Delete app with confirmation
- [x] Bulk select with enable/disable operations
- [x] Navigate to Create App / Edit App pages
- [x] Navigate to app home

**Permission Management Page (`/system/permissions`):** _(Retired — the page was deleted; the URL redirects to the Setup permission-set catalog, see #3655 and #7611)_
- [x] CRUD grid for `sys_permission` object — shipped, then deleted when `apps/console` was slimmed for third-party customisation. `sys_permission` was never a framework object name; capabilities and permission sets are registry items today (ADR-0131 D3), with no catalog object behind them
- [x] Search/filter permissions — went with the page
- [x] Admin-only create/delete controls — went with the page

**ObjectView-Driven System Pages (P1.12.2):** _(Retired — the console's wrapper pages are gone; these objects are contributed by framework plugins and reached through the Setup app's generic object route)_
- [x] Shared `SystemObjectViewPage` component, and the hand-copied `systemObjects` definitions behind it — deleted as dead code once nothing in the repo referenced them (PR #3699)
- [x] User Management (`/system/users`) — page gone; the URL survives as a redirect onto the framework's `sys_user` object route (PR #3673)
- [x] Organization Management (`/system/organizations`) — page gone; the URL redirects to `sys_organization` (PR #3673). The `sys_org` named here was never a framework object
- [x] Role Management (`/system/roles`) — page gone; the URL redirects to the Setup position catalog (PR #3673, then #7611: positions are registry items, ADR-0131 D3)
- [x] Permission Management (`/system/permissions`) — decided as the permission-set surface (#3655); the URL redirects to the Setup permission-set catalog (#7611)
- [x] Audit Log (`/system/audit-log`) — the route still resolves, but to `AuditLogPage`, a standalone read-only page that queries `sys_audit_log` over REST and renders its own table, filters, pagination and detail sheet; ObjectView is not involved
- [x] Admin-only CRUD operations — were the `operations` config on `SystemObjectViewPage`'s own schema, and went with the component (PR #3699)
- [x] Automatic search, sort, filter, pagination — likewise; what serves these objects today is the framework's Setup app route, not this repo's
- [x] System page test suite — retired with the pages; `pages/system/__tests__/` now covers `SystemHubPage` only

**Sidebar & Navigation Updates:**
- [x] Settings button → `/system/` hub (was `/system/profile`)
- [x] App switcher "Manage All Apps" link → `/system/apps`

**Empty State & System Route Accessibility (P1.12.1):**
- [x] "Create App" button always shown in empty state (even when config loading fails)
- [x] "System Settings" link always shown alongside "Create App" in empty state
- [x] Top-level `/system/*` routes accessible without any app context (promoted to main routes)
- [x] Top-level `/create-app` route accessible without any app context
- [x] Sidebar fallback navigation with system menu items when no apps are configured
- [x] System pages (`SystemHubPage`, `AppManagementPage`) handle missing `appName` gracefully
- [x] Login/Register/Forgot password pages remain always accessible regardless of app state

**Routes:**
- [x] `/system/` → SystemHubPage
- [x] `/system/apps` → AppManagementPage
- [ ] `/system/permissions` — no route is declared at this URL; the `PermissionManagementPage` it named was deleted when `apps/console` was slimmed for third-party customisation (commit cccdf84d), and the successor surface is pending maintainer decision, see #3655
- [x] `/system/metadata/:metadataType` — the URL still resolves, but as a legacy alias: its route element is `MetadataRedirect` (`apps/console/src/AppContent.tsx`), which forwards in one hop to the metadata-admin engine's own `metadata/:type`. The `MetadataManagerPage` named here has zero files and zero references under `apps/console/src/`; the generic, registry-driven list that route lands on is `MetadataResourceListPage` (`packages/app-shell/src/views/metadata-admin/ResourceListPage.tsx`), mounted by `packages/app-shell/src/console/AppContent.tsx` (#3639)

**Unified Metadata Management (P1.12.3):**
- [x] Metadata type registry (`config/metadataTypeRegistry.ts`) — centralized config for all metadata types. That file did ship, at `apps/console/src/config/metadataTypeRegistry.ts`, and was deleted in commit ff9a0d9e9 ("remove studio app and migrate to metadata-admin engine"); `metadataTypeRegistry` has zero hits anywhere in the tree today. The live registry is the metadata-admin engine's own `MetadataResourceRegistry` (`packages/app-shell/src/views/metadata-admin/registry.ts`): its per-type row is `MetadataResourceConfig`, filled in by `registerMetadataResource()`. It is not centralized config in the old sense either — a type needs no entry at all to be listed and edited, an entry only overrides the defaults
- [x] Generic `MetadataManagerPage` for listing/managing items of any registered type — shipped, then deleted when `apps/console` was slimmed for third-party customisation. The generic list is now `MetadataResourceListPage` (`packages/app-shell/src/views/metadata-admin/ResourceListPage.tsx`), driven by the engine's own `MetadataResourceRegistry` (`registry.ts` in that directory) rather than by a console-side config, and it covers every registered metadata type from one shell
- [x] SystemHubPage auto-generates metadata type cards from registry (dashboard, page, report) — nothing is generated and none of those three types has a card: `metadataTypeCards` in `apps/console/src/pages/system/SystemHubPage.tsx` is a hand-written literal (Applications, Metadata, Datasources), and the comment directly above it records why the per-type cards went away — the engine started auto-listing every type, so a card per type stopped paying for itself. What enumerates types from the registry today is the engine's own type directory, `MetadataDirectoryPage`, which the hand-written "Metadata" card links to
- [x] Dynamic `/system/metadata/:metadataType` routes in all route contexts — this spelling is declared only in the console host fragment (`apps/console/src/AppContent.tsx`, in three arities: bare, `/:metadataType`, `/:metadataType/:itemName`) and is not a page in any of them: the route element is `MetadataRedirect`, a `<Navigate>` onto the engine's route. The dynamic route that renders is the engine's `metadata/:type` in `packages/app-shell/src/console/AppContent.tsx` — and that one *is* declared in both route contexts, the with-app branch and the zero-app branch, which is the half of this claim that survives (#3639)
- [x] Generic `MetadataService` methods: `getItems()`, `saveMetadataItem()`, `deleteMetadataItem()`
- [x] Types with custom pages (`app`, `object`) link to existing dedicated routes — still true of `app` (`system/apps` renders `AppManagementPage`, `apps/console/src/AppContent.tsx`), no longer true of `object`: it has no dedicated page or route of its own. The engine's generic shell lists and edits it, configured by `registerMetadataResource({ type: 'object', … })` in `packages/app-shell/src/services/builtinComponents.tsx` and in `views/metadata-admin/anchors.ts` — list columns, searchable fields, create-form fields and anchor groups, and no component override. The only shell pages any type replaces are `permission`'s `EditPage` and `datasource`'s `ListPage`
- [x] Legacy routes preserved — no breaking changes
- [x] New tests for the registry-driven metadata surface — no total is carried here, because none of the four suites named survives in that form: the `MetadataManagerPage` and `config/metadataTypeRegistry.ts` suites went with the code they covered, `MetadataService` has no test file in the tree at all, and `SystemHubPage`'s remaining suites test its two hand-written cards, not registry-generated ones. What covers this surface today is the metadata-admin engine's own tests under `packages/app-shell/src/views/metadata-admin/`, plus the console's hub-card and legacy-redirect suites under `apps/console/src/`

**Tests:**
- [x] New tests for the system pages — of the three suites named here, only `SystemHubPage`'s is still in the tree; nothing tests `AppManagementPage` today, and `PermissionManagementPage` has no tests because the page itself is gone (commit cccdf84d)
- [x] The system page suites that remain are green — no total is carried here: "system page tests" has no fixed referent, the suites being split across `apps/console` and `packages/app-shell`, and the count this line used to state matched neither the narrow reading (`apps/console/src/pages/system/__tests__/`) nor the wide one (that directory plus the console's system-hub route suite). Measure the group you mean instead of trusting a number written down once, see #3712

### P1.13 Airtable Grid/List UX Optimization ✅

> **Status:** Complete — Grid/List components now match Airtable UX patterns for date formatting, row interactions, editing, density, headers, filters, and empty states.

**Date Field Humanized Format:**
- [x] `formatDate`, `formatDateTime`, `DateTimeCellRenderer` use browser locale (`undefined` instead of `'en-US'`)
- [x] All date columns auto-format to localized human-readable format (e.g., "2024/2/28 12:57am")

**Row Hover "Open >" Button:**
- [x] Expand button changed from icon-only `<Expand>` to text "Open >" with `<ChevronRight>` icon
- [x] Consistent across Grid and ListView (shown on row hover)

**Single-Click Edit Mode:**
- [x] Added `singleClickEdit` prop to `DataTableSchema` and `ObjectGridSchema`
- [x] When true, clicking a cell enters edit mode (instead of double-click)

**Default Compact Row Height:**
- [x] ObjectGrid default changed from `'medium'` to `'compact'` (32-36px rows)
- [x] ListView default density changed from `'comfortable'` to `'compact'`
- [x] Row height toggle preserved in toolbar

**Single-Click Edit Mode:**
- [x] Added `singleClickEdit` prop to `DataTableSchema` and `ObjectGridSchema`
- [x] ObjectGrid defaults `singleClickEdit` to `true` (click-to-edit by default)
- [x] InlineEditing component already compatible (click-to-edit native)

**Column Header Minimal Style:**
- [x] Headers use `text-xs font-normal text-muted-foreground` (was `text-[11px] font-semibold uppercase tracking-wider`)
- [x] Sort arrows inline with header text

**Filter Pill/Chip Styling:**
- [x] Filter badges use `rounded-full` for Airtable-style pill appearance
- [x] "More" overflow button matches pill styling

**Column Width Auto-Sizing:**
- [x] Auto column width estimation based on header and data content (80-400px range)
- [x] Samples up to 50 rows for width calculation

**Row Selection Checkbox Style:**
- [x] Added `selectionStyle` prop ('always'|'hover') to `DataTableSchema`
- [x] 'hover' mode shows checkboxes only on row hover

**Empty Table Ghost Row:**
- [x] Empty tables show 3 ghost placeholder rows with skeleton-like appearance
- [x] Ghost rows use varying widths for visual variety

### P1.14 Console Integration — Engine Schema Capabilities ✅

> **Status:** Complete — Console now consumes HeaderBarSchema, ViewSwitcher allowCreateView/viewActions, SidebarNav enhanced props, and Airtable UX defaults.

**ViewSwitcher `allowCreateView` & `viewActions`:**
- [x] Added `allowCreateView` and `viewActions` to `ObjectViewSchema` type
- [x] Engine `ObjectView` passes `allowCreateView`/`viewActions` to `ViewSwitcherSchema` builder
- [x] Engine `ObjectView` accepts and passes `onCreateView`/`onViewAction` callbacks to `ViewSwitcher`
- [x] Console `ObjectView` sets `allowCreateView: isAdmin` and `viewActions` (settings/share/duplicate/delete)
- [x] Console wires `onCreateView` → open ViewConfigPanel in create mode
- [x] Console wires `onViewAction('settings')` → open ViewConfigPanel in edit mode

**AppHeader `HeaderBarSchema` Alignment:**
- [x] Console `AppHeader` breadcrumb items typed as engine `BreadcrumbItem` type
- [x] Breadcrumbs with `siblings` dropdown navigation working
- [x] Search triggers ⌘K command palette (desktop + mobile)

**SidebarNav Enhanced Props:**
- [x] Storybook stories for badges, nested items, NavGroups, search filtering
- [x] Documentation updated for `SidebarNav` enhanced API (badges, badgeVariant, children, searchEnabled, NavGroup)

**Airtable UX Defaults Propagation:**
- [x] Verified: Console `ObjectView` does NOT override `rowHeight`, `density`, or `singleClickEdit`
- [x] Engine defaults (`compact` rows, `singleClickEdit: true`, browser locale dates) flow through correctly

### P1.15 Convention-based Auto-resolution for Object & Field Label i18n ✅

- [x] `useObjectLabel` hook in `@object-ui/i18n` — convention-based resolver (`objectLabel`, `objectDescription`, `fieldLabel`)
- [x] Dynamic app namespace discovery (no hardcoded `crm.` prefix — scans i18next resources for app namespaces)
- [x] `useSafeFieldLabel` shared wrapper for plugins without I18nProvider
- [x] Wired into Console `ObjectView` (breadcrumb, page title, description, drawer title)
- [x] Wired into `ObjectGrid` column headers (ListColumn, string[], auto-generated paths)
- [x] Wired into `ListView` toolbar field labels (hide fields, group by, sort/filter builder)
- [x] Wired into `NavigationRenderer` via optional `resolveObjectLabel` + `t()` props for full i18n
- [x] Wired into Console `AppSidebar` to pass resolver and `t` to NavigationRenderer
- [x] Wired into all form variants (ObjectForm, ModalForm, WizardForm, DrawerForm, TabbedForm, SplitForm)
- [x] `I18nProvider` loads app-specific translations on mount (fixes initial language loading)
- [x] 10 unit tests for `useObjectLabel` hook
- [x] Zero changes to object metadata files or translation files

### P1.16 Object Manager & Field Designer ✅

> **Status:** Complete — `ObjectManager` and `FieldDesigner` components shipped in `@object-ui/plugin-designer`. Object Detail View enhanced with Power Apps-style sections.

Enterprise-grade visual designers for managing object definitions and configuring fields. Supports the full metadata platform workflow: define objects, configure fields with advanced properties, and maintain relationships.

**Object Manager (`ObjectManager`):**
- [x] CRUD operations on object definitions (custom and system objects)
- [x] Visual configuration of object properties (name, label, plural label, description, icon, group, sort order, enabled)
- [x] Object relationship display and maintenance
- [x] Inline property editor with collapsible sections
- [x] Search/filter functionality
- [x] Grouped object display with badges
- [x] System object protection (non-deletable, name-locked)
- [x] Read-only mode support
- [x] Confirm dialog for destructive actions
- [x] 18 unit tests

**Object Detail View (Power Apps alignment):**
- [x] Dedicated Relationships section with type badges, foreign key info, and empty state
- [x] Keys section auto-extracting primary keys, unique keys, and external IDs from field metadata
- [x] Data Experience placeholder section (Forms, Views, Dashboards) — UI structure ready for future implementation
- [x] Inline data preview placeholder section (Power Apps sample data grid parity)
- [x] System field non-editable visual hints
- [x] Enhanced object properties card with separated concern sections

**Metadata Manager Grid Mode:**
- [x] `listMode: 'grid' | 'table' | 'card'` configuration on MetadataTypeConfig — neither the option nor the interface exists: `listMode` and `MetadataTypeConfig` both have zero hits in the tree. The engine's per-type row is `MetadataResourceConfig` (`packages/app-shell/src/views/metadata-admin/registry.ts`) and it carries no rendering-mode key at all; what it exposes for list shape is `listColumns`, plus `ListPage` to replace the shell page outright
- [x] Professional table rendering with column headers and action buttons in grid mode — the table rendering is real, but it is not a mode you select: `MetadataResourceListPage` (`packages/app-shell/src/views/metadata-admin/ResourceListPage.tsx`) renders a single `<table>` whose `<thead>` is built from `listColumns` (falling back to an inferred primary + label pair) for every type unconditionally. There is no branch to switch on, so there is no "grid mode" to be in
- [x] Report type configured with grid mode by default — `report` does have a registry entry, `registerMetadataResource({ type: 'report', … })` in `packages/app-shell/src/views/metadata-admin/anchors.ts`, but nothing in it selects a rendering mode, because there is none to select. What it configures is the object anchor group and the create-form seeds (`createFields`, `createDerive`, `createDefaults`); its list is the same unconditional table every other type gets
- [x] Reusable `MetadataGrid` component extracted for cross-page reuse — `MetadataGrid` has zero hits in the tree; it went with the console-side manager page it was extracted from. Cross-type reuse is no longer achieved by importing a grid component per page: every type's list is the one shell page reached through the engine's `metadata/:type` route

**MetadataFormDialog Enhancements:**
- [x] `number` field type — renders HTML number input
- [x] `boolean` field type — renders Shadcn Switch toggle with Yes/No label

**MetadataDetailPage & Provider Enhancements:**
- [x] Auto-redirect for custom page types (object → `/system/objects/:name`) — removed; object now uses metadata pipeline
- [x] `getItemsByType(type)` method on MetadataProvider for dynamic registry access
- [x] Object type merged into the generic metadata pipeline — `ObjectManagerPage` removed (only stale docblock mentions of it remain, in the two `utils/metadataConverters.ts`). Neither vehicle named here survived the move onto the metadata-admin engine: `ObjectManagerListAdapter` has zero hits, and `object` needs no custom list at all — it is listed by the engine's generic shell, configured by `registerMetadataResource({ type: 'object', … })` in `packages/app-shell/src/services/builtinComponents.tsx`
- [x] Per-type override slot for injecting a custom list UI — `listComponent` on `MetadataTypeConfig` went with that console-side registry (both names have zero hits today). The engine's equivalent is `ListPage` on `MetadataResourceConfig` (`packages/app-shell/src/views/metadata-admin/registry.ts`), which bypasses the generic shell for one type; `datasource` is the only type overriding it
- [x] All entry points (sidebar, QuickActions, hub cards) unified to `/system/metadata/object` — judged per entry, none of the three aims there today, and they left for different reasons. The hub cards carry no object card at all: `SystemHubPage`'s hand-written cards aim at the engine's type directory and at `metadata/datasource`. The sidebars' `sys-objects` item (in both `AppSidebar` and `UnifiedSidebar`) and the home page's `manage-objects` quick action were re-pointed at the engine's canonical `/apps/setup/metadata/object` (#3739), because the `system/…` spelling is not a page: `MetadataRedirect` serves it with a `<Navigate>` onto exactly that URL, so aiming at it charged every click a redundant hop plus a re-render. What is unified is the destination, not this spelling of it — the alias routes stay declared for bookmarks and external links

**Technical Debt Cleanup:**
- [x] Unified icon resolver — consolidated 3 duplicated ICON_MAP/resolveIcon into shared `getIcon` utility
- [x] Extracted `toObjectDefinition`/`toFieldDefinition` to shared `utils/metadataConverters.ts`

**Field Designer (`FieldDesigner`):**
- [x] CRUD operations on field definitions with 27 supported field types
- [x] Advanced field properties: uniqueness, default values, options/picklists, read-only, hidden, validation rules, external ID, history tracking, indexed
- [x] Field grouping, sorting, and layout management
- [x] System reserved field protection
- [x] Type-specific property editors (lookup reference, formula expression, select options)
- [x] Validation rule builder (min, max, minLength, maxLength, pattern, custom)
- [x] Search and type-based filtering
- [x] Read-only mode support
- [x] 22 unit tests

**Metadata Persistence (Console Integration):**
- [x] `MetadataService` class wrapping `client.meta.saveItem` for object/field CRUD
- [x] `useMetadataService` hook for adapter-aware service access
- [x] Optimistic update pattern with rollback on API failure
- [x] Object create/update persisted via `saveItem('object', name, data)`
- [x] Object delete via soft-delete (`enabled: false, _deleted: true`)
- [x] Field changes persisted as part of parent object metadata
- [x] MetadataProvider `refresh()` called after successful mutations
- [x] Saving state indicators with loading spinners
- [x] Accurate toast messages (create/update/delete action labels, error details)
- [x] 16 new MetadataService unit tests + 2 ObjectManagerPage API integration tests

**Type Definitions (`@object-ui/types`):**
- [x] `ObjectDefinition`, `ObjectDefinitionRelationship`, `ObjectManagerSchema`
- [x] `DesignerFieldType` (27 types), `DesignerFieldOption`, `DesignerValidationRule`
- [x] `DesignerFieldDefinition`, `FieldDesignerSchema`

**i18n Support:**
- [x] Full translations for all 10 locales (en, zh, ja, ko, de, fr, es, pt, ru, ar)
- [x] 50 new translation keys per locale (objectManager + fieldDesigner sections)
- [x] Fallback translations in `useDesignerTranslation` for standalone usage

### P1.17 View Management UX & Performance (Post-3.3.2, queued for next release) ✅

> **Status:** Code complete on `main`; queued in `.changeset/` and `[Unreleased]` for the next published patch.

**View Management:**
- [x] **Manage Views dialog** (`@object-ui/plugin-view`) — full view CRUD UI replacing inline tab drag (commit `35f57ecf`)
- [x] Tab-drag UX retired in favour of Manage Views dialog (commit `3371239c`)
- [x] Drag handle hidden until tab hover (commit `0bcded75`); entire tab body becomes drag activator (commit `f9eab1b6`)
- [x] **CreateViewDialog** — Airtable-style + simplified config panel (commits `248a835c`, `30904b16`); requires type-specific fields (commit `88da56a1`)
- [x] Visible chevron menu + Airtable-light config panel on view tabs (commit `1a87e678`)
- [x] Airtable-parity create / edit / delete view UX (commit `d822d195`)
- [x] User-defined `sys_view` records load alongside metadata views in `ObjectView` (commit `b54cb5be`)
- [x] App-shell renders view-tab strip even for single-view objects (commit `675ffcb7`)
- [x] App-shell `Design Tools` dropdown next to primary "New" button retired (commit `9d964416`)

**Data Layer Performance:**
- [x] **View metadata merging + request coalescing** — duplicate concurrent `find()` queries from multiple renderers are deduped (commit `38eb96bd`)
- [x] `plugin-list` `$select` projection now includes view-specific fields (commit `b2d2489f`)
- [x] Stable dependency keys prevent infinite refetch loops (commit `647782a9`)
- [x] **Lazy `MetadataProvider`** — Console no longer pre-fetches the full app/object/dashboard/report/page graph at boot (CHANGELOG `[Unreleased]`)

**Title Resolution:**
- [x] Kanban card titles resolve via `objectDef.titleFormat` fallback (commit `ad40a718`)
- [x] Calendar event titles resolve via `objectDef.titleFormat` fallback (commit `643f661b`)

**i18n (Convention-Based):**
- [x] Sidebar group / dashboard / page / report label conventions in `useObjectLabel` + `NavigationRenderer` + `UnifiedSidebar`
- [x] `AppHeader` breadcrumb dashboard/page/report segments use convention lookups
- [x] `ChartRenderer` accepts `series[].label`; `DashboardRenderer` populates from `fieldLabel(widget.object, dataKey)`
- [x] `ObjectChart` `resolveGroupByLabels` translates legend categories via `fieldOptionLabel`
- [x] `ObjectDataTable` translates auto-derived column headers + select/picklist cell values
- [x] `data-table` formats ISO date / datetime cell values with `Intl.DateTimeFormat(language)`
- [x] Dashboard label / description / actionLabel / widget title / widget description conventions
- [x] `loadLanguage.ts` includes `dashboards` namespace

**Mobile UX (Round 1 + Round 2):**
- [x] Mobile UX round 1 — list / sidebar / record-detail polish; soft pill badge palette; DropdownMenu propagation fix (commits `a919454d`, `a409010a`)
- [x] Mobile UX round 2 — Kanban readability + ScrollArea height fix; Calendar mobile default `month`; Timeline `ml-3` marker dot fix (commit `eee295da`)

**Theming Foundation:**
- [x] Class-based dark mode variant centralised in app-shell styles (commit `4944d02c`)
- [x] Refactor: class-based dark mode + soft pill badge colors (commit `dbbd2cd2`)
- [x] Build: circular CSS import in `components` & `runner` broken (commit `1bae8f8a`)

---

## 🧩 P2 — Polish & Advanced Features

### P2.0 Flow Designer ✅

> **Status:** Complete — `FlowDesigner` component shipped in `@object-ui/plugin-workflow`.

The `FlowDesigner` is a canvas-based flow editor that bridges the gap between the approval-focused `WorkflowDesigner` and the BPMN-heavyweight `ProcessDesigner`. It targets automation/integration flows with spec v3.0.9 types.

**Core Canvas:**
- [x] Drag-to-reposition nodes on SVG canvas
- [x] Undo/redo with keyboard shortcuts (`Ctrl+Z` / `Ctrl+Y`)
- [x] Ctrl+S save shortcut with `onSave` callback
- [x] Zoom in/out/reset controls
- [x] Edge creation by clicking source → target connection ports
- [x] Node deletion via delete button or `Delete` key

**Node Types (spec v3.0.9):**
- [x] Standard nodes: `start`, `end`, `task`, `user_task`, `service_task`, `script_task`, `approval`, `condition`
- [x] Gateway nodes: `parallel_gateway`, `join_gateway`
- [x] Event nodes: `boundary_event`, `delay`, `notification`, `webhook`

**Edges (spec v3.0.9):**
- [x] Edge types: `default`, `conditional`, `timeout`
- [x] Conditional edges with `condition` expression field
- [x] `isDefault` flag for default/fallthrough edge marking
- [x] Visual differentiation: dashed lines for conditional, dotted for default

**Property Panel:**
- [x] Node property editor: label, type, description
- [x] Node executor configuration: `FlowNodeExecutorDescriptor` (type, `inputSchema`, `outputSchema`, `timeoutMs`, retry policy)
- [x] Wait event config for delay nodes: `FlowWaitEventType` (condition/manual/webhook/timer/signal)
- [x] Boundary event config: `FlowBoundaryConfig` (`attachedToNodeId`, `eventType`, `cancelActivity`, `timer`, `errorCode`)
- [x] Edge property editor: label, type, condition expression, `isDefault` toggle

**Spec v3.0.9 Protocol Features:**
- [x] `FlowVersionEntry[]` version history panel with current/previous entries
- [x] `FlowConcurrencyPolicy` badge display (allow/forbid/replace/queue)
- [x] `FlowExecutionStep[]` execution monitoring overlay with per-node status icons
- [x] `FlowBpmnInteropResult` BPMN XML export with warning/error reporting

**ComponentRegistry:**
- [x] Registered as `'flow-designer'` with all inputs documented

### P2.1 Designer — Remaining Interaction (Post-v1.0)

- [ ] PageDesigner: Component drag-to-reorder and drag-to-position
- [ ] ProcessDesigner: Node drag-to-move
- [x] ProcessDesigner/FlowDesigner: Support v3.0.9 node types (`parallel_gateway`, `join_gateway`, `boundary_event`) — implemented in FlowDesigner
- [x] ProcessDesigner/FlowDesigner: Support v3.0.9 conditional edges and default edge marking — implemented in FlowDesigner
- [x] ReportView: Refactored to left-right split layout (preview + DesignDrawer) — consistent with DashboardView/ListView
- [x] ReportConfigPanel: Schema-driven config via ConfigPanelRenderer + useConfigDraft (replaces full-page ReportBuilder in edit mode)
- [x] ReportConfigPanel: Report type selector (Tabular/Summary/Matrix), visual field picker (multi-select columns), undo/redo, dashboard-style consistency
- [x] ReportView: Live preview linkage fix — config panel changes instantly refresh report preview (title, description, fields, filters, groupBy)
- [x] ReportViewer: Client-side grouping — groupBy config renders grouped table with group headers and row counts
- [x] ReportType added to ReportSchema types (tabular/summary/matrix)
- [x] ReportConfigPanel: Per-column aggregation (sum/avg/count/min/max) in field picker
- [x] ReportConfigPanel: Visual chart editor — chart type selection + X/Y axis field mapping (no JSON editing)
- [x] ReportConfigPanel: Conditional formatting UI — rule builder with field/operator/value + background color
- [x] ReportConfigPanel: Section/block manager — add/remove/reorder header, summary, table, chart, text sections
- [x] ReportViewer: Conditional formatting applied to table cells (background/text color)
- [x] ReportView: Chart config from panel auto-generates chart section in preview
- [ ] ReportDesigner: Element drag-to-reposition within sections
- [x] FlowDesigner: Edge creation UI (click source port → click target port)
- [x] FlowDesigner: Property editing for node labels/types + executor config + boundary config
- [ ] Confirmation dialogs for ProcessDesigner destructive actions

### P2.2 Designer — Advanced Features

- [ ] Full property editors for all designers (PageDesigner, ProcessDesigner, ReportDesigner)
- [ ] i18n integration: all hardcoded strings through `resolveI18nLabel`
- [ ] Canvas pan/zoom with minimap
- [ ] Auto-layout algorithms (force-directed for DataModel, Dagre for Process)
- [ ] Copy/paste support (`Ctrl+C`/`Ctrl+V`) across all designers
- [ ] Multi-select (`Ctrl+Click`, `Shift+Click`) and bulk operations
- [ ] Responsive collapsible panels

### P2.3 Designer — Collaboration Integration

- [ ] Wire `CollaborationProvider` into each designer's state management
- [ ] Live cursor positions (PresenceCursors component)
- [ ] Operation-based undo/redo sync
- [ ] Conflict resolution UI (merge dialog)
- [ ] Version history browser with restore

### P2.4 Spec Compliance Gaps (Low Priority)

- [ ] `@object-ui/core`: DataScope module — row-level permission enforcement
- [ ] `@object-ui/core`: Custom validator registration API
- [ ] `@object-ui/core`: STDEV, VARIANCE, PERCENTILE, MEDIAN formula functions
- [ ] `@object-ui/react`: useTheme hook for component-level theme access
- [ ] `@object-ui/react`: Re-export usePermissions for unified hook API
- [ ] `@object-ui/components`: ErrorBoundary wrapper per component
- [ ] `@object-ui/fields`: Inline validation message rendering
- [ ] `@object-ui/plugin-charts`: Drill-down click handler for chart segments
- [x] `@object-ui/plugin-charts`: Fix `object-chart` crash when data is non-array — added `Array.isArray()` guards in ObjectChart, ChartRenderer, and AdvancedChartImpl to prevent Recharts `r.slice is not a function` error
- [x] `@object-ui/plugin-workflow`: **FlowDesigner** — canvas-based flow editor (`flow-designer` component) with drag-to-reposition nodes, edge creation UI, undo/redo, Ctrl+S save, property panel, and BPMN export
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 BPMN interop types — `FlowBpmnInteropResult` with `bpmnXml` export, `nodeCount`, `edgeCount`, `warnings`
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 node executor descriptors — `FlowNodeExecutorDescriptor` with `inputSchema`, `outputSchema`, wait event config, retry policy
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 `inputSchema`/`outputSchema` on flow nodes via `FlowNodeExecutorDescriptor`
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 `boundaryConfig` for boundary event nodes — `FlowBoundaryConfig` with `attachedToNodeId`, `eventType`, `cancelActivity`, `timer`, `errorCode`
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 node types — `parallel_gateway`, `join_gateway`, `boundary_event` in `FlowNodeType`
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 conditional edges — `FlowEdge.type = 'conditional'` + `isDefault` flag
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 `FlowVersionHistory` — `FlowVersionEntry[]` with version number, author, changeNote, isCurrent
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 `ConcurrencyPolicy` — `FlowConcurrencyPolicy` (allow/forbid/replace/queue)
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 `WaitEventType` — `FlowWaitEventType` (condition/manual/webhook/timer/signal)
- [x] `@object-ui/plugin-workflow`: Support v3.0.9 execution tracking — `FlowExecutionStep` with status overlay on nodes
- [ ] `@object-ui/plugin-ai`: Configurable AI endpoint adapter (OpenAI, Anthropic)
- [ ] Navigation `width` property: apply to drawer/modal overlays across all plugins
- [ ] Navigation `view` property: specify target form/view on record click across all plugins
- [ ] Support App `engine` field (`{ objectstack: string }`) for version pinning (v3.0.9)
- [ ] Integrate v3.0.9 package upgrade protocol (`PackageArtifact`, `ArtifactChecksum`, `UpgradeContext`)
- [x] `@object-ui/types`: Align `ViewType` with spec ListView type enum — add `'gallery'` and `'gantt'` (was missing from `views.ts` and `views.zod.ts`)
- [x] `@object-ui/types`: Sync `DetailViewFieldSchema` Zod validator with TS interface — add data-oriented field types (`number`, `currency`, `percent`, `boolean`, `select`, `lookup`, `master_detail`, `email`, `url`, `phone`, `user`) and missing properties (`options`, `reference_to`, `reference_field`, `currency`)
- [x] `@object-ui/types`: Add `showBorder` and `headerColor` to `DetailViewSectionSchema` Zod validator (already in TS interface)
- [x] `@object-ui/plugin-view`: Add `gallery` and `gantt` to ViewSwitcher default labels and icons
- [x] `@object-ui/plugin-list`: Fix `list-view` and `list` registration `viewType` enum — remove invalid `'list'`/`'chart'`, add `'gallery'`/`'timeline'`/`'gantt'`/`'map'` to match spec
- [x] `@object-ui/plugin-detail`: Add missing `detail-view` registration inputs (`layout`, `columns`, `loading`, `backUrl`, `editUrl`, `deleteConfirmation`, `header`, `footer`)
- [x] `@object-ui/plugin-detail`: Add `showBorder` and `headerColor` inputs to `detail-section` registration

### P2.6 ListView Spec Protocol Gaps (Remaining) ✅

> All items from the ListView Spec Protocol analysis have been implemented.

**P0 — Core Protocol:**
- [x] `data` (ViewDataSchema): ListView consumes `schema.data` — supports `provider: value` (inline items), `provider: object` (fetch from objectName), and plain array shorthand. Falls back to `dataSource.find()` when not set.
- [x] `grouping` rendering: Group button enabled with GroupBy field picker popover. Grouping config wired to ObjectGrid child view, which renders collapsible grouped sections via `useGroupedData` hook.
- [x] `rowColor` rendering: Color button enabled with color-field picker popover. Row color config wired to ObjectGrid child view, which applies row background colors via `useRowColor` hook.

**P1 — Structural Alignment:**
- [x] `quickFilters` structure reconciliation: Auto-normalizes spec `{ field, operator, value }` format into ObjectUI `{ id, label, filters[] }` format. Both formats supported simultaneously. Dual-format type union (`QuickFilterItem = ObjectUIQuickFilterItem | SpecQuickFilterItem`) exported from `@object-ui/types`. Standalone `normalizeQuickFilter()` / `normalizeQuickFilters()` adapter functions in `@object-ui/core`. Bridge (`list-view.ts`) normalizes at spec→SchemaNode transform time. Spec shorthand operators (`eq`, `ne`, `gt`, `gte`, `lt`, `lte`) mapped to ObjectStack AST operators. Mixed-format arrays handled transparently.
- [x] `conditionalFormatting` expression reconciliation: Supports spec `{ condition, style }` format alongside ObjectUI field/operator/value rules. Dual-format type union (`ConditionalFormattingRule = ObjectUIConditionalFormattingRule | SpecConditionalFormattingRule`) exported from `@object-ui/types`. Zod validator updated with `z.union()` for both formats. `evaluatePlainCondition()` convenience function in `@object-ui/core` for safe plain/template expression evaluation with record context. Plain expressions (e.g., `status == 'overdue'`) evaluated directly without `${}` wrapper; record fields spread into evaluator context for direct field references alongside `data.` namespace. Mixed-format arrays handled transparently.
- [x] `exportOptions` schema reconciliation: Accepts both spec `string[]` format (e.g., `['csv', 'xlsx']`) and ObjectUI object format `{ formats, maxRecords, includeHeaders, fileNamePrefix }`.
- [x] Column `pinned`: `pinned` property added to ListViewSchema column type. Bridge passes through to ObjectGrid which supports `frozenColumns`. ObjectGrid reorders columns (left-pinned first, right-pinned last with sticky CSS). Zod schema updated with `pinned` field. `useColumnSummary` hook created.
- [x] Column `summary`: `summary` property added to ListViewSchema column type. Bridge passes through for aggregation rendering. ObjectGrid renders summary footer with count/sum/avg/min/max aggregations via `useColumnSummary` hook. Zod schema updated with `summary` field.
- [x] Column `link`: ObjectGrid renders click-to-navigate buttons on link-type columns with `navigation.handleClick`. Primary field auto-linked.
- [x] Column `action`: ObjectGrid renders action dispatch buttons via `executeAction` on action-type columns.
- [x] `tabs` (ViewTabSchema): TabBar component renders view tabs above the ListView toolbar. Supports icon (Lucide), pinned (always visible), isDefault (auto-selected), visible filtering, order sorting, and active tab state. Tab switch applies filter config. Extracted as reusable `TabBar` component in `packages/plugin-list/src/components/TabBar.tsx`. i18n keys added for all 10 locales.

**P2 — Advanced Features:**
- [x] `rowActions`: Row-level dropdown action menu per row in ObjectGrid. `schema.rowActions` string array items rendered as dropdown menu items, dispatched via `executeAction`.
- [x] `bulkActions`: Bulk action bar rendered in ListView when rows are selected and `schema.bulkActions` is configured. Fires `onBulkAction` callback with action name and selected rows.
- [x] `sharing` schema reconciliation: Supports both ObjectUI `{ visibility, enabled }` and spec `{ type: personal/collaborative, lockedBy }` models. Share button renders when either `enabled: true` or `type` is set. Zod validator updated with `type` and `lockedBy` fields. Bridge normalizes spec format: `type: personal` → `visibility: private`, `type: collaborative` → `visibility: team`, auto-sets `enabled: true`.
- [x] `exportOptions` schema reconciliation: Zod validator updated to accept both spec `string[]` format and ObjectUI object format via `z.union()`. ListView normalizes string[] to `{ formats }` at render time.
- [x] `pagination.pageSizeOptions` backend integration: Page size selector is now a controlled component that dynamically updates `effectivePageSize`, triggering data re-fetch. `onPageSizeChange` callback fires on selection. Full test coverage for selector rendering, option enumeration, and data reload.
- [x] `$expand` auto-injection: `buildExpandFields()` utility in `@object-ui/core` scans schema fields for `lookup`/`master_detail` types and returns field names for `$expand`. Integrated into **all** data-fetching plugins (ListView, ObjectGrid, ObjectKanban, ObjectCalendar, ObjectGantt, ObjectMap, ObjectTimeline, ObjectGallery, ObjectView, ObjectAgGrid) so the backend (objectql) returns expanded objects instead of raw foreign-key IDs. Supports column-scoped expansion (`ListColumn[]` compatible) and graceful fallback when `$expand` is not supported. Cross-repo: objectql engine expand support required for multi-level nesting.

### P2.7 Platform UI Consistency & Interaction Optimization ✅

> All items from the UI consistency optimization (Issue #749) have been implemented.

**Global Theme & Design Tokens:**
- [x] Hardcoded gray colors in `GridField.tsx`, `ReportRenderer.tsx`, and `ObjectGrid.tsx` replaced with theme tokens (`text-muted-foreground`, `bg-muted`, `border-border`, `border-foreground`)
- [x] Global font-family (`Inter`, ui-sans-serif, system-ui) injected in `index.css` `:root`
- [x] `--config-panel-width` CSS custom property added for unified config panel sizing (updated to `320px` in P2.8)
- [x] Border radius standardized to `rounded-lg` across report/grid components
- [x] `transition-colors duration-150` added to all interactive elements (toolbar buttons, tab bar, sidebar menu buttons)
- [x] `LayoutRenderer.tsx` outer shell `bg-slate-50/50 dark:bg-zinc-950` replaced with `bg-background` theme token

**Sidebar Navigation:**
- [x] `SidebarMenuButton` active state enhanced with 3px left indicator bar via `before:` pseudo-element
- [x] `SidebarMenuButton` transition expanded to include `color, background-color` with `duration-150`
- [x] `SidebarGroupLabel` visual separator added (`border-t border-border/30 pt-3 mt-2`)
- [x] Collapsed-mode tooltip support in `SidebarNav` via `tooltip={item.title}` prop
- [ ] `LayoutRenderer.tsx` hand-written sidebar → `SidebarNav` unification (deferred: requires extending SidebarNav to support nested menus, logo, version footer)

**ListView Toolbar:**
- [x] Search changed from expandable button to always-visible inline `<Input>` (`w-48`)
- [x] Activated state (`bg-primary/10 border border-primary/20`) added to Filter/Sort/Group/Color buttons when active
- [x] Toolbar overflow improved with `overflow-x-auto` for responsive behavior
- [x] `transition-colors duration-150` added to all toolbar buttons

**ObjectGrid Cell Renderers:**
- [x] `formatRelativeDate()` function added for relative time display ("Today", "2 days ago", "Yesterday")
- [x] DataTable/VirtualGrid header styling unified: `text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70 bg-muted/30`
- [x] Remaining hardcoded gray colors in ObjectGrid loading spinner and status badge fallback replaced with theme tokens
- [x] Select/status type Badge rendering — `getCellRenderer()` returns `<Badge>` with color mapping from `field.options`; auto-generated options from unique data values when type is inferred; priority semantic colors (Critical→red, High→orange, Medium→yellow, Low→gray); muted default style for unconfigured colors
- [x] Date type human-readable formatting — `DateCellRenderer` defaults to relative format ("Today", "Yesterday", "3 days ago"); overdue dates styled with red text; ISO timestamp shown as hover tooltip; `formatRelativeDate()` threshold tightened to 7 days
- [x] Boolean type visual rendering — `BooleanCellRenderer` renders `<Checkbox disabled>` for true/false; null/undefined values display as `—`

**ConfigPanelRenderer:**
- [x] `<Separator>` added between sections for visual clarity
- [x] Panel width uses `--config-panel-width` CSS custom property

**View Tab Bar:**
- [x] Tab spacing tightened (`gap-0.5`, `px-3 py-1.5`)
- [x] Active tab indicator changed to bottom border (`border-b-2 border-primary font-medium text-foreground`)
- [x] `transition-colors duration-150` added to tab buttons

### P2.8 Airtable Parity: Product View & Global UI Detail Optimization

> Platform-level grid, toolbar, sidebar, and config panel optimizations for Airtable-level experience (Issue #768).

**Platform: DataTable & ObjectGrid Enhancements:**
- [x] `rowStyle` callback prop added to `DataTableSchema` type — enables inline CSSProperties per row
- [x] `<TableRow>` in data-table.tsx applies `rowStyle` callback for runtime row styling
- [x] ObjectGrid: `conditionalFormatting` rules wired to `rowStyle` — evaluates both spec-format (`condition`/`style`) and ObjectUI-format (`field`/`operator`/`value`) rules per row using `evaluatePlainCondition` from `@object-ui/core`
- [x] Row number (#) column: hover shows `<Checkbox>` for multi-select (when `selectable` mode is enabled), replacing expand icon

**Platform: ListView Toolbar:**
- [x] Visual `<div>` separators (`h-4 w-px bg-border/60`) between toolbar button groups: Search | Hide Fields | Filter/Sort/Group | Color/Density | Export
- [x] Separators conditionally rendered only when adjacent groups are visible
- [x] Inline search moved to toolbar left end (`w-48`, Airtable-style)
- [x] Density button: activated state highlight (`bg-primary/10 border border-primary/20`) when density is non-default
- [x] Merged UserFilters row and tool buttons row into single toolbar line — left: field filter badges, right: tool buttons with separator
- [x] Search changed from inline input to icon button + Popover — saves toolbar space, matches Airtable pattern
- [x] UserFilters `maxVisible` prop added — overflow badges collapse into "More" dropdown with Popover
- [x] UserFilters config panel: `_userFilters` integrated into `buildDataSection` in ViewConfigPanel — element type selector (dropdown/tabs/toggle), field picker, live preview sync, i18n (en/zh), `NamedListView.userFilters` type parity with `ListViewSchema.userFilters`
- [x] FilterBuilder: multi-select support for `in`/`notIn` operators — checkbox list UI replaces text input for select/lookup/master_detail fields
- [x] FilterBuilder: lookup/master_detail field types now show dropdown selector instead of manual ID input
- [x] FilterBuilder: all field types mapped — `currency`/`percent`/`rating` → number operators, `datetime`/`time` → date operators with proper input types, `status` → select operators, `user`/`owner` → lookup operators
- [x] FilterUI: `multi-select` filter type added — checkbox-based multi-value selection for filter forms
- [x] FilterCondition value type expanded to support arrays `(string | number | boolean)[]` for multi-value filters
- [x] ObjectView filterSchema: `lookup`/`master_detail`/`user`/`owner` fields auto-map to `multi-select` type; `status` fields auto-map to `select`
- [x] Console `normalizeFieldType`: `lookup`/`master_detail`/`user`/`owner`/`status`/`time` types now properly classified for filter/sort config
- [x] Toolbar layout uses flex with `min-w-0` overflow handling for responsive behavior

**Platform: ViewTabBar:**
- [x] Tab "•" dot indicator replaced with descriptive badge (`F`/`S`/`FS`) + tooltip showing "Active filters", "Active sort"

**Platform: Console Sidebar:**
- [x] Recent items section: default collapsed with chevron toggle (saves sidebar space)

**Platform: ViewConfigPanel Advanced Sections:**
- [x] `userActions`, `sharing`, and `accessibility` sections set to `defaultCollapsed: true` — common settings remain expanded, advanced settings folded by default

**Platform: Config Panel Width:**
- [x] `--config-panel-width` CSS variable increased from `280px` to `320px` for wider config panel

**CRM Example: Product Grid Column Configs:**
- [x] All columns upgraded from `string[]` to `ListColumn[]` with explicit `field`, `label`, `width`, `type`, `align`
- [x] `IS ACTIVE`: `type: 'boolean'` for `<Checkbox disabled>` rendering
- [x] Price: `type: 'currency'`, `align: 'right'` for `formatCurrency` formatting
- [x] Default `rowHeight: 'short'` for compact density
- [x] Conditional formatting: stock=0 red, stock<5 yellow warning
- [x] Column widths: NAME 250, SKU 120, CATEGORY 110, PRICE 120, STOCK 80

**Tests:**
- [x] 7 new CRM metadata tests validating column types, widths, rowHeight, conditionalFormatting
- [x] 136 ViewConfigPanel tests updated for defaultCollapsed sections (expand before access)
- [x] 411 ListView + ViewTabBar tests passing (255 plugin-list tests including 9 new toolbar/collapse tests)
- [x] 11 AppSidebar tests passing

### P2.9 Platform UI Navigation & Table Optimization ✅

> Platform-level sidebar, navigation, and grid/table UX improvements (Issue #XX).

**Sidebar Navigation:**
- [x] Pin icons show-on-hover: `SidebarMenuAction` in `NavigationRenderer` now uses `showOnHover` (always true) — all pin/unpin icons only appear on hover for a cleaner sidebar. Applied to both `action` and leaf navigation item types.
- [x] Search placeholder contrast: Search icon in AppSidebar improved from `opacity-50` → `opacity-70` for better readability.
- [x] Recent section position: Recent items section moved above Record Favorites in AppSidebar for quicker access to recently visited items.
- [x] Favorites section: Already hides automatically when no pinned items exist (verified).
- [x] Resizable sidebar width: `SidebarRail` enhanced with pointer-event drag-to-resize (min 200px, max 480px). Width persisted to `localStorage`. Click toggles sidebar, double-click resets to default. `useSidebar()` hook now exposes `sidebarWidth` and `setSidebarWidth`.

**Grid/Table Field Inference:**
- [x] Percent field auto-inference: `inferColumnType()` in ObjectGrid now detects fields with names containing `probability`, `percent`, `percentage`, `completion`, `progress`, `rate` and assigns `PercentCellRenderer` with progress bar display.
- [x] ISO datetime fallback: ObjectGrid `inferColumnType()` now detects ISO 8601 datetime strings (`YYYY-MM-DDTHH:MM`) in data values as a catch-all for fields whose names don't match date/datetime patterns.
- [x] Date/datetime human-friendly display: `DateCellRenderer` (relative format) and `DateTimeCellRenderer` (split date/time) already registered in field registry for all grid/table views.
- [x] Currency/status/boolean renderers: Already implemented with proper formatting (currency symbol, Badge colors, checkbox display).
- [x] **accessorKey-format type inference**: `generateColumns()` in ObjectGrid now applies `inferColumnType()` + `getCellRenderer()` to `accessorKey`-format columns that don't already have a `cell` renderer. Previously, `accessorKey` columns bypassed the entire inference pipeline, showing raw dates, plain text status/priority, and raw numbers for progress.
- [x] **humanizeLabel() utility**: New `humanizeLabel()` export in `@object-ui/fields` converts snake_case/kebab-case values to Title Case (e.g., `in_progress` → `In Progress`). Used as fallback in `SelectCellRenderer` when no explicit `option.label` exists.
- [x] **PercentCellRenderer progress-field normalization**: `PercentCellRenderer` now uses field name to disambiguate 0-1 fraction vs 0-100 whole number — fields matching `/progress|completion/` treat values as already in 0-100 range (e.g., `75` → `75%`), while other fields like `probability` still treat `0.75` → `75%`.

**Header & Breadcrumb i18n:**
- [x] AppHeader breadcrumb labels (`Dashboards`, `Pages`, `Reports`, `System`) now use `t()` translation via `useObjectTranslation`.
- [x] `console.breadcrumb` i18n keys added to all 10 locales (en, zh, ja, ko, de, fr, es, pt, ru, ar).
- [x] `header-bar` renderer: `resolveCrumbLabel()` handles both string and `I18nLabel` objects for breadcrumb labels.
- [x] `breadcrumb` renderer: `resolveItemLabel()` handles both string and `I18nLabel` objects for item labels.

**Tests:**
- [x] 46 NavigationRenderer tests passing (pin/favorites/search/reorder)
- [x] 86 field cell renderer tests passing (date/datetime/select/boolean/percent/humanizeLabel/progress)
- [x] 293 ObjectGrid tests passing (inference, rendering, accessibility, accessorKey-format inference)
- [x] 28 DataTable tests passing
- [x] 78 Layout tests passing (NavigationRenderer + AppSchemaRenderer)
- [x] 11 AppSidebar tests passing
- [x] 32 i18n tests passing

### P2.10 ActionBar Rendering & useActionEngine Integration ✅

> Location-aware action toolbar component and React hook for ActionEngine.
> Bridges ActionSchema metadata → visible, clickable action buttons at all defined locations.

- [x] `action:bar` component — Composite toolbar renderer that accepts `ActionSchema[]` + `location` filter
  - Filters actions by `ActionLocation` (list_toolbar, list_item, record_header, record_more, record_related, global_nav)
  - Resolves each action's `component` type (action:button, action:icon, action:menu, action:group) via ComponentRegistry
  - Overflow support: actions beyond `maxVisible` threshold grouped into "More" dropdown (action:menu)
  - Supports horizontal/vertical direction, gap, variant/size defaults, custom className
  - WCAG: `role="toolbar"` + `aria-label="Actions"`
  - Registered in ComponentRegistry with inputs/defaultProps for Designer/Studio integration
- [x] `useActionEngine` hook — React wrapper around `ActionEngine`
  - `getActionsForLocation(location)` — returns filtered, priority-sorted actions
  - `getBulkActions()` — returns bulk-enabled actions
  - `executeAction(name)` — executes by name with optional context override
  - `handleShortcut(keys)` — keyboard shortcut dispatch
  - Memoized engine instance, stable callbacks
- [x] Tests: 23 tests (12 ActionBar, 11 useActionEngine) covering registration, rendering, location filtering, overflow, styling, execution, shortcuts

### P2.5 PWA & Offline (Real Sync)

- [ ] Background sync queue → real server sync (replace simulation)
- [ ] Conflict resolution on reconnection wired into Console flow
- [ ] Optimistic updates with TransactionManager state application

### P2.6 Plugin Modularization & Dynamic Management

> **Status:** Phase 1 complete — Plugin class standard, install/uninstall API, example plugin classes. Phase 1.5 complete — composeStacks unified to `@objectstack/spec`, plugin isolation, duplicate merge removal.

Plugin architecture refactoring to support true modular development, plugin isolation, and dynamic plugin install/uninstall at runtime.

**Phase 1 — Plugin Class Standard & Example Plugins ✅**
- [x] Define `AppMetadataPlugin` interface in `@object-ui/types` (name, version, type, description, init/start/stop/getConfig)
- [x] Define `PluginContext` interface for lifecycle hook context (logger, kernel)
- [x] Add `install(plugin)` / `uninstall(pluginName)` convenience methods to `PluginSystem` in `@object-ui/core`
- [x] Create `CRMPlugin` with full lifecycle (init/start/stop/getConfig) — `examples/crm/plugin.ts`
- [x] Create `TodoPlugin` — `examples/todo/plugin.ts`
- [x] Create `KitchenSinkPlugin` — `examples/kitchen-sink/plugin.ts`
- [x] Update `package.json` exports for all example apps (`./plugin` entry point)
- [x] Refactor root `objectstack.config.ts` to use plugin-based config collection via `getConfig()`
- [x] Unit tests for `install()` / `uninstall()` (5 new tests, 18 total in PluginSystem)

**Phase 1.5 — Plugin Isolation & Config Composition ✅**
- [x] Add explicit `objectName` to all example plugin actions (CRM: 28 actions, Todo: 6 actions, Kitchen Sink: 3 actions)
- [x] Rename Kitchen Sink `account` → `ks_account` to eliminate same-name object conflicts across plugins
- [x] Create `composeStacks()` utility in `@object-ui/core` — declarative stack merging with `objectConflict` option, automatic views→objects and actions→objects mapping
- [x] Remove duplicate `mergeActionsIntoObjects()` from root config and console shared config
- [x] Remove duplicate `mergeViewsIntoObjects()` from root config and console shared config (moved into `composeStacks`)
- [x] Refactor root `objectstack.config.ts` and `apps/console/objectstack.shared.ts` to use `composeStacks()`
- [x] Eliminate `defineStack()` double-pass hack — single `composeStacks()` call produces final config with runtime properties (listViews, actions) preserved. `defineStack()` Zod validation stripped these fields, requiring a second `composeStacks` pass to restore them.
- [x] Use `composed.apps` unified flow in console shared config — replaced manual `[...crmApps, ...(todoConfig.apps || []), ...]` spreading with CRM navigation patch applied to composed output
- [x] Use `composed.reports` in console shared config — replaced `...(crmConfig.reports || [])` with `...(composed.reports || [])` to include reports from all stacks
- [x] **composeStacks unified to `@objectstack/spec`:** Removed `@object-ui/core` composeStacks implementation and its 15-test suite (coverage now lives upstream in `@objectstack/spec`). All config composition now uses `composeStacks` from `@objectstack/spec` (protocol-level: object dedup, array concatenation, actions→objects mapping, manifest selection, i18n). Runtime-specific `mergeViewsIntoObjects` adapter extracted to `@object-ui/core` and applied post-composition at call sites. A deprecated re-export of `composeStacks` is kept in `@object-ui/core` for backward compatibility.

**Phase 2 — Dynamic Plugin Loading (Planned)**
- [ ] Hot-reload / lazy loading of plugins for development
- [ ] Runtime plugin discovery and loading from registry
- [ ] Plugin dependency graph visualization in Console

**Phase 3 — Plugin Identity & Isolation (Planned)**
- [x] Eliminate same-name object conflicts across plugins (Kitchen Sink `account` → `ks_account`)
- [ ] Preserve origin plugin metadata on objects, actions, dashboards for runtime inspection
- [ ] Per-plugin i18n namespace support
- [ ] Per-plugin permissions and data isolation
- [ ] Move `mergeViewsIntoObjects` from `composeStacks` to runtime/provider layer

**Phase 4 — Cross-Repo Plugin Ecosystem (Planned)**
- [ ] Plugin marketplace / registry for third-party plugins
- [ ] Plugin publish/validate tooling (spec v3.0.9 `PluginBuildOptions`, `PluginPublishOptions`)
- [ ] Cross-repo plugin loading from npm packages

### P2.11 Gantt Feature Parity (vs SVAR React Gantt)

> **Status:** Planned. Gap analysis done (June 2026) against [SVAR React Gantt](https://github.com/svar-widgets/react-gantt).
> Full phased task list lives in [`packages/plugin-gantt/ROADMAP.md`](packages/plugin-gantt/ROADMAP.md):
> Phase 1 dependency links → Phase 2 real time scales → Phase 3 hierarchy/milestones →
> Phase 4 interaction polish → Phase 5 virtualization → Phase 6 advanced (critical path, baselines, auto-scheduling).

---

## 🔮 P3 — Future Vision (Deferred)

### CRM Example Metadata Enhancement ✅

> Comprehensive metadata expansion for the CRM reference implementation.

- [x] **P0: Reports** — Sales Report and Pipeline Report with full ReportSchema (fields, groupBy, sections, schedule, export)
- [x] **P0: Report Navigation** — Native `type: 'report'` navigation items (no shared config hack)
- [x] **P1: Seed Data — Users** — 7 users covering admin, manager, user, viewer roles + inactive user
- [x] **P1: Seed Data — Orders** — 7 orders covering all statuses (draft, pending, paid, shipped, delivered, cancelled)
- [x] **P1: Seed Data — Products** — 2 inactive products (`is_active: false`) for filter testing
- [x] **P1: Order ↔ Product Junction** — `order_items` object with line items (quantity, price, discount, item_type) + 12 seed records
- [x] **P1: Opportunity ↔ Contact Junction** — `opportunity_contacts` object with role-based relationships + 7 seed records
- [x] **P1: Contact ↔ Event Attendees** — `participants` field populated on all event seed data
- [x] **P2: Dashboard Dynamic Data** — "Revenue by Account" widget using `provider: 'object'` aggregation. DashboardRenderer now delegates `provider: 'object'` widgets to ObjectChart (`type: 'object-chart'`) for async data loading + client-side aggregation (sum/count/avg/min/max)
- [x] **P2: Fix Revenue by Account Chart** — Fixed 3 bugs preventing "Revenue by Account" chart from displaying data: (1) ObjectChart `extractRecords()` now handles `results.data` and `results.value` response formats in addition to `results.records`, (2) DashboardRenderer auto-adapts series `dataKey` from `aggregate.field` when aggregate config is present, (3) CRM dashboard `yField` aligned to aggregate field `amount` (was `total`). Centralized `extractRecords()` utility in `@object-ui/core` and unified data extraction across all 6 data components (ObjectChart, ObjectMap, ObjectCalendar, ObjectGantt, ObjectTimeline, ObjectKanban). Added 16 new tests.
- [x] **P2: App Branding** — `logo`, `favicon`, `backgroundColor` fields on CRM app
- [x] **P3: Pages** — Settings page (utility) and Getting Started page (onboarding)
- [x] **P2: Spec Compliance Audit** — Fixed `variant: 'danger'` → `'destructive'` (4 actions), `columns: string` → `number` (33 form sections), added `type: 'dashboard'` to dashboard
- [x] **P2: Dashboard Widget Spec Alignment** — Added `id`, `title`, `object`, `categoryField`, `valueField`, `aggregate` to all dashboard widgets across CRM, Todo, and Kitchen Sink examples (5 new spec-compliance tests)
- [x] **P2: i18n (10 locales)** — Full CRM metadata translations for en, zh, ja, ko, de, fr, es, pt, ru, ar — objects, fields, fieldOptions, navigation, actions, views, formSections, dashboard, reports, pages (24 tests)
- [x] **P2: Full Examples Metadata Audit** — Systematic spec compliance audit across all 4 examples: added `type: 'dashboard'` + `description` to todo/kitchen-sink dashboards, refactored msw-todo to use `ObjectSchema.create` + `Field.*` with snake_case field names, added explicit views to kitchen-sink and msw-todo, added missing `successMessage` on CRM opportunity action, 21 automated compliance tests
- [x] **P2: CRM Dashboard Full provider:'object' Adaptation** — Converted all chart and table widgets in CRM dashboard from static `provider: 'value'` to dynamic `provider: 'object'` with aggregation configs. 12 widgets total: 4 KPI metrics (static), 7 charts (sum/count/avg/max aggregation across opportunity, product, order objects), 1 table (dynamic fetch). Cross-object coverage (order), diverse aggregate functions (sum, count, avg, max). Fixed table `close_date` field alignment. Added i18n for 2 new widgets (10 locales). 9 new CRM metadata tests, 6 new DashboardRenderer rendering tests (area/donut/line/cross-object + edge cases). All provider:'object' paths covered.
- [x] **P1: Dashboard provider:'object' Crash & Blank Rendering Fixes** — Fixed 3 critical bugs causing all charts to be blank and tables to crash on provider:'object' dashboards: (1) DashboardRenderer `...options` spread was leaking provider config objects as `data` in data-table and pivot schemas — fixed by destructuring `data` out before spread, (2) DataTableRenderer and PivotTable now guard with `Array.isArray()` for graceful degradation when non-array data arrives, (3) ObjectChart now shows visible loading/warning messages instead of silently rendering blank when `dataSource` is missing. Also added provider:'object' support to DashboardGridLayout (charts, tables, pivots). 2 new regression tests.
- [x] **P1: Dashboard Widget Data Blank — useDataScope/dataSource Injection Fix** — Fixed root cause of dashboard widgets showing blank data with no server requests: `useDataScope(undefined)` was returning the full context `dataSource` (service adapter) instead of `undefined` when no bind path was given, causing ObjectChart and all data components (ObjectKanban, ObjectGallery, ObjectTimeline, ObjectGrid) to treat the adapter as pre-bound data and skip async fetching. Fixed `useDataScope` to return `undefined` when no path is provided. Also improved ObjectChart fault tolerance: uses `useContext` directly instead of `useSchemaContext` (no throw without provider), validates `dataSource.find` is callable before invoking. 14 new tests (7 useDataScope + 7 ObjectChart data fetch/fault tolerance).
- [x] **P1: URL-Driven Debug/Developer Panel** — Universal debug mode activated via `?__debug` URL parameter (amis devtools-style). `@object-ui/core`: exported `DebugFlags`, `DebugCollector` (perf/expr/event data collection, tree-shakeable), `parseDebugFlags()`, enhanced `isDebugEnabled()` (URL → globalThis → env resolution, SSR-safe). `@object-ui/react`: `useDebugMode` hook with URL detection, Ctrl+Shift+D shortcut, manual toggle; `SchemaRendererContext` extended with `debugFlags`; `SchemaRenderer` injects `data-debug-type`/`data-debug-id` attrs + reports render perf to `DebugCollector` when debug enabled. `@object-ui/components`: floating `DebugPanel` with 7 built-in tabs (Schema, Data, Perf, Expr, Events, Registry, Flags), plugin-extensible via `extraTabs`. Console `MetadataInspector` auto-opens when `?__debug` detected. Fine-grained sub-flags: `?__debug_schema`, `?__debug_perf`, `?__debug_data`, `?__debug_expr`, `?__debug_events`, `?__debug_registry`. 48 new tests.
- [x] **P1: Chart Widget Server-Side Aggregation** — Fixed chart widgets (bar/line/area/pie/donut/scatter) downloading all raw data and aggregating client-side. Added optional `aggregate()` method to `DataSource` interface (`AggregateParams`, `AggregateResult` types) enabling server-side grouping/aggregation via analytics API (e.g. `GET /api/v1/analytics/{resource}?category=…&metric=…&agg=…`). `ObjectChart` now prefers `dataSource.aggregate()` when available, falling back to `dataSource.find()` + client-side aggregation for backward compatibility. Implemented `aggregate()` in `ValueDataSource` (in-memory), `ApiDataSource` (HTTP), and `ObjectStackAdapter` (analytics API with client-side fallback). Only detail widgets (grid/table/list) continue to fetch full data. 9 new tests.
- [x] **P1: Spec-Aligned CRM I18n** — Fixed CRM internationalization not taking effect on the console. Root cause: CRM metadata used plain string labels instead of spec-aligned `I18nLabel` objects. Fix: (1) Updated CRM app/dashboard/navigation metadata to use `I18nLabel` objects (`{ key, defaultValue }`) per spec. (2) Updated `NavigationItem` and `NavigationArea` types to support I18nLabel. (3) Added `resolveLabel()` helper in NavigationRenderer. (4) Updated `resolveI18nLabel()` to accept `t()` function for translation. (5) Added `loadLanguage` callback in I18nProvider for API-based translation loading. (6) Added `/api/v1/i18n/translations/:lang` endpoint to mock server. Console contains zero CRM-specific code.
- [x] **P0: Opportunity List View & ObjectDef Column Enrichment** — Fixed ObjectGrid not using objectDef field metadata for type-aware rendering when columns are `string[]` or `ListColumn[]` without full options. (1) Schema resolution always fetches full schema from DataSource for field type metadata. (2) String[] column path enriched with objectDef types, options (with colors), currency, precision for proper CurrencyCellRenderer, SelectCellRenderer (colored badges), PercentCellRenderer, DateCellRenderer. (3) ListColumn[] fieldMeta deep-merged with objectDef field properties (select options with colors, currency code, precision). (4) Opportunity view columns upgraded from bare `string[]` to `ListColumn[]` with explicit types, alignment, and summary aggregation. 9 new tests.
- [x] **P1: Actions Merge into Object Definitions** — Fixed action buttons never showing in Console/Studio because example object definitions lacked `actions` field. Initially added `mergeActionsIntoObjects()` helper with longest-prefix name matching. Later refactored: all actions now declare explicit `objectName`, and merging is handled by `composeStacks()` from `@objectstack/spec`. Created todo task actions (6: complete, start, clone, defer, set_reminder, assign) and kitchen-sink showcase actions (3: change_status, assign_owner, archive). All CRM/Todo/Kitchen Sink objects now serve `actions` in metadata. Fixes #840.
- [x] **P1: Unified Debug/Metadata Entry — Remove Redundant Metadata Button** — Removed the visible `<MetadataToggle>` button from RecordDetailView, DashboardView, PageView, and ReportView headers. End users no longer see a "</> Metadata" button that had no practical purpose. The MetadataInspector panel is now only accessible via `?__debug` URL parameter (auto-opens when debug mode is active). ObjectView retains its admin-only Design Tools menu entry for metadata inspection. This unifies the debug entry point and improves end-user UX by removing redundant UI elements.

### Ecosystem & Marketplace
- Plugin marketplace website with search, ratings, and install count
- Plugin publishing CLI (`objectui plugin publish`) with automated validation
- 25+ official plugins

### Community Growth
- Official website (www.objectui.org) with interactive playground
- Discord community, monthly webinars, technical blog, YouTube tutorials

### ObjectUI Cloud (2027)
- Project hosting, online editor, Database as a Service
- One-click deployment, performance monitoring
- Billing system (Free / Pro / Enterprise)

### Industry Solutions (2027)
- CRM, ERP, HRM, E-commerce, Project Management accelerators
- AI-powered schema generation from natural language

---

## 📈 Success Metrics

### v1.0 Release Criteria

| Metric | Current | v1.0 Target | How Measured |
|--------|---------|-------------|--------------|
| **Protocol Alignment** | ~85% | 90%+ (UI-facing) | Protocol Consistency Assessment |
| **AppShell Renderer** | ✅ Complete | Sidebar + nav tree from `AppSchema` JSON | Console renders from spec JSON |
| **Designer Interaction** | Phase 2 (most complete) | DataModelDesigner drag/undo; ViewDesigner removed (replaced by ViewConfigPanel) | Manual UX testing |
| **Build Status** | 43/43 pass | 43/43 pass | `pnpm build` |
| **Test Count** | 6,700+ | 6,700+ | `pnpm test` summary |
| **Test Coverage** | 90%+ | 90%+ | `pnpm test:coverage` |
| **Storybook Stories** | 80 | 91+ (1 per component) | Story file count |
| **Console i18n** | 100% | 100% | No hardcoded strings |

---

## 🐛 Bug Fixes

### Console Metadata Lazy Loading (Phase 1) (April 2026)

**Root Cause:** The console's `MetadataProvider` fetched the full `app`,
`object`, `dashboard`, `report`, and `page` lists in parallel at startup
and held them in five top-level arrays via `useMetadata()`. As tenant
metadata grew, first-paint TTI, browser memory, and API pressure all
scaled linearly with total catalogue size — even when entering a single
app that only needed a fraction of it.

**Fix (Phase 1):** Refactored `MetadataProvider` to a per-type cache map
(`status / items / byName / fetchedAt / promise`) with these
characteristics:

1. Only the `app` list is fetched on mount (required by router and App
   switcher); other types are fully lazy.
2. New imperative API on the context value: `ensureType(type)` (in-flight
   de-duplicated), `getItem(type, name)` (single-record fetch + cache),
   `invalidate(type, name?)`, and per-type `refresh(type?)`.
3. New hooks: `useMetadataType(type)` and `useMetadataItem(type, name)`.
4. 5-minute TTL freshness on list buckets; `app` list is hydrated from
   `sessionStorage` on reload for instant first paint.
5. Fully backward compatible: `apps / objects / dashboards / reports /
   pages` are now lazy getters that auto-trigger `ensureType` on first
   read, so all 20+ existing call sites keep working unchanged.
6. Dev-only timing/cache-hit logs.

**Tests:** 7 new `MetadataProviderLazy.test.tsx` cases (only `app`
fetched on mount, lazy fetch on getter access, in-flight de-duplication,
single-item fetch & cache, per-record invalidation, scoped `refresh`,
`useMetadataItem` hook). Full console suite: 891 passed / 1 skipped.

**Follow-ups (deferred to later phases of the original plan):** route-
scoped `AppScopeProvider`, per-component migration to
`useMetadataItem`, route-level `React.lazy` chunking, and server-side
`?app=` filter pushdown / ETag support.

### Record Detail "Record Not Found" in External Metadata Environments (March 2026)

**Root Cause:** Three compounding issues caused "Record not found" when navigating from a list to a record detail page in external metadata environments:
1. `DetailView.tsx`'s alt-ID fallback only triggered when `findOne` returned null. If it threw an error (server 500, network failure, etc.), the error propagated to the outer catch handler and the fallback was never tried.
2. `ObjectStackAdapter.findOne` with `$expand` used `rawFindWithPopulate` with `$filter: { _id: id }`, which some external servers don't support. On failure it threw, instead of falling back to the simpler `data.get()` call.
3. Record IDs in navigation URLs were not URL-encoded, which could cause routing issues with IDs containing special characters.

**Fix:** Made `DetailView` catch all errors from the first `findOne` (converting to null) so the alt-ID fallback always runs. Made `ObjectStackAdapter.findOne` fall through to direct `data.get()` when the `$expand` raw request fails with a non-404 error. Added `encodeURIComponent` for record IDs in all navigation URL construction points.

**Tests:** 32 DetailView tests, 12 expand tests, 33 useNavigationOverlay tests, 6 RecordDetailEdit tests — all pass.

### Auth Registration and Login Unavailable in MSW/Server Modes (March 2026)

**Root Cause:** `createKernel.ts` (MSW mode) and `objectstack.config.ts` (Server mode) did not load `AuthPlugin`, so the kernel had no 'auth' service. All `/api/v1/auth/*` endpoints (sign-up, sign-in, get-session, sign-out) returned 404.

**Fix:**
1. Added `AuthPlugin` from `@objectstack/plugin-auth` to `objectstack.config.ts` for server mode (`pnpm dev:server`).
2. Created `authHandlers.ts` with in-memory mock implementations of better-auth endpoints for MSW mode (`pnpm dev`). Mock handlers are added to `customHandlers` in both `browser.ts` and `server.ts`.
3. Mock handlers support: sign-up/email, sign-in/email, get-session, sign-out, forget-password (better-auth convention), reset-password, update-user.

**Tests:** 11 new auth handler tests, all existing MSW (7) and auth (24) tests pass.

### Default Navigation Mode (Page) Clicks Have No Effect — Stale Closure (February 2026)

**Root Cause:** Three compounding issues created a stale closure chain in `ObjectView.tsx`:
1. `{ mode: 'page' }` fallback created a new object literal every render, causing `useNavigationOverlay`'s `handleClick` `useCallback` to be recreated with potentially stale deps.
2. The `onNavigate` callback was an inline arrow function with unstable identity, so React could batch-skip the render where `handleClick` picks up the fresh closure.
3. Cascade instability: `navOverlay` (from `useMemo`) got a new reference every render because its deps (`handleClick`, etc.) changed, propagating stale closures through `renderListView`.

**Fix:** Memoized `detailNavigation` with `useMemo` (stable reference for the `{ mode: 'page' }` fallback) and extracted `onNavigate` into a `useCallback` (`handleNavOverlayNavigate`) with `[navigate, viewId]` deps. This ensures stable identities for both inputs to `useNavigationOverlay`, preventing stale closures.

**Tests:** Added 2 stale closure prevention tests in `useNavigationOverlay.test.ts`: (1) verify `handleClick` uses latest `onNavigate` after re-render with new callback, (2) verify navigation works after config changes from undefined to explicit page mode. All 31 useNavigationOverlay tests and 739 console tests pass.

### ListView Grouping Config Not Taking Effect (February 2026)

**Root Cause:** `viewComponentSchema` `useMemo` in `ListView.tsx` was missing `groupingConfig`, `rowColorConfig`, and `navigation.handleClick` in its dependency array. When users toggled grouping fields via the toolbar popover, the state changed but the memoized schema was not recomputed, so the child grid/kanban/gallery never received the updated grouping config.

**Fix:** Added `groupingConfig`, `rowColorConfig`, and `navigation.handleClick` to the `useMemo` dependency array at line 856 of `ListView.tsx`.

**Tests:** Added integration test in `ListViewGroupingPropagation.test.tsx` that verifies toggling a group field via the toolbar immediately updates the rendered schema. All 117 ListView tests pass.

### List View Row Click Not Navigating to Record Detail (February 2026)

**Root Cause:** `onRowClick` in both `PluginObjectView` (line 772) and `renderListView` (line 599) of `ObjectView.tsx` fell back to `onEdit` / `editHandler`, which only opens an edit form. The `navOverlay.handleClick` from `useNavigationOverlay` — which handles drawer/modal/page navigation modes — was never connected to these click handlers. Additionally, the `useNavigationOverlay` hook was missing the `onNavigate` callback needed for `mode: 'page'` to update the URL.

**Fix:** Replaced `onEdit`/`editHandler` fallbacks with `navOverlay.handleClick` in both row click handlers, added `onNavigate` callback to `useNavigationOverlay` that sets the `recordId` URL search parameter, and added `navOverlay` to the `renderListView` useCallback dependency array.

**Tests:** All 32 ObjectView tests and 29 useNavigationOverlay tests pass.

### App.tsx handleRowClick Overriding All Navigation Modes (February 2026)

**Root Cause:** `App.tsx` defined a `handleRowClick` that hardcoded `setSearchParams({recordId})` (drawer-only behavior) and passed it unconditionally to `<ObjectView>` via `onRowClick={handleRowClick}`. This overrode the internal `navOverlay.handleClick` in Console's `ObjectView`, preventing page/modal/split/popover/new_window navigation modes from working.

**Fix:** Removed `handleRowClick` from `App.tsx` and the `onRowClick` prop from both `<ObjectView>` route elements. Updated Console `ObjectView` to always use `navOverlay.handleClick` (3 locations) instead of falling back to the external `onRowClick` prop. Removed the unused `onRowClick` prop from the `ObjectView` function signature.

**Tests:** All 42 ObjectView tests and 33 useNavigationOverlay tests pass (3 new tests added).

### ListView Multi-Navigation Mode Support — split/popover/page/new_window (February 2026)

**Root Cause:** While `drawer`/`modal` modes worked in the Console ObjectView, the remaining 4 navigation modes had gaps:
1. Console's `onNavigate` callback relied on implicit fallthrough for `view` action (page mode) — not explicit.
2. `PluginObjectView`'s `formLayout` only mapped `drawer`/`modal` modes; `split`/`popover` fell through to the default layout (`drawer`), rendering the wrong overlay type.
3. `PluginObjectView` lacked `NavigationOverlay` integration for `split` (resizable side-by-side panels) and `popover` (compact dialog preview).

**Fix:**
- Console `onNavigate` now explicitly checks for `action === 'view'` (page mode) alongside the existing `'new_window'` check.
- `PluginObjectView` `formLayout` now includes `split` and `popover` branches.
- `PluginObjectView` imports and renders `NavigationOverlay` from `@object-ui/components` for both `split` mode (with `mainContent` wrapping the grid) and `popover` mode (Dialog fallback when no `popoverTrigger`).
- Split mode close button properly resets form state via `handleFormCancel`.

**Tests:** Updated split/popover tests to verify `NavigationOverlay` rendering (close panel button for split, dialog role for popover). Added split close-and-return test. All 29 PluginObjectView tests and 37 Console ObjectView tests pass.

### ListView Grouping Mode Empty Rows (February 2026)

**Root Cause:** When grouping is enabled in list view, `buildGroupTableSchema` in `ObjectGrid.tsx` sets `pagination: false` but inherits `pageSize: 10` from the parent schema. The `DataTableRenderer` filler row logic (`Array.from({ length: Math.max(0, pageSize - paginatedData.length) })`) pads each group table with empty rows up to `pageSize`, creating many blank lines.

**Fix:** Added `pagination &&` condition to filler row rendering in `data-table.tsx`. Filler rows only render when pagination is enabled, since their purpose is maintaining consistent page height during paginated views.

**Tests:** Added 2 tests in `data-table-airtable-ux.test.tsx` verifying filler rows are skipped when pagination is off and still rendered when pagination is on. All 59 related tests pass.

### Metric Widget I18nLabel Render Crash (February 2026)

**Root Cause:** `MetricWidget` and `MetricCard` rendered I18nLabel objects (`{key, defaultValue}`) directly as React children. When CRM dashboard metadata used I18nLabel objects for `trend.label` (e.g. `{ key: 'crm.dashboard.trendLabel', defaultValue: 'vs last month' }`), React threw error #31 ("Objects are not valid as a React child").

**Fix:** Added `resolveLabel()` helper to `MetricWidget.tsx` and `MetricCard.tsx` that converts I18nLabel objects to plain strings before rendering. Updated prop types to accept both string and I18nLabel objects for `label`, `description`, and `trend.label`.

**Tests:** Added 3 new tests: 1 in `DashboardRenderer.widgetData.test.tsx` verifying metric widgets with I18nLabel trend labels render correctly, and 2 in `MetricCard.test.tsx` verifying I18nLabel resolution for title and description. All 159 dashboard tests pass.

### Field Type Display Issues — Lookup, User, Select, Status Renderers (February 2026)

**Root Cause:** Multiple renderer defects caused incorrect field value display across views:

1. **`LookupCellRenderer`** — Destructured only `value`, ignoring the `field` prop. When the API returned a raw primitive ID (e.g. `customer: 2`), the renderer fell through to `String(value)` and showed `"2"` instead of the related record's name. No attempt was made to resolve IDs via `field.options`.

2. **`UserCellRenderer`** — Did not guard against primitive values (number/string user IDs). Accessing `.name` / `.username` on a number returned `undefined`, silently falling through to `"User"` as the generic label.

3. **`getCellRenderer` standardMap** — `lookup` and `master_detail` were mapped to `SelectCellRenderer` instead of `LookupCellRenderer` in the fallback map. Although the fieldRegistry pre-registration shadowed this bug, it was semantically incorrect.

4. **`status`, `user`, `owner` types** — Not pre-registered in `fieldRegistry`. All went through the `standardMap` path, making their association with renderers implicit and invisible.

**Fix:**
- `LookupCellRenderer`: now accepts the `field` prop and resolves primitive IDs against `field.options` (matching by `String(opt.value) === String(val)` for type-safe comparison). Arrays of primitive IDs are resolved via the same logic. Null/empty-string guard updated from `!value` to `value == null || value === ''` to handle `0` correctly.
- `UserCellRenderer`: primitive values (typeof !== 'object') return a plain `<span>` with the string representation. Array items that are not objects are also handled gracefully.
- `getCellRenderer` standardMap: `lookup` and `master_detail` now correctly reference `LookupCellRenderer`.
- `fieldRegistry` now explicitly registers `status` → `SelectCellRenderer`, `user` → `UserCellRenderer`, and `owner` → `UserCellRenderer` alongside the existing `lookup`/`master_detail`/`select` registrations.

**Tests:** Added 36 new tests in `cell-renderers.test.tsx`:
- `getCellRenderer` registry assertions for `lookup`, `master_detail`, `status`, `user`, `owner` types
- `TextCellRenderer`: null, undefined, empty string, numeric zero (0 renders "0" not "-"), boolean false
- `LookupCellRenderer`: null, empty-string, primitive ID (number), primitive ID (string), unresolved primitive, object with name/label/_id, array of objects, array of primitive IDs resolved via options
- `UserCellRenderer`: null, primitive number ID, primitive string ID, object with name, object with username, array of user objects

5. **`TextCellRenderer`** — Used `value || '-'` which incorrectly rendered `'-'` for numeric `0` (falsy zero). Updated to `(value != null && value !== '') ? String(value) : '-'` for consistent null-only suppression.

All 313 `@object-ui/fields` tests pass.

### ListView Airtable-Style Toolbar Opt-In & Duplicate Record Count (February 2026)

**Root Cause (1 — Toolbar defaults):** `showHideFields`, `showColor`, and `showDensity` in `ListView.tsx` used opt-out logic (`!== false`), making secondary toolbar buttons visible by default. Airtable hides these controls unless explicitly enabled.

**Fix:** Changed default logic from `!== false` (opt-out) to `=== true` (opt-in) for `showHideFields`, `showColor`, and `showDensity` in the `toolbarFlags` computation. Updated `@default` JSDoc comments in `NamedListView` and `ListViewSchema` interfaces from `@default true` to `@default false`.

**Root Cause (2 — Duplicate record count):** Both `ListView.tsx` (`record-count-bar`) and `ObjectView.tsx` (`record-count-footer`) independently rendered the record count at the bottom, causing duplicate display.

**Fix:** Removed the `record-count-footer` from `ObjectView.tsx` since `ListView` already renders the authoritative `record-count-bar`.

**Tests:** Updated 11 tests across `ListView.test.tsx` and `ObjectView.test.tsx`. All 112 ListView tests and 32 ObjectView tests pass.

---

### DetailView/RecordDetailView SDUI Optimization (March 2026)

> Type-aware rendering, responsive layout, virtual scrolling, metadata-driven highlights, performance optimization, and activity panel collapse-when-empty.

**HeaderHighlight (`@object-ui/plugin-detail`):**
- [x] Use `getCellRenderer` for type-aware display (currency → `$250,000.00`, select → Badge, etc.) instead of raw `String(value)`
- [x] Add `objectSchema` prop for field metadata enrichment (type, options, currency, precision, format)

**autoLayout (`@object-ui/plugin-detail`):**
- [x] `inferDetailColumns` accepts optional `containerWidth` for responsive column capping (`<640px→1col`, `<900px→max 2col`)
- [x] `applyDetailAutoLayout` passes through `containerWidth` parameter

**RecordChatterPanel (`@object-ui/plugin-detail`):**
- [x] `collapseWhenEmpty` prop: auto-collapse panel when no feed items exist
- [x] Pass `collapseWhenEmpty` through to embedded `RecordActivityTimeline`

**DetailSection (`@object-ui/plugin-detail`):**
- [x] `virtualScroll` config (`VirtualScrollOptions`): progressive batch rendering for sections with many fields
- [x] Export `VirtualScrollOptions` type from package index

**RecordDetailView (`apps/console`):**
- [x] Wrap `detailSchema` construction with `useMemo` (deps: `objectDef`, `pureRecordId`, `related`, `childRelatedData`, `actionRefreshKey`)
- [x] Remove hardcoded `HIGHLIGHT_FIELD_NAMES`; read exclusively from `objectDef.views.detail.highlightFields` (no fallback)
- [x] Enable `collapseWhenEmpty` + `collapsible: true` on `RecordChatterPanel`

**Tests:** 125 plugin-detail tests passing (17 new) covering HeaderHighlight type-aware rendering, autoLayout responsive columns, RecordChatterPanel collapseWhenEmpty, DetailSection virtualScroll.

---

> Platform-level DetailView enhancements: auto-grouping from form sections, empty value hiding, smart header with primaryField/summaryFields, responsive breakpoint fix, and activity timeline collapse.

**Types (`@object-ui/types`):**
- [x] `DetailViewSection.hideEmpty?: boolean` — filter null/undefined/empty string fields; hide empty sections
- [x] `DetailViewSchema.primaryField?: string` — record-level title from data field
- [x] `DetailViewSchema.summaryFields?: string[]` — render key attributes as Badge in header

**DetailSection (`@object-ui/plugin-detail`):**
- [x] `hideEmpty` filtering: fields with null/undefined/empty string values are removed; section returns null when all fields hidden
- [x] Responsive breakpoint fix: `sm:grid-cols-2` → `md:grid-cols-2`, `sm:grid-cols-2 md:grid-cols-3` → `md:grid-cols-2 lg:grid-cols-3` (correct behavior on iPad+sidebar)

**DetailView Header (`@object-ui/plugin-detail`):**
- [x] Header renders `data[primaryField]` as h1 title (falls back to `schema.title`)
- [x] `summaryFields` rendered as `<Badge variant="secondary">` next to title

**RecordActivityTimeline (`@object-ui/plugin-detail`):**
- [x] `collapseWhenEmpty` prop: suppress "No activity recorded" message when true, showing only comment input

**RecordDetailView (`apps/console`):**
- [x] Read `objectDef.views?.form?.sections` for section grouping; fallback to flat field list
- [x] Remove `columns: 2` hardcode — let `autoLayout` infer optimal columns
- [x] Auto-detect `primaryField` from object fields (name/title)

**Field Renderers (`@object-ui/fields`):**
- [x] `EmailCellRenderer`: mailto link + hover copy-to-clipboard button
- [x] `PhoneCellRenderer`: tel link with call icon + hover copy-to-clipboard button
- [x] `BooleanCellRenderer`: warning Badge for active/enabled/verified fields when false (e.g. "Active — Off")

**Tests:** 94 plugin-detail tests passing (11 new), 100 field renderer tests passing (12 new) covering hideEmpty filtering, empty section hiding, primaryField/summaryFields rendering, responsive breakpoints, collapseWhenEmpty, autoLayout undefined-columns regression, email copy, phone copy+icon, boolean warning badge.

**Storybook:** Added `PrimaryFieldWithBadges` and `HideEmptyFields` stories.

---

### ListView/DetailView/DetailSection — Lookup Field & Type Display Consistency (March 2026)

> **Issue #939:** Lookup/master_detail fields displayed raw IDs (e.g. `o1`, `p1`) instead of expanded names across ListView, DetailView, and DetailSection.

**Root Causes (5 independent bugs):**

1. **ListView `$expand` race condition** — `expandFields` depended on async `objectDef` which could be `null` on first fetch, causing data to be requested without `$expand` and returning raw foreign-key IDs.
2. **DetailView missing `$expand` and objectSchema** — `findOne()` was called without `$expand` parameters and without loading `objectSchema`, so lookup fields could never be expanded.
3. **DetailSection missing objectSchema enrichment** — When `field.type` was not explicitly set, `displayValue` fell through to `String(value)`, bypassing type-aware CellRenderers even when objectSchema metadata was available.
4. **ObjectStackAdapter `find()` dropping `$expand`** — The `@objectstack/client` v3.0.10's `data.find()` (GET) does not support `expand` in its `QueryOptions` interface, so `$expand` was silently dropped during `convertQueryParams()`.
5. **ObjectStackAdapter `findOne()` ignoring params** — The `findOne()` method declared its params argument as `_params` (unused), meaning `$expand` was never sent to the server.

**Fix:**

- **ListView** (`packages/plugin-list/src/ListView.tsx`): Added `objectDefLoaded` state flag. Data fetch effect is gated on `objectDefLoaded` so the first fetch always includes correct `$expand` parameters. The `objectDef` fetch effect sets the flag in `finally` block to handle both success and error cases.
- **DetailView** (`packages/plugin-detail/src/DetailView.tsx`): Added `objectSchema` state. Data fetch effect now calls `getObjectSchema()` first, computes `$expand` via `buildExpandFields()`, and passes the params to `findOne()`. The resolved `objectSchema` is passed to `DetailSection` components.
- **DetailSection** (`packages/plugin-detail/src/DetailSection.tsx`): Added optional `objectSchema` prop. Fields are enriched with missing metadata (options, currency, precision, format, reference_to, reference_field) from `objectSchema` regardless of whether `field.type` is explicitly set. When `field.type` is not set, the type is also resolved from objectSchema. Explicit `field.type` always takes precedence for the resolved type.
- **ObjectStackAdapter `find()`** (`packages/data-objectstack/src/index.ts`): When `$expand` is present, routes through `rawFindWithPopulate()` which issues a raw GET request with a `populate=` query parameter derived from the `$expand` field names. The server's REST plugin routes `GET /data/:object` to `findData()` which processes `populate` (comma-separated string) for lookup expansion. Falls back to `client.data.find()` when no expand is needed.
- **ObjectStackAdapter `findOne()`** (`packages/data-objectstack/src/index.ts`): When `$expand` is present, uses the same `rawFindWithPopulate()` mechanism with `filter={"_id":"..."}` and `populate=` to fetch the single record with expanded lookup fields. Falls back to `client.data.get()` when no expand is needed.

**Tests:** 15 new tests added (2 ListView, 3 DetailView, 4 DetailSection, 8 data-objectstack). All 505 plugin tests + 94 data-objectstack tests pass.

---

### DetailSection — Mobile Responsive col-span Fix (March 2026)

> **Bug:** On mobile devices, detail page fields displayed in 3-column layout instead of single column, causing content to squeeze together and severely impacting readability.

**Root Cause:** When `applyAutoSpan` set `span: 3` on wide fields (textarea, markdown, etc.) in a 3-column layout, the resulting `col-span-3` CSS class was applied without responsive prefixes. In CSS Grid, when an item has `col-span-3` in a `grid-cols-1` layout, the browser creates 2 implicit column tracks — and subsequent auto-placed items flow into those implicit columns, producing a 3-column layout even on mobile.

**Fix:**

- **DetailSection** (`packages/plugin-detail/src/DetailSection.tsx`): Added `getResponsiveSpanClass()` helper that generates responsive col-span classes matching the grid breakpoints. For a 3-column layout: no col-span at base (mobile single-column), `md:col-span-2` at tablet, `lg:col-span-3` at desktop. For a 2-column layout: no col-span at base, `md:col-span-2` at tablet+. This ensures col-span never exceeds the visible column count at each breakpoint, preventing implicit grid columns on mobile.

**Tests:** 11 new tests (8 getResponsiveSpanClass unit tests + 3 DetailSection integration tests verifying no bare col-span-N classes appear). All 52 plugin-detail tests pass.

---

### RecordDetailView — Action Button Full-Chain Integration (March 2026)

> **Issue #107:** All Action buttons on record detail pages (Change Stage, Mark as Won, etc.) clicked with zero response — no dialogs, no API calls, no toast, no data refresh.

**Root Causes (6 independent bugs):**

1. **Missing `ActionProvider`** — `RecordDetailView` didn't wrap `DetailView` with `ActionProvider`, so `useAction()` fell back to an empty `ActionRunner` with no handlers.
2. **Action type overwritten** — `action:bar` component overrode `action.type` (`'api'`) with the component type (`'action:button'`), so `ActionRunner` never matched the registered `'api'` handler.
3. **No API handler** — `api` action targets were logical names (e.g., `'opportunity_change_stage'`), not HTTP URLs. The built-in `executeAPI()` tried `fetch('opportunity_change_stage')` which failed silently.
4. **No param collection** — `ActionParam[]` was passed as `params` (values) instead of `actionParams` (definitions to collect), so the param collection dialog was never triggered.
5. **No confirm/toast handlers** — `confirmText` fell back to `window.confirm`, success/error messages were silently dropped.
6. **No visibility context** — `useCondition` evaluated `visible` expressions like `"stage !== 'closed_won'"` with empty context, always returning `true`.

**Fix:**

- **RecordDetailView** (`apps/console/src/components/RecordDetailView.tsx`): Wrapped `DetailView` with `<ActionProvider>` providing `onConfirm`, `onToast`, `onNavigate`, `onParamCollection` handlers and a custom `api` handler that maps logical action targets to `dataSource.update()` operations.
- **action-bar** (`packages/components/src/renderers/action/action-bar.tsx`): Preserves original `action.type` as `actionType` when overriding with component type. Forwards `data` prop to child action renderers for visibility context.
- **action-button** (`packages/components/src/renderers/action/action-button.tsx`): Uses `actionType` for execution. Detects `ActionParam[]` arrays and passes as `actionParams`. Passes record `data` to `useCondition` for visibility expressions.
- **ActionConfirmDialog** (`apps/console/src/components/ActionConfirmDialog.tsx`): Promise-based confirmation dialog using Shadcn `AlertDialog`.
- **ActionParamDialog** (`apps/console/src/components/ActionParamDialog.tsx`): Dynamic form dialog for collecting action parameters (select, text, textarea) using Shadcn `Dialog`.

**Tests:** 6 new integration tests covering: action button rendering, confirm dialog show/accept/cancel, param collection dialog, toast notification, dataSource.update invocation. All 764 console tests pass.

---

## ⚠️ Risk Management

| Risk | Mitigation |
|------|------------|
| AppShell complexity (7 nav types, areas, mobile) | Start with static nav tree, add mobile modes incrementally |
| Designer DnD integration time | Use `@dnd-kit/core` (already proven in Kanban/Dashboard) |
| Airtable UX bar is high | Focus on Grid + Kanban + Form triad first; defer Gallery/Timeline polish |
| PWA real sync complexity | Keep simulated sync as fallback; real sync behind feature flag |
| Performance regression | Performance budgets in CI, 10K-record benchmarks |
| View config live preview dependency chain breakage | `generateViewSchema` hardcodes non-grid defaults; per-view-type integration tests required (see P1.8.1) |
| Config property type gaps (`NamedListView` missing fields) | Add first-class properties to `@object-ui/types`; use Zod schema to validate at runtime |

### P2.11 Airtable UX Polish: Table Selection, i18n, Layout, and Density ✅

> **Status:** Complete — Comprehensive UX polish for Airtable-level table experience.

**i18n Compliance:**
- [x] All hardcoded UI strings in `data-table.tsx` replaced with `t()` calls (12+ strings)
- [x] All hardcoded UI strings in `ListView.tsx` replaced with `t()` calls (6+ strings)
- [x] New i18n keys added to `en.ts` and `zh.ts` locale files (table/list sections)
- [x] Default fallback translations ensure standalone usage works without I18nProvider

**Row Selection Auto-Enable:**
- [x] `ObjectGrid` auto-enables `selectionMode: 'multiple'` when `batchActions`/`bulkActions` are defined
- [x] No explicit `selectable` config needed for bulk action workflows

**Column Width Optimization:**
- [x] Selection checkbox and row number columns reduced from `w-12` (48px) to `w-10` (40px)
- [x] Frozen column offset calculations updated to match new widths

**Border/Cell Contrast:**
- [x] Table row borders increased from `border-border/50` to `border-border` for better scanability

**Pagination Density:**
- [x] Filler row `colSpan` now correctly includes `showRowNumbers` count

---

## 📦 Detail Page & Related List i18n (P1.15)

> **Goal:** Salesforce-style detail page enhancements: i18n for all detail page UI elements, improved empty value display, related list actions, and auto-discovery of related lists.

**i18n Integration:**
- [x] Add `detail.*` translation keys to all 10 locale files (en, zh, ja, de, fr, es, ar, ru, pt, ko)
- [x] `useDetailTranslation` safe wrapper hook with English fallback (follows existing useGridTranslation/useListViewTranslation pattern)
- [x] DetailView fully i18n-integrated (Back, Edit, Share, Delete, Duplicate, Export, View history, Record not found, Related heading, favorites, navigation)
- [x] DetailSection copy tooltip i18n via `useSectionTranslation`
- [x] RelatedList i18n-integrated (record counts, loading, empty state)
- [x] Add `'detail'` to `BUILTIN_KEYS` in `useObjectLabel.ts` to prevent namespace collision

**Empty Value Display:**
- [x] Replace hardcoded `-` with styled em-dash (`—`) using `text-muted-foreground/50 text-xs italic` for elegant empty state

**Related List Enhancements:**
- [x] Add `onNew` prop and "New" button to RelatedList header
- [x] Add `onViewAll` prop and "View All" button to RelatedList header
- [x] Record count uses singular/plural i18n keys

**Tests:**
- [x] 10 new RelatedList tests (title, record counts, empty state, New/View All buttons)
- [x] 2 new DetailView i18n fallback tests (Record not found text, Related heading)
- [x] Updated DetailSection tests for new empty value styling

**Completed:**
- [x] Auto-discover related lists from objectSchema reference fields
- [x] Tab layout (Details/Related/Activity) for detail page
- [x] Related list row-level Edit/Delete quick actions
- [x] Related list pagination, sorting, filtering
- [x] Collapsible section groups
- [x] Header highlight area with key fields
- [x] Console `RecordDetailView` integration: `autoTabs`, `autoDiscoverRelated`, `highlightFields`, `sectionGroups` wired into `detailSchema` for end-to-end availability
- [x] Console reverse-reference discovery: child objects (e.g., `order_item` → `order`) auto-discovered and rendered with filtered data
- [x] `useSafeFieldLabel` wired into `DetailSection`, `RelatedList`, `HeaderHighlight` for convention-based field label i18n (#968, #883, #942)
- [x] `objectName` threaded through `DetailView` → `SectionGroup` → `DetailSection` / `HeaderHighlight` / `RelatedList`
- [x] RelatedList sortable headers fixed to use `effectiveColumns` (auto-generated from schema) instead of raw `columns` prop
- [x] Added missing `detail.*` i18n keys (`activity`, `editRow`, `deleteRow`, `previousPage`, `nextPage`, etc.) to en.ts and zh.ts
- [x] RelatedList auto-generated columns use `getCellRenderer` for type-aware cell rendering (date, currency, select/badge, lookup, boolean, etc.)
- [x] Console `RecordDetailView` fallback section title uses `t('detail.details')` instead of hardcoded English

---

## 📚 Reference

- [CONTRIBUTING.md](./CONTRIBUTING.md) — Contribution guidelines
- [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) — Developer quick reference
- [Plugin Development Guide](./content/docs/guide/plugin-development.md)

---

**Roadmap Status:** 🎯 Active — AppShell ✅ · Designer Interaction · View Config Live Preview Sync ✅ · Dashboard Config Panel ✅ · Schema-Driven View Config Panel ✅ · Right-Side Visual Editor Drawer ✅ · Feed/Chatter Documentation ✅ · Airtable UX Parity
**Next Review:** March 15, 2026
**Contact:** hello@objectui.org | https://github.com/objectstack-ai/objectui
