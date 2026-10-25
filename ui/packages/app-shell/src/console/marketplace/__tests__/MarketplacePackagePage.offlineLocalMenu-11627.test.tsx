// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * On a runtime with no marketplace that DOES mount install-local, a local
 * install's Details page offers its local reseed / purge menu (objectui#11627).
 *
 * ## The defect
 *
 * An offline boot (`OS_CLOUD_URL=off`) serves `features.marketplace: false`
 * and, because the install-local surface is still mounted, `installLocal:
 * true`. Installed Apps lists the locally installed package and links its
 * Details to this page. The page returned `MarketplaceDisabled` for
 * `!marketplaceEnabled` before anything else, so the local menu below it was
 * unreachable: "App Marketplace is turned off", and zero install-local wire
 * calls.
 *
 * ## What the cases pin — both halves
 *
 * - LOCAL HALF: an admin whose package is a local install gets its header and
 *   local menu, and the menu's items issue the install-local POSTs. The purge
 *   call is pinned as ISSUED, not as succeeding: what the server answers to it
 *   is objectstack-ai/objectstack#21728's.
 * - REMOTE HALF: the disabled notice still renders, and nothing remote is
 *   asked for — no catalog request, no cloud-installation probe — and no
 *   install-to-cloud CTA, readme or version list is drawn.
 * - MUST NOT CHANGE: a marketplace-off boot WITHOUT install-local renders the
 *   notice alone and asks for nothing. A package that is not a local install
 *   also gets the notice alone, once the ledger has answered.
 *
 * ## Why the cases drive the WIRE
 *
 * `marketplaceApi` is NOT mocked. Every case boots the real
 * `initRuntimeConfig()` and the real request helpers over one stubbed `fetch`
 * that answers by path, so "issued" means a request left for that path with
 * that method, and "refused" means no request left at all — the two claims
 * the card's acceptance is made of. A mocked helper would only show that the
 * page called a stand-in.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';

const route = vi.hoisted(() => ({ packageId: 'com.example.crm' }));
const viewer = vi.hoisted(() => ({ isAdmin: true }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: route.packageId }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));

// `t` echoes the KEY, as the sibling suites do: the claim under test is WHICH
// state the page reaches, and a `t` echoing prose could not tell them apart.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));
// Renders nothing here: it fetches its own suggestions on mount, a network
// surface this suite is not about.
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** A `GET /api/v1/runtime/config` answer, as an offline boot sends it. */
const offlineConfig = (installLocal: boolean) => ({
  cloudUrl: '',
  singleEnvironment: true,
  features: { installLocal, marketplace: false, aiStudio: true, autoPublishAiBuilds: true },
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
});

/** What `os package install <file> -r` leaves in the install-local ledger: an inline manifest's packageId IS its manifest id. */
const CRM_ENTRY = {
  packageId: 'com.example.crm',
  versionId: 'inline',
  manifestId: 'com.example.crm',
  version: '4.0.0',
  installedAt: '2026-10-05T00:00:00.000Z',
  withSampleData: true,
};

interface WireCall { path: string; method: string }
let calls: WireCall[] = [];

const answer = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: '',
  json: async () => body,
});

/** Boot the SPA against an offline runtime whose install-local ledger holds `installs`. */
async function bootOffline(installLocal: boolean, installs: unknown[]) {
  resetRuntimeConfigForTesting();
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: { method?: string }) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ path, method });
      if (path === '/api/v1/runtime/config') return answer(200, offlineConfig(installLocal));
      if (path === '/api/v1/marketplace/install-local' && method === 'GET') {
        return answer(200, { success: true, data: { items: installs, total: installs.length } });
      }
      const action = /^\/api\/v1\/marketplace\/install-local\/([^/]+)\/(reseed|purge)-sample-data$/.exec(path);
      if (action && method === 'POST') {
        const manifestId = decodeURIComponent(action[1]);
        return answer(200, {
          success: true,
          data: action[2] === 'reseed'
            ? { manifestId, inserted: 2, updated: 0, errors: 0, withSampleData: true }
            : { manifestId, deleted: 0, withSampleData: false },
        });
      }
      return answer(404, { success: false, error: { code: 'NOT_FOUND', message: `no route ${method} ${path}` } });
    }),
  );
  await initRuntimeConfig();
  calls = [];
}

/** Requests that only a marketplace or a cloud control plane could answer. */
const remoteCalls = () =>
  calls.filter(({ path }) =>
    (path.startsWith('/api/v1/marketplace') && !path.startsWith('/api/v1/marketplace/install-local'))
    || path.startsWith('/api/v1/cloud-connection/')
    || path.startsWith('/api/v1/cloud/'),
  );

const ledgerReads = () => calls.filter((c) => c.path === '/api/v1/marketplace/install-local' && c.method === 'GET');

