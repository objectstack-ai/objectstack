// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #13804 — updating a datasource must rebuild its live pool exactly when a
 * connectivity-bearing field changed, and only then.
 *
 * The defect: `updateDatasource` persisted the merged record and called
 * `registerPool`, whose connect-path idempotency guard answered
 * `already-registered` while the OLD driver held the name — so the running
 * pool never followed the record, and `toSummary` kept reporting the ORIGINAL
 * connect's retained `connected`, i.e. a successful save describing a pool the
 * record no longer declares. `active: false` not taking effect is the
 * security-adjacent corner of the same hole: an explicitly disabled data plane
 * kept serving until process restart.
 *
 * The rig wires the REAL `DatasourceAdminService` + `DatasourceConnectionService`
 * together exactly as `DatasourceAdminServicePlugin` does (registerPool →
 * connect, unregisterPool → disconnect, reregisterPool → reconnect,
 * connectionStates → listConnectionStates), against a fake engine that mirrors
 * the real registry's semantics — `registerDriver` KEEPS the incumbent on a
 * name collision, `unregisterDriver` removes driver + datasource def + default
 * together — because those two behaviours are precisely why the update path
 * needed an explicit rebuild primitive.
 *
 * "Serving" at this seam: the engine routes a query by consulting the driver
 * registry FIRST (a registered driver answers before the unavailable mark is
 * even read — see `ObjectQLEngine.getDriver`), so "the registry holds a live
 * driver instance whose pool is open" is what serving means here, and "the
 * registry no longer answers the name" is what stopping means.
 */

import { describe, it, expect } from 'vitest';
import {
  DatasourceAdminService,
  type DatasourceAdminServiceConfig,
  type StoredDatasource,
} from '../datasource-admin-service.js';
import {
  DatasourceConnectionService,
  type ConnectionEngineLike,
} from '../datasource-connection-service.js';
import { datasourceConnectivityChanged } from '../datasource-connectivity-change.js';
import type {
  IDatasourceDriverFactory,
  DatasourceConnectionSpec,
} from '../contracts/datasource-driver-factory.js';
import type { DatasourceDraft } from '../contracts/index.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

/** The fake driver a pool is: it knows what it was built from and whether its connection is open. */
interface FakeDriver {
  name: string;
  /** The exact `factory.create` input this pool was built from — the positive pin's subject. */
  builtFrom: DatasourceConnectionSpec & { secret?: string };
  connected: boolean;
  closed: boolean;
  disconnect: () => Promise<void>;
}

/** A fake engine mirroring the REAL registry semantics the fix depends on. */
function fakeEngine() {
  const drivers = new Map<string, FakeDriver>();
  const defs = new Map<string, { name: string; schemaMode?: string; external?: unknown }>();
  const unavailable = new Map<string, { kind: string }>();
  const evicted: string[] = [];
  const engine: ConnectionEngineLike & {
    drivers: typeof drivers;
    defs: typeof defs;
    unavailable: typeof unavailable;
    evicted: string[];
  } = {
    drivers,
    defs,
    unavailable,
    evicted,
    registerDriver: (driver) => {
      // Mirror the real engine: a name collision KEEPS the incumbent and
      // discards the newcomer — the reason `connect()` alone cannot swap.
      if (drivers.has(driver.name)) return;
      drivers.set(driver.name, driver as unknown as FakeDriver);
    },
    unregisterDriver: (name) => {
      // Mirror the real engine: the def is removed together with the driver
      // (the registry owns that invariant) — the reason `reconnect` must
      // restore the def on the keep-old-pool path.
      defs.delete(name);
      evicted.push(name);
      return drivers.delete(name);
    },
    getDriverByName: (name) => drivers.get(name) as unknown as IDataDriver | undefined,
    registerDatasourceDef: (def) => {
      defs.set(def.name, def);
    },
    markDatasourceUnavailable: (info) => {
      unavailable.set(info.name, info);
    },
    clearDatasourceUnavailable: (name) => {
      unavailable.delete(name);
    },
  };
  return engine;
}

