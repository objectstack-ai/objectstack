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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
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
  // `persistence: false` keeps the acceptance hermetic. The driver's own default
  // is `'auto'` — in Node a file adapter at `.objectstack/data/…` under the CWD,
  // which both reloads and rewrites ambient state between runs (#4083).
  await kernel.use(new DriverPlugin(new InMemoryDriver({ persistence: false }))); // default driver
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

// #4083 — the acceptance above passed on a clean checkout and failed on every
// subsequent run, reading 2×N rows on the Nth: the auto-connected `memory`
// datasource inherited `InMemoryDriver`'s then-default `persistence: 'auto'`
// (#4065 has since made that default `false`), so it
// flushed `ext_note` into `.objectstack/data/memory-driver.json` under the CWD
// and the next boot's connect() loaded those rows back before this file seeded
// its own. CI never caught it because CI always runs #1 on a fresh checkout.
//
// The intermittency ("passes once in four") came from WHEN the flush lands: the
// file adapter writes on a 2s unref'd autosave timer, so a run short enough to
// finish first left nothing behind. `flush()` below stands in for that timer, so
// this pins the property that was actually broken — a federated in-memory pool
// leaves nothing behind and does not outlive its kernel — without a timing race
// and without depending on run-to-run state.
describe('ADR-0062 D1 — the auto-connected in-memory pool leaves nothing behind (#4083)', () => {
  const STATE_DIR = join(process.cwd(), '.objectstack');
  const clearState = () => { try { rmSync(STATE_DIR, { recursive: true, force: true }); } catch { /* noop */ } };
  // Clear on both sides: a leftover from elsewhere would make this pass for the
  // wrong reason, and a failure that DID write must not leak into the next run
  // (that leak is the bug under test).
  beforeAll(clearState);
  afterAll(clearState);

  async function seedAndRead(kernel: Awaited<ReturnType<typeof boot>>) {
    const engine = kernel.getService<{
      getDriverByName(n: string): any;
      find(object: string, query?: any): Promise<any[]>;
    }>('data');
    const driver = engine.getDriverByName('autoconn_ext');
    await driver.bulkCreate('ext_note', [
      { id: 'n1', title: 'first' },
      { id: 'n2', title: 'second' },
    ]);
    const titles = (await engine.find('ext_note')).map((r) => r.title).sort();
    // Whatever the autosave timer would have written, written now.
    await driver.flush?.();
    return titles;
  }

  it('writes no state file, and a second boot in the same process starts empty', async () => {
    const first = await boot();
    try {
      expect(await seedAndRead(first)).toEqual(['first', 'second']);
      // The seeded rows must not have reached the host filesystem at all.
      expect(existsSync(STATE_DIR)).toBe(false);
    } finally {
      try { await (first as any)?.stop?.(); } catch { /* noop */ }
    }

    const second = await boot();
    try {
      // Was ['first','first','second','second'] — the first boot's rows, reloaded.
      expect(await seedAndRead(second)).toEqual(['first', 'second']);
    } finally {
      try { await (second as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);
});

describe('ADR-0062 credentials fail-closed (D3)', () => {
  // An external datasource that declares a credentialsRef the host cannot
  // resolve (no matching sys_secret row) must FAIL CLOSED — never connect with
  // a missing credential. With onMismatch:'fail' that bricks boot (fail-fast).
  function credArtifact() {
    return {
      manifest: { id: 'com.test.ds-cred', name: 'DS Cred', version: '1.0.0' },
      objects: [{ name: 'note', label: 'Note', fields: { title: { type: 'text' } } }],
      datasources: [
        {
          name: 'needs_secret',
          driver: 'memory',
          schemaMode: 'external',
          origin: 'code',
          config: {},
          external: {
            allowWrites: false,
            credentialsRef: 'sys_secret:does-not-exist',
            validation: { onMismatch: 'fail', checkOnBoot: false },
          },
          active: true,
        },
      ],
    };
  }

  it('bricks boot with a clear message when a required credential cannot be resolved', async () => {
    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { InMemoryDriver } = await import('@objectstack/driver-memory');
    const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
      '@objectstack/service-datasource'
    );
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    await kernel.use(new DriverPlugin(new InMemoryDriver()));
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppPlugin(credArtifact()));
    await kernel.use(
      new DatasourceAdminServicePlugin({
        driverFactory: createDefaultDatasourceDriverFactory(),
        // A binder whose resolve never finds the secret (rotated key / missing row).
        secrets: { bind: async () => 'sys_secret:x', resolve: async () => undefined },
      }),
    );
    await expect(kernel.bootstrap()).rejects.toThrow(/needs_secret|credential|fail-fast/i);
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  }, BOOT_TIMEOUT);
});

describe('ADR-0062 D5 — an explicitly-bound datasource that cannot connect bricks boot (#3758)', () => {
  // A MANAGED datasource with no `onMismatch:'fail'` to lean on, that two
  // objects bind to explicitly. Those objects never fall back to the `default`
  // driver — `engine.getDriver` throws for them — so leaving this at a warning
  // produced a server that started clean and failed every query against them.
  function boundArtifact() {
    return {
      manifest: { id: 'com.test.ds-bound', name: 'DS Bound', version: '1.0.0' },
      objects: [
        { name: 'visit', label: 'Visit', datasource: 'analytics', fields: { id: { type: 'text' } } },
        { name: 'session', label: 'Session', datasource: 'analytics', fields: { id: { type: 'text' } } },
        { name: 'note', label: 'Note', fields: { title: { type: 'text' } } },
      ],
      datasources: [
        {
          name: 'analytics',
          label: 'Analytics',
          // No factory supports this driver — the same dead end as an
          // unreachable host, from the bound objects' point of view.
          driver: 'not-a-real-driver',
          schemaMode: 'managed',
          origin: 'code',
          config: {},
          active: true,
        },
      ],
    };
  }

  async function bootBound() {
    const { ObjectQLPlugin } = await import('@objectstack/objectql');
    const { InMemoryDriver } = await import('@objectstack/driver-memory');
    const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
      '@objectstack/service-datasource'
    );
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    await kernel.use(new DriverPlugin(new InMemoryDriver()));
    await kernel.use(new ObjectQLPlugin());
    await kernel.use(new AppPlugin(boundArtifact()));
    await kernel.use(
      new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }),
    );
    return kernel;
  }

  const ENV = 'OS_ALLOW_DRIVER_CONNECT_FAILURE';
  let saved: string | undefined;
  beforeEach(() => { saved = process.env[ENV]; delete process.env[ENV]; });
  afterEach(() => {
    if (saved === undefined) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it('refuses the boot, naming the datasource and the objects that depend on it', async () => {
    const kernel = await bootBound();
    const err = await kernel.bootstrap().then(
      () => { throw new Error('bootstrap() resolved but should have thrown'); },
      (e: unknown) => e as Error,
    );
    expect(err.message).toMatch(/analytics/);
    expect(err.message).toMatch(/visit/);
    expect(err.message).toMatch(/session/);
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  }, BOOT_TIMEOUT);

  it('boots degraded when the operator sets OS_ALLOW_DRIVER_CONNECT_FAILURE', async () => {
    process.env[ENV] = '1';
    const kernel = await bootBound();
    await expect(kernel.bootstrap()).resolves.not.toThrow();
    const engine = kernel.getService<{ getDriverByName(n: string): unknown }>('data');
    expect(engine.getDriverByName('analytics')).toBeUndefined(); // still unconnected
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
  }, BOOT_TIMEOUT);
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

  // framework#3828 — the denial is deliberate and stays non-fatal, but the
  // tenant used to be told `Datasource 'autoconn_ext' is not registered`, which
  // reads like "you misconfigured your app" rather than "your plan blocks this".
  it('a query against a denied datasource explains WHY, without leaking the operator reason', async () => {
    const denyExternal: DatasourceConnectPolicy = {
      canConnect: (ds) =>
        ds.schemaMode === 'external'
          ? {
              allow: false,
              reason: 'egress allow-list miss for warehouse.internal:5432 (org_42, plan=free)',
              publicReason: 'External datasources require the Scale plan.',
            }
          : { allow: true },
    };
    const kernel = await boot({ connectPolicy: denyExternal });
    try {
      const engine = kernel.getService<{ find(o: string): Promise<unknown> }>('data');
      const err: any = await engine.find('ext_note').then(
        () => { throw new Error('find() resolved but should have thrown'); },
        (e: unknown) => e,
      );
      expect(err.code).toBe('ERR_DATASOURCE_UNAVAILABLE');
      expect(err.message).toContain('connect policy refused it');
      expect(err.message).toContain('require the Scale plan');
      // The operator-facing reason must never cross into a tenant-visible error.
      expect(err.message).not.toContain('warehouse.internal');
      expect(err.message).not.toContain('org_42');
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);

  // framework#3827 — the admin list is the one place an operator can see this
  // without redeploying and re-reading boot logs.
  it('surfaces the denial in the datasource-admin list, with the operator reason', async () => {
    const denyExternal: DatasourceConnectPolicy = {
      canConnect: (ds) =>
        ds.schemaMode === 'external'
          ? { allow: false, reason: 'egress allow-list miss for warehouse.internal:5432' }
          : { allow: true },
    };
    const kernel = await boot({ connectPolicy: denyExternal });
    try {
      const admin = kernel.getService<{ listDatasources(): Promise<any[]> }>('datasource-admin');
      const list = await admin.listDatasources();
      const ext = list.find((d) => d.name === 'autoconn_ext')!;
      expect(ext.status).toBe('blocked');
      // Admin-gated surface: the raw reason is the useful answer here.
      expect(ext.statusReason).toContain('warehouse.internal:5432');
      // A datasource nothing tried to connect stays honestly unknown.
      expect(list.find((d) => d.name === 'decorative')!.status).toBe('unvalidated');
    } finally {
      try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    }
  }, BOOT_TIMEOUT);
});
