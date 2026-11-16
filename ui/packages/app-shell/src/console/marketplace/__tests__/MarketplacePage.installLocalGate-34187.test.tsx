// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog asks install-local only where the runtime mounts it
 * (objectstack#34187).
 *
 * A hosted environment mounts no install-local surface and its runtime config
 * says so (`features.installLocal: false`), yet the catalog's side load read
 * `GET /api/v1/marketplace/install-local` on every first load and Refresh and
 * was answered 404. The package page already gates the same read on that flag.
 *
 * - With `installLocal: false` no install-local request is made, and the
 *   catalog list is drawn.
 * - CONTROL: with `installLocal: true` it is asked, beside the catalog.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path with the
 * bodies the server serves, and records every path it was asked.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '@object-ui/i18n';

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

const LISTED = 'com.example.notes';
const CATALOG = [
  { id: `pkg_${LISTED}`, manifest_id: LISTED, display_name: LISTED, latest_version: { id: 'ver_1', version: '1.0.0' } },
];
const INSTALL_LOCAL = '/api/v1/marketplace/install-local';

const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8' } });

/** Boot the SPA against a runtime whose config says `installLocal`, and return every GET path asked. */
async function boot(installLocal: boolean): Promise<string[]> {
  resetRuntimeConfigForTesting();
  const asked: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      if (method === 'GET') asked.push(path);
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/packages' && method === 'GET') {
        return answer(200, { success: true, data: { items: CATALOG, total: CATALOG.length, limit: 100, offset: 0 } });
      }
      if (path === INSTALL_LOCAL && method === 'GET') {
        return answer(200, { success: true, data: { items: [] } });
      }
      if (path === '/api/v1/cloud-connection/installed' && method === 'GET') {
        return answer(200, { success: true, data: { packages: [], total: 0, connected: true } });
      }
      if (path === '/api/v1/cloud-connection/org-packages' && method === 'GET') {
        return answer(200, { success: true, data: { connected: true, items: [] } });
      }
      return answer(404, { success: false, error: { code: 'ROUTE_NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
  return asked;
}

function renderPage() {
  return render(
    <I18nProvider config={{ defaultLanguage: 'en', detectBrowserLanguage: false }} persistLanguage={false}>
      <MarketplacePage />
    </I18nProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('Catalog side load — install-local only where it is mounted (objectstack#34187)', () => {
  it('with installLocal false no install-local request is made, and the catalog list is drawn', async () => {
    const asked = await boot(false);
    renderPage();

    expect(await screen.findByTestId(`marketplace-card-${LISTED}`)).toBeInTheDocument();
    // The side loads are read in one batch with the catalog: a drawn card means they were asked.
    expect(asked).toContain('/api/v1/cloud-connection/installed');
    expect(asked).not.toContain(INSTALL_LOCAL);
  });

  it('CONTROL: with installLocal true it is asked, beside the catalog', async () => {
    const asked = await boot(true);
    renderPage();

    expect(await screen.findByTestId(`marketplace-card-${LISTED}`)).toBeInTheDocument();
    expect(asked).toContain(INSTALL_LOCAL);
  });
});
