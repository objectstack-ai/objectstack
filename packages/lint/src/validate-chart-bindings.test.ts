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

  // #14577 — this rule used to carry a private Levenshtein-only `suggest`,
  // which gave NO hint for the issue's own headline example: `amount` →
  // `sum_amount` is 4 edits, over the `max(2, floor(len/3))` budget of 2. Now
  // delegating to the shared `suggestName` (#14268), the containment pre-pass
  // catches it — a dataset measure name containing the raw base-column name is
  // exactly the ADR-0021 cutover drift this rule exists to catch.
  it('offers a did-you-mean via containment for the base-column → measure-name drift', () => {
    const findings = validateChartBindings({
      datasets: [
        {
          name: 'sales_metrics',
          object: 'crm_opportunity',
          dimensions: [{ name: 'stage', field: 'stage' }],
          measures: [{ name: 'sum_amount', aggregate: 'sum', field: 'amount' }],
        },
      ],
      reports: [
        {
          name: 'r',
          dataset: 'sales_metrics',
          values: ['sum_amount'],
          chart: { type: 'bar', xAxis: 'stage', yAxis: 'amount' },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].hint).toContain('Did you mean "sum_amount"?');
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
    // #15575 — still reported, one tier down: see the block below for why.
    expect(findings[0].severity).toBe('warning');
  });
});

/**
 * #15575 — the per-position tier and consequence, pinned per surface against
 * the `@object-ui` revision `.objectui-sha` names. Each title names the
 * renderer line that decides it, as the `chart-field-unknown` tests do: the
 * tier follows that measurement, and a test that does not name it cannot be
 * re-checked when the pin moves.
 */
