// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from '../src/index.js';

describe('SqliteWasmDriver Schema Sync (SQLite)', () => {
  let driver: SqliteWasmDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
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
          users: { type: 'lookup', reference: 'user', multiple: true } as any,
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

  it('should create database constraints (unique, storage.notNull) — required alone stays nullable (ADR-0113)', async () => {
    const objects = [
      {
        name: 'constraint_test',
        fields: {
          unique_field: { type: 'string', unique: true } as any,
          // ADR-0113: the physical constraint is the explicit storage opt-in;
          // `required` alone is the engine-enforced write contract and the
          // column deliberately stays nullable.
          constrained_field: { type: 'string', required: true, storage: { notNull: true } } as any,
          required_field: { type: 'string', required: true } as any,
        },
      },
    ];

    await driver.initObjects(objects);

    await driver.create('constraint_test', { unique_field: 'u1', constrained_field: 'c1', required_field: 'r1' });

    try {
      await driver.create('constraint_test', { unique_field: 'u1', constrained_field: 'c2', required_field: 'r2' });
      expect.unreachable('Should throw error for unique violation');
    } catch (e: any) {
      expect(e.message).toMatch(/UNIQUE constraint failed|duplicate key value/);
    }

    try {
      await driver.create('constraint_test', { unique_field: 'u2', required_field: 'r3' });
      expect.unreachable('Should throw error for not null violation');
    } catch (e: any) {
      expect(e.message).toMatch(/NOT NULL constraint failed|null value in column/);
    }

    // The write-contract-only field produced a nullable column: omitting it at
    // the DRIVER seam succeeds — the record validator at the engine seam is
    // what enforces it for real writes.
    await expect(
      driver.create('constraint_test', { unique_field: 'u3', constrained_field: 'c3' }),
    ).resolves.toBeDefined();
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
