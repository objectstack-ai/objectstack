import { describe, it, expect } from 'vitest';
import {
  ReportSchema,
  ReportColumnSchema,
  ReportGroupingSchema,
  ReportChartSchema,
  ReportType,
  Report,
  type ReportColumn,
  type ReportGrouping,
  type ReportChart,
} from './report.zod';

describe('ReportType', () => {
  it('should accept valid report types', () => {
    const validTypes = ['tabular', 'summary', 'matrix', 'joined'];

    validTypes.forEach(type => {
      expect(() => ReportType.parse(type)).not.toThrow();
    });
  });

  it('should reject invalid report types', () => {
    expect(() => ReportType.parse('list')).toThrow();
    expect(() => ReportType.parse('grid')).toThrow();
    expect(() => ReportType.parse('')).toThrow();
  });
});

describe('ReportColumnSchema', () => {
  it('should accept valid minimal column', () => {
    const column: ReportColumn = {
      field: 'name',
    };

    expect(() => ReportColumnSchema.parse(column)).not.toThrow();
  });

  it('should accept column with all fields', () => {
    const column = ReportColumnSchema.parse({
      field: 'amount',
      label: 'Total Amount',
      aggregate: 'sum',
    });

    expect(column.label).toBe('Total Amount');
    expect(column.aggregate).toBe('sum');
  });

  it('should accept different aggregate functions', () => {
    const aggregates: Array<NonNullable<ReportColumn['aggregate']>> = ['sum', 'avg', 'max', 'min', 'count', 'unique'];

    aggregates.forEach(aggregate => {
      const column = ReportColumnSchema.parse({
        field: 'value',
        aggregate,
      });
      expect(column.aggregate).toBe(aggregate);
    });
  });

  it('should reject invalid aggregate function', () => {
    expect(() => ReportColumnSchema.parse({
      field: 'value',
      aggregate: 'median',
    })).toThrow();
  });
});

describe('ReportGroupingSchema', () => {
  it('should accept valid minimal grouping', () => {
    const grouping: ReportGrouping = {
      field: 'category',
    };

    expect(() => ReportGroupingSchema.parse(grouping)).not.toThrow();
  });

  it('should apply default sort order', () => {
    const grouping = ReportGroupingSchema.parse({
      field: 'category',
    });

    expect(grouping.sortOrder).toBe('asc');
  });

  it('should accept grouping with all fields', () => {
    const grouping = ReportGroupingSchema.parse({
      field: 'created_date',
      sortOrder: 'desc',
      dateGranularity: 'month',
    });

    expect(grouping.sortOrder).toBe('desc');
    expect(grouping.dateGranularity).toBe('month');
  });

  it('should accept different sort orders', () => {
    const orders: Array<ReportGrouping['sortOrder']> = ['asc', 'desc'];

    orders.forEach(sortOrder => {
      const grouping = ReportGroupingSchema.parse({
        field: 'name',
        sortOrder,
      });
      expect(grouping.sortOrder).toBe(sortOrder);
    });
  });

  it('should accept different date granularities', () => {
    const granularities: Array<NonNullable<ReportGrouping['dateGranularity']>> = ['day', 'week', 'month', 'quarter', 'year'];

    granularities.forEach(dateGranularity => {
      const grouping = ReportGroupingSchema.parse({
        field: 'date',
        dateGranularity,
      });
      expect(grouping.dateGranularity).toBe(dateGranularity);
    });
  });
});

