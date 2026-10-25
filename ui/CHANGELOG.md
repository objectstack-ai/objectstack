# Changelog

This file is a **hand-curated summary** of notable changes across the monorepo. It is
updated at release time by whoever cuts the release — it is not generated. The `Auto
Changelog` workflow (`.github/workflows/changelog.yml`) exists to regenerate it with
git-cliff, and runs on manual dispatch only.

For granular, always-current history, read the `CHANGELOG.md` published inside each
`@object-ui/*` package — Changesets writes those on every release commit, and they are
the source of truth where the two disagree.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Removed

- **Demo link from official website.** Removed the "View Demo" button from the homepage hero section and the "Demo" navigation link pointing to `demo.objectui.org`.

### Added

- **Spec-driven reports — `tabular` / `summary` / `matrix` / `joined`
  variants.** `@object-ui/plugin-report` now renders every report shape
  defined by `@objectstack/spec` (`Report` in `@objectstack/spec/ui`).
  A single `<ReportRenderer schema={...}>` (also registered as
  `spec-report` in `ComponentRegistry`) dispatches on `schema.type`.
  Authors write a JSON `Report` and get a fully wired view with
  grouping, aggregation, totals and drill-down.

- **`useReportData()` hook with server-side aggregation.** Translates a
  `Report` into spec `QueryAST` (`{ groupBy, aggregations, where, limit }`)
  and posts it to `POST /api/v1/data/:object/query`. Supports
  multi-level `groupingsDown` / `groupingsAcross`, `dateGranularity`
  (`day` / `week` / `month` / `quarter` / `year`), `unique` aggregation
  (distinct count), `mergeFilters($and)`, `drillDown(groupKey)`, and
  pre-fetched `rows` bypass. If the endpoint is unavailable the hook
  falls back transparently to `dataSource.find()` + client-side
  aggregation — no application code changes required.

- **`MatrixRenderer` — row × column pivot** with row totals, column
  totals and grand total. Every cell click dispatches a `drill` action
  with the combined row/column group key merged into the report filter.

- **`JoinedReportRenderer` — vertically stacked sub-reports.** A
  `type: 'joined'` report carries `blocks[]`; each block is rendered as
  its own independent report. Blocks inherit container `objectName`
  (fallback) and AND their `filter` with the container's; block failures
  are isolated; `block.type` excludes `'joined'` (no recursion).

- **Drill protocol — `drill` action.** New `DrillActionDef`,
  `buildDrillAction(report, groupKey, opts)` factory ($and-merges
  `report.filter` + `runtimeFilter` + `groupKey`),
  `createDrillHandler({ navigate })` and `registerDrillHandler(runner, opts)`.
  Hosts inject a `navigate` callback; the handler stays
  protocol-neutral. Two drill targets:
  1. **List view** (default) — navigates to the filtered records.
  2. **Report drawer** — if the calling widget declares
     `drillDown.report`, the click opens a side drawer rendering that
     report scoped to the cell's group key, composing
     **dashboard → report → record** in three clicks.

- **Dashboard → Report drill.** `DrillDownConfig` (in `@object-ui/types`)
  gains an optional `report` field; `DrillDownDrawer` renders it via
  `SchemaRenderer` as a `spec-report` instead of the default
  `ObjectDataTable`. `ObjectPivotTable` and `ObjectMetricWidget` forward
  `drillDown.report`.

- **`SpecReportGrid` — Tabular/Summary bridge to `ObjectGrid`.** Reuses
  `useGroupedData` and inherits cell rendering, sorting and
  virtualization, avoiding a third table implementation. New
  `count_distinct` aggregation in `useGroupedData.AggregationType`;
  `count` semantics aligned with SQL `count(*)`.

- **`isSpecReport` / `isJoinedSpecReport` type guards and
  `specReportToPresentation()` adapter** in
  `@object-ui/types/spec-report`. Lets hosts distinguish spec reports
  from legacy presentation schemas.

- **CRM example reports (5 new):** `pipeline_coverage_by_quarter`
  (matrix, `dateGranularity: quarter`), `opportunity_funnel_by_owner_stage`
  (summary, 2-level), `lead_inflow_by_month_source`
  (matrix, `dateGranularity: month`), `cases_opened_by_day_priority`
  (matrix, `dateGranularity: day`), `customer_churn_signals` (joined,
  3 blocks: at-risk accounts / silent high-value / recently lost opps).
  Sales Dashboard `pipeline_stage_by_source` pivot now drills into
  `pipeline_coverage_by_quarter` via the new report drawer.

### Changed

- **Server-side `dateGranularity` pushdown.** `useReportData()` reports
  with `{ groupBy: [{ field, dateGranularity }] }` are now aggregated
  directly in the database via native SQL (`strftime` / `to_char` /
  `date_format`) instead of fetching raw rows and bucketing in Node.
  The framework's `driver-sql` advertises per-granularity support via
  `IDataDriver.supports.queryDateGranularity` and the engine falls back
  to in-memory bucketing only when the dialect can't express a given
  granularity (notably SQLite `week`, which requires `strftime('%V')`
  added in SQLite 3.46). Output bucket labels (`2026-Q2`, `2026-01-15`,
  `2026-W23`, …) are byte-for-byte identical between paths so drill
  `groupKey` filters compose correctly across SQL and in-memory routes.
  Requires framework ≥ commit `b26d217c`.

- **`ReportRenderer` is now a thin dispatcher** that reads `schema.type`
  and routes to `MatrixRenderer` / `JoinedReportRenderer` /
  `SpecReportGrid` / legacy `ReportRenderer`. It also unwraps the
  `{ type: 'spec-report', report: {...} }` wrapper produced by
  `SchemaRenderer` registry dispatch so the inner `type` reaches the
  variant router.

- **`@object-ui/types` — `JoinedReportBlock` flattened** to mirror
  `JoinedReportBlockSchema` in `@objectstack/spec`. Block fields
  (`name`, `type`, `objectName`, `columns`, `groupingsDown`,
  `groupingsAcross`, `filter`, …) live at the top level of each block;
  the previous `block.report.{...}` nesting is gone.

- **`@object-ui/data-objectstack` — `aggregate()` spec-shape detection.**
  When the payload looks spec-shaped (`groupBy[]` / `aggregations[]` /
  `where`), the adapter routes directly to `client.data.query()`
  (`POST .../query`) instead of the single-measure analytics path,
  unblocking matrix and joined reports.

- **`@object-ui/app-shell` — `ReportView` router.** Reports whose
  top-level `type` is `matrix` or `joined` (or that carry
  `dateGranularity`) now render through the spec `ReportRenderer`
  dispatcher rather than the legacy viewer.

- **`@object-ui/plugin-report` README + plugin docs** rewritten to
  document the spec variants, `dateGranularity`, drill protocol,
  server-side aggregation, joined reports, and the filter-time CEL
  workaround. See `content/docs/plugins/plugin-report.mdx`.

- **`ManagedByBanner` (@object-ui/app-shell)** — surfaces a warning banner at the top of `ObjectView`, `RecordDetailView`, and `RecordFormPage` when an object's schema declares `managedBy !== 'platform'` (e.g. `'better-auth'`). Tells the user the table is owned by an upstream system and that direct edits bypass the owning system's hashing / session validation / audit hooks. `@object-ui/plugin-form` `ObjectForm` additionally disables every field by default when `managedBy !== 'platform'`. Resolves the silent-data-corruption risk where an admin could open `sys_user` / `sys_account` / `sys_session` etc. in the Console and write directly through the generic data API.
- **`ObjectSchemaMetadata.managedBy`** — new optional schema field (`'platform' | 'better-auth' | string`); default `'platform'`. Lets the platform mark tables as owned by an upstream system so the Console can render the appropriate guard rails.

### Fixed

