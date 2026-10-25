// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12233 — a lookup on a custom page carries the router's basename,
 * as the record page's lookups do.
 *
 * `PageView` publishes the console's record navigator to the blocks on the
 * page (`pageRecordActionsValue`, objectui#11293), and a lookup there renders
 * a real anchor from its `recordHref`. That builder returned the bare route
 * `/apps/APP/OBJECT/record/ID`, so on a console mounted at `/_console` a new
 * tab, a middle-click or a copied link left the console, while a left click
 * (routed by `openRecord`) worked.
 *
 * The page, the router and the lookup are real: `PageView` under a
 * `MemoryRouter`, and the real `LookupCellRenderer` reading the context the
 * page publishes. `SchemaRenderer` is replaced by that one lookup, the stand-in
 * the objectui#11293 pin beside this file uses for "a block on the page". The
 * oracle for the href is react-router's own `Link` for the same route. The
 * control mounts the same tree with no basename and keeps the bare href.
 */

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import '@testing-library/jest-dom';
import { LookupCellRenderer } from '@object-ui/fields';

const PAGE_NAME = 'the_page';
const APP = 'crm';
const ACCOUNT = { id: 'A-1', name: 'Acme Corp' };
const ACCOUNT_ROUTE = `/apps/${APP}/account/record/${ACCOUNT.id}`;

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({
    user: { id: 'u1', name: 'User', role: 'user', image: null },
    activeOrganization: null,
  }),
  useWorkspaceAdminStatus: () => ({ isAdmin: false, isResolved: true }),
  createAuthenticatedFetch: () => vi.fn(),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (k: string, o?: { defaultValue?: string; name?: string }) => o?.defaultValue ?? o?.name ?? k,
  }),
}));

vi.mock('../../providers/MetadataProvider', () => ({
  useMetadata: () => ({
    pages: [{ name: 'the_page', label: 'A Page', type: 'app' }],
    objects: [{ name: 'account' }],
  }),
}));

vi.mock('../MetadataInspector', () => ({
  MetadataPanel: () => null,
  useMetadataInspector: () => ({ showDebug: false }),
}));

vi.mock('@object-ui/react', async (orig) => {
  const actual = await orig<typeof import('@object-ui/react')>();
  return {
    ...actual,
    useAdapter: () => ({}),
    // "A block on the page": one real lookup, reading the context PageView
    // publishes.
    SchemaRenderer: () => (
      <LookupCellRenderer
        value={{ id: 'A-1', name: 'Acme Corp' }}
        field={{ type: 'lookup', reference: 'account' } as never}
      />
    ),
  };
});

import { PageView } from '../PageView';

afterEach(() => {
  cleanup();
});

/** The router's own location, basename stripped: where a left click took us. */
function RouterLocation() {
  const location = useLocation();
  return <output data-testid="router-location">{`${location.pathname}${location.search}`}</output>;
}

function mount(basename?: string) {
  const root = basename ?? '';
  return render(
    <MemoryRouter basename={basename} initialEntries={[`${root}/apps/${APP}/page/${PAGE_NAME}`]}>
      <Routes>
        <Route path="/apps/:appName/page/:pageName" element={<PageView />} />
        <Route path="*" element={null} />
      </Routes>
      <Link to={ACCOUNT_ROUTE} data-testid="oracle">
        oracle
      </Link>
      <RouterLocation />
    </MemoryRouter>,
  );
}

const accountAnchor = async () => (await screen.findByText(ACCOUNT.name)).closest('a');

describe('a lookup on a custom page carries the router basename (objectui#12233)', () => {
  it('under basename /_console: the href is the one react-router renders for the route, and a left click routes there once', async () => {
    mount('/_console');
    const anchor = await accountAnchor();
    const href = anchor?.getAttribute('href') ?? null;
    expect(href).toBe(`/_console${ACCOUNT_ROUTE}`);
    expect(href).toBe(screen.getByTestId('oracle').getAttribute('href'));
    fireEvent.click(anchor as Element, { button: 0 });
    expect(screen.getByTestId('router-location').textContent).toBe(ACCOUNT_ROUTE);
  });

  it('control, no basename: the href is the bare route, as before', async () => {
    mount();
    const anchor = await accountAnchor();
    expect(anchor?.getAttribute('href')).toBe(ACCOUNT_ROUTE);
    expect(anchor?.getAttribute('href')).toBe(screen.getByTestId('oracle').getAttribute('href'));
    fireEvent.click(anchor as Element, { button: 0 });
    expect(screen.getByTestId('router-location').textContent).toBe(ACCOUNT_ROUTE);
  });
});
