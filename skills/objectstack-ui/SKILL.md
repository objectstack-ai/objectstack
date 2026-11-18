---
name: objectstack-ui
description: >
  Author ObjectStack UI metadata — Views (list/form/kanban/calendar/gantt),
  Apps (navigation), Pages (structured plus the HTML and React source-authoring
  tiers, ADR-0080/0081), Dashboards, Reports, Charts, Actions, and
  package Docs (`src/docs/*.md`). Use when
  the user is adding `*.view.ts` / `*.page.ts` / `*.app.ts` /
  `*.dashboard.ts` / `*.report.ts` / `*.dataset.ts` / `*.action.ts` /
  `src/docs/*.md` files or designing a Studio-rendered UI surface.
  Do not use for: data schema (see objectstack-data), multi-step flows that
  BRANCH on logic between steps (those are `*.flow.ts` with `type: 'screen'` —
  see objectstack-automation; a stepped form over ONE object is this skill's
  `formViews` `type: 'wizard'`), or Studio's own admin UI (that
  ships with the platform). CEL expressions in
  visibility/conditional rules: load objectstack-formula alongside.
license: Apache-2.0
compatibility: Requires @objectstack/spec 18.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "18.6.0"
  domain: ui
  tags: view, app, page, dashboard, report, chart, action, widget, doc
---

# UI Design — ObjectStack UI Protocol

## First checks

1. **Version.** This skill targets the `@objectstack/spec` major in its
   `compatibility` line. Read the installed one
   (`node_modules/@objectstack/spec/package.json`); where they differ, the
   installed contract is right.
2. **Read what exists.** Read the object's declaration (fields, `fieldGroups`,
   relationships) and the project's own files for it (the globs under Where to
   go). Add beside what is there; reuse a declared dataset, field group or view.
3. **Read the type's contract.** [references/_index.md](./references/_index.md)
   points at each type's Zod source in `node_modules/@objectstack/spec/src/`.
   `Read` it for exact keys, enum members and refusals, never from memory: it
   decides what to write. A running environment serves the parsed shape as
   JSON Schema (`GET /api/v1/meta/types`, `entries[].schema`): a defaulted
   key reads as required and a bare-string predicate as `{}`.
4. **Verify before reporting done.** `os validate` (`npm run validate` in a
   scaffolded project; `os build` runs the same gates). Most traps below pass
   it.

## Traps — each parses, then fails at run time

