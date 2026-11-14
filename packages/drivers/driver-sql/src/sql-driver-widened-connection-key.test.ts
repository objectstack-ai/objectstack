// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0150 D4 and D8 row R11, #31699] The connector connection's key gained
 * its package column: `sys_connector_connection`'s
 * `{ fields: ['connector_name'], unique: 'organization' }`, built as
 * `(organization_id, connector_name)`, became `(organization_id,
 * connector_package, connector_name)` (`unique: 'global'`, the organization
 * column listed). The grant key's case (`sql-driver-widened-grant-key.test.ts`)
 * on the connection table, over a real SQLite database:
 *
 *  - before `metadata-protocol`'s package-less guard stands, the old key is
 *    KEPT — no safe replace and no orphan drop — because the gained column is
 *    nullable and the old key is the only rule keeping package-less connections
 *    to one;
 *  - once the guard stands (the statement `metadata-protocol` runs on SQLite,
 *    verbatim), the plan is one SAFE replace; applied without
 *    `allowDestructive`, the re-plan is empty, and the rows answer: a second
 *    package-less connection of one instance in one organization refused, two
 *    packages admitted, one package twice refused;
 *  - CONTROL, the spelling not taken: `unique: 'organization'` over
 *    `(connector_package, connector_name)` leaves the old key to the orphan arm,
 *    a DESTRUCTIVE `drop_index`, so a safe apply keeps refusing the second
 *    package's connection.
 *
 * The live cells (PostgreSQL, MySQL) run the same upgrade over a real server
 * with the statement `metadata-protocol` runs there. On MySQL the guard is a
 * functional key part, which `driver-sql`'s introspection reads as an
 * expression rather than as a partial guard, so the widening arm KEEPS the old
 * key: a declared limit, pinned so that teaching the driver to read it turns the
 * pin red on purpose. It loosens nothing; the old key keeps refusing what it
 * refused.
 *
 * The table first shipped in 18.3.0, after plain organization keys (18.1.0), so
 * no released database carries its old key in ADR-0120 D3's NULL-safe form.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { SqlDriver } from './index.js';
import { buildIndexName } from './schema-drift.js';
import { MYSQL_CELL, PG_CELL, declareDialectCell } from './live-dialect-matrix.testkit.js';

const CONNECTIONS = 'sys_connector_connection';
const GUARD_NAME = 'uniq_sys_connector_connection_packageless';
/** `buildConnectorConnectionPackagelessIndexSql(undefined)` in metadata-protocol, verbatim. */
const GUARD_SQL =
  `CREATE UNIQUE INDEX IF NOT EXISTS ${GUARD_NAME} ON ${CONNECTIONS} (organization_id, connector_name) ` +
  'WHERE connector_package IS NULL';
/** metadata-protocol's `CONNECTOR_CONNECTION_OLD_KEY_INDEX_NAME`, verbatim. */
const OLD_KEY_NAME = 'uniq_sys_connector_connection_organization_id_connector_name';

const OLD_INDEXES = [{ fields: ['connector_name'], unique: 'organization' as const }];
const NEW_INDEXES = [{ fields: ['organization_id', 'connector_package', 'connector_name'], unique: 'global' as const }];

const connections = (indexes: unknown[]) => [{
  name: CONNECTIONS,
  fields: {
    // As service-automation declares them: the package-id width class.
    organization_id: { type: 'text', required: true, maxLength: 255 },
    connector_name: { type: 'text', required: true, maxLength: 255 },
    connector_package: { type: 'text', maxLength: 255 },
  },
  indexes,
}];

