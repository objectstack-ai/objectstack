// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The install dialog's "Open on Cloud" link opens the control plane's declared
 * console home page when the runtime serves one (objectstack#34622).
 *
 * ## What the code reads
 *
 * When the dialog cannot list the caller's cloud environments it offers an
 * "Open on Cloud" exit. `RuntimeConfigPlugin` serves a top-level
 * `cloudHomeUrl` when the host declares the control plane's console home page;
 * the page opens it verbatim. Without the key the link is today's:
 * `cloudConsoleUrl()` (the runtime's `cloudUrl`), drawn only when the runtime
 * named an upstream cloud.
 *
 * ## What the cases pin
 *
 * - Declared: the link opens `cloudHomeUrl`, not the cloud origin, and is
 *   drawn even on a runtime whose `cloudUrl` is empty.
 * - CONTROL, absent: the link opens the cloud origin, and is not drawn at all
 *   when the runtime names no upstream cloud.
 *
 * `cloudConsoleUrl` is the real implementation, so the fallback asserted is
 * the one the page ships. `t` echoes the KEY.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'com.acme.crm' }),
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

vi.mock('../marketplaceApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../marketplaceApi')>();
  return {
    getMarketplacePackage: async () => PACKAGE,
    getServedPackageBody: async () => null,
    declaredInstallModesOf: () => undefined,
    getInstallNamespace: async () => null,
    getCloudInstallationInfo: async () => null,
    listLocalInstalls: async () => [],
    installPackage: async () => ({}),
    installLocal: async () => ({}),
    uninstallLocal: async () => ({}),
    // The environment list cannot be read: the branch that offers the link.
    listCloudEnvironments: async () => { throw new Error('ENV-LIST-FAILED sentinel'); },
    listInstallableOrgIds: async () => new Set<string>(),
    cloudConsoleUrl: actual.cloudConsoleUrl,
    reseedSampleData: async () => ({ ok: true }),
    purgeSampleData: async () => ({ ok: true }),
    reseedLocalSampleData: async () => ({ ok: true }),
    purgeLocalSampleData: async () => ({ ok: true }),
    countLocalSampleData: async () => null,
  };
});

vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));
vi.mock('../../../components/SuggestedBindingsPanel', () => ({ SuggestedBindingsPanel: () => null }));

import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const PACKAGE = {
  package: {
    id: 'pkg_1',
    manifest_id: 'com.acme.crm',
    display_name: 'Acme CRM',
    description: 'A CRM.',
    latest_version: { id: 'ver_1', version: '1.0.0' },
  },
  versions: [{ id: 'ver_1', version: '1.0.0' }],
};

const CLOUD_ORIGIN = 'https://cloud.example.test';
const CLOUD_HOME = 'https://cloud.example.test/_console/?from=marketplace';

/** Boot as a hosted runtime: no install-local door, no environment of its own. */
async function boot(served: Record<string, unknown>) {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        singleEnvironment: false,
        features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
        ...served,
      }),
    })),
  );
  await initRuntimeConfig();
}

/** Open the install dialog and wait for the environment-list failure it renders. */
async function openFailedInstallDialog(): Promise<HTMLElement> {
  render(<MarketplacePackagePage />);
  fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.installToCloud»' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByText('ENV-LIST-FAILED sentinel');
  return dialog;
}

/** The "Open on Cloud" anchor in the dialog, or null when it is not drawn. */
function openOnCloudLink(dialog: HTMLElement): HTMLAnchorElement | null {
  const label = within(dialog).queryByText('«marketplace.action.openOnCloud»');
  return label ? (label.closest('a') as HTMLAnchorElement | null) : null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

describe('"Open on Cloud" opens the declared cloudHomeUrl (objectstack#34622)', () => {
  it('declared: the link opens cloudHomeUrl verbatim, not the cloud origin', async () => {
    await boot({ cloudUrl: CLOUD_ORIGIN, cloudHomeUrl: CLOUD_HOME });
    const link = openOnCloudLink(await openFailedInstallDialog());
    expect(link).not.toBeNull();
    expect(link).toHaveAttribute('href', CLOUD_HOME);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('declared on a runtime with an empty cloudUrl: the link is drawn', async () => {
    await boot({ cloudUrl: '', cloudHomeUrl: CLOUD_HOME });
    const link = openOnCloudLink(await openFailedInstallDialog());
    expect(link).toHaveAttribute('href', CLOUD_HOME);
  });

  it('CONTROL, absent: the link opens the cloud origin, as before', async () => {
    await boot({ cloudUrl: CLOUD_ORIGIN });
    const link = openOnCloudLink(await openFailedInstallDialog());
    expect(link).toHaveAttribute('href', CLOUD_ORIGIN);
  });

  it('CONTROL, absent with an empty cloudUrl: no link is drawn, as before', async () => {
    await boot({ cloudUrl: '' });
    const dialog = await openFailedInstallDialog();
    expect(openOnCloudLink(dialog)).toBeNull();
  });
});
