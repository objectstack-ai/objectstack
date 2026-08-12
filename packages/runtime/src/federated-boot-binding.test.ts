// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #7737 — a declared FEDERATED (external) object must end the boot bound to
// its remote table, whatever ORDER the boot happened to run in.
//
// ## What is actually being pinned
//
// `driver.registerExternalObject(obj)` is the only thing that installs an
// external object's object -> remote-table mapping (`external.remoteName`),
// its `columnMap` translation and its coercion maps. Without it the query path
// resolves to a table named after the OBJECT, so a read either fails with
// "no such table" or answers from the wrong table.
//
// `ObjectQLPlugin.start()` calls it from boot schema-sync — but that runs
// BEFORE `AppPlugin.start()` auto-connects the declared datasource, so at that
// point `getDriverForObject()` answers `undefined` for every federated object
// and the call is skipped. Whether the object ends up bound therefore depends
// on some later component re-driving it, which is the ordering dependence
// #7737 was filed against.
//
// So these are BOOT-SEQUENCE tests on purpose. A test that calls
// `registerExternalObject` directly passes with or without the fix and pins
// nothing: the defect is not in that method, it is in whether the boot ever
// reaches it.
//
// Two binding routes are exercised, and they were NOT equivalent before the
// fix:
//   • explicit `object.datasource` — was already re-driven at connect time by
//     `DatasourceConnectionService`, so it worked; it is here as the guard
//     that the fix does not regress the path that did work.
//   • a `datasourceMapping` rule (#4462) — the connect-time re-drive iterated
//     only the explicitly-bound list, so this object was never bound and its
//     read hit `no such table: fed_invoice`. This is the case that fails on
//     unfixed code.
//
// sqlite `:memory:` keeps it hermetic (the database lives and dies inside the
// process). The remote tables are created through the LIVE auto-connected
// driver after boot — `registerExternalObject` records a name and never
// introspects, so "the remote table exists" is independent of when it appeared.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Runtime } from './runtime.js';
import { DriverPlugin } from './driver-plugin.js';
import { AppPlugin } from './app-plugin.js';

const BOOT_TIMEOUT = 60_000;

async function makeDefaultDriver() {
  const { SqlDriver } = await import('@objectstack/driver-sql');
  return new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });
}

const EXTERNAL_DATASOURCE = {
  name: 'fed_ext',
  label: 'Federated external (sqlite :memory:)',
  driver: 'sqlite',
  schemaMode: 'external',
  origin: 'code',
  config: { filename: ':memory:' },
  external: { allowWrites: false, validation: { onMismatch: 'warn', checkOnBoot: false } },
  active: true,
};

/** The showcase shape: object name deliberately differs from the remote table. */
function artifact() {
  return {
    manifest: { id: 'com.test.fed-binding', name: 'Federated Binding', version: '1.0.0' },
    objects: [
      // Route (1): explicit binding.
      {
        name: 'fed_customer',
        label: 'Federated Customer',
        datasource: 'fed_ext',
        external: { remoteName: 'remote_customers' },
        fields: { id: { type: 'text' }, name: { type: 'text' } },
      },
      // Route (2): NO `datasource` — a datasourceMapping rule routes it.
      {
        name: 'fed_invoice',
        label: 'Federated Invoice',
        external: { remoteName: 'remote_invoices' },
        fields: { id: { type: 'text' }, amount: { type: 'number' } },
      },
      // A managed object on the host default, so the mapping rule below is
      // demonstrably selective rather than catching everything.
      { name: 'local_note', label: 'Local Note', fields: { title: { type: 'text' } } },
    ],
    datasourceMapping: [{ objectPattern: 'fed_invoice', datasource: 'fed_ext' }],
    datasources: [EXTERNAL_DATASOURCE],
  };
}

/** An external object whose declared datasource is not declared anywhere. */
function orphanArtifact() {
  return {
    manifest: { id: 'com.test.fed-orphan', name: 'Federated Orphan', version: '1.0.0' },
    objects: [
      {
        name: 'fed_orphan',
        label: 'Federated Orphan',
        datasource: 'fed_missing',
        external: { remoteName: 'remote_orphans' },
        fields: { id: { type: 'text' } },
      },
    ],
    datasources: [],
  };
}

async function boot(bundle: Record<string, unknown>) {
  const { ObjectQLPlugin } = await import('@objectstack/objectql');
  const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
    '@objectstack/service-datasource'
  );

  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  await kernel.use(new DriverPlugin(await makeDefaultDriver()));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(new AppPlugin(bundle as never));
  await kernel.use(
    new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }),
  );
  await kernel.bootstrap();
  return kernel;
}

type Engine = {
  getDriverByName(n: string): any;
  find(object: string, query?: Record<string, unknown>): Promise<any[]>;
};

