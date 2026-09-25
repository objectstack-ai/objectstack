// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20041] `driver-memory` refuses a `$like` / `$ilike` pattern holding U+0000
 * on every door that refuses a dangling escape — although it answered one
 * correctly.
 *
 * Measured at base `8d76c2d38c`: this driver's query path and its reference
 * matcher both answered every U+0000 pattern of the probe exactly as
 * `@objectstack/formula` did (20 of 20 cases, bare and under `$not`), because
 * `likePatternToRegexSource` reads every character. The SQLite faces did not:
 * their `GLOB` reads a pattern only up to its first U+0000, and there is no
 * NUL-safe primitive to compile to instead. An in-memory double that answers a
 * filter production refuses is the "one filter, two answers" divergence this
 * driver exists to avoid, so it refuses the same patterns, through the spec's
 * shared `hasNulInLikePattern`, with `driver-sql`'s author text word for word.
 *
 * The doors, all three pinned:
 *
 * - the `$`-spelling on the live query path (`assertFieldConstraintShape`);
 * - the QueryAST `comparison` spelling (`convertConditionToMongo`'s `like` /
 *   `ilike` arm), which has its own dangling-escape refusal;
 * - the reference matcher `match()`, through the same shape gate.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

const NUL = String.fromCharCode(0x00);
const TABLE = 'like_nul_pattern';
const CLASS_STATEMENT = 'has a pattern holding the NUL character U+0000';

const ROWS: ReadonlyArray<{ label: string; v: string | null }> = [
  { label: 'ab', v: 'ab' },
  { label: 'a', v: 'a' },
  { label: 'b', v: 'b' },
  { label: 'axb', v: 'axb' },
  { label: 'AB', v: 'AB' },
  { label: 'plain', v: 'plain' },
  { label: 'empty', v: '' },
  { label: 'missing', v: null },
];

const NUL_PATTERNS: ReadonlyArray<readonly ['$like' | '$ilike', string]> = [
  ['$like', '%' + NUL],
  ['$like', NUL + '%'],
  ['$like', 'a' + NUL + 'b'],
  ['$like', '\\' + NUL],
  ['$ilike', '%' + NUL + 'B'],
];

/** NUL-free controls, with the rows `@objectstack/formula` answers over ROWS. */
const CONTROLS: ReadonlyArray<{ where: Record<string, unknown>; expected: readonly string[] }> = [
  { where: { v: { $like: '%' } }, expected: ['AB', 'a', 'ab', 'axb', 'b', 'empty', 'plain'] },
  { where: { v: { $like: 'a%' } }, expected: ['a', 'ab', 'axb'] },
  { where: { v: { $like: 'a_b' } }, expected: ['axb'] },
  { where: { v: { $like: '' } }, expected: ['empty'] },
  { where: { v: { $ilike: '%B' } }, expected: ['AB', 'ab', 'axb', 'b'] },
];

describe('[#20041] driver-memory — a $like / $ilike pattern holding U+0000 is refused on every door', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false, logger: { info() {}, warn() {}, error() {}, debug() {} } as never });
    await driver.connect();
    for (const row of ROWS) await driver.create(TABLE, { ...row });
  });

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    const err = await driver
      .find(TABLE, { where: where as never })
      .then(() => null, (e: unknown) => e as WireBearingError);
    if (!err) throw new Error(`expected a refusal for ${JSON.stringify(where)}, but it ran`);
    return err;
  };

  const matcherRefusalOf = (where: unknown): WireBearingError => {
    try {
      match({ v: 'ab' }, where);
    } catch (e) {
      return e as WireBearingError;
    }
    throw new Error(`expected the matcher to refuse ${JSON.stringify(where)}, but it answered`);
  };

  const expectEnvelope = (err: WireBearingError, located: string) => {
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(Object.keys(err).sort()).toEqual(['code', 'status']);
    expect(err.message).toContain(`${located} ${CLASS_STATEMENT}`);
  };

  for (const [op, pattern] of NUL_PATTERNS) {
    const shown = JSON.stringify(pattern);

    it(`${op} ${shown}: the live query path refuses it, bare and under $not, naming the path`, async () => {
      expectEnvelope(await refusalOf({ v: { [op]: pattern } }), `Operator "${op}" on field "v" at filter.v.${op}`);
      expectEnvelope(
        await refusalOf({ $not: { v: { [op]: pattern } } }),
        `Operator "${op}" on field "v" at filter.$not.v.${op}`,
      );
      expectEnvelope(
        await refusalOf({ $or: [{ label: 'ab' }, { v: { [op]: pattern } }] }),
        `Operator "${op}" on field "v" at filter.$or[1].v.${op}`,
      );
    });

    it(`${op} ${shown}: the QueryAST comparison spelling refuses it`, async () => {
      const operator = op.slice(1);
      expectEnvelope(
        await refusalOf({ type: 'comparison', field: 'v', operator, value: pattern }),
        `Operator "${operator}" on field "v" at filter`,
      );
    });

    it(`${op} ${shown}: the reference matcher refuses it rather than answering`, () => {
      expectEnvelope(matcherRefusalOf({ v: { [op]: pattern } }), `Operator "${op}" on field "v" at filter.v.${op}`);
    });
  }

  it('the dangling escape keeps its own refusal on every door, also beside a U+0000', async () => {
    for (const pattern of ['abc\\', 'a' + NUL + '\\']) {
      for (const err of [
        await refusalOf({ v: { $like: pattern } }),
        await refusalOf({ type: 'comparison', field: 'v', operator: 'like', value: pattern }),
        matcherRefusalOf({ v: { $like: pattern } }),
      ]) {
        expect(err.code).toBe('INVALID_FILTER');
        expect(err.status).toBe(400);
        expect(err.message).toContain('has a pattern ending in a lone unpaired backslash');
        expect(err.message).not.toContain(CLASS_STATEMENT);
      }
    }
  });

  for (const c of CONTROLS) {
    it(`control: ${JSON.stringify(c.where)} (no U+0000) answers the same rows on the query path and the matcher`, async () => {
      const queried = (await driver.find(TABLE, { where: c.where as never }))
        .map((r: Record<string, unknown>) => String(r.label))
        .sort();
      const matched = ROWS.filter((r) => match(r, c.where)).map((r) => r.label).sort();
      expect({ queried, matched }).toEqual({ queried: [...c.expected], matched: [...c.expected] });
    });
  }
});
