// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12452, objectstack#36899 — Access is a place of its own in Studio's
 * navigation.
 *
 * objectui#12452 made Access a first-class segment of the pillar nav and
 * retired the "More" overflow that held it alone. objectstack#36899 replaced
 * the pillar nav with the left menu of six domain groups (ADR-0084, amended):
 * Access is now a group, and the Access pillar is reached from its
 * permission-set entry. This file keeps the two facts the segment's pins held,
 * read on the menu:
 *
 * 1. The menu's Access group holds the permission-set entry, a real router
 *    link, with no "More" trigger anywhere; that entry carries the shield
 *    glyph, the Data group's object entry does not (objectstack#37452: a
 *    group's label draws no glyph, each entry draws its own line icon).
 * 2. With the Access pillar's address open (under any package id) — which
 *    lands on the list of sets since objectstack#36905 — that entry is the
 *    current page and carries the active state; with Data open it carries
 *    neither, and the object entry carries both.
 *
 * Leaving an unsaved pillar is `pillarNavGuard`'s case.
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
      entries: [
        { type: 'object', label: 'Object', domain: 'data' },
        { type: 'flow', label: 'Flow', domain: 'automation' },
        { type: 'permission', label: 'Permission', domain: 'security', allowEnvironmentOverlay: true },
      ],
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
// objectstack#36905 — the area's pages, where the Access pillar's address lands.
vi.mock('../metadata-admin/index.js', () => ({
  MetadataDirectoryPage: () => <div data-testid="area-page" />,
  MetadataDiagnosticsPage: () => <div data-testid="area-page" />,
  MetadataResourceListPage: () => <div data-testid="area-page" />,
  MetadataResourceEditPage: () => <div data-testid="area-page" />,
  MetadataResourceHistoryPage: () => <div data-testid="area-page" />,
}));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { translateMetadataDomain } from '../metadata-admin/i18n';
// The source under test reaches dynamic imports of `@objectstack/lint`; their first
// load is paid here, at collection, never inside a case's clock (`check:test-source-alias`).
import '@objectstack/lint';
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';

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

/** The `security` group's name, Access (objectstack ADR-0084, amended). */
const ACCESS = translateMetadataDomain('security', 'en');
const OBJECT_ENTRY = 'studio-menu-entry-type:object';
const PERMISSION_ENTRY = 'studio-menu-entry-type:permission';

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
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const menu = () => screen.getByTestId('studio-menu');
const entry = (testId: string) => within(menu()).getByTestId(testId);

/** The markup of lucide's own `Shield`, the permission-set entry's glyph. */
function shieldMarkup(): string {
  const { container, unmount } = render(<Shield />);
  const markup = container.querySelector('svg')!.innerHTML;
  unmount();
  return markup;
}

describe('Studio menu: Access is a group of its own, and More is gone (objectui#12452, objectstack#36899)', () => {
  it('the Access group holds the permission-set entry, a link to the area list, with no More trigger', async () => {
    renderAt(`/studio/${PKG}/data`);
    await screen.findByTestId('studio-top-left');

    const group = within(menu()).getByTestId('studio-menu-group-security');
    expect(group).toHaveTextContent(ACCESS);
    expect(within(group).getByTestId(PERMISSION_ENTRY)).toHaveAttribute(
      'href',
      `/studio/${PKG}/metadata/permission?package=${PKG}`,
    );
    expect(screen.queryByTestId('studio-nav-more')).toBeNull();
    expect(screen.queryByTestId('studio-pillar-nav')).toBeNull();
    const shield = shieldMarkup();
    expect(within(group).getByTestId(PERMISSION_ENTRY).querySelector('svg')!.innerHTML).toBe(shield);
    expect(entry(OBJECT_ENTRY).querySelector('svg')!.innerHTML).not.toBe(shield);
  });

  it.each(['app.objectstack.hotcrm', PKG])('with Access open in %s, the permission-set entry is the current page', async (pkg) => {
    fetchPackagesMock.mockResolvedValue([{ id: pkg, name: 'Pkg', writable: true, namespace: 'pkg' }]);
    renderAt(`/studio/${pkg}/access`);
    await screen.findByTestId('area-page');
    expect(screen.getByTestId('location-path')).toHaveTextContent(`/studio/${pkg}/metadata/permission`);

    const access = entry(PERMISSION_ENTRY);
    expect(access).toHaveAttribute('aria-current', 'page');
    expect(access).toHaveAttribute('data-active', 'true');
    expect(entry(OBJECT_ENTRY)).not.toHaveAttribute('aria-current');
    expect(entry(OBJECT_ENTRY)).toHaveAttribute('data-active', 'false');
  });

  it('control: with Data open, the permission-set entry carries neither, and the object entry carries both', async () => {
    renderAt(`/studio/${PKG}/data`);
    await screen.findByTestId('studio-top-left');

    expect(entry(PERMISSION_ENTRY)).not.toHaveAttribute('aria-current');
    expect(entry(PERMISSION_ENTRY)).toHaveAttribute('data-active', 'false');
    expect(entry(OBJECT_ENTRY)).toHaveAttribute('aria-current', 'page');
    expect(entry(OBJECT_ENTRY)).toHaveAttribute('data-active', 'true');
  });
});
