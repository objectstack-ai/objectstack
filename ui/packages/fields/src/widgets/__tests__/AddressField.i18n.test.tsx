/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AddressField` is translatable, and its readonly line reads in the reader's
 * own address order — objectui#4028.
 *
 * The report was measured on a zh-CN console: every label on the account
 * dialog was Chinese except the five inside the address field, which were
 * English string literals with no i18n key at all. Nothing an app could do
 * reached them — the parts are not fields on the object (`billing_address` is
 * one `address` column), so a translation bundle had nothing to key on, there
 * is no `subLabels` property to declare, and the widget cannot be replaced
 * from metadata. The only workaround was to abandon `Field.address()` for five
 * text fields, losing the structured value, geocoding and the map view.
 *
 * ## What each group asserts, and why in this shape
 *
 * - **Labels: non-`en` positive AND English-literal negative, together.** A
 *   positive-only assertion stays green when one label is re-inlined next to
 *   four translated siblings, which is precisely how this defect looked in the
 *   first place — four Chinese labels around one English one would have read
 *   as "not translated yet".
 * - **`en` is a NO-OP pin, not a defect reproducer.** The five pack values are
 *   byte-identical to the literals they replace, so English was green before
 *   this change too. Only a positive assertion can see that the swap left
 *   English alone, and `AddressField.no-provider.test.tsx` pins the other half
 *   of that equality (what renders with no `I18nProvider` at all).
 * - **Placeholders are asserted ABSENT, per locale.** They were `123 Main St`
 *   / `San Francisco` / `CA` / `94102` / `United States`: untranslated and
 *   US-specific, so a zh/ja/ar user was shown an American address as the
 *   example of what to type. They are dropped rather than keyed — see the
 *   widget for the measurement — and an absence needs a test precisely because
 *   nothing else would notice one creeping back: a re-added `placeholder=` is
 *   invisible to every i18n gate, which only ever look at keys.
 * - **Readonly ORDER, zh against a Latin locale.** The line used to be
 *   US-ordered for everyone. `zh` is the reported case (largest-first) and
 *   `es` is the control that must NOT move — an implementation that reversed
 *   unconditionally, or that keyed off "not English", passes a zh-only check
 *   and fails here.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { AddressField } from '../AddressField';
import type { FieldMetadata } from '@object-ui/types';

const addressField = { name: 'billing_address', type: 'address' } as unknown as FieldMetadata;

/** The record from the issue's evidence, in the locale it was reported from. */
const CN_ADDRESS = {
  street: '中策路 1 号',
  city: '杭州',
  state: '浙江',
  postalCode: '310000',
  country: '中国',
};

/** A US address — the shape the old hardcoded order was built around. */
const US_ADDRESS = {
  street: '123 Main St',
  city: 'San Francisco',
  state: 'CA',
  postalCode: '94102',
  country: 'United States',
};

function renderIn(language: string, element: React.ReactElement) {
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      {element}
    </I18nProvider>,
  );
}

const editable = (value: Record<string, string> = {}) => (
  <AddressField value={value} onChange={vi.fn()} field={addressField} />
);

/** Every English literal the five sub-labels used to be. */
const ENGLISH_SUB_LABELS = [
  'Street Address',
  'City',
  'State / Province',
  'ZIP / Postal Code',
  'Country',
];

describe('AddressField sub-labels are translated (objectui#4028)', () => {
  it('renders the English labels under an en provider', () => {
    renderIn('en', editable());
    for (const label of ENGLISH_SUB_LABELS) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('renders Chinese labels — and NO English literal — under a zh provider', () => {
    const { container } = renderIn('zh', editable());
    expect(screen.getByLabelText('街道地址')).toBeInTheDocument();
    expect(screen.getByLabelText('城市')).toBeInTheDocument();
    expect(screen.getByLabelText('省 / 州')).toBeInTheDocument();
    expect(screen.getByLabelText('邮政编码')).toBeInTheDocument();
    expect(screen.getByLabelText('国家 / 地区')).toBeInTheDocument();
    // The negative half: not one of the five may survive as English.
    for (const label of ENGLISH_SUB_LABELS) {
      expect(container.textContent).not.toContain(label);
    }
  });

  it('renders Japanese labels — and NO English literal — under a ja provider', () => {
    const { container } = renderIn('ja', editable());
    expect(screen.getByLabelText('番地・建物名')).toBeInTheDocument();
    expect(screen.getByLabelText('市区町村')).toBeInTheDocument();
    expect(screen.getByLabelText('都道府県')).toBeInTheDocument();
    expect(screen.getByLabelText('郵便番号')).toBeInTheDocument();
    expect(screen.getByLabelText('国')).toBeInTheDocument();
    for (const label of ENGLISH_SUB_LABELS) {
      expect(container.textContent).not.toContain(label);
    }
  });

  it('renders Arabic labels under an ar provider (RTL pack, same keys)', () => {
    renderIn('ar', editable());
    expect(screen.getByLabelText('عنوان الشارع')).toBeInTheDocument();
    expect(screen.getByLabelText('المدينة')).toBeInTheDocument();
    expect(screen.getByLabelText('الرمز البريدي')).toBeInTheDocument();
  });

  it('keeps every sub-label bound to its own input (htmlFor survives the swap)', () => {
    renderIn('zh', editable(CN_ADDRESS));
    // Each label resolves to the box holding that part's stored value — the
    // association objectui#3343 established, re-checked through translated
    // label text rather than the old literals.
    expect(screen.getByLabelText('街道地址')).toHaveValue('中策路 1 号');
    expect(screen.getByLabelText('城市')).toHaveValue('杭州');
    expect(screen.getByLabelText('邮政编码')).toHaveValue('310000');
  });
});

describe('AddressField shows no US example placeholders (objectui#4028)', () => {
  const US_EXAMPLES = ['123 Main St', 'San Francisco', 'CA', '94102', 'United States'];

  for (const language of ['en', 'zh', 'ja', 'ar']) {
    it(`renders no placeholder at all under a ${language} provider`, () => {
      const { container } = renderIn(language, editable());
      const boxes = Array.from(container.querySelectorAll('input'));
      expect(boxes).toHaveLength(5);
      for (const box of boxes) {
        expect(box.getAttribute('placeholder')).toBeNull();
      }
    });
  }

  it('leaves no US example text anywhere in the rendered zh form', () => {
    const { container } = renderIn('zh', editable());
    for (const example of US_EXAMPLES) {
      expect(container.textContent).not.toContain(example);
      expect(container.innerHTML).not.toContain(`placeholder="${example}"`);
    }
  });
});

describe('AddressField readonly line follows the locale part order (objectui#4028)', () => {
  it('reads largest-first under zh — the reported case', () => {
    const { container } = renderIn(
      'zh',
      <AddressField value={CN_ADDRESS} onChange={vi.fn()} field={addressField} readonly />,
    );
    expect(container.textContent).toBe('中国, 310000 浙江, 杭州, 中策路 1 号');
  });

  it('keeps the small-to-large order under es — the Latin control', () => {
    const { container } = renderIn(
      'es',
      <AddressField value={CN_ADDRESS} onChange={vi.fn()} field={addressField} readonly />,
    );
    expect(container.textContent).toBe('中策路 1 号, 杭州, 浙江 310000, 中国');
  });

  it('leaves the English line byte-identical to what it always was', () => {
    const { container } = renderIn(
      'en',
      <AddressField value={US_ADDRESS} onChange={vi.fn()} field={addressField} readonly />,
    );
    expect(container.textContent).toBe('123 Main St, San Francisco, CA 94102, United States');
  });

  it('orders a US address by the READER, not by the address — the stated limit', () => {
    // Not an endorsement, a pin: the channel is the display locale, because
    // this widget writes no `countryCode` for an address-driven rule to read.
    // If that ever changes, this expectation is the thing that must move, and
    // moving it deliberately is the point of writing it down.
    const { container } = renderIn(
      'zh',
      <AddressField value={US_ADDRESS} onChange={vi.fn()} field={addressField} readonly />,
    );
    expect(container.textContent).toBe('United States, 94102 CA, San Francisco, 123 Main St');
  });

  it('drops missing parts in the localized order too, with no dangling separators', () => {
    const { container } = renderIn(
      'zh',
      <AddressField
        value={{ street: '中策路 1 号', country: '中国' }}
        onChange={vi.fn()}
        field={addressField}
        readonly
      />,
    );
    expect(container.textContent).toBe('中国, 中策路 1 号');
  });
});
