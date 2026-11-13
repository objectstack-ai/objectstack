// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dashboard and report advisories' user-facing sentences in the request's
 * language (ruling record 6819749037, the pattern `finding-user-text.test.ts`
 * pins for the security-posture rule): the widget-binding rule's catalog
 * (`validate-widget-bindings.user-text.ts`) and the chart-binding rule's
 * (`validate-chart-bindings.user-text.ts`), each rendered from the rule's REAL
 * findings in every platform locale, and carried out of the publish door.
 */

import { describe, it, expect } from 'vitest';
import { RuntimeAuthoringIssueSchema } from '@objectstack/spec/api';
import { PLATFORM_LOCALE_TAGS } from '@objectstack/spec/system';
import { FINDING_USER_TEXT_CATALOG, findingUserMessage } from './finding-user-text.js';
import { WIDGET_BINDINGS_USER_TEXT } from './validate-widget-bindings.user-text.js';
import { CHART_BINDINGS_USER_TEXT } from './validate-chart-bindings.user-text.js';
import {
  CHART_DIMENSIONS_MISSING,
  CHART_FIELD_UNKNOWN,
  CHART_MEASURES_MISSING,
  DASHBOARD_FILTER_FIELD_UNPROVISIONED,
  MEASURE_AGGREGATE_INCOHERENT,
  TABLE_COUNT_ONLY,
  WIDGET_LEGACY_ANALYTICS_SHAPE,
  WIDGET_MEASURES_MISSING,
  validateWidgetBindings,
} from './validate-widget-bindings.js';
import {
  CHART_AXIS_NOT_SELECTED,
  CHART_MEASURE_UNKNOWN,
  validateChartBindings,
} from './validate-chart-bindings.js';
import { PAGE_VISUALIZATION_WITHOUT_BINDING } from './validate-page-visualization-bindings.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';

type AnyRec = Record<string, unknown>;

/** The widget-binding advisory ids the publish door returns on a dashboard write. */
const WIDGET_ADVISORY_RULES = [
  WIDGET_LEGACY_ANALYTICS_SHAPE,
  DASHBOARD_FILTER_FIELD_UNPROVISIONED,
  CHART_FIELD_UNKNOWN,
  CHART_MEASURES_MISSING,
  WIDGET_MEASURES_MISSING,
  CHART_DIMENSIONS_MISSING,
  TABLE_COUNT_ONLY,
];

/** The chart-binding advisory ids the publish door returns on a report write. */
const CHART_ADVISORY_RULES = [CHART_MEASURE_UNKNOWN, CHART_AXIS_NOT_SELECTED];

// ── Fixtures: one dataset, one dashboard widget, one report ──────────────────

const OBJ = {
  name: 'expense_line',
  fields: { amount: { type: 'currency' }, category: { type: 'text' } },
};
const DATASET = {
  name: 'expense_line_metrics',
  object: 'expense_line',
  dimensions: [{ name: 'category', field: 'category' }],
  measures: [
    { name: 'sum_amount', aggregate: 'sum', field: 'amount' },
    { name: 'ticket_count', aggregate: 'count' },
  ],
};
const dashboardStack = (widget: AnyRec): AnyRec => ({
  objects: [OBJ],
  datasets: [DATASET],
  dashboards: [{
    name: 'spend_dashboard',
    label: 'Spend',
    widgets: [{
      id: 'spend_by_category', type: 'bar', dataset: 'expense_line_metrics',
      dimensions: ['category'], values: ['sum_amount'], layout: { x: 0, y: 0, w: 6, h: 4 },
      ...widget,
    }],
  }],
});
/** The #8340 repro: a dashboard filter on an injected column of an external object. */
const UNPROVISIONED_STACK: AnyRec = {
  objects: [{ name: 'ext_customer', external: { remoteName: 'customers' }, fields: [{ name: 'email', type: 'text' }] }],
  datasets: [{
    name: 'customer_metrics', object: 'ext_customer',
    dimensions: [{ name: 'email', field: 'email' }], measures: [{ name: 'customer_count', aggregate: 'count' }],
  }],
  dashboards: [{
    name: 'federation_dashboard',
    globalFilters: [{ field: 'owner_id', type: 'select' }],
    widgets: [{ id: 'total_customers', type: 'metric', dataset: 'customer_metrics', values: ['customer_count'] }],
  }],
};
const reportStack = (chart: AnyRec): AnyRec => ({
  datasets: [DATASET],
  reports: [{
    name: 'spend_report', label: 'Spend', type: 'summary', dataset: 'expense_line_metrics',
    rows: ['category'], values: ['sum_amount'],
    chart: { type: 'bar', xAxis: 'category', yAxis: 'sum_amount', ...chart },
  }],
});

