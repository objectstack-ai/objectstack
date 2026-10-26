// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4575 — the metadata-admin dataset PREVIEW's measures and numeric
 * dimension values follow the display locale, not the machine's.
 *
 * objectui#4566 (PR #4577) gave `formatMeasure` / `formatDimensionValue` in
 * `@object-ui/core` an optional trailing `locale` and threaded
 * `useDisplayLocale()` from the dashboard's `DatasetWidget`. The parameter is
 * optional, so consumers that were not threaded kept formatting in the MACHINE's
 * locale — this preview's two call sites among them.
 *
 * ── Why every case pins TWO locales ──────────────────────────────────────────
 * A lone de assertion is not falsifiable: on a German runner it would pass
 * before the fix too. Each case pins the same value in de AND in en, so before
 * the fix — when both render in the machine's locale — at least one of the two
 * must fail on ANY runner.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────────
 * Runner machine locale measured as en-US.
 *   the de measure + dimension cases    RED pre-fix — render the en form
 *   the en counterparts                 GREEN both sides — byte-identity pins;
 *                                       en must NOT move on this card
 *   the `locale` PROP case              RED pre-fix, and it is the channel
 *                                       discriminator — see its own note
 *   malformed-tag guard                 GREEN both sides — a guard, labelled as
 *                                       such, not a pin of the defect
 */

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
// Same pre-warm as the sibling `DatasetPreview.test.tsx`, for the same reason:
// the preview renders its chart behind `React.lazy(() => import(...))`, and
// importing the package here moves that cost into this file's import phase —
// which no test or hook timeout applies to — instead of letting it race the
// assertions below. Keep the specifier identical to DatasetPreview.tsx's.
import '@object-ui/plugin-charts';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { formatMeasure } from '@object-ui/core';
import { DatasetPreview } from './DatasetPreview';

// Mock the data adapter the preview pulls from AdapterProvider.
const { queryDataset } = vi.hoisted(() => ({ queryDataset: vi.fn() }));
vi.mock('../../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ queryDataset }),
}));

/**
 * objectui#8187 — the preview now resolves its dimensions' option labels
 * through the shared label net, which issues `GET /api/v1/meta/object/<name>`.
 * happy-dom resolves that relative URL against `localhost:3000`, so without a
 * double every test here reaches a real socket and the network-escape guard
 * (objectui#6640) fails the file.
 *
 * The double serves the base object with NO select options, which is what these
 * cases have always assumed: nothing resolves, `relabelDimensions` returns the
 * server's rows by identity, and every assertion below is byte-identical to
 * what it pinned before that card. Label resolution itself is pinned in
 * `__tests__/DatasetPreview.dimensionLabels-8187.test.tsx`, not here.
 */
const realFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ item: { name: 'opportunity', fields: {} } }),
  })) as any;
});

afterEach(() => {
  cleanup();
  queryDataset.mockReset();
  global.fetch = realFetch;
});

/**
 * NOTE the `locale` prop is pinned to 'en-US' in EVERY case below. It is a
 * different channel from the one this card threads — it carries the metadata
 * designer's own chrome language (`useMetadataLocale()`, which resolves to
 * exactly 'en-US' or 'zh-CN'), never a number-formatting locale. Holding it at
 * en-US while the session is German is what proves the numbers follow
 * `useDisplayLocale()` rather than this prop.
 */
const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };

const draft = {
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [{ name: 'bucket', field: 'account.bucket' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount' }],
};

/** A fractional DIMENSION value alongside the measure, so both sites render. */
const RESULT = {
  rows: [{ bucket: 9876.5, revenue: 1234.5 }],
  fields: [
    { name: 'bucket', type: 'number', label: 'Bucket' },
    { name: 'revenue', type: 'number', label: 'Revenue', format: '0.0' },
  ],
};

/**
 * `locale` on the LocalizationProvider is the tenant's resolved regional
 * default — channel 1 of `useDisplayLocale`, which outranks the UI language.
 */
function renderIn(locale: string, ui: React.ReactElement, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>{ui}</LocalizationProvider>
    </I18nProvider>,
  );
}

describe('DatasetPreview follows the display locale (objectui#4575)', () => {
  it('localizes both the measure cell and the dimension cell in a de session', async () => {
    queryDataset.mockResolvedValue(RESULT);
    renderIn('de-DE', <DatasetPreview {...baseProps} draft={draft} />);
    // site 228 — the measure cell
    expect(await screen.findByText('1.234,5')).toBeInTheDocument();
    // site 229 — the numeric dimension cell
    expect(screen.getByText('9.876,5')).toBeInTheDocument();
  });

  it('leaves the en session byte-identical (must-not-change)', async () => {
    queryDataset.mockResolvedValue(RESULT);
    renderIn('en-US', <DatasetPreview {...baseProps} draft={draft} />);
    expect(await screen.findByText('1,234.5')).toBeInTheDocument();
    expect(screen.getByText('9,876.5')).toBeInTheDocument();
  });

  it('places the currency sign the way the locale does, not the way en does', async () => {
    queryDataset.mockResolvedValue({
      rows: [{ bucket: 1, revenue: 1234.5 }],
      fields: [
        { name: 'bucket', type: 'number', label: 'Bucket' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0.00', currency: 'EUR' },
      ],
    });
    renderIn('de-DE', <DatasetPreview {...baseProps} draft={draft} />);
    // German writes the sign LAST, separated by a NO-BREAK SPACE (U+00A0).
    // Testing Library's default normalizer collapses whitespace runs — U+00A0
    // among them — so a trim-only normalizer is what keeps the byte the locale
    // actually produces assertable (the objectui#4577 lesson).
    expect(
      await screen.findByText(`1.234,50\u00a0€`, { normalizer: (t: string) => t.trim() }),
    ).toBeInTheDocument();
  });

  it('keeps the en currency form byte-identical (must-not-change)', async () => {
    queryDataset.mockResolvedValue({
      rows: [{ bucket: 1, revenue: 1234.5 }],
      fields: [
        { name: 'bucket', type: 'number', label: 'Bucket' },
        { name: 'revenue', type: 'number', label: 'Revenue', format: '0.00', currency: 'EUR' },
      ],
    });
    renderIn('en-US', <DatasetPreview {...baseProps} draft={draft} />);
    expect(
      await screen.findByText('€1,234.50', { normalizer: (t: string) => t.trim() }),
    ).toBeInTheDocument();
  });

  /**
   * The channel discriminator. The designer chrome stays English (`locale`
   * prop) while the tenant's display locale is German — so a German number here
   * can only have come from `useDisplayLocale()`. Reading the prop instead
   * would render `1,234.5` and fail this case, which is what stops a later
   * reader from "simplifying" the hook away into the prop already in scope.
   */
  it('follows the display locale even though the designer chrome locale stays en-US', async () => {
    queryDataset.mockResolvedValue(RESULT);
    renderIn('de-DE', <DatasetPreview {...baseProps} locale="en-US" draft={draft} />);
    expect(await screen.findByText('1.234,5')).toBeInTheDocument();
  });

  /**
   * ⚠️ HONEST LABELLING — GREEN on both sides of the fix, because before it the
   * tag was never passed and nothing could throw. It pins that the hazard the
   * threading introduces is contained, not the #4575 defect. The containment
   * belongs to the producer (#4577's `formatNumberInLocale` retries without the
   * locale), so this asserts only that the surface survives and degrades to that
   * same no-locale output — computed through the function itself, so the
   * assertion does not depend on the runner's machine locale.
   */
  it('a malformed tenant locale tag degrades instead of taking the preview down', async () => {
    queryDataset.mockResolvedValue(RESULT);
    renderIn('en_US', <DatasetPreview {...baseProps} draft={draft} />);
    expect(await screen.findByText(formatMeasure(1234.5, '0.0'))).toBeInTheDocument();
  });
});