Two more: [List Views](#list-views), [Actions](#actions).

1. **A long form stays `simple`**: collapse what is rarely filled and size it
   with `columns` and `modalSize`. `tabbed` flags a required field only on its
   own tab and overflows on a phone
   ([Form Views](./rules/list-views.md#form-views)).
2. **A record entered with its line items is `inlineEdit` on the child's
   `master_detail` field**, before any custom page, and its grid needs no "Add
   line" button. A parent or child declaring `enable.apiMethods` must list
   `'bulk'`, or the save is refused `405`
   ([Master-Detail Forms](./rules/list-views.md#master-detail-forms-parent--child-line-items)).
3. **A persisted chart binds a declared dataset.** A widget or report names a
   `defineDataset` and selects its `dimensions` / `values` by name; an object
   without one has no analytics face. A dataset is narrow: a window, a to-many
   rollup or a computed dimension is a stored field or app code, never forced
   into one; an ad-hoc chart in a `kind: 'react'` page needs none. Read
   [Dashboards](./rules/dashboards.md#dataset-bound-widgets) before writing any
   widget, dataset or chart.
4. **A filter token is presentation scope, not security.** `{current_user_id}`,
   `{today}` and the rest (vocabulary: objectstack-query → `rules/filters.md`,
   load it before writing one; an unrecognised token is a build error) decide
   what a surface *shows*; RLS decides what a caller may *read*. Such a filter
   must never be what keeps a user from someone else's data.
5. **The object declares its record page.** Related lists, their order and
   filter are flags on the object and its fields, not a page file; how a record
   opens is one list-view key, and the reader's own display choices are never
   metadata ([Record Page](./rules/record-page.md)).

## Where to go

| Authoring | In | Open first |
|:--|:--|:--|
| A list, board, calendar, gallery or gantt: columns, `filter`, quick filters, toolbar search, sorting, grouping | `src/views/*.view.ts` | [List Views](./rules/list-views.md) |
| A form (`simple` / `tabbed` / `wizard`): width, columns and `sections`; master-detail (a parent with line items), a public form, field conditional rules | `src/views/*.view.ts` | [Form Views](./rules/list-views.md#form-views) |
| An app and its navigation; who sees or opens it; object nav, a `filters` slice or an interface page | `src/apps/*.app.ts` | [Navigation](./rules/navigation.md) |
| What a record page shows: related lists, a slotted or full page, drawer or page | the object | [Record Page](./rules/record-page.md) |
| A button or operation: `locations`, visibility, dialog and toast copy, params, new tab, the body's `ctx` | `src/actions/*.actions.ts` | [Actions](./rules/actions.md) |
| A number, chart, KPI or report over records: datasets, widgets, dashboard filters, `compareTo`, date bucketing, drilldown, cubes | `src/datasets/*.dataset.ts`, `src/dashboards/*.dashboard.ts`, `src/reports/*.report.ts` | [Dashboards](./rules/dashboards.md) |
| A page (regions, components, print, `kind: 'html'` / `'react'` source, styling) or package docs | `*.page.ts`, `src/docs/*.md` | [Pages & Docs](./rules/pages.md) |
| The props of a block in a `kind: 'react'` page | | [react-blocks.md](./references/react-blocks.md) |

## View Types

### List Views

A list view's `type`: `grid` (the default table), `kanban` (a board by status),
`gallery` (cards over an image, avatar or file field), `calendar`, `timeline`
(a chronological stream), `gantt` (start/end bars with dependencies), `map`
(`location` fields), `chart` (an aggregate over the object), `tree` (a
self-referencing hierarchy).

**Keep the kind the request names.** A photo wall, card wall or catalogue of
covers is `gallery` (an image, avatar or file field as `gallery.coverField`),
a schedule or timeline over a start/end date pair is `gantt`, a board is
`kanban`; never downgrade a named kind to `grid`: the file parses and the user
opens a table. "Add a board" is a NEW `listViews` entry, never `list` retyped,
and a board over a field added in the same change opens empty:
[List Views](./rules/list-views.md#adding-a-board-calendar-gallery-or-gantt-beside-the-list).

## App Navigation

One App per package: `defineStack` refuses a second, so audiences sharing a
product are `requiredPermissions`-gated groups inside it. Hiding an app
(`tabPermissions`) is not gating it: its URL still opens. Both, and each item
type's keys: [Navigation](./rules/navigation.md).

### Navigation Item Types

| Type | Purpose |
|:--|:--|
| `group` | Collapsible group of items |
| `object` | An object list, a named view, a record deep-link, or a `filters` slice |
| `dashboard` | A dashboard |
| `report` | A report |
| `page` | A custom Page |
| `url` | External or custom URL |
| `action` | Run an action instead of navigating |
| `component` | Built-in platform component |
| `doc` | Package docs |
| `separator` | Visual separator |

## Actions

**An operation is an `action`, never a view, and a write button must write.**
"Mark as done", "approve", "set status to X" is an action (`defineAction` in
TypeScript) with `objectName` and `locations`; with neither `locations` nor a view naming it,
it renders nowhere. `ctx.record` is a read-only snapshot and the body's return
value is applied to nothing: a body that returns or assigns the new values
reports success and changes nothing. Call the API, with the option `value`,
never its label ([Actions](./rules/actions.md)):

```json
{ "name": "mark_done", "label": "Mark as done", "objectName": "task", "locations": ["record_header"],
  "type": "script", "body": { "language": "js", "capabilities": ["api.write"],
    "source": "await ctx.api.object('task').update({ id: ctx.recordId, status: 'done' });" } }
```

### Action Types

| `type` | Purpose |
|:--|:--|
| `script` | Run an inline L2 hook body (sandboxed JS) on the server: `body`, or `target` naming a registered function |
| `url` | Navigate to an internal route or external URL |
| `modal` | Open the page named by `target`; a `body` runs only on `script` |
| `flow` | Launch a screen/auto-launched flow by name; a multi-step operation is this, with a flow you also author |
| `api` | Call a registered API endpoint |
| `form` | Open a FormView by name (routed to `/_console/forms/:name`) |

Every type but `script` requires `target`.

## Report Types

| Type | When to Use |
|:--|:--|
| `tabular` | Flat data table with columns and filters |
| `summary` | Grouped data with subtotals (e.g., revenue by region) |
| `matrix` | Cross-tab / pivot table (`rows` down × `columns` across) |
| `joined` | Multi-block analytic surface (combines several sub-reports) |

There is no `chart` report type — a report *visualizes* via its embedded
`chart:` config.
