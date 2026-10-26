// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The environment marketplace detail page offers an "update" only for a HIGHER
 * version (objectui#10899 item 7, carried from cloud#2432).
 *
 * Measured on the 2026-09-28 local E2E: an environment that held v1.1.0 (a
 * draft installed ahead of review) while the latest approved version was
 * v1.0.0 read `Installed · v1.1.0 / Update available → v1.0.0`, and the
 * primary button offered to "update" it — to the older version. The page
 * compared the two with `!==`.
 *
 * Real subject: `MarketplacePackagePage` over the genuine runtime-config boot
 * (the same harness the sibling `*-5620` / `*.guardOrder` suites use), with the
 * marketplace API stubbed at its module boundary. `t` echoes the KEY so the
 * assertion names which state the page reached, not which English string.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.local.sample' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

const getMarketplacePackage = vi.fn();
const getCloudInstallationInfo = vi.fn();

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: (...a: unknown[]) => getMarketplacePackage(...a),
  getCloudInstallationInfo: (...a: unknown[]) => getCloudInstallationInfo(...a),
  listLocalInstalls: async () => [],
  listMarketplacePackages: async () => ({ items: [] }),
  listOrgPackages: async () => ({ items: [] }),
  listInstalledPackages: async () => ({ items: [] }),
  installPackage: async () => ({}),
  installLocal: async () => ({}),
  uninstallLocal: async () => ({}),
  listCloudEnvironments: async () => [],
  listInstallableOrgIds: async () => [],
  cloudConsoleUrl: () => '',
  reseedSampleData: async () => ({ ok: true }),
  purgeSampleData: async () => ({ ok: true }),
  reseedLocalSampleData: async () => ({ ok: true }),
  purgeLocalSampleData: async () => ({ ok: true }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** An env console: marketplace mounted, cloud install path (no local install). */
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

function packageWithLatest(version: string) {
  return {
    package: {
      id: 'pkg_1',
      manifest_id: 'com.local.sample',
      display_name: 'Sample',
      description: 'A sample package.',
      latest_version: { version },
    },
    versions: [{ version }],
  };
}

beforeEach(() => {
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('installed version is NEWER than the latest approved one', () => {
  it('offers no update — no badge, and the button reads Installed', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(packageWithLatest('1.0.0'));
    getCloudInstallationInfo.mockResolvedValue({ version: '1.1.0' });

    render(<MarketplacePackagePage />);

    await screen.findByText('Sample');
    // The installed badge is there (the probe answered) …
    expect(await screen.findByText('«marketplace.detail.installedV»')).toBeInTheDocument();
    // … and nothing calls the older version an update.
    expect(screen.queryByText(/marketplace\.detail\.updateAvailable/)).not.toBeInTheDocument();
    expect(screen.queryByText('«marketplace.action.updateTo»')).not.toBeInTheDocument();
    expect(screen.getByText('«marketplace.action.installed»')).toBeInTheDocument();
  });
});

describe('POSITIVE CONTROL — installed version is OLDER than the latest', () => {
  it('still offers the update', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(packageWithLatest('1.1.0'));
    getCloudInstallationInfo.mockResolvedValue({ version: '1.0.0' });

    render(<MarketplacePackagePage />);

    await screen.findByText('Sample');
    expect(await screen.findByText(/marketplace\.detail\.updateAvailable/)).toBeInTheDocument();
    expect(screen.getByText('«marketplace.action.updateTo»')).toBeInTheDocument();
  });
});

describe('CONTROL — installed version EQUALS the latest', () => {
  it('offers no update', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(packageWithLatest('1.0.0'));
    getCloudInstallationInfo.mockResolvedValue({ version: '1.0.0' });

    render(<MarketplacePackagePage />);

    await screen.findByText('Sample');
    expect(await screen.findByText('«marketplace.detail.installedV»')).toBeInTheDocument();
    expect(screen.queryByText(/marketplace\.detail\.updateAvailable/)).not.toBeInTheDocument();
  });
});
