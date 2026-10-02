// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21437] A caller-named measure whose inferred source names no field is
 * refused at the analytics door, `INVALID_FIELD` / 400 naming the spelling the
 * caller sent, before either strategy reads anything.
 *
 * ## The shape this closes
 *
 * `inferMeasure` strips an aggregation suffix and aggregates what precedes it.
 * For an EMPTY prefix it minted the row wildcard (`key.slice(…) || '*'`), so
 * `_sum` became `{ type: 'sum', sql: '*' }`; the member-shape gate admits `'*'`
 * as a column reference, and the strategies emit the operand verbatim.
 * Measured through `POST /api/v1/analytics/query` on `origin/main`
 * `713b0fa76` (the runtime dispatcher's door composition, SQLite, both
 * strategies, an ad-hoc cube and an authored cube that does not declare the
 * member): every suffix with an empty prefix answered `500 DATABASE_ERROR`
 * after a statement reached the engine, except `_count_distinct` on the
 * ObjectQL strategy, which the engine refused `400 INVALID_QUERY` after the
 * aggregate was called. The same mint also passed the row wildcard and the
 * empty string through VERBATIM — `*`, `*_sum`, `''` — with the same 500.
 *
 * ## What these pins hold
 *
 * - **The enumeration.** Every suffix `inferMeasure` strips — read from
 *   `INFERRED_MEASURE_SUFFIXES`, the list the mint itself iterates, never
 *   restated here — with an empty prefix, bare and `<cube>.`-qualified, on
 *   both strategies, on an ad-hoc cube and on an authored cube that does not
 *   declare the member, is refused `INVALID_FIELD` / 400 naming the spelling
 *   sent, with zero raw statements and zero engine aggregates. So are the
 *   other spellings whose source names no field (`*`, `*<suffix>`, `''`).
 * - **The controls.** The bare `count` is still `COUNT(*)`; `amount_sum` and
 *   an authored `amount_total` answer the true sum; a member an authored cube
 *   DECLARES under an empty-prefix name (`CubeSchema` admits any measure key)
 *   is the cube's own vocabulary, never minted, and is served.
 * - **By construction.** For every caller spelling the corpus generates, the
 *   source the member-shape gate reads (`inferredCallerMeasureSql`) is `'*'`
 *   only for a spelling that reduces to `count`, so the gate's `'*'`
 *   pass-through decides nothing about aggregates.
 *
 * `AnalyticsService.query()` / `generateSql()` are what the dispatcher's
 * `POST /api/v1/analytics/query` and `/sql` routes call one-to-one, and the
 * dispatcher carries a thrown `code` / `status` to the wire unchanged — the
 * same `INVALID_FIELD` / 400 crossing is pinned at the route by
 * `packages/runtime/src/analytics-json-dimension-door.test.ts`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import {
  AnalyticsService,
  INFERRED_MEASURE_SUFFIXES,
  inferMeasure,
  inferredCallerMeasureSql,
} from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const OBJECT = 'os21437_deal';

