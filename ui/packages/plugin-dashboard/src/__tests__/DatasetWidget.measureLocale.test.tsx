// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4566 — the dashboard's dataset-bound measures follow the display
 * locale.
 *
 * `formatMeasure` / `formatDimensionValue` live in `@object-ui/core`, which is
 * React-free, so they cannot read `useDisplayLocale()` themselves: the tag
 * arrives as their new optional last parameter and THIS component is what
 * threads it. The parameter lands with its consumers (the objectui#4272
 * playbook), so every site `DatasetWidget` formats through is exercised here —
 * the KPI, the flat grouped table's measure AND dimension cells, and the
 * cross-tab's header labels and cells.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────────
 * Runner machine locale measured as en-US.
 *   every de case                RED pre-fix — renders the en form
 *   every en counterpart         GREEN both sides — the byte-identity pins.
 *                                en must NOT move on this card: these sites
 *                                already grouped via `Intl`, so the only thing
 *                                the fix changes is WHOSE locale is used.
 *                                (Contrast objectui#4553, where `formatPercent`
 *                                had never grouped and moving en WAS the fix.)
 *   `buildPivot` unit case       RED pre-fix on the de half
 *
 * ⚠️ NOT asserted here, deliberately: a `useMemo` dependency. Unlike
 * objectui#4542 / #4553 none of this component's formatting happens inside a
 * memo — every site is in the render body — so there is no dependency array to
 * add the locale to and no dep-isolation case to write. Recorded so a later
 * reader does not go looking for the case that is missing.
 *
 * ⚠️ The objectui#4487 flake lives in the sibling `DatasetWidget.test.tsx`.
 * This file mounts the same component, so a red here is verified locally and
 * re-run before being owned.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider, LocalizationProvider, type LocalizationValue } from '@object-ui/i18n';
import { DatasetWidget, buildPivot } from '../DatasetWidget';

afterEach(cleanup);

/** German writes a NO-BREAK SPACE between the amount and the currency sign. */
const NBSP = '\u00a0';

type Row = Record<string, unknown>;

const makeSource = (rows: Row[], fields?: Row[]) => ({
  queryDataset: vi.fn(async () => ({ rows, ...(fields ? { fields } : {}) })),
});

/**
 * `locale` on the LocalizationProvider is the tenant's resolved regional
 * default — channel 1 of `useDisplayLocale`, which outranks the UI language.
 */
function renderIn(locale: string | undefined, widget: Row, dataSource: unknown, language = 'en') {
  const value: LocalizationValue = locale ? { locale } : {};
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={value}>
        <DatasetWidget widget={widget} dataSource={dataSource} />
      </LocalizationProvider>
    </I18nProvider>,
  );
}

