// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#11189 — the Interfaces pillar's nav autosave sends every edit it has
 * shown, on a writable package.
 *
 * Two ways a shown edit was left unsent:
 *  - "Done" inside the autosave's debounce. The autosave is blocked while nav
 *    editing is closed, so closing it cleared the pending save, and the edit
 *    stayed on screen, unsent, until editing was opened again.
 *  - An edit taken while a nav save was in flight. The completing save cleared
 *    the pillar's dirty flag whatever had been edited meanwhile, and its
 *    draft-saved signal re-read the app and installed the served draft (the
 *    document that save sent) over the edit buffer. The later edit vanished
 *    from the screen and was never sent, and the leave guard let go of it.
 *
 * Now "Done" sends a dirty buffer at once (the autosave, fired early), waits
 * for a save in flight, and closes editing once the buffer is clean. A
 * completing save clears only the edit generation it sent, and a re-read of the
 * same package does not install the served draft over a buffer holding an
 * edit that has not been sent.
 *
 * "Unsent" is read three ways, as the objectui#11167 suite reads it: the
 * saves the server double received and what each one carried, the rail
 * (which shows the edit buffer), and the surface's leave guard (a
 * `beforeunload` it cancels while the pillar reports unsaved nav edits).
 * objectui#11167's read-only close has its own suite, unmodified, and is the
 * control for the close path.
 *
 * objectui#11196 re-judged what an Add appends: a new canvas entry is born
 * with no `label` (it was born "New item"), so the rail shows it by its `id`
 * (`nav_item_3`, `nav_item_4`: the fixture has two entries) and a save carries
 * it with no `label` key. The counts and the saves below read that; what they
 * pin is unchanged.
 *
 * objectui#11776 re-judged what a save SENDS: an entry that names no target
 * for its `type` is left out of it (the spec refuses one, and the server with
 * it), so a bare Add is no longer an edit that reaches a save. Each edit here
 * is an Add whose new entry is then bound to the fixture's object in its
 * inspector: the rail shows it by that object's name, and a save still
 * carries it with no `label` key. What these pins pin is unchanged.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };
/** The object an added entry is bound to (objectui#11776). */
const TASK = { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
  /** Each app save as the server received it: the navigation it carried. */
  appSaves: [] as Array<{ navigation: Array<Record<string, unknown>> }>,
  /** While set, the next app save waits on it (a save held in flight). */
  hold: null as Promise<void> | null,
  /** While set, the next app save rejects with it. */
  fail: null as Error | null,
}));

// A server double: a save lands as the item's draft, and a later load serves
// it — so a re-read after a save installs exactly what that save sent.
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
      if (draft) return { item: JSON.parse(JSON.stringify(draft)) as Record<string, unknown> };
      throw Object.assign(new Error(`No pending draft exists for ${type}/${name}.`), { code: 'NO_DRAFT', status: 404 });
    }),
    save: vi.fn(async (type: string, name: string, item: unknown) => {
      const body = JSON.parse(JSON.stringify(item)) as Record<string, unknown>;
      if (type === 'app') {
        server.appSaves.push({ navigation: (body.navigation as Array<Record<string, unknown>>) ?? [] });
        const failure = server.fail;
        server.fail = null;
        if (failure) throw failure;
        const hold = server.hold;
        server.hold = null;
        if (hold) await hold;
      }
      server.drafts.set(k(type, name), body);
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

// The package list is the surface's write-state probe: every package here is writable.
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
  server.appSaves.length = 0;
  server.hold = null;
  server.fail = null;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  fetchPackagesMock.mockReset();
  fetchPackagesMock.mockResolvedValue([{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]);
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

function surfaceTree() {
  return (
    <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
    </MemoryRouter>
  );
}

/** Holds the next app save in flight until the returned release is called. */
function holdNextSave(): () => Promise<void> {
  let release!: () => void;
  server.hold = new Promise<void>((r) => (release = r));
  return async () => {
    await act(async () => {
      release();
      await new Promise((r) => setTimeout(r, 0));
    });
  };
}

/** The app draft has loaded: the rail's nav tree lists its items (view mode). */
async function treeLoaded(): Promise<void> {
  await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
}

/** Nav editing is open: the rail carries the nav canvas, whose add affordance only it renders. */
function navEditingOpen(): boolean {
  return screen.queryAllByRole('button', { name: /Add nav item/ }).length > 0;
}

/** The pillar's rail: the innermost navigation landmark that lists the app's items. */
function rail(): HTMLElement {
  const lists = screen.getAllByRole('navigation').filter((n) => n.textContent?.includes('Home menu'));
  const innermost = lists.filter((n) => !lists.some((other) => other !== n && n.contains(other)));
  expect(innermost).toHaveLength(1);
  return innermost[0];
}

/**
 * How many appended items the rail shows: a canvas row each while editing, a
 * tree entry each in view mode. A label-less new entry bound to the fixture's
 * object shows that object's name.
 */
function addedItemsInRail(): number {
  return within(rail()).queryAllByRole('button', { name: new RegExp(TASK.name) }).length;
}

/** True while the surface's leave guard holds unsaved nav edits (it cancels `beforeunload`). */
function leaveGuarded(): boolean {
  const e = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(e);
  return e.defaultPrevented;
}

async function openEditing(): Promise<void> {
  fireEvent.click(screen.getByTitle(/^Edit navigation/));
  await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 });
}

/**
 * One edit: "Add nav item" (the canvas selects the new entry), then bind it to
 * the fixture's object in its inspector — objectui#11776: an unbound entry is
 * left out of what a save sends.
 */
async function addItem(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: /Add nav item/ }));
  // *Link object* is the shared `Select` since objectui#11865: open its list and pick.
  fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(`\\(${TASK.name}\\)$`) }));
}

