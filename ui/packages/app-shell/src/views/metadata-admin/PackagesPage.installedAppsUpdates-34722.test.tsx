// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34722 — Setup → Installed Apps is the administrator's door to
 * this page (`?source=marketplace`), Studio → Packages the developer's (no
 * `source`; ADR-0146 D1, ruling 甲 on objectstack#25098).
 *
 * On the Setup door:
 *   - an installed app the catalog lists at a higher version draws the
 *     marketplace's own "Update available → vX" badge (`UpdateAvailableBadge`,
 *     decided by `updateTarget`), linked to the app's marketplace page, and the
 *     page says how many apps have a newer version;
 *   - an app that is up to date, or that the catalog does not list (404), has
 *     no badge;
 *   - a catalog that cannot be read — a failed read, or a runtime with no
 *     marketplace — leaves the list as it is and says the update information
 *     cannot be read, never drawing silence as "up to date";
 *   - the badge's words are the lazy `marketplace` namespace's: while it loads
 *     the Update cell holds a placeholder, and a namespace that cannot be
 *     fetched still shows the target version and the way to upgrade;
 *   - a module package (`type: 'module'` declaring its app in `dependencies`)
 *     is folded under that app's line and shown on demand;
 *   - the columns are Name, Version, Status, Source, Update, and the developer
 *     doors (Import, New Package, the platform switch, the Source chip's
 *     Show all) are not drawn.
 * On the Studio door all of the developer doors and columns stay, and the
 * catalog is never asked.
 *
 * The wire is stubbed (`fetch`), the runtime config is the real module booted
 * over a served body, and `marketplaceApi` is not mocked.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '@object-ui/i18n';

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

/** A namespace state a case forces; `null` = the real hook. */
const namespaceOverride = vi.hoisted(() => ({ state: null as null | { status: 'loading' | 'failed' } }));
vi.mock('@object-ui/i18n/namespaces/marketplace', async (importOriginal) => {
  const real = await importOriginal<typeof import('@object-ui/i18n/namespaces/marketplace')>();
  return {
    ...real,
    useMarketplaceNamespace: () => {
      const actual = real.useMarketplaceNamespace();
      return namespaceOverride.state ? { ...namespaceOverride.state, retry: () => {} } : actual;
    },
  };
});

