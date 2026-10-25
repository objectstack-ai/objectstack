// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package page's 「更新」 button opens an UPDATE dialog (objectui#12146
 * item 1).
 *
 * Seen on staging while updating HotCRM 3.1.0 → 4.0.1: the page read
 * 「已安装 · v3.1.0」 and 「有可用更新 → v4.0.1」, and its 「更新」 button
 * opened the install dialog unchanged — titled 「安装 HotCRM」, primary button
 * 「安装」, no versions named, no word about the major jump (HotCRM 4.0 calls
 * for a one-time data conversion), and an unexplained 「包含示例数据」.
 *
 * Now the same dialog opens in an update mode: an update title and button, the
 * two versions the page already shows, one notice line for a major jump that
 * links to the target version's notes in the side panel, no sample-data control
 * (and no sample-data request), and the result says "Updated to vX". The
 * CONTROL pins the install path: a package this environment does not hold opens
 * today's dialog, sample-data checkbox and all.
 *
 * Real subject: `MarketplacePackagePage` over the genuine runtime-config boot
 * (the harness the sibling `*-10899` suite uses), with the marketplace API
 * stubbed at its module boundary and the served-app wait answered at once. `t`
 * echoes the KEY and its interpolation values, so each assertion names which
 * sentence the page picked and with what, not one pack's wording.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_hotcrm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

/** `«key»`, or `«key|a=1,b=2»` with the interpolation values (never `defaultValue`). */
function echo(key: string, opts?: Record<string, unknown>): string {
  const values = Object.entries(opts ?? {}).filter(([k]) => k !== 'defaultValue');
  return values.length ? `«${key}|${values.map(([k, v]) => `${k}=${String(v)}`).join(',')}»` : `«${key}»`;
}

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({ t: echo, language: 'en' }),
}));

const getMarketplacePackage = vi.fn();
const getCloudInstallationInfo = vi.fn();
const installPackage = vi.fn();

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: (...a: unknown[]) => getMarketplacePackage(...a),
  getCloudInstallationInfo: (...a: unknown[]) => getCloudInstallationInfo(...a),
  installPackage: (...a: unknown[]) => installPackage(...a),
  listLocalInstalls: async () => [],
  installLocal: async () => ({}),
  uninstallLocal: async () => ({}),
  listCloudEnvironments: async () => [],
  listInstallableOrgIds: async () => new Set<string>(),
  cloudConsoleUrl: () => '',
  reseedSampleData: async () => ({ ok: true }),
  purgeSampleData: async () => ({ ok: true }),
  reseedLocalSampleData: async () => ({ ok: true }),
  purgeLocalSampleData: async () => ({ ok: true }),
}));

// The runtime serves the installed version at once: the wait answers served.
vi.mock('../waitForServedApp', () => ({
  waitForServedApp: async () => ({ served: true, apps: [] }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: async () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** An env console: marketplace mounted, cloud install path into this environment. */
async function bootEnvConsole() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cloudUrl: 'https://cloud.objectos.ai',
        singleEnvironment: true,
        defaultEnvironmentId: 'env_1',
        features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
}

/** HotCRM as the catalog lists it: 4.0.1 latest, with notes; 4.0.0 and 3.1.0 below it. */
function hotcrm() {
  return {
    package: {
      id: 'pkg_hotcrm',
      manifest_id: 'com.hotcrm.app',
      display_name: 'HotCRM',
      description: 'A CRM.',
      latest_version: { version: '4.0.1' },
    },
    versions: [
      { id: 'v401', version: '4.0.1', release_notes: 'Run the contact address conversion once after updating.' },
      { id: 'v400', version: '4.0.0', release_notes: 'Contact address is now structured.' },
      { id: 'v310', version: '3.1.0' },
    ],
  };
}

/** Wait for the page, click its primary button, and return the dialog it opens. */
async function openDialogFrom(buttonKey: string) {
  await screen.findByText('HotCRM');
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`«${buttonKey.replace(/\./g, '\\.')}»`) }));
  return screen.findByRole('dialog');
}

