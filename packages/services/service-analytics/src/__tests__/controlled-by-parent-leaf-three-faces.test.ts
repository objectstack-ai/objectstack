// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0139 D6 · ruling Q2 A on #24932] A read scope carrying the engine's
 * `ReadableIds` leaf — what `getReadFilter` answers for a `controlled_by_parent`
 * object since plugin-security's derivation switched to the leaf — on the three
 * analytics faces:
 *
 * - **the engine-bound face** (`ObjectQLStrategy.withReadScope` →
 *   `engine.aggregate`) ADMITS the leaf and the engine composes it at its
 *   boundary, so the aggregate answers the find path's rows;
 * - **the native face** (`NativeSQLStrategy`) DECLINES the query in
 *   `canHandle`, so it routes to the ObjectQL strategy and the raw-SQL seam is
 *   never called — the content-based decline the #7598 ruling accepted;
 * - **the `/analytics/sql` echo** (`ObjectQLStrategy.generateSql`, through
 *   `compileScopedFilterToSql`) REFUSES in the withheld
 *   `READ_SCOPE_COMPILE_FAILED` / 500 envelope: it runs no composition and
 *   renders no statement it would not run. The one visible change, on a
 *   debugging aid, named in the PR as a deviation.
 *
 * And what must not move: a filter an AUTHOR writes keeps today's judgement
 * (an unbranded `{ object }` in a `$in` slot is refused as the non-list
 * comparand it always was, with or without a leaf-carrying scope), and a
 * caller the master object does not admit — the deny sentinel as the scope —
 * keeps serving nothing on every face.
 *
 * Before this change (measured on the base, the dev report on #24932): every
 * face answered `READ_SCOPE_COMPILE_FAILED` / 500 for a leaf-carrying scope,
 * the engine-bound one from `assertReadScopeComparandsRunnable` refusing the
 * branded leaf as a non-list comparand before `engine.aggregate` could
 * compose it.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { declaredRefusalMessage, resolveThrownHttpError, serverFaultProvenance } from '@objectstack/types';
import { ReadableIds, RLS_DENY_FILTER } from '@objectstack/spec/data';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';
import { compileScopedFilterToSql, findReadableIdsLeaf } from '../read-scope-sql.js';

const MASTER = 'cbp_leaf_account';
const DETAIL = 'cbp_leaf_contact';

const MASTER_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  owner: { type: 'text', name: 'owner' },
};
const DETAIL_FIELDS: Record<string, Record<string, unknown>> = {
  id: { type: 'text', name: 'id' },
  account: { type: 'text', name: 'account' },
  region: { type: 'text', name: 'region' },
};

const MASTERS = [
  { id: 'a_mine', owner: 'u_me' },
  { id: 'a_mine2', owner: 'u_me' },
  { id: 'a_theirs', owner: 'u_other' },
];
const DETAILS = [
  { id: 'c1', account: 'a_mine', region: 'emea' },
  { id: 'c2', account: 'a_mine2', region: 'apac' },
  { id: 'c3', account: 'a_theirs', region: 'emea' },
  { id: 'c4', account: null, region: 'emea' },
  { id: 'c5', account: 'a_gone', region: 'amer' },
];
/** The rows the find path serves u_me: the details of the masters u_me owns. */
const MINE = ['c1', 'c2'];
const ALL = DETAILS.map((d) => d.id);

const CUBE: Cube = {
  name: 'contacts',
  sql: DETAIL,
  measures: { n: { sql: '*', type: 'count', title: 'n' } },
  dimensions: Object.fromEntries(['id', 'region'].map((n) => [n, { label: n, type: 'string', sql: n }])),
  public: true,
} as unknown as Cube;

const QUERY = { cube: 'contacts', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery;

/** The scope plugin-security's derivation answers for DETAIL: the leaf over MASTER. A factory: a fresh leaf each time. */
const leafScope = (): FilterCondition => ({ account: { $in: ReadableIds.of(MASTER) } }) as unknown as FilterCondition;
/** What an author could write that LOOKS like the leaf: an unbranded object in a list slot. */
const authoredLookalike = { account: { $in: { object: MASTER } } };

interface WireBearingError extends Error {
  code?: unknown;
  status?: unknown;
}

type Outcome = { refusal?: WireBearingError; admitted?: string[] };

const quiet = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return quiet;
  },
};

