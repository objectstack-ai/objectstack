import { describe, it, expect } from 'vitest';
import type { IDataDriver } from './data-driver';

describe('IDataDriver', () => {
  it('should allow creating a conforming mock implementation', () => {
    const mockDriver: IDataDriver = {
      name: 'mock_driver',
      version: '1.0.0',
      // #4634: capability bits are opt-in advertisements read by the engine;
      // the 31 inert bits the old mock spelled out are tombstoned (`never`),
      // so a conforming driver declares only what has a reader.
      supports: {
        autonumber: true,
        batchSchemaSync: false,
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
    expect(mockDriver.supports.autonumber).toBe(true);
    expect(mockDriver.supports.batchSchemaSync).toBe(false);
  });

  it('should allow optional methods', () => {
    const minimalDriver: IDataDriver = {
      name: 'minimal',
      version: '0.1.0',
      // #4634: an empty advertisement is a valid one — every live bit is opt-in.
      supports: {},
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
      // #4634: the full live surface — native date buckets, driver-owned
      // autonumber, batched DDL. Everything else is expressed by the methods.
      supports: {
        queryDateGranularity: { day: true, week: true, month: true, quarter: true, year: true },
        autonumber: true,
        batchSchemaSync: true,
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