import { PackagesPage, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';
// The page's package form reaches the CEL authoring helpers, which load these
// two lazily; loaded here so their first load is paid at import, not inside a
// test's clocked window.
import '@objectstack/formula';
import '@objectstack/lint';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';
// The designer rows (the page's own strings) and the marketplace catalogue
// (the badge's words) are both fetched on demand; resident before any case so
// a render reads them from its first paint.
import { loadStudioCatalogue } from '@object-ui/i18n/namespaces/studio';
import { loadMarketplaceCatalogue } from '@object-ui/i18n/namespaces/marketplace';
await loadStudioCatalogue('zh');
await loadMarketplaceCatalogue('en');
await loadMarketplaceCatalogue('zh-Hans');

const HOTCRM_ID = 'app.objectstack.hotcrm';
const MODULE_IDS = ['o2c', 'service', 'marketing', 'cpq'].map((m) => `${HOTCRM_ID}.${m}`);

const app = (id: string, name: string, version: string, extra: Partial<InstalledPackageRow> = {}): InstalledPackageRow => ({
  manifest: { id, name, version, type: 'app' },
  enabled: true,
  source: 'marketplace',
  writable: false,
  ...extra,
});
const moduleOf = (id: string, parents: string[], source: InstalledPackageRow['source'] = 'marketplace'): InstalledPackageRow => ({
  manifest: {
    id,
    name: `HotCRM ${id.split('.').pop()}`,
    version: '6.2.0',
    type: 'module',
    dependencies: Object.fromEntries(parents.map((p) => [p, '^6.0.0'])),
  },
  enabled: true,
  source,
  writable: false,
  disableable: true,
});

const HOTCRM = app(HOTCRM_ID, 'HotCRM', '6.2.0');
const MODULES = MODULE_IDS.map((id) => moduleOf(id, [HOTCRM_ID]));
const TODO = app('com.example.todo', 'Todo', '1.0.0');
const CODE: InstalledPackageRow = {
  manifest: { id: 'com.acme.code', name: 'Code App', version: '1.0.0', type: 'app', scope: 'project' },
  enabled: true,
  source: 'code',
  writable: false,
};
const PLATFORM: InstalledPackageRow = {
  manifest: { id: 'com.objectstack.platform', name: 'Platform', version: '1.0.0', scope: 'system' },
  enabled: true,
  source: 'code',
  writable: false,
};

const ledger = (manifestId: string, packageId: string, version: string) => ({
  packageId,
  versionId: `ver_${packageId}`,
  manifestId,
  version,
  installedAt: '2026-11-01T09:00:00.000Z',
});
const LEDGER = [ledger(HOTCRM_ID, 'pkg_hotcrm', '6.2.0'), ledger('com.example.todo', 'pkg_todo', '1.0.0')];

/** What the catalog's package door answers, by package id: a latest version, or a status. */
type Catalog = Record<string, { latest: string } | { status: number }>;
const LISTED: Catalog = { pkg_hotcrm: { latest: '6.4.0' }, pkg_todo: { latest: '1.0.0' } };

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let catalogReads: string[] = [];

/** Boot the real runtime config, then serve the package, install and catalog doors. */
async function serve({
  packages,
  installs = LEDGER,
  catalog = LISTED,
  marketplace = true,
}: {
  packages: InstalledPackageRow[];
  installs?: unknown[];
  catalog?: Catalog;
  marketplace?: boolean;
}) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true, marketplace } })));
  await initRuntimeConfig();
  catalogReads = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages } });
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return reply(200, { success: true, data: { items: installs } });
      }
      const listing = /^\/api\/v1\/marketplace\/packages\/([^/]+)$/.exec(path);
      if (listing) {
        const id = decodeURIComponent(listing[1]);
        catalogReads.push(id);
        const answer = catalog[id];
        if (!answer) return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no package ${id}` } });
        if ('status' in answer) return reply(answer.status, { success: false, error: { code: 'UPSTREAM', message: 'down' } });
        return reply(200, {
          success: true,
          data: { package: { id, latest_version: { version: answer.latest } }, versions: [] },
        });
      }
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
}

const SETUP_URL = '/apps/setup/component/developer/packages?source=marketplace';
const STUDIO_URL = '/apps/studio/component/developer/packages';

function Where() {
  const { pathname } = useLocation();
  return <div data-testid="where">{pathname}</div>;
}

function renderAt(url: string, lang: 'en' | 'zh' = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/apps/:app/component/developer/packages" element={<PackagesPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </I18nProvider>,
  );
}

const row = (key: string, lang: 'en' | 'zh' = 'en') => t(key, lang === 'en' ? 'en-US' : 'zh-CN');

/** Wait for the list and for the catalog reads to settle. */
async function settled(id = HOTCRM_ID) {
  await screen.findByTestId(`pkg-row-${id}`);
  await waitFor(() => expect(screen.queryByTestId(`pkg-update-reading-${id}`)).toBeNull());
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
  namespaceOverride.state = null;
});

describe('Setup → Installed Apps: update available (objectstack#34722)', () => {
  it('an app the catalog lists at a higher version draws the marketplace badge, linked to its marketplace page', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO] });
    renderAt(SETUP_URL);
    await settled();

    const link = screen.getByTestId(`pkg-update-${HOTCRM_ID}`);
    expect(link).toHaveTextContent('Update available → v6.4.0');
    expect(link).toHaveAttribute('href', '/apps/setup/system/marketplace/pkg_hotcrm');
    expect(screen.getByTestId('pkg-updates-summary')).toHaveTextContent('1 app has a newer version in the marketplace.');
    expect(screen.queryByTestId('pkg-updates-unavailable')).toBeNull();

    fireEvent.click(link);
    expect(await screen.findByTestId('where')).toHaveTextContent('/apps/setup/system/marketplace/pkg_hotcrm');
  });

  it('an app that is up to date has no badge, and with none to update there is no summary', async () => {
    await serve({ packages: [TODO], installs: [LEDGER[1]] });
    renderAt(SETUP_URL);
    await settled('com.example.todo');

    expect(screen.queryByTestId('pkg-update-com.example.todo')).toBeNull();
    expect(screen.queryByTestId('pkg-updates-summary')).toBeNull();
    expect(screen.queryByTestId('pkg-updates-unavailable')).toBeNull();
    expect(catalogReads).toEqual(['pkg_todo']);
  });

  it('an app the catalog does not list (404) has no badge and is not read as unavailable', async () => {
    await serve({ packages: [HOTCRM, TODO], catalog: { pkg_todo: { latest: '1.0.0' } } });
    renderAt(SETUP_URL);
    await settled();

    expect(screen.queryByTestId(`pkg-update-${HOTCRM_ID}`)).toBeNull();
    expect(screen.queryByTestId('pkg-updates-unavailable')).toBeNull();
  });

  it('counts every app with a newer version', async () => {
    await serve({ packages: [HOTCRM, TODO], catalog: { pkg_hotcrm: { latest: '6.4.0' }, pkg_todo: { latest: '1.1.0' } } });
    renderAt(SETUP_URL);
    await settled();

    expect(screen.getByTestId('pkg-updates-summary')).toHaveTextContent('2 apps have a newer version in the marketplace.');
  });

  it('a catalog that cannot be read leaves the list as it is and says the update information cannot be read', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO], catalog: { pkg_hotcrm: { status: 502 }, pkg_todo: { latest: '1.0.0' } } });
    renderAt(SETUP_URL);
    await settled();

    expect(screen.getByTestId(`pkg-row-${HOTCRM_ID}`)).toBeInTheDocument();
    expect(screen.getByTestId('pkg-row-com.example.todo')).toBeInTheDocument();
    expect(screen.getByTestId('pkg-updates-unavailable')).toHaveTextContent(
      row('engine.packages.installedApps.updatesUnavailable'),
    );
    expect(screen.queryByTestId(`pkg-update-${HOTCRM_ID}`)).toBeNull();
    expect(screen.queryByTestId('pkg-updates-summary')).toBeNull();
  });

  it('on a runtime with no marketplace the catalog is not asked and the page says so', async () => {
    await serve({ packages: [HOTCRM, TODO], marketplace: false });
    renderAt(SETUP_URL);
    await settled();

    expect(catalogReads).toEqual([]);
    expect(screen.getByTestId('pkg-updates-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId(`pkg-update-${HOTCRM_ID}`)).toBeNull();
  });

  it('asks the catalog about apps only, never about their modules', async () => {
    await serve({ packages: [HOTCRM, ...MODULES], installs: [LEDGER[0]] });
    renderAt(SETUP_URL);
    await settled();

    expect(catalogReads).toEqual(['pkg_hotcrm']);
  });

  it('reads in zh-CN: the badge in the marketplace catalogue words, the summary in the designer rows', async () => {
    await serve({ packages: [HOTCRM] });
    renderAt(SETUP_URL, 'zh');
    await settled();

    expect(screen.getByTestId(`pkg-update-${HOTCRM_ID}`)).toHaveTextContent('有可用更新 → v6.4.0');
    const summary = row('engine.packages.installedApps.updatesSummaryOne', 'zh').replace('{count}', '1');
    expect(summary).not.toContain('newer');
    expect(screen.getByTestId('pkg-updates-summary')).toHaveTextContent(summary);
  });
});

describe('Setup → Installed Apps: the badge waits on the marketplace namespace (objectstack#34722)', () => {
  it('while the namespace loads, the Update cell holds a placeholder, not an empty "up to date" cell', async () => {
    namespaceOverride.state = { status: 'loading' };
    await serve({ packages: [HOTCRM], installs: [LEDGER[0]] });
    renderAt(SETUP_URL);
    await screen.findByTestId(`pkg-row-${HOTCRM_ID}`);
    await waitFor(() => expect(catalogReads).toEqual(['pkg_hotcrm']));
    // The summary is the page's own words and arrives with the catalog read.
    await screen.findByTestId('pkg-updates-summary');

    expect(screen.getByTestId(`pkg-update-reading-${HOTCRM_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`pkg-update-${HOTCRM_ID}`)).toBeNull();
  });

  it('a namespace that cannot be fetched still shows the target version and the way to upgrade', async () => {
    namespaceOverride.state = { status: 'failed' };
    await serve({ packages: [HOTCRM] });
    renderAt(SETUP_URL);
    await settled();

    const link = screen.getByTestId(`pkg-update-${HOTCRM_ID}`);
    expect(link).toHaveAttribute('href', '/apps/setup/system/marketplace/pkg_hotcrm');
    expect(within(link).getByTestId(`pkg-update-version-${HOTCRM_ID}`)).toHaveTextContent('→ v6.4.0');
    expect(link).not.toHaveTextContent('Update available');
  });
});

