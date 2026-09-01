// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13578 — the registry's missing removal door.
//
// The observed defect was operational: `DELETE /api/v1/datasources/:name`
// emptied the admin door on every replica while `GET /api/v1/ready` kept naming
// the deleted datasource's driver, recoverable only by restarting every
// process. The cause is here rather than at the probe — the driver registry had
// a `registerDriver` and no counterpart, so nothing could ever leave it.
//
// These pins hold the PRIMITIVE's invariants. The behavioural pin that the
// readiness probe actually stops naming an evicted datasource — driven through
// the real delete funnel — is
// `packages/runtime/src/registry-eviction-readiness.test.ts`, because only that
// package sees the engine, the connection service and the dispatcher at once.

import { describe, it, expect } from 'vitest';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { ObjectQL } from './engine.js';

/**
 * A registrable driver double, annotated `IDataDriver` for the reason the
 * sibling `engine-primary-datasource.test.ts` fixture states: an un-annotated
 * literal is checked only at the call site and drifts silently as the contract
 * grows.
 */
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

function registerSys(engine: ObjectQL, name: string, extra: Record<string, unknown> = {}): void {
  engine.registry.registerObject(
    { name, fields: { title: { type: 'text' } }, ...extra } as any,
    'platform-objects',
    undefined,
    'own',
  );
}

const healthNames = async (engine: ObjectQL) =>
  (await engine.checkDriversHealth()).map((r) => r.driverName).sort();

describe('#13578 — ObjectQL.unregisterDriver(), the registry\'s removal door', () => {
  it('the entry the readiness probe reads is actually gone', async () => {
    // The defect in one assertion: before this method existed, there was no
    // call that could make `checkDriversHealth()` stop reporting a name.
    const engine = newEngine();
    engine.registerDriver(driver('primary'), true);
    engine.registerDriver(driver('stuck', { healthy: false }));

    expect(await healthNames(engine)).toEqual(['primary', 'stuck']);

    expect(engine.unregisterDriver('stuck')).toBe(true);

    expect(await healthNames(engine)).toEqual(['primary']);
    expect(engine.getDriverByName('stuck')).toBeUndefined();
  });

  it('evicts ONLY the named driver — the sibling entries are untouched', async () => {
    // The positive control. An eviction that cleared the Map, or that keyed off
    // the wrong name, would pass the assertion above and fail this one.
    const engine = newEngine();
    engine.registerDriver(driver('keep_a'), true);
    engine.registerDriver(driver('drop'));
    engine.registerDriver(driver('keep_b'));

    engine.unregisterDriver('drop');

    expect(await healthNames(engine)).toEqual(['keep_a', 'keep_b']);
    expect(engine.getDriverByName('keep_a')).toBeDefined();
    expect(engine.getDriverByName('keep_b')).toBeDefined();
  });

  it('returns false for a name the registry never held — a no-op is distinguishable', () => {
    // An idempotent caller (a retried DELETE, a teardown sweep after a partial
    // one) has to be able to tell "removed" from "there was nothing there";
    // a `void` return would have made both look identical.
    const engine = newEngine();
    engine.registerDriver(driver('only'), true);

    expect(engine.unregisterDriver('never_registered')).toBe(false);
    expect(engine.getDriverByName('only')).toBeDefined();
  });

  describe('the invariants a caller could not have maintained itself', () => {
    it('evicting the DEFAULT clears the default NAME, so nothing answers with a dead one', () => {
      // `defaultDriver` is a name, not a reference. Deleting the Map entry
      // alone would leave `getDefaultDriverName()` answering 'main' with
      // nothing behind it — a worse state than the leak, because callers treat
      // that answer as a live routing target.
      const engine = newEngine();
      engine.registerDriver(driver('main'), true);
      expect(engine.getDefaultDriverName()).toBe('main');

      engine.unregisterDriver('main');

      expect(engine.getDefaultDriverName()).toBeUndefined();
    });

    it('after evicting the default, the #13408 primary verdict reads "cannot tell", never a name', () => {
      // `engine-primary-datasource.test.ts` wrote this requirement down before
      // eviction existed: "an eviction that removes the default is exactly how
      // a registered system object stops being bound anywhere. When that lands,
      // this must already read as 'cannot tell', not as a name." This is that
      // reading, now driven by the real eviction rather than by an engine that
      // never had a driver.
      const engine = newEngine();
      engine.registerDriver(driver('sqlite'), true);
      registerSys(engine, 'sys_user');
      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: true,
        datasource: 'sqlite',
        witnesses: 1,
      });

      engine.unregisterDriver('sqlite');

      // Unresolved ⇒ the readiness caller drains, which is the ruled
      // fail-toward-draining direction. ⛔ Never `{ resolved: true, datasource:
      // 'sqlite' }` read off a stale default.
      expect(engine.resolvePrimaryDatasource()).toEqual({
        resolved: false,
        reason: 'system-object-unbound',
      });
    });

    it('the datasource DEF goes with the driver — it has no removal door of its own', () => {
      // `registerDatasourceDef` is public and there is no `unregisterDatasourceDef`,
      // so a def outliving its driver is unreachable state: the write gate keeps
      // judging writes against `external.allowWrites` for a datasource that no
      // longer exists.
      const engine = newEngine();
      engine.registerDriver(driver('warehouse'));
      engine.registerDatasourceDef({
        name: 'warehouse',
        schemaMode: 'external',
        external: { allowWrites: false },
      } as any);
      expect(engine.listDatasourceDefs().map((d) => d.name)).toContain('warehouse');

      engine.unregisterDriver('warehouse');

      expect(engine.listDatasourceDefs().map((d) => d.name)).not.toContain('warehouse');
    });

    it('drops a def even when no driver was ever registered under the name', () => {
      // A datasource that never connected leaves a def and no driver. Keying
      // the def removal off "a driver was removed" would strand exactly the
      // rows a FAILED datasource leaves behind — the population this card is
      // about.
      const engine = newEngine();
      engine.registerDatasourceDef({ name: 'never_connected', schemaMode: 'external' } as any);
      expect(engine.listDatasourceDefs().map((d) => d.name)).toContain('never_connected');

      expect(engine.unregisterDriver('never_connected')).toBe(false);

      expect(engine.listDatasourceDefs().map((d) => d.name)).not.toContain('never_connected');
    });
  });

  describe('teardown is an eviction path too', () => {
    it('destroy() leaves the registry EMPTY, not merely disconnected', async () => {
      // Before #13578 `destroy()` disconnected every driver and left them all
      // registered, so a destroyed engine still answered `checkDriversHealth()`
      // by pinging pools it had just closed.
      const engine = newEngine();
      engine.registerDriver(driver('a'), true);
      engine.registerDriver(driver('b'));
      expect(await healthNames(engine)).toEqual(['a', 'b']);

      await engine.destroy();

      expect(await healthNames(engine)).toEqual([]);
      expect(engine.getDefaultDriverName()).toBeUndefined();
    });

    it('destroy() still disconnects every driver before evicting it', async () => {
      // The ordering guard: evicting first would drop the only handle able to
      // close the pool, turning a leak of registry entries into a leak of
      // sockets. Eviction must not be a shortcut past teardown.
      const closed: string[] = [];
      const engine = newEngine();
      for (const name of ['a', 'b']) {
        engine.registerDriver({ ...driver(name), disconnect: async () => { closed.push(name); } });
      }

      await engine.destroy();

      expect(closed.sort()).toEqual(['a', 'b']);
    });
  });
});
