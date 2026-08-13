// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8389 — an air-gapped runtime's WORKING install route must be DISCOVERABLE.
 *
 * #8343 stopped `OS_CLOUD_URL=off` from unmounting
 * `/api/v1/marketplace/install-local`, but mounted it ALONE: the offline arm
 * shipped no `RuntimeConfigPlugin`, so the box served no
 * `/api/v1/runtime/config` at all. From the Console's side that is
 * indistinguishable from "the feature does not exist" — it cannot learn the
 * route is there, and renders no install affordance for a capability that
 * works.
 *
 * That omission was forced, not careless: the plugin hardcoded
 * `features.marketplace: true`, so reporting install-local truthfully would
 * have asserted a browse capability definitively absent on a proxy-less
 * runtime — "trading the reported bug for its mirror image". #8356 removed the
 * constraint by deriving `features.marketplace` from the serving app's route
 * table, which is what unblocks this mount.
 *
 * ## What these tests assert, and why it is the PAYLOAD
 *
 * The acceptance is an OBSERVABLE: an `OS_CLOUD_URL=off` boot serves
 * `/api/v1/runtime/config` reporting `installLocal: true` AND
 * `marketplace: false`. So every case here reads the served body out of the
 * really-mounted handler, rather than asserting "the constructor was handed
 * `installLocal: true`". That distinction is load-bearing and dated: #8388
 * makes `features.installLocal` derived the same way `marketplace` now is,
 * keeping the constructor option only as an explicit override. A pin on the
 * constructor flag breaks the day it lands; a pin on the payload does not.
 *
 * ## Why `marketplace: false` is not a vacuous assertion here
 *
 * `false` is exactly what a runtime serving NOTHING would report if the
 * assertion were written loosely (`body?.features?.marketplace` on an absent
 * body), and "serves nothing" is precisely today's defect. Three guards:
 *
 *   - `readConfig` THROWS when `/api/v1/runtime/config` was never registered,
 *     so "nothing served" can never read as a passing `false`;
 *   - the same body must simultaneously report `installLocal: true`, which an
 *     unserved payload cannot do;
 *   - a positive control mounts the REAL `MarketplaceProxyPlugin` on the same
 *     app and requires `marketplace: true`, proving the flag is observed here
 *     and not pinned false by the fixture.
 *
 * ## What this harness re-spells, stated rather than hidden
 *
 * The mount itself lives deep inside `Serve.run()` behind a dynamic import,
 * where observing a mounting rule means booting a kernel — the same reason
 * `planMarketplaceWiring` exists as a pure static. So this file drives the
 * REAL decision function with the REAL constructor options off `Serve`, and
 * mounts the REAL plugins; the one thing it restates is the branch-to-plugin
 * mapping (`offlineRuntimeConfig` -> `RuntimeConfigPlugin`). Everything a
 * change would realistically touch — the flag, the options, the identities,
 * the plugins' own route strings — is read from source, not copied.
 */

import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Serve from '../src/commands/serve.js';

interface RouteRecord { method: string; path: string }

interface HonoShapedApp {
  routes: RouteRecord[];
  handlers: Map<string, any>;
  get(path: string, handler?: any): void;
  post(path: string, handler?: any): void;
  put(path: string, handler?: any): void;
  delete(path: string, handler?: any): void;
  head(path: string, handler?: any): void;
  all(path: string, handler?: any): void;
  use(path: string, handler?: any): void;
}

/**
 * A raw app shaped like the Hono instance `getRawApp()` returns: a public
 * `routes` ledger collecting EVERY registration, verb methods and
 * `use()`/`all()` alike. That ledger is what #8356's derivation reads, so a
 * fixture without it would make `features.marketplace` report `false` for the
 * wrong reason and the negative cases here would pass vacuously.
 */
function createApp(): HonoShapedApp {
  const routes: RouteRecord[] = [];
  const handlers = new Map<string, any>();
  const record = (method: string) => (path: string, handler?: any) => {
    routes.push({ method, path });
    handlers.set(`${method} ${path}`, handler);
  };
  return {
    routes,
    handlers,
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    delete: record('DELETE'),
    head: record('HEAD'),
    all: record('ALL'),
    use: record('ALL'),
  };
}

