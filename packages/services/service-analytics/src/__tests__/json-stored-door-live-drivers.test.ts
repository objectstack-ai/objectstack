// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The card's three rows, over a real `SqlDriver`, on the strategy that
 * bypassed the engine's aggregate door — each refused before any statement
 * reaches the database, each beside a scalar control that is still served.
 *
 * ## Measured without the refusal, on this composition
 *
 * `AnalyticsServicePlugin` composed over a real `ObjectQL` engine (both
 * auto-bridges live, so `NativeSQLStrategy` answers on a SQL driver), four
 * rows: `status` a, a, b, b; `tags_f` [a,b], [a,b], [b], [ab]; `ms` and
 * `multi_sel` (a `select` with `multiple: true`) [a,b], [a,b], [b], [b];
 * `meta` {a:1}, {a:1}, {b:1}, {b:1}:
 *
 * | query | SQLite | PostgreSQL 16 |
 * |:--|:--|:--|
 * | row 1 — a cube or dataset dimension on `tags_f` / `ms` / `multi_sel` | 200, one group per serialized array | 500 `DATABASE_ERROR` |
 * | row 2 — an inferred `FIELD_count_distinct` over `meta` / `tags_f` / `multi_sel` | 200, 2 / 3 / 2 | 500 |
 * | row 3 — a dataset `count_distinct` measure over `multi_sel` | registers, then 200, 2 | registers, then 500 |
 * | controls — the `status` dimension, `status_count_distinct`, a dataset `count_distinct` over `status` | 200 | 200 |
 *
 * After the change every row answers 400 on both dialects — `INVALID_FIELD`
 * for rows 1 and 2 (the analytics door, naming the member), `DATASET_INVALID`
 * for row 3 (the dataset compiler, at registration) — and every control is
 * unchanged.
 *
 * ## The dialect axis
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI step
 * provisions that variable for this package, so the live cell is red-capable
 * and un-run in CI. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { DatasetSchema } from '@objectstack/spec/ui';
import { AnalyticsServicePlugin } from '../plugin.js';
import type { AnalyticsService } from '../analytics-service.js';

const OBJECT = 'analytics_json_stored_door_ledger';
const OPTIONS = [{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }];

const LEDGER = {
  name: OBJECT,
  label: 'JSON-stored door ledger',
  fields: {
    title: { name: 'title', type: 'text' as const },
    status: { name: 'status', type: 'select' as const, options: OPTIONS },
    tags_f: { name: 'tags_f', type: 'tags' as const },
    ms: { name: 'ms', type: 'multiselect' as const, options: OPTIONS },
    multi_sel: { name: 'multi_sel', type: 'select' as const, multiple: true, options: OPTIONS },
    meta: { name: 'meta', type: 'json' as const },
  },
};

const ROWS = [
  { id: 'r1', title: 'x', status: 'a', tags_f: ['a', 'b'], ms: ['a', 'b'], multi_sel: ['a', 'b'], meta: { a: 1 } },
  { id: 'r2', title: 'x', status: 'a', tags_f: ['a', 'b'], ms: ['a', 'b'], multi_sel: ['a', 'b'], meta: { a: 1 } },
  { id: 'r3', title: 'y', status: 'b', tags_f: ['b'], ms: ['b'], multi_sel: ['b'], meta: { b: 1 } },
  { id: 'r4', title: 'y', status: 'b', tags_f: ['ab'], ms: ['b'], multi_sel: ['b'], meta: { b: 1 } },
];

const CUBE = {
  name: 'json_stored_door_cube',
  title: 'JSON-stored door',
  sql: OBJECT,
  public: true,
  measures: { count: { label: 'Rows', type: 'count' as const, sql: '*' } },
  dimensions: Object.fromEntries(
    ['status', 'tags_f', 'ms', 'multi_sel'].map((f) => [f, { label: f, type: 'string' as const, sql: f }]),
  ),
};

const dataset = (name: string, measures: unknown[], dimensions: unknown[] = []) =>
  DatasetSchema.parse({ name, label: name, object: OBJECT, dimensions, measures });

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

const quiet: any = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

interface Refusal extends Error {
  code?: string;
  status?: number;
  member?: string;
  param?: string;
  field?: string;
}

