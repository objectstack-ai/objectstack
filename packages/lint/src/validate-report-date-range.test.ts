// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateReportDateRange as validateReportDateRangeUnrecorded,
  REPORT_DATE_RANGE_DIMENSION_UNKNOWN,
  REPORT_DATE_RANGE_DIMENSION_NOT_DATE,
  REPORT_DATE_RANGE_DIMENSION_AMBIGUOUS,
  REPORT_DATE_RANGE_DIMENSION_NONE,
} from './validate-report-date-range.js';
import { explainRule } from './rule-explanations.js';
import { validateReferenceIntegrity } from './reference-integrity-suite.js';

// Every call records what it fired; the last cases hold each recorded verdict
// to one line of at most 200 characters (the one-verdict-per-finding shape).
const fired: Array<{ rule: string; message: string; hint: string }> = [];
const validateReportDateRange: typeof validateReportDateRangeUnrecorded = (...args) => {
  const findings = validateReportDateRangeUnrecorded(...args);
  fired.push(...findings);
  return findings;
};

/**
 * `examples/app-todo`'s task dataset shape: two `type: 'date'` dimensions, so
 * a report on it has to name which one its period applies to.
 */
const TASK_METRICS = {
  name: 'task_metrics',
  object: 'todo_task',
  dimensions: [
    { name: 'status', field: 'status', type: 'string' },
    { name: 'owner', field: 'owner', type: 'lookup' },
    { name: 'due_date', field: 'due_date', type: 'date' },
    { name: 'completed_date', field: 'completed_date', type: 'date' },
    // A date COLUMN that does not declare `type: 'date'` is a string axis.
    { name: 'created', field: 'created_at' },
  ],
  measures: [{ name: 'task_count', aggregate: 'count' }],
};

const ONE_DATE = {
  name: 'deal_metrics',
  object: 'deal',
  dimensions: [
    { name: 'stage', field: 'stage', type: 'string' },
    { name: 'close_date', field: 'close_date', type: 'date', dateGranularity: 'quarter' },
  ],
  measures: [{ name: 'amount_sum', aggregate: 'sum', field: 'amount' }],
};

const NO_DATE = {
  name: 'region_metrics',
  object: 'deal',
  dimensions: [{ name: 'region', field: 'region', type: 'string' }],
  measures: [{ name: 'deal_count', aggregate: 'count' }],
};

const stack = (report: Record<string, unknown>) => ({
  datasets: [TASK_METRICS, ONE_DATE, NO_DATE],
  reports: [{ name: 'r', label: 'R', type: 'summary', rows: ['status'], values: ['task_count'], dataset: 'task_metrics', ...report }],
});

describe('validateReportDateRange — a named dimension', () => {
  it('is clean when it names a `type: \'date\'` dimension', () => {
    expect(validateReportDateRange(stack({ dateRange: { dimension: 'due_date' } }))).toEqual([]);
  });

  it('errors on a name the dataset does not declare, listing its date dimensions', () => {
    const [f, ...rest] = validateReportDateRange(stack({ dateRange: { dimension: 'due_dat' } }));
    expect(rest).toEqual([]);
    expect(f!.rule).toBe(REPORT_DATE_RANGE_DIMENSION_UNKNOWN);
    expect(f!.severity).toBe('error');
    expect(f!.path).toBe('reports[0].dateRange.dimension');
    expect(f!.where).toBe('report "r" · dateRange');
    expect(f!.hint).toContain('(completed_date, due_date)');
    expect(f!.hint).toContain('Did you mean "due_date"?');
  });

  it('never suggests a dimension the window would refuse — the nearest name among DATE dimensions only', () => {
    // `statu` is one edit from `status`, which is not a date dimension.
    const [f] = validateReportDateRange(stack({ dateRange: { dimension: 'statu' } }));
    expect(f!.rule).toBe(REPORT_DATE_RANGE_DIMENSION_UNKNOWN);
    expect(f!.hint).not.toContain('"status"');
  });

  it.each([['status'], ['owner'], ['created']])('errors on `%s`, a declared dimension that is not a date', (dimension) => {
    const [f, ...rest] = validateReportDateRange(stack({ dateRange: { dimension } }));
    expect(rest).toEqual([]);
    expect(f!.rule).toBe(REPORT_DATE_RANGE_DIMENSION_NOT_DATE);
    expect(f!.path).toBe('reports[0].dateRange.dimension');
    expect(f!.message).toContain(`dimension "${dimension}" of dataset "task_metrics"`);
  });
});