/** A fake factory whose drivers capture the spec they were built from. */
function fakeFactory(opts: { failWhen?: (spec: DatasourceConnectionSpec & { secret?: string }) => boolean } = {}) {
  const created: Array<DatasourceConnectionSpec & { secret?: string }> = [];
  const factory: IDatasourceDriverFactory & { created: typeof created } = {
    created,
    supports: () => true,
    create: async (spec) => {
      created.push(spec as DatasourceConnectionSpec & { secret?: string });
      const driver: FakeDriver = {
        name: 'com.fake.driver',
        builtFrom: spec as DatasourceConnectionSpec & { secret?: string },
        connected: false,
        closed: false,
        disconnect: async () => {
          driver.closed = true;
        },
      };
      return {
        driver,
        connect: async () => {
          if (opts.failWhen?.(driver.builtFrom)) throw new Error('connection refused');
          driver.connected = true;
        },
      };
    },
  };
  return factory;
}

/**
 * The plugin's wiring, reproduced: one admin service and one connection
 * service sharing an engine, a factory, and a secret store.
 */
function makeRig(opts: {
  failWhen?: (spec: DatasourceConnectionSpec & { secret?: string }) => boolean;
  /** Rewrap-in-place binder: every write lands under ONE stable ref. */
  stableSecretRef?: boolean;
  /** Leave the `reregisterPool` seam unwired (a pre-#13804 host). */
  noReregisterSeam?: boolean;
} = {}) {
  const engine = fakeEngine();
  const factory = fakeFactory({ failWhen: opts.failWhen });
  const records: StoredDatasource[] = [];
  const secrets = new Map<string, string>();
  let secretSeq = 0;

  const connection = new DatasourceConnectionService({
    factory: () => factory,
    engine: () => engine,
    secrets: { resolve: async (ref) => secrets.get(ref) },
  });

  const config: DatasourceAdminServiceConfig = {
    probe: async () => ({ ok: true }),
    listDatasourceRecords: async () => records.map((r) => ({ ...r })),
    getDatasourceRecord: async (n) => {
      const r = records.find((x) => x.name === n);
      return r ? { ...r } : undefined;
    },
    putDatasourceRecord: async (record) => {
      const idx = records.findIndex((r) => r.name === record.name);
      if (idx >= 0) records[idx] = { ...record };
      else records.push({ ...record });
    },
    deleteDatasourceRecord: async (n) => {
      const idx = records.findIndex((r) => r.name === n);
      if (idx >= 0) records.splice(idx, 1);
    },
    writeSecret: async (input, hint) => {
      const ref = opts.stableSecretRef
        ? `sys_secret://datasource/${hint.name}`
        : `sys_secret://datasource/${hint.name}#${++secretSeq}`;
      secrets.set(ref, input.value);
      return ref;
    },
    countBoundObjects: async () => 0,
    registerPool: (record) =>
      connection.connect(record, {
        context: { origin: record.origin ?? 'runtime', trigger: 'runtime-admin' },
      }).then(() => undefined),
    unregisterPool: (name) => connection.disconnect(name),
    ...(opts.noReregisterSeam
      ? {}
      : {
          reregisterPool: (previous: StoredDatasource, next: StoredDatasource) =>
            connection
              .reconnect(next, {
                previous,
                context: { origin: next.origin ?? 'runtime', trigger: 'runtime-admin' },
              })
              .then(() => undefined),
        }),
    connectionStates: () => connection.listConnectionStates(),
  };

  const service = new DatasourceAdminService(config);
  return { service, connection, engine, factory, secrets, records };
}

const draft = (over: Partial<DatasourceDraft> = {}): DatasourceDraft => ({
  name: 'analytics',
  driver: 'sqlite',
  config: { filename: '/tmp/old.db' },
  ...over,
});

