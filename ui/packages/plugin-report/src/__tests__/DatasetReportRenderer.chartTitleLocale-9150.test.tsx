// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#9150 — a report chart's own `h3` heading narrowed `chart.title` to a
 * plain string, so a title authored as the spec's INLINE LOCALE MAP arm drew no
 * heading at all.
 *
 * `ReportChartSchema.title` is `I18nLabel`: a plain string OR an inline locale
 * map. `DatasetReportChart` paints the heading itself (it deliberately DROPS
 * `title` from the lowered chrome so the chart cannot draw a second one inside
 * its frame) and read it back through `typeof chart.title === 'string'`. The
 * map arm failed that test, `title` became `undefined`, and the `h3` was not
 * rendered — in EVERY language, with no diagnostic. Not the wrong language: no
 * heading, which is why no "does the heading match the locale" check could see
 * it.
 *
 * The repair converges this one read site onto the precedent already in the
 * same file: `pickLocalized`, the repo's one resolver for this union, which
 * `authoredSeriesLabel` a few lines above already uses.
 *
 * ## Scope
 *
 * The REPORT surface's own `h3`, both branches that paint it — the series chart
 * (`dataset-report-chart`) and the single-value metric (`dataset-report-metric`)
 * read ONE binding, and the triage note asked for that to be measured rather
 * than assumed. The dashboard surface is objectui#9038's and is not touched
 * here. The sibling `DatasetReportRenderer.chartLocaleChrome-9038.test.tsx`
 * covers `subtitle`/`description` on this surface; its scope note names this
 * gap as reported-not-pinned, and this file is what it was pointing at.
 *
 * ## Every case pins TWO languages, on purpose
 *
 * A single-language assertion cannot tell `pickLocalized` apart from "picked
 * the first key in the map" — with `en` written FIRST in every fixture below, a
 * first-key pick returns the English limb and a lone `en` assertion passes
 * under a wrong repair. Two languages over one authored document must draw two
 * DIFFERENT headings; that is the un-fakeable signal (objectui#8943's defect
 * was exactly a first-string-wins pick).
 *
 * ## The missing-language case, decided rather than left to `|| undefined`
 *
 * `pickLocalized` resolves exact tag -> base language -> region-qualified
 * sibling -> `default` -> `en` -> first entry, and spells a total miss `''`.
 * The ruling pinned below is that this renderer does NOT re-decide any of that:
 *
 *  - a map with no limb for the active language FALLS BACK along that chain and
 *    still draws a heading (a heading in another language is strictly better
 *    than the silent nothing this card is about, and it is what every other
 *    `I18nLabel` on this surface already does — a second policy here would make
 *    the report the one surface that disagrees with the resolver);
 *  - `default` outranks `en`, so the fallback is the resolver's documented
 *    chain and not an ad-hoc "else English";
 *  - only a map with NO usable string at all resolves to `''`, and the
 *    `|| undefined` turns that into the absence the `{title ? … : null}` guards
 *    encode — an empty `h3` would be a rendered element with nothing in it.
 *
 * PREDICTIONS, written before the run: every locale-map case RED before the fix
 * (no `h3` at all, in either language); both plain-string controls GREEN on
 * both sides; the "no second heading" pin GREEN on both sides.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { ComponentRegistry } from '@object-ui/core';
import { I18nProvider } from '@object-ui/i18n';
import { DatasetReportRenderer } from '../DatasetReportRenderer';

/** The schema the registered chart component was handed, or `null`. */
let captured: { schema: Record<string, any> } | null = null;

