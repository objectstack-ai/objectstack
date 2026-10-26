# ObjectUI SDUI Page Builder

Building production pages with the Schema-Driven UI engine, for app developers.

## Standard workflow

### 1. Frame the page contract first

Before writing implementation code, define:

- Page purpose (dashboard, list, detail, form, wizard, board).
- Required data inputs and output actions.
- User roles and visibility rules.
- Interaction model (navigation, submit, bulk actions, modals).

Then produce a first schema draft.

### 2. Select the right package boundaries

Use these boundaries in guidance and generated code:

- `@object-ui/types`: schema and typed interfaces.
- `@object-ui/core`: expression/action/registry logic.
- `@object-ui/components`: base visual components and wrappers.
- `@object-ui/fields`: form input renderers.
- `@object-ui/layout`: shell and page composition.
- `@object-ui/plugin-*`: heavy feature widgets (grid, charts, kanban, map).
- `@object-ui/react`: `SchemaRenderer`, provider wiring, runtime bridge.

When helping third-party apps, consume these packages; avoid duplicating core runtime logic in the app layer.

### 3. Compose schema using proven node shape

Use a strict component schema shape similar to this — a page whose host
published `userRole` and `metrics` (section 4, step 3, names the channel):

<!-- os:check -->
```json
{
  "type": "card",
  "id": "customer_summary",
  "className": "col-span-12 lg:col-span-4",
  "title": "Customer Summary",
  "hidden": "${userRole !== 'admin'}",
  "children": [
    {
      "type": "text",
      "content": "Active users: ${metrics.activeUsers}"
    }
  ]
}
```

**Every key belongs on the node itself — never in a `props` envelope.** The
renderers read `schema.title` / `schema.content` / `schema.columns` directly;
`SchemaRenderer` spreads `schema.props` as React props instead of merging it
into the node, so a key parked under `props` is never read and the component
paints an empty frame (the envelope itself also lands in the DOM as
`props="[object Object]"`). Namespaced `element:*` components are where `props`
is read by design (`readProps` in
`packages/components/src/renderers/basic/elements.tsx`).

`properties` is a different envelope with a different fate: `SchemaRenderer`
evaluates it and then **hoists its keys onto the node**, so unlike `props` it
does reach every renderer. That is why it is the only spelling that gets a
provider expression into a `data-table` today — measured, with the failing legs
and the reason it is recorded rather than recommended, in
[`rules/protocol.md`](../rules/protocol.md).

Prefer expression-based behavior (`hidden`, `disabled`) over imperative
branching in component code.

### 3b. Pick the right layout primitive

These are the structural types to reach for. By volume in the schema
catalogue, `flex`, `stack` and `box` are the three most-used layout nodes, so
reach for them before anything heavier. All but `flex` take `children` and read
every key off the node; `flex` takes its props and `children` in `properties`.

| `type` | Renders | Key props (renderer defaults) | Reach for it when |
|---|---|---|---|
| `flex` | a flex row | `direction` (`row`), `justify` (`start`), `align` (`start`), `gap` (`2`), `wrap` (`false`) | items sit side by side: a toolbar, a header with actions pushed right (`justify: "between"`) |
| `stack` | a flex column | same props; `direction` defaults to `col` and `align` to `stretch` | items sit one under another: a form, a sidebar, a page body |
| `grid` | a CSS grid | `columns` (number, or a breakpoint object), `gap` (`4`) | a fixed number of equal cells that must reflow by breakpoint — KPI cards, a tile wall |
| `container` | a centred, width-capped block | `maxWidth` (`xl`; `false` cancels the cap), `centered` (`true`), `padding` (`4`) | you want page gutters and a reading width, once, near the root |
| `box` | a bare `div` | none — `className` passes through **verbatim**, and the renderer injects nothing | you want a wrapper that adds no layout of its own: a Tailwind-only block, a positioning anchor |

Use whichever of `flex` / `stack` names your intent; do not set
`direction: "col"` on a `flex`; `objectui validate` refuses flat `flex` props.

