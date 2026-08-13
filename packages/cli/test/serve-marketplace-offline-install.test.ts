// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #8343 — the air-gapped install surface must not be gated on the control
 * plane it is designed not to need.
 *
 * The defect, measured on a customer's self-hosted objectos-ee 4.0.5-rc.1 with
 * `OS_CLOUD_URL=off` (the value that image's own compose file documents for a
 * fully self-hosted box): `GET` and `POST /api/v1/marketplace/install-local`
 * both 404, with no other package-install surface in the served OpenAPI. The
 * deployment could not install a package by any route — while its
 * `/api/v1/runtime/config` advertised `features.installLocal: true`.
 *
 * Why the whole wiring block sat behind ONE flag: it mounts a control-plane
 * client (browse proxy, cloud-connection, runtime-config) AND the local
 * install surface, and only the former needs a URL. `handleInstall`'s
 * inline-manifest branch reads no URL at all, which is exactly what makes
 * `os package install ./dist/objectstack.json` the documented offline path.
 *
 * These tests pin the SPLIT, in both directions — a fix that merely mounts
 * more would be indistinguishable here from one that stopped honouring `off`:
 *
 *   - explicitly-disabled cloud mounts the offline surface and NOTHING that
 *     dials out,
 *   - a resolved cloud URL still mounts the full set (no capability lost),
 *   - a runtime host kernel still mounts NEITHER (the cloud distribution wires
 *     its own — the guard that was checked first and is easy to disturb),
 *   - a host config that wires its own install-local is left alone.
 */

import { describe, expect, it } from 'vitest';
import Serve from '../src/commands/serve.js';

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

const INSTALL_LOCAL = plugin(
  'com.objectstack.runtime.marketplace-install-local',
  'MarketplaceInstallLocalPlugin',
);

describe('#8343: install-local mounts on a runtime with the cloud switched off', () => {
  it('THE REGRESSION — `OS_CLOUD_URL=off` still mounts the offline install surface', () => {
    // resolveCloudUrl() maps every disable sentinel to '' — that empty string
    // is what reaches this decision, and it used to mean "mount nothing".
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: '',
      plugins: [],
    });

    expect(
      wiring.offlineInstallLocal,
      'a self-hosted box with no control plane is the deployment that most needs the offline install path',
    ).toBe(true);
  });

  it('and mounts NOTHING that talks to a control plane', () => {
    // The other half of the fix. `off` still has to mean off: the browse
    // proxy, the cloud-connection surface and the pushed runtime-config are
    // all control-plane clients and must stay unmounted.
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: '',
      plugins: [],
    });

    expect(wiring.cloudSurfaces).toBe(false);
  });

  it('a resolved cloud URL still mounts the full set — nothing was traded away', () => {
    // The regression a narrowed rule invites: mounting only the offline half
    // everywhere would pass the two tests above while silently deleting
    // marketplace browse from every connected runtime.
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: 'https://cloud.objectos.ai',
      plugins: [],
    });

    expect(wiring.cloudSurfaces).toBe(true);
    // The cloud arm already carries its own install-local, so the offline arm
    // must not fire on top of it.
    expect(wiring.offlineInstallLocal).toBe(false);
  });

  it('vanilla `objectstack dev` is UNCHANGED — it never reached the offline arm', () => {
    // Worth pinning because the reading that makes this change look expensive
    // is "unconditional mounting adds a Setup nav entry to every plain dev
    // app". It does not: with OS_CLOUD_URL unset, resolveCloudUrl() returns
    // the public DEFAULT_CLOUD_URL, so a plain dev app takes the CLOUD arm —
    // and has mounted install-local (and its "Installed Apps" nav) all along.
    // Only runs that explicitly opted out see any difference at all.
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: 'https://cloud.objectos.ai', // what an unset env resolves to
      plugins: [],
    });

    expect(wiring.cloudSurfaces).toBe(true);
    expect(wiring.offlineInstallLocal).toBe(false);
  });

  it('a runtime host kernel mounts NEITHER arm, cloud off or on', () => {
    // The guard that is checked FIRST and is the easy casualty of editing this
    // block: the cloud distribution (objectos-stack) wires its own marketplace
    // on the host kernel, so auto-wiring here double-mounts. Pinned for both
    // URL states, because the offline arm is a new path through this branch.
    for (const marketplaceUrl of ['', 'https://cloud.objectos.ai']) {
      const wiring = Serve.planMarketplaceWiring({
        isRuntimeHostKernel: true,
        marketplaceUrl,
        plugins: [OBJECTOS_ENVIRONMENT],
      });

      expect(wiring.cloudSurfaces, `cloudSurfaces for url='${marketplaceUrl}'`).toBe(false);
      expect(wiring.offlineInstallLocal, `offlineInstallLocal for url='${marketplaceUrl}'`).toBe(false);
    }
  });

  it('a host that wires its OWN install-local keeps it', () => {
    // `kernel.use` keys plugins by name, so an unguarded mount would REPLACE a
    // host's own instance. That is not a redundant-mount tidy-up: a host may
    // have constructed one with an explicit control-plane URL while
    // OS_CLOUD_URL says `off`, and the replacement — pinned to `off` — would
    // silently drop that host's catalog capability.
    const wiring = Serve.planMarketplaceWiring({
      isRuntimeHostKernel: false,
      marketplaceUrl: '',
      plugins: [INSTALL_LOCAL],
    });

    expect(wiring.offlineInstallLocal).toBe(false);
  });
});

