// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `update()`, `delete()` and `bulkDelete()` find their row through
 * `external.columnMap` (ADR-0015 §18).
 *
 * The write payload has been mapped since columnMap landed
 * (`applyWriteColumnMap`), and so has the insert read-back
 * (`readBackInsertedRows`). The by-id doors were not: they wrote
 * `WHERE "id" = ?` whatever the map said, so on a federated object whose key
 * column is `CUST_NO` they asked for a column the remote table does not have.
 * Measured before the fix on SQLite (this file).
 *
 * The second fixture is the silent half: a remote table that ALSO has a
 * column literally named `id`, which is not the mapped key. The unmapped
 * statement then updated and deleted rows by THAT column.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { SqlDriver } from './index.js';

async function driverOver(ddl: string, rows: string[]): Promise<any> {
  const d = new SqlDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
    pool: { min: 1, max: 1 },
    schemaMode: 'external',
  } as any) as any;
  d.name = 'extds';
  await d.connect();
  await d.knex.raw(ddl);
  for (const row of rows) await d.knex.raw(row);
  return d;
}

let driver: any;
afterEach(async () => { await driver?.disconnect(); driver = undefined; });

describe('by-id writes over a columnMap-ed key', () => {
  const ddl = 'create table legacy_cust (CUST_NO text primary key, FULL_NAME text)';
  const rows = ["insert into legacy_cust values ('c1', 'Aurora'), ('c2', 'Borealis'), ('c3', 'Cyan')"];
  const register = (d: any) => d.registerExternalObject({
    name: 'cust',
    external: { remoteName: 'legacy_cust', columnMap: { CUST_NO: 'id', FULL_NAME: 'name' } },
    fields: { name: { type: 'text' } },
  });

  it('update() writes the row the mapped key names and reads it back', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    expect(await driver.update('cust', 'c2', { name: 'Bore' })).toEqual({ id: 'c2', name: 'Bore' });
    expect(await driver.findOne('cust', { where: { id: 'c2' } })).toEqual({ id: 'c2', name: 'Bore' });
  });

  it('delete() removes the row the mapped key names', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    expect(await driver.delete('cust', 'c1')).toBe(true);
    expect((await driver.find('cust', {})).map((r: any) => r.id).sort()).toEqual(['c2', 'c3']);
  });

  it('bulkDelete() removes the rows the mapped keys name', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    await driver.bulkDelete('cust', ['c1', 'c3']);
    expect((await driver.find('cust', {})).map((r: any) => r.id)).toEqual(['c2']);
  });
});

describe('a remote table with its own unmapped `id` column (the silent case)', () => {
  // `id` here is a surrogate the remote system owns; the object's key is CODE.
  const ddl = 'create table legacy_part (id integer, CODE text primary key, LABEL text)';
  const rows = ["insert into legacy_part values (1, 'B', 'bolt'), (2, 'A', 'anchor')"];
  const register = (d: any) => d.registerExternalObject({
    name: 'part',
    external: { remoteName: 'legacy_part', columnMap: { CODE: 'id', LABEL: 'label' } },
    fields: { label: { type: 'text' } },
  });

  it('update() by key does not touch the row whose surrogate equals the key', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    // Key 'A' is the row with surrogate id 2. The unmapped statement matched
    // `id = 'A'` (no row) and answered null; the mapped one updates CODE 'A'.
    expect(await driver.update('part', 'A', { label: 'anchor!' })).toEqual({ id: 'A', label: 'anchor!' });
    const raw = await driver.knex('legacy_part').select('id', 'CODE', 'LABEL').orderBy('id');
    expect(raw).toEqual([
      { id: 1, CODE: 'B', LABEL: 'bolt' },
      { id: 2, CODE: 'A', LABEL: 'anchor!' },
    ]);
  });

  it('delete() by key removes that row, not the one whose surrogate matches', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    // Key '1' names no row by CODE; the unmapped statement deleted surrogate 1.
    expect(await driver.delete('part', '1')).toBe(false);
    expect(await driver.knex('legacy_part').count({ n: '*' })).toEqual([{ n: 2 }]);
  });
});

