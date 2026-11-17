// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Datasets backing the Chart Gallery dashboard (ADR-0021). Every gallery widget
 * binds to one of these and selects dimensions/measures BY NAME, so the same
 * metric ("task count", "hours", "budget") is defined once.
 */

/** Task analytics — counts, hours, progress over showcase_task. */
export const ShowcaseTaskDataset = defineDataset({
  name: 'showcase_task_metrics',
  label: 'Task Metrics',
  object: 'showcase_task',
  // Every member carries `synonyms` (ADR-0149 D1): the words a person types in
  // a question, every language in the one list; matched, never translated.
  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string', synonyms: ['task status', '任务状态'] },
    { name: 'priority', label: 'Priority', field: 'priority', type: 'string', synonyms: ['urgency', '优先级'] },
    {
      name: 'progress', label: 'Progress', field: 'progress', type: 'number',
      synonyms: ['percent complete', 'completion percentage', '进度'],
    },
    {
      name: 'created_at', label: 'Created', field: 'created_at', type: 'date', dateGranularity: 'month',
      synonyms: ['created date', 'creation month', '创建时间', '创建月份'],
    },
  ],
  measures: [
    { name: 'task_count', label: 'Tasks', aggregate: 'count', synonyms: ['number of tasks', '任务数', '任务数量'] },
    {
      name: 'est_hours', label: 'Estimated Hours', aggregate: 'sum', field: 'estimate_hours', format: '0.0',
      synonyms: ['planned hours', 'estimated effort', '预估工时'],
    },
    {
      name: 'avg_estimate', label: 'Avg Estimate', aggregate: 'avg', field: 'estimate_hours', format: '0.0',
      synonyms: ['average estimate', 'average estimated hours', '平均预估工时'],
    },
    {
      name: 'avg_progress', label: 'Avg Progress', aggregate: 'avg', field: 'progress', format: '0.0',
      synonyms: ['average progress', 'average completion', '平均进度'],
    },
    // The done rate, moved here from the `showcase_delivery` cube (#20943): a
    // cube member's `sql` is a column reference, and this is the declared
    // form of what its CASE expression computed — a count scoped by its own
    // structured filter, over the unfiltered count. `ratio` yields a 0–1
    // fraction (the cube's expression multiplied by 100), which the `%`
    // pattern displays as a percentage; the server annotates the column's
    // scale from the operator, as it does for `paid_rate`.
    {
      name: 'done_count', label: 'Done Tasks', aggregate: 'count', filter: { status: 'done' },
      synonyms: ['completed tasks', 'finished tasks', '已完成任务数'],
    },
    {
      name: 'done_rate',
      label: 'Done Rate',
      derived: { op: 'ratio', of: ['done_count', 'task_count'] },
      format: '0.0%',
      synonyms: ['completion rate', 'percent done', '完成率'],
    },
  ],
});

/** Project analytics — budget / spend over showcase_project. */
export const ShowcaseProjectDataset = defineDataset({
  name: 'showcase_project_metrics',
  label: 'Project Metrics',
  object: 'showcase_project',
  // Every member carries `synonyms` (ADR-0149 D1): the words a person types in
  // a question, every language in the one list; matched, never translated.
  dimensions: [
    { name: 'account', label: 'Account', field: 'account', type: 'lookup', synonyms: ['customer', 'client', '客户'] },
    // status / health added for the Operations dashboard — power the
    // "by health" chart and the filtered KPI tiles (active / at-risk).
    { name: 'status', label: 'Status', field: 'status', type: 'string', synonyms: ['project status', '项目状态'] },
    { name: 'health', label: 'Health', field: 'health', type: 'string', synonyms: ['project health', '项目健康度'] },
  ],
  measures: [
    {
      name: 'project_count', label: 'Projects', aggregate: 'count',
      synonyms: ['number of projects', '项目数', '项目数量'],
    },
    // `budget`/`spent` are currency fields with a FIXED currency
    // (`currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' }`).
    // The column's currency resolves through the measure's own `currency` →
    // the field's `currencyConfig.defaultCurrency`, read only under
    // `currencyMode: 'fixed'` → the tenant `localization.currency` default, so
    // these measures need no `currency` of their own (never a hardcoded "$"
    // in `format`). `0,0.00` writes a total the way the Projects list writes
    // an amount, with two decimals. The Command Center's `cc_k6` tile, which
    // aggregates `budget` without this dataset, declares the same pattern and
    // currency, so both dashboards read one total budget alike.
    {
      name: 'budget_sum', label: 'Total Budget', aggregate: 'sum', field: 'budget', format: '0,0.00',
      synonyms: ['budget', 'planned budget', '预算', '总预算'],
    },
    {
      name: 'spent_sum', label: 'Total Spent', aggregate: 'sum', field: 'spent', format: '0,0.00',
      synonyms: ['spend', 'actual spend', '支出', '已花费'],
    },
  ],
});
