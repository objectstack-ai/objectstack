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

  // #15734 — this fixture WARNED until the set moved, and this pin held the
  // warning in place. At the pinned `@object-ui` revision the embedded chart
  // runs its OWN query out of the axis pair — `useDatasetRows(dataset,
  // plan.kind === 'series' && xAxis ? [xAxis] : [], wantsQuery && yAxis ?
  // [yAxis] : [], …)` — so `est_hours` IS asked for and IS plotted. The
  // warning stated "the query does not return it", which that query refutes.
  // `report.values` selects the TABLE beneath the chart, not the chart.
  it('says nothing when the yAxis measure is declared but outside `report.values` — a report chart cannot fail to select what it queries', () => {
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
    expect(findings).toEqual([]);
  });

  // The other direction of the same set move: `series[].name` is a display-name
  // override paired with a DERIVED series, and the report chart derives exactly
  // one — from its own `chart.yAxis`. So the singleton `{ chart.yAxis }` is
  // what decides whether an entry lands, in BOTH directions.
  it('a report series[].name that names `chart.yAxis` is silent even when `report.values` does not select it', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'r',
          dataset: 'task_metrics',
          values: ['task_count'],
          chart: {
            type: 'bar',
            xAxis: 'status',
            yAxis: 'est_hours',
            series: [{ name: 'est_hours', color: '#f00' }],
          },
        },
      ],
    });
    expect(findings).toEqual([]);
  });

  it('a report series[].name that names a declared measure OTHER than `chart.yAxis` fires — even one `report.values` does select', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'r',
          dataset: 'task_metrics',
          values: ['task_count', 'est_hours'],
          chart: {
            type: 'bar',
            xAxis: 'status',
            yAxis: 'est_hours',
            series: [{ name: 'task_count' }],
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_AXIS_NOT_SELECTED);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].path).toBe('reports[0].chart.series[0].name');
    // The SET the message names is the singleton the chart derives, not
    // `report.values` — which here selects `task_count` and still cannot make
    // the override land.
    expect(findings[0].message).toContain("selected values (est_hours)");
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
 * #16105 — a report is dataset-bound whether or not it draws a chart.
 *
 * Four pins, mirroring the four injections the card measured on a real app,
 * and each reads the findings ARRAY rather than a pass/fail: the tier that
 * moved here is `error`, but `chart-axis-not-selected` rides along at
 * `warning` and changes no exit code, so a test that only asked "did it fail"
 * could not tell the two apart. Two of the four are NEGATIVE controls — the
 * behaviour that already worked before the walk was restructured — because the
 * failure mode this rule is now exposed to is a later refactor breaking the
 * charted path while the new chartless assertions stay green.
 */
