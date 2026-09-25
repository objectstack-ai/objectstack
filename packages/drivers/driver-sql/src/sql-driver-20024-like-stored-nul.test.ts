// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20024] A `$like` / `$ilike` pattern WITHOUT U+0000 reads the whole STORED
 * value on SQLite, U+0000s included.
 *
 * The SQLite arm compiled `$like` to `GLOB`, and `glob()` reads the stored value
 * as a C string, only up to its first U+0000. Measured at base `fe677aeeed` on
 * better-sqlite3 (SQLite 3.53.4), sql.js (3.49.1), `TursoDriver` local, and
 * `TursoDriver` remote over a real `@libsql/client` engine (3.45.1), all four
 * alike: over 108 patterns and 22 compositions against 59 stored values, 359 of
 * 3380 cells over a value holding U+0000 differed from `@objectstack/formula`,
 * and 0 of 3640 over a value without one inside the Basic Multilingual Plane.
 * For example `$like: 'a'` returned
 * `'a'` + U+0000 + `'b'`, and `$like: '_'` missed a lone U+0000.
 *
 * `likePatternPredicate` now rewrites a value holding U+0000 before `GLOB` reads
 * it: each U+0000 becomes one stand-in character that the pattern never names
 * literally. A value without U+0000 still takes the bare `GLOB`, and a pattern
 * that is a literal prefix plus trailing `%`s keeps its old statement, so its
 * index plan is kept too.
 *
 * Every literal case is pinned AND checked against `formula`'s
 * `matchesFilterCondition` (the JS baseline face). The wider grid below holds
 * every cell to `formula` without a literal table. The `\x01` rows are the
 * stand-in's own controls: a stand-in the pattern names literally would match
 * where U+0000 does not.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqlDriver } from './sql-driver.js';

const NUL = String.fromCharCode(0x00);
const SOH = String.fromCharCode(0x01);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'stored_nul_like';

/** label → stored value: U+0000 leading, interior, trailing, doubled, and none. */
const ROWS: Readonly<Record<string, string | null>> = {
  nul_mid: 'a' + NUL + 'b',
  nul_trail: 'ab' + NUL,
  nul_lead: NUL + 'z',
  nul_only: NUL,
  nul_two: NUL + NUL,
  nul_multi: 'a' + NUL + 'b' + NUL + 'c',
  upper_nul: 'A' + NUL + 'B',
  pct_nul: '%' + NUL + '_',
  bs_nul: '\\' + NUL + '\\',
  mb_nul: 'é' + NUL + 'ü',
  cjk_nul: '中' + NUL + '文',
  soh_nul: SOH + NUL + SOH,
  a: 'a',
  ab: 'ab',
  a_b: 'a_b',
  a_soh_b: 'a' + SOH + 'b',
  eu: 'éü',
  empty: '',
  missing: null,
};

const EVERY_VALUE = Object.keys(ROWS).filter((l) => ROWS[l] !== null).sort();

interface RowCase {
  readonly name: string;
  readonly where: FilterCondition;
  readonly expected: readonly string[];
}