const REVENUE_FIELDS = [{ name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' }];
const CURRENCY_FIELDS = [{ name: 'revenue', type: 'number', label: 'Revenue', format: '0.00', currency: 'EUR' }];
const METRIC_WIDGET = { type: 'metric', dataset: 'sales', values: ['revenue'] };

/**
 * Testing Library's DEFAULT normalizer collapses whitespace runs to a plain
 * space, and U+00A0 is whitespace — so the German currency form `1.234,50 €`
 * would be compared as if it were written with an ordinary space and the
 * no-break space could never be asserted. Trimming only keeps the byte the
 * locale actually produces, which is the whole point of the case.
 */
const KEEP_NBSP = { normalizer: (text: string) => text.trim() };

describe('DatasetWidget KPI follows the display locale (objectui#4566)', () => {
  it('renders the German form in a de session', async () => {
    renderIn('de-DE', METRIC_WIDGET, makeSource([{ revenue: 1234.5 }], REVENUE_FIELDS));
    expect(await screen.findByText('1.234,5')).toBeInTheDocument();
  });

  it('renders the English form unchanged in an en session (must-not-change)', async () => {
    renderIn('en-US', METRIC_WIDGET, makeSource([{ revenue: 1234.5 }], REVENUE_FIELDS));
    expect(await screen.findByText('1,234.5')).toBeInTheDocument();
  });

  it('follows the UI LANGUAGE when the tenant states no regional preference', async () => {
    // Channel 2 of `useDisplayLocale` — proves the widget reads the composed
    // hook rather than one provider.
    renderIn(undefined, METRIC_WIDGET, makeSource([{ revenue: 1234.5 }], REVENUE_FIELDS), 'de');
    expect(await screen.findByText('1.234,5')).toBeInTheDocument();
  });

  it('places the currency sign the way the locale does, not the way en does', async () => {
    renderIn('de-DE', METRIC_WIDGET, makeSource([{ revenue: 1234.5 }], CURRENCY_FIELDS));
    // German writes the sign LAST, separated by a no-break space.
    expect(await screen.findByText(`1.234,50${NBSP}€`, KEEP_NBSP)).toBeInTheDocument();
  });

  it('keeps the en currency form byte-identical (must-not-change)', async () => {
    renderIn('en-US', METRIC_WIDGET, makeSource([{ revenue: 1234.5 }], CURRENCY_FIELDS));
    // English writes it FIRST, with no space at all.
    expect(await screen.findByText('€1,234.50', KEEP_NBSP)).toBeInTheDocument();
  });
});

describe('DatasetWidget grouped table follows the display locale (objectui#4566)', () => {
  const TABLE_WIDGET = { type: 'table', dataset: 'sales', dimensions: ['bucket'], values: ['revenue'] };
  const FIELDS = [
    { name: 'bucket', type: 'number', label: 'Bucket' },
    { name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' },
  ];
  // A fractional DIMENSION value, so `formatDimensionValue` is exercised too —
  // it has its own formatting site and its own new parameter.
  const ROWS = [{ bucket: 9876.5, revenue: 1234.5 }];

  it('localizes both the measure cell and the dimension cell in a de session', async () => {
    renderIn('de-DE', TABLE_WIDGET, makeSource(ROWS, FIELDS));
    await waitFor(() => expect(screen.getByText('1.234,5')).toBeInTheDocument());
    expect(screen.getByText('9.876,5')).toBeInTheDocument();
  });

  it('leaves the en session byte-identical (must-not-change)', async () => {
    renderIn('en-US', TABLE_WIDGET, makeSource(ROWS, FIELDS));
    await waitFor(() => expect(screen.getByText('1,234.5')).toBeInTheDocument());
    expect(screen.getByText('9,876.5')).toBeInTheDocument();
  });
});

describe('DatasetWidget cross-tab follows the display locale (objectui#4566)', () => {
  // Two dimensions ⇒ `isMatrix`, which is the path through `buildPivot`.
  const PIVOT_WIDGET = { type: 'pivot', dataset: 'sales', dimensions: ['region', 'bucket'], values: ['revenue'] };
  const FIELDS = [
    { name: 'region', type: 'string', label: 'Region' },
    { name: 'bucket', type: 'number', label: 'Bucket' },
    { name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' },
  ];
  const ROWS = [{ region: 'EMEA', bucket: 9876.5, revenue: 1234.5 }];

  it('localizes the across-axis header label and the cell in a de session', async () => {
    renderIn('de-DE', PIVOT_WIDGET, makeSource(ROWS, FIELDS));
    // The column header comes from `buildPivot`'s `colHeaders[].label`.
    await waitFor(() => expect(screen.getByText('9.876,5')).toBeInTheDocument());
    expect(screen.getByText('1.234,5')).toBeInTheDocument();
  });

  it('leaves the en session byte-identical (must-not-change)', async () => {
    renderIn('en-US', PIVOT_WIDGET, makeSource(ROWS, FIELDS));
    await waitFor(() => expect(screen.getByText('9,876.5')).toBeInTheDocument());
    expect(screen.getByText('1,234.5')).toBeInTheDocument();
  });
});

describe('buildPivot localizes header labels but never the bucket IDs (objectui#4566)', () => {
  const ROWS = [
    { region: 'EMEA', bucket: 9876.5, revenue: 1 },
    { region: 'AMER', bucket: 1234.5, revenue: 2 },
  ];

  it('formats the header labels in the supplied locale', () => {
    const de = buildPivot(ROWS, ['region'], 'bucket', 'de-DE');
    expect(de.colHeaders.map((c) => c.label)).toEqual(['9.876,5', '1.234,5']);

    const en = buildPivot(ROWS, ['region'], 'bucket', 'en-US');
    expect(en.colHeaders.map((c) => c.label)).toEqual(['9,876.5', '1,234.5']);
  });

  /**
   * The ids are opaque keys built from the RAW values, so a locale change must
   * not re-key a cell — that would break `cellIndex` and drill-through with it.
   * Green on both sides of the fix; it pins a property the fix must not break.
   */
  it('keys cells identically in every locale', () => {
    const de = buildPivot(ROWS, ['region'], 'bucket', 'de-DE');
    const en = buildPivot(ROWS, ['region'], 'bucket', 'en-US');
    expect(de.colHeaders.map((c) => c.id)).toEqual(en.colHeaders.map((c) => c.id));
    expect(de.rowHeaders.map((r) => r.id)).toEqual(en.rowHeaders.map((r) => r.id));
    expect([...de.cellIndex.entries()]).toEqual([...en.cellIndex.entries()]);
  });

  /** Omitting the argument reproduces the previous machine-locale behaviour. */
  it('omitting the locale is byte-identical to the previous signature', () => {
    const omitted = buildPivot(ROWS, ['region'], 'bucket');
    const explicitUndefined = buildPivot(ROWS, ['region'], 'bucket', undefined);
    expect(omitted.colHeaders).toEqual(explicitUndefined.colHeaders);
  });
});
