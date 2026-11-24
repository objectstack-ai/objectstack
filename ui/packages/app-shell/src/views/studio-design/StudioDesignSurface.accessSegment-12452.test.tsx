// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12452 — Access is a segment of the Studio pillar nav, and the More
 * overflow that held it alone is gone.
 *
 * Since objectui#5813 Access sat in a "More" popover beside the primary
 * pillars, and objectui#11794 pinned that trigger's name. The overflow held one
 * pillar, so it was a one-item menu. The epic's decision A (objectui#12446)
 * puts Access in the segmented control as a first-class pillar and retires
 * More; this file replaces the More trigger's pin.
 *
 * Two facts are pinned:
 *
 * 1. The nav reads Data, Automations, Access (objectstack#36502 retired the
 *    Interfaces segment that stood third), each a real router link to its
 *    pillar, with no trigger of any kind beside them. Access carries the
 *    shield glyph, compared with lucide's own `Shield`.
 * 2. With Access open (under any package id) the Access segment is the current
 *    page and carries the active look the open primary pillar carries; with
 *    Data open it carries neither, and Data carries both.
 *
 * A third fact, "leaving an unsaved pillar through Access asks as through
 * Data does", was read on the Interfaces pillar's nav edit, the one pillar
 * other than Access that reported an unsaved edit; it retired with that
 * pillar. The surface's one leave guard stays pinned from Access itself in
 * `pillarNavGuard`.
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
import { render, screen, cleanup, within } from '@testing-library/react';
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
// The source under test reaches dynamic imports of `@objectstack/lint`; their first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';

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

describe('Studio pillar nav: Access is a segment of its own, and More is gone (objectui#12452)', () => {
  it('reads Data, Automations, Access, each a link to its pillar, with no trigger beside them', async () => {
    renderAt(`/studio/${PKG}/data`);
    await screen.findByTestId('studio-shell-header');

    const links = within(pillarNav()).getAllByRole('link');
    // objectstack#28561 — the "All metadata" area follows the pillars.
    // objectstack#36502 — Interfaces is retired: no segment, no link.
    expect(links.map((a) => a.textContent)).toEqual([DATA, AUTOMATIONS, ACCESS, t('engine.studio.pillar.metadata', 'en')]);
    expect(links.map((a) => a.getAttribute('href'))).toEqual(
      ['data', 'automations', 'access', 'metadata'].map((p) => `/studio/${PKG}/${p}`),
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
    for (const name of [DATA, AUTOMATIONS]) {
      expect(segment(name)).not.toHaveAttribute('aria-current');
      expect(segment(name)).not.toHaveClass('shadow-sm');
    }
  });

  it('control: with Data open, Access carries neither, and Data carries both', async () => {
    renderAt(`/studio/${PKG}/data`);
    await screen.findByTestId('studio-shell-header');

    expect(segment(ACCESS)).not.toHaveAttribute('aria-current');
    expect(segment(ACCESS)).not.toHaveClass('shadow-sm');
    expect(segment(ACCESS).querySelector('svg')).not.toHaveClass('text-primary');
    expect(segment(DATA)).toHaveAttribute('aria-current', 'page');
    expect(segment(DATA)).toHaveClass(...ACTIVE);
  });
});
