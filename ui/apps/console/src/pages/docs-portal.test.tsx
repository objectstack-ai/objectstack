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
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

// ── Sample metadata the mocked adapter serves (two packages, no books) ──────
// Defined via vi.hoisted so the hoisted vi.mock factory can close over them,
// and so the adapter is a STABLE singleton — the real useAdapter() returns a
// memoized instance, so a fresh object per render would loop the fetch effects.
const { ADAPTER, WORLD, GATED_REASON } = vi.hoisted(() => {
  const DOCS = [
    { name: 'crm_intro', label: 'CRM Intro', _packageId: 'crm', order: 1 },
    { name: 'crm_guide_lead', label: 'Leads', _packageId: 'crm', order: 2 },
    { name: 'ops_setup', label: 'Setup', _packageId: 'ops' },
  ];
  const CONTENT: Record<string, string> = {
    crm_intro: 'Welcome to the CRM',
    crm_guide_lead: 'Managing leads {#lead-scoring}',
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
    showcase_lead_guide: 'LEAD BODY {#lead-scoring}',
    alpha_welcome: 'ALPHA BODY',
    beta_start: 'BETA BODY',
    acme_intro: 'ACME BODY',
    ops_setup: 'OPS BODY',
  };
  // objectstack#34070 — a third world, switched on only by the "two packages
  // ship one doc name" block: `shared_guide` is shipped by alpha AND beta (beta
  // listed first), and a read of it that names no package is refused the way
  // the server refuses it, `409 RESOURCE_CONFLICT` naming both holders.
  const CONFLICT_DOCS = [
    { name: 'shared_guide', label: 'Shared Guide', _packageId: 'com.example.beta' },
    { name: 'beta_start', label: 'Beta Start', _packageId: 'com.example.beta' },
    { name: 'shared_guide', label: 'Shared Guide', _packageId: 'com.example.alpha' },
    { name: 'alpha_welcome', label: 'Alpha Welcome', _packageId: 'com.example.alpha' },
  ];
  const CONFLICT_CONTENT: Record<string, Record<string, string>> = {
    'com.example.alpha': { shared_guide: 'ALPHA SHARED BODY', alpha_welcome: 'ALPHA BODY' },
    'com.example.beta': { shared_guide: 'BETA SHARED BODY', beta_start: 'BETA BODY' },
  };
  // objectstack#34247 — a doc beta ships that the member's audience may not
  // read: pruned from the member's list (ADR-0046 §6.7), so only the flat
  // permalink's single-item read (objectui#10188) answers it, with the gate's
  // 403 wherever the read reaches beta's doc.
  const GATED: Record<string, string> = { gated_runbook: 'com.example.beta' };
  const GATED_REASON = 'Only the runbook audience may read this documentation';
  /** A rejection shaped like `@objectstack/client`'s on a non-2xx response. */
  const failure = (httpStatus: number, code: string, message: string, details?: unknown) =>
    Object.assign(new Error(message), { httpStatus, code, details });
  const conflictRead = (name: string, packageId: string | undefined) => {
    if (name === 'broken_doc') throw failure(500, 'INTERNAL_ERROR', 'The metadata service is unavailable');
    const holders = Object.keys(CONFLICT_CONTENT).filter((p) => name in CONFLICT_CONTENT[p] || GATED[name] === p);
    WORLD.reads.push(packageId);
    // objectstack#34247 — the server's exact address answers only that
    // package's own doc: where it ships none of the name, 409
    // `not-held-by-qualifier` naming the holders (ruling 6917064203 on
    // objectstack#34398), or 404 when no package ships it.
    if (packageId && WORLD.exact && !holders.includes(packageId)) {
      if (holders.length === 0) throw failure(404, 'RESOURCE_NOT_FOUND', `doc "${name}" not found`);
      // The server's envelope carries the candidates, not the reason.
      throw failure(409, 'RESOURCE_CONFLICT', `doc "${name}" is not held by package "${packageId}"`, {
        candidates: holders.map((p) => ({ kind: 'package', packageId: p })),
      });
    }
    if (name in GATED) throw failure(403, 'PERMISSION_DENIED', GATED_REASON);
    if (packageId) return { item: { name, content: CONFLICT_CONTENT[packageId]?.[name] } };
    if (holders.length > 1) {
      throw failure(409, 'RESOURCE_CONFLICT', `doc "${name}" is held by ${holders.length} packages`, {
        candidates: holders.map((p) => ({ kind: 'package', packageId: p })),
      });
    }
    return { item: { name, content: holders.length ? CONFLICT_CONTENT[holders[0]][name] : undefined } };
  };
  // objectstack#35424 — the "All documentation" page's world: the apps the
  // caller's `/meta/app` lists, a platform package's doc switched on by
  // `platform`, and every `?include=content` list read the page asks.
  const PLATFORM_DOCS = [{ name: 'setup_overview', label: 'Setup overview', _packageId: 'com.objectstack.setup' }];
  const PLATFORM_CONTENT: Record<string, string> = { setup_overview: 'ADMIN BODY about permission sets' };
  const WORLD = {
    authored: false,
    conflict: false,
    exact: false,
    platform: false,
    reads: [] as Array<string | undefined>,
    apps: [] as Array<Record<string, unknown>>,
    contentReads: 0,
  };
  const ADAPTER = {
    getClient: () => ({
      meta: {
        getItems: async (type: string, options?: { include?: string }) => {
          const list = WORLD.conflict
            ? (type === 'doc' ? CONFLICT_DOCS : []) // implicit books only
            : WORLD.authored
            ? (type === 'doc' ? [...AUTHORED_DOCS, ...(WORLD.platform ? PLATFORM_DOCS : [])] : type === 'book' ? AUTHORED_BOOKS : [])
            : (type === 'doc' ? DOCS : []); // no authored books
          if (type !== 'doc' || options?.include !== 'content') return list;
          // The list with every body, as `GET /meta/doc?include=content` serves it.
          WORLD.contentReads += 1;
          const bodies: Record<string, string> = { ...CONTENT, ...AUTHORED_CONTENT, ...PLATFORM_CONTENT };
          return list.map((d) => ({ ...d, content: bodies[d.name] }));
        },
        getItem: async (_type: string, name: string, options?: { packageId?: string }) =>
          WORLD.conflict
            ? conflictRead(name, options?.packageId)
            : { item: { name, content: (WORLD.authored ? AUTHORED_CONTENT : CONTENT)[name] } },
      },
    }),
  };
  return { ADAPTER, WORLD, GATED_REASON };
});

