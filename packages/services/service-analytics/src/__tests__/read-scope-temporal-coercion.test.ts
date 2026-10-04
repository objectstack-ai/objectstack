// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21505, ADR-0053 D-A1 / D-A2] The read scope binds a temporal comparand in
 * the column's storage form, through the driver's own coercion pair.
 *
 * `compileScopedFilterToSql` takes `coerceTemporalFilterValue` and
 * `coerceTemporalFilterColumn`, the engine door's pair
 * (`IDataDriver.temporalFilterValue` / `temporalFilterColumnSql`) bound to the
 * object, and applies them after the shared lowering to every value
 * comparison. Both of its consumers pass the context's pair. Absent members are
 * identity. The draft preview, which has no driver, puts both sides of each
 * value comparison in the same storage form with `@objectstack/core`'s
 * `temporalStorageForm`, by the column's declared type.
 *
 * Measured at `d2f452b88`, before this change, with the comparand bound as
 * written: the read scope differed from `engine.find` on 7 of the 12
 * `datetime` cells below on SQLite and 9 of 12 on PostgreSQL 16 under a
 * non-UTC server, and on 0 of the 4 `date` cells. The native face, which runs
 * the read scope, differed on the same cells end to end; the ObjectQL face
 * (the engine) on none. The preview differed on 7 of the 12 `datetime` cells
 * and on 0 of the 4 `date` cells.
 *
 * The PostgreSQL cells run where `OS_TEST_POSTGRES_URL` is set, and are a
 * named skip otherwise. Each asserts its server is not on UTC, because a UTC
 * server reads a bare day as UTC midnight and would pass with no coercion at
 * all. Each owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { lowerFilterCondition, type Cube, type FilterCondition } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { compileScopedFilterToSql, type ReadScopeCompileOptions } from '../read-scope-sql.js';

// ── Where the pair applies: after the lowering, on the value comparisons ─────

const DECLARED: Record<string, string> = { signed_at: 'datetime', due_on: 'date', note: 'text' };
const declaredValueShape = (field: string) => (DECLARED[field] ? { type: DECLARED[field], multiple: false } : undefined);

