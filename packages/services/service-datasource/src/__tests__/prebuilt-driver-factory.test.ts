// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #3826 (fourth pass): `createPrebuiltDriverFactory` is the "adopt a
// host-built driver instance" seam, landed AS a factory so the connect +
// failure-verdict orchestration stays the one `DatasourceConnectionService`
// implementation. These tests pin the two properties the seam exists for:
// `create()` hands back the SAME instance (pooling stays a host concern), and
// an adopted instance rides the exact same connect path — including the
// verdict — as a factory-built one.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createPrebuiltDriverFactory } from '../prebuilt-driver-factory.js';
import { DatasourceConnectionService } from '../datasource-connection-service.js';
import type { IDataDriver } from '@objectstack/spec/contracts';

// The fail-fast case below asserts the default (no-escape-hatch) verdict.
const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
let savedEnv: string | undefined;
beforeEach(() => { savedEnv = process.env[ENV]; delete process.env[ENV]; });
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV];
  else process.env[ENV] = savedEnv;
});

function stubDriver(name: string, opts: { failConnect?: boolean } = {}) {
  const calls: string[] = [];
  return {
    calls,
    name,
    async connect() {
      calls.push('connect');
      if (opts.failConnect) throw new Error('connect ECONNREFUSED 127.0.0.1:8080');
    },
    async disconnect() { calls.push('disconnect'); },
    async checkHealth() { calls.push('checkHealth'); return true; },
  };
}

describe('createPrebuiltDriverFactory — supports()', () => {
  it('matches only the configured driverId (case-insensitive)', () => {
    const f = createPrebuiltDriverFactory(stubDriver('turso'), { driverId: 'turso' });
    expect(f.supports('turso')).toBe(true);
    expect(f.supports('TURSO')).toBe(true);
    expect(f.supports('postgres')).toBe(false);
  });

  it('matches every id when no driverId is configured', () => {
    const f = createPrebuiltDriverFactory(stubDriver('anything'));
    expect(f.supports('turso')).toBe(true);
    expect(f.supports('whatever')).toBe(true);
  });

  it('defers non-matching ids to the fallback factory', () => {
    const fallback = { supports: (id: string) => id === 'sqlite', create: () => ({ driver: {} }) };
    const f = createPrebuiltDriverFactory(stubDriver('turso'), { driverId: 'turso', fallback });
    expect(f.supports('sqlite')).toBe(true);
    expect(f.supports('mysql')).toBe(false);
  });
});

describe('createPrebuiltDriverFactory — create()', () => {
  it('returns the SAME instance as the handle driver, with its lifecycle forwarded', async () => {
    const driver = stubDriver('turso');
    const f = createPrebuiltDriverFactory(driver, { driverId: 'turso' });
    const handle: any = await f.create({ driver: 'turso', config: {} });
    expect(handle.driver).toBe(driver);
    await handle.connect();
    await handle.checkHealth();
    await handle.disconnect();
    expect(driver.calls).toEqual(['connect', 'checkHealth', 'disconnect']);
  });

  it('dispatches a non-matching id to the fallback, and throws without one', async () => {
    const built = { driver: { name: 'sqlite' } };
    const fallback = { supports: (id: string) => id === 'sqlite', create: () => built };
    const f = createPrebuiltDriverFactory(stubDriver('turso'), { driverId: 'turso', fallback });
    expect(await f.create({ driver: 'sqlite', config: {} })).toBe(built);

    const noFallback = createPrebuiltDriverFactory(stubDriver('turso'), { driverId: 'turso' });
    expect(() => noFallback.create({ driver: 'sqlite', config: {} })).toThrow(/only supports driver 'turso'/);
  });
});

