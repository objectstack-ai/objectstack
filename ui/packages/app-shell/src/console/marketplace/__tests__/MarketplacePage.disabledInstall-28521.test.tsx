// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A package uninstalled on a cloud-managed environment is not drawn as
 * installed (objectstack#28521).
 *
 * The control plane's uninstall is a soft disable: it keeps the installation
 * row (the ADR-0025 consent record and the sample-data state) and its env
 * listing, `GET /cloud-connection/installed`, still lists that row, with
 * `status: 'disabled'` and `enabled: false`. The console read every listed row
 * as installed, so the org card said "Installed" with no way back, and Setup →
 * Packages (`readMarketplaceInstalls`) drew it as an install. The install door,
 * `POST /cloud-connection/install`, re-enables the same row.
 *
 * `listInstalledPackages` and `installPackage` are the REAL client here, so the
 * rows are the ones that crossed the wire and the reinstall is the request the
 * door received. Only the catalog, the org listing and the local ledger are
 * stubbed. `t` echoes the KEY: the claim is WHICH control the card draws.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  useAuth: () => ({ activeOrganization: { id: 'org_1' } }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

const PKG = 'com.acme.crm';
const ORG_ROW = {
  id: 'pkg_1',
  manifest_id: PKG,
  display_name: 'Acme CRM',
  description: 'A CRM.',
  category: null,
  icon_url: null,
  visibility: 'org',
  latest_version: '1.0.0',
};

vi.mock('../marketplaceApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  listMarketplacePackages: async () => ({ items: [] }),
  listLocalInstalls: async () => [],
  listOrgPackages: async () => ({ connected: true, items: [ORG_ROW] }),
}));

// The org install's post-install wait is objectui#12097's subject, not this
// suite's: it settles at once, so no poll outlives a case.
vi.mock('../waitForServedApp', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  waitForServedApp: async () => ({ served: false }),
}));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';
import { listInstalledPackages, readMarketplaceInstalls } from '../marketplaceApi';

const INSTALLED_PATH = '/api/v1/cloud-connection/installed';
const INSTALL_PATH = '/api/v1/cloud-connection/install';

/** An installation row as the control plane's env package listing sends it. */
const row = (state: 'enabled' | 'disabled', manifestId = PKG) => ({
  package_id: manifestId,
  package_version_id: 'ver_1',
  version: '1.0.0',
  installed_at: '2026-10-31T00:00:00.000Z',
  installed_by: 'usr_1',
  with_sample_data: false,
  status: state === 'enabled' ? 'installed' : 'disabled',
  enabled: state === 'enabled',
});

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** The environment: its listed rows, and every install request the door received. */
const env = { rows: [] as unknown[], installs: [] as unknown[] };

async function boot(rows: unknown[]) {
  resetRuntimeConfigForTesting();
  env.rows = rows;
  env.installs = [];
  vi.stubGlobal('fetch', vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const path = new URL(String(input), 'http://console.test').pathname;
    const method = (init?.method ?? 'GET').toUpperCase();
    if (path === INSTALLED_PATH && method === 'GET') {
      return answer(200, { success: true, data: { packages: env.rows, total: env.rows.length, connected: true } });
    }
    if (path === INSTALL_PATH && method === 'POST') {
      const body = JSON.parse(init?.body ?? '{}');
      env.installs.push(body);
      // The door re-enables the same row.
      env.rows = env.rows.map((r: any) => (r.package_id === PKG ? row('enabled') : r));
      return answer(200, {
        success: true,
        data: { outcome: 'reinstalled', installation: { id: 'inst_1', environment_id: 'env_1', package_id: 'pkg_1', version: '1.0.0' } },
      });
    }
    if (path === '/api/v1/runtime/config') {
      // A cloud-managed environment: no install-local door, a control plane.
      return answer(200, {
        cloudUrl: 'https://cloud.example', singleEnvironment: false, defaultEnvironmentId: 'env_1',
        features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      });
    }
    return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
  }));
  await initRuntimeConfig();
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the control plane lists an uninstalled package; the console does not call it installed', () => {
  it('the client marks the disabled row, and only that one', async () => {
    await boot([row('disabled'), row('enabled', 'com.acme.psa')]);
    const listed = await listInstalledPackages();
    expect(listed.connected).toBe(true);
    expect(listed.items.map((i) => [i.manifestId, i.disabled])).toEqual([
      [PKG, true],
      ['com.acme.psa', undefined],
    ]);
    // Absent, never `false`, on an installed row.
    expect('disabled' in listed.items[1]).toBe(false);
  });

  it('either field alone marks the row disabled', async () => {
    await boot([
      { ...row('enabled'), status: 'disabled' },
      { ...row('enabled', 'com.acme.psa'), enabled: false },
    ]);
    const listed = await listInstalledPackages();
    expect(listed.items.map((i) => i.disabled)).toEqual([true, true]);
  });

  it('Setup → Packages reads only the installed rows', async () => {
    await boot([row('disabled'), row('enabled', 'com.acme.psa')]);
    const installs = await readMarketplaceInstalls();
    expect(installs.source).toBe('cloud');
    expect(installs.items.map((i) => i.manifestId)).toEqual(['com.acme.psa']);
  });

  it('the org card offers Reinstall, which the install door answers by re-enabling the row', async () => {
    await boot([row('disabled')]);
    render(<MarketplacePage />);
    const card = await screen.findByTestId(`org-card-${PKG}`);

    const reinstall = await within(card).findByRole('button', { name: '«marketplace.action.reinstall»' });
    expect(within(card).queryByText('«marketplace.org.installedBadge»')).not.toBeInTheDocument();

    fireEvent.click(reinstall);
    await waitFor(() => expect(env.installs).toEqual([{ package_id: 'pkg_1', seed_sample_data: true }]));
    // The page reads the listing again: the re-enabled row is installed.
    expect(await within(card).findByText('«marketplace.org.installedBadge»')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('CONTROL: an installed row still reads Installed, with no action', async () => {
    await boot([row('enabled')]);
    render(<MarketplacePage />);
    const card = await screen.findByTestId(`org-card-${PKG}`);
    expect(await within(card).findByText('«marketplace.org.installedBadge»')).toBeInTheDocument();
    expect(within(card).queryByRole('button')).not.toBeInTheDocument();
  });

  it('CONTROL: a package with no row still offers Install', async () => {
    await boot([]);
    render(<MarketplacePage />);
    const card = await screen.findByTestId(`org-card-${PKG}`);
    expect(await within(card).findByRole('button', { name: '«marketplace.org.install»' })).toBeInTheDocument();
  });
});