const DASH = { dashboard: 'spend_dashboard', widget: 'spend_by_category', dataset: 'expense_line_metrics' };

type Case = {
  label: string;
  rule: string;
  stack: AnyRec;
  params: Record<string, string>;
  run: (stack: AnyRec) => ReadonlyArray<{ rule: string; severity: string; userTextParams?: Record<string, string> }>;
};

const widgetCase = (label: string, rule: string, stack: AnyRec, params: Record<string, string>): Case =>
  ({ label, rule, stack, params, run: (s) => validateWidgetBindings(s as never) });
const chartCase = (label: string, rule: string, stack: AnyRec, params: Record<string, string>): Case =>
  ({ label, rule, stack, params, run: (s) => validateChartBindings(s as never) });

/**
 * One stack per advisory push site the publish door reaches, with the params
 * each finding must carry. Every push site of the nine ids is reached, both
 * `chart-field-unknown` sites (the x-axis one and the y-axis/series one, in
 * both of its positions) and both arms of `widget-measures-missing`.
 */
const CASES: readonly Case[] = [
  widgetCase('legacy analytics key on a dataset-bound widget', WIDGET_LEGACY_ANALYTICS_SHAPE,
    dashboardStack({ valueField: 'amount' }),
    { dashboard: 'spend_dashboard', widget: 'spend_by_category', keys: 'valueField' }),
  widgetCase('dashboard filter on an unprovisioned injected column', DASHBOARD_FILTER_FIELD_UNPROVISIONED,
    UNPROVISIONED_STACK,
    { dashboard: 'federation_dashboard', widget: 'total_customers', filter: 'owner_id', field: 'owner_id', object: 'ext_customer' }),
  widgetCase('x-axis field that is no dimension', CHART_FIELD_UNKNOWN,
    dashboardStack({ chartConfig: { type: 'bar', xAxis: { field: 'categories' } } }),
    { ...DASH, field: 'categories', axis: 'x' }),
  widgetCase('y-axis field that is no selected measure', CHART_FIELD_UNKNOWN,
    dashboardStack({ chartConfig: { type: 'bar', yAxis: [{ field: 'amount' }] } }),
    { ...DASH, field: 'amount', axis: 'y' }),
  widgetCase('series name that is no selected measure', CHART_FIELD_UNKNOWN,
    dashboardStack({ chartConfig: { type: 'bar', series: [{ name: 'value' }] } }),
    { ...DASH, field: 'value', axis: 'series' }),
  widgetCase('chart widget with no values', CHART_MEASURES_MISSING,
    dashboardStack({ values: [] }), DASH),
  widgetCase('metric widget with no values', WIDGET_MEASURES_MISSING,
    dashboardStack({ type: 'metric', dimensions: [], values: [] }), { ...DASH, shows: 'number' }),
  widgetCase('table widget with no values', WIDGET_MEASURES_MISSING,
    dashboardStack({ type: 'table', dimensions: [], values: [] }), { ...DASH, shows: 'table' }),
  widgetCase('chart widget with no dimensions', CHART_DIMENSIONS_MISSING,
    dashboardStack({ dimensions: [] }), DASH),
  widgetCase('count-only table without dimensions', TABLE_COUNT_ONLY,
    dashboardStack({ type: 'table', dimensions: [], values: ['ticket_count'] }), DASH),
  chartCase('report chart series naming no measure', CHART_MEASURE_UNKNOWN,
    reportStack({ series: [{ name: 'net_amount' }] }),
    { report: 'spend_report', measure: 'net_amount', dataset: 'expense_line_metrics' }),
  chartCase('report chart series naming a measure the chart does not plot', CHART_AXIS_NOT_SELECTED,
    reportStack({ series: [{ name: 'ticket_count' }] }),
    { report: 'spend_report', measure: 'ticket_count', dataset: 'expense_line_metrics', plotted: 'sum_amount' }),
];

