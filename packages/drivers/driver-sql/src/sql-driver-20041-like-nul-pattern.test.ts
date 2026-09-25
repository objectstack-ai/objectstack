// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20041] A `$like` / `$ilike` pattern holding U+0000 is REFUSED by
 * `SqlDriver`, in the envelope its dangling-escape sibling answers with.
 *
 * ## What was measured before this file existed
 *
 * The SQLite arm compiles a pattern to `GLOB`, and SQLite reads a pattern only
 * up to its first U+0000, so the pattern was cut there and nothing was raised.
 * Measured at base `8d76c2d38c` through the public `find` on better-sqlite3,
 * against `@objectstack/formula` over the same rows: `$like: '%'` + U+0000
 * returned all 12 non-NULL rows where `formula` returns the two ending in
 * U+0000, and `$like: 'a'` + U+0000 + `'b'` also returned `'a'`. All 20
 * U+0000 cases of that probe (10 patterns, bare and under `$not`) differed on
 * this face, on `SqliteWasmDriver` and on `TursoDriver` local and remote,
 * identically; none differed on `driver-memory`.
 *
 * ## What is pinned
 *
 * - every U+0000 pattern, `$like` and `$ilike`, bare, under `$not`, and inside
 *   `$or` / `$and`, through `find` and `count`: `INVALID_FILTER` / 400, the
 *   error's own keys `code` and `status` only;
 *   - an UNMARKED caller gets the class statement and no operator, field, path
 *     or pattern (the #8220 fail direction), and the log gets all of them;
 *   - an `'author'`-marked caller gets the operator, field and PATH;
 * - the dangling escape keeps its own refusal, also when the pattern holds
 *   U+0000 as well;
 * - NUL-free `$like` / `$ilike` controls keep answering `formula`'s rows;
 * - the refusal fires on the walk, before the dialect is chosen, so the
 *   Postgres and MySQL compiles refuse it too (compiled with no server).
 *
 * The withheld seam's own four-way pin for this builder lives in
 * `sql-driver-compile-refusal-seam.test.ts`, beside every other door.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Knex } from 'knex';
import { markFilterSubtreeProvenance, type DriverOptions, type FilterCondition } from '@objectstack/spec/data';
import { matchesFilterCondition } from '@objectstack/formula';
import { SqlDriver, type SqlDriverConfig } from './index.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const NUL = String.fromCharCode(0x00);
const TABLE = 'like_nul_pattern';
const BYPASS: DriverOptions = { bypassTenantAudit: true };
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

/** [operator, pattern] — U+0000 at the start, middle and end, alone, escaped, beside wildcards. */
const NUL_PATTERNS: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ['$like', '%' + NUL],
  ['$like', NUL + '%'],
  ['$like', '%' + NUL + '%'],
  ['$like', 'a' + NUL + 'b'],
  ['$like', '_' + NUL + '_'],
  ['$like', '\\' + NUL],
  ['$like', NUL],
  ['$ilike', '%' + NUL + 'B'],
  ['$ilike', 'AB' + NUL],
];

const shown = (s: string) => JSON.stringify(s);

const CONTROLS: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ['$like', '%'],
  ['$like', 'a%'],
  ['$like', '%b'],
  ['$like', 'a_b'],
  ['$like', ''],
  ['$like', '_'],
  ['$ilike', '%B'],
  ['$ilike', 'ab'],
];