const CASES: readonly RowCase[] = [
  // A wildcard-free pattern is an exact comparison of the WHOLE value.
  { name: "$like 'a'", where: { v: { $like: 'a' } }, expected: ['a'] },
  { name: "$like ''", where: { v: { $like: '' } }, expected: ['empty'] },
  // A U+0000 in the value is matched by `%` or `_`, and counts as one character.
  { name: "$like '%b'", where: { v: { $like: '%b' } }, expected: ['a_b', 'a_soh_b', 'ab', 'nul_mid'] },
  { name: "$like 'a_b'", where: { v: { $like: 'a_b' } }, expected: ['a_b', 'a_soh_b', 'nul_mid'] },
  { name: "$like '_'", where: { v: { $like: '_' } }, expected: ['a', 'nul_only'] },
  { name: "$like '__'", where: { v: { $like: '__' } }, expected: ['ab', 'eu', 'nul_lead', 'nul_two'] },
  { name: "$like '%c'", where: { v: { $like: '%c' } }, expected: ['nul_multi'] },
  { name: "$like 'a%c'", where: { v: { $like: 'a%c' } }, expected: ['nul_multi'] },
  { name: "$like '%'", where: { v: { $like: '%' } }, expected: EVERY_VALUE },
  { name: "$like '%%'", where: { v: { $like: '%%' } }, expected: EVERY_VALUE },
  // Multi-byte characters around a U+0000 matched by `_`.
  { name: "$like 'é_ü'", where: { v: { $like: 'é_ü' } }, expected: ['mb_nul'] },
  { name: "$like '中_文'", where: { v: { $like: '中_文' } }, expected: ['cjk_nul'] },
  // Escaped `%`, `_` and `\` around a U+0000.
  { name: "$like '\\%_\\_'", where: { v: { $like: '\\%_\\_' } }, expected: ['pct_nul'] },
  { name: "$like '\\\\_\\\\'", where: { v: { $like: '\\\\_\\\\' } }, expected: ['bs_nul'] },
  // A literal prefix then `%` alone keeps the bare GLOB; with `_` after it, it does not.
  { name: "$like 'ab%'", where: { v: { $like: 'ab%' } }, expected: ['ab', 'nul_trail'] },
  { name: "$like 'ab_'", where: { v: { $like: 'ab_' } }, expected: ['nul_trail'] },
  // The stand-in is never a literal of the pattern: U+0001 here, so U+0002 stands in.
  { name: "$like '%' + U+0001 + '%'", where: { v: { $like: '%' + SOH + '%' } }, expected: ['a_soh_b', 'soh_nul'] },
  { name: "$like U+0001 + '_' + U+0001", where: { v: { $like: SOH + '_' + SOH } }, expected: ['soh_nul'] },
  { name: "$like '_' + U+0001 + '_'", where: { v: { $like: '_' + SOH + '_' } }, expected: ['a_soh_b'] },
  // `$ilike` folds ASCII letters and nothing else, past a U+0000.
  { name: "$ilike 'A_B'", where: { v: { $ilike: 'A_B' } }, expected: ['a_b', 'a_soh_b', 'nul_mid', 'upper_nul'] },
  { name: "$ilike '%B'", where: { v: { $ilike: '%B' } }, expected: ['a_b', 'a_soh_b', 'ab', 'nul_mid', 'upper_nul'] },
  { name: "$ilike 'É_Ü'", where: { v: { $ilike: 'É_Ü' } }, expected: [] },
  { name: "$ilike 'é_ü'", where: { v: { $ilike: 'é_ü' } }, expected: ['mb_nul'] },
  // `$not` / `$or` / `$and`, with the '' and NULL rows in every answer set.
  {
    name: "$not $like 'a_b'",
    where: { $not: { v: { $like: 'a_b' } } },
    expected: EVERY_VALUE.filter((l) => !['a_b', 'a_soh_b', 'nul_mid'].includes(l)).concat('missing').sort(),
  },
  {
    name: "$not $like ''",
    where: { $not: { v: { $like: '' } } },
    expected: EVERY_VALUE.filter((l) => l !== 'empty').concat('missing').sort(),
  },
  {
    name: "$or [$like '_', $like '%c']",
    where: { $or: [{ v: { $like: '_' } }, { v: { $like: '%c' } }] },
    expected: ['a', 'nul_multi', 'nul_only'],
  },
  {
    name: "$and [$like 'a%', $like '%b']",
    where: { $and: [{ v: { $like: 'a%' } }, { v: { $like: '%b' } }] },
    expected: ['a_b', 'a_soh_b', 'ab', 'nul_mid'],
  },
  {
    name: "$not $or [$like '%b', $ilike 'A%']",
    where: { $not: { $or: [{ v: { $like: '%b' } }, { v: { $ilike: 'A%' } }] } },
    expected: [
      'bs_nul', 'cjk_nul', 'empty', 'eu', 'mb_nul', 'missing', 'nul_lead', 'nul_only', 'nul_two', 'pct_nul', 'soh_nul',
    ],
  },
  {
    name: "$not $and [$like 'ab%', $like '%']",
    where: { $not: { $and: [{ v: { $like: 'ab%' } }, { v: { $like: '%' } }] } },
    expected: EVERY_VALUE.filter((l) => !['ab', 'nul_trail'].includes(l)).concat('missing').sort(),
  },
];

