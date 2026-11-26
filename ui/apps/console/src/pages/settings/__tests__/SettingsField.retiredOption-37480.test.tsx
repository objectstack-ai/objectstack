/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * SettingsField — a closed `select` whose stored value is no longer among the
 * manifest's `options` names that value as "no longer available"
 * (objectstack#37480).
 *
 * An option removed in a later release (the knowledge adapter `ragflow`) left
 * an environment that had saved it with a blank trigger: no label and no
 * placeholder, because Radix shows the selected item's text and no item carried
 * the stored code. The select now adds one disabled item for that code, so the
 * trigger reads the code with the locale's "no longer available" mark, and the
 * admin can still pick a current option.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

import { SettingsField } from '../SettingsField';
import type { Specifier } from '../types';

afterEach(cleanup);

/** A closed select: exhaustive `options`, no `valueDomain`. */
const ADAPTER: Specifier = {
  type: 'select',
  key: 'adapter',
  label: 'Adapter',
  options: [
    { value: 'builtin', label: 'Built-in' },
    { value: 'dify', label: 'Dify' },
  ],
};

function renderIn(language: string, value: unknown) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <SettingsField spec={ADAPTER} value={value} onChange={vi.fn()} />
    </I18nProvider>,
  );
  return instance;
}

describe('objectstack#37480 — a stored select value outside the current options is named', () => {
  it('under en, the trigger reads the stored code marked "no longer available"', () => {
    const en = renderIn('en', 'ragflow');
    const named = en.t('console.settingsView.selectValueRetired', { value: 'ragflow' });

    // The key resolves in the en pack (not the raw key, not the bare code).
    expect(named).toBe('ragflow (no longer available)');
    expect(screen.getByRole('combobox')).toHaveTextContent(named);
    expect(screen.getByRole('combobox')).not.toHaveTextContent(en.t('common.select'));
  });

  it('under zh-CN, the mark is the zh pack\'s text, not the en words', () => {
    const zh = renderIn('zh-CN', 'ragflow');
    const zhText = zh.t('console.settingsView.selectValueRetired', { value: 'ragflow' });
    const enText = zh.getFixedT('en')('console.settingsView.selectValueRetired', { value: 'ragflow' });

    expect(zhText).not.toBe(enText);
    expect(zhText).toContain('ragflow');
    expect(screen.getByRole('combobox')).toHaveTextContent(zhText);
  });

  it('CONTROL — a stored value among the options renders its label, with no retired mark', () => {
    const en = renderIn('en', 'dify');
    const combobox = screen.getByRole('combobox');
    expect(combobox).toHaveTextContent('Dify');
    expect(combobox).not.toHaveTextContent(
      en.t('console.settingsView.selectValueRetired', { value: 'dify' }),
    );
    expect(screen.queryByTestId('settings-select-retired')).toBeNull();
  });

  it('CONTROL — no stored value still shows the placeholder, with no retired mark', () => {
    const en = renderIn('en', undefined);
    expect(screen.getByRole('combobox')).toHaveTextContent(en.t('common.select'));
    expect(screen.queryByTestId('settings-select-retired')).toBeNull();
  });
});