describe('ReportChartSchema', () => {
  it('should accept valid minimal chart', () => {
    const chart: ReportChart = {
      type: 'bar',
      xAxis: 'category',
      yAxis: 'total_amount',
    };

    expect(() => ReportChartSchema.parse(chart)).not.toThrow();
  });

  it('should apply default showLegend', () => {
    const chart = ReportChartSchema.parse({
      type: 'pie',
      xAxis: 'category',
      yAxis: 'count',
    });

    expect(chart.showLegend).toBe(true);
  });

  it('should accept chart with all fields', () => {
    const chart = ReportChartSchema.parse({
      type: 'column',
      title: 'Sales by Region',
      showLegend: false,
      xAxis: 'region',
      yAxis: 'total_sales',
    });

    expect(chart.title).toBe('Sales by Region');
    expect(chart.showLegend).toBe(false);
  });

  it('should accept different chart types', () => {
    const types: Array<ReportChart['type']> = [
      'bar', 'column', 'line', 'pie', 'donut', 'scatter', 'funnel',
      'area', 'gauge', 'treemap', 'sankey', 'metric'
    ];

    types.forEach(type => {
      const chart = ReportChartSchema.parse({
        type,
        xAxis: 'x',
        yAxis: 'y',
      });
      expect(chart.type).toBe(type);
    });
  });

  it('should reject invalid chart type', () => {
    expect(() => ReportChartSchema.parse({
      type: 'invalid-chart-type',
      xAxis: 'x',
      yAxis: 'y',
    })).toThrow();
  });
});

