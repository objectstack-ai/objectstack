// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#19999] A `$contains` / `$notContains` / `$icontains` / `$startsWith` /
 * `$endsWith` comparand that holds U+0000 is compared WHOLE on SQLite — against
 * the whole stored value.
 *
 * Before the fix the SQLite arm of `textMatchPredicate` compiled every one of
 * them to `GLOB`, and SQLite's `glob()` reads BOTH of its arguments as C
 * strings: the pattern and the stored value are each cut at their first
 * U+0000. Measured at base `fc6ddb87a` on better-sqlite3 (SQLite 3.53.4),
 * sql.js (3.49.1) and a local libSQL engine (3.45.1), all three alike:
 * `$contains` and `$endsWith` with a comparand that STARTS with U+0000 matched
 * every row (the pattern was cut to `*`), and `$startsWith` of one matched the
 * rows that are empty before their first U+0000, `''` among them. Neither
 * raised.
 *
 * What the arm emits now for such a comparand is length-aware, and each piece
 * was measured NUL-safe on those three engines before it was used: `instr()`
 * (byte-exact `memcmp`, positions in characters), `lower()`, and `substr()` /
 * `length()` over a BLOB. `length()` and `substr()` over TEXT are NOT — they
 * stop at the first U+0000 (`length('a' || char(0) || 'b')` is 1) — which is
 * why the suffix test goes through `CAST(… AS BLOB)`.
 *
 * The expected rows are the JavaScript answer: every case is checked against
 * `@objectstack/formula`'s `matchesFilterCondition` (the JS baseline face) as
 * well as pinned literally, so the table cannot drift from what the other
 * faces answer. `driver-memory` answered the same 50-row probe identically.
 *
 * A comparand WITHOUT U+0000 keeps `GLOB` and binds exactly what it bound
 * before, so no existing plan moves; the second block pins that.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqlDriver } from './sql-driver.js';

const NUL = String.fromCharCode(0x00);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'nul_text_match';

/**
 * label → stored value. The first five are the rows the card's refinement
 * measured; the rest add a case-fold pair, the GLOB metacharacters behind a
 * U+0000, a non-ASCII letter for the ASCII-only fold, and a NULL for the
 * NULL-safe negation.
 */
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

interface NulCase {
  readonly op: TextOp;
  readonly comparand: string;
  readonly expected: readonly string[];
}

const NUL_CASES: readonly NulCase[] = [
  // The refinement's table, each row with its JavaScript answer.
  { op: '$contains', comparand: NUL, expected: ['accent_nul', 'glob_nul', 'nul_lead', 'nul_mid', 'nul_trail', 'upper_nul'] },
  { op: '$endsWith', comparand: NUL, expected: ['accent_nul', 'nul_trail'] },
  { op: '$contains', comparand: NUL + 'b', expected: ['nul_mid'] },
  { op: '$contains', comparand: 'a' + NUL, expected: ['nul_mid'] },
  { op: '$startsWith', comparand: NUL, expected: ['nul_lead'] },
  { op: '$startsWith', comparand: 'a' + NUL, expected: ['nul_mid'] },
  // The other two shapes of a comparand that starts with U+0000.
  { op: '$endsWith', comparand: NUL + 'b', expected: ['nul_mid'] },
  { op: '$startsWith', comparand: NUL + 'z', expected: ['nul_lead'] },
  // A comparand exactly as long as the value, and longer than the values it
  // could end or start.
  { op: '$endsWith', comparand: 'A' + NUL + 'B', expected: ['upper_nul'] },
  { op: '$endsWith', comparand: 'zz' + NUL + 'b', expected: [] },
  { op: '$startsWith', comparand: 'ab' + NUL + 'x', expected: [] },
  // The negation, NULL-safe: a missing value does not contain anything.
  { op: '$notContains', comparand: NUL, expected: ['empty', 'missing', 'plain'] },
  {
    op: '$notContains',
    comparand: NUL + 'b',
    expected: ['accent_nul', 'empty', 'glob_nul', 'missing', 'nul_lead', 'nul_trail', 'plain', 'upper_nul'],
  },
  // The fold: ASCII on both sides, and nothing else.
  { op: '$icontains', comparand: NUL + 'B', expected: ['nul_mid', 'upper_nul'] },
  { op: '$icontains', comparand: 'a' + NUL + 'B', expected: ['nul_mid', 'upper_nul'] },
  { op: '$icontains', comparand: 'cafÉ' + NUL, expected: ['accent_nul'] },
  { op: '$icontains', comparand: 'café' + NUL, expected: [] },
  // GLOB's metacharacters stay literal behind a U+0000 (#5567's bypass, in
  // GLOB's spelling): read as wildcards, each of these matches far more.
  { op: '$contains', comparand: NUL + '*', expected: ['glob_nul'] },
  { op: '$contains', comparand: NUL + '*?[', expected: ['glob_nul'] },
  { op: '$startsWith', comparand: 'x' + NUL + '*', expected: ['glob_nul'] },
  { op: '$endsWith', comparand: NUL + '*?[y', expected: ['glob_nul'] },
  // No row holds U+0000 then `?`; read as GLOB's any-one-character, it would
  // exclude every row that holds a U+0000 followed by anything.
  { op: '$notContains', comparand: NUL + '?', expected: Object.keys(ROWS).sort() },
];

