// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver Schema Introspection (SQLite)', () => {
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

  it('should introspect empty database', async () => {
    const schema = await driver.introspectSchema();

    expect(schema).toBeDefined();
    expect(schema.tables).toBeDefined();
    expect(Object.keys(schema.tables).length).toBe(0);
  });

  it('should discover existing tables', async () => {
    await knexInstance.schema.createTable('users', (t: any) => {
      t.string('id').primary();
      t.string('name').notNullable();
      t.string('email').unique();
      t.integer('age');
      t.boolean('active').defaultTo(true);
      t.timestamp('created_at').defaultTo(knexInstance.fn.now());
    });

    await knexInstance.schema.createTable('posts', (t: any) => {
      t.string('id').primary();
      t.string('title').notNullable();
      t.text('content');
      t.timestamp('created_at').defaultTo(knexInstance.fn.now());
    });

    const schema = await driver.introspectSchema();

    expect(Object.keys(schema.tables)).toContain('users');
    expect(Object.keys(schema.tables)).toContain('posts');
    expect(Object.keys(schema.tables).length).toBe(2);
  });

  it('should discover column types', async () => {
    await knexInstance.schema.createTable('test_types', (t: any) => {
      t.string('id').primary();
      t.string('text_col');
      t.integer('int_col');
      t.float('float_col');
      t.boolean('bool_col');
      t.date('date_col');
      t.timestamp('timestamp_col');
      t.json('json_col');
    });

    const schema = await driver.introspectSchema();
    const table = schema.tables['test_types'];

    expect(table).toBeDefined();
    expect(table.columns.length).toBeGreaterThan(0);

    const colNames = table.columns.map((c) => c.name);
    expect(colNames).toContain('text_col');
    expect(colNames).toContain('int_col');
    expect(colNames).toContain('bool_col');
    expect(colNames).toContain('json_col');
  });

  it('should detect primary keys', async () => {
    await knexInstance.schema.createTable('pk_test', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });

    const schema = await driver.introspectSchema();
    const table = schema.tables['pk_test'];

    expect(table.primaryKeys).toContain('id');
  });

  it('should detect foreign keys', async () => {
    await knexInstance.schema.createTable('categories', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });

    await knexInstance.schema.createTable('products', (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.string('category_id');
      t.foreign('category_id').references('categories.id');
    });

    const schema = await driver.introspectSchema();
    const productsTable = schema.tables['products'];

    expect(productsTable).toBeDefined();
    expect(productsTable.foreignKeys.length).toBeGreaterThan(0);

    const fk = productsTable.foreignKeys.find((fk) => fk.columnName === 'category_id');
    expect(fk).toBeDefined();
    expect(fk?.referencedTable).toBe('categories');
    expect(fk?.referencedColumn).toBe('id');
  });

  it('should detect nullable and required columns', async () => {
    await knexInstance.schema.createTable('nullable_test', (t: any) => {
      t.string('id').primary();
      t.string('required_field').notNullable();
      t.string('optional_field');
    });

    const schema = await driver.introspectSchema();
    const table = schema.tables['nullable_test'];

    const requiredCol = table.columns.find((c) => c.name === 'required_field');
    const optionalCol = table.columns.find((c) => c.name === 'optional_field');

    expect(requiredCol?.nullable).toBe(false);
    expect(optionalCol?.nullable).toBe(true);
  });

  it('should handle multiple foreign keys in one table', async () => {
    await knexInstance.schema.createTable('users', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });

    await knexInstance.schema.createTable('teams', (t: any) => {
      t.string('id').primary();
      t.string('name');
    });

    await knexInstance.schema.createTable('memberships', (t: any) => {
      t.string('id').primary();
      t.string('user_id');
      t.string('team_id');
      t.foreign('user_id').references('users.id');
      t.foreign('team_id').references('teams.id');
    });

    const schema = await driver.introspectSchema();
    const table = schema.tables['memberships'];

    expect(table.foreignKeys.length).toBe(2);

    const userFk = table.foreignKeys.find((fk) => fk.columnName === 'user_id');
    const teamFk = table.foreignKeys.find((fk) => fk.columnName === 'team_id');

    expect(userFk?.referencedTable).toBe('users');
    expect(teamFk?.referencedTable).toBe('teams');
  });
});