describe('ReportSchema', () => {
  it('should accept valid minimal report', () => {
    const report = Report.create({
      name: 'sales_report',
      label: 'Sales Report',
      objectName: 'opportunity',
      columns: [
        { field: 'name' },
        { field: 'amount' },
      ],
    });

    expect(report.name).toBe('sales_report');
  });

  it('should validate report name format (snake_case)', () => {
    expect(() => ReportSchema.parse({
      name: 'valid_report_name',
      label: 'Valid Report',
      objectName: 'account',
      columns: [{ field: 'name' }],
    })).not.toThrow();

    expect(() => ReportSchema.parse({
      name: 'InvalidReport',
      label: 'Invalid',
      objectName: 'account',
      columns: [{ field: 'name' }],
    })).toThrow();

    expect(() => ReportSchema.parse({
      name: 'invalid-report',
      label: 'Invalid',
      objectName: 'account',
      columns: [{ field: 'name' }],
    })).toThrow();
  });

  it('should apply default report type', () => {
    const report = ReportSchema.parse({
      name: 'test_report',
      label: 'Test Report',
      objectName: 'account',
      columns: [{ field: 'name' }],
    });

    expect(report.type).toBe('tabular');
  });

  it('should accept report with all fields', () => {
    const report = ReportSchema.parse({
      name: 'full_report',
      label: 'Full Report',
      description: 'Complete report with all features',
      objectName: 'opportunity',
      type: 'summary',
      columns: [
        { field: 'stage' },
        { field: 'amount', aggregate: 'sum', label: 'Total Amount' },
      ],
      groupingsDown: [
        { field: 'stage', sortOrder: 'asc' },
      ],
      filter: { stage: { $ne: 'Closed Lost' } },
      chart: {
        type: 'bar',
        title: 'Opportunities by Stage',
        xAxis: 'stage',
        yAxis: 'total_amount',
      },
    });

    expect(report.type).toBe('summary');
    expect(report.groupingsDown).toHaveLength(1);
    expect(report.chart).toBeDefined();
  });

  it('should accept different report types', () => {
    const types: Array<z.infer<typeof ReportType>> = ['tabular', 'summary', 'matrix', 'joined'];

    types.forEach(type => {
      const report = ReportSchema.parse({
        name: 'test_report',
        label: 'Test',
        objectName: 'account',
        type,
        columns: [{ field: 'name' }],
      });
      expect(report.type).toBe(type);
    });
  });

  it('should accept tabular report', () => {
    const report = ReportSchema.parse({
      name: 'account_list',
      label: 'Account List',
      objectName: 'account',
      type: 'tabular',
      columns: [
        { field: 'name' },
        { field: 'industry' },
        { field: 'annual_revenue' },
      ],
    });

    expect(report.type).toBe('tabular');
    expect(report.columns).toHaveLength(3);
  });

  it('should accept summary report with grouping', () => {
    const report = ReportSchema.parse({
      name: 'sales_by_region',
      label: 'Sales by Region',
      objectName: 'opportunity',
      type: 'summary',
      columns: [
        { field: 'region' },
        { field: 'amount', aggregate: 'sum' },
        { field: 'opportunity_id', aggregate: 'count' },
      ],
      groupingsDown: [
        { field: 'region', sortOrder: 'asc' },
      ],
    });

    expect(report.type).toBe('summary');
    expect(report.groupingsDown).toBeDefined();
  });

  it('should accept matrix report with row and column groupings', () => {
    const report = ReportSchema.parse({
      name: 'sales_matrix',
      label: 'Sales Matrix',
      objectName: 'opportunity',
      type: 'matrix',
      columns: [
        { field: 'amount', aggregate: 'sum' },
      ],
      groupingsDown: [
        { field: 'stage' },
      ],
      groupingsAcross: [
        { field: 'type' },
      ],
    });

    expect(report.type).toBe('matrix');
    expect(report.groupingsDown).toBeDefined();
    expect(report.groupingsAcross).toBeDefined();
  });

  it('should accept report with filter criteria', () => {
    const report = ReportSchema.parse({
      name: 'high_value_opportunities',
      label: 'High Value Opportunities',
      objectName: 'opportunity',
      columns: [{ field: 'name' }, { field: 'amount' }],
      filter: {
        amount: { $gte: 100000 },
        stage: { $ne: 'Closed Lost' },
      },
    });

    expect(report.filter).toBeDefined();
  });

  it('should accept report with embedded chart', () => {
    const report = ReportSchema.parse({
      name: 'revenue_chart',
      label: 'Revenue Chart',
      objectName: 'opportunity',
      columns: [
        { field: 'stage' },
        { field: 'amount', aggregate: 'sum' },
      ],
      groupingsDown: [{ field: 'stage' }],
      chart: {
        type: 'pie',
        title: 'Revenue by Stage',
        xAxis: 'stage',
        yAxis: 'total_amount',
      },
    });

    expect(report.chart?.type).toBe('pie');
  });

  it('should accept report with date grouping', () => {
    const report = ReportSchema.parse({
      name: 'monthly_sales',
      label: 'Monthly Sales',
      objectName: 'opportunity',
      type: 'summary',
      columns: [
        { field: 'close_date' },
        { field: 'amount', aggregate: 'sum' },
      ],
      groupingsDown: [
        { field: 'close_date', dateGranularity: 'month' },
      ],
    });

    expect(report.groupingsDown?.[0].dateGranularity).toBe('month');
  });

  it('should accept report with multiple aggregations', () => {
    const report = ReportSchema.parse({
      name: 'opportunity_stats',
      label: 'Opportunity Statistics',
      objectName: 'opportunity',
      columns: [
        { field: 'stage' },
        { field: 'amount', aggregate: 'sum', label: 'Total' },
        { field: 'amount', aggregate: 'avg', label: 'Average' },
        { field: 'amount', aggregate: 'max', label: 'Maximum' },
        { field: 'opportunity_id', aggregate: 'count', label: 'Count' },
      ],
      groupingsDown: [{ field: 'stage' }],
    });

    expect(report.columns).toHaveLength(5);
  });

  it('should reject report without required fields', () => {
    expect(() => ReportSchema.parse({
      label: 'Test Report',
      objectName: 'account',
      columns: [{ field: 'name' }],
    })).toThrow();

    expect(() => ReportSchema.parse({
      name: 'test_report',
      objectName: 'account',
      columns: [{ field: 'name' }],
    })).toThrow();

    expect(() => ReportSchema.parse({
      name: 'test_report',
      label: 'Test Report',
      columns: [{ field: 'name' }],
    })).toThrow();

    expect(() => ReportSchema.parse({
      name: 'test_report',
      label: 'Test Report',
      objectName: 'account',
    })).toThrow();
  });
});

describe('Report I18n Integration', () => {
  it('should reject i18n object as report label', () => {
    expect(() => ReportSchema.parse({
      name: 'i18n_report',
      label: { key: 'reports.sales', defaultValue: 'Sales Report' },
      objectName: 'opportunity',
      columns: [{ field: 'name' }],
    })).toThrow();
  });
  it('should reject i18n object as column label', () => {
    expect(() => ReportColumnSchema.parse({
      field: 'amount',
      label: { key: 'columns.amount', defaultValue: 'Amount' },
    })).toThrow();
  });
});

