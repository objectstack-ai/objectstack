// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Installed Apps opens this page with `?source=marketplace`
 * (objectui#13356): the nav item declares
 * `{ type: 'component', componentRef: 'developer:packages', params: { source: 'marketplace' } }`
 * and the sidebar sends a component item's `params` as the query string.
 *
 * - That view is titled "Installed Apps", the entry that opened it.
 * - With no marketplace install, its empty state says no app is installed
 *   from the marketplace yet, not that filters match nothing.
 * - "No packages match your filters." stays for a filter the viewer set: the
 *   search hiding the marketplace installs that exist, or another Source.
 * - Setup → Packages (no `source`) keeps its title and empty states.
 *
 * The wire is stubbed (`fetch`), the runtime config is the real module booted
 * over a served body, and `marketplaceApi` is not mocked.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

import { resolveHref } from '@object-ui/layout';
import { PackagesPage, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

const CODE: InstalledPackageRow = {
  manifest: { id: 'com.acme.code', name: 'Code App', version: '1.0.0', scope: 'project' },
  enabled: true,
  source: 'code',
  writable: false,
};
const MARKET: InstalledPackageRow = {
  manifest: { id: 'com.example.todo', name: 'Todo', version: '1.0.0' },
  enabled: true,
  source: 'marketplace',
  writable: false,
};
const AUTHORED: InstalledPackageRow = {
  manifest: { id: 'app.b2r4', name: 'My Base' },
  enabled: true,
  source: 'authored',
  writable: true,
};
const LEDGER_TODO = {
  packageId: 'com.example.todo',
  versionId: 'ver_todo_1',
  manifestId: 'com.example.todo',
  version: '1.0.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  withSampleData: true,
};

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let packagesRead = false;

/** Boot the real runtime config with the marketplace capability, then serve the package doors. */
async function serve(packages: unknown[], ledger: unknown[] = []) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true } })));
  await initRuntimeConfig();
  packagesRead = false;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/packages') {
        packagesRead = true;
        return reply(200, { success: true, data: { packages } });
      }
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return reply(200, { success: true, data: { items: ledger } });
      }
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
}

const SETUP_BASE = '/apps/setup';
/** Setup's Installed Apps entry as objectstack declares it. */
const INSTALLED_APPS_ITEM = {
  id: 'nav_installed_apps',
  type: 'component',
  label: 'Installed Apps',
  componentRef: 'developer:packages',
  params: { source: 'marketplace' },
} as const;
const PACKAGES_PATH = `${SETUP_BASE}/component/developer/packages`;

const LOCALE = { en: 'en-US', zh: 'zh-CN' } as const;
type Lang = keyof typeof LOCALE;

function renderAt(url: string, lang: Lang = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[url]}>
        <PackagesPage />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The URL the Installed Apps nav entry opens. */
function installedAppsUrl(): string {
  return resolveHref(INSTALLED_APPS_ITEM as never, SETUP_BASE).href;
}

const row = (key: string, lang: Lang = 'en') => t(key, LOCALE[lang]);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Setup → Installed Apps (objectui#13356)', () => {
  it('the Installed Apps entry opens this page with `?source=marketplace`', () => {
    expect(installedAppsUrl()).toBe(`${PACKAGES_PATH}?source=marketplace`);
  });

  it('is titled "Installed Apps", not "Packages"', async () => {
    await serve([CODE, MARKET, AUTHORED], [LEDGER_TODO]);
    renderAt(installedAppsUrl());

    expect(await screen.findByRole('heading', { name: row('engine.packages.installedApps.title') })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: row('engine.packages.title') })).toBeNull();
    expect(await screen.findByTestId('pkg-row-com.example.todo')).toBeInTheDocument();
  });

  it.each([
    ['other packages are installed', [CODE, AUTHORED]],
    ['nothing is installed', []],
  ])('with no marketplace install (%s) it says no app is installed from the marketplace yet', async (_label, packages) => {
    await serve(packages);
    renderAt(installedAppsUrl());

    const empty = await screen.findByTestId('packages-installed-apps-empty');
    expect(empty).toHaveTextContent(row('engine.packages.installedApps.empty'));
    expect(screen.queryByText(row('engine.packages.emptyFiltered'))).toBeNull();
    expect(screen.queryByText(row('engine.packages.emptyCreate'))).toBeNull();
    expect(screen.getByRole('heading', { name: row('engine.packages.installedApps.title') })).toBeInTheDocument();
  });

  it('a search that hides the marketplace installs that exist still says no package matches the filters', async () => {
    await serve([CODE, MARKET], [LEDGER_TODO]);
    renderAt(installedAppsUrl());

    await screen.findByTestId('pkg-row-com.example.todo');
    fireEvent.change(screen.getByPlaceholderText(row('engine.packages.search')), { target: { value: 'zzz' } });
    expect(await screen.findByText(row('engine.packages.emptyFiltered'))).toBeInTheDocument();
    expect(screen.queryByTestId('packages-installed-apps-empty')).toBeNull();
  });

  it('reads in zh-CN from the catalogue rows', async () => {
    for (const key of [
      'engine.packages.installedApps.title',
      'engine.packages.installedApps.empty',
      'engine.packages.installedApps.emptyHint',
    ]) {
      expect(row(key, 'zh'), `${key}: a missing zh row echoes the key back`).not.toBe(key);
      expect(row(key, 'zh'), `${key}: the zh row must not be the English one`).not.toBe(row(key));
    }
    await serve([CODE]);
    renderAt(installedAppsUrl(), 'zh');

    expect(await screen.findByRole('heading', { name: row('engine.packages.installedApps.title', 'zh') })).toBeInTheDocument();
    expect(await screen.findByTestId('packages-installed-apps-empty')).toHaveTextContent(
      row('engine.packages.installedApps.empty', 'zh'),
    );
  });
});

describe('Setup → Packages is unchanged (objectui#13356)', () => {
  it('with no `source` it is titled "Packages"', async () => {
    await serve([CODE, MARKET], [LEDGER_TODO]);
    renderAt(PACKAGES_PATH);

    expect(await screen.findByRole('heading', { name: row('engine.packages.title') })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: row('engine.packages.installedApps.title') })).toBeNull();
  });

  it('with nothing installed it offers to create the first package', async () => {
    await serve([]);
    renderAt(PACKAGES_PATH);
    await waitFor(() => expect(packagesRead).toBe(true));

    expect(await screen.findByText(row('engine.packages.emptyCreate'))).toBeInTheDocument();
    expect(screen.queryByTestId('packages-installed-apps-empty')).toBeNull();
  });

  it('another Source filter that matches nothing still says no package matches the filters', async () => {
    await serve([CODE, MARKET], [LEDGER_TODO]);
    renderAt(`${PACKAGES_PATH}?source=authored`);

    expect(await screen.findByText(row('engine.packages.emptyFiltered'))).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: row('engine.packages.title') })).toBeInTheDocument();
    expect(screen.queryByTestId('packages-installed-apps-empty')).toBeNull();
  });
});
