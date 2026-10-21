// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Test scaffolding [#23184]: one booted sqlite `ObjectQL` engine per test file,
 * emptied before each case that takes it, instead of one boot per case.
 *
 * A suite in this package that builds a real engine over better-sqlite3
 * `:memory:` pays `init()` plus `syncSchemas()` (the DDL for every object it
 * registers) once per case: about 80 ms for the 32 objects a SCIM deployment
 * registers, and 6 to 10 ms for a small fixture set, so a file of 110 cases
 * spends most of a second booting. The engine a case receives from this pool
 * was built by the same `boot` function, so its registry, its hooks and its
 * driver are the ones a fresh boot gives; what the previous case left behind
 * is its ROWS, and those are deleted before the engine is handed out again.
 *
 * What is NOT reset, and why that is safe or refused:
 *
 *  - the engine's in-memory autonumber counters: a pool whose objects declare
 *    an `autonumber` field is refused when it first boots, since a counter
 *    seeded by an earlier case would not restart where a fresh engine does;
 *  - the engine's memo of the install's organizations, which only an engine
 *    write to `sys_organization` invalidates: the rows are deleted below the
 *    engine, so a database that holds an organization row is refused rather
 *    than emptied — unless the pool KEEPS the rows its boot wrote
 *    (`keepBootOrganizations`): they are then left in place, and a case that
 *    changed them is refused, so the memo still describes the table;
 *  - the schema itself: a case that created or dropped a table leaves an
 *    engine a fresh boot would not give, and the next `take()` refuses it;
 *  - the write epoch and the log-once sets: counters and logging only, read by
 *    nothing these suites assert on.
 *
 * A case may hold several engines at once: `take()` hands out a pooled engine
 * no case holds, or boots another. Engines that were taken come back with
 * `release()` in the file's `afterEach`, and `destroy()` closes them all in
 * its `afterAll`. A suite that needs a differently-built engine (other hooks,
 * other objects) boots it itself, as before; only the one `boot` shape is
 * pooled.
 *
 * ```ts
 * const pool = sqliteEnginePool(async () => ({ engine, driver }));
 * afterEach(pool.release);
 * afterAll(pool.destroy);
 * const engine = await pool.take();
 * ```
 */

import type { ObjectQL } from '@objectstack/objectql';
import type { SqlDriver } from '@objectstack/driver-sql';

/** What the pool's `boot` returns: the engine, and the driver it registered as the default. */
export interface BootedSqliteEngine<E extends ObjectQL = ObjectQL> {
  engine: E;
  driver: SqlDriver;
}

export interface SqliteEnginePoolOptions<E extends ObjectQL> {
  /** Per-engine fixture state the suite keeps beside the database (a catalog set, say), reset with it. */
  onReset?: (engine: E) => void | Promise<void>;
  /**
   * Keep the `sys_organization` rows the boot wrote (a Default Organization, say)
   * across resets instead of refusing them. A case that adds, changes or removes
   * one is refused at the next `take()`, as a schema change is.
   */
  keepBootOrganizations?: boolean;
}

export interface SqliteEnginePool<E extends ObjectQL> {
  /** An emptied pooled engine no case holds, or a fresh boot when every pooled engine is held. */
  take(): Promise<E>;
  /** Hand back every engine taken since the last release; the file's `afterEach`. */
  release(): void;
  /** Destroy every engine the pool booted; the file's `afterAll`. */
  destroy(): Promise<void>;
  /** Boots run, and resets performed, since the pool was made. */
  counts(): { boots: number; resets: number };
}

interface Entry<E extends ObjectQL> {
  engine: E;
  driver: SqlDriver;
  /** The tables the boot created, sorted. */
  tables: readonly string[];
  /** The `sys_organization` rows the boot wrote, serialized, when the pool keeps them. */
  bootOrganizations?: string;
  held: boolean;
}

/** The engine's in-memory organization memo is keyed on this object's rows (see the header). */
const ORGANIZATION_TABLE = 'sys_organization';

type Knex = ReturnType<SqlDriver['getKnex']>;

async function organizationRows(knex: Knex): Promise<string> {
  const rows = (await knex(ORGANIZATION_TABLE).select('*')) as Array<Record<string, unknown>>;
  return JSON.stringify(rows.map((row) => JSON.stringify(row)).sort());
}

async function tableNames(knex: Knex): Promise<string[]> {
  const rows = (await knex('sqlite_master').where({ type: 'table' }).select('name')) as Array<{ name: string }>;
  return rows
    .map((row) => row.name)
    .filter((name) => !name.startsWith('sqlite_'))
    .sort();
}

