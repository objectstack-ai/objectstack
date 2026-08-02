// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3756: `init()` answers "could the drivers connect at boot";
// `checkDriversHealth()` answers "can they serve a query right now" — the
// question a readiness probe needs the moment the database restarts or fails
// over. The bound on each probe is load-bearing: `checkHealth()` swallows its
// own errors, but on a dead pool it does not return at all.

import { describe, it, expect } from 'vitest';
import { ObjectQL } from './engine.js';

function makeDriver(name: string, checkHealth?: () => Promise<boolean>) {
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    async connect() {}, async disconnect() {},
    async execute() { return null; },
    async find() { return []; },
    async findOne() { return null; },
    async create(_o: string, data: Record<string, unknown>) { return { id: 'r_1', ...data }; },
    async update(_o: string, id: string, data: Record<string, unknown>) { return { ...data, id }; },
    async delete() { return true; },
    async count() { return 0; },
    async bulkCreate() { return []; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  };
  if (checkHealth) driver.checkHealth = checkHealth;
  return driver;
}

const healthy = (name: string) => makeDriver(name, async () => true);
const unhealthy = (name: string) => makeDriver(name, async () => false);
const throwing = (name: string, msg: string) =>
  makeDriver(name, async () => { throw new Error(msg); });
/** Models a dead knex pool: `SELECT 1` neither resolves nor rejects. */
const hanging = (name: string) => makeDriver(name, () => new Promise<boolean>(() => {}));

function engineWith(...drivers: any[]) {
  const engine = new ObjectQL({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as any);
  drivers.forEach((d, i) => engine.registerDriver(d, i === 0));
  return engine;
}

describe('ObjectQL.checkDriversHealth() (framework#3756)', () => {
  it('reports every registered driver healthy when all pings succeed', async () => {
    const engine = engineWith(healthy('sql'), healthy('mongodb'));

    const results = await engine.checkDriversHealth();

    expect(results).toEqual([
      { driverName: 'sql', healthy: true },
      { driverName: 'mongodb', healthy: true },
    ]);
  });

  it('flags a driver whose checkHealth() returns false, naming it', async () => {
    const engine = engineWith(healthy('sql'), unhealthy('mongodb'));

    const results = await engine.checkDriversHealth();

    expect(results.filter(r => !r.healthy).map(r => r.driverName)).toEqual(['mongodb']);
    expect(results.find(r => r.driverName === 'mongodb')?.error).toContain('returned false');
  });

  it('flags a driver whose checkHealth() throws, carrying the message', async () => {
    const engine = engineWith(throwing('sql', 'ECONNRESET'));

    const [result] = await engine.checkDriversHealth();

    expect(result).toMatchObject({ driverName: 'sql', healthy: false });
    expect(result.error).toContain('ECONNRESET');
  });

  it('times out a hanging probe instead of awaiting it — a dead pool never settles', async () => {
    const engine = engineWith(hanging('sql'));

    const started = Date.now();
    const [result] = await engine.checkDriversHealth({ timeoutMs: 50 });
    const elapsed = Date.now() - started;

    expect(result).toMatchObject({ driverName: 'sql', healthy: false });
    expect(result.error).toContain('did not settle');
    expect(elapsed).toBeLessThan(1_000); // would be knex's 60s acquire timeout
  });

  it('does not let one hanging driver hide a healthy one — probes settle independently', async () => {
    const engine = engineWith(hanging('sql'), healthy('memory'));

    const results = await engine.checkDriversHealth({ timeoutMs: 50 });

    expect(results.find(r => r.driverName === 'memory')?.healthy).toBe(true);
    expect(results.find(r => r.driverName === 'sql')?.healthy).toBe(false);
  });

  it('assumes a driver without checkHealth() is healthy rather than taking a replica out', async () => {
    const engine = engineWith(makeDriver('legacy'));

    const [result] = await engine.checkDriversHealth();

    expect(result).toEqual({ driverName: 'legacy', healthy: true, skipped: true });
  });

  it('returns an empty verdict when no driver is registered', async () => {
    const engine = engineWith();

    await expect(engine.checkDriversHealth()).resolves.toEqual([]);
  });
});
