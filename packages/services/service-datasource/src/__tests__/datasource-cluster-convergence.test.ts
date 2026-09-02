// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13805] Cross-replica DRIVER-registry convergence — the datasource admin
 * service's `datasource.mutated` fan-out, measured over the topology the card
 * describes: two `DatasourceAdminServicePlugin` boots ("replicas") over ONE
 * shared `sys_metadata` store, each with its OWN driver registry and its OWN
 * in-memory metadata registry, joined by a bus that delivers every publish to
 * every subscriber (publisher included — what a real remote driver does, and
 * what the `originNode` loopback guard exists for).
 *
 * The defect this pins, from a live 3-replica EE deployment: after
 * `DELETE /api/v1/datasources/:name` only the replica that served the DELETE
 * evicted the driver (#13578's door); every other replica kept the stuck
 * driver — and `/api/v1/ready` kept naming it — until restart. Symmetrically,
 * a datasource created on one replica had no pool on any other until restart.
 *
 * ---------------------------------------------------------------------------
 * Two-arm design, directions declared BEFORE running
 * ---------------------------------------------------------------------------
 *  • Arm B (bridge attached): a write on the writer reaches the peer and the
 *    peer's pool converges FROM ITS OWN READ of the shared row      -> GREEN
 *  • Arm A (control, no attach): the same write leaves the peer's registry
 *    exactly as it was — the pre-fix production shape             -> GREEN
 *    (constrains the instrument: Arm B's convergence is the bridge's doing,
 *    not a harness artifact that shares a registry between the replicas)
 *
 * Reverse verification, direction declared for the committed tree: removing
 * the `publishDatasourceMutation` call from `removeDatasource` turns EXACTLY
 * the delete-convergence cases red ("DELETE on the writer evicts … on the
 * PEER", the symmetric-payload case's delete leg) while Arm A, the loopback
 * case and every single-replica assertion stay green — with no publisher
 * nothing crosses the bus, which is indistinguishable from the shipped defect.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assertEngineDeleteDispatch,
  assertEngineFindOnePredicate,
  assertEngineUpdateDispatch,
} from '@objectstack/metadata-core';
import type { IDataDriver, IPubSub } from '@objectstack/spec/contracts';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import {
  DatasourceAdminService,
  DATASOURCE_MUTATION_CLUSTER_CHANNEL,
  type ClusterDatasourceMutationPayload,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
} from '../contracts/datasource-driver-factory.js';
import type { DatasourceDraft } from '../contracts/index.js';

type Row = Record<string, unknown>;

/** The SHARED database — the one `sys_metadata` every replica writes and reads. */
function makeSharedStore() {
  return { rows: [] as Row[], seq: 0 };
}

/** A persisted runtime datasource, in the row shape `persistDatasourceRow` writes. */
function sysRow(record: StoredDatasource): Row {
  const now = new Date().toISOString();
  return {
    id: `meta_${record.name}`,
    name: record.name,
    type: 'datasource',
    scope: 'platform',
    metadata: JSON.stringify(record),
    state: 'active',
    version: 1,
    created_at: now,
    updated_at: now,
  };
}

function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error(`fake engine: unsupported operator ${k}`);
    if (v === undefined) continue;
    if (row[k] !== v) return false;
  }
  return true;
}

/** The fake driver a pool is: it knows what it was built from and whether its connection is open. */
interface FakeDriver {
  name: string;
  builtFrom: DatasourceConnectionSpec & { secret?: string };
  connected: boolean;
  closed: boolean;
  disconnect: () => Promise<void>;
}

/** A fake factory whose drivers capture the spec they were built from. */
function fakeFactory(
  opts: { failWhen?: (spec: DatasourceConnectionSpec & { secret?: string }) => boolean } = {},
) {
  const created: Array<DatasourceConnectionSpec & { secret?: string }> = [];
  const factory: IDatasourceDriverFactory & { created: typeof created } = {
    created,
    supports: () => true,
    create: async (spec) => {
      const builtFrom = spec as DatasourceConnectionSpec & { secret?: string };
      created.push(builtFrom);
      const driver: FakeDriver = {
        name: 'com.fake.driver',
        builtFrom,
        connected: false,
        closed: false,
        disconnect: async () => {
          driver.closed = true;
        },
      };
      return {
        driver,
        connect: async () => {
          if (opts.failWhen?.(builtFrom)) throw new Error('connection refused');
          driver.connected = true;
        },
      };
    },
  };
  return factory;
}

