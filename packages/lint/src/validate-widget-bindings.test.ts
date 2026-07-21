import { describe, it, expect } from 'vitest';
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
    for (const type of ['metric', 'kpi', 'gauge', 'table']) {
      expect(validateWidgetBindings(chartStack({ type, chartConfig: undefined }))).toHaveLength(0);
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

  it('skips a relationship-path filter field (dotted paths are engine-resolved)', () => {
    expect(only(validateWidgetBindings(stack({ dateRange: { field: 'account.region' } })))).toHaveLength(0);
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
