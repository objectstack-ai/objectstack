# @objectstack/studio

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