beforeEach(() => {
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
  installPackage.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('an installed package with an update — the dialog is an update dialog', () => {
  it('says 「更新」 and names both versions', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue({ installationId: 'inst_1', version: '3.1.0', withSampleData: false });

    render(<MarketplacePackagePage />);
    const dialog = await openDialogFrom('marketplace.action.updateTo');

    expect(within(dialog).getByText('«marketplace.update.dialogTitle|name=HotCRM»')).toBeInTheDocument();
    expect(within(dialog).getByText(/«marketplace\.update\.dialogDescCurrent\|host=/)).toBeInTheDocument();
    expect(within(dialog).getByTestId('update-versions')).toHaveTextContent(
      '«marketplace.versionBadge|version=3.1.0» → «marketplace.versionBadge|version=4.0.1»',
    );
    expect(within(dialog).getByRole('button', { name: '«marketplace.action.updateTo»' })).toBeInTheDocument();
    // Nothing in it reads as an install.
    expect(within(dialog).queryByText(/marketplace\.install\.dialog/)).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: '«marketplace.action.install»' })).not.toBeInTheDocument();
  });

  it('has no sample-data checkbox, and the update asks for no sample data', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue({ installationId: 'inst_1', version: '3.1.0', withSampleData: false });
    installPackage.mockResolvedValue({ installation: { id: 'inst_1', environment_id: 'env_1', package_id: 'pkg_hotcrm', version: '4.0.1' } });

    render(<MarketplacePackagePage />);
    const dialog = await openDialogFrom('marketplace.action.updateTo');

    expect(within(dialog).queryByText('«marketplace.install.includeSampleData»')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: '«marketplace.action.updateTo»' }));
    await waitFor(() => expect(installPackage).toHaveBeenCalledTimes(1));
    expect(installPackage).toHaveBeenCalledWith({ packageId: 'pkg_hotcrm', environmentId: 'env_1', seedSampleData: false });

    // The result names the version it moved to.
    expect(await within(dialog).findByText('«marketplace.update.success|version=4.0.1»')).toBeInTheDocument();
    expect(within(dialog).queryByText('«marketplace.install.deployed»')).not.toBeInTheDocument();
  });
});

describe('a major jump — the notice line and the link', () => {
  it('says so in one line, linking to the target version’s notes in the side panel', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue({ installationId: 'inst_1', version: '3.1.0', withSampleData: false });

    render(<MarketplacePackagePage />);
    const dialog = await openDialogFrom('marketplace.action.updateTo');

    const notice = within(dialog).getByTestId('update-major-notice');
    expect(notice).toHaveTextContent('«marketplace.update.majorNotice|fromMajor=3,toMajor=4»');
    const link = within(notice).getByRole('link', { name: '«marketplace.update.releaseNotes|version=4.0.1»' });
    const entry = document.getElementById(link.getAttribute('href')!.slice(1));
    // The link names the side panel's 4.0.1 entry, the one carrying its notes.
    expect(entry).toHaveTextContent('v4.0.1');
    expect(entry).toHaveTextContent('Run the contact address conversion once after updating.');

    // Following it closes the dialog and moves focus to those notes.
    fireEvent.click(link);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(entry));
  });

  it('CONTROL — a minor update draws no notice', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue({ installationId: 'inst_1', version: '4.0.0', withSampleData: false });

    render(<MarketplacePackagePage />);
    const dialog = await openDialogFrom('marketplace.action.updateTo');

    expect(within(dialog).getByTestId('update-versions')).toHaveTextContent(
      '«marketplace.versionBadge|version=4.0.0» → «marketplace.versionBadge|version=4.0.1»',
    );
    expect(within(dialog).queryByTestId('update-major-notice')).not.toBeInTheDocument();
  });
});

describe('CONTROL — a fresh install opens today’s dialog', () => {
  it('install title and button, the sample-data checkbox, and no update summary', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue(null);
    installPackage.mockResolvedValue({ installation: { id: 'inst_1', environment_id: 'env_1', package_id: 'pkg_hotcrm', version: '4.0.1' } });

    render(<MarketplacePackagePage />);
    const dialog = await openDialogFrom('marketplace.action.installToCloud');

    expect(within(dialog).getByText('«marketplace.install.dialogTitle|name=HotCRM»')).toBeInTheDocument();
    expect(within(dialog).getByText(/«marketplace\.install\.dialogDescCurrent\|host=/)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('update-versions')).not.toBeInTheDocument();
    expect(within(dialog).queryByTestId('update-major-notice')).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/marketplace\.update\./)).not.toBeInTheDocument();

    // The sample-data request still follows the checkbox.
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: '«marketplace.action.install»' }));
    await waitFor(() => expect(installPackage).toHaveBeenCalledTimes(1));
    expect(installPackage).toHaveBeenCalledWith({ packageId: 'pkg_hotcrm', environmentId: 'env_1', seedSampleData: true });
    expect(await within(dialog).findByText('«marketplace.install.deployed»')).toBeInTheDocument();
  });
});
