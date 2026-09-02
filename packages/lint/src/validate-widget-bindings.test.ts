import { describe, it, expect } from 'vitest';
import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import {
  validateWidgetBindings,
  TABLE_COUNT_ONLY,
  WIDGET_DATASET_UNKNOWN,
  WIDGET_DIMENSION_UNKNOWN,
  WIDGET_MEASURE_UNKNOWN,
  CHART_FIELD_UNKNOWN,
  CHART_CONFIG_MISSING,
  MEASURE_AGGREGATE_INCOHERENT,
  WIDGET_LEGACY_ANALYTICS_SHAPE,
  WIDGET_LEGACY_ANALYTICS_UNRENDERABLE,
  DASHBOARD_FILTER_FIELD_UNKNOWN,
  DASHBOARD_FILTER_FIELD_UNPROVISIONED,
  DASHBOARD_FILTER_FIELD_NOT_INCLUDED,
  WIDGET_FILTER_FIELD_UNKNOWN,
  WIDGET_FILTER_FIELD_NOT_INCLUDED,
  WIDGET_SORTBY_UNSELECTED,
} from './validate-widget-bindings.js';

/** The downstream repro from issue #1719 — dataset with a count AND a sum
 *  measure plus a dimension; the widget selects only the count, no dims. */
function reproStack(widgetOverrides: Record<string, unknown> = {}) {
  return {
    datasets: [{
      name: 'expense_report_metrics',
      label: 'Expense report metrics',
      object: 'expense_report',
      measures: [
        { name: 'report_count', label: 'report_count', aggregate: 'count' },
        { name: 'total_amount', label: 'total_amount', aggregate: 'sum', field: 'total_amount' },
      ],
      dimensions: [{ name: 'cost_center', field: 'cost_center' }],
    }],
    dashboards: [{
      name: 'expenses_overview_dashboard',
      label: 'Expenses Overview',
      widgets: [{
        id: 'pending_reports_table',
        type: 'table',
        dataset: 'expense_report_metrics',
        values: ['report_count'],
        filter: { status: 'submitted' },
        layout: { x: 0, y: 0, w: 6, h: 4 },
        ...widgetOverrides,
      }],
    }],
  };
}

/** The minimal repro from issue #1721 — dataset measure is `sum_amount`, but
 *  the chart's yAxis still names the old base column `amount`. */
function chartStack(widgetOverrides: Record<string, unknown> = {}) {
  return {
    datasets: [{
      name: 'expense_line_metrics',
      label: 'Expense line metrics',
      object: 'expense_line',
      dimensions: [{ name: 'category', field: 'category' }],
      measures: [
        { name: 'sum_amount', label: 'sum_amount', aggregate: 'sum', field: 'amount' },
        { name: 'ticket_count', label: 'ticket_count', aggregate: 'count' },
      ],
    }],
    dashboards: [{
      name: 'spend_dashboard',
      label: 'Spend',
      widgets: [{
        id: 'spend_by_category',
        type: 'bar',
        dataset: 'expense_line_metrics',
        dimensions: ['category'],
        values: ['sum_amount'],
        chartConfig: {
          type: 'bar',
          xAxis: { field: 'category' },
          yAxis: [{ field: 'sum_amount' }],
        },
        layout: { x: 0, y: 0, w: 6, h: 4 },
        ...widgetOverrides,
      }],
    }],
  };
}

