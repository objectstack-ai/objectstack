// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20987] `$contains` / `$notContains` on a declared multi-valued or
 * JSON-stored field is a MEMBERSHIP test on both of this package's SQL faces
 * that execute: the read scope (`compileScopedFilterToSql`) and the native
 * `where` (`NativeSQLStrategy.buildFilterClause`). On a scalar text column it
 * stays the substring test.
 *
 * The contract is `FILTER_OPERATORS`' `$contains` docblock
 * (`@objectstack/spec/data`): on a `multiple: true` field or a JSON-stored type
 * the operator asks whether the comparand is an ELEMENT of the stored array;
 * on a scalar string column it asks for a substring. `driver-sql` answers it on
 * all three dialects (#17590), and its per-dialect construct now lives in
 * `@objectstack/core` (`jsonMembershipPredicate`) so these faces ask the same
 * question from the same implementation.
 *
 * Before this change both faces compiled the operator through the text-match
 * family on every column: on SQLite a substring test over the stored JSON text,
 * so a row storing `["u10"]` satisfied `$contains: 'u1'` (a read scope admitted
 * a row outside its policy, a `where` over-counted and its complement
 * under-counted), and on PostgreSQL a `LIKE` over a `json` column, refused by
 * the server.
 *
 * ## What runs where
 *
 * - **SQLite: EXECUTED.** One `SqliteWasmDriver` (sql.js, the engine
 *   `driver-sqlite-wasm` ships) behind a real `ObjectQL`; every face is driven
 *   through `AnalyticsService`: the native face's statement runs on that
 *   database, the ObjectQL face asks the engine, and the `/analytics/sql` echo
 *   of the ObjectQL strategy is run on the same database for the read scope.
 * - **PostgreSQL and MySQL: the emitted construct.** No server runs here; the
 *   live PostgreSQL leg is `packages/rest/src/analytics-contains-membership-door.test.ts`.
 *   MySQL is asserted as text only.
 * - **`'unknown'` dialect: refused**, on a JSON-stored field only, in each
 *   face's own envelope, before anything binds.
 *
 * The three declared classes are a `MULTI_OPTION_TYPES` member (`tags`), a
 * multi-capable type flagged `multiple: true` (`owners`) and a
 * `STRUCTURED_JSON_TYPES` member (`doc`); `label` is the scalar control.
 *
 * ## What the ObjectQL face is asked, and why not more
 *
 * Only the two multi-valued classes. The engine's text-operator door
 * (`filter-text-operator-declared-type.ts`, the #15661 ruling) refuses every
 * text operator over a `STRUCTURED_JSON_TYPES` field before any driver runs,
 * so a `doc` filter never reaches the engine's membership construct there.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import type { Cube, FilterCondition, ValueShapeFieldDef } from '@objectstack/spec/data';

import { AnalyticsService } from '../analytics-service.js';
import { compileScopedFilterToSql, type ReadScopeCompileOptions } from '../read-scope-sql.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';

const OBJECT = 'mbr_item';

const FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  label: { type: 'text', name: 'label' },
  tags: { type: 'tags', name: 'tags' },
  owners: { type: 'lookup', name: 'owners', reference: 'mbr_owner', multiple: true },
  doc: { type: 'json', name: 'doc' },
};

/** The declared value shape the host answers, per field. */
const SHAPES: Record<string, ValueShapeFieldDef> = Object.fromEntries(
  Object.entries(FIELDS).map(([name, f]) => [name, { type: String(f.type), multiple: f.multiple === true }]),
);

/** The JSON-stored columns, one per declared class. */
const MEMBERSHIP_FIELDS = ['tags', 'owners', 'doc'] as const;
/** The classes the ObjectQL face is asked about: see the header. */
const ENGINE_FIELDS: readonly string[] = ['tags', 'owners'];

/**
 * The card's fixture is `r2`: it stores `["u10"]`, which holds `u1` as a
 * substring of its text and not as a member. `r4` has no value and `r5` the
 * empty list, for the NULL rule of the negation.
 */
const ROWS = [
  { id: 'r1', label: 'u1', tags: ['u1', 'u2'], owners: ['u1', 'u2'], doc: ['u1'] },
  { id: 'r2', label: 'u10', tags: ['u10'], owners: ['u10'], doc: ['u10'] },
  { id: 'r3', label: 'u2', tags: ['u2'], owners: ['u2'], doc: ['u2'] },
  { id: 'r4', label: null, tags: null, owners: null, doc: null },
  { id: 'r5', label: '', tags: [], owners: [], doc: [] },
];

/** Membership answers, identical on every JSON-stored column. */
const MEMBER = ['r1'];
const NOT_MEMBER = ['r2', 'r3', 'r4', 'r5'];
/** The scalar control's substring answers. */
const SUBSTRING = ['r1', 'r2'];
const NOT_SUBSTRING = ['r3', 'r4', 'r5'];

const CUBE: Cube = {
  name: OBJECT,
  title: 'Membership items',
  sql: OBJECT,
  measures: { total: { label: 'Total', type: 'count', sql: '*' } },
  dimensions: { id: { label: 'Id', type: 'string', sql: 'id' } },
  public: true,
} as unknown as Cube;

const query = (where?: unknown): AnalyticsQuery =>
  ({ cube: OBJECT, measures: ['total'], dimensions: ['id'], ...(where ? { where } : {}) }) as AnalyticsQuery;

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};