describe('[#20041] SqlDriver (better-sqlite3): a $like / $ilike pattern holding U+0000 is refused', () => {
  let driver: SqlDriver;
  let logged: string[];

  beforeAll(async () => {
    driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true });
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

  const refusalOf = async (where: unknown, via: 'find' | 'count' = 'find'): Promise<WireBearingError> => {
    try {
      if (via === 'find') await driver.find(TABLE, { where: where as FilterCondition }, BYPASS);
      else await driver.count(TABLE, { where: where as FilterCondition }, BYPASS);
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
    const positions: ReadonlyArray<readonly [string, () => Record<string, unknown>, string]> = [
      ['bare', () => ({ v: { [op]: pattern } }), `filter.v.${op}`],
      ['under $not', () => ({ $not: { v: { [op]: pattern } } }), `filter.$not.v.${op}`],
      ['inside $or', () => ({ $or: [{ label: 'ab' }, { v: { [op]: pattern } }] }), `filter.$or[1].v.${op}`],
      ['inside $and', () => ({ $and: [{ label: 'ab' }, { v: { [op]: pattern } }] }), `filter.$and[1].v.${op}`],
    ];
    for (const [where, build, path] of positions) {
      it(`${op} ${shown(pattern)} ${where}: unmarked ⇒ INVALID_FILTER / 400, class statement only`, async () => {
        for (const via of ['find', 'count'] as const) {
          logged = [];
          const err = await refusalOf(build(), via);
          expect(err.code, via).toBe('INVALID_FILTER');
          expect(err.status, via).toBe(400);
          expect(Object.keys(err).sort(), via).toEqual(['code', 'status']);
          expect(err.message, via).toContain(CLASS_STATEMENT);
          expect(err.message, via).not.toContain(path);
          expect(err.message, via).not.toContain('field "v"');
          expect(err.message, via).not.toContain(NUL);
          // Relocated, not deleted: the operator, the field and the path are in the log.
          const log = logged.join('\n');
          expect(log, via).toContain(`Operator "${op}" on field "v" at ${path}`);
        }
      });

      it(`${op} ${shown(pattern)} ${where}: author-marked ⇒ the operator, the field and the path`, async () => {
        const err = await refusalOf(markFilterSubtreeProvenance(build(), 'author'));
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain(`Operator "${op}" on field "v" at ${path} ${CLASS_STATEMENT}`);
        expect(err.message).toContain(shown(pattern));
      });
    }
  }

  it('the dangling escape keeps its own refusal, including when the pattern also holds U+0000', async () => {
    for (const pattern of ['abc\\', 'a' + NUL + '\\']) {
      const err = await refusalOf(markFilterSubtreeProvenance({ v: { $like: pattern } }, 'author'));
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('Operator "$like" on field "v" at filter.v.$like has a pattern ending in a lone unpaired backslash');
      expect(err.message).not.toContain(CLASS_STATEMENT);
    }
  });

  for (const [op, pattern] of CONTROLS) {
    it(`control: ${op} ${shown(pattern)} (no U+0000) answers formula's rows, bare and under $not`, async () => {
      for (const where of [{ v: { [op]: pattern } }, { $not: { v: { [op]: pattern } } }] as FilterCondition[]) {
        expect(await labels(where), JSON.stringify(where)).toEqual(formulaLabels(where));
      }
    });
  }
});

describe('[#20041] every dialect of SqlDriver refuses it on the walk, before emitting SQL', () => {
  class CompilerProbeDriver extends SqlDriver {
    compileWhere(where: FilterCondition): string {
      const builder: Knex.QueryBuilder = this.getKnex()(TABLE);
      this.applyFilters(builder, where);
      return builder.toString();
    }
  }

  const DIALECTS: Array<[string, SqlDriverConfig]> = [
    ['sqlite', { client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }],
    ['postgres', { client: 'pg', connection: { host: '127.0.0.1' } }],
    ['mysql', { client: 'mysql2', connection: { host: '127.0.0.1' } }],
  ];

  for (const [label, config] of DIALECTS) {
    it(`${label}: refused with INVALID_FILTER / 400; the NUL-free control still compiles`, () => {
      const d = new CompilerProbeDriver(config);
      d.registerExternalObject({ name: TABLE, fields: { label: { type: 'string' }, v: { type: 'text' } } });
      for (const op of ['$like', '$ilike'] as const) {
        let err: WireBearingError | undefined;
        try {
          d.compileWhere({ v: { [op]: 'a' + NUL + '%' } } as FilterCondition);
        } catch (e) {
          err = e as WireBearingError;
        }
        expect(err, `${label} ${op}`).toBeDefined();
        expect(err!.code).toBe('INVALID_FILTER');
        expect(err!.status).toBe(400);
        expect(err!.message).toContain(CLASS_STATEMENT);
        expect(d.compileWhere({ v: { [op]: 'a%' } } as FilterCondition), `${label} ${op} control`).toMatch(/LIKE|GLOB/);
      }
    });
  }
});
