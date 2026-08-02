// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3741: `ObjectQL.init()` used to try/catch every driver's connect()
// and boot anyway, so a server that could not reach its database still reported
// itself started (and then 500'd every request), and a driver had no way to
// veto boot — any fatal startup check thrown from connect() was downgraded to a
// runtime error. init() now fails fast; the lenient path is opt-in via
// OS_ALLOW_DRIVER_CONNECT_FAILURE.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectLogger } from '@objectstack/core';
import { ObjectQL } from './engine.js';
import { DriverConnectError } from './driver-connect-errors.js';

/** Minimal driver stub — only `connect` behaviour matters for init(). */
function makeDriver(name: string, connect: () => Promise<void>) {
  let connected = false;
  const driver: any = {
    name,
    version: '0.0.0',
    supports: {},
    get connected() { return connected; },
    async connect() { await connect(); connected = true; },
    async disconnect() { connected = false; },
    async checkHealth() { return connected; },
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
  return driver;
}

const ok = (name: string) => makeDriver(name, async () => {});
const fails = (name: string, message: string) =>
  makeDriver(name, async () => { throw new Error(message); });

describe('ObjectQL.init() — driver connect fail-fast (framework#3741)', () => {
  const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
  let saved: string | undefined;

  beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('throws DriverConnectError when the only driver cannot connect', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(fails('sql', 'connect ECONNREFUSED 127.0.0.1:5432'), true);

    await expect(engine.init()).rejects.toBeInstanceOf(DriverConnectError);
  });

  it('names every failed driver and its cause in the message (the CLI prints message only)', async () => {
    const engine = new ObjectQL();
    engine.registerDriver(fails('sql', 'connect ECONNREFUSED 127.0.0.1:5432'), true);
    engine.registerDriver(ok('memory'));
    engine.registerDriver(fails('mongodb', 'multi-tenant mode is not supported'));

    const err = await engine.init().then(
      () => { throw new Error('init() resolved but should have thrown'); },
      (e: unknown) => e as DriverConnectError,
    );

    expect(err).toBeInstanceOf(DriverConnectError);
    expect(err.code).toBe('ERR_DRIVER_CONNECT');
    expect(err.failedDrivers).toEqual(['sql', 'mongodb']);
    expect(err.totalDrivers).toBe(3);
    expect(err.message).toContain('2 of 3');
    expect(err.message).toContain('sql: connect ECONNREFUSED 127.0.0.1:5432');
    expect(err.message).toContain('mongodb: multi-tenant mode is not supported');
    expect(err.message).toContain('OS_ALLOW_DRIVER_CONNECT_FAILURE=1');
    // First failure is reachable as `cause` for DEBUG / structured logging.
    expect((err.cause as Error)?.message).toBe('connect ECONNREFUSED 127.0.0.1:5432');
  });

  it('lets a driver veto boot by throwing a semantic (non-network) error from connect()', async () => {
    // The #3734 case: driver-mongodb refuses multi-tenant mode. Before this fix
    // the veto was caught and downgraded, which is why the guard had to live in
    // the constructor.
    const engine = new ObjectQL();
    engine.registerDriver(
      fails('mongodb', 'MongoDriver refuses to start: OS_TENANCY_POSTURE=isolated is not supported'),
      true,
    );

    await expect(engine.init()).rejects.toThrow(/refuses to start/);
  });

  it('still connects every healthy driver and resolves when none fail', async () => {
    const engine = new ObjectQL();
    const a = ok('sql');
    const b = ok('memory');
    engine.registerDriver(a, true);
    engine.registerDriver(b);

    await expect(engine.init()).resolves.toBeUndefined();
    expect(a.connected).toBe(true);
    expect(b.connected).toBe(true);
  });

  it('attempts every driver before throwing (does not stop at the first failure)', async () => {
    const engine = new ObjectQL();
    const healthy = ok('memory');
    engine.registerDriver(fails('sql', 'down'), true);
    engine.registerDriver(healthy);

    await expect(engine.init()).rejects.toBeInstanceOf(DriverConnectError);
    expect(healthy.connected).toBe(true);
  });

  it('boots degraded when OS_ALLOW_DRIVER_CONNECT_FAILURE opts in, and says so loudly', async () => {
    process.env[ENV] = '1';
    const warnings: string[] = [];
    const engine = new ObjectQL({
      logger: {
        debug() {}, info() {}, error() {},
        warn: (msg: string) => { warnings.push(msg); },
      },
    } as any);
    engine.registerDriver(fails('sql', 'down'), true);

    await expect(engine.init()).resolves.toBeUndefined();
    const warned = warnings.join('\n');
    expect(warned).toContain('DEGRADED BOOT');
    // The durable consequence is the SKIPPED SCHEMA SYNC, not a dead connection:
    // the client reconnects on its own, but nothing re-runs the DDL (#3759).
    expect(warned).toContain('SKIPPED FOR GOOD');
    expect(warned).toContain('sql');
  });

  it('repeats the degraded banner on stderr, which the operator log level cannot filter away', async () => {
    // The banner's `logger.warn` is dropped OUTRIGHT at `error`/`fatal`/`silent`
    // — `Logger.write()` returns before touching a stream — and a production
    // host at `error` is exactly the deployment this flag exists for. The stderr
    // copy is what survives that.
    //
    // This used to be justified by `os serve`'s boot-quiet stdout capture
    // instead; that swallowed the banner at EVERY level until framework#4012
    // fixed it. Pinning the level filter keeps the test tied to the reason that
    // is still true.
    process.env[ENV] = '1';
    const written: string[] = [];
    const onStdout: string[] = [];
    const realErrWrite = process.stderr.write;
    const realOutWrite = process.stdout.write;
    (process.stderr as { write: unknown }).write = (chunk: any) => {
      written.push(String(chunk));
      return true;
    };
    (process.stdout as { write: unknown }).write = (chunk: any) => {
      onStdout.push(String(chunk));
      return true;
    };
    try {
      const engine = new ObjectQL({
        // A REAL logger, silenced the way a production host silences it.
        logger: new ObjectLogger({ level: 'error' }),
      } as any);
      engine.registerDriver(fails('sql', 'down'), true);
      await engine.init();
    } finally {
      (process.stderr as { write: unknown }).write = realErrWrite;
      (process.stdout as { write: unknown }).write = realOutWrite;
    }

    expect(written.join('')).toContain('DEGRADED BOOT');
    // The half that makes this a real pin: at `error` the logger emitted
    // NOTHING, so stderr is the only channel that carried the banner. Drop the
    // helper and this deployment goes silent.
    expect(onStdout.join('')).not.toContain('DEGRADED BOOT');
  });

  it('treats a falsy opt-in value as off — still fail-fast', async () => {
    process.env[ENV] = 'false';
    const engine = new ObjectQL();
    engine.registerDriver(fails('sql', 'down'), true);

    await expect(engine.init()).rejects.toBeInstanceOf(DriverConnectError);
  });
});
