// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36373 — the report panel and the dashboard-widget panel speak
 * business wording: labels, not machine names.
 *
 * The card's acceptance, as a sweep over the rendered panel:
 *
 *  - The panel reads 「数据来源：商机指标」「指标：金额 · 合计、平均赢单概率 ·
 *    平均」「分组：阶段」「图表：柱状图」, and the name box reads the served
 *    「各阶段商机」, not the English source.
 *  - No machine name, chart-type token or old term is anywhere in the panel's
 *    text: `total_amount`, `stage`, `bar`, `opportunity_metrics`, `RLS`,
 *    「维度」「度量」「受治理」. A machine name lives in a `title` only.
 *  - The chart-type options are Chinese names, each with its icon.
 *  - In English the panel reads English labels, still with no machine name.
 *  - A filter binding names the filter: 「时间」 for the date range, the
 *    dimension label for a filter with no label of its own.
 *  - An edit of the name box lands in zh-CN: `{ default: SOURCE, 'zh-CN': EDIT }`.
 *
 * The fixture mirrors the HotCRM report the card measured
 * (`opportunity_metrics`), with its labels already resolved — the catalog
 * hook's job, pinned in `datasetPickers.authorText-11161.test.tsx`.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';
await loadStudioCatalogue('zh');

vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const LABELS = {
  'zh-CN': {
    dataset: '商机指标',
    total_amount: '金额',
    avg_probability: '平均赢单概率',
    stage: '阶段',
    account_industry: '行业',
    owner_id: '负责人',
  },
  'en-US': {
    dataset: 'Opportunity metrics',
    total_amount: 'Amount',
    avg_probability: 'Win probability',
    stage: 'Stage',
    account_industry: 'Industry',
    owner_id: 'Owner',
  },
} as const;
type Locale = keyof typeof LABELS;

function catalogIn(locale: Locale): DatasetCatalogEntry[] {
  const l = LABELS[locale];
  return [
    {
      name: 'opportunity_metrics',
      label: l.dataset,
      description: 'Governed opportunity facts with RLS enforced',
      dimensions: [
        { name: 'stage', label: l.stage, type: 'text' },
        { name: 'account_industry', label: l.account_industry, type: 'text' },
        { name: 'owner', field: 'owner_id', label: l.owner_id, type: 'lookup' },
      ],
      measures: [
        { name: 'total_amount', label: l.total_amount, aggregate: 'sum' },
        { name: 'avg_probability', label: l.avg_probability, aggregate: 'avg' },
      ],
    },
  ];
}

const semantics = vi.hoisted(() => ({ locale: 'zh-CN' as 'zh-CN' | 'en-US' }));
// The hooks run at render, after the module body: `catalogIn` is in scope.
vi.mock('../previews/useDatasetCatalog', async (importOriginal) => {
  const real = await importOriginal<Record<string, any>>();
  return {
    ...real,
    // The widget inspector reads its members through `useDatasetSemantics`.
    useDatasetSemantics: () => {
      const [entry] = catalogIn(semantics.locale);
      return { dimensions: entry.dimensions, measures: entry.measures, loading: false, error: null };
    },
    useDatasetCatalog: (override?: DatasetCatalogEntry[]) => ({
      datasets: override ?? catalogIn(semantics.locale),
      loading: false,
      error: null,
    }),
  };
});

import { ReportDefaultInspector } from './ReportDefaultInspector';
import { DashboardWidgetInspector } from './DashboardWidgetInspector';
import { ServedReportTextContext } from '../../studio-design/servedReportText';
import { t } from '../i18n';

afterEach(cleanup);

const SOURCE = 'Opportunities by Stage';
const SERVED = '各阶段商机';

const REPORT = {
  name: 'opportunities_by_stage',
  label: SOURCE,
  type: 'summary',
  dataset: 'opportunity_metrics',
  rows: ['stage'],
  values: ['total_amount', 'avg_probability'],
  chart: { type: 'bar', xAxis: 'stage', yAxis: 'total_amount' },
};

/** The words no panel may print: machine names, a chart token, the old terms. */
const FORBIDDEN = ['total_amount', 'avg_probability', 'account_industry', 'opportunity_metrics', 'stage', 'bar', 'RLS', '维度', '度量', '受治理'];

function visibleText(el: HTMLElement): string {
  // A Radix select keeps a hidden native <select> for forms; its <option>s are
  // not on screen. Everything else in the panel is.
  const clone = el.cloneNode(true) as HTMLElement;
  clone.querySelectorAll('select[aria-hidden="true"]').forEach((s) => s.remove());
  return clone.textContent ?? '';
}

function mountReport(locale: Locale, onPatch = vi.fn()) {
  semantics.locale = locale;
  return render(
    <ServedReportTextContext.Provider value={{ label: { authored: SOURCE, served: SERVED } }}>
      <ReportDefaultInspector
        type="report"
        name={REPORT.name}
        locale={locale}
        draft={{ ...REPORT }}
        onPatch={onPatch}
        readOnly={false}
        datasetCatalogOverride={catalogIn(locale)}
      />
    </ServedReportTextContext.Provider>,
  );
}

