// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20024] A `$contains` / `$notContains` / `$icontains` / `$endsWith` comparand
 * WITHOUT U+0000 reads the whole STORED value on SQLite, U+0000s included.
 *
 * #19999 moved a comparand that HOLDS U+0000 off `GLOB`, because SQLite's
 * `glob()` reads both of its arguments as C strings. The other half of that
 * cut stayed: with a comparand free of U+0000, `GLOB` still saw a stored value
 * only up to its first U+0000. Measured at base `9d81af714` on better-sqlite3
 * (SQLite 3.53.4), sql.js (3.49.1), `TursoDriver` local, and `TursoDriver`
 * remote over a real `@libsql/client` engine (3.45.1), all four alike: 38 of 70
 * bare cases per face (14 comparands times 5 operators) answered differently
 * from `@objectstack/formula`, and 0 of the 14 `$startsWith` cases did. For
 * example `$contains: 'b'` missed `'a'` + U+0000 + `'b'`, `$endsWith: 'a'`
 * returned it, and `$icontains: 'B'` missed `'A'` + U+0000 + `'B'`.
 *
 * Every `contains` / `ends` comparand now goes to the length-aware constructs
 * #19999 introduced (`instr()`, and a byte suffix over BLOB). `$startsWith`
 * with a comparand free of U+0000 keeps `GLOB` byte for byte: a prefix free of
 * U+0000 lies wholly before the value's first U+0000 or is not a prefix at
 * all, so the value's cut cannot change that answer, and the prefix pattern is
 * the one text construct an index serves. The `$startsWith` rows below pin
 * that, including values that begin with U+0000.
 *
 * Every case is pinned literally AND checked against `formula`'s
 * `matchesFilterCondition` (the JS baseline face), so the table cannot drift
 * from what the other faces answer. The compositions put `$not` / `$or` /
 * `$and` over each moved shape, where a NULL predicate and a false one part
 * ways; the `''` and NULL rows are in every answer set.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqlDriver } from './sql-driver.js';

const NUL = String.fromCharCode(0x00);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'stored_nul_text_match';

/** label → stored value: U+0000 at the start, middle and end, and none. */
const ROWS: Readonly<Record<string, string | null>> = {
  nul_mid: 'a' + NUL + 'b',
  nul_trail: 'ab' + NUL,
  nul_lead: NUL + 'z',
  plain: 'plain',
  empty: '',
  upper_nul: 'A' + NUL + 'B',
  glob_nul: 'x' + NUL + '*?[y',
  accent_nul: 'CAFÉ' + NUL,
  missing: null,
  b_nul_a: 'b' + NUL + 'a',
  mb_nul: 'é' + NUL + 'ü',
  zz_nul_b: 'zz' + NUL + 'b',
};

const EVERY_VALUE = Object.keys(ROWS).filter((l) => ROWS[l] !== null).sort();

interface RowCase {
  readonly name: string;
  readonly where: FilterCondition;
  readonly expected: readonly string[];
}