function autonumberFields(engine: ObjectQL): string[] {
  const objects = engine.registry.getAllObjects() as Array<{ name: string; fields?: Record<string, { type?: string }> }>;
  return objects.flatMap((object) =>
    Object.entries(object.fields ?? {})
      .filter(([, field]) => field?.type === 'autonumber')
      .map(([name]) => `${object.name}.${name}`),
  );
}

/** Make a pool over `boot`; see the module header for what a reused engine does and does not carry. */
export function sqliteEnginePool<E extends ObjectQL>(
  boot: () => Promise<BootedSqliteEngine<E>>,
  options: SqliteEnginePoolOptions<E> = {},
): SqliteEnginePool<E> {
  const entries: Array<Entry<E>> = [];
  let boots = 0;
  let resets = 0;

  async function bootEntry(): Promise<Entry<E>> {
    const { engine, driver } = await boot();
    boots += 1;
    const counted = autonumberFields(engine);
    if (counted.length > 0) {
      try {
        await engine.destroy();
      } catch {
        /* noop */
      }
      throw new Error(
        `sqliteEnginePool: ${counted.join(', ')} declare an autonumber field, whose counter the engine keeps in ` +
          'memory across a reset; boot that engine per case instead of pooling it.',
      );
    }
    const tables = await tableNames(driver.getKnex());
    const entry: Entry<E> = { engine, driver, tables, held: true };
    if (options.keepBootOrganizations && tables.includes(ORGANIZATION_TABLE)) {
      entry.bootOrganizations = await organizationRows(driver.getKnex());
    }
    entries.push(entry);
    return entry;
  }

  async function empty(entry: Entry<E>): Promise<void> {
    const knex = entry.driver.getKnex();
    const tables = await tableNames(knex);
    if (tables.join('\n') !== entry.tables.join('\n')) {
      const added = tables.filter((t) => !entry.tables.includes(t));
      const dropped = entry.tables.filter((t) => !tables.includes(t));
      throw new Error(
        `sqliteEnginePool: a case changed this engine's schema (created: ${added.join(', ') || 'none'}; ` +
          `dropped: ${dropped.join(', ') || 'none'}), so it is no longer the engine a fresh boot gives. ` +
          'Boot that case its own engine.',
      );
    }
    const keptOrganizations = entry.bootOrganizations !== undefined;
    if (keptOrganizations && (await organizationRows(knex)) !== entry.bootOrganizations) {
      throw new Error(
        `sqliteEnginePool: a case changed the ${ORGANIZATION_TABLE} rows this pool keeps from the boot, and the ` +
          'engine memoizes the organization set until an engine write to that object invalidates it. Boot that ' +
          'case its own engine.',
      );
    }
    if (tables.includes(ORGANIZATION_TABLE) && !keptOrganizations) {
      const [row] = (await knex(ORGANIZATION_TABLE).count({ n: '*' })) as Array<{ n: number | string }>;
      if (Number(row?.n ?? 0) > 0) {
        throw new Error(
          `sqliteEnginePool: a case left ${row?.n} ${ORGANIZATION_TABLE} row(s), and the engine memoizes the ` +
            'organization set until an engine write to that object invalidates it; deleting them below the ' +
            'engine would hand the next case a stale memo. Boot that case its own engine.',
        );
      }
    }
    await knex.transaction(async (trx) => {
      // Checked at commit, when every table is empty: the delete order does not matter.
      await trx.raw('PRAGMA defer_foreign_keys = ON');
      for (const table of tables) {
        if (keptOrganizations && table === ORGANIZATION_TABLE) continue;
        await trx(table).del();
      }
      const [sequence] = (await trx('sqlite_master').where({ type: 'table', name: 'sqlite_sequence' })) as unknown[];
      if (sequence) await trx('sqlite_sequence').del();
    });
    await options.onReset?.(entry.engine);
    resets += 1;
  }

  return {
    async take() {
      const free = entries.find((entry) => !entry.held);
      if (!free) return (await bootEntry()).engine;
      free.held = true;
      await empty(free);
      return free.engine;
    },
    release() {
      for (const entry of entries) entry.held = false;
    },
    async destroy() {
      while (entries.length) {
        const entry = entries.pop()!;
        try {
          await entry.engine.destroy();
        } catch {
          /* noop */
        }
      }
    },
    counts: () => ({ boots, resets }),
  };
}
