// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0155 plan step 5, Q2 as ruled] The share-grant leaf (`SharedRecordIds`)
 * on the analytics faces:
 *
 *  - **the native compiler compiles it** (`compileScopedFilterToSql`): the
 *    step-1 conformance cases (`SHARED_RECORD_IDS_CASE_SET`), live on SQLite,
 *    answer exactly their rows; the write form is refused in D4's envelope;
 *  - **it declines D4's two classes** (`NativeSQLStrategy.canHandle`), asking
 *    the engine seam's own recognition (`fixedReadLeafClassOfEngine`), and
 *    declines too when it cannot ask;
 *  - **the engine strategy's merge admits the brand**, and the engine answers
 *    the same rows the native statement does;
 *  - **the echo prints the subquery** (`/analytics/sql`).
 *
 * The invariant (D-0): the native face answers the engine path's rows, or the
 * query goes to the engine path, or the answer is D4's refusal,
 * `INTERNAL_ERROR` / 500. ⛔ No third, quieter answer.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { ObjectQL, fixedReadLeafClassOfEngine } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import {
  SHARED_RECORD_IDS_CASE_SET,
  SharedRecordIds,
  isComposedReadableIds,
  isFixedReadLeaf,
} from '@objectstack/spec/data';
import type { Cube, FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';

import { AnalyticsService } from '../analytics-service.js';
import {
  READ_SCOPE_FIXED_READ_LEAF_BRANDS,
  assertReadScopeComparandsRunnable,
  compileScopedFilterToSql,
} from '../read-scope-sql.js';

const S = SHARED_RECORD_IDS_CASE_SET;
const REFUSED = { code: 'INTERNAL_ERROR', status: 500 };

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

/** Every column a case-set table's rows carry, declared text. */
function fieldsOf(table: (typeof S.tables)[number]): Record<string, Record<string, unknown>> {
  const columns = new Set<string>();
  for (const row of table.rows) for (const column of Object.keys(row)) columns.add(column);
  return Object.fromEntries([...columns].map((name) => [name, { type: 'text', name }]));
}

/** What a case's `where` holds that this read-only compiler never compiles. */
function shapeOf(where: unknown): 'composed' | 'write-form' | 'plain' {
  let found: 'composed' | 'write-form' | 'plain' = 'plain';
  const visit = (value: unknown): void => {
    if (isComposedReadableIds(value)) found = 'composed';
    else if (isFixedReadLeaf(value)) { if (value.accessLevels !== undefined && found === 'plain') found = 'write-form'; }
    else if (value !== null && typeof value === 'object') for (const v of Object.values(value)) visit(v);
  };
  visit(where);
  return found;
}

type Thrown = (Error & { code?: string; status?: number }) | null;
const thrownBy = (fn: () => unknown): Thrown => {
  try {
    fn();
    return null;
  } catch (e) {
    return e as Thrown;
  }
};
const envelopeOf = (err: Thrown) => ({ code: err?.code, status: err?.status });

describe('[ADR-0155 Q2] the share-grant leaf on the analytics faces, live on SQLite', () => {
  let driver: SqliteWasmDriver;
  let engine: ObjectQL;
  let readScope: unknown = null;

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
    await driver.initObjects(S.tables.map((t) => ({ name: t.object, fields: fieldsOf(t) })) as never);
    for (const table of S.tables) for (const row of table.rows) await driver.create(table.object, { ...row });
    engine = new ObjectQL({ logger: quiet });
    engine.registerDriver(driver as never, true);
    await engine.init();
    for (const table of S.tables) engine.registerObject({ name: table.object, label: table.object, fields: fieldsOf(table) } as never);
  });

  afterAll(async () => {
    await driver?.disconnect?.();
  });

  describe('the native compiler against the step-1 conformance cases', () => {
    for (const c of S.cases) {
      const shape = shapeOf(c.where());
      if (shape === 'composed') {
        // A composed ReadableIds scope is the engine's own artifact (it composes
        // at its executor boundary); a read scope reaches this compiler
        // uncomposed, and `canHandle` declines it (ADR-0139 D6). Handed one
        // anyway, the compiler runs no composition and refuses, 500, rather
        // than answer rows.
        it(`refuses, runs no composition: ${c.name}`, () => {
          const err = thrownBy(() => compileScopedFilterToSql(c.where(), c.object, { object: c.object, dialect: 'sqlite' }));
          expect(err?.status).toBe(500);
        });
        continue;
      }
      it(`${shape === 'write-form' ? 'refuses' : 'matches'}: ${c.name}`, async () => {
        const compile = () => compileScopedFilterToSql(c.where(), c.object, { object: c.object, dialect: 'sqlite' });
        if (shape === 'write-form') {
          // A read-only evaluator: the write form is a predicate update's alone (③ ruled A).
          expect(envelopeOf(thrownBy(compile))).toEqual(REFUSED);
          return;
        }
        const { sql, params } = compile();
        // The outer statement's tenant wall is the caller's, untouched; the
        // subquery carries none (① ruled A).
        const wall = c.options ? ` AND "${c.object}"."${S.tenantField}" = ?` : '';
        const rows = await runRawSql(
          `SELECT "id" FROM "${c.object}" WHERE (${sql})${wall} ORDER BY "id"`,
          c.options ? [...params, c.options.tenantId] : params,
        );
        expect(rows.map((r) => String(r.id))).toEqual([...c.expected]);
        if (c.holdsLeaf) expect(sql).toContain('IN (SELECT "record_id" FROM "sys_record_share" WHERE');
      });
    }
  });

  it('binds every value and splices none: the recipient never reaches the statement text', () => {
    const { sql, params } = compileScopedFilterToSql({ id: { $in: SharedRecordIds.read('srid_doc', "u1' OR 1=1 --") } } as FilterCondition, 't', { object: 'srid_doc' });
    expect(sql).toBe(
      '"t"."id" IN (SELECT "record_id" FROM "sys_record_share" WHERE "object_name" = ? AND "recipient_type" = ? ' +
        'AND "recipient_id" = ? AND "record_id" IS NOT NULL AND "record_id" <> \'\')',
    );
    expect(params).toEqual(['srid_doc', 'user', "u1' OR 1=1 --"]);
  });

  describe('a leaf the compiler does not compile is refused in D4\'s envelope, logged once', () => {
    const leaf = () => SharedRecordIds.read('srid_doc', 'u1');
    const MISPLACED: Array<[string, () => unknown]> = [
      ['under $nin', () => ({ id: { $nin: leaf() } })],
      ['as a list member', () => ({ id: { $in: [leaf()] } })],
      ['as a bare field value', () => ({ id: leaf() })],
      ['as a $not operand', () => ({ $not: leaf() })],
      ['on another field', () => ({ owner: { $in: leaf() } })],
      ['in another object\'s scope', () => ({ id: { $in: SharedRecordIds.read('srid_note', 'u1') } })],
    ];
    for (const [where, scope] of MISPLACED) {
      it(`${where}: compiler and engine-bound merge alike`, () => {
        const lines: string[] = [];
        const sink = { log: { warn() {}, error: (m: string) => void lines.push(m) }, state: { logged: false } };
        for (let i = 0; i < 2; i++) {
          const compiled = thrownBy(() => compileScopedFilterToSql(scope() as FilterCondition, 'srid_doc', { object: 'srid_doc', fixedReadLeafRefusal: sink }));
          expect(envelopeOf(compiled)).toEqual(REFUSED);
          expect(compiled?.message).toContain('[service-analytics]');
          expect(compiled?.message).not.toContain('u1');
          const merged = thrownBy(() => assertReadScopeComparandsRunnable(scope(), 'srid_doc', {
            admitReadableIds: true, admitFixedReadLeaves: READ_SCOPE_FIXED_READ_LEAF_BRANDS, fixedReadLeafRefusal: sink, object: 'srid_doc',
          }));
          expect(envelopeOf(merged)).toEqual(REFUSED);
        }
        expect(lines).toHaveLength(1);
      });
    }

    it('the merge admits a placed read-form leaf; without the brand named, the merge refuses it as before', () => {
      const scope = { $or: [{ owner: 'u1' }, { id: { $in: leaf() } }] };
      expect(thrownBy(() => assertReadScopeComparandsRunnable(scope, 'srid_doc', {
        admitReadableIds: true, admitFixedReadLeaves: READ_SCOPE_FIXED_READ_LEAF_BRANDS, object: 'srid_doc',
      }))).toBeNull();
      expect(envelopeOf(thrownBy(() => assertReadScopeComparandsRunnable(scope, 'srid_doc', { admitReadableIds: true }))))
        .toEqual({ code: 'READ_SCOPE_COMPILE_FAILED', status: 500 });
    });
  });

  describe('the strategies: the native statement, its declines, and the engine path agree', () => {
    const CUBE: Cube = {
      name: 'docs',
      sql: 'srid_doc',
      measures: { n: { sql: '*', type: 'count', title: 'n' } },
      dimensions: { id: { label: 'id', type: 'string', sql: 'id' } },
      public: true,
    } as unknown as Cube;
    const QUERY = { cube: 'docs', dimensions: ['id'], measures: ['n'] } as AnalyticsQuery;
    const CONTEXT = { userId: 'u1' } as never;
    const READ_SCOPE = S.cases.find((c) => c.name.startsWith("the read scope's shape"))!;

    const executeAggregate = async (objectName: string, options: any) =>
      (await engine.aggregate(objectName, {
        where: options.filter,
        groupBy: options.groupBy,
        aggregations: options.aggregations?.map((a: any) => ({ function: a.method, field: a.field, alias: a.alias })),
        context: options.context,
      } as never)) as Record<string, unknown>[];

    const service = (opts: { native: boolean; classOf?: 'seam' | 'absent' }) => {
      const rawSql = vi.fn(runRawSql);
      const svc = new AnalyticsService({
        cubes: [CUBE],
        logger: quiet,
        queryCapabilities: () => ({ nativeSql: opts.native, objectqlAggregate: true, inMemory: false }),
        getReadScope: () => (readScope ?? undefined) as FilterCondition | undefined,
        executeAggregate,
        ...(opts.native
          ? {
              executeRawSql: (_object: string, sql: string, params: unknown[]) => rawSql(sql, params),
              hasObjectMiddleware: () => false,
              sqlDialect: () => 'sqlite' as const,
            }
          : {}),
        // The seam's recognition, as a host that holds the engine wires it.
        ...(opts.classOf === 'seam' ? { fixedReadLeafClassOf: (leaf: any) => fixedReadLeafClassOfEngine(engine, leaf) ?? null } : {}),
        judgeFilter: (o: string, w: any, j: any) => engine.judgeFilter(o, w, j),
      });
      return { svc, rawSql };
    };
    const idsOf = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id)).sort();

    it('neither class applies: the native face compiles the subquery and answers the engine path\'s rows', async () => {
      readScope = READ_SCOPE.where();
      const native = service({ native: true, classOf: 'seam' });
      const nativeRows = idsOf((await native.svc.query(QUERY, CONTEXT)).rows);
      expect(native.rawSql).toHaveBeenCalledTimes(1);
      expect(native.rawSql.mock.calls[0]![0]).toContain('IN (SELECT "record_id" FROM "sys_record_share"');
      readScope = READ_SCOPE.where();
      const engineRows = idsOf((await service({ native: false }).svc.query(QUERY, CONTEXT)).rows);
      expect(nativeRows).toEqual([...READ_SCOPE.expected]);
      expect(engineRows).toEqual(nativeRows);
    });

    it('a host that cannot ask the seam declines to the engine path, with the same rows', async () => {
      readScope = READ_SCOPE.where();
      const native = service({ native: true, classOf: 'absent' });
      expect(idsOf((await native.svc.query(QUERY, CONTEXT)).rows)).toEqual([...READ_SCOPE.expected]);
      expect(native.rawSql).not.toHaveBeenCalled();
    });

    it('a find hook registered for sys_record_share by name: the native face declines, and the engine\'s seam refuses (D4)', async () => {
      const hookEngine = engine;
      hookEngine.registerHook('beforeFind', () => {}, { object: 'sys_record_share' });
      try {
        readScope = READ_SCOPE.where();
        const native = service({ native: true, classOf: 'seam' });
        const err = await native.svc.query(QUERY, CONTEXT).then(() => null, (e: any) => e);
        expect(native.rawSql).not.toHaveBeenCalled();
        expect({ code: err?.code, status: err?.status }).toEqual(REFUSED);
      } finally {
        (hookEngine as any).hooks.get('beforeFind').pop();
      }
    });

    it('a leaf in the caller\'s where, any spelling, is refused before either strategy runs (compile surface 2)', async () => {
      // The read scope is the only door a leaf enters analytics by. Before plan
      // step 5 the where face answered 400 printing the recipient for `$in`, and
      // read a bare value or an array-form `=` as a relation condition on `id`.
      const secret = SharedRecordIds.read('srid_doc', 'u-secret-42');
      const wheres = [
        { id: { $in: secret } },
        { id: secret },
        { $or: [{ owner: 'u1' }, { id: { $eq: secret } }] },
        [['id', 'in', secret]],
        [['id', '=', secret]],
      ];
      for (const native of [true, false]) {
        for (const where of wheres) {
          readScope = null;
          const { svc, rawSql } = service({ native, classOf: 'seam' });
          const err = await svc.query({ ...QUERY, where } as AnalyticsQuery, CONTEXT).then(() => null, (e: any) => e);
          expect({ code: err?.code, status: err?.status }, JSON.stringify({ native, where })).toEqual(REFUSED);
          expect(err?.message).toContain('holds a SharedRecordIds leaf, a fixed read of \'sys_record_share\'');
          expect(err?.message).not.toContain('u-secret-42');
          expect(rawSql).not.toHaveBeenCalled();
        }
      }
    });

    it('the /analytics/sql echo prints the subquery the statement runs', async () => {
      readScope = READ_SCOPE.where();
      const { sql, params } = await service({ native: false }).svc.generateSql(QUERY, CONTEXT);
      expect(sql).toContain('"srid_doc"."id" IN (SELECT "record_id" FROM "sys_record_share" WHERE "object_name" = $');
      expect(params).toEqual(expect.arrayContaining(['srid_doc', 'user', 'u1']));
    });
  });
});
