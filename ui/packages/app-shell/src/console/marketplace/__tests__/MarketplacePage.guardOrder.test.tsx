// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog page answers "this runtime has no marketplace" BEFORE it answers
 * "you are not an admin" (objectui#5557).
 *
 * ## The defect
 *
 * `MarketplacePage` ordered its early returns admin-first:
 *
 *     if (!isAdmin) return (MarketplaceAccessDenied)
 *     if (!marketplaceEnabled) return (MarketplaceDisabled)
 *
 * so on an `OS_CLOUD_URL=off` deployment — the EE deploy template's factory
 * default — an unprivileged member was told they lack PERMISSION for a surface
 * that exists for nobody. That answer sends them to ask an administrator for a
 * grant that would not help them, and it left the disabled state objectui#5504
 * built unreachable for every non-admin. `MarketplacePackagePage` had already
 * been reordered under objectui#5533, so the two sibling pages disagreed about
 * one runtime for exactly one class of viewer.
 *
 * Its detail-page legs were written against an ordering that has since been
 * retired: objectui#5583 moved that page's `!isAdmin` guard ahead of its
 * `loading` and `error || !data` branches, so it no longer needs a package to
 * resolve before it can refuse anyone. The legs below now compare both pages'
 * answers from config and privilege alone, which is what "the same kind of
 * answer" was always meant to mean.
 *
 * ## Why a separate suite from `MarketplacePage.disabledState.test.tsx`
 *
 * That suite pins WHERE the disabled state comes from, and hard-mocks
 * `useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true })` at module scope — every case in it is an
 * admin, so none of them can see this defect. The admin flag has to vary per
 * case here, which is a different module mock and therefore a different file.
 *
 * ## Why these cases boot the REAL runtime-config module
 *
 * Same argument the sibling suites make: the disabled state's correctness is
 * *where it comes from*. It comes from `features.marketplace`, which the server
 * derives per request from its own route table (objectstack#8356) — never from
 * the shape of a failure. So every case boots the genuine `initRuntimeConfig()`
 * over a stubbed `GET /api/v1/runtime/config` and lets the real merge run.
 *
 * ## The control that makes the rest load-bearing
 *
 * objectui#5557 explicitly does NOT claim admin-first ordering is wrong in
 * general. On a runtime that DOES mount a marketplace, a non-admin must still
 * get access-denied — the catalog is an install surface. Without that boundary
 * case, a "fix" that simply deleted the admin check would satisfy every other
 * assertion in this file while handing an install surface to every member.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';

/** The viewer's privilege, varied per case — the axis this suite exists for. */
const viewer = vi.hoisted(() => ({ isAdmin: false }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  // `packageId` serves the detail page in the sibling-consistency case; the
  // catalog page reads only `appName`, so one mock drives both.
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

const listMarketplacePackages = vi.fn();
const getMarketplacePackage = vi.fn();
const getCloudInstallationInfo = vi.fn();

vi.mock('../marketplaceApi', () => ({
  listMarketplacePackages: (...a: unknown[]) => listMarketplacePackages(...a),
  getMarketplacePackage: (...a: unknown[]) => getMarketplacePackage(...a),
  getCloudInstallationInfo: (...a: unknown[]) => getCloudInstallationInfo(...a),
  listLocalInstalls: async () => [],
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

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePage } from '../MarketplacePage';
// Mounted to prove the two pages agree. objectui#5557 changed nothing in it;
// objectui#5583 later moved its `!isAdmin` guard ahead of its load branches,
// which is why the marketplace-ON leg below no longer has to resolve a package
// first.
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

/** What a runtime with no marketplace proxy actually returns for these routes. */
const NOT_FOUND = () => Promise.reject(new Error('HTTP 404: Not found'));

/**
 * Which KIND of answer a page gave this viewer — the unit the
 * sibling-consistency case compares. Deliberately not "did some element
 * render": two pages both rendering `other` would otherwise read as agreement.
 */
type Answer = 'runtime-off' | 'access-denied' | 'neither';

function classify(): Answer {
  return screen.queryByTestId('marketplace-disabled')
    ? 'runtime-off'
    : screen.queryByText('«marketplace.accessDenied.title»')
      ? 'access-denied'
      : 'neither';
}

/** The answer a page gives with no request settled — i.e. from config alone. */
function answerOf(ui: ReactElement): Answer {
  const { unmount } = render(ui);
  const answer = classify();
  unmount();
  return answer;
}

beforeEach(() => {
  viewer.isAdmin = false;
  listMarketplacePackages.mockReset();
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
  listMarketplacePackages.mockResolvedValue({ items: [] });
  getMarketplacePackage.mockImplementation(NOT_FOUND);
  getCloudInstallationInfo.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('a NON-ADMIN on a runtime deployed with OS_CLOUD_URL=off', () => {
  beforeEach(async () => {
    // What the EE template's factory default produces: no browse mount, so the
    // server's own derived flag is false.
    await bootOn(serverConfig('', false));
    listMarketplacePackages.mockImplementation(NOT_FOUND);
  });

  it('is told the runtime has no marketplace, never that they lack permission', () => {
    render(<MarketplacePage />);

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(screen.getByText('«marketplace.disabled.title»')).toBeInTheDocument();
    // The retired answer. It invited this viewer to go ask an administrator for
    // a grant that would not help them — there is nothing behind the door on
    // this deployment.
    expect(screen.queryByText('«marketplace.accessDenied.title»')).toBeNull();
    expect(screen.queryByText('«marketplace.accessDenied.description»')).toBeNull();
  });

  it('gets the SAME KIND of answer from the catalog page and the package detail page', () => {
    // The invariant objectui#5504 and objectui#5533 were closing, restored for
    // the one class of viewer it still failed for. Compared as kinds, so this
    // cannot pass by both pages rendering something unrelated.
    const catalog = answerOf(<MarketplacePage />);
    const detail = answerOf(<MarketplacePackagePage />);

    expect(catalog).toBe(detail);
    expect(catalog).toBe('runtime-off');
  });

  it('issues no catalog request it already knows will 404', async () => {
    render(<MarketplacePage />);

    await waitFor(() => expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument());
    expect(listMarketplacePackages).not.toHaveBeenCalled();
  });

  it('leaves the admin answer on this runtime exactly as it was', () => {
    // The reorder must be invisible to admins: they already reached the
    // disabled state, and objectui#5504's pins on it still hold.
    viewer.isAdmin = true;

    render(<MarketplacePage />);

    expect(screen.getByTestId('marketplace-disabled')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-disabled-hint')).toHaveTextContent(
      '«marketplace.disabled.hint»',
    );
  });
});

describe('the "Not claimed" boundary — a runtime that DOES have a marketplace', () => {
  beforeEach(async () => {
    await bootOn(serverConfig('https://cloud.objectos.ai', true));
  });

  it('still refuses a NON-ADMIN with access-denied, not with the disabled state', async () => {
    // THE CONTROL for this whole card. objectui#5557 does not claim admin-first
    // ordering is wrong in general: where a marketplace exists, the catalog is
    // an install surface and a member who cannot install has nothing to do with
    // it. A "fix" that deleted the admin check passes every other case in this
    // file and fails here.
    render(<MarketplacePage />);

    expect(await screen.findByText('«marketplace.accessDenied.title»')).toBeInTheDocument();
    expect(screen.getByText('«marketplace.accessDenied.description»')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
    // Not merely "some heading is missing": the catalog itself never rendered.
    expect(screen.queryByText('«marketplace.title»')).toBeNull();
  });

  it('and the detail page refuses that same non-admin the same way', () => {
    // The sibling invariant, stated in the other direction: agreement must hold
    // on a marketplace-ON runtime too, or "the pages agree" would only mean
    // "both pages are off".
    //
    // Both answers are read WITHOUT letting a request settle, and the ambient
    // `getMarketplacePackage` here is the `beforeEach` 404. Before
    // objectui#5583 the detail page needed a package that LOADS to reach a
    // refusal at all — a failing load sent it to the destructive card instead —
    // so this leg had to stub a resolving package and await the settled answer.
    // It no longer does, and not needing to is the point.
    const catalog = answerOf(<MarketplacePage />);
    const detail = answerOf(<MarketplacePackagePage />);

    expect(catalog).toBe(detail);
    expect(catalog).toBe('access-denied');
  });

  it('lets an admin through to the catalog, as before', async () => {
    viewer.isAdmin = true;

    render(<MarketplacePage />);

    expect(await screen.findByText('«marketplace.title»')).toBeInTheDocument();
    expect(screen.queryByTestId('marketplace-disabled')).toBeNull();
    expect(screen.queryByText('«marketplace.accessDenied.title»')).toBeNull();
    expect(listMarketplacePackages).toHaveBeenCalled();
  });
});
