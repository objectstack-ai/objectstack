// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11161 — the report inspector and the dashboard-widget inspector
 * show the author's text a dataset declares, beside the machine names.
 *
 * - Measure and dimension options show the member's `label` beside its name
 *   (the add-member list prints the name in its own code chip; a select item
 *   writes `LABEL (name)`; a measure keeps its ` · aggregate` hint).
 * - Dataset options show the dataset's `description`.
 * - Each falls back to the name when nothing is declared.
 * - A map-valued label resolves in the designer locale, under en and under zh.
 * - What a pick stores is the machine name, never the label.
 *
 * ── How the cases run ────────────────────────────────────────────────────────
 * The REAL inspectors and the REAL catalog hooks under the i18n provider in the
 * case's language; only the metadata client is a stand-in. The report reads
 * full documents off `list('dataset')`; the dashboard's list answers summaries
 * without members, so its members arrive through `useDatasetSemantics`'
 * `get('dataset', name)` hydration — both resolution paths are covered. Each
 * expected word of the inspector's own chrome is read from the catalogue with
 * `t` in the case's locale, so only the author's text is written out here.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, act, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';

const state = vi.hoisted(() => ({
  get: vi.fn(async (_type: string, _name: string): Promise<unknown> => undefined),
  list: vi.fn(async (_type: string): Promise<unknown[]> => []),
  metadataClient: null as unknown,
}));
state.metadataClient = {
  get: (type: string, name: string) => state.get(type, name),
  list: (type: string) => state.list(type),
};

vi.mock('../useMetadata', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMetadataClient: () => state.metadataClient,
}));

// Nothing here should reach the network; a stray read answers 404 instead of
// opening a socket (the objectui#7439 module-scope double).
vi.stubGlobal(
  'fetch',
  vi.fn(async () => new Response('null', { status: 404, headers: { 'content-type': 'application/json' } })),
);

import { t } from '../i18n';
import { ReportDefaultInspector } from './ReportDefaultInspector';
import { DashboardWidgetInspector } from './DashboardWidgetInspector';

const PIPELINE = {
  name: 'sales_pipeline',
  label: { en: 'Sales pipeline', 'zh-CN': '销售管道' },
  description: { en: 'Open deals by stage', 'zh-CN': '按阶段统计的在途商机' },
  dimensions: [
    { name: 'stage', label: { en: 'Stage', 'zh-CN': '阶段' }, type: 'text' },
    { name: 'region', type: 'text' },
  ],
  measures: [
    { name: 'revenue', label: { en: 'Revenue', 'zh-CN': '收入' }, aggregate: 'sum' },
    { name: 'deal_count', aggregate: 'count' },
  ],
};
/** Declares a label and nothing else: the fallback case for the description. */
const BARE = {
  name: 'bare_metrics',
  label: 'Bare metrics',
  dimensions: [{ name: 'day', type: 'date' }],
  measures: [{ name: 'hits', aggregate: 'sum' }],
};

type Lang = 'en' | 'zh';
const LANGS = ['en', 'zh'] as const;
const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
/** The author's text per case language — what the documents above declare. */
const TEXT = {
  en: { pipeline: 'Sales pipeline', description: 'Open deals by stage', stage: 'Stage', revenue: 'Revenue' },
  zh: { pipeline: '销售管道', description: '按阶段统计的在途商机', stage: '阶段', revenue: '收入' },
} as const;

let switchLanguage: ((lang: string) => Promise<void>) | null = null;
function LanguageProbe() {
  const { changeLanguage } = useObjectTranslation();
  React.useEffect(() => {
    switchLanguage = changeLanguage;
  }, [changeLanguage]);
  return null;
}

async function inLang(lang: Lang, ui: React.ReactElement) {
  await act(async () => {
    render(
      <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
        {ui}
        <LanguageProbe />
      </I18nProvider>,
    );
  });
  await flush();
  await flush();
}

async function flush() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * Open the Nth add-member popover and read each offered row as
 * `[label, name chip or null]` — the two slots `AddFieldPopover` renders.
 */
