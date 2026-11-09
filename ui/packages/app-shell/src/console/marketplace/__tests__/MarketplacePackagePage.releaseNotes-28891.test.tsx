// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The Versions panel renders each version's release notes as Markdown.
 *
 * Seen on staging, on HotCRM 6.0.0's package page: the side panel printed the
 * v6.0.0 notes as pre-line text, `## 6.0.0` and `**Who can enroll now.**`
 * included, while the README beside it rendered. The notes now go through the
 * same `MarkdownText` as the README, in its compact size. The CONTROL pins
 * that plain-text notes still read as before, and that a version without
 * notes renders nothing under it.
 *
 * Real subject: `MarketplacePackagePage` over the genuine runtime-config boot,
 * the harness `MarketplacePackagePage.updateDialog-12146` uses, with the
 * marketplace API stubbed at its module boundary.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

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
  countLocalSampleData: async () => null,
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

/** The side panel's entry id, as `MarketplacePackagePage` spells it. */
const versionEntryId = (version: string) => `marketplace-version-${version}`;

const NOTES_600 = [
  '## 6.0.0',
  '',
  '**Who can enroll now.** Any sales user.',
  '',
  '- Leads convert in one step',
  '- Quotes carry a **discount** line',
].join('\n');

function hotcrm() {
  return {
    package: {
      id: 'pkg_hotcrm',
      manifest_id: 'com.hotcrm.app',
      display_name: 'HotCRM',
      description: 'A CRM.',
      latest_version: { version: '6.0.0' },
    },
    versions: [
      { id: 'v600', version: '6.0.0', release_notes: NOTES_600 },
      { id: 'v510', version: '5.1.0', release_notes: 'Plain text notes.' },
      { id: 'v500', version: '5.0.0' },
    ],
  };
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

describe('the Versions panel', () => {
  it('renders release notes as Markdown: heading, bold and list, no literal marks', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue(null);

    render(<MarketplacePackagePage />);
    await screen.findByText('v6.0.0');
    const entry = document.getElementById(versionEntryId('6.0.0'))!;

    expect(entry.querySelector('h3')?.textContent).toBe('6.0.0');
    expect(Array.from(entry.querySelectorAll('strong')).map((s) => s.textContent)).toEqual(['Who can enroll now.', 'discount']);
    expect(Array.from(entry.querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'Leads convert in one step',
      'Quotes carry a discount line',
    ]);
    expect(entry.textContent).not.toContain('##');
    expect(entry.textContent).not.toContain('**');
  });

  it('control: plain-text notes read as before, and a version without notes renders none', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue(null);

    render(<MarketplacePackagePage />);
    await screen.findByText('v5.1.0');

    const plain = document.getElementById(versionEntryId('5.1.0'))!;
    expect(plain.querySelector('p')?.textContent).toBe('Plain text notes.');

    const bare = document.getElementById(versionEntryId('5.0.0'))!;
    expect(bare.querySelector('p')).toBeNull();
    expect(bare.children).toHaveLength(1);
  });
});
