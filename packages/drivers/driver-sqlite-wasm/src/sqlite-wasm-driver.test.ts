// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteWasmDriver } from '../src/index.js';

describe('SqliteWasmDriver (in-memory)', () => {
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });

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
    expect(driver).toBeInstanceOf(SqliteWasmDriver);
    expect(driver.name).toBe('com.objectstack.driver.sqlite-wasm');
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

  it('should apply simple AND/OR logic', async () => {
    const results = await driver.find('users', {
      where: { $or: [{ age: 17 }, { age: { $gt: 29 } }] },
    });
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
  });

  it('should find one object by id', async () => {
    const [alice] = await driver.find('users', { where: { name: 'Alice' } });
    expect(alice).toBeDefined();
    const fetched = await driver.findOne('users', { where: { id: alice.id } });
    expect(fetched.name).toBe('Alice');
  });

  it('should create an object', async () => {
    await driver.create('users', { name: 'Eve', age: 22 });
    const [eve] = await driver.find('users', { where: { name: 'Eve' } });
    expect(eve.age).toBe(22);
  });

  it('should update an object', async () => {
    const [bob] = await driver.find('users', { where: { name: 'Bob' } });
    await driver.update('users', bob.id, { age: 18 });
    const updated = await driver.findOne('users', { where: { id: bob.id } });
    expect(updated.age).toBe(18);
  });

  it('should delete an object', async () => {
    const [charlie] = await driver.find('users', { where: { name: 'Charlie' } });
    await driver.delete('users', charlie.id);
    const deleted = await driver.findOne('users', { where: { id: charlie.id } });
    expect(deleted).toBeNull();
  });

  it('should count objects', async () => {
    const count = await driver.count('users', { where: { age: 17 } });
    expect(count).toBe(2);
  });
});

describe('SqliteWasmDriver (file persistence)', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'os-wasm-'));
    dbPath = join(tmpDir, 'test.db');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should persist data across disconnect/reconnect (on-disconnect)', async () => {
    const d1 = new SqliteWasmDriver({ filename: dbPath, persist: 'on-disconnect' });
    const k1 = (d1 as any).knex;
    await k1.schema.createTable('items', (t: any) => {
      t.string('id').primary();
      t.string('label');
    });
    await k1('items').insert([{ id: 'a', label: 'first' }]);
    await d1.disconnect();

    const d2 = new SqliteWasmDriver({ filename: dbPath, persist: 'on-disconnect' });
    const rows = await d2.find('items', {});
    expect(rows.length).toBe(1);
    expect(rows[0].label).toBe('first');
    await d2.disconnect();
  });

  it('should persist data on-write', async () => {
    const d1 = new SqliteWasmDriver({ filename: dbPath, persist: 'on-write' });
    const k1 = (d1 as any).knex;
    await k1.schema.createTable('items', (t: any) => {
      t.string('id').primary();
      t.string('label');
    });
    await k1('items').insert([{ id: 'a', label: 'first' }]);
    // Allow microtask flushing
    await d1.flush();

    const d2 = new SqliteWasmDriver({ filename: dbPath, persist: 'on-write' });
    const rows = await d2.find('items', {});
    expect(rows.length).toBe(1);
    await d1.disconnect();
    await d2.disconnect();
  });
});
