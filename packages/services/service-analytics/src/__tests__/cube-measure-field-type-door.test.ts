// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21044] The cube door judges a measure by the ONE aggregate × field-type
 * table, `AGGREGATE_FIELD_TYPE_COMPATIBILITY` (`@objectstack/spec/data`),
 * ahead of strategy selection — as the dataset door judges it at compile.
 *
 * ## The shape this closes
 *
 * A configured cube measure `{ type: 'max', sql: 'note' }` over a `text`
 * column was SERVED by `NativeSQLStrategy` — `200`, the column's text (`"y"`) —
 * while the same response's `fields[]` declared the measure
 * `{ type: 'number' }`. The dataset door refuses that pair at compile
 * (`DATASET_INVALID` / 400, `dataset-compiler.ts`), and the engine's aggregate
 * door refuses it on the ObjectQL face (`INVALID_FIELD` / 400, after the
 * strategy has started reading). The cube door consulted nothing.
 *
 * ## What these pins hold
 *
 * - A measure whose aggregate the table refuses for its column's declared type
 *   is refused `INVALID_FIELD` / 400 BEFORE either strategy reads anything —
 *   no raw statement, no engine aggregate — with the member, the request key,
 *   the cube, the column and its object on the error. One door, every
 *   strategy, so both faces give one answer.
 * - `sum` / `avg` over the same column are refused by the same door asking the
 *   same table — the dataset door judges every aggregate, and so does this one
 *   (`count_distinct` keeps its own door, #20912).
 * - The controls are served: `max` over a `number` column answers a number,
 *   typed `number`.
 * - An ACCEPTED non-numeric pair is described by the dataset door's one rule,
 *   `measureResultType`: `min` / `max` over a temporal column is typed `time`,
 *   and over a boolean column keeps the producer's `number` (the rule declines
 *   the boolean class).
 * - A suffix-inferred measure and an authored one are one population, and the
 *   dry-run door refuses what the query door refuses.
 * - "Cannot answer, do not block": a host that wires no `sourceFieldMeta`
 *   gets no verdict.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; CI provisions
 * that variable for this package in the Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 * CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os21044_cube_measure_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Cube measure field-type ledger',
  fields: {
    category: { name: 'category', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
    status: {
      name: 'status',
      type: 'select' as const,
      options: [{ label: 'Open', value: 'open' }, { label: 'Won', value: 'won' }],
    },
    opened_at: { name: 'opened_at', type: 'datetime' as const },
    due_on: { name: 'due_on', type: 'date' as const },
    flag: { name: 'flag', type: 'boolean' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const ROWS = [
  { id: 'r1', category: 'a', note: 'x', status: 'open', opened_at: '2026-01-02T03:04:05.000Z', due_on: '2026-02-01', flag: true, amount: 10 },
  { id: 'r2', category: 'a', note: 'y', status: 'won', opened_at: '2026-03-04T05:06:07.000Z', due_on: '2026-01-15', flag: false, amount: 32 },
] as const;

const CUBE: Cube = {
  name: 'os21044_cube',
  title: 'Cube measure field-type cube',
  sql: OBJECT,
  public: true,
  measures: {
    max_note: { type: 'max', sql: 'note', label: 'Largest note (text)' },
    min_note: { type: 'min', sql: 'note', label: 'Smallest note (text)' },
    max_status: { type: 'max', sql: 'status', label: 'Largest status (select)' },
    max_opened: { type: 'max', sql: 'opened_at', label: 'Latest opening (datetime)' },
    min_due: { type: 'min', sql: 'due_on', label: 'Earliest due day (date)' },
    max_flag: { type: 'max', sql: 'flag', label: 'Any flag (boolean)' },
    max_amount: { type: 'max', sql: 'amount', label: 'Largest amount (number)' },
    sum_note: { type: 'sum', sql: 'note', label: 'Sum of notes (text)' },
    avg_note: { type: 'avg', sql: 'note', label: 'Average note (text)' },
  },
  dimensions: {
    category: { type: 'string', sql: 'category', label: 'Category' },
  },
} as Cube;

/**
 * Pairs the table refuses: the member, and the column its measure reads. The
 * `min` / `max` rows are the card's; `sum` / `avg` over the same column are the
 * same door asking the same table, measured on the base as `0` on SQLite (both
 * faces for `sum`) and a 500 on PostgreSQL.
 */
const REFUSED: ReadonlyArray<readonly [member: string, column: string]> = [
  ['max_note', 'note'],
  ['min_note', 'note'],
  ['max_status', 'status'],
  ['sum_note', 'note'],
  ['avg_note', 'note'],
];

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

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; member?: string; param?: string; cube?: string; field?: string; object?: string };

const refusalOf = (query: Promise<unknown>): Promise<Refusal> =>
  query.then<never, Refusal>(
    () => {
      throw new Error('expected the query to be refused, but it resolved');
    },
    (e) => e as Refusal,
  );

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21044] the cube door judges a measure by the aggregate × field-type table (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      /** `native`: the plugin's own capabilities. `objectql`: narrowed to the engine-aggregate path. */
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      /** One query on one face, with the reads it caused counted. */
      const read = async (face: Face, cube: string, measures: readonly string[]) => {
        const before = { ...reads };
        const outcome = await services[face]!.query({ cube, measures: [...measures] } as any).then(
          (res) => ({ res, err: undefined as Refusal | undefined }),
          (err) => ({ res: undefined, err: err as Refusal }),
        );
        return { ...outcome, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
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

        // The plugin's own composition over the real engine — `sourceFieldMeta`
        // wired from the engine's registry, both auto-bridges live.
        for (const [face, caps] of [
          ['native', undefined],
          ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
        ] as const) {
          const registered: Record<string, unknown> = {};
          await new AnalyticsServicePlugin({ cubes: [CUBE], ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
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
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      for (const face of FACES) {
        it(`${face}: a measure whose aggregate the table refuses for its column's type is refused INVALID_FIELD / 400 before anything is read`, async () => {
          for (const [member, column] of REFUSED) {
            const { res, err, rawSql, aggregate } = await read(face, CUBE.name, [member]);
            expect(res, `${member} must not be served`).toBeUndefined();
            expect(err?.code, `${member}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status, member).toBe(400);
            expect(err?.member, member).toBe(member);
            expect(err?.param, member).toBe('measures');
            expect(err?.cube, member).toBe(CUBE.name);
            expect(err?.field, member).toBe(column);
            expect(err?.object, member).toBe(OBJECT);
            expect(rawSql, `${member}: no raw statement ran`).toBe(0);
            expect(aggregate, `${member}: no engine aggregate ran`).toBe(0);
          }
        });

        it(`${face}: the control — max over a number column is served, a number, typed number`, async () => {
          const { res, err } = await read(face, CUBE.name, ['max_amount']);
          expect(err, err?.message).toBeUndefined();
          expect(res!.rows[0]!.max_amount).toBe(32);
          expect(res!.fields.find((f) => f.name === 'max_amount')?.type).toBe('number');
        });

        it(`${face}: an accepted temporal pair is served and described by measureResultType — typed time`, async () => {
          for (const member of ['max_opened', 'min_due']) {
            const { res, err } = await read(face, CUBE.name, [member]);
            expect(err, `${member}: ${err?.message}`).toBeUndefined();
            expect(res!.rows[0]![member], `${member} answers a value`).not.toBeNull();
            expect(res!.fields.find((f) => f.name === member)?.type, `${member} is described time`).toBe('time');
          }
        });

        // [#21044] The one rule declines the boolean class (three readings
        // disagree about what the aggregate returns), so the producer's `number`
        // stands — the word SQLite's 0 / 1 answer fits. [#21042] Runs on every
        // cell and face: PostgreSQL defines no `max(boolean)`, and the native
        // face now casts the boolean aggregand to `int` as `driver-sql` does,
        // through the one policy both read (`@objectstack/core`), so the
        // accepted pair answers `1` there too instead of a 500.
        it(`${face}: an accepted boolean pair is served and keeps number — the one rule declines it`, async () => {
          const { res, err } = await read(face, CUBE.name, ['max_flag']);
          expect(err, err?.message).toBeUndefined();
          expect(res!.rows[0]!.max_flag).toBe(1);
          expect(res!.fields.find((f) => f.name === 'max_flag')?.type).toBe('number');
        });

        it(`${face}: a suffix-inferred measure is judged as an authored one — on the configured cube and on an inferred cube`, async () => {
          for (const cube of [CUBE.name, OBJECT]) {
            const { res, err, rawSql, aggregate } = await read(face, cube, ['note_max']);
            expect(res, `${cube}: note_max must not be served`).toBeUndefined();
            expect(err?.code, `${cube}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status).toBe(400);
            expect(err?.member).toBe('note_max');
            expect(err?.field).toBe('note');
            expect(rawSql + aggregate, `${cube}: nothing was read`).toBe(0);
          }
          const control = await read(face, OBJECT, ['amount_max']);
          expect(control.err, control.err?.message).toBeUndefined();
          expect(control.res!.rows[0]!.amount_max).toBe(32);
        });
      }

      it('the dry-run door refuses what the query door refuses', async () => {
        const err = await refusalOf(services.native!.generateSql({ cube: CUBE.name, measures: ['max_note'] } as any));
        expect(err.code, err.message).toBe('INVALID_FIELD');
        expect(err.status).toBe(400);
        expect(err.member).toBe('max_note');
        const control = await services.native!.generateSql({ cube: CUBE.name, measures: ['max_amount'] } as any);
        expect(control.sql).toMatch(/max\(/i);
      });
    },
  );
}

describe('[#21044] cannot answer, do not block', () => {
  it('a host that wires no sourceFieldMeta gets no verdict: the pair reaches its strategy', async () => {
    let statements = 0;
    const service = new AnalyticsService({
      logger: quiet as any,
      cubes: [CUBE],
      queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: false, inMemory: false }),
      executeRawSql: async () => {
        statements += 1;
        return [{ max_note: 'y' }];
      },
    });
    const res = await service.query({ cube: CUBE.name, measures: ['max_note'] } as any);
    expect(statements).toBe(1);
    expect(res.rows).toEqual([{ max_note: 'y' }]);
  });
});
