// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21448] A LIST at a scalar operator — `{ amount: { $gt: [10, 99] } }`,
 * `{ note: { $gt: ['a', 'z'] } }` — answers ONE refusal on both analytics
 * faces, at both analytics doors, on SQLite and PostgreSQL: `INVALID_FILTER` /
 * 400, before any statement or engine read, in the words of the shared
 * comparand-shape face (`assertListComparandShapes`, `@objectstack/spec/data`).
 *
 * ## Measured on `origin/main` `b94a2a727`, through these doors
 *
 * Three rows (`note` 'b' / 'm' / 'y', `amount` 5 / 12 / 30), counted by the
 * cube read (`AnalyticsService.query`, what `POST /api/v1/analytics/query`
 * relays) and the dataset door (`AnalyticsService.queryDataset`, what
 * `POST /api/v1/analytics/dataset/query` relays, its `runtimeFilter` merged
 * into the `where`), each on two faces of the plugin's own composition: the
 * native strategy and the ObjectQL strategy (`engine.aggregate`). SQLite and
 * PostgreSQL 16.14 answered alike:
 *
 * | filter | engine-aggregate face | native face | `engine.find` |
 * |:--|:--|:--|:--|
 * | `{ amount: { $gt: [10, 99] } }` | **200, 2** (the driver received `$gt: 10`) | 400, the number verdict | 400, the number verdict |
 * | `{ amount: { $lte: [12, 1] } }` | **200, 2** (`$lte: 12`) | 400, the number verdict | 400, the number verdict |
 * | `{ note: { $gt: ['a', 'z'] } }` | **200, 3** (`$gt: 'a'`) | **200, 3** (bound `'a'`) | 400, `driver-sql`'s own bind refusal |
 * | `[['note', '>', ['a', 'z']]]` (the FilterArray spelling) | **200, 3** | **200, 3** | 400, the driver's |
 * | `{ note: { $eq: ['b'] } }`, `{ note: { $ne: ['b'] } }` | 400, the face | 400, the face | 400, the face |
 * | `{ note: { $contains: ['b', 'm'] } }` | 400, this package's LIKE gate | the same | 400, the driver's |
 *
 * The shared analytics lowering carried the operator's whole list into one
 * leaf, and the leaf compilers read its first member. The engine door did not
 * bind the first member: on `driver-sql` it refused the text cell in the
 * driver's own words, so the engine door's answer was right and only its
 * wording was per driver. The face's new arm answers every row above, so each
 * cell is one refusal, the same message on both faces.
 *
 * The lowering gained no rule: `lowerAnalyticsWhere` already hands every field
 * entry of a `where` to the shared face (`assertWhereComparandShapes`, #20010)
 * before any leaf exists, so the arm reaches it with no change here.
 *
 * The PostgreSQL cells run where `OS_TEST_POSTGRES_URL` is set and are a named
 * skip otherwise; no CI step provisions that variable for this package. The
 * live cell owns its table, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import { DatasetSchema } from '@objectstack/spec/ui';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os21448_list_ledger';

const LEDGER = {
  name: OBJECT,
  label: 'List at a scalar operator ledger',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const ROWS = [
  { id: 'r5', note: 'b', amount: 5 },
  { id: 'r12', note: 'm', amount: 12 },
  { id: 'r30', note: 'y', amount: 30 },
] as const;

const CUBE: Cube = {
  name: 'os21448_list_cube',
  title: 'List at a scalar operator cube',
  sql: OBJECT,
  public: true,
  measures: { row_count: { type: 'count', sql: '*', label: 'Rows' } },
  dimensions: {
    note: { type: 'string', sql: 'note', label: 'Note' },
    amount: { type: 'number', sql: 'amount', label: 'Amount' },
  },
} as Cube;

/** The inline dataset the dataset door carries. */
const INLINE = {
  name: 'os21448_list_inline',
  label: 'List at a scalar operator inline dataset',
  object: OBJECT,
  dimensions: [{ name: 'note', field: 'note', type: 'string' }],
  measures: [{ name: 'row_count', aggregate: 'count' }],
};

/** A registered dataset: its own scope and its measure's filter are positions under test. */
const registeredDataset = (name: string, filter: unknown, measureFilter: unknown) => ({
  name,
  label: name,
  object: OBJECT,
  ...(filter === undefined ? {} : { filter }),
  dimensions: [{ name: 'note', field: 'note', type: 'string' }],
  measures: [
    { name: 'row_count', aggregate: 'count' },
    ...(measureFilter === undefined ? [] : [{ name: 'scoped_count', aggregate: 'count', filter: measureFilter }]),
  ],
});

const REGISTERED_REFUSED = [
  registeredDataset('os21448_list_scope', { note: { $gt: ['a', 'z'] } }, undefined),
  registeredDataset('os21448_list_measure', undefined, { amount: { $lt: [20, 1] } }),
] as const;

type Refusal = { code: string; status: number; message: string };
type Answer = number | Refusal;
type Face = 'native' | 'engine';

/** Each refused filter, and the operator and field the face must name. */
const REFUSED_CELLS: ReadonlyArray<readonly [filter: unknown, op: string, field: string, label: string]> = [
  // The card's cells.
  [{ amount: { $gt: [10, 99] } }, '$gt', 'amount', 'a pair on a number column'],
  [{ amount: { $gt: [10] } }, '$gt', 'amount', 'one member on a number column'],
  [{ note: { $gt: ['a', 'z'] } }, '$gt', 'note', 'a pair on a text column'],
  [{ note: { $eq: ['b'] } }, '$eq', 'note', '$eq on a text column (the equality arm, unchanged)'],
  [{ note: { $ne: ['b'] } }, '$ne', 'note', '$ne on a text column (the $ne arm, unchanged)'],
  // The rest of the scalar set, every column type.
  [{ amount: { $lte: [12, 1] } }, '$lte', 'amount', '$lte on a number column'],
  [{ note: { $gte: ['m'] } }, '$gte', 'note', '$gte on a text column'],
  [{ note: { $lt: [] } }, '$lt', 'note', 'an EMPTY list — still a list in a one-value slot'],
  [{ note: { $contains: ['b', 'm'] } }, '$contains', 'note', 'a text operator'],
  [{ note: { $startsWith: ['b'] } }, '$startsWith', 'note', 'another text operator'],
  // Every depth, and the FilterArray spelling.
  [{ $or: [{ note: { $gt: ['a', 'z'] } }, { amount: 5 }] }, '$gt', 'note', 'under $or'],
  [{ $not: { note: { $lt: ['m'] } } }, '$lt', 'note', 'under $not'],
  [[['note', '>', ['a', 'z']]], '$gt', 'note', 'the FilterArray spelling, ">"'],
  [[['amount', 'gte', [10, 99]]], '$gte', 'amount', 'the FilterArray spelling, "gte"'],
];

/** The controls the ruling names, and the scalar neighbours: each face counts alike. */
const CONTROL_CELLS: ReadonlyArray<readonly [filter: unknown, count: number, label: string]> = [
  [{ note: { $in: ['b'] } }, 1, 'a list at $in'],
  [{ note: { $nin: ['b'] } }, 2, 'a list at $nin'],
  [{ amount: { $gt: 10 } }, 2, 'a scalar at $gt'],
  [{ note: { $gt: 'a' } }, 3, 'a scalar at $gt on a text column'],
  [{ amount: { $between: [10, 40] } }, 2, 'a range'],
];

/** The leading sentence every one of these refusals carries — the face's, `driver-memory`'s for this condition. */
const faceSentence = (op: string, field: string) =>
  `Operator "${op}" on field "${field}" requires a single comparable value, but received an array`;

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

for (const cell of DRIVER_CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21448] a list at a scalar operator answers one 400 on both analytics faces (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements, engine aggregates and driver reads of THIS object. */
      const reads = { rawSql: 0, aggregate: 0, driver: 0 };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTable = async () => {
        if (cell.id !== 'pg') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
      };

      /** The total count a face answers, or its refusal envelope, and what read the object. */
      const ask = async (face: Face, run: (svc: AnalyticsService) => Promise<{ rows: unknown[] }>) => {
        const before = { ...reads };
        const answer = await run(services[face]!).then(
          (res) => (res.rows as Array<Record<string, unknown>>).reduce((sum, r) => sum + Number(r.row_count ?? 0), 0) as Answer,
          (e: Error & { code?: string; status?: number }) => ({ code: String(e.code), status: Number(e.status), message: e.message }) as Answer,
        );
        return {
          answer,
          rawSql: reads.rawSql - before.rawSql,
          aggregate: reads.aggregate - before.aggregate,
          driver: reads.driver - before.driver,
        };
      };

      const cubeRead = (where: unknown) => (svc: AnalyticsService) =>
        svc.query({ cube: CUBE.name, measures: ['row_count'], where: structuredClone(where) } as never) as Promise<{ rows: unknown[] }>;
      const datasetRead = (runtimeFilter: unknown) => (svc: AnalyticsService) =>
        svc.queryDataset(INLINE as never, { measures: ['row_count'], dimensions: ['note'], runtimeFilter: structuredClone(runtimeFilter) } as never) as Promise<{ rows: unknown[] }>;

      /** Both faces at one door: one refusal, the same words on each, and nothing read. */
      const expectOneRefusal = async (door: typeof cubeRead, filter: unknown, op: string, field: string) => {
        const messages: string[] = [];
        for (const face of ['engine', 'native'] as const) {
          const asked = await ask(face, door(filter));
          const answer = asked.answer as Refusal;
          expect(typeof asked.answer, `${face}: refused, not answered`).toBe('object');
          expect({ code: answer.code, status: answer.status }, face).toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(answer.message, face).toContain(faceSentence(op, field));
          expect(asked.rawSql, `${face}: no raw statement ran`).toBe(0);
          expect(asked.aggregate, `${face}: no engine aggregate read the object`).toBe(0);
          expect(asked.driver, `${face}: the driver read nothing`).toBe(0);
          messages.push(answer.message);
        }
        // One verdict: the two faces answer the same words.
        expect(messages[0], 'the engine face and the native face answer one message').toBe(messages[1]);
      };

      /** Both faces at one door, counting alike — and which strategy answered. */
      const expectBothCount = async (door: typeof cubeRead, filter: unknown, count: number) => {
        const viaEngine = await ask('engine', door(filter));
        expect(viaEngine.answer, 'the engine face').toBe(count);
        expect(viaEngine.rawSql, 'the engine face ran no raw statement').toBe(0);
        const viaNative = await ask('native', door(filter));
        expect(viaNative.answer, 'the native face').toBe(count);
        expect(viaNative.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
        expect(viaNative.aggregate, 'no engine aggregate on the native face').toBe(0);
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
        (engine as any).execute = (sql: unknown, opts?: { object?: string; args?: unknown[] }) => {
          if (opts?.object === OBJECT) reads.rawSql += 1;
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
          if (object === OBJECT) reads.aggregate += 1;
          return (realAggregate as any)(object, ...rest);
        };
        for (const verb of ['find', 'aggregate', 'count'] as const) {
          const real = driver[verb].bind(driver);
          driver[verb] = (object: string, ...rest: unknown[]) => {
            if (object === OBJECT) reads.driver += 1;
            return real(object, ...rest);
          };
        }

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
          for (const dataset of REGISTERED_REFUSED) services[face]!.registerDataset(dataset as never);
        }
      });

      afterAll(async () => {
        await dropTable();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      describe('the cube read — the `where` of POST /analytics/query', () => {
        for (const [filter, op, field, label] of REFUSED_CELLS) {
          it(`${JSON.stringify(filter)} (${label}) is one 400 on both faces`, async () => {
            await expectOneRefusal(cubeRead, filter, op, field);
          });
        }
        for (const [filter, count, label] of CONTROL_CELLS) {
          it(`CONTROL ${JSON.stringify(filter)} (${label}) counts ${count} on both faces`, async () => {
            await expectBothCount(cubeRead, filter, count);
          });
        }
      });

      describe('the dataset door — the `runtimeFilter` of POST /api/v1/analytics/dataset/query', () => {
        for (const [filter, op, field, label] of REFUSED_CELLS) {
          it(`${JSON.stringify(filter)} (${label}) is one 400 on both faces`, async () => {
            await expectOneRefusal(datasetRead, filter, op, field);
          });
        }
        for (const [filter, count, label] of CONTROL_CELLS) {
          it(`CONTROL ${JSON.stringify(filter)} (${label}) counts ${count} on both faces`, async () => {
            await expectBothCount(datasetRead, filter, count);
          });
        }
      });

      describe("a registered dataset's own scope and measure filter, read by the cube door", () => {
        for (const dataset of REGISTERED_REFUSED) {
          it(`${dataset.name} is refused on both faces, before any read`, async () => {
            for (const face of ['engine', 'native'] as const) {
              const asked = await ask(face, (svc) =>
                svc.query({ cube: dataset.name, measures: dataset.measures.map((m) => m.name) } as never) as Promise<{ rows: unknown[] }>);
              const answer = asked.answer as Refusal;
              expect({ code: answer.code, status: answer.status }, face).toEqual({ code: 'INVALID_FILTER', status: 400 });
              expect(answer.message, face).toMatch(/requires a single comparable value, but received an array/);
              expect(asked.rawSql + asked.aggregate + asked.driver, `${face}: nothing read the object`).toBe(0);
            }
          });
        }

        it('…and the save door refuses the same stored filter, in the same sentence less its location', () => {
          for (const dataset of REGISTERED_REFUSED) {
            const parsed = DatasetSchema.safeParse(dataset);
            expect(parsed.success, dataset.name).toBe(false);
            const messages = parsed.error!.issues.map((i) => i.message);
            expect(messages.some((m) => /requires a single comparable value, but received an array/.test(m)), dataset.name).toBe(true);
            expect(messages.some((m) => m.includes(' at where.')), dataset.name).toBe(false);
          }
        });
      });

      describe('the engine door, measured directly (`engine.find`, the real ObjectQL)', () => {
        it('the text cell is refused in the face\'s words now, not the driver\'s — and the driver reads nothing', async () => {
          const before = reads.driver;
          const err = await engine.find(OBJECT, { where: { note: { $gt: ['a', 'z'] } } } as never).then(
            () => null,
            (e: Error & { code?: string; status?: number }) => e,
          );
          expect(err, 'refused').not.toBeNull();
          expect({ code: err!.code, status: err!.status }).toEqual({ code: 'INVALID_FILTER', status: 400 });
          expect(err!.message).toContain(`find('${OBJECT}'): ${faceSentence('$gt', 'note')}`);
          expect(reads.driver - before, 'the driver read nothing').toBe(0);
        });

        it('CONTROL: a list at $in and a scalar at $gt are served', async () => {
          expect((await engine.find(OBJECT, { where: { note: { $in: ['b', 'y'] } } } as never)).length).toBe(2);
          expect((await engine.find(OBJECT, { where: { note: { $gt: 'a' } } } as never)).length).toBe(3);
        });
      });
    },
  );
}
