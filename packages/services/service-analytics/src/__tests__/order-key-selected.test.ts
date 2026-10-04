// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21267] An analytics `order` key must name a member the query selects — a
 * `dimensions` entry, a `measures` entry, or a `timeDimensions` entry with a
 * `granularity` — or the analytics door refuses the query `INVALID_FIELD` /
 * 400, on the native-SQL and the ObjectQL face alike, before either strategy
 * runs (`order-key-door.ts`).
 *
 * ## The shape this closes
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `3196ef1a1`, SQLite and PostgreSQL 16.14. The cube over `deal` declares no
 * join; `owner` is a lookup whose target also declares `note` and `amount`:
 *
 * | query | native SQLite | native PostgreSQL | ObjectQL face |
 * |:--|:--|:--|:--|
 * | `dimensions: ['owner.email']`, `order: { note }` | 500 | 500 (42702) | 200 |
 * | `dimensions: ['note']`, `order: { amount }` | 200, arbitrary order | 500 (42803) | 200 |
 * | `dimensions: ['note']`, `order: { 'owner.email' }` | 500 | 500 (42703) | 200 |
 *
 * Every refusal pin below also asserts nothing ran: no raw statement and no
 * engine aggregate, on either face.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; CI provisions
 * that variable for this package in the Temporal Conformance job's step
 * "Run the non-SQL temporal backends under the skewed process zone"
 * (`.github/workflows/ci.yml`), so the live cell is red-capable and runs in
 * CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const PERSON = 'os21267_person';
const DEAL = 'os21267_deal';

/** The lookup's target declares `note` and `amount` too, so an unqualified ORDER BY over a join is ambiguous. */
const PERSON_OBJECT = {
  name: PERSON,
  label: 'Order key person',
  fields: {
    email: { name: 'email', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
  },
};

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Order key deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    closed_on: { name: 'closed_on', type: 'date' as const },
    owner: { name: 'owner', type: 'lookup' as const, reference: PERSON },
  },
};

const PEOPLE = [
  { id: 'p1', email: 'a@x', note: 'pn1', amount: 100 },
  { id: 'p2', email: 'b@x', note: 'pn2', amount: 200 },
] as const;
// Groups by `note`: x (2 rows, amount 15), y (1, 7), z (1, 1). Neither the
// note order nor the amount order matches insertion order reversed.
const DEALS = [
  { id: 'd1', note: 'x', amount: 10, closed_on: '2026-03-01', owner: 'p1' },
  { id: 'd2', note: 'x', amount: 5, closed_on: '2026-03-02', owner: 'p1' },
  { id: 'd3', note: 'y', amount: 7, closed_on: '2026-04-03', owner: 'p2' },
  { id: 'd4', note: 'z', amount: 1, closed_on: '2026-05-01', owner: 'p2' },
] as const;

/** The card's cube: it declares NO join, so `owner` is joined through the lookup's declared `reference`. */
const CUBE = 'os21267_cube';
const CUBES = [
  {
    name: CUBE,
    title: 'Order key cube',
    sql: DEAL,
    public: true,
    measures: {
      count: { type: 'count', sql: '*', label: 'Rows' },
      amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' },
    },
    dimensions: {
      note: { type: 'string', sql: 'note', label: 'Note' },
      closed_on: { type: 'time', sql: 'closed_on', label: 'Closed on' },
    },
  },
] as unknown as Cube[];

/** The card's three rows: each orders by a key the query does not select. */
const CARD_ROWS = [
  {
    label: 'an unselected base column beside a relationship path (ambiguous on the native face)',
    query: { cube: CUBE, measures: ['count'], dimensions: ['owner.email'], order: { note: 'asc' } },
    key: 'note',
    selected: ['owner.email', 'count'],
  },
  {
    label: 'an unselected base column with no join (an arbitrary row on SQLite, 42803 on PostgreSQL)',
    query: { cube: CUBE, measures: ['count'], dimensions: ['note'], order: { amount: 'asc' } },
    key: 'amount',
    selected: ['note', 'count'],
  },
  {
    label: 'an unselected relationship path',
    query: { cube: CUBE, measures: ['count'], dimensions: ['note'], order: { 'owner.email': 'asc' } },
    key: 'owner.email',
    selected: ['note', 'count'],
  },
] as const;

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

type Row = Record<string, unknown>;
type Refusal = Error & { code?: string; status?: number; field?: string; param?: string };

