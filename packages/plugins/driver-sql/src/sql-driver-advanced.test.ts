// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

describe('SqlDriver Advanced Operations (SQLite)', () => {
  let driver: SqlDriver;
  let knexInstance: any;

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    knexInstance = (driver as any).knex;

    await knexInstance.schema.createTable('orders', (t: any) => {
      t.string('id').primary();
      t.string('customer');
      t.string('product');
      t.float('amount');
      t.integer('quantity');
      t.string('status');
      t.timestamp('created_at').defaultTo(knexInstance.fn.now());
    });

    await knexInstance('orders').insert([
      { id: '1', customer: 'Alice', product: 'Laptop', amount: 1200.0, quantity: 1, status: 'completed' },
      { id: '2', customer: 'Bob', product: 'Mouse', amount: 25.5, quantity: 2, status: 'completed' },
      { id: '3', customer: 'Alice', product: 'Keyboard', amount: 75.0, quantity: 1, status: 'pending' },
      { id: '4', customer: 'Charlie', product: 'Monitor', amount: 350.0, quantity: 1, status: 'completed' },
      { id: '5', customer: 'Bob', product: 'Laptop', amount: 1200.0, quantity: 1, status: 'cancelled' },
    ]);
  });

  afterEach(async () => {
    await knexInstance.destroy();
  });

  describe('Aggregate Operations', () => {
    it('should sum values', async () => {
      const result = await driver.aggregate('orders', {
        where: { status: 'completed' },
        aggregate: [{ func: 'sum', field: 'amount', alias: 'total_amount' }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].total_amount).toBe(1575.5);
    });

    it('should count records', async () => {
      const result = await driver.aggregate('orders', {
        aggregate: [{ func: 'count', field: '*', alias: 'total_orders' }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].total_orders).toBe(5);
    });

    it('should calculate average', async () => {
      const result = await driver.aggregate('orders', {
        where: { status: 'completed' },
        aggregate: [{ func: 'avg', field: 'amount', alias: 'avg_amount' }],
      });

      expect(result).toHaveLength(1);
      expect(result[0].avg_amount).toBeCloseTo(525.17, 2);
    });

    it('should find min and max values', async () => {
      const result = await driver.aggregate('orders', {
        aggregate: [
          { func: 'min', field: 'amount', alias: 'min_amount' },
          { func: 'max', field: 'amount', alias: 'max_amount' },
        ],
      });

      expect(result).toHaveLength(1);
      expect(result[0].min_amount).toBe(25.5);
      expect(result[0].max_amount).toBe(1200.0);
    });

    it('should group by with aggregates', async () => {
      const result = await driver.aggregate('orders', {
        groupBy: ['customer'],
        aggregate: [
          { func: 'sum', field: 'amount', alias: 'total_spent' },
          { func: 'count', field: '*', alias: 'order_count' },
        ],
      });

      expect(result).toHaveLength(3);

      const alice = result.find((r: any) => r.customer === 'Alice');
      expect(alice.total_spent).toBe(1275.0);
      expect(alice.order_count).toBe(2);

      const bob = result.find((r: any) => r.customer === 'Bob');
      expect(bob.total_spent).toBe(1225.5);
      expect(bob.order_count).toBe(2);
    });

    it('should handle multiple group by fields', async () => {
      const result = await driver.aggregate('orders', {
        groupBy: ['customer', 'status'],
        aggregate: [{ func: 'sum', field: 'quantity', alias: 'total_qty' }],
      });

      expect(result.length).toBeGreaterThan(0);

      const aliceCompleted = result.find((r: any) => r.customer === 'Alice' && r.status === 'completed');
      expect(aliceCompleted).toBeDefined();
      expect(aliceCompleted.total_qty).toBe(1);
    });

    it('should aggregate with filters and groupBy', async () => {
      const result = await driver.aggregate('orders', {
        where: { status: { $ne: 'cancelled' } },
        groupBy: ['product'],
        aggregate: [{ func: 'sum', field: 'quantity', alias: 'total_quantity' }],
      });

      const laptop = result.find((r: any) => r.product === 'Laptop');
      expect(laptop.total_quantity).toBe(1);
    });
  });

  describe('Bulk Operations', () => {
    it('should create many records', async () => {
      const newOrders = [
        { id: '6', customer: 'Dave', product: 'Tablet', amount: 500.0, quantity: 1, status: 'pending' },
        { id: '7', customer: 'Eve', product: 'Phone', amount: 800.0, quantity: 1, status: 'pending' },
        { id: '8', customer: 'Frank', product: 'Headphones', amount: 150.0, quantity: 2, status: 'completed' },
      ];

      const result = await driver.bulkCreate('orders', newOrders);

      expect(result).toBeDefined();
      expect(result.length).toBe(3);

      const count = await driver.count('orders', {});
      expect(count).toBe(8);
    });

    it('should update many records', async () => {
      const result = await driver.updateMany('orders', { where: { status: 'pending' } } as any, { status: 'processing' });

      expect(result).toBeGreaterThan(0);

      const results = await driver.find('orders', { where: { status: 'processing' } });
      expect(results.length).toBe(1);
    });

    it('should delete many records', async () => {
      const result = await driver.deleteMany('orders', { where: { status: 'cancelled' } } as any);

      expect(result).toBe(1);

      const remaining = await driver.count('orders', {});
      expect(remaining).toBe(4);
    });

    it('should handle empty bulk update and delete', async () => {
      const result = await driver.updateMany('orders', { where: { status: 'nonexistent' } } as any, { status: 'updated' });
      expect(result).toBe(0);

      const deleteResult = await driver.deleteMany('orders', { where: { id: 'nonexistent' } } as any);
      expect(deleteResult).toBe(0);
    });
  });

  describe('Transaction Support', () => {
    it('should commit a transaction', async () => {
      const trx = await driver.beginTransaction();

      try {
        await driver.create(
          'orders',
          {
            id: 'trx1',
            customer: 'TxUser',
            product: 'Item',
            amount: 100.0,
            quantity: 1,
            status: 'completed',
          },
          { transaction: trx },
        );

        await driver.commitTransaction(trx);

        const result = await driver.findOne('orders', 'trx1' as any);
        expect(result).toBeDefined();
        expect(result.customer).toBe('TxUser');
      } catch (e) {
        await driver.rollbackTransaction(trx);
        throw e;
      }
    });

    it('should rollback a transaction', async () => {
      const trx = await driver.beginTransaction();

      try {
        await driver.create(
          'orders',
          {
            id: 'trx2',
            customer: 'TxUser2',
            product: 'Item2',
            amount: 200.0,
            quantity: 1,
            status: 'completed',
          },
          { transaction: trx },
        );

        await driver.rollbackTransaction(trx);

        const result = await driver.findOne('orders', 'trx2' as any);
        expect(result).toBeNull();
      } catch (e) {
        await driver.rollbackTransaction(trx);
        throw e;
      }
    });

    it('should handle multiple operations in a transaction', async () => {
      const trx = await driver.beginTransaction();

      try {
        await driver.create(
          'orders',
          {
            id: 'trx3',
            customer: 'MultiOp',
            product: 'Product1',
            amount: 100.0,
            quantity: 1,
            status: 'pending',
          },
          { transaction: trx },
        );

        await driver.update('orders', '1', { status: 'shipped' }, { transaction: trx });

        await driver.delete('orders', '5', { transaction: trx });

        await driver.commitTransaction(trx);

        const created = await driver.findOne('orders', 'trx3' as any);
        expect(created).toBeDefined();

        const updated = await driver.findOne('orders', '1' as any);
        expect(updated.status).toBe('shipped');

        const deleted = await driver.findOne('orders', '5' as any);
        expect(deleted).toBeNull();
      } catch (e) {
        await driver.rollbackTransaction(trx);
        throw e;
      }
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle empty filters gracefully', async () => {
      const results = await driver.find('orders', { where: {} });
      expect(results.length).toBe(5);
    });

    it('should handle undefined query parameters', async () => {
      const results = await driver.find('orders', {});
      expect(results.length).toBe(5);
    });

    it('should handle null values in data', async () => {
      await knexInstance.schema.createTable('nullable_test', (t: any) => {
        t.string('id').primary();
        t.string('name').nullable();
        t.integer('value').nullable();
      });

      await driver.create('nullable_test', { id: '1', name: null, value: null });

      const result = await driver.findOne('nullable_test', '1' as any);
      expect(result).toBeDefined();
      expect(result.name).toBeNull();
      expect(result.value).toBeNull();
    });

    it('should handle pagination with offset and limit', async () => {
      const page1 = await driver.find('orders', {
        orderBy: [{ field: 'id', order: 'asc' }],
        offset: 0,
        limit: 2,
      });
      expect(page1.length).toBe(2);
      expect(page1[0].id).toBe('1');

      const page2 = await driver.find('orders', {
        orderBy: [{ field: 'id', order: 'asc' }],
        offset: 2,
        limit: 2,
      });
      expect(page2.length).toBe(2);
      expect(page2[0].id).toBe('3');
    });

    it('should handle offset beyond total records', async () => {
      const results = await driver.find('orders', { offset: 100, limit: 10 });
      expect(results.length).toBe(0);
    });

    it('should handle complex nested filters', async () => {
      const results = await driver.find('orders', {
        where: {
          $or: [
            { $and: [{ status: 'completed' }, { amount: { $gt: 100 } }] },
            { $and: [{ customer: 'Alice' }, { status: 'pending' }] },
          ],
        },
      });

      // Was `toBeGreaterThan(0)`, which any non-empty result satisfies. This
      // particular shape was never miscompiled by #3774 — each `$or` branch
      // holds a single `$and` key, so there were no sibling keys to wrongly OR
      // — but the assertion was too weak to have noticed either way, which is
      // the only reason it is worth tightening. Branch one is completed AND
      // over 100 (Laptop 1200, Monitor 350); branch two is Alice AND pending
      // (Keyboard).
      expect(results.map((r: any) => r.id).sort()).toEqual(['1', '3', '4']);
    });

    it('should handle contains filter', async () => {
      const results = await driver.find('orders', {
        where: { product: { $contains: 'top' } },
      });

      expect(results.length).toBe(2);
      expect(results.every((r: any) => r.product.toLowerCase().includes('top'))).toBe(true);
    });

    it('should handle in filter', async () => {
      const results = await driver.find('orders', {
        where: { status: { $in: ['completed', 'pending'] } },
      });

      expect(results.length).toBe(4);
    });

    it('should handle nin (not in) filter', async () => {
      const results = await driver.find('orders', {
        where: { status: { $nin: ['cancelled'] } },
      });

      expect(results.length).toBe(4);
    });

    it('should handle findOne with query parameter', async () => {
      const result = await driver.findOne('orders', { where: { customer: 'Charlie' } });

      expect(result).toBeDefined();
      expect(result.customer).toBe('Charlie');
    });

    it('should return null for non-existent record', async () => {
      const result = await driver.findOne('orders', 'nonexistent' as any);
      expect(result).toBeNull();
    });

    it('should handle count with complex filters', async () => {
      const count = await driver.count('orders', {
        where: { $and: [{ status: 'completed' }, { amount: { $gt: 100 } }] },
      } as any);

      expect(count).toBe(2);
    });
  });

  describe('Distinct Method', () => {
    it('should get distinct values for a field', async () => {
      const statuses = await driver.distinct('orders', 'status');

      expect(statuses).toBeDefined();
      expect(Array.isArray(statuses)).toBe(true);
      expect(statuses).toHaveLength(3);
      expect(statuses).toEqual(expect.arrayContaining(['cancelled', 'completed', 'pending']));
    });

    it('should get distinct values with filters', async () => {
      const products = await driver.distinct('orders', 'product', { status: 'completed' });

      expect(products).toBeDefined();
      expect(products.length).toBe(3);
      expect(products).toContain('Laptop');
      expect(products).toContain('Mouse');
      expect(products).toContain('Monitor');
    });

    it('should return empty array for non-existent values', async () => {
      const values = await driver.distinct('orders', 'product', { status: 'nonexistent' });
      expect(values).toEqual([]);
    });
  });

  describe('Window Functions', () => {
    it('should execute ROW_NUMBER window function', async () => {
      const results = await driver.findWithWindowFunctions('orders', {
        windowFunctions: [
          {
            function: 'ROW_NUMBER',
            alias: 'row_num',
            orderBy: [{ field: 'amount', order: 'desc' }],
          },
        ],
        orderBy: [{ field: 'amount', order: 'desc' }],
      });

      expect(results).toBeDefined();
      expect(results.length).toBe(5);
      expect(results[0].row_num).toBe(1);
      expect(results[0].amount).toBe(1200.0);
    });

    it('should execute RANK window function', async () => {
      const results = await driver.findWithWindowFunctions('orders', {
        windowFunctions: [
          {
            function: 'RANK',
            alias: 'rank',
            orderBy: [{ field: 'amount', order: 'desc' }],
          },
        ],
        orderBy: [{ field: 'amount', order: 'desc' }],
      });

      expect(results).toBeDefined();
      expect(results.length).toBe(5);
      expect(results[0].rank).toBe(1);
    });

    it('should partition window function by field', async () => {
      const results = await driver.findWithWindowFunctions('orders', {
        windowFunctions: [
          {
            function: 'ROW_NUMBER',
            alias: 'customer_row',
            partitionBy: ['customer'],
            orderBy: [{ field: 'amount', order: 'desc' }],
          },
        ],
        orderBy: [{ field: 'customer', order: 'asc' }, { field: 'amount', order: 'desc' }],
      });

      expect(results).toBeDefined();

      const aliceOrders = results.filter((r: any) => r.customer === 'Alice');
      expect(aliceOrders.length).toBe(2);
    });

    it('should apply filters with window functions', async () => {
      const results = await driver.findWithWindowFunctions('orders', {
        where: { status: 'completed' },
        windowFunctions: [
          {
            function: 'ROW_NUMBER',
            alias: 'row_num',
            orderBy: [{ field: 'amount', order: 'desc' }],
          },
        ],
      });

      expect(results).toBeDefined();
      expect(results.length).toBe(3);
      expect(results.every((r: any) => r.status === 'completed')).toBe(true);
    });
  });

  describe('Query Plan Analysis', () => {
    it('should analyze a simple query', async () => {
      const analysis = await driver.analyzeQuery('orders', {
        where: { status: 'completed' },
      });

      expect(analysis).toBeDefined();
      expect(analysis.sql).toBeDefined();
      expect(analysis.client).toBe('better-sqlite3');
    });

    it('should analyze a complex query with filters', async () => {
      const analysis = await driver.analyzeQuery('orders', {
        where: {
          $and: [{ status: 'completed' }, { amount: { $gt: 100 } }],
        },
        orderBy: [{ field: 'amount', order: 'desc' }],
        limit: 10,
      });

      expect(analysis).toBeDefined();
      expect(analysis.sql).toBeDefined();
      expect(analysis.bindings).toBeDefined();
    });
  });
});