describe('upsert() over a columnMap-ed key', () => {
  // The conflict target and the read-back both name the key's mapped column.
  // Unmapped, the statement said `on conflict ("id")` — a column this table
  // does not have — and every upsert failed.
  const ddl = 'create table legacy_cust (CUST_NO text primary key, FULL_NAME text)';
  const rows = ["insert into legacy_cust values ('c1', 'Aurora'), ('c2', 'Borealis')"];
  const register = (d: any) => d.registerExternalObject({
    name: 'cust',
    external: { remoteName: 'legacy_cust', columnMap: { CUST_NO: 'id', FULL_NAME: 'name' } },
    fields: { name: { type: 'text' } },
  });

  it('merges onto the row an existing key names', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    expect(await driver.upsert('cust', { id: 'c2', name: 'Bore' })).toEqual({ id: 'c2', name: 'Bore' });
    const raw = await driver.knex('legacy_cust').select('CUST_NO', 'FULL_NAME').orderBy('CUST_NO');
    expect(raw).toEqual([
      { CUST_NO: 'c1', FULL_NAME: 'Aurora' },
      { CUST_NO: 'c2', FULL_NAME: 'Bore' },
    ]);
  });

  it('inserts a new key and reads it back', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    expect(await driver.upsert('cust', { id: 'c9', name: 'Nine' })).toEqual({ id: 'c9', name: 'Nine' });
    expect(await driver.knex('legacy_cust').count({ n: '*' })).toEqual([{ n: 3 }]);
  });

  it('an explicit conflictKeys naming the key field resolves through the map', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    expect(await driver.upsert('cust', { id: 'c1', name: 'Aurora2' }, ['id'])).toEqual({ id: 'c1', name: 'Aurora2' });
    expect(await driver.knex('legacy_cust').where('CUST_NO', 'c1').first('FULL_NAME')).toEqual({ FULL_NAME: 'Aurora2' });
  });
});

describe('upsert() on a remote table with its own unmapped `id` column (the silent case)', () => {
  // `id` is the remote system's surrogate; the object's key is CODE.
  const ddl = 'create table legacy_part (id integer unique, CODE text primary key, LABEL text)';
  const rows = ["insert into legacy_part values (1, 'B', 'bolt'), (2, 'A', 'anchor')"];
  const register = (d: any) => d.registerExternalObject({
    name: 'part',
    external: { remoteName: 'legacy_part', columnMap: { CODE: 'id', LABEL: 'label' } },
    fields: { label: { type: 'text' } },
  });

  it('merges on the mapped key, not on the surrogate', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    // Unmapped, the conflict target was the surrogate, so the insert of an
    // existing CODE raised the primary-key violation instead of merging.
    expect(await driver.upsert('part', { id: 'A', label: 'anchor!' })).toEqual({ id: 'A', label: 'anchor!' });
    const raw = await driver.knex('legacy_part').select('id', 'CODE', 'LABEL').orderBy('id');
    expect(raw).toEqual([
      { id: 1, CODE: 'B', LABEL: 'bolt' },
      { id: 2, CODE: 'A', LABEL: 'anchor!' },
    ]);
  });

  it('answers the row it wrote, not the row whose surrogate equals the key', async () => {
    driver = await driverOver(ddl, rows);
    register(driver);
    // Key '1' names no row by CODE, so this inserts. The unmapped read-back
    // matched surrogate id 1 and answered row B.
    expect(await driver.upsert('part', { id: '1', label: 'one' })).toEqual({ id: '1', label: 'one' });
    expect(await driver.knex('legacy_part').where('CODE', '1').first('LABEL')).toEqual({ LABEL: 'one' });
    expect(await driver.knex('legacy_part').where('CODE', 'B').first('LABEL')).toEqual({ LABEL: 'bolt' });
  });
});
