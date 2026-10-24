/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#13405 — the synthetic "All records" tab speaks the session's
 * language.
 *
 * THE DEFECT. A tabs-mode user-filter bar with `showAllRecords` appends a tab
 * the renderer invents, `{ id: '__all__', … }`, and its label was the literal
 * English string `'All records'`. In a zh-CN session every other word on the
 * strip was translated and that one tab was not.
 *
 * WHAT IS PINNED:
 * - zh: the tab reads the pack's `list.userFilters.allRecords` (全部记录).
 * - en: the tab still reads "All records", and so does a host with no
 *   provider (the inline fallback).
 * - CONTROL: the authored tabs keep their authored labels in both languages,
 *   and the synthetic tab's id and behaviour (no conditions, `_tab: __all__`)
 *   are unchanged.
 */

import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { I18nProvider, useObjectTranslation } from '@object-ui/i18n';
import { UserFilters } from '../UserFilters';

afterEach(cleanup);

/**
 * A readiness signal independent of the fix: an existing key read beside the
 * bar. The controls wait on it rather than on the tab label, so they stay
 * green with the fix reverted and fail only if what they guard moves.
 */
function CatalogueProbe() {
  const { t } = useObjectTranslation();
  return <span data-testid="catalogue-probe">{t('common.more')}</span>;
}
const PROBE = { zh: '更多', en: 'More' } as const;

async function catalogueReady(language: 'zh' | 'en') {
  expect((await screen.findByText(PROBE[language])).getAttribute('data-testid')).toBe('catalogue-probe');
}

const objectDef = {
  name: 'task',
  fields: { priority: { name: 'priority', type: 'select', label: 'Priority' } },
};

const config = {
  element: 'tabs' as const,
  showAllRecords: true,
  tabs: [
    { name: 'mine', label: 'My tasks', isDefault: true },
    { name: 'urgent', label: 'Urgent', filter: [{ field: 'priority', operator: 'equals', value: 'urgent' }] },
  ],
};

function renderBar(
  language: 'zh' | 'en' | null,
  handlers: {
    onFilterChange?: (f: unknown[]) => void;
    onSelectionsChange?: (s: Record<string, unknown[]>) => void;
  } = {},
) {
  const bar = (
    <UserFilters
      config={config}
      objectDef={objectDef}
      data={[]}
      onFilterChange={handlers.onFilterChange ?? (() => {})}
      onSelectionsChange={handlers.onSelectionsChange}
    />
  );
  return render(
    language === null ? (
      bar
    ) : (
      <I18nProvider config={{ defaultLanguage: language, detectBrowserLanguage: false }}>
        <CatalogueProbe />
        {bar}
      </I18nProvider>
    ),
  );
}

describe('the synthetic "All records" user-filter tab is translated (objectui#13405)', () => {
  it('zh: the tab reads 全部记录', async () => {
    renderBar('zh');
    // The zh catalogue may arrive after the first paint; wait for it first.
    await catalogueReady('zh');
    expect(screen.getByTestId('filter-tab-__all__').textContent).toBe('全部记录');
    expect(screen.queryByText('All records')).toBeNull();
  });

  it('en: the tab reads "All records"', async () => {
    renderBar('en');
    await catalogueReady('en');
    expect(screen.getByTestId('filter-tab-__all__').textContent).toBe('All records');
  });

  it('no provider: the inline fallback reads "All records"', () => {
    renderBar(null);
    expect(screen.getByTestId('filter-tab-__all__').textContent).toBe('All records');
  });

  it('CONTROL: the authored tabs keep their authored labels in zh and en', async () => {
    for (const language of ['zh', 'en'] as const) {
      renderBar(language);
      await catalogueReady(language);
      expect(screen.getByTestId('filter-tab-mine').textContent).toBe('My tasks');
      expect(screen.getByTestId('filter-tab-urgent').textContent).toBe('Urgent');
      cleanup();
    }
  });

  it('CONTROL: the tab keeps its id and behaviour — no conditions, reported as _tab __all__', async () => {
    const onFilterChange = vi.fn();
    const onSelectionsChange = vi.fn();
    renderBar('zh', { onFilterChange, onSelectionsChange });
    await catalogueReady('zh');
    fireEvent.click(screen.getByTestId('filter-tab-__all__'));
    expect(onFilterChange).toHaveBeenLastCalledWith([]);
    expect(onSelectionsChange).toHaveBeenLastCalledWith({ _tab: ['__all__'] });
  });
});
