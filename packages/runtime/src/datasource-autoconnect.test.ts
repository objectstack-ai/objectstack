// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0062 Phase 1 acceptance (D1/D2/D5): a stack that only *declares* an
// external datasource — with NO `onEnable` driver wiring — auto-connects it to
// a live ObjectQL driver and its federated objects become queryable, while a
// managed + unrouted datasource stays metadata-only (existing apps unchanged).
//
// This boots the host-config shape (instantiated plugins, no MetadataPlugin —
// the same shape `examples/app-showcase` runs under `os dev`) with the REAL
// driver factory (`createDefaultDatasourceDriverFactory`) building an in-memory
// driver, so the full AppPlugin → `datasource-connection` → engine path runs
// without any native driver dependency.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Runtime } from './runtime.js';
import { DriverPlugin } from './driver-plugin.js';
import { AppPlugin } from './app-plugin.js';
import type { DatasourceConnectPolicy } from '@objectstack/service-datasource';

const BOOT_TIMEOUT = 60_000;

// One external datasource (auto-connect target) + one managed, unrouted
// datasource (must stay metadata-only). NO `onEnable` anywhere.
function artifact() {
  return {
    manifest: { id: 'com.test.ds-autoconnect', name: 'DS AutoConnect', version: '1.0.0' },
    objects: [
      // Federated object bound to the external datasource (ADR-0015).
      {
        name: 'ext_note',
        label: 'External Note',
        datasource: 'autoconn_ext',
        external: {},
        fields: { id: { type: 'text' }, title: { type: 'text' } },
      },
      // A normal object on the default datasource.
      { name: 'note', label: 'Note', fields: { title: { type: 'text' } } },
    ],
    datasources: [
      {
        name: 'autoconn_ext',
        label: 'External (in-memory)',
        driver: 'memory',
        schemaMode: 'external',
        origin: 'code',
        config: {},
        external: { allowWrites: false, validation: { onMismatch: 'warn', checkOnBoot: false } },
        active: true,
      },
      // Managed + unrouted: nothing binds to it, not external, no autoConnect.
      // Mirrors app-crm's decorative `:memory:` datasources — must NOT connect.
      {
        name: 'decorative',
        label: 'Decorative (unrouted)',
        driver: 'memory',
        schemaMode: 'managed',
        origin: 'code',
        config: {},
        active: true,
      },
    ],
  };
}

async function boot(opts: { connectPolicy?: DatasourceConnectPolicy } = {}) {
  const { ObjectQLPlugin } = await import('@objectstack/objectql');
  const { InMemoryDriver } = await import('@objectstack/driver-memory');
  const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
    '@objectstack/service-datasource'
  );

  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  await kernel.use(new DriverPlugin(new InMemoryDriver())); // default driver
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AppPlugin(artifact()));
  await kernel.use(
    new DatasourceAdminServicePlugin({
      driverFactory: createDefaultDatasourceDriverFactory(),
      connectPolicy: opts.connectPolicy,
    }),
  );
  await kernel.bootstrap();
  return kernel;
}

describe('ADR-0062 declared-datasource auto-connect', () => {
  let kernel: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    kernel = await boot();
  }, BOOT_TIMEOUT);

  afterAll(async () => {
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  });

  it('auto-connects the declared EXTERNAL datasource as a live driver (no onEnable)', () => {
    const engine = kernel.getService<{ getDriverByName(n: string): unknown }>('data');
    expect(engine.getDriverByName('autoconn_ext')).toBeDefined();
  });

  it('leaves a managed + unrouted datasource metadata-only (app-crm byte-for-byte unchanged)', () => {
    const engine = kernel.getService<{ getDriverByName(n: string): unknown }>('data');
    expect(engine.getDriverByName('decorative')).toBeUndefined();
    // …but it is still VISIBLE in the metadata registry.
    // (visibility is asserted via the admin service below)
  });

  it('still surfaces BOTH datasources in the metadata registry (visibility unchanged)', async () => {
    const metadata = kernel.getService<{ list(t: string): Promise<any[]> }>('metadata');
    const names = (await metadata.list('datasource')).map((d) => d?.name);
    expect(names).toContain('autoconn_ext');
    expect(names).toContain('decorative');
  });

  it('makes the federated object queryable through the engine with zero app code', async () => {
    const engine = kernel.getService<{
      getDriverByName(n: string): any;
      find(object: string, query?: any): Promise<any[]>;
    }>('data');
    // Seed the live external driver directly (bypassing the read-only write gate,
    // exactly as a real remote DB would already hold the rows).
    const driver = engine.getDriverByName('autoconn_ext');
    await driver.bulkCreate('ext_note', [
      { id: 'n1', title: 'first' },
      { id: 'n2', title: 'second' },
    ]);
    const rows = await engine.find('ext_note');
    expect(rows.map((r) => r.title).sort()).toEqual(['first', 'second']);
  });
});

describe('ADR-0062 connect policy seam', () => {
  it('a deny policy leaves the external datasource unconnected (cloud egress isolation)', async () => {
    const denyExternal: DatasourceConnectPolicy = {
      canConnect: (ds) => (ds.schemaMode === 'external' ? { allow: false, reason: 'egress blocked' } : { allow: true }),
    };
    const kernel = await boot({ connectPolicy: denyExternal });
    try {
      const engine = kernel.getService<{ getDriverByName(n: string): unknown }>('data');
      expect(engine.getDriverByName('autoconn_ext')).toBeUndefined();
      // Still visible — denied means metadata-only, not invisible.
      const metadata = kernel.getService<{ list(t: string): Promise<any[]> }>('metadata');
      expect((await metadata.list('datasource')).map((d) => d?.name)).toContain('autoconn_ext');
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);
});
