// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20041] `SqliteWasmDriver` refuses a `$like` / `$ilike` pattern holding
 * U+0000, in the same envelope as `SqlDriver`, whose filter compiler it
 * inherits.
 *
 * sql.js compiles the pattern to `GLOB` and reads it only up to its first
 * U+0000, so the pattern was cut there and answered a different question.
 * Measured at base `8d76c2d38c` through `find`, over the same rows as
 * `driver-sql`'s probe: all 20 U+0000 cases differed from
 * `@objectstack/formula`, byte-identical to better-sqlite3 (for example
 * `$like: '%'` + U+0000 returned all 12 non-NULL rows, where `formula` returns
 * two). The inherited walk now refuses it; this suite pins that the inheritance
 * holds on this engine, and that NUL-free controls still answer `formula`'s
 * rows.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { markFilterSubtreeProvenance, type DriverOptions, type FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqliteWasmDriver } from './index.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const NUL = String.fromCharCode(0x00);
const BYPASS: DriverOptions = { bypassTenantAudit: true };
const TABLE = 'like_nul_pattern';
const CLASS_STATEMENT = 'has a pattern holding the NUL character U+0000';

/** Stored values WITHOUT U+0000: a stored U+0000 is #20024's other half, not this card's. */
const ROWS: Readonly<Record<string, string | null>> = {
  ab: 'ab',
  a: 'a',
  b: 'b',
  axb: 'axb',
  AB: 'AB',
  plain: 'plain',
  empty: '',
  missing: null,
};

const NUL_PATTERNS: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ['$like', '%' + NUL],
  ['$like', NUL + '%'],
  ['$like', 'a' + NUL + 'b'],
  ['$like', '\\' + NUL],
  ['$ilike', '%' + NUL + 'B'],
];

const CONTROLS: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ['$like', '%'],
  ['$like', 'a%'],
  ['$like', 'a_b'],
  ['$like', ''],
  ['$ilike', '%B'],
];

describe('[#20041] SqliteWasmDriver: a $like / $ilike pattern holding U+0000 is refused', () => {
  let driver: SqliteWasmDriver;
  let logged: string[];

  beforeAll(async () => {
    driver = new SqliteWasmDriver({ filename: ':memory:' });
    await driver.initObjects([{ name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } }]);
    for (const [label, v] of Object.entries(ROWS)) await driver.create(TABLE, { label, v }, BYPASS);
    logged = [];
    (driver as unknown as { logger: unknown }).logger = {
      warn: (m: string) => { logged.push(String(m)); },
      error: () => {},
      info: () => {},
      debug: () => {},
    };
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    try {
      await driver.find(TABLE, { where: where as FilterCondition }, BYPASS);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error(`expected a refusal for ${JSON.stringify(where)}, but the filter resolved`);
  };

  const labels = async (where: FilterCondition): Promise<string[]> =>
    ((await driver.find(TABLE, { where }, BYPASS)) as Array<{ label: string }>).map((r) => r.label).sort();

  const formulaLabels = (where: FilterCondition): string[] =>
    Object.entries(ROWS)
      .filter(([, v]) => matchesFilterCondition({ v }, where))
      .map(([l]) => l)
      .sort();

  for (const [op, pattern] of NUL_PATTERNS) {
    for (const [position, build, path] of [
      ['bare', () => ({ v: { [op]: pattern } }), `filter.v.${op}`],
      ['under $not', () => ({ $not: { v: { [op]: pattern } } }), `filter.$not.v.${op}`],
    ] as const) {
      it(`${op} ${JSON.stringify(pattern)} ${position}: INVALID_FILTER / 400; the path reaches an author, and only the log otherwise`, async () => {
        logged = [];
        const unmarked = await refusalOf(build());
        expect(unmarked.code).toBe('INVALID_FILTER');
        expect(unmarked.status).toBe(400);
        expect(Object.keys(unmarked).sort()).toEqual(['code', 'status']);
        expect(unmarked.message).toContain(CLASS_STATEMENT);
        expect(unmarked.message).not.toContain(path);
        expect(logged.join('\n')).toContain(`Operator "${op}" on field "v" at ${path}`);

        const author = await refusalOf(markFilterSubtreeProvenance(build(), 'author'));
        expect(author.code).toBe('INVALID_FILTER');
        expect(author.status).toBe(400);
        expect(author.message).toContain(`Operator "${op}" on field "v" at ${path} ${CLASS_STATEMENT}`);
      });
    }
  }

  it('the dangling escape keeps its own refusal, including when the pattern also holds U+0000', async () => {
    for (const pattern of ['abc\\', 'a' + NUL + '\\']) {
      const err = await refusalOf(markFilterSubtreeProvenance({ v: { $like: pattern } }, 'author'));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('at filter.v.$like has a pattern ending in a lone unpaired backslash');
    }
  });

  for (const [op, pattern] of CONTROLS) {
    it(`control: ${op} ${JSON.stringify(pattern)} (no U+0000) answers formula's rows, bare and under $not`, async () => {
      for (const where of [{ v: { [op]: pattern } }, { $not: { v: { [op]: pattern } } }] as FilterCondition[]) {
        expect(await labels(where), JSON.stringify(where)).toEqual(formulaLabels(where));
      }
    });
  }
});