interface CodedError extends Error {
  code?: unknown;
  status?: unknown;
}

async function refusalOf(fn: () => unknown): Promise<CodedError> {
  try {
    await fn();
  } catch (e) {
    return e as CodedError;
  }
  throw new Error('expected a refusal, and the filter was served');
}

const ids = (rows: Array<Record<string, unknown>>): string[] => rows.map((r) => String(r.id)).sort();

describe('[#20987] $contains / $notContains on a JSON-stored field answer membership — executed on SQLite', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let objectql: AnalyticsService;
  let native: AnalyticsService;
  let scopes: Record<string, unknown> = {};

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    const result = await driver.execute(sql.replace(/\$\d+/g, '?'), params as unknown[]);
    if (Array.isArray(result)) return result as Record<string, unknown>[];
    if (result && typeof result === 'object' && 'rows' in (result as Record<string, unknown>)) {
      return (result as { rows: Record<string, unknown>[] }).rows;
    }
    return [];
  };

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: FIELDS }] as never);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });

    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Membership item', fields: FIELDS } as never);

    const common = {
      cubes: [CUBE],
      logger: quiet,
      getReadScope: (object: string) => (scopes[object] ?? undefined) as FilterCondition | undefined,
      sourceFieldMeta: (object: string, field: string) => (object === OBJECT ? SHAPES[field] : undefined),
      sqlDialect: () => 'sqlite' as const,
      executeAggregate: async (objectName: string, options: Record<string, any>) =>
        (await engine.aggregate(objectName, {
          where: options.filter,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map((a: Record<string, unknown>) => ({
            function: a.method,
            field: a.field,
            alias: a.alias,
          })),
          context: options.context,
        } as never)) as Record<string, unknown>[],
    };
    objectql = new AnalyticsService({
      ...common,
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    } as never);
    native = new AnalyticsService({
      ...common,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeRawSql: async (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
    } as never);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  afterEach(() => {
    scopes = {};
  });

  /** The read scope on the native face: `applyReadScope` → the executed statement. */
  const nativeScoped = async (scope: unknown): Promise<string[]> => {
    scopes = { [OBJECT]: scope };
    return ids((await native.query(query())).rows);
  };
  /** The read scope on the ObjectQL face: the engine applies it. */
  const objectqlScoped = async (scope: unknown): Promise<string[]> => {
    scopes = { [OBJECT]: scope };
    return ids((await objectql.query(query())).rows);
  };
  /** The read scope on the `/analytics/sql` echo of the ObjectQL strategy, run on the same database. */
  const echoScoped = async (scope: unknown): Promise<string[]> => {
    scopes = { [OBJECT]: scope };
    const { sql, params } = await objectql.generateSql(query());
    return ids(await runRawSql(sql, params));
  };

  it('CONTROL: with no scope and no where, every face serves the whole fixture', async () => {
    const all = ROWS.map((r) => r.id).sort();
    expect(await nativeScoped(undefined)).toEqual(all);
    expect(await objectqlScoped(undefined)).toEqual(all);
    expect(ids((await native.query(query())).rows)).toEqual(all);
  });

  describe('the read scope, through a policy-shaped scope on each face', () => {
    for (const field of MEMBERSHIP_FIELDS) {
      it(`${field}: $contains 'u1' admits only the row holding the member, not the row storing ["u10"]`, async () => {
        const scope = { [field]: { $contains: 'u1' } };
        expect(await nativeScoped(scope), 'native').toEqual(MEMBER);
        expect(await echoScoped(scope), 'echo').toEqual(MEMBER);
        if (ENGINE_FIELDS.includes(field)) expect(await objectqlScoped(scope), 'objectql').toEqual(MEMBER);
      });

      it(`${field}: $notContains 'u1' is the exact complement, the row with no value included`, async () => {
        const scope = { [field]: { $notContains: 'u1' } };
        expect(await nativeScoped(scope), 'native').toEqual(NOT_MEMBER);
        expect(await echoScoped(scope), 'echo').toEqual(NOT_MEMBER);
        if (ENGINE_FIELDS.includes(field)) expect(await objectqlScoped(scope), 'objectql').toEqual(NOT_MEMBER);
      });
    }

    it('$not over $contains on a JSON-stored field is the membership complement', async () => {
      const scope = { $not: { tags: { $contains: 'u1' } } };
      expect(await nativeScoped(scope)).toEqual(NOT_MEMBER);
      expect(await objectqlScoped(scope)).toEqual(NOT_MEMBER);
    });

    it('CONTROL: on a scalar text column $contains stays the substring test', async () => {
      expect(await nativeScoped({ label: { $contains: 'u1' } })).toEqual(SUBSTRING);
      expect(await objectqlScoped({ label: { $contains: 'u1' } })).toEqual(SUBSTRING);
      expect(await nativeScoped({ label: { $notContains: 'u1' } })).toEqual(NOT_SUBSTRING);
    });
  });

  describe('the where, on both strategies', () => {
    for (const field of MEMBERSHIP_FIELDS) {
      it(`${field}: $contains 'u1' counts only the row holding the member`, async () => {
        const where = { [field]: { $contains: 'u1' } };
        expect(ids((await native.query(query(where))).rows), 'native').toEqual(MEMBER);
        if (ENGINE_FIELDS.includes(field)) expect(ids((await objectql.query(query(where))).rows), 'objectql').toEqual(MEMBER);
      });

      it(`${field}: $notContains 'u1' counts the complement, the row with no value included`, async () => {
        const where = { [field]: { $notContains: 'u1' } };
        expect(ids((await native.query(query(where))).rows), 'native').toEqual(NOT_MEMBER);
        if (ENGINE_FIELDS.includes(field)) expect(ids((await objectql.query(query(where))).rows), 'objectql').toEqual(NOT_MEMBER);
      });
    }

    it('CONTROL: on a scalar text column the where stays the substring test, on both strategies', async () => {
      for (const service of [native, objectql]) {
        expect(ids((await service.query(query({ label: { $contains: 'u1' } }))).rows)).toEqual(SUBSTRING);
        expect(ids((await service.query(query({ label: { $notContains: 'u1' } }))).rows)).toEqual(NOT_SUBSTRING);
      }
    });
  });
});