describe('[#21505] the compiler applies the coercion pair after the lowering, to every value comparison', () => {
  const seen: Array<[string, unknown]> = [];
  const RECORDING: ReadScopeCompileOptions = {
    declaredValueShape,
    dialect: 'sqlite',
    coerceTemporalFilterValue: (field, value) => { seen.push([field, value]); return `C(${String(value)})`; },
    coerceTemporalFilterColumn: (_field, columnSql) => `COL(${columnSql})`,
  };
  const compile = (scope: FilterCondition, opts: ReadScopeCompileOptions = RECORDING) => compileScopedFilterToSql(scope, 't', opts);

  it('the comparand the hook receives is the lowered one (ADR-0053 D-E3: widen first, convert second)', () => {
    seen.length = 0;
    expect(compile({ signed_at: { $lte: '2026-07-28' } })).toEqual({ sql: 'COL("t"."signed_at") < ?', params: ['C(2026-07-29)'] });
    expect(seen).toEqual([['signed_at', '2026-07-29']]);
    expect(compile({ signed_at: { $between: ['2026-07-28', '2026-07-28'] } })).toEqual({
      sql: '(COL("t"."signed_at") >= ? AND COL("t"."signed_at") < ?)',
      params: ['C(2026-07-28)', 'C(2026-07-29)'],
    });
  });

  it('every value comparison takes both halves', () => {
    const cells: Array<[FilterCondition, string, unknown[]]> = [
      [{ due_on: '2026-07-28' }, 'COL("t"."due_on") = ?', ['C(2026-07-28)']],
      [{ due_on: { $eq: '2026-07-28' } }, 'COL("t"."due_on") = ?', ['C(2026-07-28)']],
      [{ due_on: { $ne: '2026-07-28' } }, '(("t"."due_on" IS NULL OR COL("t"."due_on") <> ?))', ['C(2026-07-28)']],
      [
        { due_on: { $gt: 'a', $gte: 'b', $lt: 'c', $lte: 'd' } },
        '(COL("t"."due_on") > ? AND COL("t"."due_on") >= ? AND COL("t"."due_on") < ? AND COL("t"."due_on") <= ?)',
        ['C(a)', 'C(b)', 'C(c)', 'C(d)'],
      ],
      [{ due_on: { $in: ['a', 'b'] } }, 'COL("t"."due_on") IN (?, ?)', ['C(a)', 'C(b)']],
      [{ due_on: { $nin: ['a'] } }, '(("t"."due_on" IS NULL OR COL("t"."due_on") NOT IN (?)))', ['C(a)']],
      [{ due_on: { $between: ['a', 'b'] } }, 'COL("t"."due_on") BETWEEN ? AND ?', ['C(a)', 'C(b)']],
    ];
    for (const [scope, sql, params] of cells) expect(compile(scope), JSON.stringify(scope)).toEqual({ sql, params });
  });

  it('a null test, `$empty` and a text arm read the column as stored and bind no coerced value', () => {
    seen.length = 0;
    expect(compile({ due_on: null })).toEqual({ sql: '"t"."due_on" IS NULL', params: [] });
    expect(compile({ note: { $null: true } })).toEqual({ sql: '"t"."note" IS NULL', params: [] });
    expect(compile({ note: { $empty: true } })).toEqual({ sql: '("t"."note" IS NULL OR "t"."note" = ?)', params: [''] });
    expect(compile({ note: { $contains: 'x' } }).sql).not.toContain('COL(');
    expect(seen).toEqual([]);
  });

  it('absent members are identity: the same SQL and binds as identity members', () => {
    const identity: ReadScopeCompileOptions = {
      declaredValueShape,
      dialect: 'sqlite',
      coerceTemporalFilterValue: (_f, v) => v,
      coerceTemporalFilterColumn: (_f, c) => c,
    };
    const scopes: FilterCondition[] = [
      { signed_at: { $lte: '2026-07-28' } },
      { signed_at: { $ne: '2026-07-28' }, due_on: { $in: ['2026-07-28'] } },
      { $or: [{ note: 'n' }, { $not: { signed_at: { $between: ['2026-07-28', '9999-12-31'] } } }] },
    ];
    for (const scope of scopes) {
      expect(compile(scope, { declaredValueShape, dialect: 'sqlite' }), JSON.stringify(scope)).toEqual(compile(scope, identity));
    }
  });
});

// ── The engine's rows, on a real engine, on SQLite and on PostgreSQL ──────────

const OBJECT = 'os21505_coercion';
const LEDGER = {
  name: OBJECT,
  label: 'Coercion',
  fields: {
    signed_at: { name: 'signed_at', type: 'datetime' as const },
    due_on: { name: 'due_on', type: 'date' as const },
    note: { name: 'note', type: 'text' as const },
  },
};
const ROWS = [
  { id: 'r1', signed_at: '2026-07-27T10:00:00.000Z', due_on: '2026-07-27', note: '2026-07-27' },
  { id: 'r2', signed_at: '2026-07-28T00:00:00.000Z', due_on: '2026-07-28', note: '2026-07-28' },
  { id: 'r3', signed_at: '2026-07-28T10:00:00.000Z', due_on: '2026-07-28', note: '2026-07-28 late' },
  { id: 'r4', signed_at: '2026-07-29T10:00:00.000Z', due_on: '2026-07-29', note: 'n' },
  { id: 'r5', signed_at: null, due_on: null, note: null },
];
/** The same instants and days as {@link ROWS}, drafted in other spellings an author can write. */
const RESPELLED = [
  { id: 'r1', signed_at: new Date(Date.UTC(2026, 6, 27, 10)), due_on: '2026-07-27T23:00:00Z', note: '2026-07-27' },
  { id: 'r2', signed_at: '2026-07-28T00:00:00Z', due_on: '2026-07-28T00:00:00.000Z', note: '2026-07-28' },
  { id: 'r3', signed_at: '2026-07-28 10:00:00', due_on: '2026-07-28', note: '2026-07-28 late' },
  { id: 'r4', signed_at: '2026-07-29T18:00:00+08:00', due_on: '2026-07-29', note: 'n' },
  { id: 'r5', signed_at: null, due_on: null, note: null },
];
const CUBE = {
  name: 'os21505_cube',
  title: 'Coercion',
  sql: OBJECT,
  public: true,
  measures: { n: { type: 'count', sql: '*', label: 'n' } },
  dimensions: { id: { type: 'string', sql: 'id', label: 'Id' } },
} as unknown as Cube;