async function clickDone(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTitle('Done editing'));
  });
}

/**
 * The navigation the n-th app save carried (1-based), one entry per item: its
 * label, or `{ id }` for an entry saved with no `label` key (a new canvas
 * entry, objectui#11196).
 */
function savedEntries(n: number): Array<string | { id: unknown }> {
  return (server.appSaves[n - 1]?.navigation ?? []).map((item) =>
    Object.prototype.hasOwnProperty.call(item, 'label') ? String(item.label) : { id: item.id },
  );
}

describe('Studio surface — "Done" sends a shown nav edit (objectui#11189)', () => {
  it('"Done" inside the debounce sends the edit at once, and editing closes once it has landed', async () => {
    render(surfaceTree());
    await treeLoaded();
    await openEditing();
    await addItem();
    expect(addedItemsInRail()).toBe(1);

    const release = holdNextSave();
    await clickDone();
    // Sent at once — not left to a timer that closing editing would clear.
    expect(server.appSaves).toHaveLength(1);
    expect(savedEntries(1)).toEqual(['Home menu', 'Landing menu', { id: 'nav_item_3' }]);
    // The close waits for the send: editing stays open, and the guard holds.
    expect(navEditingOpen()).toBe(true);
    expect(leaveGuarded()).toBe(true);

    await release();
    await waitFor(() => expect(navEditingOpen()).toBe(false), { timeout: 8000 });
    await waitFor(() => expect(leaveGuarded()).toBe(false), { timeout: 8000 });
    // The rail's view tree shows the saved navigation, the edit included.
    await waitFor(() => expect(addedItemsInRail()).toBe(1), { timeout: 8000 });
    expect(server.drafts.get(key('app', APP.name))?.navigation).toHaveLength(NAV.length + 1);
    // Nothing else goes out: the flushed buffer is not sent a second time.
    await new Promise((r) => setTimeout(r, 1800));
    expect(server.appSaves).toHaveLength(1);
  });

  it('the control: "Done" on a clean buffer closes at once, and sends nothing', async () => {
    render(surfaceTree());
    await treeLoaded();
    await openEditing();

    await clickDone();
    expect(navEditingOpen()).toBe(false);
    await new Promise((r) => setTimeout(r, 1800));
    expect(server.appSaves).toHaveLength(0);
    expect(leaveGuarded()).toBe(false);
  });

  it('a send that fails keeps editing open, the edit on screen and the guard held', async () => {
    render(surfaceTree());
    await treeLoaded();
    await openEditing();
    await addItem();

    server.fail = new Error('navigation.2: Invalid input');
    await clickDone();
    expect(server.appSaves).toHaveLength(1);
    await screen.findByText(/navigation\.2: Invalid input/, undefined, { timeout: 8000 });
    await new Promise((r) => setTimeout(r, 50));

    expect(navEditingOpen()).toBe(true);
    expect(addedItemsInRail()).toBe(1);
    expect(leaveGuarded()).toBe(true);
  });
});