/** The error a call rejected with — and a loud failure if it resolved. */
async function rejection(call: () => unknown): Promise<Refusal> {
  let resolved: unknown;
  try {
    resolved = await call();
  } catch (e) {
    return e as Refusal;
  }
  throw new Error(`expected a refusal, got ${JSON.stringify(resolved)}`);
}

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `the JSON-stored analytics door over a real SqlDriver — ${cell.label}${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      let service: AnalyticsService;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };

      const dropTable = async () => {
        if (cell.id === 'sqlite') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTable();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: { object?: string }) => {
          if (opts?.object === OBJECT) reads.rawSql += 1;
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
          if (object === OBJECT) reads.aggregate += 1;
          return (realAggregate as any)(object, ...rest);
        };

        // The plugin's own composition over the real engine: both auto-bridges.
        const registered: Record<string, unknown> = {};
        await new AnalyticsServicePlugin({ cubes: [CUBE as any] }).init({
          getService: (name: string) => (name === 'data' ? engine : registered[name]),
          registerService: (name: string, svc: unknown) => { registered[name] = svc; },
          replaceService: (name: string, svc: unknown) => { registered[name] = svc; },
          hook: () => {},
          logger: quiet,
        } as never);
        service = registered.analytics as AnalyticsService;
        // The scalar-and-multi-value dataset (row 1) and the scalar distinct count (row 3's control).
        service.registerDataset(dataset('json_stored_door_dim', [{ name: 'n_rows', aggregate: 'count' }], [
          { name: 'picked', field: 'multi_sel', type: 'string' },
          { name: 'state', field: 'status', type: 'string' },
        ]));
        service.registerDataset(
          dataset('json_stored_door_distinct_ok', [{ name: 'n_distinct', aggregate: 'count_distinct', field: 'status' }]),
        );
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      it('row 1 — a cube and a dataset dimension on a multi-value field answer 400 INVALID_FIELD naming the member, before any statement', async () => {
        const before = { ...reads };
        for (const member of ['tags_f', 'ms', 'multi_sel']) {
          const err = await rejection(() => service.query({ cube: CUBE.name, measures: ['count'], dimensions: [member] }));
          expect({ code: err.code, status: err.status, member: err.member, param: err.param }, member).toEqual({
            code: 'INVALID_FIELD', status: 400, member, param: 'dimensions',
          });
          expect(err.message, member).toContain('a multi-value field, which analytics does not group by. The query was NOT run.');
        }
        const err = await rejection(() => service.query({ cube: 'json_stored_door_dim', measures: ['n_rows'], dimensions: ['picked'] }));
        expect({ code: err.code, status: err.status, member: err.member, field: err.field }).toEqual({
          code: 'INVALID_FIELD', status: 400, member: 'picked', field: 'multi_sel',
        });
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
      });

      it('row 1 CONTROL — a single-value select dimension is served: one group per value, counted', async () => {
        const groups = async (cube: string, measure: string, member: string) => {
          const result = await service.query({ cube, measures: [measure], dimensions: [member] });
          return (result.rows as Array<Record<string, unknown>>)
            .map((r) => [String(r[member]), Number(r[measure])] as const)
            .sort(([a], [b]) => a.localeCompare(b));
        };
        expect(await groups(CUBE.name, 'count', 'status')).toEqual([['a', 2], ['b', 2]]);
        expect(await groups('json_stored_door_dim', 'n_rows', 'state')).toEqual([['a', 2], ['b', 2]]);
      });

      it('row 2 — an inferred FIELD_count_distinct over a JSON-stored field answers 400 INVALID_FIELD naming the measure, before any statement', async () => {
        const before = { ...reads };
        for (const field of ['meta', 'tags_f', 'multi_sel']) {
          const member = `${field}_count_distinct`;
          for (const cube of [OBJECT, CUBE.name]) {
            const err = await rejection(() => service.query({ cube, measures: [member] }));
            expect({ code: err.code, status: err.status, member: err.member, param: err.param, field: err.field }, `${cube} ${member}`).toEqual({
              code: 'INVALID_FIELD', status: 400, member, param: 'measures', field,
            });
            expect(err.message, `${cube} ${member}`).toContain('which analytics does not count distinct. The query was NOT run.');
          }
        }
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);
      });

      it('row 2 CONTROL — a count_distinct over a single-value select is served', async () => {
        for (const cube of [OBJECT, CUBE.name]) {
          const result = await service.query({ cube, measures: ['status_count_distinct'] });
          expect(Number((result.rows as Array<Record<string, unknown>>)[0].status_count_distinct), cube).toBe(2);
        }
      });

      it('row 3 — a dataset count_distinct measure over a multiple: true select is refused DATASET_INVALID at registration; the scalar control registers and answers', async () => {
        const before = { ...reads };
        const err = await rejection(() => service.registerDataset(
          dataset('json_stored_door_distinct', [{ name: 'n_distinct', aggregate: 'count_distinct', field: 'multi_sel' }]),
        ));
        expect({ code: err.code, status: err.status }).toEqual({ code: 'DATASET_INVALID', status: 400 });
        expect(err.message).toContain('declares as `select` with `multiple: true`');
        expect(reads, 'no raw SQL and no engine aggregate for the object').toEqual(before);

        const result = await service.query({ cube: 'json_stored_door_distinct_ok', measures: ['n_distinct'] });
        expect(Number((result.rows as Array<Record<string, unknown>>)[0].n_distinct)).toBe(2);
      });
    },
  );
}
