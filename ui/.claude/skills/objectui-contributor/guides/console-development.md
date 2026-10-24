# ObjectUI Console Development

Working on the Console application (`apps/console/`), this repo's reference admin interface. The Console demonstrates schema-driven patterns at scale and serves as the blueprint for enterprise admin interfaces.

> **`apps/console` is a reference assembly, not the engine.** The shell, the layouts,
> the home pages, the navigation and the whole metadata admin live in
> `@object-ui/app-shell`, the designer pages live in `@object-ui/plugin-designer`, and
> `apps/console` is a thin host that mostly declares routes.
>
> **Don't credit that move to one commit.** Earlier revisions of this note attributed
> all of it to `cccdf84d7` ("Slim apps/console for third-party customisation",
> 2026-04-22); following that pointer lands you in a diff that never touches the
> symbols you are looking for. The `app-shell` extraction is a chain of commits
> spanning 2026-04-21 → 04-23, and `cccdf84d7` is **one step** in it — the step that
> removed the designer pages and `pages/system/`, not the shell/navigation move:
>
> - **Providers** (`AdapterProvider`, `MetadataProvider`, `ExpressionProvider`) —
>   `app-shell` copies added in `c1e105793` (04-21, "extract core providers and hooks
>   to @object-ui/app-shell"), `apps/console` copies deleted in `28ffe4033` (04-22,
>   "Refactor context providers to use @object-ui/app-shell"). Both **before**
>   `cccdf84d7`.
> - **Navigation, layout, home pages and the hooks** (`NavigationContext`,
>   `FavoritesProvider`, `UnifiedSidebar`, `ConsoleLayout`, `console/home/*`,
>   `useFavorites`, `useMetadataService`, `useNavPins`, `useNavigationSync`,
>   `useObjectActions`, `useRecentItems`, `useResponsiveSidebar`) — `apps/console`
>   copies deleted in `b279d80d6` (04-23), which is titled "feat: Add ReportView and
>   SearchResultsPage components" and names none of it. **After** `cccdf84d7`. (Most
>   `app-shell` copies land in that same commit; `useObjectActions` and
>   `useRecentItems` arrived earlier, in `c1e105793`.)
>
> Check the symbol you actually care about instead of trusting any single-commit
> attribution for this refactor:
> `git log --diff-filter=A --format='%h %ad %s' --date=short -- packages/app-shell/...`
>
> Two consequences for anyone reading this guide:
>
> - **Look in `packages/app-shell` first.** Most symbols you want to change are
>   there, not under `apps/console/src/`. Grep before you assume a path.
> - **Third parties fork the template, not this app** — `examples/console-starter`
>   wires `ConsoleShell` + host routes in ~100 LOC. Adding a surface to
>   `apps/console` only benefits this repo's own deployment; adding it to
>   `app-shell` (or to an app's `navigation[]` metadata) benefits every host.

## Console architecture overview

### App entry and provider stack

Most of the orchestration now lives in `@object-ui/app-shell`. `apps/console/src/App.tsx` is a thin assembly:

```
[Wrapper = ConditionalAuthWrapper | BypassWrapper]   ← from @object-ui/auth + app-shell
  └── PreviewBanner
      └── BrowserRouter
          └── ConsoleShell                            ← app-shell
              ├── ConsoleToaster
              └── Routes
                  ├── /login | /register | /forgot-password  → Default*Page (app-shell)
                  ├── /home                                  → DefaultHomeLayout + DefaultHomePage
                  ├── /organizations[/...]                   → DefaultOrganizations* + DefaultOrganization*
                  ├── /accept-invitation/:id                 → DefaultAcceptInvitationPage
                  ├── /create-app                            → plugin-designer.CreateAppPage (lazy)
                  ├── /apps/:appName/*                       → AppContent (per-app router)
                  └── /                                      → ProtectedRoute + RootLandingRedirect
```

Key building blocks imported from `@object-ui/app-shell`:
`ConsoleShell`, `ConnectedShell`, `AuthenticatedRoute`, `SystemRedirect`,
`LoadingFallback`, `ConsoleToaster`, `ConditionalAuthWrapper`, plus the `Default*Page` /
`Default*Layout` defaults for login, register, home, organizations, members, invitations,
settings and invitation acceptance.

Auth is provided by `@object-ui/auth` (`AuthProvider`, `PreviewBanner`). Provider stacks for
data sources, metadata, theme, expression and adapter are wired inside `ConsoleShell` /
`ConnectedShell` rather than at the app root — extenders rarely need to compose them by hand.

To customise the console, edit `apps/console/src/App.tsx` directly — there is no central
config object. To extend without forking, reuse the same `app-shell` exports in your own
host app (see `guides/project-setup.md` → "Runtime & integration packages").

### Page structure

```
apps/console/src/pages/
├── auth/                        # Login, register, reset/set password, verify email,
│                                #   OAuth consent, device auth, accept invitation
├── developer/                   # DeveloperHubPage, ApiConsolePage, FlowRunsPage,
│                                #   PublicFormsPage, IntegrationsPage
├── settings/                    # SettingsHub + SettingsView (`system/settings/:namespace`)
├── system/                      # Admin panel — exactly six pages
│   ├── SystemHubPage.tsx        # Card-based admin hub (@deprecated — see below)
│   ├── AppManagementPage.tsx    # App CRUD
│   ├── ProfilePage.tsx          # Signed-in user's own profile
│   ├── AuditLogPage.tsx         # Read-only audit trail (hand-written REST fetch,
│   │                            #   deliberately not an ObjectView)
│   ├── ApprovalsInboxPage.tsx   # Approvals awaiting the current user
│   └── AiPendingActionsPage.tsx # AI-proposed actions awaiting confirmation
├── DocsLayout.tsx / AppDocsIndex.tsx / DocsSlug.tsx / DocPage.tsx / BookPage.tsx
│                                # ADR-0048 / ADR-0046 §6 — package docs reader
└── SharedRecordPage.tsx         # Public share-link landing
```

Where the rest went (spread across the 2026-04-21 → 04-23 `app-shell` extraction chain,
**not** `cccdf84d7` alone — see the commit-attribution note at the top of this guide):

| Looking for | Today's home |
|---|---|
| `home/` (`HomeLayout`, `HomePage`, `QuickActions`, `RecentApps`, `AppCard`) | `packages/app-shell/src/console/home/` |
| `CreateAppPage`, `EditAppPage`, `DashboardDesignPage` | `packages/plugin-designer/src/pages/` |
| `UnifiedSidebar`, `ConsoleLayout` | `packages/app-shell/src/layout/` |
| The registry-driven metadata pages | `packages/app-shell/src/views/metadata-admin/` (see next section) |

### Retired names — do not import these

Earlier versions of this guide taught seven `pages/system/` files. Five of them are
gone; searching for them wastes a lap, and writing code against them does not
compile. Each is listed here **once**, with what replaced it — together with the
console symbols retired since:

| Retired symbol | Verdict |
|---|---|
| `MetadataManagerPage` | **Deleted.** Registry-driven list is now `MetadataResourceListPage` in `packages/app-shell/src/views/metadata-admin/ResourceListPage.tsx`. |
| `MetadataDetailPage` | **Deleted.** Registry-driven editor is now `MetadataResourceEditPage` in `.../ResourceEditPage.tsx`. |
| `UserManagementPage` | **Deleted** (`cccdf84d7`, whose message records where these objects went: "contributed by framework plugins (plugin-auth, -security, -audit) into the Setup app navigation"). The URL is now a redirect to `sys_user` — see "Routing patterns". |
| `RoleManagementPage` | **Deleted** (`cccdf84d7`). ADR-0090 D3 renamed `sys_role` to `sys_position`; the URL redirects there. |
| `PermissionManagementPage` | **Deleted** (`cccdf84d7`, 26 lines). Permissions are edited through `PermissionMatrixEditor`, registered as the `permission` type's `EditPage`. |
| `config/metadataTypeRegistry.ts` | **Deleted** (`ff9a0d9e9`, "remove studio app and migrate to metadata-admin engine"; added in `d601ef693`). It did exist, at exactly that path under `apps/console/src/` — 195 lines when it landed, 317 when it went, and `git show ff9a0d9e9^:apps/console/src/config/metadataTypeRegistry.ts` still reads it. Worth knowing before deciding that a `ROADMAP.md` line naming it was invented rather than stale. The real registry is `packages/app-shell/src/views/metadata-admin/registry.ts`. |
| `MetadataTypeConfig`, `registerMetadataType`, `getMetadataTypeConfig`, `pageSchemaFactory`, `listComponent`, `MetadataListComponentProps` | **No such API anywhere in the repo** (zero hits). The live equivalents are `MetadataResourceConfig`, `registerMetadataResource()`, `getMetadataResource()`, and the `ListPage` / `EditPage` / `CreatePage` component overrides. |
| `buildObjectDetailPageSchema`, `schemas/objectDetailPageSchema.ts` | **Deleted** (objectui#3731 / #3736). Zero callers for months — its only consumer was `MetadataDetailPage`, retired above. The `object` type is edited by the metadata-admin engine's generic shell; see "Schema-driven detail pages". |
| `ObjectDetailTabsWidget`, `ObjectPropertiesWidget`, `ObjectFieldDesignerWidget`, `ObjectRelationshipsWidget`, `ObjectKeysWidget`, `ObjectDataExperienceWidget`, `ObjectDataPreviewWidget` | **Deleted** (objectui#3731 / #3736) with `registerObjectDetailWidgets.ts` and its `main.tsx` import. The seven widget types they registered — `object-detail-tabs`, `object-properties`, `object-field-designer`, `object-relationships`, `object-keys`, `object-data-experience`, `object-data-preview` — no longer resolve in `ComponentRegistry`. |

## Metadata resource registry (metadata-admin engine)

The registry lives in `@object-ui/app-shell`, not in the console:
`packages/app-shell/src/views/metadata-admin/registry.ts`.

The important inversion versus the old page-per-type design: the engine drives **all**
metadata types from one `ListPage` / `EditPage` / `HistoryPage` shell, and the default
form is generated from the JSONSchema the framework serves on `/api/v1/meta/types`. A
type does not need a registry entry at all to be listable and editable. Registering one
only **overrides** defaults.

The contract for "add a new metadata type" is therefore mostly *not* a UI change:

1. Define its Zod schema in the framework's `packages/spec/src/<domain>/`.
2. Add it to the framework's `DEFAULT_METADATA_TYPE_REGISTRY`.
3. Done — it appears in the Setup app's Metadata Directory with working
   list / create / edit / history.

### MetadataResourceConfig — the override surface

Every field except `type` is optional. The fence below is a deliberately
SIMPLIFIED teaching copy of the published `MetadataResourceConfig`
(`import type { MetadataResourceConfig } from '@object-ui/app-shell';`), KEPT
rather than replaced by an import: it shows the 22 fields you reach for most out
of the **28** the interface declares, and the excerpt is what makes the section
usable. Nothing checks the copy against the real type — `registry.ts` documents
all 28 field by field, and the six not shown here are `hiddenFields`,
`fieldOrder`, `createSeed`, `createSchema`, `createHint` and `emptyStateHint`.

```typescript
interface MetadataResourceConfig {
  type: string;                       // 'view', 'flow', 'permission', …
  label?: string;                     // falls back to the server label, then to `type`
  description?: string;               // shown in the page hero
  iconName?: string;                  // Lucide icon name
  domain?: MetadataDomain;            // 'data' | 'ui' | 'automation' | 'security' | …
  primaryKey?: string;                // default 'name'
  identityField?: string;             // URL slug + body key; default 'name'
  searchableFields?: string[];        // default ['name','label','description']
  listColumns?: Array<{ key: string; label: string; width?: string;
                        render?: (value: unknown, item: Record<string, unknown>) => ReactNode }>;
  listFilter?: (item: Record<string, unknown>) => boolean;  // false hides the row
  ListPage?: ComponentType<{ type: string }>;                 // bypass the generic list
  EditPage?: ComponentType<{ type: string; name: string }>;    // bypass the generic editor
  CreatePage?: ComponentType<{ type: string }>;                // bypass the generic create
  createFields?: string[];            // which fields the create form asks for
  createDerive?: CreateDeriveRule[];  // e.g. label -> name via 'slugify'
  createDefaults?: Record<string, unknown>;   // shallow-merged into the PUT body
  createBuildBody?: (draft: Record<string, unknown>) => Record<string, unknown>;
  toDraft?: (item: Record<string, unknown>) => Record<string, unknown>;   // wire -> editor
  fromDraft?: (draft: Record<string, unknown>) => Record<string, unknown>; // editor -> wire
  defaultSchema?: Record<string, unknown>;    // used only when the server serves none
  supportsHistory?: boolean;          // default true
  anchors?: MetadataAnchor[];         // powers the parent's Related tab
}
```

Registration is idempotent and **merging**: calling `registerMetadataResource()` twice for
the same `type` merges the new fields over the old, so a bespoke editor and the
generic-engine defaults can be registered independently.

### How MetadataResourceListPage works

`packages/app-shell/src/views/metadata-admin/ResourceListPage.tsx`:

1. Resolves `type` from the `type` prop, else from the `:type` route param.
2. `getMetadataResource(type)` — if the entry has a `ListPage`, renders it and returns
   (done before any other hook, so the hook count stays stable across type switches).
3. Otherwise `resolveResourceConfig(type, serverEntry)` merges the registry entry with the
   `/meta/types` row (server `label` / `description` / `domain` fill the gaps).
4. Fetches `/meta/:type`, then filters by search (`searchableFields`), source/overlay, and
   package scope — plus `listFilter` if the type declares one.
5. Renders `listColumns`, falling back to columns inferred from `primaryKey`. Each row
   links to its editor at `./:name?type=…`.

### How MetadataResourceEditPage works

`.../ResourceEditPage.tsx`, one component for both edit and create (`createMode`):

1. A registered `EditPage` (edit mode) or `CreatePage` (create mode) short-circuits
   everything below — that is how `PermissionMatrixEditor` replaces the form for
   `type: 'permission'`.
2. Otherwise it picks a schema: `createSchema` in create mode, else the `/meta/types`
   row's `schema`, else the registry's `defaultSchema`.
3. Fetches the layered view (`GET /meta/:type/:name/layers`, via `client.layered()`) so
   code / overlay / effective are all visible, and renders `SchemaForm` against that
   schema. That projection has a path and a response schema of its own
   (`GetMetaItemLayeredResponseSchema`); the older spelling that flagged the ordinary
   item read is deprecated upstream — don't reintroduce it.
4. Save → PUT. A `409 destructive_change` opens a confirmation dialog and retries with
   `?force=true`. Reset overlay → DELETE. The References tab calls `client.references()`
   so an admin sees the back-pointers before deleting.

### Adding a registry override

```typescript
// packages/app-shell/src/services/builtinComponents.tsx
registerMetadataResource({
  type: 'permission',
  label: 'Permission sets',
  description: 'Object-level CRUD + VAMA + lifecycle permissions, and field-level R/W.',
  domain: 'security',
  EditPage: PermissionMatrixEditPage,   // bespoke grid replaces the generic AutoForm
  searchableFields: ['name', 'label'],
  listColumns: [
    { key: 'name', label: 'Name', width: '30%' },
    { key: 'label', label: 'Label', width: '30%' },
    { key: 'managedBy', label: 'Source', width: '15%',
      render: (v) => (v === 'package' ? 'Package' : 'Custom') },
  ],
});
```

## Schema-driven detail pages (PageSchema)

The mechanics are live and unchanged: `ComponentRegistry.register()` binds a widget type
to a React component, `SchemaRenderer` (from `@object-ui/react`) resolves a `PageSchema`
node by looking that type up, and `registerMetadataResource({ type, EditPage })` is how a
bespoke editor replaces the engine's generated form.

> **There is no in-repo schema-factory specimen today, and that is deliberate.** This
> section used to be anchored on a bespoke object-detail factory in the console —
> `buildObjectDetailPageSchema()` plus seven registered `object-*` widgets. It was
> retired (objectui#3731 / #3736) after the zero-caller fact was measured three times
> over: its only consumer was the registry-driven detail page listed under "Retired
> names" above, and the factory outlived it as unreachable code — carrying 60 lines of
> non-English UI copy that no i18n gate could see, because bare literals have no keys.
> Read that as the running cost of the pattern, not as an invitation to rebuild it.

The live bespoke editor to copy from is `PermissionMatrixEditPage`
(`packages/app-shell/src/views/metadata-admin/PermissionMatrixEditor.tsx`), registered as
the `permission` type's `EditPage` in
`packages/app-shell/src/services/builtinComponents.tsx`. Note what it is *not*: there is
no declarative "give me a schema factory" hook: the registry takes a React component, so
any factory call happens inside that component.

Before writing one, read "Adding a new admin surface" below — a registry override, a nav
item, or nothing at all is the answer more often than a bespoke page is.

## Navigation system

### UnifiedSidebar

`packages/app-shell/src/layout/UnifiedSidebar.tsx` (same directory as `ConsoleLayout.tsx`)
— Airtable-style contextual sidebar:

- **Persistent** across all routes (embedded in AppShell)
- **Context-aware**: shows different items based on `NavigationContext` (`'home'` vs `'app'`)
- **Features**: App switcher, drag-to-reorder, favorites, search/filter, pinned bottom section

### NavigationContext

`packages/app-shell/src/context/NavigationContext.tsx`:

```typescript
type NavigationContextType = 'home' | 'app';
```

⚠️ Unlike every other type quoted in this guide, `NavigationContextType` is
INTERNAL: `@object-ui/app-shell` exports only `.` (→ `dist/index.d.ts`) and
`./styles.css`, and its entry re-exports `useNavigationContext` but not this
type. So there is no import a consumer can write for it — a contributor reaches
it through the source path above, and the fence is a quotation of that file
rather than a copy standing in for a published name.

- `HomeLayout` sets context to `'home'` → sidebar shows workspace nav
- `ConsoleLayout` sets context to `'app'` → sidebar shows app-specific nav

### ConsoleLayout vs HomeLayout

Both use `AppShell` + `UnifiedSidebar`. The difference is the navigation context:

```typescript
// ConsoleLayout (for app pages)
function ConsoleLayout({ activeAppName, children }) {
  const { setContext } = useNavigation();
  useEffect(() => setContext('app'), []);
  // ...
}

// HomeLayout (for home/workspace pages)
function HomeLayout({ children }) {
  const { setContext } = useNavigation();
  useEffect(() => setContext('home'), []);
  // ...
}
```

### Routing patterns

Routes are split across two files, and that split is the thing to get right:

- **`apps/console/src/App.tsx`** — the outer skeleton only (auth pages, `/home`,
  `/organizations`, `/create-app`, `/apps/:appName/*`).
- **`packages/app-shell/src/console/AppContent.tsx`** (`DefaultAppContent`) — everything
  *inside* one app, including the metadata-admin engine's own routes. It declares two
  route tables: one for when an app is active, one for the zero-app case
  (`extraRoutesNoApp`).
- **`apps/console/src/AppContent.tsx`** — a thin wrapper that passes a
  `systemRoutes` JSX fragment into `DefaultAppContent`. Console-specific pages and
  legacy-URL redirects live in that fragment; it is exported so tests mount the real
  fragment instead of a hand-copied transcription.

The engine's canonical metadata routes (declared by `DefaultAppContent`, relative to
`/apps/:appName`):

```
metadata                            -> MetadataDirectoryPage
metadata/_diagnostics               -> MetadataDiagnosticsPage
metadata/:type                      -> MetadataResourceListPage
metadata/:type/new                  -> MetadataResourceEditPage (createMode)
metadata/:type/:name                -> MetadataResourceEditPage
metadata/:type/:name/history        -> MetadataResourceHistoryPage
```

The console's own fragment (`apps/console/src/AppContent.tsx`, abbreviated — read the file
for the full list and its rationale comments):

```
system                              -> SystemHubPage
system/apps | profile | approvals | ai-approvals | audit-log | settings[/:namespace]
developer[/api-console | flow-runs | public-forms | integrations]
docs[/:slug[/:name]]

# Legacy URLs -> the metadata-admin engine (translate the URL, don't revive the page)
system/objects[/:objectName]        -> ObjectRedirect      -> …/metadata/object[/:name]
system/metadata[/:type[/:itemName]] -> MetadataRedirect    -> …/metadata[/:type[/:name]]

# Legacy URLs -> framework-owned system objects (objectui#3655)
system/users                        -> SystemObjectRedirect -> …/sys_user
system/organizations                -> SystemObjectRedirect -> …/sys_organization
system/roles                        -> SystemObjectRedirect -> …/sys_position
system/positions                    -> SystemObjectRedirect -> …/sys_position
system/permissions                  -> SystemObjectRedirect -> …/sys_permission_set
```

All five legs resolve on `origin/main`. `system/permissions` was the last one declared, and
its history is worth knowing before you touch it: the framework splits what this console
called "Permissions" into `sys_capability` (ADR-0066 layer 1, the definition registry of
"what can be done") and `sys_permission_set` (layer 2, the grant container), so PR #3673
declined to guess and pinned the then-unchanged landing in a test instead. The maintainer
ruled **A — `sys_permission_set`** on objectui#3655 and PR #3728 declared the route. The
target is layer 2 because the hub card that emits the URL promises "permission rules and
assignments", and a definition catalog is what a set references by name, not what you
assign. The route block in `apps/console/src/AppContent.tsx` carries that reasoning in full
(including one reading of the two objects that does *not* survive a re-read of the
framework) — read it there rather than re-deriving it, and re-read this list against the
file if you are about to add a sixth leg.

Two traps worth internalising, both paid for in objectui#3639 / #3655:

- The `component/metadata/resource/:name?type=…` spelling is a **legacy alias** whose
  element is `LegacyMetadataRedirect` — a second `<Navigate>` onto the `metadata/:type…`
  routes above. Never emit it from new code; it buys a redundant hop. It stays declared
  only because bookmarks land on it.
- An unmatched URL under `/apps/:appName/*` falls to app-shell's
  `:objectName/:maybeRecordId` tail, where `looksLikeRecordId` treats any 6+ character
  segment as a record id. A missing route therefore fails in two different ways depending
  on word length: short words reach `RouteNotFound`, long ones render `RecordDetailView`
  for a nonexistent object. If you add a nav target, declare its route in the same change.

## Key contexts

All five live in `@object-ui/app-shell`; there is no `apps/console/src/context/` directory
at all. app-shell keeps **two** sibling directories, `context/` and `providers/`, and these
five are split across both — so the prefix differs per row. Check the row; do not shift one
prefix across the table.

| Context | Location | Purpose |
|---------|----------|---------|
| `AdapterProvider` | `packages/app-shell/src/providers/AdapterProvider.tsx` | ObjectStackAdapter lifecycle, connection management |
| `MetadataProvider` | `packages/app-shell/src/providers/MetadataProvider.tsx` | Apps, objects, dashboards, reports from API |
| `NavigationContext` | `packages/app-shell/src/context/NavigationContext.tsx` | Home vs App sidebar context |
| `FavoritesProvider` | `packages/app-shell/src/context/FavoritesProvider.tsx` | User's starred/pinned items |
| `ExpressionProvider` | `packages/app-shell/src/providers/ExpressionProvider.tsx` | Expression evaluator instance |

`MetadataProvider` is the one name with two hits in the repo. The console's is the
app-shell file above — it is what `ConsoleShell` / `ConnectedShell` mount and what
`@object-ui/app-shell` re-exports. `packages/providers/src/MetadataProvider.tsx` is an
unrelated, much smaller generic provider (static metadata or one fetch); nothing in the
console path uses it.

## Key hooks

All seven live in `@object-ui/app-shell`; the console app declares no hooks of its own.

| Hook | Location | Purpose |
|------|----------|---------|
| `useFavorites` | `packages/app-shell/src/hooks/useFavorites.ts` | Starred items state |
| `useMetadataService` | `packages/app-shell/src/hooks/useMetadataService.ts` | CRUD operations on metadata |
| `useNavPins` | `packages/app-shell/src/hooks/useNavPins.ts` | Pinned navigation items |
| `useNavigationSync` | `packages/app-shell/src/hooks/useNavigationSync.ts` | URL ↔ navigation context sync |
| `useObjectActions` | `packages/app-shell/src/hooks/useObjectActions.ts` | Custom actions on objects |
| `useRecentItems` | `packages/app-shell/src/hooks/useRecentItems.ts` | MRU tracking |
| `useResponsiveSidebar` | `packages/app-shell/src/hooks/useResponsiveSidebar.ts` | Sidebar collapse on mobile |

## Common console development patterns

### Adding a new admin surface

**Default answer: don't write a page.** `SystemHubPage` carries an explicit
`@deprecated` docblock — the hand-written card hub is superseded by the metadata-driven
navigation, and it says so in terms worth quoting because they are the platform's
position, not one file's preference:

> ObjectStack is a metadata-driven platform: every administrable surface (objects,
> metadata types such as `datasource`) is reached through an app's `navigation[]`
> (defined in framework `packages/platform-objects/src/apps/*.app.ts`) and rendered by
> the standard `UnifiedSidebar` → `NavigationRenderer`. New admin surfaces must be added
> as nav items (`type:'object'` or `type:'component'` with
> `componentRef:'metadata:resource'`), NOT as bespoke cards/pages here.

So, in order of preference:

1. **A metadata type** → register it in the framework's spec + type registry. The
   metadata-admin engine gives you list / create / edit / history for free; add a
   `registerMetadataResource()` entry only to override columns or swap in a bespoke editor.
2. **An object** → contribute a `type:'object'` nav item from the owning framework plugin.
3. **A genuinely bespoke React surface** → a `type:'component'` nav item with a
   `componentRef` registered in `builtinComponents.tsx`.
4. **Only if none of the above fits**: a page under `apps/console/src/pages/`, its route in
   the `systemRoutes` fragment of `apps/console/src/AppContent.tsx`, and a test that
   renders the URL. A page in this repo's host is invisible to every other host — see the
   reference-assembly note at the top.

### Extending object management

The object type is edited through the metadata-admin engine like any other metadata
type — `registerMetadataResource({ type: 'object', … })` in
`packages/app-shell/src/services/builtinComponents.tsx` is the whole override surface.
There is no longer a bespoke object-detail page in the console to add a tab to; the
factory and its seven widgets were retired (objectui#3731 / #3736). See
"Schema-driven detail pages" above before reaching for a bespoke replacement.

### Widget styling convention

Console widgets use clean form-style labels and sectioned layouts without card borders:

```typescript
function MyWidget({ schema }) {
  return (
    <div className="space-y-6">
      <div>
        <span className="text-xs font-medium uppercase text-muted-foreground">Section Title</span>
        <div className="mt-2 space-y-3">
          {/* Content */}
        </div>
      </div>
    </div>
  );
}
```

## Common mistakes

- Writing a standalone admin page instead of declaring a nav item / metadata type — see
  "Adding a new admin surface".
- Assuming a symbol lives under `apps/console/src/` because this guide's older revisions
  said so. Grep first; most of it is in `packages/app-shell`.
- Forgetting to set `NavigationContext` in custom layouts — sidebar shows wrong items.
- Not registering custom widgets before the editor renders — `SchemaRenderer` falls back.
- Emitting legacy URLs from new code (`/system/objects`, `component/metadata/resource/…`)
  instead of the engine's canonical `…/metadata/:type[/:name]`. The legacy routes stay
  declared for bookmarks; that is not a licence to generate them.
- Adding a navigation target without declaring its route in the same change — the tail
  route swallows it and fails differently depending on the word's length.
- Modifying `src/ui/**/*.tsx` files directly — these are Shadcn upstream files that get overwritten by sync scripts.

## Debugging & Browser Simulation Strategy

When debugging the simulated browser environment (e.g., `apps/console` in mock mode), strict adherence to the official toolchain is required.

### Rule #1: Official MSW Integration

- **Startup:** Use `@objectstack/plugin-msw` to initialize the mock API server. Do NOT write custom fetch interceptors or manual mock servers unless absolutely necessary.
- **Configuration:** Ensure the `MSWPlugin` is configured with the correct `baseUrl` (e.g., `/api/v1`) to match the client's expectations.

### Rule #2: Client Data Fetching

- **Data Access:** Always use `@objectstack/client` for data fetching. Do not use raw `fetch` or `axios` directly in components.
- **Alignment:** Verify that the client's `baseUrl` matches the mock server's configuration.

### Rule #3: Upstream Fixes First

- **Principle:** If you encounter a bug or limitation in the official packages (`@objectstack/*`):
  - **Action 1:** Do NOT rely solely on local workarounds (monkey-patching) in the app.
  - **Action 2:** Prompt the user to modify the source code in the official packages (if available in the workspace) or report the issue.
  - **Reasoning:** We prioritize fixing the core engine over patching individual apps.