async function openAddMember(lang: Lang, nth: number): Promise<Array<[string, string | null]>> {
  const addText = t('engine.form.addFieldPlain', LOCALE[lang]);
  const triggers = screen.getAllByRole('button').filter((b) => norm(b.textContent) === addText);
  expect(triggers.length, 'the add-member triggers').toBeGreaterThan(nth);
  fireEvent.click(triggers[nth]);
  await flush();
  const dialog = await screen.findByRole('dialog');
  return within(dialog)
    .getAllByRole('button')
    .map((row) => [
      norm(row.querySelector('span.font-medium')?.textContent),
      row.querySelector('code') ? norm(row.querySelector('code')!.textContent) : null,
    ]);
}

/** Open a Radix select and read its items. */
async function selectItems(name: string): Promise<string[]> {
  await userEvent.click(screen.getByRole('combobox', { name }));
  return (await screen.findAllByRole('option')).map((o) => norm(o.textContent));
}

beforeEach(() => {
  switchLanguage = null;
  state.get.mockReset();
  state.list.mockReset();
});

afterEach(() => {
  cleanup();
});

// ─── The report inspector ────────────────────────────────────────────────────

function mountReport(lang: Lang, draft: Record<string, unknown>, onPatch = vi.fn()) {
  state.list.mockImplementation(async () => [PIPELINE, BARE]);
  state.get.mockImplementation(async () => undefined);
  return inLang(
    lang,
    <ReportDefaultInspector
      type="report"
      name="pipeline"
      locale={LOCALE[lang]}
      draft={{ name: 'pipeline', label: 'Pipeline', type: 'summary', ...draft }}
      onPatch={onPatch}
      readOnly={false}
    />,
  );
}

describe('the report inspector shows the dataset text beside the names (objectui#11161)', () => {
  for (const lang of LANGS) {
    const x = TEXT[lang];

    it(`${lang}: the dataset options show the description; one without it reads as before`, async () => {
      await mountReport(lang, {});
      const items = await selectItems(t('engine.inspector.report.dataset', LOCALE[lang]));
      expect(items).toEqual([
        `${x.pipeline} (sales_pipeline) — ${x.description}`,
        'Bare metrics (bare_metrics)',
      ]);
    });

    it(`${lang}: the measure options show the label beside the name, the aggregate kept`, async () => {
      await mountReport(lang, { dataset: 'sales_pipeline' });
      expect(await openAddMember(lang, 0)).toEqual([
        [`${x.revenue} · sum`, 'revenue'],
        // Nothing declared: the name, exactly as the option always read.
        ['deal_count · count', 'deal_count'],
      ]);
    });

    it(`${lang}: the dimension options show the label beside the name`, async () => {
      await mountReport(lang, { dataset: 'sales_pipeline' });
      expect(await openAddMember(lang, 1)).toEqual([
        [x.stage, 'stage'],
        ['region', null],
      ]);
    });

    it(`${lang}: the chart axis selects read LABEL (name), and the name alone when none is declared`, async () => {
      await mountReport(lang, { dataset: 'sales_pipeline', chart: { type: 'bar' } });
      expect(await selectItems(t('engine.inspector.report.chartX', LOCALE[lang]))).toEqual([
        `${x.stage} (stage)`,
        'region',
      ]);
      await userEvent.keyboard('{Escape}');
      await flush();
      expect(await selectItems(t('engine.inspector.report.chartY', LOCALE[lang]))).toEqual([
        `${x.revenue} (revenue) · sum`,
        'deal_count · count',
      ]);
    });
  }

  it('a pick stores the machine name, never the label', async () => {
    const onPatch = vi.fn();
    await mountReport('en', { dataset: 'sales_pipeline', values: ['deal_count'] }, onPatch);
    await openAddMember('en', 0);
    fireEvent.click(screen.getByText('Revenue · sum'));
    expect(onPatch).toHaveBeenCalledWith({ values: ['deal_count', 'revenue'] });

    cleanup();
    const onPick = vi.fn();
    await mountReport('en', {}, onPick);
    await selectItems('Dataset');
    await userEvent.click(screen.getByRole('option', { name: 'Sales pipeline (sales_pipeline) — Open deals by stage' }));
    expect(onPick).toHaveBeenCalledWith({ dataset: 'sales_pipeline' });
  });
});

// ─── The dashboard-widget inspector ──────────────────────────────────────────

