// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8357 — the CLOUD-CONNECTED marketplace arm must leave a host config's own
 * marketplace / cloud plugins alone, the same way #8343 taught the offline arm
 * to.
 *
 * ## What was measured before writing these tests
 *
 * The card describes the CLI's instance REPLACING the host's. On this tree it
 * is the other way round, and saying so is the point of these tests rather
 * than an aside:
 *
 *   - `ObjectKernel.use()` is `this.plugins.set(pluginMeta.name, meta)` — a
 *     Map keyed by `plugin.name`. No error, no dedupe, last write wins.
 *   - The CLI's marketplace block runs several hundred lines BEFORE the loop
 *     that registers `config.plugins`. So today the HOST's instance is the
 *     last write and the host wins; the CLI's four instances are constructed,
 *     registered, and then dropped.
 *
 * That makes this a PRECEDENCE fix, not a live-bug fix — there is no measured
 * user impact today, and both sides currently construct their instances from
 * the same `resolveCloudUrl()` value anyway. What the guard buys is that the
 * host winning stops being an accident of where two blocks sit relative to
 * each other, in a file where neither block mentions the other. The last
 * `describe` pins exactly that, and is the only assertion here that would
 * behave differently under the two orders.
 *
 * ## Why the fixtures are built to be DISTINGUISHABLE
 *
 * A test that asks "does the app still work?" passes before and after the fix
 * and proves nothing, because two identically-constructed instances are
 * interchangeable. Every host fixture below is therefore constructed with
 * something the CLI's auto-wiring cannot pass — a private control plane, a
 * custom install `storageDir`, a credential path, white-label branding — and
 * each case asserts the SURVIVOR carries the host's value.
 */

import { describe, expect, it } from 'vitest';
import { ObjectKernel } from '@objectstack/core';
import {
  MarketplaceProxyPlugin,
  MarketplaceInstallLocalPlugin,
  RuntimeConfigPlugin,
  createCloudConnectionPlugin,
} from '@objectstack/cloud-connection';
import Serve from '../src/commands/serve.js';

/** A resolved cloud URL — the state that selects the cloud-connected arm. */
const CLOUD_URL = 'https://cloud.objectos.ai';

/**
 * The control plane a HOST would point at and the CLI never could: the CLI
 * constructs from `resolveCloudUrl()` alone, so any value that is not the
 * resolved `OS_CLOUD_URL` can only have come from the host config.
 */
const HOST_CONTROL_PLANE = 'https://control-plane.internal.example';

/** Minimal stand-in for a loaded plugin: what the resolver actually reads. */
function plugin(name: string, ctorName: string): { name: string } {
  const Ctor = { [ctorName]: class { name: string; constructor(n: string) { this.name = n; } } }[ctorName]!;
  return new Ctor(name) as { name: string };
}

/** The host-kernel signal the cloud distribution is detected by. */
const OBJECTOS_ENVIRONMENT = plugin(
  'com.objectstack.runtime.objectos-environment',
  'ObjectOSEnvironmentPlugin',
);

/**
 * Read a value a plugin was CONSTRUCTED with, past TypeScript's `private`.
 *
 * Deliberate, and load-bearing: `private` is erased at runtime, and these
 * constructor arguments are the only thing that distinguishes the host's
 * instance from the CLI's. Nothing on the public surface exposes them without
 * booting a kernel and issuing HTTP requests. Every use is paired with the
 * `not.toBe` precondition below, so if a field is ever renamed both readings
 * collapse to `undefined` and the precondition fails loudly — "this test no
 * longer measures anything" rather than a silent pass.
 */
function constructedWith<T>(plugin: unknown, field: string): T | undefined {
  return (plugin as Record<string, T> | null | undefined)?.[field];
}

/**
 * The plugin instances an `ObjectKernel` has registered, keyed by name.
 *
 * `ObjectKernel` publishes `hasPlugin(name)` but nothing that hands back the
 * registered INSTANCE — and which instance survived is the entire question
 * here. Same justification as {@link constructedWith}, and every read below is
 * paired with the public `hasPlugin`, so if this field is ever renamed the
 * pairing fails loudly instead of quietly reporting "not registered".
 */
function registeredPlugins(kernel: ObjectKernel): Map<string, unknown> {
  return (kernel as unknown as { plugins: Map<string, unknown> }).plugins;
}

/**
 * The four surfaces the cloud-connected arm mounts, each with:
 *  - the host's instance, built with an argument the CLI cannot produce,
 *  - the CLI's instance, built EXACTLY as `serve.ts` builds it,
 *  - the constructor-derived field that tells the two apart.
 *
 * Keep the `cli` factories in step with the mounts in `serve.ts`; they are the
 * same expressions on purpose.
 */
