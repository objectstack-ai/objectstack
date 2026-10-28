/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#27091 — a doc a SIBLING book places is not this book's orphan.
 *
 * ADR-0046 §6.4 rolls up only the docs "left unplaced". HotCRM ships two books
 * over one package (hotcrm#2327): `crm_manual` and `crm_admin_manual`, the
 * latter gated by a permission set. Every doc is claimed by exactly one book,
 * yet each book's sidebar listed the other's pages under a trailing
 * Uncategorized group, because "claimed" was judged against the book's own
 * groups only. The framework's `resolveBookTree` judges against every book
 * since objectstack#27091; this port follows it, and the docs pages pass the
 * AUTHORED books.
 *
 * Each resolver case is checked against the spec's resolver over the same
 * docs and books, the answer `GET /meta/book/:name/tree` gives.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { resolveBookTree as specResolveBookTree } from '@objectstack/spec/system';

const { ADAPTER } = vi.hoisted(() => {
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async () => [],
        getItem: async (_type: string, name: string) => ({ item: { name, content: `# ${name}` } }),
      },
    }),
  };
  return { ADAPTER };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}));

// Imported AFTER the mocks so the page picks up the mocked modules.
import DocPage from './DocPage';
import { BookDataContext } from './use-book-data';
import { buildPortalBooks, resolveBookTree, type Book, type ResolvedBook, type ResolverDoc } from './book-nav';

const docs: ResolverDoc[] = [
  { name: 'crm_overview', label: 'Overview', packageId: 'crm' },
  { name: 'crm_sales_leads', label: 'Leads', packageId: 'crm' },
  { name: 'crm_admin_access', label: 'Access control', packageId: 'crm' },
  { name: 'crm_admin_automation', label: 'Automation', packageId: 'crm' },
];
const userManual: Book = {
  name: 'crm_manual',
  label: 'CRM Manual',
  packageId: 'crm',
  groups: [
    { key: 'start', label: 'Start', include: 'crm_overview' },
    { key: 'sales', label: 'Sales', include: 'crm_sales_*' },
  ],
};
const adminManual: Book = {
  name: 'crm_admin_manual',
  label: 'CRM Admin Manual',
  packageId: 'crm',
  groups: [{ key: 'admin', label: 'Admin', include: 'crm_admin_*' }],
};
const authored = [userManual, adminManual];

const keysAndDocs = (r: { groups: { key: string; entries: { doc?: string }[] }[] }) =>
  Object.fromEntries(r.groups.map((g) => [g.key, g.entries.map((e) => e.doc)]));

/** What `GET /meta/book/:name/tree` answers: the spec resolver, judged by every book. */
const specBook = (b: Book) => ({ name: b.name, label: b.label, groups: b.groups ?? [], packageId: b.packageId });
const endpointTree = (b: Book, all: ResolverDoc[]) =>
  specResolveBookTree(specBook(b), all, b.packageId, authored.map(specBook));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('objectstack#27091 — the port: a sibling book\'s pages are not Uncategorized', () => {
  it('HotCRM\'s two books: neither tree has an Uncategorized group, and the spec agrees', () => {
    const user: ResolvedBook = resolveBookTree(userManual, docs, undefined, authored);
    expect(keysAndDocs(user)).toEqual({ start: ['crm_overview'], sales: ['crm_sales_leads'] });
    expect(keysAndDocs(resolveBookTree(adminManual, docs, undefined, authored))).toEqual({
      admin: ['crm_admin_access', 'crm_admin_automation'],
    });
    for (const b of authored) {
      expect(keysAndDocs(resolveBookTree(b, docs, undefined, authored))).toEqual(keysAndDocs(endpointTree(b, docs)));
    }
  });

  it('a doc NO book claims still rolls up under Uncategorized', () => {
    const withStray = [...docs, { name: 'crm_stray', label: 'Stray', packageId: 'crm' }];
    expect(keysAndDocs(resolveBookTree(userManual, withStray, undefined, authored)).uncategorized).toEqual(['crm_stray']);
  });

  it('CONTROL: without `books` the tree is unchanged, the sibling\'s pages still in Uncategorized', () => {
    expect(keysAndDocs(resolveBookTree(userManual, docs)).uncategorized).toEqual([
      'crm_admin_access',
      'crm_admin_automation',
    ]);
  });
});

describe('objectstack#27091 — the reader\'s sidebar for crm_manual', () => {
  it('lists the book\'s own pages and no Uncategorized group holding the admin pages', async () => {
    const value = { authoredBooks: authored, books: buildPortalBooks(authored, docs), docs, state: 'ready' as const };
    render(
      <BookDataContext.Provider value={value}>
        <MemoryRouter initialEntries={['/docs/crm_manual/crm_overview']}>
          <Routes>
            <Route path="/docs/:slug/:name" element={<DocPage />} />
          </Routes>
        </MemoryRouter>
      </BookDataContext.Provider>,
    );
    expect((await screen.findAllByRole('link', { name: 'Leads' })).length).toBeGreaterThan(0);
    expect(screen.queryByText('Uncategorized')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Access control' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Automation' })).toBeNull();
  });
});