describe('Setup → Installed Apps: an app is one line, its modules folded under it (objectstack#34722)', () => {
  it('draws HotCRM as one line by default and its four modules on demand', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO] });
    renderAt(SETUP_URL);
    await settled();

    for (const id of MODULE_IDS) expect(screen.queryByTestId(`pkg-row-${id}`)).toBeNull();
    const toggle = screen.getByTestId(`pkg-modules-toggle-${HOTCRM_ID}`);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId(`pkg-row-${HOTCRM_ID}`)).toHaveTextContent('4 modules');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const id of MODULE_IDS) {
      expect(screen.getByTestId(`pkg-row-${id}`)).toHaveAttribute('data-module-of', HOTCRM_ID);
    }
    // A module updates with its app: no Update cell of its own.
    for (const id of MODULE_IDS) expect(screen.queryByTestId(`pkg-update-reading-${id}`)).toBeNull();

    fireEvent.click(toggle);
    for (const id of MODULE_IDS) expect(screen.queryByTestId(`pkg-row-${id}`)).toBeNull();
  });

  it('a module that declares two apps, or none in view, stays a line of its own', async () => {
    const twoApps = moduleOf(`${HOTCRM_ID}.bridge`, [HOTCRM_ID, 'com.example.todo']);
    const orphan = moduleOf('com.example.lonely', ['com.example.absent']);
    // Its app is a code package: not in the marketplace view, so not folded away.
    const ofCodeApp = moduleOf('com.acme.code.extra', ['com.acme.code']);
    await serve({ packages: [HOTCRM, TODO, CODE, twoApps, orphan, ofCodeApp] });
    renderAt(SETUP_URL);
    await settled();

    for (const id of [twoApps, orphan, ofCodeApp].map((p) => p.manifest.id)) {
      expect(screen.getByTestId(`pkg-row-${id}`)).not.toHaveAttribute('data-module-of');
    }
    expect(screen.queryByTestId(`pkg-modules-toggle-${HOTCRM_ID}`)).toBeNull();
  });

  it('a search that finds a module shows it under its app', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO] });
    renderAt(SETUP_URL);
    await settled();

    fireEvent.change(screen.getByPlaceholderText(row('engine.packages.search')), { target: { value: 'cpq' } });
    expect(await screen.findByTestId(`pkg-row-${HOTCRM_ID}.cpq`)).toHaveAttribute('data-module-of', HOTCRM_ID);
    expect(screen.getByTestId(`pkg-row-${HOTCRM_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-row-com.example.todo')).toBeNull();
  });
});

describe('the two doors (objectstack#34722)', () => {
  const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());

  it('Setup → Installed Apps draws the administrator columns and none of the developer doors', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO, CODE, PLATFORM] });
    renderAt(SETUP_URL);
    await settled();

    expect(headers()).toEqual([
      row('engine.packages.col.name'),
      row('engine.packages.col.version'),
      row('engine.packages.col.status'),
      row('engine.packages.col.source'),
      row('engine.packages.installedApps.col.update'),
      row('engine.packages.col.actions'),
    ]);
    expect(screen.queryByRole('button', { name: row('engine.packages.import') })).toBeNull();
    expect(screen.queryByRole('button', { name: row('engine.packages.new') })).toBeNull();
    expect(screen.queryByTestId('pkg-show-platform')).toBeNull();
    expect(screen.queryByTestId('pkg-source-filter')).toBeNull();
    expect(screen.queryByRole('button', { name: row('engine.packages.source.showAll') })).toBeNull();
    expect(screen.queryByTestId('pkg-scope')).toBeNull();
    expect(screen.queryByText(HOTCRM_ID)).toBeNull();
  });

  it('Studio → Packages keeps Import, New Package, the platform switch and the developer columns, and asks no catalog', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO, CODE, PLATFORM] });
    renderAt(STUDIO_URL);
    await screen.findByTestId(`pkg-row-${HOTCRM_ID}`);

    expect(screen.getByRole('button', { name: row('engine.packages.import') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: row('engine.packages.new') })).toBeInTheDocument();
    expect(screen.getByTestId('pkg-show-platform')).toBeInTheDocument();
    expect(headers()).toEqual(expect.arrayContaining(['ID', row('engine.packages.col.scope')]));
    expect(headers()).not.toContain(row('engine.packages.installedApps.col.update'));
    // Every package is its own line there, modules included.
    for (const id of MODULE_IDS) expect(screen.getByTestId(`pkg-row-${id}`)).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-updates-summary')).toBeNull();
    expect(catalogReads).toEqual([]);
  });

  it('Studio → Packages filtered to another Source keeps its Show all chip', async () => {
    await serve({ packages: [CODE, HOTCRM] });
    renderAt(`${STUDIO_URL}?source=code`);
    await screen.findByTestId('pkg-row-com.acme.code');

    expect(screen.getByTestId('pkg-source-filter')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: row('engine.packages.source.showAll') })).toBeInTheDocument();
  });
});
