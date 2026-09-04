# ADR-0017: Object has-many View (Independent View Entities)

**Status**: Accepted · Implemented Phases 1–4 (2026-05-30) · Phase 5 (Studio designer) deferred
**Deciders**: ObjectStack Protocol Architects
**Builds on**: [ADR-0003](./0003-package-as-first-class-citizen.md) (package as first-class citizen), [ADR-0005](./0005-metadata-customization-overlay.md) (one Zod source per type, org overlay), [ADR-0010](./0010-metadata-protection-model.md) (L1/L2/L3 protection)
**Consumers**: `@objectstack/spec`, `@objectstack/metadata`, `@objectstack/objectql`, `@objectstack/rest`, `@objectstack/platform-objects`, `../objectui` (runtime switcher + Studio designer)

---

## 0. Context

The original view model exposed a single **per-object aggregated container**:

```ts
defineView({
  list,        // primary list view
  listViews,   // { all, pipeline, … }  — secondary list views
  formViews,   // { default, … }        — form views
})
```

A view's *identity* was the **object name**, derived at backend
registration from `list.data.object`. All of an object's views lived in
one metadata document, registered under the bare `<object>` key.

This coupling broke down once we accepted two facts about the domain:

1. **Views inherently re-aggregate.** "Object has-many view" is the data
   model, not an implementation cost. A frontend user defines a *new*
   view at any time — a "My hot leads" list, a personal kanban — and it
   must slot into the same switcher as the package-shipped views.
2. **A view needs its own identity, owner, and visibility.** A single
   aggregated container cannot carry per-view `scope` (who sees it),
   `owner` (whose personal view it is), or independent
   create/rename/delete/permission boundaries.

You cannot model runtime, user-authored, owner-scoped views as keys
inside one object-owned document. Each view must be a **first-class
entity**.

## 1. Goals & Non-goals

### Goals
- Make each view an **independent entity** with a qualified identity.
- Support **runtime user-created views** (created from the console, not
  source).
- A three-layer **scope** model — `package` / `shared` / `personal` —
  matching Airtable / Salesforce list-view semantics.
- An aggregating **switcher**: an object surfaces *all* its views
  (package + shared + personal-for-this-user) in one place.
- **Zero-migration back-compat** for existing `defineView` sources.

### Non-goals
- Changing the `ListView` / `FormView` **config** schema. A ViewItem
  *wraps* the existing config; it does not redefine it.
- Per-view physical tables. Runtime views are rows in one typed object,
  not bespoke storage.

## 2. Decision

**A View is an independent metadata entity (`ViewItem`), and an Object
has-many ViewItem.**

- **`ViewItem`** — name `<object>.<viewKey>` (qualified, globally
  unique), an `object` foreign key, a `viewKind` (`list` | `form`), a
  `scope`, and the existing `ListView`/`FormView` payload under `config`.
- **Three scopes** (a layer axis, *distinct* from ADR-0010 `_provenance`):
  - `package` — ships from `*.view.ts` source; immutable at runtime
    (not deletable / hideable / overridable in the switcher).
  - `shared` — authored at runtime, org-wide; gated by `view.manageShared`.
  - `personal` — authored at runtime, visible only to its `owner`;
    available to any user with object read.
- **Dual-read loader** — existing aggregated `defineView` containers are
  **auto-expanded** into ViewItems at load time *and* still registered
  under the bare `<object>` key, so legacy consumers keep working with no
  source change.
- **`getViewsByObject()` / `GET /meta/view?object=`** — the aggregation
  query that powers the switcher.
- **`sys_view_definition`** — a typed system object that stores the
  runtime `shared` + `personal` layers. CRUD flows through ObjectQL's
  **generic data API** (`/api/v1/data/sys_view_definition`); there are no
  bespoke per-view REST endpoints.

## 3. Detailed design

### 3.1 Protocol — `@objectstack/spec`
`packages/spec/src/ui/view.zod.ts`:
- `ViewItemNameSchema` — `^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$` (qualified
  `<object>.<viewKey>`).
- `ViewScopeSchema` — `z.enum(['package','shared','personal'])` (named
  `scope` to avoid clashing with ADR-0010 `_provenance`).
- `ViewKindSchema` — `z.enum(['list','form'])`.
- `ViewItemSchema` — a `discriminatedUnion('viewKind', …)`: a `list`
  branch carries `config: ListViewSchema`, a `form` branch carries
  `config: FormViewSchema`, both spread `...MetadataProtectionFields`.
- `defineViewItem(config)` factory + `ViewItem` / `ViewScope` /
  `ViewKind` types. `defineView` is retained (dual-read expands it).

### 3.2 Backend loader — `@objectstack/metadata`
`packages/metadata/src/plugin.ts`:
- `isAggregatedViewContainer(item)` — true when an item has no `viewKind`
  but does carry `list`/`form`/`listViews`/`formViews`.
- `expandViewContainer(object, container)` — emits one `ViewItem` per
  `listViews` entry (then the default `list`, **deduped by structural
  signature** so a `list` identical to `listViews.all` collapses to one),
  then per `formViews` entry; flags `isDefault`, clones each `config`,
  assigns `scope: 'package'` and a qualified name.
- The loader registers **both** the aggregated container (bare
  `<object>` key, back-compat) **and** every expanded `ViewItem`
  (`<object>.<key>`).