`box` exists because every other option injects layout — the props column
above, plus `card`'s border, shadow and `CardContent` wrapper. When you want
none of that, `box` is the one that gives you none of it. It always renders a
`div`, so it is never a landmark: when a JSON page needs one, use the curated
page block — `page:section`, `page:footer` and `page:sidebar` render a
`section`, `footer` and `aside` around their `children`, each with layout of
its own (`page:section` spaces its children with `space-y-4`; `page:footer`
draws a separator above a justified, muted row; `page:sidebar` is a
`w-full md:w-80 shrink-0` column, fixed at 20rem from `md` up), and
`page:header` renders the page's `header`, a title row (`title`, `subtitle`,
`breadcrumb`, `actions`) that takes no `children`. The bare HTML sectioning
tags (`section`, `header`, `nav`, …) are not curated blocks; they belong to
`kind:'html'` pages.

### 4. Wire renderer and registry cleanly

Typical integration sequence:

1. Register default renderers/components.
2. Register plugin components needed by the page type.
3. Publish the roots the page's expressions read: wrap the tree in
   `PredicateScopeProvider` (`@object-ui/react`) — every key of its `scope` is
   a root (`userRole`, `metrics` above; `bind` reads the same bag). The renderer
   itself adds `record` (the page's row) and `page` (page variables); nothing
   publishes `data`, and `SchemaRendererProvider`'s `dataSource` is the adapter
   the object-bound blocks fetch through, not a root. Provider fence:
   [`guides/auth-permissions.md`](./auth-permissions.md).
4. Render schema via `SchemaRenderer`.

Keep custom component registrations namespaced to avoid collisions.

### 5. Use action data, not inline callback spaghetti

Represent interactions as data: a control that runs something is an `action:button`
node. Its props go in the `properties` bag — `actionType` names the executor the
action runner dispatches to — never flat on the node, which the spec's strict page
component refuses (ADR-0089 D3a).

<!-- os:check -->
```json
{
  "type": "action:button",
  "properties": {
    "label": "Save customer",
    "actionType": "url",
    "target": "/customers"
  }
}
```

If custom app-side handlers are needed, isolate them in action handlers instead of embedding business logic into presentation components.

### 6. Validate responsiveness and accessibility

For every generated page, ensure:

- Responsive layout behavior (mobile/tablet/desktop).
- Semantic labels and ARIA fields where relevant.
- Keyboard-safe interactions for forms and actions.
- Error and loading states are present in schema or wrappers.

### 7. Ship with verification artifacts

Always include:

- Final page schema JSON.
- Integration code snippet (provider + renderer + registry wiring).
- Test checklist (rendering, expressions, actions, data loading).
- Optional migration notes if replacing legacy React page code.

## Output format

Always structure results in this order:

1. `Page Goal` - one paragraph.
2. `Schema JSON` - complete runnable draft.
3. `Integration Steps` - app wiring steps.
4. `Code Snippets` - minimal required TS/TSX examples.
5. `Validation Checklist` - what to test before merge.
6. `Extension Options` - how to add fields/plugins/actions next.

## Console-inspired patterns to reuse

When users ask for a "console-like" experience, prefer:

- App-shell layout with persistent navigation.
- Metadata-driven detail pages composed from widgets.
- Registry-based component resolution over switch/case rendering.
- PageSchema factories for page variants of the same domain entity.

## Expression evaluation boundaries

A key must clear **two independent gates** to reach the screen: the renderer has
to *read* it, and `SchemaRenderer` has to *evaluate* it. Both lists -- what is
evaluated, what is read raw, and what `props` / `properties` each do -- are in
[`rules/protocol.md`](../rules/protocol.md). Two consequences shape almost every
page; both examples below read `metrics`, a root the host published (section 4,
step 3):

**A `statistic` carries its own text keys**, so both static values and
expressions work on the node (`statistic` declares `label` / `value` /
`description`):
<!-- os:check -->
```json
{
  "type": "statistic",
  "label": "Active Users",
  "value": "${metrics.activeUsers}",
  "description": "+5% from last month",
  "trend": "up"
}
```

**A type that does not declare the key needs a `text` child**, because `content`
is evaluated on every component type:
<!-- os:check -->
```json
{
  "type": "card",
  "title": "Active Users",
  "children": [
    { "type": "text", "content": "${metrics.activeUsers} active, +${metrics.growth}% this month" }
  ]
}
```

Never reach for `props` to make an expression work: it is evaluated there and
then dropped, so the trade is a literal `${...}` on screen for nothing on
screen. Full syntax -- operators, formula functions, the security model -- is
[`guides/schema-expressions.md`](./schema-expressions.md).

## Stylesheets

A page renders unstyled unless the app imports
`@object-ui/components/style.css` then `@object-ui/fields/style.css`, in that
order. Both cases -- installed from npm, and linked inside the ObjectUI
workspace -- are in [`rules/styling.md`](../rules/styling.md); this guide keeps
no second copy.

## Plugin integration in page schemas

When pages need heavy widgets (grids, forms, kanbans, charts), import the plugin package and ensure its components are registered before rendering. An
`object-grid`, `object-form` or `object-gantt` takes its props in the spec's
`properties` bag, and `objectui validate` refuses the flat spelling by name;
`object-kanban` declares its keys on the node. The `props` envelope is not read here either.

**Grid plugin example** — `bind` is a node key, so it stays beside the bag:
<!-- os:check -->
```json
{
  "type": "object-grid",
  "properties": {
    "objectName": "products",
    "columns": [
      { "field": "name", "label": "Name", "type": "text" },
      { "field": "price", "label": "Price", "type": "currency" },
      { "field": "status", "label": "Status", "type": "select" }
    ]
  },
  "bind": "products"
}
```

> **Grid columns are `{ "field" }` objects; `object-form` `fields` are names.**
> `ListColumn.field` names the object field a column shows, so a grid column
> written as `{ "name": ... }` names no field and `ObjectGrid` drops it. Form
> labels, types and `required` come from the object fields; a per-form override
> goes on a `sections[].fields` entry, `{ "field": "email", "required": true }`.

**Form plugin example:**
<!-- os:check -->
```json
{
  "type": "object-form",
  "properties": {
    "objectName": "customer",
    "mode": "edit",
    "fields": ["name", "email"]
  }
}
```

**Kanban plugin example:**
<!-- os:check -->
```json
{
  "type": "object-kanban",
  "objectName": "tasks",
  "groupBy": "status",
  "bind": "tasks"
}
```

**Gantt plugin example:**
<!-- os:check -->
```json
{
  "type": "object-gantt",
  "properties": {
    "objectName": "project_task",
    "gantt": {
      "titleField": "name",
      "startDateField": "start_date",
      "endDateField": "end_date"
    }
  }
}
```

Those three `gantt` keys are the required ones; every other option — the tree,
dependency, baseline, resource-view, quick-filter, working-calendar and
read-only surfaces — is optional and documented in
[`@object-ui/plugin-gantt`'s README](https://github.com/objectstack-ai/objectui/blob/main/packages/plugin-gantt/README.md).
A flat `startDateField` / `endDateField` / `titleField` on the node is refused
by name; the refusal points at `properties.gantt.KEY`, the block's one home.

Import plugins in your app entry point to trigger registration:
<!-- os:check -->
```typescript
import '@object-ui/plugin-grid';
import '@object-ui/plugin-form';
import '@object-ui/plugin-kanban';
```

### Full plugin catalog

Pick plugins by domain — each registers its own `type` strings in the ComponentRegistry on import:

| Domain | Plugins |
|--------|---------|
| Tables | `plugin-grid` |
| List / Detail / Form | `plugin-list`, `plugin-detail`, `plugin-form` |
| Time-based | `plugin-calendar`, `plugin-timeline`, `plugin-gantt` |
| Boards / Dashboards | `plugin-kanban`, `plugin-dashboard`, `plugin-report` |
| Visualization | `plugin-charts`, `plugin-map` |
| Editors | `plugin-editor`, `plugin-markdown` |
| Views & Design | `plugin-view`, `plugin-tree`, `plugin-designer` |
| AI | `plugin-ai`, `plugin-chatbot` |

For lazy loading, use `LazyPluginLoader` from `@object-ui/react` rather than top-level imports.

### Shell integration

For host apps that need more than the raw renderer, prefer `@object-ui/app-shell`:

<!-- os:check -->
```tsx
import { AppShell, ObjectView, PageView, DashboardView } from '@object-ui/app-shell';
```

It exposes `ObjectView`, `RecordDetailView`, `PageView`, `DashboardView`,
`ReportView` and matching providers (`AdapterProvider`, `MetadataProvider`,
`ExpressionProvider`). ⚠️ Not `ObjectRenderer` / `PageRenderer` /
`DashboardRenderer`. `ObjectRenderer` exists nowhere in the repo;
`DashboardRenderer` is a public export of `@object-ui/plugin-dashboard`; and
`PageRenderer` is an internal renderer inside `@object-ui/components`,
reachable only through the `page` / `app` / `utility` / `home` / `record`
registry keys it registers, never as an import. See
`guides/project-setup.md` for the decision matrix.