describe('validateChartBindings — binding vs presentation positions (#15575)', () => {
  const reportWith = (chart: Record<string, unknown>) => ({
    ...baseStack(),
    reports: [
      { name: 'r', dataset: 'task_metrics', values: ['task_count'], chart },
    ],
  });

  const pageWith = (properties: Record<string, unknown>) => ({
    ...baseStack(),
    pages: [
      {
        name: 'p',
        regions: [
          { name: 'main', components: [{ type: 'object-chart', properties }] },
        ],
      },
    ],
  });

  // ── report charts ──────────────────────────────────────────────────────
  it('report chart.yAxis stays ERROR — DatasetReportRenderer runs `useDatasetRows(dataset, [xAxis], [yAxis], …)`, i.e. "the embedded chart queries only `chart.xAxis` × `chart.yAxis`"', () => {
    const findings = validateChartBindings(
      reportWith({ type: 'bar', xAxis: 'status', yAxis: 'estimate_hours' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('reports[0].chart.yAxis');
    expect(findings[0].message).toContain('this series comes back empty');
  });

  it('report chart.series[].name is WARNING — `mergeAuthoredSeries` pairs an authored entry with the derived series whose key it EQUALS, so "an authored entry naming a measure that is NOT in the dataset selection is ignored"', () => {
    const findings = validateChartBindings(
      reportWith({
        type: 'bar',
        xAxis: 'status',
        yAxis: 'task_count',
        series: [{ name: 'estimate_hours', color: '#f00' }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('reports[0].chart.series[0].name');
    // The consequence the pin actually has — and NOT the one it refutes.
    expect(findings[0].message).toContain('DISPLAY-NAME override');
    expect(findings[0].message).toContain('lands on nothing');
    expect(findings[0].message).not.toContain('comes back empty');
    // No surface here carries `suppressWarnings` (dashboard widgets only), and
    // the hint says so rather than advertising a key that does not exist.
    expect(findings[0].hint).toContain('no `suppressWarnings` key');
  });

  it('one report chart reports BOTH tiers — the query position gates, the presentation position advises', () => {
    const findings = validateChartBindings(
      reportWith({
        type: 'bar',
        xAxis: 'status',
        yAxis: 'estimate_hours',
        series: [{ name: 'ghost' }],
      }),
    );
    expect(findings.map((f) => [f.path, f.severity])).toEqual([
      ['reports[0].chart.yAxis', 'error'],
      ['reports[0].chart.series[0].name', 'warning'],
    ]);
  });

  it('chart-axis-not-selected at a report series position drops the query sentence — the chart derives ONE series, from its own `chart.yAxis`', () => {
    const findings = validateChartBindings(
      reportWith({
        type: 'bar',
        xAxis: 'status',
        yAxis: 'task_count',
        series: [{ name: 'est_hours' }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_AXIS_NOT_SELECTED);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('display-name override');
    expect(findings[0].message).not.toContain('the query does not return it');
    expect(findings[0].hint).toContain('chart.yAxis');
  });

  it('chart-axis-not-selected at the report yAxis position keeps its wording — that position IS the query', () => {
    const findings = validateChartBindings(
      reportWith({ type: 'bar', xAxis: 'status', yAxis: 'est_hours' }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_AXIS_NOT_SELECTED);
    expect(findings[0].message).toContain('the query does not return it');
  });

  // ── list-view charts ───────────────────────────────────────────────────
  it('list chart values[] stays ERROR — ObjectView hands `values` to the chart as the dataset measures (`values: vals`), and the series list is synthesised FROM it', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [
        {
          name: 'v',
          list: {
            chart: {
              chartType: 'bar',
              dataset: 'task_metrics',
              dimensions: ['status'],
              values: ['estimate_hours'],
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('views[0].list.chart.values[0]');
  });

  it('a list chart has NO presentation position at all — `ListChartConfigSchema` is a strict object of chartType/dataset/dimensions/values, so a stray `series` key is not this rule to report', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [
        {
          name: 'v',
          list: {
            chart: {
              chartType: 'bar',
              dataset: 'task_metrics',
              dimensions: ['status'],
              values: ['task_count'],
              // Not declared by the schema — the strict parse refuses it, and
              // this rule stays silent rather than inventing a second verdict.
              series: [{ name: 'ghost_measure' }],
            },
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  // ── dataset-bound page chart components ────────────────────────────────
  it('page component series[].name is WARNING — ObjectChart REPLACES the authored array (`series: datasetChart.series`, one entry per selected measure)', () => {
    const findings = validateChartBindings(
      pageWith({
        dataset: 'task_metrics',
        dimensions: ['status'],
        values: ['task_count'],
        series: [{ name: 'ghost_measure', stack: 'a' }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.series[0].name');
    expect(findings[0].message).toContain('REPLACES the authored array');
    expect(findings[0].message).not.toContain('comes back empty');
  });

  it('page component yAxis[].field takes the AXIS sentence, not the series one — the two limbs no longer share a message', () => {
    const findings = validateChartBindings(
      pageWith({
        dataset: 'task_metrics',
        dimensions: ['status'],
        values: ['task_count'],
        yAxis: [{ field: 'ghost_measure', stepSize: 1 }],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.yAxis[0].field');
    expect(findings[0].message).toContain('axis PRESENTATION');
    expect(findings[0].message).toContain('the plotted columns come from `values`');
    expect(findings[0].message).not.toContain('REPLACES the authored array');
  });

  it('page component values[] stays ERROR — ObjectChart queries `{ dimensions: schema.dimensions, measures: schema.values }`', () => {
    const findings = validateChartBindings(
      pageWith({
        dataset: 'task_metrics',
        dimensions: ['status'],
        values: ['estimate_hours'],
      }),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('pages[0].regions[0].components[0].properties.values[0]');
    expect(findings[0].message).toContain('this series comes back empty');
  });

  it('chart-axis-not-selected on the page surface names the derivation, per limb', () => {
    const findings = validateChartBindings(
      pageWith({
        dataset: 'task_metrics',
        dimensions: ['status'],
        values: ['task_count'],
        yAxis: [{ field: 'est_hours' }],
        series: [{ name: 'est_hours' }],
      }),
    );
    expect(findings.map((f) => [f.path, f.rule, f.severity])).toEqual([
      [
        'pages[0].regions[0].components[0].properties.yAxis[0].field',
        CHART_AXIS_NOT_SELECTED,
        'warning',
      ],
      [
        'pages[0].regions[0].components[0].properties.series[0].name',
        CHART_AXIS_NOT_SELECTED,
        'warning',
      ],
    ]);
    expect(findings[0].message).toContain('the axis entry re-points nothing');
    expect(findings[1].message).toContain('the series are derived from `values`');
    expect(findings[0].message).not.toContain('the query does not return it');
    expect(findings[1].message).not.toContain('the query does not return it');
  });

  it('the advisory positions never gate — every presentation finding this rule can raise is below `error`', () => {
    const findings = validateChartBindings(
      pageWith({
        dataset: 'task_metrics',
        dimensions: ['status'],
        values: ['task_count'],
        yAxis: [{ field: 'ghost_a' }],
        series: [{ name: 'ghost_b' }],
      }),
    ).concat(
      validateChartBindings(
        reportWith({
          type: 'bar',
          xAxis: 'status',
          yAxis: 'task_count',
          series: [{ name: 'ghost_c' }],
        }),
      ),
    );
    expect(findings).toHaveLength(3);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
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
    // #15575 — presentation on this surface, so advisory rather than gating.
    expect(findings[0].severity).toBe('warning');
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

  // The #15636 seam this file carries: its collection reader was a hand-copied
  // `asArray` whose array branch was an unchecked cast, so a junk member was
  // DEREFERENCED (`strName(entry.name)` on `null`) rather than skipped and the
  // rule threw where it should have reported. Now `recordsOf`, which filters.
  it('survives a null member in every collection it reads — skipped, not dereferenced', () => {
    const stack = {
      datasets: [
        null,
        {
          name: 'task_metrics',
          object: 'showcase_task',
          dimensions: [null, { name: 'status', field: 'status' }],
          measures: [null, { name: 'task_count', aggregate: 'count' }],
        },
      ],
      reports: [
        null,
        {
          name: 'r',
          dataset: 'task_metrics',
          values: ['task_count'],
          chart: {
            type: 'bar',
            xAxis: 'status',
            yAxis: 'task_count',
            series: [null, { name: 'ghost_measure' }],
          },
        },
      ],
    } as unknown as Record<string, unknown>;

    const findings = validateChartBindings(stack);
    // The junk members are gone rather than fatal, and the real declarations
    // around them still resolve: `status`/`task_count` are found (no unknown-
    // ref finding for either), and the one genuine defect is still reported.
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('warning');
    // Positions are indexes into the FILTERED collection — a dropped member
    // shifts them, which is the honest price of not crashing on junk.
    expect(findings[0].path).toBe('reports[0].chart.series[0].name');
  });

  it('does not mistake a tree view named "org_chart" for a chart', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      views: [{ name: 'business_unit', listViews: { org_chart: { type: 'tree' } } }],
    });
    expect(findings).toEqual([]);
  });
});
