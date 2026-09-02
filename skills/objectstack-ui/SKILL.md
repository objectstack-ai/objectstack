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
compatibility: Requires @objectstack/spec 17.x (Zod v4 schemas)
metadata:
  author: objectstack-ai
  version: "1.3"
  domain: ui
  tags: view, app, page, dashboard, report, chart, action, widget, doc
---

# UI Design — ObjectStack UI Protocol

Expert instructions for designing user interfaces using the ObjectStack
specification. This skill covers Views (list, form, kanban, calendar, …),
App navigation, Dashboards, Reports, and Actions.

---

## View Types

### List Views

| Type | When to Use |
|:-----|:------------|
| `grid` | Standard data table — default for most objects |
| `kanban` | Visual board with columns (status-driven workflows) |
| `gallery` | Card-based masonry layout (visual catalogues, contacts) |
| `calendar` | Date-based scheduling (events, tasks, bookings) |
| `timeline` | Chronological activity stream |
| `gantt` | Project management with dependency tracking |
| `map` | Geospatial records with `location` fields |
| `chart` | Aggregate visualisation over the object (mini chart view) |
| `tree` | Self-referencing hierarchy (tree-grid) |
| `page` | Mounts a published Page (`pageName`); no rows of its own |

### Form Views

| Type | When to Use |
|:-----|:------------|
| `simple` | Single-page form — suitable for objects with ≤ 15 fields |
| `tabbed` | Tabbed sections — for complex objects with many field groups |
| `wizard` | Step-by-step flow — guided data entry (onboarding, applications) |

### Master-Detail Forms (parent + child line items)

To let users enter a record **together with its child line items** (invoice +
lines, project + tasks) and save them **atomically**, you almost never need a
custom page or form config. Prefer, in order:

1. **Relationship `inlineEdit` (default, zero UI config).** Declare it in the
   DATA MODEL — set `inlineEdit` on the child's `master_detail` field that
   references the parent. Every standard New/Edit form for the parent (modal,
   drawer, full-page) then auto-renders the children and saves parent + children
   in one atomic `/api/v1/batch`. **No view metadata needed.** The
   `true` / `'grid'` / `'form'` ladder and what each value picks:
   **objectstack-data → Relationships → Inline Editing**.

2. **Form view `subforms` (override / tuning).** Add to a form view only when you
   need to override the derived columns/order, or expose a child the
   relationship didn't mark inline:

   ```typescript
   formViews: {
     default: {
       type: 'simple',
       sections: [{ group: 'invoice_header' }],  // a declared fieldGroup
       subforms: [
         { childObject: 'invoice_line', // relationshipField + columns are
           title: 'Line Items',         // derived from the child object;
           addLabel: 'Add line' },      // set `columns` here only to override.
       ],
     },
   },
   ```

3. **`object-master-detail-form` page block (bespoke layout).** Use a page only
   for free-form layouts. Same `details: [{ childObject }]` shorthand.

The relationship FK and grid columns are derived from the child object's
metadata in every case; select options and lookups carry through. A parent
`summary` field rolls child values up server-side (see objectstack-data).

**Line-item grid behaviors (`grid` mode).** The editable grid is a real
spreadsheet-style line editor (the QuickBooks / Stripe / NetSuite pattern), and
every behaviour is derived from the DATA MODEL — computed columns, catalog
typeahead auto-fill, persisted drag-reorder, and the live Subtotal → Tax → Total
stack: **objectstack-data → Relationships → Inline Editing**. Three things are
authored on this side: a trailing **ghost** row always exists, so never add an
"Add line" button (typing in the ghost materialises a row; an untouched one is
never persisted); `autofill: false` opts one column out of the typeahead copy;
and the form's `taxRateField` overrides which parent field drives the totals.

**Read side — detail-page related lists.** The mirror of `inlineEdit` is the
related list on the parent's record DETAIL page. You don't author it: every
child relationship is shown as a related list by default (owned `master_detail`
children first). Refine on the relationship:
- `relatedList: 'primary'` — mark a CORE relationship; the detail page promotes
  it to its **own tab** (see layout below). A *prominence* intent, not a layout
  switch (ADR-0085).
- `relatedList: false` — suppress a noisy child from the detail page.
- `relatedListTitle` / `relatedListColumns` — override the derived title /
  columns (both optional; columns otherwise auto-derive from the child object's
  `highlightFields`). See objectstack-data → Relationships → Detail-page related lists.

