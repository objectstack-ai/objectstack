// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#34722 — the administrator's face of this page, first drawn for
 * marketplace installs (`?source=marketplace`, Setup's retired Installed Apps
 * entry); Studio → Packages the developer's (no `face`; ADR-0146 D1).
 * objectstack#36834 extends that face to every source: Setup → Packages opens
 * it with `?face=admin` (see "Setup → Packages: the administration face" at
 * the end of this file), and the old marketplace address still opens it.
 *
 * On the administration face:
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
 *     doors (Import, the platform switch, the Source chip's Show all) are not
 *     drawn; New Package is, and lands in Studio (objectstack#36834).
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
import axe from 'axe-core';
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

/**
 * objectstack#36834 — the create dialog is the spec-driven package form, which
 * this file does not drive: a stand-in answers its `onSaved` with a created id,
 * so the case below reads what the PAGE does after a create.
 */
vi.mock('./PackageFormDialog', () => ({
  PackageFormDialog: ({
    open,
    mode,
    onSaved,
  }: {
    open: boolean;
    mode: string;
    onSaved?: (r: { id: string }) => void;
  }) =>
    open && mode === 'create' ? (
      <button type="button" data-testid="stub-create-save" onClick={() => onSaved?.({ id: 'app.fresh' })}>
        save
      </button>
    ) : null,
}));

import { resolveHref } from '@object-ui/layout';
import { PackageDetailSheet, PackagesPage, type InstalledPackageRow } from './PackagesPage';
import { t } from './i18n';
import { SETUP_NEW_PACKAGE_PATH } from './packageSource';
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
/** Every non-GET request the page sent, as `METHOD path?query`. */
let writes: string[] = [];
/** How many times the list door was read. */
let packagesReads = 0;
/** The package ids whose customizations door was read (objectstack#36908). */
let customizationReads: string[] = [];

/** Boot the real runtime config, then serve the package, install and catalog doors. */
async function serve({
  packages,
  installs = LEDGER,
  catalog = LISTED,
  marketplace = true,
  drafts = [],
}: {
  packages: InstalledPackageRow[];
  installs?: unknown[];
  catalog?: Catalog;
  marketplace?: boolean;
  /** What the pending-drafts door answers for any package. */
  drafts?: Array<{ type: string; name: string }>;
}) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { features: { installLocal: true, marketplace } })));
  await initRuntimeConfig();
  catalogReads = [];
  writes = [];
  packagesReads = 0;
  customizationReads = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const url = new URL(String(input), 'http://console.test');
      const path = url.pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method !== 'GET') writes.push(`${method} ${path}${url.search}`);
      if (path === '/api/v1/packages') {
        packagesReads += 1;
        return reply(200, { success: true, data: { packages } });
      }
      if (path === '/api/v1/meta/_drafts') return reply(200, { success: true, data: { drafts } });
      if (/^\/api\/v1\/packages\/[^/]+\/(enable|disable)$/.test(path) && method === 'PATCH') {
        return reply(200, { success: true, data: {} });
      }
      if (/^\/api\/v1\/packages\/[^/]+\/export$/.test(path)) return reply(200, { success: true, data: { id: 'x' } });
      if (/^\/api\/v1\/packages\/[^/]+$/.test(path) && method === 'DELETE') {
        return reply(200, { success: true, data: {} });
      }
      // objectstack#36908 — a read-only base's detail reads what this
      // deployment changed on it: one tab arrangement, for every base.
      const customized = /^\/api\/v1\/packages\/([^/]+)\/customizations$/.exec(path);
      if (customized) {
        customizationReads.push(decodeURIComponent(customized[1]));
        const arrangements = [{ object: 'acme_task', key: 'relatedLists' }];
        return reply(200, {
          success: true,
          data: {
            packageId: decodeURIComponent(customized[1]),
            overrides: [],
            extensions: [],
            arrangements,
            switchedOff: [],
            contributions: [],
            counts: { overrides: 0, extensions: 0, arrangements: 1, switchedOff: 0, contributions: 0 },
          },
        });
      }
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

/** The page's own query string, beside it: the URL state its filters write. */
function Search() {
  const { search } = useLocation();
  return <div data-testid="search">{search}</div>;
}