const BARE_CASES: readonly RowCase[] = [
  // `contains`: the substring after a stored U+0000 is found.
  { name: "$contains 'b'", where: { v: { $contains: 'b' } }, expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'zz_nul_b'] },
  { name: "$contains 'z'", where: { v: { $contains: 'z' } }, expected: ['nul_lead', 'zz_nul_b'] },
  { name: "$contains 'y'", where: { v: { $contains: 'y' } }, expected: ['glob_nul'] },
  // GLOB's metacharacters, literal, behind a stored U+0000.
  { name: "$contains '*?[y'", where: { v: { $contains: '*?[y' } }, expected: ['glob_nul'] },
  { name: "$contains 'ü' (multi-byte behind U+0000)", where: { v: { $contains: 'ü' } }, expected: ['mb_nul'] },
  { name: "$contains ''", where: { v: { $contains: '' } }, expected: EVERY_VALUE },
  // `$notContains`, NULL-safe: a missing value does not contain anything.
  {
    name: "$notContains 'b'",
    where: { v: { $notContains: 'b' } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul'],
  },
  {
    name: "$notContains 'z'",
    where: { v: { $notContains: 'z' } },
    expected: ['accent_nul', 'b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_mid', 'nul_trail', 'plain', 'upper_nul'],
  },
  { name: "$notContains ''", where: { v: { $notContains: '' } }, expected: ['missing'] },
  // `$icontains`: the ASCII fold, past a stored U+0000, and nothing but ASCII.
  {
    name: "$icontains 'B'",
    where: { v: { $icontains: 'B' } },
    expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'upper_nul', 'zz_nul_b'],
  },
  { name: "$icontains 'É'", where: { v: { $icontains: 'É' } }, expected: ['accent_nul'] },
  { name: "$icontains 'é'", where: { v: { $icontains: 'é' } }, expected: ['mb_nul'] },
  // `ends`: the value's LAST bytes, not the bytes before its first U+0000.
  { name: "$endsWith 'a'", where: { v: { $endsWith: 'a' } }, expected: ['b_nul_a'] },
  { name: "$endsWith 'b'", where: { v: { $endsWith: 'b' } }, expected: ['nul_mid', 'zz_nul_b'] },
  { name: "$endsWith 'z'", where: { v: { $endsWith: 'z' } }, expected: ['nul_lead'] },
  { name: "$endsWith 'y'", where: { v: { $endsWith: 'y' } }, expected: ['glob_nul'] },
  { name: "$endsWith 'ab' (the value ends in U+0000)", where: { v: { $endsWith: 'ab' } }, expected: [] },
  { name: "$endsWith 'plain'", where: { v: { $endsWith: 'plain' } }, expected: ['plain'] },
  // The empty suffix ends every value; `-length('')` must not reach `substr`.
  { name: "$endsWith ''", where: { v: { $endsWith: '' } }, expected: EVERY_VALUE },
  // `$startsWith` stays on GLOB and was already right, U+0000-led values included.
  { name: "$startsWith 'a'", where: { v: { $startsWith: 'a' } }, expected: ['nul_mid', 'nul_trail'] },
  { name: "$startsWith 'ab'", where: { v: { $startsWith: 'ab' } }, expected: ['nul_trail'] },
  { name: "$startsWith 'z'", where: { v: { $startsWith: 'z' } }, expected: ['zz_nul_b'] },
  { name: "$startsWith 'x'", where: { v: { $startsWith: 'x' } }, expected: ['glob_nul'] },
  { name: "$startsWith ''", where: { v: { $startsWith: '' } }, expected: EVERY_VALUE },
];

/**
 * `$not` / `$or` / `$and` over each moved shape. A predicate that answered NULL
 * where the answer is false would lose its row under `$not` — invisible to the
 * bare cases above.
 */