/** The dashboard's list answers summaries; `get` hydrates the bound dataset. */
function mountWidget(lang: Lang, widget: Record<string, unknown>, onPatch = vi.fn()) {
  state.list.mockImplementation(async () =>
    [PIPELINE, BARE].map(({ name, label, ...rest }) => ({
      name,
      label,
      ...('description' in rest ? { description: rest.description } : {}),
    })),
  );
  state.get.mockImplementation(async (_type: string, name: string) =>
    [PIPELINE, BARE].find((d) => d.name === name),
  );
  return inLang(
    lang,
    <DashboardWidgetInspector
      type="dashboard"
      name="sales"
      locale={LOCALE[lang]}
      draft={{
        globalFilters: [{ name: 'stage_filter', field: 'stage', label: 'Stage filter', type: 'select', options: [{ value: 'won', label: 'Won' }] }],
        widgets: [{ id: 'w1', type: 'bar', title: 'Pipeline', ...widget }],
      }}
      selection={{ kind: 'widget', id: 'w1' }}
      onPatch={onPatch}
      onClearSelection={() => {}}
      onSelectionChange={() => {}}
      readOnly={false}
    />,
  );
}

describe('the dashboard-widget inspector shows the dataset text beside the names (objectui#11161)', () => {
  for (const lang of LANGS) {
    const x = TEXT[lang];

    it(`${lang}: the dataset options show the description as the option's hint`, async () => {
      await mountWidget(lang, {});
      fireEvent.click(screen.getByRole('combobox', { name: t('engine.inspector.widget.dataset', LOCALE[lang]) }));
      await flush();
      const [pipeline, bare] = screen.getAllByRole('option');
      expect(within(pipeline).getByText('sales_pipeline')).toBeInTheDocument();
      expect(within(pipeline).getByText(`${x.pipeline} (sales_pipeline)`)).toBeInTheDocument();
      expect(within(pipeline).getByText(x.description)).toBeInTheDocument();
      // No description declared: no hint. The combo leads with the option's
      // label and puts the machine name after it (objectui#12303).
      expect(norm(bare.textContent)).toBe('Bare metrics (bare_metrics) bare_metrics');
    });

    it(`${lang}: the measure and dimension options show the label beside the name`, async () => {
      await mountWidget(lang, { dataset: 'sales_pipeline' });
      expect(state.get).toHaveBeenCalledWith('dataset', 'sales_pipeline');
      expect(await openAddMember(lang, 0)).toEqual([
        [x.stage, 'stage'],
        ['region', null],
      ]);
      await userEvent.keyboard('{Escape}');
      await flush();
      expect(await openAddMember(lang, 1)).toEqual([
        [`${x.revenue} · sum`, 'revenue'],
        ['deal_count · count', 'deal_count'],
      ]);
    });

    it(`${lang}: the filter-binding field options show the dimension label beside its name`, async () => {
      await mountWidget(lang, { dataset: 'sales_pipeline' });
      const row = screen.getByTestId('widget-filter-binding-stage_filter');
      fireEvent.click(within(row).getByRole('combobox'));
      await flush();
      const [stage, region] = screen.getAllByRole('option');
      expect(within(stage).getByText('stage')).toBeInTheDocument();
      expect(within(stage).getByText(x.stage)).toBeInTheDocument();
      // No label declared: the name, and the type hint, as before.
      expect(norm(region.textContent)).toBe('regiontext');
    });
  }

  it('a pick stores the machine name, never the label', async () => {
    const onPatch = vi.fn();
    await mountWidget('en', { dataset: 'sales_pipeline' }, onPatch);
    await openAddMember('en', 1);
    fireEvent.click(screen.getByText('Revenue · sum'));
    expect(onPatch).toHaveBeenCalledWith({
      widgets: [expect.objectContaining({ id: 'w1', values: ['revenue'] })],
    });
  });

  it('a language switch re-reads the text without a refetch', async () => {
    await mountWidget('en', { dataset: 'sales_pipeline' });
    // The trigger shows the bound option's label. Read by its id: the host's
    // `locale` prop is not what switches here, the app language is.
    const trigger = () => document.getElementById('widget-dataset');
    expect(norm(trigger()?.textContent)).toBe('Sales pipeline (sales_pipeline)');
    expect(switchLanguage, 'the provider handed its language switch over').toBeTruthy();
    await act(async () => {
      await switchLanguage!('zh');
    });
    await flush();
    expect(norm(trigger()?.textContent)).toBe('销售管道 (sales_pipeline)');
    expect(state.list, 'one read of the catalog, not one per language').toHaveBeenCalledTimes(1);
    expect(state.get, 'one hydration of the bound dataset, not one per language').toHaveBeenCalledTimes(1);
  });
});
