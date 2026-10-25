// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package detail page decides "you are not an admin" BEFORE it fetches,
 * and before it renders either the loading skeleton or the load-failure card
 * (objectui#5583).
 *
 * ## The defect
 *
 * `MarketplacePackagePage` ordered its early returns like this:
 *
 *     if (!marketplaceEnabled) return (MarketplaceDisabled)
 *     if (loading)             { ...skeleton... }
 *     if (error || !data)      { ...destructive "Failed to load package"... }
 *     ...
 *     if (!isAdmin)            return (MarketplaceAccessDenied)
 *
 * with both fetch effects gated on `marketplaceEnabled` alone. On a runtime
 * where the marketplace IS mounted, that produced two wrong answers for a
 * non-admin who opened a package URL:
 *
 *  1. When the load failed, they got the destructive card carrying the
 *     SERVER'S OWN error message — a diagnosis about a surface they are not
 *     allowed to use — and never reached the refusal at all. Whether they were
 *     refused or diagnosed came down to whether an unrelated request happened
 *     to succeed.
 *  2. `getMarketplacePackage` and `getCloudInstallationInfo` both fired on
 *     behalf of a viewer the page had already decided to turn away.
 *     objectui#5533 established on this same page that a request it knows it
 *     will discard should be skipped rather than fired.
 *
 * ## What is NOT claimed
 *
 * That the refusal itself is wrong, or that the server stops being the
 * authority on what a non-admin may fetch. This suite therefore carries a
 * control for every claim it makes: the SAME failing load, seen by an ADMIN,
 * must still produce the destructive card with the server's message intact. A
 * "fix" that hoisted the refusal unconditionally, or deleted the failure
 * branch, satisfies every non-admin case here and fails that one.
 *
 * ## Why these cases boot the REAL runtime-config module
 *
 * Same argument the sibling suites make (`MarketplacePage.guardOrder`,
 * `*.disabledState`): `features.marketplace` is derived by the server from its
 * own route table and is never inferred from the shape of a failure, so every
 * case boots the genuine `initRuntimeConfig()` over a stubbed
 * `GET /api/v1/runtime/config` and lets the real merge run.
 *
 * ## Why a separate suite from `MarketplacePackagePage.disabledState.test.tsx`
 *
 * That suite hard-mocks `useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true })` at module scope, so
 * every viewer in it is an admin and none of them can see this defect. The
 * admin flag has to vary per case here — a different module mock, therefore a
 * different file.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

/** The viewer's privilege, varied per case — the axis this suite exists for. */
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

const serverConfig = (cloudUrl: string, marketplace: boolean): ConfigBody => ({
  cloudUrl,
  singleEnvironment: true,
  features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
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

/**
 * The server's own words about a surface the viewer is not allowed to use.
 * Asserted as a STRING, not just "some error card": the defect handed this
 * exact text to a refused viewer.
 */
const SERVER_MESSAGE = 'HTTP 502: manifest store unreachable';

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

describe('a NON-ADMIN on a runtime that DOES mount a marketplace', () => {
  beforeEach(async () => {
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
  });

  it('is refused on the FIRST render, without being walked through the skeleton', () => {
    render(<MarketplacePackagePage />);

    // Deliberately synchronous — no `findBy`, no `waitFor`. Under the retired
    // ordering `loading` was seeded `true` on a marketplace-ON runtime, so the
    // first commit was the skeleton and this query found nothing. Reaching the
    // refusal with nothing awaited is the whole claim.
    expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument();
    expect(screen.getByText('«marketplace.accessDenied.description»')).toBeInTheDocument();
  });

  it('is refused rather than handed the server’s diagnosis when the load fails', async () => {
    getMarketplacePackage.mockRejectedValue(new Error(SERVER_MESSAGE));

    render(<MarketplacePackagePage />);

    expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument();
    // The retired answer: a destructive card about a surface this viewer may
    // not use, quoting the server verbatim.
    expect(screen.queryByText('«marketplace.load.packageFailed»')).toBeNull();
    expect(screen.queryByText(SERVER_MESSAGE)).toBeNull();
    // And it stays refused — the rejection settling later must not swap the
    // refusal out for the error card.
    await waitFor(() => expect(getMarketplacePackage).not.toHaveBeenCalled());
    expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument();
  });

  it('issues neither of the requests whose answers it would have thrown away', async () => {
    render(<MarketplacePackagePage />);

    await waitFor(() =>
      expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument(),
    );
    expect(getMarketplacePackage).not.toHaveBeenCalled();
    expect(getCloudInstallationInfo).not.toHaveBeenCalled();
  });
});

describe('CONTROL — the same runtime and the same failing load, seen by an ADMIN', () => {
  // Scoped to exactly what the cases above vary: same config, same package id,
  // same rejection. Only `isAdmin` differs, so these cases fail for any change
  // that reaches the refusal by breaking the load path rather than by ordering.
  beforeEach(async () => {
    viewer.isAdmin = true;
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
  });

  it('still gets the destructive card, still carrying the server’s own message', async () => {
    getMarketplacePackage.mockRejectedValue(new Error(SERVER_MESSAGE));

    render(<MarketplacePackagePage />);

    expect(await screen.findByText('«marketplace.load.packageFailed»')).toBeInTheDocument();
    expect(screen.getByText(SERVER_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.accessDenied.title»')).toBeNull();
  });

  it('still issues both requests and still renders the package it loads', async () => {
    render(<MarketplacePackagePage />);

    expect(await screen.findByText('Acme CRM')).toBeInTheDocument();
    expect(getMarketplacePackage).toHaveBeenCalledWith('com.acme.crm');
    expect(getCloudInstallationInfo).toHaveBeenCalled();
    expect(screen.queryByText('«marketplace.accessDenied.title»')).toBeNull();
    expect(screen.queryByText('«marketplace.load.packageFailed»')).toBeNull();
  });
});

describe('CONTROL — the ordering against `features.marketplace` is untouched', () => {
  beforeEach(async () => {
    // What the EE deploy template's factory default (`OS_CLOUD_URL=off`)
    // produces: no browse mount, so the server's derived flag is false.
    await bootOn(serverConfig('', false));
  });

  it('still tells a NON-ADMIN the runtime has no marketplace, not that they lack permission', () => {
    // The guard moved up, but not past this one. objectui#5557 and
    // objectui#5533 settled that "there is no marketplace here" is true of
    // every viewer and outranks a permission answer; hoisting `!isAdmin` one
    // line too far would re-break exactly that.
    render(<MarketplacePackagePage />);

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.accessDenied.title»')).toBeNull();
  });

  it('still tells an ADMIN the same thing, and asks the marketplace for nothing', async () => {
    viewer.isAdmin = true;

    render(<MarketplacePackagePage />);

    await waitFor(() =>
      expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument(),
    );
    expect(getMarketplacePackage).not.toHaveBeenCalled();
    expect(getCloudInstallationInfo).not.toHaveBeenCalled();
  });
});

describe('an admin whose adminship resolves AFTER first paint', () => {
  // Not hypothetical: `useWorkspaceAdminStatus` reads `activeMember`, which
  // `AuthProvider.refreshActiveMember` resolves asynchronously after the
  // session settles — so an admin holding the role through the org member row
  // renders once as a non-admin. Gating the fetches on `isAdmin` without
  // listing it as an effect dependency would leave that admin on a page that
  // never requests anything.
  beforeEach(async () => {
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
  });

  it('fetches once the flag flips, instead of sitting on a page that never loads', async () => {
    const { rerender } = render(<MarketplacePackagePage />);

    expect(screen.getByText('«marketplace.accessDenied.title»')).toBeInTheDocument();
    expect(getMarketplacePackage).not.toHaveBeenCalled();

    viewer.isAdmin = true;
    rerender(<MarketplacePackagePage />);

    expect(await screen.findByText('Acme CRM')).toBeInTheDocument();
    expect(getMarketplacePackage).toHaveBeenCalledWith('com.acme.crm');
    // The seed decision this depends on: `loading` stays seeded from
    // `marketplaceEnabled` alone, so the first admin render shows the skeleton
    // rather than the destructive "no data yet" card.
    expect(screen.queryByText('«marketplace.load.packageFailed»')).toBeNull();
  });
});
