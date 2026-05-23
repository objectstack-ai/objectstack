# @objectstack/studio

## 5.2.0

### Minor Changes

- fa011d8: feat(studio): metadata history timeline viewer

  Adds a new `history` view mode that surfaces the audit timeline produced by `sys_metadata_history` (ADR-0008 §5) inside Studio. Available for every metadata type as a wildcard built-in plugin.

  - `@objectstack/spec`: extend `ViewModeSchema` with `'history'`.
  - `@objectstack/studio`: new `historyViewerPlugin` rendering an event timeline (create/update/delete/rename) with op icons, short hash, actor, source, expandable detail panel. ADR-0009 `executionPinned` types (`flow`, `workflow`, `approval`) show a "Pinned" badge explaining that historical versions are retained for in-flight executions.

  Reads from the existing `GET /meta/:type/:name/history` REST endpoint via `client.meta.getHistory()`; no new server surface.

### Patch Changes

- 7bc57ad: Studio: redesign the object page Airtable-style.

  The object detail page (`/objects/:name`) previously stacked four
  overlapping navigation strips on top of each other: sidebar, outer
  route tabs (Designer/Views/Forms/...), the PluginHost mode strip
  (Preview/Code/Data/History), and ObjectExplorer's own internal
  tabs (Schema/Data/API) — plus a duplicated object header card.

  This change collapses the redundancy:

  - `ObjectExplorer` becomes a controlled component driven by the
    `mode` prop from PluginHost. Its internal tab strip is removed
    so the page only ever shows a single row of mode buttons.
  - The duplicate "object meta" card inside `ObjectSchemaInspector`
    is removed; the route-level header is now the single source of
    identity (label + machine name + description).
  - The route header itself is slimmed: the "Object" eyebrow and
    the redundant stat-badge row (fields / views / forms / hooks)
    are gone since the related-metadata tabs already convey the
    same counts.
  - `object-plugin` declares modes as `['data', 'design', 'code']`
    and `PluginHost` lands on `data` by default for objects so the
    records grid is the first thing the user sees — matching
    Airtable's "data first" philosophy.
  - Mode buttons get per-type labels via `MODE_LABEL_OVERRIDES`:
    for `object`, `data` reads "Records", `design` reads "Fields",
    `code` reads "API".
  - A per-type `MODE_ALLOWLIST_BY_TYPE` filters out the generic
    `preview` fallback for objects so the strip is the curated
    `Records / Fields / API / History` and nothing more.

- ec26370: Studio: cross-page polish — calmer cards, plain-English copy, deduped registry.

  Following the Airtable-style object-page redesign, this pass cleans
  up the rest of the surface so every page reads the same way.

  **List cards** (`MetadataListPage`):

  - Suppress the per-card type badge on single-type pages (Objects,
    Forms). The page title already conveys the type; the badge was
    noise. Multi-type pages (Views & Apps, Automations, AI, Security)
    keep the badge for disambiguation.
  - Show the metadata's own `description` when present, instead of
    the now-redundant snake_case `name` (which was a duplicate of the
    `<code>` element below). The machine name still appears as a
    subtle code line.
  - Switch the "Preview" verbose button to an icon-only ghost button
    that reveals on hover, freeing the row for the actual label.
  - Add `title` attributes everywhere so truncated labels (e.g.
    "Campaign Me…") are readable on hover.

  **Home / `DeveloperOverview`**:

  - Replace the "Developer Console" terminal-icon header with the
    package name and a one-line summary — feels like a product home,
    not a dev tool.
  - Dedupe the Metadata Registry list: the backend currently exposes
    both `sharingRule` and `sharing_rule` (and `ragPipeline` /
    `rag_pipeline`, `analyticsCube` / `analytics_cube`) as separate
    entries even though they map to the same type. A new
    `dedupeRegistryEntries` collapses each alias pair, sums the
    counts, and keeps the canonical camelCase name for display.
  - Drop the "+ N empty types" footnote — pure dev jargon.
  - Replace the opaque `/api/v1   REST · data · meta · packages`
    stat card with a clearer "REST API — Live" card that links to
    the APIs page.

  **Forms**:

  - Rewrite the page description from a wall of
    `FormView` / `sharing.allowAnonymous` / `GET /api/v1/forms/:slug`
    jargon to plain English: "Forms anyone can fill out — no login
    required. Publish a form to get a shareable link; submissions
    land directly in the bound object."
  - Empty state now points users at the visible action button
    instead of telling them to "Declare a FormView with
    `sharing.allowAnonymous: true`".

  **Logs**:

  - Empty states no longer leak the internal endpoint paths
    (`Awaiting /api/v1/_debug/requests.`) — they just say
    "Coming soon. Requests will stream here in real time."

- b626e11: Studio: redesign generic metadata-detail pages.

  Every detail page routed through `/$package/metadata/$type/$name`
  (views, dashboards, apps, flows, agents, permissions, …) used to
  have **no visible page header** — only a breadcrumb — plus a
  wasted top band hosting a floating 3-dot menu, a dev-jargon
  `objectstack.view-preview` plugin-id badge, and an unnecessary
  viewer-picker dropdown. Errors were rendered as red prose leaking
  the raw `[ObjectStack] Metadata item X not found` backend string.

  This pass aligns generic detail pages with the Object-page pattern:

  - The route now loads the item, renders a real header card
    (icon · label · machine name · type chip · description), and
    parks the `ResourceActionsMenu` on the right of the header
    instead of in its own floating top bar.
  - `PluginHost` drops the always-visible plugin-id badge from the
    toolbar (`objectstack.view-preview` etc. — pure dev jargon)
    and the same id badge from inside the viewer-picker dropdown
    items.
  - `MetadataInspector` (the default JSON-tree Preview viewer) no
    longer renders its own "Header card" — that's the route's job
    now, so users don't see "Sales Representative" twice on the
    Permission page.
  - Friendly "not found" empty states replace the red error prose
    in `view-preview-plugin`, `FlowViewer`, and `MetadataInspector`.
    Internal error strings like
    `[ObjectStack] Metadata item flow/X not found` no longer leak
    to the UI; users see "Flow not found · We couldn't load X. It
    may have been deleted or moved to another package."

