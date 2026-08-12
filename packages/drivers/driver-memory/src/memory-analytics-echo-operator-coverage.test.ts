// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7117] `MemoryAnalyticsService.generateSql()` describes the query
 * `MemoryAnalyticsService.query()` actually runs — pinned by RUNNING it.
 *
 * # The defect
 *
 * This service has two exits for one normalized filter tree and they disagreed
 * about what the LIKE family MEANS. `query()` builds a real containment pattern
 * (`CUBE_OPERATOR_TO_MONGO_PREDICATE`'s `contains` row, over the driver's own
 * `filterSubstringPattern`); `generateSql()` emitted the comparand as a bare
 * literal with no wildcard anywhere, so `{name: {$contains: 'acme'}}` echoed
 *
 *     WHERE name LIKE 'acme'
 *
 * — an EQUALITY — beside a chart built from every row CONTAINING `acme`. The
 * echo's only reason to exist is reproducing execution, so an author who runs it
 * to debug the chart gets a NARROWER row set and reads the filter as broken.
 * That is the #5333 / #3650 class ("a rendering that contradicts execution is
 * worse than no rendering"), reached through driver-memory's analytics face.
 *
 * # Why this file EXECUTES the echo instead of asserting its text
 *
 * The maintainer's ruling on this card (comment `5234868334`) is explicit, and
 * it is the same call `objectql-echo-operator-coverage.test.ts` makes for
 * `service-analytics`' third compiler: **pin the WHERE against `query()`'s ROW
 * SET, not against a string.** An assertion on the SQL text would not have
 * caught the missing `%` either — `WHERE name LIKE 'acme'` contains the column,
 * the operator and the comparand, and reads as a working predicate. So every
 * case below is run twice: once through `query()` (mingo) and once by handing
 * the echoed statement to a real SQLite engine over the same fixture. The
 * engine is `sql.js` (pure WASM) for the reason
 * `native-sql-filter-logic-conformance.test.ts` gives — a native binding loads
 * only under the exact Node ABI it was built for and aborts the vitest worker on
 * CI's Node, taking the file's cases silently with it.
 *
 * SQLite specifically, because that is the dialect this exit has always emitted:
 * `toSqlLiteral` spells booleans `1`/`0`, and #6520's `icontains` row reasoned
 * from SQLite's ASCII-only `LIKE`. Stating it as an executed premise rather than
 * a comment is what makes it go RED rather than stale if the exit ever changes
 * dialect.
 *
 * # The two axes, because #7723 opened the second one
 *
 * #7723 made the `$contains` family case-EXACT on this package's execution faces
 * (#4706 Q2 = A) — including `filterSubstringPattern`, which this face borrows.
 * A `LIKE` echo would then have contradicted execution on a SECOND axis the
 * moment the first was fixed: SQLite's `LIKE` folds ASCII case and the fold
 * cannot be turned off per statement. The two halves are one fix because the
 * case-exact construct (`GLOB`) speaks a DIFFERENT pattern language from `LIKE`,
 * so choosing it and rendering the wildcards are the same decision — which is
 * why #7723 serialized this half behind this card rather than shipping it.
 *
 * | axis | `query()` | echo, before | echo, now |
 * |:--|:--|:--|:--|
 * | containment | substring | **equality** — no wildcard | `GLOB '*v*'` |
 * | case (`$contains`) | exact (#7723) | folds ASCII (SQLite `LIKE`) | exact (`GLOB`) |
 * | case (`$icontains`) | folds ASCII | folds ASCII | folds ASCII (`lower()` both sides) |
 *
 * # What the enumeration adds over the measured table
 *
 * `ANALYTICS_FILTER_CAPABILITIES` closes the vocabulary — `normalizeFilters`
 * refuses anything outside `MONGO_TO_CUBE_OPERATOR` with `INVALID_FILTER` / 400,
 * on BOTH exits — so the operators that can ever reach the WHERE builder are a
 * finite, enumerable set. Driving all of them through both exits turns "the two
 * tables drifted" from something a reader has to notice into a failing test.
 * That is how the OTHER half of this card was measured: the issue expected
 * `startsWith` / `endsWith` to fall to `operatorToSql`'s `|| '='` fallback, and
 * they cannot — they are refused. The three operators that DID fall to it were
 * `in`, `notIn` and `set`:
 *
 * | `where` | `query()` | echo, before | echo, now |
 * |:--|:--|:--|:--|
 * | `{name: {$in: [a, b]}}` | both rows | `name = a` — one row | `name IN (a, b)` |
 * | `{name: {$nin: [a]}}` | the other four | `name = a` — the **complement** | `(name IS NULL OR name NOT IN (a))` |
 * | `{name: {$exists: true}}` | four rows | `name = 1` — **no** rows | `name IS NOT NULL` |
 *
 * # Reverse verification
 *
 * Each repair was reverted one at a time, the failure direction PREDICTED
 * first, then measured. All eight predictions held; the `measured` column is
 * the assertion text vitest printed, not a paraphrase.
 *
 * | reverted to | predicted | measured (6 rows; ids as above) |
 * |:--|:--|:--|
 * | `contains` → `LIKE <bare literal>` | the original defect: the echo narrows to an equality and answers no rows | 6 failures; `{$contains:'ACME'}` → `expected [] to deeply equal ['2']` |
 * | `GLOB` → `LIKE '%v%'` | containment right, CASE wrong — the echo picks up the upper-case row the case-exact query excludes | 5 failures; `{$contains:'ACME'}` → `expected ['1','2'] to deeply equal ['2']` |
 * | drop the comparand's LIKE-escape | `{$contains:'%'}` widens from the one row that really contains a `%` to every non-null row | `echo %: expected ['1','2','3','4','5'] to deeply equal ['4']` |
 * | `icontains` → `GLOB` without `lower()` | the fold vanishes, so a lower-case comparand matches nothing | `expected [] to deeply equal ['1','2','3']` |
 * | `notContains` → bare `NOT GLOB` | SQL's three-valued `WHERE` drops the NULL row mingo returns | `expected ['2','4','5'] to deeply equal ['2','4','5','6']` |
 * | `in` → the `\|\| '='` fallback | only the first list member survives | `expected ['1'] to deeply equal ['1','3']` |
 * | restore the `values.length > 0` guard | empty `$in` emits no WHERE, so the echo describes the whole table | `expected ['1','2','3','4','5','6'] to deeply equal []` |
 * | `lte` → a closed bare-day bound | the echo drops that day's timestamped rows | the `at < '2026-01-03'` pin, then `['1'] != ['1','2']` |
 *
 * Reverting `in`/`notIn`/`set` all the way to the deleted `operatorToSql` is not
 * expressible any more without also deleting the `Record<CubeOperator, …>` key
 * type — which is the point of that key type, and the reason those three rows
 * cannot silently go missing again.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService, ANALYTICS_FILTER_CAPABILITIES } from './memory-analytics.js';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import type { AnalyticsQuery, Cube, FilterCondition } from '@objectstack/spec/data';

/**
 * Six rows chosen so that every wrong rendering this file guards against shows
 * up as a wrong ID rather than as a coincidence:
 *
 *   - rows 1/2 differ only in CASE, so a case-folding echo picks up row 2 where
 *     the case-exact query does not;
 *   - row 3 contains the comparand without starting or ending with it, so a
 *     containment predicate compiled as an equality returns nothing;
 *   - row 4 carries LIKE's own metacharacters, so an unescaped comparand shows
 *     up as the `%`-matches-everything bypass (#5567);
 *   - row 5 carries GLOB's metacharacters, which are ORDINARY to LIKE — the
 *     direction a hand-written escape forgets;
 *   - row 6 has a NULL `name`, which is the row every negation drops under SQL's
 *     three-valued `WHERE` unless the predicate is null-safe (#5146 / #5297).
 */
const ROWS = [
  { id: '1', name: 'Acme Industries', amount: 10 },
  { id: '2', name: 'ACME INDUSTRIES', amount: 20 },
  { id: '3', name: 'Global Industries Ltd', amount: 30 },
  { id: '4', name: '100% off_peak', amount: 40 },
  { id: '5', name: 'a*b?c[d', amount: 50 },
  { id: '6', name: null, amount: 60 },
] as const;

const CUBE: Cube = {
  name: 'deals',
  title: 'Deals',
  sql: 'deal',
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: 'id' } },
  dimensions: {
    id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
    name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
    amount: { name: 'amount', label: 'Amount', type: 'number', sql: 'amount' },
  },
  public: true,
};