/** The one finding of `rule` the case's stack produces. */
const findingOf = (c: Case) => {
  const found = c.run(c.stack).filter((f) => f.rule === c.rule);
  expect(found, `${c.label}: exactly one ${c.rule} finding`).toHaveLength(1);
  return found[0]!;
};

/** The params that are NAMES the sentence must show (not the variant selectors). */
const namesOf = (params: Record<string, string>): string[] =>
  Object.entries(params).filter(([key]) => key !== 'axis' && key !== 'shows').map(([, value]) => value);

describe('dashboard and report advisories user text · the catalogs', () => {
  it('the widget catalog holds a sentence for exactly its seven door-reaching ids, in every platform locale', () => {
    expect(Object.keys(WIDGET_BINDINGS_USER_TEXT).sort()).toEqual([...WIDGET_ADVISORY_RULES].sort());
    for (const [rule, entry] of Object.entries(WIDGET_BINDINGS_USER_TEXT)) {
      expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
    }
  });

  it('the chart catalog holds a sentence for exactly its two door-reaching ids, in every platform locale', () => {
    expect(Object.keys(CHART_BINDINGS_USER_TEXT).sort()).toEqual([...CHART_ADVISORY_RULES].sort());
    for (const [rule, entry] of Object.entries(CHART_BINDINGS_USER_TEXT)) {
      expect(Object.keys(entry).sort(), rule).toEqual([...PLATFORM_LOCALE_TAGS].sort());
    }
  });

  it('both are merged into the one finding catalog the door renders from', () => {
    for (const rule of WIDGET_ADVISORY_RULES) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(WIDGET_BINDINGS_USER_TEXT[rule]);
    }
    for (const rule of CHART_ADVISORY_RULES) {
      expect(FINDING_USER_TEXT_CATALOG[rule], rule).toBe(CHART_BINDINGS_USER_TEXT[rule]);
    }
  });

  it('keeps every rule id stable: the catalogs are keyed by the ids the findings already carry', () => {
    expect([...WIDGET_ADVISORY_RULES, ...CHART_ADVISORY_RULES]).toEqual([
      'widget-legacy-analytics-shape',
      'dashboard-filter-field-unprovisioned',
      'chart-field-unknown',
      'chart-measures-missing',
      'widget-measures-missing',
      'chart-dimensions-missing',
      'table-count-only',
      'chart-measure-unknown',
      'chart-axis-not-selected',
    ]);
  });

  it('the two advisory ids the door never returns have no sentence, and stay on the English message', () => {
    // `measure-aggregate-incoherent` judges `datasets[]`, which a dashboard
    // write carries as context on both sides of the differential; the page
    // visualization rule judges `pages[]`, which no per-write snapshot carries.
    expect(FINDING_USER_TEXT_CATALOG[MEASURE_AGGREGATE_INCOHERENT]).toBeUndefined();
    expect(FINDING_USER_TEXT_CATALOG[PAGE_VISUALIZATION_WITHOUT_BINDING]).toBeUndefined();
  });
});

