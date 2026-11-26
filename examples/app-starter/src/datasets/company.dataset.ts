// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

/**
 * Company counts (ADR-0021): the dashboard's company tiles bind here and
 * select the dimension and measure by name.
 */
export const CompanyDataset = defineDataset({
  name: 'starter_company_metrics',
  label: 'Company Metrics',
  description: 'How many companies there are, by type and by industry',
  object: 'starter_company',

  dimensions: [
    {
      name: 'type',
      label: 'Type',
      field: 'type',
      type: 'string',
      description: 'What the company is to the organization: Prospect, Customer, Partner, Supplier or Other.',
      synonyms: ['company type', 'relationship', '公司类型', '类型'],
    },
    {
      name: 'industry',
      label: 'Industry',
      field: 'industry',
      type: 'string',
      description:
        'The industry the company works in: Technology, Manufacturing, Retail, Finance, Healthcare, Education '
        + 'or Other. A company with no industry set is counted under no industry.',
      synonyms: ['sector', 'business area', '行业', '所属行业'],
    },
  ],

  measures: [
    {
      name: 'company_count',
      label: 'Companies',
      aggregate: 'count',
      description: 'How many companies there are, whatever their type.',
      synonyms: ['number of companies', 'company total', '公司数', '公司数量'],
    },
  ],
});
