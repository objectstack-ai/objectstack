// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27701] A code object bound to a runtime (Setup-created) managed datasource
 * gets its table when the datasource's pool opens: on create, and on the boot
 * rehydration after a restart.
 *
 * ## The defect this pins closed
 *
 * An author declares `wh_note` with `datasource: 'warehouse'`, and an admin
 * creates `warehouse` in Setup → Datasources. Boot's schema sync skipped the
 * object, because no `warehouse` driver existed yet. The plugin's
 * `registerPool` then opened the pool with `connect(record, { context })` and
 * no `objects`, so the connect's sync loop had nothing to sync. The datasource
 * answered `ok`, the table was never created, and every read of the object was
 * a 500 (Postgres `42P01`, SQLite `no such table`), the same after a restart.
 *
 * ## What each case pins
 *
 *  - on create, the bound managed object's table exists and the object reads;
 *  - on the restart's rehydration, a table that is missing (the state an
 *    install created before this fix is in) is created, and the object reads;
 *  - ⛔ an `external` or `validate-only` datasource gets no schema sync at all:
 *    its pool opens, and nothing is synced for the objects bound to it.
 *
 * The composition is the real one: the real `DatasourceAdminServicePlugin`
 * through `init()` and `start()`, a real `ObjectQL` engine on the `'objectql'`
 * and `'data'` slots (one engine, as `ObjectQLPlugin` registers it), and the
 * real default driver factory opening SQLite files. The engine's `sys_metadata`
 * door is left off the `'data'` slot, so the plugin takes its in-memory branch:
 * durability across a restart is the subject of `datasource-admin-plugin.test.ts`
 * ("runtime datasource durability"). Here the restart's stored row arrives in
 * the metadata service, where that restore leaves it. The code object is put
 * in the engine registry before the plugin starts, as `AppPlugin.init()` does
 * through the `'manifest'` service in Phase 1.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ObjectQL } from '@objectstack/objectql';
import type { IDataDriver } from '@objectstack/spec/contracts';
import type { IDatasourceAdminService } from '../contracts/index.js';
import { DatasourceAdminServicePlugin } from '../datasource-admin-plugin.js';
import { createDefaultDatasourceDriverFactory } from '../default-datasource-driver-factory.js';

const teardowns: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const t of teardowns.splice(0).reverse()) await t();
});

type Knex = {
  schema: { hasTable(n: string): Promise<boolean>; dropTableIfExists(n: string): Promise<void> };
};

/** The author's code object, bound by name to a datasource the stack does not declare. */
const boundTo = (name: string, datasource: string, extra: Record<string, unknown> = {}) => ({
  name,
  label: name,
  datasource,
  fields: { title: { type: 'text', label: 'Title' } },
  ...extra,
});

/** A fresh directory for this case's SQLite files. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ds-27701-'));
  teardowns.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * One boot: an engine holding the code objects, then the plugin's `init()` and
 * `start()`. `stored` is what the restart's restore leaves in the metadata
 * service.
 */
