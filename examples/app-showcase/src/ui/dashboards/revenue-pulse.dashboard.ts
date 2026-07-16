// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ChartConfig, ChartType, Dashboard } from '@objectstack/spec/ui';

const invoiceDs = 'showcase_invoice_metrics';
const accountDs = 'showcase_account_metrics';

const cfg = (type: ChartType, dimension: string, measure: string): ChartConfig => ({
  type,
  xAxis: { field: dimension, showGridLines: true, logarithmic: false },
  yAxis: [{ field: measure, showGridLines: true, logarithmic: false }],
  showLegend: true,
  showDataLabels: false,
});

/**
 * Revenue Pulse — the dashboard-level filters demo (framework#2501,
 * objectui#2578): one date range + one region filter driving charts over
 * TWO different objects, each widget mapping the filter to ITS OWN field
 * via `filterBindings`:
 *
 *   • the date range's default field is the invoice `issued_on`; account
 *     widgets re-map it to `signed_on` (`filterBindings: { dateRange:
 *     'signed_on' }`) — the field simply doesn't exist on accounts;
 *   • the shared "region" filter's default field is the invoice `region`;
 *     account widgets re-map it to `sales_region`;
 *   • one KPI opts out of both (`false`) as the fixed all-time reference.
 *
 * Changing either filter live re-scopes every bound widget — the acceptance
 * scenario of framework#2501 on a real backend + seed data.
 */
export const RevenuePulseDashboard: Dashboard = {
  name: 'showcase_revenue_pulse',
  label: 'Revenue Pulse',
  description: 'Dashboard-level date + region filters driving invoice and account charts — each widget binds the filters to its own fields.',
  columns: 12,
  dateRange: { field: 'issued_on', defaultRange: 'last_90_days', allowCustomRange: true },
  globalFilters: [
    {
      name: 'region',
      field: 'region',
      label: 'Region',
      type: 'select',
      options: [
        { value: 'amer', label: 'AMER' },
        { value: 'emea', label: 'EMEA' },
        { value: 'apac', label: 'APAC' },
      ],
      scope: 'dashboard',
    },
  ],
  widgets: [
    // ── KPI row ──────────────────────────────────────────────────────────
    // Default bindings: dateRange → issued_on, region → region (invoice side).
    { id: 'kpi_invoices', type: 'metric', title: 'Invoices', dataset: invoiceDs, values: ['invoice_count'], colorVariant: 'blue', layout: { x: 0, y: 0, w: 3, h: 2 } },
    { id: 'kpi_invoice_subtotal', type: 'metric', title: 'Invoiced Subtotal', dataset: invoiceDs, values: ['subtotal_sum'], colorVariant: 'success', layout: { x: 3, y: 0, w: 3, h: 2 } },
    // Account side: both filters re-mapped to this object's own fields.
    { id: 'kpi_new_accounts', type: 'metric', title: 'Accounts Signed', dataset: accountDs, values: ['account_count'], colorVariant: 'teal', filterBindings: { dateRange: 'signed_on', region: 'sales_region' }, layout: { x: 6, y: 0, w: 3, h: 2 } },
    // Fixed reference: opted out of BOTH dashboard filters.
    { id: 'kpi_accounts_alltime', type: 'metric', title: 'Accounts (all time)', dataset: accountDs, values: ['account_count'], colorVariant: 'purple', filterBindings: { dateRange: false, region: false }, layout: { x: 9, y: 0, w: 3, h: 2 } },

    // ── Trends + distribution ────────────────────────────────────────────
    { id: 'line_invoices_by_month', type: 'line', title: 'Invoices by Month', dataset: invoiceDs, dimensions: ['issued_on'], values: ['invoice_count'], chartConfig: cfg('line', 'issued_on', 'invoice_count'), layout: { x: 0, y: 2, w: 6, h: 4 } },
    { id: 'col_accounts_by_month', type: 'column', title: 'Accounts Signed by Month', dataset: accountDs, dimensions: ['signed_on'], values: ['account_count'], chartConfig: cfg('column', 'signed_on', 'account_count'), filterBindings: { dateRange: 'signed_on', region: 'sales_region' }, layout: { x: 6, y: 2, w: 6, h: 4 } },
    { id: 'donut_invoices_by_status', type: 'donut', title: 'Invoices by Status', dataset: invoiceDs, dimensions: ['status'], values: ['invoice_count'], chartConfig: cfg('donut', 'status', 'invoice_count'), layout: { x: 0, y: 6, w: 6, h: 4 } },
    { id: 'bar_accounts_by_industry', type: 'bar', title: 'Accounts by Industry', dataset: accountDs, dimensions: ['industry'], values: ['account_count'], chartConfig: cfg('bar', 'industry', 'account_count'), filterBindings: { dateRange: 'signed_on', region: 'sales_region' }, layout: { x: 6, y: 6, w: 6, h: 4 } },
  ],
};
