// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { MongoMemoryServer } from 'mongodb-memory-server';
import { parseFilterAST } from '@objectstack/spec/data';
import { MongoDBDriver } from './mongodb-driver.js';
import { createTestMongod } from './test-mongod.js';

// `mongodb-memory-server` downloads a real MongoDB binary from
// fastdl.mongodb.org on first use, which is why this suite is OPT-IN since
// #5517: two workers downloading it at once made an all-green run `exit 1` and
// ejected unrelated PRs from the merge queue. `createTestMongod` skips this
// suite — printing why — unless `OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`, and
// an opted-in download that fails or HANGS lands on the same skip rather than
// stalling the job. The acquisition happens once here so availability is known
// at collection time — a throwing `beforeAll` would *fail* every test instead
// of skipping it.
const sharedMongod: MongoMemoryServer | undefined = await createTestMongod('MongoDBDriver');

describe.skipIf(!sharedMongod)('MongoDBDriver', () => {
  const mongod = sharedMongod as MongoMemoryServer;
  let driver: MongoDBDriver;

  beforeAll(async () => {
    const uri = mongod.getUri();
    driver = new MongoDBDriver({ url: uri, database: 'test_db' });
    await driver.connect();
  }, 90_000);

  afterAll(async () => {
    if (driver) await driver.disconnect();
    if (mongod) await mongod.stop();
  });

  beforeEach(async () => {
    // Clear test collection between tests
    const db = driver.getDb();
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      await db.dropCollection(col.name);
    }
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('should report healthy', async () => {
      expect(await driver.checkHealth()).toBe(true);
    });
  });

  // ===========================================================================
  // CRUD Operations
  // ===========================================================================

  describe('create', () => {
    it('should create a record with auto-generated id', async () => {
      const result = await driver.create('task', { title: 'Test task' });
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe('string');
      expect(result.title).toBe('Test task');
      expect(result.created_at).toBeDefined();
      expect(result.updated_at).toBeDefined();
    });

    it('should create a record with provided id', async () => {
      const result = await driver.create('task', { id: 'custom-id', title: 'Test' });
      expect(result.id).toBe('custom-id');
    });

    it('should never expose _id', async () => {
      const result = await driver.create('task', { title: 'Test' });
      expect(result).not.toHaveProperty('_id');
    });
  });

  describe('find', () => {
    beforeEach(async () => {
      await driver.bulkCreate('task', [
        { id: '1', title: 'Alpha', priority: 1, status: 'active' },
        { id: '2', title: 'Beta', priority: 2, status: 'active' },
        { id: '3', title: 'Gamma', priority: 3, status: 'done' },
        { id: '4', title: 'Delta', priority: 4, status: 'done' },
        { id: '5', title: 'Epsilon', priority: 5, status: 'active' },
      ]);
    });

    it('should find all records', async () => {
      const results = await driver.find('task', {});
      expect(results.length).toBe(5);
    });

    it('should never expose _id in results', async () => {
      const results = await driver.find('task', {});
      for (const r of results) {
        expect(r).not.toHaveProperty('_id');
      }
    });

    it('should filter with where clause', async () => {
      const results = await driver.find('task', { where: { status: 'active' } });
      expect(results.length).toBe(3);
    });

    it('should sort results', async () => {
      const results = await driver.find('task', {
        orderBy: [{ field: 'priority', order: 'desc' }],
      });
      expect(results[0].priority).toBe(5);
      expect(results[4].priority).toBe(1);
    });

    it('should paginate with limit and offset', async () => {
      const results = await driver.find('task', {
        orderBy: [{ field: 'priority', order: 'asc' }],
        limit: 2,
        offset: 1,
      });
      expect(results.length).toBe(2);
      expect(results[0].id).toBe('2');
      expect(results[1].id).toBe('3');
    });

    it('should select specific fields', async () => {
      const results = await driver.find('task', {
        fields: ['title', 'status'],
      });
      expect(results[0].title).toBeDefined();
      expect(results[0].status).toBeDefined();
      expect(results[0].id).toBeDefined(); // id always included
    });
  });

  describe('findOne', () => {
    beforeEach(async () => {
      await driver.create('task', { id: 'find-1', title: 'Find me' });
    });

    it('should find a single record by filter', async () => {
      const result = await driver.findOne('task', { where: { id: 'find-1' } });
      expect(result).not.toBeNull();
      expect(result!.title).toBe('Find me');
      expect(result).not.toHaveProperty('_id');
    });

    it('should return null for non-existent record', async () => {
      const result = await driver.findOne('task', { where: { id: 'nonexistent' } });
      expect(result).toBeNull();
    });
  });

  describe('update', () => {
    it('should update a record and return updated data', async () => {
      await driver.create('task', { id: 'upd-1', title: 'Original', status: 'new' });
      const result = await driver.update('task', 'upd-1', { title: 'Updated', status: 'done' });
      expect(result.title).toBe('Updated');
      expect(result.status).toBe('done');
      expect(result.id).toBe('upd-1');
      expect(result).not.toHaveProperty('_id');
    });

    it('should update updated_at timestamp', async () => {
      await driver.create('task', { id: 'upd-2', title: 'Test' });
      const before = await driver.findOne('task', { where: { id: 'upd-2' } });

      // Small delay to ensure different timestamp
      await new Promise((r) => setTimeout(r, 10));

      await driver.update('task', 'upd-2', { title: 'Updated' });
      const after = await driver.findOne('task', { where: { id: 'upd-2' } });

      expect(new Date(after!.updated_at as string).getTime())
        .toBeGreaterThanOrEqual(new Date(before!.updated_at as string).getTime());
    });
  });

  describe('upsert', () => {
    it('should insert when record does not exist', async () => {
      const result = await driver.upsert('task', { id: 'ups-1', title: 'New' });
      expect(result.id).toBe('ups-1');
      expect(result.title).toBe('New');
    });

    it('should update when record exists', async () => {
      await driver.create('task', { id: 'ups-2', title: 'Original' });
      const result = await driver.upsert('task', { id: 'ups-2', title: 'Updated' });
      expect(result.title).toBe('Updated');
    });
  });

  describe('delete', () => {
    it('should delete an existing record', async () => {
      await driver.create('task', { id: 'del-1', title: 'Delete me' });
      const result = await driver.delete('task', 'del-1');
      expect(result).toBe(true);

      const found = await driver.findOne('task', { where: { id: 'del-1' } });
      expect(found).toBeNull();
    });

    it('should return false for non-existent record', async () => {
      const result = await driver.delete('task', 'nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('count', () => {
    beforeEach(async () => {
      await driver.bulkCreate('task', [
        { id: '1', status: 'active' },
        { id: '2', status: 'active' },
        { id: '3', status: 'done' },
      ]);
    });

    it('should count all records', async () => {
      expect(await driver.count('task')).toBe(3);
    });

    it('should count with filter', async () => {
      expect(await driver.count('task', { where: { status: 'active' } })).toBe(2);
    });
  });

  // ===========================================================================
  // Bulk Operations
  // ===========================================================================

  describe('bulk operations', () => {
    it('should bulk create records', async () => {
      const results = await driver.bulkCreate('task', [
        { title: 'Task 1' },
        { title: 'Task 2' },
        { title: 'Task 3' },
      ]);
      expect(results.length).toBe(3);
      expect(results[0].id).toBeDefined();
      expect(results[0]).not.toHaveProperty('_id');
    });

    it('should bulk update records', async () => {
      await driver.bulkCreate('task', [
        { id: 'bu-1', title: 'One', status: 'new' },
        { id: 'bu-2', title: 'Two', status: 'new' },
      ]);

      const results = await driver.bulkUpdate('task', [
        { id: 'bu-1', data: { status: 'done' } },
        { id: 'bu-2', data: { status: 'active' } },
      ]);

      expect(results.length).toBe(2);
      const statuses = results.map((r) => r.status);
      expect(statuses).toContain('done');
      expect(statuses).toContain('active');
    });

    it('should bulk delete records', async () => {
      await driver.bulkCreate('task', [
        { id: 'bd-1', title: 'One' },
        { id: 'bd-2', title: 'Two' },
        { id: 'bd-3', title: 'Three' },
      ]);

      await driver.bulkDelete('task', ['bd-1', 'bd-3']);
      const remaining = await driver.find('task', {});
      expect(remaining.length).toBe(1);
      expect(remaining[0].id).toBe('bd-2');
    });
  });

  describe('updateMany', () => {
    it('should update multiple records matching query', async () => {
      await driver.bulkCreate('task', [
        { id: 'um-1', status: 'new' },
        { id: 'um-2', status: 'new' },
        { id: 'um-3', status: 'done' },
      ]);

      const count = await driver.updateMany('task', { where: { status: 'new' } }, { status: 'active' });
      expect(count).toBe(2);
    });
  });

  describe('deleteMany', () => {
    it('should delete multiple records matching query', async () => {
      await driver.bulkCreate('task', [
        { id: 'dm-1', status: 'done' },
        { id: 'dm-2', status: 'done' },
        { id: 'dm-3', status: 'active' },
      ]);

      const count = await driver.deleteMany('task', { where: { status: 'done' } });
      expect(count).toBe(2);
      expect(await driver.count('task')).toBe(1);
    });
  });

  // ===========================================================================
  // Aggregation
  // ===========================================================================

  describe('aggregate', () => {
    beforeEach(async () => {
      await driver.bulkCreate('order', [
        { id: '1', customer_id: 'c1', amount: 100, region: 'US' },
        { id: '2', customer_id: 'c1', amount: 200, region: 'US' },
        { id: '3', customer_id: 'c2', amount: 150, region: 'EU' },
        { id: '4', customer_id: 'c2', amount: 300, region: 'EU' },
      ]);
    });

    it('should count all records', async () => {
      const results = await driver.aggregate('order', {
        aggregations: [{ function: 'count', alias: 'total' }],
      });
      expect(results[0].total).toBe(4);
    });

    it('should group by field with sum', async () => {
      const results = await driver.aggregate('order', {
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total_amount' }],
        groupBy: ['region'],
      });

      expect(results.length).toBe(2);
      const us = results.find((r) => r.region === 'US');
      const eu = results.find((r) => r.region === 'EU');
      expect(us!.total_amount).toBe(300);
      expect(eu!.total_amount).toBe(450);
    });
  });

  // ===========================================================================
  // Schema Sync
  // ===========================================================================

  describe('syncSchema', () => {
    it('should create collection and indexes', async () => {
      await driver.syncSchema('account', {
        name: 'account',
        fields: {
          name: { type: 'string', unique: true },
          email: { type: 'email' },
          company_id: { type: 'lookup', reference_to: 'company' },
        },
        // [#6810] `email` used to carry a field-level `indexed: true` here. That
        // was never a `FieldSchema` key (#2377 / ADR-0049); the index is
        // declared in `indexes[]`, where every other index in this system is
        // declared. Same resulting index name — the assertions are unchanged,
        // which is the point.
        indexes: [{ fields: ['email'] }],
      });

      const db = driver.getDb();
      const indexes = await db.collection('account').indexes();
      const indexNames = indexes.map((i: any) => i.name);

      expect(indexNames).toContain('idx_id_unique');
      expect(indexNames).toContain('idx_name_unique');
      expect(indexNames).toContain('idx_email');
      expect(indexNames).toContain('idx_company_id_lookup');
    });

    it('should be idempotent (safe to call multiple times)', async () => {
      const schema = { name: 'project', fields: { name: { type: 'string' } } };
      await driver.syncSchema('project', schema);
      await driver.syncSchema('project', schema);

      const count = await driver.count('project');
      expect(count).toBe(0); // Collection exists, no data
    });
  });

  describe('dropTable', () => {
    it('should drop collection', async () => {
      await driver.create('temp_table', { id: '1', name: 'test' });
      await driver.dropTable('temp_table');

      const count = await driver.count('temp_table');
      expect(count).toBe(0);
    });
  });

  // ===========================================================================
  // Filters (integration)
  // ===========================================================================

  describe('filter integration', () => {
    beforeEach(async () => {
      await driver.bulkCreate('user', [
        { id: '1', name: 'Alice', age: 25, role: 'admin' },
        { id: '2', name: 'Bob', age: 30, role: 'user' },
        { id: '3', name: 'Charlie', age: 35, role: 'user' },
        { id: '4', name: 'Diana', age: 28, role: 'manager' },
      ]);
    });

    it('should filter with $gt', async () => {
      const results = await driver.find('user', { where: { age: { $gt: 30 } } });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Charlie');
    });

    it('should filter with $in', async () => {
      const results = await driver.find('user', { where: { role: { $in: ['admin', 'manager'] } } });
      expect(results.length).toBe(2);
    });

    it('should filter with $contains', async () => {
      const results = await driver.find('user', { where: { name: { $contains: 'li' } } });
      expect(results.length).toBe(2); // Alice, Charlie
    });

    it('should filter with $and', async () => {
      const results = await driver.find('user', {
        where: { $and: [{ role: 'user' }, { age: { $gte: 35 } }] },
      });
      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Charlie');
    });

    it('should filter with $or', async () => {
      const results = await driver.find('user', {
        where: { $or: [{ role: 'admin' }, { age: { $gt: 34 } }] },
      });
      expect(results.length).toBe(2);
    });

    // ── RETIRED PIN (#5158, maintainer ruling C) ──────────────────────
    //
    // This slot held `should filter with legacy array style`, which asserted
    // that this driver COMPILES `where: [['age','>=',30], ['role','=','user']]`.
    // That is the dialect itself, and the dialect is what ruling C deletes:
    // `FilterArray` is INPUT-ONLY authoring sugar (spec `data/filter.zod.ts`,
    // #5285), lowered through `parseFilterAST` at the engine and protocol doors
    // before any driver is reached. A second compiler here is the ADR-0053
    // D-A1 divergence — the same one cloud's `RemoteTransport.buildWhereSQL`
    // closed from its side (cloud#1075).
    //
    // Same treatment as `driver-sql`'s two compile-asserting cases in
    // `sql-driver-filter-no-silent-drop.test.ts`: the dialect case becomes a
    // REFUSAL pin, plus a counterpart proving the identical authored shape
    // still compiles — and returns the same rows — once lowered. Retiring the
    // old assertion is the point of the change, not a casualty of it.

    it('refuses a raw array `where` — the dialect is gone (#5158)', async () => {
      await expect(
        driver.find('user', { where: [['age', '>=', 30], ['role', '=', 'user']] as any }),
      ).rejects.toThrow(/A filter ARRAY reached the driver/);
    });

    it('the same authored shape still returns the same rows, once lowered (#5158)', async () => {
      const results = await driver.find('user', {
        where: parseFilterAST([['age', '>=', 30], ['role', '=', 'user']]) as any,
      });
      expect(results.length).toBe(2);
    });
  });
});