- d060e84: fix(studio): clearer metadata list filter chips, empty states & no-flash theme boot

  Surveyed Studio's core pages via the browser and shipped three targeted polish fixes:

  - **Filter chips on multi-type list pages** (Views & Apps, Automations, …) were displaying the nav-category label for every chip — e.g. _"Views & Apps 1"_ / _"Views & Apps 2"_ instead of _"App 1"_ / _"Dashboard 2"_. Added a singular `METADATA_TYPE_LABELS` registry and a `typeLabel()` helper in `studio-nav.ts`, and switched the chip + search placeholder + empty-state copy to per-type labels.
  - **Empty-state grammar**: _"No ai in this package yet."_ now reads _"Nothing in AI for this package yet."_ — works for any title casing (AI, Views & Apps, …) without lowercasing.
  - **First-paint theme flash**: stored theme was only applied in a `useEffect`, causing a brief white flash before React mounted (especially noticeable on slow loads). Added an inline `<script>` in `index.html` that mirrors `theme-toggle.tsx` and applies the `.dark` class and the matching `<html>` background-color synchronously, plus a `<meta name="color-scheme" content="dark light">` so native UI (scrollbars, form controls) inherits the correct scheme too.

- Updated dependencies [bab2b20]
- Updated dependencies [fa011d8]
- Updated dependencies [f0f7c27]
- Updated dependencies [b806f58]
  - @objectstack/platform-objects@5.2.0
  - @objectstack/spec@5.2.0
  - @objectstack/runtime@5.2.0
  - @objectstack/metadata@5.2.0
  - @objectstack/service-ai@5.2.0
  - @objectstack/client@5.2.0
  - @objectstack/client-react@5.2.0
  - @objectstack/objectql@5.2.0
  - @objectstack/driver-memory@5.2.0
  - @objectstack/plugin-msw@5.2.0
  - @objectstack/service-analytics@5.2.0
  - @objectstack/service-automation@5.2.0
  - @objectstack/service-feed@5.2.0

## Unreleased

### Studio UX overhaul

This iteration polished Studio against Airtable / Linear / Power Apps and
introduced the first real **metadata-as-code write loop**.

**New capabilities:**

- **Dev-only write API** (`@objectstack/cli`): mounts three endpoints
  under the same Hono app that serves Studio. Whitelisted to
  project-relative paths under a `src/` directory with `.ts/.tsx/.json`
  extensions; rejects path traversal, absolute paths, existing files
  (unless `mode: 'overwrite'`). Only registered when `isDev === true`.
  - `GET  /_studio/api/metadata/layout` — resolves on-disk srcRoot.
  - `POST /_studio/api/metadata/file` — write whole new file.
  - `POST /_studio/api/metadata/field-patch` — ts-morph powered
    surgery on a single field inside `ObjectSchema.create({...})` /
    `defineObject({...})`. Handles `Field.X({...})` and
    `Field.lookup('rel', {...})` shapes; treats `null` / `''` / `false`
    as "remove this property" so source stays minimal.
- **"Create file" button** in `CreateMetadataDialog`: clicking now
  scaffolds a real file on disk and lets HMR reload the runtime.
  `Copy snippet` remains as a fallback for production hosts.
- **"Save" button** in `FieldDetailDrawer`: the three inline-edited
  properties (label / description / required) now persist directly to
  the parent `.object.ts` file via the field-patch endpoint. Shows
  "Saving…" spinner, success toast, and exits edit mode on success.
  Falls back to Copy snippet when the host doesn't expose the dev
  write API.
- **Layout discovery**: dialogs and drawers probe the host for the
  on-disk source root, so they work equally for single-app projects
  (`<cwd>/src/...`) and monorepo packages (`packages/<id>/src/...`).

**UX polish (carried over earlier in the iteration):**

- Home Quick Start tiles open `CreateMetadataDialog` scoped to a single
  metadata type.
- Empty-state pages get a tinted medallion + primary "Create your first
  X" CTA instead of a flat placeholder.
- Global `Cmd/Ctrl+K` command palette (cmdk-backed) with categorized
  Go-to + per-type results.
- Field detail drawer gains inline edit for `label`, `description`,
  `required`. Edits regenerate the snippet on every keystroke; dirty
  state surfaces an amber paste-handoff callout and flips the Copy
  button to primary "Copy edited snippet".

**Build pipeline:**

- Vite bundle split into named vendor chunks (`vendor-react`,
  `vendor-tanstack`, `vendor-charts`, `vendor-icons`, `vendor-radix`,
  `vendor-object-ui-{core,form,grid,views}`, `vendor-objectstack`).
  Main app chunk dropped from ~3.4 MB to ~505 KB and vendor chunks now
  cache independently across deploys.

## 5.1.0

### Patch Changes

- Updated dependencies [75f4ee6]
- Updated dependencies [823d559]
  - @objectstack/spec@5.1.0
  - @objectstack/platform-objects@5.1.0
  - @objectstack/objectql@5.1.0
  - @objectstack/metadata@5.1.0
  - @objectstack/client@5.1.0
  - @objectstack/client-react@5.1.0
  - @objectstack/driver-memory@5.1.0
  - @objectstack/plugin-msw@5.1.0
  - @objectstack/runtime@5.1.0
  - @objectstack/service-ai@5.1.0
  - @objectstack/service-analytics@5.1.0
  - @objectstack/service-automation@5.1.0
  - @objectstack/service-feed@5.1.0

## 5.0.0

### Major Changes

- bb32755: Publish `@objectstack/account` and `@objectstack/console` to npm (major release).

  Previously both apps were marked `private: true`, which prevented `changeset publish`
  from releasing them. The CLI (`@objectstack/cli`) resolves these packages from
  `node_modules/@objectstack/{account,console,studio}` to serve their built `dist`
  assets, so third-party projects could not consume them via `pnpm add`.

  - Removed `private: true` from `apps/account` and `apps/console`.
  - Added `publishConfig.access: public` to `account`, `console`, and `studio` for
    scoped-package publish safety.

### Minor Changes

- ddf8080: ADR-0008 M0 PR-9: thread the canonical server-side change-log `seq` from
  `MetadataRepository` events through to the Studio HMR badge. The
  `useMetadataHmr()` hook now exposes `lastSeq` alongside the local
  `version` counter, and the badge tooltip renders "Repo seq: #N" so
  operators can correlate Studio reloads with what other replicas observe.
  Legacy chokidar-driven events still work — they simply leave `seq`
  undefined and consumers fall back to the local counter.

### Patch Changes

