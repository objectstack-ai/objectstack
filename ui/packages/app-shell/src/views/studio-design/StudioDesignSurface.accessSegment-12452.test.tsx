// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12452 — Access is the fourth segment of the Studio pillar nav, and
 * the More overflow that held it alone is gone.
 *
 * Since objectui#5813 Access sat in a "More" popover beside the three primary
 * pillars, and objectui#11794 pinned that trigger's name. The overflow held one
 * pillar, so it was a one-item menu. The epic's decision A (objectui#12446)
 * puts Access in the segmented control as a first-class pillar and retires
 * More; this file replaces the More trigger's pin.
 *
 * Three facts are pinned:
 *
 * 1. The nav reads Data, Automations, Interfaces, Access, in that order, each a
 *    real router link to its pillar, with no trigger of any kind beside them.
 *    Access carries the shield glyph, compared with lucide's own `Shield`.
 * 2. With Access open (under any package id) the Access segment is the current
 *    page and carries the active look the open primary pillar carries; with
 *    Interfaces open it carries neither, and Interfaces carries both.
 * 3. Leaving a pillar with an unsaved edit through Access asks exactly as
 *    leaving it through Data does (the surface's one leave guard,
 *    objectui#2600): cancel stays with the edit, confirm lands on Access. A
 *    clean departure through Access never asks.
 *
 * The unsaved edit is the Interfaces pillar's nav edit, the one pillar other
 * than Access that reports one. The package list is held in flight, so the
 * nav autosave never sends it and the edit stays unsaved for the whole test
 * (`navEditClosesOnReadOnly-11167` reads the same window).
 *
 * The package-less scope's single pillar stays pinned where it is:
 * `packageLessFlows-11553` asserts no Access link there. Re-clicking the open
 * Access segment is `pillarNavGuard`'s case.
 *
 * Rendered through the real `StudioDesignSurface`; only data I/O and heavy
 * docks are doubled.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Shield } from 'lucide-react';

const PKG = 'com.acme.app';

const NAV = [
  { id: 'nav_home', type: 'page', label: 'Home menu', pageName: 'home' },
  { id: 'nav_landing', type: 'page', label: 'Landing menu', pageName: 'landing' },
];
const APP = { name: 'acme_app', label: 'Acme', navigation: NAV };
const HOME = { name: 'home', label: 'Home', type: 'app', regions: [{ name: 'main', components: [] }] };
const LANDING = { name: 'landing', label: 'Landing', type: 'app', regions: [{ name: 'main', components: [] }] };
/** The object the appended nav item is bound to (objectui#11776). */
const TASK = { name: 'acme_task', label: 'Task', fields: [{ name: 'title', label: 'Title', type: 'text' }] };

const server = vi.hoisted(() => ({
  active: new Map<string, Record<string, unknown>>(),
  drafts: new Map<string, Record<string, unknown>>(),
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
      const draft = server.drafts.get(k(type, name));
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
  return {
    ...mod,
    useMetadataClient: () => mockClient,
    useMetadataTypes: () => ({
      loading: false,
      error: null,
      entries: [{ type: 'permission', label: 'Permission', allowEnvironmentOverlay: true }],
    }),
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
import { t } from '../metadata-admin/i18n';

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

const DATA = t('engine.studio.pillar.data', 'en');
const AUTOMATIONS = t('engine.studio.pillar.automations', 'en');
const INTERFACES = t('engine.studio.pillar.interfaces', 'en');
const ACCESS = t('engine.studio.pillar.access', 'en');
/** The class tokens the open pillar's segment carries (objectui#12459). */
const ACTIVE = ['bg-background', 'font-medium', 'text-foreground', 'shadow-sm'];

// This environment ships no window.confirm: the surface's leave prompt.
let confirmSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  server.active.clear();
  server.drafts.clear();
  server.saves.length = 0;
  for (const fn of Object.values(mockClient)) (fn as unknown as { mockClear: () => void }).mockClear();
  fetchPackagesMock.mockReset();
  fetchPackagesMock.mockResolvedValue([{ id: PKG, name: 'Acme', writable: true, namespace: 'acme' }]);
  server.active.set(key('app', APP.name), JSON.parse(JSON.stringify(APP)));
  server.active.set(key('page', HOME.name), JSON.parse(JSON.stringify(HOME)));
  server.active.set(key('page', LANDING.name), JSON.parse(JSON.stringify(LANDING)));
  server.active.set(key('object', TASK.name), JSON.parse(JSON.stringify(TASK)));
  confirmSpy = vi.fn();
  window.confirm = confirmSpy as unknown as typeof window.confirm;
  // The surface's pending-drafts counter polls over raw fetch — stub it flat.
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => [] })) as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Renders the router's live pathname, so a pin reads where the author is. */
function LocationProbe() {
  return <output data-testid="location-path">{useLocation().pathname}</output>;
}
const pathname = () => screen.getByTestId('location-path').textContent;

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const pillarNav = () => screen.getByTestId('studio-pillar-nav');
const segment = (name: string) => within(pillarNav()).getByRole('link', { name });

/** The markup of lucide's own `Shield`, for the Access segment's glyph. */
function shieldMarkup(): string {
  const { container, unmount } = render(<Shield />);
  const markup = container.querySelector('svg')!.innerHTML;
  unmount();
  return markup;
}

describe('Studio pillar nav: Access is the fourth segment, and More is gone (objectui#12452)', () => {
  it('reads Data, Automations, Interfaces, Access, each a link to its pillar, with no trigger beside them', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    // objectui#12725 — by test id: the Interfaces properties now sit in the right
    // slot beside the top bar, and testing-library reads their aside's `header`
    // as a second banner (a browser does not: it is inside an `aside`).
    await screen.findByTestId('studio-shell-header');

    const links = within(pillarNav()).getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual([DATA, AUTOMATIONS, INTERFACES, ACCESS]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      ['data', 'automations', 'interfaces', 'access'].map((p) => `/studio/${PKG}/${p}`),
    );
    // No More trigger, under its old test id or any other name.
    expect(within(pillarNav()).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByTestId('studio-nav-more')).toBeNull();
    // The shield glyph the overflow entry carried; the Data segment's is not it.
    const shield = shieldMarkup();
    expect(segment(ACCESS).querySelector('svg')!.innerHTML).toBe(shield);
    expect(segment(DATA).querySelector('svg')!.innerHTML).not.toBe(shield);
  });

  it.each(['app.objectstack.hotcrm', PKG])('with Access open in %s, Access is the current page and carries the active look', async (pkg) => {
    fetchPackagesMock.mockResolvedValue([{ id: pkg, name: 'Pkg', writable: true, namespace: 'pkg' }]);
    renderAt(`/studio/${pkg}/access`);
    await screen.findByTestId('studio-shell-header');

    const access = segment(ACCESS);
    expect(access).toHaveAttribute('aria-current', 'page');
    expect(access).toHaveClass(...ACTIVE);
    expect(access.querySelector('svg')).toHaveClass('text-primary');
    // No other segment is the open one.
    for (const name of [DATA, AUTOMATIONS, INTERFACES]) {
      expect(segment(name)).not.toHaveAttribute('aria-current');
      expect(segment(name)).not.toHaveClass('shadow-sm');
    }
  });

  it('control: with Interfaces open, Access carries neither, and Interfaces carries both', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    await screen.findByTestId('studio-shell-header');

    expect(segment(ACCESS)).not.toHaveAttribute('aria-current');
    expect(segment(ACCESS)).not.toHaveClass('shadow-sm');
    expect(segment(ACCESS).querySelector('svg')).not.toHaveClass('text-primary');
    expect(segment(INTERFACES)).toHaveAttribute('aria-current', 'page');
    expect(segment(INTERFACES)).toHaveClass(...ACTIVE);
  });
});