describe('#13804 — updateDatasource rebuilds the live pool when connectivity changed', () => {
  it('a config change evicts the old pool and registers a NEW pool genuinely built from the NEW config', async () => {
    const rig = makeRig();
    await rig.service.createDatasource(draft());
    const oldDriver = rig.engine.drivers.get('analytics')!;
    expect(oldDriver.builtFrom.config).toMatchObject({ filename: '/tmp/old.db' });
    expect(oldDriver.connected).toBe(true);

    const summary = await rig.service.updateDatasource('analytics', {
      config: { filename: '/tmp/new.db' },
    });

    const newDriver = rig.engine.drivers.get('analytics')!;
    // The pin is on WHAT the registered pool was built from — not on any
    // eviction call having happened (that is an implementation detail).
    expect(newDriver).not.toBe(oldDriver);
    expect(newDriver.builtFrom.config).toMatchObject({ filename: '/tmp/new.db' });
    expect(newDriver.connected).toBe(true);
    // The replaced pool's connection is closed, not leaked.
    expect(oldDriver.closed).toBe(true);
    // The save's verdict describes the pool that now exists.
    expect(summary.status).toBe('ok');
  });

  it('active: false takes the datasource out of service — the registry no longer answers the name', async () => {
    const rig = makeRig();
    await rig.service.createDatasource(draft());
    const oldDriver = rig.engine.drivers.get('analytics')!;

    const summary = await rig.service.updateDatasource('analytics', { active: false });

    // The engine routes by consulting the driver registry first, so an entry
    // that is gone is a datasource that no longer serves — the security-
    // adjacent half of the card: disabling must actually disable.
    expect(rig.engine.drivers.has('analytics')).toBe(false);
    expect(oldDriver.closed).toBe(true);
    expect(summary.active).toBe(false);
    // Verdict matches the real pool state: nothing is connected and nothing
    // was attempted — the same reading a boot gives a disabled datasource
    // (never connected, no retained verdict), not a stale `ok`.
    expect(summary.status).toBe('unvalidated');
    expect(rig.connection.getConnectionState('analytics')).toBeUndefined();
  });

  it('active: true re-enables — the pool is rebuilt from the stored record', async () => {
    const rig = makeRig();
    await rig.service.createDatasource(draft());
    await rig.service.updateDatasource('analytics', { active: false });
    expect(rig.engine.drivers.has('analytics')).toBe(false);

    const summary = await rig.service.updateDatasource('analytics', { active: true });

    const driver = rig.engine.drivers.get('analytics')!;
    expect(driver.connected).toBe(true);
    expect(driver.builtFrom.config).toMatchObject({ filename: '/tmp/old.db' });
    expect(summary.status).toBe('ok');
  });

  it('reverse control: a label-only edit is the SAME driver instance — no eviction, no rebuild, no churn', async () => {
    const rig = makeRig();
    await rig.service.createDatasource(draft());
    const oldDriver = rig.engine.drivers.get('analytics')!;
    expect(rig.factory.created).toHaveLength(1);

    const summary = await rig.service.updateDatasource('analytics', { label: 'Renamed' });

    // Identity, not equivalence: the rejected always-swap design would pass an
    // equivalence check by rebuilding an identical pool. Only instance
    // identity distinguishes "left alone" from "churned".
    expect(rig.engine.drivers.get('analytics')).toBe(oldDriver);
    expect(rig.factory.created).toHaveLength(1);
    expect(rig.engine.evicted).toHaveLength(0);
    expect(oldDriver.closed).toBe(false);
    expect(summary.label).toBe('Renamed');
    expect(summary.status).toBe('ok');
  });

  it('reverse control: round-tripping an unchanged config + external is not a change', async () => {
    const rig = makeRig();
    await rig.service.createDatasource(
      draft({ schemaMode: 'external', external: { allowWrites: false } }),
    );
    const oldDriver = rig.engine.drivers.get('analytics')!;

    // The wizard PATCHes the full document back: same config values (a new
    // object), same external block. The merge writes `credentialsRef:
    // undefined` onto `external` — a key the stored record never had — and the
    // comparison must read that as "no change" (deep equality + JSON's
    // undefined-is-absent), not rebuild the pool on every save.
    await rig.service.updateDatasource('analytics', {
      config: { filename: '/tmp/old.db' },
      external: { allowWrites: false },
    });

    expect(rig.engine.drivers.get('analytics')).toBe(oldDriver);
    expect(rig.factory.created).toHaveLength(1);
    expect(rig.engine.evicted).toHaveLength(0);
  });

  it('rebuild failure keeps the OLD pool live and serving under a loudly degraded verdict — never pool-less', async () => {
    const rig = makeRig({
      failWhen: (spec) => (spec.config as { filename?: string }).filename === '/tmp/bad.db',
    });
    await rig.service.createDatasource(
      draft({ schemaMode: 'external', external: { allowWrites: false } }),
    );
    const oldDriver = rig.engine.drivers.get('analytics')!;

    const summary = await rig.service.updateDatasource('analytics', {
      config: { filename: '/tmp/bad.db' },
    });

    // 1. The old pool is still live and serving: same instance in the
    //    registry (routing consults the registry before the unavailable
    //    mark), connection still open.
    expect(rig.engine.drivers.get('analytics')).toBe(oldDriver);
    expect(oldDriver.closed).toBe(false);
    expect(oldDriver.connected).toBe(true);
    // 2. The verdict is loudly degraded — not `connected`, not `ok` — and
    //    says the truth: the previous configuration's pool is the one serving.
    expect(summary.status).toBe('error');
    expect(summary.statusReason).toContain('connection refused');
    expect(summary.statusReason).toContain('still the one serving');
    const state = rig.connection.getConnectionState('analytics')!;
    expect(state.status).toBe('failed-degraded');
    // 3. Not pool-less: the datasource def the old pool was serving under is
    //    restored alongside the driver (`unregisterDriver` removes both).
    expect(rig.engine.defs.get('analytics')).toMatchObject({
      name: 'analytics',
      schemaMode: 'external',
    });
  });

  it('a supplied secret alone forces a rebuild — rewrap-in-place changes what the ref dereferences to', async () => {
    const rig = makeRig({ stableSecretRef: true });
    await rig.service.createDatasource(
      draft({ schemaMode: 'external', external: { allowWrites: false } }),
      { value: 'old-pw' },
    );
    const oldDriver = rig.engine.drivers.get('analytics')!;
    expect(oldDriver.builtFrom.secret).toBe('old-pw');

    // The record diff cannot see this change: the binder rewraps under the
    // SAME `credentialsRef`, so `external` compares equal — yet the pool reads
    // the credential only at build time, so without a rebuild the old
    // password keeps being used.
    await rig.service.updateDatasource('analytics', {}, { value: 'new-pw' });

    const newDriver = rig.engine.drivers.get('analytics')!;
    expect(newDriver).not.toBe(oldDriver);
    expect(newDriver.builtFrom.secret).toBe('new-pw');
    expect(oldDriver.closed).toBe(true);
  });

  it('createDatasource honours active: false — no pool for a datasource born disabled', async () => {
    const rig = makeRig();
    const summary = await rig.service.createDatasource(draft({ active: false }));

    // Same reading as every other lifecycle door: `connectDeclared` skips
    // `active === false` at boot and rehydration filters on `active ?? true`.
    // Create was the outlier that built a live pool for a disabled record.
    expect(rig.factory.created).toHaveLength(0);
    expect(rig.engine.drivers.size).toBe(0);
    expect(summary.active).toBe(false);
    expect(summary.status).toBe('unvalidated');
  });

  it('a host without the reregisterPool seam degrades to the pre-#13804 idempotent register (old pool retained)', async () => {
    const rig = makeRig({ noReregisterSeam: true });
    await rig.service.createDatasource(draft());
    const oldDriver = rig.engine.drivers.get('analytics')!;

    await rig.service.updateDatasource('analytics', { config: { filename: '/tmp/new.db' } });

    // Not the fixed behaviour — the safe fallback: the incumbent pool stays
    // (never pool-less, never a failed swap), exactly what this host had
    // before the seam existed.
    expect(rig.engine.drivers.get('analytics')).toBe(oldDriver);
    expect(rig.factory.created).toHaveLength(1);
  });
});

