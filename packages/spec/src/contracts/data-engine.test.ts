import { describe, it, expect } from 'vitest';
import type { IDataEngine } from './data-engine';
import type { IDataDriver } from './data-driver';

/**
 * Minimal DriverCapabilities object for tests.
 */
const minimalCapabilities = {
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
};

describe('Data Engine Contract', () => {
  describe('IDataEngine interface', () => {
    it('should allow a minimal implementation with required methods', () => {
      const engine: IDataEngine = {
        find: async (_objectName, _query?) => [],
        findOne: async (_objectName, _query?) => null,
        insert: async (_objectName, data, _options?) => data,
        update: async (_objectName, data, _options?) => data,
        delete: async (_objectName, _options?) => { return { deleted: 1 }; },
        count: async (_objectName, _query?) => 0,
        aggregate: async (_objectName, _query) => [],
      };

      expect(typeof engine.find).toBe('function');
      expect(typeof engine.findOne).toBe('function');
      expect(typeof engine.insert).toBe('function');
      expect(typeof engine.update).toBe('function');
      expect(typeof engine.delete).toBe('function');
      expect(typeof engine.count).toBe('function');
      expect(typeof engine.aggregate).toBe('function');
    });

    it('should perform CRUD operations', async () => {
      const store: any[] = [];

      const engine: IDataEngine = {
        find: async () => [...store],
        findOne: async () => store[0] || null,
        insert: async (_obj, data) => {
          store.push(data);
          return data;
        },
        update: async (_obj, data) => data,
        delete: async () => ({ deleted: 1 }),
        count: async () => store.length,
        aggregate: async () => [],
      };

      await engine.insert('users', { id: 1, name: 'Alice' });
      await engine.insert('users', { id: 2, name: 'Bob' });

      const all = await engine.find('users');
      expect(all).toHaveLength(2);

      const first = await engine.findOne('users');
      expect(first).toEqual({ id: 1, name: 'Alice' });

      const count = await engine.count('users');
      expect(count).toBe(2);
    });

    it('should support optional vectorFind', async () => {
      const engine: IDataEngine = {
        find: async () => [],
        findOne: async () => null,
        insert: async (_obj, data) => data,
        update: async (_obj, data) => data,
        delete: async () => ({}),
        count: async () => 0,
        aggregate: async () => [],
        vectorFind: async (_objectName, _vector, options?) => {
          return [{ id: 1, score: 0.95 }].slice(0, options?.limit ?? 10);
        },
      };

      expect(engine.vectorFind).toBeDefined();
      const results = await engine.vectorFind!('documents', [0.1, 0.2, 0.3], {
        limit: 5,
        threshold: 0.8,
      });
      expect(results).toHaveLength(1);
      expect(results[0].score).toBe(0.95);
    });

    it('should support optional batch operations', async () => {
      const engine: IDataEngine = {
        find: async () => [],
        findOne: async () => null,
        insert: async (_obj, data) => data,
        update: async (_obj, data) => data,
        delete: async () => ({}),
        count: async () => 0,
        aggregate: async () => [],
        batch: async (requests, options?) => {
          return requests.map(() => ({ success: true }));
        },
      };

      expect(engine.batch).toBeDefined();
      const results = await engine.batch!(
        [
          { object: 'users', operation: 'insert', data: { name: 'Alice' } } as any,
          { object: 'users', operation: 'insert', data: { name: 'Bob' } } as any,
        ],
        { transaction: true }
      );
      expect(results).toHaveLength(2);
    });

    it('should support optional execute (escape hatch)', async () => {
      const engine: IDataEngine = {
        find: async () => [],
        findOne: async () => null,
        insert: async (_obj, data) => data,
        update: async (_obj, data) => data,
        delete: async () => ({}),
        count: async () => 0,
        aggregate: async () => [],
        execute: async (command, options?) => {
          return { raw: true, command };
        },
      };

      expect(engine.execute).toBeDefined();
      const result = await engine.execute!('SELECT * FROM users', { timeout: 5000 });
      expect(result.raw).toBe(true);
    });
  });

  describe('IDataDriver (driver contract)', () => {
    it('should be assignable from IDataDriver (type alias check)', () => {
      const driver: IDataDriver = {
        name: 'postgres',
        version: '1.0.0',
        supports: minimalCapabilities,
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => [],
        findStream: () => (async function* () {})(),
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

      const driverAsInterface: IDataDriver = driver;

      expect(driverAsInterface.name).toBe('postgres');
      expect(driverAsInterface.version).toBe('1.0.0');
      expect(typeof driverAsInterface.connect).toBe('function');
      expect(typeof driverAsInterface.disconnect).toBe('function');
      expect(typeof driverAsInterface.checkHealth).toBe('function');
      expect(driverAsInterface.supports.queryFilters).toBe(true);
    });

    it('should support full IDataDriver lifecycle and CRUD', async () => {
      let connected = false;

      const driver: IDataDriver = {
        name: 'mongo',
        version: '2.0.0',
        supports: minimalCapabilities,
        connect: async () => { connected = true; },
        disconnect: async () => { connected = false; },
        checkHealth: async () => connected,
        execute: async () => ({}),
        find: async () => [],
        findStream: () => (async function* () {})(),
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

      await driver.connect();
      expect(connected).toBe(true);

      await driver.disconnect();
      expect(connected).toBe(false);
    });

    it('should support bulk, transaction, and schema operations', async () => {
      const driver: IDataDriver = {
        name: 'postgres',
        version: '1.0.0',
        supports: { ...minimalCapabilities, transactions: true, bulkCreate: true },
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => [],
        findStream: () => (async function* () {})(),
        findOne: async () => null,
        create: async (_obj, data) => ({ id: '1', ...data }),
        update: async (_obj, _id, data) => ({ id: '1', ...data }),
        upsert: async (_obj, data) => ({ id: '1', ...data }),
        delete: async () => true,
        count: async () => 42,
        bulkCreate: async (_obj, data) => data.map((d, i) => ({ id: String(i + 1), ...d })),
        bulkUpdate: async () => [],
        bulkDelete: async () => {},
        updateMany: async () => 5,
        deleteMany: async () => 3,
        beginTransaction: async () => ({ txId: 'tx_1' }),
        commit: async () => {},
        rollback: async () => {},
        syncSchema: async () => {},
        dropTable: async () => {},
        explain: async () => ({ plan: 'sequential scan' }),
      };

      expect(driver.bulkCreate).toBeDefined();
      expect(driver.updateMany).toBeDefined();
      expect(driver.deleteMany).toBeDefined();

      const bulk = await driver.bulkCreate('users', [{ name: 'A' }, { name: 'B' }]);
      expect(bulk).toHaveLength(2);

      expect(await driver.count('users')).toBe(42);
      expect(driver.explain).toBeDefined();
    });

    it('should support findStream with yielded values', async () => {
      const records = [{ id: '1', name: 'Alice' }, { id: '2', name: 'Bob' }];
      const driver: IDataDriver = {
        name: 'streamer',
        version: '1.0.0',
        supports: { ...minimalCapabilities, streaming: true },
        connect: async () => {},
        disconnect: async () => {},
        checkHealth: async () => true,
        execute: async () => ({}),
        find: async () => records,
        findStream: () => (async function* () {
          for (const r of records) yield r;
        })(),
        findOne: async () => null,
        create: async (_obj, data) => ({ id: '1', ...data }),
        update: async (_obj, _id, data) => ({ id: '1', ...data }),
        upsert: async (_obj, data) => ({ id: '1', ...data }),
        delete: async () => true,
        count: async () => records.length,
        bulkCreate: async () => [],
        bulkUpdate: async () => [],
        bulkDelete: async () => {},
        beginTransaction: async () => ({}),
        commit: async () => {},
        rollback: async () => {},
        syncSchema: async () => {},
        dropTable: async () => {},
      };

      const stream = driver.findStream('users', {} as any);
      const collected: any[] = [];
      for await (const row of stream as AsyncIterable<any>) {
        collected.push(row);
      }

      expect(collected).toHaveLength(2);
      expect(collected[0].name).toBe('Alice');
      expect(collected[1].name).toBe('Bob');
    });
  });
});
