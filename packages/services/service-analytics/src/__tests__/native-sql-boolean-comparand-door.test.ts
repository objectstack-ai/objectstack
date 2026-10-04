// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21376] The native-SQL strategy answers a comparand against a declared
 * BOOLEAN column what the engine's `where` door answers: `'true'` / `'false'`,
 * `'1'` / `'0'` and `1` / `0` narrow to the boolean each names, and anything
 * else the verdict refuses (`'yes'`, `2`) is refused `INVALID_FILTER` / 400
 * before a statement runs.
 *
 * ## Measured on the base, through these doors
 *
 * Three rows (`t1`, `t2` store `true`, `f1` stores `false`), counted by the
 * cube read (`AnalyticsService.query`, what `POST /api/v1/analytics/query`
 * relays) and the dataset door (`AnalyticsService.queryDataset`, what
 * `POST /api/v1/analytics/dataset/query` relays, its `runtimeFilter` merged
 * into the `where`), each on two faces of the plugin's own composition: the
 * native strategy (one raw statement) and the ObjectQL strategy, whose
 * `engine.aggregate` runs the engine's `where` door — the target column.
 *
 * | filter | native, SQLite | native, PostgreSQL 16 | engine door |
 * |:--|:--|:--|:--|
 * | `{ flag: true }` | 2 | 2 | 2 |
 * | `{ flag: 'true' }` | **0** | 2 | 2 |
 * | `{ flag: { $ne: 'true' } }` | **3** | 1 | 1 |
 * | `{ flag: 'yes' }` | **200, 0** | **200, 2** | 400 `INVALID_FILTER` |
 * | `{ flag: 1 }` | 2 | 2 | 2 |
 * | `{ flag: '1' }` | 2 | 2 | 2 |
 *
 * A stored boolean is `1` / `0` on SQLite, so the string `'true'` equalled
 * neither and the negation kept every row; PostgreSQL reads `'yes'` as `true`.
 * The strategy now runs the spec's verdict (`booleanComparandDoorVerdict`) on
 * every filter it compiles: the caller's `where`, each measure's own `filter`
 * and the dataset's own scope. Every cell below asserts the engine face's
 * answer AND the native face's equality with it, and which strategy answered.
 *
 * Each filter handed in is deep-frozen, and so is the registered dataset's
 * own `filter` and its measure's `filter`: narrowing is copy-on-write, so an
 * edit in place would throw.
 *
 * The PostgreSQL cell runs where `OS_TEST_POSTGRES_URL` is set and is a named
 * skip otherwise; CI provisions that variable for this package in the
 * Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`). The
 * live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os21376_flag_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'Boolean comparand ledger',
  fields: {
    note: { name: 'note', type: 'text' as const },
    flag: { name: 'flag', type: 'boolean' as const },
  },
};

const ROWS = [
  { id: 't1', note: 'n', flag: true },
  { id: 't2', note: 'n', flag: true },
  { id: 'f1', note: 'n', flag: false },
] as const;

const CUBE: Cube = {
  name: 'os21376_flag_cube',
  title: 'Boolean comparand cube',
  sql: OBJECT,
  public: true,
  measures: { row_count: { type: 'count', sql: '*', label: 'Rows' } },
  dimensions: {
    note: { type: 'string', sql: 'note', label: 'Note' },
    flag: { type: 'boolean', sql: 'flag', label: 'Flag' },
  },
} as Cube;

/** The inline dataset the dataset door carries. */
const INLINE = {
  name: 'os21376_flag_inline',
  label: 'Boolean comparand inline dataset',
  object: OBJECT,
  dimensions: [{ name: 'note', field: 'note', type: 'string' }],
  measures: [{ name: 'row_count', aggregate: 'count' }],
};

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

/** A registered dataset whose own scope and measure filter spell booleans as text, frozen. */
const REGISTERED = deepFreeze({
  name: 'os21376_flag_registered',
  label: 'Boolean comparand registered dataset',
  object: OBJECT,
  filter: { flag: { $ne: 'false' } },
  dimensions: [{ name: 'note', field: 'note', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    { name: 'none_count', aggregate: 'count', filter: { flag: '0' } },
  ],
});

type Answer = number | { code: string; status: number };

/** Each filter, the engine door's answer, and the doors it is asked at. */
const CELLS: ReadonlyArray<readonly [filter: unknown, engine: Answer, label: string]> = [
  // The controls: a boolean, and the number spelling.
  [{ flag: true }, 2, 'a boolean'],
  [{ flag: 1 }, 2, 'the number spelling'],
  [{ flag: false }, 1, 'a boolean'],
  // Narrowed.
  [{ flag: 'true' }, 2, 'the canonical string'],
  [{ flag: 'false' }, 1, 'the canonical string'],
  [{ flag: '1' }, 2, 'a stringified storage form'],
  [{ flag: { $eq: '0' } }, 1, 'a stringified storage form under $eq'],
  // The negation hides the excluded rows.
  [{ flag: { $ne: 'true' } }, 1, 'the string negation'],
  [{ flag: { $nin: ['true'] } }, 1, 'the string list negation'],
  [{ flag: { $in: ['false', '1'] } }, 3, 'a list of spellings'],
  [{ $or: [{ flag: 'false' }, { note: 'x' }] }, 1, 'under $or'],
  [{ $not: { flag: 'true' } }, 1, 'under $not'],
  // Refused: no boolean reading.
  [{ flag: 'yes' }, { code: 'INVALID_FILTER', status: 400 }, 'no boolean reading'],
  [{ flag: { $ne: 'TRUE' } }, { code: 'INVALID_FILTER', status: 400 }, 'another letter case'],
  [{ flag: { $in: [true, 'on'] } }, { code: 'INVALID_FILTER', status: 400 }, 'a list member with no boolean reading'],
  // A number other than 1 / 0: the verdict's refusal, read from the spec, never a table here.
  [{ flag: 2 }, { code: 'INVALID_FILTER', status: 400 }, 'a number other than 1 / 0'],
];

interface Cell {
  id: 'sqlite' | 'pg';
  label: string;
  env: string | null;
  config: () => Record<string, unknown> | null;
}

const DRIVER_CELLS: readonly Cell[] = [
  { id: 'sqlite', label: 'sqlite', env: null, config: () => ({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) },
  {
    id: 'pg',
    label: 'live postgres',
    env: 'OS_TEST_POSTGRES_URL',
    config: () => (process.env.OS_TEST_POSTGRES_URL ? { client: 'pg', connection: process.env.OS_TEST_POSTGRES_URL } : null),
  },
];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Face = 'native' | 'engine';

for (const cell of DRIVER_CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21376] analytics native SQL — a boolean comparand answers what the engine door answers (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object. */
      const reads = { rawSql: 0, aggregate: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTable = async () => {
        if (cell.id === 'pg') await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      /** The total count a face answers, or its refusal envelope, and what read the object. */
      const ask = async (face: Face, run: (svc: AnalyticsService) => Promise<{ rows: unknown[] }>) => {
        const before = { ...reads };
        const answer: Answer = await run(services[face]!).then(
          (res) => (res.rows as Array<Record<string, unknown>>).reduce((sum, r) => sum + Number(r.row_count ?? 0), 0),
          (e: Error & { code?: string; status?: number }) => ({ code: String(e.code), status: Number(e.status), message: e.message }) as Answer,
        );
        return { answer, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
      };

      const cubeRead = (where: unknown) => (svc: AnalyticsService) =>
        svc.query({ cube: CUBE.name, measures: ['row_count'], where: deepFreeze(structuredClone(where)) } as never) as Promise<{ rows: unknown[] }>;
      const datasetRead = (runtimeFilter: unknown) => (svc: AnalyticsService) =>
        svc.queryDataset(INLINE as never, { measures: ['row_count'], dimensions: ['note'], runtimeFilter: deepFreeze(structuredClone(runtimeFilter)) } as never) as Promise<{ rows: unknown[] }>;

      /** Both faces at one door: the engine face answers `engine`, the native face the same. */
      const expectBothFaces = async (door: (filter: unknown) => (svc: AnalyticsService) => Promise<{ rows: unknown[] }>, filter: unknown, engineAnswer: Answer) => {
        const viaEngine = await ask('engine', door(filter));
        const viaNative = await ask('native', door(filter));
        const strip = (a: Answer) => (typeof a === 'number' ? a : { code: a.code, status: a.status });
        expect(strip(viaEngine.answer), 'the engine door').toEqual(engineAnswer);
        expect(strip(viaNative.answer), 'the native strategy answers what the engine door answers').toEqual(engineAnswer);
        expect(viaEngine.rawSql, 'the engine face ran no raw statement').toBe(0);
        if (typeof engineAnswer === 'number') {
          expect(viaNative.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
          expect(viaNative.aggregate, 'no engine aggregate on the native face').toBe(0);
        } else {
          expect(viaNative.rawSql, 'refused before any statement ran').toBe(0);
          const message = (viaNative.answer as { message?: string }).message ?? '';
          expect(message).toContain("'flag'");
          expect(message).toContain('where');
        }
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

        // The plugin's own composition over the real engine: both auto-bridges
        // (`native`), and the same narrowed to the engine-aggregate path (`engine`).
        for (const [face, caps] of [
          ['native', undefined],
          ['engine', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
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
          services[face]!.registerDataset(REGISTERED as never);
        }
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      describe('the cube read — the `where` of POST /analytics/query', () => {
        for (const [filter, engineAnswer, label] of CELLS) {
          it(`${JSON.stringify(filter)} (${label}) answers ${JSON.stringify(engineAnswer)}`, async () => {
            await expectBothFaces(cubeRead, filter, engineAnswer);
          });
        }

        it('the FilterArray spelling and the cube-qualified member are judged too', async () => {
          await expectBothFaces(cubeRead, [['flag', '=', 'true']], 2);
          await expectBothFaces(cubeRead, { [`${CUBE.name}.flag`]: { $ne: 'true' } }, 1);
          await expectBothFaces(cubeRead, [['flag', '=', 'yes']], { code: 'INVALID_FILTER', status: 400 });
        });
      });

      describe('the dataset door — the `runtimeFilter` of POST /api/v1/analytics/dataset/query', () => {
        for (const [filter, engineAnswer, label] of CELLS) {
          it(`${JSON.stringify(filter)} (${label}) answers ${JSON.stringify(engineAnswer)}`, async () => {
            await expectBothFaces(datasetRead, filter, engineAnswer);
          });
        }
      });

      describe("a registered dataset's own scope and measure filter, read by the cube door", () => {
        it("`filter: { flag: { $ne: 'false' } }` scopes to the true rows, and `filter: { flag: '0' }` on a measure counts none of them", async () => {
          for (const face of ['engine', 'native'] as const) {
            const before = { ...reads };
            const res = await services[face]!.query({ cube: REGISTERED.name, measures: ['row_count', 'none_count'] } as never) as { rows: Array<Record<string, unknown>> };
            const total = (m: string) => res.rows.reduce((sum, r) => sum + Number(r[m] ?? 0), 0);
            expect(total('row_count'), `${face}: the dataset scope keeps the true rows`).toBe(2);
            expect(total('none_count'), `${face}: no kept row is false`).toBe(0);
            if (face === 'native') expect(reads.rawSql - before.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
          }
        });
      });
    },
  );
}
