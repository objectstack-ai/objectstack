// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * Pipeline Dashboard — aggregate view of the sales pipeline.
 *
 * Demonstrates period-over-period comparison via `compareTo`:
 *
 * - **Won This Quarter** — metric with `compareTo: 'previousPeriod'`. The
 *   filter uses `{current_quarter_start}` / `{current_quarter_end}`, so
 *   the renderer issues a parallel aggregate for Q-1 and shows a delta
 *   labelled "vs last quarter".
 * - **Avg Deal Size YoY** — metric with `compareTo: 'previousYear'` to
 *   compare against the same window one year prior.
 * - **Pipeline Trend (12 months)** — line chart with
 *   `categoryGranularity: 'month'` bucketing and a `compareTo: 'previousYear'`
 *   overlay, rendered as a dashed muted series on top of the current
 *   12-month trend.
 * - **Opportunities by Stage** — bar chart with
 *   `compareTo: 'previousPeriod'` to overlay the prior quarter.
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
      compareTo: 'previousPeriod',
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
      compareTo: 'previousYear',
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
      compareTo: 'previousYear',
      dataset: 'opportunity_metrics',
      dimensions: ['close_date'],
      values: ['opp_count'],
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
      compareTo: 'previousPeriod',
      dataset: 'opportunity_metrics',
      dimensions: ['stage'],
      values: ['opp_count'],
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
      layout: { x: 0, y: 6, w: 6, h: 4 },
    },
  ],
};

