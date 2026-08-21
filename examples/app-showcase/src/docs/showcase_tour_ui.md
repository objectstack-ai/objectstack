---
title: "Tour · UI"
description: Guided tour of the UI domain — apps, views, pages, dashboards, reports, datasets, and actions.
---

# Guided tour — UI

Everything in this domain lives under `src/ui/`.

## App & navigation

`src/ui/apps/index.ts` is the application shell — the navigation you are
clicking through, grouped to teach: Workspace / Data Model / Analytics work
like a real product; the **Authoring · \*** groups are the page-authoring
gallery.

## Data Slices — declarative `filters` on the bare data surface

The **Data Slices (filters)** group demonstrates `ObjectNavItem.filters`
(#2626): a nav item that targets an object's bare data surface
(`/:objectName/data`) with pre-applied `filter[<field>]=<value>` conditions
instead of a saved view. "In-Progress Tasks", "Urgent Tasks", and
"In-Review Tasks" all point at the same `showcase_task` object as
**Data Model → Tasks**, but each pins a different slice — the shell renders
the conditions as removable chips.

`filters` is mutually exclusive with `recordId` / `viewName`: mixing them is
an authoring ambiguity (a stale `recordId` would silently hijack the slice),
so the `app.zod` `superRefine` guard rejects the combination at build time
(#2630, precedence `recordId` → `filters` → `viewName`). Values also support
the `{current_user_id}` / `{current_org_id}` template variables for
per-user slices.

## Views — every visualization, every form layout

- **All Views** (navigation → Authoring · Visualizations → All Views) shows
  the same Task object through every list-view type: grid, kanban, gallery,
  calendar, timeline, gantt, map, chart.
- `src/ui/views/task.view.ts` also declares every form-view layout:
  simple, tabbed, wizard, split, drawer.

## Pages — four authoring models

**Start Here** (navigation, second item) teaches the decision: structured
regions (full/slotted) → constrained-JSX `html` → real `react`, with the
canonical example of each linked from that page.

## Dashboards, reports, datasets, actions

- **Chart Gallery** — one widget per chart family; the coverage test
  introspects `ChartTypeSchema` so a new chart type fails CI until it
  appears here.
- Reports (summary / matrix / joined) live in the Analytics group;
  a flat "tabular report" is deliberately a ListView lens (ADR-0021).
- `src/ui/datasets/` — the dataset semantic layer feeding reports and
  dashboards; the cube in the data domain covers the service-side analytics
  surface.
- `src/ui/actions/` — the ActionType × location matrix (script / url /
  modal / flow / api / form), visible as buttons across Task screens.
- Actions over a SELECTION come in two flavours, one view each: Task's
  **Bulk Actions** runs declared actions through the action runner — named in
  `bulkActions` for the default per-record fan-out (a script and a custom
  endpoint, neither of them a field patch), or declared as a
  `bulkActionDefs` entry with `execution: 'aggregate'` for ONE dispatch
  carrying every selected id as `params._selectedIds` (Recalculate
  Selection, objectui#3139 — the single-zip / merged-PDF shape); Project's
  `bulkActionDefs` instead mass-EDITS through the data API.
  `action.bulkEnabled` is not a third way — it was retired in spec 17 and
  its tombstone points at `bulkActions`.

## Branding

Each app's `branding` block (`primaryColor` / `accentColor`) is the colour
surface — the `themes` collection was retired in spec 17.1 (ADR-0049).

Continue with the [Automation tour](./showcase_tour_automation.md), or go
back to the [overview](./showcase_index.md).