/** Rows as tuples of the named columns, in the order they arrived; a measure reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  (rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c])));
const sorted = (list: unknown[][]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21267] an analytics order key must name a member the query selects (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
    () => {
      let driver: any;
      let engine: ObjectQL;
      /** Raw-SQL statements and engine aggregates, on any object. */
      const reads = { rawSql: 0, aggregate: 0 };
      /** `native`: the plugin's own capabilities. `objectql`: narrowed to the engine-aggregate path. */
      const services: Partial<Record<Face, AnalyticsService>> = {};

      const dropTables = async () => {
        if (cell.id !== 'pg') return;
        for (const table of [DEAL, PERSON]) await driver?.execute(`drop table if exists ${table}`).catch(() => {});
      };

      /** One call on one face: its result or its error, and the reads it caused. */
      const call = async (face: Face, door: 'query' | 'generateSql', query: Record<string, unknown>) => {
        const before = { ...reads };
        const outcome = await (services[face]![door] as (q: any) => Promise<any>).call(services[face], query as any).then(
          (res) => ({ res, err: undefined as Refusal | undefined }),
          (err) => ({ res: undefined, err: err as Refusal }),
        );
        return { ...outcome, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
      };

      /** Both doors on both faces refuse `query` with the order-key envelope, and nothing ran. */
      const refusedEverywhere = async (query: Record<string, unknown>, key: string, selected: readonly string[]) => {
        for (const face of FACES) {
          for (const door of ['query', 'generateSql'] as const) {
            const { res, err, rawSql, aggregate } = await call(face, door, query);
            const where = `${face} ${door}`;
            expect(res, `${where}: answered instead of refusing`).toBeUndefined();
            expect(err?.code, `${where}: ${err?.message}`).toBe('INVALID_FIELD');
            expect(err?.status, where).toBe(400);
            expect(err?.param, where).toBe('order');
            expect(err?.field, where).toBe(key);
            // The refusal names the offending key and every member the query does select.
            for (const name of [key, ...selected]) expect(err?.message, where).toContain(`${name}`);
            expect(rawSql, `${where}: no raw statement ran`).toBe(0);
            expect(aggregate, `${where}: no engine aggregate ran`).toBe(0);
          }
        }
      };

      beforeAll(async () => {
        driver = new SqlDriver(config as any);
        await dropTables();
        engine = new ObjectQL({ logger: quiet } as any);
        engine.registerDriver(driver, true);
        await engine.init();
        for (const object of [PERSON_OBJECT, DEAL_OBJECT]) engine.registry.registerObject(object as any);
        await engine.syncSchemas();
        for (const row of PEOPLE) await engine.insert(PERSON, { ...row } as any);
        for (const row of DEALS) await engine.insert(DEAL, { ...row } as any);

        const realExecute = (engine as any).execute.bind(engine);
        (engine as any).execute = (sql: unknown, opts?: unknown) => {
          reads.rawSql += 1;
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
          await new AnalyticsServicePlugin({ cubes: CUBES, ...(caps ? { queryCapabilities: caps } : {}) } as any).init({
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

      for (const row of CARD_ROWS) {
        it(`the card's row is refused 400 INVALID_FIELD on both faces and both doors: ${row.label}`, async () => {
          await refusedEverywhere(row.query, row.key, row.selected);
        });
      }

      it('a time-dimension entry that only windows the rows is not a column, so ordering by it is refused', async () => {
        await refusedEverywhere(
          {
            cube: CUBE,
            measures: ['count'],
            dimensions: ['note'],
            timeDimensions: [{ dimension: 'closed_on', dateRange: ['2026-03-01', '2026-05-31'] }],
            order: { closed_on: 'asc' },
          },
          'closed_on',
          ['note', 'count'],
        );
      });

      it('a key matches by its exact spelling: a qualified spelling of a measure selected bare names no column', async () => {
        await refusedEverywhere(
          { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { [`${CUBE}.amount_sum`]: 'desc' } },
          `${CUBE}.amount_sum`,
          ['note', 'amount_sum'],
        );
      });

      it('CONTROL ordering by a selected dimension is served unchanged on both faces', async () => {
        const query = { cube: CUBE, measures: ['count'], dimensions: ['note'], order: { note: 'desc' } };
        for (const face of FACES) {
          const { res, err } = await call(face, 'query', query);
          expect(err, `${face}: ${err?.message}`).toBeUndefined();
          const got = tuples(res.rows, ['note', 'count']);
          // Both faces apply the ORDER BY (the ObjectQL face since #21316).
          expect(got, face).toEqual([['z', 1], ['y', 1], ['x', 2]]);
          const { res: dry, err: dryErr } = await call(face, 'generateSql', query);
          expect(dryErr, `${face} dry run: ${dryErr?.message}`).toBeUndefined();
          expect(dry.sql, face).toContain('ORDER BY "note" DESC');
        }
      });

      it('CONTROL ordering by a selected measure is served unchanged on both faces', async () => {
        const query = { cube: CUBE, measures: ['amount_sum'], dimensions: ['note'], order: { amount_sum: 'desc' } };
        for (const face of FACES) {
          const { res, err } = await call(face, 'query', query);
          expect(err, `${face}: ${err?.message}`).toBeUndefined();
          const got = tuples(res.rows, ['note', 'amount_sum']);
          expect(got, face).toEqual([['x', 15], ['y', 7], ['z', 1]]);
          const { res: dry, err: dryErr } = await call(face, 'generateSql', query);
          expect(dryErr, `${face} dry run: ${dryErr?.message}`).toBeUndefined();
          expect(dry.sql, face).toContain('ORDER BY "amount_sum" DESC');
        }
      });

      it('CONTROL a bucketed time dimension is a column the answer carries, so ordering by it is served', async () => {
        const query = {
          cube: CUBE,
          measures: ['count'],
          timeDimensions: [{ dimension: 'closed_on', granularity: 'month' }],
          order: { closed_on: 'asc' },
        };
        for (const face of FACES) {
          const { res, err } = await call(face, 'query', query);
          expect(err, `${face}: ${err?.message}`).toBeUndefined();
          // Three month buckets (March, April, May), whichever face served them.
          expect((res.rows as Row[]).length, face).toBe(3);
          expect(sorted(tuples(res.rows, ['count'])), face).toEqual([[1], [1], [2]]);
        }
      });
    },
  );
}