describe('validateReportDateRange — an omitted dimension', () => {
  it('is clean when the dataset declares exactly one date dimension', () => {
    expect(validateReportDateRange(stack({ dataset: 'deal_metrics', rows: ['stage'], values: ['amount_sum'], dateRange: {} }))).toEqual([]);
  });

  it('errors when the dataset declares several, naming them', () => {
    const [f, ...rest] = validateReportDateRange(stack({ dateRange: { defaultRange: 'this_quarter' } }));
    expect(rest).toEqual([]);
    expect(f!.rule).toBe(REPORT_DATE_RANGE_DIMENSION_AMBIGUOUS);
    expect(f!.path).toBe('reports[0].dateRange');
    expect(f!.message).toContain('declares 2 date dimensions (completed_date, due_date)');
    expect(f!.hint).toContain("`dimension: 'completed_date'`");
  });

  it('errors when the dataset declares none', () => {
    const [f, ...rest] = validateReportDateRange(stack({ dataset: 'region_metrics', rows: ['region'], values: ['deal_count'], dateRange: {} }));
    expect(rest).toEqual([]);
    expect(f!.rule).toBe(REPORT_DATE_RANGE_DIMENSION_NONE);
    expect(f!.path).toBe('reports[0].dateRange');
  });
});

describe('validateReportDateRange — what it does not judge', () => {
  it('is silent on a report with no `dateRange`', () => {
    expect(validateReportDateRange(stack({}))).toEqual([]);
  });

  it('is silent on a dataset that resolves to nothing — `chart-dataset-unknown` reports it, once', () => {
    const s = stack({ dataset: 'no_such_dataset', dateRange: {} });
    expect(validateReportDateRange(s)).toEqual([]);
    const suite = validateReferenceIntegrity(s);
    expect(suite.filter((f) => f.rule === 'chart-dataset-unknown')).toHaveLength(1);
    expect(suite.filter((f) => f.rule.startsWith('report-date-range-'))).toEqual([]);
  });

  it('is silent on a joined report — the schema refuses its `dateRange`', () => {
    expect(validateReportDateRange(stack({ type: 'joined', dataset: undefined, dateRange: {} }))).toEqual([]);
  });

  it('never throws on malformed input', () => {
    expect(validateReportDateRange({ reports: [null, 3, { dateRange: 'x' }], datasets: [null] } as never)).toEqual([]);
    expect(validateReportDateRange(null as never)).toEqual([]);
  });

  it('runs inside the reference-integrity suite (os validate / os lint / os build)', () => {
    const suite = validateReferenceIntegrity(stack({ dateRange: {} }));
    expect(suite.map((f) => f.rule)).toContain(REPORT_DATE_RANGE_DIMENSION_AMBIGUOUS);
  });
});

describe('validateReportDateRange — verdict shape', () => {
  it('every fired verdict is one line of at most 200 characters, and every id has an explanation', () => {
    expect(fired.length).toBeGreaterThan(0);
    for (const f of fired) {
      expect(f.message, f.rule).not.toContain('\n');
      expect(f.message.length, f.message).toBeLessThanOrEqual(200);
      expect(f.hint, f.rule).not.toContain('\n');
    }
    for (const rule of [
      REPORT_DATE_RANGE_DIMENSION_UNKNOWN,
      REPORT_DATE_RANGE_DIMENSION_NOT_DATE,
      REPORT_DATE_RANGE_DIMENSION_AMBIGUOUS,
      REPORT_DATE_RANGE_DIMENSION_NONE,
    ]) {
      expect(fired.some((f) => f.rule === rule), `${rule} fired in this file`).toBe(true);
      expect(explainRule(rule)?.rule, rule).toBe(rule);
    }
  });
});