- e15885f: Fix multiple live-preview rendering bugs surfaced by end-to-end browser
  verification:

  - **Grid empty render** – `@object-ui/plugin-grid` serialises `sort:[{field,order}]`
    into a space-delimited `$orderby` string which `@object-ui/data-objectstack`
    then iterates with `Object.entries()` (character indices), producing
    `sort=0,1,2,…` and zero records. The Studio data-source adapter now
    intercepts and repairs malformed `$orderby` before it reaches the server.
  - **`listViews` sub-tabs** – `MetadataPreview` now discovers and renders tab
    entries from a view's `listViews.*` map in addition to top-level keys
    (`grid`, `kanban`, `calendar`, `form`, …), labels resolved from
    `spec.label` with sensible defaults.
  - **Kanban schema transform** – CRM-style specs nest grouping under
    `kanban.{groupByField, columns}` and carry a `data:{provider,object}`
    block. `MetadataPreview` now promotes `groupByField → groupBy`, exposes
    card fields, and strips the `data:` field that would otherwise cause
    `@object-ui/plugin-kanban` to treat it as pre-fetched records and skip
    its data fetch entirely.
  - **Calendar schema transform** – Analogous: promote
    `calendar.{startDateField, endDateField, titleField, colorField}` to
    the schema root and drop the `data:` provider block so the calendar
    fetches real records.

- ba9f04a: Studio: timeline + dashboard preview renderers

  Previously `view + timeline` and `dashboard` metadata fell through to the
  "Unsupported" JSON inspector. They now render against the same live
  DataSource as the rest of Studio:

  - **TimelinePreview** — vertical chronological list grouped by date,
    honouring `timeline.{startDateField, endDateField, titleField,
groupByField, colorField}`. Status-coloured dots, start→end ranges.
  - **DashboardPreview** — CSS-grid layout (12-col by default, driven by
    `layout.{x,y,w,h}`) that renders each widget by type: `metric` /
    `gauge` / `area` as a big aggregate value; `donut` / `pie` / `bar` /
    `column` as horizontal bar charts of grouped buckets; `table` as a
    small data table fed by `dataSource.find`.

  Both renderers are intentionally minimal — designed for "preview the
  spec with real data," not pixel-perfect production rendering.

- Updated dependencies [5e9dcb4]
- Updated dependencies [8b298c7]
- Updated dependencies [f139a24]
- Updated dependencies [4eb9f8c]
- Updated dependencies [2f7e42a]
- Updated dependencies [602cce7]
- Updated dependencies [1e625b8]
- Updated dependencies [6ee42b8]
- Updated dependencies [888a5c1]
- Updated dependencies [5cfdc85]
- Updated dependencies [09f005a]
- Updated dependencies [7825394]
- Updated dependencies [96ad4df]
- Updated dependencies [df18ae9]
- Updated dependencies [9e51868]
- Updated dependencies [ddf8080]
- Updated dependencies [2f9073a]
  - @objectstack/metadata@5.0.0
  - @objectstack/objectql@5.0.0
  - @objectstack/runtime@5.0.0
  - @objectstack/platform-objects@5.0.0
  - @objectstack/spec@5.0.0
  - @objectstack/client@5.0.0
  - @objectstack/plugin-msw@5.0.0
  - @objectstack/service-ai@5.0.0
  - @objectstack/client-react@5.0.0
  - @objectstack/driver-memory@5.0.0
  - @objectstack/service-analytics@5.0.0
  - @objectstack/service-automation@5.0.0
  - @objectstack/service-feed@5.0.0

## 4.2.0

### Patch Changes

- 3a99239: Metadata HMR via SSE — close the agent-edits → preview-refresh loop.

  - `@objectstack/metadata`: register `/api/v1/dev/metadata-events` SSE endpoint unconditionally;
    add `POST` trigger that reloads the artifact and broadcasts a `reload` event to all listeners.
  - `@objectstack/cli` (`os dev`): chokidar-based watch on `objectstack.config.ts` and `src/`;
    debounced recompile + `POST` to the HMR endpoint so the server reloads without restart.
  - `@objectstack/studio`: `useMetadataHmr` provider opens an `EventSource`, exposes a version
    counter; previews include it in their query deps, and a top-bar badge surfaces connection
    state and event counts for diagnostics.

- bab9bb8: fix
- 14f5cde: Studio: wire form previews to the **real running backend** instead of the
  hand-rolled disabled-input mockup.

  - New `LiveFormPreview` component renders `<ObjectForm>` from `@object-ui/plugin-form`
    against the live `DataSource`, with a Create / Edit / Read-only mode toggle and a
    record picker (top 10 most-recent records via `dataSource.find`) for Edit mode.
  - New `LivePreviewStatusBar` footer surfaces a pulsing **LIVE** indicator with
    the backend base URL and bound object so it is obvious previews are real, not
    mocked.
  - Playground "Form preview" tab now uses `LiveFormPreview` and correctly unwraps
    the `{ type, items }` envelope returned by `client.meta.getItems('view')`
    (previously the `.map` call silently threw, leaving the tab showing
    "No forms yet" even when ten forms existed).
  - `MetadataPreview` routes both single-spec form views and multi-view docs
    through `LiveFormPreview`; non-form previews now show the LIVE status bar.
  - Object detail page Forms/Views tabs now also detect multi-view documents
    (where `object` is nested under `list.data.object` / `form.data.object`).
  - Removed legacy mock `FormPreview` component.

- f289927: Studio: fix Object Hub Views / Forms / Hooks tabs all showing `(0)`.

  The `$package.objects.$name` route was passing the **URL slug** (e.g. `crm`)
  as `packageId` to `client.meta.getItems('view', { packageId })`, but the
  metadata server filter requires the **full package id** (e.g.
  `com.example.crm`). The server-side filter never matched, so the tabs
  silently fell back to empty arrays.

  Aligned the route with `$package.metadata.$type.$name`: resolve the slug via
  `usePackages(packageId)` and pass `selectedPackage.manifest.id` to the API
  (falling back to the raw slug until the package list loads).

- cefcf64: Live preview for view/page/dashboard/report metadata.

  Adds a built-in `objectstack.view-preview` plugin that registers a
  `Live Preview` viewer (priority 50, beating the default JSON inspector)
  for `view`, `page`, `report`, and `dashboard` types. Opening any of
  these from the Views & Apps list now renders a real `@object-ui`
  preview (grid / kanban / calendar / form / detail) instead of a JSON
  tree. HMR is wired — source edits re-fetch the spec and remount the
  preview without a full page reload.

- Updated dependencies [3a99239]
- Updated dependencies [2869891]
  - @objectstack/metadata@4.2.0
  - @objectstack/spec@4.2.0
  - @objectstack/objectql@4.2.0
  - @objectstack/client@4.2.0
  - @objectstack/runtime@4.2.0
  - @objectstack/client-react@4.2.0
  - @objectstack/platform-objects@4.2.0
  - @objectstack/driver-memory@4.2.0
  - @objectstack/plugin-msw@4.2.0
  - @objectstack/service-ai@4.2.0
  - @objectstack/service-analytics@4.2.0
  - @objectstack/service-automation@4.2.0
  - @objectstack/service-feed@4.2.0

