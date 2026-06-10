// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { UI } from '@objectstack/spec';

/**
 * Example report — total opportunity amount grouped by stage.
 *
 * ADR-0021 Phase 2: bound to the `opportunity_metrics` dataset (rows = stage,
 * values = total_amount) alongside the legacy inline query. The legacy form was
 * also corrected to actually group + sum (it previously listed rows flat despite
 * its "grouped by stage" label), so both forms compute the same number and the
 * reconciliation harness can verify them.
 */
export const SalesByStageReport: UI.Report = {
  name: 'crm_sales_by_stage',
  label: 'Sales by Stage',
  description: 'Total opportunity amount grouped by sales stage.',
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['total_amount'],
};