describe('[ADR-0139 D6] a read scope carrying the ReadableIds leaf on the three analytics faces', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  /** Swapped per case; the `getReadScope` contract filled by hand. */
  let readScope: unknown = null;
  /** Statements the NATIVE face handed to the database. */
  let rawStatements = 0;
  /** The master's scope the engine's composition is answered, per call. */
  const securityCalls: string[] = [];

  const runRawSql = async (sql: string, params: unknown[]): Promise<Record<string, unknown>[]> => {
    rawStatements += 1;
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
    await driver.initObjects([{ name: MASTER, fields: MASTER_FIELDS }, { name: DETAIL, fields: DETAIL_FIELDS }] as never);
    for (const row of MASTERS) await driver.create(MASTER, { ...row });
    for (const row of DETAILS) await driver.create(DETAIL, { ...row });

    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registerObject({ name: MASTER, label: 'Account', fields: MASTER_FIELDS } as never);
    engine.registerObject({ name: DETAIL, label: 'Contact', fields: DETAIL_FIELDS } as never);
    // The engine's security source (what `ObjectQLPlugin.init` puts in the
    // slot): the master's two halves for u_me — admitted, the rows u_me owns.
    const security = {
      canReadObject: async (object: string) => { securityCalls.push(`canReadObject:${object}`); return true; },
      getReadFilter: async (object: string) => {
        securityCalls.push(`getReadFilter:${object}`);
        return object === MASTER ? { owner: 'u_me' } : undefined;
      },
    };
    (engine as unknown as Record<symbol, unknown>)[Symbol.for('objectstack.objectql.securityServiceSource')] = () => security;
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  const executeAggregate = async (objectName: string, options: any) =>
    (await engine.aggregate(objectName, {
      where: options.filter,
      groupBy: options.groupBy,
      aggregations: options.aggregations?.map((a: any) => ({ function: a.method, field: a.field, alias: a.alias })),
      context: options.context,
    } as never)) as Record<string, unknown>[];

  /** The service with the engine path only — the three-faces rig's shape. */
  const engineService = () => new AnalyticsService({
    cubes: [CUBE],
    logger: quiet,
    queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
    getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
    executeAggregate,
  });

  /** The service with native SQL wired, as a raw-SQL deployment composes it. */
  const nativeService = () => {
    const rawSql = vi.fn(runRawSql);
    const service = new AnalyticsService({
      cubes: [CUBE],
      logger: quiet,
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
      getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
      executeAggregate,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => rawSql(sql, params),
      hasObjectMiddleware: () => false,
    });
    return { service, rawSql };
  };

  /** A hand-filled `StrategyContext` for driving one strategy directly. */
  const directCtx = (nativeSql: boolean): StrategyContext =>
    ({
      getCube: (name: string) => (name === 'contacts' ? CUBE : undefined),
      queryCapabilities: () => ({ nativeSql, objectqlAggregate: !nativeSql, inMemory: false }),
      getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
      executeRawSql: (_object: string, sql: string, params: unknown[]) => runRawSql(sql, params),
      executeAggregate,
      hasObjectMiddleware: () => false,
    }) as unknown as StrategyContext;

  const ids = (rows: Array<Record<string, unknown>>): string[] => rows.map((r) => String(r.id)).sort();

  const outcomeOf = async (run: () => Promise<Array<Record<string, unknown>>>): Promise<Outcome> => {
    try {
      return { admitted: ids(await run()) };
    } catch (e) {
      return { refusal: e as WireBearingError };
    }
  };

  const expectWithheldRefusal = (face: string, o: Outcome): void => {
    expect(o.admitted, `${face}: expected a refusal, got rows`).toBeUndefined();
    expect(o.refusal, `${face}: expected an Error`).toBeInstanceOf(Error);
    expect(o.refusal?.code, `${face}: envelope code`).toBe('READ_SCOPE_COMPILE_FAILED');
    expect(o.refusal?.status, `${face}: envelope status`).toBe(500);
    expect(serverFaultProvenance(resolveThrownHttpError(o.refusal, 500)), `${face}: provenance`).toBe('declared');
    expect(declaredRefusalMessage(o.refusal), `${face}: relayed prose`).toBeUndefined();
  };

  it('CONTROL: with no scope, the engine-bound face serves the whole fixture', async () => {
    readScope = null;
    expect(await outcomeOf(async () => (await engineService().query(QUERY)).rows)).toEqual({ admitted: ALL });
  });

  it('the engine-bound face composes the leaf and answers the find path\'s rows: the details of the masters u_me owns', async () => {
    readScope = leafScope();
    securityCalls.length = 0;
    expect(await outcomeOf(async () => (await engineService().query(QUERY)).rows)).toEqual({ admitted: MINE });
    // The composition asked the security service about the MASTER, as a find does.
    expect(securityCalls).toContain(`canReadObject:${MASTER}`);
    expect(securityCalls).toContain(`getReadFilter:${MASTER}`);
    // …and a `where` of the caller's own composes with it.
    expect(await outcomeOf(async () => (await engineService().query({ ...QUERY, where: { region: 'emea' } } as AnalyticsQuery)).rows))
      .toEqual({ admitted: ['c1'] });
  });

  it('the native face declines in canHandle, and through the service the raw-SQL seam is never called: the engine path serves the rows', async () => {
    readScope = leafScope();
    expect(new NativeSQLStrategy().canHandle(QUERY, directCtx(true))).toBe(false);
    // The decline reads the scope of every object the statement scopes — here
    // the base object — through the context's resolved set, as the door
    // resolves it.
    const scopedCtx = { ...directCtx(true), readScopedObjects: [DETAIL] } as unknown as DatasetScopedStrategyContext;
    expect(new NativeSQLStrategy().canHandle(QUERY, scopedCtx)).toBe(false);
    const { service, rawSql } = nativeService();
    rawStatements = 0;
    expect(await outcomeOf(async () => (await service.query(QUERY)).rows)).toEqual({ admitted: MINE });
    expect(rawSql).not.toHaveBeenCalled();
    expect(rawStatements).toBe(0);
  });

  it('CONTROL: the native face still serves a scope with no leaf natively — the decline is content-based', async () => {
    readScope = { region: 'emea' };
    expect(new NativeSQLStrategy().canHandle(QUERY, directCtx(true))).toBe(true);
    const { service, rawSql } = nativeService();
    expect(await outcomeOf(async () => (await service.query(QUERY)).rows)).toEqual({ admitted: ['c1', 'c3', 'c4'] });
    expect(rawSql).toHaveBeenCalledTimes(1);
  });

  it('the /analytics/sql echo refuses a leaf-carrying scope in the withheld READ_SCOPE_COMPILE_FAILED envelope, before any statement', async () => {
    readScope = leafScope();
    rawStatements = 0;
    const direct = await outcomeOf(async () => {
      const { sql, params } = await new ObjectQLStrategy().generateSql(QUERY, directCtx(false));
      return runRawSql(sql, params);
    });
    expectWithheldRefusal('echo (strategy)', direct);
    const viaService = await outcomeOf(async () => {
      const { sql, params } = await engineService().generateSql(QUERY);
      return runRawSql(sql, params);
    });
    expectWithheldRefusal('echo (service)', viaService);
    expect(rawStatements).toBe(0);
    // The compiler names the leaf and the object it stands for, for the
    // operator's log — the prose the wire withholds.
    expect(() => compileScopedFilterToSql(leafScope(), DETAIL)).toThrow(/ReadableIds leaf over "cbp_leaf_account" at readScope\.account\.\$in/);
    expect(findReadableIdsLeaf(leafScope())).toEqual({ object: MASTER, path: 'account.$in' });
    expect(findReadableIdsLeaf({ $and: [{ region: 'emea' }, leafScope()] })).toEqual({ object: MASTER, path: '$and[1].account.$in' });
    expect(findReadableIdsLeaf({ region: 'emea' })).toBeNull();
    expect(findReadableIdsLeaf(authoredLookalike)).toBeNull();
  });

  it("a filter an AUTHOR writes keeps today's judgement: an unbranded look-alike in a $in slot is refused as a non-list comparand, with or without the leaf-carrying scope", async () => {
    const authored = { ...QUERY, where: authoredLookalike } as AnalyticsQuery;
    for (const [name, scope] of [['no scope', null], ['the leaf-carrying scope', leafScope()]] as const) {
      readScope = scope;
      const engineFace = await outcomeOf(async () => (await engineService().query(authored)).rows);
      expect(engineFace.admitted, `engine face, ${name}`).toBeUndefined();
      expect(engineFace.refusal?.code, `engine face, ${name}`).toBe('INVALID_FILTER');
      expect(engineFace.refusal?.status, `engine face, ${name}`).toBe(400);
    }
    // …and the same refusal where the native face serves (no leaf in the scope).
    readScope = null;
    const { service, rawSql } = nativeService();
    const nativeFace = await outcomeOf(async () => (await service.query(authored)).rows);
    expect(nativeFace.refusal?.code).toBe('INVALID_FILTER');
    expect(nativeFace.refusal?.status).toBe(400);
    expect(rawSql).not.toHaveBeenCalled();
  });

  it('a caller the master object does not admit keeps the deny sentinel: no rows on the engine face, and the native face still serves it natively as nothing', async () => {
    readScope = RLS_DENY_FILTER;
    expect(await outcomeOf(async () => (await engineService().query(QUERY)).rows)).toEqual({ admitted: [] });
    expect(new NativeSQLStrategy().canHandle(QUERY, directCtx(true))).toBe(true);
    const { service, rawSql } = nativeService();
    expect(await outcomeOf(async () => (await service.query(QUERY)).rows)).toEqual({ admitted: [] });
    expect(rawSql).toHaveBeenCalledTimes(1);
  });
});
