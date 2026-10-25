// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Neither marketplace page may refuse a viewer on a verdict that has not
 * resolved (objectui#5619).
 *
 * ## Why this suite mounts, rather than type-checks
 *
 * The defect is a RENDER-ORDERING artefact: the hook's inputs arrive in two
 * waves and the page decides on the first one. Nothing static can see that —
 * a green type-check is satisfied by any page that reads the new pair, whether
 * or not it acts on it. So each case renders the real page, reads the FRAME the
 * unresolved verdict produces, then flips the verdict and reads the frame
 * again. The assertion is the pair of frames.
 *
 * ## Why both pages, and why the negatives are here
 *
 * These two are the card's REFUSAL surfaces: they paint
 * `MarketplaceAccessDenied` — an access-denied screen at a real administrator,
 * which is the severe half of the split triage kept. `MarketplacePackagePage`'s
 * package fetch used to mask the window incidentally, for as long as an
 * unrelated request happened to take; objectui#5621 correctly removed that, so
 * both pages now reach the window with nothing in front of them.
 *
 * The negatives matter as much as the positive: a "fix" that simply stopped
 * refusing, or that held the resolving frame forever, would satisfy the first
 * case in each pair. `a settled non-admin is still refused` and `the
 * runtime-off answer still comes first` are what make that substitution fail —
 * the second one because objectui#5557/#5533 put `!marketplaceEnabled` ahead of
 * the privilege answer deliberately, and a guard inserted in the wrong place
 * would silently retire that ordering.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';

/** The viewer's verdict AND its resolution — the two axes this suite varies. */
const viewer = vi.hoisted(() => ({ isAdmin: false, isResolved: true }));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.acme.crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: viewer.isAdmin, isResolved: viewer.isResolved }),
}));

// `t` echoes the KEY — a `t` echoing `defaultValue` renders identical text
// whether or not the key is wired, and the claim under test is WHICH state the
// page reached, i.e. which string it chose.
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
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const serverConfig = (marketplace: boolean) => ({
  cloudUrl: marketplace ? 'https://cloud.example' : 'off',
  singleEnvironment: true,
  features: { installLocal: true, marketplace, aiStudio: true, autoPublishAiBuilds: true },
  branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
});

async function bootOn(marketplace: boolean) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => serverConfig(marketplace) })),
  );
  await initRuntimeConfig();
}

/**
 * Which KIND of frame the page produced. Named states rather than "did an
 * element render", so two different wrong frames can never read as agreement.
 */
type Frame = 'resolving' | 'access-denied' | 'runtime-off' | 'admin-surface';

function frame(): Frame {
  if (screen.queryByTestId('marketplace-resolving')) return 'resolving';
  if (screen.queryByTestId('marketplace-disabled')) return 'runtime-off';
  if (screen.queryByText('«marketplace.accessDenied.title»')) return 'access-denied';
  return 'admin-surface';
}

/**
 * Mount, read the frame, and read it again after the verdict resolves.
 *
 * `make()` builds a FRESH element for the second render on purpose. React bails
 * out of re-rendering when the next element is referentially identical to the
 * previous one, so passing the same `ReactElement` twice reads the first frame
 * again and both frames agree no matter what the page does — a green (or, as
 * here, a red) that measures the harness rather than the fix.
 */
function framesAcrossResolution(make: () => ReactElement, resolvedTo: boolean): [Frame, Frame] {
  viewer.isAdmin = false;
  viewer.isResolved = false;
  const { rerender, unmount } = render(make());
  const during = frame();
  viewer.isAdmin = resolvedTo;
  viewer.isResolved = true;
  rerender(make());
  const after = frame();
  unmount();
  return [during, after];
}

const PAGES: Array<[string, () => ReactElement]> = [
  ['MarketplacePage', () => <MarketplacePage />],
  ['MarketplacePackagePage', () => <MarketplacePackagePage />],
];

beforeEach(() => {
  viewer.isAdmin = false;
  viewer.isResolved = true;
  listMarketplacePackages.mockReset();
  getMarketplacePackage.mockReset();
  getCloudInstallationInfo.mockReset();
  listMarketplacePackages.mockResolvedValue({ items: [] });
  getMarketplacePackage.mockResolvedValue({ manifest_id: 'com.acme.crm', name: 'CRM' });
  getCloudInstallationInfo.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('marketplace refusal surfaces wait for the admin verdict (objectui#5619)', () => {
  describe.each(PAGES)('%s', (_name, make) => {
    it('shows the resolving frame while the verdict is in flight, then admits the admin', async () => {
      await bootOn(true);

      // Pre-fix the FIRST of these was 'access-denied' — the access-denied
      // screen painted at an administrator, for as long as the member row took.
      expect(framesAcrossResolution(make, true)).toEqual(['resolving', 'admin-surface']);
    });

    it('MUST NOT CHANGE — a settled non-admin is still refused', async () => {
      await bootOn(true);

      // The boundary that keeps the case above load-bearing: waiting is only
      // correct while the answer is unknown. Once it is known, the install
      // surface stays closed to a member.
      expect(framesAcrossResolution(make, false)).toEqual(['resolving', 'access-denied']);
    });

    it('MUST NOT CHANGE — the runtime-off answer still comes first, even unresolved', async () => {
      // objectui#5557 / #5533: "this runtime has no marketplace" is true of
      // every viewer and needs no verdict, so it must not fall behind a wait on
      // one. If the new guard were inserted above it, this reads 'resolving'.
      await bootOn(false);
      viewer.isAdmin = false;
      viewer.isResolved = false;

      const { unmount } = render(make());
      expect(frame()).toBe('runtime-off');
      unmount();
    });
  });
});
