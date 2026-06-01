// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver Schema Sync (SQLite)', () => {
  let driver: SqlDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (driver as any).knex;
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  it('should create table if not exists', async () => {
    const objects = [
      {
        name: 'test_obj',
        fields: {
          name: { type: 'string' },
          age: { type: 'integer' },
        },
      },
    ];

    await driver.initObjects(objects);

    const exists = await knexInstance.schema.hasTable('test_obj');
    expect(exists).toBe(true);

    const columns = await knexInstance('test_obj').columnInfo();
    expect(columns).toHaveProperty('id');
    expect(columns).toHaveProperty('created_at');
    expect(columns).toHaveProperty('updated_at');
    expect(columns).toHaveProperty('name');
    expect(columns).toHaveProperty('age');
  });

  it('should add new columns if table exists', async () => {
    await knexInstance.schema.createTable('test_obj', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });

    await knexInstance('test_obj').insert({ id: '1', name: 'Old Data' });

    const objects = [
      {
        name: 'test_obj',
        fields: {
          name: { type: 'string' },
          age: { type: 'integer' },
          active: { type: 'boolean' },
        },
      },
    ];

    await driver.initObjects(objects);

    const columns = await knexInstance('test_obj').columnInfo();
    expect(columns).toHaveProperty('age');
    expect(columns).toHaveProperty('active');

    const row = await knexInstance('test_obj').where('id', '1').first();
    expect(row.name).toBe('Old Data');
  });

  it('should not delete existing columns', async () => {
    await knexInstance.schema.createTable('test_obj', (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.string('extra_column');
    });

    const objects = [
      {
        name: 'test_obj',
        fields: {
          name: { type: 'string' },
        },
      },
    ];

    await driver.initObjects(objects);

    const columns = await knexInstance('test_obj').columnInfo();
    expect(columns).toHaveProperty('name');
    expect(columns).toHaveProperty('extra_column');
  });

  it('should not fail if table creation is repeated', async () => {
    const objects = [
      {
        name: 'test_obj',
        fields: {
          name: { type: 'string' },
        },
      },
    ];

    await driver.initObjects(objects);
    await driver.initObjects(objects);

    const exists = await knexInstance.schema.hasTable('test_obj');
    expect(exists).toBe(true);
  });

  it('should create json column for multiple=true fields', async () => {
    const objects = [
      {
        name: 'multi_test',
        fields: {
          tags: { type: 'select', multiple: true } as any,
          users: { type: 'lookup', reference_to: 'user', multiple: true } as any,
        },
      },
    ];

    await driver.initObjects(objects);

    await driver.create('multi_test', {
      tags: ['a', 'b'],
      users: ['u1', 'u2'],
    });

    const results = await driver.find('multi_test', {});
    const row = results[0];

    expect(row.tags).toEqual(['a', 'b']);
    expect(row.users).toEqual(['u1', 'u2']);
  });

  it('should create percent column', async () => {
    const objects = [
      {
        name: 'percent_test',
        fields: {
          completion: { type: 'percent' } as any,
        },
      },
    ];

    await driver.initObjects(objects);

    const columns = await knexInstance('percent_test').columnInfo();
    expect(columns).toHaveProperty('completion');

    await driver.create('percent_test', { completion: 0.85 });
    const res = await driver.find('percent_test', {});
    expect(res[0].completion).toBe(0.85);
  });

  it('should handle special fields (formula, summary, auto_number)', async () => {
    const objects = [
      {
        name: 'special_fields_test',
        fields: {
          total: { type: 'formula', expression: 'price * qty', data_type: 'number' } as any,
          child_count: { type: 'summary', summary_object: 'child_obj', summary_type: 'count' } as any,
          invoice_no: { type: 'auto_number', auto_number_format: 'INV-{0000}' } as any,
        },
      },
    ];

    await driver.initObjects(objects);

    const columns = await knexInstance('special_fields_test').columnInfo();

    expect(columns).not.toHaveProperty('total');
    expect(columns).toHaveProperty('child_count');
    expect(columns).toHaveProperty('invoice_no');
  });

  it('should create database constraints (unique, required)', async () => {
    const objects = [
      {
        name: 'constraint_test',
        fields: {
          unique_field: { type: 'string', unique: true } as any,
          required_field: { type: 'string', required: true } as any,
        },
      },
    ];

    await driver.initObjects(objects);

    await driver.create('constraint_test', { unique_field: 'u1', required_field: 'r1' });

    try {
      await driver.create('constraint_test', { unique_field: 'u1', required_field: 'r2' });
      expect.unreachable('Should throw error for unique violation');
    } catch (e: any) {
      expect(e.message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    }

    try {
      await driver.create('constraint_test', { unique_field: 'u2' });
      expect.unreachable('Should throw error for not null violation');
    } catch (e: any) {
      expect(e.message).toMatch(/NOT NULL constraint failed|null value in column/);
    }
  });

  it('should handle new field types (email, file, location)', async () => {
    const objects = [
      {
        name: 'new_types_test',
        fields: {
          email: { type: 'email' } as any,
          profile_pic: { type: 'image' } as any,
          resume: { type: 'file' } as any,
          office_loc: { type: 'location' } as any,
          work_hours: { type: 'time' } as any,
        },
      },
    ];

    await driver.initObjects(objects);
    const cols = await knexInstance('new_types_test').columnInfo();

    expect(cols).toHaveProperty('email');
    expect(cols).toHaveProperty('profile_pic');
    expect(cols).toHaveProperty('resume');

    await driver.create('new_types_test', {
      email: 'test@example.com',
      profile_pic: { url: 'http://img.com/1.png' },
      office_loc: { lat: 10, lng: 20 },
      work_hours: '09:00:00',
    });

    const res = await driver.find('new_types_test', {});
    const row = res[0];

    expect(row.email).toBe('test@example.com');
    expect(row.office_loc).toEqual({ lat: 10, lng: 20 });
  });

  it('should skip ensureDatabaseExists for SQLite (no-op)', async () => {
    // SQLite auto-creates database files, so ensureDatabaseExists should be a no-op
    // This test verifies that initObjects works normally for SQLite without errors
    const objects = [
      {
        name: 'db_check_test',
        fields: {
          value: { type: 'string' },
        },
      },
    ];

    // Should not throw — SQLite skips ensureDatabaseExists
    await driver.initObjects(objects);

    const exists = await knexInstance.schema.hasTable('db_check_test');
    expect(exists).toBe(true);
  });

  it('should use object parameter (physical table name) in syncSchema, matching schema.name', async () => {
    // Under the new naming convention, system objects use sys_ prefix as their
    // actual object name (no FQN double-underscore). Both the object name and
    // physical table name are 'sys_user'.
    const physicalTableName = 'sys_user';

    await driver.syncSchema(physicalTableName, {
      name: physicalTableName,
      fields: {
        email: { type: 'string' },
        display_name: { type: 'string' },
      },
    });

    // The table should be created with the physical name
    const existsPhysical = await knexInstance.schema.hasTable(physicalTableName);
    expect(existsPhysical).toBe(true);

    const existsFqn = await knexInstance.schema.hasTable('sys__user');
    expect(existsFqn).toBe(false);

    // Verify the table has the correct columns
    const columns = await knexInstance(physicalTableName).columnInfo();
    expect(columns).toHaveProperty('id');
    expect(columns).toHaveProperty('email');
    expect(columns).toHaveProperty('display_name');
  });

  it('should materialize a declared single-column unique index and reject duplicates', async () => {
    const objects = [
      {
        name: 'idx_unique_obj',
        fields: {
          slug: { type: 'string' },
        },
        indexes: [{ fields: ['slug'], unique: true }],
      },
    ];

    await driver.initObjects(objects as any);

    // PRAGMA proves a non-PK unique index was actually created.
    const list: any = await knexInstance.raw('PRAGMA index_list(idx_unique_obj)');
    const declared = list.filter((i: any) => !String(i.name).startsWith('sqlite_autoindex'));
    expect(declared.length).toBe(1);
    expect(declared[0].unique).toBe(1);

    await driver.create('idx_unique_obj', { slug: 's1' });
    await expect(driver.create('idx_unique_obj', { slug: 's1' })).rejects.toThrow(
      /UNIQUE constraint failed|duplicate key value/,
    );
  });

  it('should materialize a declared multi-column unique index (compound dedup)', async () => {
    const objects = [
      {
        name: 'idx_multi_obj',
        fields: {
          notification_id: { type: 'string' },
          recipient_id: { type: 'string' },
          channel: { type: 'string' },
        },
        indexes: [{ fields: ['notification_id', 'recipient_id', 'channel'], unique: true }],
      },
    ];

    await driver.initObjects(objects as any);

    const list: any = await knexInstance.raw('PRAGMA index_list(idx_multi_obj)');
    const declared = list.filter((i: any) => !String(i.name).startsWith('sqlite_autoindex'));
    expect(declared.length).toBe(1);
    expect(declared[0].unique).toBe(1);

    await driver.create('idx_multi_obj', { notification_id: 'n1', recipient_id: 'r1', channel: 'bell' });
    // Same tuple → rejected.
    await expect(
      driver.create('idx_multi_obj', { notification_id: 'n1', recipient_id: 'r1', channel: 'bell' }),
    ).rejects.toThrow(/UNIQUE constraint failed|duplicate key value/);
    // Differing channel → allowed.
    await driver.create('idx_multi_obj', { notification_id: 'n1', recipient_id: 'r1', channel: 'email' });
    const rows = await driver.find('idx_multi_obj', {});
    expect(rows.length).toBe(2);
  });

  it('should allow multiple NULLs under a declared unique index (NULL-distinct)', async () => {
    const objects = [
      {
        name: 'idx_null_obj',
        fields: {
          dedup_key: { type: 'string' },
        },
        indexes: [{ fields: ['dedup_key'], unique: true }],
      },
    ];

    await driver.initObjects(objects as any);

    // Two rows with no dedup_key (NULL) must both be insertable.
    await driver.create('idx_null_obj', {});
    await driver.create('idx_null_obj', {});
    const rows = await driver.find('idx_null_obj', {});
    expect(rows.length).toBe(2);
  });

  it('should materialize a declared non-unique index', async () => {
    const objects = [
      {
        name: 'idx_plain_obj',
        fields: {
          status: { type: 'string' },
          partition_key: { type: 'string' },
        },
        indexes: [{ fields: ['status', 'partition_key'] }],
      },
    ];

    await driver.initObjects(objects as any);

    const list: any = await knexInstance.raw('PRAGMA index_list(idx_plain_obj)');
    const declared = list.filter((i: any) => !String(i.name).startsWith('sqlite_autoindex'));
    expect(declared.length).toBe(1);
    expect(declared[0].unique).toBe(0);
  });

  it('should be idempotent when initObjects runs repeatedly with declared indexes', async () => {
    const objects = [
      {
        name: 'idx_idem_obj',
        fields: { slug: { type: 'string' } },
        indexes: [{ fields: ['slug'], unique: true }],
      },
    ];

    await driver.initObjects(objects as any);
    // Second run must not throw "index already exists".
    await driver.initObjects(objects as any);

    const list: any = await knexInstance.raw('PRAGMA index_list(idx_idem_obj)');
    const declared = list.filter((i: any) => !String(i.name).startsWith('sqlite_autoindex'));
    expect(declared.length).toBe(1);
  });

  it('should skip a declared index referencing a non-materialized (virtual) column', async () => {
    const warnings: string[] = [];
    (driver as any).logger = { warn: (msg: string) => warnings.push(msg) };

    const objects = [
      {
        name: 'idx_virtual_obj',
        fields: {
          name: { type: 'string' },
          total: { type: 'formula', expression: 'a + b', data_type: 'number' },
        },
        indexes: [{ fields: ['total'], unique: true }],
      },
    ];

    // Must not throw even though `total` has no physical column.
    await driver.initObjects(objects as any);

    const list: any = await knexInstance.raw('PRAGMA index_list(idx_virtual_obj)');
    const declared = list.filter((i: any) => !String(i.name).startsWith('sqlite_autoindex'));
    expect(declared.length).toBe(0);
    expect(warnings.some((w) => w.includes('total'))).toBe(true);
  });

  it('reports indexes capability as supported', () => {
    expect((driver as any).supports.indexes).toBe(true);
  });

  it('should use short object name as physical table name in initObjects', async () => {
    const objects = [
      {
        name: 'deal',
        fields: {
          amount: { type: 'number' },
        },
      },
    ];

    await driver.initObjects(objects);

    const existsPhysical = await knexInstance.schema.hasTable('deal');
    expect(existsPhysical).toBe(true);

    // FQN-style names should never appear as table names
    const existsFqn = await knexInstance.schema.hasTable('crm__deal');
    expect(existsFqn).toBe(false);
  });
});
