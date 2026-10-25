// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11167 — the Interfaces pillar closes nav editing when the package
 * answers read-only, so no edit is taken on screen that its autosave will
 * refuse.
 *
 * The Studio surface learns the package's write state from the package list,
 * its own request, and an unknown state stays ungated: the nav toggle is on
 * offer while that request is in flight (objectui#11153's race pin keeps it
 * so). An author could therefore open nav editing and edit before the answer
 * arrived. On `writable: false` the toggle hid, but editing stayed open: the
 * canvas kept taking edits, and the nav autosave, blocked on `readOnly`, never
 * sent them. Now the read-only answer closes editing, as the toggle closes it,
 * and puts back an unsaved edit taken in the window, which the package would
 * refuse (the server refuses authoring on a read-only package).
 *
 * "Left on screen unsaved" is read two ways: the rail no longer shows the
 * edit, and the surface's leave guard (a `beforeunload` it installs while the
 * pillar reports unsaved nav edits) no longer holds it.
 *
 * Every read-only case has its writable control in this file, and the control
 * proves the edit is real: on a writable package it reaches a save.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };
/** The object the appended item is bound to (objectui#11776). */
const TASK = { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  saves: [] as Array<{ type: string; name: string }>,
}));

// A server double: a save lands as the item's draft, and a later load serves
// it, so the writable control reads back what it saved.
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
      const draft = server.drafts.get(k(type, name));
      // The served-draft envelope: the pillar reads the document from `item`.
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      server.saves.push({ type, name });
      server.drafts.set(k(type, name), JSON.parse(JSON.stringify(item)) as Record<string, unknown>);
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
// pillar suite never calls it (it hands the pillar its `readOnly` directly).
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

// The surface's viewport hooks and Radix's floating-ui measurement need these.
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
  server.drafts.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  fetchPackagesMock.mockReset();
  fetchPackagesMock.mockResolvedValue([]);
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
  server.active.set(key('page', HOME.name), JSON.parse(JSON.stringify(HOME)));
  server.active.set(key('page', LANDING.name), JSON.parse(JSON.stringify(LANDING)));
  server.active.set(key('object', TASK.name), JSON.parse(JSON.stringify(TASK)));
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

function surfaceTree(sel?: string) {
  const search = sel ? `?sel=${encodeURIComponent(sel)}` : '';
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces${search}`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
}

function pillarTree(readOnly: boolean, sel: string) {
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces?sel=${encodeURIComponent(sel)}`]}>
      <InterfacesPillar packageId={PKG} readOnly={readOnly} />
      <LocationProbe />
    </MemoryRouter>
  );
}

/** A package list the test resolves by hand, while the author is editing. */
function deferPackageList() {
  let resolve!: (list: unknown[]) => void;
  fetchPackagesMock.mockReturnValue(new Promise<unknown[]>((r) => (resolve = r)));
  return (writable: boolean) => resolve([{ id: PKG, name: 'Acme', writable, namespace: 'acme' }]);
}

/** The app draft has loaded: the rail's nav tree lists its items (view mode). */
async function treeLoaded(): Promise<void> {
  await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
}

/** Nav editing is open: the rail carries the nav canvas, whose add affordance only it renders. */
function navEditingOpen(): boolean {
  return screen.queryAllByRole('button', { name: /Add nav item/ }).length > 0;
}

/**
 * The item "Add nav item" appends, wherever it shows: a canvas row, the rail's
 * tree, an inspector field. objectui#11196: it is born with no `label` (it was
 * born "New item"). objectui#11776: an entry is sent only once it names a
 * target, so the edit binds it to the fixture's object, and the label-less
 * entry shows that object's name: as a row's or a tree entry's name, and as
 * the inspector picker's value.
 */
function addedItemOnScreen(): boolean {
  const named = new RegExp(TASK.name);
  return screen.queryAllByRole('button', { name: named }).length + screen.queryAllByDisplayValue(named).length > 0;
}

/** True while the surface's leave guard holds unsaved nav edits (it cancels `beforeunload`). */
function leaveGuarded(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

/** Open nav editing through the toggle, and take one edit: append an item, bound to the fixture's object. */
async function openEditingAndAddItem(): Promise<void> {
  fireEvent.click(screen.getByTitle(/^Edit navigation/));
  fireEvent.click(await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 }));
  // *Link object* is the shared `Select` since objectui#11865: open its list and pick.
  fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`\\(${TASK.name}\\)$`) }));
  expect(addedItemOnScreen()).toBe(true);
}

