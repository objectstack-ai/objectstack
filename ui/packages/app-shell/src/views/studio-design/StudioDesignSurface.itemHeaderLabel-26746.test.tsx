// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26746 — the Interfaces item header names the open leaf as its
 * rail row names it.
 *
 * A label-less `{ type: 'object', objectName }` entry, as the app scaffold
 * writes it, inherits its object's label at render time (objectui#11196). The
 * rail asks the console's resolver (`useNavTargetLabel`) on every render; the
 * header read `current.label || current.name`, the text frozen when the open
 * leaf's Surface was made. When the resolver learns the label after the leaf
 * opened — a draft-only object's `_drafts` row (objectui#11862) arrives after
 * the app load picks its first leaf — the rail read "Repair Ticket" while the
 * header, its screen-reader caption and the definition sheet's title kept
 * "repairs_ticket".
 *
 *  - a label-less object entry's header reads the object label once the
 *    resolver has it, however late it arrives;
 *  - a labelled entry's header reads its authored label, unchanged;
 *  - a label-less group reads, in the rail, the text the running app's
 *    sidebar gives it (`resolveNavItemLabel`), and the header of a leaf
 *    inside it reads that leaf's label, as its rail row does.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MetadataCtx } from '@object-ui/react';
import { resolveNavItemLabel } from '@object-ui/layout';

const PKG = 'com.acme.app';

let nav: unknown[] = [];

/** The package's `_drafts` rows, as objectstack serves them since #22200. */
const DRAFT_ROWS = [
  { type: 'object', name: 'repairs_ticket', packageId: PKG, label: 'Repair Ticket', updatedAt: null, updatedBy: null },
];

const mockClient = vi.hoisted(() => ({
  list: vi.fn(async (type: string) => (type === 'app' ? [{ name: 'acme_app', label: 'Acme' }] : [])),
  listDrafts: vi.fn(async (): Promise<unknown[]> => []),
  listTypes: vi.fn(async () => ({ entries: [] })),
  layered: vi.fn(async (_type: string, name: string): Promise<unknown> => ({ effective: { name } })),
  getDraft: vi.fn(async () => null),
  get: vi.fn(async () => undefined),
  references: vi.fn(async () => []),
  save: vi.fn(async () => ({})),
  publish: vi.fn(async () => ({ success: true })),
  reset: vi.fn(async () => ({})),
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

import { StudioDesignSurface } from './StudioDesignSurface';

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

/** The host's metadata cache: published only, so the draft-only object is not in it. */
const METADATA = {
  apps: [],
  objects: [],
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

/** Releases the held `_drafts` answer: it lands only after the app load opened its first leaf. */
let releaseDrafts: () => void = () => {};

beforeEach(() => {
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  mockClient.layered.mockImplementation(async (type: string, name: string) => {
    if (type === 'app') return { effective: JSON.parse(JSON.stringify({ name: 'acme_app', label: 'Acme', navigation: nav })) };
    return { effective: { name } };
  });
  fetchPackagesMock.mockReset();
  fetchPackagesMock.mockResolvedValue([{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]);
  const held = new Promise<void>((resolve) => {
    releaseDrafts = resolve;
  });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/_drafts')) await held;
      const body = url.includes('/_drafts') ? { drafts: DRAFT_ROWS } : [];
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  releaseDrafts();
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

/** The header opens on the first leaf before the `_drafts` rows land; then they land. */
async function openThenLearnLabels(): Promise<HTMLElement> {
  const crumb = await screen.findByTestId('if-breadcrumb', undefined, { timeout: 8000 });
  await act(async () => {
    releaseDrafts();
  });
  return crumb;
}

describe('objectstack#26746 — the Interfaces item header names the open leaf as its rail row does', () => {
  it('a label-less object entry: the header reads the object label the rail reads, learned after the leaf opened', async () => {
    nav = [{ id: 'nav_ticket', type: 'object', objectName: 'repairs_ticket' }];
    renderSurface();
    await openThenLearnLabels();
    await screen.findByRole('button', { name: 'Repair Ticket Object' }, { timeout: 8000 });
    const crumb = screen.getByTestId('if-breadcrumb');
    expect(crumb).toHaveTextContent(/^Repair Ticket/);
    expect(crumb).not.toHaveTextContent('repairs_ticket');
    expect(screen.getByTestId('if-canvas-caption')).toHaveTextContent(/^Repair Ticket ·/);
    // The machine name stays the secondary information, on the tooltip.
    expect(crumb).toHaveAttribute('title', expect.stringContaining('object · repairs_ticket'));
  });

  it('a labelled entry: the header reads its authored label, unchanged', async () => {
    nav = [{ id: 'nav_ticket', type: 'object', objectName: 'repairs_ticket', label: 'Open tickets' }];
    renderSurface();
    await openThenLearnLabels();
    await screen.findByRole('button', { name: 'Open tickets Object' }, { timeout: 8000 });
    const crumb = screen.getByTestId('if-breadcrumb');
    expect(crumb).toHaveTextContent(/^Open tickets/);
    expect(crumb).not.toHaveTextContent('Repair Ticket');
  });

  it('a label-less group: the rail reads what the running sidebar reads, and a leaf inside it is named alike in rail and header', async () => {
    const group = { id: 'nav_item_2', type: 'group', children: [{ id: 'nav_ticket', type: 'object', objectName: 'repairs_ticket' }] };
    nav = [group];
    renderSurface();
    await openThenLearnLabels();
    const sidebarText = resolveNavItemLabel(group as never);
    expect(await screen.findByRole('button', { name: sidebarText }, { timeout: 8000 })).toBeInTheDocument();
    await screen.findByRole('button', { name: 'Repair Ticket Object' }, { timeout: 8000 });
    expect(screen.getByTestId('if-breadcrumb')).toHaveTextContent(/^Repair Ticket/);
  });
});
