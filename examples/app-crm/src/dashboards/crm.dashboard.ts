// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * CRM Overview Dashboard
 *
 * Single-page snapshot of revenue, pipeline, and customer activity. Designed
 * to mirror the polished CRM dashboard reference at
 * https://github.com/objectstack-ai/objectui/tree/main/examples/crm/src/dashboards
 * — KPI tiles with trend indicators and icons, an area-chart revenue trend, a
 * lead-source donut, a pipeline funnel, and a recent-deals table.
 *
 * This dashboard intentionally uses the framework's first-class metadata fields
 * (colorVariant, chartConfig, header, dateRange, descriptions, action buttons)
 * rather than ad-hoc hex strings stuffed into `options.color`.
 */
export const CrmOverviewDashboard: Dashboard = {
  name: 'crm_overview_dashboard',
  label: 'CRM Overview',
  description: 'Revenue metrics, pipeline analytics, and deal insights',

  columns: 12,
  gap: 4,
  refreshInterval: 300,

  header: {
    showTitle: true,
    showDescription: true,
    actions: [
      { label: 'New Deal',   icon: 'Plus',     actionType: 'modal', actionUrl: 'create_opportunity' },
      { label: 'New Lead',   icon: 'Sparkles', actionType: 'modal', actionUrl: 'create_lead' },
      { label: 'Reports',    icon: 'bar-chart', actionType: 'url',  actionUrl: '/reports' },
    ],
  },

  dateRange: {
    field: 'close_date',
    defaultRange: 'this_quarter',
    allowCustomRange: true,
  },

  globalFilters: [
    {
      field: 'owner',
      label: 'Owner',
      type: 'lookup',
      scope: 'dashboard',
      optionsFrom: { object: 'user', valueField: 'id', labelField: 'name' },
    },
  ],

  widgets: [
    // ─── KPI Row ──────────────────────────────────────────────────────
    {
      id: 'total_revenue',
      title: 'Total Revenue',
      description: 'Closed-won revenue this period',
      type: 'metric',
      object: 'opportunity',
      filter: { stage: 'closed_won' },
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'success',
      actionUrl: '/reports/revenue',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: {
        icon: 'DollarSign',
        format: '$0,0',
        prefix: '$',
        trend: { value: 12.5, direction: 'up', label: 'vs last month' },
      },
    },
    {
      id: 'active_deals',
      title: 'Active Deals',
      description: 'Open opportunities in the pipeline',
      type: 'metric',
      object: 'opportunity',
      filter: { stage: { $nin: ['closed_won', 'closed_lost'] } },
      aggregate: 'count',
      colorVariant: 'blue',
      actionUrl: '/objects/opportunity?filter=open',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: {
        icon: 'Briefcase',
        format: '0,0',
        trend: { value: 2.1, direction: 'down', label: 'vs last month' },
      },
    },
    {
      id: 'won_deals',
      title: 'Won Deals',
      description: 'Closed-won deals this period',
      type: 'metric',
      object: 'opportunity',
      filter: { stage: 'closed_won' },
      valueField: 'id',
      aggregate: 'count',
      colorVariant: 'purple',
      actionUrl: '/reports/win-rate',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 6, y: 0, w: 3, h: 2 },
      options: {
        icon: 'Trophy',
        format: '0,0',
        trend: { value: 4.3, direction: 'up', label: 'vs last month' },
      },
    },
    {
      id: 'avg_deal_size',
      title: 'Avg Deal Size',
      description: 'Average value of closed-won deals',
      type: 'metric',
      object: 'opportunity',
      filter: { stage: 'closed_won' },
      valueField: 'amount',
      aggregate: 'avg',
      colorVariant: 'orange',
      actionUrl: '/reports/avg-deal-size',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 9, y: 0, w: 3, h: 2 },
      options: {
        icon: 'bar-chart',
        format: '$0,0',
        prefix: '$',
        trend: { value: 1.2, direction: 'up', label: 'vs last month' },
      },
    },

    // ─── Charts Row 1 ─────────────────────────────────────────────────
    {
      id: 'revenue_trends',
      title: 'Revenue Trends',
      description: 'Closed-won revenue over the last 12 months',
      type: 'area',
      object: 'opportunity',
      filter: { stage: 'closed_won', close_date: { $gte: '{last_12_months}' } },
      categoryField: 'close_date',
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'success',
      layout: { x: 0, y: 2, w: 9, h: 4 },
      chartConfig: {
        type: 'area',
        showLegend: false,
        showDataLabels: false,
        colors: ['#10B981'],
        xAxis: { field: 'close_date', title: 'Month', showGridLines: false, logarithmic: false },
        yAxis: [{ field: 'amount', title: 'Revenue', format: '$0,0', showGridLines: true, logarithmic: false }],
        interaction: { tooltips: true, brush: true, zoom: false },
      },
      options: { dateGranularity: 'month' },
    },
    {
      id: 'lead_source',
      title: 'Lead Source',
      description: 'Pipeline value by acquisition channel',
      type: 'donut',
      object: 'opportunity',
      categoryField: 'lead_source',
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'purple',
      layout: { x: 9, y: 2, w: 3, h: 4 },
      chartConfig: {
        type: 'donut',
        showLegend: true,
        showDataLabels: true,
        colors: ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
      },
    },

    // ─── Charts Row 2 ─────────────────────────────────────────────────
    {
      id: 'pipeline_by_stage',
      title: 'Pipeline by Stage',
      description: 'Open opportunity value at each sales stage',
      type: 'funnel',
      object: 'opportunity',
      filter: { stage: { $nin: ['closed_won', 'closed_lost'] } },
      categoryField: 'stage',
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'teal',
      layout: { x: 0, y: 6, w: 6, h: 4 },
      chartConfig: {
        type: 'funnel',
        showLegend: false,
        showDataLabels: true,
        colors: ['#0EA5E9', '#06B6D4', '#14B8A6', '#10B981', '#22C55E'],
      },
    },
    {
      id: 'top_products',
      title: 'Top Products',
      description: 'Total list-price revenue by product category',
      type: 'bar',
      object: 'product',
      categoryField: 'category',
      valueField: 'list_price',
      aggregate: 'sum',
      colorVariant: 'blue',
      layout: { x: 6, y: 6, w: 6, h: 4 },
      chartConfig: {
        type: 'bar',
        showLegend: false,
        showDataLabels: true,
        colors: ['#4F46E5'],
        xAxis: { field: 'category', title: 'Category', showGridLines: false, logarithmic: false },
        yAxis: [{ field: 'list_price', title: 'Revenue', format: '$0,0', showGridLines: true, logarithmic: false }],
      },
    },

    // ─── Recent Deals Table ───────────────────────────────────────────
    {
      id: 'recent_opportunities',
      title: 'Recent Opportunities',
      description: 'Most recently updated deals across the team',
      type: 'table',
      object: 'opportunity',
      aggregate: 'count',
      colorVariant: 'default',
      layout: { x: 0, y: 10, w: 12, h: 4 },
      options: {
        columns: [
          { header: 'Opportunity', accessorKey: 'name' },
          { header: 'Account',     accessorKey: 'account' },
          { header: 'Amount',      accessorKey: 'amount', format: '$0,0' },
          { header: 'Stage',       accessorKey: 'stage' },
          { header: 'Probability', accessorKey: 'probability', format: '0%' },
          { header: 'Close Date',  accessorKey: 'close_date', format: 'MMM D, YYYY' },
          { header: 'Owner',       accessorKey: 'owner' },
        ],
        sortBy: 'last_modified_date',
        sortOrder: 'desc',
        limit: 10,
        striped: true,
        density: 'comfortable',
      },
    },
  ],
};
