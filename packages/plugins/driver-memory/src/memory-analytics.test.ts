// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { AnalyticsQuerySchema, defineCube } from '@objectstack/spec/data';
import type { AnalyticsQuery, AnalyticsQueryInput, Cube } from '@objectstack/spec/data';

/**
 * Author-tier literal → the parsed `AnalyticsQuery` the service contract takes.
 *
 * `timezone` is `.default('UTC')` on the schema, so it is optional to write and
 * required on the parsed type — the two tiers are genuinely different types. A
 * real query reaches `query()` through the schema (the REST layer parses the
 * request body), so these tests take the same route rather than hand-writing
 * the filled-in default: the parse IS the proof that the default lands. Until
 * #4311 no tsc read this file, so 19 author-tier literals sat unnoticed in a
 * parameter that had required `timezone` all along.
 */
const asQuery = (input: AnalyticsQueryInput): AnalyticsQuery => AnalyticsQuerySchema.parse(input);

describe('MemoryAnalyticsService', () => {
  let driver: InMemoryDriver;
  let service: MemoryAnalyticsService;

  beforeEach(async () => {
    // Initialize driver with sample data
    driver = new InMemoryDriver({
      initialData: {
        orders: [
          { id: 1, customer: 'Alice', status: 'completed', amount: 100, created_at: new Date('2024-01-15') },
          { id: 2, customer: 'Bob', status: 'completed', amount: 200, created_at: new Date('2024-01-16') },
          { id: 3, customer: 'Alice', status: 'pending', amount: 150, created_at: new Date('2024-01-17') },
          { id: 4, customer: 'Charlie', status: 'completed', amount: 300, created_at: new Date('2024-01-18') },
          { id: 5, customer: 'Bob', status: 'cancelled', amount: 50, created_at: new Date('2024-01-19') },
        ],
        products: [
          { id: 1, name: 'Laptop', category: 'electronics', price: 999, stock: 10 },
          { id: 2, name: 'Mouse', category: 'electronics', price: 25, stock: 100 },
          { id: 3, name: 'Desk', category: 'furniture', price: 299, stock: 5 },
          { id: 4, name: 'Chair', category: 'furniture', price: 199, stock: 8 },
        ]
      }
    });

    // Connect the driver to load initial data
    await driver.connect();

    // Define cubes
    const cubes: Cube[] = [
      {
        name: 'orders',
        title: 'Orders',
        sql: 'orders',
        measures: {
          count: {
            name: 'count',
            label: 'Order Count',
            type: 'count',
            sql: 'id'
          },
          totalAmount: {
            name: 'total_amount',
            label: 'Total Amount',
            type: 'sum',
            sql: 'amount'
          },
          avgAmount: {
            name: 'avg_amount',
            label: 'Average Amount',
            type: 'avg',
            sql: 'amount'
          }
        },
        dimensions: {
          customer: {
            name: 'customer',
            label: 'Customer',
            type: 'string',
            sql: 'customer'
          },
          status: {
            name: 'status',
            label: 'Status',
            type: 'string',
            sql: 'status'
          },
          createdAt: {
            name: 'created_at',
            label: 'Created At',
            type: 'time',
            sql: 'created_at',
            granularities: ['day', 'week', 'month']
          }
        },
        public: true
      },
      {
        name: 'products',
        title: 'Products',
        sql: 'products',
        measures: {
          count: {
            name: 'count',
            label: 'Product Count',
            type: 'count',
            sql: 'id'
          },
          avgPrice: {
            name: 'avg_price',
            label: 'Average Price',
            type: 'avg',
            sql: 'price'
          },
          totalStock: {
            name: 'total_stock',
            label: 'Total Stock',
            type: 'sum',
            sql: 'stock'
          }
        },
        dimensions: {
          category: {
            name: 'category',
            label: 'Category',
            type: 'string',
            sql: 'category'
          },
          name: {
            name: 'name',
            label: 'Product Name',
            type: 'string',
            sql: 'name'
          }
        },
        public: true
      }
    ];

    service = new MemoryAnalyticsService({ driver, cubes });
  });

  describe('getMeta', () => {
    it('should return metadata for all cubes', async () => {
      const meta = await service.getMeta();
      
      expect(meta).toHaveLength(2);
      expect(meta[0].name).toBe('orders');
      expect(meta[1].name).toBe('products');
    });

    it('should return metadata for a specific cube', async () => {
      const meta = await service.getMeta('orders');
      
      expect(meta).toHaveLength(1);
      expect(meta[0].name).toBe('orders');
      expect(meta[0].measures).toHaveLength(3);
      expect(meta[0].dimensions).toHaveLength(3);
    });

    it('should include measure and dimension details', async () => {
      const meta = await service.getMeta('orders');
      const cube = meta[0];
      
      const countMeasure = cube.measures.find(m => m.name === 'orders.count');
      expect(countMeasure).toBeDefined();
      expect(countMeasure?.type).toBe('count');
      
      const statusDim = cube.dimensions.find(d => d.name === 'orders.status');
      expect(statusDim).toBeDefined();
      expect(statusDim?.type).toBe('string');
    });
  });

  describe('query', () => {
    it('should execute a simple count query', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count']
      }));

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]['orders.count']).toBe(5);
      expect(result.fields).toHaveLength(1);
      expect(result.fields[0].name).toBe('orders.count');
      expect(result.fields[0].type).toBe('number');
    });

    it('should group by a dimension', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        dimensions: ['orders.status']
      }));

      expect(result.rows).toHaveLength(3); // completed, pending, cancelled
      
      const completedRow = result.rows.find(r => r['orders.status'] === 'completed');
      expect(completedRow).toBeDefined();
      expect(completedRow!['orders.count']).toBe(3);
    });

    it('should calculate sum aggregation', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.totalAmount'],
        dimensions: ['orders.customer']
      }));

      const aliceRow = result.rows.find(r => r['orders.customer'] === 'Alice');
      expect(aliceRow).toBeDefined();
      expect(aliceRow!['orders.totalAmount']).toBe(250); // 100 + 150
    });

    it('should calculate average aggregation', async () => {
      const result = await service.query(asQuery({
        cube: 'products',
        measures: ['products.avgPrice'],
        dimensions: ['products.category']
      }));

      const electronicsRow = result.rows.find(r => r['products.category'] === 'electronics');
      expect(electronicsRow).toBeDefined();
      expect(electronicsRow!['products.avgPrice']).toBe(512); // (999 + 25) / 2
    });

    it('should support multiple measures', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count', 'orders.totalAmount', 'orders.avgAmount']
      }));

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]['orders.count']).toBe(5);
      expect(result.rows[0]['orders.totalAmount']).toBe(800); // 100+200+150+300+50
      expect(result.rows[0]['orders.avgAmount']).toBe(160); // 800/5
    });

    it('should apply filters via canonical `where`', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count', 'orders.totalAmount'],
        where: { 'orders.status': 'completed' },
      }));

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]['orders.count']).toBe(3);
      expect(result.rows[0]['orders.totalAmount']).toBe(600); // 100+200+300
    });

    it('should accept FilterCondition (short-form equality)', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count', 'orders.totalAmount'],
        where: { status: 'completed' },
      }));

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]['orders.count']).toBe(3);
      expect(result.rows[0]['orders.totalAmount']).toBe(600);
    });

    it('should accept FilterCondition with $in operator', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        where: { status: { $in: ['completed', 'pending'] } },
      }));

      expect(result.rows[0]['orders.count']).toBe(4); // 3 completed + 1 pending
    });

    it('should accept FilterCondition with $gte operator', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        where: { amount: { $gte: 200 } },
      }));

      expect(result.rows[0]['orders.count']).toBe(2); // 200, 300
    });

    it('should support sorting', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.totalAmount'],
        dimensions: ['orders.customer'],
        order: { 'orders.totalAmount': 'desc' }
      }));

      expect(result.rows[0]['orders.customer']).toBe('Charlie'); // 300
      expect(result.rows[1]['orders.customer']).toBe('Alice');   // 250
      expect(result.rows[2]['orders.customer']).toBe('Bob');     // 250
    });

    it('should support limit and offset', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        dimensions: ['orders.customer'],
        order: { 'orders.customer': 'asc' },
        limit: 2,
        offset: 1
      }));

      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]['orders.customer']).toBe('Bob');
      expect(result.rows[1]['orders.customer']).toBe('Charlie');
    });

    it('should resolve `${field}_${type}` aliases to canonical measures', async () => {
      // Cubes commonly define measures keyed by field name (e.g. measure
      // 'amount' of type 'sum'). Clients that build measure names from
      // (field, function) pairs send 'amount_sum' — the resolver should
      // accept that alias and produce the same aggregate value.
      // `defineCube` rather than a bare `: Cube` literal: `public` is
      // `.default(false)`, so it is required on the parsed `Cube` type and
      // absent here — the factory is the spec's own answer to that split.
      const aliasCube = defineCube({
        name: 'opps',
        title: 'Opps',
        sql: 'orders',
        measures: {
          amount: { name: 'amount', label: 'Amount', type: 'sum', sql: 'amount' },
        },
        dimensions: {
          status: { name: 'status', label: 'Status', type: 'string', sql: 'status' },
        },
      });
      const aliasService = new MemoryAnalyticsService({ driver, cubes: [aliasCube] });

      const aliased = await aliasService.query(asQuery({
        cube: 'opps',
        measures: ['amount_sum'],
        dimensions: ['status'],
      }));

      const completed = aliased.rows.find(r => r.status === 'completed');
      expect(completed).toBeDefined();
      expect(completed!['amount_sum']).toBe(600); // 100 + 200 + 300
    });

    it('should throw error for unknown cube', async () => {
      await expect(async () => {
        await service.query(asQuery({
          cube: 'unknown',
          measures: ['unknown.count']
        }));
      }).rejects.toThrow('Cube not found: unknown');
    });

    it('should include SQL in result for debugging', async () => {
      const result = await service.query(asQuery({
        cube: 'orders',
        measures: ['orders.count']
      }));

      expect(result.sql).toBeDefined();
      expect(result.sql).toContain('orders');
    });
  });

  describe('generateSql', () => {
    it('should generate SQL for a simple query', async () => {
      const result = await service.generateSql(asQuery({
        cube: 'orders',
        measures: ['orders.count']
      }));

      expect(result.sql).toContain('SELECT');
      expect(result.sql).toContain('COUNT(*)');
      expect(result.sql).toContain('FROM orders');
    });

    it('should generate SQL with GROUP BY', async () => {
      const result = await service.generateSql(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        dimensions: ['orders.status']
      }));

      expect(result.sql).toContain('GROUP BY status');
    });

    it('should generate SQL with WHERE clause', async () => {
      const result = await service.generateSql(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        where: { 'orders.status': 'completed' },
      }));

      expect(result.sql).toContain('WHERE');
      expect(result.sql).toContain('status');
    });

    it('should generate SQL with ORDER BY', async () => {
      const result = await service.generateSql(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        dimensions: ['orders.status'],
        order: { 'orders.status': 'asc' }
      }));

      expect(result.sql).toContain('ORDER BY');
      expect(result.sql).toContain('ASC');
    });

    it('should generate SQL with LIMIT and OFFSET', async () => {
      const result = await service.generateSql(asQuery({
        cube: 'orders',
        measures: ['orders.count'],
        limit: 10,
        offset: 5
      }));

      expect(result.sql).toContain('LIMIT 10');
      expect(result.sql).toContain('OFFSET 5');
    });
  });
});
