// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// FROZEN bare-literal fixture (see log-call.action.ts).
import type { ReportInput } from '@objectstack/spec/ui';

export const AccountsByStageReport: ReportInput = {
  name: 'dc_accounts_by_stage',
  label: 'Accounts by Stage',
  description: 'Account count grouped by stage.',
  type: 'summary',
  dataset: 'dc_account_metrics',
  rows: ['stage'],
  values: ['account_count'],
};
