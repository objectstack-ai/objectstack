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
  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    { name: 'priority', label: 'Priority', field: 'priority', type: 'string' },
    { name: 'progress', label: 'Progress', field: 'progress', type: 'number' },
    { name: 'created_at', label: 'Created', field: 'created_at', type: 'date', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'task_count', label: 'Tasks', aggregate: 'count' },
    { name: 'est_hours', label: 'Estimated Hours', aggregate: 'sum', field: 'estimate_hours', format: '0.0' },
    { name: 'avg_estimate', label: 'Avg Estimate', aggregate: 'avg', field: 'estimate_hours', format: '0.0' },
    { name: 'avg_progress', label: 'Avg Progress', aggregate: 'avg', field: 'progress', format: '0.0' },
  ],
});

/** Project analytics — budget / spend over showcase_project. */
export const ShowcaseProjectDataset = defineDataset({
  name: 'showcase_project_metrics',
  label: 'Project Metrics',
  object: 'showcase_project',
  dimensions: [
    { name: 'account', label: 'Account', field: 'account', type: 'lookup' },
    // status / health added for the Operations dashboard — power the
    // "by health" chart and the filtered KPI tiles (active / at-risk).
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    { name: 'health', label: 'Health', field: 'health', type: 'string' },
  ],
  measures: [
    { name: 'project_count', label: 'Projects', aggregate: 'count' },
    // `budget`/`spent` are currency fields with NO fixed currency (no
    // `currencyConfig`, so no currency of their own). The column's currency
    // resolves through the measure's own `currency` → the field's
    // `currencyConfig.defaultCurrency`, read only under `currencyMode: 'fixed'`
    // → the tenant `localization.currency` default; with none set it shows a
    // plain grouped number (never a hardcoded "$"). To pin a symbol, set a
    // measure `currency`, or give the field a fixed currency:
    // `currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD' }`.
    { name: 'budget_sum', label: 'Total Budget', aggregate: 'sum', field: 'budget', format: '0,0' },
    { name: 'spent_sum', label: 'Total Spent', aggregate: 'sum', field: 'spent', format: '0,0' },
  ],
});
