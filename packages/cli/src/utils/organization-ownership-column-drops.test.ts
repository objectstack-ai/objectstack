// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ceremony's `columnDrops` port (`dropColumnsThroughDrift`) on a REAL SQL
 * driver: the grant's retired `permission_set_id` goes only after the two
 * indexes it keyed (C7b), each dropped through the schema-drift ceremony.
 *
 * The database is a 17.x grant table carrying both legacy indexes under the
 * names the driver gave them, re-synced against today's declaration: schema
 * sync is additive, so the column and both indexes outlive it, and the
 * differ proposes their drops.
 *
 * ⚠️ `@objectstack/driver-sql` resolves to its built `dist/`, so a stale build
 * makes this a verdict about build state. The value import puts the file in
 * the `integration` tier (`vitest-tiers.ts`, KERNEL).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqlDriver, buildIndexName } from '@objectstack/driver-sql';
import { dropColumnsThroughDrift, type ColumnDropTarget } from './organization-ownership-column-drops.js';
import type { ColumnDrop } from './organization-ownership-apply.js';

const T = 'sys_user_permission_set';
const LEGACY_UNIQUE = buildIndexName(T, ['user_id', 'permission_set_id', 'organization_id'], true);
const LEGACY_ID_INDEX = buildIndexName(T, ['permission_set_id'], false);

const fields = {
  user_id: { type: 'text', maxLength: 255 },
  permission_set: { type: 'text', maxLength: 100 },
  organization_id: { type: 'text', maxLength: 255 },
};
/** The 17.x declaration: the id column and its two indexes. */
const LEGACY = {
  name: T,
  tenancy: { enabled: false },
  fields: { ...fields, permission_set_id: { type: 'text', maxLength: 255 } },
  indexes: [
    { fields: ['user_id', 'permission_set_id', 'organization_id'], unique: true },
    { fields: ['permission_set_id'] },
  ],
};
/** Today's declaration: the column and both indexes retired, the key on the name. */
const CURRENT = {
  name: T,
  tenancy: { enabled: false },
  fields,
  indexes: [{ fields: ['user_id', 'permission_set', 'organization_id'], unique: true }],
};
const DROP: ColumnDrop = {
  table: T,
  column: 'permission_set_id',
  retiredIndexes: [
    { columns: ['user_id', 'permission_set_id', 'organization_id'], unique: true },
    { columns: ['permission_set_id'], unique: false },
  ],
};

let dir: string | undefined;
const drivers: SqlDriver[] = [];
afterEach(async () => {
  while (drivers.length) await drivers.pop()!.disconnect().catch(() => {});
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

async function driverOn(file: string, object: typeof LEGACY | typeof CURRENT): Promise<SqlDriver> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: file }, useNullAsDefault: true });
  (driver as any).logger = { debug() {}, info() {}, warn() {}, error() {} };
  drivers.push(driver);
  await driver.initObjects([object]);
  return driver;
}

/** A 17.x database with one grant, booted by today's declaration. */
async function upgraded(): Promise<SqlDriver> {
  dir = mkdtempSync(join(tmpdir(), 'os-c7b-column-drops-'));
  const file = join(dir, 'grants.db');
  const legacy = await driverOn(file, LEGACY);
  await (legacy as any).knex(T).insert({ id: 'g1', user_id: 'u1', permission_set_id: 'ps_1', permission_set: 'member_default', organization_id: 'org_a' });
  await legacy.disconnect();
  drivers.pop();
  return driverOn(file, CURRENT);
}

const target = (driver: SqlDriver, calls: string[][]): ColumnDropTarget => ({
  drift: {
    detectManagedDrift: () => driver.detectManagedDrift(),
    applyMigrationEntries: (entries, opts) => {
      calls.push(entries.map((d) => `${String((d as any).op?.type)}:${String((d as any).op?.indexName ?? (d as any).op?.column)}`));
      return driver.applyMigrationEntries(entries, opts);
    },
  },
  isDeclared: (table) => table === T,
  indexName: (table, columns, unique) => buildIndexName(table, [...columns], unique),
});

