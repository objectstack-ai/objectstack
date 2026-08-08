// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isDeepStrictEqual } from 'node:util';
import { TursoDriver } from '../src/turso-driver.js';
import { SqlDriver } from '@objectstack/driver-sql';

/**
 * The capability keys on which TursoDriver's `supports` differs from the
 * SqlDriver baseline it spreads — i.e. exactly what this subclass CLAIMS on
 * its own behalf.
 *
 * Computed by invoking SqlDriver's own `supports` getter with the Turso
 * instance as `this` (what `super.supports` does inside the override) and
 * diffing it against the instance's `supports`. Deliberately no hard-coded
 * list of baseline bits: `DriverCapabilities` is a moving target (objectstack
 * #4634 retired 31 zero-reader bits under ADR-0049), and a test that spells
 * out inherited bits pins the BASE class's contract from the wrong repo — it
 * goes red on a framework pin bump that changed nothing about Turso. This
 * diff pins only what Turso is responsible for.
 */
function ownCapabilityClaims(driver: TursoDriver): string[] {
  const accessor = Object.getOwnPropertyDescriptor(SqlDriver.prototype, 'supports')?.get;
  if (!accessor) {
    throw new Error('SqlDriver.prototype.supports is no longer a getter — update this helper');
  }
  const base = accessor.call(driver) as Record<string, unknown>;
  const own = driver.supports as unknown as Record<string, unknown>;
  return [...new Set([...Object.keys(base), ...Object.keys(own)])]
    .filter((key) => !isDeepStrictEqual(base[key], own[key]))
    .sort();
}

// ── TursoDriver Core ─────────────────────────────────────────────────────────

