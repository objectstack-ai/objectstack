// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7536] `$like` / `$ilike` on driver-memory — BOTH faces, one answer.
 *
 * ## Why this driver implements what two of its siblings refuse
 *
 * #7536 stopped the wire from folding `like` onto `$contains` and gave the SQL
 * family a real pattern arm. The other backends then had a choice per the
 * issue's own bar: implement the same semantics, or refuse loudly in the
 * ADR-0112 envelope — never quietly answer something else. `driver-mongodb`,
 * objectql's `having` and `service-analytics` refuse, because they have no arm
 * and are in the #5499 frozen family. This driver implements, for two reasons
 * that do not apply to them:
 *
 * 1. **It is the in-memory DOUBLE.** An application whose tests run here and
 *    whose production runs SQL would get a 400 in test for a filter that works
 *    in production. That is the same "one filter, two answers" divergence #6520
 *    closed, wearing a refusal instead of a wrong row set.
 * 2. **It holds the `VALID_AST_OPERATORS` expressibility invariant** (#3948,
 *    `memory-filter-ast-vocabulary.test.ts`): every operator the protocol
 *    PARSES must survive to a matched row here. `like` is in that set — and
 *    `ilike` joined it in #7536 — so a refusal would break the invariant rather
 *    than satisfy it.
 *
 * The semantics come from the spec's shared `matchesLikePattern` /
 * `likePatternToRegexSource`, which is the same translation `formula`
 * evaluates and the same pattern `driver-sql` hands to `LIKE` / `GLOB`. That
 * sharing is the point: this package has TWO evaluation faces (the mingo query
 * path and the reference matcher), and the divergence #5374 fixed for
 * `$contains` between exactly those two faces is the failure mode here.
 *
 * `$like`/`$ilike` are deliberately NOT in the spec's `FILTER_OPERATORS`; this
 * driver widens its own `SUPPORTED_FIELD_OPERATORS` by hand instead — the
 * precedent `driver-turso`'s remote transport set for `$icontains` in #5702.
 * These cases go red if that widening is ever removed without removing the
 * arms, and `memory-filter-ast-vocabulary.test.ts` goes red if the arms are
 * removed without the widening.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

const TABLE = 'like_probe';

const ROWS = [
  { id: '1', name: 'Acme Industries' },
  { id: '2', name: 'Industries Ltd' },
  { id: '3', name: 'Industries' },
  { id: '4', name: 'ACME INDUSTRIES' },
  { id: '5', name: '100% match' },
  { id: '6', name: '100X match' },
  { id: '7', name: 'a_b' },
  { id: '8', name: 'axb' },
] as const;

interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