**Related-list layout.** On the synthesized record detail page, each
`relatedList: 'primary'` child gets its **own tab**; every other related list
stacks under a single shared **Related** tab. Promoting a child table to a
first-class tab is therefore a one-word change on the relationship — no custom
page needed. The object still declares no per-surface *layout* hints: the old
`detail.relatedLayout` toggle and object-level `detail: {...}` block stay
**removed** (ADR-0085); `relatedLayout: 'tabs' | 'stack'` survives only as an
app-level default override, not an object key. For arrangements the
relationship layer can't express — filtered splits (e.g. Open vs Closed tabs), a
chart/report tab, exact tab ordering — assign the object a **custom record
Page** and lay it out explicitly with `record:related_list` (or inline-editable
`line_items`) blocks.

### Field Conditional Rules in Forms

Conditions that belong to a field's lifecycle — `visibleWhen`, `readonlyWhen`,
`requiredWhen` — are declared on the **DATA MODEL field**, not in the form view;
ObjectUI forms consume them. Their semantics and server behaviour:
**objectstack-data → Conditional Field Rules**.

UI-side: inline master-detail grids evaluate these rules **row-by-row** against
each child row. Use `requiredWhen` — the `conditionalRequired` alias was REMOVED
in protocol 17 and is now a parse error. Load **objectstack-formula** when
authoring non-trivial CEL.

---

## Detailed Rules

- [List, Kanban & Gantt Views](./rules/list-views.md) — `defineView`, `data`, columns, filtering, `userFilters`, toolbar search, sorting, kanban, gantt.
- [Navigation & Run Modes](./rules/navigation.md) — `App.create`, the three run modes, record presentation.
- [Dashboards, Reports & Cubes](./rules/dashboards.md) — widgets, dataset binding, filters, `compareTo`, bucketing, `options`, drilldown, report config, cubes.
- [Pages & Docs](./rules/pages.md) — page types, regions, components, the html/react source tiers, styling, package docs.
- [Actions](./rules/actions.md) — `locations`, visibility, examples, `ctx`, new tab, params.

---

## App Navigation

An **App** groups objects, dashboards, reports, and custom pages into a
structured navigation tree. Build with `App.create({...})` from
`@objectstack/spec/ui` and register under `defineStack({ apps: [...] })`.

### Navigation Item Types

| Type | Properties | Purpose |
|:-----|:-----------|:--------|
| `group`     | `label`, `icon`, `expanded`, `children[]`     | Collapsible group of items |
| `object`    | `objectName`, `viewName?`, `recordId?`, `filters?`, `label`, `icon` | Link to an object list, a named view, a record deep-link, or a `filters` slice on the bare data surface. Target precedence: `recordId` → `filters` → `viewName` |
| `dashboard` | `dashboardName`, `label`, `icon`              | Link to a dashboard |
| `report`    | `reportName`, `label`, `icon`                 | Link to a report |
| `page`      | `pageName`, `label`, `icon`                   | Link to a custom Page (`type: 'home' | 'list' | ...`) |
| `url`       | `url`, `label`, `icon`                        | External or custom URL |
| `action`    | `actionDef` (`{ actionName, params? }`), `label`, `icon` | Run an action instead of navigating |
| `component` | `componentRef`, `params?`, `label`, `icon`    | Built-in platform component; `componentRef` is a colon-joined registry key (`metadata:resource`), `params` become props |
| `separator` | —                                             | Visual separator |

> **`requiresObject` / `requiresService`:** Use these on any item that
> depends on an optional system object or kernel service so the nav item is
> automatically hidden when missing — never hard-code conditional UI.

---

## Report Types

| Type | When to Use |
|:-----|:------------|
| `tabular` | Flat data table with columns and filters |
| `summary` | Grouped data with subtotals (e.g., revenue by region) |
| `matrix` | Cross-tab / pivot table (`rows` down × `columns` across) |
| `joined` | Multi-block analytic surface (combines several sub-reports) |

There is no `chart` report type — a report *visualizes* via its embedded
`chart:` config.

---

## CRM UI Blueprint (Metadata-First)

Use this CRM-style structure as the canonical UI assembly reference:

