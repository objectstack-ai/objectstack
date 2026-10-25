/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Integration test for the book-driven docs portal (ADR-0046 §6): mounts the
 * REAL DocsIndex / DocsSlug / BookPage / DocPage under the REAL route table,
 * backed by a mocked metadata adapter (no authored books — so the implicit
 * per-package books are exercised, §6.4). Verifies the full reader flow that
 * the unit tests can't: routing, the /docs/:slug dispatcher, the book landing,
 * the in-book reader + sidebar, and the legacy /docs/:name redirect.
 *
 * This is a jsdom integration test, not a real browser — it needs no backend.
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// ── Sample metadata the mocked adapter serves (two packages, no books) ──────
// Defined via vi.hoisted so the hoisted vi.mock factory can close over them,
// and so the adapter is a STABLE singleton — the real useAdapter() returns a
// memoized instance, so a fresh object per render would loop the fetch effects.
const { ADAPTER, WORLD } = vi.hoisted(() => {
  const DOCS = [
    { name: 'crm_intro', label: 'CRM Intro', _packageId: 'crm', order: 1 },
    { name: 'crm_guide_lead', label: 'Leads', _packageId: 'crm', order: 2 },
    { name: 'ops_setup', label: 'Setup', _packageId: 'ops' },
  ];
  const CONTENT: Record<string, string> = {
    crm_intro: 'Welcome to the CRM',
    crm_guide_lead: 'Managing leads',
    ops_setup: 'Operations setup',
  };
  // objectui#11197 — a second world, WITH authored books, switched on only by the
  // "a book NAME" block at the foot of this file. Every other test reads the
  // implicit-book world above, exactly as before.
  const AUTHORED_DOCS = [
    { name: 'showcase_index', label: 'Showcase Index', _packageId: 'com.example.showcase', order: 1 },
    { name: 'showcase_lead_guide', label: 'Lead Guide', _packageId: 'com.example.showcase', order: 2 },
    { name: 'alpha_welcome', label: 'Alpha Welcome', _packageId: 'com.example.alpha' },
    { name: 'beta_start', label: 'Beta Start', _packageId: 'com.example.beta' },
    { name: 'acme_intro', label: 'Acme Intro', _packageId: 'acme' },
    { name: 'ops_setup', label: 'Setup', _packageId: 'com.example.ops' },
  ];
  const AUTHORED_BOOKS = [
    // The shape of the one authored book in objectstack's examples: slug != name.
    { name: 'showcase_manual', label: 'Showcase Manual', slug: 'manual', order: 0, _packageId: 'com.example.showcase',
      groups: [{ key: 'start', label: 'Start', include: 'showcase_*' }] },
    // A BOOK named exactly like an installed DOC (collision: doc vs book name).
    { name: 'showcase_lead_guide', label: 'Leads Book', slug: 'leads', order: 1, _packageId: 'com.example.showcase',
      groups: [{ key: 'leads', label: 'Leads', include: 'showcase_lead*' }] },
    // One book's SLUG is another book's NAME (collision: slug vs name).
    { name: 'alpha_manual', label: 'Alpha Manual', slug: 'handbook', order: 2, _packageId: 'com.example.alpha',
      groups: [{ key: 'all', label: 'All', include: 'alpha_*' }] },
    { name: 'handbook', label: 'Beta Handbook', slug: 'beta', order: 3, _packageId: 'com.example.beta',
      groups: [{ key: 'all', label: 'All', include: 'beta_*' }] },
    // A book whose name's prefix IS its package id, so today's flat-doc
    // permalink fallback (`homeBook` by name prefix) catches the name first.
    { name: 'acme_manual', label: 'Acme Manual', slug: 'acme-docs', order: 4, _packageId: 'acme',
      groups: [{ key: 'all', label: 'All', include: 'acme_*' }] },
  ];
  const AUTHORED_CONTENT: Record<string, string> = {
    showcase_index: 'INDEX BODY',
    showcase_lead_guide: 'LEAD BODY',
    alpha_welcome: 'ALPHA BODY',
    beta_start: 'BETA BODY',
    acme_intro: 'ACME BODY',
    ops_setup: 'OPS BODY',
  };
  const WORLD = { authored: false };
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string) =>
          WORLD.authored
            ? (type === 'doc' ? AUTHORED_DOCS : type === 'book' ? AUTHORED_BOOKS : [])
            : (type === 'doc' ? DOCS : []), // no authored books
        getItem: async (_type: string, name: string) => ({
          item: { name, content: (WORLD.authored ? AUTHORED_CONTENT : CONTENT)[name] },
        }),
      },
    }),
  };
  return { ADAPTER, WORLD };
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