/** The wider grid: every pattern below is held to `formula` on every row. */
const GRID: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ...[
    '', '%', '%%', '_', '__', '___', 'a', 'b', 'z', 'ab', 'a%', '%a', '%a%', 'a_', '_b', 'a_b', 'a%b', '%b', '%z',
    '_z', 'ab%', 'ab_', 'ab_%', 'a%b%c', '%b%', '__b', 'a__b', '%_%', '_%', '%_', '_%_', '\\%', '\\_', '\\\\',
    '%\\%%', '%\\_%', '\\%_\\_', '\\\\_\\\\', '%\\\\', 'é%', '%ü', 'é_ü', '_ü', '中%', '%文', '中_文', '%c', 'a%c',
    '%' + SOH + '%', SOH + '_' + SOH, '_' + SOH + '_', SOH + '%', '_' + SOH,
  ].map((p) => ['$like', p] as const),
  ...['', '%', '_', 'A%', '%B', 'A_B', 'AB', 'a_b', '%A%', 'É%', 'é_ü', 'É_Ü', '\\A%', '%' + SOH + '%'].map(
    (p) => ['$ilike', p] as const,
  ),
];

/** The JavaScript baseline face's answer over the same rows. */
function jsAnswer(where: FilterCondition): string[] {
  return Object.entries(ROWS)
    .filter(([, v]) => matchesFilterCondition({ v }, where))
    .map(([label]) => label)
    .sort();
}

describe('[#20024] the expected rows are the JavaScript answer', () => {
  for (const c of CASES) {
    it(c.name, () => {
      expect(jsAnswer(c.where)).toEqual([...c.expected]);
    });
  }
});

