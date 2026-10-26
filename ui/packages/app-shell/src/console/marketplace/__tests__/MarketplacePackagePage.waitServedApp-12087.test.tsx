// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * After an install into THIS environment, the page waits until the runtime
 * serves the installed package's app before it refreshes and persists the
 * metadata cache (objectui#12087).
 *
 * ## The defect
 *
 * A cloud install answers once the control plane has written the
 * installation. The environment's runtime then rebuilds its kernel and, until
 * the rebuild lands, keeps serving the PRE-install kernel (measured ~60 s on
 * staging). The page refreshed the metadata cache the moment the install
 * answered, so the refresh read the pre-install `app` list, and
 * `MetadataProvider` kept it: in memory with no re-read of its own, and in the
 * tab's sessionStorage seed. The success message showed; the app never
 * appeared in that tab.
 *
 * ## The harness
 *
 * The REAL `MetadataProvider` and the REAL assistant bus, over a fake adapter
 * whose `GET /meta/app` answers the pre-install list for `staleReads` reads
 * after the install, then the post-install one: the stale-while-rebuild window
 * in miniature. Every sessionStorage write of the `app` seed is recorded, so
 * "never persisted" is asserted on what the provider actually wrote, not on a
 * spy of the page's own calls. `waitForServedApp` runs for real with its
 * interval and bound shrunk, and its sleeps recorded.
 *
 * ## The cases
 *
 * - the stale window: no `app` list without the installed app is persisted
 *   after the install; the success state and 「打开 <app>」 appear only once
 *   the app is served, and closing the dialog does not hide them;
 * - expiry: the timeout message, no success, nothing persisted, and "Check
 *   again" starts another wait;
 * - CONTROL: an install the runtime serves at once refreshes on the first
 *   read, with no sleep before it.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({ packageId: 'pkg_1' }),
}));

vi.mock('@object-ui/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useWorkspaceAdminStatus: () => ({ isAdmin: true, isResolved: true }),
  useAuth: () => ({ activeOrganization: { id: 'org_1' } }),
}));

// `t` echoes the KEY (and the one interpolated name), as the sibling suites do:
// the claim is WHICH sentence the page picks.
vi.mock('@object-ui/i18n', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useObjectTranslation: () => ({
    t: (key: string, opts?: { name?: string }) => (opts?.name ? `«${key}:${opts.name}»` : `«${key}»`),
    language: 'en',
  }),
}));

const installs: string[] = [];
vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: async () => PACKAGE,
  getCloudInstallationInfo: async () => null,
  listLocalInstalls: async () => [],
  installPackage: async ({ environmentId }: { environmentId: string }) => {
    installs.push(environmentId);
    server.installed = true;
    return { installation: { id: 'inst_1', environment_id: environmentId, package_id: 'pkg_1', version: '1.0.0' } };
  },
  installLocal: async () => ({}),
  uninstallLocal: async () => ({}),
  listCloudEnvironments: async () => [],
  listInstallableOrgIds: async () => new Set<string>(),
  cloudConsoleUrl: () => '',
  reseedSampleData: async () => ({ ok: true }),
  purgeSampleData: async () => ({ ok: true }),
  reseedLocalSampleData: async () => ({ ok: true }),
  purgeLocalSampleData: async () => ({ ok: true }),
}));

// Mounts its own read of the runtime; here it only marks WHEN it mounts.
vi.mock('../../../components/SuggestedBindingsPanel', () => ({
  SuggestedBindingsPanel: () => <div data-testid="suggested-bindings" />,
}));

const sleeps: number[] = [];
vi.mock('../waitForServedApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../waitForServedApp')>();
  return {
    ...actual,
    waitForServedApp: (o: Parameters<typeof actual.waitForServedApp>[0]) =>
      actual.waitForServedApp({
        ...o,
        intervalMs: 20,
        capMs: 200,
        sleep: (ms: number) => {
          sleeps.push(ms);
          return new Promise<void>((resolve) => setTimeout(resolve, ms));
        },
      }),
  };
});

import { AdapterCtx, useMetadata } from '@object-ui/react';
import { ActiveOrganizationStorage } from '@object-ui/auth';
import { MetadataProvider } from '../../../providers/MetadataProvider';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

