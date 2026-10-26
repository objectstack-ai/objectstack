/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * A marketplace package's version dates read the DECLARED session locale,
 * never the machine's (objectui#9909).
 *
 * The date sat beside a translated `marketplace.detail.prerelease` badge, so
 * the label spoke the session's language while the date spoke the machine's.
 * The same package renders twice — under a declared `de-DE` tenant locale and
 * a declared `en` one, the UI language `en` on both — and must read
 * differently; the runtime tripwire then checks the argument every
 * locale-taking call received.
 */

import '@testing-library/jest-dom/vitest';
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { I18nProvider, LocalizationProvider } from '@object-ui/i18n';
import { isMachineLocale, recordLocaleArgumentsAsync } from '@object-ui/test-support';

vi.mock('react-router-dom', () => {
  const navigate = () => {};
  const params = { packageId: 'com.acme.crm' };
  return { useNavigate: () => navigate, useParams: () => params };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

const PACKAGE = vi.hoisted(() => ({
  package: {
    id: 'pkg_1',
    manifest_id: 'com.acme.crm',
    display_name: 'Acme CRM',
    description: 'A CRM.',
    latest_version: null,
  },
  versions: [{ id: 'v1', version: '1.2.0', is_prerelease: false, published_at: '2020-03-04T12:00:00.000Z' }],
}));

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: async () => PACKAGE,
  getCloudInstallationInfo: async () => null,
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

beforeEach(async () => {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cloudUrl: 'https://cloud.objectos.ai',
        singleEnvironment: true,
        features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

async function versionsUnder(locale: string): Promise<string> {
  render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <LocalizationProvider value={{ locale }}>
        <MarketplacePackagePage />
      </LocalizationProvider>
    </I18nProvider>,
  );
  // The version appears in the header too; the versions LIST row is the one
  // that carries the published date.
  const rows = await screen.findAllByText('v1.2.0');
  const row = rows.map((el) => el.closest('li')).find(Boolean);
  const text = row?.textContent ?? '';
  cleanup();
  return text;
}

describe('marketplace version dates follow the declared session locale (objectui#9909)', () => {
  it('says the de-DE face under a de-DE session', async () => {
    const text = await versionsUnder('de-DE');
    expect(text, `got: ${text}`).toMatch(/4\.3\.2020/);
  });

  it('keeps its en face under an en session', async () => {
    const text = await versionsUnder('en');
    expect(text, `got: ${text}`).toMatch(/3\/4\/2020/);
  });

  /** ⭐ THE PIN: the runner's own locale cannot satisfy it. */
  it('is a reading of the session, not of the machine', async () => {
    expect(await versionsUnder('de-DE')).not.toBe(await versionsUnder('en'));
  });

  it('every locale-taking call receives the declared tag', async () => {
    const calls = await recordLocaleArgumentsAsync(async () => {
      await versionsUnder('de-DE');
    });
    expect(calls.some((c) => c.locale === 'de-DE'), `saw: ${JSON.stringify(calls).slice(0, 2000)}`).toBe(true);
    expect(calls.filter(isMachineLocale), 'these call sites formatted in the machine locale').toEqual([]);
  });
});