describe('TursoDriver (SQLite Integration)', () => {
  let driver: TursoDriver;

  beforeEach(async () => {
    driver = new TursoDriver({ url: ':memory:' });

    // Access the inherited Knex instance for test setup
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

  // ── Instantiation & Metadata ─────────────────────────────────────────────

  it('should be instantiable', () => {
    expect(driver).toBeDefined();
    expect(driver).toBeInstanceOf(TursoDriver);
  });

  it('should extend SqlDriver', () => {
    expect(driver).toBeInstanceOf(SqlDriver);
  });

  it('should have turso-specific name and version', () => {
    expect(driver.name).toBe('com.objectstack.driver.turso');
    expect(driver.version).toBe('1.0.0');
  });

  // The capability assertions that used to sit here — fullTextSearch /
  // jsonQuery / queryCTE / savepoints / indexes / connectionPooling — are gone
  // with the bits themselves (objectstack#4634). See the `TursoDriver
  // Capabilities` block below for what replaced them.

  it('should expose turso config', () => {
    const config = driver.getTursoConfig();
    expect(config.url).toBe(':memory:');
  });

  // ── CRUD (inherited from SqlDriver) ──────────────────────────────────────

  it('should find records with filters', async () => {
    const results = await driver.find('users', {
      fields: ['name', 'age'],
      where: { age: { $gt: 18 } },
      orderBy: [{ field: 'name', order: 'asc' }],
    });

    expect(results.length).toBe(2);
    expect(results.map((r: any) => r.name)).toEqual(['Alice', 'Charlie']);
  });

  it('should apply $or filters', async () => {
    const results = await driver.find('users', {
      where: {
        $or: [{ age: 17 }, { age: { $gt: 29 } }],
      },
    });
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
  });

  it('should find one record by id', async () => {
    const [alice] = await driver.find('users', { where: { name: 'Alice' } });
    expect(alice).toBeDefined();

    const fetched = await driver.findOne('users', { where: { id: alice.id } });
    expect(fetched).toBeDefined();
    expect(fetched!.name).toBe('Alice');
  });

  it('should create a record', async () => {
    await driver.create('users', { name: 'Eve', age: 22 });

    const [eve] = await driver.find('users', { where: { name: 'Eve' } });
    expect(eve).toBeDefined();
    expect(eve.age).toBe(22);
  });

  it('should auto-generate id on create', async () => {
    const created = await driver.create('users', { name: 'Frank', age: 35 });
    expect(created.id).toBeDefined();
    expect(typeof created.id).toBe('string');
    expect((created.id as string).length).toBeGreaterThan(0);
  });

  it('should update a record', async () => {
    const [bob] = await driver.find('users', { where: { name: 'Bob' } });
    await driver.update('users', bob.id as string, { age: 18 });

    const updated = await driver.findOne('users', { where: { id: bob.id } });
    expect(updated!.age).toBe(18);
  });

  it('should delete a record', async () => {
    const [charlie] = await driver.find('users', { where: { name: 'Charlie' } });
    const result = await driver.delete('users', charlie.id as string);
    expect(result).toBe(true);

    const deleted = await driver.findOne('users', { where: { id: charlie.id } });
    expect(deleted).toBeNull();
  });

  it('should count records', async () => {
    const count = await driver.count('users', { where: { age: 17 } });
    expect(count).toBe(2);
  });

  it('should count all records', async () => {
    const count = await driver.count('users');
    expect(count).toBe(4);
  });

  // ── Upsert ───────────────────────────────────────────────────────────────

  it('should upsert (insert) a new record', async () => {
    const result = await driver.upsert('users', { id: 'new-1', name: 'Grace', age: 28 });
    expect(result.name).toBe('Grace');

    const count = await driver.count('users');
    expect(count).toBe(5);
  });

  it('should upsert (update) an existing record', async () => {
    await driver.upsert('users', { id: '1', name: 'Alice Updated', age: 26 });

    const updated = await driver.findOne('users', { where: { id: '1' } });
    expect(updated!.name).toBe('Alice Updated');
    expect(updated!.age).toBe(26);
  });

  // ── Bulk Operations ──────────────────────────────────────────────────────

  it('should bulk create records', async () => {
    const data = [
      { id: 'b1', name: 'Bulk1', age: 10 },
      { id: 'b2', name: 'Bulk2', age: 20 },
    ];
    const result = await driver.bulkCreate('users', data);
    expect(result.length).toBe(2);
  });

  it('should bulk update records', async () => {
    const updates = [
      { id: '1', data: { age: 99 } },
      { id: '2', data: { age: 88 } },
    ];
    const result = await driver.bulkUpdate('users', updates);
    expect(result.length).toBe(2);
    expect(result[0].age).toBe(99);
    expect(result[1].age).toBe(88);
  });

  it('should bulk delete records', async () => {
    await driver.bulkDelete('users', ['1', '2']);
    const count = await driver.count('users');
    expect(count).toBe(2);
  });

  // ── Transactions ─────────────────────────────────────────────────────────

  it('should support transactions with commit', async () => {
    const trx = await driver.beginTransaction();
    await driver.create('users', { name: 'TrxUser', age: 40 }, { transaction: trx });
    await driver.commit(trx);

    const found = await driver.find('users', { where: { name: 'TrxUser' } });
    expect(found.length).toBe(1);
  });

  it('should support transactions with rollback', async () => {
    const trx = await driver.beginTransaction();
    await driver.create('users', { name: 'RollbackUser', age: 41 }, { transaction: trx });
    await driver.rollback(trx);

    const found = await driver.find('users', { where: { name: 'RollbackUser' } });
    expect(found.length).toBe(0);
  });

  // ── Schema Sync (inherited) ──────────────────────────────────────────────

  it('should sync schema and create tables', async () => {
    await driver.syncSchema('products', {
      name: 'products',
      fields: {
        title: { type: 'string' },
        price: { type: 'float' },
        active: { type: 'boolean' },
        metadata: { type: 'json' },
      },
    });

    const created = await driver.create('products', {
      title: 'Widget',
      price: 9.99,
      active: true,
      metadata: { category: 'tools' },
    });

    expect(created.title).toBe('Widget');
    expect(created.price).toBe(9.99);
  });

  it('should batch-sync multiple schemas in local mode (sequential fallback)', async () => {
    await driver.syncSchemasBatch([
      {
        object: 'local_orders',
        schema: {
          name: 'local_orders',
          fields: {
            product: { type: 'string' },
            quantity: { type: 'integer' },
          },
        },
      },
      {
        object: 'local_invoices',
        schema: {
          name: 'local_invoices',
          fields: {
            amount: { type: 'float' },
          },
        },
      },
    ]);

    // Verify tables were created
    const order = await driver.create('local_orders', { product: 'Gadget', quantity: 3 });
    expect(order.product).toBe('Gadget');

    const invoice = await driver.create('local_invoices', { amount: 42.0 });
    expect(invoice.amount).toBe(42.0);
  });

  // ── Raw Execution ────────────────────────────────────────────────────────

  it('should execute raw SQL', async () => {
    const result = await driver.execute('SELECT COUNT(*) as count FROM users');
    expect(result).toBeDefined();
  });

  // ── Health Check ─────────────────────────────────────────────────────────

  it('should report healthy connection', async () => {
    const healthy = await driver.checkHealth();
    expect(healthy).toBe(true);
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  it('should support limit and offset', async () => {
    const results = await driver.find('users', {
      orderBy: [{ field: 'name', order: 'asc' }],
      limit: 2,
      offset: 1,
    });
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Bob');
    expect(results[1].name).toBe('Charlie');
  });

  // ── updateMany / deleteMany ──────────────────────────────────────────────

  it('should updateMany records matching a query', async () => {
    const count = await driver.updateMany!('users', { where: { age: 17 } }, { age: 18 });
    expect(count).toBe(2);

    const updated = await driver.find('users', { where: { age: 18 } });
    expect(updated.length).toBe(2);
  });

  it('should deleteMany records matching a query', async () => {
    const count = await driver.deleteMany!('users', { where: { age: 17 } });
    expect(count).toBe(2);

    const remaining = await driver.count('users');
    expect(remaining).toBe(2);
  });

  // ── Sorting ──────────────────────────────────────────────────────────────

  it('should sort results', async () => {
    const results = await driver.find('users', {
      orderBy: [{ field: 'age', order: 'desc' }],
    });
    expect(results[0].name).toBe('Charlie');
    expect(results[results.length - 1].age).toBe(17);
  });

  // ── Edge Cases ───────────────────────────────────────────────────────────

  it('should return empty array for no matches', async () => {
    const results = await driver.find('users', { where: { age: 999 } });
    expect(results).toEqual([]);
  });

  it('should return null for findOne with no match', async () => {
    const result = await driver.findOne('users', { where: { name: 'NonExistent' } });
    expect(result).toBeNull();
  });

  it('should return false when deleting non-existent record', async () => {
    const result = await driver.delete('users', 'non-existent-id');
    expect(result).toBe(false);
  });
});

// ── Sync Configuration ───────────────────────────────────────────────────────

describe('TursoDriver Sync Configuration', () => {
  it('should report sync not enabled for memory mode', () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.isSyncEnabled()).toBe(false);
  });

  it('should return null libsql client when sync not configured', () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.getLibsqlClient()).toBeNull();
  });

  it('should handle sync() gracefully when not configured', async () => {
    const driver = new TursoDriver({ url: ':memory:' });
    // Should not throw
    await driver.sync();
  });
});

