// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { Dashboard } from '@objectstack/spec/ui';

/**
 * Executive Overview Dashboard
 *
 * High-level revenue, customer, and pipeline KPIs for company leadership.
 * Designed to mirror the polished CRM dashboard reference at
 * https://github.com/objectstack-ai/objectui/tree/main/examples/crm — using
 * the framework's first-class metadata fields (colorVariant, chartConfig,
 * header, dateRange, descriptions, action buttons) instead of raw hex colors.
 */
export const ExecutiveDashboard: Dashboard = {
  name: 'executive_dashboard',
  label: 'Executive Overview',
  description: 'High-level revenue, customer, and pipeline KPIs for leadership',

  columns: 12,
  gap: 4,
  refreshInterval: 300, // 5 minutes

  header: {
    showTitle: true,
    showDescription: true,
    actions: [
      { label: 'Export PDF',     icon: 'Download',  actionType: 'script', actionUrl: 'export_dashboard_pdf' },
      { label: 'Schedule Email', icon: 'Mail',      actionType: 'modal',  actionUrl: 'schedule_dashboard_email' },
      { label: 'Customize',      icon: 'Settings',  actionType: 'modal',  actionUrl: 'customize_dashboard' },
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
    {
      field: 'lead_source',
      label: 'Lead Source',
      type: 'select',
      scope: 'dashboard',
      options: [
        { value: 'web',         label: 'Web' },
        { value: 'referral',    label: 'Referral' },
        { value: 'partner',     label: 'Partner' },
        { value: 'event',       label: 'Event' },
        { value: 'cold_call',   label: 'Cold Call' },
        { value: 'advertising', label: 'Advertising' },
      ],
    },
  ],

  widgets: [
    // ─── Row 1: Headline KPIs ─────────────────────────────────────────
    {
      id: 'total_revenue_ytd',
      title: 'Total Revenue (YTD)',
      description: 'Closed-won revenue this year',
      type: 'metric',
      object: 'opportunity',
      filter: { stage: 'closed_won', close_date: { $gte: '{current_year_start}' } },
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'success',
      actionUrl: '/reports/revenue-ytd',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 0, y: 0, w: 3, h: 2 },
      options: {
        icon: 'DollarSign',
        format: '$0,0',
        trend: { value: 12.5, direction: 'up', label: 'vs last quarter' },
      },
    },
    {
      id: 'total_accounts',
      title: 'Active Accounts',
      description: 'Customers with at least one active relationship',
      type: 'metric',
      object: 'account',
      filter: { is_active: true },
      aggregate: 'count',
      colorVariant: 'blue',
      actionUrl: '/objects/account',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 3, y: 0, w: 3, h: 2 },
      options: {
        icon: 'Building2',
        format: '0,0',
        trend: { value: 3.4, direction: 'up', label: 'vs last quarter' },
      },
    },
    {
      id: 'total_contacts',
      title: 'Total Contacts',
      description: 'People in our address book',
      type: 'metric',
      object: 'contact',
      aggregate: 'count',
      colorVariant: 'purple',
      actionUrl: '/objects/contact',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 6, y: 0, w: 3, h: 2 },
      options: {
        icon: 'Users',
        format: '0,0',
        trend: { value: 5.8, direction: 'up', label: 'vs last quarter' },
      },
    },
    {
      id: 'open_leads',
      title: 'Open Leads',
      description: 'Unconverted leads in the funnel',
      type: 'metric',
      object: 'lead',
      filter: { is_converted: false },
      aggregate: 'count',
      colorVariant: 'orange',
      actionUrl: '/objects/lead',
      actionType: 'url',
      actionIcon: 'ArrowUpRight',
      layout: { x: 9, y: 0, w: 3, h: 2 },
      options: {
        icon: 'Sparkles',
        format: '0,0',
        trend: { value: 1.2, direction: 'down', label: 'vs last quarter' },
      },
    },

    // ─── Row 2: Revenue Analysis ──────────────────────────────────────
    {
      id: 'revenue_trend',
      title: 'Revenue Trend',
      description: 'Closed-won revenue over the last 12 months',
      type: 'area',
      object: 'opportunity',
      filter: { stage: 'closed_won', close_date: { $gte: '{last_12_months}' } },
      categoryField: 'close_date',
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'success',
      layout: { x: 0, y: 2, w: 8, h: 4 },
      chartConfig: {
        type: 'area',
        title: 'Revenue Trend',
        subtitle: 'Last 12 months',
        showLegend: false,
        showDataLabels: false,
        colors: ['#10B981'],
        xAxis: { field: 'close_date', title: 'Month', showGridLines: false, logarithmic: false },
        yAxis: [{ field: 'amount', title: 'Revenue', format: '$0,0', showGridLines: true, logarithmic: false }],
        interaction: { tooltips: true, zoom: false, brush: true },
      },
      options: { dateGranularity: 'month' },
    },
    {
      id: 'revenue_by_industry',
      title: 'Revenue by Industry',
      description: 'YTD closed-won revenue split by customer industry',
      type: 'donut',
      object: 'opportunity',
      filter: { stage: 'closed_won', close_date: { $gte: '{current_year_start}' } },
      categoryField: 'account.industry',
      valueField: 'amount',
      aggregate: 'sum',
      colorVariant: 'blue',
      layout: { x: 8, y: 2, w: 4, h: 4 },
      chartConfig: {
        type: 'donut',
        showLegend: true,
        showDataLabels: true,
        colors: ['#4F46E5', '#06B6D4', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'],
      },
    },

    // ─── Row 3: Pipeline & Activity ───────────────────────────────────
    {
      id: 'pipeline_by_stage',
      title: 'Pipeline by Stage',
      description: 'Open opportunity value by sales stage',
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
      id: 'new_accounts_by_month',
      title: 'New Accounts',
      description: 'Account creation cadence — last 6 months',
      type: 'bar',
      object: 'account',
      filter: { created_at: { $gte: '{last_6_months}' } },
      categoryField: 'created_at',
      aggregate: 'count',
      colorVariant: 'purple',
      layout: { x: 6, y: 6, w: 6, h: 4 },
      chartConfig: {
        type: 'bar',
        showLegend: false,
        showDataLabels: true,
        colors: ['#8B5CF6'],
        xAxis: { field: 'created_at', title: 'Month', showGridLines: false, logarithmic: false },
        yAxis: [{ field: 'count', title: 'New accounts', showGridLines: true, logarithmic: false }],
      },
      options: { dateGranularity: 'month' },
    },

    // ─── Row 4: Top Customers ─────────────────────────────────────────
    {
      id: 'top_accounts_by_revenue',
      title: 'Top Accounts by Revenue',
      description: 'Largest customers ranked by annual revenue',
      type: 'table',
      object: 'account',
      aggregate: 'count',
      colorVariant: 'default',
      layout: { x: 0, y: 10, w: 12, h: 4 },
      options: {
        columns: [
          { header: 'Account',         accessorKey: 'name' },
          { header: 'Industry',        accessorKey: 'industry' },
          { header: 'Annual Revenue',  accessorKey: 'annual_revenue', format: '$0,0' },
          { header: 'Type',            accessorKey: 'type' },
          { header: 'Owner',           accessorKey: 'owner' },
        ],
        sortBy: 'annual_revenue',
        sortOrder: 'desc',
        limit: 10,
        striped: true,
        density: 'comfortable',
      },
    },
  ],
};
