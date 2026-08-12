import { describe, it, expect } from 'vitest';
import type { DriverQuery, IDataDriver } from './data-driver';
import type { QueryAST } from '../data/query.zod';
import type { DriverOptions } from '../data/driver.zod';

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

  // ===========================================================================
  // DriverQuery — the AST no longer repeats the object name (#5181)
  // ===========================================================================
  //
  // Every pin below is resolved by tsc, not by vitest: reverting the change
  // (`query: DriverQuery` back to `query: QueryAST`) makes the `@ts-expect-error`
  // directives unused, and an unused directive is itself an error, so
  // `pnpm --filter @objectstack/spec typecheck` goes red. This file carries no
  // entry in `test-typecheck-debt.json`, which is what makes "zero errors" the
  // measurable baseline these pins move away from. The `expect()` calls only
  // give the assertions a home vitest will run.

  describe('DriverQuery', () => {
    it('does not carry `object` at all — argument one is the only spelling', () => {
      type ObjectDropped = 'object' extends keyof DriverQuery ? never : 'dropped';
      const dropped: ObjectDropped = 'dropped';
      // Everything else survives: this is a subtraction of one key, not a new dialect.
      type WhereKept = 'where' extends keyof DriverQuery ? 'kept' : never;
      const kept: WhereKept = 'kept';
      expect([dropped, kept]).toEqual(['dropped', 'kept']);
    });

    it('is what all six query-taking methods actually declare', () => {
      // This pin reads the parameter off the CONTRACT rather than off the alias,
      // and that is the point: a revert that puts `QueryAST` back on one
      // signature while leaving `DriverQuery` defined would sail past every
      // alias-scoped assertion in this block. Here that slot resolves to `never`
      // and the line goes red — per method, so the message names which one.
      type DropsObject<T> = 'object' extends keyof T ? never : 'dropped';
      const perMethod: [
        DropsObject<Parameters<IDataDriver['find']>[1]>,
        DropsObject<Parameters<IDataDriver['findOne']>[1]>,
        DropsObject<NonNullable<Parameters<IDataDriver['count']>[1]>>,
        DropsObject<Parameters<NonNullable<IDataDriver['updateMany']>>[1]>,
        DropsObject<Parameters<NonNullable<IDataDriver['deleteMany']>>[1]>,
        DropsObject<Parameters<NonNullable<IDataDriver['explain']>>[1]>,
      ] = ['dropped', 'dropped', 'dropped', 'dropped', 'dropped', 'dropped'];
      expect(perMethod).toHaveLength(6);
    });

    it('lets a caller pass only the query, which is what forced the casts', () => {
      // Before #5181 this literal did not compile (`object` was required), so a
      // caller holding just a `where` reached for `as any` — and lost the type
      // checking on everything else in the same stroke (cloud#1053, 20 sites).
      const q: DriverQuery = { where: { status: 'open' }, limit: 10 };
      expect(q.limit).toBe(10);
    });

    it('rejects the redundant object key in a call-site literal', () => {
      // The excess-property check is the whole enforcement: writing the object
      // name twice is now a compile error rather than a convention nobody could
      // enforce. It is also what stops the two spellings from disagreeing —
      // the hazard the engine spends a key order on (`{ ...query, object }`)
      // and the wire layer spends a 400 on (`QUERY_OBJECT_MISMATCH`).
      // @ts-expect-error - 'object' does not exist in type 'DriverQuery'
      const redundant: DriverQuery = { object: 'account', where: { status: 'open' } };
      expect(redundant).toBeTruthy();
    });

    it('still accepts a whole QueryAST value, so existing callers do not move', () => {
      // A `QueryAST` variable has every property `DriverQuery` requires and one
      // more; TypeScript admits the extra on any value that is not a fresh
      // literal. This is why the engine's `driver.find(object, ast, …)` needed
      // no edit — only literals written at the call site are re-judged.
      const ast: QueryAST = { object: 'account', where: { status: 'open' } };
      const asDriverQuery: DriverQuery = ast;
      expect(asDriverQuery.where).toEqual({ status: 'open' });
    });

    it('keeps `object` inside an expand entry, where it is not redundant', () => {
      // The nested value names the RELATED object — a fact no argument carries.
      const q: DriverQuery = {
        fields: ['title'],
        expand: { owner: { object: 'user', fields: ['name'] } },
      };
      expect(q.expand?.owner?.object).toBe('user');

      // @ts-expect-error - a nested expand entry still requires its own `object`
      const missing: DriverQuery = { expand: { owner: { fields: ['name'] } } };
      expect(missing).toBeTruthy();
    });

    it('keeps an implementation that still declares the full QueryAST', () => {
      // Method parameters are compared bivariantly, so a driver written against
      // the old signature needs no edit to keep satisfying the contract. What it
      // may no longer do is READ `query.object` — callers are free to omit it —
      // and no driver in this repository does.
      const legacyImplementation: Pick<IDataDriver, 'find' | 'count'> = {
        async find(_object: string, _query: QueryAST, _options?: DriverOptions) {
          return [];
        },
        async count(_object: string, _query?: QueryAST, _options?: DriverOptions) {
          return 0;
        },
      };
      expect(legacyImplementation.count).toBeDefined();
    });

    it('recovers the checks a blanket cast switched off — but not all of them', () => {
      // What the cast hid and this change gives back: the typed slots.
      // `orderBy` is `SortNode[]`, closed since #4721, so the `direction`
      // spelling that silently sorted the wrong way is a compile error again.
      // @ts-expect-error - spell the direction `order`, never `direction`
      const wrongSortKey: DriverQuery = { orderBy: [{ field: 'created_at', direction: 'desc' }] };
      expect(wrongSortKey).toBeTruthy();

      // What it does NOT give back, stated here so nobody reads more into the
      // fix than it delivers: `where` is `FilterCondition`, whose index
      // signature is `[key: string]: any` because ANY field name is a legal key.
      // An operator the dialect does not have is therefore still not a type
      // error — it reaches the runtime filter compiler and is rejected there,
      // not here. Removing the cast does not close that door; only a closed
      // operator vocabulary would, which is a separate change.
      //
      // [#7536] The exemplar was `$like` (the operator cloud#1030 measured
      // reaching the runtime). It is a DECLARED operator now, so it no longer
      // illustrates "an operator the dialect does not have" — the point stands,
      // the example had to move to a spelling that is still undeclared. The
      // history is untouched: `$like` is what cloud#1030 caught, back when it
      // was not in the protocol.
      const unknownOperator: DriverQuery = { where: { name: { $sounds_like: 'acme%' } } };
      expect(unknownOperator.where).toBeTruthy();
    });
  });
});