## 4.1.1

### Patch Changes

- 5326c6b: Studio developer UX overhaul.

  - **Inspector drawer** (right Sheet, toggle via header button or `]`) with API / Source / Refs tabs that auto-populate from the current resource detail page.
  - **Problems panel** (status bar pill + `[`) that subscribes to object/view/flow/hook changes and surfaces unknown object refs, missing field refs, and broken triggers with deep-links back to source.
  - **Keyboard shortcuts**: `g o|f|v|a|s|p` navigation, `[` problems, `]` inspector, `?` help dialog.
  - **Resource actions menu** (`⋯` on detail page header): Copy as curl / fetch() / `defineX()` TypeScript / Metadata JSON; Open in VS Code; Open API endpoint.
  - **Welcome onboarding** empty-state in the developer overview when a package has no metadata.
  - New `StudioShell` wrapper; `TopBar` gains a `rightSlot` prop for Inspector / Help buttons.

  `@objectstack/client`: surface plain-string `error` bodies (e.g. `RECORD_LOCKED: …`) in fetch error messages instead of swallowing them as `Bad Request`.

- Updated dependencies [5326c6b]
  - @objectstack/client@4.1.1
  - @objectstack/client-react@4.1.1
  - @objectstack/spec@4.1.1
  - @objectstack/metadata@4.1.1
  - @objectstack/objectql@4.1.1
  - @objectstack/platform-objects@4.1.1
  - @objectstack/runtime@4.1.1
  - @objectstack/driver-memory@4.1.1
  - @objectstack/plugin-msw@4.1.1
  - @objectstack/service-ai@4.1.1
  - @objectstack/service-analytics@4.1.1
  - @objectstack/service-automation@4.1.1
  - @objectstack/service-feed@4.1.1

## 4.1.0

### Patch Changes

- Updated dependencies [2108c30]
- Updated dependencies [96fb108]
- Updated dependencies [23db640]
- Updated dependencies [1234920]
- Updated dependencies [5683206]
- Updated dependencies [70db902]
- Updated dependencies [70db902]
- Updated dependencies [d3b455f]
- Updated dependencies [f0b3972]
- Updated dependencies [0e63f2f]
  - @objectstack/spec@4.1.0
  - @objectstack/runtime@4.1.0
  - @objectstack/metadata@4.1.0
  - @objectstack/objectql@4.1.0
  - @objectstack/plugin-security@4.1.0
  - @objectstack/client@4.1.0
  - @objectstack/client-react@4.1.0
  - @objectstack/platform-objects@4.1.0
  - @objectstack/driver-memory@4.1.0
  - @objectstack/driver-turso@4.1.0
  - @objectstack/plugin-audit@4.1.0
  - @objectstack/plugin-auth@4.1.0
  - @objectstack/plugin-msw@4.1.0
  - @objectstack/service-ai@4.1.0
  - @objectstack/service-analytics@4.1.0
  - @objectstack/service-automation@4.1.0
  - @objectstack/service-feed@4.1.0
  - @objectstack/hono@4.1.0
  - @objectstack/service-tenant@4.1.0

## 4.0.5

### Patch Changes

- 15e0df6: chore: unify all package versions to a single patch release
- Updated dependencies [15e0df6]
  - @objectstack/spec@4.0.5
  - @objectstack/client@4.0.5
  - @objectstack/client-react@4.0.5
  - @objectstack/metadata@4.0.5
  - @objectstack/objectql@4.0.5
  - @objectstack/platform-objects@4.0.5
  - @objectstack/runtime@4.0.5
  - @objectstack/driver-memory@4.0.5
  - @objectstack/driver-turso@4.0.5
  - @objectstack/plugin-audit@4.0.5
  - @objectstack/plugin-auth@4.0.5
  - @objectstack/plugin-msw@4.0.5
  - @objectstack/plugin-security@4.0.5
  - @objectstack/hono@4.0.5
  - @objectstack/service-automation@4.0.5
  - @objectstack/service-analytics@4.0.5
  - @objectstack/service-feed@4.0.5
  - @objectstack/service-ai@4.0.5
  - @objectstack/service-tenant@4.0.5

## Unreleased

### Patch Changes

- **Fix duplicate sidebar rendering on `/$package/objects/:name` and `/$package/metadata/:type/:name`.** Both the parent `$package.tsx` layout and its children rendered their own `<AppSidebar>` + `<main>` + `<SiteHeader>` shell. With TanStack Router's flat file routing, children render inside the parent's `<Outlet>` — producing a visible copy of the left sidebar in the right content pane instead of the metadata detail.
  - `$package.tsx` is now a pure layout: `<AppSidebar>` + `<main>` wrapper + `<Outlet>`. No `SiteHeader`.
  - New `$package.index.tsx` leaf handles the exact `/$package` URL, rendering `<SiteHeader selectedView="overview">` + `<DeveloperOverview>`.
  - `$package.objects.$name.tsx` and `$package.metadata.$type.$name.tsx` simplified to render only their `<SiteHeader>` + `<PluginHost>`; shell is inherited from the parent layout.
- **Unified Studio mount path to `/_studio/` for all deployments.** The Vite
  build default is now `base: '/_studio/'` (was `'./'`), baking the correct
  absolute asset URLs and router basepath into every bundle. This removes the
  previous build-time/runtime ambiguity that required the host server to
  rewrite `href="/..."` URLs or inject a `window.__OBJECTSTACK_STUDIO_BASEPATH__`
  marker.
- `resolveBasepath()` in `src/router.ts` simplified to rely solely on Vite's
  `import.meta.env.BASE_URL`, which now always yields `/_studio/` for
  production bundles and CLI dev (the CLI dev server sets
  `VITE_BASE=/_studio/`). Runtime `window` injection workaround removed.

## 4.0.4

### Patch Changes

- Updated dependencies [326b66b]
  - @objectstack/spec@4.0.4
  - @objectstack/client@4.0.4
  - @objectstack/client-react@4.0.4
  - @objectstack/metadata@4.0.4
  - @objectstack/objectql@4.0.4
  - @objectstack/driver-memory@4.0.4
  - @objectstack/driver-turso@4.0.4
  - @objectstack/plugin-audit@4.0.4
  - @objectstack/plugin-auth@4.0.4
  - @objectstack/plugin-msw@4.0.4
  - @objectstack/plugin-security@4.0.4
  - @objectstack/plugin-setup@4.0.4
  - @objectstack/runtime@4.0.4
  - @objectstack/service-ai@4.0.4
  - @objectstack/service-analytics@4.0.4
  - @objectstack/service-automation@4.0.4
  - @objectstack/service-feed@4.0.4
  - @objectstack/hono@4.0.4