describe('validateWidgetBindings (reference integrity, issue #1721)', () => {
  it('a fully resolved chart widget is clean', () => {
    expect(validateWidgetBindings(chartStack())).toHaveLength(0);
  });

  it('(a) errors on a dataset reference that does not resolve', () => {
    const findings = validateWidgetBindings(chartStack({ dataset: 'expense_line_metric' }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(WIDGET_DATASET_UNKNOWN);
    expect(findings[0].message).toContain('expense_line_metric');
    expect(findings[0].hint).toContain('Did you mean "expense_line_metrics"?');
  });

  // Issue #3583 — on the raw-config paths (`lint`/`doctor`) a widget with no
  // `dataset` key at all fell through a bare `continue` and silently bypassed
  // every binding and chart check. `dataset` is schema-REQUIRED, so reporting
  // it here matches what the parsed paths already enforce.
  it('(a2) errors on a widget that binds no dataset at all', () => {
    const stack = chartStack();
    delete (stack as any).dashboards[0].widgets[0].dataset;
    const findings = validateWidgetBindings(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(WIDGET_DATASET_UNKNOWN);
    expect(findings[0].message).toContain('binds no `dataset`');
  });

  it('(b) errors on a dimension name the dataset does not declare', () => {
    const findings = validateWidgetBindings(chartStack({ dimensions: ['categry'] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(WIDGET_DIMENSION_UNKNOWN);
    expect(findings[0].message).toContain('"categry"');
    expect(findings[0].message).toContain('declared dimensions: category');
    expect(findings[0].hint).toContain('Did you mean "category"?');
  });

  it('(c) errors on a measure name the dataset does not declare', () => {
    const findings = validateWidgetBindings(chartStack({
      type: 'metric',
      values: ['amount'],
      chartConfig: undefined,
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(WIDGET_MEASURE_UNKNOWN);
    expect(findings[0].message).toContain('declared measures: sum_amount, ticket_count');
    expect(findings[0].hint).toContain('Did you mean "sum_amount"?');
  });

  it('(d) errors on the issue repro: yAxis.field naming the stale base column', () => {
    const findings = validateWidgetBindings(chartStack({
      chartConfig: {
        type: 'bar',
        xAxis: { field: 'category' },
        yAxis: [{ field: 'amount' }],
      },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(CHART_FIELD_UNKNOWN);
    expect(findings[0].where).toContain('spend_by_category');
    expect(findings[0].message).toContain('chartConfig.yAxis[0].field "amount"');
    expect(findings[0].message).toContain('declared measures: sum_amount, ticket_count');
    expect(findings[0].hint).toContain('Did you mean "sum_amount"?');
  });

  it('(d) errors on xAxis.field that is not a dataset dimension', () => {
    const findings = validateWidgetBindings(chartStack({
      chartConfig: {
        type: 'bar',
        xAxis: { field: 'categories' },
        yAxis: [{ field: 'sum_amount' }],
      },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_FIELD_UNKNOWN);
    expect(findings[0].message).toContain('chartConfig.xAxis.field "categories"');
    expect(findings[0].hint).toContain('Did you mean "category"?');
  });

  it('(d) errors on series[].name that resolves to no selected measure', () => {
    const findings = validateWidgetBindings(chartStack({
      chartConfig: {
        type: 'bar',
        series: [{ name: 'value' }],
      },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_FIELD_UNKNOWN);
    expect(findings[0].message).toContain('chartConfig.series[0].name "value"');
  });

  it('(d) a declared-but-unselected measure gets the targeted message', () => {
    const findings = validateWidgetBindings(chartStack({
      chartConfig: {
        type: 'bar',
        xAxis: { field: 'category' },
        yAxis: [{ field: 'ticket_count' }],
      },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(CHART_FIELD_UNKNOWN);
    expect(findings[0].message).toContain('not selected in the widget\'s values');
    expect(findings[0].hint).toContain('Add "ticket_count" to the widget\'s values');
  });

  it('(d) warns when a chart-type widget has no chartConfig at all', () => {
    const findings = validateWidgetBindings(chartStack({ chartConfig: undefined }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(CHART_CONFIG_MISSING);
    expect(findings[0].message).toContain("'bar'");
    expect(findings[0].hint).toContain(`suppressWarnings: ['${CHART_CONFIG_MISSING}']`);
  });

  it('(d) missing chartConfig is suppressible per widget', () => {
    expect(validateWidgetBindings(chartStack({
      chartConfig: undefined,
      suppressWarnings: [CHART_CONFIG_MISSING],
    }))).toHaveLength(0);
  });

  it('(d) non-chart types do not warn on missing chartConfig', () => {
    for (const type of ['metric', 'kpi', 'gauge', 'solid-gauge', 'bullet', 'table', 'pivot']) {
      expect(validateWidgetBindings(chartStack({ type, chartConfig: undefined }))).toHaveLength(0);
    }
  });

  it('(d) every multi-series family in the taxonomy warns — including a newly added one', () => {
    // The set of chart families that need a measure mapping is derived from
    // `ChartTypeSchema`, so a family added to the taxonomy is covered without
    // editing a list here. `combo` is the case that proved it: as a hand-written
    // list, an unlisted family read as "not a chart" and the missing mapping
    // went unreported. objectui#2945.
    for (const type of ['bar', 'horizontal-bar', 'column', 'line', 'area', 'pie',
      'donut', 'funnel', 'scatter', 'treemap', 'sankey', 'radar', 'combo']) {
      const findings = validateWidgetBindings(chartStack({ type, chartConfig: undefined }));
      expect(findings, `expected a warning for chart type '${type}'`).toHaveLength(1);
      expect(findings[0].rule).toBe(CHART_CONFIG_MISSING);
    }
  });

  it('errors are NOT suppressible via suppressWarnings', () => {
    const findings = validateWidgetBindings(chartStack({
      dataset: 'no_such_dataset',
      suppressWarnings: [WIDGET_DATASET_UNKNOWN],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('does not double-report a chartConfig field that names an already-errored selection entry', () => {
    const findings = validateWidgetBindings(chartStack({
      values: ['amount'],
      chartConfig: {
        type: 'bar',
        xAxis: { field: 'category' },
        yAxis: [{ field: 'amount' }],
      },
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(WIDGET_MEASURE_UNKNOWN);
  });

  it('a dangling dataset reports once and skips the name checks', () => {
    const findings = validateWidgetBindings(chartStack({
      dataset: 'nope',
      dimensions: ['whatever'],
      values: ['also_whatever'],
    }));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(WIDGET_DATASET_UNKNOWN);
  });
});

describe('validateWidgetBindings (table-count-only, issue #1719)', () => {
  it('warns on the issue repro: count-only table widget without dimensions', () => {
    const warnings = validateWidgetBindings(reproStack());
    expect(warnings).toHaveLength(1);
    expect(warnings[0].severity).toBe('warning');
    expect(warnings[0].rule).toBe(TABLE_COUNT_ONLY);
    expect(warnings[0].where).toContain('expenses_overview_dashboard');
    expect(warnings[0].where).toContain('pending_reports_table');
    expect(warnings[0].path).toBe('dashboards[0].widgets[0]');
    expect(warnings[0].message).toContain('report_count');
    expect(warnings[0].message).toContain('single summary row');
    expect(warnings[0].hint).toContain('ListView (ADR-0017)');
    expect(warnings[0].hint).toContain(`suppressWarnings: ['${TABLE_COUNT_ONLY}']`);
  });

  it('warns for pivot widgets too', () => {
    const warnings = validateWidgetBindings(reproStack({ type: 'pivot' }));
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toContain("'pivot' widget");
  });

  it('is keyed on the WIDGET binding — selecting the sum measure is clean', () => {
    expect(validateWidgetBindings(reproStack({ values: ['total_amount'] }))).toHaveLength(0);
  });

  it('mixed count + non-count selection is clean', () => {
    expect(validateWidgetBindings(reproStack({ values: ['report_count', 'total_amount'] }))).toHaveLength(0);
  });

  it('declaring a dimension on the widget is clean', () => {
    expect(validateWidgetBindings(reproStack({ dimensions: ['cost_center'] }))).toHaveLength(0);
  });

  it('metric widgets are exactly what a count-only binding wants — clean', () => {
    expect(validateWidgetBindings(reproStack({ type: 'metric' }))).toHaveLength(0);
  });

  it('suppressWarnings opts a deliberate single-row table out', () => {
    expect(validateWidgetBindings(reproStack({ suppressWarnings: [TABLE_COUNT_ONLY] }))).toHaveLength(0);
  });

  it('unrelated suppressWarnings entries do not suppress', () => {
    expect(validateWidgetBindings(reproStack({ suppressWarnings: ['some-other-rule'] }))).toHaveLength(1);
  });

  it('a dangling dataset reference is the cross-reference error, not this rule', () => {
    const findings = validateWidgetBindings(reproStack({ dataset: 'no_such_dataset' }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(WIDGET_DATASET_UNKNOWN);
  });

  it('an unresolvable measure name is the cross-reference error, not this rule', () => {
    const findings = validateWidgetBindings(reproStack({ values: ['no_such_measure'] }));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].rule).toBe(WIDGET_MEASURE_UNKNOWN);
  });

  it('treats derived measures as non-count even when aggregate says count', () => {
    const stack = reproStack({ values: ['count_ratio'] });
    (stack.datasets[0].measures as Record<string, unknown>[]).push({
      name: 'count_ratio',
      aggregate: 'count',
      derived: { op: 'ratio', of: ['report_count', 'report_count'] },
    });
    expect(validateWidgetBindings(stack)).toHaveLength(0);
  });

  it('count_distinct is a deliberate analytic — clean', () => {
    const stack = reproStack({ values: ['unique_requesters'] });
    (stack.datasets[0].measures as Record<string, unknown>[]).push({
      name: 'unique_requesters',
      aggregate: 'count_distinct',
      field: 'requester',
    });
    expect(validateWidgetBindings(stack)).toHaveLength(0);
  });

  it('handles map-keyed datasets/dashboards collections', () => {
    const arrayForm = reproStack();
    const { name: _dsName, ...dsRest } = arrayForm.datasets[0];
    const { name: _dashName, ...dashRest } = arrayForm.dashboards[0];
    const stack = {
      datasets: { expense_report_metrics: dsRest },
      dashboards: { expenses_overview_dashboard: dashRest },
    };
    const warnings = validateWidgetBindings(stack);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].where).toContain('expenses_overview_dashboard');
  });

  it('is silent on stacks without dashboards or datasets', () => {
    expect(validateWidgetBindings({})).toHaveLength(0);
    expect(validateWidgetBindings({ dashboards: [], datasets: [] })).toHaveLength(0);
  });
});

describe('validateWidgetBindings (measure-aggregate-incoherent — rate aggregation)', () => {
  /** A dataset whose `probability` measure aggregates a percent field. */
  function crmStack(aggregate: string) {
    return {
      objects: [{
        name: 'opportunity',
        fields: [
          { name: 'amount', type: 'currency' },
          { name: 'probability', type: 'percent' },
          { name: 'stage', type: 'select' },
        ],
      }],
      datasets: [{
        name: 'opportunity_ds',
        object: 'opportunity',
        measures: [
          { name: 'count', aggregate: 'count' },
          { name: 'total_amount', aggregate: 'sum', field: 'amount' },
          { name: 'win_probability', aggregate, field: 'probability' },
        ],
        dimensions: [{ name: 'stage', field: 'stage' }],
      }],
    };
  }

  it('warns when a measure SUMs a percentage field', () => {
    const findings = validateWidgetBindings(crmStack('sum'));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].rule).toBe(MEASURE_AGGREGATE_INCOHERENT);
    expect(findings[0].where).toContain('opportunity_ds');
    expect(findings[0].where).toContain('win_probability');
    expect(findings[0].path).toBe('datasets[0].measures[2]');
    expect(findings[0].message).toContain('percent field "probability"');
    expect(findings[0].hint).toMatch(/avg/i);
  });

  it('is clean when the percentage field is AVG’d', () => {
    expect(validateWidgetBindings(crmStack('avg'))).toHaveLength(0);
  });

  it('also flags count_distinct of a percentage field', () => {
    const findings = validateWidgetBindings(crmStack('count_distinct'));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(MEASURE_AGGREGATE_INCOHERENT);
  });

  it('does not flag SUM of a currency/amount field', () => {
    // total_amount sums `amount` (currency) — additive, perfectly fine.
    expect(validateWidgetBindings(crmStack('avg')).filter((f) => f.rule === MEASURE_AGGREGATE_INCOHERENT)).toHaveLength(0);
  });

  it('cannot judge — and never false-positives — without the object field types', () => {
    const stack = crmStack('sum');
    delete (stack as { objects?: unknown }).objects;
    expect(validateWidgetBindings(stack)).toHaveLength(0);
  });
});

describe('validateWidgetBindings — legacy analytics shape (#1878/#1894)', () => {
  const only = (findings: ReturnType<typeof validateWidgetBindings>) =>
    findings.filter((f) => f.rule === WIDGET_LEGACY_ANALYTICS_SHAPE);

  it('warns (not errors) when a dataset-bound widget also carries a legacy key', () => {
    // valueField is dead once the widget is dataset-bound; steer the author off it.
    const findings = only(validateWidgetBindings(reproStack({ valueField: 'total_amount' })));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain('`valueField`');
    expect(findings[0].hint).toMatch(/dataset.*dimensions.*values/is);
  });

  it('warns on a legacy pivot widget that has NO dataset (previously skipped silently)', () => {
    const stack = {
      dashboards: [{
        name: 'legacy_dash',
        label: 'Legacy',
        widgets: [{
          id: 'legacy_pivot',
          type: 'pivot',
          object: 'task',
          rowField: 'status',
          columnField: 'priority',
          valueField: 'id',
          aggregation: 'count',
          layout: { x: 0, y: 0, w: 6, h: 4 },
        }],
      }],
    };
    const findings = only(validateWidgetBindings(stack));
    expect(findings).toHaveLength(1);
    // all legacy keys reported in one finding
    expect(findings[0].message).toContain('`rowField`');
    expect(findings[0].message).toContain('`columnField`');
    expect(findings[0].message).toContain('`aggregation`');
  });

  it('does NOT warn on a clean dataset-shaped widget', () => {
    expect(only(validateWidgetBindings(reproStack()))).toHaveLength(0);
  });

  it('is suppressible per widget via suppressWarnings', () => {
    const findings = only(validateWidgetBindings(reproStack({
      categoryField: 'cost_center',
      suppressWarnings: [WIDGET_LEGACY_ANALYTICS_SHAPE],
    })));
    expect(findings).toHaveLength(0);
  });

  // ── error escalation (②): legacy keys as the ONLY data wiring ──

  const legacyOnly = (findings: ReturnType<typeof validateWidgetBindings>) =>
    findings.filter((f) => f.rule === WIDGET_LEGACY_ANALYTICS_UNRENDERABLE);

  it('ERRORS on a legacy chart with no dataset/object/data — it renders nothing', () => {
    const stack = {
      dashboards: [{
        name: 'broken_dash',
        label: 'Broken',
        widgets: [{
          id: 'orphan_chart',
          type: 'bar',
          categoryField: 'status',
          valueField: 'amount',
          aggregate: 'sum',
          layout: { x: 0, y: 0, w: 6, h: 4 },
        }],
      }],
    };
    const findings = legacyOnly(validateWidgetBindings(stack));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toMatch(/renders nothing/i);
  });

  it('does NOT error when an object binding is present (legacy path still renders) — warns instead', () => {
    const stack = {
      dashboards: [{
        name: 'legacy_dash', label: 'Legacy',
        widgets: [{ id: 'obj_pivot', type: 'pivot', object: 'task', rowField: 'status', columnField: 'priority', valueField: 'id', aggregation: 'count', layout: { x: 0, y: 0, w: 6, h: 4 } }],
      }],
    };
    const findings = validateWidgetBindings(stack);
    expect(findings.filter((f) => f.rule === WIDGET_LEGACY_ANALYTICS_UNRENDERABLE)).toHaveLength(0);
    expect(findings.filter((f) => f.rule === WIDGET_LEGACY_ANALYTICS_SHAPE)).toHaveLength(1);
    expect(findings.find((f) => f.rule === WIDGET_LEGACY_ANALYTICS_SHAPE)!.severity).toBe('warning');
  });

  it('the unrenderable error is NOT suppressible', () => {
    const stack = {
      dashboards: [{
        name: 'broken_dash', label: 'Broken',
        widgets: [{ id: 'orphan', type: 'pie', categoryField: 'status', suppressWarnings: [WIDGET_LEGACY_ANALYTICS_UNRENDERABLE], layout: { x: 0, y: 0, w: 6, h: 4 } }],
      }],
    };
    // errors ignore suppressWarnings — a blank widget must not be silenceable
    expect(legacyOnly(validateWidgetBindings(stack))).toHaveLength(1);
  });
});

describe('validateWidgetBindings (dashboard-filter-field-unknown, issue #3365)', () => {
  const only = (findings: ReturnType<typeof validateWidgetBindings>) =>
    findings.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_UNKNOWN);

  /**
   * The #3365 repro: a dashboard `dateRange` bound to `close_date` (which lives
   * only on the opportunity object) inherited by a widget over `crm_account`.
   * `dash` overrides the dashboard tail (dateRange/globalFilters); `widget`
   * overrides the single account widget.
   */
  function stack(dash: Record<string, unknown> = {}, widget: Record<string, unknown> = {}) {
    return {
      objects: [
        { name: 'crm_account', fields: [
          { name: 'name', type: 'text' },
          { name: 'industry', type: 'select' },
          { name: 'renewal_date', type: 'date' },
        ] },
        { name: 'crm_opportunity', fields: [
          { name: 'name', type: 'text' },
          { name: 'close_date', type: 'date' },
        ] },
      ],
      datasets: [
        { name: 'account_metrics', object: 'crm_account',
          dimensions: [{ name: 'industry', field: 'industry' }],
          measures: [{ name: 'account_count', aggregate: 'count' }] },
      ],
      dashboards: [{
        name: 'executive_dashboard',
        label: 'Executive',
        dateRange: { field: 'close_date', defaultRange: 'this_quarter' },
        widgets: [{
          id: 'total_accounts', type: 'metric',
          dataset: 'account_metrics', values: ['account_count'],
          ...widget,
        }],
        ...dash,
      }],
    };
  }

  it('errors on the repro: an inherited dateRange field absent on the widget object', () => {
    const findings = only(validateWidgetBindings(stack()));
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.severity).toBe('error');
    // names the dashboard, widget, filter, field, and object (acceptance criteria)
    expect(f.where).toContain('executive_dashboard');
    expect(f.where).toContain('total_accounts');
    expect(f.message).toContain('dateRange');
    expect(f.message).toContain('close_date');
    expect(f.message).toContain('crm_account');
    expect(f.hint).toContain('filterBindings: { dateRange: false }');
    expect(f.path).toBe('dashboards[0].widgets[0]');
  });

  it('passes when the widget opts out via filterBindings: { dateRange: false }', () => {
    expect(only(validateWidgetBindings(stack({}, { filterBindings: { dateRange: false } })))).toHaveLength(0);
  });

  it('passes when the widget re-targets to an existing field', () => {
    expect(only(validateWidgetBindings(stack({}, { filterBindings: { dateRange: 'renewal_date' } })))).toHaveLength(0);
  });

  it('errors (explicit wording) when a re-target names a non-existent field', () => {
    const findings = only(validateWidgetBindings(stack({}, { filterBindings: { dateRange: 'closed_date' } })));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('via filterBindings');
    expect(findings[0].message).toContain('closed_date');
  });

  it('passes when the inherited field exists on the object', () => {
    expect(only(validateWidgetBindings(stack({ dateRange: { field: 'renewal_date' } })))).toHaveLength(0);
  });

  it('does not false-positive on the created_at system field (bare dateRange default)', () => {
    // dateRange with no `field` defaults to `created_at`, a registry-injected
    // system field never present in `object.fields`.
    expect(only(validateWidgetBindings(stack({ dateRange: { defaultRange: 'this_month' } })))).toHaveLength(0);
  });

  it('checks globalFilters[] fields too (name defaults to field)', () => {
    const findings = only(validateWidgetBindings(stack({
      dateRange: undefined,
      globalFilters: [{ field: 'region', type: 'select' }],
    })));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('region');
    expect(findings[0].message).toContain('crm_account');
  });

  it('a globalFilter opt-out uses the filter name (custom name honoured)', () => {
    // custom `name` becomes the filterBindings key, not the raw field.
    expect(only(validateWidgetBindings(stack(
      { dateRange: undefined, globalFilters: [{ name: 'sales_region', field: 'region', type: 'select' }] },
      { filterBindings: { sales_region: false } },
    )))).toHaveLength(0);
  });

  it('a targetWidgets allow-list gates the default binding (unlisted widget is unbound)', () => {
    // `region` targets only some_other_widget, so total_accounts never inherits
    // it — even though crm_account has no `region`.
    expect(only(validateWidgetBindings(stack({
      dateRange: undefined,
      globalFilters: [{ field: 'region', type: 'select', targetWidgets: ['some_other_widget'] }],
    })))).toHaveLength(0);
  });

  it('RESOLVES a relationship-path filter field instead of skipping it (#14275)', () => {
    // REWRITTEN, not deleted. This case pinned the branch's
    // `if (field.includes('.')) continue;`, whose comment claimed a dotted path
    // "can't be checked here". That was accurate when nothing in this package
    // could walk hops and became false when `resolveFieldPath` landed
    // (#14267 for #14105); the assertion kept passing precisely because the
    // rule had stopped asking the question. `account` is not a field on
    // `crm_account`, so the head hop is a real miss and is now named as one.
    const findings = only(validateWidgetBindings(stack({ dateRange: { field: 'account.region' } })));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('account.region');
    expect(findings[0].message).toContain('traverses "account"');
    expect(findings[0].message).toContain('crm_account');
  });

  it('cannot judge — and never false-positives — when the object is not in the stack', () => {
    const s = stack();
    delete (s as { objects?: unknown }).objects;
    expect(only(validateWidgetBindings(s))).toHaveLength(0);
  });

  it('the error is NOT suppressible via suppressWarnings', () => {
    const findings = only(validateWidgetBindings(stack({}, {
      suppressWarnings: [DASHBOARD_FILTER_FIELD_UNKNOWN],
    })));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
  });

  it('is silent on dashboards with no dashboard-level filters', () => {
    expect(only(validateWidgetBindings(stack({ dateRange: undefined })))).toHaveLength(0);
  });
});

describe('validateWidgetBindings (dashboard-filter-field-unprovisioned, issue #8340)', () => {
  const only = (findings: ReturnType<typeof validateWidgetBindings>) =>
    findings.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_UNPROVISIONED);
  const unknownOnly = (findings: ReturnType<typeof validateWidgetBindings>) =>
    findings.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_UNKNOWN);

  /**
   * The #8340 repro: a dashboard filter on `owner_id` — a registry-injected
   * system column, so #3365's existence error rightly stays silent — over a
   * dataset bound to an ADR-0015 `external` object, where the platform
   * registers the anchor and provisions no storage for it.
   *
   * `objectExtra` mutates the object (drop `external`, declare the column) so
   * each half of the derivation can be broken independently.
   */
  function stack(
    dash: Record<string, unknown> = {},
    widget: Record<string, unknown> = {},
    objectExtra: Record<string, unknown> = {},
  ) {
    return {
      objects: [
        {
          name: 'ext_customer',
          external: { remoteName: 'customers' },
          fields: [{ name: 'email', type: 'text' }, { name: 'signed_up_on', type: 'date' }],
          ...objectExtra,
        },
      ],
      datasets: [
        { name: 'customer_metrics', object: 'ext_customer',
          dimensions: [{ name: 'email', field: 'email' }],
          measures: [{ name: 'customer_count', aggregate: 'count' }] },
      ],
      dashboards: [{
        name: 'federation_dashboard',
        label: 'Federation',
        globalFilters: [{ field: 'owner_id', type: 'select' }],
        widgets: [{
          id: 'total_customers', type: 'metric',
          dataset: 'customer_metrics', values: ['customer_count'],
          ...widget,
        }],
        ...dash,
      }],
    };
  }

  it('warns on the repro: an inherited filter over an unprovisioned injected anchor', () => {
    const findings = only(validateWidgetBindings(stack()));
    expect(findings).toHaveLength(1);
    const f = findings[0];
    expect(f.severity).toBe('warning');
    expect(f.where).toContain('federation_dashboard');
    expect(f.where).toContain('total_customers');
    expect(f.message).toContain('owner_id');
    expect(f.message).toContain('ext_customer');
    expect(f.message).toContain('external object (ADR-0015)');
    expect(f.message).toContain('constant-false');
    expect(f.hint).toContain("columnMap");
    expect(f.path).toBe('dashboards[0].widgets[0]');
    // The existence rule is UNCHANGED — the name still resolves.
    expect(unknownOnly(validateWidgetBindings(stack()))).toHaveLength(0);
  });

  it('is silent on the local twin — platform storage is real (mutation: drop `external`)', () => {
    // Break the ADR-0015 half of the derivation: the same filter over a
    // platform-stored object has a real `owner_id` column behind it.
    const local = stack({}, {}, { external: undefined });
    expect(only(validateWidgetBindings(local))).toHaveLength(0);
    expect(unknownOnly(validateWidgetBindings(local))).toHaveLength(0);
  });

  it('is silent when the author DECLARES the column — it maps a remote column they vouch for', () => {
    // #7859's security direction, and the second half of the derivation.
    const declared = stack({}, {}, {
      fields: [{ name: 'email', type: 'text' }, { name: 'owner_id', type: 'text' }],
    });
    expect(only(validateWidgetBindings(declared))).toHaveLength(0);
  });

  it('is silent on an ordinary declared field of the same external object', () => {
    expect(only(validateWidgetBindings(stack({
      globalFilters: [{ field: 'signed_up_on', type: 'date' }],
    })))).toHaveLength(0);
  });

  it('warns with the explicit wording when filterBindings re-targets onto an anchor', () => {
    const findings = only(validateWidgetBindings(stack(
      { globalFilters: [{ name: 'owner', field: 'signed_up_on', type: 'date' }] },
      { filterBindings: { owner: 'created_by' } },
    )));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('via filterBindings');
    expect(findings[0].message).toContain('created_by');
  });

  it('is silent when the widget opts the filter out entirely', () => {
    expect(only(validateWidgetBindings(stack(
      { globalFilters: [{ name: 'owner_id', field: 'owner_id', type: 'select' }] },
      { filterBindings: { owner_id: false } },
    )))).toHaveLength(0);
  });

  it('IS suppressible — it is advice, not a broken query', () => {
    expect(only(validateWidgetBindings(stack({}, {
      suppressWarnings: [DASHBOARD_FILTER_FIELD_UNPROVISIONED],
    })))).toHaveLength(0);
  });

  it('cannot judge — and never false-positives — when the object is not in the stack', () => {
    const s = stack();
    delete (s as { objects?: unknown }).objects;
    expect(only(validateWidgetBindings(s))).toHaveLength(0);
  });

  it('[#14275] the anchor is looked up on the object the LEAF landed on, not the base', () => {
    // The #8340 question now rides the migrated branch, so it travels with the
    // verdict: a DOTTED filter path ending on an ADR-0015 external object is
    // answered, which the pre-#14275 branch could not do at all (it skipped
    // every dotted field before reaching the provenance test).
    const federated = {
      objects: [
        {
          name: 'crm_order',
          fields: [
            { name: 'total', type: 'number' },
            { name: 'customer', type: 'lookup', reference: 'ext_customer' },
          ],
        },
        {
          name: 'ext_customer',
          external: { remoteName: 'customers' },
          fields: [{ name: 'email', type: 'text' }],
        },
      ],
      datasets: [{
        name: 'order_metrics', object: 'crm_order', include: ['customer'],
        measures: [{ name: 'order_count', aggregate: 'count' }],
      }],
      dashboards: [{
        name: 'orders', label: 'Orders',
        globalFilters: [{ field: 'customer.owner_id', type: 'select' }],
        widgets: [{ id: 'total_orders', type: 'metric', dataset: 'order_metrics', values: ['order_count'] }],
      }],
    };
    const findings = only(validateWidgetBindings(federated));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    // The cause names ext_customer — the LEAF's object — not crm_order.
    expect(findings[0].message).toContain('ext_customer');
    expect(findings[0].message).toContain('external object (ADR-0015)');
    expect(unknownOnly(validateWidgetBindings(federated))).toHaveLength(0);
  });
});

// ── [#14275] The DASHBOARD-level filter, on the object-graph seam ────────────

/**
 * The card's repro shape: a dashboard `dateRange` re-targeted onto a
 * relationship path (`account.signed_at`), broadcast into a widget whose
 * dataset joins `account`. Every knob the two gaps turn is exposed:
 * `dash`/`widget` for the binding, `datasetOverrides` for the `include` clause,
 * `objectOverrides` for the per-object injected set.
 */
function dashboardDottedStack(
  dash: Record<string, unknown> = {},
  widget: Record<string, unknown> = {},
  datasetOverrides: Record<string, unknown> = {},
  objectOverrides: Record<string, unknown> = {},
) {
  return {
    objects: [
      {
        name: 'crm_deal',
        fields: [
          { name: 'stage', type: 'select' },
          { name: 'amount', type: 'number' },
          { name: 'account', type: 'lookup', reference: 'crm_account' },
        ],
        ...objectOverrides,
      },
      {
        name: 'crm_account',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'signed_at', type: 'date' },
        ],
      },
    ],
    datasets: [{
      name: 'deal_metrics',
      object: 'crm_deal',
      include: ['account'],
      dimensions: [{ name: 'stage', field: 'stage' }],
      measures: [{ name: 'deal_count', aggregate: 'count' }],
      ...datasetOverrides,
    }],
    dashboards: [{
      name: 'pipeline_health',
      label: 'Pipeline',
      dateRange: { field: 'account.signed_at', defaultRange: 'this_quarter' },
      widgets: [{
        id: 'open_deals', type: 'metric',
        dataset: 'deal_metrics', values: ['deal_count'],
        ...widget,
      }],
      ...dash,
    }],
  };
}

describe('dashboard-filter-field-unknown — gap 1: dotted paths are resolved (#14275)', () => {
  const unknown = (fs: ReturnType<typeof validateWidgetBindings>) =>
    fs.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_UNKNOWN);

  it('is silent on the clean shape — a dotted path through a declared include', () => {
    expect(validateWidgetBindings(dashboardDottedStack())).toEqual([]);
  });

  it('errors when a HOP names nothing on the bound object', () => {
    const findings = unknown(validateWidgetBindings(
      dashboardDottedStack({ dateRange: { field: 'acount.signed_at' } }),
    ));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    // Names the dashboard, the widget, the filter, the path and WHICH hop failed.
    expect(f.where).toBe('dashboard "pipeline_health" › widget "open_deals"');
    expect(f.message).toContain('dateRange');
    expect(f.message).toContain('traverses "acount"');
    expect(f.message).toContain('crm_deal');
    expect(f.message).toContain('Did you mean "account"?');
    expect(f.path).toBe('dashboards[0].widgets[0]');
  });

  it('errors when the LEAF names nothing on the object the hop landed on', () => {
    const findings = unknown(validateWidgetBindings(
      dashboardDottedStack({ dateRange: { field: 'account.signd_at' } }),
    ));
    expect(findings).toHaveLength(1);
    // The verdict travelled: the miss is reported against crm_ACCOUNT, the
    // object the leaf lives on, not against the dataset's base object.
    expect(findings[0].message).toContain('crm_account');
    expect(findings[0].hint).toContain('signed_at');
  });

  it('errors when a hop is not a relationship at all', () => {
    const findings = unknown(validateWidgetBindings(
      dashboardDottedStack({ dateRange: { field: 'amount.total' } }),
    ));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('not a relationship');
  });

  it('carries the explicit wording when filterBindings re-targets onto a bad path', () => {
    const findings = unknown(validateWidgetBindings(dashboardDottedStack(
      {},
      { filterBindings: { dateRange: 'acount.signed_at' } },
    )));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('via filterBindings');
    expect(findings[0].message).toContain('acount.signed_at');
  });

  it('is silent when the widget opts a bad dotted filter out entirely', () => {
    expect(validateWidgetBindings(dashboardDottedStack(
      { dateRange: { field: 'acount.signed_at' } },
      { filterBindings: { dateRange: false } },
    ))).toEqual([]);
  });

  it('takes the injected-hop skip — a path THROUGH a registry column is unknowable', () => {
    // `owner_id` is injected and IS a lookup at the registry, but its target is
    // registry-owned and invisible here. Reporting it would be the false
    // positive skip 3 exists to prevent (ADR-0072 D1).
    expect(validateWidgetBindings(
      dashboardDottedStack({ dateRange: { field: 'owner_id.name' } }),
    )).toEqual([]);
  });

  it('takes skip 2 — an object with no readable field map is never reported', () => {
    const s = dashboardDottedStack({ dateRange: { field: 'acount.signed_at' } });
    delete (s.objects[0] as { fields?: unknown }).fields;
    expect(unknown(validateWidgetBindings(s))).toHaveLength(0);
  });
});

describe('dashboard-filter-field-not-included — the include clause (#14275)', () => {
  const notIncluded = (fs: ReturnType<typeof validateWidgetBindings>) =>
    fs.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_NOT_INCLUDED);

  it('errors when a RESOLVABLE dotted path traverses an undeclared relationship', () => {
    const findings = notIncluded(validateWidgetBindings(
      dashboardDottedStack({}, {}, { include: [] }),
    ));
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.message).toContain('account');
    expect(f.message).toContain('deal_metrics');
    // The consequence that makes this a p2 rather than the widget-level twin:
    // the filter reaches every widget on the board.
    expect(f.message).toContain('EVERY bound widget');
    expect(f.hint).toContain('(none)');
  });

  it('is silent for a bare base column — it needs no join', () => {
    expect(notIncluded(validateWidgetBindings(
      dashboardDottedStack({ dateRange: { field: 'stage' } }, {}, { include: [] }),
    ))).toHaveLength(0);
  });

  it('does not double-report: an unresolvable path yields the existence finding only', () => {
    const all = validateWidgetBindings(
      dashboardDottedStack({ dateRange: { field: 'account.signd_at' } }, {}, { include: [] }),
    );
    expect(all.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_UNKNOWN)).toHaveLength(1);
    expect(notIncluded(all)).toHaveLength(0);
  });

  it('honours the implicit-prefix rule — declaring "a.b" includes "a"', () => {
    expect(notIncluded(validateWidgetBindings(
      dashboardDottedStack({}, {}, { include: ['account.owner'] }),
    ))).toHaveLength(0);
  });

  it('is NOT suppressible — it describes a query the analytics service cannot satisfy', () => {
    expect(notIncluded(validateWidgetBindings(dashboardDottedStack(
      {}, { suppressWarnings: [DASHBOARD_FILTER_FIELD_NOT_INCLUDED] }, { include: [] },
    )))).toHaveLength(1);
  });
});

describe('dashboard-filter-field-unknown — gap 2: the PER-OBJECT injected set (#14275)', () => {
  const unknown = (fs: ReturnType<typeof validateWidgetBindings>) =>
    fs.filter((f) => f.rule === DASHBOARD_FILTER_FIELD_UNKNOWN);

  /** A bare `owner_id` dashboard filter, on the object knob that decides it. */
  const ownerFilter = (objectOverrides: Record<string, unknown>) =>
    dashboardDottedStack({ dateRange: undefined, globalFilters: [{ field: 'owner_id', type: 'select' }] },
      {}, {}, objectOverrides);

  it("reports owner_id on an `ownership: 'none'` object — the union answered this resolvable", () => {
    // The card's gap 2, stated as its consequence: the platform injects NO
    // `owner_id` here, so the broadcast filter emits `WHERE owner_id = …`
    // against a table without that column. The object-independent
    // `SYSTEM_FIELDS` union said "could be a system column anywhere" and the
    // rule stayed silent; `injectedColumnsFor` answers per object.
    const findings = unknown(validateWidgetBindings(ownerFilter({ ownership: 'none' })));
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].message).toContain('owner_id');
    expect(findings[0].message).toContain('crm_deal');
  });

  it('stays silent on the twin where the platform DOES inject it (mutation: drop `ownership`)', () => {
    // Breaks the other half of the derivation — without it the test above
    // would pass for a rule that simply flags every injected column.
    expect(unknown(validateWidgetBindings(ownerFilter({})))).toHaveLength(0);
  });

  it("reports created_at on an object that opts out of the audit family", () => {
    // The same gap on the built-in date range's DEFAULT field: a bare
    // `dateRange` lands on `created_at`, which `systemFields: { audit: false }`
    // withholds.
    const s = dashboardDottedStack(
      { dateRange: { defaultRange: 'this_month' } }, {}, {},
      { systemFields: { audit: false } },
    );
    const findings = unknown(validateWidgetBindings(s));
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('created_at');
  });

  it('stays silent on the same bare dateRange where the audit family IS injected', () => {
    expect(unknown(validateWidgetBindings(
      dashboardDottedStack({ dateRange: { defaultRange: 'this_month' } }),
    ))).toHaveLength(0);
  });
});

/**
 * [#14275] Both new answers gate `validate` AND `build`, pinned end-to-end
 * rather than inferred from the registry entry — `validateWidgetBindings` is
 * `commands: ALL`, and nothing else in this file would notice if that were
 * narrowed later. The dotted existence miss and the include miss are both
 * error-tier, so they also join the #7529 runtime publish gate as members of
 * the same "this board cannot render" reference-integrity class.
 */
describe('#14275 acceptance — the migrated branch gates `validate` AND `build`', () => {
  const missing = dashboardDottedStack({ dateRange: { field: 'acount.signed_at' } });
  const unjoined = dashboardDottedStack({}, {}, { include: [] });

  for (const command of ['validate', 'build'] as const) {
    it(`a dotted dashboard filter that does not resolve fails \`${command}\``, () => {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: missing }));
      expect(errors.map((f) => f.rule)).toContain(DASHBOARD_FILTER_FIELD_UNKNOWN);
    });

    it(`a resolvable-but-unjoined dotted dashboard filter fails \`${command}\``, () => {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: unjoined }));
      expect(errors.map((f) => f.rule)).toContain(DASHBOARD_FILTER_FIELD_NOT_INCLUDED);
    });

    it(`the clean shape passes \`${command}\``, () => {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: dashboardDottedStack() }));
      const mine = errors.filter((f) => [
        DASHBOARD_FILTER_FIELD_UNKNOWN, DASHBOARD_FILTER_FIELD_NOT_INCLUDED,
      ].includes(f.rule));
      expect(mine).toEqual([]);
    });
  }
});

// ── [#14148] The widget's OWN filter keys and options.sortBy ─────────────────

/**
 * The card's measured shape, reduced: a widget bound to a dataset over
 * `duly_task`, carrying its own presentation-scope `filter` and an
 * `options.sortBy`. The dataset joins `owner` so the include clause has both a
 * declared and an undeclared prefix to exercise.
 */
function widgetOwnStack(
  widgetOverrides: Record<string, unknown> = {},
  datasetOverrides: Record<string, unknown> = {},
) {
  return {
    objects: [
      {
        name: 'duly_task',
        fields: [
          { name: 'subject', type: 'text' },
          { name: 'due_date', type: 'date' },
          { name: 'business_unit', type: 'select' },
          { name: 'owner', type: 'lookup', reference: 'duly_user' },
          { name: 'estimate', type: 'number' },
        ],
      },
      {
        name: 'duly_user',
        fields: [
          { name: 'name', type: 'text' },
          { name: 'region', type: 'select' },
        ],
      },
    ],
    datasets: [{
      name: 'duly_workload',
      object: 'duly_task',
      include: ['owner'],
      dimensions: [{ name: 'business_unit', field: 'business_unit' }],
      measures: [
        { name: 'untouched_over_14d', aggregate: 'count' },
        { name: 'total_estimate', aggregate: 'sum', field: 'estimate' },
      ],
      ...datasetOverrides,
    }],
    dashboards: [{
      name: 'duly_duty_health',
      widgets: [{
        id: 'not_moving_14d',
        type: 'table',
        dataset: 'duly_workload',
        dimensions: ['business_unit'],
        values: ['untouched_over_14d'],
        ...widgetOverrides,
      }],
    }],
  };
}

const idsOf = <T extends { rule: string }>(fs: T[], rule: string): T[] =>
  fs.filter((f) => f.rule === rule);

describe('widget-filter-field-unknown (#14148 limb A)', () => {
  it('errors on the card\'s repro — a widget filter key that is not a column', () => {
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack({
        filter: { due_daet: { $gte: '{today}', $lte: '{14_days_from_now}' } },
      })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    );
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    // Names dashboard, widget, key and object — the card's acceptance criterion.
    expect(f.where).toBe('dashboard "duly_duty_health" › widget "not_moving_14d"');
    expect(f.message).toContain('due_daet');
    expect(f.message).toContain('duly_task');
    expect(f.path).toBe('dashboards[0].widgets[0].filter.due_daet');
    // The "did you mean", and the object's field list, both present.
    expect(f.message).toContain('Did you mean "due_date"?');
    expect(f.hint).toContain('business_unit');
  });

  it('is silent on the clean shape — a real column', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({
        filter: { due_date: { $gte: '{today}' } },
      })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    )).toHaveLength(0);
  });

  it('descends $and / $or / $not rather than reading only top-level keys', () => {
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack({
        filter: { $and: [{ due_date: { $lte: '{today}' } }, { $not: { bogus_column: 1 } }] },
      })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('bogus_column');
  });

  it('judges the `{ field, operator }` rule shape and the `[field, op, value]` triple too', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({
        filter: { field: 'no_such_col', operator: 'equals', value: 1 },
      })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    )).toHaveLength(1);
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: ['no_such_col', '=', 1] })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    )).toHaveLength(1);
  });

  it('RESOLVES a dotted path through a declared include — the sub-question, answered', () => {
    // `owner` is declared in include and `region` is a real column on duly_user.
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: { 'owner.region': 'emea' } })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    )).toHaveLength(0);
    // ...and a dangling leaf on the joined object is caught, not skipped.
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: { 'owner.regionn': 'emea' } })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('duly_user');
  });

  it('reads a nested condition object as one dotted position, not a bare leaf', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: { owner: { region: { $eq: 'emea' } } } })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    )).toHaveLength(0);
  });

  it('errors when a hop is not a relationship at all', () => {
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: { 'estimate.total': 1 } })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('not a relationship');
  });

  it('takes skip 1 — an object this stack does not define is never reported', () => {
    const s = widgetOwnStack({ filter: { due_daet: 1 } });
    s.objects = s.objects.filter((o) => o.name !== 'duly_task');
    expect(idsOf(validateWidgetBindings(s), WIDGET_FILTER_FIELD_UNKNOWN)).toHaveLength(0);
  });

  it('takes skip 2 — an object with no readable field map is never reported', () => {
    const s = widgetOwnStack({ filter: { due_daet: 1 } });
    delete (s.objects[0] as { fields?: unknown }).fields;
    expect(idsOf(validateWidgetBindings(s), WIDGET_FILTER_FIELD_UNKNOWN)).toHaveLength(0);
  });

  it('takes skip 3 — a registry-injected system column resolves', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: { created_at: { $gte: '{today}' } } })),
      WIDGET_FILTER_FIELD_UNKNOWN,
    )).toHaveLength(0);
  });
});

