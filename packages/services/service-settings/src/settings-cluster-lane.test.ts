// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#31597] The settings lane: a settings write on one replica reaches every
 * replica's `settings:changed` subscribers.
 *
 * `settings:changed` is an in-process subscriber set. Its subscribers rebuild
 * the auth posture (plugin-auth binds `settings.subscribe('auth', …)` and
 * re-reads the namespace), password / session / MFA policy, organization
 * access policy, mail, SMS, storage and the AI provider. Measured on a
 * round-robin deployment before this lane: replica 1 set
 * `require_email_verification` and refused sign-in, replica 2 still answered
 * 200 after 95 s.
 *
 * Topology here: two `LiteKernel` boots ("replicas"), each with its OWN
 * `SettingsService` over its OWN real `ObjectQL` engine, both engines over ONE
 * shared Map driver (the shared database), joined by ONE bus that delivers
 * every publish to every subscriber, publisher included (what a real remote
 * driver does, and what the `originNode` loopback guard exists for). The
 * cluster service names the `redis` driver, and the real
 * `MetadataClusterBridgePlugin` attaches the lane at `kernel:ready`.
 *
 * The auth-posture subscriber below has plugin-auth's binding shape:
 * subscribe to the `auth` namespace, and on every change re-read
 * `require_email_verification` from the settings service.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { LiteKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQL } from '@objectstack/objectql';
import { SysPlatformSetting, SysSecret, SysSetting } from '@objectstack/platform-objects/system';
import type { IClusterService, IPubSub } from '@objectstack/spec/contracts';
import type { SettingsChangeEvent } from '@objectstack/spec/system';
import {
  ClusterDriverLiveness,
  MemoryPubSub,
  MetadataClusterBridgePlugin,
  offerClusterDriverLiveness,
} from '@objectstack/service-cluster';
import { SettingsService } from './settings-service.js';
import { wrapEngineAsSettingsEngine } from './settings-service-plugin.js';
import { authSettingsManifest } from './manifests/auth.manifest.js';
import { SETTINGS_CHANGE_CLUSTER_CHANNEL, type ClusterSettingsChangePayload } from './settings-cluster-channel.js';
import { makeMemoryDriver } from './__tests__/settings-door.testkit.js';
import { LEAN_ORGANIZATION_SOURCE, withEngineRegistry } from './__tests__/settings-organization.testkit.js';

const OWNER_PACKAGE = 'com.objectstack.test.settings-cluster-lane';
const ADMIN = { enforced: true, permissions: ['manage_platform_settings'], userId: 'usr_admin' } as const;

/** A probe namespace whose value is a string we can look for on the wire. */
const PROBE_MANIFEST = {
  namespace: 'lane_probe',
  label: 'Lane probe',
  specifiers: [{ type: 'text', key: 'endpoint', label: 'Endpoint', scope: 'global', default: '' }],
} as any;

/**
 * The shared bus, with every publish on the settings channel recorded and an
 * optional "outage" during which publishes are lost (the at-most-once bus).
 */
function makeSharedBus() {
  const inner = new MemoryPubSub({ onError: () => {} });
  const published: ClusterSettingsChangePayload[] = [];
  let down = false;
  const bus: IPubSub = {
    async publish(channel, payload, opts) {
      if (channel === SETTINGS_CHANGE_CLUSTER_CHANNEL) published.push(payload as ClusterSettingsChangePayload);
      if (down) return;
      await inner.publish(channel, payload, opts);
    },
    subscribe: (channel, handler, opts) => inner.subscribe(channel, handler, opts),
    close: () => inner.close(),
  };
  return {
    bus,
    published,
    setDown(value: boolean) {
      down = value;
    },
  };
}

/** Registers a prebuilt service under `name` (the slot a real plugin fills). */
function servicePlugin(name: string, service: unknown): Plugin {
  return {
    name: `test.${name}`,
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(name, service);
    },
  } as Plugin;
}

