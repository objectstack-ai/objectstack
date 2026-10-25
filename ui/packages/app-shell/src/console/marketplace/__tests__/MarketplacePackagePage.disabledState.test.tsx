// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package DETAIL page answers a marketplace-less runtime the same way its
 * sibling catalog page does (objectui#5533).
 *
 * ## The defect
 *
 * objectui#5504 (PR #5517) gave `MarketplacePage` an informational "App
 * Marketplace is turned off" state when the server reports
 * `features.marketplace: false`, and withheld both Home entries that lead
 * there. `MarketplacePackagePage` was left on the old path, so the same
 * `OS_CLOUD_URL=off` runtime rendered a red "Failed to load package / Not
 * found." card here — two sibling pages disagreeing about one runtime. It is
 * reachable exactly the way an operator keeps a package URL: a bookmark or a
 * paste that survives a redeploy which flipped `OS_CLOUD_URL` to `off`.
 *
 * ## Why these cases drive the REAL runtime-config module
 *
 * Same argument as `MarketplacePage.disabledState.test.tsx`: the whole
 * correctness claim is *where the disabled state comes from*. It comes from
 * `features.marketplace`, which the server derives from its own route table
 * (objectstack#8356) — never from the shape of a failure. Mocking
 * `isMarketplaceEnabled()` would assert against a hand-written stand-in for
 * that read, so every case here boots the genuine `initRuntimeConfig()` over a
 * stubbed `GET /api/v1/runtime/config` and lets the real merge run.
 *
 * ## The inversion these cases exist to prevent
 *
 * Turning the disabled state into "swallow all errors" would be worse than the
 * defect it replaces. So the negative controls below are load-bearing: with
 * `features.marketplace: true`, a nonexistent package id must STILL produce the
 * destructive card, and a runtime that answers nothing at all must still fetch
 * (`isMarketplaceEnabled()` fails open by design).
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.acme.crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// `t` echoes the KEY (not `defaultValue`), for the reason the sibling suite
// gives: a `t` echoing defaults renders identical text whether or not the key
// is wired, and this page's whole claim is WHICH string it reaches for.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

const getMarketplacePackage = vi.fn();
const getCloudInstallationInfo = vi.fn();
const listLocalInstalls = vi.fn();

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: (...a: unknown[]) => getMarketplacePackage(...a),
  getCloudInstallationInfo: (...a: unknown[]) => getCloudInstallationInfo(...a),
  listLocalInstalls: (...a: unknown[]) => listLocalInstalls(...a),
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

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** A `GET /api/v1/runtime/config` answer, as the server sends it. */
type ConfigBody = Record<string, unknown>;

const serverConfig = (cloudUrl: string, marketplace: boolean): ConfigBody => ({
  cloudUrl,
  singleEnvironment: true,
  features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
});

/** Boot the SPA against a runtime that answers with `body`. */
async function bootOn(body: ConfigBody | null) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      body === null
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => body },
    ),
  );
  await initRuntimeConfig();
}

/** What a runtime with no marketplace proxy actually returns for the detail route. */
const DETAIL_404 = () => Promise.reject(new Error('HTTP 404: no such package'));

beforeEach(() => {
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
  listLocalInstalls.mockReset();
  getMarketplacePackage.mockImplementation(DETAIL_404);
  getCloudInstallationInfo.mockResolvedValue(null);
  listLocalInstalls.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('a bookmarked package URL on a runtime deployed with OS_CLOUD_URL=off', () => {
  beforeEach(async () => {
    await bootOn(serverConfig('', false));
  });

  it('renders the disabled state, not a load failure', () => {
    render(<MarketplacePackagePage />);

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(screen.getByText('«marketplace.disabled.title»')).toBeInTheDocument();
    // The red card is gone: this runtime did not fail to load a package, it has
    // no marketplace to load one from.
    expect(screen.queryByText('«marketplace.load.packageFailed»')).toBeNull();
    expect(screen.queryByText('«marketplace.load.notFound»')).toBeNull();
  });

  it('offers no way back to the catalog — which is itself turned off', () => {
    render(<MarketplacePackagePage />);

    // `MarketplaceDisabled` takes no props and ships exactly one affordance:
    // back to the app home. A "Back to marketplace" button here would land the
    // operator on a second copy of this same notice.
    expect(screen.queryByText('«marketplace.back»')).toBeNull();
    expect(screen.getByText('«marketplace.action.backHome»')).toBeInTheDocument();
  });

  it('issues no package request it already knows will 404', async () => {
    render(<MarketplacePackagePage />);

    // Not "the error was swallowed" — nothing was asked for. A request fired
    // here still hits the server, and can race the destructive card onto the
    // screen before the disabled state settles.
    await waitFor(() => expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument());
    expect(getMarketplacePackage).not.toHaveBeenCalled();
    expect(getCloudInstallationInfo).not.toHaveBeenCalled();
  });
});

describe('the negative controls — a runtime that DOES have a marketplace', () => {
  it('still renders the destructive card for a package that genuinely is not there', async () => {
    // The inversion guard: the fix must not become "swallow all errors". A
    // nonexistent package id on a working catalog is a real load failure and
    // must stay one.
    await bootOn(serverConfig('https://cloud.objectos.ai', true));

    render(<MarketplacePackagePage />);

    await screen.findByText('«marketplace.load.packageFailed»');
    // The server's OWN words, not a swallowed failure and not the
    // `marketplace.load.notFound` fallback: the card only falls back to that key
    // when there is no error message to show.
    expect(screen.getByText('HTTP 404: no such package')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
  });

  it('renders the package when the catalog answers', async () => {
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
    getMarketplacePackage.mockResolvedValue({
      package: {
        id: 'pkg_1',
        manifest_id: 'com.acme.crm',
        display_name: 'Acme CRM',
        description: 'A CRM.',
        latest_version: null,
      },
      versions: [],
    });

    render(<MarketplacePackagePage />);

    await screen.findByText('Acme CRM');
    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
    expect(getMarketplacePackage).toHaveBeenCalledWith('com.acme.crm');
  });
});

describe('a runtime that answers nothing at all', () => {
  it('fails OPEN — an unanswered question never withholds a working detail page', async () => {
    // A build predating `/api/v1/runtime/config`: the endpoint 404s and the SPA
    // keeps its defaults. Reading that as "disabled" would strip the package
    // page from every older runtime that has one.
    await bootOn(null);

    render(<MarketplacePackagePage />);

    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
    await waitFor(() => expect(getMarketplacePackage).toHaveBeenCalled());
  });
});
