// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21426] The native-SQL strategy answers a comparand against a declared
 * NUMBER column what the engine's `where` door answers: a numeric string
 * (`'12'`, `'1e1'`) narrows to its number, and a string the platform's
 * numeric grammar does not read (`'abc'`, `''`, `'+5'`), a boolean or an array
 * is refused `INVALID_FILTER` / 400 before a statement runs. The number arm
 * joins the boolean arm's walk (#21376): one walk, two arms, the same three
 * positions.
 *
 * ## Measured on the base (`3a6d92f78`), through these doors
 *
 * Three rows (`amount` 5, 12, 30), counted by the cube read
 * (`AnalyticsService.query`, what `POST /api/v1/analytics/query` relays) and
 * the dataset door (`AnalyticsService.queryDataset`, what
 * `POST /api/v1/analytics/dataset/query` relays, its `runtimeFilter` merged
 * into the `where`), each on two faces of the plugin's own composition: the
 * native strategy (one raw statement) and the ObjectQL strategy, whose
 * `engine.aggregate` runs the engine's `where` door — the target column.
 *
 * | filter | native, SQLite | native, PostgreSQL 16 | engine door |
 * |:--|:--|:--|:--|
 * | `{ amount: 'abc' }` | **200, 0** | **500 `DATABASE_ERROR`** | 400 `INVALID_FILTER` |
 * | `{ amount: { $lte: '9999-12-31' } }` | **200, 3** | **200, 3** | 400 |
 * | `{ amount: { $ne: 'abc' } }` | **200, 3** | **500** | 400 |
 * | `{ amount: true }` | **200, 0** | **200, 0** | 400 |
 * | `{ amount: 12 }` (the control) | 1 | 1 | 1 |
 * | `{ amount: '12' }` | 1, binds `'12'` | 1, binds `'12'` | 1, binds `12` |
 *
 * The same refusals were missing from each measure's own `filter` and the
 * dataset's own scope (a 200 on SQLite, a 500 on PostgreSQL), and the bare-day
 * `$lte` met the native window rule for a calendar day at the top of the
 * range and bound nothing at all. The strategy now runs the spec's verdict
 * (`numberComparandDoorVerdict`) on every filter it compiles. Every parity
 * cell below asserts the engine face's answer AND the native face's equality
 * with it, and which strategy answered; every narrowing cell asserts the
 * native statement bound the numbers the engine handed its driver.
 *
 * ## One cell the engine face does not answer with this verdict
 *
 * Pinned on the native face alone ({@link NATIVE_ONLY_CELLS}), measured on
 * both faces: a relationship-path member (`account_credit`, the cube dimension
 * over `account.credit`). The engine face refuses every cross-object filter
 * (`INVALID_FIELD` / 400, "cannot evaluate a cross-object filter"), so it never
 * reaches a comparand. The native face joins, and judges the member at the
 * related object's declared column.
 *
 * [#21448] A second cell stood here: an array at an ordering operator
 * (`$gt: [10]`), which the shared analytics lowering handed the engine as its
 * first member (the engine face answered 200, 2) while the native face refused
 * it with this verdict. The shared comparand-shape face now refuses a list at
 * every scalar operator, whatever the column type, before either face's
 * verdict runs, so that cell is a both-faces pin in {@link CELLS}, answered in
 * the face's words, and this verdict's `array` arm is no longer reached at a
 * scalar operator.
 *
 * Each filter handed in is deep-frozen, and so is each registered dataset's
 * own `filter` and its measures' `filter`s: narrowing is copy-on-write, so an
 * edit in place would throw.
 *
 * The PostgreSQL cell runs where `OS_TEST_POSTGRES_URL` is set and is a named
 * skip otherwise; no CI step provisions that variable for this package. The
 * live cell owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os21426_amount_ledger';
const ACCOUNT = 'os21426_amount_account';

const ACCOUNT_DEF = {
  name: ACCOUNT,
  label: 'Number comparand account',
  fields: {
    name: { name: 'name', type: 'text' as const },
    credit: { name: 'credit', type: 'number' as const },
  },
};

const LEDGER = {
  name: OBJECT,
  label: 'Number comparand ledger',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    price: { name: 'price', type: 'currency' as const },
    share: { name: 'share', type: 'percent' as const },
    account: { name: 'account', type: 'lookup' as const, reference: ACCOUNT },
  },
};

