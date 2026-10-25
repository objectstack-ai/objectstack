// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11862 (the remainder) — the Interfaces nav editor names a draft-only
 * target by the label its `_drafts` row carries, with the machine name as
 * secondary text.
 *
 * On the maintainer's word 「所有地方以标签为主，机器名只作为次要信息」, and the seat
 * ruling `6053526025` question 1 (A, at the producer): each `_drafts` row
 * carries the draft body's own label, or `null` (objectstack-ai/objectstack#22200),
 * and Studio reads it off that row rather than reading each item for its label.
 *
 * A label-less nav entry inherits its target's CURRENT label (the runtime's
 * rule, `useNavTargetLabel`). A draft-only object or dashboard is in no
 * published list, so the console's metadata cannot name it, and the entry read
 * as its machine name in the rail, on the edit-mode cards and as the
 * inspector's Label placeholder. The Studio surface now hands the pending
 * drafts it already holds to that resolver as its last rung:
 *
 *  - the whole surface: the rail names a draft-only object entry and a
 *    draft-only dashboard entry by their `_drafts` labels, machine name beneath;
 *  - the edit-mode cards and the inspector's placeholder read the same label;
 *  - the inspector's target picker offers a draft-only dashboard by the label
 *    its `_drafts` row carries, as it offers a published one;
 *  - the published label still wins where the console's metadata has one;
 *  - CONTROL: a `_drafts` row whose label is `null` leaves the machine name
 *    alone, once;
 *  - a row stored under a plural type spelling is folded, as every `/meta`
 *    reader folds it.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';

const PKG = 'com.acme.app';

const NAV = [
  // Label-less entries, as the app scaffold and the *New dashboard* flow write them.
  { id: 'nav_ticket', type: 'object', objectName: 'repairs_ticket' },
  { id: 'nav_board', type: 'dashboard', dashboardName: 'ops_board' },
  { id: 'nav_bare', type: 'object', objectName: 'b2r4_bare' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };

/** The package's `_drafts` rows, as objectstack serves them since #22200. */
const DRAFT_ROWS = [
  { type: 'object', name: 'repairs_ticket', packageId: PKG, label: 'Repair Ticket', updatedAt: null, updatedBy: null },
  { type: 'dashboard', name: 'ops_board', packageId: PKG, label: 'Ops board', updatedAt: null, updatedBy: null },
  { type: 'object', name: 'b2r4_bare', packageId: PKG, label: null, updatedAt: null, updatedBy: null },
];

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  // The client's per-type `_drafts` read; the nav inspector's dashboard picker asks it.
  listDrafts: vi.fn(async (options?: { packageId?: string; type?: string }): Promise<unknown[]> =>
    options?.type === 'dashboard'
      ? [
          { type: 'dashboard', name: 'ops_board', packageId: 'com.acme.app', label: 'Ops board' },
          { type: 'dashboard', name: 'night_board', packageId: 'com.acme.app', label: null },
        ]
      : [],
  ),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (type: string, name: string) => {
    if (type === 'app') return { effective: JSON.parse(JSON.stringify({ name: 'acme_app', label: 'Acme', navigation: [] })) };
    return { effective: { name } };
  }),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  save: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
  // objectui#12725 — the properties are mounted in the right slot now (they
  // sat behind the folded Properties tab), so an object leaf's list-view
  // inspector asks for the preview-drafts client too.
  withPreviewDrafts: vi.fn((): unknown => mockClient),
}));

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({ loading: false, error: null, entries: [] }),
  };
});

const fetchPackagesMock = vi.hoisted(() => vi.fn());
vi.mock('./packages-io', async (importOriginal) => {
  const mod = await importOriginal<typeof import('./packages-io')>();
  return { ...mod, fetchPackages: (...args: unknown[]) => fetchPackagesMock(...args) };
});

vi.mock('@object-ui/react', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@object-ui/react')>();
  return { ...mod, useAdapter: () => ({}) };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));

vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface, StudioNavItemInspector } from './StudioDesignSurface';
import { DraftTargetLabels, useNavTargetLabel } from '../../hooks/useNavTargetLabel';

