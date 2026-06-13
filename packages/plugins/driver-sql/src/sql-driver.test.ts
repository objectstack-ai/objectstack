// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver (SQLite Integration)', () => {
  let driver: SqlDriver;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });

    const k = (driver as any).knex;

    await k.schema.createTable('users', (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.integer('age');
    });

    await k('users').insert([
      { id: '1', name: 'Alice', age: 25 },
      { id: '2', name: 'Bob', age: 17 },
      { id: '3', name: 'Charlie', age: 30 },
      { id: '4', name: 'Dave', age: 17 },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  it('should be instantiable', () => {
    expect(driver).toBeDefined();
    expect(driver).toBeInstanceOf(SqlDriver);
  });

  it('should find objects with filters', async () => {
    const results = await driver.find('users', {
      fields: ['name', 'age'],
      where: { age: { $gt: 18 } },
      orderBy: [{ field: 'name', order: 'asc' }],
    });

    expect(results.length).toBe(2);
    expect(results.map((r: any) => r.name)).toEqual(['Alice', 'Charlie']);
  });

  it('returns rows when $select names an unknown column (retries with SELECT *)', async () => {
    // A generic list view auto-requests view-binding fields (status, due_date,
    // image, ...) the object may not have. The unknown column must NOT zero
    // the whole result — the real rows still come back, minus the phantom field.
    const results = await driver.find('users', {
      fields: ['id', 'name', 'status', 'due_date', 'image'],
      orderBy: [{ field: 'name', order: 'asc' }],
    });

    expect(results.length).toBe(4);
    expect(results.map((r: any) => r.name)).toEqual(['Alice', 'Bob', 'Charlie', 'Dave']);
    // The phantom columns are simply absent (the table never had them).
    expect((results[0] as any).status).toBeUndefined();
  });

  it('still surfaces non-column errors (e.g. unknown table) instead of empty', async () => {
    await expect(
      driver.find('no_such_table', { fields: ['id'] }),
    ).rejects.toThrow();
  });

  it('should apply simple AND/OR logic', async () => {
    const results = await driver.find('users', {
      where: {
        $or: [{ age: 17 }, { age: { $gt: 29 } }],
      },
    });
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
  });

  it('should find one object by id', async () => {
    const [alice] = await driver.find('users', { where: { name: 'Alice' } });
    expect(alice).toBeDefined();

    const fetched = await driver.findOne('users', alice.id as any);
    expect(fetched).toBeDefined();
    expect(fetched.name).toBe('Alice');
  });

  it('should create an object', async () => {
    await driver.create('users', { name: 'Eve', age: 22 });

    const [eve] = await driver.find('users', { where: { name: 'Eve' } });
    expect(eve).toBeDefined();
    expect(eve.age).toBe(22);
  });

  it('should update an object', async () => {
    const [bob] = await driver.find('users', { where: { name: 'Bob' } });
    await driver.update('users', bob.id, { age: 18 });

    const updated = await driver.findOne('users', bob.id as any);
    expect(updated.age).toBe(18);
  });

  it('should delete an object', async () => {
    const [charlie] = await driver.find('users', { where: { name: 'Charlie' } });
    await driver.delete('users', charlie.id);

    const deleted = await driver.findOne('users', charlie.id as any);
    expect(deleted).toBeNull();
  });

  it('should count objects', async () => {
    const count = await driver.count('users', { where: { age: 17 } } as any);
    expect(count).toBe(2);
  });

  it('should map _id to id if provided', async () => {
    const created = await driver.create('users', { _id: 'custom-id', name: 'Frank', age: 40 });

    expect(created.id).toBe('custom-id');
    const fetched = await driver.findOne('users', 'custom-id' as any);
    expect(fetched).toBeDefined();
    expect(fetched.name).toBe('Frank');
  });
});