function renderAt(url: string, lang: 'en' | 'zh' = 'en') {
  return render(
    <I18nProvider config={{ defaultLanguage: lang, detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route
            path="/apps/:app/component/developer/packages"
            element={
              <>
                <PackagesPage />
                <Search />
              </>
            }
          />
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

  it('the toggle names the module lines it shows in aria-controls, and names none while they are hidden', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO] });
    renderAt(SETUP_URL);
    await settled();

    const toggle = screen.getByTestId(`pkg-modules-toggle-${HOTCRM_ID}`);
    expect(toggle).not.toHaveAttribute('aria-controls');

    fireEvent.click(toggle);
    const ids = (toggle.getAttribute('aria-controls') ?? '').split(' ');
    // Every id resolves to a drawn module line of this app, one per module.
    const named = ids.map((id) => document.getElementById(id));
    expect(named.map((el) => el?.getAttribute('data-testid')).sort()).toEqual(
      MODULE_IDS.map((id) => `pkg-row-${id}`).sort(),
    );
    for (const el of named) expect(el).toHaveAttribute('data-module-of', HOTCRM_ID);

    // axe judges the IDREFs of an expanded control: none may dangle.
    const res = await axe.run(screen.getByTestId('pkg-installed-apps-table'), {
      runOnly: { type: 'rule', values: ['aria-valid-attr-value'] },
    });
    expect(res.violations.map((v) => v.nodes.map((n) => n.html.slice(0, 80)))).toEqual([]);
    // Control: an empty list is a reading only if the rule judged the toggle.
    expect(res.passes.flatMap((r) => r.nodes.map((n) => n.html)).some((h) => h.includes('aria-controls='))).toBe(true);

    fireEvent.click(toggle);
    expect(toggle).not.toHaveAttribute('aria-controls');
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

  it('the administration face draws the administrator columns, New Package, and none of the developer doors', async () => {
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
    // objectstack#36834 — New Package is the administration face's one header
    // action; it lands in Studio (see the create case below).
    expect(screen.getByRole('button', { name: row('engine.packages.new') })).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// objectstack#36834 — Setup → Packages: the administration face, every source
// ---------------------------------------------------------------------------

const ADMIN_URL = '/apps/setup/component/developer/packages?face=admin';
/** Setup's Packages entry as `@objectstack/platform-objects` declares it (`setup-packages-door.test.ts`). */
const SETUP_PACKAGES_ITEM = {
  id: 'nav_packages',
  type: 'component',
  label: 'Packages',
  componentRef: 'developer:packages',
  params: { face: 'admin' },
} as const;

const AUTHORED: InstalledPackageRow = {
  manifest: { id: 'app.b2r4', name: 'My Base', version: '0.1.0', type: 'app' },
  enabled: true,
  source: 'authored',
  writable: true,
  disableable: true,
};

/** The query string the page holds, as a parsed map. */
const query = () => new URLSearchParams(screen.getByTestId('search').textContent ?? '');

describe('Setup → Packages: the administration face (objectstack#36834)', () => {
  it('the Setup entry opens this page with `?face=admin`', () => {
    expect(resolveHref(SETUP_PACKAGES_ITEM as never, '/apps/setup').href).toBe(ADMIN_URL);
  });

  it('lists every source, one line per app, and no platform package', async () => {
    await serve({ packages: [HOTCRM, ...MODULES, TODO, CODE, AUTHORED, PLATFORM] });
    renderAt(ADMIN_URL);
    await settled();

    expect(screen.getByRole('heading', { name: row('engine.packages.title') })).toBeInTheDocument();
    expect(screen.getByText(row('engine.packages.admin.description'))).toBeInTheDocument();
    for (const id of [HOTCRM_ID, 'com.example.todo', 'com.acme.code', 'app.b2r4']) {
      expect(screen.getByTestId(`pkg-row-${id}`)).toBeInTheDocument();
    }
    // Modules fold under their app; the platform package is not listed.
    for (const id of MODULE_IDS) expect(screen.queryByTestId(`pkg-row-${id}`)).toBeNull();
    expect(screen.queryByTestId('pkg-row-com.objectstack.platform')).toBeNull();
    // Only a marketplace app is asked about, and only it can carry an Update cell.
    expect(catalogReads.sort()).toEqual(['pkg_hotcrm', 'pkg_todo']);
    expect(screen.getByTestId(`pkg-update-${HOTCRM_ID}`)).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-update-reading-com.acme.code')).toBeNull();
    expect(screen.queryByTestId('pkg-update-reading-app.b2r4')).toBeNull();
  });

  it('the Source filter writes `?source=` and keeps the face; All clears it', async () => {
    await serve({ packages: [HOTCRM, TODO, CODE, AUTHORED] });
    renderAt(ADMIN_URL);
    await settled();

    expect(screen.getByTestId('pkg-source-picker-all')).toHaveAttribute('data-state', 'on');
    fireEvent.click(screen.getByTestId('pkg-source-picker-marketplace'));
    await waitFor(() => expect(query().get('source')).toBe('marketplace'));
    expect(query().get('face')).toBe('admin');
    expect(screen.getByTestId('pkg-source-picker-marketplace')).toHaveAttribute('data-state', 'on');
    expect(screen.queryByTestId('pkg-row-com.acme.code')).toBeNull();
    expect(screen.queryByTestId('pkg-row-app.b2r4')).toBeNull();
    expect(screen.getByTestId('pkg-row-com.example.todo')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('pkg-source-picker-authored'));
    await waitFor(() => expect(query().get('source')).toBe('authored'));
    expect(await screen.findByTestId('pkg-row-app.b2r4')).toBeInTheDocument();
    expect(screen.queryByTestId('pkg-row-com.example.todo')).toBeNull();

    fireEvent.click(screen.getByTestId('pkg-source-picker-all'));
    await waitFor(() => expect(query().has('source')).toBe(false));
    expect(query().get('face')).toBe('admin');
    expect(await screen.findByTestId('pkg-row-com.acme.code')).toBeInTheDocument();
  });

  it('the retired Installed Apps address still opens this face, filtered to marketplace', async () => {
    await serve({ packages: [HOTCRM, TODO, CODE, AUTHORED] });
    renderAt(SETUP_URL);
    await settled();

    expect(screen.getByTestId('pkg-source-picker-marketplace')).toHaveAttribute('data-state', 'on');
    expect(screen.queryByTestId('pkg-row-com.acme.code')).toBeNull();
    expect(screen.queryByRole('button', { name: row('engine.packages.import') })).toBeNull();
    // Clearing the filter stays on the administration face.
    fireEvent.click(screen.getByTestId('pkg-source-picker-all'));
    await waitFor(() => expect(query().get('face')).toBe('admin'));
    expect(await screen.findByTestId('pkg-row-com.acme.code')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: row('engine.packages.import') })).toBeNull();
  });

  it('an unknown face is refused by name, not read as the development surface', async () => {
    await serve({ packages: [CODE] });
    renderAt('/apps/setup/component/developer/packages?face=dev');

    expect(await screen.findByTestId('packages-source-filter-error')).toHaveTextContent('dev');
    expect(screen.queryByTestId('pkg-row-com.acme.code')).toBeNull();
  });

  const SHEET_AUTHORING = [
    'engine.packages.detail.edit',
    'engine.packages.detail.publish',
    'engine.packages.detail.revert',
    'engine.packages.detail.export',
    'engine.packages.detail.duplicate',
    'engine.packages.detail.adoptOrphans',
  ];

  it('the detail sheet offers View info, Disable and Delete, and links an authored package to Studio', async () => {
    await serve({ packages: [AUTHORED], drafts: [{ type: 'object', name: 'b2r4_task' }] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-app.b2r4'));
    const sheet = await screen.findByRole('dialog');

    expect(within(sheet).getByRole('button', { name: row('engine.packages.detail.viewInfo') })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: row('engine.packages.detail.disable') })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: row('engine.packages.detail.deletePackage') })).toBeInTheDocument();
    for (const key of SHEET_AUTHORING) {
      expect(within(sheet).queryByRole('button', { name: row(key) }), key).toBeNull();
    }
    // Pending changes (with their Publish / Discard) and the metadata browser
    // are authoring: not on this face, though the package has a draft.
    expect(within(sheet).queryByText(row('engine.packages.detail.pendingChanges'))).toBeNull();
    expect(within(sheet).queryByText(row('engine.packages.detail.browseMetadata'))).toBeNull();
    expect(within(sheet).getByTestId('pkg-detail-open-in-studio')).toHaveAttribute('href', '/studio/app.b2r4/data');
  });

  it('CONTROL: the same package on the development surface keeps every authoring action', async () => {
    await serve({ packages: [AUTHORED], drafts: [{ type: 'object', name: 'b2r4_task' }] });
    renderAt(STUDIO_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-app.b2r4'));
    const sheet = await screen.findByRole('dialog');

    for (const key of SHEET_AUTHORING) {
      expect(within(sheet).getByRole('button', { name: row(key) }), key).toBeInTheDocument();
    }
    expect(await within(sheet).findByText(row('engine.packages.detail.pendingChanges'))).toBeInTheDocument();
    expect(within(sheet).queryByTestId('pkg-detail-open-in-studio')).toBeNull();
  });

  it('a code package offers no Studio link', async () => {
    await serve({ packages: [{ ...CODE, disableable: true }] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-com.acme.code'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByRole('button', { name: row('engine.packages.detail.disable') })).toBeInTheDocument();
    expect(within(sheet).queryByTestId('pkg-detail-open-in-studio')).toBeNull();
  });

  it('Disable confirms, sends the disable door, and says so', async () => {
    await serve({ packages: [AUTHORED] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-app.b2r4'));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: row('engine.packages.detail.disable') }));
    fireEvent.click(await screen.findByTestId('pkg-detail-disable-confirm'));

    expect(await screen.findByText(row('engine.packages.detail.disabled'))).toBeInTheDocument();
    expect(writes).toContain('PATCH /api/v1/packages/app.b2r4/disable');
  });

  it.each([
    ['structure', '?keepData=true'],
    ['all', ''],
  ])('Delete keeps its keep-data choice (%s)', async (mode, qs) => {
    await serve({ packages: [AUTHORED] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-app.b2r4'));
    const sheet = await screen.findByRole('dialog');
    fireEvent.click(within(sheet).getByRole('button', { name: row('engine.packages.detail.deletePackage') }));

    fireEvent.click(await screen.findByTestId(`pkg-detail-delete-mode-${mode}`));
    fireEvent.change(screen.getByTestId('pkg-detail-delete-name-input'), { target: { value: 'My Base' } });
    fireEvent.click(screen.getByTestId('pkg-detail-delete-confirm'));

    await waitFor(() => expect(writes).toContain(`DELETE /api/v1/packages/app.b2r4${qs}`));
    await waitFor(() => expect(screen.queryByTestId('pkg-detail-delete-dialog')).toBeNull());
  });

  it('New Package lands in Studio on the created package', async () => {
    await serve({ packages: [CODE] });
    renderAt(ADMIN_URL);
    await screen.findByTestId('pkg-row-com.acme.code');
    fireEvent.click(screen.getByRole('button', { name: row('engine.packages.new') }));
    fireEvent.click(await screen.findByTestId('stub-create-save'));

    expect(await screen.findByTestId('where')).toHaveTextContent('/studio/app.fresh/data');
  });

  it('CONTROL: New Package on the development surface stays on the list', async () => {
    await serve({ packages: [CODE] });
    renderAt(STUDIO_URL);
    await screen.findByTestId('pkg-row-com.acme.code');
    fireEvent.click(screen.getByRole('button', { name: row('engine.packages.new') }));
    expect(packagesReads).toBe(1);
    fireEvent.click(await screen.findByTestId('stub-create-save'));

    // The list is read again, and the page stays where it is.
    await waitFor(() => expect(packagesReads).toBe(2));
    expect(screen.queryByTestId('where')).toBeNull();
    expect(screen.getByTestId('pkg-row-com.acme.code')).toBeInTheDocument();
  });

  it('reads in zh-CN from the catalogue rows', async () => {
    for (const key of [
      'engine.packages.admin.description',
      'engine.packages.source.all',
      'engine.packages.detail.openInStudio',
      'engine.packages.face.unknown',
      'engine.packages.face.repeated',
    ]) {
      expect(row(key, 'zh'), `${key}: a missing zh row echoes the key back`).not.toBe(key);
      expect(row(key, 'zh'), `${key}: the zh row must not be the English one`).not.toBe(row(key));
    }
  });
});

// ---------------------------------------------------------------------------
// objectstack#36908 — the console's new-package doors land on this face with
// New Package open (`SETUP_NEW_PACKAGE_PATH`), the Studio home that held that
// dialog having been removed.
// ---------------------------------------------------------------------------

describe('Setup → Packages: the new-package deep link (objectstack#36908)', () => {
  it('`?new=package` opens New Package on arrival and drops the param, keeping the face', async () => {
    await serve({ packages: [CODE] });
    renderAt(SETUP_NEW_PACKAGE_PATH);
    expect(SETUP_NEW_PACKAGE_PATH).toBe(`${ADMIN_URL}&new=package`);

    expect(await screen.findByTestId('stub-create-save')).toBeInTheDocument();
    await waitFor(() => expect(query().has('new')).toBe(false));
    expect(query().get('face')).toBe('admin');

    // The create lands in Studio on the new package, as New Package does.
    fireEvent.click(screen.getByTestId('stub-create-save'));
    expect(await screen.findByTestId('where')).toHaveTextContent('/studio/app.fresh/data');
  });

  it('CONTROL: the face without the param opens no dialog', async () => {
    await serve({ packages: [CODE] });
    renderAt(ADMIN_URL);
    await screen.findByTestId('pkg-row-com.acme.code');
    expect(screen.queryByTestId('stub-create-save')).toBeNull();
  });

  it('on the development surface the param opens nothing, and is dropped', async () => {
    await serve({ packages: [CODE] });
    renderAt(`${STUDIO_URL}?new=package`);
    await screen.findByTestId('pkg-row-com.acme.code');
    await waitFor(() => expect(query().has('new')).toBe(false));
    expect(screen.queryByTestId('stub-create-save')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// objectstack#36908 — the removed Studio home's "n customized, m switched off"
// and its "Customizations in this environment" panel are drawn in a read-only
// base's detail on this face (`PackageCustomizationsPanel.test.tsx` pins
// the panel itself).
// ---------------------------------------------------------------------------

/** A code base's paired customization package, served read-only (`isCustomizationPackage`). */
const CODE_PAIR: InstalledPackageRow = {
  manifest: { id: 'com.acme.code.custom', name: 'Code App customizations', version: '1.0.0', type: 'app', scope: 'project' },
  enabled: true,
  source: 'code',
  writable: false,
};

/** The detail sheet alone, on the administration face. */
function renderSheet(pkg: InstalledPackageRow) {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }}>
      <MemoryRouter initialEntries={[ADMIN_URL]}>
        <PackageDetailSheet pkg={pkg} face="admin" open onOpenChange={() => {}} onChanged={() => {}} />
      </MemoryRouter>
    </I18nProvider>,
  );
}

/** The sheet's own reads have had a turn to start: its info block is drawn. */
async function settledSheet(sheet: HTMLElement) {
  await waitFor(() => expect(within(sheet).getAllByText(/1\.0\.0/).length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 50));
}

describe('Setup → Packages: a read-only base’s customizations in its detail (objectstack#36908)', () => {
  it('a code package’s detail draws what this deployment changed on it, arrangements counted (objectstack#36833)', async () => {
    await serve({ packages: [CODE] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-com.acme.code'));
    const sheet = await screen.findByRole('dialog');

    const section = within(sheet).getByTestId('pkg-detail-customizations');
    await waitFor(() =>
      expect(within(section).getByTestId('pkg-detail-customizations-summary')).toHaveTextContent('1 customized, 0 switched off'),
    );
    expect(within(section).getByTestId('pkg-detail-customize')).toHaveAttribute('href', '/studio/com.acme.code/data');
  });

  it('an authored package’s detail draws no customizations section: it is changed in place', async () => {
    await serve({ packages: [AUTHORED] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-app.b2r4'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByTestId('pkg-detail-customizations')).toBeNull();
  });

  it('CONTROL: the development surface’s detail draws no customizations section', async () => {
    await serve({ packages: [CODE] });
    renderAt(STUDIO_URL);
    fireEvent.click(await screen.findByTestId('pkg-row-com.acme.code'));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).queryByTestId('pkg-detail-customizations')).toBeNull();
  });

  it('a read-only `.custom` pair’s detail draws no section and reads no customizations: it is read through its base', async () => {
    await serve({ packages: [CODE_PAIR] });
    renderAt(ADMIN_URL);
    fireEvent.click(await screen.findByTestId(`pkg-row-${CODE_PAIR.manifest.id}`));
    const sheet = await screen.findByRole('dialog');
    await settledSheet(sheet);
    expect(within(sheet).queryByTestId('pkg-detail-customizations')).toBeNull();
    expect(customizationReads).toEqual([]);
  });

  // The administration face lists no kernel package (pinned above), so its
  // detail is opened directly: the sheet's own gate is what is measured.
  it('a kernel package’s detail draws no section and reads no customizations: it takes no customization', async () => {
    await serve({ packages: [PLATFORM] });
    renderSheet(PLATFORM);
    const sheet = await screen.findByRole('dialog');
    await settledSheet(sheet);
    expect(within(sheet).queryByTestId('pkg-detail-customizations')).toBeNull();
    expect(customizationReads).toEqual([]);
  });

  it('CONTROL: the same direct render of a code package’s detail draws the section and reads its customizations once', async () => {
    await serve({ packages: [CODE] });
    renderSheet(CODE);
    const sheet = await screen.findByRole('dialog');
    await waitFor(() => expect(within(sheet).getByTestId('pkg-detail-customizations')).toBeInTheDocument());
    await waitFor(() => expect(customizationReads).toEqual(['com.acme.code']));
  });
});
