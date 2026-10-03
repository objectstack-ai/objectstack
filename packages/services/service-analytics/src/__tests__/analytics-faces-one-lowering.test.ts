// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0053 D-D1, amended — #5930 step 4] The analytics read scope (F9) and the
 * analytics `where` tree with its compilers (F10) keep no copy of the filter
 * meaning the shared lowering carries: the whole-day upper bound, the
 * `$between` split and the NULL-polarity guards. The lowering
 * (`lowerFilterCondition`, `@objectstack/spec/data`) is their one source, run at
 * each face's seam with that face's typed column reader:
 *
 * - **F10, the native strategy** — `declaredDatetimeLowering(ctx, …,
 *   'type-blind')`, the context's `declaredFieldType` hook, which the plugin
 *   answers from the engine's registry (`sourceFieldMeta`). A column the hook
 *   names no type for is read type-blind (item 7): this face is the last seam
 *   before its statement runs. The `dateRange` window is the `{ $gte, $lte }`
 *   pair, lowered by the same reader (item 8).
 * - **F10, the ObjectQL strategy** (the engine hand-off and the
 *   `/analytics/sql` echo) — the same hook; a column it names no type for is
 *   left as written, for the engine's `where` seam, which reads the object's own
 *   field map.
 * - **F9, the read scope** — `ReadScopeCompileOptions.declaredValueShape`,
 *   which both of its consumers fill from the context's `declaredValueShape`
 *   hook (the same `sourceFieldMeta`).
 * - **F11, the draft preview** — the drafted object's declared types, which
 *   `queryDataset`'s preview branch hands `evaluateAnalyticsQueryOverRows` from
 *   `sourceFieldMeta` (`declaredPreviewLowering`): a declared `datetime` is
 *   rewritten, any other declared column is compared as written, and a column
 *   with no declared type reads type-blind. The `dateRange` window is the same
 *   pair, through the same lowering.
 *
 * ## Measured on the base (`0b8239111`), through the plugin's own composition
 *
 * Rows `r1`..`r5` (below). Before this card, the native face widened a bare day
 * on EVERY column — its `lte` arm and its window arm read any `YYYY-MM-DD`
 * comparand as a calendar day — so on a `text` column it answered differently
 * from the engine, on SQLite and on PostgreSQL 16 alike:
 *
 * | `where` on the text column `note` | native, before | engine and native, now |
 * |:--|:--|:--|
 * | `$lte '2026-07-28'` | r1, r2, r3 | r1, r2 |
 * | `$lte '9999-12-31'` | r1, r2, r3, r4 | r1, r2, r3 |
 * | `$between ['2026-07-28', '2026-07-28']` | r2, r3 | r2 |
 * | `$not: { $lte '2026-07-28' }` | r4, r5 | r3, r4, r5 |
 * | `dateRange ['2026-07-28', '2026-07-28']` | r2, r3 | r2 |
 *
 * Every `datetime` and `date` cell answered the engine's rows before and
 * answers them now, on both faces and both databases; so does every cell on a
 * host with no typed reader (below), and every cell of the read scope.
 *
 * The draft preview (F11) answered the same text cells the native face did,
 * through its own type-blind `lteBound`, except the last supported day, where
 * it read a value that denotes no instant as written. With the drafted
 * object's declared types it now answers every cell the engine does.
 *
 * The PostgreSQL cell runs where `OS_TEST_POSTGRES_URL` is set and is a named
 * skip otherwise. It owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { lowerFilterCondition, TEMPORAL_CASES, TEMPORAL_NOW, TEMPORAL_ROWS, type Cube, type FilterCondition } from '@objectstack/spec/data';
import type { AnalyticsQuery, StrategyContext } from '@objectstack/spec/contracts';
import { resolveFilterTokens } from '@objectstack/core';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { NO_DATETIME_COLUMNS, normalizeAnalyticsFilterTree, type NormalizedFilterNode } from '../strategies/filter-normalizer.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '..');

