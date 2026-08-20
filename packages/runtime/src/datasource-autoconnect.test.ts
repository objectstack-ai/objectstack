// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0062 Phase 1 acceptance (D1/D2/D5): a stack that only *declares* an
// external datasource — with NO `onEnable` driver wiring — auto-connects it to
// a live ObjectQL driver and its federated objects become queryable, while a
// managed + unrouted datasource stays metadata-only (existing apps unchanged).
//
// This boots the host-config shape (instantiated plugins, no MetadataPlugin —
// the same shape `examples/app-showcase` runs under `os dev`) with the REAL
// driver factory (`createDefaultDatasourceDriverFactory`) building a real
// sqlite `:memory:` pool, so the full AppPlugin → `datasource-connection` →
// engine path runs against the same engine production uses.
//
// Backend note (#5704 batch 0): both the host default driver and the declared
// datasources ran on `@objectstack/driver-memory` until this file was migrated
// to `@objectstack/driver-sql` + better-sqlite3 `:memory:` — the repo's
// canonical ephemeral store (`examples/app-crm`, `cli db clean`). driver-memory
// is the project's legacy test-convenience backend and its in-project test
// surface is being retired (#5499). `:memory:` keeps every acceptance below
// hermetic: the database lives and dies inside the process, so nothing reaches
// the host filesystem and each boot starts empty.

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Runtime } from './runtime.js';
import { DriverPlugin } from './driver-plugin.js';
import { AppPlugin } from './app-plugin.js';
import type { DatasourceConnectPolicy } from '@objectstack/service-datasource';

// [#10126] Pay the first transform of these dist-resolved workspace deps at MODULE
// LOAD. Each is reached below through a dynamic `import()` inside an `it()` body or a
// hook -- both of which vitest clocks, while collection is clocked against nothing. See
// `scripts/check-test-source-alias.mjs` (the clocked-window rule) and #10115 / PR #10120,
// where the same shape cost 30 ejected merge-queue builds in one night.
import '@objectstack/driver-sql';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 60_000;

/** The host's default driver — sqlite `:memory:`, constructed the canonical way. */
async function makeDefaultDriver() {
  const { SqlDriver } = await import('@objectstack/driver-sql');
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

/**
 * `schemaMode: 'external'` forbids DDL through the driver (ADR-0015 — ObjectStack
 * is a guest in that database), so the federated table has to already exist,
 * exactly as the real remote database an external datasource points at would
 * hold it. Raw `execute()` is the out-of-band channel that stands in for
 * "somebody else's migration already ran".
 *
 * With driver-memory this step did not exist: a mingo store materialises a
 * collection on first write, so an undeclared table was indistinguishable from a
 * declared one. Making it explicit is the point of the migration, not a
 * workaround for it.
 */
async function ensureRemoteExtNoteTable(driver: any): Promise<void> {
  await driver.execute('CREATE TABLE IF NOT EXISTS ext_note (id text primary key, title text)');
}

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
        label: 'External (sqlite :memory:)',
        driver: 'sqlite',
        schemaMode: 'external',
        origin: 'code',
        config: { filename: ':memory:' },
        external: { allowWrites: false, validation: { onMismatch: 'warn', checkOnBoot: false } },
        active: true,
      },
      // Managed + unrouted: nothing binds to it, not external, no autoConnect.
      // Mirrors app-crm's decorative `:memory:` datasources — must NOT connect.
      {
        name: 'decorative',
        label: 'Decorative (unrouted)',
        driver: 'sqlite',
        schemaMode: 'managed',
        origin: 'code',
        config: { filename: ':memory:' },
        active: true,
      },
    ],
  };
}

async function boot(opts: { connectPolicy?: DatasourceConnectPolicy } = {}) {
  const { ObjectQLPlugin } = await import('@objectstack/objectql');
  const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
    '@objectstack/service-datasource'
  );

  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  await kernel.use(new DriverPlugin(await makeDefaultDriver())); // default driver
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
    await ensureRemoteExtNoteTable(driver);
    await driver.bulkCreate('ext_note', [
      { id: 'n1', title: 'first' },
      { id: 'n2', title: 'second' },
    ]);
    const rows = await engine.find('ext_note');
    expect(rows.map((r) => r.title).sort()).toEqual(['first', 'second']);
  });
});