describe('[#20987] the read scope compiles the membership construct per dialect', () => {
  const opts = (dialect?: string): ReadScopeCompileOptions => ({
    ...(dialect ? { dialect } : {}),
    declaredValueShape: (field) => SHAPES[field],
  });

  it('postgres: jsonb containment of the array-wrapped candidate, no LIKE over the json column', () => {
    const { sql, params } = compileScopedFilterToSql({ tags: { $contains: 'u1' } }, 't', opts('postgres'));
    expect(sql).toContain('"t"."tags"::jsonb @> ?::jsonb');
    expect(sql).not.toMatch(/LIKE/);
    expect(params).toEqual(['["u1"]']);
  });

  it('mysql: JSON_CONTAINS of the array-wrapped candidate, no binary LIKE', () => {
    const { sql, params } = compileScopedFilterToSql({ tags: { $contains: 'u1' } }, 't', opts('mysql'));
    expect(sql).toContain('JSON_CONTAINS("t"."tags", ?)');
    expect(sql).not.toMatch(/LIKE/);
    expect(params).toEqual(['["u1"]']);
  });

  it('sqlite: a json_each element scan, no instr over the stored text', () => {
    const { sql, params } = compileScopedFilterToSql({ tags: { $contains: 'u1' } }, 't', opts('sqlite'));
    expect(sql).toContain('json_each(CASE WHEN json_valid("t"."tags") THEN "t"."tags" ELSE \'[]\' END)');
    expect(sql).not.toMatch(/instr|GLOB|LIKE/);
    expect(params).toEqual(['"u1"']);
  });

  it('a numeric comparand binds both of its JSON readings, as driver-sql binds them', () => {
    expect(compileScopedFilterToSql({ owners: { $contains: '7' } }, 't', opts('postgres')).params).toEqual(['["7"]', '[7]']);
  });

  it('$notContains keeps the NULL rule around the negated membership test', () => {
    const { sql } = compileScopedFilterToSql({ doc: { $notContains: 'u1' } }, 't', opts('postgres'));
    expect(sql).toContain('"t"."doc" IS NULL OR');
    expect(sql).toContain('NOT ("t"."doc"::jsonb @> ?::jsonb)');
  });

  it('CONTROL: a scalar text column keeps the text-match construct on every dialect', () => {
    expect(compileScopedFilterToSql({ label: { $contains: 'u1' } }, 't', opts('postgres')).sql).toContain('"t"."label" LIKE ? ESCAPE ?');
    expect(compileScopedFilterToSql({ label: { $contains: 'u1' } }, 't', opts('sqlite')).sql).toContain('instr("t"."label", ?) > 0');
  });

  for (const op of ['$contains', '$notContains'] as const) {
    it(`the 'unknown' dialect refuses ${op} on a JSON-stored field: READ_SCOPE_COMPILE_FAILED / 500, before anything binds`, async () => {
      const err = await refusalOf(() => compileScopedFilterToSql({ tags: { [op]: 'u1' } }, 't', opts()));
      expect(err.code).toBe('READ_SCOPE_COMPILE_FAILED');
      expect(err.status).toBe(500);
    });
  }

  it("CONTROL: the 'unknown' dialect still compiles $contains on a scalar text column", () => {
    expect(compileScopedFilterToSql({ label: { $contains: 'u1' } }, 't', opts()).sql).toContain('"t"."label" LIKE ? ESCAPE ?');
  });
});