describe('dashboard and report advisories user text · rendered from the rules\' real findings', () => {
  it.each(CASES.map((c) => [c.label, c] as const))('%s: carries its params and renders in every platform locale', (_label, c) => {
    const finding = findingOf(c);
    expect(finding.severity).toBe('warning');
    expect(finding.userTextParams).toEqual(c.params);

    const english = findingUserMessage(finding, ['en'])!;
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const text = findingUserMessage(finding, [tag]);
      expect(text, `${c.rule} · ${tag}`).toBeTruthy();
      expect(text, `${c.rule} · ${tag}`).not.toMatch(/undefined|\$\{/);
      for (const name of namesOf(c.params)) expect(text, `${c.rule} · ${tag} names ${name}`).toContain(name);
      // A real translation, not the English floor standing in for it.
      if (tag !== 'en') expect(text, `${c.rule} · ${tag}`).not.toBe(english);
    }
  });

  it('renders the three chart-field-unknown positions apart in every platform locale', () => {
    const findings = CASES.filter((c) => c.rule === CHART_FIELD_UNKNOWN).map(findingOf);
    for (const tag of PLATFORM_LOCALE_TAGS) {
      // Same names, so only `axis` tells the three apart.
      const texts = findings.map((f) => findingUserMessage({ ...f, userTextParams: { ...f.userTextParams!, field: 'f' } }, [tag]));
      expect(new Set(texts).size, tag).toBe(3);
    }
  });

  it('says what the widget fails to show: a number for a metric, a table for a table', () => {
    const [metric, table] = CASES.filter((c) => c.rule === WIDGET_MEASURES_MISSING)
      .map((c) => findingUserMessage(findingOf(c), ['en'])!);
    expect(metric).toContain('shows no number');
    expect(table).toContain('shows no table');
    for (const tag of PLATFORM_LOCALE_TAGS) {
      const [m, t] = CASES.filter((c) => c.rule === WIDGET_MEASURES_MISSING)
        .map((c) => findingUserMessage(findingOf(c), [tag]));
      expect(m, tag).not.toBe(t);
    }
  });

  it('renders the dashboard sentence in zh-Hans and en with the widget, dashboard and dataset names', () => {
    const finding = findingOf(CASES.find((c) => c.rule === CHART_DIMENSIONS_MISSING)!);
    const zh = findingUserMessage(finding, ['zh-CN'])!;
    const en = findingUserMessage(finding, ['en-US'])!;
    expect(zh).toContain('仪表盘“spend_dashboard”中的图表组件“spend_by_category”');
    expect(zh).toContain('数据集“expense_line_metrics”');
    expect(en).toContain('Chart widget "spend_by_category" on dashboard "spend_dashboard"');
    expect(en).toContain('dataset "expense_line_metrics"');
  });

  it('names the measure the report chart plots, as the rule\'s message does', () => {
    const finding = findingOf(CASES.find((c) => c.rule === CHART_AXIS_NOT_SELECTED)!);
    expect(findingUserMessage(finding, ['en'])).toContain('(it plots "sum_amount")');
    expect(findingUserMessage(finding, ['zh-Hans'])).toContain('图表绘制的是“sum_amount”');
  });

  it('gives no sentence where the finding is not advice the door returns: an error, or a page chart', () => {
    // A query-position unknown measure is an ERROR (the series comes back empty).
    const query = validateChartBindings(reportStack({ yAxis: 'net_amount' }) as never)
      .filter((f) => f.rule === CHART_MEASURE_UNKNOWN);
    expect(query.map((f) => f.severity)).toEqual(['error']);
    expect(query[0]!.userTextParams).toBeUndefined();
    // A page chart's presentation positions are advice, judged only on the
    // whole stack: no per-write snapshot carries pages.
    const page = validateChartBindings({
      datasets: [DATASET],
      pages: [{
        name: 'spend_page', type: 'app',
        regions: [{ name: 'main', components: [{
          type: 'chart',
          properties: {
            dataset: 'expense_line_metrics', dimensions: ['category'], values: ['sum_amount'],
            series: [{ name: 'net_amount' }, { name: 'ticket_count' }],
          },
        }] }],
      }],
    } as never).filter((f) => f.rule === CHART_MEASURE_UNKNOWN || f.rule === CHART_AXIS_NOT_SELECTED);
    expect(page.map((f) => `${f.severity}:${f.rule}`)).toEqual([
      `warning:${CHART_MEASURE_UNKNOWN}`, `warning:${CHART_AXIS_NOT_SELECTED}`,
    ]);
    for (const f of page) expect(f.userTextParams, f.rule).toBeUndefined();
    // The dataset-level aggregate advisory carries none either.
    const incoherent = validateWidgetBindings({
      objects: [{ name: 'opportunity', fields: [{ name: 'probability', type: 'percent' }] }],
      datasets: [{ name: 'opportunity_ds', object: 'opportunity', measures: [{ name: 'p', aggregate: 'sum', field: 'probability' }] }],
    } as never).filter((f) => f.rule === MEASURE_AGGREGATE_INCOHERENT);
    expect(incoherent).toHaveLength(1);
    expect(incoherent[0]!.userTextParams).toBeUndefined();
  });
});