describe('the connection key widened by its package column — a real SQLite database', () => {
  let driver: SqlDriver | undefined;
  afterEach(async () => {
    await driver?.disconnect();
    driver = undefined;
  });

  const uniqueIndexes = async (): Promise<Array<{ name: string; sql: string | null }>> =>
    (driver as any).knex.raw(
      `SELECT name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name = '${CONNECTIONS}' AND name LIKE 'uniq_%' ORDER BY name`,
    );
  const columnsOf = (sql: string | null) => /\(([^)]*)\)/.exec(sql ?? '')?.[1]?.replace(/`/g, '') ?? '';
  const drift = async () => ((await driver!.detectManagedDrift()) as any[]).filter((e) => e.table === CONNECTIONS);
  const lands = async (id: string, pkg: string | null): Promise<boolean> => {
    try {
      await (driver as any).knex(CONNECTIONS).insert({ id, organization_id: 'org_1', connector_name: 'github', connector_package: pkg });
      return true;
    } catch {
      return false;
    }
  };

  async function upgraded(next = NEW_INDEXES as unknown[]): Promise<{ oldName: string; newName: string }> {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    (driver as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
    // The database an earlier release built…
    await driver.initObjects(connections(OLD_INDEXES) as any);
    const before = await uniqueIndexes();
    expect(before.map((i) => [i.name, columnsOf(i.sql)])).toEqual([[OLD_KEY_NAME, 'organization_id, connector_name']]);
    // …booted by this release's declaration.
    await driver.initObjects(connections(next) as any);
    const after = await uniqueIndexes();
    const newName = after.find((i) => columnsOf(i.sql) === 'organization_id, connector_package, connector_name')?.name;
    expect(newName).toBeTruthy();
    return { oldName: before[0].name, newName: newName! };
  }

  it('the old key\'s name is the one metadata-protocol builds where its guard has no form', () => {
    expect(buildIndexName(CONNECTIONS, ['organization_id', 'connector_name'], true)).toBe(OLD_KEY_NAME);
  });

  it('without the package-less guard the old key is KEPT: no replace, no orphan drop', async () => {
    const { oldName } = await upgraded();
    const plan = await drift();
    expect(plan).toEqual([]);
    expect((await uniqueIndexes()).map((i) => i.name)).toContain(oldName);
    // Still refusing what it refused, the second package's connection among it.
    expect(await lands('a', 'com.acme.crm')).toBe(true);
    expect(await lands('b', 'com.acme.hr')).toBe(false);
    expect(await lands('c', null)).toBe(false);
  });

  it('with the guard: one SAFE replace, applied without allowDestructive; re-plan empty; nothing the old key refused among package-less rows is admitted', async () => {
    const { oldName, newName } = await upgraded();
    await (driver as any).knex.raw(GUARD_SQL);

    const plan = await drift();
    expect(plan.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
    expect(plan[0].op).toMatchObject({ dropIndexNames: [oldName], createIndexName: newName });
    expect(plan[0].message).toContain('connector_package is nullable');

    const { applied, skipped } = await driver!.applyMigrationEntries(plan);
    expect([applied.length, skipped]).toEqual([1, []]);
    expect((await uniqueIndexes()).map((i) => i.name).sort()).toEqual([GUARD_NAME, newName].sort());
    expect(await drift()).toEqual([]);

    expect(await lands('n1', null)).toBe(true);
    expect(await lands('n2', null)).toBe(false);
    expect(await lands('p1', 'com.acme.crm')).toBe(true);
    expect(await lands('p2', 'com.acme.hr')).toBe(true);
    expect(await lands('p3', 'com.acme.crm')).toBe(false);

    // A second boot of this release leaves everything as it is.
    await driver!.initObjects(connections(NEW_INDEXES) as any);
    expect(await drift()).toEqual([]);
  });

  it('CONTROL — spelled `unique: \'organization\'`, the old key is an orphan whose drop is DESTRUCTIVE, and a safe apply keeps it', async () => {
    const { oldName } = await upgraded([{ fields: ['connector_package', 'connector_name'], unique: 'organization' }]);
    await (driver as any).knex.raw(GUARD_SQL);
    const plan = await drift();
    expect(plan.map((e) => [e.op.type, e.category])).toEqual([['drop_index', 'destructive']]);
    expect(plan[0].op).toMatchObject({ indexName: oldName });
    await driver!.applyMigrationEntries(plan.filter((e) => e.category === 'safe'));
    expect(await lands('a', 'com.acme.crm')).toBe(true);
    expect(await lands('b', 'com.acme.hr')).toBe(false);
  });
});

// ── The live cells ─────────────────────────────────────────────────────────

/** `buildConnectorConnectionPackagelessIndexSql('mysql2')` in metadata-protocol, verbatim. */
const MYSQL_GUARD_SQL =
  `CREATE UNIQUE INDEX ${GUARD_NAME} ON ${CONNECTIONS} ` +
  '((CASE WHEN connector_package IS NULL THEN unhex(sha2(concat(organization_id, 0x1f, connector_name), 256)) END))';

for (const cell of [PG_CELL, MYSQL_CELL]) {
  declareDialectCell(cell, 'connection key widened by its package column (#31699)', (c) => {
    describe(`the connection key widened by its package column on ${c.label}`, () => {
      let live: SqlDriver | undefined;
      afterEach(async () => {
        await live?.execute(`drop table if exists ${CONNECTIONS}`).catch(() => {});
        await live?.disconnect().catch(() => {});
        live = undefined;
      });

      const lands = async (id: string, pkg: string | null): Promise<boolean> => {
        try {
          await (live as any).knex(CONNECTIONS).insert({ id, organization_id: 'org_1', connector_name: 'github', connector_package: pkg });
          return true;
        } catch {
          return false;
        }
      };
      const drift = async () => ((await live!.detectManagedDrift()) as any[]).filter((e) => e.table === CONNECTIONS);

      it(c.id === 'pg'
        ? 'with the guard: one SAFE replace, applied; re-plan empty; a second package admitted, a second package-less row refused'
        : 'DECLARED LIMIT: the functional guard is not read as the partial guard, so the old key is KEPT and still refuses a second package',
      async () => {
        live = new SqlDriver(c.config());
        (live as any).logger = { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() };
        await live.execute(`drop table if exists ${CONNECTIONS}`);
        await live.initObjects(connections(OLD_INDEXES) as any);
        await live.initObjects(connections(NEW_INDEXES) as any);
        expect(await drift()).toEqual([]);
        await live.execute(c.id === 'pg' ? GUARD_SQL : MYSQL_GUARD_SQL);

        const plan = await drift();
        if (c.id === 'pg') {
          expect(plan.map((e) => [e.op.type, e.category])).toEqual([['replace_unique_index', 'safe']]);
          expect(plan[0].op).toMatchObject({ dropIndexNames: [OLD_KEY_NAME] });
          const { applied, skipped } = await live.applyMigrationEntries(plan);
          expect([applied.length, skipped]).toEqual([1, []]);
          expect(await drift()).toEqual([]);
          expect(await lands('p1', 'com.acme.crm')).toBe(true);
          expect(await lands('p2', 'com.acme.hr')).toBe(true);
          expect(await lands('p3', 'com.acme.crm')).toBe(false);
          expect(await lands('n1', null)).toBe(true);
          expect(await lands('n2', null)).toBe(false);
        } else {
          // Nothing offered — neither the replace nor an orphan drop of either index.
          expect(plan.filter((e) => String(e.op.type).endsWith('_index'))).toEqual([]);
          expect(await lands('p1', 'com.acme.crm')).toBe(true);
          expect(await lands('p2', 'com.acme.hr')).toBe(false);
          expect(await lands('n1', null)).toBe(false);
        }
      });
    });
  });
}