describe('widget-filter-field-not-included (#14148 limb A, the include clause)', () => {
  it('errors when a resolvable dotted key traverses an UNDECLARED relationship', () => {
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack(
        { filter: { 'owner.region': 'emea' } },
        { include: [] },
      )),
      WIDGET_FILTER_FIELD_NOT_INCLUDED,
    );
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.message).toContain('owner');
    expect(f.message).toContain('duly_workload');
    expect(f.hint).toContain('(none)');
  });

  it('is silent for a bare base column — it needs no join', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ filter: { due_date: 1 } }, { include: [] })),
      WIDGET_FILTER_FIELD_NOT_INCLUDED,
    )).toHaveLength(0);
  });

  it('does not double-report: an unresolvable key yields the existence finding only', () => {
    const all = validateWidgetBindings(widgetOwnStack(
      { filter: { 'owner.regionn': 'emea' } },
      { include: [] },
    ));
    expect(idsOf(all, WIDGET_FILTER_FIELD_UNKNOWN)).toHaveLength(1);
    expect(idsOf(all, WIDGET_FILTER_FIELD_NOT_INCLUDED)).toHaveLength(0);
  });
});

describe('widget-sortby-unselected (#14148 limb B)', () => {
  it('errors on the card\'s repro — sortBy names nothing the widget selects', () => {
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack({
        options: { sortBy: 'not_selected', sortOrder: 'asc' },
      })),
      WIDGET_SORTBY_UNSELECTED,
    );
    expect(findings).toHaveLength(1);
    const [f] = findings;
    expect(f.severity).toBe('error');
    expect(f.where).toBe('dashboard "duly_duty_health" › widget "not_moving_14d"');
    expect(f.path).toBe('dashboards[0].widgets[0].options.sortBy');
    expect(f.message).toContain('not_selected');
    // Lists what the widget DOES select — the card's acceptance criterion.
    expect(f.message).toContain('business_unit');
    expect(f.message).toContain('untouched_over_14d');
  });

  it('is silent when sortBy names a selected dimension', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ options: { sortBy: 'business_unit' } })),
      WIDGET_SORTBY_UNSELECTED,
    )).toHaveLength(0);
  });

  it('is silent when sortBy names a selected measure', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ options: { sortBy: 'untouched_over_14d' } })),
      WIDGET_SORTBY_UNSELECTED,
    )).toHaveLength(0);
  });

  it('is silent when there is no sortBy at all', () => {
    expect(idsOf(
      validateWidgetBindings(widgetOwnStack({ options: { limit: 10 } })),
      WIDGET_SORTBY_UNSELECTED,
    )).toHaveLength(0);
  });

  it('names the declared-but-unselected case apart — the fix is a selection, not a spelling', () => {
    const findings = idsOf(
      validateWidgetBindings(widgetOwnStack({ options: { sortBy: 'total_estimate' } })),
      WIDGET_SORTBY_UNSELECTED,
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('is declared by dataset "duly_workload" but is not');
    expect(findings[0].hint).toContain("this widget's values");
  });

  it('does not double-report a dimension entry that rule (b) already errored on', () => {
    const all = validateWidgetBindings(widgetOwnStack({
      dimensions: ['business_unitt'],
      options: { sortBy: 'business_unitt' },
    }));
    expect(idsOf(all, WIDGET_DIMENSION_UNKNOWN)).toHaveLength(1);
    expect(idsOf(all, WIDGET_SORTBY_UNSELECTED)).toHaveLength(0);
  });
});