describe('dashboard and report advisories user text · from the runtime gate to the wire field', () => {
  /** The element the save door's `advisories[]` carries, with the sentence it renders. */
  const issueOf = (advisory: { rule: string; path: string; where: string; message: string; hint: string; severity: string; userTextParams?: Record<string, string> }, locales: string[]) =>
    RuntimeAuthoringIssueSchema.parse({
      rule: advisory.rule,
      path: advisory.path,
      where: advisory.where,
      message: advisory.message,
      hint: advisory.hint,
      severity: advisory.severity,
      userMessage: findingUserMessage(advisory, locales),
    });

  it('a dashboard write\'s advisory carries its params out of the gate and renders a valid userMessage', () => {
    const stack = dashboardStack({ dimensions: [] }) as { dashboards: AnyRec[]; objects: unknown[]; datasets: unknown[] };
    const result = runRuntimeAuthoringRules({
      type: 'dashboard',
      item: stack.dashboards[0],
      context: { objects: stack.objects, datasets: stack.datasets },
    });
    const advisory = result.advisories.find((f) => f.rule === CHART_DIMENSIONS_MISSING);
    expect(advisory, 'the gate returns the dimensions advisory for this write').toBeDefined();
    expect(advisory!.userTextParams).toEqual(DASH);

    const issue = issueOf(advisory!, ['zh-CN', 'en']);
    expect(issue.rule).toBe('chart-dimensions-missing');
    expect(issue.userMessage).toContain('图表组件“spend_by_category”');
    expect(issue.message).toBe(advisory!.message);
  });

  it('a report write\'s advisory carries its params out of the gate and renders a valid userMessage', () => {
    const stack = reportStack({ series: [{ name: 'ticket_count' }] }) as { reports: AnyRec[]; datasets: unknown[] };
    const result = runRuntimeAuthoringRules({ type: 'report', item: stack.reports[0], context: { datasets: stack.datasets } });
    const advisory = result.advisories.find((f) => f.rule === CHART_AXIS_NOT_SELECTED);
    expect(advisory, 'the gate returns the not-plotted advisory for this write').toBeDefined();
    expect(advisory!.userTextParams).toEqual({
      report: 'spend_report', measure: 'ticket_count', dataset: 'expense_line_metrics', plotted: 'sum_amount',
    });

    const issue = issueOf(advisory!, ['fr-FR', 'zh-CN']);
    expect(issue.rule).toBe('chart-axis-not-selected');
    expect(issue.userMessage).toContain('Dans le rapport « spend_report »');
  });
});
