// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19999] On `SqliteWasmDriver` too, a text comparand holding U+0000 is
 * compared whole — against the whole stored value.
 *
 * `SqliteWasmDriver extends SqlDriver`, so the compiler is inherited:
 * `textMatchPredicate`'s SQLite arm sends such a comparand to a length-aware
 * construct (`instr()`, or a suffix comparison over BLOB) instead of `GLOB`,
 * whose `glob()` cuts its pattern and the stored value at their first U+0000.
 * The mechanism and its measurements are in `sql-driver.ts`
 * (`sqliteLengthAwareTextMatch`).
 *
 * What this engine adds is its own transport. sql.js binds a text value up to
 * its first U+0000, so this package binds a string that holds one as its UTF-8
 * bytes and wraps the receiving parameter in `+CAST(… AS TEXT)`
 * (`sqljs-exact-text.ts`). The length-aware constructs bind the comparand at
 * one or two parameters, inside `lower()` and `CAST(… AS BLOB)`, so each case
 * below also checks that rewrite lands on every one of them — before the fix
 * sql.js 3.49.1 answered these cases exactly as better-sqlite3 did, wrongly.
 *
 * The expected rows are the JavaScript answer, checked per case against
 * `@objectstack/formula`'s `matchesFilterCondition` as well as pinned literally.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqliteWasmDriver } from './index.js';

const NUL = String.fromCharCode(0x00);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'nul_text_match';

/** label → stored value; the first five are the rows the card measured. */
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
};

type TextOp = '$contains' | '$notContains' | '$icontains' | '$startsWith' | '$endsWith';

const NUL_CASES: ReadonlyArray<{ op: TextOp; comparand: string; expected: readonly string[] }> = [
  { op: '$contains', comparand: NUL, expected: ['accent_nul', 'glob_nul', 'nul_lead', 'nul_mid', 'nul_trail', 'upper_nul'] },
  { op: '$endsWith', comparand: NUL, expected: ['accent_nul', 'nul_trail'] },
  { op: '$contains', comparand: NUL + 'b', expected: ['nul_mid'] },
  { op: '$contains', comparand: 'a' + NUL, expected: ['nul_mid'] },
  { op: '$startsWith', comparand: NUL, expected: ['nul_lead'] },
  { op: '$startsWith', comparand: 'a' + NUL, expected: ['nul_mid'] },
  { op: '$endsWith', comparand: NUL + 'b', expected: ['nul_mid'] },
  { op: '$startsWith', comparand: NUL + 'z', expected: ['nul_lead'] },
  { op: '$endsWith', comparand: 'A' + NUL + 'B', expected: ['upper_nul'] },
  { op: '$endsWith', comparand: 'zz' + NUL + 'b', expected: [] },
  { op: '$startsWith', comparand: 'ab' + NUL + 'x', expected: [] },
  { op: '$notContains', comparand: NUL, expected: ['empty', 'missing', 'plain'] },
  {
    op: '$notContains',
    comparand: NUL + 'b',
    expected: ['accent_nul', 'empty', 'glob_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { op: '$icontains', comparand: NUL + 'B', expected: ['nul_mid', 'upper_nul'] },
  { op: '$icontains', comparand: 'a' + NUL + 'B', expected: ['nul_mid', 'upper_nul'] },
  { op: '$icontains', comparand: 'cafÉ' + NUL, expected: ['accent_nul'] },
  { op: '$icontains', comparand: 'café' + NUL, expected: [] },
  { op: '$contains', comparand: NUL + '*', expected: ['glob_nul'] },
  { op: '$contains', comparand: NUL + '*?[', expected: ['glob_nul'] },
  { op: '$startsWith', comparand: 'x' + NUL + '*', expected: ['glob_nul'] },
  { op: '$endsWith', comparand: NUL + '*?[y', expected: ['glob_nul'] },
  { op: '$notContains', comparand: NUL + '?', expected: Object.keys(ROWS).sort() },
];

const show = (s: string) => JSON.stringify(s).replace(/\\u0000/g, 'U+0000');

/**
 * `$not` over `$endsWith`, which tells a NULL predicate from a false one where a
 * bare `$endsWith` cannot. `''` ends with no comparand holding U+0000, so each
 * negation below must return the `empty` row — and `substr()` over a
 * zero-length BLOB is NULL, not the empty blob, so the suffix construct has to
 * say false there itself.
 */
const NOT_ENDS_CASES: ReadonlyArray<{ comparand: string; expected: readonly string[] }> = [
  { comparand: NUL, expected: ['empty', 'glob_nul', 'missing', 'nul_lead', 'nul_mid', 'plain', 'upper_nul'] },
  {
    comparand: NUL + 'b',
    expected: ['accent_nul', 'empty', 'glob_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  { comparand: 'a' + NUL, expected: Object.keys(ROWS).sort() },
];

describe('[#19999] driver-sqlite-wasm — a comparand holding U+0000 is compared whole', () => {
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

  for (const c of NUL_CASES) {
    it(`${c.op} ${show(c.comparand)} answers the JavaScript rows`, async () => {
      const where = { v: { [c.op]: c.comparand } } as FilterCondition;
      const js = Object.entries(ROWS)
        .filter(([, v]) => matchesFilterCondition({ v }, where))
        .map(([label]) => label)
        .sort();
      expect(js, 'the pinned rows are the JavaScript answer').toEqual([...c.expected]);
      expect(await labelsWhere(where)).toEqual([...c.expected]);
    });
  }

  for (const c of NOT_ENDS_CASES) {
    it(`$not $endsWith ${show(c.comparand)} returns the '' row`, async () => {
      const where = { $not: { v: { $endsWith: c.comparand } } } as FilterCondition;
      const js = Object.entries(ROWS)
        .filter(([, v]) => matchesFilterCondition({ v }, where))
        .map(([label]) => label)
        .sort();
      expect(js, 'the pinned rows are the JavaScript answer').toEqual([...c.expected]);
      expect(await labelsWhere(where)).toEqual([...c.expected]);
    });
  }
});