async function bootReplica(nodeId: string, shared: { driver: unknown; bus: IPubSub }, driverName = 'redis') {
  const engine = new ObjectQL();
  engine.registerDriver(shared.driver as any, true);
  await engine.init();
  for (const o of [SysSetting, SysPlatformSetting, SysSecret]) {
    engine.registry.registerObject(o as any, OWNER_PACKAGE);
  }
  const settings = new SettingsService({ env: {} });
  settings.bindEngine(withEngineRegistry(wrapEngineAsSettingsEngine(engine as any), engine), undefined, {
    organization: LEAN_ORGANIZATION_SOURCE,
  });
  settings.registerManifest(authSettingsManifest);
  settings.registerManifest(PROBE_MANIFEST);

  const cluster = {
    nodeId,
    driver: driverName,
    pubsub: shared.bus,
    lock: {},
    kv: {},
    counter: {},
    close: async () => {},
  } as unknown as IClusterService;
  const liveness = new ClusterDriverLiveness({ driver: driverName, nodeId, logger: { warn: () => {}, info: () => {} } });
  offerClusterDriverLiveness(cluster, liveness);

  const kernel = new LiteKernel({ logger: { level: 'error' } as never });
  kernel.use(servicePlugin('cluster', cluster));
  kernel.use(servicePlugin('settings', settings));
  kernel.use(new MetadataClusterBridgePlugin());
  await kernel.bootstrap();

  // plugin-auth's binding shape: re-read the namespace on every change.
  const posture = { requireEmailVerification: false, rebuilds: 0 };
  const events: SettingsChangeEvent[] = [];
  settings.subscribe(undefined, (e) => events.push(e));
  settings.subscribe('auth', () => {
    void settings.get('auth', 'require_email_verification').then((r) => {
      posture.requireEmailVerification = r.value === true;
      posture.rebuilds += 1;
    });
  });
  /** One reconnect after an outage: the driver's local `cluster.resync`. */
  const reconnect = async () => {
    liveness.reportUp('command');
    liveness.reportDown('command', new Error('ECONNREFUSED'));
    liveness.reportUp('command');
    await new Promise((r) => setTimeout(r, 0));
  };
  return { kernel, settings, posture, events, reconnect };
}

async function bootPair(opts: { declare?: boolean; driver?: string } = {}) {
  vi.stubEnv('OS_CLUSTER_REPLICAS', opts.declare === false ? '' : '2');
  vi.stubEnv('OS_EXPECT_MULTI_NODE', '');
  const { driver } = makeMemoryDriver();
  const shared = makeSharedBus();
  const a = await bootReplica('replica-a', { driver, bus: shared.bus }, opts.driver);
  const b = await bootReplica('replica-b', { driver, bus: shared.bus }, opts.driver);
  // Settle the boot's own announcements (the engine bind's `key: '*'`).
  await new Promise((r) => setTimeout(r, 0));
  a.events.length = 0;
  b.events.length = 0;
  return { a, b, shared };
}

const kernels: LiteKernel[] = [];
afterEach(async () => {
  for (const k of kernels.splice(0)) await k.shutdown();
  vi.unstubAllEnvs();
});
const track = <T extends { a: { kernel: LiteKernel }; b: { kernel: LiteKernel } }>(pair: T): T => {
  kernels.push(pair.a.kernel, pair.b.kernel);
  return pair;
};

describe('[#31597] declared replicas over redis: a settings write reaches every replica', () => {
  it('⭐ a write on A changes B’s auth posture within one second, read from the shared store', async () => {
    const { a, b } = track(await bootPair());
    expect(b.posture.requireEmailVerification).toBe(false);

    await a.settings.set('auth', 'require_email_verification', true, ADMIN);

    await vi.waitFor(() => expect(b.posture.requireEmailVerification).toBe(true), { timeout: 1000, interval: 10 });
    expect(b.events).toEqual([
      expect.objectContaining({ namespace: 'auth', key: 'require_email_verification', scope: 'global', action: 'set' }),
    ]);

    // A reset travels the same way.
    await a.settings.set('auth', 'require_email_verification', null, ADMIN);
    await vi.waitFor(() => expect(b.posture.requireEmailVerification).toBe(false), { timeout: 1000, interval: 10 });
    expect(b.events.map((e) => e.action)).toEqual(['set', 'reset']);
  });

  it('the broadcast carries the address of the change and never its value', async () => {
    const { a, b, shared } = track(await bootPair());
    const value = 'https://lane-probe.invalid/7f3a9c';

    await a.settings.set('lane_probe', 'endpoint', value, ADMIN);
    await vi.waitFor(() => expect(b.events).toHaveLength(1), { timeout: 1000, interval: 10 });

    expect(shared.published).toHaveLength(1);
    const [payload] = shared.published;
    expect(Object.keys(payload).sort()).toEqual(['action', 'at', 'key', 'namespace', 'originNode', 'scope']);
    expect(payload).toMatchObject({ originNode: 'replica-a', namespace: 'lane_probe', key: 'endpoint', scope: 'global', action: 'set' });
    expect(JSON.stringify(payload)).not.toContain('lane-probe.invalid');
    // B's subscribers read the value from the shared store, not from the wire.
    expect((await b.settings.get('lane_probe', 'endpoint')).value).toBe(value);
  });

  it('no echo: a received change is never published again, and the writer hears its own write once', async () => {
    const { a, b, shared } = track(await bootPair());

    await a.settings.set('auth', 'require_email_verification', true, ADMIN);
    await vi.waitFor(() => expect(b.posture.requireEmailVerification).toBe(true), { timeout: 1000, interval: 10 });
    await new Promise((r) => setTimeout(r, 20));

    expect(shared.published.map((p) => p.originNode)).toEqual(['replica-a']);
    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });

  it('cluster.resync: a change lost during an outage reaches the peer on reconnect', async () => {
    const { a, b, shared } = track(await bootPair());

    shared.setDown(true);
    await a.settings.set('auth', 'require_email_verification', true, ADMIN);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.posture.requireEmailVerification).toBe(false);
    shared.setDown(false);

    await b.reconnect();
    await vi.waitFor(() => expect(b.posture.requireEmailVerification).toBe(true), { timeout: 1000, interval: 10 });
    // The resync announces every namespace locally; nothing goes on the wire.
    expect(b.events.map((e) => `${e.namespace}.${e.key}`).sort()).toEqual(['auth.*', 'lane_probe.*']);
    expect(shared.published).toHaveLength(1);
  });

  it('after kernel:shutdown the replica neither publishes nor hears', async () => {
    const { a, b, shared } = track(await bootPair());
    await b.kernel.shutdown();
    kernels.splice(kernels.indexOf(b.kernel), 1);

    await a.settings.set('auth', 'require_email_verification', true, ADMIN);
    await new Promise((r) => setTimeout(r, 20));
    expect(b.events).toEqual([]);

    await b.settings.set('lane_probe', 'endpoint', 'x', ADMIN);
    expect(shared.published.map((p) => p.originNode)).toEqual(['replica-a']);
  });
});