describe('[#20024] SqlDriver on better-sqlite3 — $like / $ilike read the whole stored value', () => {
  let driver: SqlDriver;

  const labelsWhere = async (where: FilterCondition): Promise<string[]> => {
    const rows = (await driver.find(TABLE, { where }, BYPASS)) as Array<{ label: string }>;
    return rows.map((r) => r.label).sort();
  };

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
    await driver.initObjects([{ name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } }]);
    for (const [label, v] of Object.entries(ROWS)) await driver.create(TABLE, { label, v }, BYPASS);
    await driver.execute(`CREATE INDEX ${TABLE}_v ON ${TABLE} (v)`);
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

  for (const c of CASES) {
    it(`${c.name} answers the JavaScript rows`, async () => {
      expect(await labelsWhere(c.where)).toEqual([...c.expected]);
    });
  }

  it(`every one of the ${GRID.length} grid patterns answers the JavaScript rows`, async () => {
    const differing: string[] = [];
    for (const [op, pattern] of GRID) {
      const where = { v: { [op]: pattern } } as FilterCondition;
      const got = await labelsWhere(where);
      const want = jsAnswer(where);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        differing.push(`${op} ${JSON.stringify(pattern)}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
      }
    }
    expect(differing).toEqual([]);
  });
});

describe('[#20024] the SQLite $like / $ilike statements, compiled', () => {
  /** Exposes the compiled WHERE and its bindings without reaching into privates. */
  class CompilerProbeDriver extends SqlDriver {
    compile(where: FilterCondition): { sql: string; bindings: readonly unknown[] } {
      const builder: Knex.QueryBuilder = this.getKnex()(TABLE);
      this.applyFilters(builder, where);
      const { sql, bindings } = builder.toSQL();
      return { sql, bindings };
    }
  }

  const probe = new CompilerProbeDriver({
    client: 'better-sqlite3',
    connection: { filename: ':memory:' },
    useNullAsDefault: true,
  });

  /** The whole-value arm around `pat` over `col`, with stand-in `sentinel`. */
  const wholeValue = (col: string, pat: string, sentinel: number) =>
    `CASE WHEN instr(CAST(\`v\` AS BLOB), X'00') > 0 THEN (WITH RECURSIVE os_like_nul(os_rest, os_head) AS `
    + `(SELECT CAST(${col} AS BLOB), X'' UNION ALL SELECT substr(os_rest, instr(os_rest, X'00') + 1), `
    + `os_head || substr(os_rest, 1, instr(os_rest, X'00') - 1) || char(${sentinel}) FROM os_like_nul `
    + `WHERE instr(os_rest, X'00') > 0) SELECT (os_head || os_rest) GLOB ${pat} FROM os_like_nul `
    + `WHERE instr(os_rest, X'00') = 0) ELSE ${col} GLOB ${pat} END`;

  afterAll(async () => {
    await probe.disconnect();
  });

  it("a literal prefix plus trailing '%' keeps the bare GLOB and its bound pattern, byte for byte", () => {
    expect(probe.compile({ v: { $like: 'ab%' } })).toEqual({
      sql: 'select * from `stored_nul_like` where `v` GLOB ?',
      bindings: ['ab*'],
    });
    expect(probe.compile({ v: { $like: '%' } })).toEqual({
      sql: 'select * from `stored_nul_like` where `v` GLOB ?',
      bindings: ['*'],
    });
    expect(probe.compile({ v: { $ilike: 'AB%%' } })).toEqual({
      sql: 'select * from `stored_nul_like` where lower(`v`) GLOB lower(?)',
      bindings: ['AB**'],
    });
  });

  it('a case-exact pattern with a literal prefix leads with GLOB <prefix>*, then reads the whole value', () => {
    expect(probe.compile({ v: { $like: 'a_b' } })).toEqual({
      sql:
        "select * from `stored_nul_like` where (`v` GLOB ? AND CASE WHEN instr(CAST(`v` AS BLOB), X'00') > 0 THEN "
        + "(WITH RECURSIVE os_like_nul(os_rest, os_head) AS (SELECT CAST(`v` AS BLOB), X'' UNION ALL "
        + "SELECT substr(os_rest, instr(os_rest, X'00') + 1), os_head || substr(os_rest, 1, instr(os_rest, X'00') - 1) "
        + "|| char(1) FROM os_like_nul WHERE instr(os_rest, X'00') > 0) SELECT (os_head || os_rest) GLOB ? "
        + "FROM os_like_nul WHERE instr(os_rest, X'00') = 0) ELSE `v` GLOB ? END)",
      bindings: ['a*', 'a?b', 'a?b'],
    });
    // A wildcard-free pattern's prefix is the whole pattern; an escape stays literal.
    expect(probe.compile({ v: { $like: 'a\\%b' } })).toEqual({
      sql: `select * from \`stored_nul_like\` where (\`v\` GLOB ? AND ${wholeValue('`v`', '?', 1)})`,
      bindings: ['a%b*', 'a%b', 'a%b'],
    });
  });

  it('a pattern that starts with a wildcard, and every $ilike, carries no prefix conjunct', () => {
    expect(probe.compile({ v: { $like: '%b' } })).toEqual({
      sql: `select * from \`stored_nul_like\` where ${wholeValue('`v`', '?', 1)}`,
      bindings: ['*b', '*b'],
    });
    expect(probe.compile({ v: { $ilike: 'A_B' } })).toEqual({
      sql: `select * from \`stored_nul_like\` where ${wholeValue('lower(`v`)', 'lower(?)', 1)}`,
      bindings: ['A?B', 'A?B'],
    });
  });

  it('the stand-in skips every literal of the pattern and every ASCII letter', () => {
    expect(probe.compile({ v: { $like: '_' + SOH + '_' } }).sql).toContain('|| char(2) FROM');
    const STX = String.fromCharCode(0x02);
    expect(probe.compile({ v: { $like: '%' + SOH + STX + '%' } }).sql).toContain('|| char(3) FROM');
    // An escaped U+0001 is a literal as well.
    expect(probe.compile({ v: { $like: '%\\' + SOH + '_' } }).sql).toContain('|| char(2) FROM');
  });

  it('EXPLAIN QUERY PLAN keeps the index range for a literal prefix and scans otherwise', async () => {
    const driver = new CompilerProbeDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    try {
      await driver.initObjects([{ name: TABLE, fields: { v: { type: 'text' } } }]);
      await driver.execute(`CREATE INDEX ${TABLE}_v ON ${TABLE} (v)`);
      const plan = async (where: FilterCondition) => {
        const { sql, bindings } = driver.compile(where);
        const rows = (await driver.execute(`EXPLAIN QUERY PLAN ${sql}`, [...bindings])) as Array<{ detail: string }>;
        return rows.map((r) => r.detail).join(' | ');
      };
      for (const pattern of ['ab%', 'ab_', 'ab%cd', 'abc']) {
        expect(await plan({ v: { $like: pattern } }), pattern).toMatch(
          /^SEARCH stored_nul_like USING (COVERING )?INDEX stored_nul_like_v \(v>\? AND v<\?\)/,
        );
      }
      expect(await plan({ v: { $like: '%b' } })).toMatch(/^SCAN stored_nul_like/);
    } finally {
      await driver.disconnect();
    }
  });
});
