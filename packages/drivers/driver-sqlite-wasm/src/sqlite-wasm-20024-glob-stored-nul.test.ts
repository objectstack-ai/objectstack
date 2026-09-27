// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20024] On `SqliteWasmDriver` too, a `$contains` / `$notContains` /
 * `$icontains` / `$endsWith` comparand WITHOUT U+0000 reads the whole STORED
 * value, U+0000s included.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the compiler is inherited:
 * `textMatchPredicate`'s SQLite arm sends every `contains` / `ends` comparand
 * to the length-aware constructs (`instr()`, or a suffix comparison over BLOB)
 * instead of `GLOB`, whose `glob()` reads the stored value only up to its first
 * U+0000. `$startsWith` without U+0000 keeps `GLOB`, whose answer that cut
 * cannot change. The mechanism and its measurements are in `sql-driver.ts`
 * (`sqliteLengthAwareTextMatch`).
 *
 * What this engine adds is its own storage path: sql.js stores a value holding
 * U+0000 whole only through this package's exact-text bind (`sqljs-exact-text.ts`),
 * so the premise case below reads the stored bytes back. Measured at base
 * `9d81af714`, sql.js (SQLite 3.49.1) answered the bare cases exactly as
 * better-sqlite3 did, wrongly.
 *
 * The expected rows are the JavaScript answer, checked per case against
 * `@objectstack/formula`'s `matchesFilterCondition` as well as pinned
 * literally; they are the rows `driver-sql`'s `sql-driver-20024-glob-stored-nul`
 * suite pins.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqliteWasmDriver } from './index.js';

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

const CASES: ReadonlyArray<{ name: string; where: FilterCondition; expected: readonly string[] }> = [
  { name: "$contains 'b'", where: { v: { $contains: 'b' } }, expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'zz_nul_b'] },
  { name: "$contains 'z'", where: { v: { $contains: 'z' } }, expected: ['nul_lead', 'zz_nul_b'] },
  { name: "$contains '*?[y'", where: { v: { $contains: '*?[y' } }, expected: ['glob_nul'] },
  { name: "$contains 'ü'", where: { v: { $contains: 'ü' } }, expected: ['mb_nul'] },
  { name: "$contains ''", where: { v: { $contains: '' } }, expected: EVERY_VALUE },
  {
    name: "$notContains 'b'",
    where: { v: { $notContains: 'b' } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul'],
  },
  { name: "$notContains ''", where: { v: { $notContains: '' } }, expected: ['missing'] },
  {
    name: "$icontains 'B'",
    where: { v: { $icontains: 'B' } },
    expected: ['b_nul_a', 'nul_mid', 'nul_trail', 'upper_nul', 'zz_nul_b'],
  },
  { name: "$icontains 'é'", where: { v: { $icontains: 'é' } }, expected: ['mb_nul'] },
  { name: "$endsWith 'a'", where: { v: { $endsWith: 'a' } }, expected: ['b_nul_a'] },
  { name: "$endsWith 'b'", where: { v: { $endsWith: 'b' } }, expected: ['nul_mid', 'zz_nul_b'] },
  { name: "$endsWith 'z'", where: { v: { $endsWith: 'z' } }, expected: ['nul_lead'] },
  { name: "$endsWith 'ab'", where: { v: { $endsWith: 'ab' } }, expected: [] },
  { name: "$endsWith ''", where: { v: { $endsWith: '' } }, expected: EVERY_VALUE },
  { name: "$startsWith 'a'", where: { v: { $startsWith: 'a' } }, expected: ['nul_mid', 'nul_trail'] },
  { name: "$startsWith 'z'", where: { v: { $startsWith: 'z' } }, expected: ['zz_nul_b'] },
  // `$not` / `$or` / `$and` over the moved shapes, with the '' and NULL rows.
  {
    name: "$not $contains 'b'",
    where: { $not: { v: { $contains: 'b' } } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain', 'upper_nul'],
  },
  {
    name: "$not $icontains 'B'",
    where: { $not: { v: { $icontains: 'B' } } },
    expected: ['accent_nul', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'plain'],
  },
  {
    name: "$not $endsWith 'b'",
    where: { $not: { v: { $endsWith: 'b' } } },
    expected: ['accent_nul', 'b_nul_a', 'empty', 'glob_nul', 'mb_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { name: "$not $endsWith ''", where: { $not: { v: { $endsWith: '' } } }, expected: ['missing'] },
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
];

describe('[#20024] driver-sqlite-wasm — a comparand without U+0000 reads the whole stored value', () => {
  let driver: SqliteWasmDriver;

  const labelsWhere = async (where: FilterCondition): Promise<string[]> => {
    const rows = (await driver.find(TABLE, { where }, BYPASS)) as Array<{ label: string }>;
    return rows.map((r) => r.label).sort();
  };

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } }]);
    for (const [label, v] of Object.entries(ROWS)) await driver.create(TABLE, { label, v }, BYPASS);
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
      const js = Object.entries(ROWS)
        .filter(([, v]) => matchesFilterCondition({ v }, c.where))
        .map(([label]) => label)
        .sort();
      expect(js, 'the pinned rows are the JavaScript answer').toEqual([...c.expected]);
      expect(await labelsWhere(c.where)).toEqual([...c.expected]);
    });
  }
});