describe('[#31597] CONTROL: no declared multi-replica deployment over redis, single-node behaviour unchanged', () => {
  /** What a lone service with no lane emits for the same write: today's behaviour. */
  async function todaysEvents(): Promise<Array<Omit<SettingsChangeEvent, 'at'>>> {
    const { driver } = makeMemoryDriver();
    const engine = new ObjectQL();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [SysSetting, SysPlatformSetting, SysSecret]) engine.registry.registerObject(o as any, OWNER_PACKAGE);
    const lone = new SettingsService({ env: {} });
    lone.bindEngine(withEngineRegistry(wrapEngineAsSettingsEngine(engine as any), engine), undefined, {
      organization: LEAN_ORGANIZATION_SOURCE,
    });
    lone.registerManifest(authSettingsManifest);
    const seen: SettingsChangeEvent[] = [];
    lone.subscribe(undefined, (e) => seen.push(e));
    await lone.set('auth', 'require_email_verification', true, ADMIN);
    return seen.map(({ at: _at, ...rest }) => rest);
  }

  it('redis driver without a declaration: the writer emits exactly what it emits today, nothing crosses', async () => {
    const { a, b, shared } = track(await bootPair({ declare: false }));

    await a.settings.set('auth', 'require_email_verification', true, ADMIN);
    await new Promise((r) => setTimeout(r, 20));

    expect(a.events.map(({ at: _at, ...rest }) => rest)).toEqual(await todaysEvents());
    expect(shared.published).toEqual([]);
    expect(b.events).toEqual([]);
    expect(b.posture.requireEmailVerification).toBe(false);
  });

  it('declared replicas over a driver other than redis: no lane', async () => {
    const { a, b, shared } = track(await bootPair({ driver: 'postgres' }));

    await a.settings.set('auth', 'require_email_verification', true, ADMIN);
    await new Promise((r) => setTimeout(r, 20));

    expect(shared.published).toEqual([]);
    expect(b.events).toEqual([]);
  });

  it('a reconnect on an unattached replica announces nothing', async () => {
    const { b } = track(await bootPair({ declare: false }));
    await b.reconnect();
    expect(b.events).toEqual([]);
  });

  it('a malformed or own-origin message is ignored', async () => {
    const { b, shared } = track(await bootPair());
    const raw = (payload: unknown) =>
      shared.bus.publish(SETTINGS_CHANGE_CLUSTER_CHANNEL, payload) as Promise<void>;
    await raw({ originNode: 'replica-b', namespace: 'auth', key: 'k', scope: 'global', action: 'set', at: 'x' });
    await raw({ originNode: 'replica-x', namespace: '', key: 'k', scope: 'global', action: 'set', at: 'x' });
    await raw({ originNode: 'replica-x', namespace: 'auth', key: 'k', scope: 'global', action: 'drop', at: 'x' });
    await raw(undefined);
    expect(b.events).toEqual([]);
  });
});