describe('createPrebuiltDriverFactory — through DatasourceConnectionService (the actual seam)', () => {
  function service(factory: ReturnType<typeof createPrebuiltDriverFactory>) {
    const drivers = new Map<string, unknown>();
    let defaultName: string | undefined;
    const svc = new DatasourceConnectionService({
      factory: () => factory,
      engine: () => ({
        registerDriver: (d: any, isDefault?: boolean) => {
          drivers.set(d.name, d);
          if (isDefault) defaultName = d.name;
        },
        // [#12010] The double deliberately stores MINIMAL stand-ins (a bare
        // `{ name }` is how these tests simulate an `onEnable`-registered
        // driver), while the derived seam member answers the contract's
        // `IDataDriver | undefined`. Narrowing on the way out keeps the double
        // loose where it is meant to be loose without re-widening the seam.
        getDriverByName: (n: string) => drivers.get(n) as IDataDriver | undefined,
        getDefaultDriverName: () => defaultName,
      }),
      logger: { warn() {} },
    });
    return { svc, drivers, getDefault: () => (defaultName ? drivers.get(defaultName) : undefined) };
  }

  it('adopts the instance as the DEFAULT driver under its natural name', async () => {
    const driver = stubDriver('turso');
    const { svc, getDefault } = service(createPrebuiltDriverFactory(driver, { driverId: 'turso' }));
    const result = await svc.connect(
      { name: 'default', driver: 'turso', config: {}, origin: 'code', bootCritical: true },
      { asDefault: true, context: { origin: 'code', trigger: 'declared-auto' } },
    );
    expect(result.status).toBe('connected');
    expect(getDefault()).toBe(driver); // identity — never a rebuilt copy
    expect(driver.name).toBe('turso'); // natural name kept (asDefault contract)
    expect(driver.calls).toContain('connect');
  });

  it("stamps the handle 'host'-owned, and kernel teardown leaves the adopted pool alone (#3993)", async () => {
    // The cloud constraint: the adopted instance's pool outlives this kernel
    // (proxy base / registry cache). disconnect() must clear the retained
    // verdict WITHOUT closing the pool.
    const driver = stubDriver('turso');
    const factory = createPrebuiltDriverFactory(driver, { driverId: 'turso' });
    const handle: any = await factory.create({ driver: 'turso', config: {} });
    expect(handle.ownership).toBe('host');

    const { svc } = service(factory);
    const result = await svc.connect(
      { name: 'default', driver: 'turso', config: {}, origin: 'code', bootCritical: true },
      { asDefault: true, context: { origin: 'code', trigger: 'declared-auto' } },
    );
    expect(result.ownership).toBe('host');
    expect(svc.getConnectionState('default')?.ownership).toBe('host');

    await svc.disconnect('default', { asDefault: true });
    expect(driver.calls).not.toContain('disconnect'); // the pool belongs to the host
    expect(svc.getConnectionState('default')).toBeUndefined(); // the verdict is gone
  });

  it('a FACTORY-built default IS disconnected at teardown — natural-name resolution via asDefault (#3993)', async () => {
    // Without ownership the instance was built for this connect: teardown may
    // close it. `asDefault` must resolve the driver under its natural name —
    // `getDriverByName('default')` can never find it (#3826).
    const driver = stubDriver('sql');
    const factoryBuilt = {
      supports: () => true,
      create: () => ({
        connect: async () => { await driver.connect(); },
        disconnect: async () => { await driver.disconnect(); },
        driver,
      }),
    };
    const { svc } = service(factoryBuilt as any);
    await svc.connect(
      { name: 'default', driver: 'sqlite', config: {}, origin: 'code', bootCritical: true },
      { asDefault: true, context: { origin: 'code', trigger: 'declared-auto' } },
    );
    await svc.disconnect('default', { asDefault: true });
    expect(driver.calls).toContain('disconnect');
    expect(svc.getConnectionState('default')).toBeUndefined();
  });

  it("disconnectAll() closes only what THIS service opened — 'connected' states, never 'already-registered' (#3993)", async () => {
    const opened = stubDriver('sql');
    const factoryBuilt = {
      supports: () => true,
      create: () => ({ disconnect: async () => { await opened.disconnect(); }, driver: opened }),
    };
    const { svc, drivers } = service(factoryBuilt as any);
    // A driver someone ELSE registered (the D8 onEnable escape hatch): the
    // idempotency guard records `already-registered` — not ours to close.
    const foreign = stubDriver('warehouse');
    drivers.set('warehouse', foreign);
    const pre = await svc.connect(
      { name: 'warehouse', driver: 'sqlite', config: {}, autoConnect: true },
      { context: { origin: 'code', trigger: 'declared-auto' } },
    );
    expect(pre.status).toBe('already-registered');
    // A pool this service opened.
    await svc.connect(
      { name: 'analytics', driver: 'sqlite', config: {}, autoConnect: true },
      { context: { origin: 'code', trigger: 'declared-auto' } },
    );

    await svc.disconnectAll();
    expect(opened.calls).toContain('disconnect');
    expect(foreign.calls).not.toContain('disconnect');
    expect(svc.getConnectionState('analytics')).toBeUndefined();
    expect(svc.getConnectionState('warehouse')).toBeDefined(); // untouched
  });

  it('a failing adopted instance takes the SAME bootCritical fail-fast verdict', async () => {
    const driver = stubDriver('turso', { failConnect: true });
    const { svc } = service(createPrebuiltDriverFactory(driver, { driverId: 'turso' }));
    const err = await svc
      .connect(
        { name: 'default', driver: 'turso', config: {}, origin: 'code', bootCritical: true },
        { asDefault: true, context: { origin: 'code', trigger: 'declared-auto' } },
      )
      .then(
        () => { throw new Error('connect() resolved but should have thrown'); },
        (e: unknown) => e as Error,
      );
    expect(err.message).toMatch(/boot-critical/);
    expect(err.message).toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
  });
});
