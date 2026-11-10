// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4, #32164, epic ruling MF6] `sys_user_permission_set`'s
 * package-less guard, `uniq_sys_user_permission_set_packageless`, stands from
 * the table's first DDL, as the three-column key it stands in for did — not
 * from `kernel:ready`.
 *
 * The key ADR-0150 D4 gives the grant, `(user_id, permission_set,
 * permission_set_package, organization_id)`, is NULL-distinct, and every grant
 * written before the boot seals the holders names no package, so on a fresh
 * database that key alone constrains none of the bootstrap grants. A writer that is
 * find-then-insert and leans on the unique index (`auto-org-admin-grant.ts`)
 * lands twice when two replicas boot together. Built at `kernel:ready`, the
 * guard came after every plugin's `start()`, and never on a
 * `bootPhaseHooks: false` host.
 *
 * Real `ObjectKernel`, real `ObjectQLPlugin` (its built-in protocol assembly,
 * which arms metadata-protocol's migrations) over a real in-memory SQLite
 * driver, and the grant object with the key ADR-0150 D4 gives it,
 * {@link WIDENED_KEY}: stated here rather than read from the object, so the
 * pin measures the guard against that key whichever change lands first (with
 * the three-column key the second package-less grant is refused without any
 * guard, and the pin could not go red). A fixture plugin
 * ordered after `ObjectQLPlugin` writes grants from its own `start()`, through
 * the driver's own connection so no hook decides the answer: the physical
 * index does.
 *
 * On every kernel whose schema sync runs the table's DDL (MF6's review,
 * must-fix 1): a kernel with an `environmentId` and no declared
 * `runPlatformMigrations` (a per-project kernel) and one that declares it
 * `false` (as every one-shot CLI boot does) have the boot-repair gate off, and
 * both create this table at their own schema sync, so both build the guard.
 * The CLI's no-write and flush faces are pinned in `packages/cli`'s
 * `schema-migrate.grant-guard.integration.test.ts`.
 *
 * Ablations (recorded in the PR): with the `objectql:schema-synced` subscription
 * removed from metadata-protocol's assembly, leaving the `kernel:ready` build,
 * the first two boot pins go red at the second package-less grant; with it
 * moved back inside the `runPlatformMigrations` gate, the two gate-off pins go
 * red; with `created` latched, the re-ensure pin goes red.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { ObjectKernel, type Plugin, type PluginContext } from '@objectstack/core';
import { ObjectQLPlugin, OBJECTQL_SCHEMA_SYNCED_HOOK, type ObjectQL } from '@objectstack/objectql';
import { SqlDriver, buildIndexName } from '@objectstack/driver-sql';
import {
  USER_PERMISSION_SET_OLD_KEY_INDEX_NAME,
  USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS,
  USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME,
} from '@objectstack/metadata-protocol';
import { SysUserPermissionSet } from './objects/sys-user-permission-set.object.js';

const GRANTS = 'sys_user_permission_set';

/** The grant's key under ADR-0150 D4: the package column joins it, NULL-distinct on every part. */
const WIDENED_KEY = {
  fields: ['user_id', 'permission_set', 'permission_set_package', 'organization_id'],
  unique: 'global',
} as const;
const GRANT_OBJECT = {
  ...SysUserPermissionSet,
  indexes: [WIDENED_KEY, { fields: ['user_id'] }, { fields: ['organization_id'] }],
};

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

function grantObjectPlugin(): Plugin {
  return {
    name: 'test.grant-object',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql'],
    async init(ctx: PluginContext) {
      ctx.getService<{ register(m: unknown): unknown }>('manifest').register({
        id: 'test.grant-object',
        namespace: 'sys',
        version: '1.0.0',
        type: 'plugin',
        name: 'Grant object',
        objects: [GRANT_OBJECT],
      });
    },
  };
}

type Outcome = 'ok' | 'refused';

/** The grants the early writer lands, in order: two naming no package, then two packages' grants of that set. */
const WRITES: ReadonlyArray<{ id: string; permission_set_package: string | null }> = [
  { id: 'g1', permission_set_package: null },
  { id: 'g2', permission_set_package: null },
  { id: 'g3', permission_set_package: 'com.acme.crm' },
  { id: 'g4', permission_set_package: 'com.acme.hr' },
];

/**
 * Writes {@link WRITES} from its `start()`, which runs after `ObjectQLPlugin`'s
 * (its dependency) and before `kernel:ready`. Records whether `kernel:ready`
 * had fired by then, so a pin cannot pass by writing late.
 */
