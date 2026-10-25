/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The display cell renderer orders address parts the same way the input
 * widget's readonly branch does, in every locale — objectui#4028 over
 * objectui#4037's shared formatter.
 *
 * objectui#4037 pulled the one-line rule out into `address-format` so that a
 * readonly form and the detail page could not spell one stored address two
 * ways. objectui#4028 makes that rule locale-aware. Passing the locale on only
 * ONE of the formatter's two callers would re-open the exact drift #4037
 * closed — a `zh` console showing `中国, 310000 浙江, 杭州, 中策路 1 号` in the
 * record's readonly form and the US-ordered line in the grid cell beside it —
 * so the two surfaces are asserted here against the SAME expectations
 * `AddressField.i18n.test.tsx` uses for the widget.
 *
 * Resolution goes through `getCellRenderer`, not a direct import, for the same
 * reason the sibling suite does it: the assertion must fail if the display
 * registry entry regresses, not merely if the formatter changes.
 */
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom';
import { I18nProvider } from '@object-ui/i18n';

import { getCellRenderer, resolveCellRendererType } from '../index';

/** The record from the issue's evidence table. */
const CN_ADDRESS = {
  street: '中策路 1 号',
  city: '杭州',
  state: '浙江',
  postalCode: '310000',
  country: '中国',
};

function renderAddressIn(language: string, value: unknown) {
  const Renderer = getCellRenderer(resolveCellRendererType({ type: 'address' }) || 'address');
  return render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
      <Renderer value={value as any} field={{ type: 'address' } as any} />
    </I18nProvider>,
  );
}

describe('address cell renderer follows the locale part order (objectui#4028)', () => {
  it('reads largest-first under zh', () => {
    const { container } = renderAddressIn('zh', CN_ADDRESS);
    expect(container.textContent).toBe('中国, 310000 浙江, 杭州, 中策路 1 号');
  });

  it('reads largest-first under ja and ko too', () => {
    expect(renderAddressIn('ja', CN_ADDRESS).container.textContent).toBe(
      '中国, 310000 浙江, 杭州, 中策路 1 号',
    );
    expect(renderAddressIn('ko', CN_ADDRESS).container.textContent).toBe(
      '中国, 310000 浙江, 杭州, 中策路 1 号',
    );
  });

  it('keeps the small-to-large order under de — the Latin control', () => {
    const { container } = renderAddressIn('de', CN_ADDRESS);
    expect(container.textContent).toBe('中策路 1 号, 杭州, 浙江 310000, 中国');
  });

  it('keeps the small-to-large order under en', () => {
    const { container } = renderAddressIn('en', CN_ADDRESS);
    expect(container.textContent).toBe('中策路 1 号, 杭州, 浙江 310000, 中国');
  });

  it('still drops missing parts, in the localized order', () => {
    const { container } = renderAddressIn('zh', { city: '杭州', postalCode: '310000' });
    expect(container.textContent).toBe('310000, 杭州');
  });

  it('leaves the non-address branches alone under a zh provider', () => {
    // A plain string passes through, `{}` is empty, an unrecognized shape
    // keeps its JSON — none of which the order rule may touch.
    expect(renderAddressIn('zh', '中策路 1 号').container.textContent).toBe('中策路 1 号');
    expect(renderAddressIn('zh', {}).container.textContent).not.toMatch(/[{}]/);
    expect(renderAddressIn('zh', { foo: 1 }).container.textContent).toContain('foo');
  });
});
