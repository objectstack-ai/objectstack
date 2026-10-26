// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Embedded mode (Studio Access pillar) — the matrix editor is hosted at
 * `/studio/:packageId/access`, where the metadata-admin routes don't exist:
 *
 *   • History must open as an in-place sheet, NOT navigate — the relative
 *     `./history` target resolves to `/studio/:packageId/access/history`,
 *     which falls through to the app's catch-all and dumps the user on Home.
 *   • The PageShell breadcrumb must not link to `/metadata` (same dead end,
 *     and it would yank the user out of Studio even where the route exists).
 *
 * Standalone metadata-admin behavior (routed history page, linked crumbs)
 * must stay intact.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

function makeClient() {
  return {
    layered: async () => ({
      effective: { name: 'sales_perms', label: 'Sales', objects: {}, fields: {} },
      code: null,
      overlay: null,
      overlayScope: null,
    }),
    getDraft: async () => null,
    list: async (type: string) => (type === 'object' ? [{ item: { name: 'a_account' } }] : []),
    get: async (type: string) => (type === 'object' ? { fields: [] } : null),
    save: async (_t: string, _n: string, payload: Record<string, unknown>) => payload,
    history: async () => ({ events: [] }),
  } as any;
}

let clientImpl: any;

vi.mock('./useMetadata', () => ({
  useMetadataClient: () => clientImpl,
  useMetadataTypes: () => ({
    loading: false,
    error: null,
    entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
  }),
}));

// AssignedUsersSection makes its own adapter calls — irrelevant here.
vi.mock('./AssignedUsersSection', () => ({ AssignedUsersSection: () => null }));

import { PermissionMatrixEditPage } from './PermissionMatrixEditor';

afterEach(cleanup);

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="location-probe">{pathname}</div>;
}

async function renderMatrix(embedded: boolean) {
  clientImpl = makeClient();
  render(
    <MemoryRouter initialEntries={['/current']}>
      <LocationProbe />
      <PermissionMatrixEditPage
        type="permission"
        name="sales_perms"
        packageId="app.a"
        embedded={embedded}
      />
    </MemoryRouter>,
  );
  // Identity strip is collapsed by default (objectui#2600 B1) — the label is
  // summary text, not an input, until the strip is expanded.
  await screen.findByText('Sales');
}

describe('PermissionMatrixEditPage — embedded mode (Studio Access pillar)', () => {
  it('embedded: History opens an in-place sheet without navigating', async () => {
    await renderMatrix(true);

    fireEvent.click(screen.getByRole('button', { name: /History/ }));

    // The sheet mounts the shared HistoryPanel (empty-state fixture).
    expect(await screen.findByText('No history yet')).toBeInTheDocument();
    // …and the router did not move (no `./history` dead end).
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/current');
  });

  it('embedded: breadcrumb renders without /metadata links', async () => {
    await renderMatrix(true);

    expect(screen.queryByText('All Metadata Types')).not.toBeInTheDocument();
    expect(document.querySelector('a[href^="/metadata"]')).toBeNull();
    // The type label is still shown as plain-text context.
    expect(screen.getByText('Permission Set')).toBeInTheDocument();
  });

  it('standalone: History still navigates to the routed history page', async () => {
    await renderMatrix(false);

    fireEvent.click(screen.getByRole('button', { name: /History/ }));

    expect(screen.getByTestId('location-probe')).toHaveTextContent('/history');
    expect(screen.queryByText('No history yet')).not.toBeInTheDocument();
  });

  it('standalone: breadcrumb keeps its /metadata links', async () => {
    await renderMatrix(false);

    expect(screen.getByText('All Metadata Types')).toBeInTheDocument();
    expect(document.querySelector('a[href^="/metadata"]')).not.toBeNull();
  });
});
