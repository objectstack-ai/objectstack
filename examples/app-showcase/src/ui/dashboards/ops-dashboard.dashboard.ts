// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { ChartConfig, ChartType, Dashboard } from '@objectstack/spec/ui';

const taskDs = 'showcase_task_metrics';
const projectDs = 'showcase_project_metrics';

const cfg = (type: ChartType, dimension: string, measure: string): ChartConfig => ({
  type,
  xAxis: { field: dimension, showGridLines: true, logarithmic: false },
  yAxis: [{ field: measure, showGridLines: true, logarithmic: false }],
  showLegend: true,
  showDataLabels: false,
});

/**
 * Delivery Operations — a *believable business* dashboard (vs the Chart Gallery,
 * which is one-of-every-chart). It composes the patterns a real ops landing page
 * needs:
 *   • a KPI hero row of `metric` tiles, each scoped by a per-widget `filter`
 *     (active projects, at-risk projects, awaiting-review tasks) — the same
 *     dataset, sliced different ways;
 *   • comparison / distribution / trend charts underneath;
 *   • a global `dateRange` (created_at) that every widget inherits, and a global
 *     `task_status` filter that re-scopes the TASK side of the board only.
 *
 * Everything binds the semantic datasets by name (ADR-0021), so a metric is
 * defined once and reused.
 *
 * ## Why the project widgets opt out of `task_status` (#7568)
 *
 * A dashboard filter is broadcast into EVERY widget's analytics query
 * (framework#2501); a widget with no `filterBindings` inherits it on its own
 * object's like-named field. `task_status` carries the `showcase_task.status`
 * vocabulary (backlog / todo / in_progress / in_review / done), and
 * `showcase_project` also has a `status` field — with a completely different
 * vocabulary (planned / active / on_hold / completed / cancelled). So the
 * inherited binding was field-valid and value-empty: every project-bound widget
 * emitted `WHERE status = 'in_review'` against `showcase_project` and answered
 * `200 OK` with a zero. Four tiles and a chart read 0 for any selection while
 * the filter bar looked like it was working.
 *
 * The two status vocabularies are disjoint, so there is no project field to
 * re-target to — the honest binding is an opt-out. Each project-bound widget
 * therefore declares `filterBindings: { task_status: false }`, the same
 * per-widget mechanism the Revenue Pulse dashboard uses to map `region` →
 * `sales_region` across two objects, and the one the Studio widget inspector
 * authors (objectui#2586). `dateRange` is left inherited on purpose: projects
 * DO carry `created_at`, so that filter is meaningful on both sides.
 *
 * Read the pair together and the filter's reach is legible from the metadata
 * alone: it is named for the vocabulary it carries, and every widget it does
 * NOT govern says so on its own line.
 */
export const OpsDashboard: Dashboard = {
  name: 'showcase_ops_dashboard',
  label: 'Delivery Operations',
  description: 'Operations landing page — KPI hero row, project health, and task throughput.',
  columns: 12,
  dateRange: { field: 'created_at', defaultRange: 'last_90_days', allowCustomRange: true },
  globalFilters: [
    {
      // Named for the vocabulary it carries, not for the column it happens to
      // sit on: `status` exists on BOTH showcase objects, so the bare name made
      // an opt-out read as "ignore project status" instead of "this control is
      // about tasks". `filterBindings` keys reference this `name` (#7568).
      name: 'task_status',
      field: 'status',
      label: 'Task Status',
      type: 'select',
      options: [
        { value: 'backlog', label: 'Backlog' },
        { value: 'todo', label: 'To Do' },
        { value: 'in_progress', label: 'In Progress' },
        { value: 'in_review', label: 'In Review' },
        { value: 'done', label: 'Done' },
      ],
      scope: 'dashboard',
    },
  ],
  widgets: [
    // ── KPI hero row — same project dataset, sliced by per-widget filter ──
    // Project-bound widgets opt out of `task_status` (see the note above); the
    // task-bound tile inherits it and composes it with its own filter.
    { id: 'kpi_active_projects', type: 'metric', title: 'Active Projects', dataset: projectDs, values: ['project_count'], filter: { status: 'active' }, filterBindings: { task_status: false }, colorVariant: 'blue', layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 'kpi_at_risk', type: 'metric', title: 'At-Risk (Red)', dataset: projectDs, values: ['project_count'], filter: { health: 'red' }, filterBindings: { task_status: false }, colorVariant: 'danger', layout: { x: 3, y: 0, w: 3, h: 2 } },
    { id: 'kpi_awaiting_review', type: 'metric', title: 'Awaiting Review', dataset: taskDs, values: ['task_count'], filter: { status: 'in_review' }, colorVariant: 'warning', layout: { x: 6, y: 0, w: 3, h: 2 } },
    { id: 'kpi_total_budget', type: 'metric', title: 'Total Budget', dataset: projectDs, values: ['budget_sum'], filterBindings: { task_status: false }, colorVariant: 'success', layout: { x: 9, y: 0, w: 3, h: 2 } },

    // ── Health + throughput ──────────────────────────────────────────────
    { id: 'col_health', type: 'column', title: 'Projects by Health', dataset: projectDs, dimensions: ['health'], values: ['project_count'], chartConfig: cfg('column', 'health', 'project_count'), filterBindings: { task_status: false }, layout: { x: 0, y: 2, w: 4, h: 4 } },
    { id: 'bar_status', type: 'bar', title: 'Tasks by Status', dataset: taskDs, dimensions: ['status'], values: ['task_count'], chartConfig: cfg('bar', 'status', 'task_count'), layout: { x: 4, y: 2, w: 4, h: 4 } },
    { id: 'donut_priority', type: 'donut', title: 'Priority Mix', dataset: taskDs, dimensions: ['priority'], values: ['task_count'], chartConfig: cfg('donut', 'priority', 'task_count'), layout: { x: 8, y: 2, w: 4, h: 4 } },

    // ── Trend + account spend ────────────────────────────────────────────
    { id: 'line_created', type: 'line', title: 'Task Throughput (monthly)', dataset: taskDs, dimensions: ['created_at'], values: ['task_count'], chartConfig: cfg('line', 'created_at', 'task_count'), layout: { x: 0, y: 6, w: 6, h: 4 } },
    // The fifth project-bound widget — same opt-out. #7568's body names four
    // (the tiles a reader watches drop to 0); this table zeroed with them,
    // silently, because an empty table reads as "no data" rather than as a
    // broken filter.
    { id: 'table_spend', type: 'table', title: 'Budget vs Spent by Account', dataset: projectDs, dimensions: ['account'], values: ['project_count', 'budget_sum', 'spent_sum'], filterBindings: { task_status: false }, layout: { x: 6, y: 6, w: 6, h: 4 } },
  ],
};
