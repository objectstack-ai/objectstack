// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateChartBindings,
  CHART_DIMENSION_UNKNOWN,
  CHART_MEASURE_UNKNOWN,
  CHART_DATASET_UNKNOWN,
  CHART_AXIS_NOT_SELECTED,
} from './validate-chart-bindings.js';

/** A dataset whose measure names deliberately differ from the base fields. */
const baseStack = () => ({
  datasets: [
    {
      name: 'task_metrics',
      object: 'showcase_task',
      dimensions: [{ name: 'status', field: 'status' }, { name: 'priority', field: 'priority' }],
      measures: [
        { name: 'task_count', aggregate: 'count' },
        { name: 'est_hours', aggregate: 'sum', field: 'estimate_hours' },
      ],
    },
  ],
});

describe('validateChartBindings — report charts', () => {
  // The HotCRM instance: an axis naming the RAW FIELD instead of the measure.
  it('errors on a yAxis naming a raw field rather than a dataset measure', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'hours_by_status',
          dataset: 'task_metrics',
          rows: ['status'],
          values: ['est_hours'],
          chart: { type: 'bar', xAxis: 'status', yAxis: 'estimate_hours' },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].path).toBe('reports[0].chart.yAxis');
    expect(findings[0].message).toContain('estimate_hours');
    expect(findings[0].hint).toContain('est_hours');
  });

  // The dashboard rule's `Array.isArray(yAxis)` guard would skip this shape.
  it('handles the report string yAxis, not just the array form', () => {
    const clean = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'ok',
          dataset: 'task_metrics',
          values: ['est_hours'],
          chart: { type: 'bar', xAxis: 'status', yAxis: 'est_hours' },
        },
      ],
    });
    expect(clean).toEqual([]);
  });

  it('errors on an xAxis naming an undeclared dimension', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'r',
          dataset: 'task_metrics',
          values: ['task_count'],
          chart: { type: 'bar', xAxis: 'assignee', yAxis: 'task_count' },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_DIMENSION_UNKNOWN);
    expect(findings[0].path).toBe('reports[0].chart.xAxis');
  });

  it('warns when the yAxis measure is declared but not selected', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'r',
          dataset: 'task_metrics',
          values: ['task_count'],
          chart: { type: 'bar', xAxis: 'status', yAxis: 'est_hours' },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(CHART_AXIS_NOT_SELECTED);
  });

  it('errors on an unresolvable dataset', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        { name: 'r', dataset: 'task_metric', values: [], chart: { type: 'bar', xAxis: 'status', yAxis: 'x' } },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_DATASET_UNKNOWN);
    expect(findings[0].hint).toContain('Did you mean "task_metrics"?');
  });

  it('checks a joined report block chart against the block dataset', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'joined',
          type: 'joined',
          blocks: [
            {
              name: 'b1',
              dataset: 'task_metrics',
              values: ['task_count'],
              chart: { type: 'pie', xAxis: 'ghost_dim', yAxis: 'task_count' },
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('reports[0].blocks[0].chart.xAxis');
  });

  it('checks report series names as measures', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'r',
          dataset: 'task_metrics',
          values: ['task_count'],
          chart: { type: 'bar', xAxis: 'status', yAxis: 'task_count', series: [{ name: 'ghost_measure' }] },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('reports[0].chart.series[0].name');
  });
});

describe('validateChartBindings — list-view charts', () => {
  it('errors on an unknown measure in views[].listViews', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [
        {
          name: 'showcase_task',
          listViews: {
            chart: {
              type: 'chart',
              chart: { chartType: 'bar', dataset: 'task_metrics', dimensions: ['status'], values: ['estimate_hours'] },
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].path).toBe('views[0].listViews.chart.chart.values[0]');
  });

  it('errors on an unknown dimension in views[].list', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [
        {
          name: 'v',
          list: { chart: { chartType: 'bar', dataset: 'task_metrics', dimensions: ['ghost'], values: ['task_count'] } },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_DIMENSION_UNKNOWN);
    expect(findings[0].path).toBe('views[0].list.chart.dimensions[0]');
  });

  it('checks object-level listViews too', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      objects: [
        {
          name: 'showcase_task',
          fields: {},
          listViews: {
            by_status: {
              chart: { chartType: 'pie', dataset: 'task_metrics', dimensions: ['status'], values: ['ghost'] },
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('objects[0].listViews.by_status.chart.values[0]');
  });

  it('accepts a fully resolved list chart', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [
        {
          name: 'v',
          listViews: {
            chart: { chart: { chartType: 'bar', dataset: 'task_metrics', dimensions: ['status'], values: ['est_hours'] } },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateChartBindings — dataset-bound page chart components', () => {
  it('checks dimensions/values and a ChartConfig-style yAxis', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      pages: [
        {
          name: 'command_center',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-chart',
                  properties: {
                    dataset: 'task_metrics',
                    chartType: 'bar',
                    dimensions: ['status'],
                    values: ['task_count'],
                    yAxis: [{ field: 'estimate_hours', stepSize: 1 }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.yAxis[0].field',
    );
  });

  it('accepts a resolved page chart', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      pages: [
        {
          name: 'p',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-chart',
                  properties: {
                    dataset: 'task_metrics',
                    dimensions: ['status'],
                    values: ['task_count'],
                    yAxis: [{ field: 'task_count' }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('leaves an object-bound chart component alone (no dataset key)', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      pages: [
        {
          name: 'p',
          regions: [
            {
              name: 'main',
              components: [
                {
                  type: 'object-chart',
                  properties: {
                    objectName: 'showcase_invoice',
                    aggregate: { field: 'total', function: 'sum', groupBy: 'status' },
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toEqual([]);
  });
});

describe('validateChartBindings — floor', () => {
  it('is silent with no charts anywhere and tolerates empty input', () => {
    expect(validateChartBindings(baseStack())).toEqual([]);
    expect(validateChartBindings({})).toEqual([]);
    expect(validateChartBindings(null as unknown as Record<string, unknown>)).toEqual([]);
  });

  it('ignores a report with no chart', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [{ name: 'plain', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] }],
    });
    expect(findings).toEqual([]);
  });

  it('does not mistake a tree view named "org_chart" for a chart', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [{ name: 'business_unit', listViews: { org_chart: { type: 'tree' } } }],
    });
    expect(findings).toEqual([]);
  });
});
