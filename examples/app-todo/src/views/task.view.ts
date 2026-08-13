// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'todo_task' };

/**
 * Task list views (ADR-0017 object-bound row lenses).
 *
 * ADR-0021 Phase 2: the former `overdue_tasks` *report* was a flat record list
 * (no grouping / aggregation), which is a ListView concern, not analytics. It
 * is converted here to an `overdue` grid view filtered to incomplete, overdue
 * tasks — replacing the report entirely.
 *
 * Issue #1719: the dashboard's `overdue_tasks_table` / `due_today` widgets
 * were count-only `table` widgets on the `task_metrics` dataset — a single
 * summary row, not the record listing they intended. They are re-modelled
 * here as the `overdue` / `due_today` views, surfaced via app navigation;
 * the dashboard keeps the counts on its `metric` widgets.
 */
export const TaskViews = defineView({
  list: {
    label: 'All Tasks',
    type: 'grid',
    data,
    columns: [
      { field: 'subject' },
      { field: 'status' },
      { field: 'priority' },
      { field: 'due_date' },
      { field: 'owner' },
      { field: 'category' },
    ],
  },

  listViews: {
    // Replaces the legacy `overdue_tasks` report.
    overdue: {
      label: 'Overdue Tasks',
      type: 'grid',
      data,
      columns: [
        { field: 'subject' },
        { field: 'due_date' },
        { field: 'priority' },
        { field: 'owner' },
        { field: 'category' },
      ],
      // [#7226] "Overdue" asked the removed `is_overdue`/`is_completed` flags,
      // which nothing maintained — so this view was permanently EMPTY. It now
      // asks the stored, indexed columns that carry the same fact: past due, and
      // not finished. `{today}` is the platform date macro, resolved per request.
      filter: [
        { field: 'due_date', operator: 'less_than', value: '{today}' },
        { field: 'status', operator: 'not_equals', value: 'completed' },
      ],
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    // Replaces the dashboard's count-only `due_today` table widget (#1719).
    due_today: {
      label: 'Due Today',
      type: 'grid',
      data,
      columns: [
        { field: 'subject' },
        { field: 'priority' },
        { field: 'status' },
        { field: 'owner' },
        { field: 'category' },
      ],
      // [#7226] `is_completed == false` was vacuously true for every row; it now
      // asks `status` directly so a completed task really does drop out.
      filter: [
        { field: 'due_date', operator: 'equals', value: '{today}' },
        { field: 'status', operator: 'not_equals', value: 'completed' },
      ],
      sort: [{ field: 'priority', order: 'desc' }],
    },
  },
});