/** Start a plugin against `app` and fire its `kernel:ready` hooks. */
async function startOn(app: unknown, plugin: { start(ctx: any): Promise<void> }): Promise<void> {
  const hooks: Array<() => Promise<void>> = [];
  const services: Record<string, any> = {
    'http.server': { getRawApp: () => app },
    manifest: { register() {} },
    auth: { api: { getSession: async () => ({ user: { id: 'admin' } }) } },
    objectql: { syncSchemas: async () => undefined },
  };
  const ctx: any = {
    logger: { info() {}, warn() {}, error() {} },
    getService: (name: string) => {
      const svc = services[name];
      if (svc === undefined) throw new Error(`no ${name}`);
      return svc;
    },
    hook: (_event: string, cb: () => Promise<void>) => { hooks.push(cb); },
  };
  await plugin.start(ctx);
  for (const cb of hooks) await cb();
}

/**
 * Ask the mounted `/api/v1/runtime/config` for its payload.
 *
 * Throws when nothing mounted it. That throw is the whole reason this helper
 * exists: it is what stops "the runtime serves no config at all" — the defect
 * under test — from reading as a green `marketplace: false`.
 */
async function readConfig(app: HonoShapedApp): Promise<any> {
  const handler = app.handlers.get('GET /api/v1/runtime/config');
  if (typeof handler !== 'function') {
    throw new Error(
      'THE #8389 DEFECT: nothing mounted GET /api/v1/runtime/config — the Console has no way to '
      + 'discover the install-local route this runtime does serve',
    );
  }
  return handler({
    req: { header: () => undefined },
    json: (body: any) => body,
  });
}

function tempStorageDir(): string {
  return mkdtempSync(join(tmpdir(), 'os-8389-'));
}

/**
 * Boot the marketplace wiring's OFFLINE arm the way `Serve.run()` does, on a
 * shared raw app: ask the real decision function what to mount, then mount
 * exactly that, with the real plugins and the real constructor values.
 */
async function bootOfflineArm(options: {
  plugins?: readonly unknown[];
  storageDir: string;
  /** Extra plugins started on the SAME app before the arm runs (controls). */
  preMounted?: Array<{ start(ctx: any): Promise<void> }>;
}): Promise<{ app: HonoShapedApp; wiring: ReturnType<typeof Serve.planMarketplaceWiring> }> {
  const { MarketplaceInstallLocalPlugin, RuntimeConfigPlugin } = await import('@objectstack/cloud-connection');
  const app = createApp();
  for (const plugin of options.preMounted ?? []) await startOn(app, plugin);

  // `resolveCloudUrl()` maps every disable sentinel (`off`/`none`/`local`/
  // `disabled`) to '' — that empty string is what an `OS_CLOUD_URL=off` boot
  // actually hands this decision.
  const wiring = Serve.planMarketplaceWiring({
    isRuntimeHostKernel: false,
    marketplaceUrl: '',
    plugins: options.plugins ?? [],
  });

  if (wiring.offlineInstallLocal) {
    await startOn(app, new MarketplaceInstallLocalPlugin({
      controlPlaneUrl: Serve.OFFLINE_CONTROL_PLANE,
      storageDir: options.storageDir,
    }));
  }
  if (wiring.offlineRuntimeConfig) {
    await startOn(app, new RuntimeConfigPlugin({ ...Serve.RUNTIME_CONFIG_OPTIONS }));
  }
  return { app, wiring };
}

/** Minimal stand-in for a loaded plugin: what the resolver actually reads. */
function plugin(name: string, ctorName: string): { name: string } {
  const Ctor = { [ctorName]: class { name: string; constructor(n: string) { this.name = n; } } }[ctorName]!;
  return new Ctor(name) as { name: string };
}

const INSTALL_LOCAL = plugin(
  'com.objectstack.runtime.marketplace-install-local',
  'MarketplaceInstallLocalPlugin',
);
const RUNTIME_CONFIG = plugin(
  'com.objectstack.runtime.runtime-config',
  'RuntimeConfigPlugin',
);

