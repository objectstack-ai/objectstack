/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The ⌘K palette names an app navigation entry the way the sidebar does,
 * including an entry with NO `label` (objectui#9868, contract review finding 1).
 *
 * Since objectui#9868 `NavigationSyncEffect` writes every page and dashboard
 * created in the console WITHOUT a `label` — absent means "inherit the target's
 * current label at render time". The palette read `resolveKeyedI18nLabel(
 * item.label, t)`, which answers `undefined` for an absent label, so such an
 * entry drew a BLANK row whose cmdk filter value read `page undefined my_page`.
 * It now resolves through `resolveNavItemLabel` with the same
 * `useNavTargetLabel` resolver the sidebar and `nav:menu` use.
 *
 * Pinned through the real `CommandPaletteProvider` (opened by its `?palette=1`
 * deep link) under a real `MetadataCtx`, asserting both what the row SHOWS and
 * the cmdk `data-value` it is searched by:
 *
 *  - a label-less page shows its machine-name backstop (`pageName`), the text
 *    the old sync used to store;
 *  - a label-less dashboard and a label-less view entry show their targets'
 *    CURRENT metadata labels, and a rename shows on the next render;
 *  - CONTROL: an authored label renders verbatim.
 *
 * objectui#11299: an entry label written as an inline locale map is shown — and
 * searched — in the viewer's language, the `useObjectTranslation().language`
 * the palette hands `resolveNavItemLabel` as its `locale`, under a real
 * `I18nProvider` in that language.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { CommandPalette } from './CommandPalette';
import { CommandPaletteProvider } from '../context/CommandPaletteProvider';

const APP = {
  name: 'crm',
  label: 'CRM',
  navigation: [
    // What NavigationSyncEffect writes for a page / dashboard since objectui#9868.
    { id: 'nav_page', type: 'page', pageName: 'my_page' },
    { id: 'nav_dash', type: 'dashboard', dashboardName: 'sales_overview' },
    { id: 'nav_board', type: 'object', objectName: 'customer', viewName: 'board' },
    // Control: an authored label.
    { id: 'nav_home', type: 'page', pageName: 'home', label: 'Team Home' },
    // objectui#11299: a present label written as an inline locale map.
    { id: 'nav_contacts', type: 'object', objectName: 'contact', label: { en: 'Contacts', 'zh-CN': '联系人' } },
  ],
};

function metadata(viewLabel: string, dashboardLabel: string) {
  return {
    apps: [APP],
    objects: [
      {
        name: 'customer',
        label: 'Customers',
        listViews: { 'customer.board': { name: 'customer.board', label: viewLabel } },
      },
    ],
    dashboards: [{ name: 'sales_overview', label: dashboardLabel }],
    reports: [],
    pages: [{ name: 'my_page' }, { name: 'home', label: 'Home' }],
    loading: false,
    error: null,
    refresh: async () => {},
    invalidate: () => {},
    ensureType: async () => [],
    getItem: async () => null,
    getItemsByType: () => [],
    getTypeStatus: () => 'ready' as const,
  };
}

function tree(value: ReturnType<typeof metadata>) {
  return (
    <MemoryRouter initialEntries={['/apps/crm?palette=1']}>
      <MetadataCtx.Provider value={value as never}>
        <CommandPaletteProvider>
          <CommandPalette apps={[APP]} activeApp={APP} objects={value.objects} onAppChange={() => {}} />
        </CommandPaletteProvider>
      </MetadataCtx.Provider>
    </MemoryRouter>
  );
}

/** Every nav row of one kind: its visible text and its cmdk filter value. */
function rows(kind: string): Array<{ text: string; value: string }> {
  return Array.from(document.querySelectorAll(`[cmdk-item][data-value^="${kind} "]`)).map((el) => ({
    text: (el.textContent ?? '').trim(),
    value: el.getAttribute('data-value') ?? '',
  }));
}

afterEach(() => cleanup());

describe('objectui#9868 — the ⌘K palette names a label-less nav entry like the sidebar does', () => {
  it('a label-less page shows its pageName, and is searched by it — never blank, never "undefined"', () => {
    render(tree(metadata('客户管理仪表盘', 'Sales Overview')));
    if (!document.querySelector('[cmdk-input]')) throw new Error('the palette did not open');

    const page = rows('page').find((r) => r.value.includes('my_page'));
    expect(page).toBeDefined();
    expect(page!.text).toBe('my_page');
    expect(page!.value).not.toContain('undefined');
    expect(page!.value).toBe('page my_page my_page');
  });

  it('a label-less dashboard and view entry show their targets’ current labels, and follow a rename', () => {
    const utils = render(tree(metadata('客户管理仪表盘', 'Sales Overview')));

    expect(rows('dashboard').map((r) => r.text)).toEqual(['Sales Overview']);
    expect(rows('dashboard')[0].value.toLowerCase()).toContain('sales overview');
    const board = rows('object').find((r) => r.value.includes('customer'));
    expect(board?.text).toBe('客户管理仪表盘');
    expect(board?.value).toContain('客户管理仪表盘');

    utils.rerender(tree(metadata('Customer Board', 'Revenue')));
    expect(rows('dashboard').map((r) => r.text)).toEqual(['Revenue']);
    expect(rows('object').find((r) => r.value.includes('customer'))?.text).toBe('Customer Board');
  });

  it('control: an authored label renders verbatim', () => {
    render(tree(metadata('Board', 'Sales Overview')));
    const home = rows('page').find((r) => r.value.includes('home'));
    expect(home?.text).toBe('Team Home');
    expect(home?.value.toLowerCase()).toContain('team home');
  });
});

describe('objectui#11299 — the ⌘K palette names a map-labelled entry in the viewer’s language', () => {
  const inLanguage = (language: string) => (
    <I18nProvider instance={createI18n({ defaultLanguage: language, detectBrowserLanguage: false })} persistLanguage={false}>
      {tree(metadata('Board', 'Sales Overview'))}
    </I18nProvider>
  );

  it('under zh-CN the row shows, and is searched by, its zh-CN text', () => {
    render(inLanguage('zh-CN'));
    if (!document.querySelector('[cmdk-input]')) throw new Error('the palette did not open');
    const contacts = rows('object').find((r) => r.value.includes('contact'));
    expect(contacts?.text).toBe('联系人');
    expect(contacts?.value).toContain('联系人');
    expect(contacts?.value).not.toContain('Contacts');
  });

  it('under en the same row shows its en text', () => {
    render(inLanguage('en'));
    if (!document.querySelector('[cmdk-input]')) throw new Error('the palette did not open');
    expect(rows('object').find((r) => r.value.includes('contact'))?.text).toBe('Contacts');
  });
});
