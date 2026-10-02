// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#21249] On the native-SQL face, a base-table column is qualified with the
 * base table exactly when the STATEMENT joins something — read off the joins
 * the one hop resolver (`hop-object.ts`) registered for the query, never off
 * whether the cube declares `joins`.
 *
 * ## The shape this closes
 *
 * Measured through `POST /api/v1/analytics/query` on the real dispatcher route
 * at `4727fcb2`, SQLite and PostgreSQL 16.14. A configured cube over `deal`
 * declares NO join; `owner` is a lookup whose `reference` is the person
 * object, which declares `note`, `amount` and `closed_on` too:
 *
 * | query | native face | ObjectQL face |
 * |:--|:--|:--|
 * | dimensions `note` + `owner.email` | 500 (SQLite "ambiguous column name: note"; PostgreSQL 42702) | 200 |
 * | the same with `where: { note }` and `order: { note }` | 500 | 200 |
 * | `sum(amount)` by `owner.email` | 500 (42702 on `amount`) | 200 |
 * | a `closed_on` time-dimension window by `owner.email` | 500 (42702 on `closed_on`) | 200 |
 * | `where: { id }` (a member the cube does not declare) by `owner.email` | 500 (42702 on `id`) | 200 |
 * | control: the same pair on a cube that declares the join | 200 | 200 |
 *
 * The statement joined `owner` through the lookup's declared `reference`
 * (the resolver's tier 2) while `qualifyAndRegisterJoin` qualified base
 * columns only for a cube declaring `joins`: `SELECT note AS "note", … LEFT
 * JOIN "<person>" "owner" … GROUP BY note, …`.
 *
 * ## Why the statement is compiled twice
 *
 * Joins are registered lazily — by whichever member walks a relationship path
 * first — and an absorbed `$or` takes back the joins its branches registered,
 * so "does this statement join anything" is known only after every member
 * has been resolved. In the card's own pair `note` resolves before
 * `owner.email` registers the join. `generateSql` compiles once with bare base
 * columns and, when that compile registered a join, once more with every base
 * column qualified; the "join registered by a later member" pin below is the
 * one a call-time read of the join set fails.
 *
 * ## The dialect axis of THIS file
 *
 * The SQLite cell always runs. The PostgreSQL cell runs where
 * `OS_TEST_POSTGRES_URL` is set and is a named skip otherwise; no CI step
 * provisions that variable for this package, so the live cell is red-capable
 * and un-run in CI, and the PR that landed this file carries its local
 * PostgreSQL 16 run. The live cell owns its tables, dropped before and after.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import type { Cube } from '@objectstack/spec/data';
import type { AnalyticsService } from '../analytics-service.js';
import { AnalyticsServicePlugin } from '../plugin.js';

const PERSON = 'os21249_person';
const DEAL = 'os21249_deal';

/** The lookup's target declares a column of every name the base columns below use. */
const PERSON_OBJECT = {
  name: PERSON,
  label: 'Base-column qualification person',
  fields: {
    email: { name: 'email', type: 'text' as const },
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    closed_on: { name: 'closed_on', type: 'date' as const },
  },
};

const DEAL_OBJECT = {
  name: DEAL,
  label: 'Base-column qualification deal',
  fields: {
    note: { name: 'note', type: 'text' as const },
    amount: { name: 'amount', type: 'number' as const },
    closed_on: { name: 'closed_on', type: 'date' as const },
    // Named after nothing the cube joins: only the declared `reference` reaches the person.
    owner: { name: 'owner', type: 'lookup' as const, reference: PERSON },
  },
};

// The person rows carry values that would change every answer below if the
// statement read the PERSON's `note` / `amount` / `closed_on` instead.
const PEOPLE = [
  { id: 'p1', email: 'a@x', note: 'pn1', amount: 100, closed_on: '2026-01-01' },
  { id: 'p2', email: 'b@x', note: 'pn2', amount: 200, closed_on: '2026-01-01' },
] as const;
const DEALS = [
  { id: 'd1', note: 'x', amount: 10, closed_on: '2026-03-01', owner: 'p1' },
  { id: 'd2', note: 'x', amount: 5, closed_on: '2026-03-02', owner: 'p1' },
  { id: 'd3', note: 'y', amount: 7, closed_on: '2026-03-03', owner: 'p2' },
  { id: 'd4', note: 'x', amount: 1, closed_on: '2026-05-01', owner: 'p2' },
] as const;

const MEMBERS = {
  measures: {
    count: { type: 'count', sql: '*', label: 'Rows' },
    amount_sum: { type: 'sum', sql: 'amount', label: 'Amount' },
  },
  dimensions: {
    note: { type: 'string', sql: 'note', label: 'Note' },
    closed_on: { type: 'time', sql: 'closed_on', label: 'Closed on' },
  },
};

/** The card's cube: it declares NO join. */
const NO_JOIN = 'os21249_no_join';
/** The control: the same members, with the join declared. */
const DECLARED = 'os21249_declared';

const CUBES = [
  { name: NO_JOIN, title: 'No declared join', sql: DEAL, public: true, ...MEMBERS },
  { name: DECLARED, title: 'Declared join', sql: DEAL, public: true, ...MEMBERS, joins: { owner: { name: PERSON } } },
] as unknown as Cube[];

/** The card's pair, grouped by the DEAL's `note`: (note, owner email, rows). */
const PAIR_GROUPS = [['x', 'a@x', 2], ['x', 'b@x', 1], ['y', 'b@x', 1]];

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

/** Tuples in one order, so two faces' row orders compare equal. */
const sorted = (tuples: unknown[][]) => [...tuples].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Rows as sorted tuples of the named columns; a measure reads as a number on every dialect. */
const tuples = (rows: unknown, columns: readonly string[]) =>
  sorted((rows as Row[]).map((row) => columns.map((c) => (typeof row[c] === 'number' || /^-?\d+(\.\d+)?$/.test(String(row[c])) ? Number(row[c]) : row[c]))));

for (const cell of CELLS) {
  const config = cell.config();
  describe.skipIf(!config)(
    `[#21249] a base column beside a relationship path the cube declares no join for (${cell.label})${config ? '' : ` (skipped: set ${cell.env} to run this cell)`}`,
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

      /** One query on one face: its rows, or its error, and the reads it caused. */
      const read = async (face: Face, query: Record<string, unknown>) => {
        const before = { ...reads };
        const outcome = await services[face]!.query(query as any).then(
          (res) => ({ rows: res.rows as unknown, err: undefined as Error | undefined }),
          (err) => ({ rows: undefined as unknown, err: err as Error }),
        );
        return { ...outcome, rawSql: reads.rawSql - before.rawSql, aggregate: reads.aggregate - before.aggregate };
      };

      /** The statement the native face runs for a query — the dry-run door. */
      const statement = async (query: Record<string, unknown>) => (await services.native!.generateSql(query as any)).sql;

      /** Both faces serve `query` with the same `expected` groups; the native face in one raw statement. */
      const servedOnBothFaces = async (query: Record<string, unknown>, columns: readonly string[], expected: unknown[][]) => {
        for (const face of FACES) {
          const { rows, err, rawSql, aggregate } = await read(face, query);
          expect(err, `${face}: ${err?.message}`).toBeUndefined();
          expect(tuples(rows, columns), face).toEqual(sorted(expected));
          if (face === 'native') {
            expect(rawSql, 'the native face answered: one raw statement').toBe(1);
            expect(aggregate, 'the native face asked no engine aggregate').toBe(0);
          } else {
            expect(rawSql, 'the ObjectQL face ran no raw statement').toBe(0);
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

        // The plugin's own composition over the real engine — the relationship
        // resolver wired from the engine's registry, so `owner` reaches the person.
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

      it('the card pair is served on the native face, grouped by the BASE column, as the ObjectQL face serves it', async () => {
        const query = { cube: NO_JOIN, measures: ['count'], dimensions: ['note', 'owner.email'] };
        await servedOnBothFaces(query, ['note', 'owner.email', 'count'], PAIR_GROUPS);
        const sql = await statement(query);
        expect(sql).toContain(`SELECT "${DEAL}"."note" AS "note", "owner"."email" AS "owner.email"`);
        expect(sql).toContain(`LEFT JOIN "${PERSON}" "owner" ON "${DEAL}"."owner" = "owner"."id"`);
        expect(sql).toContain(`GROUP BY "${DEAL}"."note", "owner"."email"`);
      });

      it('the pair with a `where` on the base column and an `order` by it', async () => {
        const query = { cube: NO_JOIN, measures: ['count'], dimensions: ['note', 'owner.email'], where: { note: 'x' }, order: { note: 'asc' } };
        await servedOnBothFaces(query, ['note', 'owner.email', 'count'], [['x', 'a@x', 2], ['x', 'b@x', 1]]);
        const sql = await statement(query);
        expect(sql).toContain(`WHERE "${DEAL}"."note" = $1`);
        expect(sql).toContain(`GROUP BY "${DEAL}"."note", "owner"."email"`);
        // ORDER BY names the output column the SELECT list aliases, never a table column.
        expect(sql).toContain('ORDER BY "note" ASC');
      });

      it('every other base-column emitter beside the join: a measure, a time-dimension window, a member the cube does not declare', async () => {
        await servedOnBothFaces(
          { cube: NO_JOIN, measures: ['amount_sum'], dimensions: ['owner.email'] },
          ['owner.email', 'amount_sum'],
          [['a@x', 15], ['b@x', 8]],
        );
        expect(await statement({ cube: NO_JOIN, measures: ['amount_sum'], dimensions: ['owner.email'] })).toContain(`"${DEAL}"."amount"`);

        const window = { cube: NO_JOIN, measures: ['count'], dimensions: ['owner.email'], timeDimensions: [{ dimension: 'closed_on', dateRange: ['2026-03-01', '2026-03-31'] }] };
        await servedOnBothFaces(window, ['owner.email', 'count'], [['a@x', 2], ['b@x', 1]]);
        expect(await statement(window)).toContain(`"${DEAL}"."closed_on" >= $1`);

        const undeclared = { cube: NO_JOIN, measures: ['count'], dimensions: ['owner.email'], where: { id: 'd1' } };
        await servedOnBothFaces(undeclared, ['owner.email', 'count'], [['a@x', 1]]);
        expect(await statement(undeclared)).toContain(`WHERE "${DEAL}"."id" = $1`);
      });

      it('the join is known only once every member is resolved: a base column compiled BEFORE a later member registers the join is qualified too', async () => {
        // The SELECT list is compiled before the `where`, so `note` is resolved
        // while nothing is joined yet; the filter then joins `owner`.
        // Native face only: the ObjectQL face refuses a cross-object filter of its own accord.
        const byFilter = { cube: NO_JOIN, measures: ['count'], dimensions: ['note'], where: { 'owner.email': 'a@x' } };
        const { rows, err } = await read('native', byFilter);
        expect(err, err?.message).toBeUndefined();
        expect(tuples(rows, ['note', 'count'])).toEqual([['x', 2]]);
        const sql = await statement(byFilter);
        expect(sql).toContain(`SELECT "${DEAL}"."note" AS "note"`);
        expect(sql).toContain(`GROUP BY "${DEAL}"."note"`);

        // Either order of the card's pair compiles the same qualified columns.
        const reversed = await statement({ cube: NO_JOIN, measures: ['count'], dimensions: ['owner.email', 'note'] });
        expect(reversed).toContain(`GROUP BY "owner"."email", "${DEAL}"."note"`);
      });

      it('CONTROL the declared-join cube compiles the pair to the statement it always did, and serves the same groups', async () => {
        const query = { cube: DECLARED, measures: ['count'], dimensions: ['note', 'owner.email'] };
        await servedOnBothFaces(query, ['note', 'owner.email', 'count'], PAIR_GROUPS);
        expect(await statement(query)).toBe(
          `SELECT "${DEAL}"."note" AS "note", "owner"."email" AS "owner.email", COUNT(*) AS "count" FROM "${DEAL}" ` +
            `LEFT JOIN "${PERSON}" "owner" ON "${DEAL}"."owner" = "owner"."id" GROUP BY "${DEAL}"."note", "owner"."email"`,
        );
        // The cube without the declaration now compiles the very same statement.
        expect(await statement({ ...query, cube: NO_JOIN })).toBe(await statement(query));
      });

      it('CONTROL a statement that joins nothing keeps its bare columns — on either cube, and when an absorbed `$or` takes its join back', async () => {
        const bare = `SELECT note AS "note", COUNT(*) AS "count" FROM "${DEAL}" GROUP BY note`;
        for (const cube of [NO_JOIN, DECLARED]) {
          const query = { cube, measures: ['count'], dimensions: ['note'] };
          await servedOnBothFaces(query, ['note', 'count'], [['x', 3], ['y', 1]]);
          // On the declared-join cube this statement used to read `"<deal>"."note"`:
          // both name one column of the one table the statement reads.
          expect(await statement(query), cube).toBe(bare);
        }
        // `{}` is TRUE and absorbs the disjunction, taking back the join its
        // other branch registered: the statement reads one table again.
        const absorbed = { cube: NO_JOIN, measures: ['count'], dimensions: ['note'], where: { $or: [{ 'owner.email': 'a@x' }, {}] } };
        await servedOnBothFaces(absorbed, ['note', 'count'], [['x', 3], ['y', 1]]);
        expect(await statement(absorbed)).toBe(bare);
      });
    },
  );
}
