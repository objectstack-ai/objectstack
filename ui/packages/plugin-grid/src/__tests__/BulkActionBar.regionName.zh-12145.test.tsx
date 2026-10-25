/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#12145 — the bulk-action bar's region is named from the pack.
 *
 * It carried `aria-label="Bulk actions"`, so a screen reader under `zh` heard
 * the landmark in English. It now reads `grid.bulkActions`. The name is read
 * against the PACK, never against a literal.
 */
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, afterEach } from 'vitest';
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider } from '@object-ui/react';
import { en, zh } from '@object-ui/i18n/locales';
import { BulkActionBar } from '../components/BulkActionBar';

afterEach(cleanup);

const renderIn = (language: string) =>
  render(
    <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }} persistLanguage={false}>
      <BulkActionBar selectedRows={[{ id: '1' }, { id: '2' }]} actions={[]} />
    </I18nProvider>,
  );

describe('the bulk-action bar region is named from the pack (objectui#12145)', () => {
  it('under en, it carries the en pack value', async () => {
    renderIn('en');
    expect(await screen.findByRole('region', { name: en.grid.bulkActions })).toBeInTheDocument();
  });

  it('under zh, it is named by the zh pack, not by the English words', async () => {
    expect(zh.grid.bulkActions).not.toBe(en.grid.bulkActions);
    renderIn('zh');
    expect(await screen.findByRole('region', { name: zh.grid.bulkActions })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: en.grid.bulkActions })).toBeNull();
  });
});
