// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36501 — the Studio top bar's left end is 「‹ Back to app」, the
 * app's name and the Studio mark; the Studio-home button, the package switcher
 * and the top-right Open app are gone.
 *
 *  1. Entered from one of the package's apps (the app layout recorded the
 *     page, as `ConsoleLayout` does on every app route), the link names that
 *     app and returns to that very page, query included. A recorded page of
 *     another package's app is not it: the epic's decision 5 (objectstack
 *     #36890, #36899) names the current package's app, never the remembered
 *     one, so the link reads as 2.
 *  2. Opened directly (no record), it names the package's published app and
 *     lands on its first screen; with several apps, the first, by its name.
 *  3. A package with no published app (none, or only a draft) goes to the
 *     console's apps home (`useHomePath`, the launcher); with no app to name,
 *     the name slot names the package instead (objectstack#36748, the
 *     maintainer's decision-5 ruling on #36899).
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
// objectstack#36900 — the surface mounts the command palette, which reaches the
// record preview's `lazy()` detail entry: its first load is paid at collection too.
import '@object-ui/plugin-detail';

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
import { StudioPillarRedirect } from './StudioPillarRedirect';
import { studioBackTarget } from './StudioBackToApp';
import { rememberAppReturnPage, resetAppReturnPageForTests } from '../../utils/appReturnPage';
import { parsePackages } from './packages-io';
import { STUDIO_HEADER_PACKAGE_COLUMN } from './studio-tokens';

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
  resetAppReturnPageForTests();
});

function RunningApp() {
  const location = useLocation();
  return <p data-testid="running-app">{`${location.pathname}${location.search}`}</p>;
}