/** Point sql.js at the `.wasm` shipped inside its own package (Node-safe). */
async function locateWasm(): Promise<((file: string) => string) | undefined> {
  try {
    const { createRequire } = await import('node:module');
    const require = createRequire(import.meta.url);
    const pkgJsonPath = require.resolve('sql.js/package.json');
    const { dirname, join } = await import('node:path');
    const dir = dirname(pkgJsonPath);
    return (file: string) => join(dir, 'dist', file);
  } catch {
    return undefined;
  }
}

/**
 * One authorable `$op` spelling this face ACCEPTS, with a comparand this fixture
 * can answer. Keyed by the spelling rather than by the lowered cube operator, so
 * a widening of `MONGO_TO_CUBE_OPERATOR` shows up here as a missing key.
 */
const ACCEPTED_CASES: Record<string, FilterCondition> = {
  $eq: { name: { $eq: 'Acme Industries' } },
  $ne: { name: { $ne: 'Acme Industries' } },
  $gt: { amount: { $gt: 30 } },
  $gte: { amount: { $gte: 30 } },
  $lt: { amount: { $lt: 30 } },
  $lte: { amount: { $lte: 30 } },
  $in: { name: { $in: ['Acme Industries', 'Global Industries Ltd'] } },
  $nin: { name: { $nin: ['Acme Industries'] } },
  // Lower-case `I` on purpose for `$icontains` and upper for `$contains`: each
  // comparand answers differently depending on whether the fold RAN, so a
  // missing fold and a stray fold are both wrong IDs rather than passing counts.
  $contains: { name: { $contains: 'Industries' } },
  $icontains: { name: { $icontains: 'industries' } },
  $notContains: { name: { $notContains: 'Industries' } },
  $exists: { name: { $exists: true } },
};