describe('Studio surface — an edit taken while a nav save is in flight (objectui#11189)', () => {
  it('stays on screen, keeps the guard, and lands in the next save', async () => {
    render(surfaceTree());
    await treeLoaded();
    await openEditing();

    const release = holdNextSave();
    await addItem();
    // The autosave fires after its debounce and is held in flight.
    await screen.findByTestId('nav-autosaving', undefined, { timeout: 8000 });
    expect(server.appSaves).toHaveLength(1);
    await addItem();
    expect(addedItemsInRail()).toBe(2);

    await release();
    // The completed save carried item 1 only; item 2 is still on screen and unsent.
    expect(savedEntries(1)).toEqual(['Home menu', 'Landing menu', { id: 'nav_item_3' }]);
    await waitFor(
      () => expect(mockClient.getDraft.mock.calls.filter(([t, n]) => t === 'app' && n === APP.name).length).toBeGreaterThan(1),
      { timeout: 8000 },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(addedItemsInRail()).toBe(2);
    expect(navEditingOpen()).toBe(true);
    expect(leaveGuarded()).toBe(true);

    // The next save carries both items, and then the guard lets go.
    await waitFor(() => expect(server.appSaves).toHaveLength(2), { timeout: 8000 });
    expect(savedEntries(2)).toEqual(['Home menu', 'Landing menu', { id: 'nav_item_3' }, { id: 'nav_item_4' }]);
    await waitFor(() => expect(leaveGuarded()).toBe(false), { timeout: 8000 });
    expect(addedItemsInRail()).toBe(2);
    expect(server.drafts.get(key('app', APP.name))?.navigation).toHaveLength(NAV.length + 2);
  });

  it('"Done" then waits for that save, sends the later edit at once, and closes after it lands', async () => {
    render(surfaceTree());
    await treeLoaded();
    await openEditing();

    const releaseFirst = holdNextSave();
    await addItem();
    await screen.findByTestId('nav-autosaving', undefined, { timeout: 8000 });
    await addItem();
    await clickDone();
    // A save is in flight: "Done" waits for it rather than send beside it.
    expect(server.appSaves).toHaveLength(1);
    expect(navEditingOpen()).toBe(true);

    const releaseSecond = holdNextSave();
    await releaseFirst();
    // The later edit goes out as soon as the first save lands, not a debounce later.
    await waitFor(() => expect(server.appSaves).toHaveLength(2), { timeout: 1000 });
    expect(savedEntries(2)).toEqual(['Home menu', 'Landing menu', { id: 'nav_item_3' }, { id: 'nav_item_4' }]);
    expect(navEditingOpen()).toBe(true);
    expect(leaveGuarded()).toBe(true);

    await releaseSecond();
    await waitFor(() => expect(navEditingOpen()).toBe(false), { timeout: 8000 });
    await waitFor(() => expect(leaveGuarded()).toBe(false), { timeout: 8000 });
    await waitFor(() => expect(addedItemsInRail()).toBe(2), { timeout: 8000 });
    expect(server.drafts.get(key('app', APP.name))?.navigation).toHaveLength(NAV.length + 2);
  });
});

describe('Interfaces pillar — a re-read of the same package over an unsent nav edit (objectui#11189)', () => {
  function pillarTree(draftNonce: number) {
    return (
      <MemoryRouter initialEntries={[`/studio/${PKG}/interfaces`]}>
        <InterfacesPillar packageId={PKG} draftNonce={draftNonce} />
      </MemoryRouter>
    );
  }

  it('a draft-saved signal from elsewhere keeps the edit on screen, and the autosave still sends it', async () => {
    const { rerender } = render(pillarTree(0));
    await treeLoaded();
    await openEditing();
    await addItem();
    expect(addedItemsInRail()).toBe(1);

    // Another editor's save (a page draft, the create-app flow) re-reads the app.
    rerender(pillarTree(1));
    await waitFor(
      () => expect(mockClient.getDraft.mock.calls.filter(([t, n]) => t === 'app' && n === APP.name).length).toBeGreaterThan(1),
      { timeout: 8000 },
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(addedItemsInRail()).toBe(1);

    await waitFor(() => expect(server.appSaves).toHaveLength(1), { timeout: 8000 });
    expect(savedEntries(1)).toEqual(['Home menu', 'Landing menu', { id: 'nav_item_3' }]);
  });
});
