// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20024] On `SqliteWasmDriver` too, a `$like` / `$ilike` pattern WITHOUT
 * U+0000 reads the whole STORED value, U+0000s included.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the compiler is inherited:
 * `likePatternPredicate`'s SQLite arm rewrites a value holding U+0000 before
 * `GLOB` reads it, each U+0000 becoming one stand-in character the pattern
 * never names literally. The mechanism and its measurements are in
 * `sql-driver.ts` (`sqliteLikePatternMatch`).
 *
 * What this engine adds is its own storage path: sql.js stores a value holding
 * U+0000 whole only through this package's exact-text bind
 * (`sqljs-exact-text.ts`), so the premise case below reads the stored bytes
 * back. Measured at base `fe677aeeed`, sql.js (SQLite 3.49.1) answered exactly
 * as better-sqlite3 did, wrongly: 359 of 3380 cells over a value holding U+0000
 * differed from `@objectstack/formula` on the #20024 probe grid.
 *
 * The expected rows are the JavaScript answer, checked per case against
 * `@objectstack/formula`'s `matchesFilterCondition` as well as pinned
 * literally; they are the rows `driver-sql`'s `sql-driver-20024-like-stored-nul`
 * suite pins. The wider grid holds every cell to `formula`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqliteWasmDriver } from './index.js';

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

const CASES: ReadonlyArray<{ name: string; where: FilterCondition; expected: readonly string[] }> = [
  { name: "$like 'a'", where: { v: { $like: 'a' } }, expected: ['a'] },
  { name: "$like ''", where: { v: { $like: '' } }, expected: ['empty'] },
  { name: "$like '%b'", where: { v: { $like: '%b' } }, expected: ['a_b', 'a_soh_b', 'ab', 'nul_mid'] },
  { name: "$like 'a_b'", where: { v: { $like: 'a_b' } }, expected: ['a_b', 'a_soh_b', 'nul_mid'] },
  { name: "$like '_'", where: { v: { $like: '_' } }, expected: ['a', 'nul_only'] },
  { name: "$like '__'", where: { v: { $like: '__' } }, expected: ['ab', 'eu', 'nul_lead', 'nul_two'] },
  { name: "$like 'a%c'", where: { v: { $like: 'a%c' } }, expected: ['nul_multi'] },
  { name: "$like '%%'", where: { v: { $like: '%%' } }, expected: EVERY_VALUE },
  { name: "$like 'é_ü'", where: { v: { $like: 'é_ü' } }, expected: ['mb_nul'] },
  { name: "$like '\\%_\\_'", where: { v: { $like: '\\%_\\_' } }, expected: ['pct_nul'] },
  { name: "$like '\\\\_\\\\'", where: { v: { $like: '\\\\_\\\\' } }, expected: ['bs_nul'] },
  { name: "$like 'ab%'", where: { v: { $like: 'ab%' } }, expected: ['ab', 'nul_trail'] },
  { name: "$like 'ab_'", where: { v: { $like: 'ab_' } }, expected: ['nul_trail'] },
  { name: "$like '_' + U+0001 + '_'", where: { v: { $like: '_' + SOH + '_' } }, expected: ['a_soh_b'] },
  { name: "$ilike 'A_B'", where: { v: { $ilike: 'A_B' } }, expected: ['a_b', 'a_soh_b', 'nul_mid', 'upper_nul'] },
  { name: "$ilike 'É_Ü'", where: { v: { $ilike: 'É_Ü' } }, expected: [] },
  {
    name: "$not $like 'a_b'",
    where: { $not: { v: { $like: 'a_b' } } },
    expected: EVERY_VALUE.filter((l) => !['a_b', 'a_soh_b', 'nul_mid'].includes(l)).concat('missing').sort(),
  },
  {
    name: "$or [$like '_', $like '%c']",
    where: { $or: [{ v: { $like: '_' } }, { v: { $like: '%c' } }] },
    expected: ['a', 'nul_multi', 'nul_only'],
  },
  {
    name: "$not $or [$like '%b', $ilike 'A%']",
    where: { $not: { $or: [{ v: { $like: '%b' } }, { v: { $ilike: 'A%' } }] } },
    expected: [
      'bs_nul', 'cjk_nul', 'empty', 'eu', 'mb_nul', 'missing', 'nul_lead', 'nul_only', 'nul_two', 'pct_nul', 'soh_nul',
    ],
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

/** Exposes the compiled WHERE and its bindings without reaching into privates. */
class CompilerProbeDriver extends SqliteWasmDriver {
  compile(where: FilterCondition): { sql: string; bindings: readonly unknown[] } {
    const builder = this.getKnex()(TABLE);
    this.applyFilters(builder, where);
    const { sql, bindings } = builder.toSQL();
    return { sql, bindings };
  }
}

describe('[#20024] driver-sqlite-wasm — $like / $ilike read the whole stored value', () => {
  let driver: CompilerProbeDriver;

  const labelsWhere = async (where: FilterCondition): Promise<string[]> => {
    const rows = (await driver.find(TABLE, { where }, BYPASS)) as Array<{ label: string }>;
    return rows.map((r) => r.label).sort();
  };

  beforeAll(async () => {
    driver = new CompilerProbeDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } }]);
    for (const [label, v] of Object.entries(ROWS)) await driver.create(TABLE, { label, v }, BYPASS);
    await driver.execute(`CREATE INDEX ${TABLE}_v ON ${TABLE} (v)`);
  }, 60_000);

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
      expect(jsAnswer(c.where), 'the pinned rows are the JavaScript answer').toEqual([...c.expected]);
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

  it('EXPLAIN QUERY PLAN on sql.js keeps the index range for a literal prefix, and scans otherwise', async () => {
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
  });
});
