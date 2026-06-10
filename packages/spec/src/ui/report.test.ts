// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  ReportSchema,
  ReportChartSchema,
  ReportType,
  Report,
  JoinedReportBlockSchema,
} from './report.zod';

/**
 * ADR-0021 single-form: a report binds a `dataset` and selects `rows`
 * (dimensions) + `values` (measures). The legacy inline `objectName` +
 * `columns` + `groupings` query was removed in the cutover. A `joined` report
 * carries its data on `blocks`, each itself dataset-bound.
 */
describe('ReportSchema (dataset-bound)', () => {
  it('accepts a summary report (dataset + rows + values)', () => {
    const r = ReportSchema.parse({
      name: 'sales_by_stage', label: 'Sales by Stage', type: 'summary',
      dataset: 'sales', rows: ['stage'], values: ['revenue'],
    });
    expect(r.dataset).toBe('sales');
    expect(r.rows).toEqual(['stage']);
  });

  it('accepts a matrix report (rows = down × across, flattened) + runtimeFilter', () => {
    const r = ReportSchema.parse({
      name: 'hours_matrix', label: 'Hours', type: 'matrix',
      dataset: 'tasks', rows: ['owner', 'category'], values: ['est_hours', 'actual_hours'],
      runtimeFilter: { is_completed: true },
    });
    expect(r.rows).toHaveLength(2);
    expect(r.runtimeFilter).toEqual({ is_completed: true });
  });

  it('accepts an embedded chart', () => {
    const r = ReportSchema.parse({
      name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'],
      chart: { type: 'bar', xAxis: 'stage', yAxis: 'revenue' },
    });
    expect(r.chart?.xAxis).toBe('stage');
  });

  it('rejects a (non-joined) report with no dataset', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'summary', rows: ['stage'], values: ['revenue'] })).toThrow();
  });

  it('rejects a (non-joined) report with no values', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'] })).toThrow();
  });

  it('a report supplying only the removed inline fields is invalid', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'summary', objectName: 'opportunity', columns: [{ field: 'amount' }] } as any)).toThrow();
  });

  it('Report.create factory parses + returns a typed report', () => {
    const r = Report.create({ name: 'rep_x', label: 'R', type: 'summary', dataset: 'sales', rows: ['stage'], values: ['revenue'] });
    expect(r.name).toBe('rep_x');
  });

  it('ReportType enum', () => {
    expect(ReportType.parse('matrix')).toBe('matrix');
    expect(() => ReportType.parse('nope')).toThrow();
  });
});

describe('Joined reports', () => {
  it('accepts a joined report whose blocks are dataset-bound', () => {
    const r = ReportSchema.parse({
      name: 'overview', label: 'Overview', type: 'joined',
      blocks: [
        { name: 'open_block', label: 'Open', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'], runtimeFilter: { done: false } },
        { name: 'done_block', label: 'Done', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'], runtimeFilter: { done: true } },
      ],
    });
    expect(r.blocks).toHaveLength(2);
  });

  it('rejects a joined report with no blocks', () => {
    expect(() => ReportSchema.parse({ name: 'rep_x', label: 'R', type: 'joined' })).toThrow();
  });

  it('JoinedReportBlockSchema parses a dataset-bound block', () => {
    const b = JoinedReportBlockSchema.parse({ name: 'blk_x', type: 'summary', dataset: 'tasks', rows: ['status'], values: ['task_count'] });
    expect(b.dataset).toBe('tasks');
  });
});

describe('ReportChartSchema', () => {
  it('requires xAxis + yAxis', () => {
    expect(ReportChartSchema.parse({ type: 'bar', xAxis: 'stage', yAxis: 'revenue' }).type).toBe('bar');
    expect(() => ReportChartSchema.parse({ type: 'bar' })).toThrow();
  });
});
