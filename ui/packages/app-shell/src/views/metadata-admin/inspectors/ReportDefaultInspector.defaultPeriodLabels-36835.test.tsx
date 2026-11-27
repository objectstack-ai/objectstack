// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36835 — the report inspector's Default Period select
 * (「Period & export」 → Date Range → Default Period) listed each option by its
 * stored preset, `this_month`, in English and in Chinese alike.
 *
 * The spec form names the options in English; under zh the metadata-form
 * overlay names them with the platform pack's words (objectstack#37607, which
 * retired the console-side renaming this file first pinned).
 *
 *  - en: the options read the spec's names, and never a stored preset.
 *  - zh: the options read Chinese names. POSITIVE CONTROL in the same run: the
 *    row's own zh label (默认时间段, from the same overlay), so a dead locale
 *    channel cannot pass for "not relabelled".
 *  - The select's names equal the rows the report page's period chip reads
 *    (`dashboard.filters.range.*`, `dashboard.filters.custom`), in en and in zh,
 *    so the two surfaces that name a period cannot drift apart.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
// Loaded at module top so the source's dynamic imports of these two are paid
// during collection, never inside a case's clocked window.
import '@objectstack/formula';
import '@objectstack/lint';
import { I18nProvider, en } from '@object-ui/i18n';
import { zh } from '@object-ui/i18n/locales';
import { reportForm } from '@objectstack/spec/ui';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import { getReportForm } from '../report-schema';
import type { DatasetCatalogEntry } from '../previews/useDatasetCatalog';
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

afterEach(cleanup);

// Same module-scope fetch double as ReportDefaultInspector.test.tsx: the
// dataset semantics read fires a request no test body awaits.
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

const catalog: DatasetCatalogEntry[] = [
  {
    name: 'sales_metrics',
    label: 'Sales metrics',
    dimensions: [{ name: 'close_date', type: 'date' }],
    measures: [{ name: 'total_amount', aggregate: 'sum' }],
  },
];

const draft = {
  name: 'pipeline',
  label: 'Pipeline',
  type: 'summary',
  dataset: 'sales_metrics',
  rows: ['close_date'],
  values: ['total_amount'],
  dateRange: { defaultRange: 'this_quarter' },
};

/** The spec's Default Period options, as the form declares them. */
function specOptions(): Array<{ label: string; value: string }> {
  for (const section of reportForm.sections ?? []) {
    for (const field of (section.fields ?? []) as any[]) {
      if (field?.field !== 'dateRange') continue;
      const child = (field.fields ?? []).find((c: any) => c?.field === 'defaultRange');
      if (child?.options) return child.options;
    }
  }
  throw new Error('reportForm declares no dateRange.defaultRange options');
}

function renderIn(language: string, locale: 'en-US' | 'zh-CN') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <ReportDefaultInspector
        type="report"
        name="pipeline"
        draft={draft}
        onPatch={vi.fn()}
        readOnly={false}
        onSelectionChange={vi.fn()}
        datasetCatalogOverride={catalog}
        locale={locale}
      />
    </I18nProvider>,
  );
}

async function openDefaultPeriod(sectionTitle: string, rowLabel: string): Promise<string[]> {
  fireEvent.click(await screen.findByText(sectionTitle));
  const trigger = await screen.findByRole('combobox', { name: rowLabel });
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  await waitFor(() => expect(screen.queryAllByRole('option').length).toBeGreaterThan(0));
  return screen.getAllByRole('option').map((o) => o.textContent ?? '');
}

const VALUES = specOptions().map((o) => o.value);

/** The console row the period chip reads for a Default Period value. */
const chipKey = (value: string) =>
  value === 'custom' ? 'dashboard.filters.custom' : `dashboard.filters.range.${value}`;

/** The Default Period options of the report form as `getReportForm` names them for `locale`. */
function namedOptions(locale: string): Array<{ label: string; value: string }> {
  for (const section of getReportForm(locale)?.sections ?? []) {
    for (const field of (section.fields ?? []) as any[]) {
      if (field?.field !== 'dateRange') continue;
      const child = (field.fields ?? []).find((c: any) => c?.field === 'defaultRange');
      if (child?.options) return child.options;
    }
  }
  throw new Error('the report form names no dateRange.defaultRange options');
}

const readPack = (pack: unknown, key: string) =>
  key.split('.').reduce((node: any, seg) => node?.[seg], pack as Record<string, any>);

describe('#36835 — the Default Period select names its periods', () => {
  it('the spec English names are the en locale pack rows the period chip reads', () => {
    for (const { value, label } of specOptions()) {
      expect(readPack(en, chipKey(value)), value).toBe(label);
    }
  });

  it('the zh names are the zh locale pack rows the period chip reads', () => {
    for (const { value, label } of namedOptions('zh-CN')) {
      expect(readPack(zh, chipKey(value)), value).toBe(label);
    }
  });

  it('en: every option reads the spec name, never a stored preset', async () => {
    renderIn('en', 'en-US');
    const offered = await openDefaultPeriod('Period & export', 'Default Period');
    expect(offered).toEqual(expect.arrayContaining(specOptions().map((o) => o.label)));
    expect(offered).toContain('This quarter');
    for (const value of VALUES) expect(offered, value).not.toContain(value);
  });

  it('zh: every option reads its Chinese name', async () => {
    renderIn('zh', 'zh-CN');
    // POSITIVE CONTROL: the row label comes through the zh overlay.
    const offered = await openDefaultPeriod('时间段与导出', '默认时间段');
    await waitFor(() => expect(offered).toContain('本季度'));
    expect(offered).toEqual(expect.arrayContaining(['本月', '今天', '近 30 天', '自定义…']));
    for (const { value, label } of specOptions()) {
      expect(offered, value).not.toContain(value);
      expect(offered, label).not.toContain(label);
    }
  });
});