describe('#8389: an OS_CLOUD_URL=off boot serves a truthful /api/v1/runtime/config', () => {
  it('THE ACCEPTANCE — the served payload reports installLocal: true AND marketplace: false', async () => {
    const dir = tempStorageDir();
    try {
      const { app } = await bootOfflineArm({ storageDir: dir });

      // Throws if nothing served it — see readConfig. Before this fix that is
      // exactly where this test stopped.
      const body = await readConfig(app);

      expect(
        body.features.installLocal,
        'the Console must learn the install route this runtime really serves',
      ).toBe(true);
      expect(
        body.features.marketplace,
        'no proxy is mounted here, so browse must NOT be claimed (#8356 derivation)',
      ).toBe(false);

      // The fixture is only meaningful if install-local really did mount —
      // otherwise `installLocal: true` would be a claim about nothing, the
      // very shape #8343 reported on the EE image.
      expect(app.routes.some((r) => r.path.startsWith('/api/v1/marketplace/install-local'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('and reports THIS origin as the control plane — an air-gapped box dials nobody', async () => {
    // `RuntimeConfigPlugin` special-cases the empty controlPlaneUrl as "stay
    // on this origin" and bypasses `resolveCloudUrl()`, unlike its neighbour
    // in this arm, which would substitute the PUBLIC default cloud. Pinned
    // because the two mounts sit two lines apart with different spellings of
    // "no cloud", and harmonising them is the tempting cleanup.
    const dir = tempStorageDir();
    try {
      const { app } = await bootOfflineArm({ storageDir: dir });
      const body = await readConfig(app);

      expect(body.cloudUrl).toBe('');
      expect(body.singleEnvironment).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POSITIVE CONTROL — the same harness reports marketplace: true when a browse surface IS mounted', async () => {
    // Without this, `marketplace: false` above could be an artifact of the
    // fixture rather than an observation, and the pin would stay green on a
    // runtime that reported false for everything. The REAL proxy is mounted
    // on the same app rather than its route string hand-spelled, so a change
    // to its prefix fails here instead of silently flipping the flag.
    const { MarketplaceProxyPlugin } = await import('@objectstack/cloud-connection');
    const dir = tempStorageDir();
    try {
      const { app } = await bootOfflineArm({
        storageDir: dir,
        preMounted: [new MarketplaceProxyPlugin({ controlPlaneUrl: 'http://cloud.test', cacheDisabled: true })],
      });
      const body = await readConfig(app);

      expect(body.features.marketplace).toBe(true);
      expect(body.features.installLocal).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('#8389: the wiring plan mounts runtime-config on the offline arm', () => {
  it('an unconfigured OS_CLOUD_URL=off boot plans BOTH offline surfaces', () => {
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: '',
      plugins: [],
    });

    expect(wiring.offlineInstallLocal).toBe(true);
    expect(
      wiring.offlineRuntimeConfig,
      'the install route without its discovery surface is #8389',
    ).toBe(true);
    // `off` still means off: nothing that dials a control plane.
    expect(wiring.cloudSurfaces).toBe(false);
  });

  it('a host that wires its OWN runtime-config keeps it', async () => {
    // `kernel.use` keys by name (`Kernel.use` -> `plugins.set(name, meta)`),
    // so an unguarded mount REPLACES rather than double-mounts. The loss is
    // not cosmetic: `RuntimeConfigPlugin` carries the host's branding and the
    // open-core `resolveFeatures` seam, so the replacement would answer with
    // framework defaults and no distribution policy at all.
    const dir = tempStorageDir();
    try {
      const { wiring, app } = await bootOfflineArm({ plugins: [RUNTIME_CONFIG], storageDir: dir });

      expect(wiring.offlineRuntimeConfig).toBe(false);
      // Nothing of ours mounted over it — the host's instance is still the
      // only one, so this app has no runtime/config from THIS wiring.
      expect(app.handlers.has('GET /api/v1/runtime/config')).toBe(false);
      // ...and the other surface is unaffected by that guard.
      expect(wiring.offlineInstallLocal).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the two offline guards are INDEPENDENT — a host wiring only install-local still gets discovery', async () => {
    // One shared gate would have been the smaller change and would have
    // excluded exactly this box: it serves install-local (its own), serves no
    // runtime-config, and therefore has the #8389 defect in full.
    const dir = tempStorageDir();
    try {
      const { wiring, app } = await bootOfflineArm({ plugins: [INSTALL_LOCAL], storageDir: dir });

      expect(wiring.offlineInstallLocal, "the host's own install-local is left alone").toBe(false);
      expect(wiring.offlineRuntimeConfig).toBe(true);

      const body = await readConfig(app);
      expect(body.features.installLocal).toBe(true);
      expect(body.features.marketplace).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a host that wires BOTH gets neither mount', async () => {
    const dir = tempStorageDir();
    try {
      const { wiring, app } = await bootOfflineArm({
        plugins: [INSTALL_LOCAL, RUNTIME_CONFIG],
        storageDir: dir,
      });

      expect(wiring.offlineInstallLocal).toBe(false);
      expect(wiring.offlineRuntimeConfig).toBe(false);
      expect(app.routes).toHaveLength(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a runtime host kernel mounts NO arm — the cloud distribution wires its own', () => {
    // The guard checked FIRST and the easy casualty of editing this block.
    // Pinned for both URL states because the new flag is a new path through it.
    for (const marketplaceUrl of ['', 'https://cloud.objectos.ai']) {
      const wiring = Serve.planMarketplaceWiring({
        isRuntimeHostKernel: true,
        marketplaceUrl,
        plugins: [],
      });

      expect(wiring.cloudSurfaces, `cloudSurfaces for url='${marketplaceUrl}'`).toBe(false);
      expect(wiring.offlineInstallLocal, `offlineInstallLocal for url='${marketplaceUrl}'`).toBe(false);
      expect(wiring.offlineRuntimeConfig, `offlineRuntimeConfig for url='${marketplaceUrl}'`).toBe(false);
    }
  });

  it('a resolved cloud URL takes the CLOUD arm — the offline flags stay off', () => {
    // The cloud arm mounts its own RuntimeConfigPlugin, so a truthy offline
    // flag here would double-mount and, worse, replace the cloud arm's
    // instance with one that never saw the resolved URL.
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: 'https://cloud.objectos.ai',
      plugins: [],
    });

    expect(wiring.cloudSurfaces).toBe(true);
    expect(wiring.offlineInstallLocal).toBe(false);
    expect(wiring.offlineRuntimeConfig).toBe(false);
  });
});

describe('#8389: the identities and options the arm mounts with are the real ones', () => {
  it('drift check — RUNTIME_CONFIG_IDENTITIES still match the plugin the CLI mounts', async () => {
    // A registry of identities that has drifted from the class it names fails
    // OPEN: nothing matches, the guard never fires, and the host's instance is
    // replaced — with nothing else in the suite noticing.
    const { RuntimeConfigPlugin } = await import('@objectstack/cloud-connection');
    const real = new RuntimeConfigPlugin({ ...Serve.RUNTIME_CONFIG_OPTIONS });

    expect(Serve.RUNTIME_CONFIG_IDENTITIES).toContain(real.name);
    expect(Serve.RUNTIME_CONFIG_IDENTITIES).toContain(RuntimeConfigPlugin.name);
    expect(Serve.providesCapability([real], Serve.RUNTIME_CONFIG_IDENTITIES)).toBe(true);
  });

  it('the options are shared by both arms, so the offline payload cannot drift from the cloud one', () => {
    // The difference between the arms must come from what is MOUNTED — since
    // #8356 `features.marketplace` is derived from the route table — and never
    // from a second copy of these options. Frozen so a call site cannot mutate
    // the shared object out from under the other arm.
    expect(Serve.RUNTIME_CONFIG_OPTIONS).toEqual({
      controlPlaneUrl: '',
      singleEnvironment: true,
      installLocal: true,
    });
    expect(Object.isFrozen(Serve.RUNTIME_CONFIG_OPTIONS)).toBe(true);
  });
});