// Mirrors the real route table: the layout fetches once and shares the data.
function Harness({ entry }: { entry: string }) {
  return (
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/docs" element={<DocsLayout />}>
          <Route index element={<DocsIndex />} />
          <Route path=":slug" element={<DocsSlug />} />
          <Route path=":slug/:name" element={<DocPage />} />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('book-driven docs portal (integration)', () => {
  it('/docs lists an implicit per-package book for every package with docs', async () => {
    render(<Harness entry="/docs" />);
    // Implicit books keyed by packageId: crm (2 docs) + ops (1 doc).
    const crm = await screen.findByRole('link', { name: /crm/i });
    expect(crm).toHaveAttribute('href', '/docs/crm');
    expect(screen.getByRole('link', { name: /ops/i })).toHaveAttribute('href', '/docs/ops');
    expect(screen.getByText('2 articles')).toBeInTheDocument();
    expect(screen.getByText('1 article')).toBeInTheDocument();
  });

  it('/docs/:slug opens the book to its overview doc (no duplicated TOC)', async () => {
    render(<Harness entry="/docs/crm" />);
    // The landing redirects into the reader of the first doc; content + sidebar.
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Welcome to the CRM');
    const intro = screen.getAllByRole('link', { name: 'CRM Intro' });
    expect(intro.every((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('/docs/:slug/:name renders the doc content with the book sidebar (active)', async () => {
    render(<Harness entry="/docs/crm/crm_intro" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Welcome to the CRM');
    // The sidebar is rendered twice (persistent on wide, a disclosure on narrow);
    // both mark the current doc active.
    const active = screen.getAllByRole('link', { name: 'CRM Intro' });
    expect(active.length).toBeGreaterThanOrEqual(1);
    expect(active.every((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
    // A sibling doc is reachable from the sidebar.
    const leads = screen.getAllByRole('link', { name: 'Leads' });
    expect(leads.some((l) => l.getAttribute('href') === '/docs/crm/crm_guide_lead')).toBe(true);
  });

  it('legacy /docs/:name redirects to the doc\'s canonical in-book URL', async () => {
    render(<Harness entry="/docs/crm_intro" />);
    // 'crm_intro' is not a book slug → dispatcher redirects to /docs/crm/crm_intro.
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Welcome to the CRM');
    const active = screen.getAllByRole('link', { name: 'CRM Intro' });
    expect(active.every((l) => l.getAttribute('aria-current') === 'page')).toBe(true);
  });

  it('an unknown segment degrades to a not-found notice', async () => {
    render(<Harness entry="/docs/does_not_exist" />);
    expect(await screen.findByText('Documentation not found')).toBeInTheDocument();
  });

  it('clicking a book card opens it (real router flow)', async () => {
    render(<Harness entry="/docs" />);
    fireEvent.click(await screen.findByRole('link', { name: /ops/i }));
    // /docs/ops opens the ops book → reader of its single doc.
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Operations setup');
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// objectui#11197 — a book NAME reaches the book (the `doc` nav entry's target)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A `{ type: 'doc', book }` navigation entry names a book by its NAME (the
 * spec's `DocNavItemSchema.book`, the name the CLI's docs lint checks), while the
 * portal addresses a book by `bookSlug(book)` — its `slug`, default the name. So a
 * book that authors a different `slug` answered "Documentation not found" at
 * `…/docs/NAME`, and `…/docs/NAME/DOC` rendered the doc with no book sidebar.
 *
 * The portal now resolves a segment that is a book's NAME to that book and
 * redirects (replace) to the canonical slug URL. ⛔ The invariant: no URL that
 * resolves today changes its answer. The name lookup therefore runs AFTER the
 * two lookups that answer today — a book's slug, then an installed doc's name
 * (the flat-doc permalink) — and before the name-prefix fallback, whose answer
 * for a name no installed doc carries is a redirect to "Documentation not found".
 * The collision pins and the controls below hold every answer that resolves today.
 */
describe('objectui#11197 — a book NAME reaches the book, and nothing that resolves today moves', () => {
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
  /** Render `entry`, wait for doc content, and answer where the portal landed. */
  async function landsOn(entry: string): Promise<{ where: string | null; content: string | null }> {
    render(<Portal entry={entry} />);
    const content = (await screen.findByTestId('doc-content')).textContent;
    return { where: screen.getByTestId('where').textContent, content };
  }
  /** The sidebar links to `docName` that mark it current, i.e. the book sidebar is drawn around it. */
  const activeSidebarLinks = (label: string) =>
    screen.queryAllByRole('link', { name: label }).filter((l) => l.getAttribute('aria-current') === 'page');

  beforeEach(() => {
    WORLD.authored = true;
  });
  afterEach(() => {
    WORLD.authored = false;
  });

  describe('a NAME segment that answered "not found" now reaches its book', () => {
    it('`{ book: \'showcase_manual\' }` (slug `manual`) → …/docs/manual, landing on the book', async () => {
      expect(await landsOn('/docs/showcase_manual')).toEqual({ where: '/docs/manual/showcase_index', content: 'INDEX BODY' });
    });

    it('the same, under the package container the nav renderer links into', async () => {
      expect(await landsOn('/apps/com.example.showcase/docs/showcase_manual')).toEqual({
        where: '/apps/com.example.showcase/docs/manual/showcase_index',
        content: 'INDEX BODY',
      });
    });

    it('`{ book, doc }` → …/docs/manual/DOC, WITH the book sidebar', async () => {
      expect(await landsOn('/docs/showcase_manual/showcase_lead_guide')).toEqual({
        where: '/docs/manual/showcase_lead_guide',
        content: 'LEAD BODY',
      });
      const active = activeSidebarLinks('Lead Guide');
      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(active.every((l) => l.getAttribute('href') === '/docs/manual/showcase_lead_guide')).toBe(true);
    });

    it('`{ book, doc }` under the package container', async () => {
      expect(await landsOn('/apps/com.example.showcase/docs/showcase_manual/showcase_lead_guide')).toEqual({
        where: '/apps/com.example.showcase/docs/manual/showcase_lead_guide',
        content: 'LEAD BODY',
      });
      expect(activeSidebarLinks('Lead Guide').length).toBeGreaterThanOrEqual(1);
    });

    it('a book name the name-prefix fallback caught first (its answer was "not found") reaches the book', async () => {
      expect(await landsOn('/docs/acme_manual')).toEqual({ where: '/docs/acme-docs/acme_intro', content: 'ACME BODY' });
    });
  });

  describe('collisions keep today\'s answer', () => {
    it('a segment that is one book\'s SLUG and another\'s NAME opens the slug\'s book', async () => {
      // `handbook` is alpha_manual's slug and the name of the book whose slug is `beta`.
      expect(await landsOn('/docs/handbook')).toEqual({ where: '/docs/handbook/alpha_welcome', content: 'ALPHA BODY' });
    });

    it('…and as a reader segment it stays the slug\'s book: no redirect', async () => {
      expect(await landsOn('/docs/handbook/beta_start')).toEqual({ where: '/docs/handbook/beta_start', content: 'BETA BODY' });
    });

    it('a segment that is both an installed DOC\'s name and a BOOK\'s name stays the doc permalink', async () => {
      // Not `/docs/leads` (the book named `showcase_lead_guide`): the doc wins, as today.
      expect(await landsOn('/docs/showcase_lead_guide')).toEqual({
        where: '/docs/manual/showcase_lead_guide',
        content: 'LEAD BODY',
      });
    });
  });

  describe('controls — each URL shape that resolves today answers as it did', () => {
    it('a book SLUG → its landing', async () => {
      expect(await landsOn('/docs/manual')).toEqual({ where: '/docs/manual/showcase_index', content: 'INDEX BODY' });
    });

    it('SLUG/DOC → the reader, in place, with the sidebar', async () => {
      expect(await landsOn('/docs/manual/showcase_lead_guide')).toEqual({
        where: '/docs/manual/showcase_lead_guide',
        content: 'LEAD BODY',
      });
      expect(activeSidebarLinks('Lead Guide').length).toBeGreaterThanOrEqual(1);
    });

    it('an implicit package book (keyed by package id) → its landing', async () => {
      expect(await landsOn('/docs/com.example.ops')).toEqual({ where: '/docs/com.example.ops/ops_setup', content: 'OPS BODY' });
    });

    it('an unknown reader segment → the doc, in place, with no sidebar', async () => {
      expect(await landsOn('/docs/not_a_book/showcase_lead_guide')).toEqual({
        where: '/docs/not_a_book/showcase_lead_guide',
        content: 'LEAD BODY',
      });
      expect(activeSidebarLinks('Lead Guide')).toEqual([]);
    });

    it('a segment that names nothing is still "not found"', async () => {
      render(<Portal entry="/docs/nothing_here" />);
      expect(await screen.findByText('Documentation not found')).toBeInTheDocument();
      expect(screen.getByTestId('where').textContent).toBe('/docs/nothing_here');
    });
  });
});
