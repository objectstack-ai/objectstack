// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#26892 — the app's report index lists a report the navigation
 * names only when the member is shown an entry naming it.
 *
 * The index listed every report the app's package owns that the member may
 * read, so a report whose navigation entry the sidebar hid from the persona
 * (HotCRM's `visible: OPPORTUNITY_AUDIENCE`) was still listed, and opened to
 * "no rows". Now a report that entries name is listed only when the sidebar's
 * own gates (`useNavMemberGates`, `navEntriesShownToMember`) show the member
 * at least one of them; a report no entry names keeps the read rule alone.
 *
 * Pinned through the real `MetadataProvider`, `MePermissionsProvider`,
 * `ExpressionProvider` and `I18nProvider`, as the objectui#13020 suite is. The
 * package owns Alpha, Beta and Gamma, which the navigation names, and Delta,
 * which it does not; every dataset reads an object the member may read, so
 * the navigation is the only gate in play:
 *
 *  (a) Gamma's entry is `visible: false`: the index and the ⌘K palette list
 *      Alpha, Beta and Delta, not Gamma;
 *  (b) Gamma's entry requires a permission the member lacks: the index leaves
 *      it out; a member granted it lists all four;
 *  (c) Gamma's entry sits in a `visible: false` group: the index leaves it out;
 *  (d) Gamma's entry binds an API read that has not answered: it is hidden,
 *      as the sidebar hides the entry;
 *  (e) CONTROLS: an entry `visible: true` lists Gamma; a second entry the
 *      member is shown lists Gamma beside a hidden one; an app whose
 *      navigation names no report lists all four.
 *
 * The palette's navigation entries take the same gates (its own `navItems`,
 * the door a nav-named report is offered through): before, it filtered the
 * flattened leaves by their own `visible` only, so (b) and (c) were offered
 * through that door, and so was an object entry the sidebar hides:
 *
 *  (f) neither palette door offers Gamma under (b) or (c), nor an object
 *      entry whose `requiredPermissions` the member lacks;
 *  (g) an entry's API binding is read once with the sidebar mounted beside
 *      the palette: one reader per binding, no second request.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { createI18n, I18nProvider } from '@object-ui/i18n';
import { MePermissionsProvider, type MePermissionsResponse } from '@object-ui/permissions';
import { SchemaRendererContext, type ApiFetch } from '@object-ui/react';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ user: { id: 'u_agent' }, activeOrganization: null }),
}));

import { MetadataProvider } from '../../providers/MetadataProvider';
import { navEntriesShownToMember, useNavMemberGates } from '../../hooks/useNavMemberGates';
import type { NavigationItem } from '@object-ui/types';
import { ExpressionProvider } from '../../providers/ExpressionProvider';
import { CommandPalette } from '../../chrome/CommandPalette';
import { CommandPaletteProvider } from '../../context/CommandPaletteProvider';
import { AppReportIndexView } from '../AppReportIndexView';

const PKG = 'com.example.crm';

const REPORTS = [
  { name: 'rpt_alpha', label: 'Alpha', dataset: 'ds_accounts', _packageId: PKG },
  { name: 'rpt_beta', label: 'Beta', dataset: 'ds_accounts', _packageId: PKG },
  { name: 'rpt_gamma', label: 'Gamma', dataset: 'ds_accounts', _packageId: PKG },
  // Owned, and named by no navigation entry.
  { name: 'rpt_delta', label: 'Delta', dataset: 'ds_accounts', _packageId: PKG },
];

const DATASETS = [{ name: 'ds_accounts', object: 'crm_account' }];

const ALL = ['Alpha', 'Beta', 'Delta', 'Gamma'];
const WITHOUT_GAMMA = ['Alpha', 'Beta', 'Delta'];

type Entry = Record<string, unknown>;

