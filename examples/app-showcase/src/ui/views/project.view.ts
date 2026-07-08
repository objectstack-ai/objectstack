// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_project' };

/** Project views — grid + a status Kanban + a budget chart. */
export const ProjectViews = defineView({
  list: {
    label: 'All Projects',
    type: 'grid',
    data,
    // Airtable-style quick-filter chips on the DEFAULT object list view
    // (ADR-0047 amendment, framework #2679 / objectui #2338). `dropdown` value
    // chips are allowed on object views; `tabs` presets stay page-only (they'd
    // collide with the saved-view ViewTabBar — use `listViews` for those).
    userFilters: {
      element: 'dropdown',
      fields: [
        { field: 'status' },
        { field: 'health', showCount: true },
      ],
    },
    columns: [
      { field: 'name' },
      { field: 'account' },
      { field: 'status' },
      { field: 'health' },
      { field: 'labels' },
      { field: 'team_members' },
      { field: 'budget' },
      { field: 'budget_remaining' },
      { field: 'end_date' },
    ],
    // Rich bulk-edit definitions (#2185) — select rows, then "set the same
    // value on all of them" through the BulkActionDialog. Each def exercises a
    // control the dialog gained in #2185:
    //   • set_labels    → multi-select on a `select` param (fixed options)
    //   • assign_team   → multi-select on a `lookup` param (users; array patch)
    //   • reassign_account → single-select on a `lookup` param (searchable
    //                     reference picker, not a bare dropdown)
    //   • reschedule    → the new `date` control + a single-select together
    bulkActionDefs: [
      {
        name: 'set_labels',
        label: 'Set Labels',
        operation: 'update',
        confirmText: 'Set these labels on every selected project?',
        params: [
          {
            name: 'labels',
            label: 'Labels',
            type: 'select',
            multiple: true,
            required: true,
            options: [
              { label: 'Frontend', value: 'frontend' },
              { label: 'Backend', value: 'backend' },
              { label: 'Design', value: 'design' },
              { label: 'QA', value: 'qa' },
              { label: 'DevOps', value: 'devops' },
            ],
          },
        ],
      },
      {
        name: 'assign_team',
        label: 'Assign Team',
        operation: 'update',
        confirmText: 'Assign these team members to every selected project?',
        params: [
          {
            name: 'team_members',
            label: 'Team Members',
            type: 'lookup',
            object: 'sys_user',
            multiple: true,
            labelField: 'name',
            required: true,
          },
        ],
      },
      {
        name: 'reassign_account',
        label: 'Reassign Account',
        operation: 'update',
        confirmText: 'Move every selected project to this account?',
        params: [
          {
            name: 'account',
            label: 'Account',
            type: 'lookup',
            object: 'showcase_account',
            labelField: 'name',
            required: true,
          },
        ],
      },
      {
        name: 'reschedule',
        label: 'Reschedule',
        operation: 'update',
        confirmText: 'Apply this schedule/status to every selected project?',
        params: [
          { name: 'end_date', label: 'Target End Date', type: 'date' },
          {
            name: 'status',
            label: 'Status',
            type: 'select',
            options: [
              { label: 'Planned', value: 'planned' },
              { label: 'Active', value: 'active' },
              { label: 'On Hold', value: 'on_hold' },
              { label: 'Completed', value: 'completed' },
              { label: 'Cancelled', value: 'cancelled' },
            ],
          },
        ],
      },
    ],
  },
  listViews: {
    by_status: {
      label: 'By Status',
      type: 'kanban',
      data,
      columns: ['name', 'account', 'budget'],
      kanban: { groupByField: 'status', summarizeField: 'budget', columns: ['name', 'account', 'budget'] },
    },
    budget_chart: {
      label: 'Budget by Account',
      type: 'chart',
      data,
      columns: ['account', 'budget'],
      chart: {
        chartType: 'bar',
        // ADR-0021 single-form — bind to the project dataset.
        dataset: 'showcase_project_metrics', dimensions: ['account'], values: ['budget_sum', 'spent_sum'],
      },
    },
  },
  formViews: {
    // `edit`, not `default`: the main `list` implicitly claims `<object>.default`
    // in the shared view namespace, so a `default` form key collides (build-time
    // view-ref lint, framework #2554).
    edit: {
      type: 'simple',
      data,
      sections: [
        { label: 'Project', columns: 2, fields: ['name', 'account', 'status', 'health', 'owner'] },
        { label: 'Budget & Schedule', columns: 2, fields: ['budget', 'spent', 'start_date', 'end_date'] },
      ],
      // No subforms here: the Tasks subtable is derived from the data model —
      // showcase_task.project declares `inlineEdit: true`, so every standard
      // Project form auto-renders it. (A view could still add `subforms` to
      // override the derived columns/order.)
    },
  },
});
