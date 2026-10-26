// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The package page says what the runtime served (objectui#12098).
 *
 * ## Two readers of an install answer
 *
 * - **install-local's `hotLoaded`.** The runtime answers `200` with
 *   `hotLoaded: false` when the running kernel could not register a
 *   cloud-fetched manifest (objectstack#22695): the package is installed and
 *   loads at the next restart. The page said the app "should now appear" and
 *   refreshed the app list over a kernel that does not hold it.
 * - **an upgrade's served version.** After a cloud install the page waits until
 *   the package's app is served (objectui#12087). On an upgrade the stale
 *   kernel still serves the OLD version's app under the same `_packageId`, so
 *   the wait settled at once and the page persisted the pre-upgrade list. The
 *   runtime stamps `_packageVersion` (objectstack#22689), and the wait now
 *   matches the version the install answer names.
 *
 * ## The harness
 *
 * The REAL `MetadataProvider` and the REAL assistant bus, over a fake adapter
 * whose `GET /meta/app` answers as the runtime would. "No refresh" is asserted
 * on the app-list reads the adapter served, the pulses the bus carried and the
 * `app` seed writes the provider made. The upgrade runs the REAL
 * `waitForServedApp` with its REAL interval and bound on a virtual clock: each
 * sleep is a gate the test opens one interval at a time.
 */

import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react';

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

const PKG = 'com.acme.crm';
const PACKAGE = {
  package: {
    id: 'pkg_1',
    manifest_id: PKG,
    display_name: 'Acme CRM',
    description: 'A CRM.',
    latest_version: { id: 'v2', version: '1.1.0' },
  },
  versions: [{ id: 'v2', version: '1.1.0' }, { id: 'v1', version: '1.0.0' }],
};
const SETUP = { name: 'setup', label: 'Setup', _packageId: 'com.objectstack.setup' };
const appAt = (version: string | undefined) => ({
  name: 'crm_enterprise',
  label: 'Acme CRM',
  _packageId: PKG,
  ...(version === undefined ? {} : { _packageVersion: version }),
});

/** The virtual clock the wait reads, and the sleeps it is parked on. */
const clock = { now: 0, pending: [] as Array<() => void>, sleeps: [] as number[] };

/**
 * The runtime. Before the install it serves `before`. A cloud install starts a
 * rebuild that keeps serving `before` for `rebuildMs` of virtual time, then
 * serves `after`. An install-local answers `hotLoaded` and changes nothing it
 * serves: a hot-registered app is not modelled here, only whether it is read.
 */
const REBUILD_MS = 3 * 5_000;
const server = {
  before: [SETUP] as unknown[],
  after: [SETUP] as unknown[],
  rebuildMs: REBUILD_MS,
  installedAt: null as number | null,
  hotLoaded: true,
  appReadsAfterInstall: 0,
};
const serving = () => server.installedAt !== null && clock.now - server.installedAt >= server.rebuildMs;

vi.mock('../marketplaceApi', () => ({
  getMarketplacePackage: async () => PACKAGE,
  // The environment holds 1.0.0 before the install, so the page offers the update.
  getCloudInstallationInfo: async () => ({ installationId: 'inst_1', version: '1.0.0', withSampleData: false }),
  listLocalInstalls: async () => [],
  installPackage: async ({ environmentId }: { environmentId: string }) => {
    server.installedAt = clock.now;
    return { installation: { id: 'inst_1', environment_id: environmentId, package_id: 'pkg_1', version: '1.1.0' } };
  },
  installLocal: async () => {
    server.installedAt = clock.now;
    return {
      manifestId: PKG,
      version: '1.1.0',
      versionId: 'v2',
      installedAt: '2026-10-11T00:00:00.000Z',
      hotLoaded: server.hotLoaded,
      upgradedFrom: null,
    };
  },
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

/** Every wait the page starts: the manifest id and the version it names. */
const waits: Array<{ manifestId: string; version: string | undefined }> = [];
vi.mock('../waitForServedApp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../waitForServedApp')>();
  return {
    ...actual,
    waitForServedApp: (o: Parameters<typeof actual.waitForServedApp>[0]) => {
      waits.push({ manifestId: o.manifestId, version: o.version });
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
import { SERVED_APP_POLL_INTERVAL_MS } from '../waitForServedApp';
import { MarketplacePackagePage } from '../MarketplacePackagePage';

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
          if (server.installedAt !== null) server.appReadsAfterInstall++;
          return { type, items: serving() ? server.after : server.before };
        },
        getItem: async () => ({ item: null }),
      },
    }),
  } as unknown as Parameters<typeof MetadataProvider>[0]['adapter'];
}

/** Every pulse the bus carried, at its virtual time. */
let pulses: number[] = [];
let unsubscribe: () => void = () => {};

/** Every write of the `app` seed after the install: the `_packageVersion` of the package's app in it, if any. */
let seedWrites: Array<string | null> = [];
const realSetItem = Storage.prototype.setItem;

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

async function renderPage() {
  const adapter = makeAdapter();
  render(
    <AdapterCtx.Provider value={adapter}>
      <MetadataProvider adapter={adapter}>
        <MarketplacePackagePage />
        <AppsProbe />
      </MetadataProvider>
    </AdapterCtx.Provider>,
  );
  await waitFor(() => expect(screen.getByTestId('apps').textContent).toBe(server.before.map((a) => (a as { name: string }).name).join(',')));
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
  server.before = [SETUP];
  server.after = [SETUP];
  server.rebuildMs = REBUILD_MS;
  server.installedAt = null;
  server.hotLoaded = true;
  server.appReadsAfterInstall = 0;
  waits.length = 0;
  navigate.mockReset();
  pulses = [];
  seedWrites = [];
  sessionStorage.clear();
  ActiveOrganizationStorage.set('org_1');
  unsubscribe = subscribeMetadataRefresh(() => pulses.push(clock.now));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
    if (key.startsWith('objectui:metadata:app:') && server.installedAt !== null) {
      const items = JSON.parse(value) as Array<{ _packageId?: string; _packageVersion?: string }>;
      const app = items.find((a) => a._packageId === PKG);
      seedWrites.push(app ? (app._packageVersion ?? 'unstamped') : null);
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

describe('install-local reads hotLoaded (objectui#12098)', () => {
  async function installLocally() {
    await bootConsole({ installLocal: true });
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.install»' }));
  }

  it('a 200 with hotLoaded: false says the app loads at the next restart, and refreshes no app list', async () => {
    server.hotLoaded = false;
    await installLocally();

    expect(await screen.findByText('«marketplace.install.localLoadsAtRestart:Acme CRM»')).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.install.localSuccess:Acme CRM»')).not.toBeInTheDocument();
    // Nothing of the package is served before the restart: no read, no pulse, no seed.
    expect(server.appReadsAfterInstall).toBe(0);
    expect(pulses).toEqual([]);
    expect(seedWrites).toEqual([]);
    expect(waits).toEqual([]);
  });

  it('CONTROL: hotLoaded: true keeps the "should now appear" wording and refreshes the app list', async () => {
    server.hotLoaded = true;
    await installLocally();

    expect(await screen.findByText('«marketplace.install.localSuccess:Acme CRM»')).toBeInTheDocument();
    expect(screen.queryByText('«marketplace.install.localLoadsAtRestart:Acme CRM»')).not.toBeInTheDocument();
    expect(server.appReadsAfterInstall).toBeGreaterThan(0);
    expect(pulses).toEqual([0]);
    expect(waits).toEqual([]);
  });
});

describe('an upgrade waits for the new version to be served (objectui#12098)', () => {
  async function upgrade() {
    await bootConsole({ installLocal: false });
    await renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '«marketplace.action.updateTo»' }));
    // The dialog an upgrade opens is an UPDATE dialog, whose primary button
    // reads "Update" like the page's own (objectui#12146).
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '«marketplace.action.updateTo»' }));
  }

  it('keeps waiting while 1.0.0 is served, and refreshes once 1.1.0 is served', async () => {
    server.before = [SETUP, appAt('1.0.0')];
    server.after = [SETUP, appAt('1.1.0')];
    await upgrade();
    expect(await screen.findByText('«marketplace.install.deploying»')).toBeInTheDocument();
    // The wait names the version the install answer names.
    expect(waits).toEqual([{ manifestId: PKG, version: '1.1.0' }]);

    // The stale kernel serves 1.0.0: one read per interval, nothing refreshed.
    for (let i = 0; i < REBUILD_MS / SERVED_APP_POLL_INTERVAL_MS - 1; i++) {
      await elapseInterval();
      await waitFor(() => expect(clock.pending).toHaveLength(1));
      expect(pulses).toEqual([]);
      expect(seedWrites).toEqual([]);
      expect(screen.getByTestId('install-deploy-status')).toHaveTextContent('«marketplace.install.deploying»');
    }

    // The interval at which the rebuild lands: 1.1.0 is served, then refreshed.
    await elapseInterval();
    expect(await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' })).toBeInTheDocument();
    // An upgrade's served state says it updated (objectui#12146), not the install's "deployed".
    expect(screen.getByTestId('install-deploy-status')).toHaveTextContent('«marketplace.update.success»');
    expect(pulses).toEqual([REBUILD_MS]);
    await waitFor(() => expect(seedWrites).toContain('1.1.0'));
    expect(seedWrites.every((v) => v === '1.1.0')).toBe(true);
    expect(clock.sleeps).toEqual(Array(REBUILD_MS / SERVED_APP_POLL_INTERVAL_MS).fill(SERVED_APP_POLL_INTERVAL_MS));
  });

  it('CONTROL: an app with no _packageVersion (a runtime before the stamp) is accepted on the id, as today', async () => {
    server.before = [SETUP, appAt(undefined)];
    server.after = [SETUP, appAt(undefined)];
    await upgrade();

    expect(await screen.findByRole('button', { name: '«marketplace.install.openApp:Acme CRM»' })).toBeInTheDocument();
    expect(waits).toEqual([{ manifestId: PKG, version: '1.1.0' }]);
    expect(clock.sleeps).toEqual([]);
    expect(pulses).toEqual([0]);
  });
});
