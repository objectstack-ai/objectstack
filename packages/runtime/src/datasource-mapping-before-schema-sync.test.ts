// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #23649 — a stack's `datasourceMapping` governs the engine from its FIRST
// schema sync, platform objects included.
//
// ## The defect
//
// `AppPlugin.start()` used to install the mapping, after `ObjectQLPlugin.start()`
// had schema-synced every registered object onto the default store and after
// the auth plugin's `start()` had written the Default Organization there. A
// `{ default: true, datasource: 'primary' }` rule then re-routed every platform
// object to a `primary` whose schema never synced: the served boot reported
// ready while the default store held the platform tables and the boot rows,
// and `primary` answered "no such table". A rule that routes platform objects
// only (`objectPattern: 'sys_*'`) left `primary` never connected at all,
// because the connect gate counted the app's own objects.
//
// ## What is pinned
//
// One in-process boot per mapping shape, with the composition the served host
// config uses: a default SQL driver (`DriverPlugin`), the engine plugin, the
// app, the datasource-admin plugin with the REAL driver factory, and a fixture
// "platform" plugin that stands in for the auth plugin — it registers an object
// the app does not declare in `init()` and writes a row to it in `start()`,
// between the engine plugin's start and the app's (the Default Organization's
// slot). Every store is sqlite `:memory:`, so each datasource is its own
// database and nothing reaches the host filesystem.
//
//   1. `default: true` → `primary`: the platform object's table AND its boot
//      row are on `primary`, and the default store holds neither;
//   2. `objectPattern: 'sys_*'` → `primary`: `primary` is connected and holds
//      the platform object, while the app object (unmatched) stays on the
//      default store;
//   3. CONTROL, no mapping: everything on the default store, and the managed,
//      unrouted `primary` stays metadata-only (unchanged);
//
// and in every leg the engine's default driver is still the `DriverPlugin`'s:
// the mapped datasource connects after the engine adopted its drivers, so it
// never takes the default slot.

import { describe, it, expect, afterEach } from 'vitest';
import { Runtime } from './runtime.js';
import { DriverPlugin } from './driver-plugin.js';
import { AppPlugin } from './app-plugin.js';

// [#10126] Pay the first transform of these dist-resolved workspace deps at
// MODULE LOAD, not inside a clocked `it()` (`scripts/check-test-source-alias.mjs`).
import '@objectstack/driver-sql';
import '@objectstack/objectql';
import '@objectstack/service-datasource';

const BOOT_TIMEOUT = 60_000;

/** The object the fixture platform plugin owns — no rule names it but `default`/`sys_*`. */
const PLATFORM_OBJECT = 'sys_fx_ledger';
/** The app's own object. */
const APP_OBJECT = 'fx_task';
/** The row the platform plugin writes in `start()` — the Default Organization's slot. */
const BOOT_ROW = 'written-during-boot';

interface EngineView {
  getDriverByName(name: string): any;
  getDefaultDriverName(): string | undefined;
  insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
}

function stack(datasourceMapping?: unknown[]) {
  return {
    manifest: { id: 'com.test.mapping-before-sync', name: 'Mapping before sync', version: '1.0.0' },
    objects: [{ name: APP_OBJECT, label: 'Task', fields: { title: { type: 'text' } } }],
    datasources: [
      {
        name: 'primary',
        label: 'Primary (sqlite :memory:)',
        driver: 'sqlite',
        schemaMode: 'managed',
        origin: 'code',
        config: { filename: ':memory:' },
        active: true,
      },
    ],
    ...(datasourceMapping ? { datasourceMapping } : {}),
  };
}

/**
 * A plugin the app does not own, shaped like the auth plugin: its object is
 * registered in `init()` and a row is written to it in `start()`, after the
 * engine plugin's start (declared) and before the app's (it is registered
 * ahead of the app, and the kernel breaks ties by registration order).
 */
function platformPlugin() {
  return {
    name: 'com.test.mapping-before-sync.platform',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    init: async (ctx: any) => {
      ctx.getService('manifest').register({
        id: 'com.test.mapping-before-sync.platform',
        name: 'Platform fixture',
        version: '1.0.0',
        type: 'plugin',
        objects: [{ name: PLATFORM_OBJECT, label: 'Ledger', fields: { title: { type: 'text' } } }],
      });
    },
    start: async (ctx: any) => {
      await ctx.getService('objectql').insert(PLATFORM_OBJECT, { title: BOOT_ROW }, { context: { isSystem: true } });
    },
  };
}

