import { describe, it, expect } from 'vitest';
import type { EngineDatasourceDef, IDataEngine, WriteObservabilityOptions } from './data-engine';
import type { IDataDriver } from './data-driver';
import type { ServiceSlotContract } from './core-service-contracts';
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

  // Deliberately NO new engine double in this block: every pin below reads the
  // MEMBER type off the contract instead of standing up another `IDataEngine`
  // literal (this file's doubles are counted by `check:engine-double-contract`
  // against a shrink-only baseline, and a pin block is not a reason to grow
  // it). The value-level optionality evidence already exists above: every
  // pre-existing minimal `IDataEngine` literal in this file omits
  // `introspectDatasource` and compiles.
  describe('introspectDatasource (#11493)', () => {
    type Member = IDataEngine['introspectDatasource'];
    type EngineIntrospection = Awaited<ReturnType<NonNullable<Member>>>;

    it('is optional — an engine without a named-driver registry stays conformant', () => {
      // Same posture as `getDriverByName?` ([#4251]): the member's type admits
      // `undefined`, so the minimal literals above satisfy the contract without
      // it. A revert to a REQUIRED member resolves `Optional` to `never`.
      type Optional = undefined extends Member ? 'optional' : never;
      const optional: Optional = 'optional';
      expect(optional).toBe('optional');
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

    it('accepts an implementation that answers the spec shape', () => {
      const introspect: NonNullable<Member> = async (_datasource: string) => ({
        dialect: 'postgres',
        introspectedAt: '2026-08-24T00:00:00.000Z',
        tables: {},
      });
      expect(typeof introspect).toBe('function');
    });

    it('refuses an implementation that answers a non-spec shape', () => {
      // The pre-#11493 posture: `{ tables }` alone, no envelope — absorbed at
      // runtime by the consumer-side shim, invisible to every compiler.
      const bareTables = { tables: {} };
      // @ts-expect-error - the untyped pre-#11493 result no longer satisfies the declared member
      const misShapen: NonNullable<Member> = async (_datasource: string) => bareTables;
      expect(misShapen).toBeTruthy();
    });
  });

  // ===========================================================================
  // Datasource resolution + lifecycle members (#12248 — the #11833 ruling)
  // ===========================================================================
  //
  // Five members ObjectQL has implemented for releases, all consumed
  // cross-package, all recoverable until #12248 only through consumer-local
  // structural re-declarations (`service-analytics`'s `DataEngineLike`,
  // `service-datasource`'s `ConnectionEngineLike` — the #12010 inventory).
  // Declared per the 2026-08-25 maintainer ruling on #11833 (fork 1 option A;
  // item 4 for the `ConnectionEngineLike` trio), under the [#4251]/[#11493]
  // evidence bar.
  //
  // Same discipline as the block above: NO new engine double (the value-level
  // optionality evidence is the minimal `IDataEngine` literals earlier in this
  // file, which omit all five and compile); every directive below is resolved
  // by tsc, so reverting a member makes its `@ts-expect-error` unused, and an
  // unused directive is itself an error.
  describe('datasource resolution members (#12248, #11833 fork 1)', () => {
    type ResolveMember = IDataEngine['resolveEffectiveDatasource'];
    type DriverMember = IDataEngine['getDriverForObject'];

    it('both are optional — an engine without datasource routing stays conformant', () => {
      type ResolveOptional = undefined extends ResolveMember ? 'optional' : never;
      type DriverOptional = undefined extends DriverMember ? 'optional' : never;
      const a: ResolveOptional = 'optional';
      const b: DriverOptional = 'optional';
      expect(a).toBe('optional');
      expect(b).toBe('optional');
    });

    it('resolveEffectiveDatasource answers a NAME or undefined — exactly', () => {
      // Mutual extends: `undefined` is the declared "rides the deployment
      // default" answer (#5288 — deliberately not the string 'default', which
      // the engine reads as "no explicit binding, keep looking"). A drift to
      // bare `string`, or to `string | null`, resolves `Exact` to `never`.
      type Answer = ReturnType<NonNullable<ResolveMember>>;
      type Exact = Answer extends string | undefined
        ? (string | undefined extends Answer ? 'exact' : never)
        : never;
      const exact: Exact = 'exact';
      expect(exact).toBe('exact');
    });

    it('refuses a null-answering resolveEffectiveDatasource implementation', () => {
      // `null` vs `undefined` is the drift a structural re-declaration lets
      // through silently; the declared member refuses it at the return.
      // @ts-expect-error - the absent-binding answer is `undefined`, never `null`
      const nullish: NonNullable<ResolveMember> = (_objectName: string) => null;
      expect(nullish).toBeTruthy();
    });

    it('getDriverForObject answers the CONTRACT driver, or undefined — exactly', () => {
      type Answer = ReturnType<NonNullable<DriverMember>>;
      type Exact = Answer extends IDataDriver | undefined
        ? (IDataDriver | undefined extends Answer ? 'exact' : never)
        : never;
      const exact: Exact = 'exact';
      expect(exact).toBe('exact');
    });

    it('a consumer can narrow the returned driver to a picked slice at the call site', () => {
      // The `service-analytics` pattern (ADR-0053 temporal coercion): the
      // consumer keeps `Pick<IDataDriver, …>` narrowing on the RETURN — what
      // the contract ends is re-inventing the MEMBER, not the narrowing.
      type TemporalSurface = Pick<IDataDriver, 'temporalFilterValue' | 'temporalFilterColumnSql'>;
      const read = (engine: IDataEngine, objectName: string): TemporalSurface | undefined =>
        engine.getDriverForObject?.(objectName);
      expect(typeof read).toBe('function');
    });

    it('refuses an implementation answering a non-driver', () => {
      const bareName = { name: 'sql' };
      // @ts-expect-error - a `{ name }` bag is not the IDataDriver contract
      const misShapen: NonNullable<DriverMember> = (_objectName: string) => bareName;
      expect(misShapen).toBeTruthy();
    });
  });

  describe('datasource lifecycle members (#12248, #12010, #12805 via the #11833 ruling item 4)', () => {
    type RegisterMember = IDataEngine['registerDatasourceDef'];
    type ListMember = IDataEngine['listDatasourceDefs'];
    type MarkMember = IDataEngine['markDatasourceUnavailable'];
    type ClearMember = IDataEngine['clearDatasourceUnavailable'];

    it('all four are optional — only engines owning a datasource registry answer', () => {
      type A = undefined extends RegisterMember ? 'optional' : never;
      type L = undefined extends ListMember ? 'optional' : never;
      type B = undefined extends MarkMember ? 'optional' : never;
      type C = undefined extends ClearMember ? 'optional' : never;
      const a: A = 'optional';
      const l: L = 'optional';
      const b: B = 'optional';
      const c: C = 'optional';
      expect([a, l, b, c]).toEqual(['optional', 'optional', 'optional', 'optional']);
    });

    it('registerDatasourceDef takes the declarative def — name required, write gate keys optional', () => {
      const register: NonNullable<RegisterMember> = (_def) => {};
      register({ name: 'warehouse' });
      register({ name: 'warehouse', schemaMode: 'read-only', external: { allowWrites: false } });
      // #12805 — the accept set catches up to what the engine has retained
      // since #12758: a fresh literal carrying the secrets-store handle
      // compiles at THIS seam (before the catch-up it was refused with
      // TS2353 here while the runtime accepted and kept the value).
      register({
        name: 'warehouse',
        schemaMode: 'read-only',
        external: { allowWrites: false, credentialsRef: 'secrets/warehouse' },
      });
      // @ts-expect-error - a datasource definition without a name registers nothing
      register({ schemaMode: 'read-only' });
      // The widening is exactly the ruled key, not an open door: an inline
      // credential has no declared home on the def (secrets travel by
      // REFERENCE — `credentialsRef`), so an undeclared `external` key stays
      // refused. Pinned in BOTH directions, like the `kind` union below.
      // @ts-expect-error - `credentials` (inline) is not a declared external key
      register({ name: 'warehouse', external: { credentials: 'user:pass' } });
      expect(typeof register).toBe('function');
    });

    it('listDatasourceDefs answers the SAME declared def the register member takes — one shape, no drift', () => {
      // Mutual extends pins that the write side and the read-back share ONE
      // declaration (`EngineDatasourceDef`): a widening that reaches only one
      // of the pair resolves either half to `never`.
      type Registered = Parameters<NonNullable<RegisterMember>>[0];
      type Listed = ReturnType<NonNullable<ListMember>>[number];
      type Same = Registered extends Listed
        ? (Listed extends Registered ? 'same' : never)
        : never;
      type Declared = Listed extends EngineDatasourceDef
        ? (EngineDatasourceDef extends Listed ? 'declared' : never)
        : never;
      const same: Same = 'same';
      const declared: Declared = 'declared';
      expect(same).toBe('same');
      expect(declared).toBe('declared');
    });

    it('a sys_secret sweep can read the handle through the data slot contract alone', () => {
      // The #12804 consumer seam (#12805): "which code-declared datasources
      // hold a `sys_secret` handle", typed against `ServiceSlotContract`
      // for the data slot — naming neither the engine class nor a
      // consumer-local structural re-declaration (the #11833 pattern).
      const sweep = (engine: ServiceSlotContract<'data'>): string[] =>
        (engine.listDatasourceDefs?.() ?? [])
          .filter((def) => def.external?.credentialsRef !== undefined)
          .map((def) => def.name);
      expect(typeof sweep).toBe('function');
    });

    it('refuses an implementation answering nameless or inline-credential defs', () => {
      // @ts-expect-error - every listed definition carries its name
      const nameless: NonNullable<ListMember> = () => [{ schemaMode: 'read-only' }];
      // @ts-expect-error - the def carries a secrets-store REFERENCE, never an inline credential
      const inline: NonNullable<ListMember> = () => [{ name: 'w', external: { credentials: 'user:pass' } }];
      expect(nameless).toBeTruthy();
      expect(inline).toBeTruthy();
    });

    it('markDatasourceUnavailable admits exactly the two declared kinds', () => {
      // `'blocked'` (host policy refused) vs `'failed'` (connect failed under
      // a degraded boot) is the framework#3828 distinction — the reason the
      // member exists at all. The literal union is pinned in BOTH directions:
      // the two declared arms are accepted, an undeclared arm is refused, so
      // widening or narrowing the union moves this case.
      const mark: NonNullable<MarkMember> = (_info) => {};
      mark({ name: 'warehouse', kind: 'blocked' });
      mark({ name: 'warehouse', kind: 'failed', publicDetail: 'temporarily unavailable' });
      // @ts-expect-error - only 'blocked' | 'failed' are declared unavailability kinds
      mark({ name: 'warehouse', kind: 'offline' });
      expect(typeof mark).toBe('function');
    });

    it('clearDatasourceUnavailable drops a record by name and answers nothing', () => {
      type Exact = ReturnType<NonNullable<ClearMember>> extends void ? 'void' : never;
      const exact: Exact = 'void';
      const clear: NonNullable<ClearMember> = (_name: string) => {};
      clear('warehouse');
      expect(exact).toBe('void');
    });
  });
});
