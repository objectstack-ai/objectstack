// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11153 — a shared `?sel=nav:ID` link survives the Interfaces
 * pillar's mount and opens that nav item.
 *
 * The pillar's URL mirror is keyed on the nav selection, so its MOUNT pass
 * runs with no selection. It used to delete `sel` right there, before the app
 * draft had loaded, so by the time the nav tree arrived there was no param
 * left to apply: the objectui#2272 deep link never opened anything. The mirror
 * now waits while the param is unapplied and the tree (and the package's write
 * state) has not settled; the link is applied once when they arrive.
 *
 * Applying it reads the package's write state. Nav editing autosaves, and that
 * autosave is blocked on a read-only package (the objectui#11124 /
 * objectui#11136 class), so there the link selects the item WITHOUT entering
 * editing. The pillar has no view-mode rendering of a nav selection (the rail
 * reads the open surface, and the nav-item inspector is an editing
 * affordance), so on a read-only package the held selection is observable only
 * through the URL mirror that keeps the param.
 *
 * The write state the Studio surface hands the pillar starts UNKNOWN (the
 * package list is its own request, not ordered against the app draft's). An
 * unknown state is not read as writable: the last suite mounts the whole
 * surface with the package list still in flight when the tree arrives.
 *
 * Every read-only case has its writable control in this file, and an unknown
 * id is the control that the link is keyed on the id, not on the param's mere
 * presence.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string }>,
}));

const mockClient = vi.hoisted(() => {
  const k = (type: string, name: string) => `${type}/${name}`;
  return {
    list: vi.fn(async (type: string) =>
      [...server.active.entries()]
        .filter(([key]) => key.startsWith(`${type}/`))
        .map(([, row]) => ({ name: row.name, label: row.label ?? row.name })),
    ),
    listDrafts: vi.fn(async () => []),
    listTypes: vi.fn(async () => ({ entries: [] })),
    get: vi.fn(async () => null),
    references: vi.fn(async () => []),
    layered: vi.fn(async (type: string, name: string) => {
      const eff = server.active.get(k(type, name)) ?? null;
      return { code: null, overlay: eff, overlayScope: eff ? 'env' : null, effective: eff, editable: true, deletable: true, resettable: false, lock: 'none' };
    }),
    getDraft: vi.fn(async (type: string, name: string) => {
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name });
      return { type, name, item };
    }),
    publish: vi.fn(async () => ({ success: true })),
    reset: vi.fn(async () => ({})),
  };
});

vi.mock('../metadata-admin/useMetadata', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../metadata-admin/useMetadata')>();
  return { ...mod, useMetadataClient: () => mockClient, useMetadataTypes: () => ({ loading: false, error: null, entries: [] }) };
});

// The package list is the write-state probe of the whole-surface suite; the
// pillar suites never call it (they hand the pillar its `readOnly` directly).
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

// Rail siblings / docks the whole-surface suite does not read.
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { InterfacesPillar, StudioDesignSurface } from './StudioDesignSurface';

// jsdom ships neither of these; the surface's viewport hooks and Radix's
// floating-ui measurement need them.
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

const key = (type: string, name: string) => `${type}/${name}`;