const indexNames = async (driver: SqlDriver): Promise<string[]> =>
  ((await (driver as any).knex.raw(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`, [T])) as Array<{ name: string }>)
    .map((r) => r.name)
    .filter((n) => !n.startsWith('sqlite_autoindex'))
    .sort();
const columnNames = async (driver: SqlDriver): Promise<string[]> =>
  ((await (driver as any).knex.raw(`SELECT name FROM pragma_table_info(?)`, [T])) as Array<{ name: string }>).map((r) => r.name);

describe('C7b — the retired grant id column drops after the indexes it keyed', () => {
  it('the fixture is real: the column and both legacy indexes outlive the declaration, and the differ proposes their drops', async () => {
    const driver = await upgraded();
    expect(await columnNames(driver)).toContain('permission_set_id');
    expect(await indexNames(driver)).toEqual(expect.arrayContaining([LEGACY_UNIQUE, LEGACY_ID_INDEX]));
    const ops = (await driver.detectManagedDrift()).map((d) => `${(d as any).op?.type}:${(d as any).op?.indexName ?? (d as any).op?.column}`);
    expect(ops).toEqual(expect.arrayContaining([`drop_index:${LEGACY_UNIQUE}`, `drop_index:${LEGACY_ID_INDEX}`, 'drop_column:permission_set_id']));
  });

  it('drops both indexes in one apply, then the column in a later one; the grant and the new key survive', async () => {
    const driver = await upgraded();
    const calls: string[][] = [];
    expect(await dropColumnsThroughDrift(target(driver, calls), [DROP])).toEqual([
      { table: T, column: 'permission_set_id', outcome: 'dropped' },
    ]);
    expect(calls).toHaveLength(2);
    expect([...calls[0]!].sort()).toEqual([`drop_index:${LEGACY_UNIQUE}`, `drop_index:${LEGACY_ID_INDEX}`].sort());
    expect(calls[1]).toEqual(['drop_column:permission_set_id']);
    expect(await columnNames(driver)).not.toContain('permission_set_id');
    const left = await indexNames(driver);
    expect(left).not.toContain(LEGACY_UNIQUE);
    expect(left).not.toContain(LEGACY_ID_INDEX);
    expect(left).toContain(buildIndexName(T, ['user_id', 'permission_set', 'organization_id'], true));
    expect(await (driver as any).knex(T).select('id', 'permission_set')).toEqual([{ id: 'g1', permission_set: 'member_default' }]);
  });

  it('a column the differ proposes no drop for is not-proposed when declared, not-declared when not, and nothing is applied', async () => {
    const driver = await upgraded();
    const calls: string[][] = [];
    const t = target(driver, calls);
    const outcomes = await dropColumnsThroughDrift(
      { ...t, isDeclared: (table) => table === T },
      [{ table: T, column: 'user_id', retiredIndexes: [{ columns: ['user_id'], unique: false }] }, { table: 'sys_gone', column: 'organization_id' }],
    );
    expect(outcomes).toEqual([
      { table: T, column: 'user_id', outcome: 'not-proposed', detail: 'the drift differ proposed no drop for it' },
      { table: 'sys_gone', column: 'organization_id', outcome: 'not-declared' },
    ]);
    expect(calls).toEqual([]);
  });

  it('an index drop the ceremony skips keeps its column: failed, naming the index, and the column is not dropped', async () => {
    const driver = await upgraded();
    const calls: string[][] = [];
    const t = target(driver, calls);
    const refusing: ColumnDropTarget = {
      ...t,
      drift: {
        detectManagedDrift: t.drift.detectManagedDrift,
        applyMigrationEntries: async (entries, opts) => {
          if (entries.some((d) => (d as any).op?.type === 'drop_index')) {
            calls.push(['refused']);
            return { applied: [], skipped: entries.map((d) => ({ ...d, message: 'refused by the test' })) };
          }
          return t.drift.applyMigrationEntries(entries, opts);
        },
      },
    };
    const [outcome] = await dropColumnsThroughDrift(refusing, [DROP]);
    expect(outcome).toMatchObject({ table: T, column: 'permission_set_id', outcome: 'failed' });
    expect(outcome!.detail).toMatch(/could not be dropped first \(refused by the test\)/);
    expect(calls).toEqual([['refused']]);
    expect(await columnNames(driver)).toContain('permission_set_id');
  });
});