async function makeDefaultDriver() {
  const { SqlDriver } = await import('@objectstack/driver-sql');
  return new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
}

const kernels: Array<{ stop?: () => Promise<void> }> = [];
afterEach(async () => {
  for (const kernel of kernels.splice(0)) {
    try { await kernel.stop?.(); } catch { /* noop */ }
  }
});

async function boot(datasourceMapping?: unknown[]) {
  const { ObjectQLPlugin } = await import('@objectstack/objectql');
  const { DatasourceAdminServicePlugin, createDefaultDatasourceDriverFactory } = await import(
    '@objectstack/service-datasource'
  );
  const defaultDriver = await makeDefaultDriver();
  const runtime = new Runtime({ cluster: false });
  const kernel = runtime.getKernel();
  kernels.push(kernel as never);
  await kernel.use(new DriverPlugin(defaultDriver));
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(platformPlugin() as never);
  await kernel.use(new AppPlugin(stack(datasourceMapping)));
  await kernel.use(new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory() }));
  await kernel.bootstrap();
  const engine = kernel.getService<EngineView>('objectql');
  return { engine, defaultDriver };
}

/** Rows knex returns for a raw SELECT, whichever envelope the dialect uses. */
function rowsOf(result: any): any[] {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.rows)) return result.rows;
  return result == null ? [] : [result];
}

async function tablesOf(driver: any): Promise<string[]> {
  const result = await driver.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name");
  return rowsOf(result).map((r: any) => r.name);
}

async function bootRowsOn(driver: any): Promise<string[]> {
  const result = await driver.execute(`SELECT title FROM ${PLATFORM_OBJECT}`);
  return rowsOf(result).map((r: any) => r.title);
}

describe('#23649 — datasourceMapping governs the engine from its first schema sync', () => {
  it('a `default: true` rule puts the platform object\'s table and its boot row on the mapped datasource', async () => {
    const { engine, defaultDriver } = await boot([{ default: true, datasource: 'primary' }]);
    const primary = engine.getDriverByName('primary');
    expect(primary, 'the mapped datasource was never connected').toBeDefined();

    // The default slot is the DriverPlugin's, as before the mapping existed.
    expect(engine.getDriverByName(engine.getDefaultDriverName() as string)).toBe(defaultDriver);

    const onPrimary = await tablesOf(primary);
    const onDefault = await tablesOf(defaultDriver);
    expect(onPrimary).toContain(PLATFORM_OBJECT);
    expect(onPrimary).toContain(APP_OBJECT);
    expect(onDefault, 'the first schema sync still went to the default store').not.toContain(PLATFORM_OBJECT);
    expect(onDefault).not.toContain(APP_OBJECT);

    // The row a platform plugin wrote in `start()` is where the object routes.
    expect(await bootRowsOn(primary)).toEqual([BOOT_ROW]);
  }, BOOT_TIMEOUT);

  it('an `objectPattern: \'sys_*\'` rule connects the datasource it routes platform objects to', async () => {
    const { engine, defaultDriver } = await boot([{ objectPattern: 'sys_*', datasource: 'primary' }]);
    const primary = engine.getDriverByName('primary');
    expect(primary, 'a datasource only platform objects route to was never connected').toBeDefined();
    expect(engine.getDriverByName(engine.getDefaultDriverName() as string)).toBe(defaultDriver);

    const onPrimary = await tablesOf(primary);
    const onDefault = await tablesOf(defaultDriver);
    expect(onPrimary).toContain(PLATFORM_OBJECT);
    expect(onDefault).not.toContain(PLATFORM_OBJECT);
    // The app object matches no rule: it stays on the default store.
    expect(onDefault).toContain(APP_OBJECT);
    expect(onPrimary).not.toContain(APP_OBJECT);
    expect(await bootRowsOn(primary)).toEqual([BOOT_ROW]);
  }, BOOT_TIMEOUT);

  it('control: with no mapping everything stays on the default store and the unrouted datasource stays metadata-only', async () => {
    const { engine, defaultDriver } = await boot();
    expect(engine.getDriverByName('primary')).toBeUndefined();
    expect(engine.getDriverByName(engine.getDefaultDriverName() as string)).toBe(defaultDriver);

    const onDefault = await tablesOf(defaultDriver);
    expect(onDefault).toContain(PLATFORM_OBJECT);
    expect(onDefault).toContain(APP_OBJECT);
    expect(await bootRowsOn(defaultDriver)).toEqual([BOOT_ROW]);
  }, BOOT_TIMEOUT);
});
