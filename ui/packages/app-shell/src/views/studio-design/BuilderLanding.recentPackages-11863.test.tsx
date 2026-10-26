// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11863 (Q3) — the Studio landing lists the packages the author was
 * last in, above its package cards.
 *
 * A recent `package` entry stores the package's identity and no label
 * (objectui#11678's shape); the landing labels it from the package list it
 * loads, on every render. So these cases pin what that buys and what it must
 * not regress into:
 *
 *  - the label is the package's CURRENT name: a rename between the visit and
 *    the render shows the new one, and no entry is drawn as its raw id while a
 *    live package is behind it;
 *  - a package the list no longer has draws its machine name, as a missing
 *    object, page or report does (`useRecentItemLabel`);
 *  - nothing is listed before the list answers, or when there are no recent
 *    packages, and the existing cards stay.
 *
 * The store is the REAL `RecentItemsProvider`, seeded through the localStorage
 * copy it hydrates from (no signed-in user here, so the key is unscoped).
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const packages = vi.hoisted(() => ({
  list: [] as Array<Record<string, unknown>>,
  /** When set, `fetchPackages` waits for it, so the loading window can be observed. */
  gate: null as Promise<void> | null,
}));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return {
    ...mod,
    fetchPackages: vi.fn(async () => {
      if (packages.gate) await packages.gate;
      return packages.list;
    }),
  };
});

// The create dialog is closed throughout; its form stack is not under test.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';
import { RecentItemsProvider } from '../../context/RecentItemsProvider';

/** The key `RecentItemsProvider` hydrates from with no signed-in user. */
const STORAGE_KEY = 'objectui-recent-items';

const at = '2026-10-08T09:00:00.000Z';
const visit = (id: string) => ({
  id: `package:${id}`,
  type: 'package',
  name: id,
  href: `/studio/${encodeURIComponent(id)}`,
  visitedAt: at,
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  packages.list = [];
  packages.gate = null;
});

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location">{pathname}</div>;
}

function renderLanding(stored: unknown[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  return render(
    <RecentItemsProvider>
      <MemoryRouter initialEntries={['/studio']}>
        <LocationProbe />
        <Routes>
          <Route path="/studio" element={<BuilderLanding />} />
          <Route path="/studio/:packageId" element={<div data-testid="package-route" />} />
          <Route path="/studio/:packageId/:tab" element={<div data-testid="pillar-builder" />} />
        </Routes>
      </MemoryRouter>
    </RecentItemsProvider>,
  );
}

const recentSection = () => screen.getByTestId('studio-landing-recent');
const recentLinks = () => within(recentSection()).getAllByRole('link');

describe('Studio landing → recent packages (objectui#11863)', () => {
  it('lists the most recent packages first, each by its current name, each opening its /studio/PKG route', async () => {
    packages.list = [
      { id: 'com.acme.crm', name: 'Acme CRM', writable: true, namespace: 'acme' },
      { id: 'com.acme.hr', name: 'Acme HR', writable: true, namespace: 'acmehr' },
      { id: 'com.example.showcase', name: 'Showcase', writable: false, namespace: 'showcase' },
    ];
    renderLanding([visit('com.example.showcase'), visit('com.acme.crm')]);

    await screen.findByText('Recently viewed');
    const links = recentLinks();
    expect(links.map((a) => a.querySelector('.font-medium')?.textContent)).toEqual(['Showcase', 'Acme CRM']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/studio/com.example.showcase', '/studio/com.acme.crm']);

    fireEvent.click(links[1]);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/studio/com.acme.crm'));
    expect(screen.getByTestId('package-route')).toBeInTheDocument();
  });

  it('a package renamed since the visit shows its new name: the label is read on the render, never stored', async () => {
    // The visit happened while the package was called something else; the
    // stored entry carries no text from that moment to go stale.
    packages.list = [{ id: 'com.acme.crm', name: 'Acme Sales', writable: true, namespace: 'acme' }];
    renderLanding([visit('com.acme.crm')]);

    await screen.findByText('Recently viewed');
    const [link] = recentLinks();
    expect(within(link).getByText('Acme Sales')).toBeInTheDocument();
    expect(within(link).queryByText('Acme CRM')).not.toBeInTheDocument();
  });

  it('a package the list no longer has draws its machine name, as a missing object does', async () => {
    packages.list = [{ id: 'com.acme.crm', name: 'Acme CRM', writable: true, namespace: 'acme' }];
    renderLanding([visit('com.acme.gone'), visit('com.acme.crm')]);

    await screen.findByText('Recently viewed');
    expect(recentLinks().map((a) => a.querySelector('.font-medium')?.textContent)).toEqual([
      'com.acme.gone',
      'Acme CRM',
    ]);
  });

  it('lists only package entries, and at most one row of three', async () => {
    packages.list = ['a', 'b', 'c', 'd'].map((x) => ({
      id: `com.acme.${x}`,
      name: `Pkg ${x.toUpperCase()}`,
      writable: true,
      namespace: `acme${x}`,
    }));
    renderLanding([
      visit('com.acme.a'),
      { id: 'object:showcase_task', type: 'object', name: 'showcase_task', href: '/apps/showcase/showcase_task', visitedAt: at },
      visit('com.acme.b'),
      visit('com.acme.c'),
      visit('com.acme.d'),
    ]);

    await screen.findByText('Recently viewed');
    expect(recentLinks().map((a) => a.querySelector('.font-medium')?.textContent)).toEqual([
      'Pkg A',
      'Pkg B',
      'Pkg C',
    ]);
  });

  it('nothing is listed while the package list loads, so no entry is drawn as its id', async () => {
    let release!: () => void;
    packages.gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    packages.list = [{ id: 'com.acme.crm', name: 'Acme CRM', writable: true, namespace: 'acme' }];
    renderLanding([visit('com.acme.crm')]);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByTestId('studio-landing-recent')).not.toBeInTheDocument();
    expect(screen.queryByText('com.acme.crm')).not.toBeInTheDocument();

    release();
    await screen.findByText('Recently viewed');
    expect(within(recentSection()).getByText('Acme CRM')).toBeInTheDocument();
  });

  it('with no recent package there is no section, and the package cards are unchanged', async () => {
    packages.list = [{ id: 'com.acme.crm', name: 'Acme CRM', writable: true, namespace: 'acme' }];
    renderLanding([
      { id: 'object:showcase_task', type: 'object', name: 'showcase_task', href: '/apps/showcase/showcase_task', visitedAt: at },
    ]);

    await screen.findByText('Acme CRM');
    expect(screen.queryByTestId('studio-landing-recent')).not.toBeInTheDocument();
    expect(screen.queryByText('Recently viewed')).not.toBeInTheDocument();
    expect(screen.getByText('My packages (writable)')).toBeInTheDocument();
    expect(screen.getByTestId('studio-landing-org-scope')).toBeInTheDocument();
  });

  it('the package cards stay beside the recent row', async () => {
    packages.list = [{ id: 'com.acme.crm', name: 'Acme CRM', writable: true, namespace: 'acme' }];
    renderLanding([visit('com.acme.crm')]);

    await screen.findByText('Recently viewed');
    // Once in the recent row, once as its writable card.
    expect(screen.getAllByText('Acme CRM')).toHaveLength(2);
    expect(screen.getByText('My packages (writable)')).toBeInTheDocument();
  });
});