const SURFACES = [
  {
    label: 'marketplace browse proxy',
    flag: 'cloudProxy',
    pluginName: 'com.objectstack.runtime.marketplace-proxy',
    identities: () => Serve.MARKETPLACE_PROXY_IDENTITIES,
    field: 'cloudUrl',
    host: () => new MarketplaceProxyPlugin({
      controlPlaneUrl: HOST_CONTROL_PLANE,
      cacheMaxEntries: 4096,
    }),
    cli: () => new MarketplaceProxyPlugin({ controlPlaneUrl: CLOUD_URL }),
  },
  {
    label: 'install-local',
    flag: 'cloudInstallLocal',
    pluginName: 'com.objectstack.runtime.marketplace-install-local',
    identities: () => Serve.INSTALL_LOCAL_IDENTITIES,
    field: 'cloudUrl',
    host: () => new MarketplaceInstallLocalPlugin({
      controlPlaneUrl: HOST_CONTROL_PLANE,
      storageDir: '/srv/objectos/installed-packages',
    }),
    cli: () => new MarketplaceInstallLocalPlugin({ controlPlaneUrl: CLOUD_URL }),
  },
  {
    label: 'cloud-connection',
    flag: 'cloudConnection',
    pluginName: 'com.objectstack.cloud.connection',
    identities: () => Serve.CLOUD_CONNECTION_IDENTITIES,
    field: 'cfg',
    host: () => createCloudConnectionPlugin({
      singleEnvironment: true,
      controlPlaneUrl: HOST_CONTROL_PLANE,
      credentialPath: '/srv/objectos/cloud-connection.json',
    }),
    cli: () => createCloudConnectionPlugin({ singleEnvironment: true, controlPlaneUrl: CLOUD_URL }),
  },
  {
    label: 'runtime-config',
    flag: 'cloudRuntimeConfig',
    pluginName: 'com.objectstack.runtime.runtime-config',
    identities: () => Serve.RUNTIME_CONFIG_IDENTITIES,
    field: 'productName',
    host: () => new RuntimeConfigPlugin({
      ...Serve.RUNTIME_CONFIG_OPTIONS,
      productName: 'Contoso Operations',
    }),
    cli: () => new RuntimeConfigPlugin({ ...Serve.RUNTIME_CONFIG_OPTIONS }),
  },
] as const;

type CloudFlag = (typeof SURFACES)[number]['flag'];

const ALL_CLOUD_FLAGS: readonly CloudFlag[] = SURFACES.map((s) => s.flag);

/**
 * The whole set the objectos-ee single-environment config wires itself — the
 * host shape this card is about. Note what is NOT here: an
 * `ObjectOSEnvironmentPlugin`. Only the `OS_MULTI_TENANT` branch constructs
 * one (via `createObjectOSStack`), so the `isRuntimeHostKernel` guard never
 * fires for the shipped single-environment shape, and a rule hung off that
 * sentinel would not fire for the exact host it was written for.
 */
function eeSingleEnvironmentHostPlugins(): unknown[] {
  return SURFACES.map((s) => s.host());
}

