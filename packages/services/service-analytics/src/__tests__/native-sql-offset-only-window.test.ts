// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21365] An `offset` with no `limit` is a valid window — every row after the
 * offset — and the native face renders it for the dialect that runs it.
 *
 * ## The shape this closes
 *
 * `NativeSQLStrategy.assembleStatement` wrote `OFFSET n` with no `LIMIT` in
 * front of it. Measured at `POST /api/v1/analytics/query` on `main`
 * `ee75aae1a`, `order { note: 'asc' }, offset: 1`:
 *
 * | | native SQLite | native PostgreSQL 16.14 | ObjectQL face, both |
 * |:--|:--|:--|:--|
 * | answer | 500, `near "OFFSET": syntax error` | rows 2..n | rows 2..n |
 *
 * SQLite's grammar has no `OFFSET` without a `LIMIT`; its "no upper bound" is
 * a negative `LIMIT`. The statement now carries the dialect's no-limit
 * spelling (`windowClauseSql`), read off the `sqlDialect` hook the plugin
 * fills from the executing driver.
 *
 * ## The cells, and what each one's evidence is
 *
 *   - **sqlite → EXECUTED** (better-sqlite3), every run: `LIMIT -1 OFFSET n`.
 *   - **postgres → EXECUTED** where `OS_TEST_POSTGRES_URL` is set, a named skip
 *     otherwise: `OFFSET n` alone, byte-identical to before. CI provisions
 *     that variable for this package in the Temporal Conformance job's step
 *     "Run the non-SQL temporal backends under the skewed process zone"
 *     (`.github/workflows/ci.yml`), so the live cell is red-capable and runs
 *     in CI; the PR that landed this file carries its
 *     local PostgreSQL 16 run.
 *   - **unknown (no `sqlDialect` hook) → EXECUTED** on both engines above,
 *     through a `NativeSQLStrategy` whose context names no dialect:
 *     `LIMIT 9223372036854775807 OFFSET n`, which every LIMIT dialect parses.
 *   - **mysql → NOT MEASURED.** Asserted as text only: no MySQL server is
 *     provisionable in this container.
 *
 * Each executed cell answers the same rows on both faces, and the native
 * face's echoed `sql` and `generateSql` (the `/analytics/sql` body) are the
 * statement that ran, byte for byte.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';
import { NativeSQLStrategy, windowClauseSql } from '../strategies/native-sql-strategy.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';

const DEAL = 'os21365_deal';

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Offset window deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

// Inserted out of note order, so an answer in note order is the ORDER BY's.
const DEALS = [
  { id: 'd1', note: 'y', amount: 20 },
  { id: 'd2', note: 'w', amount: 7 },
  { id: 'd3', note: 'z', amount: 1 },
  { id: 'd4', note: 'x', amount: 10 },
  { id: 'd5', note: 'x', amount: 5 },
] as const;

const CUBE = 'os21365_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Offset window cube',
    sql: DEAL,
    public: true,
    measures: { amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' } },
    dimensions: { note: { type: 'string', sql: 'note', label: 'Note' } },
  },
] as unknown as Cube[];

const DATASET = {
  name: 'os21365_ds',
  label: 'Offset window dataset',
  object: DEAL,
  dimensions: [{ name: 'note', field: 'note', type: 'string' }],
  measures: [{ name: 'amount_sum', aggregate: 'sum', field: 'amount' }],
};

/** The card's row 4: ordered, an offset, no limit. */
const OFFSET_ONLY = { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { note: 'asc' }, offset: 1 };
/** Every group after the first, in note order. */
const AFTER_FIRST = [['x', 15], ['y', 20], ['z', 1]];

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
  /** The no-limit spelling the plugin's dialect hook makes the native face write, `''` for none. */
  noLimit: string;
}

const CELLS: readonly Cell[] = [
  {
    id: 'sqlite',
    label: 'sqlite',
    env: null,
    config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }),
    noLimit: ' LIMIT -1',
  },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
    noLimit: '',
  },
];

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Row = Record<string, unknown>;

