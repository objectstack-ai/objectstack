import { describe, it, expect } from 'vitest';
import type { IDataEngine, WriteObservabilityOptions } from './data-engine';
import type { IDataDriver } from './data-driver';
import type { IntrospectedSchema } from './schema-diff-service';
import {
  EngineUpdateOptionsSchema,
  DataEngineInsertOptionsSchema,
  BaseEngineOptionsSchema,
} from '../data/data-engine.zod';

/**
 * Minimal DriverCapabilities object for tests.
 *
 * #4634: capability bits are opt-in advertisements — the 31 inert bits the old
 * literal spelled out are tombstoned (`never`), and `batchSchemaSync` is the
 * one live bit a batching driver would flip. Minimal = advertise nothing.
 */
const minimalCapabilities = {
  batchSchemaSync: false,
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

    it('takes the execution context in a trailing options argument on every read', async () => {
      // [#4251] The read methods' 3rd argument. It is what ObjectQL has taken
      // since reads and writes were unified on "context goes in the trailing
      // options" — passing it as the 3rd arg to `insert` was correct while the
      // same object as the 3rd arg to `find` was SILENTLY DROPPED, and an
      // intended `isSystem` bypass just vanished. The contract declared only
      // `query.context`, so callers reaching the trailing channel had to erase
      // the lookup to `any` to do it. Pinned here in the position that matters:
      // at the CALL, which is where the old contract rejected it.
      const seen: Array<{ method: string; isSystem?: boolean }> = [];
      const engine: IDataEngine = {
        find: async (_obj, _query, options) => {
          seen.push({ method: 'find', isSystem: options?.context?.isSystem });
          return [];
        },
        findOne: async (_obj, _query, options) => {
          seen.push({ method: 'findOne', isSystem: options?.context?.isSystem });
          return null;
        },
        insert: async (_obj, data) => data,
        update: async (_obj, data) => data,
        delete: async () => ({}),
        count: async (_obj, _query, options) => {
          seen.push({ method: 'count', isSystem: options?.context?.isSystem });
          return 0;
        },
        aggregate: async (_obj, _query, options) => {
          seen.push({ method: 'aggregate', isSystem: options?.context?.isSystem });
          return [];
        },
      };

      const sys = { context: { isSystem: true } };
      await engine.find('sys_permission_set', { where: {} }, sys);
      await engine.findOne('sys_user', { where: {} }, sys);
      await engine.count('sys_account', { where: {} }, sys);
      await engine.aggregate('sys_user', {} as any, sys);

      expect(seen).toEqual([
        { method: 'find', isSystem: true },
        { method: 'findOne', isSystem: true },
        { method: 'count', isSystem: true },
        { method: 'aggregate', isSystem: true },
      ]);
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

    // The `batch?` case that stood here was deleted with the member itself
    // (ADR-0119 D3, #4618). It is worth recording WHY it never protected
    // anything: it built an ad-hoc object literal carrying a `batch` property
    // and asserted the property was defined. That pins the TYPE — it cannot
    // fail while the declaration exists, and it would have passed unchanged for
    // the member's entire life with no engine implementing it. A test that
    // asserts a contract member is declared is not evidence the contract is
    // honoured; the neighbouring `getDefaultDriverName?` / `getDriverByName?`
    // cases earn their optionality by naming a real implementer.

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

  /**
   * [#5126] `WriteObservabilityOptions` is the IN-PROCESS write-options
   * channel. Both its members are deliberately absent from the serializable
   * Zod bags, for two different reasons that must not be conflated:
   *
   *  - `onFieldsDropped` CANNOT be there — a function has no JSON-Schema
   *    representation (#3407);
   *  - `strictReadonlyWrites` COULD trivially be there — it is a boolean — and
   *    is kept out ON PURPOSE. It was the rejected Option A of #5126: putting a
   *    write-refusal switch in the client-serializable bag makes it settable
   *    from a REST/wire body, i.e. a new toggle on a security-adjacent path.
   *
   * The second reason is the one that decays silently: nothing about a boolean
   * resists being "helpfully" added to the schema later by someone who reads
   * the contract member and assumes the bag simply lagged behind it. These
   * cases are that decision's tripwire — if one goes red, the reader is either
   * re-opening Option A or has moved the member, and either way it is a
   * maintainer decision, not a merge conflict to resolve by hand.
   */
  describe('strictReadonlyWrites stays OFF the serializable options bags (#5126)', () => {
    const shapeKeys = (schema: unknown): string[] =>
      Object.keys((schema as { shape: Record<string, unknown> }).shape);

    it('EngineUpdateOptionsSchema does not declare strictReadonlyWrites', () => {
      expect(shapeKeys(EngineUpdateOptionsSchema)).not.toContain('strictReadonlyWrites');
    });

    it('a wire body carrying strictReadonlyWrites cannot smuggle it through the update bag', () => {
      // The behavioural half of the guard: even if the key survives transport,
      // parsing the serializable bag must not yield it. A `.strict()` schema
      // would reject outright and a stripping one drops it — both are fine,
      // and both are "the client did not get to set it". What is NOT fine is
      // the value coming out the other side.
      const parsed = EngineUpdateOptionsSchema.safeParse({
        where: { id: 'r1' },
        strictReadonlyWrites: true,
      });
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty('strictReadonlyWrites');
      }
    });

    it('neither does the insert bag nor the shared base every bag extends', () => {
      // Guarding only the update bag would miss the cheapest way to re-open
      // Option A: adding it to `BaseEngineOptionsSchema`, which every engine
      // options schema extends — including the read ones.
      expect(shapeKeys(DataEngineInsertOptionsSchema)).not.toContain('strictReadonlyWrites');
      expect(shapeKeys(BaseEngineOptionsSchema)).not.toContain('strictReadonlyWrites');
    });

    it('and it IS declared on the in-process contract — the guard above is not vacuous', () => {
      // Without this case the three above would keep passing after someone
      // deleted the member outright: absent from the bag AND absent from the
      // contract reads as "the rejection holds", which is the #4984 phantom-
      // check shape. A type-level check is the honest one — the member is an
      // optional boolean on an interface, so there is no runtime value to
      // inspect.
      const strict: WriteObservabilityOptions = { strictReadonlyWrites: true };
      const off: WriteObservabilityOptions = { strictReadonlyWrites: false };
      expect(strict.strictReadonlyWrites).toBe(true);
      expect(off.strictReadonlyWrites).toBe(false);
      // Absent is the default and must stay legal — strict is opt-in.
      const unset: WriteObservabilityOptions = {};
      expect(unset.strictReadonlyWrites).toBeUndefined();
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
      expect(driverAsInterface.supports.batchSchemaSync).toBe(false);
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
        // #4634: transactions/bulk are expressed by the methods below, not by
        // capability bits — those two bits are tombstoned.
        supports: { ...minimalCapabilities, autonumber: true },
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

    // The `findStream` case that stood here was removed with the contract method
    // in 17.0.0 (#4484) — it built an IDataDriver whose only job was to satisfy a
    // required method no production code ever called.
  });

  // ===========================================================================
  // introspectDatasource — typed on the contract, not re-declared by consumers
  // (#11493, extending the #11123 ruling to the engine-registration seam)
  // ===========================================================================
  //
  // Reverse-verified against the pre-#11493 contract (measured 2026-08-24):
  // with the member undeclared, an engine answering a non-spec shape compiled
  // green, and the one in-tree consumer (service-datasource's plugin) carried
  // a private structural `DataEngineLike` to recover the spec return type.
  // Every directive below is resolved by tsc; reverting the member makes it
  // unused, and an unused directive is itself an error.

  describe('introspectDatasource (#11493)', () => {
    type EngineIntrospection = Awaited<ReturnType<NonNullable<IDataEngine['introspectDatasource']>>>;

    const minimalEngine: IDataEngine = {
      find: async () => [],
      findOne: async () => null,
      insert: async (_obj, data) => data,
      update: async (_obj, data) => data,
      delete: async () => ({ deleted: 0 }),
      count: async () => 0,
      aggregate: async () => [],
    };

    it('is optional — an engine without a named-driver registry stays conformant', () => {
      // `minimalEngine` satisfies `IDataEngine` at its declaration with no
      // registry members at all — same posture as `getDriverByName?` ([#4251]).
      expect(minimalEngine.introspectDatasource).toBeUndefined();
    });

    it('declares exactly the spec introspection shape', () => {
      // Mutual extends: a revert to `Promise<unknown>` — the shape that forced
      // the consumer-side re-declaration — resolves `Exact` to `never`.
      type Exact = EngineIntrospection extends IntrospectedSchema
        ? (IntrospectedSchema extends EngineIntrospection ? 'exact' : never)
        : never;
      const exact: Exact = 'exact';
      expect(exact).toBe('exact');
    });

    it('accepts an engine that answers the spec shape', () => {
      const introspecting: IDataEngine = {
        ...minimalEngine,
        introspectDatasource: async (_datasource) => ({
          dialect: 'postgres',
          introspectedAt: '2026-08-24T00:00:00.000Z',
          tables: {},
        }),
      };
      expect(typeof introspecting.introspectDatasource).toBe('function');
    });

    it('refuses an engine that answers a non-spec shape at the member', () => {
      // The pre-#11493 posture: `{ tables }` alone, no envelope — absorbed at
      // runtime by the consumer-side shim, invisible to every compiler.
      const bareTables = { tables: {} };
      const misShapen: IDataEngine = {
        ...minimalEngine,
        // @ts-expect-error - the untyped pre-#11493 result no longer satisfies the declared member
        introspectDatasource: async (_datasource: string) => bareTables,
      };
      expect(misShapen).toBeTruthy();
    });
  });
});
