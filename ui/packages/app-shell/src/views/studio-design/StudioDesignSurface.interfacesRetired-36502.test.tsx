// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36502 — an old Interfaces URL lands on the Studio home and says
 * where interface editing went.
 *
 * The Interfaces pillar is retired: menus, header actions, list views,
 * dashboards, reports and record pages are designed in the running app. A
 * bookmarked `/studio/<package>/interfaces` link, with or without its
 * `?surface=` deep link, still opens: the real `StudioDesignSurface`
 * replaces it with the package's Data pillar and shows, once, there, the
 * sentence 「界面的修改已经搬到应用里」 with a link back to the app.
 *
 * Pinned:
 *  - the bare URL and a `?surface=` deep link land on `/studio/<package>/data`,
 *    the deep link dropped; `?changes=review` travels;
 *  - the notice reads the card's sentence in zh-CN and its English in en,
 *    and its link goes to the package's app, as 「‹ Back to app」 does;
 *  - Dismiss hides it;
 *  - the pillar nav names no Interfaces segment;
 *  - CONTROL: an ordinary arrival on the Data pillar shows no notice.
 *
 * The URL arithmetic itself is `studioInterfacesRetired.test.ts`. Rendered
 * through the real surface; only data I/O and heavy docks are doubled.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

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

// The notice's sentence lives in `@object-ui/i18n`'s `studio` namespace, whose
// `zh` catalogue is fetched on demand (objectstack#25922): resident before any case.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
await loadStudioCatalogue('zh');

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

/** Renders the router's live path and query, so a pin reads where the author is. */
function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-path">{`${location.pathname}${location.search}`}</output>;
}
const where = () => screen.getByTestId('location-path').textContent;
/** The path alone: the Data pillar opens its first object with a `?surface=` of its own. */
const pathname = () => (where() ?? '').split('?')[0];

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/apps/*" element={<output data-testid="the-app" />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

const notice = () => screen.queryByTestId('studio-interfaces-retired');

describe('an old Interfaces URL lands on the Studio home (objectstack#36502)', () => {
  it('the bare URL: Data pillar, the notice, and a link back to the app', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    await screen.findByTestId('studio-shell-header');
    expect(where()).toBe(`/studio/${PKG}/data`);

    const strip = await screen.findByTestId('studio-interfaces-retired');
    expect(strip).toHaveAttribute('role', 'status');
    expect(strip).toHaveTextContent(t('engine.studio.interfacesRetired.sentence', 'en'));
    expect(t('engine.studio.interfacesRetired.sentence', 'zh-CN')).toBe('界面的修改已经搬到应用里');

    // The same target as 「‹ Back to app」: the package's one app.
    const back = within(strip).getByTestId('studio-interfaces-retired-back');
    await waitFor(() => expect(back).toHaveAttribute('data-target', `/apps/${PKG}`));
    fireEvent.click(back);
    await screen.findByTestId('the-app');
    expect(where()).toBe(`/apps/${PKG}`);
  });

  it('a `?surface=` deep link lands on the same home, its retired parameter dropped', async () => {
    renderAt(`/studio/${PKG}/interfaces?surface=${encodeURIComponent('page:home')}`);
    await screen.findByTestId('studio-shell-header');
    expect(where()).toBe(`/studio/${PKG}/data`);
    expect(await screen.findByTestId('studio-interfaces-retired')).toBeInTheDocument();
  });

  it('`?changes=review` travels with it: the drawer is the surface\'s, not the pillar\'s', async () => {
    // The surface opens the drawer from `?changes=` and then drops the
    // parameter, so the URL settles on the Data pillar either way. The target
    // that carries it is `studioInterfacesRetired.test`'s; the drawer opening
    // on an old link, with the real drawer mounted, is `copilotDoors-12894`'s.
    renderAt(`/studio/${PKG}/interfaces?surface=${encodeURIComponent('page:home')}&changes=review`);
    await screen.findByTestId('studio-shell-header');
    expect(pathname()).toBe(`/studio/${PKG}/data`);
    expect(where()).not.toContain('surface=page');
    expect(await screen.findByTestId('studio-interfaces-retired')).toBeInTheDocument();
  });

  it('Dismiss hides the notice, and the author stays on the home', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    const strip = await screen.findByTestId('studio-interfaces-retired');
    fireEvent.click(within(strip).getByRole('button', { name: t('engine.studio.interfacesRetired.dismiss', 'en') }));
    await waitFor(() => expect(notice()).toBeNull());
    expect(pathname()).toBe(`/studio/${PKG}/data`);
  });

  it('the notice outlasts the Data pillar opening its first object (a `?surface=` written with no state)', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    await screen.findByTestId('studio-interfaces-retired');
    await waitFor(() => expect(where()).toContain('surface='));
    expect(screen.getByTestId('studio-interfaces-retired')).toBeInTheDocument();
  });

  it('leaving for another pillar takes the notice away, and coming back does not bring it', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    await screen.findByTestId('studio-interfaces-retired');
    const nav = screen.getByTestId('studio-pillar-nav');
    fireEvent.click(within(nav).getByRole('link', { name: 'Automations' }));
    await waitFor(() => expect(pathname()).toBe(`/studio/${PKG}/automations`));
    expect(notice()).toBeNull();
    fireEvent.click(within(nav).getByRole('link', { name: 'Data' }));
    await waitFor(() => expect(pathname()).toBe(`/studio/${PKG}/data`));
    expect(notice()).toBeNull();
  });

  it('the pillar nav names no Interfaces segment', async () => {
    renderAt(`/studio/${PKG}/interfaces`);
    await screen.findByTestId('studio-shell-header');
    const nav = screen.getByTestId('studio-pillar-nav');
    expect(within(nav).getAllByRole('link').map((a) => a.getAttribute('href'))).not.toContain(`/studio/${PKG}/interfaces`);
    expect(within(nav).getAllByRole('link').map((a) => a.textContent)).not.toContain('Interfaces');
  });

  it('CONTROL: an ordinary arrival on the Data pillar shows no notice', async () => {
    renderAt(`/studio/${PKG}/data`);
    await screen.findByTestId('studio-shell-header');
    expect(where()).toBe(`/studio/${PKG}/data`);
    expect(notice()).toBeNull();
  });
});
