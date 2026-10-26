// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A cloud Re-seed / Purge refused with `ENVIRONMENT_KERNEL_UNAVAILABLE` renders
 * as a TERMINAL refusal: one sentence, and no retry offered (objectui#10432).
 *
 * ## What the code means
 *
 * cloud#2072 ruled that a control plane with no environment kernels refuses
 * re-seed / purge with HTTP 500 and code `ENVIRONMENT_KERNEL_UNAVAILABLE`. That
 * is a fact about how the deployment is composed. No retry on that deployment
 * can succeed, so the page says so and stops offering the two actions.
 * `INTERNAL_ERROR` is different: the environment kernel could not be reached
 * right now, and a retry may well work.
 *
 * ## How the page offered a retry before
 *
 * A failed call rendered its text in the inline status banner and left both
 * menu items enabled, so the user could pick the same action again. On a 500
 * that text is the control plane's withheld generic sentence, the same for
 * both faults.
 *
 * ## What the cases pin
 *
 * - The kernel code renders the new sentence (the key, because `t` echoes keys
 *   here) instead of the withheld text, and disables BOTH cloud sample-data
 *   actions, whichever of the two was refused.
 * - CONTROL: `INTERNAL_ERROR` keeps today's behaviour: the response's own text
 *   in the banner, and both actions still enabled.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.acme.crm' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
}));

// `t` echoes the KEY, as the sibling suites do: the claim under test is WHICH
// sentence the page picks, and a `t` that echoed prose could not tell a wired
// key from a fallback.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

const reseedSampleData = vi.fn();
const purgeSampleData = vi.fn();

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: async () => PACKAGE,
  getCloudInstallationInfo: async () => ({
    installationId: 'inst_1',
    version: '1.0.0',
    withSampleData: true,
  }),
  listLocalInstalls: async () => [],
  listMarketplacePackages: async () => ({ items: [] }),
  listOrgPackages: async () => ({ items: [] }),
  listInstalledPackages: async () => ({ items: [] }),
  installPackage: async () => ({}),
  installLocal: async () => ({}),
  uninstallLocal: async () => ({}),
  listCloudEnvironments: async () => [],
  listInstallableOrgIds: async () => [],
  cloudConsoleUrl: () => '',
  reseedSampleData: (...a: unknown[]) => reseedSampleData(...a),
  purgeSampleData: (...a: unknown[]) => purgeSampleData(...a),
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

/** The withheld 5xx sentence: what `error` holds on every 500. */
const WITHHELD = 'Internal server error';

/**
 * Boot the SPA as the control plane itself (`cloudUrl: ''`): the one runtime
 * where the page renders the cloud Re-seed / Purge menu.
 */
async function bootOnControlPlane() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cloudUrl: '',
        singleEnvironment: true,
        features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
}

/** Open the cloud sample-data menu and return its two items. */
async function openMenu() {
  const trigger = await screen.findByRole('button', { name: '«marketplace.detail.moreOptions»' });
  fireEvent.keyDown(trigger, { key: 'Enter' });
  return {
    reseed: await screen.findByRole('menuitem', { name: '«marketplace.detail.reseedAgain»' }),
    purge: await screen.findByRole('menuitem', { name: '«marketplace.detail.purgeSampleData»' }),
  };
}

beforeEach(async () => {
  reseedSampleData.mockReset();
  purgeSampleData.mockReset();
  vi.stubGlobal('confirm', () => true);
  await bootOnControlPlane();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

const KERNEL_REFUSAL = { ok: false, error: WITHHELD, code: 'ENVIRONMENT_KERNEL_UNAVAILABLE' };
const INTERNAL_FAULT = { ok: false, error: WITHHELD, code: 'INTERNAL_ERROR' };

describe('ENVIRONMENT_KERNEL_UNAVAILABLE is a terminal refusal', () => {
  it('a refused Re-seed renders the kernel sentence and disables both actions', async () => {
    reseedSampleData.mockResolvedValue(KERNEL_REFUSAL);
    render(<MarketplacePackagePage />);

    fireEvent.click((await openMenu()).reseed);

    expect(await screen.findByText('«marketplace.detail.sampleDataKernelUnavailable»')).toBeInTheDocument();
    expect(screen.queryByText(WITHHELD)).not.toBeInTheDocument();
    const { reseed, purge } = await openMenu();
    expect(reseed).toHaveAttribute('aria-disabled', 'true');
    expect(purge).toHaveAttribute('aria-disabled', 'true');
  });

  it('a refused Purge renders the kernel sentence and disables both actions', async () => {
    purgeSampleData.mockResolvedValue(KERNEL_REFUSAL);
    render(<MarketplacePackagePage />);

    fireEvent.click((await openMenu()).purge);

    expect(await screen.findByText('«marketplace.detail.sampleDataKernelUnavailable»')).toBeInTheDocument();
    expect(screen.queryByText(WITHHELD)).not.toBeInTheDocument();
    const { reseed, purge } = await openMenu();
    expect(reseed).toHaveAttribute('aria-disabled', 'true');
    expect(purge).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('CONTROL: INTERNAL_ERROR keeps today\'s retryable behaviour', () => {
  it('a Re-seed refused with INTERNAL_ERROR shows its own text and leaves both actions enabled', async () => {
    reseedSampleData.mockResolvedValue(INTERNAL_FAULT);
    render(<MarketplacePackagePage />);

    fireEvent.click((await openMenu()).reseed);

    expect(await screen.findByText(WITHHELD)).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.detail.sampleDataKernelUnavailable»')).not.toBeInTheDocument();
    const { reseed, purge } = await openMenu();
    await waitFor(() => expect(reseed).not.toHaveAttribute('aria-disabled'));
    expect(purge).not.toHaveAttribute('aria-disabled');
  });

  it('a Purge refused with INTERNAL_ERROR shows its own text and leaves both actions enabled', async () => {
    purgeSampleData.mockResolvedValue(INTERNAL_FAULT);
    render(<MarketplacePackagePage />);

    fireEvent.click((await openMenu()).purge);

    expect(await screen.findByText(WITHHELD)).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.detail.sampleDataKernelUnavailable»')).not.toBeInTheDocument();
    const { reseed, purge } = await openMenu();
    await waitFor(() => expect(reseed).not.toHaveAttribute('aria-disabled'));
    expect(purge).not.toHaveAttribute('aria-disabled');
  });
});