describe('[#20987] the native where compiles the membership construct per dialect', () => {
  const ctxFor = (dialect?: string): StrategyContext => {
    const hooks: Partial<DatasetScopedStrategyContext> = {
      getCube: (name: string) => (name === OBJECT ? CUBE : undefined),
      declaredValueShape: (object: string, field: string) => (object === OBJECT ? SHAPES[field] : undefined),
      ...(dialect ? { sqlDialect: () => dialect } : {}),
    };
    return {
      ...hooks,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => [],
    } as StrategyContext;
  };

  it('postgres: jsonb containment, with the strategy\'s own placeholders', async () => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(query({ tags: { $contains: 'u1' } }), ctxFor('postgres'));
    expect(sql).toMatch(/tags"?::jsonb @> \$\d+::jsonb/);
    expect(sql).not.toMatch(/LIKE/);
    expect(params).toContain('["u1"]');
  });

  it('mysql: JSON_CONTAINS of the array-wrapped candidate', async () => {
    const { sql, params } = await new NativeSQLStrategy().generateSql(query({ tags: { $contains: 'u1' } }), ctxFor('mysql'));
    expect(sql).toMatch(/JSON_CONTAINS\([^)]*tags"?, \$\d+\)/);
    expect(sql).not.toMatch(/LIKE/);
    expect(params).toContain('["u1"]');
  });

  for (const op of ['$contains', '$notContains'] as const) {
    it(`the 'unknown' dialect refuses ${op} on a JSON-stored field: INVALID_FILTER / 400`, async () => {
      const err = await refusalOf(() => new NativeSQLStrategy().execute(query({ owners: { [op]: 'u1' } }), ctxFor()));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
    });
  }

  it("CONTROL: the 'unknown' dialect still compiles $contains on a scalar text column", async () => {
    const { sql } = await new NativeSQLStrategy().generateSql(query({ label: { $contains: 'u1' } }), ctxFor());
    expect(sql).toMatch(/label"? LIKE \$\d+ ESCAPE \$\d+/);
  });
});

/**
 * [#20987, the seat's decision 5927023075] On a datasource whose SQL dialect
 * the host cannot name (`'unknown'`: a non-SQL driver such as memory or
 * mongodb, whose raw-SQL bridge answers `RAW_SQL_UNSUPPORTED`), a query that
 * would need a JSON function is DECLINED by `NativeSQLStrategy.canHandle`: a
 * `$contains` / `$notContains` on a declared multi-valued or JSON-stored field,
 * or a `$empty` on a multi-valued one, in the `where` or in a read scope. The
 * ObjectQL strategy then answers through the engine. The compile-time
 * refusals stay as the backstop, so a host with no ObjectQL bridge is still
 * refused, and nothing reaches its raw-SQL bridge.
 *
 * The fixture is the one above. The raw-SQL bridge refuses every statement as
 * a non-SQL driver does, and counts what reached it; the host answers no
 * dialect.
 */
describe('[#20987] an unknown dialect: the native strategy declines a JSON-stored membership test, and the ObjectQL strategy answers', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let bridged: AnalyticsService;
  let unbridged: AnalyticsService;
  let scopes: Record<string, unknown> = {};
  let rawStatements = 0;

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    (driver as unknown as { logger: unknown }).logger = quiet;
    await driver.initObjects([{ name: OBJECT, fields: FIELDS }] as never);
    for (const row of ROWS) await driver.create(OBJECT, { ...row });

    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: OBJECT, label: 'Membership item', fields: FIELDS } as never);

    const common = {
      cubes: [CUBE],
      logger: quiet,
      getReadScope: (object: string) => (scopes[object] ?? undefined) as FilterCondition | undefined,
      sourceFieldMeta: (object: string, field: string) => (object === OBJECT ? SHAPES[field] : undefined),
      // What the plugin's bridge answers on a non-SQL driver: no raw SQL runs.
      executeRawSql: async () => {
        rawStatements += 1;
        const err = new Error('this driver does not support SQL execution') as Error & { code: string };
        err.code = 'RAW_SQL_UNSUPPORTED';
        throw err;
      },
    };
    bridged = new AnalyticsService({
      ...common,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async (objectName: string, options: Record<string, any>) =>
        (await engine.aggregate(objectName, {
          where: options.filter,
          groupBy: options.groupBy,
          aggregations: options.aggregations?.map((a: Record<string, unknown>) => ({
            function: a.method,
            field: a.field,
            alias: a.alias,
          })),
          context: options.context,
        } as never)) as Record<string, unknown>[],
    } as never);
    unbridged = new AnalyticsService({
      ...common,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
    } as never);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  afterEach(() => {
    scopes = {};
    rawStatements = 0;
  });

  const served = async (service: AnalyticsService, scope?: unknown, where?: unknown): Promise<string[]> => {
    scopes = scope ? { [OBJECT]: scope } : {};
    return ids((await service.query(query(where))).rows);
  };

  describe('the read scope (a policy)', () => {
    for (const field of ENGINE_FIELDS) {
      it(`${field}: $contains 'u1' is answered by the engine, membership, and no statement reaches the raw-SQL bridge`, async () => {
        expect(await served(bridged, { [field]: { $contains: 'u1' } })).toEqual(MEMBER);
        expect(rawStatements).toBe(0);
      });

      it(`${field}: $notContains 'u1' is answered by the engine, the complement`, async () => {
        expect(await served(bridged, { [field]: { $notContains: 'u1' } })).toEqual(NOT_MEMBER);
        expect(rawStatements).toBe(0);
      });
    }

    it('$empty on a multi-valued field is answered by the engine', async () => {
      expect(await served(bridged, { tags: { $empty: true } })).toEqual(['r4', 'r5']);
      expect(rawStatements).toBe(0);
    });

    it('with no ObjectQL bridge the query is refused, fail-closed, and no statement reaches the raw-SQL bridge', async () => {
      await refusalOf(() => served(unbridged, { tags: { $contains: 'u1' } }));
      expect(rawStatements).toBe(0);
    });

    it('CONTROL: a scalar text policy is not declined; the native strategy is tried and falls back as before', async () => {
      expect(await served(bridged, { label: { $contains: 'u1' } })).toEqual(SUBSTRING);
      expect(rawStatements).toBe(1);
    });
  });

  describe('the where', () => {
    for (const field of ENGINE_FIELDS) {
      it(`${field}: $contains 'u1' is answered by the engine, membership, and no statement reaches the raw-SQL bridge`, async () => {
        expect(await served(bridged, undefined, { [field]: { $contains: 'u1' } })).toEqual(MEMBER);
        expect(rawStatements).toBe(0);
      });

      it(`${field}: $notContains 'u1' is answered by the engine, the complement`, async () => {
        expect(await served(bridged, undefined, { [field]: { $notContains: 'u1' } })).toEqual(NOT_MEMBER);
        expect(rawStatements).toBe(0);
      });
    }

    it('$empty on a multi-valued field is answered by the engine', async () => {
      expect(await served(bridged, undefined, { tags: { $empty: true } })).toEqual(['r4', 'r5']);
      expect(rawStatements).toBe(0);
    });

    it('with no ObjectQL bridge the query is refused, fail-closed, and no statement reaches the raw-SQL bridge', async () => {
      await refusalOf(() => served(unbridged, undefined, { tags: { $contains: 'u1' } }));
      expect(rawStatements).toBe(0);
    });

    it('CONTROL: a scalar text where is not declined; the native strategy is tried and falls back as before', async () => {
      expect(await served(bridged, undefined, { label: { $contains: 'u1' } })).toEqual(SUBSTRING);
      expect(rawStatements).toBe(1);
    });
  });
});
