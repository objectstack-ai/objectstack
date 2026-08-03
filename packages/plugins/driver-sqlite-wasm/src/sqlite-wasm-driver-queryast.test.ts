// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteWasmDriver } from '../src/index.js';

/**
 * QueryAST format tests — verifies compatibility with @objectstack/spec QueryAST.
 */
describe('SqliteWasmDriver (QueryAST Format)', () => {
  let driver: SqliteWasmDriver;

  beforeEach(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });

    const k = (driver as any).knex;

    await k.schema.createTable('products', (t: any) => {
      t.string('id').primary();
      t.string('name');
      t.float('price');
      t.string('category');
    });

    await k('products').insert([
      { id: '1', name: 'Laptop', price: 1200, category: 'Electronics' },
      { id: '2', name: 'Mouse', price: 25, category: 'Electronics' },
      { id: '3', name: 'Desk', price: 350, category: 'Furniture' },
      { id: '4', name: 'Chair', price: 200, category: 'Furniture' },
      { id: '5', name: 'Monitor', price: 400, category: 'Electronics' },
    ]);
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  describe('Driver Metadata', () => {
    it('should expose driver metadata for ObjectStack compatibility', () => {
      expect(driver.name).toBe('com.objectstack.driver.sqlite-wasm');
      expect(driver.version).toBeDefined();
      expect(driver.supports).toBeDefined();
      // #4634: only the live capability bits remain (inherited from SqlDriver).
      expect(driver.supports.autonumber).toBe(true);
      expect(driver.supports).not.toHaveProperty('transactions');
    });
  });

  describe('Lifecycle Methods', () => {
    it('should support connect method', async () => {
      await expect(driver.connect()).resolves.toBeUndefined();
    });

    it('should support checkHealth method', async () => {
      const healthy = await driver.checkHealth();
      expect(healthy).toBe(true);
    });

    it('should support disconnect method', async () => {
      const testDriver = new SqliteWasmDriver({ filename: ':memory:' });

      await expect(testDriver.disconnect()).resolves.toBeUndefined();
      const healthy = await testDriver.checkHealth();
      expect(healthy).toBe(false);
    });
  });

  describe('QueryAST Format Support', () => {
    it('should support QueryAST with limit and orderBy', async () => {
      const results = await driver.find('products', {
        fields: ['name', 'price'],
        limit: 2,
        orderBy: [{ field: 'price', order: 'asc' as const }],
      } as any);

      expect(results.length).toBe(2);
      expect(results[0].name).toBe('Mouse');
      expect(results[1].name).toBe('Chair');
    });

    it('should support QueryAST orderBy with object notation', async () => {
      const results = await driver.find('products', {
        fields: ['name'],
        orderBy: [
          { field: 'category', order: 'asc' as const },
          { field: 'price', order: 'desc' as const },
        ],
      } as any);

      expect(results.length).toBe(5);
      expect(results[0].name).toBe('Laptop');
      expect(results[3].name).toBe('Desk');
    });

    it('should support QueryAST with where, offset, limit, and orderBy', async () => {
      const results = await driver.find('products', {
        where: [['category', '=', 'Electronics']],
        offset: 1,
        limit: 1,
        orderBy: [{ field: 'price', order: 'asc' as const }],
      } as any);

      expect(results.length).toBe(1);
      expect(results[0].name).toBe('Monitor');
    });

    it('should support aggregations in QueryAST format', async () => {
      const results = await driver.aggregate('products', {
        aggregations: [
          { function: 'sum' as const, field: 'price', alias: 'total_price' },
          { function: 'count' as const, field: '*', alias: 'count' },
        ],
        groupBy: ['category'],
      });

      expect(results.length).toBe(2);

      const electronics = results.find((r: any) => r.category === 'Electronics');
      const furniture = results.find((r: any) => r.category === 'Furniture');

      expect(electronics).toBeDefined();
      expect(electronics.total_price).toBe(1625);

      expect(furniture).toBeDefined();
      expect(furniture.total_price).toBe(550);
    });

    it('should support count with QueryAST where clause', async () => {
      const count = await driver.count('products', {
        where: [['price', '>', 300]],
      } as any);
      expect(count).toBe(3);
    });
  });

  describe('Standard QueryAST Pagination', () => {
    it('should support limit with orderBy using standard keys', async () => {
      const results = await driver.find('products', {
        fields: ['name'],
        limit: 2,
        orderBy: [{ field: 'price', order: 'asc' }],
      } as any);

      expect(results.length).toBe(2);
      expect(results[0].name).toBe('Mouse');
    });

    it('should still support legacy aggregate format', async () => {
      const results = await driver.aggregate('products', {
        aggregate: [{ func: 'avg', field: 'price', alias: 'avg_price' }],
        groupBy: ['category'],
      });

      expect(results.length).toBe(2);
      const electronics = results.find((r: any) => r.category === 'Electronics');
      expect(electronics.avg_price).toBeCloseTo(541.67, 1);
    });

    it('should support offset and limit with orderBy', async () => {
      const results = await driver.find('products', {
        limit: 3,
        offset: 2,
        orderBy: [{ field: 'name', order: 'asc' as const }],
      } as any);

      expect(results.length).toBe(3);
      expect(results[0].name).toBe('Laptop');
      expect(results[1].name).toBe('Monitor');
      expect(results[2].name).toBe('Mouse');
    });
  });

  describe('Legacy Keys Are Ignored', () => {
    it('should ignore legacy "filters" key — only "where" is recognized', async () => {
      const results = await driver.find('products', {
        filters: [['category', '=', 'Furniture']],
      } as any);

      // "filters" is not recognized, so no WHERE clause is applied — returns all rows
      expect(results.length).toBe(5);
    });

    it('should use "where" and ignore "filters" when both are present', async () => {
      const results = await driver.find('products', {
        where: [['category', '=', 'Electronics']],
        filters: [['category', '=', 'Furniture']],
      } as any);

      // Only "where" is applied — returns Electronics, not Furniture
      expect(results.every((r: any) => r.category === 'Electronics')).toBe(true);
      expect(results.length).toBe(3);
    });

    it('should ignore legacy "sort" key — only "orderBy" is recognized', async () => {
      const results = await driver.find('products', {
        fields: ['name'],
        limit: 5,
        orderBy: [{ field: 'price', order: 'desc' as const }],
        sort: [{ field: 'price', order: 'asc' as const }],
      } as any);

      // "sort" is ignored; "orderBy" (desc) is applied — most expensive first
      expect(results.length).toBe(5);
      expect(results[0].name).toBe('Laptop');
      expect(results[4].name).toBe('Mouse');
    });

    it('should ignore legacy "skip" key — only "offset" is recognized', async () => {
      const results = await driver.find('products', {
        skip: 3,
        orderBy: [{ field: 'name', order: 'asc' as const }],
      } as any);

      // "skip" is not recognized — no offset applied, returns all 5 rows
      expect(results.length).toBe(5);
    });

    it('should ignore legacy "top" key — only "limit" is recognized', async () => {
      const results = await driver.find('products', {
        top: 2,
        orderBy: [{ field: 'name', order: 'asc' as const }],
      } as any);

      // "top" is not recognized — no limit applied, returns all 5 rows
      expect(results.length).toBe(5);
    });

    it('should ignore legacy "filters" in count — only "where" is recognized', async () => {
      const count = await driver.count('products', {
        filters: [['price', '>', 300]],
      } as any);

      // "filters" is not recognized — counts all rows
      expect(count).toBe(5);
    });
  });
});
