// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

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
  },

  listViews: {
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
        groupByField: 'status',
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
        xAxisField: 'status',
        yAxisFields: ['estimate_hours'],
        aggregation: 'sum',
        groupByField: 'priority',
        // ADR-0021 dual-form — bind to the task dataset.
        dataset: 'showcase_task_metrics',
        dimensions: ['status', 'priority'],
        values: ['est_hours'],
      },
    },
  },

  formViews: {
    // simple ── single-section form ──────────────────────────────────────
    default: {
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

    // split ── master-detail split pane ──────────────────────────────────
    split: {
      type: 'split',
      data,
      sections: [{ label: 'Task', columns: 1, fields: ['title', 'status', 'assignee'] }],
    },

    // drawer ── side panel quick edit ────────────────────────────────────
    quick: {
      type: 'drawer',
      data,
      sections: [{ label: 'Quick Edit', columns: 1, fields: ['status', 'priority', 'progress'] }],
    },
  },
});
