// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The catalog page's org install, on a cloud-managed environment, waits until
 * the runtime serves the installed package's app before it pulses the metadata
 * refresh (objectui#12097, the sibling of objectui#12087).
 *
 * ## The defect
 *
 * `doOrgInstall`'s cloud branch sent `emitMetadataRefresh()` the moment
 * `installPackage` answered. A cloud install answers once the control plane has
 * written the installation; the environment's runtime then rebuilds its kernel
 * and, until the rebuild lands, keeps serving the PRE-install kernel (measured
 * ~60 s on staging, objectui#12087). The pulse makes every mounted
 * `MetadataProvider` re-read its loaded types and persist them, so it read, and
 * kept, the pre-install `app` list. objectui#12096 fixed the package page; this
 * page did not call `waitForServedApp`.
 *
 * ## The harness: a virtual clock
 *
 * The REAL `waitForServedApp`, with its REAL interval and bound
 * (`SERVED_APP_POLL_INTERVAL_MS`, `SERVED_APP_WAIT_CAP_MS`): only its `now` and
 * `sleep` are swapped for a virtual clock, and each sleep is a gate the test
 * opens one interval at a time. The runtime is a fake adapter whose
 * `GET /meta/app` answers the pre-install list until `REBUILD_MS` of virtual
 * time has passed since the install, then the post-install one. The REAL
 * `MetadataProvider` and the REAL assistant bus are mounted, so "no refresh" is
 * asserted on the pulses the bus carried and on what the provider actually
 * wrote to the `app` session seed, not on a spy of the page's own calls.
 *
 * ## The cases
 *
 * - the stale window: no pulse and no pre-install seed write while the stale
 *   list is served; one pulse, and 「打开 <app>」, once the app is served;
 * - expiry: the honest timeout, no pulse, no success, nothing persisted, and
 *   "Check again" starts another wait;
 * - CONTROL: the `installLocal` branch (the runtime hot-registers before it
 *   answers) refreshes at once, as before, and starts no wait;
 * - objectui#12098: that branch answered `hotLoaded: false` (the runtime's
 *   lenient path, objectstack#22695) says the app loads at the next restart,
 *   and sends no refresh.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
  useParams: () => ({}),
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

const PKG = 'com.acme.crm';
/** A "Your organization" row as the control plane's `GET /cloud/org-packages` builds it. */
const ORG_ROW = {
  id: 'pkg_1',
  manifest_id: PKG,
  display_name: 'Acme CRM',
  description: 'A CRM.',
  category: null,
  icon_url: null,
  visibility: 'org',
  latest_version: '1.0.0',
};
const PRE = [{ name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' }];
const POST = [...PRE, { name: 'crm_enterprise', label: 'Acme CRM', _packageId: PKG }];

/** The virtual clock the wait reads, and the sleeps it is parked on. */
const clock = { now: 0, pending: [] as Array<() => void>, sleeps: [] as number[] };

/**
 * The runtime. A cloud install starts a rebuild that serves the pre-install
 * kernel for `rebuildMs` of virtual time; an install-local hot-registers before
 * it answers.
 */
const REBUILD_MS = 60_000;
const server = { installedAt: null as number | null, rebuildMs: REBUILD_MS, hotRegistered: false, hotLoaded: true };
const serving = () =>
  server.hotRegistered || (server.installedAt !== null && clock.now - server.installedAt >= server.rebuildMs);

const installs: Array<{ route: 'cloud' | 'local'; input: Record<string, unknown> }> = [];
vi.mock('../marketplaceApi', () => ({
  listMarketplacePackages: async () => ({ items: [] }),
  listLocalInstalls: async () =>
    // The ledger lists a local install whether or not the kernel registered it.
    installs.some((i) => i.route === 'local')
      ? [{ packageId: PKG, versionId: 'v1', manifestId: PKG, version: '1.0.0', installedAt: '2026-10-11T00:00:00.000Z' }]
      : [],
  listOrgPackages: async () => ({ connected: true, items: [ORG_ROW] }),
  listInstalledPackages: async () => ({
    connected: true,
    items:
      server.installedAt === null
        ? []
        : [{ packageId: PKG, versionId: 'v1', manifestId: PKG, version: '1.0.0', installedAt: '2026-10-11T00:00:00.000Z' }],
  }),
  installPackage: async (input: Record<string, unknown>) => {
    installs.push({ route: 'cloud', input });
    server.installedAt = clock.now;
    return { installation: { id: 'inst_1', environment_id: 'env_1', package_id: 'pkg_1', version: '1.0.0' } };
  },
  installLocal: async (input: Record<string, unknown>) => {
    installs.push({ route: 'local', input });
    server.hotRegistered = server.hotLoaded;
    return { manifestId: PKG, version: '1.0.0', hotLoaded: server.hotLoaded };
  },
}));

/** Every wait the page starts: its manifest id and version, and whether it kept the real interval and bound. */
const waits: Array<{ manifestId: string; version: string | undefined; defaults: boolean }> = [];
vi.mock('../waitForServedApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../waitForServedApp')>();
  return {
    ...actual,
    waitForServedApp: (o: Parameters<typeof actual.waitForServedApp>[0]) => {
      waits.push({ manifestId: o.manifestId, version: o.version, defaults: o.intervalMs === undefined && o.capMs === undefined });
      return actual.waitForServedApp({
        ...o,
        now: () => clock.now,
        sleep: (ms: number) =>
          new Promise<void>((resolve) => {
            clock.sleeps.push(ms);
            clock.pending.push(() => {
              clock.now += ms;
              resolve();
            });
          }),
      });
    },
  };
});

import { AdapterCtx, useMetadata } from '@object-ui/react';
import { ActiveOrganizationStorage } from '@object-ui/auth';
import { MetadataProvider } from '../../../providers/MetadataProvider';
import { subscribeMetadataRefresh } from '../../../assistant/assistantBus';
import { initRuntimeConfig, resetRuntimeConfigForTesting } from '../../../runtime-config';
import { SERVED_APP_POLL_INTERVAL_MS, SERVED_APP_WAIT_CAP_MS } from '../waitForServedApp';
import { MarketplacePage } from '../MarketplacePage';

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
        getItems: async (type: string) => ({ type, items: type === 'app' ? (serving() ? POST : PRE) : [] }),
        getItem: async () => ({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** Every pulse the bus carried: when, and whether the runtime served the app by then. */
let pulses: Array<{ at: number; served: boolean }> = [];
let unsubscribe: () => void = () => {};

/** Every write of the `app` seed: whether it came after the install, and whether it carried the app. */
let seedWrites: Array<{ afterInstall: boolean; hasApp: boolean }> = [];
const realSetItem = Storage.prototype.setItem;
const staleSeedWrites = () => seedWrites.filter((w) => w.afterInstall && !w.hasApp);

function AppsProbe() {
  const { apps } = useMetadata();
  return <span data-testid="apps">{apps.map((a: { name: string }) => a.name).join(',')}</span>;
}

async function bootConsole(features: { installLocal: boolean }) {
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
        features: { installLocal: features.installLocal, marketplace: true, aiStudio: true, autoPublishAiBuilds: true },
        branding: { productName: 'ObjectOS', productShortName: 'ObjectOS' },
      }),
    })),
  );
  await initRuntimeConfig();
}