/** Let the ledger answer land and the page re-render on it. */
async function settleLedger() {
  await waitFor(() => expect(ledgerReads()).toHaveLength(1));
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

const menuTrigger = () => screen.queryByRole('button', { name: '«marketplace.detail.moreOptions»' });

async function openLocalMenu() {
  const trigger = await screen.findByRole('button', { name: '«marketplace.detail.moreOptions»' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
}

beforeEach(() => {
  route.packageId = 'com.example.crm';
  viewer.isAdmin = true;
  vi.stubGlobal('confirm', () => true);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('MUST NOT CHANGE — a marketplace-off boot WITHOUT install-local', () => {
  it('renders the disabled notice alone and asks the server for nothing', async () => {
    await bootOffline(false, [CRM_ENTRY]);

    render(<MarketplacePackagePage />);
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(menuTrigger()).toBeNull();
    expect(screen.queryByText('com.example.crm')).toBeNull();
    // Not "the answer was ignored": nothing was asked, the ledger included.
    expect(calls).toEqual([]);
  });
});

describe('a marketplace-off boot that permits install-local, seen by an admin', () => {
  it('adds the local header and menu ABOVE the notice, which is never retracted', async () => {
    await bootOffline(true, [CRM_ENTRY]);

    render(<MarketplacePackagePage />);
    // First frame, before the ledger answers: the notice, as before.
    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'com.example.crm' })).toBeInTheDocument();
    expect(screen.getByText('«marketplace.detail.installedV»')).toBeInTheDocument();
    expect(menuTrigger()).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();

    await openLocalMenu();
    expect(await screen.findByRole('menuitem', { name: '«marketplace.detail.reseedAgain»' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: '«marketplace.detail.purgeSampleData»' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('menuitem', { name: '«marketplace.detail.uninstallFromRuntime»' })).toBeInTheDocument();
  });

  it('keeps the REMOTE half refused: no catalog or cloud request, no install CTA, readme or versions', async () => {
    await bootOffline(true, [CRM_ENTRY]);

    render(<MarketplacePackagePage />);
    await screen.findByRole('heading', { name: 'com.example.crm' });

    expect(remoteCalls()).toEqual([]);
    for (const key of [
      '«marketplace.action.installToCloud»',
      '«marketplace.action.install»',
      '«marketplace.action.reinstall»',
      '«marketplace.detail.about»',
      '«marketplace.detail.versions»',
      '«marketplace.back»',
    ]) {
      expect(screen.queryByText(key)).toBeNull();
    }
  });

  it('Re-seed issues POST install-local/com.example.crm/reseed-sample-data', async () => {
    await bootOffline(true, [CRM_ENTRY]);

    render(<MarketplacePackagePage />);
    await openLocalMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: '«marketplace.detail.reseedAgain»' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: '/api/v1/marketplace/install-local/com.example.crm/reseed-sample-data',
        method: 'POST',
      }),
    );
    expect(await screen.findByText('«marketplace.detail.reseedLocalSuccess»')).toBeInTheDocument();
  });

  it('Purge issues POST install-local/com.example.crm/purge-sample-data (issued, not graded)', async () => {
    await bootOffline(true, [CRM_ENTRY]);

    render(<MarketplacePackagePage />);
    await openLocalMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: '«marketplace.detail.purgeSampleData»' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: '/api/v1/marketplace/install-local/com.example.crm/purge-sample-data',
        method: 'POST',
      }),
    );
  });

  // The frame is the one this page always drew; the ledger read before it is
  // new, and is what makes the absence of a menu here a reading rather than
  // an answer that has not arrived yet.
  it('a package that is NOT a local install gets the notice alone once the ledger has answered', async () => {
    await bootOffline(true, [{ ...CRM_ENTRY, packageId: 'com.example.todo', manifestId: 'com.example.todo' }]);

    render(<MarketplacePackagePage />);
    await settleLedger();

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(menuTrigger()).toBeNull();
  });
});

describe('the route id is matched on the field Installed Apps builds the link from', () => {
  // A package installed from the catalog while the marketplace was on keeps
  // the catalog's package id in its ledger entry, distinct from its manifest
  // id. Installed Apps links `entry.packageId`; the install-local routes are
  // keyed by manifest id.
  const CATALOG_ENTRY = { ...CRM_ENTRY, packageId: 'pkg_7f3', manifestId: 'com.acme.crm' };

  it('matches `packageId`, and the menu acts on the MANIFEST id', async () => {
    route.packageId = 'pkg_7f3';
    await bootOffline(true, [CATALOG_ENTRY]);

    render(<MarketplacePackagePage />);
    expect(await screen.findByRole('heading', { name: 'com.acme.crm' })).toBeInTheDocument();
    await openLocalMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: '«marketplace.detail.reseedAgain»' }));

    await waitFor(() =>
      expect(calls).toContainEqual({
        path: '/api/v1/marketplace/install-local/com.acme.crm/reseed-sample-data',
        method: 'POST',
      }),
    );
  });

  it('does not ALSO match on the manifest id — one field, no alias', async () => {
    route.packageId = 'com.acme.crm';
    await bootOffline(true, [CATALOG_ENTRY]);

    render(<MarketplacePackagePage />);
    await settleLedger();

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(menuTrigger()).toBeNull();
  });
});