## 4.0.3

### Patch Changes

- Fix simulateBrowser mock handlers to properly support query parameters (top, skip, sort, select, filter) in data endpoints, use protocol service for metadata endpoints (types, items), and return correct response formats matching the ObjectStack protocol spec
- Updated dependencies [ee39bff]
  - @objectstack/service-ai@4.0.3
  - @objectstack/plugin-auth@4.0.3
  - @objectstack/spec@4.0.3
  - @objectstack/client@4.0.3
  - @objectstack/client-react@4.0.3
  - @objectstack/metadata@4.0.3
  - @objectstack/objectql@4.0.3
  - @objectstack/runtime@4.0.3
  - @objectstack/driver-memory@4.0.3
  - @objectstack/driver-turso@4.0.3
  - @objectstack/plugin-audit@4.0.3
  - @objectstack/plugin-msw@4.0.3
  - @objectstack/plugin-security@4.0.3
  - @objectstack/plugin-setup@4.0.3
  - @objectstack/hono@4.0.3
  - @objectstack/service-automation@4.0.3
  - @objectstack/service-analytics@4.0.3
  - @objectstack/service-feed@4.0.3

## 4.0.2

### Patch Changes

- 5f659e9: fix ai
- Updated dependencies [5f659e9]
  - @objectstack/driver-memory@4.0.2
  - @objectstack/service-ai@4.0.2
  - @objectstack/hono@4.0.2
  - @objectstack/client@4.0.2
  - @objectstack/spec@4.0.2
  - @objectstack/driver-turso@4.0.2
  - @objectstack/client-react@4.0.2
  - @objectstack/metadata@4.0.2
  - @objectstack/objectql@4.0.2
  - @objectstack/plugin-audit@4.0.2
  - @objectstack/plugin-auth@4.0.2
  - @objectstack/plugin-msw@4.0.2
  - @objectstack/plugin-security@4.0.2
  - @objectstack/plugin-setup@4.0.2
  - @objectstack/runtime@4.0.2
  - @objectstack/service-analytics@4.0.2
  - @objectstack/service-automation@4.0.2
  - @objectstack/service-feed@4.0.2

## Unreleased

### Patch Changes

- **Vercel deployment: Fix POST/PUT/PATCH API requests timing out**

  Replaced the `handle()` + outer Hono app delegation pattern with
  `getRequestListener()` from `@hono/node-server`, matching the proven
  pattern from the hotcrm reference deployment.

  The previous approach used `handle()` from `@hono/node-server/vercel`
  wrapped in an outer Hono app that delegated to the inner ObjectStack
  app via `inner.fetch(c.req.raw)`. On Vercel, the `IncomingMessage`
  stream is already drained by the time the inner app's route handler
  calls `.json()`, causing POST/PUT/PATCH requests to hang indefinitely.

  The new approach uses `getRequestListener()` directly, which exposes
  the raw `IncomingMessage` via `env.incoming`. For POST/PUT/PATCH
  requests, the body is extracted from Vercel's pre-buffered `rawBody` /
  `body` properties and a fresh standard `Request` is constructed for
  the inner Hono app. This also adds `x-forwarded-proto` URL correction
  for proper HTTPS detection behind Vercel's reverse proxy.

- Remove `functions` block from `vercel.json` to fix deployment error:
  "The pattern 'api/index.js' defined in `functions` doesn't match any
  Serverless Functions inside the `api` directory."

  The `api/index.js` file is a build artifact generated by `bundle-api.mjs`
  during the Vercel build step — it does not exist in the source tree.
  Vercel validates `functions` patterns before running the build, causing
  the mismatch. The per-function configuration (`memory`, `maxDuration`)
  is already exported from `server/index.ts` via `export const config`,
  which the `@vercel/node` runtime picks up at deploy time.

### Minor Changes

- Add collapsible right-side AI Chat floating panel (VS Code Copilot Chat style).

  - New `AiChatPanel` component: fixed right-side panel with 48px collapsed edge
    button and 380px expanded view. Supports stream chat via Vercel AI SDK
    `useChat` hook connected to `/api/v1/ai/chat`.
  - New `use-ai-chat-panel` hook: manages panel visibility toggle, keyboard
    shortcut (`Ctrl+Shift+I` / `Cmd+Shift+I`), and message history persistence
    to localStorage.
  - Added `ai` and `@ai-sdk/react` dependencies for Vercel Data Stream Protocol
    integration.

## 4.0.0

### Patch Changes

- 1624851: Fix Vercel deployment API endpoints returning HTML instead of JSON.

  The `bundle-api.mjs` script was emitting the serverless function to `api/index.js`
  at the project root, but `vercel.json` sets `outputDirectory: "dist"` — causing
  Vercel to never find the function entrypoint and fall back to the SPA HTML route
  for all `/api/*` requests.

  - Change esbuild `outfile` from `api/index.js` to `dist/api/index.js` so the
    bundled serverless function lands inside the Vercel output directory.
  - Add explicit `functions` config in `vercel.json` pointing to `api/index.js`
    (relative to `outputDirectory`) with `@vercel/node@3` runtime.
  - Remove obsolete `.gitignore` entries for `api/index.js` and `api/index.js.map`
    (now emitted under `dist/` which is already git-ignored).

- Updated dependencies [f08ffc3]
- Updated dependencies [e0b0a78]
  - @objectstack/spec@4.0.0
  - @objectstack/client@4.0.0
  - @objectstack/runtime@4.0.0
  - @objectstack/hono@4.0.0
  - @objectstack/objectql@4.0.0
  - @objectstack/plugin-auth@4.0.0
  - @objectstack/client-react@4.0.0
  - @objectstack/metadata@4.0.0
  - @objectstack/driver-memory@4.0.0
  - @objectstack/driver-turso@3.3.2
  - @objectstack/plugin-audit@4.0.0
  - @objectstack/plugin-msw@4.0.0
  - @objectstack/plugin-security@4.0.0
  - @objectstack/service-feed@4.0.0

## Unreleased

### Enhancements

- **API Console: Complete service endpoint discovery from `/api/v1/discovery`**
  - The API console now uses the discovery endpoint's `services` and `routes` maps to dynamically populate endpoints for all enabled services (AI, Workflow, Realtime, Notifications, Analytics, Automation, i18n, UI, Feed, Storage)
  - Previously, only System, Auth, Metadata, and Data CRUD endpoints were shown; AI and other service endpoints were missing
  - Added `SERVICE_ENDPOINT_CATALOG` — a well-known endpoint catalog aligned with `plugin-rest-api.zod.ts` route definitions
  - Added `buildServiceEndpoints()` helper for generating endpoint definitions from a service name and route prefix
  - Updated group sort order to include service groups between Auth and Metadata

