/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#11245 — the rendered book sidebar, through the REAL route table
 * (DocsLayout → DocsSlug / DocPage → BookSidebar), lists a doc that names one of
 * the book's groups through its own `group` key from outside the book's package.
 *
 * The world is the card's probe: book `docprobe_manual` (package
 * `com.example.docprobe`) with a "Getting started" and a "Reference" group, and a
 * doc `live_guide` saved from the doc editor with `group: 'reference'` into it —
 * a runtime row, not the book's package. `GET /meta/book/docprobe_manual/tree`
 * lists it under Reference; the sidebar now does too. The book landing opens a
 * book whose only member is placed that way. Another package's ungrouped doc
 * stays out of the sidebar (the control).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { ADAPTER } = vi.hoisted(() => {
  const PKG = 'com.example.docprobe';
  const DOCS = [
    { name: 'docprobe_gs_welcome', label: 'Welcome', _packageId: PKG },
    { name: 'live_guide', label: 'Live Guide', group: 'reference', _packageId: 'sys_metadata' },
    { name: 'other_note', label: 'Other Note', _packageId: 'com.example.other' },
    { name: 'live_note', label: 'Live Note', group: 'notes', _packageId: 'sys_metadata' },
  ];
  const BOOKS = [
    { name: 'docprobe_manual', label: 'Probe Manual', _packageId: PKG,
      groups: [
        { key: 'start', label: 'Getting started', order: 1, include: 'docprobe_gs_*' },
        { key: 'reference', label: 'Reference', order: 2 },
      ] },
    // A book whose ONLY member is placed by its own `group` from another package.
    { name: 'notes_manual', label: 'Notes', _packageId: 'com.example.notes',
      groups: [{ key: 'notes', label: 'Notes' }] },
  ];
  const CONTENT: Record<string, string> = {
    docprobe_gs_welcome: 'WELCOME BODY',
    live_guide: 'LIVE BODY',
    other_note: 'OTHER BODY',
    live_note: 'NOTE BODY',
  };
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) => (type === 'doc' ? DOCS : type === 'book' ? BOOKS : []),
        getItem: async (_type: string, name: string) => ({ item: { name, content: CONTENT[name] } }),
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
import DocsSlug from './DocsSlug';
import DocPage from './DocPage';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function Portal({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Where />
      <Routes>
        <Route path="/docs" element={<DocsLayout />}>
          <Route path=":slug" element={<DocsSlug />} />
          <Route path=":slug/:name" element={<DocPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

/** Each rendered copy of a sidebar group (wide nav + narrow disclosure), by its label. */
const sidebarGroups = async (label: string) =>
  (await screen.findAllByText(label)).map((el) => el.parentElement as HTMLElement);

afterEach(cleanup);

describe('objectui#11245 — the book sidebar lists a doc placed by its own `group` from another package', () => {
  it('reading another page of the book, the Reference group links the placed doc', async () => {
    render(<Portal entry="/docs/docprobe_manual/docprobe_gs_welcome" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('WELCOME BODY');
    const groups = await sidebarGroups('Reference');
    expect(groups.length).toBeGreaterThanOrEqual(1);
    for (const group of groups) {
      const link = within(group).getByRole('link', { name: 'Live Guide' });
      expect(link).toHaveAttribute('href', '/docs/docprobe_manual/live_guide');
    }
  });

  it('reading the placed doc, the sidebar marks it current inside its group', async () => {
    render(<Portal entry="/docs/docprobe_manual/live_guide" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('LIVE BODY');
    for (const group of await sidebarGroups('Reference')) {
      expect(within(group).getByRole('link', { name: 'Live Guide' })).toHaveAttribute('aria-current', 'page');
    }
  });

  it('a book whose only member is placed that way opens to it, not to "no documents yet"', async () => {
    render(<Portal entry="/docs/notes_manual" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('NOTE BODY');
    expect(screen.getByTestId('where').textContent).toBe('/docs/notes_manual/live_note');
  });

  it('control: another package\'s ungrouped doc stays out of the sidebar (no Uncategorized)', async () => {
    render(<Portal entry="/docs/docprobe_manual/docprobe_gs_welcome" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('WELCOME BODY');
    await sidebarGroups('Getting started'); // the sidebar has rendered
    expect(screen.queryAllByRole('link', { name: 'Other Note' })).toEqual([]);
    expect(screen.queryAllByText('Uncategorized')).toEqual([]);
  });
});