describe('#8357: the cloud-connected arm mounts only what the host did NOT wire', () => {
  it('a host that wires nothing still gets the full set — no capability traded away', () => {
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: CLOUD_URL,
      plugins: [],
    });

    expect(wiring.cloudSurfaces, 'a resolved cloud URL still selects the cloud arm').toBe(true);
    for (const flag of ALL_CLOUD_FLAGS) {
      expect(wiring[flag], `${flag} for a host that wires nothing`).toBe(true);
    }
  });

  for (const surface of SURFACES) {
    it(`a host that wires its own ${surface.label} keeps it — and only it is skipped`, () => {
      const wiring = Serve.planMarketplaceWiring({
        isRuntimeHostKernel: false,
        marketplaceUrl: CLOUD_URL,
        plugins: [surface.host()],
      });

      expect(wiring.cloudSurfaces).toBe(true);
      expect(wiring[surface.flag], `${surface.flag} must NOT be mounted by the CLI`).toBe(false);

      // The other three are untouched. One shared gate would either overwrite
      // what the host wired or withhold what it did not — objectos-ee wires
      // runtime-config unconditionally and the other three only behind its own
      // URL check, so partial host composition is the SHIPPED shape, not a
      // hypothetical.
      for (const other of ALL_CLOUD_FLAGS) {
        if (other === surface.flag) continue;
        expect(wiring[other], `${other} must still be auto-wired`).toBe(true);
      }
    });
  }

  it('the EE single-environment host shape keeps ALL FOUR of its own plugins', () => {
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: CLOUD_URL,
      plugins: eeSingleEnvironmentHostPlugins(),
    });

    expect(wiring.cloudSurfaces, 'the arm is still selected — the URL resolved').toBe(true);
    for (const flag of ALL_CLOUD_FLAGS) {
      expect(wiring[flag], `${flag} for the EE single-environment host`).toBe(false);
    }
  });

  it('a runtime host kernel still mounts NOTHING, cloud on or off', () => {
    // The guard checked FIRST and the easy casualty of editing this block.
    for (const marketplaceUrl of ['', CLOUD_URL]) {
      const wiring = Serve.planMarketplaceWiring({
        isRuntimeHostKernel: true,
        marketplaceUrl,
        plugins: [OBJECTOS_ENVIRONMENT],
      });

      expect(wiring.cloudSurfaces, `cloudSurfaces for url='${marketplaceUrl}'`).toBe(false);
      for (const flag of ALL_CLOUD_FLAGS) {
        expect(wiring[flag], `${flag} for url='${marketplaceUrl}'`).toBe(false);
      }
      expect(wiring.offlineInstallLocal).toBe(false);
      expect(wiring.offlineRuntimeConfig).toBe(false);
    }
  });

  it('the OFFLINE arm is unchanged — no cloud surface leaks into a cloud-less boot', () => {
    // #8343 / #8389 regression guard: adding per-surface cloud flags must not
    // make any of them true on the arm that exists precisely because there is
    // no control plane to talk to.
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: '',
      plugins: [],
    });

    expect(wiring.cloudSurfaces).toBe(false);
    for (const flag of ALL_CLOUD_FLAGS) {
      expect(wiring[flag], `${flag} on the offline arm`).toBe(false);
    }
    expect(wiring.offlineInstallLocal).toBe(true);
    expect(wiring.offlineRuntimeConfig).toBe(true);
  });
});

describe('#8357: the identities the cloud arm matches on are the real ones', () => {
  // Same discipline as the #8343 drift test: a registry of identities that has
  // drifted from the class it names fails OPEN — nothing matches, the guard
  // never fires, the host's instance is silently overwritten again — and
  // nothing else in the suite would notice.
  for (const surface of SURFACES) {
    it(`${surface.label}: registered name AND class name both match the real plugin`, () => {
      const real = surface.host() as { name: string; constructor: { name: string } };

      expect(surface.identities()).toContain(real.name);
      expect(Serve.providesCapability([real], surface.identities())).toBe(true);

      // The class-name limb, compared to the BUILT class name exactly (#8645).
      // This used to strip one leading underscore, because
      // `MarketplaceProxyPlugin` referenced itself by name inside its own body
      // and esbuild emitted `var X = class _X { … }` — so the shipped class was
      // called `_MarketplaceProxyPlugin` and this limb matched nothing. The
      // source idiom is fixed and the equality is now enforced for every
      // registry in `serve.ts` by `serve-capability-identity.test.ts`; the
      // accommodation is retired rather than left as a third spelling of one
      // rule. If this line ever fails with a `_`-prefixed name, fix the source
      // idiom (`this.x` / a module-scope constant) — do not strip it here.
      expect(surface.identities()).toContain(real.constructor.name);
    });
  }

  it('the registered NAME alone satisfies every guard — the limb no bundler can touch', () => {
    // Still asserted with the class-name limb repaired (#8645), because the two
    // limbs are independent claims: `plugin.name` is a plain string field that
    // no bundler rewrites, so it is what recognises a host instance reached
    // through a factory, a subclass, or a re-export. The class-name limb is the
    // redundancy on top — enforced now, not assumed.
    for (const surface of SURFACES) {
      expect(
        Serve.providesCapability([{ name: surface.pluginName }], surface.identities()),
        `${surface.label} must be recognised by its registered name alone`,
      ).toBe(true);
    }
  });

  it('the cloud-connection identity names the CLASS the factory returns, not the factory', () => {
    // The one surface reached through a factory. `createCloudConnectionPlugin`
    // is not an identity — a function is not what lands in the kernel — so the
    // entry has to name `CloudConnectionPlugin`, which no call site spells out.
    expect(Serve.CLOUD_CONNECTION_IDENTITIES).not.toContain('createCloudConnectionPlugin');
    expect(createCloudConnectionPlugin({}).constructor.name).toBe('CloudConnectionPlugin');
  });

  it('an unrelated plugin does not satisfy any of the four', () => {
    const bystander = plugin('com.objectstack.connector.marketplace-mirror', 'MarketplaceMirrorConnector');
    for (const surface of SURFACES) {
      expect(
        Serve.providesCapability([bystander], surface.identities()),
        `${surface.label} must not be satisfied by a consumer named after it`,
      ).toBe(false);
    }
  });
});