vi.mock('@object-ui/app-shell', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAdapter: () => ADAPTER,
  // The apps `/meta/app` serves this caller (objectstack#35424); none by default.
  useMetadata: () => ({ apps: WORLD.apps }),
}));

// A `{#id}` marker in a doc body stands for a heading with that anchor id. Like
// the real renderer's (behind React.lazy), it mounts AFTER the body's first
// render, and the marker is not part of the body text.
vi.mock('@object-ui/plugin-markdown', async (importOriginal) => {
  const { useEffect, useState } = await import('react');
  // Explicit closing tags: check:vi-mock-inherit's masker reads a self-closing `/>` after `}` as a regex.
  function LateHeadings({ ids }: { ids: string[] }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
      const timer = setTimeout(() => setMounted(true), 0);
      return () => clearTimeout(timer);
    }, []);
    return mounted ? <>{ids.map((id) => <h2 key={id} id={id}></h2>)}</> : null;
  }
  return {
    ...(await importOriginal<Record<string, unknown>>()),
    MarkdownRenderer: ({ schema }: { schema: { content?: string } }) => {
      const content = schema.content ?? '';
      const ids = [...content.matchAll(/\{#([\w-]+)\}/g)].map((m) => m[1]);
      return (
        <>
          <div data-testid="doc-content">{content.replace(/\s*\{#[\w-]+\}/g, '')}</div>
          <LateHeadings ids={ids}></LateHeadings>
        </>
      );
    },
    extractToc: () => [],
  };
});

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Interpolates `{{name}}` from the options, as i18next does.
  useObjectTranslation: () => ({
    t: (_k: string, o?: { defaultValue?: string } & Record<string, unknown>) =>
      (o?.defaultValue ?? _k).replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(o?.[name] ?? '')),
  }),
}));