### 3.3 Aggregation — `MetadataManager`
`packages/metadata/src/metadata-manager.ts` — `getViewsByObject(object)`
lists `view`, keeps `v.viewKind && v.object === object`, sorts by
`(order, name)`. Returns the **package** layer only; REST merges runtime
rows on top.

### 3.4 Runtime storage — `sys_view_definition`
`packages/metadata-core/src/objects/sys-view-definition.object.ts` —
a `sys_`-prefixed **system object** (auto-provisioned). Columns:
`name`, `object`, `view_kind`, `label`, `is_default`, `view_order`,
`scope` (`shared`|`personal`), `owner`, `hidden`, `config` (JSON),
`organization_id`, `state`, audit fields. Unique partial index on
`(name, organization_id, owner)` where `state='active'` so a shared view
(owner NULL) and each user's personal views never collide.

> Rationale for a **dedicated object** rather than the `sys_metadata`
> overlay: runtime views are *data*, not admin metadata customisation.
> They carry an `owner` and a visibility `scope` and are queried
> per-user — a personal "My hot leads" view must never pollute the global
> metadata registry.

### 3.5 REST — `@objectstack/rest`
`packages/rest/src/rest-server.ts` — `GET /meta/:type` gains an
`?object=` filter for `type === 'view'`: returns only expanded ViewItems
bound to that object, sorted, handling both array and `{items:[]}`
response shapes.

### 3.6 Runtime switcher — `../objectui`
`packages/data-objectstack/src/index.ts` — the adapter's runtime-view
CRUD (`listViews` / `createView` / `updateView` / `deleteView`) is
repointed from the legacy metadata `view` overlay onto
`sys_view_definition` via the generic data API:
- `listViews(object, { owner })` returns `scope='shared'` rows plus this
  user's `personal` rows (server applies org isolation; the scope filter
  is defence-in-depth).
- `update`/`delete` resolve `(object, name) → record id` through a query,
  then mutate by id.
- `viewDefRowToSpec` / `viewSpecToRecord` map between the flat view-spec
  the tab-bar consumes and the typed columns (config nested; identity
  hoisted).

`packages/app-shell/src/views/ObjectView.tsx` — the console switcher
aggregates two sources it already merged: **package** views via
`objectDef.listViews` (the dual-read aggregated container, surfaced by
`MetadataProvider`) and **shared/personal** via `dataSource.listViews`.
New and duplicated views default to the `personal` layer owned by the
creator (Airtable parity).

## 4. Scope model & protection (ADR-0010 interplay)

`scope` (this ADR) and `_provenance` (ADR-0010) are **orthogonal axes**:

| Axis | Values | Means |
|:---|:---|:---|
| `scope` | package / shared / personal | *Which layer* a view belongs to and *who sees it*. |
| `_provenance` | package / org / env-forced | *Where a metadata override came from* and *whether it is locked*. |

Switcher behaviour by scope:

| Scope | Visible to | Mutable at runtime | Default-able |
|:---|:---|:---:|:---:|
| `package` | everyone | ❌ (duplicate to customise) | source-defined |
| `shared` | everyone in org | ✅ with `view.manageShared` | ✅ |
| `personal` | `owner` only | ✅ (owner) | ✅ (for owner) |

## 5. Migration

1. **Existing `defineView` sources — no migration required.** The
   dual-read loader (§3.2) auto-expands them into package ViewItems while
   keeping the aggregated container registered. Sources compile and load
   unchanged.
2. **Optional codemod** `defineView → defineViewItem`
   (`scripts/codemod/view-to-viewitem.mjs`) for teams that want to author
   independent views explicitly. It is *optional* precisely because
   dual-read makes it unnecessary for correctness.
3. **Pre-existing runtime views** that were written to the metadata
   `view` overlay (before `sys_view_definition` existed) are migrated
   one-time into `sys_view_definition` (`scope='shared'`, `owner=NULL`).
   See `scripts/migrate/overlay-views-to-sys-view-definition.md`.

## 6. Consequences

### Positive
- Runtime users create / own / share views without touching source.
- One coherent switcher per object across all three layers.
- Package views are protected by construction (not in the mutable set).
- Reuses the generic ObjectQL data API — no bespoke per-view endpoints.

### Negative
- Two reads per object page (package meta + `sys_view_definition` data).
  Both are cached; the data read 404-degrades gracefully when the object
  isn't provisioned.
- Runtime view ownership is enforced client-side today (scope filter +
  server org isolation), pending row-level security (§7).

### Neutral
- `defineView` remains a supported authoring shorthand; it is now sugar
  over a set of `ViewItem`s.

## 7. Open questions

- **Row-level security on `sys_view_definition`.** Owner-scoping of
  `personal` views is a client filter plus org isolation today. The
  long-term enforcement is an ObjectQL sharing rule
  (`scope='shared' OR owner = $currentUser`) so the server never returns
  another user's personal views.
- **`view.manageShared` enforcement.** The permission gates the shared
  layer in the UI; backend enforcement on create/update of `scope='shared'`
  rows is pending.
- **Studio designer (Phase 5).** An Airtable-style per-object view
  designer (left-rail view list, single-view editor, inline
  rename/duplicate/delete/reorder/set-default) is deferred until the
  concurrent metadata-admin work merges, to avoid file conflicts.
