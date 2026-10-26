// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `MarketplacePackagePage`'s third fetch effect — `listLocalInstalls` — is
 * gated on the same predicates that make its only consumer reachable
 * (objectui#5620).
 *
 * ## The defect
 *
 * objectui#5533 and objectui#5583 gated `getMarketplacePackage` and
 * `getCloudInstallationInfo` on `marketplaceEnabled` and `isAdmin`, but the
 * page's third effect was left checking only `features.installLocal`:
 *
 *     useEffect(() => {
 *       if (!getRuntimeConfig().features.installLocal) return;
 *       ...listLocalInstalls()...
 *     }, [packageId, localResult]);
 *
 * `listLocalInstalls`'s only consumer is `localInstalls.find(...)` in the
 * CONTENT branch, reached only after both `!marketplaceEnabled` and
 * `!isAdmin` have already returned early. So on any runtime with
 * `features.installLocal: true`, the request still fired — and its answer
 * was discarded — on a marketplace-off runtime and for a refused viewer.
 *
 * ## objectui#11627 retired the `marketplaceEnabled` half
 *
 * On a marketplace-OFF runtime that mounts install-local, the answer now HAS a
 * consumer: an admin whose package is a local install gets its local menu
 * above the disabled notice, and this request is what decides that. So the
 * case that pinned "never fires on a marketplace-off runtime, even for an
 * admin with installLocal on" pinned exactly the branch that card removed, and
 * was replaced, not respelled. What still holds on a marketplace-off runtime,
 * and is pinned below, is the rest of this card's class: no request where its
 * answer has nowhere to go — installLocal off, or a refused viewer. The
 * positive half lives in `MarketplacePackagePage.offlineLocalMenu-11627.test.tsx`.
 *
 * ## What is NOT claimed
 *
 * That `features.installLocal` stops mattering. It is a genuinely separate
 * deployment axis from `features.marketplace` (a runtime can mount a local
 * kernel install path with no marketplace proxy at all), so the fix ADDS the
 * two predicates as a conjunction rather than replacing the existing check —
 * the negative controls below pin that `installLocal: false` still skips the
 * request even when marketplace is on and the viewer is an admin.
 *
 * ## Why these cases boot the REAL runtime-config module
 *
 * Same argument the sibling suites make (`*.guardOrder`, `*.disabledState`):
 * `features.marketplace` and `features.installLocal` are both server-derived
 * runtime config, never inferred from the shape of a failure, so every case
 * boots the genuine `initRuntimeConfig()` over a stubbed
 * `GET /api/v1/runtime/config` and lets the real merge run.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/** The viewer's privilege, varied per case — one of the two axes this suite exists for. */
const viewer = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.acme.crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: true }),
}));

// `t` echoes the KEY, for the reason the sibling suites give: a `t` echoing
// `defaultValue` renders identical text whether or not the key is wired, and
// the claim under test is WHICH state — and so which string — the page reaches.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      typeof opts?.url === 'string' ? `«${key}:${opts.url}»` : `«${key}»`,
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
// Renders nothing here: it fetches its own suggestions on mount, which is a
// second network surface this suite is not about.
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

/** A `GET /api/v1/runtime/config` answer, as the server sends it. */
type ConfigBody = Record<string, unknown>;

const serverConfig = (marketplace: boolean, installLocal: boolean): ConfigBody => ({
  cloudUrl: marketplace ? 'https://cloud.objectos.ai' : '',
  singleEnvironment: true,
  features: { installLocal, marketplace, aiStudio: true, autoPublishAiBuilds: true },
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
});

/** Boot the SPA against a runtime that answers with `body`. */
async function bootOn(body: ConfigBody) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => body })),
  );
  await initRuntimeConfig();
}

const PACKAGE = {
  package: {
    id: 'pkg_1',
    manifest_id: 'com.acme.crm',
    display_name: 'Acme CRM',
    description: 'A CRM.',
    latest_version: null,
  },
  versions: [],
};

beforeEach(() => {
  viewer.isAdmin = false;
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
  listLocalInstalls.mockReset();
  getMarketplacePackage.mockResolvedValue(PACKAGE);
  getCloudInstallationInfo.mockResolvedValue(null);
  listLocalInstalls.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('listLocalInstalls on a marketplace-OFF runtime', () => {
  it('never fires when installLocal is off too, even for an admin', async () => {
    viewer.isAdmin = true;
    await bootOn(serverConfig(false, false));

    render(<MarketplacePackagePage />);

    await waitFor(() => expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument());
    expect(listLocalInstalls).not.toHaveBeenCalled();
  });

  it('never fires for a refused (non-admin) viewer, even with installLocal on', async () => {
    viewer.isAdmin = false;
    await bootOn(serverConfig(false, true));

    render(<MarketplacePackagePage />);

    await waitFor(() => expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument());
    expect(listLocalInstalls).not.toHaveBeenCalled();
  });
});

describe('listLocalInstalls for a REFUSED (non-admin) viewer', () => {
  it('never fires on a runtime that does mount a marketplace', async () => {
    viewer.isAdmin = false;
    await bootOn(serverConfig(true, true));

    render(<MarketplacePackagePage />);

    await waitFor(() =>
      expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument(),
    );
    expect(listLocalInstalls).not.toHaveBeenCalled();
  });
});

describe('POSITIVE CONTROL — admin + marketplace on + installLocal on', () => {
  it('fires the request and renders the local-install badge from its answer', async () => {
    viewer.isAdmin = true;
    await bootOn(serverConfig(true, true));
    listLocalInstalls.mockResolvedValue([
      { manifestId: 'com.acme.crm', version: '1.2.0', withSampleData: false },
    ]);

    render(<MarketplacePackagePage />);

    await screen.findByText('Acme CRM');
    expect(listLocalInstalls).toHaveBeenCalled();
    expect(await screen.findByText('«marketplace.detail.installedV»')).toBeInTheDocument();
  });
});

describe('NEGATIVE CONTROL — features.installLocal itself is untouched', () => {
  it('still skips the request when installLocal is off, even for an admin on a marketplace-on runtime', async () => {
    viewer.isAdmin = true;
    await bootOn(serverConfig(true, false));

    render(<MarketplacePackagePage />);

    await screen.findByText('Acme CRM');
    expect(listLocalInstalls).not.toHaveBeenCalled();
  });
});

describe('an admin whose adminship resolves AFTER first paint', () => {
  it('fetches local installs once the flag flips, instead of staying gated forever', async () => {
    await bootOn(serverConfig(true, true));

    const { rerender } = render(<MarketplacePackagePage />);

    expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument();
    expect(listLocalInstalls).not.toHaveBeenCalled();

    viewer.isAdmin = true;
    rerender(<MarketplacePackagePage />);

    await waitFor(() => expect(listLocalInstalls).toHaveBeenCalled());
  });
});
