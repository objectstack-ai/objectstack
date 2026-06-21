// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Opportunity analytics dataset (ADR-0021).
 *
 * The single semantic source of truth for pipeline metrics. The Pipeline
 * dashboard binds every widget to this dataset and selects measures BY NAME
 * (`total_amount`, `avg_amount`, `opp_count`) so "pipeline revenue" means the
 * same thing on every tile. Single-object dataset (no `include`).
 */
export const OpportunityDataset = defineDataset({
  name: 'opportunity_metrics',
  label: 'Opportunity Metrics',
  description: 'Semantic layer for sales-pipeline counts and amounts',
  object: 'crm_opportunity',

  dimensions: [
    { name: 'stage', label: 'Stage', field: 'stage', type: 'string' },
    // Lookup dimension — the analytics layer resolves the account FK to its
    // display name in `rows`, but exposes the raw FK via drillRawRows so a
    // report drill filters by the stored id (ADR-0021 D2), not the name.
    { name: 'account', label: 'Account', field: 'account', type: 'lookup' },
    // ADR-0021 single-form: the monthly bucketing the trend widget used to carry
    // as `categoryGranularity: 'month'` now lives on the dimension itself.
    { name: 'close_date', label: 'Close Date', field: 'close_date', type: 'date', dateGranularity: 'month' },
  ],

  measures: [
    { name: 'opp_count', label: 'Opportunities', aggregate: 'count' },
    { name: 'total_amount', label: 'Total Amount', aggregate: 'sum', field: 'amount', format: '0,0', currency: 'USD' },
    { name: 'avg_amount', label: 'Avg Deal Size', aggregate: 'avg', field: 'amount', format: '0,0', currency: 'USD' },
  ],
});
