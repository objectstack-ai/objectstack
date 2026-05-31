// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_project' };

/** Project views — grid + a status Kanban + a budget chart. */
export const ProjectViews = defineView({
  list: {
    label: 'All Projects',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'account' },
      { field: 'status' },
      { field: 'health' },
      { field: 'budget' },
      { field: 'budget_remaining' },
      { field: 'end_date' },
    ],
  },
  listViews: {
    by_status: {
      label: 'By Status',
      type: 'kanban',
      data,
      columns: ['name', 'account', 'budget'],
      kanban: { groupByField: 'status', summarizeField: 'budget', columns: ['name', 'account', 'budget'] },
    },
    budget_chart: {
      label: 'Budget by Account',
      type: 'chart',
      data,
      columns: ['account', 'budget'],
      chart: { chartType: 'bar', xAxisField: 'account', yAxisFields: ['budget', 'spent'], aggregation: 'sum' },
    },
  },
  formViews: {
    default: {
      type: 'simple',
      data,
      sections: [
        { label: 'Project', columns: 2, fields: ['name', 'account', 'status', 'health', 'owner'] },
        { label: 'Budget & Schedule', columns: 2, fields: ['budget', 'spent', 'start_date', 'end_date'] },
      ],
    },
  },
});
