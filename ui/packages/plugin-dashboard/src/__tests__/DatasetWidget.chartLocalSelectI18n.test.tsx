// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#7696 — MEASUREMENT of the card's claimed-open 2x2 cell: a LOCAL
 * select dimension on a CHART widget. The card's own fixture, verbatim:
 * `duly_duty_register` on `duly_duty`, one local `form` dimension (a select
 * with three options), a pie with `showLegend: true`, and rows arriving
 * SERVER-RESOLVED to the object's authored ENGLISH labels (ADR-0021) — the
 * exact bytes the card measured off
 * `POST /api/v1/analytics/dataset/query`.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetWidget } from '../DatasetWidget';

/** Capture what the widget hands the chart renderer (jsdom lays out no SVG). */
let capturedChartProps: any = null;
beforeAll(() => {
  ComponentRegistry.register('chart', (props: any) => {
    capturedChartProps = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  capturedChartProps = null;
  vi.restoreAllMocks();
});

const FORM_OPTIONS = [
  { value: 'one_off', label: 'One-off' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'standing', label: 'Standing' },
];

/** The card's object. */
const DUTY = { name: 'duly_duty', fields: { form: { type: 'select', options: FORM_OPTIONS } } };
/** The SAME object with the option LIST absent — the control (see below). */
const DUTY_NO_OPTIONS = { name: 'duly_duty', fields: { form: { type: 'select' } } };

const ZH_BUNDLE = {
  zh: {
    duly: {
      fields: { duly_duty: { form: '形式' } },
      fieldOptions: {
        duly_duty: { form: { one_off: '一次性', recurring: '周期性', standing: '常设' } },
      },
    },
  },
};

function installMetaRouter(docs: Record<string, unknown>) {
  const requested: string[] = [];
  global.fetch = vi.fn(async (input: unknown) => {
    const url = String(input);
    const m = /\/api\/v1\/meta\/object\/(.+)$/.exec(url);
    const name = m ? decodeURIComponent(m[1]) : '';
    requested.push(name);
    const doc = docs[name];
    if (!doc) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => ({ item: doc }) };
  }) as any;
  return { requested };
}

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

/** The card's measurement: `rows[].form` carries the authored ENGLISH label. */
const serverResolvedPie = () =>
  sourceOf({
    rows: [
      { form: 'One-off', duty_count: 5 },
      { form: 'Recurring', duty_count: 3 },
      { form: 'Standing', duty_count: 2 },
    ],
    fields: [
      // `type: 'string'` — what a select dimension is on the wire.
      { name: 'form', type: 'string', label: '形式' },
      { name: 'duty_count', type: 'number', label: '数量' },
    ],
    object: 'duly_duty',
    dimensionFields: { form: 'form' },
    drillRawRows: [{ form: 'one_off' }, { form: 'recurring' }, { form: 'standing' }],
  });

const PIE_WIDGET = {
  type: 'pie',
  dataset: 'duly_duty_register',
  dimensions: ['form'],
  values: ['duty_count'],
  chartConfig: { showLegend: true },
};

function renderIn(language: string, ui: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false, resources: ZH_BUNDLE }}>
      {ui}
    </I18nProvider>,
  );
}

/**
 * The pie's categories, as the chart renderer receives them. A pie legend is
 * painted from exactly this: `AdvancedChartImpl`'s pie branch builds
 * `pieConfig[String(row[xAxisKey])] = { label: String(row[xAxisKey]) }` and
 * hands it to `ChartLegendContent nameKey={xAxisKey}`, so the legend text IS
 * the category string in these rows.
 */
const categories = () => (capturedChartProps?.schema?.data ?? []).map((r: any) => r.form);

describe('objectui#7696 — a LOCAL select dimension on a CHART widget', () => {
  it('renders the zh-CN option labels as the pie categories', async () => {
    const { requested } = installMetaRouter({ duly_duty: DUTY });
    renderIn('zh', <DatasetWidget widget={PIE_WIDGET} dataSource={serverResolvedPie()} />);
    await waitFor(() => expect(categories()).toContain('周期性'));
    expect(categories()).toEqual(['一次性', '周期性', '常设']);
    // The authored English label must not survive beside the translation.
    expect(categories()).not.toContain('Recurring');
    // ONE read, on the dataset's base object — a local path walks no relationship.
    expect(requested).toEqual(['duly_duty']);
  });

  it('CONTROL — with the option LIST absent the categories stay English', async () => {
    // A control that FIRES. `resolveDimensionFieldMeta` yields an entry only
    // for a terminal field that carries `options`, so removing them is the one
    // change that starves the seam while leaving every other input identical:
    // same rows, same bundle, same widget, same locale, same read. It is what
    // makes the assertion above a reading rather than a coincidence — the
    // fixture CAN produce English, and does, exactly when the option list the
    // locale bundle is keyed against is missing.
    const { requested } = installMetaRouter({ duly_duty: DUTY_NO_OPTIONS });
    renderIn('zh', <DatasetWidget widget={PIE_WIDGET} dataSource={serverResolvedPie()} />);
    await waitFor(() => expect(requested).toEqual(['duly_duty']));
    expect(categories()).toEqual(['One-off', 'Recurring', 'Standing']);
  });

  it('BOUNDARY — under `en` the chart reads the authored labels', async () => {
    installMetaRouter({ duly_duty: DUTY });
    renderIn('en', <DatasetWidget widget={PIE_WIDGET} dataSource={serverResolvedPie()} />);
    await waitFor(() => expect(capturedChartProps).not.toBeNull());
    expect(categories()).toEqual(['One-off', 'Recurring', 'Standing']);
  });
});
