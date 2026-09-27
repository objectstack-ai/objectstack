// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20143] driver-memory — `$like` / `$ilike` `_` is ONE Unicode code point on
 * EVERY door, the answer every SQLite face gives.
 *
 * This driver answers `$like` on three doors: the `$`-spelling through mingo
 * (`normalizeFilterCondition`), the AST comparison node `like` / `ilike`
 * through mingo (`convertConditionToMongo`), and the reference matcher. The
 * two mingo doors compiled the spec's `likePatternToRegexSource` with a local
 * `new RegExp(...)` and no flags, and the matcher evaluated the spec's
 * `matchesLikePattern`, which did the same — so all three read one UTF-16 code
 * unit per `_`. Measured at base `e7f69dbb`: `$like: '_'` missed a stored
 * `😀` that better-sqlite3, sql.js and `TursoDriver` (local, and remote on a
 * real libSQL engine) all returned, on both mingo doors. The mingo doors now
 * take the spec's `likePatternToRegExp` (the `u` flag), and the matcher
 * inherits it through `matchesLikePattern`.
 *
 * Each door is asserted against the literal code-point rows, not merely
 * against the others: parity alone is satisfied by breaking all three alike.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

const GRIN = String.fromCodePoint(0x1f600);
const SCRIPT_A = String.fromCodePoint(0x1d49c);
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

/** [op, pattern, the code-point rows — the SQLite faces' answer]. */
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

describe('[#20143] driver-memory — `_` is one code point on every door', () => {
  let driver: InMemoryDriver;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false, logger: { info() {}, warn() {}, error() {}, debug() {} } as never });
    await driver.connect();
    for (const [label, v] of Object.entries(ROWS)) await driver.create(TABLE, { label, v });
  });

  const labels = (rows: Array<Record<string, unknown>>): string[] => rows.map((r) => String(r.label)).sort();

  it('stored every value whole (the premise)', async () => {
    const rows = (await driver.find(TABLE, {})) as Array<{ label: string; v: string }>;
    expect(Object.fromEntries(rows.map((r) => [r.label, r.v]))).toEqual(ROWS);
  });

  for (const [op, pattern, expected] of FAMILY) {
    it(`${op} ${JSON.stringify(pattern)} answers the code-point rows on all three doors`, async () => {
      const where = { v: { [op]: pattern } };
      const ast = { type: 'comparison', field: 'v', operator: op === '$ilike' ? 'ilike' : 'like', value: pattern };
      expect({
        dollarQuery: labels(await driver.find(TABLE, { where: where as never })),
        astQuery: labels(await driver.find(TABLE, { where: ast as never })),
        matcher: Object.entries(ROWS).filter(([label, v]) => match({ label, v }, where)).map(([l]) => l).sort(),
      }).toEqual({ dollarQuery: [...expected], astQuery: [...expected], matcher: [...expected] });
    });
  }
});