/** The app: entries for Alpha and Beta, then `gamma` (one entry or several). */
function appWith(...gamma: Entry[]) {
  return {
    name: 'crm',
    label: 'CRM',
    active: true,
    _packageId: PKG,
    navigation: [
      { id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' },
      { id: 'nav_alpha', type: 'report', reportName: 'rpt_alpha', label: 'Alpha' },
      { id: 'nav_beta', type: 'report', reportName: 'rpt_beta', label: 'Beta' },
      ...gamma,
    ],
  };
}

const gammaEntry = (extra: Entry = {}): Entry => ({
  id: 'nav_gamma',
  type: 'report',
  reportName: 'rpt_gamma',
  label: 'Gamma',
  ...extra,
});

function answer(forecastRead: boolean): MePermissionsResponse {
  return {
    authenticated: true,
    userId: 'u_agent',
    tenantId: null,
    roles: [],
    permissionSets: ['service_agent'],
    systemPermissions: [],
    objects: {
      crm_account: { allowRead: true },
      crm_forecast: { allowRead: forecastRead },
    },
    fields: {},
  };
}

function adapterFor(app: unknown) {
  const items: Record<string, unknown[]> = { app: [app], report: REPORTS, dataset: DATASETS };
  return {
    clearCache: vi.fn(),
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: (type: string) => Promise.resolve({ type, items: items[type] ?? [] }),
        getItem: () => Promise.resolve({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

interface ShellOptions {
  forecastRead?: boolean;
  apiFetch?: ApiFetch;
}

function shell(app: ReturnType<typeof appWith>, children: React.ReactNode, url: string, options: ShellOptions = {}) {
  const permissions = answer(options.forecastRead ?? false);
  const fetcher = vi.fn(async () => ({ ok: true, status: 200, json: async () => permissions }) as unknown as Response);
  const apiFetch = options.apiFetch ?? vi.fn<ApiFetch>(() => new Promise<Response>(() => {}));
  render(
    <I18nProvider instance={createI18n({ defaultLanguage: 'en', detectBrowserLanguage: false })} persistLanguage={false}>
      <SchemaRendererContext.Provider value={{ dataSource: null, apiFetch }}>
        <MePermissionsProvider endpoint="/api/v1/auth/me/permissions" fetcher={fetcher as unknown as typeof fetch}>
          <MetadataProvider adapter={adapterFor(app)}>
            <ExpressionProvider app={app}>
              <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>
            </ExpressionProvider>
          </MetadataProvider>
        </MePermissionsProvider>
      </SchemaRendererContext.Provider>
    </I18nProvider>,
  );
}

function renderIndex(app: ReturnType<typeof appWith>, options?: ShellOptions) {
  shell(
    app,
    <Routes>
      <Route path="/apps/:appName/reports" element={<AppReportIndexView />} />
    </Routes>,
    '/apps/crm/reports',
    options,
  );
}

function renderPalette(app: ReturnType<typeof appWith>, options?: ShellOptions) {
  shell(
    app,
    <CommandPaletteProvider>
      <Routes>
        <Route
          path="/apps/:appName"
          element={<CommandPalette apps={[app]} activeApp={app} objects={[]} onAppChange={() => {}} />}
        />
      </Routes>
    </CommandPaletteProvider>,
    '/apps/crm?palette=1',
    options,
  );
}

/** The labels the index lists, sorted. */
function indexed(): string[] {
  return screen
    .queryAllByRole('link')
    .map((a) => a.textContent ?? '')
    .sort();
}

/** The labels of every report item the palette rendered, through either door, sorted. */
function paletteReports(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="report "]'))
    .map((el) => (el.textContent ?? '').trim())
    .sort();
}

/** The index has listed Delta, the report no gate can hide: its lists have answered. */
async function indexSettled() {
  await screen.findByRole('link', { name: 'Delta' });
}

async function paletteSettled() {
  await waitFor(() => expect(paletteReports()).toContain('Delta'));
}

beforeEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe('the report index applies the navigation\'s member gates (objectstack#26892)', () => {
  it('(a) leaves out a report whose only entry is `visible: false`', async () => {
    renderIndex(appWith(gammaEntry({ visible: false })));
    await indexSettled();
    expect(indexed()).toEqual(WITHOUT_GAMMA);
  });

  it('(b) leaves out a report whose entry requires a permission the member lacks', async () => {
    renderIndex(appWith(gammaEntry({ requiredPermissions: ['crm_forecast:read'] })));
    await indexSettled();
    expect(indexed()).toEqual(WITHOUT_GAMMA);
  });

  it('(b) CONTROL: lists it for a member granted that permission', async () => {
    renderIndex(appWith(gammaEntry({ requiredPermissions: ['crm_forecast:read'] })), { forecastRead: true });
    await screen.findByRole('link', { name: 'Gamma' });
    expect(indexed()).toEqual(ALL);
  });

  it('(c) leaves out a report whose entry sits in a `visible: false` group', async () => {
    renderIndex(
      appWith({ id: 'grp_forecast', type: 'group', label: 'Forecast', visible: false, children: [gammaEntry()] }),
    );
    await indexSettled();
    expect(indexed()).toEqual(WITHOUT_GAMMA);
  });

  it('(d) hides a report whose entry\'s API read has not answered, as the sidebar hides the entry', async () => {
    const apiFetch = vi.fn<ApiFetch>(() => new Promise<Response>(() => {}));
    const dataSource = { provider: 'api', read: { url: '/api/v1/nav-probe/26892-pending' } };
    renderIndex(appWith(gammaEntry({ visible: 'data.total == 1', dataSource })), { apiFetch });
    await indexSettled();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(indexed()).toEqual(WITHOUT_GAMMA);
  });

  it('(e) CONTROL: an entry `visible: true` lists the report', async () => {
    renderIndex(appWith(gammaEntry({ visible: true })));
    await screen.findByRole('link', { name: 'Gamma' });
    expect(indexed()).toEqual(ALL);
  });

  it('(e) CONTROL: one entry the member is shown is enough, beside a hidden one', async () => {
    renderIndex(appWith(gammaEntry({ visible: false }), gammaEntry({ id: 'nav_gamma_2' })));
    await screen.findByRole('link', { name: 'Gamma' });
    expect(indexed()).toEqual(ALL);
  });

  it('(e) CONTROL: an app whose navigation names no report lists every report it owns', async () => {
    const app = { ...appWith(), navigation: [{ id: 'nav_accounts', type: 'object', objectName: 'crm_account', label: 'Accounts' }] };
    renderIndex(app);
    await screen.findByRole('link', { name: 'Gamma' });
    expect(indexed()).toEqual(ALL);
  });
});

describe('⌘K applies the same gates to the app\'s reports (objectstack#26892)', () => {
  it('(a) offers Alpha, Beta and Delta, not a report whose only entry is `visible: false`', async () => {
    renderPalette(appWith(gammaEntry({ visible: false })));
    await paletteSettled();
    expect(paletteReports()).toEqual(WITHOUT_GAMMA);
  });

  it('(d) does not offer a report whose entry\'s API read has not answered', async () => {
    const apiFetch = vi.fn<ApiFetch>(() => new Promise<Response>(() => {}));
    const dataSource = { provider: 'api', read: { url: '/api/v1/nav-probe/26892-pending-palette' } };
    renderPalette(appWith(gammaEntry({ visible: 'data.total == 1', dataSource })), { apiFetch });
    await paletteSettled();
    await waitFor(() => expect(apiFetch).toHaveBeenCalled());
    expect(paletteReports()).toEqual(WITHOUT_GAMMA);
  });

  it('(e) CONTROL: offers the report, once, when its entry is shown', async () => {
    renderPalette(appWith(gammaEntry({ visible: true })));
    await paletteSettled();
    expect(paletteReports()).toEqual(ALL);
  });
});

/** The sidebar's walk, as `UnifiedSidebar` takes it: the labels of the entries it shows, depth-first. */
function SidebarProbe({ items }: { items: NavigationItem[] }) {
  const gates = useNavMemberGates();
  const labels: string[] = [];
  const walk = (list: NavigationItem[]) => {
    for (const item of list) {
      if (item.type === 'group' && Array.isArray(item.children)) walk(item.children);
      else labels.push(String(item.label));
    }
  };
  walk(navEntriesShownToMember(items, gates));
  return <div data-testid="sidebar-probe">{labels.join('|')}</div>;
}

function renderPaletteBesideSidebar(app: ReturnType<typeof appWith>, options?: ShellOptions) {
  shell(
    app,
    <CommandPaletteProvider>
      <Routes>
        <Route
          path="/apps/:appName"
          element={
            <>
              <SidebarProbe items={app.navigation as NavigationItem[]} />
              <CommandPalette apps={[app]} activeApp={app} objects={[]} onAppChange={() => {}} />
            </>
          }
        />
      </Routes>
    </CommandPaletteProvider>,
    '/apps/crm?palette=1',
    options,
  );
}

/** The labels of every object item the palette rendered. */
function paletteObjects(): string[] {
  return Array.from(document.querySelectorAll('[cmdk-item][data-value^="object "]')).map((el) =>
    (el.textContent ?? '').trim(),
  );
}

describe('⌘K offers its navigation entries as the sidebar shows them (objectstack#26892)', () => {
  it('(f) offers neither door to a report whose entry requires a permission the member lacks', async () => {
    renderPalette(appWith(gammaEntry({ requiredPermissions: ['crm_forecast:read'] })));
    await paletteSettled();
    expect(paletteReports()).toEqual(WITHOUT_GAMMA);
  });

  it('(f) CONTROL: offers it, once, to a member granted that permission', async () => {
    renderPalette(appWith(gammaEntry({ requiredPermissions: ['crm_forecast:read'] })), { forecastRead: true });
    await waitFor(() => expect(paletteReports()).toContain('Gamma'));
    expect(paletteReports()).toEqual(ALL);
  });

  it('(f) offers neither door to a report whose entry sits in a `visible: false` group', async () => {
    renderPalette(
      appWith({ id: 'grp_forecast', type: 'group', label: 'Forecast', visible: false, children: [gammaEntry()] }),
    );
    await paletteSettled();
    expect(paletteReports()).toEqual(WITHOUT_GAMMA);
  });

  it('(f) does not offer an object entry the sidebar hides by `requiredPermissions`', async () => {
    const forecasts = {
      id: 'nav_forecasts',
      type: 'object',
      objectName: 'crm_account',
      label: 'Forecasts',
      requiredPermissions: ['crm_forecast:read'],
    };
    renderPalette(appWith(forecasts));
    await paletteSettled();
    expect(paletteObjects()).toEqual(['Accounts']);
  });

  it('(g) reads an entry\'s API binding once with the sidebar beside the palette, and both show it', async () => {
    const url = '/api/v1/nav-probe/26892-shared';
    const apiFetch = vi.fn<ApiFetch>(
      async () => ({ ok: true, status: 200, json: async () => ({ total: 1 }) }) as unknown as Response,
    );
    const dataSource = { provider: 'api', read: { url } };
    renderPaletteBesideSidebar(appWith(gammaEntry({ visible: 'data.total == 1', dataSource })), { apiFetch });
    await waitFor(() => expect(paletteReports()).toEqual(ALL));
    expect(screen.getByTestId('sidebar-probe')).toHaveTextContent('Gamma');
    expect(apiFetch.mock.calls.filter(([asked]) => asked === url)).toHaveLength(1);
  });
});