// ── URL Parsing & Validation ─────────────────────────────────────────────────

describe('TursoDriver URL Parsing', () => {
  it('should parse file: URL correctly', () => {
    const driver = new TursoDriver({ url: 'file:./data/test.db' });
    expect(driver.getTursoConfig().url).toBe('file:./data/test.db');
  });

  it('should handle :memory: URL', () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.getTursoConfig().url).toBe(':memory:');
  });

  it('should auto-detect remote mode for remote-only URL', () => {
    const driver = new TursoDriver({
      url: 'libsql://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should accept remote URL when syncUrl is provided', () => {
    // Should not throw — embedded replica mode
    const driver = new TursoDriver({
      url: 'libsql://test-db.turso.io',
      syncUrl: 'libsql://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.getTursoConfig().syncUrl).toBe('libsql://test-db.turso.io');
  });
});

// ── Capabilities ─────────────────────────────────────────────────────────────

describe('TursoDriver Capabilities', () => {
  // This block used to re-assert ~17 inherited bits (create / read / bulk* /
  // transactions / queryFilters / schemaSync …). Every one of them was a
  // SqlDriver constant restated here, and objectstack#4634 retired the lot as
  // zero-reader — so the assertions pinned the base class's old shape from the
  // consumer repo, and went red on a framework pin bump that changed nothing
  // about Turso. What is worth pinning is the DIFF: which bits this subclass
  // claims for itself, in each transport mode.

  it('claims only batchSchemaSync in local mode', () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.transportMode).toBe('local');
    expect(ownCapabilityClaims(driver)).toEqual(['batchSchemaSync']);

    // The bit is load-bearing only in tandem with the method — the engine
    // requires both before it will use the batch DDL path.
    expect(driver.supports.batchSchemaSync).toBe(true);
    expect(typeof driver.syncSchemasBatch).toBe('function');
  });

  it('claims batchSchemaSync + an emptied queryDateGranularity in remote mode', () => {
    const remote = new TursoDriver({ url: 'libsql://test-db.turso.io', authToken: 'test-token' });
    expect(remote.transportMode).toBe('remote');
    expect(ownCapabilityClaims(remote)).toEqual(['batchSchemaSync', 'queryDateGranularity']);
  });

  it('does NOT advertise native date-granularity in remote mode (avoids the "[object Object]" aggregate 500)', () => {
    // Remote mode delegates aggregate() to RemoteTransport, which accepts only
    // string group-by identifiers and has no date bucketing. If remote inherited
    // SqlDriver's queryDateGranularity, the analytics engine would push a
    // structured { field, dateGranularity } groupBy down to it and hit
    // "RemoteTransport: unsafe identifier rejected: [object Object]" (a dashboard
    // widget stuck loading). Remote must report no native granularity so the
    // engine falls back to find() + in-memory bucketing.
    const remote = new TursoDriver({ url: 'libsql://test-db.turso.io', authToken: 'test-token' });
    expect(remote.transportMode).toBe('remote');
    // No granularity advertised as natively supported -> engine falls back.
    expect(remote.supports.queryDateGranularity).toEqual({});
    expect(remote.supports.queryDateGranularity?.month).not.toBe(true);

    // Local/replica keep native bucketing inherited from SqlDriver.
    const local = new TursoDriver({ url: ':memory:' });
    expect(local.transportMode).toBe('local');
    expect(Object.keys(local.supports.queryDateGranularity ?? {}).length).toBeGreaterThan(0);
  });
});

// ── Transport Mode Detection ─────────────────────────────────────────────────

describe('TursoDriver Transport Mode Detection', () => {
  it('should detect local mode for :memory: URL', () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.transportMode).toBe('local');
    expect(driver.isRemote).toBe(false);
  });

  it('should detect local mode for file: URL', () => {
    const driver = new TursoDriver({ url: 'file:./data/test.db' });
    expect(driver.transportMode).toBe('local');
    expect(driver.isRemote).toBe(false);
  });

  it('should detect replica mode for file: URL with syncUrl', () => {
    const driver = new TursoDriver({
      url: 'file:./data/replica.db',
      syncUrl: 'libsql://test.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('replica');
    expect(driver.isRemote).toBe(false);
  });

  it('should detect replica mode for :memory: with syncUrl', () => {
    const driver = new TursoDriver({
      url: ':memory:',
      syncUrl: 'libsql://test.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('replica');
    expect(driver.isRemote).toBe(false);
  });

  it('should detect remote mode for libsql:// URL', () => {
    const driver = new TursoDriver({
      url: 'libsql://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should detect remote mode for https:// URL', () => {
    const driver = new TursoDriver({
      url: 'https://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should detect remote mode for wss:// URL', () => {
    const driver = new TursoDriver({
      url: 'wss://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  // Plaintext schemes for self-hosted / local-dev endpoints (ObjectBase gateway
  // without TLS, sqld on localhost). Regression: `http://` previously fell
  // through to the local-SQLite fallback and silently wrote to an ephemeral
  // in-memory DB instead of the remote, so seeded system tables / users never
  // reached the backend and were lost on every kernel restart.
  it('should detect remote mode for http:// URL (self-hosted, no TLS)', () => {
    const driver = new TursoDriver({
      url: 'http://p-deadbeef.default.localhost:3000',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should detect remote mode for ws:// URL (self-hosted, no TLS)', () => {
    const driver = new TursoDriver({
      url: 'ws://127.0.0.1:8080',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should respect explicit mode override', () => {
    // Force remote mode even with a file: URL
    const driver = new TursoDriver({
      url: 'file:./data/test.db',
      mode: 'remote',
    });
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should expose remote transport in remote mode', () => {
    const driver = new TursoDriver({
      url: 'libsql://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.getRemoteTransport()).not.toBeNull();
  });

  it('should not expose remote transport in local mode', () => {
    const driver = new TursoDriver({ url: ':memory:' });
    expect(driver.getRemoteTransport()).toBeNull();
  });

  it('should detect replica mode for libsql:// URL with syncUrl', () => {
    const driver = new TursoDriver({
      url: 'libsql://test-db.turso.io',
      syncUrl: 'libsql://test-db.turso.io',
      authToken: 'test-token',
    });
    expect(driver.transportMode).toBe('replica');
    expect(driver.isRemote).toBe(false);
  });
});

// ── Remote Mode with @libsql/client ──────────────────────────────────────────

describe('TursoDriver Remote Mode (via @libsql/client)', () => {
  let driver: TursoDriver;

  beforeEach(async () => {
    // Use @libsql/client in local mode (file::memory:) to test remote transport
    // without actually connecting to a real Turso cloud instance.
    // We create a libsql client in memory, then pass it to TursoDriver as a
    // pre-configured client to exercise the RemoteTransport code path.
    const { createClient } = await import('@libsql/client');
    const memClient = createClient({ url: 'file::memory:' });

    // Pre-create the test table
    await memClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT,
        age INTEGER
      )
    `);
    await memClient.execute({ sql: `INSERT INTO users (id, name, age) VALUES (?, ?, ?)`, args: ['1', 'Alice', 25] });
    await memClient.execute({ sql: `INSERT INTO users (id, name, age) VALUES (?, ?, ?)`, args: ['2', 'Bob', 17] });
    await memClient.execute({ sql: `INSERT INTO users (id, name, age) VALUES (?, ?, ?)`, args: ['3', 'Charlie', 30] });
    await memClient.execute({ sql: `INSERT INTO users (id, name, age) VALUES (?, ?, ?)`, args: ['4', 'Dave', 17] });

    driver = new TursoDriver({
      url: 'libsql://test.turso.io',  // Trigger remote mode
      authToken: 'test-token',
      client: memClient,               // Inject pre-configured client
    });
    await driver.connect();
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  // ── Instantiation & Metadata ─────────────────────────────────────────────

  it('should be in remote mode', () => {
    expect(driver.transportMode).toBe('remote');
    expect(driver.isRemote).toBe(true);
  });

  it('should still be a TursoDriver instance', () => {
    expect(driver).toBeInstanceOf(TursoDriver);
    expect(driver).toBeInstanceOf(SqlDriver);
  });

  it('should have the same name and version', () => {
    expect(driver.name).toBe('com.objectstack.driver.turso');
    expect(driver.version).toBe('1.0.0');
  });

  it('should expose the injected libsql client', () => {
    expect(driver.getLibsqlClient()).not.toBeNull();
  });

  // ── Health Check ─────────────────────────────────────────────────────────

  it('should report healthy connection', async () => {
    const healthy = await driver.checkHealth();
    expect(healthy).toBe(true);
  });

  // ── CRUD Operations ──────────────────────────────────────────────────────

  it('should find all records', async () => {
    const results = await driver.find('users', {});
    expect(results.length).toBe(4);
  });

  it('should find records with equality filter', async () => {
    const results = await driver.find('users', {
      where: { age: 17 },
    });
    expect(results.length).toBe(2);
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Bob', 'Dave']);
  });

  it('should find records with $gt filter', async () => {
    const results = await driver.find('users', {
      where: { age: { $gt: 18 } },
      orderBy: [{ field: 'name', order: 'asc' }],
    });
    expect(results.length).toBe(2);
    expect(results.map((r: any) => r.name)).toEqual(['Alice', 'Charlie']);
  });

  it('should find records with $or filter', async () => {
    const results = await driver.find('users', {
      where: {
        $or: [{ age: 17 }, { age: { $gt: 29 } }],
      },
    });
    const names = results.map((r: any) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie', 'Dave']);
  });

  it('should find records with field selection', async () => {
    const results = await driver.find('users', {
      fields: ['name'],
      where: { id: '1' },
    });
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Alice');
  });

  it('should support limit and offset', async () => {
    const results = await driver.find('users', {
      orderBy: [{ field: 'name', order: 'asc' }],
      limit: 2,
      offset: 1,
    });
    expect(results.length).toBe(2);
    expect(results[0].name).toBe('Bob');
    expect(results[1].name).toBe('Charlie');
  });

  it('should findOne by id', async () => {
    const result = await driver.findOne('users', { where: { id: '1' } });
    expect(result).not.toBeNull();
    expect(result!.name).toBe('Alice');
  });

  it('should findOne by query', async () => {
    const result = await driver.findOne('users', { where: { name: 'Bob' } });
    expect(result).not.toBeNull();
    expect(result!.age).toBe(17);
  });

  it('should return null for findOne with no match', async () => {
    const result = await driver.findOne('users', { where: { name: 'NonExistent' } });
    expect(result).toBeNull();
  });

  it('should create a record', async () => {
    const created = await driver.create('users', { name: 'Eve', age: 22 });
    expect(created.id).toBeDefined();
    expect(created.name).toBe('Eve');
    expect(created.age).toBe(22);
  });

  it('should auto-generate id on create', async () => {
    const created = await driver.create('users', { name: 'Frank', age: 35 });
    expect(created.id).toBeDefined();
    expect(typeof created.id).toBe('string');
    expect((created.id as string).length).toBeGreaterThan(0);
  });

  it('should update a record', async () => {
    await driver.update('users', '2', { age: 18 });
    const updated = await driver.findOne('users', { where: { id: '2' } });
    expect(updated!.age).toBe(18);
  });

  it('should delete a record', async () => {
    const result = await driver.delete('users', '3');
    expect(result).toBe(true);

    const deleted = await driver.findOne('users', { where: { id: '3' } });
    expect(deleted).toBeNull();
  });

  it('should return false when deleting non-existent record', async () => {
    const result = await driver.delete('users', 'non-existent-id');
    expect(result).toBe(false);
  });

  it('should count all records', async () => {
    const count = await driver.count('users');
    expect(count).toBe(4);
  });

  it('should count records with filter', async () => {
    const count = await driver.count('users', { where: { age: 17 } });
    expect(count).toBe(2);
  });

  it('should return empty array for no matches', async () => {
    const results = await driver.find('users', { where: { age: 999 } });
    expect(results).toEqual([]);
  });

  // ── Upsert ───────────────────────────────────────────────────────────────

  it('should upsert (insert) a new record', async () => {
    const result = await driver.upsert('users', { id: 'new-1', name: 'Grace', age: 28 });
    expect(result.name).toBe('Grace');

    const count = await driver.count('users');
    expect(count).toBe(5);
  });

  it('should upsert (update) an existing record', async () => {
    await driver.upsert('users', { id: '1', name: 'Alice Updated', age: 26 });

    const updated = await driver.findOne('users', { where: { id: '1' } });
    expect(updated!.name).toBe('Alice Updated');
    expect(updated!.age).toBe(26);
  });

  // ── Bulk Operations ──────────────────────────────────────────────────────

  it('should bulk create records', async () => {
    const data = [
      { id: 'b1', name: 'Bulk1', age: 10 },
      { id: 'b2', name: 'Bulk2', age: 20 },
    ];
    const result = await driver.bulkCreate('users', data);
    expect(result.length).toBe(2);
  });

  it('should bulk update records', async () => {
    const updates = [
      { id: '1', data: { age: 99 } },
      { id: '2', data: { age: 88 } },
    ];
    const result = await driver.bulkUpdate('users', updates);
    expect(result.length).toBe(2);
    expect(result[0].age).toBe(99);
    expect(result[1].age).toBe(88);
  });

  it('should bulk delete records', async () => {
    await driver.bulkDelete('users', ['1', '2']);
    const count = await driver.count('users');
    expect(count).toBe(2);
  });

  // ── updateMany / deleteMany ──────────────────────────────────────────────

  it('should updateMany records matching a query', async () => {
    const count = await driver.updateMany!('users', { where: { age: 17 } }, { age: 18 });
    expect(count).toBe(2);

    const updated = await driver.find('users', { where: { age: 18 } });
    expect(updated.length).toBe(2);
  });

  it('should deleteMany records matching a query', async () => {
    const count = await driver.deleteMany!('users', { where: { age: 17 } });
    expect(count).toBe(2);

    const remaining = await driver.count('users');
    expect(remaining).toBe(2);
  });

  // ── Raw Execution ────────────────────────────────────────────────────────

  it('should execute raw SQL', async () => {
    const result = await driver.execute('SELECT COUNT(*) as count FROM users');
    expect(result).toBeDefined();
  });

  // ── Schema Sync ──────────────────────────────────────────────────────────

  it('should sync schema and create tables', async () => {
    await driver.syncSchema('products', {
      name: 'products',
      fields: {
        title: { type: 'string' },
        price: { type: 'float' },
        active: { type: 'boolean' },
      },
    });

    const created = await driver.create('products', {
      title: 'Widget',
      price: 9.99,
      active: 1,  // SQLite stores boolean as integer
    });

    expect(created.title).toBe('Widget');
    expect(created.price).toBe(9.99);
  });

  it('should drop a table', async () => {
    await driver.syncSchema('temp_table', {
      name: 'temp_table',
      fields: { value: { type: 'string' } },
    });

    await driver.create('temp_table', { value: 'test' });
    await driver.dropTable('temp_table');

    // After drop, creating a record should fail
    await expect(driver.create('temp_table', { value: 'test' })).rejects.toThrow();
  });

  // ── Sorting ──────────────────────────────────────────────────────────────

  it('should sort results', async () => {
    const results = await driver.find('users', {
      orderBy: [{ field: 'age', order: 'desc' }],
    });
    expect(results[0].name).toBe('Charlie');
    expect(results[results.length - 1].age).toBe(17);
  });

  // ── Batch Schema Sync ──────────────────────────────────────────────────

  it('should advertise batchSchemaSync capability', () => {
    expect(driver.supports.batchSchemaSync).toBe(true);
  });

  it('should batch-sync multiple schemas in one call', async () => {
    await driver.syncSchemasBatch([
      {
        object: 'orders',
        schema: {
          name: 'orders',
          fields: {
            product: { type: 'string' },
            quantity: { type: 'integer' },
          },
        },
      },
      {
        object: 'invoices',
        schema: {
          name: 'invoices',
          fields: {
            amount: { type: 'float' },
            paid: { type: 'boolean' },
          },
        },
      },
    ]);

    // Verify tables were created
    const order = await driver.create('orders', { product: 'Widget', quantity: 5 });
    expect(order.product).toBe('Widget');

    const invoice = await driver.create('invoices', { amount: 99.99, paid: 1 });
    expect(invoice.amount).toBe(99.99);
  });

  it('should batch-sync add columns to existing tables', async () => {
    // First create a table
    await driver.syncSchema('items', {
      name: 'items',
      fields: {
        title: { type: 'string' },
      },
    });

    // Now batch-sync with a new column
    await driver.syncSchemasBatch([
      {
        object: 'items',
        schema: {
          name: 'items',
          fields: {
            title: { type: 'string' },
            description: { type: 'text' },
          },
        },
      },
    ]);

    // Verify the new column works
    const item = await driver.create('items', { title: 'Test', description: 'A description' });
    expect(item.title).toBe('Test');
    expect(item.description).toBe('A description');
  });

  it('should handle empty batch gracefully', async () => {
    await expect(driver.syncSchemasBatch([])).resolves.not.toThrow();
  });

  // ── initObjects (remote-mode override — must NOT touch better-sqlite3) ──
  //
  // Regression: in serverless environments (e.g. Vercel) the native
  // `better-sqlite3` binding is unavailable. The base `SqlDriver.initObjects`
  // uses Knex (better-sqlite3) for `hasTable`/`createTable`, which crashes
  // with "Could not locate the bindings file". TursoDriver must route
  // `initObjects` through RemoteTransport instead.
  it('should provision tables via RemoteTransport (no better-sqlite3) in remote mode', async () => {
    await driver.initObjects([
      {
        name: 'remote_init_a',
        fields: {
          title: { type: 'string' },
          qty: { type: 'integer' },
        },
      },
      {
        name: 'remote_init_b',
        fields: {
          name: { type: 'string' },
        },
      },
    ]);

    // If routed via RemoteTransport, both tables exist on the libsql client.
    const a = await driver.create('remote_init_a', { title: 'X', qty: 1 });
    expect(a.title).toBe('X');
    const b = await driver.create('remote_init_b', { name: 'Y' });
    expect(b.name).toBe('Y');
  });

  it('should handle empty initObjects list gracefully in remote mode', async () => {
    await expect(driver.initObjects([])).resolves.not.toThrow();
  });
});

// ── Lazy Connect (self-healing for serverless cold starts) ───────────────────

describe('TursoDriver Remote Mode — Lazy Connect', () => {
  it('should lazy-connect on first find when connect() was never called', async () => {
    const { createClient } = await import('@libsql/client');
    const memClient = createClient({ url: 'file::memory:' });

    await memClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);
    await memClient.execute({ sql: `INSERT INTO users (id, name) VALUES (?, ?)`, args: ['1', 'Alice'] });

    // Create driver but intentionally do NOT call connect()
    const driver = new TursoDriver({
      url: 'libsql://test.turso.io',
      authToken: 'test-token',
      client: memClient,
    });

    // The first CRUD operation should trigger lazy connect via the factory
    const results = await driver.find('users', {});
    expect(results.length).toBe(1);
    expect((results[0] as any).name).toBe('Alice');

    // Client should now be connected
    expect(driver.getLibsqlClient()).not.toBeNull();
    await driver.disconnect();
  });

  it('should lazy-connect on first create when connect() was never called', async () => {
    const { createClient } = await import('@libsql/client');
    const memClient = createClient({ url: 'file::memory:' });

    await memClient.execute(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        title TEXT
      )
    `);

    const driver = new TursoDriver({
      url: 'libsql://test.turso.io',
      authToken: 'test-token',
      client: memClient,
    });

    // No connect() — should lazy-connect
    const item = await driver.create('items', { id: 'x', title: 'Test' });
    expect(item.title).toBe('Test');
    await driver.disconnect();
  });

  it('should lazy-connect on checkHealth when connect() was never called', async () => {
    const { createClient } = await import('@libsql/client');
    const memClient = createClient({ url: 'file::memory:' });

    const driver = new TursoDriver({
      url: 'libsql://test.turso.io',
      authToken: 'test-token',
      client: memClient,
    });

    // checkHealth should trigger lazy connect and succeed
    const healthy = await driver.checkHealth();
    expect(healthy).toBe(true);
    await driver.disconnect();
  });

  it('should de-duplicate concurrent lazy-connect attempts', async () => {
    const { createClient } = await import('@libsql/client');
    const memClient = createClient({ url: 'file::memory:' });

    await memClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);
    await memClient.execute({ sql: `INSERT INTO users (id, name) VALUES (?, ?)`, args: ['1', 'Alice'] });

    const driver = new TursoDriver({
      url: 'libsql://test.turso.io',
      authToken: 'test-token',
      client: memClient,
    });

    // Fire multiple operations concurrently without calling connect()
    const [r1, r2, r3] = await Promise.all([
      driver.find('users', {}),
      driver.find('users', {}),
      driver.count('users'),
    ]);

    expect(r1.length).toBe(1);
    expect(r2.length).toBe(1);
    expect(r3).toBe(1);
    await driver.disconnect();
  });

  it('should recover when transport client is cleared', async () => {
    const { createClient } = await import('@libsql/client');

    // We create two separate clients: one to simulate the "lost" state, and
    // a fresh one that the lazy factory should produce on reconnect.
    const memClient1 = createClient({ url: 'file::memory:' });
    const memClient2 = createClient({ url: 'file::memory:' });

    await memClient2.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT
      )
    `);
    await memClient2.execute({ sql: `INSERT INTO users (id, name) VALUES (?, ?)`, args: ['1', 'Bob'] });

    const driver = new TursoDriver({
      url: 'libsql://test.turso.io',
      authToken: 'test-token',
      client: memClient1,
    });

    await driver.connect();
    expect(driver.getLibsqlClient()).not.toBeNull();

    // Clear only the transport's reference (simulates stale state) and point
    // the factory at a fresh, working client.
    const transport = driver.getRemoteTransport()!;
    transport.setClient(null as unknown as any);
    // Override the factory to return the second client
    transport.setConnectFactory(async () => memClient2);

    // Next operation should re-connect via the factory
    const results = await driver.find('users', {});
    expect(results.length).toBe(1);
    expect((results[0] as any).name).toBe('Bob');

    memClient1.close();
    memClient2.close();
  });
});
