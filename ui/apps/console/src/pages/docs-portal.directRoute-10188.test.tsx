/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#10188 — the docs portal's DIRECT routes, for a member outside a doc's
 * audience, through the REAL route table (DocsLayout → DocsSlug / DocPage).
 *
 * The acceptance: "a member outside the doc's audience does not see the entry and
 * gets a refusal, not a blank page, on the direct route". The server answers such
 * a member 403 `PERMISSION_DENIED` (401 `UNAUTHENTICATED` when signed out) on
 * `GET /meta/doc/:name` and `GET /meta/book/:name`, and 404 for a name nothing
 * carries. The portal mirrors that split: a refusal is never shown as "not found",
 * and a truly absent name still is.
 *
 * The adapter below is that member: its `doc` / `book` lists omit the staff doc
 * and book (the server prunes them per caller), and its single-item reads reject
 * exactly as `@objectstack/client` does on a failed response — an `Error` carrying
 * the server's `message`, `httpStatus` and `code`.
 *
 * The second block pins the addendum's "a doc entry opens that page in its book's
 * context": in a package with several books, the flat permalink opens the doc in
 * the book that CLAIMS it, not in the package's first book by label.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const { ADAPTER } = vi.hoisted(() => {
  const PKG = 'com.example.menuprobe';
  const MULTI = 'com.example.multi';
  /** The outsider's lists: no staff doc, no staff book (server-pruned per caller). */
  const DOCS = [
    { name: 'menuprobe_gs_welcome', label: 'Welcome', _packageId: PKG },
    { name: 'multi_guide', label: 'Multi Guide', _packageId: MULTI },
    { name: 'multi_loose', label: 'Loose Page', _packageId: MULTI },
  ];
  const BOOKS = [
    { name: 'menuprobe_manual', label: 'Open Manual', _packageId: PKG,
      groups: [{ key: 'start', label: 'Getting started', include: 'menuprobe_gs_*' }] },
    // Two books in ONE package. By label, "A Manual" comes first — but it claims
    // nothing of `multi_guide`; "Z Manual" is the book that claims it.
    { name: 'multi_a_manual', label: 'A Manual', _packageId: MULTI,
      groups: [{ key: 'other', label: 'Other', include: 'multi_other_*' }] },
    { name: 'multi_z_manual', label: 'Z Manual', _packageId: MULTI,
      groups: [{ key: 'guides', label: 'Guides', include: 'multi_guide' }] },
  ];
  const CONTENT: Record<string, string> = {
    menuprobe_gs_welcome: 'WELCOME BODY',
    multi_guide: 'MULTI GUIDE BODY',
    multi_loose: 'LOOSE BODY',
  };
  /** A rejection shaped like `@objectstack/client`'s on a non-2xx response. */
  const failure = (httpStatus: number, code: string, message: string) =>
    Object.assign(new Error(message), { httpStatus, code });
  const HOLDER = 'This documentation is limited to holders of a permission set you do not have';
  const SIGN_IN = 'This documentation requires sign-in';
  const ABSENT = 'Metadata item not found or access denied.';
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) => (type === 'doc' ? DOCS : type === 'book' ? BOOKS : []),
        getItem: async (type: string, name: string) => {
          if (type === 'doc') {
            if (name in CONTENT) return { item: { name, content: CONTENT[name] } };
            if (name === 'menuprobe_staff_secret') throw failure(403, 'PERMISSION_DENIED', HOLDER);
            if (name === 'menuprobe_signin_only') throw failure(401, 'UNAUTHENTICATED', SIGN_IN);
            throw failure(404, 'RESOURCE_NOT_FOUND', ABSENT);
          }
          if (type === 'book') {
            if (BOOKS.some((b) => b.name === name)) return { item: BOOKS.find((b) => b.name === name) };
            if (name === 'menuprobe_staff_manual') throw failure(403, 'PERMISSION_DENIED', HOLDER);
            throw failure(404, 'RESOURCE_NOT_FOUND', ABSENT);
          }
          throw failure(404, 'RESOURCE_NOT_FOUND', ABSENT);
        },
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
import DocsIndex from './DocsIndex';
import DocsSlug from './DocsSlug';
import DocPage from './DocPage';

