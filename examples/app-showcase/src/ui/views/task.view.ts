// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView, P } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_task' };

/**
 * Task view gallery — a single object backing **all eight** list-view types
 * plus the simple / tabbed / wizard / split / drawer form variants. This is
 * the heart of the view-layer coverage: the coverage manifest references
 * each `listViews.*.type` here.
 */
export const TaskViews = defineView({
  // Default list shown when the object is opened.
  list: {
    label: 'All Tasks',
    type: 'grid',
    data,
    columns: [
      { field: 'title' },
      { field: 'project' },
      { field: 'assignee' },
      { field: 'status' },
      { field: 'priority' },
      { field: 'due_date' },
      { field: 'progress' },
    ],

    // ADR-0053 — on the object's DEFAULT list (views mode) status presets are
    // *named views* in the switcher (Salesforce/Airtable "saved views"), not an
    // in-view tab row. See the `in_progress` / `urgent` / `done` listViews below.
    // The end-user filter ELEMENTS (Airtable "User filters": tabs / dropdowns)
    // belong to interface pages (filters mode) — see the *.page.ts examples.

    // ADR-0047 — runtime visualization whitelist (Airtable "Appearance →
    // Visualizations"). Rendered as a compact dropdown in the toolbar's
    // right cluster; types whose bindings don't resolve are hidden by the
    // client regardless. This default list is the showcase's "switch every
    // view" case: the SAME records re-shaped into each record-based
    // visualization (chart is excluded — it aggregates a dataset, not records,
    // and lives as its own named view + dashboard element).
    appearance: {
      // The six record-based visualizations the spec + runtime switcher support
      // out of the box: the SAME task records re-shaped on demand. (map needs a
      // spec MapConfigSchema the ListViewSchema doesn't yet have, and chart
      // aggregates a dataset rather than records — both live as their own named
      // views below instead of in this switcher.)
      allowedVisualizations: ['grid', 'kanban', 'gallery', 'calendar', 'timeline', 'gantt'],
    },

    // Per-visualization bindings so each type in the switcher resolves and
    // renders the same task records. Field names map to task.object.ts.
    kanban: { groupByField: 'status', summarizeField: 'estimate_hours', columns: ['title', 'assignee', 'priority'] },
    gallery: { coverField: 'cover', titleField: 'title', visibleFields: ['assignee', 'status', 'priority'] },
    calendar: { startDateField: 'due_date', titleField: 'title', colorField: 'status' },
    timeline: { startDateField: 'created_at', titleField: 'title', colorField: 'priority', scale: 'week' },
    gantt: { startDateField: 'start_date', endDateField: 'end_date', titleField: 'title', progressField: 'progress' },
  },

  listViews: {
    // ── Status presets (ADR-0053) — saved views with a base ListView.filter,
    // shown as switcher entries on the object's default list (views mode). ──
    in_progress: {
      label: 'In Progress',
      type: 'grid',
      data,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }, { field: 'priority' }, { field: 'due_date' }],
      filter: [{ field: 'status', operator: 'equals', value: 'in_progress' }],
      // Object form (#8010): `formats` is what the renderer reads; the bare
      // array is the legacy spelling and lifts to this shape at parse.
      exportOptions: { formats: ['csv', 'xlsx', 'json'] },
    },
    urgent: {
      label: 'Urgent',
      type: 'grid',
      data,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }, { field: 'priority' }, { field: 'due_date' }],
      filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }],

      // ── The showcase's `emptyState` specimen (#7714) ──────────────────────
      // Authored HERE, on a filtered saved view, and not on some unfiltered
      // object list: emptiness means different things on the two. An empty
      // unfiltered list is a SETUP state ("nothing exists yet") that the seed
      // deliberately never produces; an empty filtered view is a STEADY state
      // ("nothing matches right now") that a running deployment hits
      // constantly — and on *this* filter it is the outcome you want, so the
      // copy can report good news instead of nagging about missing data. That
      // is the case per-view empty-state copy exists for, which makes this the
      // spelling worth pinning as the fixture.
      //
      // It is also reachable without touching the seed: the two urgent seed
      // rows are exactly what the `bulk_actions` view's `showcase_mark_done`
      // is there to clear, so a demo user empties this view by using the app.
      //
      // Consumed as a translation surface at
      // `objects.showcase_task._views.urgent.emptyState.{title,message}` —
      // both locales are authored in `system/translations/index.ts`. Until
      // this fixture existed the spec declared that key group with no
      // reachable instance anywhere under `examples/`, so the i18n
      // surface-matrix check had nothing to resolve and was waived rather
      // than run.
      emptyState: {
        title: 'No urgent tasks',
        message: 'Nothing needs immediate attention right now. A task appears here as soon as its priority is raised to Urgent.',
      },
    },
    done: {
      label: 'Done',
      type: 'grid',
      data,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }, { field: 'due_date' }],
      filter: [{ field: 'status', operator: 'equals', value: 'done' }],
    },

    // ── Legacy `rowActions: string[]` coverage (objectui#2960) ──────────
    // The pre-`rowActionDefs` authoring form: the row menu is declared as bare
    // action NAMES rather than defs. Both cases the client has to handle are
    // present here on purpose:
    //
    //   `showcase_recalc_estimate` — declared on the object at `record_more` /
    //     `record_section`, i.e. NOT a `list_item` action, so nothing derives a
    //     def for it. The client must resolve the name against the object's
    //     actions or the entry is a dead menu item.
    //
    //   `showcase_quick_view` — already a `list_item` action, so the client
    //     derives a def for it independently. Naming it here too must NOT
    //     produce a second, dead copy alongside the working one.
    //
    // Kept as a fixture: this is the only view in the showcase authored the
    // legacy way, and it is what makes the regression visible in a browser.
    legacy_row_actions: {
      label: 'Legacy Row Actions',
      type: 'grid',
      data,
      columns: [{ field: 'title' }, { field: 'project' }, { field: 'assignee' }, { field: 'status' }],
      rowActions: ['showcase_recalc_estimate', 'showcase_quick_view'],
    },

    // ── Bulk actions — one declared action over the SELECTED records ──────
    // The selection-bar twin of `legacy_row_actions` above, and — unlike that
    // fixture — the CANONICAL authoring form, not a legacy one. `bulkActions`
    // is the only way to declare a bulk action: `action.bulkEnabled` was
    // retired in spec 17 (#3896 close-out) precisely because nothing ever
    // consumed it, and its tombstone prescribes this key instead.
    //
    // Complements `project.view.ts`'s `bulkActionDefs`, which is the OTHER
    // bulk vocabulary: inline defs that mass-EDIT records through the data
    // API (`operation: 'update'` + a patch). Here the selected records go
    // through the action runner instead, so an action that is not a field
    // patch at all — a script, a custom endpoint — works over a selection.
    // Runner-dispatched bulk actions come in TWO execution modes:
    //
    //   Per-record (default) — each selected record is one dispatch:
    //   `showcase_mark_done`       — type `script`; its sandboxed body flips
    //     `done`/`progress` per record via the platform action route.
    //   `showcase_recalc_estimate` — type `api`; POSTs the showcase's own
    //     `/api/v1/showcase/recalc`, with `recordIdParam: 'recordId'` (already
    //     declared for the row surface) carrying each record's id.
    //
    //   Aggregate (objectui#3139) — the whole selection in ONE dispatch:
    //   `showcase_recalc_selection` — the `bulkActionDefs` entry below opts in
    //     with `execution: 'aggregate'`, so the renderer POSTs the SAME recalc
    //     endpoint once, carrying every selected id in `params._selectedIds`
    //     (the endpoint's batch branch). This is the "one zip for N devices"
    //     dispatch shape; results are all-or-nothing, no per-row retry.
    //
    // None declares `list_toolbar`: a bulk action is not a toolbar action,
    // it needs a selection. Naming it here is the whole declaration.
    bulk_actions: {
      label: 'Bulk Actions',
      type: 'grid',
      data,
      columns: [
        { field: 'title' },
        { field: 'assignee' },
        { field: 'estimate_hours' },
        { field: 'progress' },
        { field: 'done' },
      ],
      bulkActions: ['showcase_mark_done', 'showcase_recalc_estimate'],
      bulkActionDefs: [
        { name: 'showcase_recalc_selection', operation: 'custom', execution: 'aggregate' },
      ],
    },

    // 0 ── Tabular ───────────────────────────────────────────────────────
    // ADR-0021 Phase 2: replaces the former `showcase_task_list` report
    // (a flat record list — a ListView concern, not analytics).
    tabular: {
      label: 'Task List',
      type: 'grid',
      data,
      columns: [
        { field: 'title' },
        { field: 'project' },
        { field: 'assignee' },
        { field: 'status' },
        { field: 'estimate_hours' },
      ],

      // @objectstack/spec ListViewSchema.sort accepts a bare STRING
      // ("field [asc|desc]"), not only the {field,order}[] array form. This
      // is the exact shape that used to crash the renderer with
      // "schema.sort.map is not a function" (objectui#2601) — kept here as a
      // live coverage fixture so a real list view exercises the string form.
      sort: 'estimate_hours desc',

      // ADR-0053 — NO `userFilters` here: on an object list view ("views"
      // mode) the console suppresses them by design (the view switcher is
      // the only nav control; objectui warns since #2220). End-user filter
      // elements live in interface pages ("filters" mode) — see
      // task-workbench / task-triage / active-projects *.page.ts. Status
      // presets on this object are the named views above instead.
    },

    // 1 ── Grid ─────────────────────────────────────────────────────────
    grid: {
      label: 'Grid',
      type: 'grid',
      data,
      columns: [
        { field: 'title' },
        { field: 'assignee' },
        { field: 'status' },
        { field: 'priority' },
        { field: 'estimate_hours' },
        { field: 'due_date' },
      ],
      rowColor: { field: 'priority' },
      // List-level inline edit — cells become editable in place, with a
      // per-row edit affordance and a save-all/cancel-all toolbar (view-level
      // master switch; distinct from the master-detail `inlineEdit` on fields).
      inlineEdit: true,
    },

    // 2 ── Kanban ───────────────────────────────────────────────────────
    board: {
      label: 'Board (Kanban)',
      type: 'kanban',
      data,
      columns: ['title', 'assignee', 'priority'],
      kanban: {
        groupByField: 'status',
        summarizeField: 'estimate_hours',
        columns: ['title', 'assignee', 'priority'],
      },
    },

    // 3 ── Gallery ──────────────────────────────────────────────────────
    cards: {
      label: 'Cards (Gallery)',
      type: 'gallery',
      data,
      columns: ['title', 'assignee', 'status'],
      gallery: {
        coverField: 'cover',
        coverFit: 'cover',
        cardSize: 'medium',
        titleField: 'title',
        visibleFields: ['assignee', 'status', 'priority'],
      },
    },

    // 4 ── Calendar ─────────────────────────────────────────────────────
    calendar: {
      label: 'Calendar',
      type: 'calendar',
      data,
      columns: ['title', 'assignee'],
      calendar: {
        startDateField: 'due_date',
        titleField: 'title',
        colorField: 'status',
      },
    },

    // 5 ── Timeline ─────────────────────────────────────────────────────
    timeline: {
      label: 'Activity Timeline',
      type: 'timeline',
      data,
      columns: ['title'],
      timeline: {
        startDateField: 'created_at',
        titleField: 'title',
        colorField: 'priority',
        scale: 'week',
      },
    },

    // 6 ── Gantt ────────────────────────────────────────────────────────
    gantt: {
      label: 'Schedule (Gantt)',
      type: 'gantt',
      data,
      columns: ['title', 'assignee'],
      gantt: {
        startDateField: 'start_date',
        endDateField: 'end_date',
        titleField: 'title',
        progressField: 'progress',
      },
    },

    // 7 ── Map ──────────────────────────────────────────────────────────
    map: {
      label: 'Work Locations (Map)',
      type: 'map',
      data,
      columns: ['title', 'location', 'assignee'],
    },

    // 8 ── Chart ────────────────────────────────────────────────────────
    chart: {
      label: 'Hours by Status (Chart)',
      type: 'chart',
      data,
      columns: ['status', 'estimate_hours'],
      chart: {
        chartType: 'bar',
        // ADR-0021 dual-form — bind to the task dataset.
        dataset: 'showcase_task_metrics',
        dimensions: ['status', 'priority'],
        values: ['est_hours'],
      },
    },
  },

  formViews: {
    // Keyed `edit`, NOT `default`: list and form views share one
    // `<object>.<key>` namespace, and the main `list` implicitly claims
    // `showcase_task.default`. A `default` form key collides — the build-time
    // view-ref lint fails on it (framework #2554) instead of silently renaming
    // it to `default_2` and breaking any action target that references it.
    // simple ── single-section form ──────────────────────────────────────
    edit: {
      type: 'simple',
      data,
      sections: [
        {
          label: 'Task',
          columns: 2,
          fields: [
            { field: 'title', required: true },
            { field: 'project', required: true },
            { field: 'assignee' },
            { field: 'status', required: true },
            { field: 'priority' },
            { field: 'due_date' },
            // View-level conditional visibility (FormField.visibleWhen, CEL):
            // the notes box only appears while the task is Urgent. Data-level
            // counterpart is `visibleWhen` on invoice.paid_on.
            // Width via the semantic `span` (#2578): 'full' = whole row at any
            // derived column count — the primary primitive; absolute colSpan
            // is legacy and lint-discouraged.
            { field: 'notes', visibleWhen: P`record.priority == 'urgent'`, span: 'full' },
          ],
        },
      ],
    },

    // tabbed ── sections rendered as tabs ────────────────────────────────
    tabbed: {
      type: 'tabbed',
      data,
      sections: [
        { name: 'overview', label: 'Overview', columns: 2, fields: ['title', 'project', 'assignee', 'status'] },
        { name: 'schedule', label: 'Schedule', columns: 2, fields: ['start_date', 'end_date', 'due_date', 'progress'] },
        { name: 'details', label: 'Details', columns: 1, fields: ['estimate_hours', 'labels', 'location', 'notes'] },
      ],
    },

    // wizard ── step-by-step creation ────────────────────────────────────
    wizard: {
      type: 'wizard',
      data,
      sections: [
        { name: 'step_basics', label: 'Basics', columns: 1, fields: ['title', 'project'] },
        { name: 'step_assign', label: 'Assignment', columns: 1, fields: ['assignee', 'priority'] },
        { name: 'step_schedule', label: 'Schedule', columns: 2, fields: ['start_date', 'end_date', 'due_date'] },
      ],
    },

    // split ── side-by-side resizable panes; `pane` places each section ──
    split: {
      type: 'split',
      data,
      sections: [
        { name: 'split_task', label: 'Task', pane: 'primary', columns: 1, fields: ['title', 'status', 'assignee'] },
        { name: 'split_schedule', label: 'Schedule', pane: 'secondary', columns: 1, fields: ['start_date', 'due_date', 'progress'] },
      ],
    },

    // drawer ── side panel quick edit ────────────────────────────────────
    quick: {
      type: 'drawer',
      data,
      sections: [{ label: 'Quick Edit', columns: 1, fields: ['status', 'priority', 'progress'] }],
    },
  },
});