- **CI: `MetadataDetailPage` flaky test (`should display field values
  from the item`).** The `useMetadataService()` and `useMetadata()`
  mocks in `apps/console/dev/__tests__/MetadataDetailPage.test.tsx`
  returned a fresh object literal on every render, which made
  `MetadataDetailPage`'s `fetchItem` `useCallback` reference change on
  every render and re-trigger the data-fetch `useEffect` in an infinite
  loading→loaded→loading loop. Locally the resolved promise won the
  race; in CI the page was occasionally still in the `loading` state
  when assertions ran, breaking the text lookup. Hoisted both mock
  return values to module-level singletons, and additionally hardened
  `apps/console/src/legacy/MetadataDetailPage.tsx` to read the
  `metadataService` and `config.label` through refs so an unstable
  hook return identity in any host can no longer cause the same loop
  (CI run #25541629421).

## [4.0.2] - 2026-05-08

### Added

- **Page-mode record forms (`editMode: 'page'`).** New per-object
  metadata flag that opts a record's create/edit form into a dedicated
  full-screen route instead of the default modal dialog. Routes are
  scoped under the active app:
  - `GET /apps/:appName/:objectName/new` — create page
  - `GET /apps/:appName/:objectName/record/:recordId/edit` — edit page

  These URLs are deep-linkable, refresh-safe, and integrate with the
  browser back button — making them suitable for long forms,
  multi-tab/wizard layouts, and copy-paste-share workflows. The same
  `<ObjectForm>` pipeline drives both modes, so every existing field /
  section / `formType` configuration carries over unchanged.

  Two new declarative actions, `navigate_create` and `navigate_edit`,
  let JSON `<action:button>` schemas open the page routes directly
  without any host-app code changes. Default behavior (modal) is
  preserved for any object that does not set `editMode`.

  Implemented in `@object-ui/app-shell` (new `RecordFormPage` view +
  routes in `AppContent`). Type added to `@object-ui/types`
  (`ObjectSchemaMetadata.editMode`). New guide at
  `content/docs/guide/record-edit-modes.md`.

### Fixed

- **CI: `ReportViewer` conditional-formatting test.** Made the
  background-color assertion in
  `packages/plugin-report/src/__tests__/ReportViewer.test.tsx`
  tolerant of both `rgb(...)` and hex (`#rrggbb`) representations.
  Newer jsdom versions preserve the original hex value on
  `HTMLElement.style.backgroundColor` instead of normalizing to
  `rgb(...)`, which broke the previous strict equality check
  (CI run #25539753515).
- **`@object-ui/plugin-list` & `@object-ui/plugin-detail`: shared `ComponentRegistry` singleton broken when consumed via published dist.** Both packages' `vite.config.ts` only listed `react`, `react-dom`, `react/jsx-runtime` in `rollupOptions.external`. As a result Rolldown inlined `@object-ui/core` (and a large chunk of lucide-react) into each plugin's bundle, giving every plugin its **own private `ComponentRegistry` instance**. Downstream apps that loaded the published plugins from npm saw `registry.get('object-grid')` from one plugin return `undefined` for components registered by another plugin — only workspace `alias` overrides pointing back to `packages/*/src` masked the issue. The `external` config now uses a regex covering all `@object-ui/*` workspace packages, the `@object-ui/*` deps have been moved from `dependencies` to `peerDependencies` (versioned `workspace:^` for publish-time rewrite, mirrored in `devDependencies` for local builds), and a regression test (`packages/core/src/registry/__tests__/cross-plugin-singleton.test.ts`) imports the built dist of `@object-ui/plugin-grid` and `@object-ui/plugin-list` and asserts cross-plugin lookup works against the same `ComponentRegistry` singleton. Downstream consumers (e.g. framework `apps/dashboard`) can now drop any `OBJECTUI_ROOT` / `packages/*/src` aliases.
  - `packages/plugin-list/dist/index.js` shrank from a multi-megabyte icon bundle to **67 kB** (gzip 16 kB).
  - `packages/plugin-detail/dist/index.js` shrank to **124 kB** (gzip 28 kB).
- **CI: `apps/console` ObjectView test failures.** The `vi.mock('@object-ui/i18n', ...)`
  block in `apps/console/dev/__tests__/ObjectView.test.tsx` was returning bare
  functions for `useObjectTranslation` / `useObjectLabel`, but the real hooks
  return objects with `{ t, ... }` and `{ objectLabel, objectDescription, ... }`
  — `ObjectView` therefore crashed on `objectLabel is not a function`. The
  mocks have been rewritten to mirror the real shape, the broken
  `useNavigationOverlay` stub has been dropped (the real hook drives the
  drawer/modal/split/popover state machine and the page-mode `onNavigate`),
  the smart `dataSource.find('sys_view', …)` mock now seeds sys_view-backed
  views so the chevron config menu renders, and the dependent tests have been
  converted to `async` + `findByTestId` to wait for the async fetch.
- **`@object-ui/app-shell` CreateViewDialog churn.** `existingSet` is now
  memoised on the joined string key of `existingLabels` rather than the raw
  array reference, preventing the name-suggest `useEffect` from re-firing on
  every parent render when callers pass an inline `views.map(v => v.label)`.

## [4.0.0] - 2026-05-07

### Added

- **Sidebar group label i18n convention.** `useObjectLabel` (`@object-ui/i18n`)
  now exposes `navGroupLabel(appName, groupId, fallback)`, resolving against
  `{ns}.apps.{appName}.navigation.{groupId}.label` across discovered app
  namespaces. `NavigationRenderer` (`@object-ui/layout`) accepts a new
  `resolveGroupLabel` callback that is applied to `type: 'group'` items with a
  plain string label. `UnifiedSidebar` (`@object-ui/app-shell`) wires it from
  the active app, so apps can translate navigation group labels (e.g.
  "Sales" → "销售") purely through translation packs without editing app
  metadata.

- **Sidebar/breadcrumb/chart/table i18n convention.** Convention-based i18n
  was extended across the dashboard surface so translation packs can localise
  every label without metadata edits:
  - `useObjectLabel` (`@object-ui/i18n`) now exposes `pageLabel` and
    `reportLabel` to mirror `dashboardLabel` (`{ns}.pages.{name}.label`,
    `{ns}.reports.{name}.label`). The app-namespace discovery used by
    `resolve()` recognises `pages` and `reports` buckets.
  - `useSafeFieldLabel` now also exposes `fieldOptionLabel` for plugin
    components rendered outside an `I18nProvider`.
  - `NavigationRenderer` (`@object-ui/layout`) accepts a new
    `resolveDashboardLabel` callback alongside `resolveObjectLabel`, used to
    translate dashboard-type sidebar items via the convention. Pin/unpin
    `aria-label`s and the drag-handle `aria-label` are now keyed
    (`console.nav.pinItem`, `console.nav.unpinItem`,
    `console.nav.dragToReorder`); the inline "Favorites" group label uses
    `console.nav.favorites`.
  - `UnifiedSidebar` (`@object-ui/app-shell`) wires
    `resolveDashboardLabel={dashboardLabel}` and replaces the hard-coded
    "Area"/"Recent"/"Favorites"/"Starred" group labels and
    "Remove … from favorites" `aria-label`s with `t('sidebar.*')` keys
    (new `sidebar.area/recent/favorites/starred/removeFromFavorites`).
  - `AppHeader` (`@object-ui/app-shell`) breadcrumb dashboard/page/report
    segments now look up the metadata definition and call `dashboardLabel`,
    `pageLabel`, or `reportLabel` instead of `humanizeSlug(slug)`.
  - `DashboardView` (`@object-ui/app-shell`) "Edit" button uses
    `t('common.edit')`.
  - `ChartRenderer` (`@object-ui/plugin-charts`) accepts `series[].label`
    and uses it for the auto-generated `ChartConfig`. `DashboardRenderer`
    (`@object-ui/plugin-dashboard`) populates each chart series with
    `label: fieldLabel(widget.object, dataKey)` so axis/legend titles
    follow the field-label convention.
  - `ObjectChart`'s `resolveGroupByLabels` accepts an optional
    `translateOption` callback. The component injects one bound to
    `fieldOptionLabel(objectName, groupBy, value, fallback)` so chart
    legend categories (e.g. opportunity stages) translate via the
    `fieldOptions.*` convention.
  - `ObjectDataTable` (`@object-ui/plugin-dashboard`) translates
    auto-derived column headers via `fieldLabel(objectName, accessorKey)`,
    fetches the object schema, and rewrites select/picklist cell values via
    `fieldOptionLabel` before delegating to `data-table`.
  - `data-table` (`@object-ui/components`) formats ISO date / datetime
    cell values with `Intl.DateTimeFormat(language)` so dates render in
    the active locale (e.g. `2026年6月4日 21:35` for `zh-CN`).
  - 13 widget-data tests updated to assert the new `series[].label`
    fallback.

- **Dashboard i18n convention.** `useObjectLabel` (`@object-ui/i18n`) now
  exposes `dashboardLabel`, `dashboardDescription`, `dashboardActionLabel`,
  `widgetTitle`, and `widgetDescription` helpers that auto-resolve translations
  via the convention `{ns}.dashboards.{dashboardName}.label|description|`
  `actions.{actionUrl}.label|widgets.{widgetId}.title|description` — mirroring
  the existing `objects.*`/`fields.*`/`apps.*` patterns. `DashboardRenderer`
  (`@object-ui/plugin-dashboard`) and `DashboardView` (`@object-ui/app-shell`)
  use these hooks for the page header, header action buttons, and widget
  titles/descriptions, so dashboard metadata can keep English fallbacks while
  translation packs supply localized text. The `apps/console` translation
  loader (`loadLanguage.ts`) now passes the `dashboards` namespace through
  to i18next so spec-format `TranslationData` payloads are picked up. Adds
  8 unit tests covering the new helpers.

### Fixed

- **`@object-ui/app-shell` DashboardView modal handler**: Header `modal`
  actions emitted with the conventional `<verb>_<object>` `actionUrl`
  (e.g. `create_opportunity`, `edit_lead`) now correctly resolve to the
  underlying object name and `mode`. Previously the string was passed
  through verbatim as `objectName`, causing the form loader to request
  `/api/v1/meta/object/create_opportunity` and fail with `[ObjectStack]
  Not Found` when clicking the dashboard's "New Opportunity" button.
- **`@object-ui/fields`**: Fixed flaky `RecordPickerDialog` test that asserted
  `renderGrid` slot props before async data fetch had completed. The test now
  awaits the final render with populated records before asserting.
- **`apps/console`**: Removed non-existent `pnpm msw:init` step from Vercel
  build command that caused deployment failures (exit code 254).

### Changed

- **`MetadataProvider` now lazy-loads metadata.** Previously the console
  fetched the full `app`, `object`, `dashboard`, `report`, and `page`
  lists in parallel at app startup, so first-paint cost scaled linearly
  with tenant size. The provider now only fetches the `app` list
  eagerly (required by the router and the App switcher); the other
  buckets are loaded on demand the first time a consumer reads them.
  Concurrent reads share a single in-flight request, results are cached
  with a 5 minute TTL, and the eager `app` list is hydrated from
  `sessionStorage` on reload for an instant first paint.
  - New context API: `ensureType(type)`, `getItem(type, name)`,
    `invalidate(type, name?)`, `refresh(type?)` (per-type form).
  - New hooks: `useMetadataType(type)`, `useMetadataItem(type, name)`.
  - The legacy `useMetadata()` shape (`apps`, `objects`, `dashboards`,
    `reports`, `pages`, `loading`, `error`, `refresh`,
    `getItemsByType`) is preserved — reading any of the lazy array
    properties transparently triggers `ensureType` so existing
    components keep working without changes. The `loading` flag now
    reflects only the initial `app` load, not lazy buckets.

### Fixed

- **"Object Not Found" / React "Rendered more hooks" crash on app entry.**
  A regression introduced by the lazy `MetadataProvider` refactor above:
  `useMetadata().objects` started empty while the lazy fetch was in flight,
  so `ObjectView` hit its `if (!objectDef) return <Empty/>` early return on
  the first render; once the fetch resolved, the hooks declared below that
  early return ran and React threw _"Rendered more hooks than during the
  previous render"_. `AppContent` now preloads the `object`, `dashboard`,
  `report`, and `page` buckets (via `ensureType`) before rendering the
  routes under `/apps/:appName/*`, so legacy components that assume
  metadata is fully loaded by render time continue to work. `/home`,
  `/login` and `/register` do not go through `AppContent`, so the Phase 1
  benefit of fetching only the `app` list at boot is preserved.

- **Record detail header** no longer renders two separate "More" (⋯) overflow
  menus when an object defines more `record_header` actions than
  `maxVisible`. The hardcoded `<DropdownMenu>` inside
  `@object-ui/plugin-detail`'s `DetailView` has been removed; its contents
  (Duplicate, Export, View History, Delete, plus mobile-only Share / Edit /
  Inline Edit fallbacks) are now emitted as `ActionSchema` entries and
  funnelled through the record-header `action:bar` via its new
  `systemActions` field. At most **one** overflow menu is rendered per bar,
  regardless of how many business actions the object metadata contributes.

### Changed

- **`action:bar` schema** now accepts `systemActions?: ActionSchema[]`
  (`@object-ui/components`). System/chrome actions are always placed in the
  overflow menu (never inline) and share the same `⋯` trigger with any
  business-action overflow. A visual separator is automatically inserted
  between business and system groups.
- **`ActionSchema`** (`@object-ui/types`) exposes an optional UI-local
  `onClick?: () => void | Promise<void>` escape hatch. `action:menu`
  short-circuits to `onClick` when present, bypassing the ActionEngine.
  This is intended for chrome-level callbacks (e.g., opening the native
  Share sheet, toggling inline-edit mode) that depend on React state and
  are not part of the server-driven action protocol.

- **Console home page (`/home`)** now uses a top navigation bar (`HomeTopNav`)
  instead of the left `UnifiedSidebar`. This visually separates the workspace
  landing page from individual applications (which still use `AppShell` +
  `UnifiedSidebar` for their rich, contextual left-hand navigation). Fixes
  confusion when the home page and an application page look visually
  identical. The top nav keeps the workspace switcher, Home link, search
  (⌘K), activity feed, help, theme toggle, locale switcher, and user
  profile menu.


## [3.3.0] - 2026-04-17

> First official release of Object UI published for third-party consumption.
> All 39 packages under `packages/*` are now published to npm at version `3.3.0`
> and aligned with `@objectstack/spec` v3.3.0 / `@objectstack/client` v3.3.0.

### Release Highlights

- **Package publishing:** All 39 packages now ship with complete `package.json`
  release metadata (`description`, `keywords`, `repository`, `homepage`, `bugs`,
  `license`, `author`, `publishConfig`, `files`) and a per-package `LICENSE` +
  `CHANGELOG.md`.
- **Documentation:** Every package README follows a standard template with
  Installation, Quick Start, API, **Compatibility**, **Links**, and **License**
  sections. The docs site (`content/docs/`) is refreshed for v3.3.0.
- **Architecture:** Spec v4 alignment (plain-string `label` types across
  Navigation schemas), unified Copilot Skills architecture, new thin packages
  (`@object-ui/app-shell`, `@object-ui/providers`) for third-party integration,
  and a streamlined console rendering pipeline (~50KB core vs. 500KB+ before).

### Fixed

- **apps/console Vercel deployment** — The production build for Vercel previously ran `vite build` without setting `VITE_USE_MOCK_SERVER=false`, which caused the MSW service worker to be bundled and started in production. As a result, all `/api/v1/*` requests were intercepted locally and the console never actually connected to its configured backend (e.g. `demo.objectstack.ai`). Users hitting routes such as `/apps/<app>/<object>` would see an *object not found* empty state because the MSW mock dataset does not contain every production app/object. `apps/console/vercel.json` now explicitly sets `VITE_USE_MOCK_SERVER=false` in the Vercel `buildCommand`, and the README documents the required `VITE_SERVER_URL` environment variable.

### Added

- **@object-ui/app-shell** - New package providing minimal application rendering engine for third-party integration
  - `AppShell` - Basic layout container component
  - `ObjectRenderer` - Renders object views (Grid, Kanban, List, etc.)
  - `DashboardRenderer` - Renders dashboard layouts from schema
  - `PageRenderer` - Renders custom page schemas
  - `FormRenderer` - Renders forms (modal or inline)
  - Framework-agnostic design (~50KB bundle size)

- **@object-ui/providers** - New package with reusable React context providers
  - `DataSourceProvider` - Generic data source context (not ObjectStack-specific)
  - `MetadataProvider` - Schema/metadata management
  - `ThemeProvider` - Theme management with system theme detection
  - Zero backend coupling (~10KB bundle size)

- **examples/minimal-console** - Proof-of-concept demonstrating third-party integration
  - Custom console built in ~100 lines of code
  - Custom routing with React Router
  - Mock data source (not ObjectStack)
  - No console dependencies
  - Shows how to integrate ObjectUI without full console infrastructure

- **Architecture Documentation** - New `docs/ARCHITECTURE.md` explaining:
  - Package architecture and boundaries
  - Migration strategy from monolithic console
  - Integration examples for third-party systems
  - Custom data source interface

### Changed

- Console can now be streamlined for third-party use without inheriting full infrastructure
- Bundle size for core rendering reduced from 500KB+ to ~50KB using new packages

### Changed (additional)

- **Copilot Skills Architecture Unified** (`skills`): Consolidated 10 parallel ObjectUI Copilot skills (`objectui-auth-permissions`, `objectui-console-development`, `objectui-data-integration`, `objectui-i18n`, `objectui-mobile`, `objectui-plugin-development`, `objectui-project-setup`, `objectui-schema-expressions`, `objectui-sdui-page-builder`, `objectui-testing`) into a single tree-based `skills/objectui/` structure aligned with shadcn/ui best practices. The new architecture features:
  - **Single entry point** (`skills/objectui/SKILL.md`): Unified skill manifest with core principles, architecture overview, and indexed references to guides and rules.
  - **Global rules** (`skills/objectui/rules/`): Protocol compliance, styling constraints, component composition patterns, and no-touch zones as dedicated markdown files.
  - **Domain guides** (`skills/objectui/guides/`): 10 specialized guides (page-builder, plugin-development, schema-expressions, data-integration, project-setup, testing, i18n, mobile, auth-permissions, console-development) for deep domain expertise.
  - **Unified evals** (`skills/objectui/evals/`): All evaluation JSON files consolidated from parallel skill evals directories.
  - **Updated skills-lock.json**: Now references only `objectui` (local) and `shadcn` (github) skills, removing fragmented cross-skill dependencies.
  - This restructuring improves AI agent selection accuracy, reduces maintenance overhead, and aligns with shadcn/ui's single-skill tree model for better ecosystem compatibility.

### Improved

- **Console UI design optimization sweep** (`@object-ui/console`): Comprehensive accessibility and design consistency improvements across all major console interfaces:
  - **Accessibility (WCAG 2.1 AA)**: Added `aria-label`, `aria-pressed`, `aria-required`, `aria-live`, `role="status"`, `role="link"`, `role="toolbar"`, `role="img"` attributes across HomePage, SystemHubPage, MetadataManagerPage, MetadataDetailPage, AppManagementPage, ProfilePage, SearchResultsPage, AuthPageLayout, and DashboardView. Added keyboard navigation (Enter/Space) to all clickable Card components. Added `<title>` element to SVG logo. Added screen-reader-only `<label>` elements for search inputs.
  - **Design tokens**: Replaced hardcoded `bg-blue-50`/`text-blue-700` badge in AppCard with Shadcn `<Badge variant="secondary">` for consistent theming.
  - **Shadcn component alignment**: Replaced raw `<input type="checkbox">` elements in AppManagementPage with Shadcn `<Checkbox>` component for consistent styling and accessibility.
  - **Spacing consistency**: Standardized responsive padding (`px-4 sm:px-6`) on HomePage, unified grid columns across RecentApps/StarredApps (4 columns at xl), standardized `gap-4` in MetadataManagerPage grid, graduated padding (`p-2 sm:p-4 md:p-6`) in DashboardView.
  - **Focus management**: Added `focus-visible:opacity-100` on AppCard favorite button so keyboard users can discover it, added focus rings to search result card links, added `focus-visible:ring-2` to DashboardView widget toolbar buttons and MetadataFormDialog native select.
  - **i18n compatibility**: Replaced CSS `capitalize` with programmatic string casing in RecentApps/StarredApps type labels.

### Fixed

- **E2E sidebar tests failing due to missing auth** (`e2e`): The `sidebar-text-visibility.spec.ts` tests failed because the MSW mock environment returns `auth.enabled: true` in its discovery response, causing `AuthGuard` to redirect unauthenticated users to the login page where no sidebar exists. Added `e2e/helpers/auth.ts` with a `registerAndLogin()` helper that signs up a test user via the register form, and updated both sidebar tests to authenticate before asserting sidebar visibility.

- **Changesets release bump escalation** (`release`): Added `___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH.onlyUpdatePeerDependentsWhenOutOfRange` in `.changeset/config.json` and moved internal `@object-ui/*` entries in `@object-ui/plugin-designer` from `peerDependencies` to `dependencies` to prevent minor release PRs from incorrectly escalating fixed-group packages to a major version.

- **Home page star/favorite not reactive** (`@object-ui/console`): Migrated `useFavorites` from standalone hook to React Context (`FavoritesProvider`) so all consumers (HomePage, AppCard, AppSidebar, UnifiedSidebar) share a single state instance. Previously, each component calling `useFavorites()` created independent state, so toggling a favorite in AppCard did not trigger re-render in HomePage. localStorage persistence is retained as the storage layer.

### Changed

- **Storybook CI scope reduced** (`ci`): Updated `.github/workflows/storybook-tests.yml` to run only on `push` to `main` (removed `pull_request` and `develop` triggers) and removed the PR-only visual regression step to reduce heavy CI load on contributor PRs.

- **Merged ObjectManagerPage into MetadataManagerPage pipeline** (`@object-ui/console`): Removed the standalone `ObjectManagerPage` component. Object management is now fully handled by the generic `MetadataManagerPage` (list view) and `MetadataDetailPage` (detail view) pipeline. The object type config in `metadataTypeRegistry` uses `listComponent: ObjectManagerListAdapter` for the custom list UI and `pageSchemaFactory: buildObjectDetailPageSchema` for the detail page, eliminating redundant page code and centralizing all metadata management through a single architecture.

- **`listComponent` extension point on MetadataTypeConfig** (`@object-ui/console`): New optional `listComponent` field allows metadata types to inject a fully custom list component into `MetadataManagerPage`, replacing the default card/grid rendering. The page shell (header, back button, title) is still rendered by the generic manager. `MetadataListComponentProps` interface provides `config`, `basePath`, `metadataType`, and `isAdmin` to the custom component.

- **Routes unified to `/system/metadata/object`** (`@object-ui/console`): All entry points (sidebar, QuickActions, SystemHubPage hub cards) now point to `/system/metadata/object` instead of `/system/objects`. Legacy `/system/objects` routes redirect to the new path for backward compatibility.

### Removed

- **`ObjectManagerPage`** (`@object-ui/console`): Deleted `pages/system/ObjectManagerPage.tsx`. All object management functionality is now delivered through the `ObjectManagerListAdapter` + `MetadataManagerPage`/`MetadataDetailPage` pipeline.

- **`customRoute` on object type config** (`@object-ui/console`): The object metadata type no longer uses `customRoute: '/system/objects'`. It now routes through the standard metadata pipeline at `/system/metadata/object`.

### Fixed

- **Protocol bridges** (`@object-ui/core`): Updated `DndProtocol`, `KeyboardProtocol`, and `NotificationProtocol` to align with `@objectstack/spec` v4 type changes where `ariaLabel`, `label`, `title`, and `message` fields are now plain strings instead of i18n translation objects (`{ key, defaultValue }`).

- **CRM example** (`@object-ui/example-crm`): Converted all i18n label objects (`{ key, defaultValue }`) in `crm.app.ts` and `crm.dashboard.ts` to plain strings to match the updated `@objectstack/spec` v4 schema requirements.

- **Console app** (`@object-ui/console`): Fixed unused import warnings (`MetadataFormFieldDef`, `MetadataActionDef`, `toast`) and a `defaultValue` type mismatch (`unknown` → `string | undefined`) in `MetadataService.ts`.

### Changed

- **Object detail page migrated to PageSchema-driven rendering** (`@object-ui/console`): The object detail page (both at `/system/objects/:objectName` and `/system/metadata/object/:objectName`) is now rendered via `SchemaRenderer` using a `PageSchema` built by `buildObjectDetailPageSchema()`. Each section (properties, relationships, keys, data experience, data preview, field designer) is a self-contained SchemaNode widget registered in the ComponentRegistry. This replaces the monolithic `ObjectDetailView` component with a composable, metadata-driven architecture.

- **MetadataDetailPage unified PageSchema support** (`@object-ui/console`): `MetadataDetailPage` now supports three rendering modes in priority order: (1) PageSchema-driven via `pageSchemaFactory` in the registry config, (2) custom `detailComponent`, (3) default card layout. The `hasCustomPage` + `<Navigate>` redirect hack has been removed — all metadata detail pages are rendered directly by `MetadataDetailPage`.

- **MetadataTypeConfig refactored** (`@object-ui/console`): Replaced `hasCustomPage` boolean flag with the more expressive `pageSchemaFactory` function and kept `customRoute` for hub card linking. The `getGenericMetadataTypes()` helper now filters by `customRoute` instead of `hasCustomPage`.

- **SchemaErrorBoundary for detail pages** (`@object-ui/console`): Added `SchemaErrorBoundary` class component to both `MetadataDetailPage` and `ObjectManagerPage` to gracefully catch and display rendering errors when a PageSchema or its widgets fail to render.

### Added

- **Object detail schema widgets** (`@object-ui/console`): Six self-contained SchemaNode widget components for the object detail page, registered in ComponentRegistry: `object-properties`, `object-relationships`, `object-keys`, `object-data-experience`, `object-data-preview`, `object-field-designer`. Each widget resolves its data from React context (`useMetadata`, `useMetadataService`) making them fully composable via PageSchema.

- **Object detail PageSchema factory** (`@object-ui/console`): `buildObjectDetailPageSchema(objectName, item?)` generates a `PageSchema` for object detail pages. The schema defines the page structure as an array of widget nodes, enabling server-driven UI customization of the object detail page layout.

- **`pageSchemaFactory` on MetadataTypeConfig** (`@object-ui/console`): New optional factory function on the registry config that generates a `PageSchema` for detail page rendering via `SchemaRenderer`. When defined, `MetadataDetailPage` uses schema rendering instead of the default card layout.

- **Grid list mode for MetadataManagerPage** (`@object-ui/console`): MetadataManagerPage now supports `listMode: 'grid' | 'table'` configuration via the metadata type registry. When set, items are rendered in a professional table layout with column headers, sortable rows, and inline action buttons — matching the Power Apps table listing UX. The `report` type is configured to use grid mode by default.

- **Enhanced Object Detail View (Power Apps alignment)** (`@object-ui/console`): ObjectDetailView now includes dedicated sections beyond the existing Object Properties and Fields:
  - **Relationships section**: Displays all relationships with type badges (one-to-many, many-to-one), related object names, and foreign key info. Shows empty state message when no relationships are defined.
  - **Keys section**: Automatically extracts and displays primary keys, unique keys, and external ID fields from the object's field metadata.
  - **Data Experience section**: Placeholder cards for Forms, Views, and Dashboards design capabilities — preparing the UI structure for future implementation.
  - **Inline data preview placeholder**: Dedicated "Data Preview" section with placeholder UI for sample data grid (Power Apps parity).
  - **System field hints**: Visual indicator warning that system fields (id, createdAt, updatedAt) are read-only and cannot be edited.

- **Reusable MetadataGrid component** (`@object-ui/console`): Extracted the grid/table rendering logic from MetadataManagerPage into a standalone `MetadataGrid` component (`components/MetadataGrid.tsx`). Supports configurable columns, action buttons, row click handlers, and delete confirmation state. Can be reused by any metadata type list page.

- **MetadataDetailPage unified schema rendering** (`@object-ui/console`): MetadataDetailPage now renders object detail pages via PageSchema (using `pageSchemaFactory`) instead of redirecting to `/system/objects/:name`. The redirect-based approach (`hasCustomPage` + `<Navigate>`) has been replaced with direct schema rendering.

- **MetadataProvider dynamic type access** (`@object-ui/console`): Added `getItemsByType(type)` method to `MetadataContextValue`, allowing pages to access cached metadata items for any known type without hardcoding property names.

- **Number and boolean field types in MetadataFormDialog** (`@object-ui/console`): Extended `MetadataFormFieldDef.type` to support `'number'` (renders HTML number input) and `'boolean'` (renders a Shadcn Switch toggle with Yes/No label). All existing field types (`text`, `textarea`, `select`) continue to work unchanged.

- **Shared metadata converters utility** (`@object-ui/console`): Extracted `toObjectDefinition()` and `toFieldDefinition()` from ObjectManagerPage into a shared `utils/metadataConverters.ts` module. These functions convert raw ObjectStack API metadata shapes to the UI types (`ObjectDefinition`, `DesignerFieldDefinition`), and can now be reused across pages.

- **Unified icon resolver** (`@object-ui/console`): Consolidated three duplicated `ICON_MAP` + `resolveIcon()` implementations (in MetadataManagerPage, MetadataDetailPage, SystemHubPage) into a single `getIcon()` utility from `utils/getIcon.ts`, which dynamically resolves any Lucide icon by kebab-case or PascalCase name.

- **Metadata Create & Edit via MetadataFormDialog** (`@object-ui/console`): New generic `MetadataFormDialog` component (`components/MetadataFormDialog.tsx`) provides a registry-driven create/edit dialog for any metadata type. Form fields are determined by the `formFields` configuration in the metadata type registry, with fallback defaults (`name`, `label`, `description`). Supports required validation, `disabledOnEdit` for immutable keys (e.g. `name`), textarea and select field types, and loading state during submission.

- **MetadataManagerPage CRUD enhancements** (`@object-ui/console`): Extended the generic MetadataManagerPage with "New" button in the header (opens create dialog), per-item edit buttons (opens pre-filled edit dialog), and click-to-navigate to the detail page. All mutations use `MetadataService.saveMetadataItem()` with toast feedback, loading state, and automatic list refresh.

- **MetadataDetailPage** (`@object-ui/console`): New detail page component (`pages/system/MetadataDetailPage.tsx`) for viewing a single metadata item at `/system/metadata/:metadataType/:itemName`. Displays item fields from the registry's `formFields` config, supports editing via MetadataFormDialog, and allows custom detail renderers via the registry's `detailComponent` property.

- **Registry extensions** (`@object-ui/console`): Extended `MetadataTypeConfig` interface with `formFields` (standardized create/edit form structure), `detailComponent` (custom detail renderers), `actions` (custom page-level and row-level action buttons via `MetadataActionDef`), and `MetadataFormFieldDef` type. Added `formFields` entries for dashboard, page, and report types. Added `DEFAULT_FORM_FIELDS` constant for types without explicit form configuration.

- **Permission integration** (`@object-ui/console`): MetadataManagerPage and MetadataDetailPage now check the current user's role via `useAuth()`. Create, edit, and delete buttons are only shown for admin users (`user.role === 'admin'`), matching the pattern used by UserManagementPage, RoleManagementPage, and other system pages.

- **Custom actions support** (`@object-ui/console`): MetadataManagerPage renders page-level and row-level custom action buttons from the registry's `actions` configuration. Page-level actions appear in the header alongside the create button; row-level actions appear on each item card alongside edit/delete.

- **Unified metadata management architecture** (`@object-ui/console`): New centralized metadata type registry (`config/metadataTypeRegistry.ts`) that defines all manageable metadata categories (app, object, dashboard, page, report) as configuration entries. Registry-driven approach eliminates code duplication — adding a new metadata type requires only a single config entry. Includes `getMetadataTypeConfig()`, `getGenericMetadataTypes()`, and `getHubMetadataTypes()` helpers.

- **Generic MetadataManagerPage** (`@object-ui/console`): New reusable page component (`pages/system/MetadataManagerPage.tsx`) for listing and managing metadata items of any registered type. Driven by the `:metadataType` URL parameter, it fetches items via `MetadataService.getItems()`, supports search filtering, soft-delete with confirm pattern, and displays items in a responsive card grid. Routes: `/system/metadata/:metadataType`.

- **Generic MetadataService methods** (`@object-ui/console`): Extended `MetadataService` with `getItems(category)`, `saveMetadataItem(category, name, data)`, and `deleteMetadataItem(category, name)` methods that work for any metadata type, complementing the existing object/field-specific methods.

- **SystemHubPage registry integration** (`@object-ui/console`): Refactored `SystemHubPage` to auto-generate metadata type cards from the registry instead of hardcoded arrays. New cards (Dashboards, Pages, Reports) appear automatically. Types with custom pages (app, object) link to their existing routes; generic types link to the unified MetadataManagerPage. No breaking changes — all existing hub cards (Users, Orgs, Roles, etc.) remain unchanged.

- **Dynamic routing for metadata types** (`@object-ui/console`): Added `/system/metadata/:metadataType` routes across all three route blocks (SystemRoutes, AppContent minimal, AppContent full) so the generic manager is accessible from both top-level `/system/*` and app-scoped `/apps/:appName/system/*` contexts.

- **Metadata service layer** (`@object-ui/console`): New `MetadataService` class (`services/MetadataService.ts`) that encapsulates object and field CRUD operations against the ObjectStack metadata API (`client.meta.saveItem`). Provides `saveObject()`, `deleteObject()`, and `saveFields()` methods with automatic cache invalidation. Includes static `diffObjects()` and `diffFields()` helpers to detect create/update/delete changes between arrays. Companion `useMetadataService` hook (`hooks/useMetadataService.ts`) provides a memoised service instance from the `useAdapter()` context. 16 new unit tests.

### Fixed

- **Object/field changes now persist to backend** (`@object-ui/console`): Refactored `ObjectManagerPage` so that `handleObjectsChange` and `handleFieldsChange` call the MetadataService API instead of only updating local state. Implements optimistic update pattern — UI updates immediately, rolls back on API failure. After successful persistence, the MetadataProvider is refreshed so changes survive page reloads. Toast messages now accurately reflect the operation performed (create/update/delete) and display error details on failure. Added saving state indicators with a loading spinner during API operations.

- **ObjectManager & FieldDesigner read-only grid fix** (`@object-ui/plugin-designer`): Added `operations: { create: true, update: true, delete: true }` to the `ObjectGridSchema` in both `ObjectManager` and `FieldDesigner` components. The real `ObjectGrid` requires `schema.operations` to render action buttons (add/edit/delete); without it, the grid renders as read-only regardless of the `readOnly` prop or callback handlers. The `operations` property is now conditionally set based on the `readOnly` prop.

- **FieldDesigner modal dialog for add/edit** (`@object-ui/plugin-designer`): Replaced the inline `FieldEditor` panel (rendered below the grid) with a proper `ModalForm` dialog, matching the `ObjectManager` pattern. Add Field and Edit Field now open a modal with all field properties (name, label, type, group, description, toggles for required/unique/readonly/hidden/indexed/externalId/trackHistory, default value, placeholder, referenceTo, formula). This provides a consistent, professional UX across both object and field management.

- **Duplicate action column in ObjectGrid** (`@object-ui/plugin-grid`): Fixed a bug where `ObjectGrid` rendered two action columns when `schema.operations` was set — one via `RowActionMenu` (working dropdown with Edit/Delete) and another via DataTable's built-in `rowActions` (inline buttons calling unset `schema.onRowEdit`/`schema.onRowDelete`). The DataTable's `rowActions` is now only enabled for inline-editable grids, preventing the duplicate column and dead buttons.

- **AI service discovery** (`@object-ui/react`): Added `ai` service type to `DiscoveryInfo.services` interface with `enabled`, `status`, and `route` fields. Added `isAiEnabled` convenience property to `useDiscovery()` hook return value — returns `true` only when `services.ai.enabled === true` and `services.ai.status === 'available'`, defaults to `false` otherwise.

- **Conditional chatbot rendering** (`@object-ui/console`): Console floating chatbot (FAB) now only renders when the AI service is detected as available via `useDiscovery().isAiEnabled`. Previously the chatbot was always visible; now it is hidden when the server has no AI plugin installed.

- **Home page user menu** (`@object-ui/console`): Added complete user menu dropdown (Profile, Settings, Sign Out) to the Home Dashboard via new `HomeLayout` shell component. Users can now access account actions directly from the `/home` page without navigating elsewhere.

- **"Return to Home" navigation** (`@object-ui/console`): Added a "Home" entry in the AppSidebar app switcher dropdown, allowing users to navigate back to `/home` from any application context. Previously, the only way to return to the Home Dashboard was to manually edit the URL.

- **HomeLayout shell** (`@object-ui/console`): New lightweight layout wrapper for the Home Dashboard providing a sticky top navigation bar with Home branding, Settings, and user menu dropdown. Replaces bare `<HomePage />` rendering with a consistent navigation frame for future extensibility (notifications, global guide, unified theming).

### Fixed

- **CSP-safe expression evaluation** (`@object-ui/core`): Replaced `new Function()` in `ExpressionCache.compileExpression()` with a new `SafeExpressionParser` — a recursive-descent interpreter that evaluates expressions without any dynamic code execution. This fixes `Content Security Policy` violations (`'unsafe-eval' is not an allowed source of script`) that occurred when evaluating schema expressions like `${stage !== 'closed_won' && stage !== 'closed_lost'}` in enterprise deployments with strict CSP headers. The `SafeExpressionParser` supports the full ObjectUI expression language: all comparison and logical operators, ternary and nullish coalescing, arithmetic, unary operators (`!`, `-`, `+`, `typeof`), dot/bracket/optional-chaining member access, function calls (formula functions, method calls, `Math.*`), single-param arrow functions (for `.filter(u => u.isActive)`, `.map(x => x.name)` etc.), array literals, `new Date()` / `new RegExp()` constructors, and all literal types. The `ExpressionCache` public API is unchanged. 41 new tests added.

- **CI build errors** (`@object-ui/console`): Removed unused imports (`resolveI18nLabel` in `HomePage.tsx`, `Upload`/`FileText` in `QuickActions.tsx`) that caused TS6133 errors. Fixed `appConfig` → `appConfigs[0]` in `i18n-translations.test.ts` (TS2552). Extracted `customReportsConfig` from aggregated `sharedConfig` into a standalone export so the mock server kernel includes the `sales_performance_q1` report, fixing `ReportView.test.tsx` failures.

- **Charts groupBy value→label resolution** (`@object-ui/plugin-charts`): Chart X-axis labels now display human-readable labels instead of raw values. Select/picklist fields resolve value→label via field metadata options, lookup/master_detail fields batch-fetch referenced record names, and all other fields fall back to `humanizeLabel()` (snake_case → Title Case). Removed hardcoded `value.slice(0, 3)` truncation from `AdvancedChartImpl.tsx` XAxis tick formatters — desktop now shows full labels with angle rotation for long text, mobile truncates at 8 characters with "…".

- **Analytics aggregate measures format** (`@object-ui/data-objectstack`): Fixed `aggregate()` method to send `measures` as string array (`['amount_sum']`, `['count']`) instead of object array (`[{ field, function }]`). The backend `MemoryAnalyticsService.resolveMeasure()` expects strings and calls `.split('.')`, causing `TypeError: t.split is not a function` when receiving objects. Also fixed `dimensions` to send an empty array when `groupBy` is `'_all'` (single-bucket aggregation), and added response mapping to rename measure keys (e.g. `amount_sum`) back to the original field name (`amount`) for consumer compatibility. Additionally fixed chart rendering blank issue: the `rawRows` extraction now handles the `{ rows: [...] }` envelope (when the SDK unwraps the outer `{ success, data }` wrapper) and the `{ data: { rows: [...] } }` envelope (when the SDK returns the full response), matching the actual shape returned by the analytics API (`/api/v1/analytics/query`).
- **Fields SSR build** (`@object-ui/fields`): Added `@object-ui/i18n` to Vite `external` in `vite.config.ts` and converted to regex-based externalization pattern (consistent with `@object-ui/components`) to prevent `react-i18next` CJS code from being bundled. Fixes `"dynamic usage of require is not supported"` error during Next.js SSR prerendering of `/docs/components/basic/text`.
- **Console build** (`@object-ui/console`): Added missing `@object-ui/plugin-chatbot` devDependency that caused `TS2307: Cannot find module '@object-ui/plugin-chatbot'` during build.
- **Site SSR build** (`@object-ui/site`): Added `@object-ui/i18n` to `transpilePackages` in `next.config.mjs` to fix "dynamic usage of require is not supported" error when prerendering the tooltip docs page. The i18n package is a transitive dependency of `@object-ui/react` and its `react-i18next` dependency requires transpilation for Turbopack SSR compatibility.

### Added

- **Floating Chatbot FAB Widget** (`@object-ui/plugin-chatbot`): Airtable-style floating action button (FAB) that opens a chatbot panel overlay. New components: `FloatingChatbot`, `FloatingChatbotPanel`, `FloatingChatbotTrigger`, `FloatingChatbotProvider`. Features include configurable position (bottom-right/left), fullscreen toggle, close, portal rendering to avoid z-index conflicts, and `useFloatingChatbot` hook for programmatic control. Registered as `chatbot-floating` in ComponentRegistry. 21 new unit tests.

- **New ChatbotSchema floating fields** (`@object-ui/types`): Extended `ChatbotSchema` with `displayMode` (`'inline' | 'floating'`) and `floatingConfig` (`FloatingChatbotConfig`) for schema-driven floating chatbot configuration. New `FloatingChatbotConfig` interface with `position`, `defaultOpen`, `panelWidth`, `panelHeight`, `title`, `triggerIcon`, and `triggerSize` options.

- **Console floating chatbot integration** (`@object-ui/console`): Added the floating chatbot FAB to `ConsoleLayout`, making it available on every authenticated page. Uses `useObjectChat` with metadata-aware context (app name, object list) for intelligent auto-responses. Wired with demo auto-response mode by default, switchable to API streaming when `api` endpoint is configured.

- **AI SDUI Chatbot integration** (`@object-ui/plugin-chatbot`): Refactored chatbot plugin to support full AI streaming via `service-ai` backend and `vercel/ai` SDK (`@ai-sdk/react`). New `useObjectChat` composable hook wraps `@ai-sdk/react`'s `useChat` for SSE streaming, tool-calling, and production-grade chat. Auto-detects API mode (when `api` schema field is set) vs legacy local auto-response mode. ChatbotEnhanced component now supports stop, reload, error display, and streaming state indicators. 44 unit tests (19 new hook tests, 10 new streaming tests).

- **New ChatbotSchema fields** (`@object-ui/types`): Extended `ChatbotSchema` with `api`, `conversationId`, `systemPrompt`, `model`, `streamingEnabled`, `headers`, `requestBody`, `maxToolRoundtrips`, and `onError` fields for service-ai integration. Extended `ChatMessage` with `streaming`, `toolInvocations` fields and added `ChatToolInvocation` interface for tool-calling flows.

- **New Storybook stories for AI chatbot** (`@object-ui/components`): Added `AIStreamingMode`, `AIWithSystemPrompt`, and `AIWithToolCalls` stories demonstrating the new AI SDUI chat modes alongside existing local/demo stories.

- **Object Manager visual designer** (`@object-ui/plugin-designer`): Enterprise-grade object management interface for creating, editing, deleting, and configuring meta-object definitions. Uses standard ObjectGrid for the list view and ModalForm for create/edit operations. Features include property editing (name, label, plural label, description, icon, group, sort order, enabled toggle), object relationship display, search/filter, system object protection, confirm dialogs for destructive actions, and read-only mode. 18 unit tests.

- **Field Designer visual designer** (`@object-ui/plugin-designer`): Enterprise-grade field configuration wizard supporting 27 field types with full CRUD operations. Uses standard ObjectGrid for the list view with a specialized FieldEditor panel for advanced type-specific properties. Features include uniqueness constraints, default values, picklist/option set management, read-only, hidden, validation rules (min/max/length/pattern/custom), external ID, history tracking, and database indexing. Type-specific editors for lookup references, formula expressions, and select options. Field type filtering, search, system field protection, and read-only mode. 22 unit tests.

- **New type definitions** (`@object-ui/types`): Added `ObjectDefinition`, `ObjectDefinitionRelationship`, `ObjectManagerSchema`, `DesignerFieldType` (27 field types), `DesignerFieldOption`, `DesignerValidationRule`, `DesignerFieldDefinition`, and `FieldDesignerSchema` interfaces for the Object Manager and Field Designer components.

- **New i18n keys for Object Manager and Field Designer** (`@object-ui/i18n`): Added 50 new translation keys per locale across all 10 locale packs (en, zh, ja, ko, de, fr, es, pt, ru, ar) covering both `objectManager` and `fieldDesigner` subsections of `appDesigner`.

- **Designer translation fallbacks** (`@object-ui/plugin-designer`): Updated `useDesignerTranslation` with fallback translations for all new Object Manager and Field Designer keys.

- **Console integration** (`@object-ui/console`): Object Manager and Field Designer are now accessible in the console application at `/system/objects`. Added ObjectManagerPage to system admin routes, SystemHubPage card, and sidebar navigation. Selecting an object drills into its FieldDesigner for field configuration. 7 unit tests.

### Changed

- **System settings pages refactored to ObjectView** (`apps/console`): All five system management pages (Users, Organizations, Roles, Permissions, Audit Log) now use the metadata-driven `ObjectView` from `@object-ui/plugin-view` instead of hand-written HTML tables. Each page's UI is driven by the object definitions in `systemObjects.ts`, providing automatic search, sort, filter, and CRUD capabilities. A shared `SystemObjectViewPage` component eliminates code duplication across all system pages.

### Fixed

- **TypeScript build error in ObjectManagerPage** (`apps/console`): Fixed `TS2322: Type 'string' is not assignable to type 'DesignerFieldType'` by adding proper type assertion and missing import for `DesignerFieldType`.

- **ChatbotSchema `body` property conflict with BaseSchema** (`@object-ui/types`): Renamed `ChatbotSchema.body` to `requestBody` to resolve `TS2430: Interface 'ChatbotSchema' incorrectly extends interface 'BaseSchema'` — the chatbot's HTTP request body parameter conflicted with `BaseSchema.body` (child schema nodes). Updated all references in `@object-ui/plugin-chatbot` renderer accordingly.

- **Fields package SSR compatibility for Next.js docs site** (`@object-ui/fields`): Added `react/jsx-runtime` to the Vite build externals configuration to prevent it from being bundled. This fixes the `Error: dynamic usage of require is not supported` failure during Next.js static page prerendering of the `/docs/components/overlay/tooltip` page.

- **Dashboard widgets now surface API errors instead of showing hardcoded data** (`@object-ui/plugin-dashboard`, `@object-ui/plugin-charts`):
  - **ObjectChart**: Added error state tracking. When `dataSource.aggregate()` or `dataSource.find()` fails, the chart now shows a prominent error message with a red alert icon instead of silently swallowing errors and rendering an empty chart.
  - **MetricWidget / MetricCard**: Added `loading` and `error` props. When provided, the widget shows a loading spinner or a destructive-colored error message instead of the metric value, making API failures immediately visible.
  - **ObjectMetricWidget** (new component): Data-bound metric widget that fetches live values from the server via `dataSource.aggregate()` or `dataSource.find()`. Shows explicit loading/error states. Falls back to static `fallbackValue` only when no `dataSource` is available (demo mode).
  - **DashboardRenderer**: Metric widgets with `widget.object` binding are now routed to `ObjectMetricWidget` (`object-metric` type) for async data loading, instead of always rendering static hardcoded values. Static-only metric widgets (no `object` binding) continue to work as before.
  - **CRM dashboard example**: Documented that `options.value` fields are demo/fallback values that only display when no dataSource is connected.
  - 13 new tests covering error states, loading states, fallback behavior, and routing logic.

- **Plugin designer test infrastructure** (`@object-ui/plugin-designer`): Created missing `vitest.setup.ts` with ResizeObserver polyfill and jest-dom matchers. Added `@object-ui/i18n` alias to vite config. These fixes resolved 9 pre-existing test suite failures, bringing total passing tests from 45 to 246.

- **Chinese language pack (zh.ts) untranslated key** (`@object-ui/i18n`): Fixed `console.objectView.toolbarEnabledCount` which was still in English (`'{{count}} of {{total}} enabled'`) — now properly translated to `'已启用 {{count}}/{{total}} 项'`. Also fixed the same untranslated key in all other 8 non-English locales (ja, ko, de, fr, es, pt, ru, ar).

- **Hardcoded English strings in platform UI** (`apps/console`, `@object-ui/fields`, `@object-ui/react`, `@object-ui/components`): Replaced hardcoded English strings with i18n `t()` calls:
  - Console `App.tsx`: Modal dialog title (`"Create/Edit Contact"`), description (`"Add a new ... to your database."`), submitText (`"Save Record"`), and cancelText (`"Cancel"`) now use i18n keys.
  - `SelectField`: Default placeholder `"Select an option"` now uses `t('common.selectOption')`.
  - `LookupField`: Default placeholder `"Select..."` and search placeholder `"Search..."` now use i18n keys.
  - `FieldFactory`: Default select option placeholder now uses `t('common.selectOption')`.
  - Form renderer: Default select placeholder now uses `t('common.selectOption')`.

### Added

- **New i18n keys for select/form components** (`@object-ui/i18n`): Added new translation keys across all 10 locale packs:
  - `common.selectOption` — Default select field placeholder (e.g., '请选择' in Chinese)
  - `common.select` — Short select placeholder (e.g., '选择...' in Chinese)
  - `form.createTitle` — Form dialog create title with interpolation (e.g., '新建{{object}}' in Chinese)
  - `form.editTitle` — Form dialog edit title with interpolation
  - `form.createDescription` — Form dialog create description with interpolation
  - `form.editDescription` — Form dialog edit description with interpolation
  - `form.saveRecord` — Save record button text

- **Safe translation hook for field widgets** (`@object-ui/fields`): Added `useFieldTranslation` hook that provides fallback to English defaults when no `I18nProvider` is available, following the same pattern as `useDetailTranslation` in `@object-ui/plugin-detail`.

### Fixed

- **ObjectView ChatterPanel test assertion mismatch** (`apps/console`): Fixed the failing CI test in `ObjectView.test.tsx` where the RecordChatterPanel drawer test used `getByLabelText('Show discussion')` but the actual aria-label rendered by the component is `'Show Discussion (0)'` (from the i18n default translation `detail.showDiscussion` with count parameter). Updated the test assertion to match the correct aria-label.

### Changed

- **Upgrade @objectstack packages from v3.2.9 to v3.3.0**: Upgraded all `@objectstack/*` dependencies across the entire monorepo (root, `apps/console`, `examples/crm`, `examples/todo`, `examples/msw-todo`, `examples/kitchen-sink`, `packages/core`, `packages/types`, `packages/react`, `packages/data-objectstack`, `packages/plugin-map`, `packages/plugin-gantt`, `packages/plugin-timeline`) from `^3.2.9` to `^3.3.0`. All 42 build tasks pass and all 7,224 tests pass with no breaking changes.

### Added

- **Standardized List Refresh After Mutation (P0/P1/P2)** (`@object-ui/types`, `@object-ui/plugin-list`, `@object-ui/plugin-view`, `@object-ui/plugin-kanban`, `@object-ui/plugin-calendar`, `@object-ui/react`, `@object-ui/core`, `apps/console`): Resolved a platform-level architectural deficiency where list views did not refresh after create/update/delete mutations. The fix spans three phases:
  - **P0 — refreshTrigger Prop**: Added `refreshTrigger?: number` to `ListViewSchema`. When a parent component (e.g., `ObjectView`) increments this value after a mutation, `ListView` automatically re-fetches data. The plugin-view's `ObjectView.renderContent()` now passes its internal `refreshKey` as both a direct callback prop and embedded in the schema's `refreshTrigger`. The console `ObjectView` combines both its own and the plugin's refresh signals for full propagation.
  - **P1 — Imperative `refresh()` API + `useDataRefresh` hook**: `ListView` is now wrapped with `React.forwardRef` and exposes a `refresh()` method via `useImperativeHandle`. Parents can trigger a re-fetch programmatically via `listRef.current?.refresh()`. Exported `ListViewHandle` type from `@object-ui/plugin-list`. Added reusable `useDataRefresh(dataSource, objectName)` hook to `@object-ui/react` that encapsulates the refreshKey state + `onMutation` subscription pattern for any view component.
  - **P2 — DataSource Mutation Event Bus**: Added `MutationEvent` interface and optional `onMutation(callback): unsubscribe` method to the `DataSource` interface. All data-bound views now auto-subscribe to mutation events when the DataSource implements this: `ListView`, `ObjectView` (plugin-view), `ObjectKanban` (plugin-kanban), and `ObjectCalendar` (plugin-calendar). `ValueDataSource` emits mutation events on create/update/delete. Includes 22 new tests covering all three phases.

- **Unified i18n Plugin Loading & Translation Injection** (`examples/crm`, `apps/console`): Unified the i18n loading mechanism so that both server and MSW/mock environments use the same translation pipeline. CRM's `objectstack.config.ts` now declares its translations via `i18n: { namespace: 'crm', translations: crmLocales }`. The shared config (`objectstack.shared.ts`) merges i18n bundles from all composed stacks. `createKernel` registers an i18n kernel service from the config bundles and auto-generates the `/api/v1/i18n/translations/:lang` MSW handler, returning translations in the standard `{ data: { locale, translations } }` spec envelope. Removed all manually-maintained i18n custom handlers and duplicate `loadAppLocale` functions from `browser.ts` and `server.ts`. The broker shim now supports `i18n.getTranslations` for server-side dispatch.

- **ObjectDataTable: columns now support `string[]` shorthand** (`@object-ui/plugin-dashboard`): `ObjectDataTable` now normalizes `columns` entries so that both `string[]` (e.g. `['name', 'close_date']`) and `object[]` formats are accepted. String entries are automatically converted to `{ header, accessorKey }` objects with title-cased headers derived from snake_case and camelCase field names. Previously, passing a `string[]` caused the downstream `data-table` renderer to crash when accessing `col.accessorKey` on a plain string. Mixed arrays (some strings, some objects) are also handled correctly. Includes 8 new unit tests.

### Fixed

- **i18n Kernel Service `getTranslations` Returns Wrong Format** (`apps/console`): Fixed the `createKernel` i18n service registration where `getTranslations` returned a wrapped `{ locale, translations }` object instead of the flat `Record<string, any>` dictionary expected by the spec's `II18nService` interface. The HttpDispatcher wraps the service return value in `{ data: { locale, translations } }`, so the extra wrapping caused translations to be empty or double-nested in the API response (`/api/v1/i18n/translations/:lang`). The service now returns `resolveI18nTranslations(bundles, lang)` directly, aligning with the spec and making CRM business translations work correctly in all environments (MSW, server, dev).

- **i18n Translations Empty in Server Mode (`pnpm start`)** (`apps/console`): Fixed translations returning `{}` when running the real ObjectStack server on port 3000. The root cause was that the CLI's `isHostConfig()` function detects plugins with `init` methods in the config's `plugins` array and treats it as a "host config" — **skipping auto-registration of `AppPlugin`**. Without `AppPlugin`, the config's translations, objects, and seed data were never loaded. Additionally, the kernel's memory i18n fallback is only auto-registered in `validateSystemRequirements()` (after all plugin starts), too late for `AppPlugin.start()` → `loadTranslations()`. Fixed by: (1) explicitly adding `AppPlugin(sharedConfig)` to `objectstack.config.ts` plugins, and (2) adding `MemoryI18nPlugin` before it to register the i18n service during init phase. Also added a spec-format `translations` array to `objectstack.shared.ts` so `AppPlugin.loadTranslations()` can iterate and load the CRM locale bundles.

- **i18n Translations Empty in Root Dev Mode (`pnpm dev`)** (root `objectstack.config.ts`): Fixed translations returning `{}` when running `pnpm dev` from the monorepo root. The root config uses `objectstack dev` → `objectstack serve --dev` which loads the root `objectstack.config.ts` — but this config did not aggregate i18n bundles from the example stacks (CRM, Todo, etc.). The `composeStacks()` function doesn't handle the custom `i18n` field, so translation data was lost during composition. Fixed by: (1) aggregating i18n bundles from all plugin configs (same pattern as `objectstack.shared.ts`), (2) building a spec-format `translations` array passed to `AppPlugin(mergedApp)`, and (3) adding `MemoryI18nPlugin` to register the i18n service during init phase.

- **Duplicate Data in Calendar and Kanban Views** (`@object-ui/plugin-view`, `@object-ui/plugin-kanban`, `@object-ui/plugin-list`): Fixed a bug where Calendar and Kanban views displayed every record twice. The root cause was that `ObjectView` (plugin-view) unconditionally fetched data even when a `renderListView` callback was provided — causing parallel duplicate requests since `ListView` (plugin-list) independently fetches its own data. The duplicate fetch results triggered re-renders that destabilised child component rendering, leading to duplicate events in the calendar and duplicate cards on the kanban board. Additionally, `ObjectKanban` lacked proper external-data handling (`data`/`loading` props with `hasExternalData` guard), unlike `ObjectCalendar` which already had this pattern. Fixes: (1) `ObjectView` now skips its own fetch when `renderListView` is provided, (2) `ObjectKanban` now accepts explicit `data`/`loading` props and skips internal fetch when external data is supplied (matching `ObjectCalendar`'s pattern), (3) `ListView` now handles `{ value: [] }` OData response format consistently with `extractRecords` utility. Includes regression tests.

- **CI Build Fix: Replace dynamic `require()` with static imports** (`@object-ui/plugin-view`): Replaced module-level `require('@object-ui/react')` calls in `index.tsx` and `ObjectView.tsx` with static `import` statements. The dynamic `require()` pattern is not supported by Next.js Turbopack, causing the docs site build to fail during SSR prerendering of the `/docs/components/complex/view-switcher` page with `Error: dynamic usage of require is not supported`. Since `@object-ui/react` is already a declared dependency and other files in the package use static imports from it, replacing the `require()` with static imports is safe and eliminates the SSR compatibility issue.

- **CI Build Fix: Remove unused `...rest` parameter** (`@object-ui/plugin-calendar`): Removed unused `...rest` destructured parameter from `ObjectCalendar` component props (TS6133), which caused the declaration file generation to emit a TypeScript error during the build.

- **CI Build Fix: Unused Parameters in Test Mocks** (`apps/console`): Fixed TypeScript `noUnusedParameters` errors (TS6133) in `ListToolbarActions.test.tsx` where mock component `props` parameters were declared but never used in `@object-ui/plugin-kanban` and `@object-ui/plugin-calendar` mocks, causing the console `tsc` build step to fail in CI.

- **i18n loadLanguage Not Compatible with Spec REST API Response Format** (`apps/console`): Fixed `loadLanguage` in `apps/console/src/main.tsx` to correctly unwrap the `@objectstack/spec` REST API envelope `{ data: { locale, translations } }`. Previously, the function returned the raw JSON response, which meant `useObjectLabel` and `useObjectTranslation` hooks received a wrapped object instead of the flat translation map, causing business object and field labels (e.g., CRM contact/account) to fall back to English. The fix extracts `data.translations` when the spec envelope is detected, while preserving backward compatibility with mock/dev environments that return flat translation objects. Includes 6 unit tests covering spec envelope unwrapping, flat fallback, HTTP errors, network failures, and edge cases.

- **List Toolbar Action Buttons Not Responding** (`apps/console`): Fixed a bug where schema-driven action buttons in the upper-right corner of the list view (rendered via `action:bar` with `locations: ['list_toolbar']`) did not respond to clicks. The root cause: the console `ObjectView` component rendered these action buttons via `SchemaRenderer` without wrapping them in an `ActionProvider`. This caused `useAction()` to fall back to a local `ActionRunner` with no handlers, toast, confirmation, or navigation capabilities — so clicks executed silently with no visible effect. Added `ActionProvider` with proper handlers (toast via Sonner, confirmation dialog, navigation via React Router, param collection dialog, and a generic API handler) to the console `ObjectView`, following the same pattern already used in `RecordDetailView`. Includes 4 new integration tests validating the full action chain (render, confirm, execute, cancel).

- **CRM Seed Data Lookup References** (`examples/crm`): Fixed all CRM seed data files to use natural key (`name`) references for lookup fields instead of raw `id` values. The `SeedLoaderService` resolves foreign key references by the target object's `name` field (the default `externalId`), so seed data values like `order: "o1"` or `account: "2"` could not be resolved and were set to `null`. Updated all 8 affected data files (`account`, `contact`, `opportunity`, `order`, `order_item`, `opportunity_contact`, `project_task`, `event`) to use human-readable name references (e.g., `order: "ORD-2024-001"`, `product: "Workstation Pro Laptop"`, `account: "Salesforce Tower"`). This fixes the issue where Order and Product columns displayed as empty in the Order Item grid view.

### Added

- **Lookup Field Selection Display Fix** (`@object-ui/fields`): Fixed a bug where selecting a record from the RecordPickerDialog (Level 2 popup) produced no visible feedback in the LookupField. The root cause: `findOption` only searched static and popover-fetched options, which did not include records loaded by the dialog. Added `onSelectRecords` callback to `RecordPickerDialogProps` that returns full record objects alongside IDs. LookupField now caches selected records from the dialog and displays their labels/badges correctly. Both single-select and multi-select modes are supported. Includes a `selectedRecordsMap` ref in RecordPickerDialog that persists selected record data across page navigation for multi-select scenarios.

- **RecordPickerDialog UI/UX Overhaul** (`@object-ui/fields`): Major enterprise-grade improvements referencing mainstream low-code platforms:
  - **Skeleton Loading Screen**: Replaced simple spinner with a table-shaped skeleton screen during initial data load, matching the column layout for a polished loading experience.
  - **Sticky Table Header**: Table header now sticks to the top during vertical scroll, keeping column labels visible at all times.
  - **Loading Overlay**: Subsequent data fetches (page navigation, sorting, filtering) show a semi-transparent overlay with spinner over the existing data, preventing layout jank.
  - **Page Jump Input**: New input field in pagination bar allows users to type a page number and press Enter to jump directly to any page.
  - **Enhanced Search Bar**: Redesigned with a subtle background container and borderless input for a cleaner, more modern appearance.
  - **Improved Table Styling**: Even/odd row striping (`bg-muted/20`), refined selected-row highlighting (`bg-primary/5`), uppercase column headers with tighter tracking, rounded table border, and improved cell padding.
  - **Responsive Dialog**: Responsive dialog sizing from `sm:max-w-3xl` to `lg:max-w-5xl` for optimal data density across screen sizes; filter panel supports 3-column layout on wide viewports (`lg:grid-cols-3`).
  - **Fixed Close-Reset Cycle**: Separated dialog close-reset logic into its own `useEffect` (depends only on `open`) to prevent cascading state updates that could trigger React Error #185 (Maximum update depth exceeded) when selecting a record.
  - **8 New Unit Tests**: Comprehensive test coverage for skeleton loading (column count validation), sticky header classes, page jump navigation (valid/invalid/single-page), and loading overlay behavior.

- **"Browse All" Button for Lookup Fields** (`@object-ui/fields`): Added an always-visible "Browse All" (table icon) button next to the Lookup quick-select trigger. Opens the full RecordPickerDialog directly, regardless of record count — making enterprise features (multi-column table, sort/filter bar, cell renderers) discoverable at all times. Previously, the dialog was only accessible via the "Show All Results" in-popover button, which only appeared when total records exceeded the page size. The button uses accessible `aria-label`, `title`, and Lucide `TableProperties` icon. Keyboard and screen reader accessible.
- **CRM Enterprise Lookup Metadata** (`examples/crm`): All 14 lookup fields across 8 CRM objects now have enterprise-grade RecordPicker configuration — `lookup_columns` (with type hints for cell rendering: select, currency, boolean, date, number, percent), `lookup_filters` (base business filters using eq/ne/in/notIn operators), and `description_field`. Uses post-create `Object.assign` injection pattern to bypass `ObjectSchema.create()` Zod stripping (analogous to the listViews passthrough approach).
- **Enterprise Lookup Tests** (`examples/crm`): 12 new test cases validating lookup_columns presence & type diversity, lookup_filters operator validity, description_field coverage, and specific business logic (e.g., active-only users, non-cancelled orders, open opportunities).
- **RecordPickerDialog Component** (`@object-ui/fields`): New enterprise-grade record selection dialog with multi-column table display, pagination, search, column sorting with `$orderby`, keyboard navigation (Arrow keys + Enter), loading/error/empty states, and single/multi-select support. Responsive layout with mobile-friendly width. Provides the foundation for Salesforce-style Lookup experience.
- **LookupField Popover Typeahead** (`@object-ui/fields`): Level 1 quick-select upgraded from Dialog to Popover for inline typeahead experience (anchored dropdown, not modal). Includes "Show All Results" footer button that opens the full RecordPickerDialog (Level 2).
- **LookupFieldMetadata Schema Enhancement** (`@object-ui/types`): Added `lookup_columns`, `description_field`, `lookup_page_size`, `lookup_filters` to `LookupFieldMetadata`. New `LookupColumnDef` interface with `type` hint for cell formatting. New `LookupFilterDef` interface for base filter configuration.

### Changed

- **@objectstack v3.2.6 Upgrade**: Upgraded all `@objectstack/*` packages from `^3.2.5` to `^3.2.6` across 13 package.json files (43 references)
- **@objectstack v3.0.4 Upgrade**: Upgraded all `@objectstack/*` packages from `^3.0.2` to `^3.0.4` across 42 references
- **@objectstack v3.0.0 Upgrade**: Upgraded all `@objectstack/*` packages from `^2.0.7` to `^3.0.0` across 13 package.json files
- **Breaking change migrations**:
  - `Hub` namespace → `Cloud` in @object-ui/types re-exports
  - `definePlugin` removed (only `defineStack` remains)
  - `PaginatedResult.value` → `.records` across all data plugins and adapters
  - `PaginatedResult.count` → `.total` in data-objectstack adapter
  - `client.meta.getObject()` → `client.meta.getItem('object', name)` in data adapter
- Updated spec version references across ROADMAP.md, SPEC_COMPLIANCE_EVALUATION.md, OBJECTSTACK_CLIENT_EVALUATION.md, and console docs
- Updated ROADMAP with v3.0.0 migration table and next phase roadmap (N.1-N.5)
- Updated namespace-exports tests to reflect v3.0.0 exports

### Added

- **Preview Mode** (`@object-ui/auth`): New `previewMode` prop on `AuthProvider` for auto-login with simulated identity — skip login/registration for marketplace demos and app showcases. Includes `PreviewBanner` component, `isPreviewMode` / `previewMode` on `useAuth()`, and `PreviewModeOptions` type. Aligns with `@objectstack/spec` kernel `PreviewModeConfig`.
- **Discovery Preview Detection** (`@object-ui/react`): Extended `DiscoveryInfo` with `mode` and `previewMode` fields for server-driven preview mode detection.
- **Console Preview Support**: `ConditionalAuthWrapper` auto-detects `mode === 'preview'` from server discovery and configures auth accordingly.
- **Console Bundle Optimization**: Split monolithic 3.7 MB main chunk into 17 granular cacheable chunks via `manualChunks` — main entry reduced from 1,008 KB gzip to 48.5 KB gzip (95% reduction)
- **Gzip + Brotli Compression**: Pre-compressed assets via `vite-plugin-compression2` — Brotli main entry at 40 KB
- **Bundle Analysis**: Added `rollup-plugin-visualizer` generating interactive treemap at `dist/stats.html`; new `build:analyze` script
- **Lazy MSW Loading**: MSW mock server now loaded via dynamic `import()` — fully excluded from `build:server` output (~150 KB gzip saved)
- **ROADMAP Console v1.0 Section**: Added production release optimization roadmap with detailed before/after metrics

---

## [0.3.1] - 2026-01-27

### Changed

- Maintenance release - Documentation and build improvements
- Updated internal dependencies across all packages

---

## [0.3.0] - 2026-01-17

### Added

- **New Plugin**: `@object-ui/plugin-object` - ObjectQL plugin for automatic table and form generation
  - `ObjectTable`: Auto-generates tables from ObjectQL object schemas
  - `ObjectForm`: Auto-generates forms from ObjectQL object schemas with create/edit/view modes
  - Full TypeScript support with comprehensive type definitions
- **Type Definitions**: Added `ObjectTableSchema` and `ObjectFormSchema` to `@object-ui/types`
- **ObjectQL Integration**: Enhanced `ObjectQLDataSource` with `getObjectSchema()` method using MetadataApiClient

### Changed

- Updated `@objectql/sdk` from ^1.8.3 to ^1.9.1
- Updated `@objectql/types` from ^1.8.3 to ^1.9.1

---

## [0.2.1] - 2026-01-15

### Changed

- Fixed changeset configuration to remove non-existent @apps/* pattern
- Added automated changeset-based version management and release workflow
- Enhanced CI/CD workflows with GitHub Actions
- Improved documentation for contributing and releasing

## [0.2.0] - 2026-01-15

### Added

- Comprehensive test suite using Vitest and React Testing Library
- Test coverage for @object-ui/core, @object-ui/react, @object-ui/components, and @object-ui/designer packages
- GitHub Actions CI/CD workflows:
  - CI workflow for automated testing, linting, and building
  - Release workflow for publishing new versions
- Test coverage reporting with @vitest/coverage-v8
- Contributing guidelines (CONTRIBUTING.md)
- Documentation for testing and development workflow in README
- README files for all core packages

### Changed

- Updated package.json scripts to use Vitest instead of placeholder test commands
- Enhanced README with testing instructions and CI status badges

## [0.1.0] - Initial Release

### Added

- Core packages:
  - @object-ui/core - Core logic, types, and validation (Zero React dependencies)
  - @object-ui/react - React bindings and SchemaRenderer component
  - @object-ui/components - Standard UI components built with Tailwind CSS & Shadcn
  - @object-ui/designer - Drag-and-drop visual editor
- Monorepo structure using pnpm workspaces
- Basic TypeScript configuration
- Example applications in the examples directory
- Complete documentation site with VitePress

[0.3.0]: https://github.com/objectstack-ai/objectui/releases/tag/v0.3.0
[0.2.1]: https://github.com/objectstack-ai/objectui/releases/tag/v0.2.1
[0.2.0]: https://github.com/objectstack-ai/objectui/releases/tag/v0.2.0
[0.1.0]: https://github.com/objectstack-ai/objectui/releases/tag/v0.1.0
