// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * Pipeline Dashboard — aggregate view of the sales pipeline.
 *
 * Demonstrates period-over-period comparison via `compareTo`, whose shape is
 * `{ kind, dimension? }` — the same contract the analytics executor reads
 * (`DatasetSelection.compareTo`). Every widget below omits `dimension`:
 * `opportunity_metrics` dates exactly one dimension (`close_date`), so the
 * executor resolves it. Name it explicitly (`{ kind: 'previousYear', dimension:
 * 'close_date' }`) only on a dataset that dates more than one — the executor
 * refuses to guess, and says which candidates it found.
 *
 * - **Won This Quarter** — metric with `compareTo: { kind: 'previousPeriod' }`.
 *   The filter uses `{current_quarter_start}` / `{current_quarter_end}`, so
 *   the renderer issues a parallel aggregate for Q-1 and shows a delta
 *   labelled "vs last quarter".
 * - **Avg Deal Size YoY** — metric with `compareTo: { kind: 'previousYear' }`
 *   to compare against the same window one year prior.
 * - **Pipeline Trend (12 months)** — line chart with
 *   `categoryGranularity: 'month'` bucketing and a
 *   `compareTo: { kind: 'previousYear' }` overlay, rendered as a dashed muted
 *   series on top of the current 12-month trend.
 * - **Opportunities by Stage** — bar chart with
 *   `compareTo: { kind: 'previousPeriod' }` to overlay the prior quarter.
 * - **Pipeline by Industry** — pie chart without `compareTo`
 *   (pie / donut / funnel ignore overlays even if set).
 */
export const PipelineDashboard: Dashboard = {
  name: 'pipeline_dashboard',
  label: 'Pipeline Dashboard',
  description: 'Aggregate view of the sales pipeline with period-over-period comparisons.',
  columns: 12,
  widgets: [
    // --- Row 1: KPI tiles -------------------------------------------------
    {
      id: 'total_pipeline',
      type: 'metric',
      title: 'Total Pipeline ($)',
      description: 'Sum of opportunity amounts across open stages.',
      filter: { stage: { $nin: ['closed_won', 'closed_lost'] } },
      dataset: 'opportunity_metrics',
      values: ['total_amount'],
      options: { format: 'currency', currency: 'USD' },
      layout: { x: 0, y: 0, w: 4, h: 2 },
    },
    {
      id: 'won_this_quarter',
      type: 'metric',
      title: 'Won This Quarter',
      description: 'Revenue closed-won in the current quarter, compared to the previous quarter.',
      filter: {
        stage: 'closed_won',
        close_date: {
          $gte: '{current_quarter_start}',
          $lte: '{current_quarter_end}',
        },
      },
      compareTo: { kind: 'previousPeriod' },
      dataset: 'opportunity_metrics',
      values: ['total_amount'],
      options: { format: 'currency', currency: 'USD' },
      layout: { x: 4, y: 0, w: 4, h: 2 },
    },
    {
      id: 'avg_deal_size_yoy',
      type: 'metric',
      title: 'Avg Deal Size (YoY)',
      description: 'Average won-deal value this year vs the same window last year.',
      filter: {
        stage: 'closed_won',
        close_date: {
          $gte: '{current_year_start}',
          $lte: '{current_year_end}',
        },
      },
      compareTo: { kind: 'previousYear' },
      dataset: 'opportunity_metrics',
      values: ['avg_amount'],
      options: { format: 'currency', currency: 'USD' },
      layout: { x: 8, y: 0, w: 4, h: 2 },
    },

    // --- Row 2: Trend + breakdown ----------------------------------------
    {
      id: 'pipeline_trend_90d',
      type: 'line',
      title: 'Pipeline Trend (12 months)',
      description: 'Opportunity count bucketed by close-month for the last year, with a sliding overlay of the prior year for compareTo.',
      filter: {
        close_date: { $gte: '{1_years_ago}', $lte: '{today}' },
      },
      compareTo: { kind: 'previousYear' },
      dataset: 'opportunity_metrics',
      dimensions: ['close_date'],
      values: ['opp_count'],
      // Axis fields name the dataset's dimension/measure (NOT base columns) —
      // post-cutover query rows are keyed by measure name (issue #1721).
      chartConfig: {
        type: 'line',
        xAxis: { field: 'close_date', showGridLines: true, logarithmic: false },
        yAxis: [{ field: 'opp_count', showGridLines: true, logarithmic: false }],
        showLegend: true,
        showDataLabels: false,
      },
      layout: { x: 0, y: 2, w: 8, h: 4 },
    },
    {
      id: 'opportunities_by_stage',
      type: 'bar',
      title: 'Opportunities by Stage',
      description: 'Count grouped by stage with previous-quarter overlay (compareTo).',
      filter: {
        close_date: {
          $gte: '{current_quarter_start}',
          $lte: '{current_quarter_end}',
        },
      },
      compareTo: { kind: 'previousPeriod' },
      dataset: 'opportunity_metrics',
      dimensions: ['stage'],
      values: ['opp_count'],
      chartConfig: {
        type: 'bar',
        xAxis: { field: 'stage', showGridLines: true, logarithmic: false },
        yAxis: [{ field: 'opp_count', showGridLines: true, logarithmic: false }],
        showLegend: true,
        showDataLabels: false,
      },
      layout: { x: 8, y: 2, w: 4, h: 4 },
    },

    // --- Row 3: Mix breakdown (pie ignores compareTo, even if set) -------
    {
      id: 'pipeline_by_industry',
      type: 'pie',
      title: 'Open Pipeline by Stage ($)',
      description: 'Open-pipeline revenue split by pipeline stage. Pie/donut/funnel ignore `compareTo`.',
      filter: { stage: { $nin: ['closed_won', 'closed_lost'] } },
      dataset: 'opportunity_metrics',
      dimensions: ['stage'],
      values: ['total_amount'],
      chartConfig: {
        type: 'pie',
        xAxis: { field: 'stage', showGridLines: true, logarithmic: false },
        yAxis: [{ field: 'total_amount', showGridLines: true, logarithmic: false }],
        showLegend: true,
        showDataLabels: false,
      },
      layout: { x: 0, y: 6, w: 6, h: 4 },
    },
  ],
};