describe('validateChartBindings — a report binds a dataset with or without a chart', () => {
  /** The card's `pipeline_coverage_by_quarter`: a matrix report, no chart. */
  const chartlessMatrix = (over: Record<string, unknown> = {}) => ({
    ...baseStack(),
    reports: [
      {
        name: 'coverage_by_quarter',
        type: 'matrix',
        dataset: 'task_metrics',
        rows: ['status'],
        columns: ['priority'],
        values: ['task_count'],
        ...over,
      },
    ],
  });

  /** The card's `opportunities_by_stage`: the same binding, plus a chart. */
  const chartedReport = (over: Record<string, unknown> = {}) => ({
    ...baseStack(),
    reports: [
      {
        name: 'hours_by_status',
        type: 'summary',
        dataset: 'task_metrics',
        rows: ['status'],
        values: ['est_hours'],
        chart: { type: 'bar', xAxis: 'status', yAxis: 'est_hours' },
        ...over,
      },
    ],
  });

  // P1 — the card's Fact 1. Before the lift the ONLY site that received
  // `report.dataset` was the chart closure, whose first line returned on a
  // report with no `chart` key.
  it('P1 · resolves a CHARTLESS report\'s dataset — the entrance the chart early-return used to own', () => {
    const findings = validateChartBindings(chartlessMatrix({ dataset: 'task_metrics_nope' }));
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [CHART_DATASET_UNKNOWN, 'reports[0].dataset', 'error'],
    ]);
    // The path names the key the author wrote. It used to be spelled
    // `reports[0].chart.dataset` — a position a report does not have, and one
    // a chartless report cannot have at all.
    expect(findings[0].hint).toContain('Did you mean "task_metrics"?');
    // The dataset is unresolvable, so nothing downstream of it is resolved
    // against anything: no dimension or measure finding piles on the typo.
    expect(findings).toHaveLength(1);
  });

  // P2 — the card's Fact 2, on the CHARTED report: on one and the same report
  // object the measure selection was resolved and the dimension selection
  // beside it was not.
  it('P2 · resolves `rows` on a charted report — the selection `values` was resolved without', () => {
    const findings = validateChartBindings(chartedReport({ rows: ['status_nope'] }));
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [CHART_DIMENSION_UNKNOWN, 'reports[0].rows[0]', 'error'],
    ]);
    expect(findings[0].message).toContain('not a dimension declared by dataset "task_metrics"');
    expect(findings[0].hint).toContain('Did you mean "status"?');
  });

  it('P2 · resolves `columns` — the across axis a `matrix` pivots on (ADR-0021 D2)', () => {
    const findings = validateChartBindings(chartlessMatrix({ columns: ['priority_nope'] }));
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [CHART_DIMENSION_UNKNOWN, 'reports[0].columns[0]', 'error'],
    ]);
  });

  it('P2 · resolves `rows` on a chartless report too — Fact 2 says every report', () => {
    const findings = validateChartBindings(chartlessMatrix({ rows: ['status_nope'] }));
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [CHART_DIMENSION_UNKNOWN, 'reports[0].rows[0]', 'error'],
    ]);
  });

  // The same entrance, one collection down: `values` was resolved only when a
  // chart existed, so a chartless report's measure selection was as invisible
  // as its dimensions.
  it('resolves a chartless report\'s `values` measures', () => {
    const findings = validateChartBindings(chartlessMatrix({ values: ['task_count_nope'] }));
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [CHART_MEASURE_UNKNOWN, 'reports[0].values[0]', 'error'],
    ]);
    expect(findings[0].message).toContain('this series comes back empty');
  });

  // Every position of a joined report's block, which declares the same keys.
  it('resolves a joined BLOCK\'s dataset and `rows` with no chart on the block', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'overview',
          type: 'joined',
          blocks: [
            { name: 'b1', dataset: 'task_metrics', rows: ['status_nope'], values: ['task_count'] },
            { name: 'b2', dataset: 'task_metrics_nope', rows: ['status'], values: ['task_count'] },
          ],
        },
      ],
    });
    expect(findings.map((f) => [f.rule, f.path, f.where])).toEqual([
      [
        CHART_DIMENSION_UNKNOWN,
        'reports[0].blocks[0].rows[0]',
        'report "overview" · block "b1"',
      ],
      [
        CHART_DATASET_UNKNOWN,
        'reports[0].blocks[1].dataset',
        'report "overview" · block "b2"',
      ],
    ]);
  });

  // N1 — the working control the card ran beside P1: the SAME edit on a report
  // that does have a chart. It gated before the lift and must still gate, and
  // exactly once: the dataset is resolved per report surface, not per group of
  // positions, so restructuring must not double-report the one typo.
  it('N1 · a charted report\'s unresolvable dataset still gates — exactly ONE finding, not one per position group', () => {
    const findings = validateChartBindings(chartedReport({ dataset: 'task_metrics_nope' }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_DATASET_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('reports[0].dataset');
  });

  // N2 — the card's other working control: the measure selection renamed on a
  // charted report. Both tiers, in order, and the tiers are the point: the
  // `error` is what an exit code sees, the `warning` rides along and does not
  // change it (the card's third implementer note).
  it('N2 · a charted report\'s renamed `values` still gates, with the advisory tier riding along unchanged', () => {
    const findings = validateChartBindings(
      chartedReport({
        values: ['est_hours_nope', 'est_hours'],
        chart: {
          type: 'bar',
          xAxis: 'status',
          yAxis: 'est_hours',
          series: [{ name: 'task_count' }],
        },
      }),
    );
    expect(findings.map((f) => [f.rule, f.path, f.severity])).toEqual([
      [CHART_MEASURE_UNKNOWN, 'reports[0].values[0]', 'error'],
      [CHART_AXIS_NOT_SELECTED, 'reports[0].chart.series[0].name', 'warning'],
    ]);
    expect(findings.filter((f) => f.severity === 'error')).toHaveLength(1);
  });

  // N3 — the floor on both shapes. A clean report of either kind says nothing,
  // which is what makes the four pins above readings rather than noise.
  it('N3 · a clean charted report and a clean chartless report both report nothing', () => {
    expect(validateChartBindings(chartedReport())).toEqual([]);
    expect(validateChartBindings(chartlessMatrix())).toEqual([]);
  });

  // A `joined` container selects nothing itself (`ReportSchema` puts its data
  // on `blocks`), so it binds no dataset and has nothing to resolve.
  it('N3 · a joined container with no dataset of its own reports nothing for itself', () => {
    const findings = validateChartBindings({
      ...baseStack(),
      reports: [
        {
          name: 'overview',
          type: 'joined',
          blocks: [{ name: 'b1', dataset: 'task_metrics', rows: ['status'], values: ['task_count'] }],
        },
      ],
    });
    expect(findings).toEqual([]);
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

  // #15734 replaced this case rather than re-worded it: the position keeps the
  // wording it was given here, but nothing on this surface reaches it any more.
  // A report `chart.yAxis` IS the query the chart issues, so it cannot name a
  // measure that query does not ask for — the not-selected limb is gone at that
  // position, and `chart-measure-unknown` (the case above) is untouched.
  it('chart-axis-not-selected does not fire at the report yAxis position at all — that position IS the query', () => {
    const findings = validateChartBindings(
      reportWith({ type: 'bar', xAxis: 'status', yAxis: 'est_hours' }),
    );
    expect(findings).toEqual([]);
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

  // #15734 — the report surface moved to the chart's own `{ chart.yAxis }`.
  // This surface did not, and this control shows it firing: `ObjectView` hands
  // `values` to the chart as the dataset measures, so `values` IS the query's
  // measure set here and a name outside the dataset still gates at its own
  // position. The shape declares no `yAxis`/`series` limb, so no singleton can
  // enter this surface in the first place.
  it('list-view charts resolve against `values`, unchanged by #15734 — firing control', () => {
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
              values: ['task_count', 'estimate_hours'],
            },
          },
        },
      ],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_MEASURE_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].path).toBe('views[0].list.chart.values[1]');
    expect(findings[0].message).toContain('this series comes back empty');
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

  // #15734 — the companion control on the page surface, where
  // `chart-axis-not-selected` DOES have presentation limbs to fire at.
  // `ObjectChart` queries `{ dimensions: schema.dimensions, measures:
  // schema.values }`, so both limbs stay resolved against `values`: the SET
  // named in each message is the page chart's own `values`, never a
  // `{ yAxis[0].field }` singleton borrowed from the report surface.
  it('page-component charts resolve against `values`, unchanged by #15734 — firing control on both limbs', () => {
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
                    yAxis: [{ field: 'est_hours' }],
                    series: [{ name: 'est_hours' }],
                  },
                },
              ],
            },
          ],
        },
      ],
    });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.rule === CHART_AXIS_NOT_SELECTED)).toBe(true);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(findings[0].path).toBe(
      'pages[0].regions[0].components[0].properties.yAxis[0].field',
    );
    expect(findings[1].path).toBe(
      'pages[0].regions[0].components[0].properties.series[0].name',
    );
    expect(findings[0].message).toContain('selected values (task_count)');
    expect(findings[1].message).toContain('selected values (task_count)');
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

  // #16105 re-scoped this from "ignores a report with no chart" — a global
  // zero that held for the wrong reason. The report below is CLEAN: its
  // dataset resolves, `status` is a declared dimension and `task_count` a
  // declared measure. The zero is now a reading about this fixture rather than
  // about the walk skipping it; the readings about the walk are the pins in
  // the "with or without a chart" block above.
  it('says nothing about a chartless report whose every binding resolves', () => {
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