const show = (s: string) => JSON.stringify(s).replace(/\\u0000/g, 'U+0000');

/** The JavaScript baseline face's answer over the same rows. */
function jsAnswer(where: FilterCondition): string[] {
  return Object.entries(ROWS)
    .filter(([, v]) => matchesFilterCondition({ v }, where))
    .map(([label]) => label)
    .sort();
}

describe('[#19999] the expected rows are the JavaScript answer', () => {
  for (const c of NUL_CASES) {
    it(`${c.op} ${show(c.comparand)}`, () => {
      expect(jsAnswer({ v: { [c.op]: c.comparand } } as FilterCondition)).toEqual([...c.expected]);
    });
  }
});

describe('[#19999] SqlDriver on better-sqlite3 — a comparand holding U+0000 is compared whole', () => {
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
    )) as Array<{
      label: string;
      h: string | null;
    }>;
    const stored = Object.fromEntries(rows.map((r) => [r.label, r.h]));
    for (const [label, v] of Object.entries(ROWS)) {
      expect(stored[label], label).toBe(v === null ? null : Buffer.from(v, 'utf8').toString('hex').toUpperCase());
    }
  });

  for (const c of NUL_CASES) {
    it(`${c.op} ${show(c.comparand)} answers the JavaScript rows`, async () => {
      expect(await labelsWhere({ v: { [c.op]: c.comparand } } as FilterCondition)).toEqual([...c.expected]);
    });
  }
});

describe('[#19999] the SQLite construct, compiled', () => {
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

  /**
   * A comparand without U+0000 compiles exactly as it did before this change —
   * `GLOB`, one bound escaped pattern — so no existing plan moves (a
   * `$startsWith` GLOB over an indexed column can still use the index).
   */
  it('a comparand without U+0000 keeps GLOB and its pattern', () => {
    expect(probe.compile({ v: { $contains: 'a*b' } })).toEqual({
      sql: 'select * from `nul_text_match` where `v` GLOB ?',
      bindings: ['*a[*]b*'],
    });
    expect(probe.compile({ v: { $startsWith: 'ab' } }).bindings).toEqual(['ab*']);
    expect(probe.compile({ v: { $endsWith: 'ab' } }).bindings).toEqual(['*ab']);
    expect(probe.compile({ v: { $icontains: 'Ab' } })).toEqual({
      sql: 'select * from `nul_text_match` where lower(`v`) GLOB lower(?)',
      bindings: ['*Ab*'],
    });
    expect(probe.compile({ v: { $notContains: 'ab' } }).sql).toMatch(/`v` NOT GLOB \?/);
  });

  /**
   * A comparand holding U+0000 never reaches `GLOB`, and is bound RAW: the
   * length-aware construct has no pattern language, so there is nothing to
   * escape — a `[*]` class bound here would be searched for literally.
   */
  for (const op of ['$contains', '$notContains', '$icontains', '$startsWith', '$endsWith'] as const) {
    it(`${op}: a comparand holding U+0000 compiles without GLOB and binds it raw`, () => {
      const comparand = 'a' + NUL + '*';
      const { sql, bindings } = probe.compile({ v: { [op]: comparand } } as FilterCondition);
      expect(sql).not.toMatch(/GLOB/);
      expect(bindings.length).toBeGreaterThan(0);
      for (const b of bindings) expect(b).toBe(comparand);
    });
  }
});
