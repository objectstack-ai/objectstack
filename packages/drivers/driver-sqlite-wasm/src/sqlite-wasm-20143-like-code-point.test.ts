// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20143] `driver-sqlite-wasm` (sql.js) — `$like` / `$ilike` `_` is ONE
 * Unicode code point, and `@objectstack/formula` now gives the same rows.
 *
 * This face was already right: it compiles `$like` to GLOB over the spec's
 * `likePatternToGlobPattern`, and GLOB's `?` counts code points. The JS faces
 * compiled `likePatternToRegexSource` with no flags and counted UTF-16 code
 * units, so measured at base `e7f69dbb` `$like: '_'` returned a stored `😀`
 * here and not in `formula`. The spec's `likePatternToRegExp` now compiles with
 * the `u` flag, and the last case holds this face and `formula` to one answer.
 *
 * Each case asserts the literal code-point rows, not only the parity: parity
 * alone is satisfied by breaking both faces the same way. The same cells are
 * pinned on `driver-sql` (better-sqlite3), both `driver-turso` transports,
 * `driver-memory`, `formula` and the spec.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqliteWasmDriver } from './index.js';

const GRIN = String.fromCodePoint(0x1f600);
const SCRIPT_A = String.fromCodePoint(0x1d49c);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'like_code_point';

const ROWS: Readonly<Record<string, string>> = {
  x: 'x',
  grin: GRIN,
  grin_grin: GRIN + GRIN,
  a_grin_b: 'a' + GRIN + 'b',
  a_grin_grin_b: 'a' + GRIN + GRIN + 'b',
  upper_script_b: 'A' + SCRIPT_A + 'B',
  ab: 'ab',
  axb: 'axb',
  axyb: 'axyb',
};

/** [op, pattern, the code-point rows]. */
const FAMILY: ReadonlyArray<readonly ['$like' | '$ilike', string, readonly string[]]> = [
  ['$like', '_', ['grin', 'x']],
  ['$like', '__', ['ab', 'grin_grin']],
  ['$like', 'a_b', ['a_grin_b', 'axb']],
  ['$like', 'a__b', ['a_grin_grin_b', 'axyb']],
  ['$like', '___', ['a_grin_b', 'axb', 'upper_script_b']],
  ['$like', GRIN + '_', ['grin_grin']],
  ['$like', '_' + GRIN, ['grin_grin']],
  ['$ilike', '_', ['grin', 'x']],
  ['$ilike', 'A_B', ['a_grin_b', 'axb', 'upper_script_b']],
  ['$ilike', 'A__B', ['a_grin_grin_b', 'axyb']],
];

function formulaAnswer(where: FilterCondition): string[] {
  return Object.entries(ROWS)
    .filter(([, v]) => matchesFilterCondition({ v }, where))
    .map(([label]) => label)
    .sort();
}

describe('[#20143] driver-sqlite-wasm (sql.js) — `_` is one code point', () => {
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

  it('stored every value whole, as UTF-8 (the premise)', async () => {
    const rows = (await driver.execute(`select label, hex(v) as h from ${TABLE}`)) as Array<{ label: string; h: string }>;
    const stored = Object.fromEntries(rows.map((r) => [r.label, r.h]));
    for (const [label, v] of Object.entries(ROWS)) {
      expect(stored[label], label).toBe(Buffer.from(v, 'utf8').toString('hex').toUpperCase());
    }
  });

  for (const [op, pattern, expected] of FAMILY) {
    it(`${op} ${JSON.stringify(pattern)} answers the code-point rows`, async () => {
      expect(await labelsWhere({ v: { [op]: pattern } } as FilterCondition)).toEqual([...expected]);
    });
  }

  it('formula answers the same rows as this face on every family cell', async () => {
    const differing: string[] = [];
    for (const [op, pattern] of FAMILY) {
      const where = { v: { [op]: pattern } } as FilterCondition;
      const sql = await labelsWhere(where);
      const js = formulaAnswer(where);
      if (JSON.stringify(sql) !== JSON.stringify(js)) {
        differing.push(`${op} ${JSON.stringify(pattern)}: sql ${JSON.stringify(sql)} != formula ${JSON.stringify(js)}`);
      }
    }
    expect(differing).toEqual([]);
  });
});
