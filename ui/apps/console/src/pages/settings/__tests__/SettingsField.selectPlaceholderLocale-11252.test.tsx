/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsField — a closed `select` with no value shows the locale's
 * `common.select`, not an English literal (objectui#11252).
 *
 * The closed dropdown (a `select` specifier WITHOUT `valueDomain`) drew
 * `SelectValue placeholder="Select…"`, so an unset key read English under every
 * locale. It now reads the shared `common.select` key, so this file asserts the
 * key's IDENTITY — what the bound instance answers — and guards that the zh and
 * en answers really differ.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

afterEach(cleanup);

/** A closed select: exhaustive `options`, no `valueDomain`, no default. */
const PROVIDER: Specifier = {
  type: 'select',
  key: 'provider',
  label: 'Provider',
  options: [
    { value: 'smtp', label: 'SMTP' },
    { value: 'ses', label: 'Amazon SES' },
  ],
};

/** Mount under a provider in `language`; returns the bound instance. */
function renderIn(language: string, value: unknown = undefined) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <SettingsField spec={PROVIDER} value={value} onChange={vi.fn()} />
    </I18nProvider>,
  );
  return instance;
}

describe('objectui#11252 — an unset closed settings select reads `common.select`', () => {
  it('under zh-CN, the placeholder is the zh pack\'s `common.select`, not the en word', () => {
    const zh = renderIn('zh-CN');
    const zhWord = zh.t('common.select');
    const enWord = zh.getFixedT('en')('common.select');

    // The pin is only a pin if the two packs disagree.
    expect(zhWord).not.toBe(enWord);
    expect(zhWord).not.toBe('common.select');
    expect(screen.getByRole('combobox')).toHaveTextContent(zhWord);
    expect(screen.getByRole('combobox')).not.toHaveTextContent(enWord);
  });

  it('under en, the placeholder is the en pack\'s `common.select`', () => {
    const en = renderIn('en');
    expect(screen.getByRole('combobox')).toHaveTextContent(en.t('common.select'));
  });

  it('CONTROL — a set value renders its option label, not the placeholder', () => {
    const zh = renderIn('zh-CN', 'ses');
    expect(screen.getByRole('combobox')).toHaveTextContent('Amazon SES');
    expect(screen.getByRole('combobox')).not.toHaveTextContent(zh.t('common.select'));
  });
});
