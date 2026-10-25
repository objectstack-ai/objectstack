// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11862 — the Studio Interfaces rail shows a nav entry's label as the
 * primary text and its target's machine name as secondary text, and never
 * names an entry by the `nav_item_N` id the editor minted for it.
 *
 * On the maintainer's word 「所有地方以标签为主，机器名只作为次要信息」:
 *
 *  - a label-less object entry shows its object's label, with the object's
 *    machine name as the secondary information on the row's tooltip;
 *  - an authored label shows verbatim, with the target's machine name on the
 *    tooltip;
 *  - an entry that names no target yet ("Add nav item" left unbound) reads as
 *    the editor's untitled wording, "Item N" by its place, never its id;
 *  - CONTROL: a target with no label in hand shows its machine name alone,
 *    once;
 *  - the secondary name is not part of the row's accessible name, which stays
 *    the label and the kind it was.
 *
 * objectui#12455 (epic objectui#12446, decision 5) moved the machine name from
 * a second line under the label to the row's tooltip: the rail is the app's
 * navigation as the shipped sidebar draws it, one 32 px row per entry, and the
 * card keeps "the id and the bound target in the row's title". The tooltip is
 * still secondary information beside a primary label, which is what the
 * ruling asks; the assertions below read it there.
 *
 * The inspector beside the rail offers the same untitled wording as its Label
 * placeholder for an unbound entry.
 */
import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

const NAV = [
  // An authored label. The pillar opens this first leaf on load.
  { id: 'nav_dash', type: 'dashboard', label: 'Ops board', dashboardName: 'ops_board' },
  // What the platform writes since objectui#9868: no `label`.
  { id: 'nav_obj', type: 'object', objectName: 'b2r4_customer' },
  // "Add nav item" left unbound, kept in its place by the editor. Its id's
  // number (7) differs from its place (3), so the wording is not read off the id.
  { id: 'nav_item_7', type: 'object' },
  // A target the host's metadata does not label (a draft-only object).
  { id: 'nav_ticket', type: 'object', objectName: 'repairs_ticket' },
];

const mockClient = {
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async () => []),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: { name: 'acme_app', label: 'Acme', navigation: NAV } };
    if (type === 'dashboard') return { effective: { name, label: 'Ops board', widgets: [] } };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  save: vi.fn(async () => ({})),
  get: vi.fn(async () => undefined),
};

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ entries: [] }),
  };
});

vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: vi.fn(async () => []) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

import { InterfacesPillar, StudioNavItemInspector } from './StudioDesignSurface';

afterEach(cleanup);

/** The host's metadata cache: `b2r4_customer` carries a label, `repairs_ticket` is not in it. */
const METADATA = {
  apps: [],
  objects: [{ name: 'b2r4_customer', label: 'Customers' }],
  dashboards: [{ name: 'ops_board', label: 'Ops board' }],
  reports: [],
  pages: [],
  loading: false,
  error: null,
  refresh: async () => {},
  invalidate: () => {},
  ensureType: async () => [],
  getItem: async () => null,
  getItemsByType: () => [],
  getTypeStatus: () => 'ready' as const,
};

function renderPillar() {
  return render(
    <MetadataCtx.Provider value={METADATA as never}>
      <MemoryRouter initialEntries={['/studio/com.acme.app/interfaces']}>
        <InterfacesPillar packageId="com.acme.app" />
      </MemoryRouter>
    </MetadataCtx.Provider>,
  );
}

describe('objectui#11862 — the Interfaces rail: label first, machine name second', () => {
  it("a label-less object entry shows its object's label, its machine name as secondary text", async () => {
    renderPillar();
    // The accessible name is the label and the kind, as before: the machine
    // name is its description, on the tooltip, never the visible text.
    const row = await screen.findByRole('button', { name: 'Customers Object' });
    expect(within(row).getByText('Customers')).toBeInTheDocument();
    expect(row).toHaveAttribute('title', 'object · b2r4_customer');
    expect(row).toHaveAccessibleDescription('object · b2r4_customer');
    expect(row).not.toHaveTextContent('b2r4_customer');
  });

  it("an authored label shows verbatim, the target's machine name beneath it", async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'Ops board Dashboard' });
    expect(row).toHaveAttribute('title', 'dashboard · ops_board');
    expect(row).not.toHaveTextContent('ops_board');
  });

  it('an entry that names no target reads as the untitled wording by its place, never its id', async () => {
    renderPillar();
    // objectui#12455 — its kind is known (it was born an object entry), so
    // its tag says so.
    const row = await screen.findByRole('button', { name: 'Item 3 Object' });
    expect(row).toBeDisabled();
    expect(row).not.toHaveTextContent('nav_item_7');
    expect(row).not.toHaveAttribute('title', 'nav_item_7');
  });

  it('CONTROL: a target with no label in hand shows its machine name alone, once', async () => {
    renderPillar();
    const row = await screen.findByRole('button', { name: 'repairs_ticket Object' });
    expect(within(row).getAllByText('repairs_ticket')).toHaveLength(1);
  });
});

describe('objectui#11862 — the nav-item inspector offers the untitled wording for an unbound entry', () => {
  function renderInspector(navigation: Array<Record<string, unknown>>, navId: string) {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <StudioNavItemInspector
          navId={navId}
          appDraft={{ navigation }}
          objects={[{ name: 'b2r4_customer', label: 'Customers' }]}
          packageId="com.acme.app"
          onNavPatch={vi.fn()}
          onClear={vi.fn()}
        />
      </MetadataCtx.Provider>,
    );
    return screen.getByRole('textbox') as HTMLInputElement;
  }

  it("an unbound entry's Label placeholder is \"Item N\" by its place, not its id", () => {
    const field = renderInspector([NAV[1], { id: 'nav_item_7', type: 'object' }], 'navigation[1]');
    expect(field).toHaveAttribute('placeholder', 'Item 2');
  });

  it("CONTROL: a bound label-less entry's placeholder is still its object's label", () => {
    const field = renderInspector([NAV[1]], 'navigation[0]');
    expect(field).toHaveAttribute('placeholder', 'Customers');
  });
});
