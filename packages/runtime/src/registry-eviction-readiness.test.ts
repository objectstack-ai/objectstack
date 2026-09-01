// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13578 — the BEHAVIOURAL pin: after a datasource is deleted, `GET
// /api/v1/ready` stops naming its driver.
//
// The card was reported as an operational fact, not a structural one — "the
// admin-door list is empty on every replica … but `/ready` still names that
// datasource's driver … only a process restart clears it". A pin on
// `unregisterDriver()` alone would not have caught it: the defect was that
// nothing on the delete path CALLED the registry, and the probe reads the
// registry through two packages' worth of indirection.
//
// So this suite deliberately uses no doubles for the three things under test:
//
//   - the REAL `ObjectQL` engine, which owns the driver registry;
//   - the REAL `DatasourceConnectionService.disconnect()`, which is the funnel
//     `DELETE /api/v1/datasources/:name` reaches via
//     `removeDatasource` → `tryUnregisterPool` → `unregisterPool`;
//   - the REAL `HttpDispatcher` `/ready` handler, which is the door the
//     operator actually watched stay 503.
//
// `packages/runtime` is the only package that depends on all three, which is
// why the pin lives here and not beside either half.
//
// ⛔ The probe half is not re-pinned here — `http-dispatcher.ready.test.ts`
// owns the #13408 drain semantics, and this suite must not become a second
// opinion on them. What it pins is only that eviction reaches the probe.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { DatasourceConnectionService } from '@objectstack/service-datasource';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { HttpDispatcher, type HttpDispatcherResult } from './http-dispatcher.js';

/** See the sibling suites: annotated so the contract, not the call site, fails first. */
const driver = (name: string, opts: { healthy?: boolean } = {}): IDataDriver => ({
  name,
  version: '1.0.0',
  supports: {},
  connect: async () => {},
  disconnect: async () => {},
  checkHealth: async () => opts.healthy !== false,
  find: async () => [],
  findOne: async () => null,
  create: async (_o, data) => ({ id: '1', ...data }),
  update: async (_o, id, data) => ({ id, ...data }),
  upsert: async (_o, data) => ({ id: '1', ...data }),
  delete: async () => true,
  count: async () => 0,
  bulkCreate: async () => [],
  bulkUpdate: async () => [],
  bulkDelete: async () => {},
  execute: async () => null,
  beginTransaction: async () => ({}),
  commit: async () => {},
  rollback: async () => {},
  syncSchema: async () => {},
  dropTable: async () => {},
});

function newEngine(): ObjectQL {
  return new ObjectQL({ logger: { debug() {}, info() {}, warn() {}, error() {} } } as any);
}

function kernel(engine: unknown): any {
  return {
    getState: () => 'running',
    getService: (name: string) => (name === 'data' ? engine : undefined),
    getServiceAsync: async () => undefined,
  };
}

/**
 * `HttpDispatcherResult.response` is optional, so every read is a
 * `possibly undefined` in a type-checked program — and this package's test
 * layer IS type-checked by `check:type-check-debt`. Narrowed loudly, the shape
 * lifted from `http-dispatcher.ready.test.ts` rather than invented again.
 */
function responseOf(res: HttpDispatcherResult): NonNullable<HttpDispatcherResult['response']> {
  const { response } = res;
  if (!response) throw new Error('GET /ready answered no response at all');
  return response;
}

/** What `/ready` says right now: the status, and every driver name it mentions. */
async function ready(engine: unknown): Promise<{ status: number; named: string[] }> {
  const res = await new HttpDispatcher(kernel(engine)).dispatch('GET', '/ready', undefined, undefined, {} as any);
  const response = responseOf(res);
  const body: any = response.body;
  // Both shapes are read, deliberately: an unhealthy driver is named in
  // `details.drivers` on the 503 and in `data.degraded.drivers` on the #13408
  // secondary-degraded 200. The card's symptom is "still NAMES it", so the
  // assertion must not be able to pass merely because the envelope changed.
  const named = [
    ...(body?.error?.details?.drivers ?? body?.details?.drivers ?? []),
    ...(body?.data?.degraded?.drivers ?? []),
  ];
  return { status: response.status, named: [...named].map(String).sort() };
}