function earlyGrantWriter(seen: { outcomes: Outcome[]; afterReady?: boolean; ctx?: PluginContext }): Plugin {
  let ready = false;
  return {
    name: 'test.early-grant-writer',
    type: 'standard',
    version: '1.0.0',
    dependencies: ['com.objectstack.engine.objectql', 'test.grant-object'],
    async init(ctx: PluginContext) {
      seen.ctx = ctx;
      ctx.hook('kernel:ready', async () => {
        ready = true;
      });
    },
    async start(ctx: PluginContext) {
      seen.afterReady = ready;
      const ql = ctx.getService<ObjectQL>('objectql');
      const knex = (ql as any).getDriver(GRANTS).knex;
      for (const w of WRITES) {
        try {
          await knex(GRANTS).insert({
            id: w.id,
            user_id: 'usr_1',
            permission_set: 'sales_rep',
            permission_set_package: w.permission_set_package,
            organization_id: 'org_1',
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

async function boot(
  bootPhaseHooks: boolean,
  engine: { environmentId?: string; runPlatformMigrations?: boolean } = {},
) {
  const seen: { outcomes: Outcome[]; afterReady?: boolean; ctx?: PluginContext } = { outcomes: [] };
  kernel = new ObjectKernel({ logger: { level: 'silent' }, bootPhaseHooks });
  await kernel.use(sqliteDriverPlugin());
  await kernel.use(new ObjectQLPlugin(engine));
  await kernel.use(grantObjectPlugin());
  await kernel.use(earlyGrantWriter(seen));
  await kernel.bootstrap();
  const ql = kernel.getService<ObjectQL>('objectql');
  const knex = (ql as any).getDriver(GRANTS).knex;
  const indexNames = async (): Promise<string[]> =>
    ((await knex.raw("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?", [GRANTS])) as Array<{
      name: string;
    }>).map((i) => i.name);
  return { seen, indexNames: await indexNames(), readIndexNames: indexNames, ql, knex };
}

describe('[#32164 MF6] the package-less grant guard stands from schema sync, before any later start() writes', () => {
  it('a fresh database: the second grant naming no package, written in a start() before kernel:ready, is refused; two packages’ grants of that set are admitted', async () => {
    const { seen, indexNames } = await boot(true);
    expect(seen.afterReady).toBe(false);
    expect(seen.outcomes).toEqual(['ok', 'refused', 'ok', 'ok']);
    expect(indexNames).toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);
  });

  it('a bootPhaseHooks: false host (no kernel:ready) refuses it too, and the guard stands after bootstrap', async () => {
    const { seen, indexNames } = await boot(false);
    expect(seen.afterReady).toBe(false);
    expect(seen.outcomes).toEqual(['ok', 'refused', 'ok', 'ok']);
    expect(indexNames).toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);
  });

  it('a fresh database gets no old three-column key where the guard has a form (SQLite)', async () => {
    const { indexNames } = await boot(true);
    expect(indexNames).not.toContain(USER_PERMISSION_SET_OLD_KEY_INDEX_NAME);
  });
});

describe('[#32164 MF6, review must-fix 1] on every kernel whose schema sync runs the table\'s DDL, whatever its boot-repair gate says', () => {
  it('a kernel with an environmentId and no declared runPlatformMigrations (gate off): the guard stands from schema sync', async () => {
    const { seen, indexNames } = await boot(true, { environmentId: 'env_project_a' });
    expect(seen.afterReady).toBe(false);
    expect(seen.outcomes).toEqual(['ok', 'refused', 'ok', 'ok']);
    expect(indexNames).toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);
  });

  it('a kernel that declares runPlatformMigrations: false (a one-shot CLI boot\'s posture), with bootPhaseHooks: false too: the guard stands from schema sync', async () => {
    const { seen, indexNames } = await boot(false, { runPlatformMigrations: false });
    expect(seen.afterReady).toBe(false);
    expect(seen.outcomes).toEqual(['ok', 'refused', 'ok', 'ok']);
    expect(indexNames).toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);
  });
});

describe('[#32164 review should-fix 2] a later pass re-ensures a guard the table lost', () => {
  it('dropped after the boot (as a SQLite table rebuild drops every undeclared index), the next schema-sync pass builds it again', async () => {
    const { seen, readIndexNames, ql, knex } = await boot(true);
    expect(await readIndexNames()).toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);

    await knex.raw(`DROP INDEX ${USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME}`);
    expect(await readIndexNames()).not.toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);

    // The event the next pass triggers (a `metadata:reloaded` re-sync, or a
    // flushed one-shot pass), as `ObjectQLPlugin` triggers it.
    await seen.ctx!.trigger(OBJECTQL_SCHEMA_SYNCED_HOOK, ql);
    expect(await readIndexNames()).toContain(USER_PERMISSION_SET_PACKAGELESS_INDEX_NAME);
  });
});

describe('[#32164 MF6] the names metadata-protocol spells as literals, pinned against their owners', () => {
  it('the event it subscribes to is the one ObjectQLPlugin triggers', () => {
    // The boot pins above fail if metadata-protocol subscribed to any other
    // name; this line names the constant those pins exercise.
    expect(OBJECTQL_SCHEMA_SYNCED_HOOK).toBe('objectql:schema-synced');
  });

  it('the old key it keeps on a dialect with no guard form is the name driver-sql generates for that key', () => {
    expect(USER_PERMISSION_SET_OLD_KEY_INDEX_NAME).toBe(buildIndexName(GRANTS, [...USER_PERMISSION_SET_PACKAGELESS_INDEX_COLUMNS], true));
  });
});