describe('Studio surface — Edit clicked while the package list is in flight (objectui#11167)', () => {
  it('then `writable: false`: nav editing closes, and the edit taken in the window is not left on screen', async () => {
    const settle = deferPackageList();
    render(surfaceTree());

    await treeLoaded();
    await openEditingAndAddItem();
    // The edit is held unsaved: the surface guards leaving.
    expect(leaveGuarded()).toBe(true);

    settle(false);
    await waitFor(() => expect(screen.queryByTitle(/^Edit navigation/)).toBeNull(), { timeout: 8000 });
    await waitFor(() => expect(navEditingOpen()).toBe(false), { timeout: 8000 });

    expect(screen.queryByTitle('Done editing')).toBeNull();
    // The rail is back in view mode, showing the package's navigation: the
    // loaded items, and not the item the package refuses.
    expect(screen.getByRole('button', { name: /Landing menu/ })).toBeInTheDocument();
    expect(addedItemOnScreen()).toBe(false);
    // The pillar reports its dirty state up through an effect, so the guard
    // lets go one render after the close.
    await waitFor(() => expect(leaveGuarded()).toBe(false), { timeout: 8000 });
  });

  it('the control: then `writable: true`: nav editing stays open, and the edit reaches a save', async () => {
    const settle = deferPackageList();
    render(surfaceTree());

    await treeLoaded();
    await openEditingAndAddItem();

    settle(true);
    await waitFor(() => expect(server.saves).toContainEqual({ type: 'app', name: APP.name }), { timeout: 8000 });
    // A save re-reads the app (the draft-saved signal); read after that lands.
    await waitFor(
      () => expect(mockClient.getDraft.mock.calls.filter(([t, n]) => t === 'app' && n === APP.name).length).toBeGreaterThan(1),
      { timeout: 8000 },
    );
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTitle('Done editing')).toBeInTheDocument();
    expect(navEditingOpen()).toBe(true);
    expect(addedItemOnScreen()).toBe(true);
    expect(server.drafts.get(key('app', APP.name))?.navigation).toHaveLength(NAV.length + 1);
  });

  it('a pending `?sel=nav:` link still applies read-only when the same answer closes editing', async () => {
    // The author opens editing and selects an item (the appended one) before
    // the answer. That answer both closes editing and settles the link, which
    // on a read-only package selects its item without editing and keeps the
    // param (objectui#11153). The close must not clear what the link selects.
    const settle = deferPackageList();
    render(surfaceTree('nav:nav_landing'));

    await treeLoaded();
    await openEditingAndAddItem();
    expect(selParam()).toBe('nav:nav_landing');

    settle(false);
    await waitFor(() => expect(navEditingOpen()).toBe(false), { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.queryByTitle('Done editing')).toBeNull();
    expect(addedItemOnScreen()).toBe(false);
    expect(selParam()).toBe('nav:nav_landing');
  });
});

describe('Interfaces pillar — a link that opened nav editing, then a read-only answer (objectui#11167)', () => {
  it('closes nav editing and the linked item’s inspector', async () => {
    const { rerender } = render(pillarTree(false, 'nav:nav_landing'));

    await screen.findByTitle('Done editing', undefined, { timeout: 8000 });
    expect(within(screen.getByRole('complementary')).getByDisplayValue('Landing menu')).toBeInTheDocument();

    rerender(pillarTree(true, 'nav:nav_landing'));
    await waitFor(() => expect(navEditingOpen()).toBe(false), { timeout: 8000 });

    expect(screen.queryByTitle('Done editing')).toBeNull();
    expect(screen.queryByTitle(/^Edit navigation/)).toBeNull();
    expect(within(screen.getByRole('complementary')).queryByDisplayValue('Landing menu')).toBeNull();
  });

  it('the control: a writable re-render leaves it open', async () => {
    const { rerender } = render(pillarTree(false, 'nav:nav_landing'));

    await screen.findByTitle('Done editing', undefined, { timeout: 8000 });

    rerender(pillarTree(false, 'nav:nav_landing'));
    await new Promise((r) => setTimeout(r, 50));

    expect(screen.getByTitle('Done editing')).toBeInTheDocument();
    expect(navEditingOpen()).toBe(true);
    expect(within(screen.getByRole('complementary')).getByDisplayValue('Landing menu')).toBeInTheDocument();
  });
});
