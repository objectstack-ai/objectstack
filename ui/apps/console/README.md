# ObjectStack Console

The standard runtime UI for ObjectStack applications. This package provides the **Console** — a full-featured enterprise admin interface that renders from JSON metadata alone, requiring zero custom pages.

> **Version:** see the [npm page](https://www.npmjs.com/package/@object-ui/console) &nbsp;|&nbsp; **Spec:** the `@objectstack/spec` range declared in [`package.json`](./package.json) &nbsp;|&nbsp; [Full Roadmap →](../../ROADMAP.md)

## Features

- **Server-Driven UI**: Renders objects, views, dashboards, reports, and pages from JSON schemas
- **Multi-App Support**: Switch between apps defined in your stack, each with its own branding
- **Plugin Architecture**: 15+ view plugins (grid, kanban, calendar, timeline, chart, map, gantt, gallery, etc.)
- **Expression Engine**: Dynamic visibility, disabled, and hidden expressions evaluated at runtime
- **CRUD Operations**: Create, edit, delete records via schema-driven forms and dialogs
- **Command Palette**: `⌘+K` for quick navigation across apps and objects
- **Dark/Light Theme**: System-aware theme with per-app branding (logo, colors, favicon)
- **Developer Tools**: Built-in metadata inspector with collapsible sections and copy-to-clipboard support

## Quick Start

```bash
# From the repository root
pnpm install

# Start the console SPA (requires a running ObjectStack backend)
pnpm dev

# Build for production
pnpm build

# Run tests
pnpm test
```

`pnpm build` also writes `dist/sdui.manifest.json`, the SDUI component manifest
of the registry this build ships. A host serving `dist` registers it as its
deployment manifest, and the metadata save door judges page sources against it
(ADR-0080 §5). The step (`pnpm build:sdui-manifest`) runs after `vite build`,
calls `buildArtifacts` from `packages/sdui-parser/scripts/gen-manifest.ts` over
the registry `dev/manifest-registry.ts` loads, and needs the workspace packages
built first (turbo's `^build` does that).

The console is a **pure SPA** and requires an external ObjectStack backend.
`VITE_SERVER_URL` in `apps/console/.env.development` ships empty (same-origin);
the Vite dev server proxies `/api/*` to `http://localhost:3000` by default, or
to `DEV_PROXY_TARGET` when set — e.g.
`DEV_PROXY_TARGET=https://demo.objectstack.ai pnpm dev` — to point dev at a
different backend without leaving same-origin.

To run a backend locally, use the `@objectstack/cli` from a separate
ObjectStack project checkout — we no longer ship an in-repo dev-server
because it pinned ObjectStack versions and caused drift against the
published packages.

## Running Modes

The console runs as a standalone SPA against any ObjectStack backend:

### 1. Development Mode
**Command:** `pnpm dev`

- Vite dev server with Hot Module Replacement (HMR), opens at
  http://localhost:5180.
- `VITE_SERVER_URL` is empty by default (same origin); Vite proxies `/api/*`
  to `http://localhost:3000`, or to `DEV_PROXY_TARGET` when set, to reach the
  ObjectStack backend.
- Only `/api/*` is proxied — `/_auth/*` and `/_account/*` are **not**
  proxied.

### 2. Standalone SPA preview
**Command:** `pnpm start`

- Runs `vite preview` against the built `dist/` directory.
- Connects to whatever backend `VITE_SERVER_URL` points at — useful for
  smoke-testing a production build against a remote ObjectStack instance.

- Opens at http://localhost:4173 (Vite preview default).

**Required environment variable** (set in the Vercel project's *Environment Variables* panel):

| Variable | Example | Description |
| --- | --- | --- |
| `VITE_SERVER_URL` | `https://demo.objectstack.ai` | Absolute URL of the ObjectStack backend. When unset, requests default to the same origin — which will 404 on a static SPA host. |

Additional backend requirements for cross-origin deployments:

1. The backend must allow CORS from the SPA origin (`Access-Control-Allow-Origin: <spa-origin>`, `Access-Control-Allow-Credentials: true`).
2. Auth cookies must use `SameSite=None; Secure` so they are sent on cross-site requests.
3. The apps and objects referenced in URLs (e.g. `crm_enterprise`, `lead`) must actually exist in the backend metadata — otherwise the console will render its *object not found* empty state.

## ObjectStack Spec Compliance

### AppSchema Support
- ✅ `name`, `label`, `icon` — Basic app metadata
- ✅ `description`, `version` — Optional app information
- ✅ `requiredPermissions` — Permission-based access control
- ✅ `branding.logo`, `branding.primaryColor`, `branding.favicon` — App branding

### Navigation Support
- ✅ `object` — Navigate to object list views
- ✅ `dashboard` — Navigate to dashboards
- ✅ `page` — Navigate to custom pages
- ✅ `report` — Navigate to reports
- ✅ `url` — External URL navigation with target support
- ✅ `group` — Nested navigation groups with collapse
- ✅ `visible` / `visibleOn` — Expression-based visibility conditions

### Object Operations
- ✅ Multi-view switching (grid, kanban, calendar, timeline, chart, map, gantt, gallery)
- ✅ Create / Read / Update / Delete via ObjectForm
- ✅ Search, filter, sort across all view types
- ✅ Record detail page and drawer preview
- ✅ Metadata inspector for developers

## Architecture

The console is a thin orchestration layer on top of the ObjectUI plugin system:

```
Console App
├── @object-ui/react          — SchemaRenderer (JSON → Component)
├── @object-ui/components     — Shadcn UI primitives
├── @object-ui/layout         — AppShell, Sidebar
├── @object-ui/core           — ExpressionEvaluator, ActionRunner
├── @object-ui/data-objectstack — API adapter (auto-reconnect, caching)
├── @object-ui/plugin-view    — ObjectView (multi-view container)
├── @object-ui/plugin-form    — ObjectForm (CRUD forms)
├── @object-ui/plugin-grid    — DataGrid (Shadcn-native, virtualized)
├── @object-ui/plugin-kanban  — Kanban board
├── @object-ui/plugin-calendar— Calendar view
├── @object-ui/plugin-dashboard — Dashboard renderer
├── @object-ui/plugin-report  — Report viewer/builder
└── 8 more view plugins...
```

## Documentation

| Document | Description |
|----------|-------------|
| [Roadmap](../../ROADMAP.md) | Repo-wide development plan — the Console phases and their status live here |
| [Getting Started Guide](../../content/docs/guide/console.md) | User-facing documentation |
| [Architecture Guide](../../content/docs/guide/console-architecture.md) | Technical deep-dive |
| [UI Improvement Proposal](./docs/UI_IMPROVEMENT_PROPOSAL.md) | Modern UI design improvements for metadata inspector |

## License

MIT