const PKG = 'com.acme.crm';
const PACKAGE = {
  package: {
    id: 'pkg_1',
    manifest_id: PKG,
    display_name: 'Acme CRM',
    description: 'A CRM.',
    latest_version: { id: 'v1', version: '1.0.0' },
  },
  versions: [{ id: 'v1', version: '1.0.0' }],
};
const PRE = [{ name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' }];
const POST = [...PRE, { name: 'crm_enterprise', label: 'Acme CRM', _packageId: PKG }];

/** The runtime: pre-install list until the install, then for `staleReads` more reads. */
const server = { installed: false, staleReads: 0, readsSinceInstall: 0 };

function makeAdapter() {
  return {
    clearCache: vi.fn(),
    // objectui#13044 — the real MetadataProvider reads an object by name through
    // the adapter's `getObjectSchema`; this double answers it from its own by-name door.
    getObjectSchema(this: { getClient(): any }, name: string) {
      return this.getClient()
        .meta.getItem('object', name)
        .then((res: any) => (res && typeof res === 'object' && 'item' in res ? res.item : res));
    },
    getClient: () => ({
      meta: {
        getItems: async (type: string) => {
          if (type !== 'app') return { type, items: [] };
          if (!server.installed) return { type, items: PRE };
          const stale = server.readsSinceInstall++ < server.staleReads;
          return { type, items: stale ? PRE : POST };
        },
        getItem: async () => ({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** Every write of the `app` seed: whether it came after the install, and whether it carried the app. */
let seedWrites: Array<{ afterInstall: boolean; hasApp: boolean }> = [];
const realSetItem = Storage.prototype.setItem;

function AppsProbe() {
  const { apps } = useMetadata();
  return <span data-testid="apps">{apps.map((a: { name: string }) => a.name).join(',')}</span>;
}

async function bootAsEnvironmentConsole() {
  resetRuntimeConfigForTesting();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cloudUrl: 'https://cloud.example',
        singleEnvironment: true,
        defaultEnvironmentId: 'env_1',
        features: { installLocal: false, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
}

function renderPage() {
  const adapter = makeAdapter();
  return render(
    <AdapterCtx.Provider value={adapter}>
      <MetadataProvider adapter={adapter}>
        <MarketplacePackagePage />
        <AppsProbe />
      </MetadataProvider>
    </AdapterCtx.Provider>,
  );
}

/** Open the dialog and install into this environment. */
async function install() {
  fireEvent.click(await screen.findByRole('button', { name: /«marketplace\.action\.installToCloud»/ }));
  fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.install»' }));
}

const staleSeedWrites = () => seedWrites.filter((w) => w.afterInstall && !w.hasApp);

beforeEach(async () => {
  server.installed = false;
  server.staleReads = 0;
  server.readsSinceInstall = 0;
  installs.length = 0;
  sleeps.length = 0;
  navigate.mockReset();
  seedWrites = [];
  sessionStorage.clear();
  ActiveOrganizationStorage.set('org_1');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('objectui:metadata:app:')) {
      const items = JSON.parse(value) as Array<{ _packageId?: string }>;
      seedWrites.push({ afterInstall: server.installed, hasApp: items.some((a) => a._packageId === PKG) });
    }
    return realSetItem.call(this, key, value);
  });
  await bootAsEnvironmentConsole();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
  sessionStorage.clear();
});

describe('MarketplacePackagePage waits for the installed app to be served (objectui#12087)', () => {
  it('persists no pre-install app list in the stale window, and offers 「打开」 once the app is served', async () => {
    server.staleReads = 3;
    renderPage();
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup'));
    await install();

    expect(await screen.findByText('«marketplace.install.deploying»')).toBeInTheDocument();
    expect(installs).toEqual(['env_1']);
    // No success is claimed, and no suggested bindings read the stale kernel.
    expect(screen.queryByText('«marketplace.install.success»')).not.toBeInTheDocument();
    expect(screen.queryByTestId('suggested-bindings')).not.toBeInTheDocument();

    // Closing the dialog does not hide what is still happening.
    fireEvent.click(screen.getByRole('button', { name: '«marketplace.action.close»' }));
    const open = await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' });
    expect(screen.getByTestId('install-deploy-status')).toHaveTextContent('«marketplace.install.deployed»');

    // The cache holds the installed app, in memory and in the persisted seed,
    // and no seed write after the install ever lacked it.
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup,crm_enterprise'));
    expect(staleSeedWrites()).toEqual([]);
    expect(seedWrites.some((w) => w.afterInstall && w.hasApp)).toBe(true);
    // The wait slept through the stale reads, one interval each.
    expect(sleeps).toEqual([20, 20, 20]);

    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith(`/apps/${PKG}`);
  });

  it('on expiry says the app has not appeared, persists nothing, and "Check again" waits again', async () => {
    server.staleReads = Number.POSITIVE_INFINITY;
    renderPage();
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup'));
    await install();

    expect(await screen.findByText('«marketplace.install.deployTimeout»', {}, { timeout: 2000 })).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.install.deployed»')).not.toBeInTheDocument();
    expect(screen.queryByText('«marketplace.install.success»')).not.toBeInTheDocument();
    expect(seedWrites.filter((w) => w.afterInstall)).toEqual([]);
    expect(screen.getByTestId('apps').textContent).toBe('setup');

    // The rebuild lands; asking again finds the app.
    server.staleReads = 0;
    server.readsSinceInstall = 0;
    fireEvent.click(screen.getByRole('button', { name: '«marketplace.install.checkAgain»' }));
    expect(await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup,crm_enterprise'));
    expect(staleSeedWrites()).toEqual([]);
  });

  it('CONTROL: an install served at once refreshes on the first read, with no sleep', async () => {
    server.staleReads = 0;
    renderPage();
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup'));
    await install();

    expect(await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' })).toBeInTheDocument();
    expect(sleeps).toEqual([]);
    expect(screen.getByTestId('suggested-bindings')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup,crm_enterprise'));
    expect(staleSeedWrites()).toEqual([]);
  });
});
