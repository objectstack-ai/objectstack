// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20025] The `sqlite` arm of `text-match-sql.ts` reads the WHOLE comparand and
 * the WHOLE stored value, U+0000 included, on every face that calls it:
 *
 * - `compileScopedFilterToSql` (`read-scope-sql.ts`, the ADR-0021 D-C read
 *   scope), reached directly and through both strategies' scope merge;
 * - `NativeSQLStrategy.buildFilterClause`, the executed `where`;
 * - the `ObjectQLStrategy` echo of that statement, which the `/analytics/sql`
 *   caller runs on the same database.
 *
 * ## The defect
 *
 * SQLite's `glob()` reads its pattern AND the stored value as C strings, so each
 * is cut at its first U+0000. `driver-sql` moved off that construct in #19999
 * (the comparand's cut) and #20024 (the stored value's cut). This package
 * re-emits the driver's construct table rather than importing it (see
 * `text-match-sql.ts`'s header for why), so its copy kept `GLOB` for every
 * shape. Run against this file's grid on better-sqlite3 (SQLite 3.53.4) and
 * sql.js (3.49.1) at `980bc05e5b`, every one of the five faces on both engines
 * answered 88 of the 128 cells differently from the JavaScript rows, while
 * `driver-sql` answered all 128 alike. The error runs in BOTH directions: a
 * read scope that widens (a comparand holding U+0000 is cut down to `*`, and a
 * `$notContains` or `$not` whose comparand sits after a stored U+0000 admits
 * the row) and one that narrows (a `$contains` / `$endsWith` whose match sits
 * after a stored U+0000 is missed). `$startsWith` with a comparand free of
 * U+0000 was the one shape that answered like JS in every cell.
 *
 * ## The construct table this pins
 *
 * `driver-sql`'s, cell for cell: `instr(col, ?) > 0` for `contains`,
 * `instr(col, ?) = 1` for a `starts` comparand holding U+0000, and a byte
 * suffix over BLOB for `ends`, with `coalesce()` so a zero-length value answers
 * false rather than NULL and an empty `ends` comparand routed to `instr()`.
 * Only `starts` with a comparand free of U+0000 keeps `GLOB`, byte for byte:
 * the value's cut cannot change that answer, and it is the one shape an index
 * can serve.
 *
 * ## Two references per cell, and why the driver is one of them
 *
 * Every cell is required to equal the JavaScript answer ({@link jsMatches},
 * the five operator lines of `@objectstack/formula`'s `evalOp` over a string or
 * NULL — this package does not depend on `formula`, and the fold comes from the
 * spec's own `asciiCaseInsensitiveContains`) AND the rows `driver-sql`'s own
 * compiler returns on the same engine (`driver.find`, the face the ObjectQL
 * execute path lands on). `driver-sql`'s #20024 suite pins that face to
 * `formula` directly, so the second reference is what keeps the two construct
 * tables from drifting: a change to either one reds here.
 *
 * ## Why the statements run through the DRIVERS' `execute()`, not a bare engine
 *
 * `plugin.ts` runs this package's SQL through `engine.execute(sql, { args })`,
 * which is the driver's `knex.raw`. On sql.js that path matters: a bare
 * `Statement.bind` hands a string to `sqlite3_bind_text` with length `-1`, so a
 * comparand holding U+0000 is cut at the BIND, before any construct sees it
 * (`driver-sqlite-wasm`'s `sqljs-exact-text.ts` carries the measurement), and a
 * test that bound that way would measure the transport, not this file.
 * `SqliteWasmDriver.execute` binds such a comparand exactly, as production
 * does; better-sqlite3 binds every string with its length.
 *
 * ## One cell deliberately outside the grid
 *
 * `$icontains: ''`. `driver-sql` refuses it (`INVALID_FILTER`, #5702) and the
 * spec's parse door refuses it too. It is not a U+0000 cell, so this change did
 * not move it, and it stays out of the grid. [#20068] RE-JUDGED: these
 * compilers no longer answer it with every non-NULL row. Both doors now refuse
 * it before any construct is chosen, the `where` door as `INVALID_FILTER` / 400
 * and the read scope as `READ_SCOPE_COMPILE_FAILED` / 500, so the grid has no
 * rows for it to hold. `icontains-text-comparand-refusal.test.ts` pins the
 * refusal on every face.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Cube, DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { asciiCaseInsensitiveContains } from '@objectstack/spec/data';
import type { AnalyticsQuery } from '@objectstack/spec/contracts';
import { SqlDriver } from '@objectstack/driver-sql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';

import { NativeSQLStrategy } from '../strategies/native-sql-strategy.js';
import { ObjectQLStrategy } from '../strategies/objectql-strategy.js';
import { compileScopedFilterToSql } from '../read-scope-sql.js';
import type { DatasetScopedStrategyContext } from '../strategies/types.js';

/** U+0000, spelled by its code point so no raw control byte sits in this file. */
const NUL = String.fromCharCode(0x00);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'nul_text';

/** label → stored value: U+0000 at the start, middle and end; none; `''`; NULL. */
const ROWS: Readonly<Record<string, string | null>> = {
  nul_mid: 'a' + NUL + 'b',
  nul_trail: 'ab' + NUL,
  nul_lead: NUL + 'z',
  plain: 'plain',
  empty: '',
  missing: null,
  word: 'word',
  word_after_nul: 'x' + NUL + 'word',
  upper_nul: 'A' + NUL + 'B',
  b_nul_a: 'b' + NUL + 'a',
  glob_nul: 'x' + NUL + '*?[y',
  mb_nul: 'é' + NUL + 'ü',
};

/** Comparands without U+0000 (the stored value's cut) and with it (the comparand's). */
const NUL_FREE = ['b', 'word', 'a', 'z', 'B', '', '*?[y', 'ü'] as const;
const HOLDS_NUL = [NUL, NUL + 'b', 'a' + NUL, 'a' + NUL + 'b', NUL + 'z'] as const;
const OPS = ['$contains', '$notContains', '$startsWith', '$endsWith', '$icontains'] as const;
type TextOp = (typeof OPS)[number];

/** Human-readable comparand for a case name — U+0000 shown as `NUL`. */
const shown = (v: string): string => `'${v.split(NUL).join('\\0')}'`;

/**
 * The JavaScript answer for one leaf over a string or NULL — the five operator
 * lines of `@objectstack/formula`'s `evalOp` (`matches-filter.ts`), with the
 * fold taken from the spec's one definition.
 */
function jsMatches(op: TextOp, value: string | null, comparand: string): boolean {
  const text = typeof value === 'string';
  switch (op) {
    case '$contains': return text && value.includes(comparand);
    case '$notContains': return !(text && value.includes(comparand));
    case '$startsWith': return text && value.startsWith(comparand);
    case '$endsWith': return text && value.endsWith(comparand);
    case '$icontains': return text && comparand !== '' && asciiCaseInsensitiveContains(value, comparand);
  }
}

interface GridCase {
  readonly name: string;
  readonly where: FilterCondition;
  readonly expected: readonly string[];
}

const rowsWhere = (pred: (value: string | null) => boolean): string[] =>
  Object.entries(ROWS).filter(([, v]) => pred(v)).map(([label]) => label).sort();

const GRID: readonly GridCase[] = OPS.flatMap((op) =>
  [...NUL_FREE, ...HOLDS_NUL]
    // The one cell outside the grid — see this file's header.
    .filter((c) => !(op === '$icontains' && c === ''))
    .flatMap((c): GridCase[] => [
      {
        name: `${op} ${shown(c)}`,
        where: { v: { [op]: c } } as FilterCondition,
        expected: rowsWhere((v) => jsMatches(op, v, c)),
      },
      {
        // Under `$not` a construct that answers NULL where the answer is false
        // loses its row — invisible to the bare leaf above.
        name: `$not ${op} ${shown(c)}`,
        where: { $not: { v: { [op]: c } } } as FilterCondition,
        expected: rowsWhere((v) => !jsMatches(op, v, c)),
      },
    ]),
);

const CUBE: Cube = {
  name: TABLE,
  title: 'Texts',
  sql: TABLE,
  measures: { total: { name: 'total', label: 'Total', type: 'count', sql: '*' } },
  dimensions: {
    label: { name: 'label', label: 'Label', type: 'string', sql: 'label' },
    v: { name: 'v', label: 'V', type: 'string', sql: 'v' },
  },
  public: false,
} as unknown as Cube;

const query = (where: unknown): AnalyticsQuery =>
  ({ cube: TABLE, measures: ['total'], dimensions: ['label'], timezone: 'UTC', where }) as AnalyticsQuery;

/** The host `plugin.ts` wires from a SQLite driver, optionally carrying a read scope. */
const sqliteCtx = (scope?: FilterCondition): DatasetScopedStrategyContext =>
  ({
    getCube: (name: string) => (name === TABLE ? CUBE : undefined),
    queryCapabilities: () => ({ nativeSql: true, objectqlAggregate: true, inMemory: false }),
    sqlDialect: () => 'sqlite',
    ...(scope ? { getReadScope: (object: string) => (object === TABLE ? scope : null) } : {}),
  }) as DatasetScopedStrategyContext;

type Compiled = { sql: string; params: unknown[] };

/** Every face that reaches `textMatchPredicateSql` with `dialect: 'sqlite'`. */
const FACES: ReadonlyArray<readonly [string, (where: FilterCondition) => Promise<Compiled>]> = [
  [
    'read scope (compileScopedFilterToSql)',
    async (where) => {
      const { sql, params } = compileScopedFilterToSql(where, 't', { dialect: 'sqlite' });
      return { sql: `SELECT "t"."label" AS "label" FROM "${TABLE}" AS "t" WHERE ${sql}`, params };
    },
  ],
  ['read scope via NativeSQLStrategy', (where) => new NativeSQLStrategy().generateSql(query(undefined), sqliteCtx(where))],
  ['read scope via the ObjectQL echo', (where) => new ObjectQLStrategy().generateSql(query(undefined), sqliteCtx(where))],
  ['NativeSQLStrategy where', (where) => new NativeSQLStrategy().generateSql(query(where), sqliteCtx())],
  ['ObjectQL echo where', (where) => new ObjectQLStrategy().generateSql(query(where), sqliteCtx())],
];

/**
 * Every grid cell whose rows differ from the expected set, named — so a red run
 * reports the whole count, not only the first cell it met.
 */
async function cellsDiffering(rowsFor: (where: FilterCondition) => Promise<string[]>): Promise<string[]> {
  const wrong: string[] = [];
  for (const c of GRID) {
    const got = await rowsFor(c.where);
    if (got.join(',') !== c.expected.join(',')) wrong.push(`${c.name}: [${got.join(',')}], JS [${c.expected.join(',')}]`);
  }
  return wrong;
}

/** The two SQLite builds this package's tests run, each behind its driver's `execute()`. */
const ENGINES: ReadonlyArray<readonly [string, () => SqlDriver]> = [
  ['better-sqlite3', () => new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true })],
  ['sql.js', () => new SqliteWasmDriver({ filename: ':memory:' })],
];

describe('[#20025] the grid answers JavaScript\'s rows (the expectations themselves)', () => {
  it('covers every operator with and without U+0000 in the comparand, and the `\'\'` and NULL rows', () => {
    expect(GRID).toHaveLength(2 * (OPS.length * (NUL_FREE.length + HOLDS_NUL.length) - 1));
    expect(Object.values(ROWS)).toContain('');
    expect(Object.values(ROWS)).toContain(null);
  });

  // A few cells stated literally, so the reference above is not only checked
  // against itself.
  it.each([
    ["$contains 'b'", ['b_nul_a', 'nul_mid', 'nul_trail']],
    ["$notContains 'word'", ['b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'nul_mid', 'nul_trail', 'plain', 'upper_nul']],
    ["$endsWith 'b'", ['nul_mid']],
    ["$contains '\\0'", ['b_nul_a', 'glob_nul', 'mb_nul', 'nul_lead', 'nul_mid', 'nul_trail', 'upper_nul', 'word_after_nul']],
    ["$endsWith '\\0'", ['nul_trail']],
    ["$startsWith '\\0'", ['nul_lead']],
    ["$contains '\\0b'", ['nul_mid']],
    ["$not $endsWith ''", ['missing']],
    ["$not $contains 'b'", ['empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul', 'word', 'word_after_nul']],
  ])('%s', (name, expected) => {
    expect(GRID.find((c) => c.name === name)?.expected).toEqual(expected);
  });
});

for (const [engineName, makeDriver] of ENGINES) {
  describe(`[#20025] on ${engineName}: every face answers JavaScript's rows and driver-sql's`, () => {
    let driver: SqlDriver;

    const execute = async ({ sql, params }: Compiled): Promise<string[]> => {
      // `plugin.ts`'s bridge, verbatim: `$N` → `?`, then the driver's raw path.
      const rows = (await driver.execute(sql.replace(/\$(\d+)/g, '?'), params)) as Array<{ label: string }>;
      return rows.map((r) => String(r.label)).sort();
    };

    beforeAll(async () => {
      driver = makeDriver();
      await driver.initObjects([{ name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } }]);
      for (const [label, v] of Object.entries(ROWS)) await driver.create(TABLE, { label, v }, BYPASS);
    });

    afterAll(async () => {
      await driver.disconnect();
    });

    it('stored every value whole (the premise)', async () => {
      const rows = (await driver.execute(
        `select label, case when v is null then null else hex(v) end as h from ${TABLE}`,
      )) as Array<{ label: string; h: string | null }>;
      const stored = Object.fromEntries(rows.map((r) => [r.label, r.h]));
      for (const [label, v] of Object.entries(ROWS)) {
        expect(stored[label], label).toBe(v === null ? null : Buffer.from(v, 'utf8').toString('hex').toUpperCase());
      }
    });

    it('driver-sql (the ObjectQL execute face) answers the JavaScript rows — the reference', async () => {
      const wrong = await cellsDiffering(async (where) =>
        ((await driver.find(TABLE, { where }, BYPASS)) as Array<{ label: string }>).map((r) => r.label).sort(),
      );
      expect(wrong, `driver-sql: ${wrong.length} of ${GRID.length} cells differ`).toEqual([]);
    });

    for (const [faceName, compile] of FACES) {
      it(`${faceName} answers the same rows`, async () => {
        const wrong = await cellsDiffering(async (where) => execute(await compile(where)));
        expect(wrong, `${faceName}: ${wrong.length} of ${GRID.length} cells differ`).toEqual([]);
      });
    }
  });
}

describe('[#20025] the compiled constructs, per shape', () => {
  const native = (where: FilterCondition) => new NativeSQLStrategy().generateSql(query(where), sqliteCtx());
  const echo = (where: FilterCondition) => new ObjectQLStrategy().generateSql(query(where), sqliteCtx());
  const scope = (where: FilterCondition) => compileScopedFilterToSql(where, 't', { dialect: 'sqlite' });

  it('`$startsWith` without U+0000 keeps GLOB and its escaped prefix pattern, byte for byte', async () => {
    const where = { v: { $startsWith: 'a*b' } } as FilterCondition;
    expect((await native(where)).sql).toContain('WHERE v GLOB $1 GROUP BY');
    expect((await native(where)).params).toEqual(['a[*]b*']);
    expect((await echo(where)).sql).toContain('WHERE v GLOB $1 GROUP BY');
    expect((await echo(where)).params).toEqual(['a[*]b*']);
    expect(scope(where)).toEqual({ sql: '"t"."v" GLOB ?', params: ['a[*]b*'] });
  });

  it('`$contains` / `$notContains` / `$icontains` take instr() and bind the comparand raw', async () => {
    expect(scope({ v: { $contains: 'a*b' } } as FilterCondition))
      .toEqual({ sql: 'instr("t"."v", ?) > 0', params: ['a*b'] });
    // The #5298 NULL-safe wrapper composes around the negated construct unchanged.
    expect(scope({ v: { $notContains: 'a*b' } } as FilterCondition))
      .toEqual({ sql: '("t"."v" IS NULL OR NOT (instr("t"."v", ?) > 0))', params: ['a*b'] });
    expect(scope({ v: { $icontains: 'A*b' } } as FilterCondition))
      .toEqual({ sql: 'instr(lower("t"."v"), lower(?)) > 0', params: ['A*b'] });
    const n = await native({ v: { $contains: 'a*b' } } as FilterCondition);
    expect(n.sql).toContain('WHERE instr(v, $1) > 0 GROUP BY');
    expect(n.params).toEqual(['a*b']);
    const e = await echo({ v: { $icontains: 'A*b' } } as FilterCondition);
    expect(e.sql).toContain('WHERE instr(lower(v), lower($1)) > 0 GROUP BY');
    expect(e.params).toEqual(['A*b']);
  });

  it('`$endsWith` takes the BLOB byte suffix and binds its comparand twice, in placeholder order', async () => {
    expect(scope({ v: { $endsWith: 'a*b' } } as FilterCondition)).toEqual({
      sql: 'coalesce(substr(CAST("t"."v" AS BLOB), -length(CAST(? AS BLOB))), CAST("t"."v" AS BLOB)) = CAST(? AS BLOB)',
      params: ['a*b', 'a*b'],
    });
    const n = await native({ v: { $endsWith: 'a*b' } } as FilterCondition);
    expect(n.sql).toContain(
      'WHERE coalesce(substr(CAST(v AS BLOB), -length(CAST($1 AS BLOB))), CAST(v AS BLOB)) = CAST($2 AS BLOB) GROUP BY',
    );
    expect(n.params).toEqual(['a*b', 'a*b']);
  });

  it("an empty `$endsWith` comparand takes instr(), never the suffix's substr(…, -0)", () => {
    expect(scope({ v: { $endsWith: '' } } as FilterCondition)).toEqual({ sql: 'instr("t"."v", ?) > 0', params: [''] });
  });

  it('`$startsWith` with U+0000 takes instr() = 1, the first occurrence being the prefix', () => {
    expect(scope({ v: { $startsWith: 'a' + NUL } } as FilterCondition))
      .toEqual({ sql: 'instr("t"."v", ?) = 1', params: ['a' + NUL] });
  });
});
