// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Setup → Packages is the one list of what is installed (objectui#12675,
 * ruling B on objectstack#23892).
 *
 * - Every package carries a Source from the closed set code / marketplace /
 *   authored: the row's served `source` (objectstack#24010), read as is
 *   (`packageSource.ts`, objectui#12790). Neither the `writable` verdict nor
 *   the marketplace slice's installed list names it any more — the two-read
 *   join these pins used to hold retired, so its pins are flipped below, not
 *   dropped: each one now asserts that the served key wins where the join
 *   would have answered otherwise.
 * - With the marketplace capability (`features.installLocal`) present, the
 *   rows whose served Source is marketplace carry the Installed Apps actions
 *   (Details, Uninstall); with it absent, no row does and nothing reads the
 *   marketplace.
 * - `?source=VALUE` filters the list; an unknown or repeated value, and a row
 *   whose served `source` is absent or outside the closed set, are refused by
 *   name and nothing is drawn in their place.
 *
 * The wire is stubbed (`fetch`), the runtime config is the real module booted
 * over a served body, and `marketplaceApi` is not mocked.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';

const admin = vi.hoisted(() => ({ value: true }));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: admin.value, isResolved: true }),
}));

import { PackagesPage, type InstalledPackageRow } from './PackagesPage';
import { PACKAGE_SOURCES } from './packageSource';
import { t, tFormat } from './i18n';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../runtime-config';

// Each fixture is a row as objectstack serves it since objectstack#24010: the
// door that registered the package states `source`, beside `writable`.
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

interface Served {
  packages: unknown[];
  ledger?: unknown[];
  /** Status the install-local listing answers with. */
  ledgerStatus?: number;
}

let calls: Array<{ path: string; method: string }> = [];

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Boot the real runtime config with `installLocal`, then serve the package doors. */
async function serve(installLocal: boolean, served: Served) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply(200, { features: { installLocal } })),
  );
  await initRuntimeConfig();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ path, method });
      if (path === '/api/v1/packages') return reply(200, { success: true, data: { packages: served.packages } });
      // Not cloud-bound: the marketplace slice reads the local ledger.
      if (path === '/api/v1/cloud-connection/installed') return reply(404, {});
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        const status = served.ledgerStatus ?? 200;
        return status === 200
          ? reply(200, { success: true, data: { items: served.ledger ?? [] } })
          : reply(status, { success: false, error: { code: 'INTERNAL_ERROR', message: 'ledger unreadable' } });
      }
      return reply(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
}

function LocationProbe() {
  const { pathname, search } = useLocation();
  return <div data-testid="location">{`${pathname}${search}`}</div>;
}

const PACKAGES_PATH = '/apps/setup/component/developer/packages';

function renderPackages(search = '') {
  return render(
    <MemoryRouter initialEntries={[`${PACKAGES_PATH}${search}`]}>
      <LocationProbe />
      <PackagesPage />
    </MemoryRouter>,
  );
}

/** id → the Source the row draws, for every drawn row. */
async function drawnSources(): Promise<Record<string, string | null>> {
  await screen.findAllByTestId('pkg-source');
  const out: Record<string, string | null> = {};
  for (const row of screen.getAllByTestId(/^pkg-row-(?!uninstall|details)/)) {
    const id = row.getAttribute('data-testid')!.slice('pkg-row-'.length);
    out[id] = within(row).getByTestId('pkg-source').getAttribute('data-source');
  }
  return out;
}