// ── The enumeration ──────────────────────────────────────────────────────────

/** Every non-test source file of this package, path relative to `src/`. */
function sourceFiles(dir = SRC): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== '__tests__') out.push(...sourceFiles(path));
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(relative(SRC, path));
    }
  }
  return out.sort();
}

/**
 * Does `source` USE `name` as code: import it, declare it, or call it? A prose
 * mention of a helper (a docblock's `{@link name}` or a backticked name) is
 * not a copy of it, and no such mention is an import list, a declaration or a
 * call, so no comment stripping is needed to tell them apart.
 */
function uses(source: string, name: string): boolean {
  const imported = new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`);
  const declared = new RegExp(`\\b(function|const|let|var)\\s+${name}\\b`);
  const called = new RegExp(`\\b${name}\\s*\\(`);
  return imported.test(source) || declared.test(source) || called.test(source);
}

/** Which of `names` each file uses, keyed by file; files using none are left out. */
function holders(names: readonly string[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const file of sourceFiles()) {
    const source = readFileSync(join(SRC, file), 'utf8');
    const held = names.filter((name) => uses(source, name));
    if (held.length > 0) out[file] = held;
  }
  return out;
}

/**
 * The whole-day rule's own spellings: the calendar-day primitives a face calls
 * to widen a bound itself, and the preview's helper built on them.
 */
const WHOLE_DAY_HELPERS = ['nextUtcCalendarDay', 'isUnboundedAbove', 'UNBOUNDED_ABOVE', 'lteBound'] as const;

/** The NULL-polarity copies' spellings, as the faces named them. */
const NULL_POLARITY_HELPERS = [
  'nullSafeNegationOperand',
  'nullValueSatisfiesOperator',
  'operatorIsNullTotal',
  'nullGuardForFieldSpec',
  'guardFieldEntry',
  'nullSafeNegative',
] as const;

describe('[#5930 step 4] the enumeration: no analytics face keeps the meaning the shared lowering carries', () => {
  it('the scan reads the faces it judges (positive control)', () => {
    const files = sourceFiles();
    expect(files).toContain('read-scope-sql.ts');
    expect(files).toContain(join('strategies', 'filter-normalizer.ts'));
    expect(files).toContain(join('strategies', 'native-sql-strategy.ts'));
    expect(files).toContain(join('strategies', 'objectql-strategy.ts'));
    // The seams that run the lowering are where the scan finds it.
    expect(Object.keys(holders(['lowerFilterCondition'])).sort()).toEqual([
      'preview-evaluator.ts',
      'read-scope-sql.ts',
      join('strategies', 'filter-normalizer.ts'),
    ]);
  });

  it('no face keeps a whole-day helper of its own', () => {
    expect(holders(WHOLE_DAY_HELPERS)).toEqual({});
  });

  it('no face keeps a NULL-polarity copy', () => {
    expect(holders(NULL_POLARITY_HELPERS)).toEqual({});
  });
});

// ── One source: each compiler compiles the bound it is handed ────────────────

const OBJECT = 'os21417_whole_day';
const LEDGER = {
  name: OBJECT,
  label: 'Whole day',
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
const CUBE: Cube = {
  name: 'os21417_cube',
  title: 'Whole day',
  sql: OBJECT,
  public: true,
  measures: { n: { type: 'count', sql: '*', label: 'n' } },
  dimensions: {
    id: { type: 'string', sql: 'id', label: 'Id' },
    signed_at: { type: 'time', sql: 'signed_at', label: 'Signed' },
    due_on: { type: 'time', sql: 'due_on', label: 'Due' },
    note: { type: 'string', sql: 'note', label: 'Note' },
  },
} as Cube;
const DECLARED: Record<string, string> = { signed_at: 'datetime', due_on: 'date', note: 'text' };

/** A strategy context with this cube and, unless `declared` is omitted, the declared-type hook. */
const strategyCtx = (declared?: (object: string, field: string) => string | undefined, extra: Record<string, unknown> = {}) => ({
  getCube: (name: string) => (name === CUBE.name ? CUBE : undefined),
  queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
  ...(declared ? { declaredFieldType: declared } : {}),
  ...extra,
}) as unknown as StrategyContext;
const TYPED = strategyCtx((_o, f) => DECLARED[f]);
const q = (rest: Partial<AnalyticsQuery>): AnalyticsQuery =>
  ({ cube: CUBE.name, measures: ['n'], dimensions: ['id'], ...rest }) as AnalyticsQuery;
/** The WHERE of a statement, the grouping cut off. */
const whereOf = (sql: string): string => sql.replace(/^[\s\S]*? WHERE /, '').replace(/ GROUP BY[\s\S]*$/, '');

describe('[#5930 step 4] one source: the native compiler and the echo compile the bound they are handed', () => {
  const native = async (ctx: StrategyContext, rest: Partial<AnalyticsQuery>) =>
    new NativeSQLStrategy().generateSql(q(rest), ctx);
  const echo = async (ctx: StrategyContext, rest: Partial<AnalyticsQuery>) =>
    new ObjectQLStrategy().generateSql(q(rest), ctx);

  it('a bare-day $lte: `<` the next day on the declared datetime, as written on every other declared column', async () => {
    for (const compile of [native, echo]) {
      const at = await compile(TYPED, { where: { signed_at: { $lte: '2026-07-28' } } });
      expect(whereOf(at.sql)).toBe('signed_at < $1');
      expect(at.params).toEqual(['2026-07-29']);
      for (const column of ['due_on', 'note']) {
        const other = await compile(TYPED, { where: { [column]: { $lte: '2026-07-28' } } });
        expect(whereOf(other.sql), column).toBe(`${column} <= $1`);
        expect(other.params, column).toEqual(['2026-07-28']);
      }
      // The last supported day: `IS NOT NULL` on the datetime only. The text
      // column's `$lte '9999-12-31'` is a comparison as written — the cell the
      // native face's own copy answered with every row that had a value.
      expect(whereOf((await compile(TYPED, { where: { signed_at: { $lte: '9999-12-31' } } })).sql)).toBe('signed_at IS NOT NULL');
      expect(whereOf((await compile(TYPED, { where: { note: { $lte: '9999-12-31' } } })).sql)).toBe('note <= $1');
    }
  });

  it('a $between: split and widened on the declared datetime, inclusive as written elsewhere', async () => {
    for (const compile of [native, echo]) {
      expect(whereOf((await compile(TYPED, { where: { signed_at: { $between: ['2026-07-28', '2026-07-28'] } } })).sql))
        .toBe('(signed_at >= $1 AND signed_at < $2)');
      expect(whereOf((await compile(TYPED, { where: { note: { $between: ['2026-07-28', '2026-07-28'] } } })).sql))
        .toBe('(note >= $1 AND note <= $2)');
    }
  });

  it('a dateRange window: the same pair, through the same reader (item 8)', async () => {
    const window = (dimension: string, end = '2026-07-28'): Partial<AnalyticsQuery> =>
      ({ timeDimensions: [{ dimension, dateRange: ['2026-07-28', end] as [string, string] }] });
    for (const compile of [native, echo]) {
      const at = await compile(TYPED, window('signed_at'));
      expect(whereOf(at.sql)).toBe('(signed_at >= $1 AND signed_at < $2)');
      expect(at.params).toEqual(['2026-07-28', '2026-07-29']);
      expect(whereOf((await compile(TYPED, window('signed_at', '9999-12-31'))).sql)).toBe('(signed_at >= $1 AND signed_at IS NOT NULL)');
      for (const column of ['due_on', 'note']) {
        const other = await compile(TYPED, window(column));
        expect(whereOf(other.sql), column).toBe(`(${column} >= $1 AND ${column} <= $2)`);
        expect(other.params, column).toEqual(['2026-07-28', '2026-07-28']);
      }
    }
  });

  /** The null predicates a tree holds, and the `$null` flags a condition holds. */
  const nullLeaves = (node: NormalizedFilterNode | null): number => {
    if (!node) return 0;
    if (node.kind === 'leaf') return node.operator === 'set' || node.operator === 'notSet' ? 1 : 0;
    if (node.kind === 'not') return nullLeaves(node.child);
    if (node.kind === 'and' || node.kind === 'or') return node.children.reduce((n, c) => n + nullLeaves(c), 0);
    return 0;
  };
  const nullFlags = (condition: unknown): number => (JSON.stringify(condition).match(/"\$null"/g) ?? []).length;
  /** Wheres whose every null predicate is a guard: no `$null`, `$exists` or null comparand of the author's. */
  const GUARDED: FilterCondition[] = [
    { $not: { note: '2026-07-28' } },
    { note: { $ne: 'n' } },
    { note: { $nin: ['n'] } },
    { note: { $notContains: 'late' } },
    { $not: { $or: [{ note: 'n' }, { due_on: { $ne: '2026-07-28' } }] } },
    { $not: { signed_at: { $gt: '2026-07-28' }, note: { $ne: 'n' } } },
    { $or: [{ note: { $ne: 'n' } }, { $not: { due_on: { $in: ['2026-07-28'] } } }] },
  ];

  it('F10: every null predicate in the tree is one the shared lowering wrote', () => {
    for (const where of GUARDED) {
      const lowered = lowerFilterCondition(where, NO_DATETIME_COLUMNS);
      expect(nullFlags(lowered), JSON.stringify(where)).toBeGreaterThan(0);
      expect(nullLeaves(normalizeAnalyticsFilterTree({ where }, NO_DATETIME_COLUMNS)), JSON.stringify(where)).toBe(nullFlags(lowered));
    }
  });

  it('F9: every null test in the read scope is one the shared lowering wrote', () => {
    for (const where of GUARDED) {
      const lowered = lowerFilterCondition(where, NO_DATETIME_COLUMNS);
      const { sql } = compileScopedFilterToSql(where, OBJECT);
      expect((sql.match(/ IS (NOT )?NULL/g) ?? []).length, JSON.stringify(where)).toBe(nullFlags(lowered));
    }
  });
});

// ── The typed drivers' answer, on every face, over a real engine ─────────────

type Ids = string;
/** Each cell: a label, the query, and the rows the engine's `find` answers for it. */
const CELLS: ReadonlyArray<readonly [label: string, query: Partial<AnalyticsQuery>, engine: Ids]> = [
  ['datetime $lte a day', { where: { signed_at: { $lte: '2026-07-28' } } }, 'r1,r2,r3'],
  ['datetime $lte the last day', { where: { signed_at: { $lte: '9999-12-31' } } }, 'r1,r2,r3,r4'],
  ['datetime $between one day', { where: { signed_at: { $between: ['2026-07-28', '2026-07-28'] } } }, 'r2,r3'],
  ['datetime $not $lte a day', { where: { $not: { signed_at: { $lte: '2026-07-28' } } } }, 'r4,r5'],
  ['datetime window one day', { timeDimensions: [{ dimension: 'signed_at', dateRange: ['2026-07-28', '2026-07-28'] }] }, 'r2,r3'],
  ['datetime window to the last day', { timeDimensions: [{ dimension: 'signed_at', dateRange: ['2026-07-28', '9999-12-31'] }] }, 'r2,r3,r4'],
  ['date $lte a day', { where: { due_on: { $lte: '2026-07-28' } } }, 'r1,r2,r3'],
  ['date $lte the last day', { where: { due_on: { $lte: '9999-12-31' } } }, 'r1,r2,r3,r4'],
  ['date $between one day', { where: { due_on: { $between: ['2026-07-28', '2026-07-28'] } } }, 'r2,r3'],
  ['date window one day', { timeDimensions: [{ dimension: 'due_on', dateRange: ['2026-07-28', '2026-07-28'] }] }, 'r2,r3'],
  ['text $lte a day', { where: { note: { $lte: '2026-07-28' } } }, 'r1,r2'],
  ['text $lte the last day', { where: { note: { $lte: '9999-12-31' } } }, 'r1,r2,r3'],
  ['text $between one day', { where: { note: { $between: ['2026-07-28', '2026-07-28'] } } }, 'r2'],
  ['text $between to the last day', { where: { note: { $between: ['2026-07-28', '9999-12-31'] } } }, 'r2,r3'],
  ['text $not $lte a day', { where: { $not: { note: { $lte: '2026-07-28' } } } }, 'r3,r4,r5'],
  ['text window one day', { timeDimensions: [{ dimension: 'note', dateRange: ['2026-07-28', '2026-07-28'] }] }, 'r2'],
  ['text window to the last day', { timeDimensions: [{ dimension: 'note', dateRange: ['2026-07-28', '9999-12-31'] }] }, 'r2,r3'],
  ['text $ne a value', { where: { note: { $ne: 'n' } } }, 'r1,r2,r3,r5'],
];

/** The engine's own `where` for a cell: a window is the `{ $gte, $lte }` pair. */
const engineWhere = (query: Partial<AnalyticsQuery>): Record<string, unknown> => {
  if (query.where) return query.where as Record<string, unknown>;
  const td = query.timeDimensions![0];
  const [start, end] = td.dateRange as string[];
  return { [td.dimension]: { $gte: start, $lte: end } };
};

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };
const ids = (rows: Array<Record<string, unknown>>): Ids => rows.map((r) => String(r.id)).sort().join(',');

interface DbCell { id: 'sqlite' | 'pg'; label: string; env: string | null; config: () => Record<string, unknown> | null }
const DB_CELLS: readonly DbCell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

/** The plugin's own composition over `engine`: the native face, and the same narrowed to the engine aggregate. */
async function composeFaces(engine: ObjectQL, cubes: Cube[]): Promise<{ native: AnalyticsService; objectql: AnalyticsService }> {
  const faces: Record<string, AnalyticsService> = {};
  for (const [face, caps] of [
    ['native', undefined],
    ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
  ] as const) {
    const registered: Record<string, unknown> = {};
    await new AnalyticsServicePlugin({ cubes, ...(caps ? { queryCapabilities: caps } : {}) } as never).init({
      getService: (name: string) => (name === 'data' ? engine : registered[name]),
      registerService: (name: string, svc: unknown) => { registered[name] = svc; },
      replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
      hook: () => {},
      logger: quiet,
    } as never);
    faces[face] = registered.analytics as AnalyticsService;
  }
  return faces as { native: AnalyticsService; objectql: AnalyticsService };
}

for (const cell of DB_CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#5930 step 4] a bare day answers the typed drivers' rows on every analytics face (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: SqlDriver;
      let engine: ObjectQL;
      let faces: { native: AnalyticsService; objectql: AnalyticsService };
      /** The raw statements the native face ran on the object, to prove which face answered. */
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
        faces = await composeFaces(engine, [CUBE]);
      });
      afterAll(async () => {
        await drop();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      const viaFace = async (face: 'native' | 'objectql', query: Partial<AnalyticsQuery>) => {
        const before = rawStatements;
        const res = await faces[face].query(q(query) as never);
        return { ids: ids(res.rows as Array<Record<string, unknown>>), raw: rawStatements - before };
      };

      for (const [label, query, expected] of CELLS) {
        it(`${label}: ${expected}`, async () => {
          expect(ids(await engine.find(OBJECT, { where: engineWhere(query), fields: ['id'] } as never)), 'engine.find').toBe(expected);
          const native = await viaFace('native', query);
          expect(native.ids, 'the native face').toBe(expected);
          expect(native.raw, 'the native strategy answered').toBeGreaterThanOrEqual(1);
          const objectql = await viaFace('objectql', query);
          expect(objectql.ids, 'the ObjectQL face').toBe(expected);
          expect(objectql.raw, 'the engine aggregate answered').toBe(0);
        });
      }

      // [#21505] F9 binds each comparand through the driver's coercion pair
      // (ADR-0053 D-A1 / D-A2), as both of its consumers wire it, so its
      // datetime cells hold on PostgreSQL too, where a bare-day text bound
      // would otherwise be read in the session's zone.
      it('the read scope (F9), typed by its declared value shape, answers the same rows', async () => {
        const declaredValueShape = (field: string) => (DECLARED[field] ? { type: DECLARED[field], multiple: false } : undefined);
        for (const [label, query, expected] of CELLS) {
          if (!query.where) continue;
          const { sql, params } = compileScopedFilterToSql(query.where as FilterCondition, OBJECT, {
            declaredValueShape,
            dialect: cell.id === 'pg' ? 'postgres' : 'sqlite',
            coerceTemporalFilterValue: (field, value) => driver.temporalFilterValue(OBJECT, field, value),
            coerceTemporalFilterColumn: (field, columnSql) => driver.temporalFilterColumnSql(OBJECT, field, columnSql),
          });
          const res = await (engine as any).execute(`select "id" from "${OBJECT}" where ${sql}`, { args: params, object: OBJECT });
          const rows = Array.isArray(res) ? res : (res as { rows: Array<Record<string, unknown>> }).rows;
          expect(ids(rows as Array<Record<string, unknown>>), label).toBe(expected);
        }
      });

      it.skipIf(cell.id !== 'sqlite')('a host with no typed reader keeps the type-blind reading on the native face (ADR-0053 D-D1 item 7)', async () => {
        // The native strategy over a context with no `declaredFieldType` hook,
        // and over one whose hook names no type (an `AnalyticsService` built
        // without `sourceFieldMeta`): every column is read type-blind. So the
        // datetime and date cells keep the engine's rows, and the text cells
        // keep the answer the deleted copy gave — the cells where "answer as
        // the typed drivers" cannot hold without a reader, because a reader is
        // what tells a text column from a datetime one.
        const raw = async (_object: string, sql: string, params: unknown[]) =>
          (engine as any).execute(sql.replace(/\$(\d+)/g, '?'), { args: params, object: OBJECT });
        const typeBlind: Record<string, Ids> = {
          'text $lte a day': 'r1,r2,r3',
          'text $lte the last day': 'r1,r2,r3,r4',
          'text $between one day': 'r2,r3',
          'text $between to the last day': 'r2,r3,r4',
          'text $not $lte a day': 'r4,r5',
          'text window one day': 'r2,r3',
          'text window to the last day': 'r2,r3,r4',
        };
        for (const hook of [undefined, () => undefined]) {
          const ctx = strategyCtx(hook, { executeRawSql: raw });
          for (const [label, query, expected] of CELLS) {
            const res = await new NativeSQLStrategy().execute(q(query), ctx);
            expect(ids(res.rows as Array<Record<string, unknown>>), `${label} (${hook ? 'a hook naming no type' : 'no hook'})`)
              .toBe(typeBlind[label] ?? expected);
          }
        }
      });
    },
  );
}

describe('[#5930 step 4] the ObjectQL face hands a column with no declared type to the engine as written', () => {
  it('a bare-day $lte and a window reach engine.aggregate unrewritten', async () => {
    const seen: unknown[] = [];
    const ctx = strategyCtx(undefined, {
      executeAggregate: async (_object: string, opts: { filter?: unknown }) => { seen.push(opts.filter); return []; },
    });
    await new ObjectQLStrategy().execute(q({ where: { note: { $lte: '2026-07-28' } } }), ctx);
    await new ObjectQLStrategy().execute(q({ timeDimensions: [{ dimension: 'signed_at', dateRange: ['2026-07-28', '2026-07-28'] }] }), ctx);
    expect(seen).toEqual([
      { note: { $lte: '2026-07-28' } },
      { signed_at: { $gte: '2026-07-28', $lte: '2026-07-28' } },
    ]);
  });
});

// ── The draft preview (F11), through the door that reaches it ────────────────

/**
 * `AnalyticsService.queryDataset` with `previewDrafts`, over drafted seed rows
 * (`draftRowsResolver`): the preview branch hands the evaluator the drafted
 * object's declared types from `sourceFieldMeta`. The live path is not wired,
 * so an answer can only come from the preview.
 */
describe('[#5930 step 4] the draft preview (F11) answers the typed drivers\' rows', () => {
  const DATASET = DatasetSchema.parse({
    name: 'os21417_preview',
    label: 'Whole day preview',
    object: OBJECT,
    dimensions: [
      { name: 'id', field: 'id', type: 'string' },
      { name: 'signed_at', field: 'signed_at', type: 'date' },
      { name: 'due_on', field: 'due_on', type: 'date' },
      { name: 'note', field: 'note', type: 'string' },
    ],
    measures: [{ name: 'row_count', aggregate: 'count' }],
  });
  const service = (sourceFieldMeta?: (object: string, field: string) => { type: string } | undefined) =>
    new AnalyticsService({
      ...(sourceFieldMeta ? { sourceFieldMeta } : {}),
      queryCapabilities: () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false }),
      executeAggregate: async () => { throw new Error('the live path ran: the preview did not answer'); },
      draftRowsResolver: async (object: string) => (object === OBJECT ? ROWS.map((r) => ({ ...r })) : null),
    } as never);
  const DECLARING = service((object, field) => (object === OBJECT && DECLARED[field] ? { type: DECLARED[field] } : undefined));
  const viaPreview = async (svc: AnalyticsService, query: Partial<AnalyticsQuery>): Promise<Ids> => {
    const selection = {
      dimensions: ['id'],
      measures: ['row_count'],
      ...(query.where ? { runtimeFilter: query.where } : {}),
      ...(query.timeDimensions ? { timeDimensions: query.timeDimensions } : {}),
    };
    const res = await svc.queryDataset(DATASET as never, selection as never, { tenantId: 'org_A' } as never, { previewDrafts: true });
    return ids(res.rows as Array<Record<string, unknown>>);
  };

  for (const [label, query, expected] of CELLS) {
    it(`${label}: ${expected}`, async () => {
      expect(await viaPreview(DECLARING, query)).toBe(expected);
    });
  }

  it('a host that names no declared type reads every column type-blind (ADR-0053 D-D1 item 7)', async () => {
    // The text cells keep the type-blind answer — the cells where "answer as
    // the typed drivers" cannot hold without a reader — and the datetime and
    // date cells keep the engine's rows.
    const typeBlind: Record<string, Ids> = {
      'text $lte a day': 'r1,r2,r3',
      'text $lte the last day': 'r1,r2,r3,r4',
      'text $between one day': 'r2,r3',
      'text $between to the last day': 'r2,r3,r4',
      'text $not $lte a day': 'r4,r5',
      'text window one day': 'r2,r3',
      'text window to the last day': 'r2,r3,r4',
    };
    const undeclared = service();
    for (const [label, query, expected] of CELLS) {
      expect(await viaPreview(undeclared, query), label).toBe(typeBlind[label] ?? expected);
    }
  });
});

// ── The temporal conformance matrix, on every face ───────────────────────────

/**
 * `TEMPORAL_CASES` through the native face and the ObjectQL face of the
 * plugin's composition, and through the read scope, over one engine on SQLite.
 * The native face over a context with no hook runs the same matrix in
 * `native-sql-temporal-conformance.test.ts`. Dimension ids match the fixture's
 * properties (`at` / `on`); the columns do not, so a member is resolved, not
 * echoed.
 */
describe('[#5930 step 4] the temporal conformance matrix answers on every analytics face (sqlite)', () => {
  const TEMPORAL = 'os21417_temporal';
  const COLUMN: Record<string, string> = { at: 'happened_at', on: 'happened_on' };
  const temporalCube = {
    name: 'os21417_temporal_cube',
    title: 'Temporal',
    sql: TEMPORAL,
    public: true,
    measures: { n: { type: 'count', sql: '*', label: 'n' } },
    dimensions: {
      id: { type: 'string', sql: 'id', label: 'Id' },
      at: { type: 'time', sql: COLUMN.at, label: 'At' },
      on: { type: 'time', sql: COLUMN.on, label: 'On' },
    },
  } as unknown as Cube;
  let engine: ObjectQL;
  let faces: { native: AnalyticsService; objectql: AnalyticsService };
  const resolveTokens = <T,>(filter: T): T => resolveFilterTokens(filter, { now: new Date(TEMPORAL_NOW) });
  /** The case's filter on the columns, for the read scope, which reads columns. */
  const onColumns = (filter: FilterCondition): FilterCondition =>
    Object.fromEntries(Object.entries(filter).map(([k, v]) => [COLUMN[k] ?? k, v])) as FilterCondition;

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as never);
    engine = new ObjectQL({ logger: quiet } as never);
    engine.registerDriver(driver as never, true);
    await engine.init();
    engine.registry.registerObject({
      name: TEMPORAL,
      label: 'Temporal',
      fields: {
        [COLUMN.at]: { name: COLUMN.at, type: 'datetime' },
        [COLUMN.on]: { name: COLUMN.on, type: 'date' },
      },
    } as never);
    await engine.syncSchemas();
    for (const r of TEMPORAL_ROWS) await engine.insert(TEMPORAL, { id: r.id, [COLUMN.at]: r.at, [COLUMN.on]: r.on } as never);
    faces = await composeFaces(engine, [temporalCube]);
  });
  afterAll(async () => {
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  const idsOn = async (face: 'native' | 'objectql', rest: Partial<AnalyticsQuery>) =>
    ids((await faces[face].query({ cube: temporalCube.name, measures: ['n'], dimensions: ['id'], ...rest } as never)).rows as Array<Record<string, unknown>>);

  for (const c of TEMPORAL_CASES) {
    it(c.name, async () => {
      const expected = [...c.expected].sort().join(',');
      for (const face of ['native', 'objectql'] as const) {
        expect(await idsOn(face, { where: c.filter }), `${face}: ${c.note ?? ''}`).toBe(expected);
        if (c.tokenFilter) expect(await idsOn(face, { where: resolveTokens(c.tokenFilter) }), `${face}, tokens`).toBe(expected);
        if (c.dateRange) {
          expect(await idsOn(face, { timeDimensions: [{ dimension: c.field, dateRange: resolveTokens(c.dateRange) }] }), `${face}, dateRange`).toBe(expected);
        }
      }
      const { sql, params } = compileScopedFilterToSql(onColumns(c.filter), TEMPORAL, {
        declaredValueShape: (field) => (field === COLUMN.at ? { type: 'datetime', multiple: false } : field === COLUMN.on ? { type: 'date', multiple: false } : undefined),
        dialect: 'sqlite',
      });
      const rows = await (engine as any).execute(`select "id" from "${TEMPORAL}" where ${sql}`, { args: params, object: TEMPORAL });
      expect(ids(rows as Array<Record<string, unknown>>), 'the read scope').toBe(expected);
    });
  }
});