### Fixes

- **Vercel deployment: Fix `functions` pattern validation error**

  - The `functions` key in `vercel.json` referenced `api/index.js` — a build artifact created by
    `bundle-api.mjs` — which does not exist in the source tree. Vercel CLI validates patterns against
    source files before the build runs, producing the error:
    `The pattern "api/index.js" defined in "functions" doesn't match any Serverless Functions`.
  - Removed `functions` from `vercel.json` and moved the memory/maxDuration settings to an inline
    `export const config` in `server/index.ts`. This is the standard Vercel per-function configuration
    mechanism and is bundled into `api/index.js` by esbuild.

- **Vercel deployment: Fix `@vercel/node@3` runtime error**
  - Removed the `functions.runtime` config from `vercel.json` — the `runtime` field is only for custom/community runtimes, not Node.js. Vercel auto-detects the pre-bundled `api/index.js` as a Node.js serverless function.

## 3.3.1

### Patch Changes

- @objectstack/spec@3.3.1
- @objectstack/client@3.3.1
- @objectstack/client-react@3.3.1
- @objectstack/metadata@3.3.1
- @objectstack/objectql@3.3.1
- @objectstack/runtime@3.3.1
- @objectstack/driver-memory@3.3.1
- @objectstack/plugin-audit@3.3.1
- @objectstack/plugin-auth@3.3.1
- @objectstack/plugin-msw@3.3.1
- @objectstack/plugin-security@3.3.1
- @objectstack/hono@3.3.1
- @objectstack/service-feed@3.3.1
- @objectstack/driver-turso@3.3.1

## 3.3.1

### Patch Changes

- Fix Vercel deployment crash (`ERR_MODULE_NOT_FOUND` for `@objectstack/metadata/src/index.ts`)
  - Change `bundle-api.mjs` output from `api/index.mjs` to `api/index.js` so Vercel's @vercel/node runtime uses the pre-bundled self-contained bundle directly instead of compiling from TypeScript source (which resolves workspace symlinks to `.ts` source files)
  - Since `package.json` has `"type": "module"`, `.js` files are treated as ESM — matching the esbuild `format: 'esm'` output

## 3.3.0

### Patch Changes

- Updated dependencies [814a6c4]
  - @objectstack/plugin-auth@3.3.0
  - @objectstack/spec@3.3.0
  - @objectstack/client@3.3.0
  - @objectstack/client-react@3.3.0
  - @objectstack/metadata@3.3.0
  - @objectstack/objectql@3.3.0
  - @objectstack/runtime@3.3.0
  - @objectstack/driver-memory@3.3.0
  - @objectstack/plugin-msw@3.3.0
  - @objectstack/plugin-security@3.3.0
  - @objectstack/hono@3.3.0
  - @objectstack/service-feed@3.3.0
  - @objectstack/plugin-audit@3.2.10

## 3.2.9

### Patch Changes

- Updated dependencies [c3065dd]
  - @objectstack/objectql@3.2.9
  - @objectstack/client@3.2.9
  - @objectstack/plugin-msw@3.2.9
  - @objectstack/plugin-auth@3.2.9
  - @objectstack/spec@3.2.9
  - @objectstack/client-react@3.2.9
  - @objectstack/metadata@3.2.9
  - @objectstack/runtime@3.2.9
  - @objectstack/driver-memory@3.2.9
  - @objectstack/plugin-security@3.2.9
  - @objectstack/hono@3.2.9
  - @objectstack/service-feed@3.2.9
  - @objectstack/plugin-audit@3.2.9

## 3.2.8

### Patch Changes

- Updated dependencies [1fe5612]
  - @objectstack/plugin-auth@3.2.8
  - @objectstack/spec@3.2.8
  - @objectstack/client@3.2.8
  - @objectstack/client-react@3.2.8
  - @objectstack/metadata@3.2.8
  - @objectstack/objectql@3.2.8
  - @objectstack/runtime@3.2.8
  - @objectstack/driver-memory@3.2.8
  - @objectstack/plugin-msw@3.2.8
  - @objectstack/plugin-security@3.2.8
  - @objectstack/hono@3.2.8
  - @objectstack/service-feed@3.2.8
  - @objectstack/plugin-audit@3.2.8

## 3.2.10

### Patch Changes

- Fix Vercel deployment crash (`ERR_MODULE_NOT_FOUND` for `api/_kernel`)
  - Inline `_kernel.ts` content into `api/index.ts` to eliminate the bare extensionless relative import that broke Node's ESM resolver
  - Move `hono` from `devDependencies` to `dependencies` so it is available in the Vercel serverless runtime
  - Use explicit `.js` file extensions for relative imports in the API entrypoint (`create-broker-shim.js`, `objectstack.config.js`) per ESM best practice
  - Delete `api/_kernel.ts` — all kernel/service initialisation is now co-located in `api/index.ts`

## 3.2.9

### Minor Changes

- Migrate Vercel API entrypoint from `api/[...path].ts` to `api/index.ts` (Hono + Vercel Node adapter)
  - Replace Next.js-style catch-all with a proper Hono app exported via `handle(app)` from `hono/vercel`
  - Add `/api/*` → `/api` rewrite in `vercel.json` for native Hono routing
  - Rename `getApp()` → `ensureApp()` and export `ensureKernel()` from `_kernel.ts`
  - Remove path-normalisation workaround (no longer needed with Vercel rewrites)
  - Add deployment smoke tests for `/api/v1/meta` and `/api/v1/packages`

## 3.2.8

### Minor Changes

- Switch Vercel deployment from MSW (browser mock) to real server mode
  - Add `api/[...path].ts` Vercel serverless catch-all using Hono + `@objectstack/hono`
  - Add `api/_kernel.ts` server-side kernel singleton with broker shim
  - Extract broker shim to `src/lib/create-broker-shim.ts` (shared by MSW and server modes)
  - Update `vercel.json` to set `VITE_RUNTIME_MODE=server` and `VITE_SERVER_URL=""`
  - Add `hono` and `@objectstack/hono` dependencies
  - Update deployment documentation

## 3.2.7

### Patch Changes

- @objectstack/spec@3.2.7
- @objectstack/client@3.2.7
- @objectstack/client-react@3.2.7
- @objectstack/metadata@3.2.7
- @objectstack/objectql@3.2.7
- @objectstack/runtime@3.2.7
- @objectstack/driver-memory@3.2.7
- @objectstack/plugin-msw@3.2.7

