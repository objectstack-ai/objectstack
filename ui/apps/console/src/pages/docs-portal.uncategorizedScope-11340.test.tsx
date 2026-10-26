/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11340 — the rendered book sidebar, through the REAL route table
 * (DocsLayout → DocPage → BookSidebar), shows the resolver's answer with no
 * pre-filter in front of it.
 *
 * Book `crm_manual` (package `crm`) has a "Getting started" group, a "Pinned"
 * group whose `pages` pin `ops_keys` from package `ops`, and an "Extensions"
 * group that reads package `b` through its own `package`. Its Uncategorized
 * group lists the unplaced docs of `crm` and `b` — the book's own packages —
 * and no other package's (the control). The pinned doc of another package is
 * listed under its own label.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { ADAPTER } = vi.hoisted(() => {
  const DOCS = [
    { name: 'crm_intro', label: 'Intro', _packageId: 'crm' },
    { name: 'crm_stray', label: 'Stray Page', _packageId: 'crm' },
    { name: 'ops_keys', label: 'Ops Keys', _packageId: 'ops' },
    { name: 'ops_note', label: 'Ops Note', _packageId: 'ops' },
    { name: 'b_ref_one', label: 'B Reference', _packageId: 'b' },
    { name: 'b_note', label: 'B Note', _packageId: 'b' },
  ];
  const BOOKS = [
    { name: 'crm_manual', label: 'CRM Manual', _packageId: 'crm',
      groups: [
        { key: 'start', label: 'Getting started', order: 1, include: 'crm_intro' },
        { key: 'pinned', label: 'Pinned', order: 2, pages: ['ops_keys'] },
        { key: 'ext', label: 'Extensions', order: 3, include: 'b_ref_*', package: 'b' },
      ] },
  ];
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) => (type === 'doc' ? DOCS : type === 'book' ? BOOKS : []),
        getItem: async (_type: string, name: string) => ({ item: { name, content: `${name} BODY` } }),
      },
    }),
  };
  return { ADAPTER };
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
import DocPage from './DocPage';

function Portal({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/docs" element={<DocsLayout />}>
          <Route path=":slug/:name" element={<DocPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

/** Each rendered copy of a sidebar group (wide nav + narrow disclosure), by its label. */
const sidebarGroups = async (label: string) =>
  (await screen.findAllByText(label)).map((el) => el.parentElement as HTMLElement);

/** Open the reader on the book's first page and wait for the sidebar. */
async function openManual() {
  render(<Portal entry="/docs/crm_manual/crm_intro" />);
  expect(await screen.findByTestId('doc-content')).toHaveTextContent('crm_intro BODY');
  await sidebarGroups('Getting started');
}

afterEach(cleanup);

describe('objectui#11340 — the book sidebar renders the resolver\'s Uncategorized group', () => {
  it('lists the book\'s own unplaced doc under Uncategorized, and no other package\'s (the control)', async () => {
    await openManual();
    const groups = await sidebarGroups('Uncategorized');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    for (const group of groups) {
      expect(within(group).getByRole('link', { name: 'Stray Page' })).toHaveAttribute('href', '/docs/crm_manual/crm_stray');
    }
    expect(screen.queryAllByRole('link', { name: 'Ops Note' })).toEqual([]);
  });

  it('corner 1: a group\'s `package` makes that package\'s unplaced doc an Uncategorized entry', async () => {
    await openManual();
    for (const group of await sidebarGroups('Uncategorized')) {
      expect(within(group).getByRole('link', { name: 'B Note' })).toHaveAttribute('href', '/docs/crm_manual/b_note');
    }
  });

  it('corner 2: a `pages`-pinned doc of another package is listed in its pinned group under its own label', async () => {
    await openManual();
    const groups = await sidebarGroups('Pinned');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    for (const group of groups) {
      expect(within(group).getByRole('link', { name: 'Ops Keys' })).toHaveAttribute('href', '/docs/crm_manual/ops_keys');
    }
  });
});