// Imported AFTER the mocks so the pages pick up the mocked modules.
import DocsLayout from './DocsLayout';
import DocsIndex from './DocsIndex';
import DocsSlug from './DocsSlug';
import DocPage from './DocPage';
import AppDocsIndex from './AppDocsIndex';

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

    it('…and as a reader segment it is the slug\'s book: a doc of that book stays, with no redirect', async () => {
      expect(await landsOn('/docs/handbook/alpha_welcome')).toEqual({ where: '/docs/handbook/alpha_welcome', content: 'ALPHA BODY' });
    });

    it('…while a doc the slug\'s book does not hold reads in its own book (objectstack#35424), never in the book NAMED like the slug', async () => {
      // `beta_start` is in the book whose slug is `beta` (and whose name is
      // `handbook`); `handbook` the slug is alpha's book, which does not hold it.
      expect(await landsOn('/docs/handbook/beta_start')).toEqual({ where: '/docs/beta/beta_start', content: 'BETA BODY' });
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


// ─────────────────────────────────────────────────────────────────────────────
// objectstack#33055 — a flat permalink keeps its #section through the redirect
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A cross-reference to a section of another doc is written against the doc's
 * flat permalink (`…/docs/NAME#section`). The portal redirects that permalink
 * to the canonical in-book URL; the redirect keeps the fragment, and the reader
 * scrolls the named heading into view once it mounts (behind the markdown
 * renderer's lazy boundary) — the scroll an in-page anchor click gives. A URL
 * with no fragment lands at the top.
 */
describe('objectstack#33055 — the #section survives the flat → canonical redirect and is scrolled to', () => {
  function Where() {
    const { pathname, hash } = useLocation();
    return <div data-testid="where">{`${pathname}${hash}`}</div>;
  }
  function Portal({ entry }: { entry: string }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <Where />
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

  /** The ids of the elements `scrollIntoView` was called on, in order. */
  let scrolled: string[];
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this.id);
    });
  });
  afterEach(() => {
    delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    WORLD.authored = false;
  });

  it('a flat permalink with #section lands on the canonical URL with the fragment, scrolled to that heading', async () => {
    render(<Portal entry="/docs/crm_guide_lead#lead-scoring" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Managing leads');
    expect(screen.getByTestId('where').textContent).toBe('/docs/crm/crm_guide_lead#lead-scoring');
    await waitFor(() => expect(scrolled).toEqual(['lead-scoring']));
  });

  it('CONTROL: the same flat permalink with no fragment lands at the top', async () => {
    render(<Portal entry="/docs/crm_guide_lead" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Managing leads');
    expect(screen.getByTestId('where').textContent).toBe('/docs/crm/crm_guide_lead');
    await waitFor(() => expect(document.getElementById('lead-scoring')).not.toBeNull());
    expect(scrolled).toEqual([]);
  });

  it('the canonical URL with #section, opened directly, scrolls to that heading', async () => {
    render(<Portal entry="/docs/crm/crm_guide_lead#lead-scoring" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('Managing leads');
    await waitFor(() => expect(scrolled).toEqual(['lead-scoring']));
  });

  it('the name-prefix fallback redirect keeps the fragment too', async () => {
    render(<Portal entry="/docs/crm_not_installed#lead-scoring" />);
    expect(await screen.findByText('Documentation not found')).toBeInTheDocument();
    expect(screen.getByTestId('where').textContent).toBe('/docs/crm/crm_not_installed#lead-scoring');
  });

  it('a book NAME reader segment redirects to the slug URL with the fragment, scrolled to that heading', async () => {
    WORLD.authored = true;
    render(<Portal entry="/docs/showcase_manual/showcase_lead_guide#lead-scoring" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('LEAD BODY');
    expect(screen.getByTestId('where').textContent).toBe('/docs/manual/showcase_lead_guide#lead-scoring');
    await waitFor(() => expect(scrolled).toEqual(['lead-scoring']));
  });
});


// ─────────────────────────────────────────────────────────────────────────────
// objectstack#34070 — a doc name two packages ship: the reader picks the package
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Two enabled packages may ship one doc name. A read of it that names no
 * package is refused, `409 RESOURCE_CONFLICT`, with the holders in the
 * refusal's `details.candidates` (ADR-0150 D3; the `/meta` 409 section of
 * `content/docs/api/client-sdk.mdx`). The portal lists those candidates, each
 * linking to its package address `/apps/PACKAGE/docs/NAME`, where the read names
 * the package and the doc opens in that package's own book. One holder, and
 * any other failure, answer as they did.
 */
describe('objectstack#34070 — a doc name two packages ship lists its candidate packages', () => {
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
  const candidateList = () => screen.findByRole('list', { name: 'Packages that provide this document' });

  beforeEach(() => {
    WORLD.conflict = true;
  });
  afterEach(() => {
    WORLD.conflict = false;
  });

  it('a 409 with two candidates lists both, each linking to its package address', async () => {
    render(<Portal entry="/docs/shared_guide" />);
    const list = await candidateList();
    expect(screen.getByRole('heading', { name: 'Choose a package' })).toBeInTheDocument();
    const links = within(list).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/apps/com.example.alpha/docs/shared_guide',
      '/apps/com.example.beta/docs/shared_guide',
    ]);
    // The package as the portal names it (its book), with its id beside it.
    expect(links.map((l) => l.textContent)).toEqual(['Alphacom.example.alpha', 'Betacom.example.beta']);
    expect(screen.queryByTestId('doc-content')).toBeNull();
    expect(screen.queryByText('Failed to load documentation')).toBeNull();
  });

  it('each candidate opens that package\'s doc, in that package\'s book', async () => {
    render(<Portal entry="/docs/shared_guide" />);
    fireEvent.click(within(await candidateList()).getByRole('link', { name: /com\.example\.alpha/ }));
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('ALPHA SHARED BODY');
    // Beta is listed first by the server; the package container decides the book.
    expect(screen.getByTestId('where').textContent).toBe('/apps/com.example.alpha/docs/com.example.alpha/shared_guide');
    cleanup();

    render(<Portal entry="/docs/shared_guide" />);
    fireEvent.click(within(await candidateList()).getByRole('link', { name: /com\.example\.beta/ }));
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('BETA SHARED BODY');
    expect(screen.getByTestId('where').textContent).toBe('/apps/com.example.beta/docs/com.example.beta/shared_guide');
  });

  it('CONTROL: a doc one package ships renders as today, with no candidate list', async () => {
    render(<Portal entry="/docs/alpha_welcome" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('ALPHA BODY');
    expect(screen.getByTestId('where').textContent).toBe('/docs/com.example.alpha/alpha_welcome');
    expect(screen.queryByRole('list', { name: 'Packages that provide this document' })).toBeNull();
  });

  it('CONTROL: a failure that is not the 409 keeps today\'s error state', async () => {
    render(<Portal entry="/docs/com.example.alpha/broken_doc" />);
    expect(await screen.findByText('Failed to load documentation')).toBeInTheDocument();
    expect(screen.getByText('The metadata service is unavailable')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Packages that provide this document' })).toBeNull();
  });

  /**
   * objectstack#34247 — the server's `?package=X` read answers X's own doc or
   * 404. The route's segment is ADR-0048 prefer-local context, not an exact
   * address: the doc the route's package ships none of is read by name.
   */
  describe('objectstack#34247 — a doc the route\'s package ships none of is read by name', () => {
    beforeEach(() => {
      WORLD.exact = true;
      WORLD.reads.length = 0;
    });
    afterEach(() => {
      WORLD.exact = false;
    });

    it('a cross-reference from one package\'s docs to another package\'s doc renders that doc', async () => {
      render(<Portal entry="/apps/com.example.alpha/docs/com.example.alpha/beta_start" />);
      expect(await screen.findByTestId('doc-content')).toHaveTextContent('BETA BODY');
      expect(WORLD.reads).toEqual(['com.example.alpha', undefined]);
    });

    it('an app-name segment that names no package renders the doc its one holder ships', async () => {
      render(<Portal entry="/apps/alpha_suite/docs/com.example.alpha/alpha_welcome" />);
      expect(await screen.findByTestId('doc-content')).toHaveTextContent('ALPHA BODY');
      expect(WORLD.reads).toEqual(['alpha_suite', undefined]);
    });

    it('a name two other packages ship lists both holders', async () => {
      render(<Portal entry="/apps/alpha_suite/docs/com.example.alpha/shared_guide" />);
      const links = within(await candidateList()).getAllByRole('link');
      expect(links.map((l) => l.getAttribute('href'))).toEqual([
        '/apps/com.example.alpha/docs/shared_guide',
        '/apps/com.example.beta/docs/shared_guide',
      ]);
    });

    it('CONTROL: the route\'s own package\'s doc is read at its package address only', async () => {
      render(<Portal entry="/apps/com.example.beta/docs/com.example.beta/shared_guide" />);
      expect(await screen.findByTestId('doc-content')).toHaveTextContent('BETA SHARED BODY');
      expect(WORLD.reads).toEqual(['com.example.beta']);
    });

    // The flat permalink (DocsSlug), which every cross-reference is rewritten
    // to (doc-links.ts), asks the server about a name the member's lists do
    // not answer (objectui#10188): the route's segment is no exact address
    // there either, so the doc's holder's audience verdict is what renders.
    const refusal = () => screen.findByRole('heading', { name: 'You do not have access to this documentation' });

    it('the flat permalink: a cross-reference to another package\'s gated doc renders its holder\'s refusal', async () => {
      render(<Portal entry="/apps/com.example.alpha/docs/gated_runbook" />);
      expect(await refusal()).toBeInTheDocument();
      expect(screen.getByText(GATED_REASON)).toBeInTheDocument();
      expect(screen.queryByText('Documentation not found')).toBeNull();
      expect(screen.getByTestId('where').textContent).toBe('/apps/com.example.alpha/docs/gated_runbook');
      expect(WORLD.reads).toEqual(['com.example.alpha', undefined]);
    });

    it('the flat permalink: an app-name segment that names no package renders the holder\'s refusal', async () => {
      render(<Portal entry="/apps/alpha_suite/docs/gated_runbook" />);
      expect(await refusal()).toBeInTheDocument();
      expect(screen.getByText(GATED_REASON)).toBeInTheDocument();
      expect(screen.queryByText('Documentation not found')).toBeNull();
      expect(WORLD.reads).toEqual(['alpha_suite', undefined]);
    });

    it('CONTROL: the flat permalink under the holder\'s own package reads its address only', async () => {
      render(<Portal entry="/apps/com.example.beta/docs/gated_runbook" />);
      expect(await refusal()).toBeInTheDocument();
      expect(WORLD.reads).toEqual(['com.example.beta']);
    });

    it('CONTROL: a name no package ships is still "not found"', async () => {
      render(<Portal entry="/apps/com.example.alpha/docs/com.example.alpha/nobody_doc" />);
      expect(await screen.findByText(/It may belong to a package that is not installed/)).toBeInTheDocument();
      expect(screen.queryByTestId('doc-content')).toBeNull();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// objectstack#35424 — the in-app reader: one docs column, a path above the
// article, and the previous / next article at its end
// ─────────────────────────────────────────────────────────────────────────────

describe('objectstack#35424 — the in-app reader has one docs column and a path to its book', () => {
  function Where() {
    return <div data-testid="where">{useLocation().pathname}</div>;
  }
  function InApp({ entry }: { entry: string }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <Where />
        <Routes>
          <Route path="/apps/:appName/docs" element={<DocsLayout />}>
            <Route index element={<AppDocsIndex />} />
            <Route path=":slug" element={<DocsSlug />} />
            <Route path=":slug/:name" element={<DocPage />} />
          </Route>
        </Routes>
      </MemoryRouter>
    );
  }
  /** The persistent column (the narrow-screen disclosure draws a second copy). */
  const column = () => screen.getAllByTestId('docs-nav')[0];

  it('draws no bar of its own: the app bar names 「APP / Documentation」', async () => {
    render(<InApp entry="/apps/crm/docs/crm/crm_intro" />);
    await screen.findByTestId('doc-content');
    expect(document.querySelector('header')).toBeNull();
  });

  it('the column leads back to the app and ends with all documentation', async () => {
    render(<InApp entry="/apps/crm/docs/crm/crm_intro" />);
    await screen.findByTestId('doc-content');
    expect(within(column()).getByTestId('docs-nav-back')).toHaveAttribute('href', '/apps/crm');
    // This harness's `t` returns the default text uninterpolated.
    expect(within(column()).getByTestId('docs-nav-back')).toHaveTextContent('Back to');
    expect(within(column()).getByTestId('docs-nav-all-docs')).toHaveAttribute('href', '/docs');
    // The reader carries the link once, in its column: no second one above the page.
    expect(screen.queryByTestId('docs-back-bar')).toBeNull();
  });

  // The app menu is off on every docs route, so every docs page keeps a way back.
  it('a book or doc that is not found still leads back to the app', async () => {
    render(<InApp entry="/apps/crm/docs/nonesuch" />);
    await screen.findByText(/not found/i);
    const bar = screen.getByTestId('docs-back-bar');
    expect(within(bar).getByTestId('docs-nav-back')).toHaveAttribute('href', '/apps/crm');
  });

  it('the path above the article names the book', async () => {
    render(<InApp entry="/apps/crm/docs/crm/crm_intro" />);
    await screen.findByTestId('doc-content');
    const path = screen.getByTestId('doc-breadcrumb');
    expect(within(path).getByRole('link', { name: 'Documentation' })).toHaveAttribute('href', '/apps/crm/docs');
    expect(within(path).getByRole('link', { name: 'Crm' })).toHaveAttribute('href', '/apps/crm/docs/crm');
  });

  it('the first article says so on its previous side and links its next one', async () => {
    render(<InApp entry="/apps/crm/docs/crm/crm_intro" />);
    await screen.findByTestId('doc-content');
    expect(screen.getByTestId('doc-pager-first')).toHaveTextContent('This is the first article in this book');
    expect(screen.getByTestId('doc-pager-next')).toHaveAttribute('href', '/apps/crm/docs/crm/crm_guide_lead');
    expect(screen.getByTestId('doc-pager-next')).toHaveTextContent('Leads');
  });

  it('the last article links its previous one and says it is the last', async () => {
    render(<InApp entry="/apps/crm/docs/crm/crm_guide_lead" />);
    await screen.findByTestId('doc-content');
    expect(screen.getByTestId('doc-pager-previous')).toHaveAttribute('href', '/apps/crm/docs/crm/crm_intro');
    expect(screen.getByTestId('doc-pager-last')).toHaveTextContent('This is the last article in this book');
  });

  it('the search field narrows the column to matching titles, and says when none match', async () => {
    render(<InApp entry="/apps/crm/docs/crm/crm_intro" />);
    await screen.findByTestId('doc-content');
    const search = within(column()).getByTestId('docs-nav-search');
    fireEvent.change(search, { target: { value: 'lead' } });
    expect(within(column()).getByRole('link', { name: 'Leads' })).toBeInTheDocument();
    expect(within(column()).queryByRole('link', { name: 'CRM Intro' })).toBeNull();
    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(within(column()).getByTestId('docs-nav-no-match')).toBeInTheDocument();
  });

  describe('a package with several books', () => {
    beforeEach(() => {
      WORLD.authored = true;
    });
    afterEach(() => {
      WORLD.authored = false;
    });

    it('lists every book of the package, the current one open and the others folded', async () => {
      render(<InApp entry="/apps/com.example.showcase/docs/manual/showcase_index" />);
      await screen.findByTestId('doc-content');
      const current = within(column()).getByRole('button', { name: /Showcase Manual/ });
      const other = within(column()).getByRole('button', { name: /Leads Book/ });
      expect(current).toHaveAttribute('aria-expanded', 'true');
      expect(other).toHaveAttribute('aria-expanded', 'false');
      // No book of another package is listed.
      expect(within(column()).queryByRole('button', { name: /Alpha Manual/ })).toBeNull();
      fireEvent.click(other);
      expect(other).toHaveAttribute('aria-expanded', 'true');
      const lead = within(column())
        .getAllByRole('link', { name: 'Lead Guide' })
        .map((l) => l.getAttribute('href'));
      expect(lead).toContain('/apps/com.example.showcase/docs/leads/showcase_lead_guide');
    });

    it('the app\'s docs index (the path\'s 「Documentation」 link) leads back to the app', async () => {
      render(<InApp entry="/apps/com.example.showcase/docs" />);
      await screen.findByText('Leads Book');
      expect(screen.getByTestId('where')).toHaveTextContent('/apps/com.example.showcase/docs');
      const bar = screen.getByTestId('docs-back-bar');
      expect(within(bar).getByTestId('docs-nav-back')).toHaveAttribute('href', '/apps/com.example.showcase');
    });
  });
});

describe('objectstack#35424 — 「All documentation」 groups its books by app and searches every article', () => {
  function Where() {
    const loc = useLocation();
    return <div data-testid="where">{`${loc.pathname}${loc.search}`}</div>;
  }
  function Portal({ entry }: { entry: string }) {
    return (
      <MemoryRouter initialEntries={[entry]}>
        <Where />
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
  const SETUP_APP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup', navigation: [] };
  /** The cards of the group headed `label`, by their titles. */
  const groupCards = (label: string) => {
    const heading = screen.getByRole('heading', { level: 2, name: label });
    const section = heading.closest('section')!;
    return within(section).getAllByRole('link').map((l) => l.firstElementChild?.textContent);
  };

  beforeEach(() => {
    WORLD.authored = true;
    WORLD.contentReads = 0;
    WORLD.apps = [
      { name: 'showcase_app', label: 'Showcase', _packageId: 'com.example.showcase', navigation: [] },
      // Beta's handbook is linked from Alpha's navigation, in a group.
      {
        name: 'alpha_app',
        label: 'Alpha',
        _packageId: 'com.example.alpha',
        navigation: [{ id: 'help', type: 'group', children: [{ id: 'nav_beta', type: 'doc', book: 'handbook' }] }],
      },
    ];
  });
  afterEach(() => {
    WORLD.authored = false;
    WORLD.platform = false;
    WORLD.apps = [];
  });

  it('a book goes under the app whose navigation links it, else its package\'s app; the rest under 「Other documentation」', async () => {
    render(<Portal entry="/docs" />);
    await screen.findByRole('heading', { level: 2, name: 'Showcase' });
    expect(groupCards('Showcase')).toEqual(['Showcase Manual', 'Leads Book']);
    expect(groupCards('Alpha')).toEqual(['Alpha Manual', 'Beta Handbook']);
    expect(groupCards('Other documentation')).toEqual(['Acme Manual', 'Ops']);
    // The groups follow the apps' order, the ungrouped last.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Showcase',
      'Alpha',
      'Other documentation',
    ]);
    // The page names no package id, and counts in words.
    expect(screen.queryByText(/com\.example/)).toBeNull();
    expect(screen.getAllByText('1 article').length).toBeGreaterThan(0);
  });

  it('a platform package\'s book is listed under its app, and not listed where the caller\'s app list has no such app', async () => {
    WORLD.platform = true;
    render(<Portal entry="/docs" />);
    await screen.findByRole('heading', { level: 2, name: 'Showcase' });
    expect(screen.queryByText('Setup')).toBeNull();
    cleanup();

    // An administrator's app list carries the Setup app: its docs are listed
    // under it, named by the app, after the business apps.
    WORLD.apps = [...WORLD.apps, SETUP_APP];
    render(<Portal entry="/docs" />);
    await screen.findByRole('heading', { level: 2, name: 'Setup' });
    expect(groupCards('Setup')).toEqual(['Setup']);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Showcase',
      'Alpha',
      'Setup',
      'Other documentation',
    ]);
    expect(screen.queryByText('com.objectstack.setup')).toBeNull();
  });

  it('「Search all documentation」 finds an article by a word of its body, asks for the bodies once, and keeps the query in the URL', async () => {
    render(<Portal entry="/docs" />);
    await screen.findByRole('heading', { level: 2, name: 'Showcase' });
    expect(WORLD.contentReads).toBe(0); // nothing asked before a search
    const search = screen.getByRole('searchbox', { name: 'Search all documentation' });
    fireEvent.change(search, { target: { value: 'alpha body' } });
    const results = await screen.findByTestId('docs-search-results');
    const hit = within(results).getByRole('link', { name: /Alpha Welcome/ });
    expect(hit).toHaveAttribute('href', '/docs/handbook/alpha_welcome');
    expect(within(hit).getByText('Alpha Manual')).toBeInTheDocument();
    // The words are marked in the snippet.
    expect(within(hit).getAllByText(/alpha|body/i, { selector: 'mark' }).length).toBeGreaterThan(0);
    expect(screen.getByTestId('where')).toHaveTextContent('/docs?q=alpha+body');
    // The groups give way to the results while searching.
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(await screen.findByText('No articles match.')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });
    await screen.findByRole('heading', { level: 2, name: 'Showcase' });
    fireEvent.change(search, { target: { value: 'lead' } });
    await screen.findByTestId('docs-search-results');
    expect(WORLD.contentReads).toBe(1);
  });

  it('the search offers no article the page does not list (a platform doc with no app in the caller\'s list)', async () => {
    WORLD.platform = true;
    render(<Portal entry="/docs?q=permission" />);
    expect(await screen.findByText('No articles match.')).toBeInTheDocument();
    cleanup();
    WORLD.apps = [...WORLD.apps, SETUP_APP];
    render(<Portal entry="/docs?q=permission" />);
    const results = await screen.findByTestId('docs-search-results');
    expect(within(results).getByRole('link', { name: /Setup overview/ })).toHaveAttribute(
      'href',
      '/docs/com.objectstack.setup/setup_overview',
    );
  });

  it('the label is not the docs column\'s 「Search docs」', async () => {
    render(<Portal entry="/docs" />);
    await screen.findByRole('heading', { level: 2, name: 'Showcase' });
    expect(screen.queryByRole('searchbox', { name: 'Search docs' })).toBeNull();
  });

  it('a hand-typed reader URL whose book does not hold the doc reads in the doc\'s own book', async () => {
    render(<Portal entry="/docs/manual/alpha_welcome" />);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/docs/handbook/alpha_welcome'));
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('ALPHA BODY');
    // The pager is the doc's own book's: one article, so both ends say so.
    expect(screen.getByTestId('doc-pager-first')).toBeInTheDocument();
    expect(screen.getByTestId('doc-pager-last')).toBeInTheDocument();
  });

  it('CONTROL: a reader URL whose book holds the doc stays where it is', async () => {
    render(<Portal entry="/docs/manual/showcase_index" />);
    expect(await screen.findByTestId('doc-content')).toHaveTextContent('INDEX BODY');
    expect(screen.getByTestId('where')).toHaveTextContent('/docs/manual/showcase_index');
  });
});
