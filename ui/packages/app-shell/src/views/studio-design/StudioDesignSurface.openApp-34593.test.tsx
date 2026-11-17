// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34593 — the Studio workbench and the running app, both ways.
 *
 *  1. The header offers "Open app", the mirror of the app bar's
 *     Edit app: from the object in focus (`?surface=object:<name>`, the
 *     target Edit app hands Studio) it lands on that object's list in the
 *     app; with no surface in focus it lands on the app's home. A package
 *     with several published apps offers a choice; a package whose only app
 *     is still a draft offers nothing (no running front-end yet).
 *  2. The package switcher offers business packages only (ADR-0016 §3.8 —
 *     "you cannot author into a kernel package"): the kernel rows the
 *     registry half serves with a flat `scope` are hidden too, while the list
 *     keeps them tagged `kernel` for the app → Studio entry gate. No toggle
 *     shows them.
 *
 * The REAL `StudioDesignSurface` and metadata client over a fetch stub that
 * serves the package list, the package's apps and objects. The running app is
 * a route that prints where the author landed.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
// The surface's reach loads `@objectstack/lint` lazily; pay that load during
// collection, not inside a case's clocked window (`check:test-source-alias`).
import '@objectstack/lint';

const OWN = 'com.example.sales';
const FLAT_KERNEL = 'sys.env-artifact-cache';
const MANIFEST_KERNEL = 'com.objectstack.plugin-auth';

const srv = vi.hoisted(() => ({
  apps: [] as Array<Record<string, unknown>>,
  appDrafts: [] as Array<Record<string, unknown>>,
}));

