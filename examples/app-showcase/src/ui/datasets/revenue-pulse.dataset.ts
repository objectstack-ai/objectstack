// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Datasets backing the Revenue Pulse dashboard (framework#2501) — two
 * DIFFERENT base objects on one dashboard, so the dashboard-level filters
 * demonstrably re-scope cross-object: the date range hits `issued_on` on
 * invoices vs `signed_on` on accounts, and the shared "region" filter hits
 * `region` vs `sales_region`, each mapped per widget via `filterBindings`.
 */

/** Invoice analytics — counts by status / month / region over showcase_invoice. */
export const ShowcaseInvoiceDataset = defineDataset({
  name: 'showcase_invoice_metrics',
  label: 'Invoice Metrics',
  object: 'showcase_invoice',
  dimensions: [
    { name: 'status', label: 'Status', field: 'status', type: 'string' },
    { name: 'region', label: 'Region', field: 'region', type: 'string' },
    { name: 'issued_on', label: 'Issued', field: 'issued_on', type: 'date', dateGranularity: 'month' },
    { name: 'account', label: 'Account', field: 'account', type: 'lookup' },
  ],
  measures: [
    { name: 'invoice_count', label: 'Invoices', aggregate: 'count' },
    { name: 'subtotal_sum', label: 'Subtotal', aggregate: 'sum', field: 'total', format: '0,0' },
  ],
});

/** Account analytics — counts / revenue by industry / region over showcase_account. */
export const ShowcaseAccountDataset = defineDataset({
  name: 'showcase_account_metrics',
  label: 'Account Metrics',
  object: 'showcase_account',
  dimensions: [
    { name: 'industry', label: 'Industry', field: 'industry', type: 'string' },
    { name: 'status', label: 'Lifecycle', field: 'status', type: 'string' },
    { name: 'sales_region', label: 'Sales Region', field: 'sales_region', type: 'string' },
    { name: 'signed_on', label: 'Customer Since', field: 'signed_on', type: 'date', dateGranularity: 'month' },
  ],
  measures: [
    { name: 'account_count', label: 'Accounts', aggregate: 'count' },
    { name: 'revenue_sum', label: 'Annual Revenue', aggregate: 'sum', field: 'annual_revenue', format: '0,0' },
  ],
});
