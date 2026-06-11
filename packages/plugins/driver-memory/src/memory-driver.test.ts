import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';

describe('InMemoryDriver', () => {
  let driver: InMemoryDriver;
  const testTable = 'test_table';

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
  });

  describe('Lifecycle', () => {
    it('should connect successfully', async () => {
      expect(driver.checkHealth()).resolves.toBe(true);
    });

    it('should clear data on disconnect', async () => {
      await driver.create(testTable, { id: '1', name: 'test' });
      await driver.disconnect();
      const results = await driver.find(testTable, { fields: ['id'], object: testTable });
      expect(results).toHaveLength(0);
    });
  });

  describe('Plugin Installation', () => {
      it('should register driver with engine', () => {
          const registerDriverFn = vi.fn();
          const mockEngine = {
              ql: {
                  registerDriver: registerDriverFn
              }
          };
          
          driver.install({ engine: mockEngine });
          expect(registerDriverFn).toHaveBeenCalledWith(driver);
      });
      
       it('should handle missing engine gracefully', () => {
          const mockCtx = {}; // No engine
          // Should not throw
          driver.install(mockCtx);
      });
  });

  describe('CRUD Operations', () => {
    it('should create and find records', async () => {
      const data = { id: '1', name: 'Alice', age: 30 };
      const created = await driver.create(testTable, data);
      expect(created.id).toBe('1');

      const results = await driver.find(testTable, { 
          fields: ['id', 'name', 'age'],
          object: testTable
      });
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
      expect(results[0].name).toBe('Alice');
    });

    it('should support updating records by ID', async () => {
      await driver.create(testTable, { id: '1', name: 'Bob', active: true });
      
      const updateResult = await driver.update(
          testTable, 
          '1', 
          { active: false }
      );
      
      expect(updateResult.active).toBe(false);
      
      const results = await driver.find(testTable, { fields: ['active'], object: testTable });
      expect(results[0].active).toBe(false);
    });

    it('should support deleting records by ID', async () => {
       await driver.create(testTable, { id: '1', name: 'Charlie' });
       await driver.create(testTable, { id: '2', name: 'David' });
       
       const deleteResult = await driver.delete(testTable, '1');
       expect(deleteResult).toBe(true);
       
       const results = await driver.find(testTable, { fields: ['name'], object: testTable });
       expect(results).toHaveLength(1);
       expect(results[0].name).toBe('David');
    });

    it('should return a copy of created record (immutability)', async () => {
      const created = await driver.create(testTable, { id: '1', name: 'Alice' });
      created.name = 'Modified';
      
      const found = await driver.find(testTable, { object: testTable });
      expect(found[0].name).toBe('Alice');
    });

    it('should preserve created_at on update', async () => {
      const created = await driver.create(testTable, { id: '1', name: 'Alice' });
      const originalCreatedAt = created.created_at;
      
      const updated = await driver.update(testTable, '1', { name: 'Alice Updated' });
      expect(updated.created_at).toBe(originalCreatedAt);
      expect(updated.name).toBe('Alice Updated');
    });
  });
  
  describe('Query Capability', () => {
      it('should filter results', async () => {
          await driver.create(testTable, { id: '1', role: 'admin' });
          await driver.create(testTable, { id: '2', role: 'user' });
          await driver.create(testTable, { id: '3', role: 'user' });
          
          const results = await driver.find(testTable, {
              fields: ['id'],
              object: testTable,
              where: { role: 'user' }
          });
          
          expect(results).toHaveLength(2);
      });

      it('should limit results', async () => {
           await driver.create(testTable, { id: '1' });
           await driver.create(testTable, { id: '2' });
           await driver.create(testTable, { id: '3' });
          
          const results = await driver.find(testTable, {
              fields: ['id'],
              object: testTable,
              limit: 2
          });
          
          expect(results).toHaveLength(2);
      });

      it('should project specific fields', async () => {
        await driver.create(testTable, { id: '1', name: 'Alice', age: 30, role: 'admin' });
        
        const results = await driver.find(testTable, {
          fields: ['name', 'age'],
          object: testTable,
        });
        
        expect(results).toHaveLength(1);
        expect(results[0].name).toBe('Alice');
        expect(results[0].age).toBe(30);
        expect(results[0].id).toBe('1'); // id always included
        expect(results[0].role).toBeUndefined();
      });
  });

  describe('Initial Data', () => {
    it('should load initial data on connect', async () => {
      const driverWithData = new InMemoryDriver({
        persistence: false,
        initialData: {
          users: [
            { id: '1', name: 'Alice' },
            { id: '2', name: 'Bob' },
          ],
          posts: [
            { id: '1', title: 'Hello World' },
          ],
        },
      });
      await driverWithData.connect();

      const users = await driverWithData.find('users', { object: 'users' });
      expect(users).toHaveLength(2);
      expect(users[0].name).toBe('Alice');

      const posts = await driverWithData.find('posts', { object: 'posts' });
      expect(posts).toHaveLength(1);
    });

    it('should generate IDs for initial data without IDs', async () => {
      const driverWithData = new InMemoryDriver({
        persistence: false,
        initialData: {
          items: [{ name: 'Widget' }],
        },
      });
      await driverWithData.connect();

      const items = await driverWithData.find('items', { object: 'items' });
      expect(items).toHaveLength(1);
      expect(items[0].id).toBeDefined();
      expect(typeof items[0].id).toBe('string');
    });
  });

  describe('Strict Mode', () => {
    it('should throw on update of missing record in strict mode', async () => {
      const strictDriver = new InMemoryDriver({ strictMode: true });
      await strictDriver.connect();

      await expect(
        strictDriver.update(testTable, 'non-existent', { name: 'Test' })
      ).rejects.toThrow('Record with ID non-existent not found');
    });

    it('should throw on delete of missing record in strict mode', async () => {
      const strictDriver = new InMemoryDriver({ strictMode: true });
      await strictDriver.connect();

      await expect(
        strictDriver.delete(testTable, 'non-existent')
      ).rejects.toThrow('Record with ID non-existent not found');
    });

    it('should return null on update of missing record in default mode', async () => {
      const result = await driver.update(testTable, 'non-existent', { name: 'Test' });
      expect(result).toBeNull();
    });

    it('should return false on delete of missing record in default mode', async () => {
      const result = await driver.delete(testTable, 'non-existent');
      expect(result).toBe(false);
    });
  });

  describe('Transaction Support', () => {
    it('should begin and commit a transaction', async () => {
      await driver.create(testTable, { id: '1', name: 'Alice' });
      
      const tx = await driver.beginTransaction();
      await driver.create(testTable, { id: '2', name: 'Bob' });
      await driver.commit(tx);

      const results = await driver.find(testTable, { object: testTable });
      expect(results).toHaveLength(2);
    });

    it('should rollback a transaction', async () => {
      await driver.create(testTable, { id: '1', name: 'Alice' });
      
      const tx = await driver.beginTransaction();
      await driver.create(testTable, { id: '2', name: 'Bob' });
      
      // Verify Bob exists before rollback
      let results = await driver.find(testTable, { object: testTable });
      expect(results).toHaveLength(2);

      await driver.rollback(tx);

      // After rollback, Bob should be gone
      results = await driver.find(testTable, { object: testTable });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice');
    });

    it('should handle rollback of updates', async () => {
      await driver.create(testTable, { id: '1', name: 'Alice' });
      
      const tx = await driver.beginTransaction();
      await driver.update(testTable, '1', { name: 'Alice Modified' });
      await driver.rollback(tx);

      const results = await driver.find(testTable, { object: testTable });
      expect(results[0].name).toBe('Alice');
    });

    it('should support capabilities.transactions = true', () => {
      expect(driver.supports.transactions).toBe(true);
    });
  });

  describe('Utility Methods', () => {
    it('should clear all data', async () => {
      await driver.create(testTable, { id: '1', name: 'Alice' });
      await driver.create('other_table', { id: '1', name: 'Bob' });
      
      expect(driver.getSize()).toBe(2);
      
      await driver.clear();
      
      expect(driver.getSize()).toBe(0);
    });

    it('should return correct size', async () => {
      expect(driver.getSize()).toBe(0);
      
      await driver.create(testTable, { id: '1' });
      expect(driver.getSize()).toBe(1);
      
      await driver.create(testTable, { id: '2' });
      expect(driver.getSize()).toBe(2);
      
      await driver.create('other', { id: '1' });
      expect(driver.getSize()).toBe(3);
    });

    it('should return distinct values for a field', async () => {
      await driver.create(testTable, { id: '1', role: 'admin' });
      await driver.create(testTable, { id: '2', role: 'user' });
      await driver.create(testTable, { id: '3', role: 'user' });
      await driver.create(testTable, { id: '4', role: 'moderator' });

      const roles = await driver.distinct(testTable, 'role');
      expect(roles).toHaveLength(3);
      expect(roles).toContain('admin');
      expect(roles).toContain('user');
      expect(roles).toContain('moderator');
    });

    it('should return distinct values with filter', async () => {
      await driver.create(testTable, { id: '1', role: 'admin', active: true });
      await driver.create(testTable, { id: '2', role: 'user', active: false });
      await driver.create(testTable, { id: '3', role: 'user', active: true });

      const roles = await driver.distinct(testTable, 'role', {
        object: testTable,
        where: { active: true },
      });
      expect(roles).toHaveLength(2);
      expect(roles).toContain('admin');
      expect(roles).toContain('user');
    });
  });

  describe('Schema Management', () => {
    it('should create table on syncSchema', async () => {
      await driver.syncSchema('new_table', {});
      const results = await driver.find('new_table', { object: 'new_table' });
      expect(results).toHaveLength(0);
    });

    it('should drop table', async () => {
      await driver.create(testTable, { id: '1', name: 'test' });
      await driver.dropTable(testTable);
      const results = await driver.find(testTable, { object: testTable });
      expect(results).toHaveLength(0);
    });
  });

  describe('Bulk Operations', () => {
    it('should bulk create records', async () => {
      const records = [
        { name: 'Alice' },
        { name: 'Bob' },
        { name: 'Charlie' },
      ];
      const results = await driver.bulkCreate(testTable, records);
      expect(results).toHaveLength(3);
      expect(results[0].name).toBe('Alice');
      expect(results[1].name).toBe('Bob');
    });

    it('should count records', async () => {
      await driver.create(testTable, { id: '1', role: 'admin' });
      await driver.create(testTable, { id: '2', role: 'user' });
      await driver.create(testTable, { id: '3', role: 'user' });

      const total = await driver.count(testTable);
      expect(total).toBe(3);

      const userCount = await driver.count(testTable, {
        object: testTable,
        where: { role: 'user' },
      });
      expect(userCount).toBe(2);
    });
  });

  describe('ID Generation', () => {
    it('should generate unique counter-based IDs', async () => {
      const r1 = await driver.create(testTable, { name: 'A' });
      const r2 = await driver.create(testTable, { name: 'B' });
      
      expect(r1.id).toBeDefined();
      expect(r2.id).toBeDefined();
      expect(r1.id).not.toBe(r2.id);
      // Counter-based IDs include the table name
      expect(r1.id).toContain(testTable);
    });
  });

  describe('Version', () => {
    it('should report version 1.0.0', () => {
      expect(driver.version).toBe('1.0.0');
    });
  });

  describe('Mingo Aggregation Pipeline', () => {
    beforeEach(async () => {
      // Seed order data for aggregation tests
      await driver.create('orders', { id: '1', customer: 'alice', amount: 100, status: 'completed' });
      await driver.create('orders', { id: '2', customer: 'bob',   amount: 200, status: 'completed' });
      await driver.create('orders', { id: '3', customer: 'alice', amount: 150, status: 'pending' });
      await driver.create('orders', { id: '4', customer: 'bob',   amount: 300, status: 'completed' });
      await driver.create('orders', { id: '5', customer: 'charlie', amount: 50, status: 'cancelled' });
    });

    it('should $group and $sum', async () => {
      const results = await driver.aggregate('orders', [
        { $match: { status: 'completed' } },
        { $group: { _id: '$customer', totalAmount: { $sum: '$amount' } } },
        { $sort: { _id: 1 } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]._id).toBe('alice');
      expect(results[0].totalAmount).toBe(100);
      expect(results[1]._id).toBe('bob');
      expect(results[1].totalAmount).toBe(500);
    });

    it('should $group with $avg', async () => {
      const results = await driver.aggregate('orders', [
        { $group: { _id: null, avgAmount: { $avg: '$amount' } } },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].avgAmount).toBe(160); // (100+200+150+300+50)/5
    });

    it('should $group with $min and $max', async () => {
      const results = await driver.aggregate('orders', [
        { $group: { _id: null, minAmount: { $min: '$amount' }, maxAmount: { $max: '$amount' } } },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].minAmount).toBe(50);
      expect(results[0].maxAmount).toBe(300);
    });

    it('should $group with $count', async () => {
      const results = await driver.aggregate('orders', [
        { $match: { status: 'completed' } },
        { $count: 'completedCount' },
      ]);

      expect(results).toHaveLength(1);
      expect(results[0].completedCount).toBe(3);
    });

    it('should $sort pipeline stage', async () => {
      const results = await driver.aggregate('orders', [
        { $sort: { amount: -1 } },
        { $limit: 3 },
      ]);

      expect(results).toHaveLength(3);
      expect(results[0].amount).toBe(300);
      expect(results[1].amount).toBe(200);
      expect(results[2].amount).toBe(150);
    });

    it('should $project pipeline stage', async () => {
      const results = await driver.aggregate('orders', [
        { $match: { customer: 'alice' } },
        { $project: { customer: 1, amount: 1, _id: 0 } },
        { $sort: { amount: 1 } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]).toEqual({ customer: 'alice', amount: 100 });
      expect(results[1]).toEqual({ customer: 'alice', amount: 150 });
    });

    it('should $group with $push (collect values)', async () => {
      const results = await driver.aggregate('orders', [
        { $match: { status: 'completed' } },
        { $group: { _id: '$customer', amounts: { $push: '$amount' } } },
        { $sort: { _id: 1 } },
      ]);

      expect(results).toHaveLength(2);
      expect(results[0]._id).toBe('alice');
      expect(results[0].amounts).toEqual([100]);
      expect(results[1]._id).toBe('bob');
      expect(results[1].amounts).toEqual([200, 300]);
    });
  });

  describe('Mingo Query Operators', () => {
    beforeEach(async () => {
      await driver.create(testTable, { id: '1', name: 'Alice', age: 30, score: 85 });
      await driver.create(testTable, { id: '2', name: 'Bob', age: 25, score: 92 });
      await driver.create(testTable, { id: '3', name: 'Charlie', age: 35, score: 78 });
      await driver.create(testTable, { id: '4', name: 'Diana', age: 28, score: 95 });
    });

    it('should filter with $gt operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { age: { $gt: 28 } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Alice', 'Charlie']);
    });

    it('should filter with $in operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { name: { $in: ['Alice', 'Diana'] } },
      });
      expect(results).toHaveLength(2);
    });

    it('should filter with $and operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { $and: [{ age: { $gte: 28 } }, { score: { $gt: 80 } }] },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Alice', 'Diana']);
    });

    it('should filter with $or operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { $or: [{ age: { $lt: 26 } }, { score: { $gte: 95 } }] },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Bob', 'Diana']);
    });

    it('should filter with $regex operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { name: { $regex: /^[AB]/ } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Alice', 'Bob']);
    });

    it('should count with complex filter', async () => {
      const count = await driver.count(testTable, {
        object: testTable,
        where: { age: { $gte: 30 } },
      });
      expect(count).toBe(2);
    });
  });

  describe('Aggregation Edge Cases', () => {
    it('should aggregate empty collection', async () => {
      const results = await driver.aggregate('empty_table', [
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      expect(results).toHaveLength(0);
    });

    it('should handle pipeline with only $match', async () => {
      await driver.create(testTable, { id: '1', status: 'active' });
      await driver.create(testTable, { id: '2', status: 'inactive' });

      const results = await driver.aggregate(testTable, [
        { $match: { status: 'active' } },
      ]);
      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('active');
    });
  });

  describe('AST Filter Conversion', () => {
    beforeEach(async () => {
      await driver.create(testTable, { id: '1', name: 'Alice', age: 30 });
      await driver.create(testTable, { id: '2', name: 'Bob', age: 25 });
      await driver.create(testTable, { id: '3', name: 'Charlie', age: 35 });
    });

    it('should handle AST comparison node filter', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { type: 'comparison', field: 'age', operator: '>', value: 28 },
      });
      expect(results).toHaveLength(2);
    });

    it('should handle AST logical node filter', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: {
          type: 'logical',
          operator: 'or',
          conditions: [
            { type: 'comparison', field: 'name', operator: '=', value: 'Alice' },
            { type: 'comparison', field: 'name', operator: '=', value: 'Charlie' },
          ],
        },
      });
      expect(results).toHaveLength(2);
    });

    it('should handle empty where clause', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
      });
      expect(results).toHaveLength(3);
    });
  });

  describe('FilterCondition Object Format (from parseFilterAST)', () => {
    beforeEach(async () => {
      await driver.create(testTable, { id: '1', name: 'Alice Johnson', age: 30, email: 'alice@example.com', bio: null });
      await driver.create(testTable, { id: '2', name: 'Bob Smith', age: 25, email: 'bob@test.com', bio: 'Developer' });
      await driver.create(testTable, { id: '3', name: 'Charlie Brown', age: 35, email: 'charlie@example.com', bio: '' });
      await driver.create(testTable, { id: '4', name: 'Evan Davis', age: 28, email: 'evan@test.com', bio: 'Designer' });
    });

    it('should filter with $contains operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { name: { $contains: 'Evan' } },
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Evan Davis');
    });

    it('should filter with $contains case-insensitively', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { name: { $contains: 'alice' } },
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Johnson');
    });

    it('should filter with $notContains operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { email: { $notContains: 'example' } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Bob Smith', 'Evan Davis']);
    });

    it('should filter with $startsWith operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { name: { $startsWith: 'Ch' } },
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Charlie Brown');
    });

    it('should filter with $endsWith operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { email: { $endsWith: '.com' } },
      });
      expect(results).toHaveLength(4);
    });

    it('should filter with $between operator', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { age: { $between: [26, 32] } },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Alice Johnson', 'Evan Davis']);
    });

    it('should filter with $null: true', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { bio: { $null: true } },
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Johnson');
    });

    it('should filter with $null: false', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { bio: { $null: false } },
      });
      expect(results).toHaveLength(3);
    });

    it('should handle $contains inside $and', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { $and: [{ name: { $contains: 'a' } }, { age: { $gte: 30 } }] },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Alice Johnson', 'Charlie Brown']);
    });

    it('should handle $startsWith inside $or', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { $or: [{ name: { $startsWith: 'Al' } }, { name: { $startsWith: 'Ev' } }] },
      });
      expect(results).toHaveLength(2);
      expect(results.map((r: any) => r.name).sort()).toEqual(['Alice Johnson', 'Evan Davis']);
    });

    it('should handle AST-converted notcontains via convertConditionToMongo', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { type: 'comparison', field: 'name', operator: 'notcontains', value: 'Bob' },
      });
      expect(results).toHaveLength(3);
    });

    it('should handle combined $startsWith + $endsWith on same field', async () => {
      const results = await driver.find(testTable, {
        object: testTable,
        where: { name: { $startsWith: 'A', $endsWith: 'son' } },
      });
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe('Alice Johnson');
    });

    it('should filter with $null: true on missing fields', async () => {
      // bio is null for Alice Johnson — should match
      // Records without bio field at all should also match $null: true
      await driver.create(testTable, { id: '5', name: 'Frank', age: 40, email: 'frank@test.com' });
      const results = await driver.find(testTable, {
        object: testTable,
        where: { bio: { $null: true } },
      });
      // Alice (bio: null), Frank (bio: missing)
      expect(results.length).toBeGreaterThanOrEqual(2);
      expect(results.map((r: any) => r.name)).toContain('Alice Johnson');
      expect(results.map((r: any) => r.name)).toContain('Frank');
    });
  });

  describe('Read isolation (no live references into the backing table)', () => {
    // Callers (notably the ObjectQL engine's read-time mutations — secret-field
    // masking, expand, afterFind hooks) mutate returned rows in place. find /
    // findOne must therefore hand back COPIES, never live references into the
    // stored table — otherwise a read would corrupt the persisted record (e.g.
    // overwrite a `secret:` ref with the read mask, permanently losing the
    // secret). `create()` already honors this; these guard find / findOne.
    beforeEach(async () => {
      await driver.create(testTable, { id: '1', name: 'original', secret_ref: 'secret:abc123' });
    });

    it('find() returns copies — mutating a result does not change the store', async () => {
      const first = await driver.find(testTable, { object: testTable, where: { id: '1' } });
      (first[0] as any).secret_ref = '••••••••'; // simulate engine masking the row in place

      const second = await driver.find(testTable, { object: testTable, where: { id: '1' } });
      expect((second[0] as any).secret_ref).toBe('secret:abc123'); // store intact
      expect(second[0]).not.toBe(first[0]); // distinct object identity
    });

    it('findOne() returns a copy — mutating it does not change the store', async () => {
      const first = await driver.findOne(testTable, { object: testTable, where: { id: '1' } });
      (first as any).secret_ref = '••••••••';

      const second = await driver.findOne(testTable, { object: testTable, where: { id: '1' } });
      expect((second as any).secret_ref).toBe('secret:abc123');
      expect(second).not.toBe(first);
    });
  });

  describe('aggregate() — QueryAST shape (analytics fallback path)', () => {
    let driver: InMemoryDriver;
    const tbl = 'expenses';

    beforeEach(async () => {
      driver = new InMemoryDriver({});
      await driver.connect();
      await driver.create(tbl, { id: '1', category: 'travel', amount: 100 });
      await driver.create(tbl, { id: '2', category: 'travel', amount: 50 });
      await driver.create(tbl, { id: '3', category: 'meals', amount: 30 });
    });

    it('accepts the engine AST ({groupBy, aggregations}) and returns grouped sums', async () => {
      const rows = await driver.aggregate(tbl, {
        object: tbl,
        groupBy: ['category'],
        aggregations: [{ function: 'sum', field: 'amount', alias: 'amount' }],
      } as any);
      const byCat = Object.fromEntries(rows.map((r: any) => [r.category, r.amount]));
      expect(byCat).toEqual({ travel: 150, meals: 30 });
    });

    it('AST with no groupBy returns a single total row; where filters first', async () => {
      const rows = await driver.aggregate(tbl, {
        object: tbl,
        where: { category: 'travel' },
        aggregations: [{ function: 'sum', field: 'amount', alias: 'total' }, { function: 'count', field: '*', alias: 'count' }],
      } as any);
      expect(rows).toEqual([{ total: 150, count: 2 }]);
    });

    it('still accepts a real MongoDB pipeline array (Mingo passthrough)', async () => {
      const rows = await driver.aggregate(tbl, [
        { $match: { category: 'travel' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      expect((rows[0] as any).total).toBe(150);
    });
  });

});
