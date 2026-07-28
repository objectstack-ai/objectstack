// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// framework#3826 — DRIFT GUARD for the two "a datasource would not connect"
// implementations.
//
// ADR-0062 D1 asks for exactly one "definition → live driver" path. The
// *construction* half converged (both build through the shared datasource driver
// factory), but the *connect + failure verdict* half did not:
//
//   - the `default` driver is registered as a `driver.*` kernel service and
//     connected by `ObjectQLEngine.init()`     → DriverConnectError (#3741)
//   - declared datasources are connected by
//     `DatasourceConnectionService.connect()`  → handleFailure  (#3758)
//
// They agree today only because two separate pieces of code were each written
// correctly — and the last time they disagreed, the gap survived three months
// and a second bug report (#3741 fixed one layer, #3758 was the other). Until
// the paths are actually merged, this test is what notices a divergence:
// it pins the operator-visible contract both of them owe.
//
// This lives in `runtime` because it is the only package that depends on both.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { DatasourceConnectionService } from '@objectstack/service-datasource';

const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';

/** Minimal driver stub whose `connect()` rejects — the engine-side failure. */
function failingDriver(name: string) {
  return {
    name,
    version: '0.0.0',
    supports: {},
    connected: false,
    async connect() { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); },
    async disconnect() {},
    async checkHealth() { return false; },
    async execute() { return null; },
    async find() { return []; },
    findStream() { throw new Error('ni'); },
    async findOne() { return null; },
    async create(_o: string, d: Record<string, unknown>) { return { id: 'r_1', ...d }; },
    async update(_o: string, id: string, d: Record<string, unknown>) { return { ...d, id }; },
    async delete() { return true; },
    async count() { return 0; },
    async bulkCreate() { return []; },
    async bulkUpdate() { return []; },
    async bulkDelete() {},
    async beginTransaction() { return { __trx: true, commit: async () => {}, rollback: async () => {} }; },
    async commit() {}, async rollback() {},
  } as any;
}

/** The engine path: one boot-registered driver that cannot connect. */
async function bootEngine(): Promise<Error | undefined> {
  const engine = new ObjectQL({
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  } as any);
  engine.registerDriver(failingDriver('sql'), true);
  return engine.init().then(() => undefined, (e: Error) => e);
}

/**
 * The datasource path: a declared datasource with an object bound to it that
 * cannot connect — the #3758 shape, i.e. the one with no fallback, so the two
 * paths are being asked the same question ("a datasource I need is down").
 */
async function bootDatasource(): Promise<Error | undefined> {
  const drivers = new Map<string, unknown>();
  const service = new DatasourceConnectionService({
    factory: () => ({
      supports: () => true,
      create: async () => ({
        driver: { name: 'd' },
        connect: async () => { throw new Error('connect ECONNREFUSED 127.0.0.1:5432'); },
      }),
    }) as any,
    engine: () => ({
      registerDriver: (d: any) => drivers.set(d.name, d),
      getDriverByName: (n: string) => drivers.get(n),
    }),
    logger: { warn() {} },
  });
  return service
    .connect(
      { name: 'analytics', driver: 'sqlite', schemaMode: 'managed', config: {} },
      { objects: ['visit'], context: { trigger: 'declared-auto' } },
    )
    .then(() => undefined, (e: Error) => e);
}

const PATHS: Array<{ label: string; boot: () => Promise<Error | undefined> }> = [
  { label: 'ObjectQLEngine.init()', boot: bootEngine },
  { label: 'DatasourceConnectionService.connect()', boot: bootDatasource },
];

describe('degraded-boot parity between the two connect paths (framework#3826)', () => {
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  for (const { label, boot } of PATHS) {
    describe(label, () => {
      it('refuses the boot by default', async () => {
        expect(await boot()).toBeInstanceOf(Error);
      });

      // The flag is the operator's single lever over both paths. If either one
      // ever re-reads the env inline instead of going through
      // `resolveAllowDriverConnectFailure()`, these two cases diverge — which is
      // precisely the drift this file exists to catch.
      for (const truthy of ['1', 'true', 'on', 'yes', 'YES', ' True ']) {
        it(`boots degraded when ${ENV}=${JSON.stringify(truthy)}`, async () => {
          process.env[ENV] = truthy;
          expect(await boot()).toBeUndefined();
        });
      }

      for (const falsy of ['0', 'false', 'off', 'no', '']) {
        it(`still refuses the boot when ${ENV}=${JSON.stringify(falsy)}`, async () => {
          process.env[ENV] = falsy;
          expect(await boot()).toBeInstanceOf(Error);
        });
      }

      it('announces the degraded state on stderr, which `os serve` boot-quiet cannot swallow', async () => {
        process.env[ENV] = '1';
        const written: string[] = [];
        const realWrite = process.stderr.write;
        (process.stderr as { write: unknown }).write = (chunk: any) => {
          written.push(String(chunk));
          return true;
        };
        try {
          await boot();
        } finally {
          (process.stderr as { write: unknown }).write = realWrite;
        }
        expect(written.join('')).toContain('DEGRADED BOOT');
      });
    });
  }
});