describe('[#7536] driver-memory — $like / $ilike on both faces', () => {
  let driver: InMemoryDriver;

  beforeEach(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    for (const row of ROWS) await driver.create(TABLE, { ...row });
  });

  /** Ids the LIVE QUERY PATH returns (mingo), ascending. */
  const queryIds = async (where: unknown): Promise<string[]> =>
    (await driver.find(TABLE, { where: where as never }))
      .map((r: Record<string, unknown>) => String(r.id))
      .sort((a, b) => a.localeCompare(b));

  /** Ids the REFERENCE MATCHER returns, ascending. */
  const matcherIds = (where: unknown): string[] =>
    ROWS.filter((r) => match(r, where)).map((r) => r.id).sort((a, b) => a.localeCompare(b));

  const refusalOf = async (where: unknown): Promise<WireBearingError> => {
    const err = await driver
      .find(TABLE, { where: where as never })
      .then(() => null, (e: unknown) => e as WireBearingError);
    if (!err) throw new Error(`expected a refusal for ${JSON.stringify(where)}, but it ran`);
    return err;
  };

  it('seeded the fixture (the premise)', async () => {
    expect(await queryIds({})).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
  });

  /**
   * Every case is asserted on BOTH faces, and the faces are compared to each
   * other FIRST — a drift between them reads as a drift rather than as two
   * unrelated wrong answers.
   */
  const CASES: Array<[string, Record<string, unknown>, string[]]> = [
    // The card's own repro table.
    ['a wildcard pattern binds the caller\'s %', { name: { $like: '%Industries' } }, ['1', '3']],
    ['a wildcard-free pattern is EXACT, not a substring', { name: { $like: 'Industries' } }, ['3']],
    ['% at the end', { name: { $like: 'Industries%' } }, ['2', '3']],
    // The pattern language.
    ['_ matches exactly one character', { name: { $like: 'a_b' } }, ['7', '8']],
    ['a backslash escapes _ back to a literal', { name: { $like: 'a\\_b' } }, ['7']],
    ['a backslash escapes % back to a literal', { name: { $like: '100\\% match' } }, ['5']],
    // Case, and the ASCII boundary.
    ['$like is case-SENSITIVE', { name: { $like: 'Acme%' } }, ['1']],
    ['$ilike folds ASCII case', { name: { $ilike: 'acme%' } }, ['1', '4']],
    // The control: `$contains` must NOT have moved.
    //
    // The comparand is `Ltd` rather than the `Industries` every other row uses,
    // and it was steered there deliberately: when this file was written the two
    // faces disagreed on `{ $contains: 'Industries' }` — ['1','2','3','4'] on
    // the QUERY path against ['1','2','3'] on the reference matcher — because
    // the query path lowered `$contains` to a RegExp carrying the `i` flag
    // while the matcher used `String.includes`. That was #6682's open half, the
    // last DEBT row the driver-conformance ledger carried for this pair of
    // faces. #7723 closed it: `filterSubstringPattern` no longer sets the flag,
    // both faces answer ['1','2','3'] (measured), and the ledger is at zero.
    // The comparand stays `Ltd` because it is a perfectly good control and
    // moving it would change what this row measures, not because it still has
    // to dodge anything.
    ['the $contains control still matches substrings', { name: { $contains: 'Ltd' } }, ['2']],
  ];

  for (const [name, where, expected] of CASES) {
    it(name, async () => {
      const fromQuery = await queryIds(where);
      const fromMatcher = matcherIds(where);
      expect(fromMatcher, 'the reference matcher disagrees with the query path').toEqual(fromQuery);
      expect(fromQuery).toEqual(expected);
    });
  }

  it('answers the same rows as it would for a substring search ONLY when asked to', async () => {
    // The defect, stated as an inequality: under the fold these two were the
    // same query. This is the assertion that catches a regression that moves
    // BOTH operators.
    expect(await queryIds({ name: { $like: 'Industries' } }))
      .not.toEqual(await queryIds({ name: { $contains: 'Industries' } }));
  });

  it('expresses the INFIX like/ilike spellings identically', async () => {
    // The QueryAST comparison door. Until #7536 this arm was SHARED with
    // `contains` — the memory-face twin of the wire defect: the comparand was
    // regex-ESCAPED (so `%` matched a literal percent sign) and matched as a
    // SUBSTRING. One driver must not answer two ways depending on which door a
    // filter came through (#3948).
    const viaInfix = await queryIds({
      type: 'comparison', field: 'name', operator: 'like', value: '%Industries',
    });
    expect(viaInfix).toEqual(['1', '3']);
    const viaInfixI = await queryIds({
      type: 'comparison', field: 'name', operator: 'ilike', value: '%industries',
    });
    expect(viaInfixI).toEqual(['1', '3', '4']);
  });

  // ── Refusals: the shapes no backend can agree on ──────────────────────────

  it('refuses a non-string pattern in the ADR-0112 envelope', async () => {
    const err = await refusalOf({ name: { $like: 42 } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$like');
    expect(err.message).toContain('$contains');
  });

  it('refuses a pattern ending in a lone unpaired backslash', async () => {
    const err = await refusalOf({ name: { $like: 'abc\\' } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('backslash');
  });

  it('accepts an EMPTY pattern — it is not the widening $icontains refuses', async () => {
    // `$icontains: ''` is refused because every row contains the empty
    // substring. `LIKE ''` matches only the empty string, which constrains
    // plenty. Copying the sibling's rule here would refuse a legitimate query.
    expect(await queryIds({ name: { $like: '' } })).toEqual([]);
  });
});