/** The spellings this face REFUSES — the complement, so the two sets are total. */
const REFUSED_OPERATORS = ['$between', '$startsWith', '$endsWith', '$null'] as const;

describe('[#7117] the analytics echo renders the query it describes', () => {
  let db: any;
  let driver: InMemoryDriver;
  let service: MemoryAnalyticsService;

  beforeAll(async () => {
    const mod: any = await import('sql.js');
    const initSqlJs = mod.default ?? mod;
    const locateFile = await locateWasm();
    const SQL = await initSqlJs(locateFile ? { locateFile } : undefined);

    db = new SQL.Database();
    db.run(`CREATE TABLE deal (id TEXT PRIMARY KEY, name TEXT, amount REAL);`);
    const insert = db.prepare(`INSERT INTO deal (id, name, amount) VALUES (?,?,?)`);
    for (const r of ROWS) insert.run([r.id, r.name, r.amount]);
    insert.free();

    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    for (const r of ROWS) await driver.create('deal', { ...r });
    service = new MemoryAnalyticsService({ driver, cubes: [CUBE] });
  });

  afterAll(() => {
    db?.close();
    return driver?.disconnect?.();
  });

  const query = (where: unknown): AnalyticsQuery => ({
    cube: 'deals',
    measures: ['total'],
    dimensions: ['id'],
    where,
  } as unknown as AnalyticsQuery);

  const sortIds = (ids: string[]): string[] => [...ids].sort((a, b) => a.localeCompare(b));

  /** The rows the pipeline actually returns — what the chart is drawn from. */
  const executedIds = async (where: unknown): Promise<string[]> =>
    sortIds((await service.query(query(where))).rows.map((r: any) => String(r.id)));

  /** The rows the ECHOED statement returns, run on a real SQLite engine. */
  const echoIds = async (where: unknown): Promise<string[]> => {
    const { sql } = await service.generateSql(query(where));
    const stmt = db.prepare(sql);
    const out: string[] = [];
    while (stmt.step()) out.push(String(stmt.getAsObject().id));
    stmt.free();
    return sortIds(out);
  };

  const echoSql = async (where: unknown): Promise<string> =>
    (await service.generateSql(query(where))).sql;

  it('seeded both engines identically (the premise)', async () => {
    expect(await executedIds({})).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(await echoIds({})).toEqual(['1', '2', '3', '4', '5', '6']);
  });

  // ── The issue's own repro ──────────────────────────────────────────────────

  describe("the issue's measured case", () => {
    it('`$contains` echoes a containment pattern, not an equality', async () => {
      const where = { name: { $contains: 'Industries' } };
      // Was `WHERE name LIKE 'Industries'` — an equality, and zero rows.
      expect(await echoSql(where)).toContain("name GLOB '*Industries*'");
      expect(await echoIds(where)).toEqual(['1', '3']);
      expect(await executedIds(where)).toEqual(['1', '3']);
    });

    it('`$notContains` mirrors it, and keeps the NULL row mingo keeps', async () => {
      const where = { name: { $notContains: 'Industries' } };
      // #5146 / #5297: a bare `NOT GLOB` is UNKNOWN for a NULL column and a
      // `WHERE` keeps only TRUE, so row 6 would vanish from the echo alone.
      expect(await echoSql(where)).toContain("(name IS NULL OR name NOT GLOB '*Industries*')");
      expect(await echoIds(where)).toEqual(['2', '4', '5', '6']);
      expect(await executedIds(where)).toEqual(['2', '4', '5', '6']);
    });

    it('the echoed `$contains` is case-EXACT, like the query it describes', async () => {
      // The #7723 axis. Row 2 is row 1 in upper case: SQLite's `LIKE` would
      // return it and the pipeline does not, so this is the assertion that
      // fails if the construct ever goes back to `LIKE`.
      const where = { name: { $contains: 'ACME' } };
      expect(await echoIds(where)).toEqual(['2']);
      expect(await executedIds(where)).toEqual(['2']);
    });

    it('`$icontains` folds ASCII on BOTH sides, and only ASCII', async () => {
      const where = { name: { $icontains: 'industries' } };
      expect(await echoSql(where)).toContain("lower(name) GLOB lower('*industries*')");
      expect(await echoIds(where)).toEqual(['1', '2', '3']);
      expect(await executedIds(where)).toEqual(['1', '2', '3']);
    });

    it("an author's own LIKE metacharacters stay LITERAL", async () => {
      // #5567's bypass, in this exit. Unescaped, `LIKE '%%%'` matches every
      // non-null row; the query matches only the row that really contains a `%`.
      for (const [comparand, expected] of [
        ['%', ['4']],
        ['_', ['4']],
        ['100% off', ['4']],
        ['off_peak', ['4']],
      ] as Array<[string, string[]]>) {
        const where = { name: { $contains: comparand } };
        expect(await echoIds(where), `echo ${comparand}`).toEqual(expected);
        expect(await executedIds(where), `executed ${comparand}`).toEqual(expected);
      }
    });

    it("GLOB's OWN metacharacters stay literal too — the direction LIKE has no opinion on", async () => {
      // `*`, `?` and `[` are ordinary to LIKE and wildcards to GLOB, so moving
      // the construct is what makes these cases exist at all.
      for (const comparand of ['a*b', 'b?c', 'c[d', 'a*b?c[d']) {
        const where = { name: { $contains: comparand } };
        expect(await echoIds(where), `echo ${comparand}`).toEqual(['5']);
        expect(await executedIds(where), `executed ${comparand}`).toEqual(['5']);
      }
      // …and a pattern that would only match if `*` were a wildcard matches
      // NEITHER face. This is the assertion an escape-free rendering fails.
      const bypass = { name: { $contains: '*Industries*' } };
      expect(await echoIds(bypass)).toEqual([]);
      expect(await executedIds(bypass)).toEqual([]);
    });

    it('a quote in the comparand survives into the pattern literal', async () => {
      const where = { name: { $contains: "o'clock" } };
      expect(await echoSql(where)).toContain("GLOB '*o''clock*'");
      expect(await echoIds(where)).toEqual([]);
      expect(await executedIds(where)).toEqual([]);
    });
  });

  // ── The `|| '='` fallback the issue's Scope names ──────────────────────────

  describe("the operators that fell to `operatorToSql`'s `|| '='`", () => {
    it('`$in` renders the WHOLE list, not its first member', async () => {
      const where = { name: { $in: ['Acme Industries', 'Global Industries Ltd'] } };
      expect(await echoIds(where)).toEqual(['1', '3']);
      expect(await executedIds(where)).toEqual(['1', '3']);
    });

    it('`$nin` renders the negation — it used to echo the exact COMPLEMENT', async () => {
      const where = { name: { $nin: ['Acme Industries'] } };
      expect(await echoIds(where)).toEqual(['2', '3', '4', '5', '6']);
      expect(await executedIds(where)).toEqual(['2', '3', '4', '5', '6']);
    });

    it('an EMPTY list is a predicate, not an absent clause', async () => {
      // The `values.length > 0` guard: `$in: []` selects nothing and used to
      // echo a statement with no WHERE at all — the whole table.
      expect(await echoIds({ name: { $in: [] } })).toEqual([]);
      expect(await executedIds({ name: { $in: [] } })).toEqual([]);
      expect(await echoIds({ name: { $nin: [] } })).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(await executedIds({ name: { $nin: [] } })).toEqual(['1', '2', '3', '4', '5', '6']);
    });

    it('`$exists` renders a nullness test — it used to echo `name = 1`', async () => {
      expect(await echoSql({ name: { $exists: true } })).toContain('name IS NOT NULL');
      expect(await echoSql({ name: { $exists: false } })).toContain('name IS NULL');
      // `name = 1` matched NO row on either engine; these match the query's.
      expect(await echoIds({ name: { $exists: true } })).toEqual(['1', '2', '3', '4', '5']);
    });

    /**
     * The one cell where SQL cannot say what mingo says, asserted as an
     * INEQUALITY so it cannot be closed in silence.
     *
     * mingo's `$exists` tests KEY PRESENCE; a relational column always has it.
     * A row storing an explicit `null` therefore satisfies `$exists: true` on
     * `query()` and fails `IS NOT NULL` in the echo. `IS NOT NULL` is
     * nonetheless the spelling both of this repo's other SQL lowerings use
     * (`read-scope-sql.ts`'s `$exists` arm; `driver-sql`'s "a present field is a
     * non-null column in SQL"), and it is a far smaller gap than the `name = 1`
     * it replaces, which matched nothing at all.
     */
    it('documents the one `$exists` cell SQL cannot translate exactly', async () => {
      const where = { name: { $exists: true } };
      // Row 6 stores an explicit `null`: present to mingo, NULL to SQL.
      expect(await executedIds(where)).toEqual(['1', '2', '3', '4', '5', '6']);
      expect(await echoIds(where)).toEqual(['1', '2', '3', '4', '5']);
    });
  });

  // ── The bare-day upper bound, which both exits must read the same way ──────

  it('a bare-day `$lte` is half-open in the echo, as it is in the pipeline', async () => {
    // #4042 (the SQL twin is #3777): `<= '2026-01-02'` drops that day's
    // timestamped rows, so the echo was one row NARROWER than its chart.
    const temporal = new InMemoryDriver({ persistence: false });
    await temporal.connect();
    for (const r of [
      { id: '1', at: '2026-01-01T05:00:00.000Z' },
      { id: '2', at: '2026-01-02T18:00:00.000Z' },
      { id: '3', at: '2026-01-03T00:00:00.000Z' },
    ]) await temporal.create('ev', { ...r });
    const cube: Cube = {
      name: 'evs', title: 'Evs', sql: 'ev',
      measures: { total: { name: 'total', label: 'T', type: 'count', sql: 'id' } },
      dimensions: {
        id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
        at: { name: 'at', label: 'At', type: 'time', sql: 'at' },
      },
      public: true,
    };
    const svc = new MemoryAnalyticsService({ driver: temporal, cubes: [cube] });
    const q = {
      cube: 'evs', measures: ['total'], dimensions: ['id'],
      where: { at: { $lte: '2026-01-02' } },
    } as unknown as AnalyticsQuery;

    const { sql } = await svc.generateSql(q);
    expect(sql).toContain("at < '2026-01-03'");

    db.run(`CREATE TABLE ev (id TEXT PRIMARY KEY, at TEXT);`);
    const insert = db.prepare(`INSERT INTO ev (id, at) VALUES (?,?)`);
    for (const r of [
      ['1', '2026-01-01T05:00:00.000Z'],
      ['2', '2026-01-02T18:00:00.000Z'],
      ['3', '2026-01-03T00:00:00.000Z'],
    ]) insert.run(r);
    insert.free();

    const stmt = db.prepare(sql);
    const echoed: string[] = [];
    while (stmt.step()) echoed.push(String(stmt.getAsObject().id));
    stmt.free();

    expect(sortIds(echoed)).toEqual(['1', '2']);
    expect(sortIds((await svc.query(q)).rows.map((r: any) => String(r.id)))).toEqual(['1', '2']);
    await temporal.disconnect?.();
  });

  // ── The vocabulary, enumerated so the two tables cannot drift apart ────────

  describe('the closed vocabulary, enumerated', () => {
    it('the accepted and refused sets together are the whole Filter Protocol', () => {
      expect(sortIds([...Object.keys(ACCEPTED_CASES), ...REFUSED_OPERATORS]))
        .toEqual(sortIds([...FILTER_OPERATORS]));
    });

    it('the accepted set IS the face\'s declared vocabulary', () => {
      expect(sortIds(Object.keys(ACCEPTED_CASES)))
        .toEqual(sortIds([...ANALYTICS_FILTER_CAPABILITIES.fieldOperators]));
    });

    for (const [op, where] of Object.entries(ACCEPTED_CASES)) {
      it(`${op}: running the echo returns exactly the rows the query returns`, async () => {
        const executed = await executedIds(where);
        const echoed = await echoIds(where);
        if (op === '$exists') {
          // The documented residue above — asserted there, skipped here so this
          // loop stays a statement about every OTHER operator.
          return;
        }
        expect(echoed, `${op}: the echo describes a different row set`).toEqual(executed);
      });

      it(`${op}: the echo carries a WHERE at all`, async () => {
        const sql = await echoSql(where);
        expect(sql, `${op} echoed no WHERE — the predicate was dropped`).toContain('WHERE');
        expect(sql).toMatch(/WHERE\s+\S/);
      });
    }

    for (const op of REFUSED_OPERATORS) {
      it(`${op} is REFUSED by both exits — it never reaches a fallback`, async () => {
        // The half of this card's premise that measurement falsified: the issue
        // expected `$startsWith` / `$endsWith` to render as `=` through
        // `operatorToSql`'s `|| '='`. They cannot — they are not in
        // `MONGO_TO_CUBE_OPERATOR`, so #5345's gate refuses them first, loudly
        // and identically on both exits.
        const where = { name: { [op]: 'x' } } as unknown as FilterCondition;
        for (const run of [
          () => service.query(query(where)),
          () => service.generateSql(query(where)),
        ]) {
          const err = await run().then(() => null, (e: any) => e);
          expect(err, `${op} was accepted`).toBeInstanceOf(Error);
          expect(err.code).toBe('INVALID_FILTER');
          expect(err.status).toBe(400);
          expect(err.message).toContain(op);
        }
      });
    }
  });
});