describe('#7737 federated boot binding — declared external objects are bound whatever the boot order', () => {
  let kernel: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    kernel = undefined;
  });

  it('binds BOTH binding routes to their remote tables and serves the remote rows', async () => {
    kernel = await boot(artifact());
    const engine = kernel.getService<Engine>('data');

    const driver = engine.getDriverByName('fed_ext');
    expect(driver, 'the declared external datasource must auto-connect (ADR-0062 D1)').toBeDefined();

    // Stand up the "remote" database out of band — nothing in this
    // composition may run DDL on an `external` datasource.
    await driver.execute('CREATE TABLE remote_customers (id text primary key, name text)');
    await driver.execute('CREATE TABLE remote_invoices (id text primary key, amount numeric)');
    await driver.execute("INSERT INTO remote_customers (id, name) VALUES ('c1','Ada'), ('c2','Grace')");
    await driver.execute("INSERT INTO remote_invoices (id, amount) VALUES ('i1', 100)");

    // Route (1) — explicit `object.datasource`. Worked before the fix; here
    // as the no-regression guard.
    const customers = await engine.find('fed_customer');
    expect(customers.map((r) => r.name).sort()).toEqual(['Ada', 'Grace']);

    // Route (2) — routed by a `datasourceMapping` rule. THIS is the one that
    // fails on unfixed code: with no binding installed, the read targets a
    // table called `fed_invoice`, which does not exist in the remote
    // database, and the call rejects with `no such table: fed_invoice`.
    const invoices = await engine.find('fed_invoice');
    expect(invoices.map((r) => r.id)).toEqual(['i1']);
  }, BOOT_TIMEOUT);

  // The binding must not depend on the DDL opt-out: `registerExternalObject`
  // runs no DDL, and `OS_SKIP_SCHEMA_SYNC` is about DDL managed out of band.
  // Before the fix this flag skipped BOTH `syncRegisteredSchemas()` calls and
  // took the only in-plugin binding site with them.
  it('binds federated objects even when boot schema sync is skipped (OS_SKIP_SCHEMA_SYNC)', async () => {
    const previous = process.env.OS_SKIP_SCHEMA_SYNC;
    process.env.OS_SKIP_SCHEMA_SYNC = '1';
    try {
      kernel = await boot(artifact());
      const engine = kernel.getService<Engine>('data');
      const driver = engine.getDriverByName('fed_ext');
      await driver.execute('CREATE TABLE remote_customers (id text primary key, name text)');
      await driver.execute('CREATE TABLE remote_invoices (id text primary key, amount numeric)');
      await driver.execute("INSERT INTO remote_customers (id, name) VALUES ('c1','Ada')");
      await driver.execute("INSERT INTO remote_invoices (id, amount) VALUES ('i1', 100)");
      expect((await engine.find('fed_customer')).map((r) => r.name)).toEqual(['Ada']);
      expect((await engine.find('fed_invoice')).map((r) => r.id)).toEqual(['i1']);
    } finally {
      if (previous === undefined) delete process.env.OS_SKIP_SCHEMA_SYNC;
      else process.env.OS_SKIP_SCHEMA_SYNC = previous;
    }
  }, BOOT_TIMEOUT);
});

// #7737's ruling: the `if (!driver)` skip must stop being SILENT for a
// declared external object. Before the fix the entire diagnosis of a broken
// federation was one `debug` line reading "No driver available for object,
// skipping schema sync" — invisible at any normal log level, and emitted on
// healthy boots too (the driver simply had not connected yet at that point).
//
// This is a LOG assertion, not an ADR-0112 refusal assertion, and deliberately
// so: an unbound federated object does not throw at boot. It is reported, and
// the read that follows refuses on its own with the engine's existing
// "Datasource 'fed_missing' … is not registered" error — asserted below so the
// pair (boot says so / read refuses) is pinned together.
describe('#7737 an external object that cannot be bound is REPORTED, not skipped in silence', () => {
  let kernel: Awaited<ReturnType<typeof boot>> | undefined;

  afterEach(async () => {
    try { await (kernel as any)?.stop?.(); } catch { /* noop */ }
    kernel = undefined;
    vi.restoreAllMocks();
  });

  it('names the object, its datasource, the consequence and the fix at error level', async () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as never);

    kernel = await boot(orphanArtifact());
    spy.mockRestore();

    const report = lines.find((l) => l.includes('fed_orphan') && l.includes('ERROR'));
    expect(report, 'boot must report the unbound federated object at ERROR level').toBeDefined();
    // The object, the datasource that could not be resolved, the consequence
    // and the remedy — a diagnosis, not a bare "skipping".
    expect(report).toContain('fed_orphan');
    expect(report).toContain('fed_missing');
    expect(report).toContain('NOT bound');
    expect(report).toContain('no such table');
    expect(report).toContain('Fix');

    // …and the read itself still refuses rather than answering empty.
    const engine = kernel.getService<Engine>('data');
    await expect(engine.find('fed_orphan')).rejects.toThrow(/fed_missing/);
  }, BOOT_TIMEOUT);

  it('says nothing when every federated object bound (no false alarm on a healthy boot)', async () => {
    const lines: string[] = [];
    const spy = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation(((chunk: string | Uint8Array) => {
        lines.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
        return true;
      }) as never);

    kernel = await boot(artifact());
    spy.mockRestore();

    expect(lines.filter((l) => l.includes('NOT bound to their remote'))).toEqual([]);
  }, BOOT_TIMEOUT);
});
