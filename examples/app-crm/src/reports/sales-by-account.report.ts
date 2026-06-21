// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type * as UI from '@objectstack/spec/ui';

/**
 * Example report — total opportunity amount grouped by ACCOUNT.
 *
 * Bound to `opportunity_metrics` with rows = `account`, a LOOKUP dimension.
 * The analytics layer resolves each account FK to its display name in `rows`,
 * but exposes the raw FK via `drillRawRows` + `dimensionFields` (ADR-0021 D2),
 * so drilling a row filters the opportunity list by the account's stored id —
 * not its (possibly non-unique) display name. Paired with the currency-aware
 * `total_amount` measure (USD), this exercises both render paths — Intl
 * currency formatting AND raw-value lookup drill — end to end.
 */
export const SalesByAccountReport: UI.ReportInput = {
  name: 'crm_sales_by_account',
  label: 'Sales by Account',
  description: 'Total opportunity amount grouped by account (lookup-dimension drill).',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['account'],
  values: ['total_amount'],
};
