/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `ConfigFieldRenderer`'s select with no `placeholder` speaks the session
 * language — objectui#11252.
 *
 * The select arm drew `field.placeholder ?? 'Select…'`, so a config select with
 * no placeholder and no value read English under every locale. The fallback now
 * reads the shared `common.select` key, so this file asserts the key's
 * IDENTITY — what the bound instance answers for `common.select` — never its
 * copy, and guards that the zh and en answers really differ.
 *
 * The provider-less leg (the `createSafeTranslation` defaults map) is its own
 * file, `config-field-select-placeholder-no-provider-11252.test.tsx`:
 * `createI18n` registers its instance as react-i18next's module-global default
 * and that survives `cleanup()`, so a "no provider" case here would resolve
 * against whichever language ran last.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { ConfigFieldRenderer } from '../custom/config-field-renderer';
import type { ConfigField } from '../types/config-panel';

afterEach(cleanup);

/** A config select with options, no `placeholder`, no `defaultValue`. */
const THEME: ConfigField = {
  key: 'theme',
  label: 'Theme',
  type: 'select',
  options: [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
  ],
};

/** Mount under a provider in `language`; returns the bound instance. */
function renderIn(language: string, field: ConfigField) {
  const instance = createI18n({ defaultLanguage: language, detectBrowserLanguage: false });
  render(
    <I18nProvider instance={instance} persistLanguage={false}>
      <ConfigFieldRenderer field={field} value={undefined} onChange={vi.fn()} draft={{}} />
    </I18nProvider>,
  );
  return instance;
}

const trigger = () => screen.getByTestId('config-field-theme');

describe('objectui#11252 — a config select with no placeholder reads `common.select`', () => {
  it('under zh-CN, the fallback is the zh pack\'s `common.select`, not the en word', () => {
    const zh = renderIn('zh-CN', { ...THEME });
    const zhWord = zh.t('common.select');
    const enWord = zh.getFixedT('en')('common.select');

    // The pin is only a pin if the two packs disagree.
    expect(zhWord).not.toBe(enWord);
    expect(zhWord).not.toBe('common.select');
    expect(trigger()).toHaveTextContent(zhWord);
    expect(trigger()).not.toHaveTextContent(enWord);
  });

  it('under en, the fallback is the en pack\'s `common.select`', () => {
    const en = renderIn('en', { ...THEME });
    expect(trigger()).toHaveTextContent(en.t('common.select'));
  });

  it('an author-supplied placeholder still wins, verbatim, under zh-CN', () => {
    const zh = renderIn('zh-CN', { ...THEME, placeholder: 'Pick a theme' });
    expect(trigger()).toHaveTextContent('Pick a theme');
    expect(trigger()).not.toHaveTextContent(zh.t('common.select'));
  });

  it('CONTROL — a select with a `defaultValue` renders that option, not the placeholder', () => {
    const zh = renderIn('zh-CN', { ...THEME, defaultValue: 'dark' });
    expect(trigger()).toHaveTextContent('Dark');
    expect(trigger()).not.toHaveTextContent(zh.t('common.select'));
  });
});
