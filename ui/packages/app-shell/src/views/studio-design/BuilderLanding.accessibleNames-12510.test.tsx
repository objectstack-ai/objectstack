// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12510 — every card on the Studio home is named by the label the
 * author sees on it (objectui#11862: label first).
 *
 * The 2026-10-15 test pass read the recent-package links, the writable and
 * installed package cards, and the "Organization flows" card as controls with
 * no name. The browser's computed tree names each one from its visible text;
 * these cases pin that by querying each card by role and name, so a later
 * restyle that hides the text from the tree (an `aria-hidden` on the label, an
 * icon-only card) turns them red.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const packages = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => packages.list) };
});

// The create dialog is closed throughout; its own names are pinned beside it.
vi.mock('../metadata-admin/PackageFormDialog', () => ({ PackageFormDialog: () => null }));

import { BuilderLanding } from './BuilderLanding';
import { RecentItemsProvider } from '../../context/RecentItemsProvider';

/** The key `RecentItemsProvider` hydrates from with no signed-in user. */
const STORAGE_KEY = 'objectui-recent-items';

afterEach(() => {
  cleanup();
  localStorage.clear();
  packages.list = [];
});

function renderLanding() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([
      {
        id: 'package:app.objectstack.hotcrm',
        type: 'package',
        name: 'app.objectstack.hotcrm',
        href: '/studio/app.objectstack.hotcrm',
        visitedAt: '2026-10-15T09:00:00.000Z',
      },
    ]),
  );
  return render(
    <RecentItemsProvider>
      <MemoryRouter initialEntries={['/studio']}>
        <Routes>
          <Route path="/studio" element={<BuilderLanding />} />
        </Routes>
      </MemoryRouter>
    </RecentItemsProvider>,
  );
}

describe('Studio home cards carry their visible label as their name (objectui#12510)', () => {
  it('names the recent link, the package cards and the organization card by their labels', async () => {
    packages.list = [
      { id: 'com.acme.crm', name: 'Acme CRM', writable: true, namespace: 'acme' },
      { id: 'app.objectstack.hotcrm', name: 'HotCRM', writable: false, namespace: 'crm' },
    ];
    renderLanding();

    const recent = await screen.findByTestId('studio-landing-recent');
    expect(within(recent).getByRole('link', { name: /HotCRM/ })).toHaveAttribute('href', '/studio/app.objectstack.hotcrm');

    // The writable card: its label leads the name; the api name follows it.
    expect(screen.getByRole('button', { name: /^Acme CRM\b/ })).toBeInTheDocument();
    // The installed (read-only) card.
    expect(screen.getByRole('button', { name: /^HotCRM\b.*Read-only/ })).toBeInTheDocument();
    // The organization's flows.
    expect(screen.getByTestId('studio-landing-org-scope')).toHaveAccessibleName(/^Organization flows/);
    expect(screen.getByRole('button', { name: /^New package/ })).toBeInTheDocument();

    // No button or link on the page is left without a name.
    const unnamed = [...screen.getAllByRole('button'), ...screen.getAllByRole('link')].filter(
      (el) => !el.textContent?.trim() && !el.getAttribute('aria-label') && !el.getAttribute('aria-labelledby'),
    );
    expect(unnamed.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
  });
});
