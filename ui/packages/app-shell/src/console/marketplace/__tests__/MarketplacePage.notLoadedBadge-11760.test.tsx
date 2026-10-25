// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The marketplace catalog reads a local install the runtime refused to load as
 * NOT LOADED, never as "Installed" (objectui#11760).
 *
 * ## The defect
 *
 * Since objectstack#21822 (PR objectstack#21833, `@objectstack/*` 17.7.0) the
 * install-local listing marks an entry this runtime's startup rehydrate refused
 * with `notLoaded: { code, requiredRange }`. objectui#11645 taught Installed
 * Apps to read it. The catalog still badged every local install green,
 * "Installed vX" on a catalog card and "Installed" on a "Your organization"
 * card, whether or not the runtime had loaded it.
 *
 * ## What the cases pin
 *
 * - A catalog card whose package is a refused local install carries the
 *   installed version and the "Not loaded" badge, not "Installed vX".
 * - An org card whose package is a refused local install carries "Not loaded",
 *   not "Installed", and no Install button (it IS installed).
 * - Controls on the same page: a loaded local install keeps its green badge on
 *   either kind of card.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path with the
 * bodies the server serves (the install-local listing verbatim in shape).
 * Expected text is the PACK's value for its key, read from the pack and
 * interpolated here, through the real `I18nProvider`, in `en` and `zh`.
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

/** An install-local listing item as objectstack PR #21833 serves it: refused (marker, no `withSampleData`) or loaded. */
const entry = (manifestId: string, version: string, refused: boolean) => ({
  packageId: manifestId,
  versionId: `ver_${manifestId}`,
  manifestId,
  version,
  installedAt: '2026-10-05T09:00:00.000Z',
  ...(refused
    ? { notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: '^16' } }
    : { withSampleData: true }),
  installedBy: 'admin@objectos.ai',
});

const LISTING = [
  entry('com.example.crm', '3.2.0', true),
  entry('com.example.todo', '1.0.0', false),
  entry('com.acme.orgcrm', '2.0.0', true),
  entry('com.acme.orgtodo', '1.1.0', false),
];

/** Public catalog rows. Each latest version differs from the installed one, so the two version badges are told apart. */
const catalogRow = (manifestId: string, latest: string) => ({
  id: manifestId,
  manifest_id: manifestId,
  display_name: manifestId,
  latest_version: { id: `ver_${manifestId}_latest`, version: latest },
});

/** The organization's own packages (ADR-0007 step ②), installed into this runtime through install-local. */
const orgRow = (manifestId: string) => ({
  id: `org_${manifestId}`,
  manifest_id: manifestId,
  display_name: manifestId,
  visibility: 'org',
  latest_version: '9.9.9',
});

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Boot the SPA against a runtime with a marketplace, an install-local surface holding `LISTING`, and an org catalog. */
async function boot() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal: true, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/packages' && method === 'GET') {
        const items = [catalogRow('com.example.crm', '4.0.0'), catalogRow('com.example.todo', '1.5.0')];
        return answer(200, { success: true, data: { items, total: items.length, limit: 100, offset: 0 } });
      }
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: LISTING, total: LISTING.length } });
      }
      if (path === '/api/v1/cloud-connection/org-packages' && method === 'GET') {
        return answer(200, {
          success: true,
          data: { connected: true, items: [orgRow('com.acme.orgcrm'), orgRow('com.acme.orgtodo')] },
        });
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
])('Catalog — a refused local install reads not loaded (objectui#11760) [%s]', (_lang, config, pack) => {
  const badge = pack.marketplace.notLoaded.badge;

  it('the catalog card carries the installed version and the not-loaded badge, not "Installed vX"', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId('marketplace-card-com.example.crm');
    expect(await within(card).findByText(badge)).toBeInTheDocument();
    expect(within(card).getByText(fill(pack.marketplace.versionBadge, { version: '3.2.0' }))).toBeInTheDocument();
    expect(within(card).queryByText(fill(pack.marketplace.installedBadge, { version: '3.2.0' }))).toBeNull();
  });

  it('control: a loaded local install\'s catalog card keeps "Installed vX" and no not-loaded badge', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId('marketplace-card-com.example.todo');
    expect(await within(card).findByText(fill(pack.marketplace.installedBadge, { version: '1.0.0' }))).toBeInTheDocument();
    expect(within(card).queryByText(badge)).toBeNull();
  });

  it('the org card carries the not-loaded badge, not "Installed", and offers no Install', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId('org-card-com.acme.orgcrm');
    expect(await within(card).findByText(badge)).toBeInTheDocument();
    expect(within(card).queryByText(pack.marketplace.org.installedBadge)).toBeNull();
    expect(within(card).queryByRole('button')).toBeNull();
  });

  it('control: a loaded local install\'s org card keeps "Installed" and no not-loaded badge', async () => {
    await boot();
    renderPage(config);

    const card = await screen.findByTestId('org-card-com.acme.orgtodo');
    expect(await within(card).findByText(pack.marketplace.org.installedBadge)).toBeInTheDocument();
    expect(within(card).queryByText(badge)).toBeNull();
  });
});