## 3.2.6

### Patch Changes

- @objectstack/spec@3.2.6
- @objectstack/client@3.2.6
- @objectstack/client-react@3.2.6
- @objectstack/metadata@3.2.6
- @objectstack/objectql@3.2.6
- @objectstack/runtime@3.2.6
- @objectstack/driver-memory@3.2.6
- @objectstack/plugin-msw@3.2.6

## 3.2.5

### Patch Changes

- @objectstack/spec@3.2.5
- @objectstack/client@3.2.5
- @objectstack/client-react@3.2.5
- @objectstack/metadata@3.2.5
- @objectstack/objectql@3.2.5
- @objectstack/runtime@3.2.5
- @objectstack/driver-memory@3.2.5
- @objectstack/plugin-msw@3.2.5

## 3.2.4

### Patch Changes

- @objectstack/spec@3.2.4
- @objectstack/client@3.2.4
- @objectstack/client-react@3.2.4
- @objectstack/metadata@3.2.4
- @objectstack/objectql@3.2.4
- @objectstack/runtime@3.2.4
- @objectstack/driver-memory@3.2.4
- @objectstack/plugin-msw@3.2.4

## 3.2.3

### Patch Changes

- @objectstack/spec@3.2.3
- @objectstack/client@3.2.3
- @objectstack/client-react@3.2.3
- @objectstack/metadata@3.2.3
- @objectstack/objectql@3.2.3
- @objectstack/runtime@3.2.3
- @objectstack/driver-memory@3.2.3
- @objectstack/plugin-msw@3.2.3

## 3.2.2

### Patch Changes

- Updated dependencies [46defbb]
  - @objectstack/spec@3.2.2
  - @objectstack/driver-memory@3.2.2
  - @objectstack/client@3.2.2
  - @objectstack/client-react@3.2.2
  - @objectstack/metadata@3.2.2
  - @objectstack/objectql@3.2.2
  - @objectstack/plugin-msw@3.2.2
  - @objectstack/runtime@3.2.2

## 3.2.1

### Patch Changes

- Updated dependencies [850b546]
  - @objectstack/spec@3.2.1
  - @objectstack/client@3.2.1
  - @objectstack/client-react@3.2.1
  - @objectstack/metadata@3.2.1
  - @objectstack/objectql@3.2.1
  - @objectstack/driver-memory@3.2.1
  - @objectstack/plugin-msw@3.2.1
  - @objectstack/runtime@3.2.1

## 3.2.0

### Patch Changes

- Updated dependencies [5901c29]
  - @objectstack/spec@3.2.0
  - @objectstack/client@3.2.0
  - @objectstack/client-react@3.2.0
  - @objectstack/metadata@3.2.0
  - @objectstack/objectql@3.2.0
  - @objectstack/driver-memory@3.2.0
  - @objectstack/plugin-msw@3.2.0
  - @objectstack/runtime@3.2.0

## 3.1.1

### Patch Changes

- Updated dependencies [953d667]
  - @objectstack/spec@3.1.1
  - @objectstack/client@3.1.1
  - @objectstack/client-react@3.1.1
  - @objectstack/metadata@3.1.1
  - @objectstack/objectql@3.1.1
  - @objectstack/driver-memory@3.1.1
  - @objectstack/plugin-msw@3.1.1
  - @objectstack/runtime@3.1.1

## 3.1.0

### Patch Changes

- Updated dependencies [0088830]
  - @objectstack/spec@3.1.0
  - @objectstack/client@3.1.0
  - @objectstack/client-react@3.1.0
  - @objectstack/metadata@3.1.0
  - @objectstack/objectql@3.1.0
  - @objectstack/driver-memory@3.1.0
  - @objectstack/plugin-msw@3.1.0
  - @objectstack/runtime@3.1.0

## 3.0.11

### Patch Changes

- Updated dependencies [92d9d99]
  - @objectstack/spec@3.0.11
  - @objectstack/client@3.0.11
  - @objectstack/client-react@3.0.11
  - @objectstack/metadata@3.0.11
  - @objectstack/objectql@3.0.11
  - @objectstack/driver-memory@3.0.11
  - @objectstack/plugin-msw@3.0.11
  - @objectstack/runtime@3.0.11

## 3.0.10

### Patch Changes

- Updated dependencies [d1e5d31]
  - @objectstack/spec@3.0.10
  - @objectstack/client@3.0.10
  - @objectstack/client-react@3.0.10
  - @objectstack/metadata@3.0.10
  - @objectstack/objectql@3.0.10
  - @objectstack/driver-memory@3.0.10
  - @objectstack/plugin-msw@3.0.10
  - @objectstack/runtime@3.0.10

## 3.0.9

### Patch Changes

- Updated dependencies [15e0df6]
  - @objectstack/spec@3.0.9
  - @objectstack/client@3.0.9
  - @objectstack/client-react@3.0.9
  - @objectstack/metadata@3.0.9
  - @objectstack/objectql@3.0.9
  - @objectstack/driver-memory@3.0.9
  - @objectstack/plugin-msw@3.0.9
  - @objectstack/runtime@3.0.9

## 3.0.8

### Patch Changes

- Updated dependencies [5a968a2]
  - @objectstack/spec@3.0.8
  - @objectstack/client@3.0.8
  - @objectstack/client-react@3.0.8
  - @objectstack/metadata@3.0.8
  - @objectstack/objectql@3.0.8
  - @objectstack/driver-memory@3.0.8
  - @objectstack/plugin-msw@3.0.8
  - @objectstack/runtime@3.0.8

## 3.0.7

### Patch Changes

- Updated dependencies [0119bd7]
- Updated dependencies [5426bdf]
  - @objectstack/spec@3.0.7
  - @objectstack/client@3.0.7
  - @objectstack/client-react@3.0.7
  - @objectstack/metadata@3.0.7
  - @objectstack/objectql@3.0.7
  - @objectstack/driver-memory@3.0.7
  - @objectstack/plugin-msw@3.0.7
  - @objectstack/runtime@3.0.7

## 3.0.6

### Patch Changes

- Updated dependencies [5df254c]
  - @objectstack/spec@3.0.6
  - @objectstack/client@3.0.6
  - @objectstack/client-react@3.0.6
  - @objectstack/metadata@3.0.6
  - @objectstack/objectql@3.0.6
  - @objectstack/driver-memory@3.0.6
  - @objectstack/plugin-msw@3.0.6
  - @objectstack/runtime@3.0.6

## 3.0.5

### Patch Changes

