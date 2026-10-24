---
title: Console Architecture
description: Internal architecture of the ObjectStack Console — data flow, routing, and how JSON metadata becomes a working UI.
---

# Console Architecture

This document describes the internal architecture of the Console SPA.

`apps/console` is a thin host: it owns the Vite build, the outermost route tree, and plugin
registration. Almost everything named below is a **component exported by a package**, not a file
under `apps/console` — the shell (providers, layout, object and record views) ships from
`@object-ui/app-shell`, view rendering from `@object-ui/plugin-view`, and the app wizard from
`@object-ui/plugin-designer`. Packages are named where it matters; import from the package, never
from a path.

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│  ObjectStack server  (owns apps, objects, views)        │
│  • metadata is authored and stored server-side          │
│  • the console reads it over HTTP — it has no local     │
│    metadata file of its own                             │
└────────────────────┬────────────────────────────────────┘
                     │ HTTP  (base URL from VITE_SERVER_URL)
                     ▼
┌─────────────────────────────────────────────────────────┐
│  ObjectStackAdapter  (@object-ui/data-objectstack)      │
│  • discovery() → apps[], objects[]                      │
│  • find / findOne / create / update / delete            │
│  • getView / getApp (optional metadata cache)           │
└────────────────────┬────────────────────────────────────┘
                     │ DataSource interface
                     ▼