/**
 * [#14148] The card's binding acceptance criterion, pinned end-to-end rather
 * than inferred from the registry entry: BOTH limbs must fail `validate` AND
 * `build`. `build` is the publish gate and is where these currently ship, so a
 * validate-only fix was explicitly not acceptable — and nothing else in this
 * file would notice if the entry's `commands` were narrowed later.
 */
describe('#14148 acceptance — both limbs gate `validate` AND `build`', () => {
  const limbA = widgetOwnStack({ filter: { due_daet: { $gte: '{today}' } } });
  const limbB = widgetOwnStack({ options: { sortBy: 'not_selected', sortOrder: 'asc' } });

  for (const command of ['validate', 'build'] as const) {
    it(`limb A (widget filter key) fails \`${command}\``, () => {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: limbA }));
      expect(errors.map((f) => f.rule)).toContain(WIDGET_FILTER_FIELD_UNKNOWN);
    });

    it(`limb B (options.sortBy) fails \`${command}\``, () => {
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: limbB }));
      expect(errors.map((f) => f.rule)).toContain(WIDGET_SORTBY_UNSELECTED);
    });

    it(`the clean shape passes \`${command}\` on both limbs`, () => {
      const clean = widgetOwnStack({
        filter: { due_date: { $gte: '{today}' }, 'owner.region': 'emea' },
        options: { sortBy: 'business_unit', sortOrder: 'asc' },
      });
      const { errors } = splitBySeverity(runAuthoringRules(command, { normalized: clean }));
      const mine = errors.filter((f) => [
        WIDGET_FILTER_FIELD_UNKNOWN, WIDGET_FILTER_FIELD_NOT_INCLUDED, WIDGET_SORTBY_UNSELECTED,
      ].includes(f.rule));
      expect(mine).toEqual([]);
    });
  }
});
