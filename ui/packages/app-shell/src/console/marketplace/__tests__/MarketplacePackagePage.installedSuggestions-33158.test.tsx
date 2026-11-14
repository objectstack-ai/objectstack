// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#33158 (ADR-0090 D5) — an installed package's marketplace page
 * draws its suggested audience bindings on every visit, not only in an
 * install's own result. A package installed earlier, or from the cloud
 * console, has no install result on this page, and its pending default
 * permission set had no door left to accept it.
 *
 * The REAL page and the REAL `SuggestedBindingsPanel`, over a stub of the
 * suggestion door's client and of the marketplace calls the page makes.
 *
 * Pinned:
 *  - a package installed into this environment (the cloud installation read
 *    answers installed), with no install in this session: a pending
 *    suggestion renders the panel with Accept and Dismiss, listed for the
 *    package's manifest id;
 *  - the same for a local install this runtime loaded;
 *  - CONTROL: an installed package with no suggestion renders nothing new;
 *  - CONTROL: a package not installed here does not read the list at all;
 *  - a list refused `403` (a caller without `manage_metadata`) renders no
 *    panel and no error.
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';

const PKG = 'app.example.crm';

const state = vi.hoisted(() => ({
  cloudInstall: null as null | { installationId: string; version: string; withSampleData: boolean },
  localInstalls: [] as unknown[],
  installLocal: false,
}));

const api = vi.hoisted(() => ({
  list: vi.fn(),
  confirm: vi.fn(),
  dismiss: vi.fn(),
  reopen: vi.fn(),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ packageId: 'pkg_1' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  useAuth: () => ({ activeOrganization: { id: 'org_1' } }),
}));

// `t` echoes the KEY, as the sibling suites do.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string) => `«${key}»`,
    language: 'en',
  }),
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock('../../../assistant/assistantBus', () => ({ emitMetadataRefresh: () => {} }));
vi.mock('../../../providers/MetadataProvider', () => ({ useMetadata: () => ({ refresh: () => {} }) }));

vi.mock('../../../services/suggestedBindingsApi', () => ({
  listSuggestedBindings: api.list,
  confirmSuggestedBinding: api.confirm,
  dismissSuggestedBinding: api.dismiss,
  reopenSuggestedBinding: api.reopen,
}));

vi.mock('../marketplaceApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getMarketplacePackage: async () => PACKAGE,
  getCloudInstallationInfo: async () => state.cloudInstall,
  listLocalInstalls: async () => state.localInstalls,
  countLocalSampleData: async () => null,
}));

import { toast } from 'sonner';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const PACKAGE = {
  package: {
    id: 'pkg_1',
    manifest_id: PKG,
    display_name: 'Example CRM',
    description: 'A CRM.',
    latest_version: { id: 'v1', version: '6.1.2' },
  },
  versions: [{ id: 'v1', version: '6.1.2' }],
};

const PENDING = {
  id: 'sug_1',
  package_id: PKG,
  permission_set_name: 'crm_user',
  anchor: 'everyone' as const,
  status: 'pending' as const,
};

const LOCAL_ENTRY = {
  packageId: 'pkg_1',
  versionId: 'v1',
  manifestId: PKG,
  version: '6.1.2',
  installedAt: '2026-11-01T00:00:00.000Z',
  withSampleData: false,
};

function refused(status: number, code: string, message: string): Error {
  return Object.assign(new Error(message), { status, code });
}

async function boot() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const path = new URL(String(input), 'http://console.test').pathname;
      if (path === '/api/v1/runtime/config') {
        return new Response(
          JSON.stringify({
            cloudUrl: 'https://cloud.example',
            singleEnvironment: true,
            defaultEnvironmentId: 'env_1',
            features: { installLocal: state.installLocal, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
            branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: path } }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }),
  );
  await initRuntimeConfig();
}

beforeEach(() => {
  state.cloudInstall = null;
  state.localInstalls = [];
  state.installLocal = false;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
});

/** Wait for the page header (the catalog read has answered). */
const pageReady = () => screen.findByText('Example CRM', undefined, { timeout: 8000 });

describe('objectstack#33158 — an installed package page draws its suggested bindings', () => {
  it('installed into this environment, no install this session: a pending suggestion offers Accept and Dismiss', async () => {
    state.cloudInstall = { installationId: 'inst_1', version: '6.1.2', withSampleData: false };
    api.list.mockResolvedValue([PENDING]);
    await boot();
    render(<MarketplacePackagePage />);
    const row = within(await screen.findByTestId('suggested-binding-crm_user', undefined, { timeout: 8000 }));
    expect(row.getByTestId('suggested-binding-confirm-crm_user')).toHaveTextContent('«marketplace.suggestedBindings.confirm»');
    expect(row.getByTestId('suggested-binding-dismiss-crm_user')).toHaveTextContent('«marketplace.suggestedBindings.dismiss»');
    expect(api.list).toHaveBeenCalledWith({ packageId: PKG });
    // One panel on screen for the package.
    expect(screen.getAllByTestId('suggested-bindings-panel')).toHaveLength(1);
  });

  it('a local install this runtime loaded: the same panel', async () => {
    state.installLocal = true;
    state.localInstalls = [LOCAL_ENTRY];
    api.list.mockResolvedValue([PENDING]);
    await boot();
    render(<MarketplacePackagePage />);
    expect(await screen.findByTestId('suggested-binding-confirm-crm_user', undefined, { timeout: 8000 })).toBeInTheDocument();
    expect(api.list).toHaveBeenCalledWith({ packageId: PKG });
  });

  it('CONTROL: an installed package with no suggestion renders nothing new', async () => {
    state.cloudInstall = { installationId: 'inst_1', version: '6.1.2', withSampleData: false };
    api.list.mockResolvedValue([]);
    await boot();
    render(<MarketplacePackagePage />);
    await pageReady();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('suggested-bindings-panel')).toBeNull();
  });

  it('CONTROL: a package not installed here does not read the suggestions at all', async () => {
    api.list.mockResolvedValue([PENDING]);
    await boot();
    render(<MarketplacePackagePage />);
    await pageReady();
    await new Promise((r) => setTimeout(r, 20));
    expect(api.list).not.toHaveBeenCalled();
    expect(screen.queryByTestId('suggested-bindings-panel')).toBeNull();
  });

  it('a list refused 403 (no manage_metadata) renders no panel and no error', async () => {
    state.cloudInstall = { installationId: 'inst_1', version: '6.1.2', withSampleData: false };
    api.list.mockRejectedValue(
      refused(403, 'PERMISSION_DENIED', 'listing audience-binding suggestions requires the `manage_metadata` capability.'),
    );
    await boot();
    render(<MarketplacePackagePage />);
    await pageReady();
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId('suggested-bindings-panel')).toBeNull();
    expect(screen.queryByText(/manage_metadata/)).toBeNull();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
