/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectstack#26690 — the docs sidebar under `/apps/:appName/docs` draws a doc
 * book's title and section titles in the reader's locale.
 *
 * The portal builds its sidebar from `GET /meta/book`, which the server answers
 * in the request locale (`Accept-Language`, sent by the console's client on
 * every request) by overlaying the bundle's `books` group through
 * `translateBook`. This test mounts the REAL route table, layout, reader and
 * sidebar over an adapter that answers the book list the way the server does:
 * the authored book run through the spec's own translator with a translation
 * bundle, for the locale the "request" carries. So the chain pinned here is
 * bundle → served book → sidebar, with nothing hand-translated in between.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { ADAPTER, REQUEST } = vi.hoisted(() => {
  const REQUEST = { locale: 'en-US' };
  const DOCS = [
    { name: 'crm_start_login', label: 'Signing in', _packageId: 'com.example.crm', order: 1 },
    { name: 'crm_pipe_stages', label: 'Stages', _packageId: 'com.example.crm', order: 2 },
  ];
  const BOOK = {
    name: 'crm_manual',
    label: 'User Manual',
    slug: 'manual',
    _packageId: 'com.example.crm',
    groups: [
      { key: 'start', label: 'Getting started', include: 'crm_start_*' },
      { key: 'pipeline', label: 'Pipeline', include: 'crm_pipe_*' },
    ],
  };
  const BUNDLE = {
    'zh-CN': {
      books: { crm_manual: { label: '使用手册', groups: { start: { label: '快速上手' }, pipeline: { label: '销售管道' } } } },
    },
  };
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) => {
          if (type === 'doc') return DOCS;
          if (type !== 'book') return [];
          // What `GET /meta/book` answers: every book through the translator
          // table, for the request's locale.
          const { translateMetadataDocument } = await import('@objectstack/spec/system');
          return [translateMetadataDocument('book', BOOK, BUNDLE as any, { locale: REQUEST.locale })];
        },
        getItem: async (_type: string, name: string) => ({ item: { name, content: `BODY ${name}` } }),
      },
    }),
  };
  return { ADAPTER, REQUEST };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
}));

vi.mock('@object-ui/plugin-markdown', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  MarkdownRenderer: ({ schema }: { schema: { content?: string } }) => (
    <div data-testid="doc-content">{schema.content}</div>
  ),
  extractToc: () => [],
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: (_k: string, o?: { defaultValue?: string }) => o?.defaultValue ?? _k }),
}));

// Imported AFTER the mocks so the pages pick up the mocked modules.
import DocsLayout from './DocsLayout';
import DocsSlug from './DocsSlug';
import DocPage from './DocPage';

function Portal({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/apps/:appName/docs" element={<DocsLayout />}>
          <Route path=":slug" element={<DocsSlug />} />
          <Route path=":slug/:name" element={<DocPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

/** The book sidebar (rendered once wide, once as a narrow disclosure) — every copy. */
async function sidebars(): Promise<HTMLElement[]> {
  await screen.findByTestId('doc-content');
  return screen.getAllByRole('navigation').filter((nav) => within(nav).queryAllByRole('link').length > 0);
}

afterEach(() => {
  cleanup();
  REQUEST.locale = 'en-US';
});

describe('objectstack#26690 — the docs sidebar serves the request locale', () => {
  it('a zh-CN reader sees the book title and every section title in zh-CN', async () => {
    REQUEST.locale = 'zh-CN';
    render(<Portal entry="/apps/com.example.crm/docs/manual/crm_start_login" />);
    const navs = await sidebars();
    expect(navs.length).toBeGreaterThanOrEqual(1);
    for (const nav of navs) {
      expect(nav).toHaveAttribute('aria-label', '使用手册');
      expect(within(nav).getByText('快速上手')).toBeInTheDocument();
      expect(within(nav).getByText('销售管道')).toBeInTheDocument();
      expect(within(nav).queryByText('Getting started')).toBeNull();
    }
  });

  it('an en-US reader is unchanged: the authored title and section titles', async () => {
    render(<Portal entry="/apps/com.example.crm/docs/manual/crm_start_login" />);
    const navs = await sidebars();
    expect(navs.length).toBeGreaterThanOrEqual(1);
    for (const nav of navs) {
      expect(nav).toHaveAttribute('aria-label', 'User Manual');
      expect(within(nav).getByText('Getting started')).toBeInTheDocument();
      expect(within(nav).getByText('Pipeline')).toBeInTheDocument();
    }
  });
});