const ACCOUNTS = [
  { id: 'a1', name: 'A', credit: 50 },
  { id: 'a2', name: 'B', credit: 500 },
] as const;

const ROWS = [
  { id: 'r5', note: 'n', amount: 5, price: 5, share: 0.1, account: 'a1' },
  { id: 'r12', note: 'n', amount: 12, price: 12, share: 0.5, account: 'a2' },
  { id: 'r30', note: 'n', amount: 30, price: 30, share: 0.9, account: 'a2' },
] as const;

const CUBE: Cube = {
  name: 'os21426_amount_cube',
  title: 'Number comparand cube',
  sql: OBJECT,
  public: true,
  measures: { row_count: { type: 'count', sql: '*', label: 'Rows' } },
  dimensions: {
    note: { type: 'string', sql: 'note', label: 'Note' },
    amount: { type: 'number', sql: 'amount', label: 'Amount' },
    price: { type: 'number', sql: 'price', label: 'Price' },
    share: { type: 'number', sql: 'share', label: 'Share' },
    account_credit: { type: 'number', sql: 'account.credit', label: 'Account credit' },
  },
} as Cube;

/** The inline dataset the dataset door carries. */
const INLINE = {
  name: 'os21426_amount_inline',
  label: 'Number comparand inline dataset',
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

/** A registered dataset, frozen: its own scope and its measures' filters are the positions under test. */
const registeredDataset = (name: string, filter: unknown, measureFilter: unknown) => deepFreeze({
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

/** The control: a numeric string in each position narrows, and both faces count alike. */
const REGISTERED_NARROWED = registeredDataset('os21426_amount_narrowed', { amount: { $gt: '10' } }, { amount: { $lte: '12' } });
/** One refused comparand per position. */
const REGISTERED_REFUSED = [
  registeredDataset('os21426_amount_scope_refused', { amount: 'abc' }, undefined),
  registeredDataset('os21426_amount_measure_refused', undefined, { amount: { $ne: 'abc' } }),
  registeredDataset('os21426_amount_measure_boolean', undefined, { amount: true }),
] as const;

type Refusal = { code: string; status: number };
type Answer = number | Refusal;
const REFUSED: Refusal = { code: 'INVALID_FILTER', status: 400 };

/** Each filter, the engine door's answer, and the doors it is asked at. */
const CELLS: ReadonlyArray<readonly [filter: unknown, engine: Answer, label: string]> = [
  // The card's four cells.
  [{ amount: 'abc' }, REFUSED, 'no numeric reading'],
  [{ amount: { $lte: '9999-12-31' } }, REFUSED, 'a date where a number belongs'],
  [{ amount: { $ne: 'abc' } }, REFUSED, 'the negation of a non-number'],
  [{ amount: true }, REFUSED, 'a boolean'],
  // The controls: a number.
  [{ amount: 12 }, 1, 'a number'],
  [{ amount: { $gt: 10 } }, 2, 'a number under $gt'],
  // Narrowed: the platform's numeric grammar reads each.
  [{ amount: '12' }, 1, 'a numeric string'],
  [{ amount: { $gt: '10' } }, 2, 'a numeric string under $gt'],
  [{ amount: { $gt: '1e1' } }, 2, 'an exponent spelling'],
  [{ amount: { $in: ['12', 30] } }, 2, 'a numeric string as a list member'],
  [{ amount: { $between: ['10', '40'] } }, 2, 'numeric strings as range bounds'],
  [{ $not: { amount: '12' } }, 2, 'under $not'],
  [{ price: { $gt: '10' } }, 2, 'a numeric string on a currency field'],
  [{ share: { $gt: '0.2' } }, 2, 'a numeric string on a percent field'],
  // Refused: no numeric reading, or not a number at all.
  [{ amount: false }, REFUSED, 'the other boolean'],
  [{ amount: '' }, REFUSED, 'a blank string'],
  [{ amount: { $gt: '+5' } }, REFUSED, 'a spelling JSON does not admit'],
  [{ amount: { $in: [12, 'abc'] } }, REFUSED, 'a list member with no numeric reading'],
  [{ $or: [{ amount: 'abc' }, { note: 'x' }] }, REFUSED, 'under $or'],
  [{ price: 'abc' }, REFUSED, 'a currency field'],
  [{ share: 'abc' }, REFUSED, 'a percent field'],
  // [#21448] A list where one number belongs: the shared comparand-shape face
  // refuses it before either face's verdict runs, whatever the column type.
  // Pinned on the native face alone until then, because the engine face
  // answered 200, 2 — the analytics lowering handed the engine the first member.
  [{ amount: { $gt: [10] } }, REFUSED, 'a list where one number belongs'],
  // Not the verdict's subject: the null tests.
  [{ amount: null }, 0, 'the null test'],
  [{ amount: { $ne: null } }, 3, 'the negated null test'],
  [{ amount: { $exists: true } }, 3, 'a flag operator'],
];

/**
 * Cells whose engine face is not this verdict's answer (see the module
 * header): the native face's answer alone, with the values it must bind.
 */
const NATIVE_ONLY_CELLS: ReadonlyArray<readonly [filter: unknown, native: Answer, binds: readonly unknown[] | null, label: string]> = [
  [{ account_credit: 'abc' }, REFUSED, null, 'a relationship path, judged at the related object\'s number column'],
  [{ account_credit: { $gt: '100' } }, 2, [100], 'a relationship path, narrowed at the related object\'s number column'],
];

/** Narrowing cells: the native statement binds exactly the numbers the engine handed its driver. */
const NARROWING_CELLS: ReadonlyArray<readonly [filter: unknown, count: number, binds: readonly number[]]> = [
  [{ amount: '12' }, 1, [12]],
  [{ amount: { $gt: '1e1' } }, 2, [10]],
  [{ amount: { $in: ['12', 30] } }, 2, [12, 30]],
  [{ amount: { $between: ['10', '40'] } }, 2, [10, 40]],
  [{ price: { $gt: '10' } }, 2, [10]],
  [{ share: { $gt: '0.2' } }, 2, [0.2]],
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

/** The member a refusal must name: the judged key the filter spells. */
const memberOf = (filter: unknown): string => {
  const json = JSON.stringify(filter);
  return [`${CUBE.name}.amount`, 'account_credit', 'price', 'share', 'amount'].find((m) => json.includes(`"${m}"`)) ?? 'amount';
};

/** Every number or string a filter carries, in document order — the values a driver binds. */
function boundLeaves(node: unknown): unknown[] {
  if (typeof node === 'number' || typeof node === 'string') return [node];
  if (Array.isArray(node)) return node.flatMap(boundLeaves);
  if (node !== null && typeof node === 'object') return Object.values(node).flatMap(boundLeaves);
  return [];
}

for (const cell of DRIVER_CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21426] analytics native SQL — a number comparand answers what the engine door answers (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates that read THIS object, and what each bound. */
      const reads = { rawSql: 0, aggregate: 0, rawArgs: [] as unknown[][], driverWhere: [] as unknown[] };
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        await driver?.execute(`drop table if exists ${OBJECT}`).catch(() => {});
        await driver?.execute(`drop table if exists ${ACCOUNT}`).catch(() => {});
      };

      /** The total count a face answers, or its refusal envelope, and what read the object. */
      const ask = async (face: Face, run: (svc: AnalyticsService) => Promise<{ rows: unknown[] }>) => {
        const before = { rawSql: reads.rawSql, aggregate: reads.aggregate };
        reads.rawArgs.length = 0;
        reads.driverWhere.length = 0;
        const answer = await run(services[face]!).then(
          (res) => (res.rows as Array<Record<string, unknown>>).reduce((sum, r) => sum + Number(r.row_count ?? 0), 0) as Answer,
          (e: Error & { code?: string; status?: number }) => ({ code: String(e.code), status: Number(e.status), message: e.message }) as Answer,
        );
        return {
          answer,
          rawSql: reads.rawSql - before.rawSql,
          aggregate: reads.aggregate - before.aggregate,
          rawArgs: reads.rawArgs.flat(),
          driverLeaves: reads.driverWhere.flatMap(boundLeaves),
        };
      };

      const cubeRead = (where: unknown) => (svc: AnalyticsService) =>
        svc.query({ cube: CUBE.name, measures: ['row_count'], where: deepFreeze(structuredClone(where)) } as never) as Promise<{ rows: unknown[] }>;
      const datasetRead = (runtimeFilter: unknown) => (svc: AnalyticsService) =>
        svc.queryDataset(INLINE as never, { measures: ['row_count'], dimensions: ['note'], runtimeFilter: deepFreeze(structuredClone(runtimeFilter)) } as never) as Promise<{ rows: unknown[] }>;

      const strip = (a: Answer) => (typeof a === 'number' ? a : { code: a.code, status: a.status });

      /** The native face's answer at one door, and — refused — that no statement ran and the words name the member. */
      const expectNative = async (door: (filter: unknown) => (svc: AnalyticsService) => Promise<{ rows: unknown[] }>, filter: unknown, expected: Answer, member: string) => {
        const viaNative = await ask('native', door(filter));
        expect(strip(viaNative.answer), 'the native strategy').toEqual(expected);
        if (typeof expected === 'number') {
          expect(viaNative.rawSql, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
          expect(viaNative.aggregate, 'no engine aggregate on the native face').toBe(0);
        } else {
          expect(viaNative.rawSql, 'refused before any statement ran').toBe(0);
          const message = (viaNative.answer as { message?: string }).message ?? '';
          // The number verdict quotes the member '…'; the shared comparand-shape
          // face, which answers a list first (#21448), quotes it "…".
          expect([`'${member}'`, `"${member}"`].some((quoted) => message.includes(quoted)), message).toBe(true);
          expect(message).toContain('where');
        }
        return viaNative;
      };

      /** Both faces at one door: the engine face answers `engine`, the native face the same. */
      const expectBothFaces = async (door: (filter: unknown) => (svc: AnalyticsService) => Promise<{ rows: unknown[] }>, filter: unknown, engineAnswer: Answer, member = memberOf(filter)) => {
        const viaEngine = await ask('engine', door(filter));
        expect(strip(viaEngine.answer), 'the engine door').toEqual(engineAnswer);
        expect(viaEngine.rawSql, 'the engine face ran no raw statement').toBe(0);
        const viaNative = await expectNative(door, filter, engineAnswer, member);
        return { viaEngine, viaNative };
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        engine.registry.registerObject(ACCOUNT_DEF as any);
        engine.registry.registerObject(LEDGER as any);
        await engine.syncSchemas();
        for (const row of ACCOUNTS) await engine.insert(ACCOUNT, { ...row } as any);
        for (const row of ROWS) await engine.insert(OBJECT, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: { object?: string; args?: unknown[] }) => {
          if (opts?.object === OBJECT) {
            reads.rawSql += 1;
            reads.rawArgs.push([...(opts.args ?? [])]);
          }
          return realExecute(sql, opts);
        };
        const realAggregate = engine.aggregate.bind(engine);
        (engine as any).aggregate = (object: string, ...rest: unknown[]) => {
          if (object === OBJECT) reads.aggregate += 1;
          return (realAggregate as any)(object, ...rest);
        };
        // What the engine door handed its driver — the target the native statement's binds are held to.
        const realDriverAggregate = driver.aggregate.bind(driver);
        driver.aggregate = (object: string, query: { where?: unknown }, ...rest: unknown[]) => {
          if (object === OBJECT) reads.driverWhere.push(query?.where);
          return realDriverAggregate(object, query, ...rest);
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
          for (const dataset of [REGISTERED_NARROWED, ...REGISTERED_REFUSED]) services[face]!.registerDataset(dataset as never);
        }
      });

      afterAll(async () => {
        await dropTables();
        try { await engine?.destroy(); } catch { /* noop */ }
      });

      describe('the cube read — the `where` of POST /analytics/query', () => {
        for (const [filter, engineAnswer, label] of CELLS) {
          it(`${JSON.stringify(filter)} (${label}) answers ${JSON.stringify(engineAnswer)}`, async () => {
            await expectBothFaces(cubeRead, filter, engineAnswer);
          });
        }

        it('the FilterArray spelling and the cube-qualified member are judged too', async () => {
          await expectBothFaces(cubeRead, [['amount', '=', 'abc']], REFUSED);
          await expectBothFaces(cubeRead, [['amount', '>', '10']], 2);
          await expectBothFaces(cubeRead, { [`${CUBE.name}.amount`]: 'abc' }, REFUSED);
        });

        it('a numeric string binds the number the engine handed its driver, never the string', async () => {
          for (const [filter, count, binds] of NARROWING_CELLS) {
            const { viaEngine, viaNative } = await expectBothFaces(cubeRead, filter, count);
            expect(viaEngine.driverLeaves, `${JSON.stringify(filter)}: what the engine door handed its driver`).toEqual(binds);
            expect(viaNative.rawArgs, `${JSON.stringify(filter)}: what the native statement bound`).toEqual(binds);
          }
        });

        for (const [filter, nativeAnswer, binds, label] of NATIVE_ONLY_CELLS) {
          it(`${JSON.stringify(filter)} (${label}) answers ${JSON.stringify(nativeAnswer)} on the native face`, async () => {
            const viaNative = await expectNative(cubeRead, filter, nativeAnswer, memberOf(filter));
            if (binds) expect(viaNative.rawArgs, 'what the native statement bound').toEqual(binds);
          });
        }
      });

      describe('the dataset door — the `runtimeFilter` of POST /api/v1/analytics/dataset/query', () => {
        for (const [filter, engineAnswer, label] of CELLS) {
          it(`${JSON.stringify(filter)} (${label}) answers ${JSON.stringify(engineAnswer)}`, async () => {
            await expectBothFaces(datasetRead, filter, engineAnswer);
          });
        }
      });

      describe("a registered dataset's own scope and measure filter, read by the cube door", () => {
        it("`filter: { amount: { $gt: '10' } }` scopes to two rows, and `filter: { amount: { $lte: '12' } }` on a measure counts one of them — both bound as numbers", async () => {
          for (const face of ['engine', 'native'] as const) {
            const before = reads.rawSql;
            reads.rawArgs.length = 0;
            const res = await services[face]!.query({ cube: REGISTERED_NARROWED.name, measures: ['row_count', 'scoped_count'] } as never) as { rows: Array<Record<string, unknown>> };
            const total = (m: string) => res.rows.reduce((sum, r) => sum + Number(r[m] ?? 0), 0);
            expect(total('row_count'), `${face}: the dataset scope keeps two rows`).toBe(2);
            expect(total('scoped_count'), `${face}: the measure filter keeps one of them`).toBe(1);
            if (face === 'native') {
              expect(reads.rawSql - before, 'NativeSQLStrategy answered').toBeGreaterThanOrEqual(1);
              const bound = reads.rawArgs.flat();
              expect(bound, 'the scope and the measure filter bind numbers').toEqual(expect.arrayContaining([10, 12]));
              expect(bound.filter((v) => typeof v === 'string'), 'no numeric string reached the statement').toEqual([]);
            }
          }
        });

        for (const dataset of REGISTERED_REFUSED) {
          it(`${dataset.name}: ${JSON.stringify(dataset.filter ?? dataset.measures[1]?.filter)} is refused on both faces`, async () => {
            for (const face of ['engine', 'native'] as const) {
              const before = reads.rawSql;
              const answer = await services[face]!.query({ cube: dataset.name, measures: dataset.measures.map((m) => m.name) } as never).then(
                () => 'answered' as const,
                (e: Error & { code?: string; status?: number }) => ({ code: String(e.code), status: Number(e.status) }),
              );
              expect(answer, `${face}: refused`).toEqual(REFUSED);
              expect(reads.rawSql - before, `${face}: no statement ran`).toBe(0);
            }
          });
        }
      });
    },
  );
}