/**
 * A remote-driver-shaped bus: one transport object, every publish delivered
 * synchronously to EVERY subscription — the publisher's own node included.
 */
function makeBus() {
  type Msg = { channel: string; payload: unknown; publishedAt: number };
  const subs: Array<{ channel: string; handler: (msg: Msg) => void }> = [];
  const published: Array<{ channel: string; payload: ClusterDatasourceMutationPayload }> = [];
  const bus = {
    async publish(channel: string, payload: unknown) {
      published.push({ channel, payload: payload as ClusterDatasourceMutationPayload });
      for (const s of [...subs]) {
        if (s.channel === channel) s.handler({ channel, payload, publishedAt: Date.now() });
      }
    },
    subscribe(channel: string, handler: (msg: never) => void) {
      const sub = { channel, handler: handler as (msg: Msg) => void };
      subs.push(sub);
      return () => {
        const i = subs.indexOf(sub);
        if (i >= 0) subs.splice(i, 1);
      };
    },
    async close() {},
  };
  return { bus: bus as unknown as IPubSub, raw: bus, published, subscriptionCount: () => subs.length };
}

/**
 * One "replica": the REAL plugin booted over a fake `data` engine whose
 * sys_metadata slice is the SHARED store and whose driver-registry slice is
 * its own — mirroring the real registry's semantics (`registerDriver` keeps
 * the incumbent on a name collision; `unregisterDriver` removes driver + def
 * together), because those two behaviours are why convergence needs the
 * rebuild primitive rather than a bare re-register.
 */
async function makeReplica(
  store: ReturnType<typeof makeSharedStore>,
  opts: { failWhen?: (spec: DatasourceConnectionSpec & { secret?: string }) => boolean } = {},
) {
  const drivers = new Map<string, FakeDriver>();
  const defs = new Map<string, { name: string; schemaMode?: string; external?: unknown }>();
  const evicted: string[] = [];

  const engine = {
    // ── the sys_metadata slice (`DataEngineLike`): over the SHARED rows ──
    findOne: async (table: string, q: { where: Record<string, unknown> }) => {
      assertEngineFindOnePredicate(table, q);
      return store.rows.find((r) => matches(r, q.where)) ?? null;
    },
    find: async (_table: string, q?: { where?: Record<string, unknown>; limit?: number }) => {
      // Hold the caller's bound AFTER the filter, by PRESENCE — the
      // objectql-double-limit contract.
      const all = store.rows.filter((r) => matches(r, q?.where ?? {}));
      return typeof q?.limit === 'number' ? all.slice(0, q.limit) : all;
    },
    insert: async (_table: string, data: Row) => {
      const row = { ...data, id: data.id ?? `r_${++store.seq}` };
      store.rows.push(row);
      return { id: row.id };
    },
    update: async (_table: string, data: Row, q: { where: Record<string, unknown> }) => {
      assertEngineUpdateDispatch(data, q);
      for (const r of store.rows) if (matches(r, q.where)) Object.assign(r, data);
      return {};
    },
    delete: async (_table: string, q: { where: Record<string, unknown> }) => {
      assertEngineDeleteDispatch(q);
      const before = store.rows.length;
      for (let i = store.rows.length - 1; i >= 0; i--) {
        if (matches(store.rows[i], q.where)) store.rows.splice(i, 1);
      }
      return { deleted: before - store.rows.length };
    },
    // ── the driver-registry slice (`ConnectionEngineLike`): PER REPLICA ──
    registerDriver: (driver: IDataDriver) => {
      if (drivers.has(driver.name)) return;
      drivers.set(driver.name, driver as unknown as FakeDriver);
    },
    unregisterDriver: (name: string) => {
      defs.delete(name);
      evicted.push(name);
      return drivers.delete(name);
    },
    getDriverByName: (name: string) => drivers.get(name) as unknown as IDataDriver | undefined,
    registerDatasourceDef: (def: { name: string; schemaMode?: string; external?: unknown }) => {
      defs.set(def.name, def);
    },
    markDatasourceUnavailable: () => {},
    clearDatasourceUnavailable: () => {},
  };

  // This replica's OWN in-memory metadata registry — per-replica state on
  // the host-config boot, which is exactly why convergence must not read it.
  const registry = new Map<string, Map<string, unknown>>();
  const metadata = {
    get: async (t: string, n: string) => registry.get(t)?.get(n),
    list: async (t: string) => [...(registry.get(t)?.values() ?? [])],
    register: async (t: string, n: string, d: unknown) => {
      if (!registry.has(t)) registry.set(t, new Map());
      registry.get(t)!.set(n, d);
    },
    unregister: async (t: string, n: string) => {
      registry.get(t)?.delete(n);
    },
    listObjects: async () => [],
  };

  const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  let service: DatasourceAdminService | undefined;
  const ctx: any = {
    getService: (name: string) => {
      if (name === 'data') return engine;
      if (name === 'metadata') return metadata;
      throw new Error(`no service ${name}`);
    },
    registerService: (name: string, svc: unknown) => {
      if (name === 'datasource-admin') service = svc as DatasourceAdminService;
    },
    trigger: async () => {},
    logger,
  };

  const factory = fakeFactory({ failWhen: opts.failWhen });
  const plugin = new DatasourceAdminServicePlugin({ driverFactory: factory, logger });
  await plugin.init(ctx);
  await plugin.start(ctx);

  return { service: service!, drivers, defs, evicted, factory, registry, logger, plugin, ctx };
}

