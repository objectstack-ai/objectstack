import { describe, it, expect } from 'vitest';
import {
  DriverCapabilitiesSchema,
  DriverInterfaceSchema,
  type DriverCapabilities,
  type DriverInterface,
} from './driver.zod';

describe('DriverCapabilitiesSchema', () => {
  it('should accept valid capabilities', () => {
    const capabilities: DriverCapabilities = {
      transactions: true,
      queryFilters: true,
      queryAggregations: true,
      querySorting: true,
      queryPagination: true,
      queryWindowFunctions: true,
      querySubqueries: true,
      joins: true,
      fullTextSearch: true,
      jsonFields: true,
      arrayFields: true,
    };

    expect(() => DriverCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should accept minimal capabilities', () => {
    const capabilities: DriverCapabilities = {
      transactions: false,
      queryFilters: false,
      queryAggregations: false,
      querySorting: false,
      queryPagination: false,
      queryWindowFunctions: false,
      querySubqueries: false,
      joins: false,
      fullTextSearch: false,
      jsonFields: false,
      arrayFields: false,
    };

    expect(() => DriverCapabilitiesSchema.parse(capabilities)).not.toThrow();
  });

  it('should accept capabilities with defaults', () => {
    const incomplete = {
      transactions: true,
      joins: true,
      queryFilters: true,
      // missing other fields - they should use defaults
    };

    const result = DriverCapabilitiesSchema.safeParse(incomplete);
    expect(result.success).toBe(true);
    if (result.success) {
      // Check that defaults are applied
      expect(result.data.create).toBe(true); // default
      expect(result.data.bulkCreate).toBe(false); // default
      expect(result.data.queryAggregations).toBe(false); // default
    }
  });
});

describe('DriverInterfaceSchema', () => {
  describe('Basic Properties', () => {
    it('should require name and version', () => {
      const incomplete = {
        name: 'postgresql',
        // missing version and other required fields
      };

      const result = DriverInterfaceSchema.safeParse(incomplete);
      expect(result.success).toBe(false);
    });

    it('should accept name and version', () => {
      const driver = {
        name: 'postgresql',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => [],
        findOne: async () => null,
        create: async () => ({}),
        update: async () => ({}),
        upsert: async () => ({}),
        delete: async () => true,
        count: async () => 0,
        bulkCreate: async () => [],
        bulkUpdate: async () => [],
        bulkDelete: async () => {},
        beginTransaction: async () => ({}),
        commit: async () => {},
        rollback: async () => {},
        syncSchema: async () => {},
        dropTable: async () => {},
        supports: {
          transactions: true,
          queryFilters: true,
          queryAggregations: true,
          querySorting: true,
          queryPagination: true,
          queryWindowFunctions: true,
          querySubqueries: true,
          joins: true,
          fullTextSearch: true,
          jsonFields: true,
          arrayFields: true,
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('CRUD Operations', () => {
    const baseDriver = {
      name: 'test-driver',
      version: '1.0.0',
      connect: async () => {},
      disconnect: async () => {},
      checkHealth: async () => true,
      execute: async () => ({}),
      find: async (object: string, query: any) => [],
      findOne: async (object: string, query: any) => null,
      create: async (object: string, data: any) => data,
      update: async (object: string, id: any, data: any) => data,
      upsert: async (object: string, data: any) => data,
      delete: async (object: string, id: any) => true,
      count: async () => 0,
      bulkCreate: async (object: string, data: any[]) => data,
      bulkUpdate: async (object: string, updates: any[]) => updates,
      bulkDelete: async (object: string, ids: any[]) => {},
      beginTransaction: async () => ({}),
      commit: async () => {},
      rollback: async () => {},
      syncSchema: async (object: string, schema: any) => {},
      dropTable: async (object: string) => {},
      supports: {
        transactions: false,
        queryFilters: false,
        queryAggregations: false,
        querySorting: false,
        queryPagination: false,
        queryWindowFunctions: false,
        querySubqueries: false,
        joins: false,
        fullTextSearch: false,
        jsonFields: false,
        arrayFields: false,
      },
    };

    it('should accept driver with CRUD operations', () => {
      expect(() => DriverInterfaceSchema.parse(baseDriver)).not.toThrow();
    });

    it('should validate find method signature', () => {
      const driver = {
        ...baseDriver,
        find: async (object: string, query: any) => [
          { id: '1', name: 'Record 1' },
          { id: '2', name: 'Record 2' },
        ],
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate findOne method signature', () => {
      const driver = {
        ...baseDriver,
        findOne: async (object: string, id: any) => ({
          id: '1',
          name: 'Record 1',
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate create method signature', () => {
      const driver = {
        ...baseDriver,
        create: async (object: string, data: any) => ({
          ...data,
          id: 'generated-id',
          created_at: new Date(),
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate update method signature', () => {
      const driver = {
        ...baseDriver,
        update: async (object: string, id: any, data: any) => ({
          id,
          ...data,
          updated_at: new Date(),
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate delete method signature', () => {
      const driver = {
        ...baseDriver,
        delete: async (object: string, id: any) => ({
          id,
          deleted: true,
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('Bulk Operations', () => {
    const baseDriver = {
      name: 'test-driver',
      version: '1.0.0',
      connect: async () => {},
      disconnect: async () => {},
      checkHealth: async () => true,
      execute: async () => ({}),
      find: async () => [],
      findOne: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      upsert: async () => ({}),
      delete: async () => true,
      count: async () => 0,
      bulkCreate: async () => [],
      bulkUpdate: async () => [],
      bulkDelete: async () => {},
      beginTransaction: async () => ({}),
      commit: async () => {},
      rollback: async () => {},
      syncSchema: async () => {},
      dropTable: async () => {},
      supports: {
        transactions: false,
        queryFilters: false,
        queryAggregations: false,
        querySorting: false,
        queryPagination: false,
        queryWindowFunctions: false,
        querySubqueries: false,
        joins: false,
        fullTextSearch: false,
        jsonFields: false,
        arrayFields: false,
      },
    };

    it('should validate bulkCreate method', () => {
      const driver = {
        ...baseDriver,
        bulkCreate: async (object: string, data: any[]) => {
          return data.map((item, i) => ({
            ...item,
            id: `generated-${i}`,
          }));
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate bulkUpdate method', () => {
      const driver = {
        ...baseDriver,
        bulkUpdate: async (object: string, updates: any[]) => {
          return updates.map(u => ({
            ...u.data,
            id: u.id,
            updated_at: new Date(),
          }));
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate bulkDelete method', () => {
      const driver = {
        ...baseDriver,
        bulkDelete: async (object: string, ids: any[]) => ({
          deleted: ids.length,
          ids,
        }),
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('DDL Operations', () => {
    const baseDriver = {
      name: 'test-driver',
      version: '1.0.0',
      connect: async () => {},
      disconnect: async () => {},
      checkHealth: async () => true,
      execute: async () => ({}),
      find: async () => [],
      findOne: async () => null,
      create: async () => ({}),
      update: async () => ({}),
      upsert: async () => ({}),
      delete: async () => true,
      count: async () => 0,
      bulkCreate: async () => [],
      bulkUpdate: async () => [],
      bulkDelete: async () => {},
      beginTransaction: async () => ({}),
      commit: async () => {},
      rollback: async () => {},
      syncSchema: async () => {},
      dropTable: async () => {},
      supports: {
        transactions: false,
        queryFilters: false,
        queryAggregations: false,
        querySorting: false,
        queryPagination: false,
        queryWindowFunctions: false,
        querySubqueries: false,
        joins: false,
        fullTextSearch: false,
        jsonFields: false,
        arrayFields: false,
      },
    };

    it('should validate syncSchema method', () => {
      const driver = {
        ...baseDriver,
        syncSchema: async (object: string, schema: any) => {
          // Create table if not exists
          // Alter table to match schema
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should validate dropTable method', () => {
      const driver = {
        ...baseDriver,
        dropTable: async (object: string) => {
          // DROP TABLE IF EXISTS
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('Transaction Support', () => {
    it('should accept driver without transaction support', () => {
      const driver = {
        name: 'simple-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => [],
        findOne: async () => null,
        create: async () => ({}),
        update: async () => ({}),
        upsert: async () => ({}),
        delete: async () => true,
        count: async () => 0,
        bulkCreate: async () => [],
        bulkUpdate: async () => [],
        bulkDelete: async () => {},
        beginTransaction: async () => ({}),
        commit: async () => {},
        rollback: async () => {},
        syncSchema: async () => {},
        dropTable: async () => {},
        supports: {
          transactions: false,
          queryFilters: false,
          queryAggregations: false,
          querySorting: false,
          queryPagination: false,
          queryWindowFunctions: false,
          querySubqueries: false,
          joins: false,
          fullTextSearch: false,
          jsonFields: false,
          arrayFields: false,
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });

    it('should accept driver with transaction support', () => {
      const driver = {
        name: 'transactional-driver',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => [],
        findOne: async () => null,
        create: async () => ({}),
        update: async () => ({}),
        upsert: async () => ({}),
        delete: async () => true,
        count: async () => 0,
        bulkCreate: async () => [],
        bulkUpdate: async () => [],
        bulkDelete: async () => {},
        beginTransaction: async () => ({ id: 'tx-123' }),
        commit: async (tx: any) => {},
        rollback: async (tx: any) => {},
        syncSchema: async () => {},
        dropTable: async () => {},
        supports: {
          transactions: true,
          queryFilters: true,
          queryAggregations: true,
          querySorting: true,
          queryPagination: true,
          queryWindowFunctions: false,
          querySubqueries: true,
          joins: true,
          fullTextSearch: false,
          jsonFields: true,
          arrayFields: false,
        },
      };

      expect(() => DriverInterfaceSchema.parse(driver)).not.toThrow();
    });
  });

  describe('Real-World Driver Examples', () => {
    it('should accept PostgreSQL-like driver', () => {
      const postgresDriver: DriverInterface = {
        name: 'postgresql',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async (object, query) => [],
        findOne: async (object, query) => null,
        create: async (object, data) => data,
        update: async (object, id, data) => data,
        upsert: async (object, data) => data,
        delete: async (object, id) => true,
        count: async () => 0,
        bulkCreate: async (object, data) => data,
        bulkUpdate: async (object, updates) => updates,
        bulkDelete: async (object, ids) => {},
        beginTransaction: async () => ({}),
        commit: async (tx) => {},
        rollback: async (tx) => {},
        syncSchema: async (object, schema) => {},
        dropTable: async (object) => {},
        supports: {
          transactions: true,
          queryFilters: true,
          queryAggregations: true,
          querySorting: true,
          queryPagination: true,
          queryWindowFunctions: true,
          querySubqueries: true,
          joins: true,
          fullTextSearch: true,
          jsonFields: true,
          arrayFields: true,
        },
      };

      expect(() => DriverInterfaceSchema.parse(postgresDriver)).not.toThrow();
    });

    it('should accept MongoDB-like driver', () => {
      const mongoDriver: DriverInterface = {
        name: 'mongodb',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async (object, query) => [],
        findOne: async (object, query) => null,
        create: async (object, data) => data,
        update: async (object, id, data) => data,
        upsert: async (object, data) => data,
        delete: async (object, id) => true,
        count: async () => 0,
        bulkCreate: async (object, data) => data,
        bulkUpdate: async (object, updates) => updates,
        bulkDelete: async (object, ids) => {},
        beginTransaction: async () => ({}),
        commit: async (tx) => {},
        rollback: async (tx) => {},
        syncSchema: async (object, schema) => {},
        dropTable: async (object) => {},
        supports: {
          transactions: true,
          queryFilters: true,
          queryAggregations: true,
          querySorting: true,
          queryPagination: true,
          queryWindowFunctions: false, // MongoDB has limited window function support
          querySubqueries: true,
          joins: false, // MongoDB has limited join support
          fullTextSearch: true,
          jsonFields: true, // Native JSON support
          arrayFields: true, // Native array support
        },
      };

      expect(() => DriverInterfaceSchema.parse(mongoDriver)).not.toThrow();
    });

    it('should accept Salesforce-like driver', () => {
      const salesforceDriver: DriverInterface = {
        name: 'salesforce',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async (object, query) => [],
        findOne: async (object, query) => null,
        create: async (object, data) => data,
        update: async (object, id, data) => data,
        upsert: async (object, data) => data,
        delete: async (object, id) => true,
        count: async () => 0,
        bulkCreate: async (object, data) => data,
        bulkUpdate: async (object, updates) => updates,
        bulkDelete: async (object, ids) => {},
        beginTransaction: async () => ({}),
        commit: async (tx) => {},
        rollback: async (tx) => {},
        syncSchema: async (object, schema) => {},
        dropTable: async (object) => {},
        supports: {
          transactions: false, // Salesforce doesn't support transactions
          queryFilters: true, // SOQL WHERE clause
          queryAggregations: true, // SOQL GROUP BY
          querySorting: true, // SOQL ORDER BY
          queryPagination: true, // SOQL LIMIT/OFFSET
          queryWindowFunctions: false, // No window functions
          querySubqueries: true, // SOQL supports subqueries
          joins: true, // SOQL supports relationships
          fullTextSearch: true, // SOSL
          jsonFields: false, // No native JSON type
          arrayFields: false, // No native array type
        },
      };

      expect(() => DriverInterfaceSchema.parse(salesforceDriver)).not.toThrow();
    });

    it('should accept Redis-like driver', () => {
      const redisDriver: DriverInterface = {
        name: 'redis',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async (object, query) => [],
        findOne: async (object, query) => null,
        create: async (object, data) => data,
        update: async (object, id, data) => data,
        upsert: async (object, data) => data,
        delete: async (object, id) => true,
        count: async () => 0,
        bulkCreate: async (object, data) => data,
        bulkUpdate: async (object, updates) => updates,
        bulkDelete: async (object, ids) => {},
        beginTransaction: async () => ({}),
        commit: async (tx) => {},
        rollback: async (tx) => {},
        syncSchema: async (object, schema) => {},
        dropTable: async (object) => {},
        supports: {
          transactions: true, // Redis supports transactions
          queryFilters: false, // Limited query support - key-based lookup
          queryAggregations: false, // No aggregation support
          querySorting: false, // No native sorting
          queryPagination: false, // No pagination support
          queryWindowFunctions: false, // No window functions
          querySubqueries: false, // No subqueries
          joins: false, // No join support
          fullTextSearch: false, // No native full-text search
          jsonFields: true, // RedisJSON module
          arrayFields: true, // Redis lists
        },
      };

      expect(() => DriverInterfaceSchema.parse(redisDriver)).not.toThrow();
    });

    it('should accept memory-like driver with limited query support', () => {
      const memoryDriver: DriverInterface = {
        name: 'memory',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async (object, query) => [],
        findOne: async (object, query) => null,
        create: async (object, data) => data,
        update: async (object, id, data) => data,
        upsert: async (object, data) => data,
        delete: async (object, id) => true,
        count: async () => 0,
        bulkCreate: async (object, data) => data,
        bulkUpdate: async (object, updates) => updates,
        bulkDelete: async (object, ids) => {},
        beginTransaction: async () => ({}),
        commit: async (tx) => {},
        rollback: async (tx) => {},
        syncSchema: async (object, schema) => {},
        dropTable: async (object) => {},
        supports: {
          transactions: false, // No transactions in memory
          queryFilters: false, // Memory driver doesn't support query conditions - all filtering done in memory
          queryAggregations: false, // No aggregation support
          querySorting: false, // No native sorting
          queryPagination: false, // No pagination support
          queryWindowFunctions: false, // No window functions
          querySubqueries: false, // No subqueries
          joins: false, // No join support - joins done in memory
          fullTextSearch: false, // No full-text search
          jsonFields: true, // Memory can store any type
          arrayFields: true, // Memory can store any type
        },
      };

      expect(() => DriverInterfaceSchema.parse(memoryDriver)).not.toThrow();
    });
  });

  // ===========================================================================
  // Retired surface (#4484, ADR-0049 enforce-or-remove)
  // ===========================================================================

  describe('findStream (retired in 17.0.0)', () => {
    it('is no longer part of the declared driver shape', () => {
      expect(DriverInterfaceSchema.shape).not.toHaveProperty('findStream');
    });

    it('deliberately carries no tombstone — nothing ever parsed a driver with it', () => {
      // The other retirements in this major tombstone their key so authoring it
      // fails loudly. That would be noise here: `DriverInterfaceSchema` describes
      // a TypeScript contract that drivers IMPLEMENT, and nothing in either
      // repository ever ran a driver object through `.parse()` — the prescription
      // would have no one to reach. The enforced channel is tsc on `IDataDriver`
      // (see contracts/data-driver.test.ts), which breaks callers, and there were
      // none. A stray `findStream` on a driver object therefore just parses and
      // is dropped, exactly as any other non-contract method on it always has.
      const withLegacyMethod = {
        name: 'legacy',
        version: '1.0.0',
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => [],
        findStream: async function* () {},
        findOne: async () => null,
        create: async () => ({}),
        update: async () => ({}),
        upsert: async () => ({}),
        delete: async () => true,
        count: async () => 0,
        bulkCreate: async () => [],
        bulkUpdate: async () => [],
        bulkDelete: async () => {},
        beginTransaction: async () => ({}),
        commit: async () => {},
        rollback: async () => {},
        syncSchema: async () => {},
        dropTable: async () => {},
        supports: {
          transactions: true,
          queryFilters: true,
          queryAggregations: true,
          querySorting: true,
          queryPagination: true,
          queryWindowFunctions: false,
          querySubqueries: false,
          joins: false,
          fullTextSearch: false,
          jsonFields: true,
          arrayFields: true,
        },
      };

      const parsed = DriverInterfaceSchema.parse(withLegacyMethod);
      expect(parsed).not.toHaveProperty('findStream');
    });
  });
});
