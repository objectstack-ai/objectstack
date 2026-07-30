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
        getDriverByName: (n: string) => drivers.get(n),
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