// ADR-0062 D1 acceptance — an auto-connected in-memory federated pool leaves
// nothing behind and does not outlive its kernel.
//
// ## What this pinned before, and why it still says the same thing
//
// #4083: the acceptance above passed on a clean checkout and failed on every
// subsequent run, reading 2×N rows on the Nth. The auto-connected `memory`
// datasource inherited `InMemoryDriver`'s then-default `persistence: 'auto'`
// (#4065 has since made that default `false`), so it flushed `ext_note` into
// `.objectstack/data/memory-driver.json` under the CWD and the next boot's
// connect() loaded those rows back before this file seeded its own. CI never
// caught it because CI always runs #1 on a fresh checkout. The intermittency
// ("passes once in four") came from WHEN the flush landed — the file adapter
// wrote on a 2s unref'd autosave timer — so the original block called
// `driver.flush?.()` to force the timer's work and remove the race.
//
// Those three things — `memory-driver.json`, `flush()`, the autosave timer —
// are driver-memory FILE-ADAPTER specifics, and this file no longer runs on
// driver-memory (#5704 batch 0). The acceptance target was never the file
// adapter: ADR-0062 D1 asks for a runtime property — a federated in-memory pool
// leaves nothing on the host and a restart starts empty — so the block is
// rewritten against sqlite `:memory:` rather than deleted (deleting it would
// drop D1's acceptance) and rather than moved into driver-memory's own suite
// (the factory-level #4083 pin already lives in service-datasource's tests).
//
// Under `:memory:` the property is asserted more directly than before: a fresh
// pool has no `ext_note` TABLE at all, not merely no rows — the one thing a
// reloaded snapshot could never look like. The filesystem half is unchanged and
// still load-bearing: `filename: ':memory:'` is one config typo away from a
// relative file path, and that typo is exactly what #4083 was.
describe('ADR-0062 D1 — the auto-connected in-memory pool leaves nothing behind (#4083)', () => {
  const STATE_DIR = join(process.cwd(), '.objectstack');
  const clearState = () => { try { rmSync(STATE_DIR, { recursive: true, force: true }); } catch { /* noop */ } };
  // Clear on both sides: a leftover from elsewhere would make this pass for the
  // wrong reason, and a failure that DID write must not leak into the next run
  // (that leak is the bug under test).
  beforeAll(clearState);
  afterAll(clearState);

  function externalDriver(kernel: Awaited<ReturnType<typeof boot>>) {
    const engine = kernel.getService<{ getDriverByName(n: string): any }>('data');
    return engine.getDriverByName('autoconn_ext');
  }

  /** Rows knex returns for a raw SELECT, whichever envelope the dialect uses. */
  function rowsOf(result: any): any[] {
    if (Array.isArray(result)) return result;
    if (Array.isArray(result?.rows)) return result.rows;
    return result == null ? [] : [result];
  }

  /**
   * Does this pool's database already hold the federated table? A pool that
   * reloaded a previous boot's state would; a genuinely fresh `:memory:` one
   * cannot, because nothing in this composition is allowed to run DDL on an
   * `external` datasource.
   */
  async function hasExtNoteTable(kernel: Awaited<ReturnType<typeof boot>>) {
    const result = await externalDriver(kernel).execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ext_note'",
    );
    return rowsOf(result).length > 0;
  }

  async function seedAndRead(kernel: Awaited<ReturnType<typeof boot>>) {
    const engine = kernel.getService<{
      getDriverByName(n: string): any;
      find(object: string, query?: any): Promise<any[]>;
    }>('data');
    const driver = engine.getDriverByName('autoconn_ext');
    await ensureRemoteExtNoteTable(driver);
    await driver.bulkCreate('ext_note', [
      { id: 'n1', title: 'first' },
      { id: 'n2', title: 'second' },
    ]);
    return (await engine.find('ext_note')).map((r) => r.title).sort();
  }

  it('writes no state file, and a second boot in the same process starts empty', async () => {
    const first = await boot();
    try {
      expect(await hasExtNoteTable(first)).toBe(false);
      expect(await seedAndRead(first)).toEqual(['first', 'second']);
      // The seeded rows must not have reached the host filesystem at all.
      expect(existsSync(STATE_DIR)).toBe(false);
    } finally {
      try { await (first as any)?.stop?.(); } catch { /* noop */ }
    }

    const second = await boot();
    try {
      // The whole point: not "no rows carried over" but "no database carried
      // over". Was ['first','first','second','second'] under the #4083 defect.
      expect(await hasExtNoteTable(second)).toBe(false);
      expect(await seedAndRead(second)).toEqual(['first', 'second']);
      expect(existsSync(STATE_DIR)).toBe(false);
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
          driver: 'sqlite',
          schemaMode: 'external',
          origin: 'code',
          config: { filename: ':memory:' },
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
    const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
      '@objectstack/service-datasource'
    );
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    await kernel.use(new DriverPlugin(await makeDefaultDriver()));
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
    const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
      '@objectstack/service-datasource'
    );
    const runtime = new Runtime({ cluster: false });
    const kernel = runtime.getKernel();
    await kernel.use(new DriverPlugin(await makeDefaultDriver()));
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