describe('#8357: the host instance survives REGARDLESS of registration order', () => {
  /**
   * Mount the cloud arm the way `serve.ts` does — one guarded `kernel.use`
   * per surface, in the same order, with the same constructor arguments.
   */
  async function mountCliCloudArm(
    kernel: ObjectKernel,
    wiring: ReturnType<typeof Serve.planMarketplaceWiring>,
  ): Promise<void> {
    for (const surface of SURFACES) {
      if (wiring[surface.flag]) await kernel.use(surface.cli() as never);
    }
  }

  /**
   * Both orders are tested because only one of them is reachable today, and
   * that is the whole point: `cli-then-host` is the order `serve.ts` really
   * runs in, and under it the host already wins WITHOUT any guard — so it
   * cannot tell a fixed build from a broken one. `host-then-cli` is the order
   * in which the missing check bites, and the one that goes red when the guard
   * is removed. Passing BOTH is the property being claimed: the host's
   * composition wins because it is a rule, not because of where two blocks
   * happen to sit in one 4000-line file.
   */
  for (const order of ['cli-then-host', 'host-then-cli'] as const) {
    it(`EE single-environment host keeps its own four instances (${order})`, async () => {
      const kernel = new ObjectKernel({ gracefulShutdown: false, logger: { level: 'error' } });
      const hostPlugins = eeSingleEnvironmentHostPlugins();

      const wiring = Serve.planMarketplaceWiring({
        isRuntimeHostKernel: false,
        marketplaceUrl: CLOUD_URL,
        plugins: hostPlugins,
      });

      const registerHost = async () => {
        for (const p of hostPlugins) await kernel.use(p as never);
      };

      if (order === 'cli-then-host') {
        await mountCliCloudArm(kernel, wiring);
        await registerHost();
      } else {
        await registerHost();
        await mountCliCloudArm(kernel, wiring);
      }

      const registered = registeredPlugins(kernel);

      for (const [index, surface] of SURFACES.entries()) {
        const hostInstance = hostPlugins[index]!;
        expect(kernel.hasPlugin(surface.pluginName), `${surface.label} must be registered`).toBe(true);
        const survivor = registered.get(surface.pluginName);

        // Precondition: the two instances really ARE distinguishable. Without
        // this the identity assertion below could pass for the wrong reason,
        // and a renamed private field would make it vacuous rather than red.
        expect(
          constructedWith(hostInstance, surface.field),
          `${surface.label}: host fixture must differ from the CLI's instance`,
        ).not.toEqual(constructedWith(surface.cli(), surface.field));

        expect(survivor, `${surface.label}: the surviving instance must be the HOST's`).toBe(hostInstance);
        expect(
          constructedWith(survivor, surface.field),
          `${surface.label}: the survivor must carry the host's construction argument`,
        ).toEqual(constructedWith(hostInstance, surface.field));
      }
    });
  }

  it('with no host wiring, the CLI still supplies all four instances', async () => {
    // The other direction: the guard must not turn into "never auto-wire".
    const kernel = new ObjectKernel({ gracefulShutdown: false, logger: { level: 'error' } });
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: CLOUD_URL,
      plugins: [],
    });

    await mountCliCloudArm(kernel, wiring);

    for (const surface of SURFACES) {
      expect(kernel.hasPlugin(surface.pluginName), `${surface.label} must be auto-wired`).toBe(true);
    }
  });

  it('THE MECHANISM — an unguarded second mount really does overwrite by name', async () => {
    // The premise the whole card rests on, measured rather than quoted, and
    // the reason the guard is the fix rather than "kernel.use should refuse"
    // (that alternative was explicitly rejected at grading: engine-core blast
    // radius, its own card). `Kernel.use` is a Map keyed by `plugin.name`:
    // no error, no dedupe, last write wins — so an unguarded mount is never a
    // harmless duplicate, it is a silent choice of winner made by ordering.
    const kernel = new ObjectKernel({ gracefulShutdown: false, logger: { level: 'error' } });
    const host = SURFACES[0].host();
    const cli = SURFACES[0].cli();

    await kernel.use(host as never);
    await kernel.use(cli as never);

    const registered = registeredPlugins(kernel);
    expect(registered.size, 'two plugins, one name, one entry').toBe(1);
    expect(registered.get(SURFACES[0].pluginName)).toBe(cli);
    expect(constructedWith(registered.get(SURFACES[0].pluginName), 'cloudUrl')).toBe(CLOUD_URL);
  });
});