function Elsewhere() {
  const location = useLocation();
  return <p data-testid="elsewhere">{location.pathname}</p>;
}

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/studio/:packageId/metadata/*" element={<StudioDesignSurface area="metadata" />} />
        <Route path="/studio/:packageId/:tab" element={<StudioPillarRedirect><StudioDesignSurface /></StudioPillarRedirect>} />
        <Route path="/apps/*" element={<RunningApp />} />
        <Route path="*" element={<Elsewhere />} />
      </Routes>
    </MemoryRouter>,
  );
}

const header = () => screen.getByTestId('studio-shell-header');
const backLink = () => within(header()).findByTestId('studio-back-to-app', undefined, { timeout: 8000 });

describe('「‹ Back to app」 returns to the app page the author came from (objectstack#36501)', () => {
  it('names the app the author came from and returns to that page, query kept', async () => {
    rememberAppReturnPage({ path: `/apps/${OWN}/opportunity?view=open`, app: 'sales', label: 'Sales' });
    renderAt(`/studio/${OWN}/data?surface=object:opportunity`);
    const link = await backLink();
    expect(link).toHaveAccessibleName('Back to app');
    expect(within(header()).getByTestId('studio-back-app-name')).toHaveTextContent('Sales');
    expect(within(header()).getByTestId('studio-mark')).toHaveTextContent(/^App Studio$/);
    expect(within(header()).getByTestId('studio-back')).toHaveTextContent(/^Back to app·Sales·App Studio$/);
    fireEvent.click(link);
    expect(await screen.findByTestId('running-app')).toHaveTextContent(`/apps/${OWN}/opportunity?view=open`);
  });

  it('a page of another package\'s app is not named: the current package\'s app is (decision 5, objectstack#36899)', async () => {
    rememberAppReturnPage({ path: '/apps/service/opportunity', app: 'service', label: 'Service desk' });
    renderAt(`/studio/${OWN}/data`);
    const link = await backLink();
    // Read the name while the header is still on screen; the click leaves Studio.
    await waitFor(() => expect(within(header()).getByTestId('studio-back-app-name')).toHaveTextContent('Sales'), {
      timeout: 8000,
    });
    fireEvent.click(link);
    expect(await screen.findByTestId('running-app')).toHaveTextContent(new RegExp(`^/apps/${OWN.replace(/\./g, '\\.')}$`));
  });
});

describe('opened directly, 「‹ Back to app」 lands on the package app\'s first screen (objectstack#36501)', () => {
  it('names the published app and lands on its home, whatever is in focus', async () => {
    renderAt(`/studio/${OWN}/data?surface=object:opportunity`);
    await waitFor(() => expect(within(header()).getByTestId('studio-back-app-name')).toHaveTextContent('Sales'), {
      timeout: 8000,
    });
    fireEvent.click(await backLink());
    expect(await screen.findByTestId('running-app')).toHaveTextContent(new RegExp(`^/apps/${OWN.replace(/\./g, '\\.')}$`));
  });

  it('with several published apps, the first, addressed by its name', async () => {
    srv.apps = [SERVICE_APP, SALES_APP];
    renderAt(`/studio/${OWN}/owd`);
    await waitFor(() => expect(within(header()).getByTestId('studio-back-app-name')).toHaveTextContent('Service desk'), {
      timeout: 8000,
    });
    fireEvent.click(await backLink());
    expect(await screen.findByTestId('running-app')).toHaveTextContent(/^\/apps\/service$/);
  });
});

describe('a package with no app: 「‹ Back to app」 names the package and goes to the default landing (objectstack#36501, objectstack#36748)', () => {
  it('no app at all: the package is named, and the link goes to the console landing', async () => {
    srv.apps = [];
    renderAt(`/studio/${OWN}/data`);
    const link = await backLink();
    // Settled: the header has read the package's apps (it offers Create app).
    await within(header()).findByRole('button', { name: /Create app/ }, { timeout: 8000 });
    // objectstack#36748 — the name slot names the open package, by its label.
    const name = await within(header()).findByTestId('studio-back-app-name', undefined, { timeout: 8000 });
    expect(name).toHaveAttribute('data-names', 'package');
    expect(within(header()).getByTestId('studio-back')).toHaveTextContent(/^Back to app·Sales·App Studio$/);
    fireEvent.click(link);
    expect(await screen.findByTestId('elsewhere')).toHaveTextContent('/home');
  });

  it('a draft-only app counts as none: nothing runs yet', async () => {
    srv.apps = [];
    srv.appDrafts = [{ name: 'sales', label: 'Sales', type: 'app' }];
    renderAt(`/studio/${OWN}/data`);
    const link = await backLink();
    // The draft app is resolved (the header's create-app slot reads it) ...
    await waitFor(() => expect(within(header()).queryByRole('button', { name: /Create app/ })).toBeNull(), { timeout: 8000 });
    // ... and still no app is named or opened: the slot names the package.
    expect(await within(header()).findByTestId('studio-back-app-name')).toHaveAttribute('data-names', 'package');
    fireEvent.click(link);
    expect(await screen.findByTestId('elsewhere')).toHaveTextContent('/home');
  });
});

describe('the controls the back link replaced are gone (objectstack#36501)', () => {
  it('no Studio-home button, no package switcher, no Open app', async () => {
    renderAt(`/studio/${OWN}/data`);
    await waitFor(() => expect(within(header()).getByTestId('studio-back-app-name')).toHaveTextContent('Sales'), {
      timeout: 8000,
    });
    for (const id of ['studio-home', 'studio-pkg-chip', 'studio-open-app']) {
      expect(within(header()).queryByTestId(id)).toBeNull();
    }
    expect(within(header()).queryByRole('button', { name: /Open app|Studio home/ })).toBeNull();
    expect(within(header()).queryByTitle(/Switch \/ create package/)).toBeNull();
  });
});

describe('on a narrow bar the app name gives way, nothing else (objectstack#36501, objectui#12611)', () => {
  it('the column is the container; the name truncates; the link and the mark keep their width', async () => {
    renderAt(`/studio/${OWN}/data`);
    const name = await within(header()).findByTestId('studio-back-app-name', undefined, { timeout: 8000 });
    const column = header().children[0] as HTMLElement;
    expect(column).toHaveClass(STUDIO_HEADER_PACKAGE_COLUMN);
    expect(column.contains(name)).toBe(true);
    expect(name).toHaveClass('min-w-0', 'truncate');
    expect(within(header()).getByTestId('studio-back-to-app')).toHaveClass('shrink-0');
    expect(within(header()).getByTestId('studio-mark')).toHaveClass('shrink-0');
    expect(within(header()).getByTestId('studio-back')).toHaveClass('min-w-0', 'whitespace-nowrap');
  });
});

describe('studioBackTarget — the order of the three answers (objectstack#36501)', () => {
  const sales = { name: 'sales', label: 'Sales' };
  const service = { name: 'service', label: { en: 'Service', 'zh-CN': '服务台' } };
  const base = { packageId: OWN, locale: 'en-US', landingPath: '/landing' };
  it('a recorded page of one of the package\'s apps wins; one of another package\'s app does not (decision 5)', () => {
    const own = { path: '/apps/sales/y?z=1', app: 'sales', label: 'Sales (recorded)' };
    expect(studioBackTarget({ ...base, remembered: own, apps: [sales] })).toEqual({ path: '/apps/sales/y?z=1', appLabel: 'Sales' });
    // The package id is the route key of a package's one app.
    const byPackage = { path: `/apps/${OWN}/y`, app: OWN, label: 'Sales' };
    expect(studioBackTarget({ ...base, remembered: byPackage, apps: [sales] })).toEqual({ path: `/apps/${OWN}/y`, appLabel: 'Sales' });
    const foreign = { path: '/apps/x/y?z=1', app: 'x', label: 'X app' };
    expect(studioBackTarget({ ...base, remembered: foreign, apps: [sales] })).toEqual({ path: `/apps/${OWN}`, appLabel: 'Sales' });
  });
  it('no record: the package id addresses its one app; the name addresses the first of several', () => {
    expect(studioBackTarget({ ...base, remembered: null, apps: [sales] })).toEqual({ path: `/apps/${OWN}`, appLabel: 'Sales' });
    expect(studioBackTarget({ ...base, remembered: null, apps: [service, sales] })).toEqual({
      path: '/apps/service',
      appLabel: 'Service',
    });
  });
  it('no app, or the package-less scope: the apps home, unnamed, whatever is recorded', () => {
    const foreign = { path: '/apps/x/y', app: 'x', label: 'X app' };
    expect(studioBackTarget({ ...base, remembered: foreign, apps: [] })).toEqual({ path: '/landing', appLabel: null });
    expect(studioBackTarget({ ...base, remembered: null, apps: [] })).toEqual({ path: '/landing', appLabel: null });
    expect(studioBackTarget({ ...base, packageId: null, remembered: null, apps: [sales] })).toEqual({
      path: '/landing',
      appLabel: null,
    });
  });
});

describe('the package list keeps kernel rows tagged (objectstack#34593, ADR-0016 §3.8)', () => {
  it('the flat kernel row stays in the list, tagged, for the app → Studio entry gate', () => {
    const listed = parsePackages(PACKAGE_LIST);
    expect(listed.map((p) => [p.id, p.kernel ?? false])).toEqual([
      [FLAT_KERNEL, true],
      [OWN, false],
    ]);
  });
});
