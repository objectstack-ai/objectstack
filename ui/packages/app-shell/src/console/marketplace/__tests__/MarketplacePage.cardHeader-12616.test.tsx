// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A marketplace card gives its title the header row (objectui#12616).
 *
 * ## The defect
 *
 * The card header was one row: icon, a text column, then the publisher badge
 * with `shrink-0`. The badge took its width first and the title and id got the
 * remainder, each cut to one line at its end (`truncate`). The card grid was
 * `sm:grid-cols-2 lg:grid-cols-3`, three zero-minimum tracks from a 1024px
 * viewport up, whatever width the Setup sidebar left the page. The issue
 * measured the HotCRM card at 1024px reading "H…" over "ap…".
 *
 * ## What the cases pin
 *
 * - The title holds the whole display name in its DOM text and is clamped to
 *   two lines (`line-clamp-2`), never cut to one (`truncate`).
 * - The badge sits in the text column on its own line under the title, not in
 *   the header row beside it, so it cannot take the title's width.
 * - The id is two runs in one flex line: the head, which shrinks and takes the
 *   ellipsis, and the package suffix, which does not. The element's text and
 *   its `title` are the whole id; nothing is shortened in the DOM.
 * - Every card grid is a 240px-minimum auto-fill track, not a viewport
 *   breakpoint.
 *
 * Both cards that draw this header are pinned: the catalog card and the
 * "Your organization" card. happy-dom does no layout, so a rendered width
 * cannot be read here: these cases pin the structure and the classes that
 * produce the layout. The widths themselves are a browser reading, taken
 * outside this suite.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('react-router-dom', () => {
  const navigate = () => {};
  const params = {};
  return { useNavigate: () => navigate, useParams: () => params };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;

const GRID_TRACK = 'grid-cols-[repeat(auto-fill,minmax(240px,1fr))]';

/** HotCRM as its manifest names it: the card the defect was walked on. */
const HOTCRM = {
  id: 'pkg_hotcrm',
  manifest_id: 'app.objectstack.hotcrm',
  display_name: 'HotCRM',
  publisher: 'objectstack',
  category: 'crm',
  latest_version: { id: 'ver_hotcrm', version: '1.0.0' },
};

/** An organization package with a long name, drawn by the "Your organization" card. */
const ORG = {
  id: 'org_northwind',
  manifest_id: 'com.northwind.customer-relationship-suite',
  display_name: 'Northwind Customer Relationship Management Suite for Field Sales',
  visibility: 'org',
  latest_version: '2.0.0',
};

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Boot the SPA against a runtime with a marketplace, a one-row catalog and a one-row org catalog. */
async function boot() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal: true, marketplace: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/packages' && method === 'GET') {
        return answer(200, { success: true, data: { items: [HOTCRM], total: 1, limit: 100, offset: 0 } });
      }
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: [], total: 0 } });
      }
      if (path === '/api/v1/cloud-connection/org-packages' && method === 'GET') {
        return answer(200, { success: true, data: { connected: true, items: [ORG] } });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
}

function renderPage() {
  return render(
    <I18nProvider config={EN} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe.each([
  ['catalog card', 'marketplace-card-app.objectstack.hotcrm', HOTCRM.display_name, 'objectstack', HOTCRM.manifest_id, 'app.objectstack.', 'hotcrm'],
  ['org card', 'org-card-com.northwind.customer-relationship-suite', ORG.display_name, 'org', ORG.manifest_id, 'com.northwind.', 'customer-relationship-suite'],
])('Marketplace %s header (objectui#12616)', (_kind, testId, title, badgeText, manifestId, head, suffix) => {
  it('the title holds the whole name, clamped to two lines rather than cut to one', async () => {
    await boot();
    renderPage();

    const card = await screen.findByTestId(testId);
    const titleEl = within(card).getByText(title);
    expect(titleEl.textContent).toBe(title);
    expect(titleEl).toHaveClass('line-clamp-2', 'text-[13px]');
    expect(titleEl).not.toHaveClass('truncate');
  });

  it('the badge sits on its own line under the title, not in the header row beside it', async () => {
    await boot();
    renderPage();

    const card = await screen.findByTestId(testId);
    const titleEl = within(card).getByText(title);
    const badge = within(card).getByText(badgeText);
    const column = titleEl.parentElement as HTMLElement;
    const row = column.parentElement as HTMLElement;

    expect(column).toHaveClass('flex-col');
    expect(badge.parentElement).toBe(column);
    expect(badge.previousElementSibling).toBe(titleEl);
    // The header row holds the icon and the text column, and nothing else.
    expect(row).toHaveClass('flex-row');
    expect(row.children).toHaveLength(2);
    expect(row.lastElementChild).toBe(column);
  });

  it('the id is a shrinking head and a package suffix that does not shrink, and the whole id is its text and title', async () => {
    await boot();
    renderPage();

    const card = await screen.findByTestId(testId);
    const code = card.querySelector('code') as HTMLElement;
    expect(code.textContent).toBe(manifestId);
    expect(code).toHaveAttribute('title', manifestId);
    expect(code).toHaveClass('flex', 'font-mono');
    expect(code.parentElement).toHaveClass('text-[11px]');

    const runs = Array.from(code.children) as HTMLElement[];
    expect(runs.map((run) => run.textContent)).toEqual([head, suffix]);
    // The head is the run that gives way: it may shrink to nothing and draws
    // the ellipsis where it is cut, which is in the middle of the id.
    expect(runs[0]).toHaveClass('min-w-0', 'truncate');
    expect(runs[0]).not.toHaveClass('shrink-0');
    // The package suffix keeps its width, capped so a suffix longer than the
    // column still leaves the head 4ch.
    expect(runs[1]).toHaveClass('shrink-0', 'truncate', 'max-w-[calc(100%_-_4ch)]');
  });

  it('the card sits in a 240px-minimum auto-fill grid, not a viewport breakpoint grid', async () => {
    await boot();
    renderPage();

    const card = await screen.findByTestId(testId);
    const grid = card.parentElement as HTMLElement;
    expect(grid).toHaveClass('grid', GRID_TRACK);
    expect(grid.className).not.toMatch(/\blg:grid-cols-/);
  });
});