┌─────────────────────────────────────────────────────────┐
│  SchemaRendererProvider  (@object-ui/react)             │
│  • provides dataSource + registry to all children       │
└────────────────────┬────────────────────────────────────┘
                     │ React Context
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Console shell  (@object-ui/app-shell)                  │
│  ├── ExpressionProvider  (user, app, evaluator)         │
│  ├── ConsoleLayout                                      │
│  │   ├── AppShell (@object-ui/layout)                   │
│  │   │   └── useAppShellBranding (CSS vars)             │
│  │   ├── sidebar nav (app switcher + nav tree)          │
│  │   └── AppHeader (breadcrumbs, status)                │
│  └── Routes (mounted by apps/console at /apps/:appName) │
│      ├── /apps/:appName/:objectName  → ObjectView       │
│      ├── /apps/:appName/:objectName/record/:id → Detail │
│      └── /apps/:appName  → Home Page                    │
└─────────────────────────────────────────────────────────┘
```

### What the console boots from

The console has **no metadata file of its own** — nothing in `apps/console` declares apps,
objects or views. Everything above the adapter is fetched. Its entire local configuration is
one build-time Vite variable:

- **`VITE_SERVER_URL`** — the only setting that picks a backend. It seeds both the adapter's
  `baseUrl` and the runtime-config fetch. Empty means same origin, which is what a server that
  serves the console itself wants.
- **Server-pushed runtime config** — before React mounts, the entry point resolves
  `/api/v1/runtime/config` (branding, feature flags, cloud URL) through `@object-ui/app-shell`,
  so first paint already shows operator branding instead of the static defaults.
- **Discovery + metadata** — `AdapterProvider` (`@object-ui/app-shell`) constructs the
  `ObjectStackAdapter`, `connect()`s it (one `/api/v1/discovery` probe, cached per base URL),
  and the metadata provider pulls apps, objects and views from the server's metadata API on
  demand.

Apps and objects **are** authored declaratively — but in the ObjectStack **server** project
(`objectstack.config.ts` there, or through Studio), not in this repo. The console is a pure
consumer of whatever that server publishes; see
[ObjectOS Integration](/docs/guide/objectos-integration) for the server-side shape.

## Routing

Routing is React Router DOM v7. `apps/console` mounts the per-app subtree at
`/apps/:appName/*`; the routes below are declared inside it by the console shell
(`@object-ui/app-shell`). Every component in the table is exported by `@object-ui/app-shell`,
except `CreateAppPage` / `EditAppPage`, which are lazy-loaded from `@object-ui/plugin-designer`.

**The table below is a curated subset, not an inventory.** It covers the object-facing routes
— the ones you need to understand how metadata becomes a page. The real tree is several times
larger and is declared in exactly two places, which are the source of truth when you need the
full list:

- the **console's own route tree** (`apps/console`) — the unauthenticated auth surfaces
  (login, register, password reset, verify-email, setup, OAuth consent, invitations), plus
  home, Studio, AI, organizations, docs and the shared/public record pages;
- the **shell's app-content route tree** (`@object-ui/app-shell`) — everything under
  `/apps/:appName/*`: record create and edit, dashboards, pages, reports, search, the
  marketplace, and the whole metadata-admin subtree.

Read those two route trees in the source rather than trusting a hand-copied table to stay
current.

The Setup catalog for positions and permission sets is not a separate route family. It is
the metadata-admin list and editor with the query parameter `scope=environment`, for
example `/apps/setup/metadata/permission?scope=environment`. That scope lists every item
the registry serves for the type and adds the Setup half of an item, which is who holds
it. The console's legacy `system/roles`, `system/positions` and `system/permissions`
URLs forward there. The same scope lists the sharing rules installed packages declare,
`/apps/setup/metadata/sharing_rule?scope=environment`, read-only with Disable / Enable
and Clone; the rules an organization authors stay on the `sys_sharing_rule` object page.
The `@object-ui/app-shell` README describes the scope under "The Setup catalog".

| Route Pattern | Component | Purpose |
|---------------|-----------|---------|
| `/apps/:appName` | Home redirect | Redirects to the first object in navigation |
| `/apps/:appName/:objectName` | `ObjectView` | Object list with view switcher |
| `/apps/:appName/:objectName/view/:viewId` | `ObjectView` | Specific view for an object |
| `/apps/:appName/:objectName/data` | `ObjectDataPage` | Bare data surface — URL `filter[<field>]=<value>` conditions, not bound to any saved view (ADR-0055) |
| `/apps/:appName/:objectName/record/:recordId` | `RecordDetailView` | Single-record detail |
| `/apps/:appName/:objectName/record/:recordId/page/:pageName` | `RecordDetailView` | The same record on the NAMED record page `:pageName`; a name that is not a record page of the object shows "Page not found" |
| `/apps/:appName/create-app` | `CreateAppPage` | App creation wizard (4-step) |
| `/apps/:appName/edit-app/:editAppName` | `EditAppPage` | Edit existing app configuration |

## Key Patterns

### 1. Expression-Based Visibility

Navigation items can be conditionally hidden using expressions:

```json
{
  "type": "object",
  "objectName": "admin_settings",
  "visible": "${user.role === 'admin'}"
}
```

`ExpressionProvider` (`@object-ui/app-shell`) wraps the layout and provides an `ExpressionEvaluator` that resolves `${}` templates against context variables (`current_user` and its `user` / `ctx.user` / `os.user` aliases, `data`, `features`). It publishes `app` on the React context value for components to read, but does **not** bind it as an expression root — objectui#8155 removed that binding, because the engine's `SCOPE_ROOTS` has no `app`.

### 2. Action System

Actions are typed with `ActionDef` from `@object-ui/core`:

```ts
import { useActionRunner } from '@object-ui/react';

const { execute } = useActionRunner({
  context: { objectName: 'contacts' },
});

await execute({
  type: 'delete',
  confirmText: 'Are you sure?',
  params: { recordId: '123' },
});
```

The `ActionRunner` supports:
- **Confirmation** — async `ConfirmationHandler` (default: `window.confirm`, override with Shadcn AlertDialog). A caller that asks the handler directly may pass `options`: `title`, `confirmText` and `cancelText` replace the dialog's generic copy, and `destructive: true` paints the confirm button in the destructive style. The console's record delete asks this way: `recordDelete.confirmCopy` (`@object-ui/core`) builds a title naming the record (or counting a selection) and a "Delete" confirm label, and both the list and the record page show that copy.
- **Toast notifications** — `ToastHandler` for success/error messages
- **Custom handlers** — register domain-specific action types (e.g., `'create'`, `'delete'`, `'refresh'`)

### 3. Plugin ObjectView Delegation

The shell's `ObjectView` — the one exported by `@object-ui/app-shell` and bound to the routes
above — is a **thin wrapper** around `@object-ui/plugin-view`'s `ObjectView`:

- Resolves views from the object definition's `listViews`
- Passes a `renderListView` callback for multi-view rendering (kanban, calendar, chart)
- Handles shell-level concerns: URL routing, MetadataInspector, record detail overlay

### 4. App Creation & Editing

App creation and editing are owned end to end by `@object-ui/plugin-designer`: it exports both
route pages and the `AppCreationWizard` they render. The console shell only lazy-loads them onto
routes.

- **Create App** — `CreateAppPage` at `/apps/:appName/create-app`. Passes metadata objects as `availableObjects`, handles `onComplete` (converts draft via `wizardDraftToAppSchema()`, navigates to new app), `onCancel` (navigate back), and `onSaveDraft` (localStorage persistence).
- **Edit App** — `EditAppPage` at `/apps/:appName/edit-app/:editAppName`. Loads existing app config as `initialDraft` and updates on completion.

**How users get there.** Manual app creation is **deprecated in favour of the AI-first
builder**, and the menu entries that used to launch it are gone. Today:

- **Build with AI** — the primary path. The console home (`/home`) offers it whenever the
  server reports a deployed build agent, and it opens the AI build surface rather than the
  4-step wizard.
- **Studio** — the authoring surface for a package and the apps inside it (`/studio`, and the
  design surface per package). This is where app structure is edited by hand now.
- **The wizard routes themselves** — `create-app` / `edit-app/:editAppName` stay mounted and
  reachable as direct (legacy) deep links, which is why the pages above still ship.

Do not re-document the old sidebar / command-palette entries: the "Add App" and "Edit App"
items lived only in `AppSidebar`, which the console had already stopped mounting
(`ConsoleLayout` renders `UnifiedSidebar`) and which `@object-ui/app-shell` no longer exports
(objectui#5817); the command palette never registered a create-app command. The console's
sidebar is `UnifiedSidebar`.

### 5. Branding

Per-app branding is applied via `AppShell`'s `branding` prop:

<!-- doc-snippet: fragment — a bare JSX opening tag: the section is about the shape of the branding prop, and the element is never closed -->
```tsx
<AppShell branding={{
  primaryColor: '#3B82F6',
  accentColor: '#10B981',
  favicon: '/custom-favicon.ico',
  title: 'CRM — ObjectStack Console',
}}>
```

This writes CSS custom properties on the document root (`html`), and re-applies them whenever
the `.dark` class on that element changes, so the brand stays readable across the theme toggle.

**Branding acts through the Shadcn theme tokens.** `primaryColor` sets `--primary`,
`--primary-foreground`, `--ring`, `--sidebar-primary` and `--sidebar-ring`; `accentColor` sets
`--accent` and `--accent-foreground`. They reach rendered output through the Tailwind 4 `@theme`
block in `packages/components/src/index.css`, which maps each one to a colour token
(`--color-primary: hsl(var(--primary))`, `--color-accent: hsl(var(--accent))`, and so on) — and
that is what generates the `bg-primary`, `text-primary-foreground`, `bg-accent` and `ring-ring`
utilities the components already use. Overriding the token is therefore the whole mechanism:
every existing consumer picks up the brand colour without a single component change.

`AppShell` also writes `--brand-primary`, `--brand-primary-hsl`, `--brand-accent` and
`--brand-accent-hsl`. These are **backward-compatibility aliases, not the branding surface** —
no utility is wired to them, and nothing in this repository reads them. They are not
interchangeable with the tokens above either: `--brand-*` carries the authored hex and its
light-mode HSL triple and does not follow the light/dark toggle, whereas `--primary` /
`--accent` carry the mode-adjusted value. Theme against the Shadcn tokens; treat the
`--brand-*` names as an alias kept for whatever already consumes it.

**The app's logo is not part of that object.** `AppShellBranding` carries theme values and the
tab title only. An app's `branding.logo` (an image URL — the one logo spelling the app schema
declares — for the app's square icon) is drawn in the top bar: the app pill (`AppSwitcher`) shows
it left of the app's name, and each row of the pill's dropdown shows its own app's logo. An app
without a `branding.logo` gets its `icon` on a tile instead, coloured by its own
`branding.primaryColor` when that is a hex. The sidebar draws no logo. On a phone, where the top
bar hides the pill, the sidebar drawer's header shows the app's glyph and name.

### 6. Unsaved Edits

A page that holds unsaved edits in component state (a settings page, the
metadata editor) registers them with the shell through
`useRegisterUnsavedEdits(dirty, message)` from `@object-ui/app-shell`. While
anything is registered, a tab close or reload raises the browser's leave prompt,
and an in-app link to another page asks `message` first. The shell's own
departures that start from a button (the header's help, avatar and app menus,
the go-home shortcut, the workspace switcher, a sidebar entry's Design, the
command palette, the inbox popover and the AI entry) go through `confirmUnsavedLeave(go)`, which asks the same question before it runs
`go`. An organization switch asks before it is sent, so Cancel keeps the
organization as well as the edits. The prompt is the browser's `confirm`.

Not guarded: browser Back and Forward, which `BrowserRouter` gives a page no
way to hold, and any departure a component starts with `navigate()` without
going through `confirmUnsavedLeave`. The
`@object-ui/app-shell` README describes the two exports under "Unsaved edits".

## Development Mode

There is **no bundled mock backend** — offline development is not a thing here. In dev exactly as
in production, `ObjectStackAdapter` talks over HTTP to a live ObjectStack server at
`VITE_SERVER_URL`, and everything above the adapter in the data flow depends on that call
succeeding: no server, no discovery, no apps in the sidebar.

See [Console App → Quick Start](/docs/guide/console#quick-start) for the dev server port, the
default `VITE_SERVER_URL`, and how to point the console at a different backend.