describe('the report panel speaks business wording (objectstack#36373)', () => {
  it('zh-CN: 数据来源 商机指标, 指标 金额 · 合计, 分组 阶段, 图表 柱状图, and the served name', () => {
    const { container } = mountReport('zh-CN');
    const text = visibleText(container);
    for (const word of ['数据来源', '商机指标', '指标', '金额 · 合计', '平均赢单概率 · 平均', '分组', '阶段', '柱状图']) {
      expect(text, word).toContain(word);
    }
    expect(screen.getByDisplayValue(SERVED)).toBeInTheDocument();
    expect(screen.queryByDisplayValue(SOURCE)).toBeNull();
    expect(screen.getByTestId('report-dataset-hint')).toHaveTextContent('报表从这里取数；每个人只能看到自己有权限的记录。');
  });

  it('zh-CN: no machine name, chart token or old term anywhere in the panel text', () => {
    const { container } = mountReport('zh-CN');
    const text = visibleText(container);
    for (const word of FORBIDDEN) expect(text, word).not.toContain(word);
  });

  it('a machine name is still there for the builder — on hover', () => {
    const { container } = mountReport('zh-CN');
    const titles = Array.from(container.querySelectorAll('[title]')).map((el) => el.getAttribute('title'));
    expect(titles).toEqual(expect.arrayContaining(['stage', 'total_amount', 'avg_probability']));
  });

  it('zh-CN: the chart types are Chinese names, each with its icon', async () => {
    mountReport('zh-CN');
    await userEvent.click(screen.getByRole('combobox', { name: t('engine.inspector.report.chartType', 'zh-CN') }));
    const options = await screen.findAllByRole('option');
    const names = options.map((o) => (o.textContent ?? '').trim());
    expect(names).toEqual(['不显示图表（只看表格）', '柱状图', '柱形图', '折线图', '面积图', '饼图', '环形图']);
    // Every chart (not the "none" row) carries its icon.
    for (const o of options.slice(1)) expect(o.querySelector('svg'), o.textContent ?? '').not.toBeNull();
  });

  it('en-US: English labels, and still no machine name', () => {
    const { container } = mountReport('en-US');
    const text = visibleText(container);
    for (const word of ['Data source', 'Opportunity metrics', 'Metrics', 'Amount · Sum', 'Group by', 'Stage', 'Bar Chart']) {
      expect(text, word).toContain(word);
    }
    for (const word of FORBIDDEN.filter((w) => w !== 'stage')) expect(text, word).not.toContain(word);
    // `Stage` is the label; the lowercase machine name is not printed.
    expect(text).not.toMatch(/\bstage\b/);
  });

  it('an edit of the served name lands in zh-CN, the English source byte-identical', () => {
    const onPatch = vi.fn();
    mountReport('zh-CN', onPatch);
    fireEvent.change(screen.getByDisplayValue(SERVED), { target: { value: '商机阶段分布' } });
    expect(onPatch).toHaveBeenCalledWith({ label: { default: SOURCE, 'zh-CN': '商机阶段分布' } });
  });
});

// ─── The dashboard-widget panel ──────────────────────────────────────────────

const DASHBOARD = {
  dateRange: { field: 'close_date', defaultRange: 'last_30_days' },
  globalFilters: [
    // No label of its own: the row names it by the dimension's label.
    { name: 'owner_id', field: 'owner_id', type: 'lookup' },
    { name: 'lead_source', field: 'lead_source', label: { en: 'Lead source', 'zh-CN': '线索来源' }, type: 'select', options: [{ value: 'web', label: 'Web' }] },
  ],
  widgets: [
    {
      id: 'w1',
      type: 'bar',
      title: 'Revenue by Industry',
      dataset: 'opportunity_metrics',
      dimensions: ['account_industry'],
      values: ['total_amount'],
    },
  ],
};

function mountWidget(locale: Locale) {
  semantics.locale = locale;
  return render(
    <DashboardWidgetInspector
      type="dashboard"
      name="executive_overview"
      locale={locale}
      draft={DASHBOARD}
      selection={{ kind: 'widget', id: 'w1' }}
      onPatch={vi.fn()}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
    />,
  );
}

describe('the dashboard-widget panel speaks business wording (objectstack#36373)', () => {
  it('zh-CN: 数据来源 商机指标, 分组 行业, 指标 金额 · 合计, and the filters by name', () => {
    const { container } = mountWidget('zh-CN');
    const text = visibleText(container);
    for (const word of ['数据来源', '商机指标', '分组', '行业', '指标', '金额 · 合计', '跟着页面顶部的筛选变']) {
      expect(text, word).toContain(word);
    }
    expect(within(screen.getByTestId('widget-filter-binding-dateRange')).getByText('时间')).toBeInTheDocument();
    expect(within(screen.getByTestId('widget-filter-binding-owner_id')).getByText('负责人')).toBeInTheDocument();
    expect(within(screen.getByTestId('widget-filter-binding-lead_source')).getByText('线索来源')).toBeInTheDocument();
  });

  it('zh-CN: no machine name, filter name or old term anywhere in the panel text', () => {
    const { container } = mountWidget('zh-CN');
    const text = visibleText(container);
    for (const word of [...FORBIDDEN, 'dateRange', 'owner_id', 'lead_source']) expect(text, word).not.toContain(word);
  });
});
