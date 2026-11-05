// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The detail page's two columns may shrink below their content
 * (objectstack#30330).
 *
 * Seen on HotCRM's detail page at an 883 px window: below the `lg` breakpoint
 * the grid has one implicit `auto` column, and a grid item's automatic
 * minimum width is its content's, so a 259-character line in a README fence
 * sized the column, and the README, at 1926 px; the page cut it off. With
 * `min-w-0` on each cell the column keeps the page's width and the fence
 * scrolls inside itself. jsdom does no layout: this pins the class that
 * carries the fix; the measured before/after in a real browser is on the
 * pull request. The CONTROL pins that the README and Versions content render
 * where they did.
 *
 * Real subject: `MarketplacePackagePage` over the genuine runtime-config
 * boot, the harness `MarketplacePackagePage.releaseNotes-28891` uses.
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

const WIDE_LINE = "curl -d '" + 'x'.repeat(259) + "'";

function hotcrm() {
  return {
    package: {
      id: 'pkg_hotcrm',
      manifest_id: 'com.hotcrm.app',
      display_name: 'HotCRM',
      description: 'A CRM.',
      readme: ['# HotCRM', '', '```bash', WIDE_LINE, '```'].join('\n'),
      latest_version: { version: '6.0.0' },
    },
    versions: [{ id: 'v600', version: '6.0.0', release_notes: 'Notes.' }],
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

/** The grid cell holding the card titled `title`. */
function gridCell(title: string): HTMLElement {
  const heading = screen.getByText(title);
  let el: HTMLElement | null = heading;
  while (el && !el.parentElement?.classList.contains('grid')) el = el.parentElement;
  if (!el) throw new Error(`no grid cell holds ${title}`);
  return el;
}

describe('the detail page columns', () => {
  it('let the README and Versions cells shrink below their content', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue(null);

    render(<MarketplacePackagePage />);
    await screen.findByText('v6.0.0');

    expect(gridCell('«marketplace.detail.about»')).toHaveClass('min-w-0');
    expect(gridCell('«marketplace.detail.versions»')).toHaveClass('min-w-0');
  });

  it('control: the README fence renders in the About cell and scrolls inside itself', async () => {
    await bootEnvConsole();
    getMarketplacePackage.mockResolvedValue(hotcrm());
    getCloudInstallationInfo.mockResolvedValue(null);

    render(<MarketplacePackagePage />);
    await screen.findByText('v6.0.0');

    const pre = gridCell('«marketplace.detail.about»').querySelector('pre')!;
    expect(pre.textContent).toBe(WIDE_LINE);
    expect(pre).toHaveClass('overflow-x-auto');
    expect(gridCell('«marketplace.detail.versions»').textContent).toContain('Notes.');
  });
});
