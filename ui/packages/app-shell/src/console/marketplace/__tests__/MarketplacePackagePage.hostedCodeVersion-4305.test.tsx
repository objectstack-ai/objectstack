// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * cloud#4305 — the Versions panel marks a code-plugin version where the
 * page's install would be refused for it.
 *
 * Seen on the control plane's marketplace: a package's detail page listed
 * v1.1.0, a code plugin (`artifact_kind: 'plugin'`, served as
 * `contains_code: true`), beside its metadata versions with nothing saying a
 * hosted environment refuses it (422 `CODE_PLUGIN_UNSUPPORTED`). On a runtime
 * with no install-local surface the page installs through the control plane's
 * door, which installs into hosted environments only and refuses every code
 * plugin; there each code-plugin version carries a "not installable on hosted"
 * badge and one muted line naming the way out. A self-hosted runtime installs
 * through its own install-local door, and marks nothing.
 *
 * Real subject: `MarketplacePackagePage` over the genuine runtime-config boot,
 * with the marketplace API stubbed at its module boundary (the harness of
 * `MarketplacePackagePage.releaseNotes-28891`).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_widgets' }),
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

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: (...a: unknown[]) => getMarketplacePackage(...a),
  getCloudInstallationInfo: (...a: unknown[]) => getCloudInstallationInfo(...a),
  installPackage: async () => ({}),
  listLocalInstalls: async () => [],
  installLocal: async () => ({}),
  uninstallLocal: async () => ({}),
  listCloudEnvironments: async () => [],
  listInstallableOrgIds: async () => new Set<string>(),
  cloudConsoleUrl: () => '',
  getServedPackageBody: async () => { throw new Error('no manifest'); },
  reseedSampleData: async () => ({ ok: true }),
  purgeSampleData: async () => ({ ok: true }),
  reseedLocalSampleData: async () => ({ ok: true }),
  purgeLocalSampleData: async () => ({ ok: true }),
  countLocalSampleData: async () => null,
}));

vi.mock('../waitForServedApp', () => ({
  waitForServedApp: async () => ({ served: true, apps: [] }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: async () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** The three runtime shapes the page meets, as their runtimes serve `/runtime/config`. */
const RUNTIMES = {
  // A hosted environment's console: a cloud base, no install-local surface.
  hostedEnvironment: { cloudUrl: 'https://cloud.objectos.ai', singleEnvironment: true, defaultEnvironmentId: 'env_1', installLocal: false },
  // The control plane's own console: same origin, no install-local surface;
  // its install door installs into the hosted environment picked.
  controlPlane: { cloudUrl: '', singleEnvironment: false, defaultEnvironmentId: undefined, installLocal: false },
  // A self-hosted runtime connected to the cloud marketplace: a cloud base AND
  // a mounted install-local surface, which installs code plugins.
  selfHosted: { cloudUrl: 'https://cloud.objectos.ai', singleEnvironment: true, defaultEnvironmentId: 'env_1', installLocal: true },
} as const;

async function boot(runtime: keyof typeof RUNTIMES) {
  const r = RUNTIMES[runtime];
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cloudUrl: r.cloudUrl,
        singleEnvironment: r.singleEnvironment,
        defaultEnvironmentId: r.defaultEnvironmentId,
        features: { installLocal: r.installLocal, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
}

/** The side panel's entry id, as `MarketplacePackagePage` spells it. */
const versionEntryId = (version: string) => `marketplace-version-${version}`;

const BADGE = '«marketplace.detail.notInstallableHosted»';
const REASON = '«marketplace.detail.notInstallableHostedReason»';

function widgets() {
  return {
    package: {
      id: 'pkg_widgets',
      manifest_id: 'com.acme.widgets',
      display_name: 'Widgets',
      description: 'Widgets.',
      latest_version: { version: '1.1.0', artifact_kind: 'plugin', contains_code: true },
    },
    versions: [
      { id: 'v110', version: '1.1.0', artifact_kind: 'plugin', contains_code: true },
      { id: 'v100', version: '1.0.0', artifact_kind: 'metadata', contains_code: false },
    ],
  };
}

function entryText(version: string): string {
  return document.getElementById(versionEntryId(version))?.textContent ?? '';
}

beforeEach(() => {
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
  getMarketplacePackage.mockResolvedValue(widgets());
  getCloudInstallationInfo.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('the Versions panel marks a code-plugin version where the install door refuses it', () => {
  it('a hosted environment: the code-plugin version carries the badge and the reason', async () => {
    await boot('hostedEnvironment');
    render(<MarketplacePackagePage />);
    await screen.findByText('v1.1.0');

    expect(entryText('1.1.0')).toContain(BADGE);
    expect(entryText('1.1.0')).toContain(REASON);
  });

  it('the control plane console: the code-plugin version carries the badge and the reason', async () => {
    await boot('controlPlane');
    render(<MarketplacePackagePage />);
    await screen.findByText('v1.1.0');

    expect(entryText('1.1.0')).toContain(BADGE);
    expect(entryText('1.1.0')).toContain(REASON);
  });

  it('a hosted environment: a metadata version carries neither', async () => {
    await boot('hostedEnvironment');
    render(<MarketplacePackagePage />);
    await screen.findByText('v1.0.0');

    expect(entryText('1.0.0')).not.toContain(BADGE);
    expect(entryText('1.0.0')).not.toContain(REASON);
  });

  it('a self-hosted runtime with install-local: the code-plugin version carries neither', async () => {
    await boot('selfHosted');
    render(<MarketplacePackagePage />);
    await screen.findByText('v1.1.0');

    expect(entryText('1.1.0')).toContain('v1.1.0');
    expect(entryText('1.1.0')).not.toContain(BADGE);
    expect(entryText('1.1.0')).not.toContain(REASON);
  });
});
