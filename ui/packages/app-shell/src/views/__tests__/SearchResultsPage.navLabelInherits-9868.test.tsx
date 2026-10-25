/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The full-page search lists and MATCHES an app navigation entry by the text
 * the sidebar shows for it, including an entry with NO `label` (objectui#9868,
 * contract review finding 2).
 *
 * It built each result as `item.label || item.objectName || item.dashboardName
 * || …`, so a label-less entry whose target IS labelled was listed — and could
 * only be found — by its machine name. It now resolves through
 * `resolveNavItemLabel` with the shared `useNavTargetLabel` resolver:
 *
 *  - a label-less view / dashboard entry is listed by its target's CURRENT
 *    metadata label, and a query for that label finds it while a query for a
 *    text it no longer shows does not;
 *  - a label-less page falls back to its `pageName` (not an inheriting target);
 *  - CONTROL: an authored label is listed verbatim.
 *
 * objectui#11299: an entry label written as an inline locale map is listed —
 * and matched — in the viewer's language (`useObjectTranslation().language`,
 * handed to `resolveNavItemLabel` as `locale`), under a real `I18nProvider`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { createI18n, I18nProvider } from '@object-ui/i18n';

const url = vi.hoisted(() => ({ search: '' }));

vi.mock('react-router-dom', () => ({
  useParams: () => ({ appName: 'crm' }),
  useSearchParams: () => [new URLSearchParams(url.search), vi.fn()],
  Link: ({ to, children, ...rest }: { to: unknown; children?: React.ReactNode }) => (
    <a href={typeof to === 'string' ? to : ''} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@object-ui/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useRecordSearch: () => ({ results: [], isSearching: false, error: undefined }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    apps: [
      {
        name: 'crm',
        label: 'CRM',
        navigation: [
          { id: 'nav_board', type: 'object', objectName: 'customer', viewName: 'board' },
          { id: 'nav_dash', type: 'dashboard', dashboardName: 'sales_overview' },
          { id: 'nav_page', type: 'page', pageName: 'my_page' },
          { id: 'nav_home', type: 'page', pageName: 'home', label: 'Team Home' },
          // objectui#11299: a present label written as an inline locale map.
          { id: 'nav_contacts', type: 'object', objectName: 'contact', label: { en: 'Contacts', 'zh-CN': '联系人' } },
        ],
      },
    ],
    objects: [
      {
        name: 'customer',
        label: 'Customers',
        listViews: { 'customer.board': { name: 'customer.board', label: '客户管理仪表盘' } },
      },
    ],
    dashboards: [{ name: 'sales_overview', label: 'Sales Overview' }],
  }),
}));

vi.mock('../../providers/AdapterProvider', () => ({
  useAdapter: () => ({ find: vi.fn(), searchAll: vi.fn() }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u1' }, activeOrganization: null }),
}));

import { SearchResultsPage } from '../SearchResultsPage';

/** The visible title of every nav result card, in render order. */
const titles = () => Array.from(document.querySelectorAll('p.text-sm.font-medium')).map((p) => p.textContent);

describe('objectui#9868 — search lists and matches a label-less nav entry by the label it shows', () => {
  beforeEach(() => {
    url.search = '';
  });

  it('browse: inherited labels for the view and dashboard entries, pageName for the page, the authored label verbatim', () => {
    render(<SearchResultsPage />);
    expect(titles()).toEqual(expect.arrayContaining(['客户管理仪表盘', 'Sales Overview', 'my_page', 'Team Home']));
    // Not the machine names the old `item.label || item.objectName || …` chain listed.
    expect(titles()).not.toContain('customer');
    expect(titles()).not.toContain('sales_overview');
  });

  it('query: the inherited label finds the entry', () => {
    url.search = 'q=仪表盘';
    render(<SearchResultsPage />);
    expect(titles()).toEqual(['客户管理仪表盘']);
  });

  it('query: the dashboard is found by its label, not only by its machine name', () => {
    url.search = 'q=overview';
    render(<SearchResultsPage />);
    expect(screen.getByText('Sales Overview')).toBeTruthy();
  });
});

describe('objectui#11299 — search lists and matches a map-labelled entry in the viewer’s language', () => {
  beforeEach(() => {
    url.search = '';
  });

  const inLanguage = (language: string) => (
    <I18nProvider instance={createI18n({ defaultLanguage: language, detectBrowserLanguage: false })} persistLanguage={false}>
      <SearchResultsPage />
    </I18nProvider>
  );

  it('under zh-CN the entry is listed by its zh-CN text, and a zh-CN query finds it', () => {
    render(inLanguage('zh-CN'));
    expect(titles()).toContain('联系人');
    expect(titles()).not.toContain('Contacts');
    cleanup();

    url.search = 'q=联系';
    render(inLanguage('zh-CN'));
    expect(titles()).toEqual(['联系人']);
  });

  it('under en the same entry is listed by its en text', () => {
    render(inLanguage('en'));
    expect(titles()).toContain('Contacts');
    expect(titles()).not.toContain('联系人');
  });
});
