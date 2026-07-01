// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

export const OpportunityViews = defineView({
  list: {
    label: 'All Opportunities',
    type: 'grid',
    data: { provider: 'object', object: 'crm_opportunity' },
    columns: [
      { field: 'name' },
      { field: 'account' },
      { field: 'stage' },
      { field: 'amount' },
      { field: 'probability' },
      { field: 'expected_revenue' },
      { field: 'close_date' },
    ],
    exportOptions: ['csv', 'xlsx', 'json'],
  },
  listViews: {
    all: {
      label: 'All Opportunities',
      data: { provider: 'object', object: 'crm_opportunity' },
      type: 'grid',
      columns: [
        { field: 'name' },
        { field: 'account' },
        { field: 'stage' },
        { field: 'amount' },
        { field: 'probability' },
        { field: 'expected_revenue' },
        { field: 'close_date' },
      ],
      exportOptions: ['csv', 'xlsx', 'json'],
    },
    pipeline: {
      label: 'Pipeline (Kanban)',
      type: 'kanban',
      data: { provider: 'object', object: 'crm_opportunity' },
      columns: ['name', 'account', 'amount', 'close_date'],
      kanban: {
        groupByField: 'stage',
        summarizeField: 'amount',
        columns: ['name', 'account', 'amount', 'close_date'],
      },
    },
  },
  formViews: {
    default: {
      type: 'simple',
      data: { provider: 'object', object: 'crm_opportunity' },
      sections: [
        {
          label: 'Opportunity',
          columns: 2,
          fields: [
            { field: 'name', required: true },
            { field: 'account', required: true },
            { field: 'stage', required: true },
            { field: 'amount' },
            { field: 'probability' },
            { field: 'close_date' },
          ],
        },
      ],
    },
  },
});