/** Rows as tuples of the named columns, in arrival order; a numeric cell reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  (rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c])));

describe('[#21365] windowClauseSql — the window clause per dialect', () => {
  it('an offset with no limit takes the dialect\'s no-limit spelling in front of OFFSET', () => {
    expect(windowClauseSql(undefined, 1, 'sqlite')).toBe(' LIMIT -1 OFFSET 1');
    expect(windowClauseSql(undefined, 1, 'postgres')).toBe(' OFFSET 1');
    expect(windowClauseSql(undefined, 1, 'unknown')).toBe(' LIMIT 9223372036854775807 OFFSET 1');
    // NOT MEASURED: text only — no MySQL server is provisionable here.
    expect(windowClauseSql(undefined, 1, 'mysql')).toBe(' LIMIT 18446744073709551615 OFFSET 1');
  });

  it('CONTROL: a limit is written as given, with or without an offset, on every dialect', () => {
    for (const dialect of ['sqlite', 'postgres', 'mysql', 'unknown'] as const) {
      expect(windowClauseSql(2, 1, dialect), dialect).toBe(' LIMIT 2 OFFSET 1');
      expect(windowClauseSql(0, undefined, dialect), dialect).toBe(' LIMIT 0');
      expect(windowClauseSql(undefined, undefined, dialect), dialect).toBe('');
    }
  });
});

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21365] an offset with no limit runs on the native face (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Every raw statement the engine ran, in order. */
      const executed: string[] = [];
      const reads = { aggregate: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        await driver?.execute(`drop table if exists ${DEAL}`).catch(() => {});
      };

      /** One `query()` on one face, with the statements and aggregates it caused. */
      const ask = async (face: Face, query: Record<string, unknown>) => {
        const before = { statements: executed.length, aggregate: reads.aggregate };
        const res = await services[face]!.query(query as any);
        return { res, statements: executed.slice(before.statements), aggregate: reads.aggregate - before.aggregate };
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(DEAL_OBJECT as any);
        await engine.syncSchemas();
        for (const row of DEALS) await engine.insert(DEAL, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: unknown) => {
          executed.push(String(sql));
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (...args: unknown[]) => {
          reads.aggregate += 1;
          return (realAggregate as any)(...args);
        };

        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: CUBES, debugSql: true, ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
            getService: (name: string) => (name === 'data' ? engine : registered[name]),
            registerService: (name: string, svc: unknown) => { registered[name] = svc; },
            replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
            hook: () => {},
            logger: quiet,
          } as never);
          services[face] = registered.analytics as AnalyticsService;
        }
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it("the card's row: ordered, offset 1, no limit — both faces answer every row after the first", async () => {
        const native = await ask('native', OFFSET_ONLY);
        expect(native.statements, 'the native face ran ONE statement').toHaveLength(1);
        expect(native.statements[0].endsWith(`ORDER BY "note" ASC${cell.noLimit} OFFSET 1`), native.statements[0]).toBe(true);
        expect(tuples(native.res.rows, ['note', 'amount_sum']), 'native face').toEqual(AFTER_FIRST);

        const objectql = await ask('objectql', OFFSET_ONLY);
        expect(objectql.statements, 'the ObjectQL face ran no statement').toEqual([]);
        expect(objectql.aggregate, 'the ObjectQL face ran the engine aggregate').toBeGreaterThan(0);
        expect(tuples(objectql.res.rows, ['note', 'amount_sum']), 'ObjectQL face').toEqual(AFTER_FIRST);
      });

      it('the echo is the statement that ran: the result\'s `sql` and `generateSql` (the /analytics/sql body) carry its bytes', async () => {
        const { res, statements } = await ask('native', OFFSET_ONLY);
        expect(statements).toHaveLength(1);
        // The statement binds no parameter, so the raw-SQL bridge's `$N` → `?`
        // rewrite leaves it byte-identical: the echo can be compared as is.
        expect(res.sql).not.toContain('$');
        expect(res.sql).toBe(statements[0]);
        const dryRun = await services.native!.generateSql!(OFFSET_ONLY as any);
        expect(dryRun.sql).toBe(statements[0]);
      });

      it('an offset past every row answers no rows, and offset 0 answers every row', async () => {
        const past = await ask('native', { ...OFFSET_ONLY, offset: 9 });
        expect(past.res.rows).toEqual([]);
        const zero = await ask('native', { ...OFFSET_ONLY, offset: 0 });
        expect(zero.statements[0].endsWith(`${cell.noLimit} OFFSET 0`), zero.statements[0]).toBe(true);
        expect(tuples(zero.res.rows, ['note', 'amount_sum'])).toEqual([['w', 7], ...AFTER_FIRST]);
      });

      it('CONTROL: an integer window keeps its bytes — `LIMIT 2 OFFSET 1` — and both faces agree', async () => {
        const query = { ...OFFSET_ONLY, limit: 2 };
        const native = await ask('native', query);
        expect(native.statements[0].endsWith('ORDER BY "note" ASC LIMIT 2 OFFSET 1'), native.statements[0]).toBe(true);
        expect(tuples(native.res.rows, ['note', 'amount_sum'])).toEqual([['x', 15], ['y', 20]]);
        const objectql = await ask('objectql', query);
        expect(tuples(objectql.res.rows, ['note', 'amount_sum'])).toEqual([['x', 15], ['y', 20]]);
      });

      it('the dataset door pushes the offset-only window down, and both faces answer the same page', async () => {
        for (const face of FACES) {
          const before = executed.length;
          const res = await services[face]!.queryDataset(DATASET as any, {
            dimensions: ['note'],
            measures: ['amount_sum'],
            order: { note: 'asc' },
            offset: 1,
          } as any);
          expect(tuples(res.rows, ['note', 'amount_sum']), face).toEqual(AFTER_FIRST);
          if (face === 'native') {
            const ran = executed.slice(before);
            expect(ran.some((sql) => sql.endsWith(`${cell.noLimit} OFFSET 1`)), ran.join('\n')).toBe(true);
          }
        }
      });

      it('a host that wires no sqlDialect hook (the `unknown` arm) runs the window too, and answers the same rows', async () => {
        const strategy = new NativeSQLStrategy();
        // The plugin's own raw-SQL bridge, restated: `$N` → `?`, the object as
        // the driver-selection key, `{ rows }` or an array back. No `sqlDialect`.
        const ctx = {
          getCube: (name: string) => (name === CUBE ? CUBES[0] : undefined),
          queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
          executeRawSql: async (object: string, sql: string, params: unknown[]) => {
            const result = await (engine as any).execute(sql.replace(/\$(\d+)/g, '?'), { args: params, object });
            return Array.isArray(result) ? result : (result as { rows: Row[] }).rows;
          },
        } as unknown as DatasetScopedStrategyContext;
        const { sql } = await strategy.generateSql(OFFSET_ONLY as any, ctx);
        expect(sql.endsWith('ORDER BY "note" ASC LIMIT 9223372036854775807 OFFSET 1'), sql).toBe(true);
        const res = await strategy.execute(OFFSET_ONLY as any, ctx);
        expect(res.sql).toBe(sql);
        expect(tuples(res.rows, ['note', 'amount_sum'])).toEqual(AFTER_FIRST);
      });
    },
  );
}
