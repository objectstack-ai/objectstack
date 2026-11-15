// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A catalog card on a cloud-managed environment carries the package's install
 * state: "Installed vX", and "Update available → vY" when the latest listed
 * version is newer (objectstack#33831).
 *
 * ## The defect
 *
 * On a cloud-managed environment what is installed is the control plane's env
 * listing (`GET /cloud-connection/installed`, `listInstalledPackages`); the
 * runtime's install-local ledger is empty there. The catalog page read that
 * listing only into a set of manifest ids for the "Your organization" cards
 * (which is how an org card knew to offer Reinstall), while the catalog card
 * read the install-local ledger alone. So a public app installed through the
 * control plane drew no install state on its card, and only the package page
 * (`getCloudInstallationInfo`) said "Installed · v6.1.2" and
 * "Update available → v6.2.0".
 *
 * ## What the cases pin
 *
 * - An installed app whose latest listed version is newer: the card carries
 *   the installed version AND the update badge naming the latest version.
 * - Control, an app not installed: the card carries neither.
 * - An app installed at the latest version: installed, no update.
 * - Control, a row the control plane lists as uninstalled (a soft disable,
 *   objectstack#28521): not installed, no update.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path with the
 * bodies the server serves. Expected text is the PACK's value for its key,
 * read from the pack and interpolated here, through the real `I18nProvider`,
 * in `en` and `zh`.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';
import { en, zh } from '@object-ui/i18n/locales';

vi.mock('react-router-dom', () => {
  const navigate = () => {};
  const params = {};
  return { useNavigate: () => navigate, useParams: () => params };
});

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';

type Pack = typeof en;
const EN = { defaultLanguage: 'en', detectBrowserLanguage: false } as const;
const ZH = { defaultLanguage: 'zh', detectBrowserLanguage: false } as const;

/** `{{name}}` interpolation, as i18next applies it to these keys (the console sets `escapeValue: false`). */
const fill = (template: string, values: Record<string, string>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => values[k] ?? `{{${k}}}`);

const OUTDATED = 'com.hotcrm.app';
const NOT_INSTALLED = 'com.example.notes';
const CURRENT = 'com.example.todo';
const UNINSTALLED = 'com.example.survey';

/** Public catalog rows, each with its latest listed version. */
const catalogRow = (manifestId: string, latest: string) => ({
  id: `pkg_${manifestId}`,
  manifest_id: manifestId,
  display_name: manifestId,
  latest_version: { id: `ver_${manifestId}_latest`, version: latest },
});

const CATALOG = [
  catalogRow(OUTDATED, '6.2.0'),
  catalogRow(NOT_INSTALLED, '1.0.0'),
  catalogRow(CURRENT, '2.0.0'),
  catalogRow(UNINSTALLED, '3.0.0'),
];

/** An installation row as the control plane's env package listing sends it (objectstack#28521's shape). */
const installation = (manifestId: string, version: string, enabled = true) => ({
  package_id: manifestId,
  package_version_id: `ver_${manifestId}_${version}`,
  version,
  installed_at: '2026-11-01T00:00:00.000Z',
  installed_by: 'usr_1',
  with_sample_data: false,
  status: enabled ? 'installed' : 'disabled',
  enabled,
});

const INSTALLED_ROWS = [
  installation(OUTDATED, '6.1.2'),
  installation(CURRENT, '2.0.0'),
  installation(UNINSTALLED, '2.5.0', false),
];

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Boot the SPA against a cloud-managed environment: no install-local door, the control plane's install listing. */
async function boot() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: 'https://cloud.example',
          singleEnvironment: false,
          defaultEnvironmentId: 'env_1',
          features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/packages' && method === 'GET') {
        return answer(200, { success: true, data: { items: CATALOG, total: CATALOG.length, limit: 100, offset: 0 } });
      }
      if (path === '/api/v1/cloud-connection/installed' && method === 'GET') {
        return answer(200, {
          success: true,
          data: { packages: INSTALLED_ROWS, total: INSTALLED_ROWS.length, connected: true },
        });
      }
      if (path === '/api/v1/cloud-connection/org-packages' && method === 'GET') {
        return answer(200, { success: true, data: { connected: true, items: [] } });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
}

function renderPage(config: typeof EN | typeof ZH) {
  return render(
    <I18nProvider config={config} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe.each([
  ['en', EN, en as Pack],
  ['zh', ZH, zh as unknown as Pack],
])('Catalog card — a cloud-managed install and its update (objectstack#33831) [%s]', (_lang, config, pack) => {
  const installedText = (version: string) => fill(pack.marketplace.installedBadge, { version });
  const updateText = (version: string) => `${pack.marketplace.detail.updateAvailable} → v${version}`;

  it('an installed app with a newer listed version carries "Installed vX" and "Update available → vY"', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId(`marketplace-card-${OUTDATED}`);
    expect(await within(card).findByText(installedText('6.1.2'))).toBeInTheDocument();
    expect(within(card).getByText(updateText('6.2.0'))).toBeInTheDocument();
  });

  it('control: an app not installed carries neither badge', async () => {
    await boot();
    renderPage(config);

    // The catalog and the install listings are read in one batch, so a drawn
    // card is already drawn with the install state.
    const card = await screen.findByTestId(`marketplace-card-${NOT_INSTALLED}`);
    expect(within(card).queryByTestId('marketplace-card-installed')).toBeNull();
    expect(within(card).queryByTestId('marketplace-card-update')).toBeNull();
    expect(within(card).queryByText(updateText('1.0.0'))).toBeNull();
  });

  it('an app installed at the latest version carries "Installed vX" and no update', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId(`marketplace-card-${CURRENT}`);
    expect(await within(card).findByText(installedText('2.0.0'))).toBeInTheDocument();
    expect(within(card).queryByTestId('marketplace-card-update')).toBeNull();
  });

  it('control: a row the control plane lists as uninstalled is not installed and offers no update', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId(`marketplace-card-${UNINSTALLED}`);
    expect(within(card).queryByText(installedText('2.5.0'))).toBeNull();
    expect(within(card).queryByTestId('marketplace-card-installed')).toBeNull();
    expect(within(card).queryByTestId('marketplace-card-update')).toBeNull();
  });
});