| UI Surface | Typical Location | Pattern to Follow |
|:--|:--|:--|
| Multi-view object UI | `src/views/*.view.ts` | Define default `list` + `form`, then named `listViews` / `formViews` for scenarios |
| **Public / anonymous form** | `src/views/*.view.ts` (formView with `sharing.allowAnonymous: true`) | Web-to-Lead / Web-to-Case. Auto-exposed at `GET/POST /api/v1/forms/:slug` |
| App navigation | `src/apps/*.app.ts` | Use grouped nav trees, `viewName` shortcuts, and `requiresObject` for capability-aware visibility |
| **Analytics dataset** | `src/datasets/*.dataset.ts` | One per object you want reportable — dashboards and reports bind a **declared** dataset by name, so an object without one has no analytics face |
| Dashboards | `src/dashboards/*.dashboard.ts` | Combine KPI + chart + table widgets with shared `dateRange` and `globalFilters` |
| Reports | `src/reports/*.report.ts` | Select `rows` (dimensions) + `values` (measures) from that dataset; tabular/summary/matrix/joined |
| Record pages | `src/pages/*.page.ts` | Compose `regions` + components (`page:header`, `record:highlights`, related lists, tabs) |
| User actions | `src/actions/*.actions.ts` | Use `flow` for orchestration and `modal` for parameterized bulk mutations |

This blueprint is the default for “build a complete metadata app UI” tasks.

---

## Date Macros — Filter Placeholders

Filter values in list views, dashboards, reports and pages accept relative-date
tokens (`{today}`, `{current_month_start}`, `{30_days_ago}`) and the two session
tokens `{current_user_id}` / `{current_org_id}`. **The vocabulary, both accepted
spellings, the two resolvers and the near-miss list are owned by
objectstack-query → `rules/filters.md` — load it before writing a filter token.**
An unrecognised token is a build error and a runtime throw, never a silent
literal.

Two rules this package owns, because they are about UI surfaces rather than the
token vocabulary:

* A filter token is **presentation scope, not security**. It decides what a
  surface *shows*; RLS decides what a caller may *read*. Removing a
  `{current_user_id}` filter widens a view — it must never be the thing standing
  between a user and someone else's data.
* `AppContextSelector` ids (e.g. `{active_package}`) resolve in navigation
  `recordId` / `params` only. Filters are not evaluated with the sidebar's
  selector state.

---

## Actions

Actions are user-triggered operations attached to an object or a view.
Register them under `defineStack({ actions: [...] })`.

### Action Types

| `type`   | Purpose                                                            | Required field |
|:---------|:-------------------------------------------------------------------|:---------------|
| `script` | Run an inline L2 hook body (sandboxed JS) on the server            | `body` (or `target` = registered function name) |
| `url`    | Navigate to an internal route or external URL                      | `target`       |
| `modal`  | Open a dialog (typically collecting `params`, then executing `body`) | `target`     |
| `flow`   | Launch a screen/auto-launched flow by name                         | `target`       |
| `api`    | Call a registered API endpoint                                     | `target`       |
| `form`   | Open a FormView by name (routed to `/_console/forms/:name`)        | `target`       |

---

## Common Pitfalls

1. **Putting too many columns in a grid view.**
   Users rarely need more than 6–8 columns visible by default. Use `hidden`
   for secondary columns.

2. **Forgetting `link: true` on the primary column.**
   The first meaningful column (usually the name/subject) should be the
   navigation link to the record detail.

3. **Putting widget grid placement in `position`.**
   The grid-placement field is `layout: { x, y, w, h }` — `position` is not a
   widget key and the closed schema REJECTS it by name (it was silently
   dropped before protocol 17). `layout` is optional: omit it and the widget
   auto-flows (the Studio designer relies on this); set it only when you want
   an explicit grid position.

---

## Verify your work

After authoring any `*.view.ts` / `*.action.ts` / `*.dashboard.ts`, run the
author-time gate before reporting done:

```bash
os validate     # CEL predicates (record.<field>) + widget bindings + schema
# or: os build  # the same gates, plus emits dist/
```

Two UI-specific traps it catches, both **silent at runtime** otherwise:

- **Action / field predicate** — a bare field ref in an action `visible` /
  `disabled` or a field `visibleWhen` (`done` instead of `record.done`)
  evaluates to `null` and hides the control on *every* record (the
  "button never shows" trap).
- **Dashboard widget binding** — a widget `dataset` / `dimensions` / `values`
  that doesn't resolve to a declared dataset/field renders an empty chart
  (ADR-0021).

Don't report a view/action/dashboard done until `os validate` passes. In a
scaffolded project the gate is `npm run validate`.

---

## References

See [references/_index.md](./references/_index.md) for the full list of Zod
schemas (with one-line descriptions) — pointers into
`node_modules/@objectstack/spec/src/`. Always `Read` the source for exact field
shapes; do not rely on memory of property names.