/** The delete funnel, wired exactly as `datasource-admin-plugin` wires it. */
function connectionServiceFor(engine: ObjectQL): DatasourceConnectionService {
  return new DatasourceConnectionService({
    factory: () => undefined,
    engine: () => engine,
  });
}

describe('#13578 — DELETE of a datasource stops /ready naming its driver', () => {
  it('the reported defect, end to end: after the delete funnel runs, /ready recovers without a restart', async () => {
    const engine = newEngine();
    engine.registerDriver(driver('postgres_primary'), true);
    engine.registerDriver(driver('stuck_mongo', { healthy: false }));

    // The state the operator observed: the app is healthy, one datasource's
    // driver is stuck, and the probe names it.
    const before = await ready(engine);
    expect(before.status).toBe(503);
    expect(before.named).toContain('stuck_mongo');

    // `DELETE /api/v1/datasources/stuck_mongo` reaches exactly this call.
    await connectionServiceFor(engine).disconnect('stuck_mongo');

    // The recovery the card says only a process restart could produce.
    const after = await ready(engine);
    expect(after.named).not.toContain('stuck_mongo');
    expect(after.status).toBe(200);
  });

  it('POSITIVE CONTROL — a second stuck datasource is still named, and the healthy one survives', async () => {
    // Without this, a fix that emptied the registry (or that made `/ready`
    // stop reporting drivers at all) would pass the pin above. Deleting ONE
    // datasource must recover exactly that one.
    const engine = newEngine();
    engine.registerDriver(driver('postgres_primary'), true);
    engine.registerDriver(driver('stuck_a', { healthy: false }));
    engine.registerDriver(driver('stuck_b', { healthy: false }));

    expect((await ready(engine)).named).toEqual(['stuck_a', 'stuck_b']);

    await connectionServiceFor(engine).disconnect('stuck_a');

    const after = await ready(engine);
    expect(after.named).toEqual(['stuck_b']);
    expect(after.status).toBe(503);
    // The untouched datasources are still routable — eviction is not a reset.
    expect(engine.getDriverByName('postgres_primary')).toBeDefined();
    expect(engine.getDriverByName('stuck_b')).toBeDefined();
  });

  it('the pool is CLOSED as well as evicted — the delete does not leak the socket', async () => {
    // Eviction must not become a shortcut past teardown: `disconnect()`
    // resolves the driver out of the registry, so an eviction ordered before
    // the close would drop the only handle that could close it.
    let closed = false;
    const engine = newEngine();
    engine.registerDriver(driver('primary'), true);
    engine.registerDriver({
      ...driver('leaky', { healthy: false }),
      disconnect: async () => { closed = true; },
    });

    await connectionServiceFor(engine).disconnect('leaky');

    expect(closed).toBe(true);
    expect(engine.getDriverByName('leaky')).toBeUndefined();
  });

  it('deleting the DEFAULT datasource evicts it under its NATURAL name', async () => {
    // #3826: the default driver is registered under its own name, never under
    // the literal 'default'. An eviction keyed on the datasource name would
    // remove nothing here and report success — the exit-0-did-nothing shape.
    const engine = newEngine();
    engine.registerDriver(driver('sqlite_main', { healthy: false }), true);

    expect((await ready(engine)).named).toContain('sqlite_main');

    await connectionServiceFor(engine).disconnect('default', { asDefault: true });

    expect((await ready(engine)).named).not.toContain('sqlite_main');
    expect(engine.getDriverByName('sqlite_main')).toBeUndefined();
    expect(engine.getDefaultDriverName()).toBeUndefined();
  });
});
