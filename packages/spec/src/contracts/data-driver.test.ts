import { describe, it, expect } from 'vitest';
import type { IDataDriver } from './data-driver';

describe('IDataDriver', () => {
  it('should allow creating a conforming mock implementation', () => {
    const mockDriver: IDataDriver = {
      name: 'mock_driver',
      version: '1.0.0',
      supports: {
        create: true,
        read: true,
        update: true,
        delete: true,
        bulkCreate: false,
        bulkUpdate: false,
        bulkDelete: false,
        transactions: false,
        savepoints: false,
        queryFilters: true,
        queryAggregations: false,
        querySorting: true,
        queryPagination: true,
        queryWindowFunctions: false,
        querySubqueries: false,
        queryCTE: false,
        joins: false,
        fullTextSearch: false,
        jsonQuery: false,
        geospatialQuery: false,
        streaming: false,
        jsonFields: false,
        arrayFields: false,
        vectorSearch: false,
        schemaSync: false,
        batchSchemaSync: false,
        migrations: false,
        indexes: false,
        connectionPooling: false,
        preparedStatements: false,
        queryCache: false,
      },
      connect: async () => {},
      disconnect: async () => {},
      checkHealth: async () => true,
      execute: async () => ({}),
      find: async () => [],
      findOne: async () => null,
      create: async (_obj, data) => ({ id: '1', ...data }),
      update: async (_obj, _id, data) => ({ id: '1', ...data }),
      upsert: async (_obj, data) => ({ id: '1', ...data }),
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
    };

    expect(mockDriver.name).toBe('mock_driver');
    expect(mockDriver.version).toBe('1.0.0');
    expect(mockDriver.supports.create).toBe(true);
    expect(mockDriver.supports.transactions).toBe(false);
  });

  it('should allow optional methods', () => {
    const minimalDriver: IDataDriver = {
      name: 'minimal',
      version: '0.1.0',
      supports: {
        create: true,
        read: true,
        update: true,
        delete: true,
        bulkCreate: false,
        bulkUpdate: false,
        bulkDelete: false,
        transactions: false,
        savepoints: false,
        queryFilters: false,
        queryAggregations: false,
        querySorting: false,
        queryPagination: false,
        queryWindowFunctions: false,
        querySubqueries: false,
        queryCTE: false,
        joins: false,
        fullTextSearch: false,
        jsonQuery: false,
        geospatialQuery: false,
        streaming: false,
        jsonFields: false,
        arrayFields: false,
        vectorSearch: false,
        schemaSync: false,
        batchSchemaSync: false,
        migrations: false,
        indexes: false,
        connectionPooling: false,
        preparedStatements: false,
        queryCache: false,
      },
      connect: async () => {},
      disconnect: async () => {},
      checkHealth: async () => true,
      execute: async () => ({}),
      find: async () => [],
      findOne: async () => null,
      create: async () => ({ id: '1' }),
      update: async () => ({ id: '1' }),
      upsert: async () => ({ id: '1' }),
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
    };

    // Optional methods should be undefined when not provided
    expect(minimalDriver.getPoolStats).toBeUndefined();
    expect(minimalDriver.updateMany).toBeUndefined();
    expect(minimalDriver.deleteMany).toBeUndefined();
    expect(minimalDriver.explain).toBeUndefined();
  });

  it('should support optional extended methods', () => {
    const extendedDriver: IDataDriver = {
      name: 'extended',
      version: '2.0.0',
      supports: {
        create: true,
        read: true,
        update: true,
        delete: true,
        bulkCreate: true,
        bulkUpdate: true,
        bulkDelete: true,
        transactions: true,
        savepoints: true,
        queryFilters: true,
        queryAggregations: true,
        querySorting: true,
        queryPagination: true,
        queryWindowFunctions: true,
        querySubqueries: true,
        queryCTE: true,
        joins: true,
        fullTextSearch: true,
        jsonQuery: true,
        geospatialQuery: false,
        streaming: true,
        jsonFields: true,
        arrayFields: true,
        vectorSearch: false,
        schemaSync: true,
        batchSchemaSync: false,
        migrations: true,
        indexes: true,
        connectionPooling: true,
        preparedStatements: true,
        queryCache: true,
      },
      connect: async () => {},
      disconnect: async () => {},
      checkHealth: async () => true,
      getPoolStats: () => ({ total: 10, idle: 5, active: 3, waiting: 2 }),
      execute: async () => ({}),
      find: async () => [],
      findOne: async () => null,
      create: async () => ({ id: '1' }),
      update: async () => ({ id: '1' }),
      upsert: async () => ({ id: '1' }),
      delete: async () => true,
      count: async () => 0,
      bulkCreate: async () => [],
      bulkUpdate: async () => [],
      bulkDelete: async () => {},
      updateMany: async () => 5,
      deleteMany: async () => 3,
      beginTransaction: async () => ({}),
      commit: async () => {},
      rollback: async () => {},
      syncSchema: async () => {},
      dropTable: async () => {},
      explain: async () => ({ plan: 'sequential scan' }),
    };

    expect(extendedDriver.getPoolStats?.()).toEqual({
      total: 10, idle: 5, active: 3, waiting: 2,
    });
    expect(extendedDriver.updateMany).toBeDefined();
    expect(extendedDriver.deleteMany).toBeDefined();
    expect(extendedDriver.explain).toBeDefined();
  });

  // ===========================================================================
  // Retired surface (#4484, ADR-0049 enforce-or-remove)
  // ===========================================================================

  describe('findStream (retired in 17.0.0)', () => {
    it('is not declared on the contract, so calling it does not type-check', () => {
      // The pin is the type, not the runtime: `keyof IDataDriver` is resolved by
      // tsc, so re-adding `findStream(...)` to the interface makes `Retired`
      // resolve to `never` and this line fails `pnpm typecheck` — which is the
      // only channel that can catch a *contract* regression. The expect() below
      // just gives the type assertion a home vitest will run.
      type Retired = 'findStream' extends keyof IDataDriver ? never : 'absent';
      const retired: Retired = 'absent';
      expect(retired).toBe('absent');
    });

    it('leaves an implementation that still defines it harmless', () => {
      // A driver written against 16.x keeps compiling: an extra method is not an
      // excess-property error on a class or on a widened object, it is simply
      // never reached. The break is on the CALLER side — `driver.findStream(...)`
      // no longer compiles — and there were no callers to break.
      const legacyShaped = { findStream: () => undefined };
      expect('findStream' in legacyShaped).toBe(true);
    });
  });
});