const DEAL = {
  name: OBJECT,
  label: 'Caller measure ledger',
  fields: {
    title: { name: 'title', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const ROWS = [
  { id: 'd1', title: 'x', amount: 100 },
  { id: 'd2', title: 'x', amount: 300 },
  { id: 'd3', title: 'y', amount: 1000 },
] as const;

/** Sum of `amount` over ROWS. */
const TRUE_SUM = 1400;

/** An authored cube that declares NO empty-prefix member: every one is minted. */
const AUTHORED: Cube = {
  name: 'os21437_cube',
  title: 'Caller measure cube',
  sql: OBJECT,
  public: true,
  measures: {
    count: { type: 'count', sql: '*', label: 'Rows' },
    amount_total: { type: 'sum', sql: 'amount', label: 'Total amount' },
  },
  dimensions: { title: { type: 'string', sql: 'title', label: 'Title' } },
} as Cube;

/** An authored cube that DECLARES a member under an empty-prefix name. */
const DECLARES_EMPTY_PREFIX_NAME: Cube = {
  name: 'os21437_declared_cube',
  title: 'Declared empty-prefix name',
  sql: OBJECT,
  public: true,
  measures: {
    _sum: { type: 'sum', sql: 'amount', label: 'Total amount, under an empty-prefix key' },
  },
  dimensions: { title: { type: 'string', sql: 'title', label: 'Title' } },
} as Cube;

const SUFFIXES = INFERRED_MEASURE_SUFFIXES.map(([suffix]) => suffix);

/** The other spellings whose source names no field: the wildcard, wildcard + suffix, empty. */
const OTHER_NO_FIELD = ['*', ...SUFFIXES.map((s) => `*${s}`), ''];

const SHAPES = [
  { label: 'an ad-hoc cube', cube: OBJECT },
  { label: 'an authored cube that does not declare the member', cube: AUTHORED.name },
] as const;

const FACES = ['native', 'objectql'] as const;
type Face = (typeof FACES)[number];

const quiet = { debug() {}, info() {}, warn() {}, error() {}, child() { return quiet; } };

type Refusal = Error & { code?: string; status?: number; member?: string; param?: string; cube?: string; field?: string };

const refusalOf = (pending: Promise<unknown>): Promise<Refusal> =>
  pending.then<never, Refusal>(
    () => {
      throw new Error('expected the request to be refused, but it resolved');
    },
    (e) => e as Refusal,
  );

describe('[#21437] a caller-named measure whose source names no field — at the analytics door (sqlite)', () => {
  let engine: ObjectQL;
  /** Raw-SQL statements and engine aggregates that read THIS object. */
  const reads = { rawSql: 0, aggregate: 0 };
  const services: Partial<Record<Face, AnalyticsService>> = {};

  const read = async (face: Face, cube: string, measures: readonly string[]) => {
    const before = { ...reads };
    const outcome = await services[face]!.query({ cube, measures: [...measures] } as any).then(
      (res) => ({ res, err: undefined as Refusal | undefined }),
      (err) => ({ res: undefined, err: err as Refusal }),
    );
    return { ...outcome, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
  };

  beforeAll(async () => {
    const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true } as any);
    engine = new ObjectQL({ logger: quiet } as any);
    engine.registerDriver(driver, true);
    await engine.init();
    engine.registry.registerObject(DEAL as any);
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

    // The plugin's own composition over the real engine, both auto-bridges
    // live; `objectql` narrows the capabilities to the engine-aggregate path.
    for (const [face, caps] of [
      ['native', undefined],
      ['objectql', () => ({ nativeSql: false, objectqlAggregate: true, inMemory: false })],
    ] as const) {
      const registered: Record<string, unknown> = {};
      await new AnalyticsServicePlugin({
        cubes: [AUTHORED, DECLARES_EMPTY_PREFIX_NAME],
        ...(caps ? { queryCapabilities: caps } : {}),
      } as any).init({
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
    try { await engine?.destroy(); } catch { /* noop */ }
  });

  it('the enumeration reads the mint\'s own suffix list, and it is not empty', () => {
    expect(SUFFIXES.length).toBeGreaterThan(0);
  });

  for (const face of FACES) {
    describe(`${face} strategy`, () => {
      for (const { label, cube } of SHAPES) {
        it(`every suffix the mint strips, with an empty prefix, is refused INVALID_FIELD / 400 naming the spelling — ${label}`, async () => {
          for (const spelling of SUFFIXES.flatMap((s) => [s, `${cube}.${s}`])) {
            const { res, err, rawSql, aggregate } = await read(face, cube, [spelling]);
            expect(res, `${spelling} must not be served`).toBeUndefined();
            expect(err?.code, `${spelling}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status, spelling).toBe(400);
            expect(err?.member, spelling).toBe(spelling);
            expect(err?.param, spelling).toBe('measures');
            expect(err?.cube, spelling).toBe(cube);
            expect(err?.field, `${spelling}: there is no field to name`).toBeUndefined();
            expect(err?.message, spelling).toContain(`Measure '${spelling}' on cube '${cube}'`);
            expect(rawSql, `${spelling}: no raw statement ran`).toBe(0);
            expect(aggregate, `${spelling}: no engine aggregate ran`).toBe(0);
          }
        });

        it(`the other spellings whose source names no field (*, *<suffix>, '') are refused the same way — ${label}`, async () => {
          for (const spelling of [...OTHER_NO_FIELD, `${cube}.*`, `${cube}.`]) {
            const { res, err, rawSql, aggregate } = await read(face, cube, [spelling]);
            expect(res, `${JSON.stringify(spelling)} must not be served`).toBeUndefined();
            expect(err?.code, `${JSON.stringify(spelling)}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status, spelling).toBe(400);
            expect(err?.member, spelling).toBe(spelling);
            expect(err?.param, spelling).toBe('measures');
            expect(rawSql + aggregate, `${JSON.stringify(spelling)}: nothing was read`).toBe(0);
          }
        });

        it(`CONTROL the bare count is COUNT(*), and amount_sum is the true sum — ${label}`, async () => {
          const count = await read(face, cube, ['count']);
          expect(count.err, count.err?.message).toBeUndefined();
          expect(Number(count.res!.rows[0]!.count)).toBe(ROWS.length);
          const statement = await services[face]!.generateSql({ cube, measures: ['count'] } as any);
          expect(statement.sql, 'the count reads the row wildcard').toMatch(/COUNT\(\*\)/i);

          const sum = await read(face, cube, ['amount_sum']);
          expect(sum.err, sum.err?.message).toBeUndefined();
          expect(Number(sum.res!.rows[0]!.amount_sum)).toBe(TRUE_SUM);
        });
      }

      it('CONTROL the authored cube\'s own amount_total is the true sum', async () => {
        const { res, err } = await read(face, AUTHORED.name, ['amount_total']);
        expect(err, err?.message).toBeUndefined();
        expect(Number(res!.rows[0]!.amount_total)).toBe(TRUE_SUM);
      });

      it('CONTROL a member an authored cube DECLARES under an empty-prefix name is its own vocabulary — served, never minted', async () => {
        const { res, err } = await read(face, DECLARES_EMPTY_PREFIX_NAME.name, ['_sum']);
        expect(err, err?.message).toBeUndefined();
        expect(Number(res!.rows[0]!._sum)).toBe(TRUE_SUM);
      });

      it('the dry-run door refuses what the query door refuses, and shows COUNT(*) for the control', async () => {
        for (const spelling of SUFFIXES) {
          const err = await refusalOf(services[face]!.generateSql({ cube: AUTHORED.name, measures: [spelling] } as any));
          expect(err.code, `${spelling}: ${err.message}`).toBe('INVALID_FIELD');
          expect(err.status, spelling).toBe(400);
          expect(err.member, spelling).toBe(spelling);
        }
        const control = await services[face]!.generateSql({ cube: AUTHORED.name, measures: ['count'] } as any);
        expect(control.sql).toMatch(/COUNT\(\*\)/i);
      });
    });
  }
});

describe('[#21437] by construction: a \'*\' reaches the member-shape gate only together with count', () => {
  const CUBE = AUTHORED.name;
  const PREFIXES = ['', '*', '**', ' ', '_', 'amount', 'count'];
  const TAILS = ['', ...SUFFIXES];
  const QUALIFIERS = ['', `${CUBE}.`, 'other.'];
  const CORPUS = [...new Set(QUALIFIERS.flatMap((q) => PREFIXES.flatMap((p) => TAILS.map((t) => `${q}${p}${t}`))))];
  /** The spellings that reduce to the bare `count`, once the cube qualifier is stripped. */
  const COUNT_SPELLINGS = new Set(['count', `${CUBE}.count`]);

  it('for every caller spelling the corpus generates, the gate input is \'*\' only for count, and the mint pairs it with count', () => {
    let wildcards = 0;
    let refusals = 0;
    for (const spelling of CORPUS) {
      let source: string | null;
      try {
        source = inferredCallerMeasureSql(spelling, CUBE);
      } catch (e) {
        const err = e as Refusal;
        expect(err.code, `${JSON.stringify(spelling)}: ${err.message}`).toBe('INVALID_FIELD');
        expect(err.status, spelling).toBe(400);
        expect(err.member, spelling).toBe(spelling);
        refusals += 1;
        continue;
      }
      if (source !== '*') continue;
      wildcards += 1;
      expect(COUNT_SPELLINGS.has(spelling), `${JSON.stringify(spelling)} reaches the gate as '*' but is not count`).toBe(true);
      const key = spelling.startsWith(`${CUBE}.`) ? spelling.slice(CUBE.length + 1) : spelling;
      expect(inferMeasure(key, { member: spelling, cube: CUBE }).type, spelling).toBe('count');
    }
    // The corpus must exercise both arms, or this pin could pass over nothing.
    expect(wildcards, 'the count spellings reached the gate as the row wildcard').toBe(COUNT_SPELLINGS.size);
    expect(refusals, 'the no-field spellings were refused').toBeGreaterThanOrEqual(2 * SUFFIXES.length);
  });
});
