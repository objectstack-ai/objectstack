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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

/** The same options drawn as a radio group. */
const ADAPTER_RADIO: Specifier = { ...ADAPTER, type: 'radio' };

function renderRadioIn(language: string, value: unknown) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <SettingsField spec={ADAPTER_RADIO} value={value} onChange={vi.fn()} />
    </I18nProvider>,
  );
  return instance;
}

describe('objectstack#37480 — a stored radio value outside the current options is named', () => {
  it('the group shows a checked, disabled item reading the stored code marked "no longer available"', () => {
    const en = renderRadioIn('en', 'ragflow');
    const named = en.t('console.settingsView.selectValueRetired', { value: 'ragflow' });

    const item = screen.getByRole('radio', { name: named });
    expect(item).toBeChecked();
    expect(item).toBeDisabled();
    // The current options stay pickable and unchecked.
    expect(screen.getByRole('radio', { name: 'Dify' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Dify' })).toBeEnabled();
  });

  it('CONTROL — a stored value among the options checks its own item, with no retired item', () => {
    renderRadioIn('en', 'dify');
    expect(screen.getByRole('radio', { name: 'Dify' })).toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.queryByTestId('settings-radio-retired')).toBeNull();
  });
});

/** The same options drawn as a multiselect. */
const ADAPTER_MULTI: Specifier = { ...ADAPTER, type: 'multiselect' };

function renderMultiIn(language: string, value: unknown, onChange = vi.fn()) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <SettingsField spec={ADAPTER_MULTI} value={value} onChange={onChange} />
    </I18nProvider>,
  );
  return instance;
}

describe('objectstack#37480 — a stored multiselect member outside the current options is named', () => {
  it('the member shows as a checked checkbox reading the stored code marked "no longer available"', () => {
    const en = renderMultiIn('en', ['ragflow', 'dify']);
    const named = en.t('console.settingsView.selectValueRetired', { value: 'ragflow' });

    expect(screen.getByRole('checkbox', { name: named })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Dify' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Built-in' })).not.toBeChecked();
  });

  it('ticking a current option keeps the retired member in the array, as before', () => {
    const onChange = vi.fn();
    renderMultiIn('en', ['ragflow'], onChange);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dify' }));
    expect(onChange).toHaveBeenCalledWith(['ragflow', 'dify']);
  });

  it('unticking the retired member drops it from the array', () => {
    const onChange = vi.fn();
    const en = renderMultiIn('en', ['ragflow', 'dify'], onChange);
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: en.t('console.settingsView.selectValueRetired', { value: 'ragflow' }),
      }),
    );
    expect(onChange).toHaveBeenCalledWith(['dify']);
  });

  it('CONTROL — members all among the options draw only the option checkboxes', () => {
    renderMultiIn('en', ['dify']);
    expect(screen.getAllByRole('checkbox')).toHaveLength(2);
    expect(screen.getByRole('checkbox', { name: 'Dify' })).toBeChecked();
    expect(screen.queryByTestId('settings-multiselect-retired')).toBeNull();
  });
});
