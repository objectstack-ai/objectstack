// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4 and D8 row R11, #31699] `sys_connector_connection`'s
 * package-less guard, `uniq_sys_connector_connection_packageless`, stands from
 * the table's first DDL, through a booted kernel, with the object's own key.
 *
 * The connection's key is `(organization_id, connector_package,
 * connector_name)` (the maintainer's ruling on #31699: unique by package and
 * name), and `connector_package` is NULL-distinct. Every connection of an
 * instance the environment authored or a plugin registers in code names no
 * package, so for exactly those the declared key alone constrains nothing. The
 * guard keeps them to one per `(organization_id, connector_name)`.
 *
 * Real `ObjectKernel`, real `ObjectQLPlugin` (its built-in protocol assembly,
 * which arms metadata-protocol's migrations) over a real in-memory SQLite
 * driver, and the shipped {@link SysConnectorConnection}: read from the object,
 * not restated, so the pin measures the key this package declares. A fixture
 * plugin ordered after `ObjectQLPlugin` writes connections from its own
 * `start()`, before `kernel:ready`, through the driver's own connection, so no
 * hook decides the answer: the physical indexes do.
 *
 * The grant guard's pins (`plugin-security`'s
 * `user-permission-set-guard-at-schema-sync.test.ts`) measure the gate-off
 * kernels and the re-ensure for the shared machinery; this file pins the
 * connection table's own wiring (the subscription in metadata-protocol's
 * assembly) and its key.
 *
 * Ablation (recorded in the PR): with `ensureConnectionGuard()` removed from
 * the `objectql:schema-synced` handler in `metadata-protocol`'s `plugin.ts`,
 * the boot pins go red at the second package-less connection.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, OBJECTQL_SCHEMA_SYNCED_HOOK, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver, buildIndexName } from '@objectstack/driver-sql';
import {
  CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME,
  CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS,
  CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME,
} from '@objectstack/metadata-protocol';
import { SysConnectorConnection } from './sys-connector-connection.object.js';

const CONNECTIONS = 'sys_connector_connection';

function sqliteDriverPlugin(): Plugin {
  return {
    name: 'test.driver.sqlite',
    type: 'standard',
    version: '1.0.0',
    async init(ctx: PluginContext) {
      ctx.registerService(
        'driver.default',
        new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
      );
    },
  };
}

function connectionObjectPlugin(): Plugin {
  return {
    name: 'test.connection-object',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.connection-object',
        namespace: 'sys',
        version: '1.0.0',
        type: 'plugin',
        name: 'Connection object',
        objects: [SysConnectorConnection],
      });
    },
  };
}

type Outcome = 'ok' | 'refused';

/**
 * The connections the early writer lands, in order, all of instance name
 * `billing` in one organization: two naming no package, two packages' own,
 * then a second of the first package's.
 */
const WRITES: ReadonlyArray<{ id: string; connector_package: string | null }> = [
  { id: 'c1', connector_package: null },
  { id: 'c2', connector_package: null },
  { id: 'c3', connector_package: 'com.acme.crm' },
  { id: 'c4', connector_package: 'com.acme.hr' },
  { id: 'c5', connector_package: 'com.acme.crm' },
];

function earlyConnectionWriter(seen: { outcomes: Outcome[]; afterReady?: boolean; ctx?: PluginContext }): Plugin {
  let ready = false;
  return {
    name: 'test.early-connection-writer',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql', 'test.connection-object'],
    async init(ctx: PluginContext) {
      seen.ctx = ctx;
      ctx.hook('kernel:ready', async () => {
        ready = true;
      });
    },
    async start(ctx: PluginContext) {
      seen.afterReady = ready;
      const ql = ctx.getService<ObjectQL>('objectql');
      const knex = (ql as any).getDriver(CONNECTIONS).knex;
      for (const w of WRITES) {
        try {
          await knex(CONNECTIONS).insert({
            id: w.id,
            organization_id: 'org_1',
            connector_name: 'billing',
            connector_package: w.connector_package,
            grant: 'authorization_code',
            status: 'connected',
            revision: 1,
          });
          seen.outcomes.push('ok');
        } catch {
          seen.outcomes.push('refused');
        }
      }
    },
  };
}

let kernel: ObjectKernel | undefined;
afterEach(async () => {
  try {
    await kernel?.shutdown();
  } catch {
    /* a refused boot leaves the kernel stopped */
  }
  kernel = undefined;
});

async function boot(bootPhaseHooks: boolean) {
  const seen: { outcomes: Outcome[]; afterReady?: boolean; ctx?: PluginContext } = { outcomes: [] };
  kernel = new ObjectKernel({ logger: { level: 'silent' }, bootPhaseHooks });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin());
  await kernel.use(connectionObjectPlugin());
  await kernel.use(earlyConnectionWriter(seen));
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const knex = (ql as any).getDriver(CONNECTIONS).knex;
  const indexNames = async (): Promise<string[]> =>
    ((await knex.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?", [CONNECTIONS])) as Array<{
      name: string;
    }>).map((i) => i.name);
  return { seen, indexNames: await indexNames(), readIndexNames: indexNames, ql, knex };
}

describe('[#31699] the package-less connection guard stands from schema sync, before any later start() writes', () => {
  it('a fresh database: a second connection naming no package is refused, two packages’ connections of one name are admitted, a second of one package’s is refused', async () => {
    const { seen, indexNames } = await boot(true);
    expect(seen.afterReady).toBe(false);
    expect(seen.outcomes).toEqual(['ok', 'refused', 'ok', 'ok', 'refused']);
    expect(indexNames).toContain(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME);
    // A fresh database never carries the old two-column key where the guard has a form.
    expect(indexNames).not.toContain(CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME);
  });

  it('a bootPhaseHooks: false host (no kernel:ready) refuses it too', async () => {
    const { seen, indexNames } = await boot(false);
    expect(seen.afterReady).toBe(false);
    expect(seen.outcomes).toEqual(['ok', 'refused', 'ok', 'ok', 'refused']);
    expect(indexNames).toContain(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME);
  });

  it('a later pass builds it again after the table lost it', async () => {
    const { seen, readIndexNames, ql, knex } = await boot(true);
    await knex.raw(`DROP INDEX ${CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME}`);
    expect(await readIndexNames()).not.toContain(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME);
    await seen.ctx!.trigger(OBJECTQL_SCHEMA_SYNCED_HOOK, ql);
    expect(await readIndexNames()).toContain(CONNECTOR_CONNECTION_PACKAGELESS_INDEX_NAME);
  });
});

describe('[#31699] the names metadata-protocol spells as literals, pinned against their owners', () => {
  it('the old key it keeps on a dialect with no guard form is the name driver-sql generates for the key this object declared before', () => {
    expect(CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME).toBe(
      buildIndexName(CONNECTIONS, [...CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS], true),
    );
  });

  it('the guard key is the object key minus the package column, in the object key’s order', () => {
    const unique = (SysConnectorConnection.indexes ?? []).filter((i: any) => i.unique);
    expect(unique.map((i: any) => i.fields)).toEqual([['organization_id', 'connector_package', 'connector_name']]);
    expect([...CONNECTOR_CONNECTION_PACKAGELESS_INDEX_COLUMNS]).toEqual(
      unique[0]!.fields.filter((f: string) => f !== 'connector_package'),
    );
  });
});
