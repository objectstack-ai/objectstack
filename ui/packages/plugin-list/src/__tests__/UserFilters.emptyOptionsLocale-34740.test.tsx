/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack-ai/objectstack#34740 — a dropdown chip whose field has no
 * options reads its empty state in the reader's language.
 *
 * The popover drew a hard-coded English "No options" on a zh-CN console. It now
 * asks for `fields.options.empty` ("this field has no options to choose from"),
 * the eager pack key every built-in locale already carries; the form's options
 * empty state reads the same key. `lookup.noOptions` is not it: that one is the
 * search-miss wording ("No options found").
 *
 * Direction, written before the run: with the literal put back, the en cell
 * reads "No options" against "No options available" and the zh-CN cell reads
 * "No options" against 暂无可选项 — both RED; the control (a field WITH options
 * draws no empty state) GREEN on both sides.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { builtInLocales } from '@object-ui/i18n/locales';
import { UserFilters } from '../UserFilters';

/** A text field (no options of its own) next to a select that has some. */
const objectDef = {
  name: 'crm_lead',
  fields: {
    company: { type: 'text', label: 'Company' },
    status: { type: 'select', label: 'Status', options: [{ label: 'New', value: 'new' }] },
  },
};

const EMPTY = (lang: 'en' | 'zh-Hans') =>
  (builtInLocales[lang] as { fields: { options: { empty: string } } }).fields.options.empty;

function openChip(field: string, language?: string) {
  const bar = (
    <UserFilters
      config={{ element: 'dropdown', fields: [{ field }] } as never}
      objectDef={objectDef}
      data={[]}
      onFilterChange={vi.fn()}
    />
  );
  render(
    language
      ? <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>{bar}</I18nProvider>
      : bar,
  );
  fireEvent.click(screen.getByTestId(`filter-badge-${field}`));
}

afterEach(() => cleanup());

describe('UserFilters.emptyOptionsLocale-34740 — the no-options state reads in the reader language', () => {
  it('the premise: the key carries a distinct translation in both packs under test', () => {
    expect(EMPTY('en')).toBe('No options available');
    expect(EMPTY('zh-Hans')).toBe('暂无可选项');
  });

  it('en: the empty state reads the pack sentence', () => {
    openChip('company', 'en');
    expect(screen.getByTestId('filter-options-empty-company')).toHaveTextContent(EMPTY('en'));
  });

  it('zh-CN: the empty state reads in Chinese, never the English literal', () => {
    openChip('company', 'zh-CN');
    const empty = screen.getByTestId('filter-options-empty-company');
    expect(empty).toHaveTextContent(EMPTY('zh-Hans'));
    expect(empty.textContent).not.toMatch(/No options/);
  });

  it('no provider: the English fallback is the pack sentence, not the old literal', () => {
    openChip('company');
    expect(screen.getByTestId('filter-options-empty-company').textContent?.trim()).toBe('No options available');
  });

  it('CONTROL: a field with options draws its options and no empty state', () => {
    openChip('status', 'zh-CN');
    expect(screen.getByTestId('filter-options-status')).toHaveTextContent('New');
    expect(screen.queryByTestId('filter-options-empty-status')).toBeNull();
  });
});