describe('Studio pillar nav: leaving an unsaved pillar through Access asks as through Data (objectui#12452)', () => {
  /** Hold the package list in flight: the nav autosave waits on it, so an edit stays unsaved. */
  function holdPackageList() {
    fetchPackagesMock.mockReturnValue(new Promise<unknown[]>(() => {}));
  }
  const addedItemOnScreen = () => screen.queryAllByRole('button', { name: new RegExp(TASK.name) }).length > 0;
  /** True while the surface's leave guard holds an unsaved edit (it cancels `beforeunload`). */
  function leaveGuarded(): boolean {
    const e = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(e);
    return e.defaultPrevented;
  }
  /** Open nav editing and append an item bound to the fixture's object: the Interfaces pillar's unsaved edit. */
  async function editTheNav(): Promise<void> {
    await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
    fireEvent.click(screen.getByTitle(/^Edit navigation/));
    fireEvent.click(await screen.findByRole('button', { name: /Add nav item/ }, { timeout: 8000 }));
    fireEvent.keyDown(screen.getByTestId('nav-link-object'), { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: new RegExp(`\\(${TASK.name}\\)$`) }));
    expect(addedItemOnScreen()).toBe(true);
    await waitFor(() => expect(leaveGuarded()).toBe(true));
  }

  it('cancel through Access stays with the edit, as cancel through Data does; confirm through Access lands on Access', async () => {
    holdPackageList();
    renderAt(`/studio/${PKG}/interfaces`);
    await editTheNav();

    // The control door: Data asks, and cancel keeps the author and the edit.
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(segment(DATA));
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(pathname()).toBe(`/studio/${PKG}/interfaces`);
    expect(addedItemOnScreen()).toBe(true);

    // THE PIN: Access asks the same question, and cancel does the same.
    confirmSpy.mockReturnValueOnce(false);
    fireEvent.click(segment(ACCESS));
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(confirmSpy).toHaveBeenLastCalledWith(confirmSpy.mock.calls[0]![0]);
    expect(pathname()).toBe(`/studio/${PKG}/interfaces`);
    expect(addedItemOnScreen()).toBe(true);

    confirmSpy.mockReturnValueOnce(true);
    fireEvent.click(segment(ACCESS));
    expect(confirmSpy).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(pathname()).toBe(`/studio/${PKG}/access`));
    expect(segment(ACCESS)).toHaveAttribute('aria-current', 'page');
    // The edit was discarded, never sent.
    expect(server.saves).toEqual([]);
  });

  it('control: a clean departure through Access never asks', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    await screen.findByRole('button', { name: /Landing menu/ }, { timeout: 8000 });
    expect(leaveGuarded()).toBe(false);

    fireEvent.click(segment(ACCESS));
    await waitFor(() => expect(pathname()).toBe(`/studio/${PKG}/access`));
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
