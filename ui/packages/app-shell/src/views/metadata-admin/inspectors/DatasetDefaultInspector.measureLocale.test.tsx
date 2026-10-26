// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#4575 — the dataset inspector's format-hint SAMPLE follows the
 * display locale, not the machine's.
 *
 * The sample under the measure's display-format picker exists so a business
 * user can see what their `format` / `currency` choice will look like without
 * hand-writing a numeral pattern. It is a preview of authored formatting, so it
 * has to arrive through the same channel as the surface it previews: a German
 * session picking "Number · 1 decimal" must be shown `1.234,5`, because that is
 * what the report and dashboard will render — showing `1,234.5` makes the
 * sample lie about the very thing it exists to demonstrate.
 *
 * ── Why every case pins TWO locales ──────────────────────────────────────────
 * A lone de assertion is not falsifiable: on a German runner it would pass
 * before the fix too. Each case pins the same sample in de AND in en, so before
 * the fix — when both render in the machine's locale — at least one of the two
 * must fail on ANY runner.
 *
 * ── Directions, predicted in writing BEFORE the run ──────────────────────────
 * Runner machine locale measured as en-US.
 *   the de number / currency / percent samples   RED pre-fix — render the en form
 *   the en counterparts                          GREEN both sides — byte-identity
 *                                                pins; en must NOT move here
 *   the no-provider case                         GREEN both sides — see its note
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';

// Stub the catalog hooks so the inspector renders without a MetadataClient /
// network — the same stubs the sibling `DatasetDefaultInspector.test.tsx` uses.
vi.mock('./useDatasetFields', () => ({
  useObjectOptions: () => ({ options: [], loading: false }),
  useDatasetFieldCatalog: () => ({ relationships: [], fieldOptions: [], loading: false }),
  useDatasetUsage: () => ({ reports: 0, dashboards: 0, loading: false }),
  fieldTypeToDimensionType: (t: string) => (t === 'date' ? 'date' : 'string'),
}));

import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { DatasetDefaultInspector } from './DatasetDefaultInspector';

afterEach(cleanup);

/**
 * The `locale` prop is the metadata designer's own chrome language
 * (`useMetadataLocale()` — exactly 'en-US' or 'zh-CN'), NOT a number-formatting
 * locale. It stays en-US in every case below, so a German sample can only have
 * come from `useDisplayLocale()`.
 */
const baseProps = { type: 'dataset', name: 'sales', locale: 'en-US' as const };

const draftWith = (measure: Record<string, unknown>) => ({
  name: 'sales',
  label: 'Sales',
  object: 'opportunity',
  dimensions: [{ name: 'region', field: 'account.region', type: 'string' }],
  measures: [{ name: 'revenue', aggregate: 'sum', field: 'amount', ...measure }],
});

function renderIn(locale: string | undefined, ui: React.ReactElement, language = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={locale ? { locale } : {}}>{ui}</LocalizationProvider>
    </I18nProvider>,
  );
}

/** The sample renders as `Sample: <span>{value}</span>` beneath the picker. */
const sampleText = () => {
  const label = screen.getByText(/^Sample:/);
  return within(label).getByText(/\d/).textContent;
};

describe('dataset inspector format sample follows the display locale (objectui#4575)', () => {
  it('renders the German number sample in a de session', () => {
    renderIn(
      'de-DE',
      <DatasetDefaultInspector {...baseProps} draft={draftWith({ format: '0,0.0' })} onPatch={vi.fn()} readOnly={false} />,
    );
    expect(sampleText()).toBe('1.234,5');
  });

  it('leaves the en number sample byte-identical (must-not-change)', () => {
    renderIn(
      'en-US',
      <DatasetDefaultInspector {...baseProps} draft={draftWith({ format: '0,0.0' })} onPatch={vi.fn()} readOnly={false} />,
    );
    expect(sampleText()).toBe('1,234.5');
  });

  it('places the currency sign the way the locale does, not the way en does', () => {
    renderIn(
      'de-DE',
      <DatasetDefaultInspector
        {...baseProps}
        draft={draftWith({ format: '0,0.00', currency: 'EUR' })}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    // German writes the sign LAST, separated by a NO-BREAK SPACE (U+00A0).
    // Read through `textContent` rather than a text matcher, so no normalizer
    // can collapse that byte away (the objectui#4577 lesson).
    expect(sampleText()).toBe(`1.234,50\u00a0€`);
  });

  it('keeps the en currency sample byte-identical (must-not-change)', () => {
    renderIn(
      'en-US',
      <DatasetDefaultInspector
        {...baseProps}
        draft={draftWith({ format: '0,0.00', currency: 'EUR' })}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(sampleText()).toBe('€1,234.50');
  });

  it('renders the German percent sample in a de session', () => {
    renderIn(
      'de-DE',
      <DatasetDefaultInspector {...baseProps} draft={draftWith({ format: '0.0%' })} onPatch={vi.fn()} readOnly={false} />,
    );
    // The decimal COMMA is the point: `12.3%` and `12,3%` read as different
    // numbers to the two audiences, not as the same one restyled.
    //
    // PIN MOVED (objectui#4576). The German expectation gained the no-break
    // space before the sign. `formatMeasure` appended a literal '%' in every
    // locale; it now renders the locale's own percent convention, the one a
    // list cell has used since #4553. The en sample in the case below is
    // UNMOVED, which is what says this was a convention change and not a
    // numeral one. Same class as the two moves in
    // `packages/core/src/utils/__tests__/dataset-format.locale.test.ts`.
    expect(sampleText()).toBe('12,3\u00a0%');
  });

  it('keeps the en percent sample byte-identical (must-not-change)', () => {
    renderIn(
      'en-US',
      <DatasetDefaultInspector {...baseProps} draft={draftWith({ format: '0.0%' })} onPatch={vi.fn()} readOnly={false} />,
    );
    expect(sampleText()).toBe('12.3%');
  });

  /**
   * ⚠️ HONEST LABELLING — GREEN on both sides of the fix, and NOT a defect pin.
   * The inspector's own suite mounts it with no i18n providers at all, so this
   * records that `useDisplayLocale` is provider-safe there (it documents
   * `useLocalization` returning `{}` and `useObjectTranslation` reading an
   * optional context, falling back to 'en'). It is what keeps that sibling
   * suite green and untouched by this card — and it makes the sample
   * DETERMINISTIC where it previously followed whatever locale the machine ran
   * in.
   */
  it('degrades to en when mounted with no localization providers at all', () => {
    render(
      <DatasetDefaultInspector
        {...baseProps}
        draft={draftWith({ format: '0,0.0' })}
        onPatch={vi.fn()}
        readOnly={false}
      />,
    );
    expect(sampleText()).toBe('1,234.5');
  });
});