async function renderPageAndInstall() {
  const adapter = makeAdapter();
  render(
    <AdapterCtx.Provider value={adapter}>
      <MetadataProvider adapter={adapter}>
        <MarketplacePage />
        <AppsProbe />
      </MetadataProvider>
    </AdapterCtx.Provider>,
  );
  await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup'));
  const card = await screen.findByTestId(`org-card-${PKG}`);
  fireEvent.click(within(card).getByRole('button', { name: '«marketplace.org.install»' }));
  // The install answered and the page re-read its lists: the card is badged.
  await within(card).findByText('«marketplace.org.installedBadge»');
}

/** Let one poll interval pass on the virtual clock: open the wait's one pending sleep. */
async function elapseInterval() {
  await waitFor(() => expect(clock.pending).toHaveLength(1));
  await act(async () => {
    clock.pending.shift()!();
  });
}

beforeEach(() => {
  clock.now = 0;
  clock.pending.length = 0;
  clock.sleeps.length = 0;
  server.installedAt = null;
  server.rebuildMs = REBUILD_MS;
  server.hotRegistered = false;
  server.hotLoaded = true;
  installs.length = 0;
  waits.length = 0;
  navigate.mockReset();
  pulses = [];
  seedWrites = [];
  sessionStorage.clear();
  ActiveOrganizationStorage.set('org_1');
  unsubscribe = subscribeMetadataRefresh(() => pulses.push({ at: clock.now, served: serving() }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('objectui:metadata:app:')) {
      const items = JSON.parse(value) as Array<{ _packageId?: string }>;
      seedWrites.push({
        afterInstall: installs.length > 0,
        hasApp: items.some((a) => a._packageId === PKG),
      });
    }
    return realSetItem.call(this, key, value);
  });
});

afterEach(() => {
  unsubscribe();
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetRuntimeConfigForTesting();
  sessionStorage.clear();
});