describe('datasourceConnectivityChanged — the ruled field set, read from what attemptConnect consumes', () => {
  const base: Pick<StoredDatasource, 'driver' | 'config' | 'external' | 'pool' | 'active'> = {
    driver: 'postgres',
    config: { host: 'db.internal', port: 5432 },
    external: { allowWrites: false, credentialsRef: 'sys_secret://x' },
    pool: { max: 10 },
    active: true,
  };

  it('each ruled field trips it', () => {
    expect(datasourceConnectivityChanged(base, { ...base, driver: 'mysql' })).toBe(true);
    expect(
      datasourceConnectivityChanged(base, { ...base, config: { host: 'db.other', port: 5432 } }),
    ).toBe(true);
    expect(
      datasourceConnectivityChanged(base, {
        ...base,
        external: { allowWrites: false, credentialsRef: 'sys_secret://y' },
      }),
    ).toBe(true);
    expect(datasourceConnectivityChanged(base, { ...base, pool: { max: 20 } })).toBe(true);
    expect(datasourceConnectivityChanged(base, { ...base, active: false })).toBe(true);
  });

  it('a schemaMode-only edit trips it — the seventh member, ruled in by the contract review', () => {
    // Three real readings on the connect path: the policy gate (`canConnect`),
    // `toSpec` -> `factory.create` (the driver is built from it), and
    // `registerDatasourceDef` (the write gate's def). It is patchable by
    // `updateDatasource`, so without this member a schemaMode-only save
    // persisted the new record while all three kept the OLD value until
    // restart — a narrower instance of the stale-pool defect this card fixes.
    expect(datasourceConnectivityChanged(base, { ...base, schemaMode: 'external' })).toBe(true);
    // Both directions: first-time set, and cleared.
    expect(
      datasourceConnectivityChanged(
        { driver: 'sqlite' },
        { driver: 'sqlite', schemaMode: 'validate-only' },
      ),
    ).toBe(true);
    expect(
      datasourceConnectivityChanged(
        { driver: 'sqlite', schemaMode: 'external' },
        { driver: 'sqlite' },
      ),
    ).toBe(true);
    // Widened by exactly ONE member, not into "rebuild on everything": an
    // unchanged schemaMode is still no change, which is what leaves the
    // label-only reverse control above reading the same as before.
    expect(
      datasourceConnectivityChanged(
        { ...base, schemaMode: 'external' },
        { ...base, schemaMode: 'external' },
      ),
    ).toBe(false);
  });

  it('deep-equal values are no change, whatever the object identity', () => {
    const same = {
      driver: 'postgres',
      config: { host: 'db.internal', port: 5432 },
      external: { allowWrites: false, credentialsRef: 'sys_secret://x' },
      pool: { max: 10 },
      active: true,
    };
    expect(datasourceConnectivityChanged(base, same)).toBe(false);
  });

  it('normalises the way the connect path reads: config ?? {}, active ?? true, undefined keys absent', () => {
    // `toSpec` sends `config ?? {}`.
    expect(
      datasourceConnectivityChanged(
        { driver: 'sqlite', config: undefined },
        { driver: 'sqlite', config: {} },
      ),
    ).toBe(false);
    // Spec default: `active` omitted means enabled.
    expect(
      datasourceConnectivityChanged(
        { driver: 'sqlite', active: undefined },
        { driver: 'sqlite', active: true },
      ),
    ).toBe(false);
    // The update merge writes `credentialsRef: undefined` onto a record that
    // never had the key — JSON semantics: not a change.
    expect(
      datasourceConnectivityChanged(
        { driver: 'sqlite', external: { allowWrites: true } },
        { driver: 'sqlite', external: { allowWrites: true, credentialsRef: undefined } },
      ),
    ).toBe(false);
  });
});