beforeEach(() => {
  captured = null;
  ComponentRegistry.register('chart', (props: any) => {
    captured = props;
    return null;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const RESULT = {
  rows: [
    { stage: 'Qualification', amount: 120 },
    { stage: 'Negotiation', amount: 80 },
  ],
  fields: [
    { name: 'stage', type: 'text', label: 'Stage' },
    { name: 'amount', type: 'number', label: 'Amount' },
  ],
};

const sourceOf = (result: unknown) => ({ queryDataset: vi.fn(async () => result) });

const BASE = {
  name: 'pipeline_by_stage',
  type: 'tabular',
  dataset: 'pipeline_metrics',
  rows: ['stage'],
  values: ['amount'],
};

const CHART = { type: 'bar', xAxis: 'stage', yAxis: 'amount' } as const;
/** The single-value family, which paints the SAME `title` binding above its number. */
const METRIC = { type: 'kpi', yAxis: 'amount' } as const;

/**
 * ⚠️ `en` FIRST in every map. A "first key wins" pick therefore returns the
 * English limb, so a zh assertion below fails under that wrong repair instead
 * of passing by coincidence.
 */
const TITLE = { en: 'Pricing', 'zh-CN': '定价' };
/** `default` written AFTER `en`, so key order cannot be what selects it. */
const TITLE_DEFAULTED = { en: 'Pricing', default: 'Tarification' };
/** A map the contract admits that carries no usable string at all. */
const TITLE_EMPTY: Record<string, string> = {};

/** Render one authored report at one UI language. */
function renderAt(language: string, chart: Record<string, unknown>) {
  return render(
    <I18nProvider
      config={{ defaultLanguage: language, detectBrowserLanguage: false }}
      persistLanguage={false}
    >
      <DatasetReportRenderer
        report={{ ...BASE, chart } as never}
        dataSource={sourceOf(RESULT) as never}
      />
    </I18nProvider>,
  );
}

/** The text of the series chart's own heading, or `null` when none is drawn. */
async function seriesHeading(language: string, chart: Record<string, unknown>) {
  const { container } = renderAt(language, chart);
  const slot = await screen.findByTestId('dataset-report-chart');
  // The chart component is a registry stub that renders nothing, so the wait
  // above is on the SLOT; the heading is a sibling of it inside the same box.
  const h3 = slot.querySelector('h3');
  return { text: h3 ? h3.textContent : null, container, slot };
}

/** The text of the single-value metric's heading, or `null` when none is drawn. */
async function metricHeading(language: string, chart: Record<string, unknown>) {
  renderAt(language, chart);
  const slot = await screen.findByTestId('dataset-report-metric');
  const h3 = slot.querySelector('h3');
  return h3 ? h3.textContent : null;
}

describe('report chart heading — the inline-locale-map arm draws (objectui#9150)', () => {
  it('draws the heading for a locale-map title, resolved for the active language', async () => {
    // Before the fix there was no `h3` in this slot at all, in either language.
    const { text } = await seriesHeading('en', { ...CHART, title: TITLE });
    expect(text).toBe('Pricing');
  });

  it('the SAME authored document draws a DIFFERENT heading under another language', async () => {
    // The falsifier for "picked the first key": `en` is first in TITLE, so a
    // first-key pick prints 'Pricing' here and this fails.
    const en = await seriesHeading('en', { ...CHART, title: TITLE });
    cleanup();
    const zh = await seriesHeading('zh', { ...CHART, title: TITLE });
    expect(en.text).toBe('Pricing');
    expect(zh.text).toBe('定价');
    expect(zh.text).not.toBe(en.text);
  });

  it('leaves a plain-string title exactly where it was — the lit control', async () => {
    // This case rendered correctly BEFORE the fix and must render identically
    // after it. If it moves, the repair overshot.
    const en = await seriesHeading('en', { ...CHART, title: 'Pricing' });
    expect(en.text).toBe('Pricing');
    cleanup();
    const zh = await seriesHeading('zh', { ...CHART, title: 'Pricing' });
    // A plain string is not translatable metadata: it must NOT move with the
    // language. Same document, same bytes, both languages.
    expect(zh.text).toBe('Pricing');
  });

  it('still hands the chart NO title, so no second heading is drawn in its frame', async () => {
    // The most easily broken acceptance item: this renderer paints the heading,
    // so `title` must stay dropped from the lowered chrome.
    const { slot, container } = await seriesHeading('zh', { ...CHART, title: TITLE });
    await waitFor(() => expect(captured?.schema?.data?.length).toBe(2));
    expect(captured!.schema.title).toBeUndefined();
    // And exactly ONE heading exists on the rendered surface.
    expect(container.querySelectorAll('h3')).toHaveLength(1);
    expect(slot.querySelectorAll('h3')).toHaveLength(1);
  });
});

describe('report chart heading — the single-value branch reads the same binding', () => {
  it('draws a locale-map title above the metric, in the active language', async () => {
    // Measured, not assumed: the triage note asked for this branch to be shown
    // covered by the one change rather than inferred from the series branch.
    expect(await metricHeading('en', { ...METRIC, title: TITLE })).toBe('Pricing');
    cleanup();
    expect(await metricHeading('zh', { ...METRIC, title: TITLE })).toBe('定价');
  });

  it('leaves a plain-string metric title unchanged — the second lit control', async () => {
    expect(await metricHeading('en', { ...METRIC, title: 'Pricing' })).toBe('Pricing');
    cleanup();
    expect(await metricHeading('zh', { ...METRIC, title: 'Pricing' })).toBe('Pricing');
  });
});

describe('report chart heading — a map with no limb for the active language', () => {
  it('falls back along the resolver chain and still draws a heading', async () => {
    // `de` is in neither limb of TITLE. The ruling: fall back (here to `en`),
    // do NOT draw nothing — a heading in another language beats the silent
    // absence this card exists to remove, and it is what every other I18nLabel
    // on this surface already does.
    const { text } = await seriesHeading('de', { ...CHART, title: TITLE });
    expect(text).toBe('Pricing');
  });

  it('takes `default` over `en`, so the fallback is the resolver chain and not "else English"', async () => {
    // If this renderer had grown its own `?? title.en` fallback instead of
    // deferring to `pickLocalized`, this would read 'Pricing'.
    const { text } = await seriesHeading('de', { ...CHART, title: TITLE_DEFAULTED });
    expect(text).toBe('Tarification');
  });

  it('draws NO heading when the map carries no usable string at all', async () => {
    // `pickLocalized` spells a total miss `''`; `|| undefined` turns that into
    // the absence the `{title ? … : null}` guard encodes, so the surface gets
    // no empty `h3`.
    const { text, slot } = await seriesHeading('en', { ...CHART, title: TITLE_EMPTY });
    expect(text).toBeNull();
    expect(slot.querySelectorAll('h3')).toHaveLength(0);
  });

  it('draws no heading when no title is authored at all — unchanged', async () => {
    const { slot } = await seriesHeading('zh', { ...CHART });
    expect(slot.querySelectorAll('h3')).toHaveLength(0);
  });
});