describe('MarketplacePage org install waits for the installed app to be served (objectui#12097)', () => {
  it('sends no refresh while the stale list is served, and one once the app is served', async () => {
    await bootConsole({ installLocal: false });
    await renderPageAndInstall();

    // The install answered inside the rebuild window: nothing is refreshed yet.
    expect(installs).toEqual([{ route: 'cloud', input: { packageId: 'pkg_1', environmentId: '', seedSampleData: true } }]);
    expect(pulses).toEqual([]);
    expect(staleSeedWrites()).toEqual([]);
    expect(waits).toEqual([{ manifestId: PKG, version: '1.0.0', defaults: true }]);
    const status = screen.getByTestId('org-deploy-status');
    expect(status).toHaveTextContent('Acme CRM');
    expect(status).toHaveTextContent('«marketplace.install.deploying»');
    // No success is claimed before the app is served.
    expect(screen.queryByText('«marketplace.org.installed:Acme CRM»')).not.toBeInTheDocument();

    // The rebuild serves the stale list for REBUILD_MS: one read per interval,
    // and after each one the wait sleeps again with nothing refreshed.
    const staleIntervals = REBUILD_MS / SERVED_APP_POLL_INTERVAL_MS - 1;
    for (let i = 0; i < staleIntervals; i++) {
      await elapseInterval();
      await waitFor(() => expect(clock.pending).toHaveLength(1));
      expect(pulses).toEqual([]);
      expect(staleSeedWrites()).toEqual([]);
      expect(screen.getByTestId('org-deploy-status')).toHaveTextContent('«marketplace.install.deploying»');
    }

    // The interval at which the rebuild lands: the app is served, then refreshed.
    await elapseInterval();
    const open = await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' });
    expect(screen.getByTestId('org-deploy-status')).toHaveTextContent('«marketplace.install.deployed»');
    expect(pulses).toEqual([{ at: REBUILD_MS, served: true }]);
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup,crm_enterprise'));
    expect(staleSeedWrites()).toEqual([]);
    expect(seedWrites.some((w) => w.afterInstall && w.hasApp)).toBe(true);
    expect(clock.sleeps).toEqual(Array(REBUILD_MS / SERVED_APP_POLL_INTERVAL_MS).fill(SERVED_APP_POLL_INTERVAL_MS));

    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith(`/apps/${PKG}`);
  });

  it('on expiry says the app has not appeared, refreshes nothing, and "Check again" waits again', async () => {
    server.rebuildMs = Number.POSITIVE_INFINITY;
    await bootConsole({ installLocal: false });
    await renderPageAndInstall();

    // Every interval of the bound passes with the stale list served.
    for (let i = 0; i < SERVED_APP_WAIT_CAP_MS / SERVED_APP_POLL_INTERVAL_MS; i++) await elapseInterval();
    const status = await screen.findByTestId('org-deploy-status');
    await waitFor(() => expect(status).toHaveTextContent('«marketplace.install.deployTimeout»'));
    expect(status).toHaveTextContent('Acme CRM');
    expect(clock.now).toBe(SERVED_APP_WAIT_CAP_MS);
    expect(clock.pending).toEqual([]);
    expect(pulses).toEqual([]);
    expect(seedWrites.filter((w) => w.afterInstall)).toEqual([]);
    expect(screen.getByTestId('apps').textContent).toBe('setup');
    expect(screen.queryByText('«marketplace.install.deployed»')).not.toBeInTheDocument();
    expect(screen.queryByText('«marketplace.org.installed:Acme CRM»')).not.toBeInTheDocument();

    // The rebuild lands; asking again finds the app on its first read.
    server.rebuildMs = 0;
    fireEvent.click(within(status).getByRole('button', { name: '«marketplace.install.checkAgain»' }));
    expect(await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' })).toBeInTheDocument();
    expect(waits).toEqual([
      { manifestId: PKG, version: '1.0.0', defaults: true },
      { manifestId: PKG, version: '1.0.0', defaults: true },
    ]);
    expect(pulses).toEqual([{ at: SERVED_APP_WAIT_CAP_MS, served: true }]);
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup,crm_enterprise'));
    expect(staleSeedWrites()).toEqual([]);
  });

  it('CONTROL: the installLocal branch refreshes at once, as before, and starts no wait', async () => {
    await bootConsole({ installLocal: true });
    await renderPageAndInstall();

    expect(installs).toEqual([{ route: 'local', input: { packageId: PKG, versionId: 'latest' } }]);
    await waitFor(() => expect(pulses).toEqual([{ at: 0, served: true }]));
    expect(screen.getByText('«marketplace.org.installed:Acme CRM»')).toBeInTheDocument();
    expect(waits).toEqual([]);
    expect(clock.sleeps).toEqual([]);
    expect(screen.queryByTestId('org-deploy-status')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe('setup,crm_enterprise'));
    expect(staleSeedWrites()).toEqual([]);
  });

  it('objectui#12098: the installLocal branch answered hotLoaded: false says the app loads at the next restart, and sends no refresh', async () => {
    server.hotLoaded = false;
    await bootConsole({ installLocal: true });
    await renderPageAndInstall();

    expect(installs).toEqual([{ route: 'local', input: { packageId: PKG, versionId: 'latest' } }]);
    expect(await screen.findByText('«marketplace.install.localLoadsAtRestart:Acme CRM»')).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.org.installed:Acme CRM»')).not.toBeInTheDocument();
    expect(pulses).toEqual([]);
    expect(seedWrites.filter((w) => w.afterInstall)).toEqual([]);
    expect(waits).toEqual([]);
    expect(screen.getByTestId('apps').textContent).toBe('setup');
  });
});
