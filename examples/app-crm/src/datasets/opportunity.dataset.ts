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
  name: 'crm_opportunity_metrics',
  label: 'Opportunity Metrics',
  description: 'Semantic layer for sales-pipeline counts and amounts',
  object: 'crm_opportunity',

  // ADR-0149 D1 business vocabulary. `synonyms` are the words a person types in
  // a question, every language in the one list (they are matched, never drawn,
  // and never translated); `description` is a plain business definition of the
  // member, not an instruction to a model (M1, ruled A), and IS translated at
  // `datasets.crm_opportunity_metrics.{dimensions,measures}.<member>.description`.
  dimensions: [
    {
      name: 'stage',
      label: 'Stage',
      field: 'stage',
      type: 'string',
      description:
        'Where the opportunity stands in the sales process: Prospecting, Qualification, Proposal, '
        + 'Closed Won or Closed Lost. The first three are the open pipeline; the last two are finished deals.',
      synonyms: ['sales stage', 'deal stage', 'pipeline stage', '销售阶段', '商机阶段', '漏斗阶段'],
    },
    // Lookup dimension — the analytics layer resolves the account FK to its
    // display name in `rows`, but exposes the raw FK via drillRawRows so a
    // report drill filters by the stored id (ADR-0021 D2), not the name.
    {
      name: 'account',
      label: 'Account',
      field: 'account',
      type: 'lookup',
      description:
        'The customer company the opportunity is being sold to. Every opportunity belongs to exactly one account; '
        + 'results show the account name.',
      synonyms: ['customer', 'client', 'company', '客户', '公司', '客户名称'],
    },
    // ADR-0021 single-form: the monthly bucketing the trend widget used to carry
    // as `categoryGranularity: 'month'` now lives on the dimension itself.
    {
      name: 'close_date',
      label: 'Close Date',
      field: 'close_date',
      type: 'date',
      dateGranularity: 'month',
      description:
        'The date the deal closed, or for an open opportunity the date it is expected to close, grouped by '
        + 'calendar month. It is not the date the opportunity was created.',
      synonyms: ['closing month', 'expected close date', '成交日期', '预计成交日期', '成交月份'],
    },
  ],

  // The amount measures carry no `currency`: they inherit the `amount` field's
  // currency, which is the tenant default (ADR-0104 D1). A hard-coded code here
  // would print `$` for a tenant whose books are in another currency.
  measures: [
    {
      name: 'opp_count',
      label: 'Opportunities',
      aggregate: 'count',
      description:
        'How many opportunities there are, at every stage: open, won and lost alike. '
        + 'To count won deals only, narrow it to the Closed Won stage.',
      synonyms: ['deal count', 'number of deals', '商机数', '商机数量', '机会数'],
    },
    {
      name: 'total_amount',
      label: 'Total Amount',
      aggregate: 'sum',
      field: 'amount',
      format: '0,0',
      description:
        'The sum of the Amount of every opportunity at every stage, open, won and lost alike, so it is neither '
        + 'the open pipeline nor booked revenue. Open pipeline is this total narrowed to the three open stages; '
        + 'won revenue is it narrowed to Closed Won.',
      synonyms: ['deal value', 'opportunity amount', '商机金额', '金额合计'],
    },
    {
      name: 'avg_amount',
      label: 'Avg Deal Size',
      aggregate: 'avg',
      field: 'amount',
      format: '0,0',
      description:
        'The average Amount of one opportunity, at every stage: open, won and lost alike. '
        + 'Opportunities with no amount entered are left out of the average.',
      synonyms: ['average deal value', 'average opportunity amount', '平均商机金额'],
    },
  ],
});