- Updated dependencies [23a4a68]
  - @objectstack/spec@3.0.5
  - @objectstack/client@3.0.5
  - @objectstack/client-react@3.0.5
  - @objectstack/metadata@3.0.5
  - @objectstack/objectql@3.0.5
  - @objectstack/driver-memory@3.0.5
  - @objectstack/plugin-msw@3.0.5
  - @objectstack/runtime@3.0.5

## 3.0.4

### Patch Changes

- Updated dependencies [d738987]
- Updated dependencies [437b0b8]
  - @objectstack/spec@3.0.4
  - @objectstack/objectql@3.0.4
  - @objectstack/client@3.0.4
  - @objectstack/client-react@3.0.4
  - @objectstack/metadata@3.0.4
  - @objectstack/driver-memory@3.0.4
  - @objectstack/plugin-msw@3.0.4
  - @objectstack/runtime@3.0.4

## 3.0.3

### Patch Changes

- c7267f6: Patch release for maintenance updates and improvements.
- Updated dependencies [c7267f6]
  - @objectstack/spec@3.0.3
  - @objectstack/client@3.0.3
  - @objectstack/client-react@3.0.3
  - @objectstack/metadata@3.0.3
  - @objectstack/objectql@3.0.3
  - @objectstack/runtime@3.0.3
  - @objectstack/driver-memory@3.0.3
  - @objectstack/plugin-msw@3.0.3

## 3.0.2

### Patch Changes

- Updated dependencies [28985f5]
  - @objectstack/spec@3.0.2
  - @objectstack/client@3.0.2
  - @objectstack/client-react@3.0.2
  - @objectstack/metadata@3.0.2
  - @objectstack/objectql@3.0.2
  - @objectstack/driver-memory@3.0.2
  - @objectstack/plugin-msw@3.0.2
  - @objectstack/runtime@3.0.2

## 3.0.1

### Patch Changes

- Updated dependencies [389725a]
  - @objectstack/spec@3.0.1
  - @objectstack/client@3.0.1
  - @objectstack/client-react@3.0.1
  - @objectstack/metadata@3.0.1
  - @objectstack/objectql@3.0.1
  - @objectstack/driver-memory@3.0.1
  - @objectstack/plugin-msw@3.0.1
  - @objectstack/runtime@3.0.1

## 3.0.0

### Major Changes

- Release v3.0.0 — unified version bump for all ObjectStack packages.

### Patch Changes

- Updated dependencies
  - @objectstack/spec@3.0.0
  - @objectstack/client@3.0.0
  - @objectstack/client-react@3.0.0
  - @objectstack/metadata@3.0.0
  - @objectstack/objectql@3.0.0
  - @objectstack/runtime@3.0.0
  - @objectstack/driver-memory@3.0.0
  - @objectstack/plugin-msw@3.0.0

## 2.0.7

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.7
  - @objectstack/client@2.0.7
  - @objectstack/client-react@2.0.7
  - @objectstack/metadata@2.0.7
  - @objectstack/objectql@2.0.7
  - @objectstack/driver-memory@2.0.7
  - @objectstack/plugin-msw@2.0.7
  - @objectstack/runtime@2.0.7

## 2.0.6

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.6
  - @objectstack/client@2.0.6
  - @objectstack/client-react@2.0.6
  - @objectstack/metadata@2.0.6
  - @objectstack/objectql@2.0.6
  - @objectstack/runtime@2.0.6
  - @objectstack/driver-memory@2.0.6
  - @objectstack/plugin-msw@2.0.6

## 2.0.5

### Patch Changes

- Updated dependencies
  - @objectstack/spec@2.0.5
  - @objectstack/client@2.0.5
  - @objectstack/client-react@2.0.5
  - @objectstack/metadata@2.0.5
  - @objectstack/objectql@2.0.5
  - @objectstack/driver-memory@2.0.5
  - @objectstack/plugin-msw@2.0.5
  - @objectstack/runtime@2.0.5

## 2.0.4

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.4
  - @objectstack/client@2.0.4
  - @objectstack/client-react@2.0.4
  - @objectstack/metadata@2.0.4
  - @objectstack/objectql@2.0.4
  - @objectstack/runtime@2.0.4
  - @objectstack/driver-memory@2.0.4
  - @objectstack/plugin-msw@2.0.4

## 2.0.3

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.3
  - @objectstack/client@2.0.3
  - @objectstack/client-react@2.0.3
  - @objectstack/metadata@2.0.3
  - @objectstack/objectql@2.0.3
  - @objectstack/runtime@2.0.3
  - @objectstack/driver-memory@2.0.3
  - @objectstack/plugin-msw@2.0.3

## 2.0.2

### Patch Changes

- Updated dependencies [1db8559]
  - @objectstack/spec@2.0.2
  - @objectstack/client@2.0.2
  - @objectstack/client-react@2.0.2
  - @objectstack/metadata@2.0.2
  - @objectstack/objectql@2.0.2
  - @objectstack/driver-memory@2.0.2
  - @objectstack/plugin-msw@2.0.2
  - @objectstack/runtime@2.0.2

## 2.0.1

### Patch Changes

- Patch release for maintenance and stability improvements
- Updated dependencies
  - @objectstack/spec@2.0.1
  - @objectstack/client@2.0.1
  - @objectstack/client-react@2.0.1
  - @objectstack/metadata@2.0.1
  - @objectstack/objectql@2.0.1
  - @objectstack/runtime@2.0.1
  - @objectstack/driver-memory@2.0.1
  - @objectstack/plugin-msw@2.0.1

## 2.0.0

### Patch Changes

- Updated dependencies [38e5dd5]
- Updated dependencies [38e5dd5]
  - @objectstack/spec@2.0.0
  - @example/app-crm@1.2.1
  - @example/app-todo@1.2.1
  - @objectstack/client@2.0.0
  - @objectstack/client-react@2.0.0
  - @objectstack/metadata@2.0.0
  - @objectstack/objectql@2.0.0
  - @objectstack/driver-memory@2.0.0
  - @objectstack/plugin-msw@2.0.0
  - @objectstack/runtime@2.0.0

## 0.9.16

### Patch Changes

- Updated dependencies
  - @objectstack/spec@1.0.12
  - @objectstack/client@1.0.12
  - @objectstack/client-react@1.0.12
  - @objectstack/runtime@1.0.12
  - @example/app-crm@0.9.15
  - @example/app-todo@0.9.15
  - @objectstack/metadata@1.0.12
  - @objectstack/objectql@1.0.12
  - @objectstack/driver-memory@1.0.12
  - @objectstack/plugin-msw@1.0.12

## 0.9.15

### Patch Changes

- Simplify console runtime config: remove demo mode, unify VITE_RUNTIME_MODE (msw/server), add Vercel deployment configs