const REFUSAL = 'You do not have access to this documentation';
const HOLDER = 'This documentation is limited to holders of a permission set you do not have';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function Portal({ entry }: { entry: string }) {
  const children = (
    <>
      <Route path=":slug" element={<DocsSlug />} />
      <Route path=":slug/:name" element={<DocPage />} />
    </>
  );
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Where />
      <Routes>
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsIndex />} />
          {children}
        </Route>
        <Route path="/apps/:appName/docs" element={<DocsLayout />}>
          {children}
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

const where = () => screen.getByTestId('where').textContent;

afterEach(cleanup);

describe('objectui#10188 — a member outside the audience gets a refusal on the direct route, never "not found"', () => {
  it.each([
    ['a page: /docs/DOC', '/docs/menuprobe_staff_secret'],
    ['a book: /docs/BOOK', '/docs/menuprobe_staff_manual'],
    ['a page in a book: /docs/BOOK/DOC', '/docs/menuprobe_staff_manual/menuprobe_staff_secret'],
    ['a page, under the package container a menu entry links into', '/apps/com.example.menuprobe/docs/menuprobe_staff_secret'],
    ['a book, under the package container', '/apps/com.example.menuprobe/docs/menuprobe_staff_manual'],
  ])('%s → the refusal with the server\'s reason, in place', async (_name, entry) => {
    render(<Portal entry={entry} />);
    expect(await screen.findByRole('heading', { name: REFUSAL })).toBeInTheDocument();
    expect(screen.getByText(HOLDER)).toBeInTheDocument();
    expect(screen.queryByText('Documentation not found')).toBeNull();
    expect(screen.queryByText('Failed to load documentation')).toBeNull();
    expect(screen.queryByTestId('doc-content')).toBeNull();
    expect(where()).toBe(entry);
  });

  it('signed out (401): the refusal carries the server\'s sign-in reason', async () => {
    render(<Portal entry="/docs/menuprobe_manual/menuprobe_signin_only" />);
    expect(await screen.findByRole('heading', { name: REFUSAL })).toBeInTheDocument();
    expect(screen.getByText('This documentation requires sign-in')).toBeInTheDocument();
  });

  it('control: a name nothing carries is still "not found"', async () => {
    render(<Portal entry="/docs/menuprobe_no_such_doc" />);
    expect(await screen.findByText('Documentation not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: REFUSAL })).toBeNull();
    expect(where()).toBe('/docs/menuprobe_no_such_doc');
  });

  it('control: a name nothing carries, as a reader segment, is still "not found"', async () => {
    render(<Portal entry="/docs/menuprobe_manual/menuprobe_no_such_doc" />);
    expect(await screen.findByText('Documentation not found')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: REFUSAL })).toBeNull();
  });

  it('control: a page the member can read still opens in its book', async () => {
    render(<Portal entry="/docs/menuprobe_gs_welcome" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('WELCOME BODY');
    expect(where()).toBe('/docs/menuprobe_manual/menuprobe_gs_welcome');
  });
});

describe('objectui#10188 — a flat doc permalink opens the page in the book that claims it', () => {
  const activeSidebarLinks = (label: string) =>
    screen.queryAllByRole('link', { name: label }).filter((l) => l.getAttribute('aria-current') === 'page');

  it('several books in one package: the claiming book, not the first by label', async () => {
    render(<Portal entry="/docs/multi_guide" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('MULTI GUIDE BODY');
    expect(where()).toBe('/docs/multi_z_manual/multi_guide');
    const active = activeSidebarLinks('Multi Guide');
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.every((l) => l.getAttribute('href') === '/docs/multi_z_manual/multi_guide')).toBe(true);
  });

  it('control: a page no book claims keeps today\'s answer — the package\'s first book', async () => {
    render(<Portal entry="/docs/multi_loose" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('LOOSE BODY');
    expect(where()).toBe('/docs/multi_a_manual/multi_loose');
  });
});