/** Each cell: a label, the scope, and the rows `engine.find` answers for it. */
const CELLS: ReadonlyArray<readonly [label: string, scope: FilterCondition, engine: string]> = [
  ['datetime $between one day', { signed_at: { $between: ['2026-07-28', '2026-07-28'] } }, 'r2,r3'],
  ['datetime $between to the last day', { signed_at: { $between: ['2026-07-28', '9999-12-31'] } }, 'r2,r3,r4'],
  ['datetime $ne a day', { signed_at: { $ne: '2026-07-28' } }, 'r1,r3,r4,r5'],
  ['datetime equality on a day', { signed_at: '2026-07-28' }, 'r2'],
  ['datetime $gte a day', { signed_at: { $gte: '2026-07-28' } }, 'r2,r3,r4'],
  ['datetime $lte a day', { signed_at: { $lte: '2026-07-28' } }, 'r1,r2,r3'],
  ['datetime $gt a day', { signed_at: { $gt: '2026-07-28' } }, 'r3,r4'],
  ['datetime $lt a day', { signed_at: { $lt: '2026-07-28' } }, 'r1'],
  ['datetime $in [a day]', { signed_at: { $in: ['2026-07-28'] } }, 'r2'],
  ['datetime $nin [a day]', { signed_at: { $nin: ['2026-07-28'] } }, 'r1,r3,r4,r5'],
  ['datetime $gte a zone-naive time', { signed_at: { $gte: '2026-07-28 05:00' } }, 'r3,r4'],
  ['datetime $ne under $not under $or', { $or: [{ note: 'n' }, { $not: { signed_at: { $ne: '2026-07-28' } } }] }, 'r2,r4'],
  ['date $between one day (control)', { due_on: { $between: ['2026-07-28', '2026-07-28'] } }, 'r2,r3'],
  ['date $ne a day (control)', { due_on: { $ne: '2026-07-28' } }, 'r1,r4,r5'],
  ['date $lte a day (control)', { due_on: { $lte: '2026-07-28' } }, 'r1,r2,r3'],
  ['date equality on a day (control)', { due_on: '2026-07-28' }, 'r2,r3'],
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
/** The ids of a result, sorted: a row array, or a raw `pg` result's `rows`. */
const ids = (res: unknown): string =>
  ((Array.isArray(res) ? res : (res as { rows: unknown[] }).rows) as Array<Record<string, unknown>>)
    .map((r) => String(r.id)).sort().join(',');

interface DbCell { id: 'sqlite' | 'pg'; dialect: string; config: () => Record<string, unknown> | null }
const DB_CELLS: readonly DbCell[] = [
  { id: 'sqlite', dialect: 'sqlite', config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    dialect: 'postgres',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

for (const cell of DB_CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21505] the read scope admits the engine's rows (${cell.id})${config ? '' : ' (skipped: set OS_TEST_POSTGRES_URL to run this cell)'}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;
      let faces: { native: AnalyticsService; objectql: AnalyticsService };
      let scope: FilterCondition | null = null;
      let rawStatements = 0;
      const drop = async () => {
        if (cell.id === 'pg') await (driver as any)?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as never);
        await drop();
        engine = new ObjectQL({ logger: quiet } as never);
        engine.registerDriver(driver as never, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as never);
        await engine.syncSchemas();
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as never);
        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: string, opts?: { object?: string }) => {
          if (opts?.object === OBJECT) rawStatements += 1;
          return realExecute(sql, opts);
        };
        // The plugin's own composition, with a host read scope: the native
        // face, and the same narrowed to the engine aggregate (whose echo is
        // the `/analytics/sql` statement).
        const composed: Record<string, AnalyticsService> = {};
        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: [CUBE], getReadScope: () => scope, ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          composed[face] = registered.analytics as AnalyticsService;
        }
        faces = composed as typeof faces;
      });
      afterAll(async () => {
        await drop();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it.skipIf(cell.id !== 'pg')('the server is not on UTC (the premise of the PostgreSQL cells)', async () => {
        const res = await (driver as any).execute('show timezone');
        const zone = String(Object.values((res as { rows: Array<Record<string, unknown>> }).rows[0])[0]);
        expect(['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT', 'UCT', 'Zulu']).not.toContain(zone);
      });

      it('compiled with the driver\'s pair, every cell admits the engine\'s rows, and the date control too', async () => {
        const options: ReadScopeCompileOptions = {
          declaredValueShape,
          dialect: cell.dialect,
          coerceTemporalFilterValue: (field, value) => driver.temporalFilterValue(OBJECT, field, value),
          coerceTemporalFilterColumn: (field, columnSql) => driver.temporalFilterColumnSql(OBJECT, field, columnSql),
        };
        for (const [label, where, expected] of CELLS) {
          expect(ids(await engine.find(OBJECT, { where, fields: ['id'] } as never)), `${label}: engine.find`).toBe(expected);
          const { sql, params } = compileScopedFilterToSql(where, OBJECT, options);
          const rows = await (engine as any).execute(`select "id" from "${OBJECT}" where ${sql}`, { args: params, object: OBJECT });
          expect(ids(rows), `${label}: the read scope`).toBe(expected);
        }
      });

      it('end to end, the native face scoped by a host getReadScope answers the engine\'s rows', async () => {
        for (const [label, where, expected] of CELLS) {
          scope = where;
          const before = rawStatements;
          const res = await faces.native.query({ cube: CUBE.name, measures: ['n'], dimensions: ['id'] } as never);
          expect(ids(res.rows), `${label}: the native face`).toBe(expected);
          expect(rawStatements - before, `${label}: the native strategy answered`).toBeGreaterThanOrEqual(1);
        }
        scope = null;
      });

      it('the ObjectQL echo prints the comparand the executed statement binds', async () => {
        scope = { signed_at: { $ne: '2026-07-28' } };
        const echo = await faces.objectql.generateSql({ cube: CUBE.name, measures: ['n'], dimensions: ['id'] } as never);
        scope = null;
        expect(echo.params).toContain(driver.temporalFilterValue(OBJECT, 'signed_at', '2026-07-28'));
        expect(echo.params).not.toContain('2026-07-28');
      });

      it('the draft preview (queryDataset previewDrafts) answers the engine\'s rows over drafted rows in either spelling', async () => {
        // Window ends written shorter than the stored instant, beside the cells.
        const windows: Array<[string, [string, string]]> = [
          ['datetime window to a zone-naive minute', ['2026-07-28', '2026-07-28T10:00']],
          ['datetime window to a zone-naive second', ['2026-07-28', '2026-07-28T10:00:00']],
        ];
        for (const [label, [start, end]] of windows) {
          expect(ids(await engine.find(OBJECT, { where: { signed_at: { $gte: start, $lte: end } }, fields: ['id'] } as never)), `${label}: engine.find`).toBe('r2,r3');
        }
        const dataset = DatasetSchema.parse({
          name: 'os21505_preview',
          label: 'Coercion preview',
          object: OBJECT,
          dimensions: [{ name: 'id', field: 'id', type: 'string' }, { name: 'signed_at', field: 'signed_at', type: 'date' }],
          measures: [{ name: 'row_count', aggregate: 'count' }],
        });
        for (const [spelling, drafted] of [['canonical', ROWS], ['respelled', RESPELLED]] as const) {
          // The live path is not wired, so an answer can only come from the preview.
          const svc = new AnalyticsService({
            sourceFieldMeta: (object: string, field: string) => (object === OBJECT && DECLARED[field] ? { type: DECLARED[field] } : undefined),
            queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
            executeAggregate: async () => { throw new Error('the live path ran: the preview did not answer'); },
            draftRowsResolver: async (object: string) => (object === OBJECT ? drafted.map((r) => ({ ...r })) : null),
          } as never);
          const preview = async (selection: Record<string, unknown>) =>
            ids((await svc.queryDataset(dataset as never, { dimensions: ['id'], measures: ['row_count'], ...selection } as never, { tenantId: 'org_A' } as never, { previewDrafts: true })).rows);
          for (const [label, where, expected] of CELLS) {
            expect(await preview({ runtimeFilter: where }), `${spelling} rows, ${label}: the preview`).toBe(expected);
          }
          for (const [label, dateRange] of windows) {
            expect(await preview({ timeDimensions: [{ dimension: 'signed_at', dateRange }] }), `${spelling} rows, ${label}: the preview`).toBe('r2,r3');
          }
        }
      });
    },
  );
}

