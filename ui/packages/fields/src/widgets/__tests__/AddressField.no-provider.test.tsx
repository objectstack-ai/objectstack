/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `AddressField` with NO `I18nProvider` mounted — the other half of
 * objectui#4028's equality, and the half a provider-mounted test cannot see.
 *
 * `AddressField.i18n.test.tsx` renders under providers and asserts the ten
 * packs serve the five sub-labels. This file asserts what a host that mounts
 * no provider at all renders: `createSafeTranslation`'s `FIELD_DEFAULTS`
 * English, byte-identical to the literals the widget used to hold — not a raw
 * `fields.address.street` key, which is what a bare `useObjectTranslation()`
 * would have put on screen. Standalone SDUI nodes and the inline grid editor
 * are real hosts of exactly this shape, so this is a shipped path, not a test
 * artifact.
 *
 * Same split, same reason as `TextAreaField.characterCount.no-provider.test.tsx`
 * and `FullscreenFieldEditor.no-provider.test.tsx`.
 *
 * The readonly line is here too: with no provider `useDisplayLocale()` resolves
 * to its concrete `'en'` last resort, so the formatted address must stay
 * byte-identical to what it was before the locale parameter existed. That is
 * the no-regression floor for every existing consumer of this widget.
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

import { AddressField } from '../AddressField';
import type { FieldMetadata } from '@object-ui/types';

const addressField = { name: 'billing_address', type: 'address' } as unknown as FieldMetadata;

describe('AddressField with no i18n configured (objectui#4028)', () => {
  it('renders the English sub-labels, not raw keys', () => {
    render(<AddressField value={{}} onChange={vi.fn()} field={addressField} />);

    // Byte-identical to the literals this change replaced.
    expect(screen.getByLabelText('Street Address')).toBeInTheDocument();
    expect(screen.getByLabelText('City')).toBeInTheDocument();
    expect(screen.getByLabelText('State / Province')).toBeInTheDocument();
    expect(screen.getByLabelText('ZIP / Postal Code')).toBeInTheDocument();
    expect(screen.getByLabelText('Country')).toBeInTheDocument();
  });

  it('never leaks a translation key to the user', () => {
    const { container } = render(
      <AddressField value={{}} onChange={vi.fn()} field={addressField} />,
    );
    expect(container.textContent).not.toMatch(/fields\.address/);
  });

  it('carries no placeholder on any of the five boxes', () => {
    const { container } = render(
      <AddressField value={{}} onChange={vi.fn()} field={addressField} />,
    );
    const boxes = Array.from(container.querySelectorAll('input'));
    expect(boxes).toHaveLength(5);
    expect(boxes.map((b) => b.getAttribute('placeholder'))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('formats the readonly line exactly as it did before the locale parameter', () => {
    const { container } = render(
      <AddressField
        value={{
          street: '中策路 1 号',
          city: '杭州',
          state: '浙江',
          postalCode: '310000',
          country: '中国',
        }}
        onChange={vi.fn()}
        field={addressField}
        readonly
      />,
    );
    expect(container.textContent).toBe('中策路 1 号, 杭州, 浙江 310000, 中国');
  });
});
