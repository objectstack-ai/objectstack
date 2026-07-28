// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3828: `getDriver()` answered four different situations with one
// sentence — `Datasource 'x' is not registered.` A policy denial, a boot
// connect failure the operator waved through, a misspelled name, and an
// `active: false` row all read identically, so the reader goes hunting for a
// typo that isn't there. The connection layer knows which one it is; the engine
// just had no way to be told.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';
import { DatasourceUnavailableError } from './driver-connect-errors.js';

/** An engine holding one object bound to a datasource that has no driver. */
function engineWithBoundObject() {
  const engine = new ObjectQL({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as any);
  engine.registerObject({
    name: 'visit',
    label: 'Visit',
    datasource: 'analytics',
    fields: { id: { type: 'text' } },
  } as any);
  return engine;
}

/** Query the bound object and hand back whatever it threw. */
async function queryError(engine: ObjectQL): Promise<any> {
  return engine.find('visit').then(
    () => { throw new Error('find() resolved but should have thrown'); },
    (e: unknown) => e,
  );
}

describe('ObjectQL.getDriver — a declared datasource with no driver (framework#3828)', () => {
  it('keeps the original message when nothing ever tried to connect the name', async () => {
    // The authoring-bug case: a typo, or a datasource nobody declared. There is
    // genuinely nothing to add, so the wording is unchanged.
    const err = await queryError(engineWithBoundObject());
    expect(err.message).toContain("Datasource 'analytics'");
    expect(err.message).toContain('is not registered');
    expect(err).not.toBeInstanceOf(DatasourceUnavailableError);
  });

  it('says the policy refused it, when the connection layer recorded a denial', async () => {
    const engine = engineWithBoundObject();
    engine.markDatasourceUnavailable({ name: 'analytics', kind: 'blocked' });

    const err = await queryError(engine);
    expect(err).toBeInstanceOf(DatasourceUnavailableError);
    expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
    expect(err.datasource).toBe('analytics');
    expect(err.objectName).toBe('visit');
    expect(err.kind).toBe('blocked');
    expect(err.message).toContain('connect policy refused it');
    expect(err.message).not.toContain('is not registered');
  });

  it('appends the host-authored publicReason when one was opted into', async () => {
    const engine = engineWithBoundObject();
    engine.markDatasourceUnavailable({
      name: 'analytics',
      kind: 'blocked',
      publicDetail: 'External datasources require the Scale plan.',
    });
    expect((await queryError(engine)).message).toContain('require the Scale plan');
  });

  it('says the connect failed and a restart is needed, for the degraded-boot case', async () => {
    const engine = engineWithBoundObject();
    engine.markDatasourceUnavailable({ name: 'analytics', kind: 'failed' });

    const err = await queryError(engine);
    expect(err.kind).toBe('failed');
    expect(err.message).toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE');
    // The durable fact: the client may reconnect, but nothing re-runs the
    // connect, so waiting it out does not help (#3759).
    expect(err.message).toContain('restarted');
  });

  it('never carries the underlying cause — that is what leaks hosts and DSNs', async () => {
    const engine = engineWithBoundObject();
    // The connection layer deliberately hands over only the class, so there is
    // no path for a cause to reach here even if a caller wanted one.
    engine.markDatasourceUnavailable({ name: 'analytics', kind: 'failed' });
    const err = await queryError(engine);
    expect(err.message).not.toMatch(/ECONNREFUSED|\d+\.\d+\.\d+\.\d+|postgres:\/\//);
    expect(err.message).toContain('startup logs');
  });

  it('clears the explanation once the datasource connects', async () => {
    const engine = engineWithBoundObject();
    engine.markDatasourceUnavailable({ name: 'analytics', kind: 'failed' });
    expect(engine.listUnavailableDatasources()).toEqual([{ name: 'analytics', kind: 'failed' }]);

    engine.clearDatasourceUnavailable('analytics');
    expect(engine.listUnavailableDatasources()).toEqual([]);
    // …and the message falls back to the undeclared-name wording.
    expect((await queryError(engine)).message).toContain('is not registered');
  });

  it('lists unavailable datasources — which checkDriversHealth structurally cannot', async () => {
    const engine = engineWithBoundObject();
    engine.markDatasourceUnavailable({ name: 'analytics', kind: 'failed' });
    engine.markDatasourceUnavailable({ name: 'billing', kind: 'blocked', publicDetail: 'nope' });

    // A datasource that never connected was never registered as a driver, so
    // the health probe cannot report it at all (framework#3827).
    expect(await engine.checkDriversHealth()).toEqual([]);
    expect(engine.listUnavailableDatasources()).toEqual([
      { name: 'analytics', kind: 'failed' },
      { name: 'billing', kind: 'blocked', publicDetail: 'nope' },
    ]);
  });
});
