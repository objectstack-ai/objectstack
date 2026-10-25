// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A local install the runtime refused to load at startup is not offered the
 * Details actions that need the package loaded (objectui#11645).
 *
 * ## The defect
 *
 * Since objectstack#21822 (PR objectstack#21833, `@objectstack/*` 17.7.0) the
 * install-local listing marks such an entry `notLoaded: { code, requiredRange }`
 * IN PLACE of `withSampleData`. The Details page's local menu read the missing
 * `withSampleData` as "no sample data yet" and offered "Add sample data": a
 * re-seed into objects the runtime never registered. Re-seed and purge both act
 * on the package's own objects; Uninstall does not, and it is how the operator
 * removes the refused entry.
 *
 * ## What the cases pin
 *
 * - A `notLoaded` entry's menu holds Uninstall alone, and Uninstall still issues
 *   the DELETE. Both runtime shapes that draw the local menu are driven: the
 *   catalog view (marketplace on) and the local view an offline boot draws
 *   (objectui#11627).
 * - MUST NOT CHANGE: a loaded entry's menu still offers re-seed and purge — the
 *   lit control that the absence above is a reading of the marker.
 *
 * `marketplaceApi` is NOT mocked: one stubbed `fetch` answers by path with the
 * listing body the server landed. `t` echoes the KEY: the claim under test is
 * WHICH items the menu offers.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.example.crm' }),
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

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** The refused entry as objectstack PR #21833's wire shape gives it: no `withSampleData` key, the marker in its place. */
const REFUSED = {
  packageId: 'com.example.crm',
  versionId: 'ver_crm_3',
  manifestId: 'com.example.crm',
  version: '3.2.0',
  installedAt: '2026-10-05T09:00:00.000Z',
  notLoaded: { code: 'OS_PROTOCOL_INCOMPATIBLE', requiredRange: '^16' },
  installedBy: 'admin@objectos.ai',
};

/** The same package, loaded: the listing as it was before #21833. */
const { notLoaded: _marker, ...LOADED_BASE } = REFUSED;
const LOADED = { ...LOADED_BASE, withSampleData: true };

const CATALOG_PACKAGE = {
  package: {
    id: 'com.example.crm',
    manifest_id: 'com.example.crm',
    display_name: 'Example CRM',
    latest_version: { id: 'ver_crm_4', version: '4.0.0' },
  },
  versions: [],
};

interface WireCall { path: string; method: string }
let calls: WireCall[] = [];

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  headers: new Headers({ 'content-type': 'application/json' }),
  json: async () => body,
  text: async () => JSON.stringify(body),
});

/** Boot the SPA against a runtime whose install-local ledger holds `entry`; `marketplace` picks the catalog view or the offline local view. */
async function boot(marketplace: boolean, entry: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ path, method });
      if (path === '/api/v1/runtime/config') {
        return answer(200, {
          cloudUrl: '',
          singleEnvironment: true,
          features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
          branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        });
      }
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: [entry], total: 1 } });
      }
      if (path === '/api/v1/marketplace/install-local/com.example.crm' && method === 'DELETE') {
        return answer(200, { success: true, data: { manifestId: 'com.example.crm', cleanups: [] } });
      }
      if (path === '/api/v1/marketplace/packages/com.example.crm' && method === 'GET') {
        return answer(200, { success: true, data: CATALOG_PACKAGE });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
  calls = [];
}

const item = (key: string) => screen.queryByRole('menuitem', { name: `«${key}»` });

async function openLocalMenu() {
  const trigger = await screen.findByRole('button', { name: '«marketplace.detail.moreOptions»' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  // The one item every local menu carries: the menu is open once it is.
  await screen.findByRole('menuitem', { name: '«marketplace.detail.uninstallFromRuntime»' });
}

beforeEach(() => {
  calls = [];
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe.each([
  ['the catalog view (marketplace on)', true],
  ['the offline local view (marketplace off, objectui#11627)', false],
])('Details local menu — %s (objectui#11645)', (_view, marketplace) => {
  it('a not-loaded entry is offered Uninstall alone: no re-seed, no add-sample-data, no purge', async () => {
    await boot(marketplace, REFUSED);
    render(<MarketplacePackagePage />);
    await openLocalMenu();

    expect(item('marketplace.detail.addSampleData')).toBeNull();
    expect(item('marketplace.detail.reseedAgain')).toBeNull();
    expect(item('marketplace.detail.purgeSampleData')).toBeNull();
    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
  });

  it('Uninstall on the not-loaded entry issues DELETE for its manifest id', async () => {
    await boot(marketplace, REFUSED);
    render(<MarketplacePackagePage />);
    await openLocalMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: '«marketplace.detail.uninstallFromRuntime»' }));

    await waitFor(() =>
      expect(calls).toContainEqual({ path: '/api/v1/marketplace/install-local/com.example.crm', method: 'DELETE' }),
    );
  });

  it('MUST NOT CHANGE: a loaded entry is still offered re-seed and purge beside Uninstall', async () => {
    await boot(marketplace, LOADED);
    render(<MarketplacePackagePage />);
    await openLocalMenu();

    expect(item('marketplace.detail.reseedAgain')).toBeInTheDocument();
    expect(item('marketplace.detail.purgeSampleData')).not.toHaveAttribute('aria-disabled');
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });
});