vi.mock('@object-ui/react', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAdapter: () => ({}) };
});
vi.mock('sonner', () => ({
  toast: { warning: vi.fn(), error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), dismiss: vi.fn() },
  Toaster: () => null,
}));
vi.mock('../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));
vi.mock('../metadata-admin/AccessExplainPanel', () => ({ AccessExplainPanel: () => null }));
vi.mock('./StudioAiCopilot', () => ({ StudioChatDock: () => null }));
vi.mock('../../preview/DraftChangesPanel', () => ({ DraftChangesPanel: () => null }));

import { StudioDesignSurface } from './StudioDesignSurface';
import { studioOpenAppPath } from './StudioOpenApp';
import { offeredPackages } from './PackageSwitcher';
import { parsePackages } from './packages-io';

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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** `GET /api/v1/packages` as both producers serve it: the durable half nested, the registry half flat. */
const PACKAGE_LIST = {
  success: true,
  data: [
    { id: FLAT_KERNEL, name: 'Environment artifact cache', scope: 'system', writable: false },
    { manifest: { id: MANIFEST_KERNEL, name: 'Authentication', scope: 'system' }, writable: false },
    { manifest: { id: OWN, name: 'Sales', namespace: 'sales', version: '0.1.0' }, writable: true },
  ],
};

const SALES_APP = { name: 'sales', label: 'Sales', navigation: [{ id: 'nav_opp', type: 'object', objectName: 'opportunity' }] };
const SERVICE_APP = { name: 'service', label: 'Service desk', navigation: [] };

beforeEach(() => {
  srv.apps = [SALES_APP];
  srv.appDrafts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input), 'http://localhost');
      const path = url.pathname;
      if (path === '/api/v1/packages') return json(PACKAGE_LIST);
      if (path === '/api/v1/meta/_drafts') {
        return json({ drafts: url.searchParams.get('type') === 'app' ? srv.appDrafts : [] });
      }
      if (path === '/api/v1/meta/app') return json(srv.apps);
      if (path === '/api/v1/meta/object') {
        return json([
          { name: 'opportunity', label: 'Opportunity', fields: {} },
          { name: 'account', label: 'Account', fields: {} },
        ]);
      }
      if (path.endsWith('/layers')) return json({ code: null, overlay: null, overlayScope: null, effective: null });
      if (/^\/api\/v1\/meta\/[^/]+\/[^/]+$/.test(path)) return json({}, 404);
      return json([]);
    }) as unknown as typeof fetch,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function RunningApp() {
  const location = useLocation();
  return <p data-testid="running-app">{location.pathname}</p>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/studio/:packageId/:tab" element={<StudioDesignSurface />} />
        <Route path="/apps/*" element={<RunningApp />} />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('studio-shell-header');

describe('Open app returns from the workbench to the running app (objectstack#34593)', () => {
  it('from the Opportunity in focus, Open app lands back on the Opportunity list', async () => {
    renderAt(`/studio/${OWN}/data?surface=object:opportunity`);
    const button = await within(header()).findByTestId('studio-open-app', undefined, { timeout: 8000 });
    expect(button).toHaveAccessibleName('Open app');
    fireEvent.click(button);
    expect(await screen.findByTestId('running-app')).toHaveTextContent(`/apps/${OWN}/opportunity`);
  });

  it('with no surface in focus, it lands on the app home', async () => {
    renderAt(`/studio/${OWN}/access`);
    fireEvent.click(await within(header()).findByTestId('studio-open-app', undefined, { timeout: 8000 }));
    expect(await screen.findByTestId('running-app')).toHaveTextContent(new RegExp(`^/apps/${OWN.replace(/\./g, '\\.')}$`));
  });

  it('a package with several apps offers a choice, and each lands under its own address', async () => {
    srv.apps = [SALES_APP, SERVICE_APP];
    renderAt(`/studio/${OWN}/data?surface=object:opportunity`);
    fireEvent.click(await within(header()).findByTestId('studio-open-app', undefined, { timeout: 8000 }));
    const menu = await screen.findByTestId('studio-open-app-menu');
    const rows = within(menu).getAllByTestId('studio-open-app-row');
    expect(rows.map((r) => r.textContent)).toEqual(['Sales', 'Service desk']);
    fireEvent.click(rows[1]!);
    expect(await screen.findByTestId('running-app')).toHaveTextContent('/apps/service/opportunity');
  });

  it('a package whose only app is a draft offers no Open app (nothing runs yet)', async () => {
    srv.apps = [];
    srv.appDrafts = [{ name: 'sales', label: 'Sales', type: 'app' }];
    renderAt(`/studio/${OWN}/data`);
    await waitFor(() => expect(within(header()).getByTestId('studio-pkg-chip')).toHaveAttribute('data-pkg-list-state', 'loaded'), {
      timeout: 8000,
    });
    // The draft app is resolved (the header's create-app slot reads it), and still no way out is drawn.
    await waitFor(() => expect(within(header()).queryByRole('button', { name: /Create app/ })).toBeNull());
    expect(within(header()).queryByTestId('studio-open-app')).toBeNull();
  });

  it('the path mirrors the app bar\'s Edit app targets: object list, interface page, else app home', () => {
    const one = [{ name: 'sales', label: 'Sales' }];
    const two = [...one, { name: 'service', label: 'Service' }];
    expect(studioOpenAppPath(OWN, one, 'sales', { type: 'object', name: 'opportunity' })).toBe(`/apps/${OWN}/opportunity`);
    expect(studioOpenAppPath(OWN, one, 'sales', { type: 'dashboard', name: 'pipeline' })).toBe(`/apps/${OWN}/dashboard/pipeline`);
    expect(studioOpenAppPath(OWN, one, 'sales', { type: 'flow', name: 'close_won' })).toBe(`/apps/${OWN}`);
    expect(studioOpenAppPath(OWN, one, 'sales', null)).toBe(`/apps/${OWN}`);
    expect(studioOpenAppPath(OWN, two, 'service', { type: 'object', name: 'opportunity' })).toBe('/apps/service/opportunity');
  });
});

describe('the package switcher offers business packages only (objectstack#34593, ADR-0016 §3.8)', () => {
  it('no kernel row in the menu — neither the manifest-scoped one nor the one served with a flat `scope`', async () => {
    renderAt(`/studio/${OWN}/access`);
    const chip = await within(header()).findByTestId('studio-pkg-chip', undefined, { timeout: 8000 });
    await waitFor(() => expect(chip).toHaveAttribute('data-pkg-list-state', 'loaded'), { timeout: 8000 });
    fireEvent.click(chip);
    const menu = await screen.findByRole('dialog');
    const rows = within(menu).getAllByTestId('studio-switcher-row').map((r) => r.getAttribute('data-package'));
    expect(rows).toEqual([OWN]);
    expect(within(menu).queryByText(FLAT_KERNEL)).toBeNull();
    expect(within(menu).queryByText(/show system/i)).toBeNull();
  });

  it('CONTROL — the list itself keeps the flat kernel row, tagged, for the app → Studio entry gate', () => {
    const listed = parsePackages(PACKAGE_LIST);
    expect(listed.map((p) => [p.id, p.kernel ?? false])).toEqual([
      [FLAT_KERNEL, true],
      [OWN, false],
    ]);
    expect(offeredPackages(listed)?.map((p) => p.id)).toEqual([OWN]);
    expect(offeredPackages(null)).toBeNull();
  });
});