afterEach(() => {
  cleanup();
  admin.value = true;
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Packages — marketplace capability present (objectui#12675)', () => {
  it('every package carries its Source, and only the marketplace row carries the actions', async () => {
    await serve(true, { packages: [CODE, MARKET, AUTHORED], ledger: [LEDGER_TODO] });
    renderPackages();

    // The kernel toggle hides nothing here: no row has a platform scope.
    expect(await drawnSources()).toEqual({
      'com.acme.code': 'code',
      'com.example.todo': 'marketplace',
      'app.b2r4': 'authored',
    });
    expect(screen.getByTestId('pkg-row-com.example.todo')).toContainElement(
      screen.getByTestId('pkg-row-uninstall-com.example.todo'),
    );
    expect(screen.getByTestId('pkg-row-details-com.example.todo')).toBeInTheDocument();
    for (const id of ['com.acme.code', 'app.b2r4']) {
      expect(within(screen.getByTestId(`pkg-row-${id}`)).queryByRole('button')).toBeNull();
    }
  });

  it('`?source=marketplace` shows only the marketplace rows, and Show all clears it', async () => {
    await serve(true, { packages: [CODE, MARKET, AUTHORED], ledger: [LEDGER_TODO] });
    renderPackages('?source=marketplace');

    expect(await drawnSources()).toEqual({ 'com.example.todo': 'marketplace' });
    fireEvent.click(within(screen.getByTestId('pkg-source-filter')).getByRole('button'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(new RegExp(`^${PACKAGES_PATH}$`)));
    expect(Object.keys(await drawnSources())).toHaveLength(3);
  });

  it.each(PACKAGE_SOURCES)('`?source=%s` shows only the rows served that Source', async (source) => {
    await serve(true, { packages: [CODE, MARKET, AUTHORED], ledger: [LEDGER_TODO] });
    renderPackages(`?source=${source}`);

    const expected = Object.fromEntries(
      [CODE, MARKET, AUTHORED].filter((p) => p.source === source).map((p) => [p.manifest.id, source]),
    );
    expect(Object.keys(expected)).toHaveLength(1);
    expect(await drawnSources()).toEqual(expected);
  });

  it('Uninstall confirms in-app and removes the install through the install-local door', async () => {
    await serve(true, { packages: [CODE, MARKET], ledger: [LEDGER_TODO] });
    renderPackages();

    fireEvent.click(await screen.findByTestId('pkg-row-uninstall-com.example.todo'));
    fireEvent.click(await screen.findByTestId('pkg-row-uninstall-confirm-com.example.todo'));
    await waitFor(() =>
      expect(calls).toContainEqual({ path: '/api/v1/marketplace/install-local/com.example.todo', method: 'DELETE' }),
    );
    // A click on a row action never opens the row's detail sheet.
    expect(screen.queryByRole('dialog', { name: 'Todo' })).toBeNull();
  });

  it('Details opens the package\'s marketplace page, where Update and the sample-data menu live', async () => {
    await serve(true, { packages: [MARKET], ledger: [LEDGER_TODO] });
    renderPackages();

    fireEvent.click(await screen.findByTestId('pkg-row-details-com.example.todo'));
    await waitFor(() =>
      expect(screen.getByTestId('location')).toHaveTextContent('/apps/setup/system/marketplace/com.example.todo'),
    );
  });

  it('a viewer who is not a workspace admin sees every Source and no marketplace action', async () => {
    admin.value = false;
    await serve(true, { packages: [CODE, MARKET, AUTHORED], ledger: [LEDGER_TODO] });
    renderPackages();

    expect(await drawnSources()).toEqual({
      'com.acme.code': 'code',
      'com.example.todo': 'marketplace',
      'app.b2r4': 'authored',
    });
    expect(screen.queryByTestId('pkg-row-uninstall-com.example.todo')).toBeNull();
    expect(screen.queryByTestId('pkg-row-details-com.example.todo')).toBeNull();
  });
});

describe('Packages — marketplace capability absent (objectui#12675)', () => {
  it('every package still carries its served Source, no row carries a marketplace action, and the marketplace is not read', async () => {
    await serve(false, { packages: [CODE, MARKET, AUTHORED], ledger: [LEDGER_TODO] });
    renderPackages();

    // Flipped (objectui#12790): the join read every row as code or authored
    // here, deriving "not a marketplace install" from the capability. The page
    // derives nothing now — it draws what the server states.
    expect(await drawnSources()).toEqual({
      'com.acme.code': 'code',
      'com.example.todo': 'marketplace',
      'app.b2r4': 'authored',
    });
    expect(screen.queryByText(t('engine.packages.col.actions', 'en'))).toBeNull();
    expect(screen.queryByTestId(/^pkg-row-(uninstall|details)-/)).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/api/v1/marketplace/'))).toBe(false);
  });
});

describe('Packages — an origin or filter the Source boundary cannot place is refused (objectui#12675)', () => {
  it.each([
    ['absent', undefined],
    ['null', null],
    ['outside the closed set', 'plugin'],
    ['a different spelling of a member', 'Marketplace'],
  ])('a row whose served `source` is %s refuses the list by its id; no row is drawn', async (_label, source) => {
    const { source: _served, ...rest } = CODE;
    const row = source === undefined ? rest : { ...rest, source };
    await serve(true, { packages: [row, AUTHORED], ledger: [] });
    renderPackages();

    expect(await screen.findByTestId('packages-load-error')).toHaveTextContent(
      tFormat('engine.packages.source.unknown', 'en', { id: 'com.acme.code' }),
    );
    expect(screen.queryAllByTestId('pkg-source')).toHaveLength(0);
  });

  it('a row with no `source` is refused even when the marketplace lists it: the list is not a fallback', async () => {
    const { source: _served, ...rest } = MARKET;
    await serve(true, { packages: [rest], ledger: [LEDGER_TODO] });
    renderPackages();

    expect(await screen.findByTestId('packages-load-error')).toHaveTextContent(
      tFormat('engine.packages.source.unknown', 'en', { id: 'com.example.todo' }),
    );
    expect(screen.queryAllByTestId('pkg-source')).toHaveLength(0);
  });

  it('a marketplace listing that cannot be read refuses the list instead of dropping the installs only it lists', async () => {
    await serve(true, { packages: [CODE, MARKET], ledgerStatus: 500 });
    renderPackages();

    expect(await screen.findByTestId('packages-load-error')).toHaveTextContent('ledger unreadable');
    expect(screen.queryAllByTestId('pkg-source')).toHaveLength(0);
  });

  it.each([
    ['an unknown value', '?source=plugin', 'engine.packages.source.filterUnknown', 'plugin'],
    ['an empty value', '?source=', 'engine.packages.source.filterUnknown', ''],
    ['a repeated param', '?source=code&source=authored', 'engine.packages.source.filterRepeated', 'code, authored'],
  ])('%s in `?source=` is refused by name, and no row is drawn', async (_label, search, key, value) => {
    await serve(true, { packages: [CODE, MARKET, AUTHORED], ledger: [LEDGER_TODO] });
    renderPackages(search);

    expect(await screen.findByTestId('packages-source-filter-error')).toHaveTextContent(
      tFormat(key, 'en', { value }),
    );
    await waitFor(() => expect(calls.some((c) => c.path === '/api/v1/packages')).toBe(true));
    expect(screen.queryAllByTestId('pkg-source')).toHaveLength(0);
  });
});

/**
 * The join's answers, flipped (objectui#12790). Each fixture below is a row the
 * retired `writable` × installed-list join placed differently from what the
 * server now states; the page draws the server's statement every time.
 */
describe('Packages — the served `source` wins where the retired join answered otherwise (objectui#12790)', () => {
  it('CONTROL: a non-writable authored install with a `system` / `cloud` scope reads authored (the join called it code)', async () => {
    const system: InstalledPackageRow = {
      manifest: { id: 'com.acme.platform_base', name: 'Platform Base', version: '1.0.0', scope: 'system' },
      enabled: true,
      source: 'authored',
      writable: false,
    };
    const cloud: InstalledPackageRow = {
      manifest: { id: 'com.acme.cloud_base', name: 'Cloud Base', version: '1.0.0', scope: 'cloud' },
      enabled: true,
      source: 'authored',
      writable: false,
    };
    await serve(true, { packages: [CODE, system, cloud], ledger: [] });
    renderPackages();

    // system / cloud rows sit behind the page's show-kernel switch.
    await screen.findByTestId('pkg-row-com.acme.code');
    fireEvent.click(document.getElementById('show-kernel')!);
    expect(await drawnSources()).toEqual({
      'com.acme.code': 'code',
      'com.acme.platform_base': 'authored',
      'com.acme.cloud_base': 'authored',
    });
  });

  it('CONTROL: a non-writable authored install the marketplace lists reads authored, with no marketplace action (the join called it marketplace)', async () => {
    const listed: InstalledPackageRow = { ...MARKET, source: 'authored' };
    await serve(true, { packages: [listed], ledger: [LEDGER_TODO] });
    renderPackages();

    expect(await drawnSources()).toEqual({ 'com.example.todo': 'authored' });
    expect(screen.queryByTestId(/^pkg-row-(uninstall|details)-/)).toBeNull();
  });

  it('a non-writable row the marketplace lists, served code, reads code with no marketplace action (the join called it marketplace)', async () => {
    const listed: InstalledPackageRow = { ...MARKET, source: 'code' };
    await serve(true, { packages: [listed], ledger: [LEDGER_TODO] });
    renderPackages();

    expect(await drawnSources()).toEqual({ 'com.example.todo': 'code' });
    expect(screen.queryByTestId(/^pkg-row-(uninstall|details)-/)).toBeNull();
  });

  it('a writable authored row the marketplace also lists reads authored: no conflict is left to refuse (the join refused it)', async () => {
    await serve(true, { packages: [AUTHORED], ledger: [{ ...LEDGER_TODO, packageId: 'app.b2r4', manifestId: 'app.b2r4' }] });
    renderPackages();

    expect(await drawnSources()).toEqual({ 'app.b2r4': 'authored' });
    expect(screen.queryByTestId('packages-load-error')).toBeNull();
    expect(screen.queryByTestId(/^pkg-row-(uninstall|details)-/)).toBeNull();
  });

  it('a marketplace row the marketplace list does not hold still reads marketplace, with no action to act on', async () => {
    await serve(true, { packages: [MARKET], ledger: [] });
    renderPackages();

    expect(await drawnSources()).toEqual({ 'com.example.todo': 'marketplace' });
    expect(screen.queryByTestId(/^pkg-row-(uninstall|details)-/)).toBeNull();
  });
});