// ── The column half: a SQLite datetime column the driver has not certified ────

/**
 * An external object (ADR-0015) is registered with no backfill, so its SQLite
 * `datetime` column is never certified canonical and may hold the forms written
 * before the canonical convention. The driver reads such a column through its
 * repair expression, and `temporalFilterColumnSql` hands that expression to a
 * raw-SQL caller. Coercing the comparand alone keeps half the defect (D-A2).
 */
describe('[#21505] the column half reads an uncertified SQLite datetime column as the driver does', () => {
  const LEGACY = 'os21505_legacy';
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    const knex = (driver as any).knex;
    await knex.schema.createTable(LEGACY, (t: any) => {
      t.string('id').primary();
      t.specificType('at', 'datetime');
    });
    await knex(LEGACY).insert([
      { id: 'l1', at: Date.UTC(2026, 6, 27, 10) },
      { id: 'l2', at: '2026-07-28T00:00:00.000Z' },
      { id: 'l3', at: '2026-07-28 10:00:00' },
      { id: 'l4', at: '2026-07-29T18:00:00+08:00' },
      { id: 'l5', at: null },
    ]);
    driver.registerExternalObject({ name: LEGACY, fields: { at: { name: 'at', type: 'datetime' } } });
  });
  afterAll(async () => {
    try { await driver?.disconnect(); } catch { /* noop */ }
  });

  it('the fixture is the uncertified state: the driver wraps this column', () => {
    expect(driver.temporalFilterColumnSql(LEGACY, 'at', '"c"')).not.toBe('"c"');
  });

  it('with the pair, the read scope admits the driver\'s own rows', async () => {
    const options: ReadScopeCompileOptions = {
      declaredValueShape: (field) => (field === 'at' ? { type: 'datetime', multiple: false } : undefined),
      dialect: 'sqlite',
      coerceTemporalFilterValue: (field, value) => driver.temporalFilterValue(LEGACY, field, value),
      coerceTemporalFilterColumn: (field, columnSql) => driver.temporalFilterColumnSql(LEGACY, field, columnSql),
    };
    const cells: Array<[FilterCondition, string]> = [
      [{ at: { $gte: '2026-07-28' } }, 'l2,l3,l4'],
      [{ at: { $lt: '2026-07-28' } }, 'l1'],
      [{ at: { $ne: '2026-07-28' } }, 'l1,l3,l4,l5'],
      [{ at: { $in: ['2026-07-28 10:00'] } }, 'l3'],
    ];
    for (const [where, expected] of cells) {
      const lowered = lowerFilterCondition(where, { isDatetimeColumn: (field) => field === 'at' });
      expect(ids(await driver.find(LEGACY, { where: lowered, fields: ['id'] } as never)), `${JSON.stringify(where)}: the driver`).toBe(expected);
      const { sql, params } = compileScopedFilterToSql(where, LEGACY, options);
      const rows = await (driver as any).knex.raw(`select "id" from "${LEGACY}" where ${sql}`, params);
      expect(ids(rows), `${JSON.stringify(where)}: the read scope`).toBe(expected);
    }
  });
});