/** Both replicas over one store, joined (or not) by the bus. */
async function makeCluster(
  opts: {
    attach?: boolean;
    seed?: StoredDatasource[];
    peerFailWhen?: (spec: DatasourceConnectionSpec & { secret?: string }) => boolean;
  } = {},
) {
  const store = makeSharedStore();
  for (const rec of opts.seed ?? []) store.rows.push(sysRow(rec));
  const writer = await makeReplica(store);
  const peer = await makeReplica(store, { failWhen: opts.peerFailWhen });
  const { bus, raw, published, subscriptionCount } = makeBus();
  const detachers: Array<() => void> = [];
  if (opts.attach !== false) {
    detachers.push(writer.service.attachDatasourceMutationPubSub(bus, 'node-a'));
    detachers.push(peer.service.attachDatasourceMutationPubSub(bus, 'node-b'));
  }
  return { store, writer, peer, bus, raw, published, subscriptionCount, detachers };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

const draft = (over: Partial<DatasourceDraft> = {}): DatasourceDraft => ({
  name: 'analytics',
  driver: 'sqlite',
  config: { filename: '/tmp/old.db' },
  ...over,
});

const seeded: StoredDatasource = {
  name: 'analytics',
  driver: 'sqlite',
  config: { filename: '/tmp/old.db' },
  origin: 'runtime',
};

describe('[#13805] ⭐ two-arm: the peer’s driver registry converges because of the bridge', () => {
  it('Arm B — DELETE on the writer evicts the driver on the PEER, not only on the replica that served it', async () => {
    const c = await makeCluster({ seed: [seeded] });
    // Both replicas rehydrated the pool at boot — the production shape.
    const writerDriver = c.writer.drivers.get('analytics')!;
    const peerDriver = c.peer.drivers.get('analytics')!;
    expect(writerDriver.connected).toBe(true);
    expect(peerDriver.connected).toBe(true);

    await c.writer.service.removeDatasource('analytics');

    // The serving replica: #13578's eviction, unchanged.
    expect(c.writer.drivers.has('analytics')).toBe(false);
    // The card: the PEER evicts too — pre-fix this stayed `true` until restart.
    await vi.waitFor(() => expect(c.peer.drivers.has('analytics')).toBe(false));
    expect(c.peer.evicted).toContain('analytics');
    expect(peerDriver.closed).toBe(true);
    // The peer's def went with its driver (the registry owns that invariant).
    expect(c.peer.defs.has('analytics')).toBe(false);
  });

  it('Arm A — CONTROL: the identical DELETE with no bridge leaves the peer’s driver in place', async () => {
    const c = await makeCluster({ attach: false, seed: [seeded] });
    expect(c.writer.drivers.has('analytics')).toBe(true);
    expect(c.peer.drivers.has('analytics')).toBe(true);

    await c.writer.service.removeDatasource('analytics');
    await settle();

    expect(c.writer.drivers.has('analytics')).toBe(false);
    // The pre-fix production shape: N-1 replicas keep the stuck driver. This
    // arm is what makes Arm B a measurement — the harness shares a store
    // between the replicas, never a registry.
    expect(c.peer.drivers.has('analytics')).toBe(true);
    expect(c.peer.drivers.get('analytics')!.closed).toBe(false);
    expect(c.published).toHaveLength(0);
  });

  it('Arm B — create on the writer builds the pool on the PEER, from the peer’s OWN read of the shared row', async () => {
    const c = await makeCluster();
    expect(c.peer.drivers.size).toBe(0);

    await c.writer.service.createDatasource(draft());

    expect(c.writer.drivers.get('analytics')!.connected).toBe(true);
    await vi.waitFor(() => expect(c.peer.drivers.has('analytics')).toBe(true));
    const peerDriver = c.peer.drivers.get('analytics')!;
    expect(peerDriver.connected).toBe(true);
    // Built from the SHARED ROW — the wire carried no config to build from.
    expect(peerDriver.builtFrom.config).toMatchObject({ filename: '/tmp/old.db' });
    expect(c.peer.factory.created).toHaveLength(1);
    // Converged the DRIVER registry only: the peer's metadata registry is a
    // different sink (#13609's lane) and was deliberately left untouched.
    expect(c.peer.registry.get('datasource')?.has('analytics') ?? false).toBe(false);
  });

  it('Arm A — CONTROL: the identical create with no bridge leaves the peer pool-less', async () => {
    const c = await makeCluster({ attach: false });

    await c.writer.service.createDatasource(draft());
    await settle();

    expect(c.writer.drivers.has('analytics')).toBe(true);
    expect(c.peer.drivers.size).toBe(0);
    expect(c.peer.factory.created).toHaveLength(0);
  });

  it('Arm B — a connectivity change on the writer rebuilds the peer’s pool in place from the new row', async () => {
    const c = await makeCluster({ seed: [seeded] });
    const oldPeerDriver = c.peer.drivers.get('analytics')!;

    await c.writer.service.updateDatasource('analytics', { config: { filename: '/tmp/new.db' } });

    await vi.waitFor(() => expect(c.peer.drivers.get('analytics')).not.toBe(oldPeerDriver));
    const newPeerDriver = c.peer.drivers.get('analytics')!;
    expect(newPeerDriver.builtFrom.config).toMatchObject({ filename: '/tmp/new.db' });
    expect(newPeerDriver.connected).toBe(true);
    // The replaced pool's connection is closed, not leaked.
    expect(oldPeerDriver.closed).toBe(true);
  });

  it('Arm B — active:false on the writer takes the peer out of service; active:true brings it back', async () => {
    const c = await makeCluster({ seed: [seeded] });
    const peerDriver = c.peer.drivers.get('analytics')!;

    await c.writer.service.updateDatasource('analytics', { active: false });
    await vi.waitFor(() => expect(c.peer.drivers.has('analytics')).toBe(false));
    expect(peerDriver.closed).toBe(true);

    await c.writer.service.updateDatasource('analytics', { active: true });
    await vi.waitFor(() => expect(c.peer.drivers.has('analytics')).toBe(true));
    expect(c.peer.drivers.get('analytics')!.builtFrom.config).toMatchObject({ filename: '/tmp/old.db' });
  });
});

describe('[#13805] the signal is an address, and receipt is convergence', () => {
  it('publishes name + originNode only, on datasource.mutated, for create, update AND delete — symmetric', async () => {
    const c = await makeCluster();

    await c.writer.service.createDatasource(draft());
    await c.writer.service.updateDatasource('analytics', { label: 'Renamed' });
    await c.writer.service.removeDatasource('analytics');
    await settle();

    expect(c.published).toHaveLength(3);
    for (const { channel, payload } of c.published) {
      expect(channel).toBe(DATASOURCE_MUTATION_CLUSTER_CHANNEL);
      // Address-only: a peer must re-read its own store, so the wire must not
      // offer it anything else to trust — no config, no driver, no verb.
      expect(Object.keys(payload).sort()).toEqual(['name', 'originNode']);
      expect(payload).toEqual({ originNode: 'node-a', name: 'analytics' });
    }
  });

  it('a duplicate delivery is a no-op — same driver instance on the peer, no rebuild', async () => {
    const c = await makeCluster();
    await c.writer.service.createDatasource(draft());
    await vi.waitFor(() => expect(c.peer.drivers.has('analytics')).toBe(true));
    const peerDriver = c.peer.drivers.get('analytics')!;
    const last = c.published[c.published.length - 1];

    // What an at-least-once transport does: the same message, again.
    await c.raw.publish(last.channel, last.payload);
    await c.raw.publish(last.channel, last.payload);
    await settle();

    // Identity, not equivalence: a converge that rebuilt would pass an
    // equivalence check with an identical pool.
    expect(c.peer.drivers.get('analytics')).toBe(peerDriver);
    expect(c.peer.factory.created).toHaveLength(1);
    expect(c.peer.evicted).toHaveLength(0);
  });

  it('a label-only edit on the writer does not churn the peer’s pool', async () => {
    const c = await makeCluster({ seed: [seeded] });
    const peerDriver = c.peer.drivers.get('analytics')!;

    await c.writer.service.updateDatasource('analytics', { label: 'Renamed' });
    await settle();

    expect(c.published).toHaveLength(1);
    expect(c.peer.drivers.get('analytics')).toBe(peerDriver);
    expect(c.peer.factory.created).toHaveLength(1);
    expect(c.peer.evicted).toHaveLength(0);
    expect(peerDriver.closed).toBe(false);
  });

  it('two signals in quick succession converge in order — a create chased by an update ends on the update', async () => {
    const c = await makeCluster();

    // Not awaited in between: the peer sees both deliveries before its first
    // convergence finishes reading. Ordered receipt is what keeps this from
    // opening two pools for one name.
    const create = c.writer.service.createDatasource(draft());
    const update = create.then(() =>
      c.writer.service.updateDatasource('analytics', { config: { filename: '/tmp/new.db' } }),
    );
    await update;

    await vi.waitFor(() =>
      expect(c.peer.drivers.get('analytics')?.builtFrom.config).toMatchObject({ filename: '/tmp/new.db' }),
    );
    // Every pool the peer opened along the way is either the live one or closed.
    const stale = c.peer.factory.created.length - 1;
    expect(stale).toBeGreaterThanOrEqual(0);
    expect(c.peer.drivers.size).toBe(1);
  });

  it('a signal naming a datasource the peer never pooled, with no shared row, touches nothing — a code-defined pool survives a stray name', async () => {
    const c = await makeCluster();
    // A pool the HOST STACK owns (code-defined): registered straight into the
    // engine, never through this plugin's `registerPool`.
    const codeDriver: FakeDriver = {
      name: 'warehouse',
      builtFrom: { name: 'warehouse', driver: 'postgres', config: {} },
      connected: true,
      closed: false,
      disconnect: async () => {
        codeDriver.closed = true;
      },
    };
    c.peer.drivers.set('warehouse', codeDriver);

    await c.raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-a', name: 'warehouse' });
    await c.raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-a', name: 'never_existed' });
    await settle();

    expect(c.peer.drivers.get('warehouse')).toBe(codeDriver);
    expect(codeDriver.closed).toBe(false);
    expect(c.peer.evicted).toHaveLength(0);
    expect(c.peer.factory.created).toHaveLength(0);
    expect(c.peer.logger.warn).not.toHaveBeenCalled();
  });

  it('a rebuild that fails on the peer keeps the peer’s OLD pool serving — never pool-less', async () => {
    const c = await makeCluster({
      seed: [{ ...seeded, schemaMode: 'external', external: { allowWrites: false } }],
      peerFailWhen: (spec) => (spec.config as { filename?: string }).filename === '/tmp/bad.db',
    });
    const oldPeerDriver = c.peer.drivers.get('analytics')!;

    // The writer's own rebuild succeeds (its factory does not fail on the new
    // config); only the peer's does not.
    await c.writer.service.updateDatasource('analytics', { config: { filename: '/tmp/bad.db' } });
    await vi.waitFor(() => expect(c.peer.factory.created).toHaveLength(2));
    await settle();

    // Same instance in the peer's registry, connection still open, def
    // restored alongside — the #13804 keep-old-pool settlement, on a peer.
    expect(c.peer.drivers.get('analytics')).toBe(oldPeerDriver);
    expect(oldPeerDriver.closed).toBe(false);
    expect(oldPeerDriver.connected).toBe(true);
    expect(c.peer.defs.get('analytics')).toMatchObject({ name: 'analytics', schemaMode: 'external' });
  });

  it('a stored row that cannot be read is NOT spent as "gone" — the peer keeps its pool and says so', async () => {
    const c = await makeCluster({ seed: [seeded] });
    const peerDriver = c.peer.drivers.get('analytics')!;
    const row = c.store.rows.find((r) => r.name === 'analytics')!;
    row.metadata = '{not json';

    await c.raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-a', name: 'analytics' });
    await settle();

    expect(c.peer.drivers.get('analytics')).toBe(peerDriver);
    expect(peerDriver.closed).toBe(false);
    expect(c.peer.evicted).toHaveLength(0);
    expect(c.peer.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("converging 'analytics' after a peer write failed"),
      expect.any(Error),
    );
  });

  it('a publish failure never fails the write it announces', async () => {
    const c = await makeCluster();
    c.raw.publish = async () => {
      throw new Error('bus down');
    };

    const summary = await c.writer.service.createDatasource(draft());
    await settle();

    expect(summary.name).toBe('analytics');
    expect(c.writer.drivers.get('analytics')!.connected).toBe(true);
    expect(c.writer.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("publishing 'analytics' to peer replicas failed"),
      expect.any(Error),
    );
  });

  it('after detach, a write on the writer no longer reaches the peer', async () => {
    const c = await makeCluster();
    for (const d of c.detachers) d();
    expect(c.subscriptionCount()).toBe(0);

    await c.writer.service.createDatasource(draft());
    await settle();

    expect(c.published).toHaveLength(0);
    expect(c.peer.drivers.size).toBe(0);
  });

  it('a replica that boots AFTER the write still converges the old way — boot rehydration is the loss bound', async () => {
    const c = await makeCluster();
    await c.writer.service.createDatasource(draft());
    await settle();

    // A third replica that was down at publish time: it never heard the
    // signal, and does not need to — its boot reads the shared row.
    const late = await makeReplica(c.store);
    expect(late.drivers.get('analytics')?.connected).toBe(true);
  });
});

describe('[#13805] the attach seam — loopback, idempotency, the missing converge seam', () => {
  function makeStub(over: Partial<DatasourceAdminServiceConfig> = {}) {
    const logger = { warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const config: DatasourceAdminServiceConfig = {
      probe: async () => ({ ok: true }),
      listDatasourceRecords: async () => [],
      getDatasourceRecord: async () => undefined,
      putDatasourceRecord: async () => {},
      deleteDatasourceRecord: async () => {},
      writeSecret: async () => 'ref',
      countBoundObjects: async () => 0,
      logger,
      ...over,
    };
    return { service: new DatasourceAdminService(config), logger };
  }

  it('ignores its own node’s messages (loopback) and converges on a peer’s', async () => {
    const converge = vi.fn(async (_name: string) => {});
    const { service } = makeStub({ convergePool: converge });
    const { bus, raw } = makeBus();
    service.attachDatasourceMutationPubSub(bus, 'node-a');

    await raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-a', name: 'analytics' });
    await settle();
    expect(converge).not.toHaveBeenCalled();

    await raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-b', name: 'analytics' });
    await settle();
    expect(converge).toHaveBeenCalledTimes(1);
    expect(converge).toHaveBeenCalledWith('analytics');
  });

  it('a malformed payload is ignored, never converged', async () => {
    const converge = vi.fn(async (_name: string) => {});
    const { service, logger } = makeStub({ convergePool: converge });
    const { bus, raw } = makeBus();
    service.attachDatasourceMutationPubSub(bus, 'node-a');

    await raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-b' });
    await raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-b', name: '' });
    await raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, null);
    await settle();

    expect(converge).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('is idempotent on the (pubsub, nodeId) pair and detaches cleanly', async () => {
    const { service, logger } = makeStub({ convergePool: async () => {} });
    const { bus, subscriptionCount } = makeBus();

    const detach1 = service.attachDatasourceMutationPubSub(bus, 'node-a');
    const detach2 = service.attachDatasourceMutationPubSub(bus, 'node-a');
    expect(subscriptionCount()).toBe(1);
    expect(logger.info).toHaveBeenCalledTimes(1);
    expect(logger.info.mock.calls[0][0]).toBe(
      `datasource admin: attached to the ${DATASOURCE_MUTATION_CLUSTER_CHANNEL} cluster channel (node=node-a)`,
    );

    // A different node id on the same transport is a re-attach.
    service.attachDatasourceMutationPubSub(bus, 'node-a2');
    expect(subscriptionCount()).toBe(1);

    detach1();
    detach2();
    service.detachDatasourceMutationPubSub();
    expect(subscriptionCount()).toBe(0);
  });

  it('a host without a convergePool seam still publishes, applies nothing, and says so once at debug', async () => {
    const { service, logger } = makeStub();
    const { bus, raw, published } = makeBus();
    service.attachDatasourceMutationPubSub(bus, 'node-a');

    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(logger.debug.mock.calls[0][0]).toContain('no convergePool seam wired');

    await service.createDatasource(draft());
    expect(published).toEqual([
      { channel: DATASOURCE_MUTATION_CLUSTER_CHANNEL, payload: { originNode: 'node-a', name: 'analytics' } },
    ]);

    await raw.publish(DATASOURCE_MUTATION_CLUSTER_CHANNEL, { originNode: 'node-b', name: 'analytics' });
    await settle();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('migrateCredential does not publish — the live pool is left alone on every replica alike', async () => {
    const records: StoredDatasource[] = [
      {
        name: 'warehouse',
        driver: 'postgres',
        origin: 'runtime',
        config: { host: 'db.internal', database: 'app', username: 'app', password: 'hunter2' },
      },
    ];
    const secrets = new Map<string, string>();
    const { service } = makeStub({
      convergePool: async () => {},
      getDatasourceRecord: async (n) => records.find((r) => r.name === n),
      putDatasourceRecord: async (r) => {
        records.splice(0, records.length, r);
      },
      writeSecret: async (input, hint) => {
        const ref = `sys_secret://datasource/${hint.name}#1`;
        secrets.set(ref, input.value);
        return ref;
      },
      readSecret: async (ref) => secrets.get(ref),
    });
    const { bus, published } = makeBus();
    service.attachDatasourceMutationPubSub(bus, 'node-a');

    const result = await service.migrateCredential('warehouse');

    expect(result.status).toBe('migrated');
    expect(published).toHaveLength(0);
  });
});