async function boot(opts: { objects: Array<Record<string, unknown>>; stored?: Array<Record<string, unknown>> }) {
  const ql = new ObjectQL();
  for (const object of opts.objects) (ql as any).registry.registerObject(object as never, 'com.acme.warehouse');
  const synced = vi.spyOn(ql, 'syncObjectSchema');

  const records = new Map<string, Map<string, unknown>>([
    ['datasource', new Map((opts.stored ?? []).map((r) => [r.name as string, r]))],
  ]);
  const metadata = {
    get: async (t: string, n: string) => records.get(t)?.get(n),
    list: async (t: string) => [...(records.get(t)?.values() ?? [])],
    register: async (t: string, n: string, d: unknown) => {
      if (!records.has(t)) records.set(t, new Map());
      records.get(t)!.set(n, d);
    },
    unregister: async (t: string, n: string) => void records.get(t)?.delete(n),
  };
  const sysMetadataDoor = new Set(['find', 'findOne', 'insert', 'update', 'delete']);
  const data = new Proxy(ql, {
    get: (target, key, receiver) => (sysMetadataDoor.has(key as string) ? undefined : Reflect.get(target, key, receiver)),
  });

  const services = new Map<string, unknown>([
    ['objectql', ql],
    ['data', data],
    ['metadata', metadata],
  ]);
  const ctx = {
    getService: (n: string) => {
      if (!services.has(n)) throw new Error(`no service: ${n}`);
      return services.get(n);
    },
    registerService: (n: string, s: unknown) => void services.set(n, s),
    trigger: async () => {},
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  };

  const plugin = new DatasourceAdminServicePlugin({ driverFactory: createDefaultDatasourceDriverFactory({}) });
  await plugin.init(ctx as never);
  await plugin.start(ctx as never);
  teardowns.push(async () => {
    for (const driver of (ql as any).drivers?.values?.() ?? []) await (driver as IDataDriver).disconnect?.();
  });

  const knexOf = (datasource: string) => (ql.getDriverByName(datasource) as unknown as { getKnex(): Knex }).getKnex();
  const read = (object: string) => ql.find(object, { context: { isSystem: true } } as never);
  return { ql, synced, knexOf, read, admin: services.get('datasource-admin') as IDatasourceAdminService };
}

describe('a code object bound to a runtime managed datasource gets its table', () => {
  it('on create: the table exists and the object reads', async () => {
    const dir = scratch();
    const { admin, knexOf, read } = await boot({ objects: [boundTo('wh_note', 'warehouse')] });

    const created = await admin.createDatasource({
      name: 'warehouse',
      driver: 'sqlite',
      config: { filename: join(dir, 'warehouse.db') },
    });

    expect(created.status).toBe('ok');
    expect(await knexOf('warehouse').schema.hasTable('wh_note')).toBe(true);
    await expect(read('wh_note')).resolves.toEqual([]);
  });

  it('after a restart: the rehydrated pool creates a table that is missing, and the object reads', async () => {
    const dir = scratch();
    const record = {
      name: 'warehouse',
      driver: 'sqlite',
      origin: 'runtime',
      active: true,
      config: { filename: join(dir, 'warehouse.db') },
    };
    const first = await boot({ objects: [boundTo('wh_note', 'warehouse')] });
    await first.admin.createDatasource({ name: record.name, driver: record.driver, config: record.config });
    // The state an install that created the datasource before this fix is in.
    await first.knexOf('warehouse').schema.dropTableIfExists('wh_note');
    await (first.ql.getDriverByName('warehouse') as IDataDriver).disconnect?.();

    const restarted = await boot({ objects: [boundTo('wh_note', 'warehouse')], stored: [record] });

    expect(await restarted.knexOf('warehouse').schema.hasTable('wh_note')).toBe(true);
    await expect(restarted.read('wh_note')).resolves.toEqual([]);
  });

  it('control: an object bound to another datasource is not synced on this one', async () => {
    const dir = scratch();
    const { admin, synced } = await boot({
      objects: [boundTo('wh_note', 'warehouse'), boundTo('crm_note', 'crm')],
    });

    await admin.createDatasource({ name: 'warehouse', driver: 'sqlite', config: { filename: join(dir, 'warehouse.db') } });

    expect(synced.mock.calls.map(([name]) => name)).toEqual(['wh_note']);
  });
});

describe('⛔ an external or federated datasource never gets DDL', () => {
  it.each(['external', 'validate-only'] as const)(
    'schemaMode %s: the pool opens, and no object bound to it is synced',
    async (schemaMode) => {
      const dir = scratch();
      const { admin, synced, knexOf } = await boot({
        objects: [
          boundTo('lake_note', 'lake'),
          boundTo('lake_orders', 'lake', { external: { remoteName: 'orders' } }),
        ],
      });

      const created = await admin.createDatasource({
        name: 'lake',
        driver: 'sqlite',
        schemaMode,
        external: { validation: { onMismatch: 'warn' } },
        config: { filename: join(dir, 'lake.db') },
      } as never);

      expect(created.status).toBe('ok');
      expect(synced).not.toHaveBeenCalled();
      expect(await knexOf('lake').schema.hasTable('lake_note')).toBe(false);
    },
  );
});