describe('Report ARIA Integration', () => {
  it('should accept report with ARIA attributes', () => {
    expect(() => ReportSchema.parse({
      name: 'accessible_report',
      label: 'Accessible Report',
      objectName: 'account',
      columns: [{ field: 'name' }],
      aria: { ariaLabel: 'Account listing report', role: 'table' },
    })).not.toThrow();
  });
});

describe('Report Responsive Integration', () => {
  it('should accept column with responsive config', () => {
    const result = ReportColumnSchema.parse({
      field: 'phone',
      label: 'Phone',
      responsive: { hiddenOn: ['xs', 'sm'] },
    });
    expect(result.responsive?.hiddenOn).toEqual(['xs', 'sm']);
  });
});

describe('Report Performance Integration', () => {
  it('should accept report with performance config', () => {
    expect(() => ReportSchema.parse({
      name: 'perf_report',
      label: 'Performance Report',
      objectName: 'opportunity',
      columns: [{ field: 'name' }],
      performance: { lazyLoad: true, pageSize: 50, virtualScroll: { enabled: true, itemHeight: 36 } },
    })).not.toThrow();
  });
});

// ============================================================================
// Negative / Inverse Validation Tests
// ============================================================================

describe('ReportSchema - Negative Validation', () => {
  it('should reject report without name', () => {
    expect(() => ReportSchema.parse({
      label: 'No Name Report',
      objectName: 'contact',
      columns: [{ field: 'name' }],
    })).toThrow();
  });

  it('should reject report without label', () => {
    expect(() => ReportSchema.parse({
      name: 'no_label',
      objectName: 'contact',
      columns: [{ field: 'name' }],
    })).toThrow();
  });

  it('should reject report without objectName', () => {
    expect(() => ReportSchema.parse({
      name: 'no_object',
      label: 'No Object Report',
      columns: [{ field: 'name' }],
    })).toThrow();
  });

  it('should reject report without columns', () => {
    expect(() => ReportSchema.parse({
      name: 'no_columns',
      label: 'No Columns Report',
      objectName: 'contact',
    })).toThrow();
  });

  it('should reject report with camelCase name', () => {
    expect(() => ReportSchema.parse({
      name: 'myReport',
      label: 'CamelCase Name',
      objectName: 'contact',
      columns: [{ field: 'name' }],
    })).toThrow();
  });

  it('should reject report with invalid type enum', () => {
    expect(() => ReportSchema.parse({
      name: 'invalid_type',
      label: 'Invalid Type',
      objectName: 'contact',
      type: 'pivot',
      columns: [{ field: 'name' }],
    })).toThrow();
  });

  it('should reject report column without field', () => {
    expect(() => ReportColumnSchema.parse({
      label: 'No Field',
    })).toThrow();
  });
});

describe('ReportSchema — dataset binding (ADR-0021 dual-form)', () => {
  it('accepts a dataset-bound report (dataset + values, no objectName/columns)', () => {
    expect(() => ReportSchema.parse({
      name: 'revenue_by_region',
      label: 'Revenue by Region',
      dataset: 'sales',
      rows: ['region'],
      values: ['revenue'],
    })).not.toThrow();
  });

  it('rejects a dataset-bound report with no values', () => {
    expect(() => ReportSchema.parse({
      name: 'bad', label: 'Bad', dataset: 'sales', rows: ['region'],
    })).toThrowError(/needs `values`/);
  });

  it('still accepts a legacy inline report (objectName + columns)', () => {
    expect(() => ReportSchema.parse({
      name: 'legacy', label: 'Legacy', objectName: 'crm_opportunity',
      columns: [{ field: 'amount', aggregate: 'sum' }],
    })).not.toThrow();
  });

  it('rejects an inline report missing objectName/columns (and no dataset)', () => {
    expect(() => ReportSchema.parse({ name: 'bad2', label: 'Bad2' }))
      .toThrowError(/needs `objectName`|needs `columns`/);
  });

  it('carries runtimeFilter on a dataset-bound report', () => {
    const r = ReportSchema.parse({
      name: 'scoped', label: 'Scoped', dataset: 'sales', values: ['revenue'],
      runtimeFilter: { stage: 'won' },
    });
    expect((r as any).runtimeFilter).toEqual({ stage: 'won' });
  });
});