window.matchMedia = ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  (globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

/** The host's metadata cache: published only, so no draft-only target is in it. */
const METADATA = {
  apps: [],
  objects: [{ name: 'b2r4_customer', label: 'Customers' }],
  dashboards: [],
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

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.layered.mockImplementation(async (type: string, name: string) => {
    if (type === 'app') return { effective: JSON.parse(JSON.stringify(APP)) };
    return { effective: { name } };
  });
  fetchPackagesMock.mockReset();
  fetchPackagesMock.mockResolvedValue([{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]);
  // The surface's pending-drafts feed (`GET /api/v1/meta/_drafts?packageId=…`).
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/_drafts') ? { drafts: DRAFT_ROWS } : [];
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSurface() {
  return render(
    <MetadataCtx.Provider value={METADATA as never}>
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <Routes>
          <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        </Routes>
      </MemoryRouter>
    </MetadataCtx.Provider>,
  );
}

describe("objectui#11862 — the Interfaces nav editor names a draft-only target by its `_drafts` label", () => {
  it('the rail: a draft-only object entry reads as its label, its machine name as secondary text', async () => {
    renderSurface();
    const row = await screen.findByRole('button', { name: 'Repair Ticket Object' }, { timeout: 8000 });
    // objectui#12455 — the machine name is the row's tooltip, not a second line.
    expect(row).toHaveAttribute('title', 'object · repairs_ticket');
    expect(row).not.toHaveTextContent('repairs_ticket');
  });

  it('the rail: a draft-only dashboard entry reads as its label, its machine name as secondary text', async () => {
    renderSurface();
    const row = await screen.findByRole('button', { name: 'Ops board Dashboard' }, { timeout: 8000 });
    expect(row).toHaveAttribute('title', 'dashboard · ops_board');
    expect(row).not.toHaveTextContent('ops_board');
  });

  it('CONTROL: a `_drafts` row whose label is null leaves the machine name alone, once', async () => {
    renderSurface();
    const row = await screen.findByRole('button', { name: 'b2r4_bare Object' }, { timeout: 8000 });
    expect(within(row).getAllByText('b2r4_bare')).toHaveLength(1);
  });

  it('the edit-mode cards read the same label, the machine name on their title', async () => {
    renderSurface();
    await screen.findByRole('button', { name: 'Repair Ticket Object' }, { timeout: 8000 });
    fireEvent.click(screen.getByTitle(/^Edit navigation/));
    const card = await screen.findByRole('button', { name: /^Repair Ticket/ });
    // objectui#12519 — the api name moved from the row onto its title.
    expect(card).toHaveAttribute('title', 'Repair Ticket · repairs_ticket');
    expect(screen.queryByRole('button', { name: /^repairs_ticket/ })).toBeNull();
  });
});

describe('objectui#11862 — the resolver the nav editor asks: the draft label is the last rung', () => {
  function Probe({ target }: { target: Parameters<ReturnType<typeof useNavTargetLabel>>[0] }) {
    const resolve = useNavTargetLabel();
    return <output data-testid="probe">{resolve(target) ?? '(none)'}</output>;
  }

  function probe(target: Parameters<ReturnType<typeof useNavTargetLabel>>[0], drafts: unknown[]) {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <DraftTargetLabels.Provider value={drafts as never}>
          <Probe target={target} />
        </DraftTargetLabels.Provider>
      </MetadataCtx.Provider>,
    );
    return screen.getByTestId('probe').textContent;
  }

  it("a draft-only object answers its `_drafts` row's label", () => {
    expect(probe({ kind: 'object', objectName: 'repairs_ticket' }, DRAFT_ROWS)).toBe('Repair Ticket');
  });

  it('the published label still wins over a pending draft of the same object', () => {
    const drafts = [{ type: 'object', name: 'b2r4_customer', label: 'Draft customers' }];
    expect(probe({ kind: 'object', objectName: 'b2r4_customer' }, drafts)).toBe('Customers');
  });

  it('a row stored under a plural type spelling is folded to its singular type', () => {
    const drafts = [{ type: 'objects', name: 'repairs_ticket', label: 'Repair Ticket' }];
    expect(probe({ kind: 'object', objectName: 'repairs_ticket' }, drafts)).toBe('Repair Ticket');
  });

  it("a draft of another type does not name the target", () => {
    const drafts = [{ type: 'dashboard', name: 'repairs_ticket', label: 'Not this one' }];
    expect(probe({ kind: 'object', objectName: 'repairs_ticket' }, drafts)).toBe('(none)');
  });

  it('CONTROL: with no provider the resolver answers as it did — nothing for a target the metadata lacks', () => {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <Probe target={{ kind: 'object', objectName: 'repairs_ticket' }} />
      </MetadataCtx.Provider>,
    );
    expect(screen.getByTestId('probe').textContent).toBe('(none)');
  });

  it("the inspector's Label placeholder inherits the draft label", () => {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <DraftTargetLabels.Provider value={DRAFT_ROWS as never}>
          <StudioNavItemInspector
            navId="navigation[0]"
            appDraft={{ navigation: NAV }}
            objects={[{ name: 'repairs_ticket', label: 'Repair Ticket' }]}
            packageId={PKG}
            onNavPatch={vi.fn()}
            onClear={vi.fn()}
          />
        </DraftTargetLabels.Provider>
      </MetadataCtx.Provider>,
    );
    expect(screen.getByPlaceholderText('Repair Ticket')).toBeInTheDocument();
  });

  it("the inspector's target picker offers a draft-only dashboard by its `_drafts` label", async () => {
    render(
      <MetadataCtx.Provider value={METADATA as never}>
        <StudioNavItemInspector
          navId="navigation[1]"
          appDraft={{ navigation: NAV }}
          objects={[]}
          packageId={PKG}
          onNavPatch={vi.fn()}
          onClear={vi.fn()}
        />
      </MetadataCtx.Provider>,
    );
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Dashboard' }), { key: 'ArrowDown' });
    const listbox = await screen.findByRole('listbox');
    expect(await within(listbox).findByRole('option', { name: 'Ops board (ops_board)' })).toBeInTheDocument();
    // CONTROL: a `_drafts` row with no label is offered by its name alone.
    expect(within(listbox).getByRole('option', { name: 'night_board' })).toBeInTheDocument();
    expect(mockClient.listDrafts).toHaveBeenCalledWith({ packageId: PKG, type: 'dashboard' });
  });
});