const COMPOSED_CASES: readonly RowCase[] = [
  {
    name: "$not $contains 'b'",
    where: { $not: { v: { $contains: 'b' } } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul'],
  },
  {
    name: "$not $notContains 'b'",
    where: { $not: { v: { $notContains: 'b' } } },
    expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'zz_nul_b'],
  },
  {
    name: "$not $icontains 'B'",
    where: { $not: { v: { $icontains: 'B' } } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain'],
  },
  {
    name: "$not $endsWith 'a'",
    where: { $not: { v: { $endsWith: 'a' } } },
    expected: [
      'accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'nul_mid', 'nul_trail', 'plain', 'upper_nul',
      'zz_nul_b',
    ],
  },
  {
    name: "$not $endsWith 'b'",
    where: { $not: { v: { $endsWith: 'b' } } },
    expected: ['accent_nul', 'b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { name: "$not $endsWith ''", where: { $not: { v: { $endsWith: '' } } }, expected: ['missing'] },
  {
    name: "$not $startsWith 'a'",
    where: { $not: { v: { $startsWith: 'a' } } },
    expected: ['accent_nul', 'b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul', 'zz_nul_b'],
  },
  {
    name: "$or [$contains 'b', $endsWith 'z']",
    where: { $or: [{ v: { $contains: 'b' } }, { v: { $endsWith: 'z' } }] },
    expected: ['b_nul_a', 'nul_lead', 'nul_mid', 'nul_trail', 'zz_nul_b'],
  },
  {
    name: "$and [$notContains 'z', $endsWith 'b']",
    where: { $and: [{ v: { $notContains: 'z' } }, { v: { $endsWith: 'b' } }] },
    expected: ['nul_mid'],
  },
  {
    name: "$not $or [$endsWith 'a', $icontains 'B']",
    where: { $not: { $or: [{ v: { $endsWith: 'a' } }, { v: { $icontains: 'B' } }] } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain'],
  },
  {
    name: "$not $and [$contains 'z', $endsWith 'z']",
    where: { $not: { $and: [{ v: { $contains: 'z' } }, { v: { $endsWith: 'z' } }] } },
    expected: [
      'accent_nul', 'b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_mid', 'nul_trail', 'plain', 'upper_nul',
      'zz_nul_b',
    ],
  },
];

const ALL_CASES: readonly RowCase[] = [...BARE_CASES, ...COMPOSED_CASES];

/** The JavaScript baseline face's answer over the same rows. */
function jsAnswer(where: FilterCondition): string[] {
  return Object.entries(ROWS)
    .filter(([, v]) => matchesFilterCondition({ v }, where))
    .map(([label]) => label)
    .sort();
}

describe('[#20024] the expected rows are the JavaScript answer', () => {
  for (const c of ALL_CASES) {
    it(c.name, () => {
      expect(jsAnswer(c.where)).toEqual([...c.expected]);
    });
  }
});

describe('[#20024] SqlDriver on better-sqlite3 — a comparand without U+0000 reads the whole stored value', () => {
  let driver: SqlDriver;

  const labelsWhere = async (where: FilterCondition): Promise<string[]> => {
    const rows = (await driver.find(TABLE, { where }, BYPASS)) as Array<{ label: string }>;
    return rows.map((r) => r.label).sort();
  };

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
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

  for (const c of ALL_CASES) {
    it(`${c.name} answers the JavaScript rows`, async () => {
      expect(await labelsWhere(c.where)).toEqual([...c.expected]);
    });
  }
});

describe('[#20024] the SQLite constructs, compiled, for a comparand without U+0000', () => {
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

  afterAll(async () => {
    await probe.disconnect();
  });

  it('$contains / $notContains / $icontains / $endsWith never reach GLOB, and bind the comparand raw', () => {
    expect(probe.compile({ v: { $contains: 'a*b' } })).toEqual({
      sql: 'select * from `stored_nul_text_match` where instr(`v`, ?) > 0',
      bindings: ['a*b'],
    });
    expect(probe.compile({ v: { $notContains: 'a*b' } })).toEqual({
      sql: 'select * from `stored_nul_text_match` where (`v` is null or NOT (instr(`v`, ?) > 0))',
      bindings: ['a*b'],
    });
    expect(probe.compile({ v: { $icontains: 'A*b' } })).toEqual({
      sql: 'select * from `stored_nul_text_match` where instr(lower(`v`), lower(?)) > 0',
      bindings: ['A*b'],
    });
    expect(probe.compile({ v: { $endsWith: 'a*b' } })).toEqual({
      sql:
        'select * from `stored_nul_text_match` where coalesce(substr(CAST(`v` AS BLOB), -length(CAST(? AS BLOB))), '
        + 'CAST(`v` AS BLOB)) = CAST(? AS BLOB)',
      bindings: ['a*b', 'a*b'],
    });
  });

  it("an empty $endsWith comparand takes instr(), never the suffix's substr(…, -0)", () => {
    expect(probe.compile({ v: { $endsWith: '' } })).toEqual({
      sql: 'select * from `stored_nul_text_match` where instr(`v`, ?) > 0',
      bindings: [''],
    });
  });

  /**
   * `$startsWith` without U+0000 compiles exactly as before #20024 — `GLOB` and
   * one escaped prefix pattern — so the plan an index gives it is kept.
   */
  it('$startsWith keeps GLOB and its escaped prefix pattern, byte for byte', () => {
    expect(probe.compile({ v: { $startsWith: 'a*b' } })).toEqual({
      sql: 'select * from `stored_nul_text_match` where `v` GLOB ?',
      bindings: ['a[*]b*'],
    });
  });
});