beforeEach(() => {
  server.active.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  fetchPackagesMock.mockReset();
  fetchPackagesMock.mockResolvedValue([]);
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
  server.active.set(key('page', HOME.name), JSON.parse(JSON.stringify(HOME)));
  server.active.set(key('page', LANDING.name), JSON.parse(JSON.stringify(LANDING)));
  // The surface's pending-drafts counter polls over raw fetch — stub it flat.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the router's live `search`, so a pin reads the URL the mirror wrote. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-search">{location.search}</output>;
}

/** The `sel` param as the router holds it right now. */
function selParam(): string | null {
  return new URLSearchParams(screen.getByTestId('location-search').textContent ?? '').get('sel');
}

function renderPillar(readOnly: boolean, sel: string) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces?sel=${encodeURIComponent(sel)}`]}>
      <InterfacesPillar packageId={PKG} readOnly={readOnly} />
      <LocationProbe />
    </MemoryRouter>,
  );
}

function renderSurface(sel: string) {
  return render(
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces?sel=${encodeURIComponent(sel)}`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

/** The right rail (classic layout: the inspector's own aside). */
function rail(): HTMLElement {
  return screen.getByRole('complementary');
}

/** The app draft has loaded: the rail's nav tree lists its items (view mode). */
async function treeLoaded(): Promise<void> {
  await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
}

/** Nav editing is open: the rail carries the nav canvas, whose add affordance only it renders. */
function navEditingOpen(): boolean {
  return screen.queryAllByRole('button', { name: /Add nav item/ }).length > 0;
}

describe('Interfaces pillar — a `?sel=nav:ID` link on a writable package (objectui#11153)', () => {
  it('opens nav editing on that item once the draft loads, and the URL keeps the param', async () => {
    renderPillar(false, 'nav:nav_landing');

    await screen.findByTitle('Done editing', undefined, { timeout: 8000 });
    expect(navEditingOpen()).toBe(true);
    // The nav-item inspector is open on the LINKED item, not on the first one.
    expect(within(rail()).getByDisplayValue('Landing menu')).toBeInTheDocument();
    expect(within(rail()).queryByDisplayValue('Home menu')).toBeNull();
    expect(selParam()).toBe('nav:nav_landing');
  });

  it('an unknown id changes nothing: no editing, and the param is left as it was', async () => {
    renderPillar(false, 'nav:nav_missing');

    await treeLoaded();
    // The toggle is offered (the package is writable) but not engaged.
    expect(screen.getByTitle(/^Edit navigation/)).toBeInTheDocument();
    expect(screen.queryByTitle('Done editing')).toBeNull();
    expect(navEditingOpen()).toBe(false);
    expect(selParam()).toBe('nav:nav_missing');
  });
});

describe('Interfaces pillar — a `?sel=nav:ID` link on a read-only package (objectui#11153)', () => {
  it('selects the item without entering nav editing, and the URL keeps the param', async () => {
    renderPillar(true, 'nav:nav_landing');

    await treeLoaded();
    // Let the apply run against the loaded tree before reading its outcome.
    await waitFor(() => expect(mockClient.layered).toHaveBeenCalledWith('app', APP.name));
    await new Promise((r) => setTimeout(r, 50));

    expect(navEditingOpen()).toBe(false);
    expect(screen.queryByTitle('Done editing')).toBeNull();
    expect(within(rail()).queryByDisplayValue('Landing menu')).toBeNull();
    expect(selParam()).toBe('nav:nav_landing');
  });

  it('an unknown id changes nothing here either', async () => {
    renderPillar(true, 'nav:nav_missing');

    await treeLoaded();
    await new Promise((r) => setTimeout(r, 50));

    expect(navEditingOpen()).toBe(false);
    expect(selParam()).toBe('nav:nav_missing');
  });
});

describe('Studio surface — the link waits for the package write state (objectui#11153)', () => {
  /** A package list the test resolves by hand, after the app draft has loaded. */
  function deferPackageList() {
    let resolve!: (list: unknown[]) => void;
    fetchPackagesMock.mockReturnValue(new Promise<unknown[]>((r) => (resolve = r)));
    return (writable: boolean) =>
      resolve([{ id: PKG, name: 'Acme', writable, namespace: 'acme' }]);
  }

  it('a read-only package whose write state settles AFTER the tree never enters nav editing', async () => {
    const settle = deferPackageList();
    renderSurface('nav:nav_landing');

    await treeLoaded();
    await new Promise((r) => setTimeout(r, 50));
    // The write state is still unknown here — the surface stays ungated, so the
    // toggle is on offer — and the link has not been read as writable.
    expect(screen.getByTitle(/^Edit navigation/)).toBeInTheDocument();
    expect(navEditingOpen()).toBe(false);
    expect(selParam()).toBe('nav:nav_landing');

    settle(false);
    await waitFor(() => expect(screen.queryByTitle(/^Edit navigation/)).toBeNull(), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 50));

    expect(navEditingOpen()).toBe(false);
    expect(screen.queryByTitle('Done editing')).toBeNull();
    expect(selParam()).toBe('nav:nav_landing');
  });

  it('the control: a writable package whose write state settles after the tree opens the link then', async () => {
    const settle = deferPackageList();
    renderSurface('nav:nav_landing');

    await treeLoaded();
    await new Promise((r) => setTimeout(r, 50));
    expect(navEditingOpen()).toBe(false);

    settle(true);
    await screen.findByTitle('Done editing', undefined, { timeout: 8000 });
    expect(navEditingOpen()).toBe(true);
    // The surface may fold the inspector into a center tab beside the chat
    // dock, so the nav-item inspector is found on the page, not in an aside.
    expect(await screen.findByDisplayValue('Landing menu', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(selParam()).toBe('nav:nav_landing');
  });
});