describe('#8343: the identities the offline arm matches on are the real ones', () => {
  it('matches the plugin by registered name AND by class name', () => {
    expect(Serve.providesCapability([INSTALL_LOCAL], Serve.INSTALL_LOCAL_IDENTITIES)).toBe(true);
    expect(
      Serve.providesCapability(
        [plugin('some.other.plugin', 'MarketplaceInstallLocalPlugin')],
        Serve.INSTALL_LOCAL_IDENTITIES,
      ),
    ).toBe(true);
  });

  it('drift check — the identities still match the plugin the CLI actually mounts', async () => {
    // Same discipline as serve-capability-identity.test.ts: a registry of
    // identities that has drifted from the class it names fails OPEN (nothing
    // matches -> the guard never fires -> the host's instance gets replaced),
    // and nothing else in the suite would notice.
    const { MarketplaceInstallLocalPlugin } = await import('@objectstack/cloud-connection');
    const real = new MarketplaceInstallLocalPlugin({ controlPlaneUrl: 'off' });

    expect(Serve.INSTALL_LOCAL_IDENTITIES).toContain(real.name);
    expect(Serve.INSTALL_LOCAL_IDENTITIES).toContain(MarketplaceInstallLocalPlugin.name);
    expect(Serve.providesCapability([real], Serve.INSTALL_LOCAL_IDENTITIES)).toBe(true);
  });
});

describe('#8343: why the offline mount passes `off` and never an empty string', () => {
  it('an empty controlPlaneUrl resolves to the PUBLIC cloud, `off` resolves to none', async () => {
    // The trap behind the call site's literal. The plugin re-resolves whatever
    // it is constructed with through resolveCloudUrl(), which treats '' as
    // "unset" and substitutes DEFAULT_CLOUD_URL. Handing it the '' that the
    // wiring block already has in `marketplaceUrl` would therefore point an
    // air-gapped runtime's catalog branch at cloud.objectos.ai — the exact
    // opposite of what `off` requested, and invisible until a box with no
    // egress hangs on an install.
    const { resolveCloudUrl, DEFAULT_CLOUD_URL } = await import('@objectstack/cloud-connection');

    expect(resolveCloudUrl(''), "'' means 'unset', NOT 'disabled'").toBe(DEFAULT_CLOUD_URL);

    // The call site's actual value, not a restatement of it — this goes red if
    // anyone "simplifies" the constant to the empty marketplaceUrl in scope.
    expect(
      resolveCloudUrl(Serve.OFFLINE_CONTROL_PLANE),
      'the value the offline mount is constructed with must resolve to NO cloud',
    ).toBe('');
  });
});
