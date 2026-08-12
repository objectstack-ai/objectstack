// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7536] `$like` / `$ilike` on the SQL family — the EXECUTION half of the fix,
 * against a real SQLite engine.
 *
 * ## What this file is proving
 *
 * The spec half (`filter-like-wire-lowering.test.ts`) pins that a wire `like`
 * lowers to `$like` instead of being folded onto `$contains`. That is necessary
 * and not sufficient: the reason the fold survived from #5158 to #7536 is that
 * this driver had **no arm to reach**. The array-format emitter that once
 * handled the infix `like` went away with the array dialect in #5158, leaving
 * only the two infix spellings in `SCALAR_COMPARAND_OPERATORS` — a comparand
 * gate for an operator nothing could emit. So a lowering fix with no emitter
 * would have turned a silent wrong answer into a 400, and the card's repro
 * table would still not pass.
 *
 * These cases therefore run rows, not SQL strings, and they run the card's own
 * table:
 *
 * | filter | before #7536 | here |
 * |---|---|---|
 * | `["name","like","%Industries"]` | `200`, **0 rows** (the `%` bound as a literal) | the rows ENDING WITH `Industries` |
 * | `["name","like","Industries"]` | a substring match, byte-identical to the `$contains` control | an EXACT match |
 * | the `$contains` control | `%…%`-wrapped substring | unchanged — still `%…%`-wrapped |
 *
 * ## Why the fixture is authored here rather than shared
 *
 * `FILTER_TEXT_ROWS` is the shared text fixture and this file deliberately does
 * NOT use it. That table's rows exist to make CASE and LITERALNESS mistakes
 * visible; the mistakes here are about ANCHORING (does a wildcard-free pattern
 * match a substring?) and WILDCARD BINDING, which need rows that differ by
 * their prefixes and suffixes. Enrolling this file in the shared case-set would
 * also flip the conformance gate's `FILTER_TEXT_CASES` cell for a driver on the
 * strength of cases that table does not contain. The shared-standard question
 * for `$like` is real and is the follow-up the changeset names — it cannot be
 * answered by one driver's suite, because `driver-memory` and `driver-mongodb`
 * REFUSE these operators today.
 *
 * ## Reverse verification — predicted before it was run
 *
 * - Restore `'like': '$contains'` in the spec's `AST_OPERATOR_MAP` → predicted
 *   RED on the two wire cases below (the wildcard one returns `[]`, the exact
 *   one returns the substring row too) and GREEN everywhere else, since the
 *   object spelling does not pass through that map. Measured: exactly that.
 * - Delete the `case '$like'` emitter arm → predicted RED on every case in this
 *   file with an `INVALID_FILTER` refusal rather than a wrong row set.
 *   Measured: 13 reds, all of them "Unsupported filter operator".
 * - Emit `LIKE` instead of `GLOB` on the sqlite arm of `likePatternPredicate`
 *   → predicted RED on the case-sensitivity case ONLY (SQLite's `LIKE` folds
 *   ASCII), green elsewhere. Measured: 1 red, that one.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { parseFilterAST } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';

/** The error a refused filter produced — never a bare `toThrow()`. */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * Rows chosen so every pair differs by the ONE property under test.
 *
 * `1`/`2`/`3` are the card's own shape: a name that ends with `Industries`, one
 * that merely contains it, and the bare word itself. A substring reading and a
 * whole-value reading return visibly different sets over them, which is what
 * made the original defect invisible — with only row 3 present, the fold and
 * the fix agree.
 */
const ROWS = [
  { id: '1', name: 'Acme Industries' },
  { id: '2', name: 'Industries Ltd' },
  { id: '3', name: 'Industries' },
  { id: '4', name: 'ACME INDUSTRIES' },
  { id: '5', name: '100% match' },
  { id: '6', name: '100X match' },
  { id: '7', name: 'a_b' },
  { id: '8', name: 'axb' },
  { id: '9', name: 'a*b' },
] as const;

const BYPASS: DriverOptions = { bypassTenantAudit: true };

describe('[#7536] SqlDriver — $like / $ilike run the caller\'s pattern', () => {
  let driver: SqlDriver;

  beforeAll(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([{ name: 'txt', fields: { name: { type: 'string' } } }]);
    for (const row of ROWS) await driver.create('txt', { ...row }, BYPASS);
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find('txt', { where }, BYPASS);
    return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
  };

  /** The wire path: an AST array lowered exactly as the protocol door lowers it. */
  const wire = async (ast: unknown): Promise<string[]> =>
    ids(parseFilterAST(ast) as FilterCondition);

  const refusalOf = async (where: FilterCondition): Promise<WireBearingError> => {
    const err = await driver
      .find('txt', { where }, BYPASS)
      .then(() => null, (e: unknown) => e as WireBearingError);
    if (!err) throw new Error(`expected a refusal for ${JSON.stringify(where)}, but it compiled`);
    return err;
  };

  it('seeded the fixture (the premise)', async () => {
    expect(await ids({})).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  // ── The card's repro table, end to end over the wire ──────────────────────

  it('["name","like","%Industries"] returns the rows ENDING WITH Industries', async () => {
    // The headline defect: this answered `200` with ZERO rows, because the `%`
    // was LIKE-escaped into a literal percent sign by the `$contains` fold.
    expect(await wire(['name', 'like', '%Industries'])).toEqual(['1', '3']);
  });

  it('["name","like","Industries"] is an EXACT match, not a substring match', async () => {
    // The tell. Under the fold this returned rows 1, 2 and 3 — a substring
    // match byte-identical to the `$contains` control below.
    expect(await wire(['name', 'like', 'Industries'])).toEqual(['3']);
  });

  it('the $contains control still wraps in %…% — it did NOT move', async () => {
    // Half of the guard: `like` had to change WITHOUT `contains` changing.
    expect(await wire(['name', 'contains', 'Industries'])).toEqual(['1', '2', '3']);
  });

  it('like and contains no longer answer the same rows', async () => {
    // The other half, as a property rather than two literals — this is the
    // assertion that catches a future change that moves BOTH spellings.
    const like = await wire(['name', 'like', 'Industries']);
    const contains = await wire(['name', 'contains', 'Industries']);
    expect(like).not.toEqual(contains);
  });

  // ── The pattern language, executed ────────────────────────────────────────

  it('gives % its "any sequence" meaning at either end', async () => {
    expect(await ids({ name: { $like: 'Industries%' } })).toEqual(['2', '3']);
    expect(await ids({ name: { $like: '%Industries%' } })).toEqual(['1', '2', '3']);
  });

  it('gives _ its "exactly one character" meaning', async () => {
    expect(await ids({ name: { $like: 'a_b' } })).toEqual(['7', '8', '9']);
  });

  it('lets a backslash escape a wildcard back into a literal', async () => {
    // Row 7 is the literal `a_b`; rows 8 and 9 must NOT match once the `_` is
    // escaped. This is the caller's half of the escaping contract — the
    // `$contains` family escapes on the caller's behalf, `$like` does not.
    expect(await ids({ name: { $like: 'a\\_b' } })).toEqual(['7']);
    expect(await ids({ name: { $like: '100\\% match' } })).toEqual(['5']);
  });

  it('escapes GLOB\'s own metacharacters, which are ORDINARY to LIKE', async () => {
    // `*` means nothing to LIKE, so this pattern is a literal — and on the
    // SQLite dialects it is compiled to GLOB, where `*` means EVERYTHING. An
    // untranslated pattern matches all nine rows here; the translation's
    // self-closing `[*]` class is what makes it match one.
    expect(await ids({ name: { $like: 'a*b' } })).toEqual(['9']);
  });

  // ── Case: $like is exact, $ilike folds ASCII only ─────────────────────────

  it('$like is case-SENSITIVE (#4706 Q2 = A)', async () => {
    // SQLite's LIKE folds ASCII unconditionally, which is why the emitter uses
    // GLOB. A driver that regressed to LIKE answers ['1','4'] here.
    expect(await ids({ name: { $like: 'Acme%' } })).toEqual(['1']);
  });

  it('$ilike folds ASCII case, on both operands', async () => {
    expect(await ids({ name: { $ilike: 'acme%' } })).toEqual(['1', '4']);
    expect(await ids({ name: { $ilike: 'ACME%' } })).toEqual(['1', '4']);
  });

  it('lowers a wire `ilike` the same way', async () => {
    // `ilike` had NO lowering at all before #7536 — `isFilterAST` refused it, so
    // the whole filter was rejected at the protocol door.
    expect(await wire(['name', 'ilike', '%industries'])).toEqual(['1', '3', '4']);
  });

  // ── Combinators: the arm must work where filters actually live ────────────

  it('compiles inside $and / $or', async () => {
    expect(await ids({ $or: [{ name: { $like: '%Ltd' } }, { name: { $like: 'a\\_b' } }] }))
      .toEqual(['2', '7']);
    expect(await ids({ $and: [{ name: { $like: '%Industries' } }, { name: { $like: 'Acme%' } }] }))
      .toEqual(['1']);
  });

  it('compiles under $not, and is NULL-safe there', async () => {
    // `$not` negates a predicate the driver first makes TOTAL (#5146): SQL's
    // `NOT UNKNOWN` is UNKNOWN, which would drop rows whose column is NULL
    // where the JS faces keep them. No NULL rows in this fixture, so what is
    // pinned is the complement over the rows that exist.
    expect(await ids({ $not: { name: { $like: '%Industries' } } }))
      .toEqual(['2', '4', '5', '6', '7', '8', '9']);
  });

  // ── Refusals: the shapes that cannot mean one thing on every backend ──────

  it('refuses a non-string pattern in the ADR-0112 envelope', async () => {
    const err = await refusalOf({ name: { $like: 42 } } as unknown as FilterCondition);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$like');
    // The refusal must name what to write instead — an author who wanted a
    // literal substring search needs `$contains`, not a coerced pattern.
    expect(err.message).toContain('$contains');
  });

  it('refuses an OBJECT pattern rather than compiling "[object Object]"', async () => {
    // `String({})` is `[object Object]`, whose `[` OPENS a GLOB character
    // class — so coercion here would not merely compare text nobody wrote, it
    // would run a PATTERN nobody wrote.
    const err = await refusalOf({ name: { $like: {} } } as unknown as FilterCondition);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });

  it('refuses a pattern ending in a lone unpaired backslash', async () => {
    // No meaning survives every backend: Postgres rejects such a pattern
    // outright, and GLOB has no escape character to reject.
    const err = await refusalOf({ name: { $like: 'abc\\' } });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('backslash');
  });

  it('accepts a PAIRED trailing backslash — the refusal is not "contains a backslash"', async () => {
    // The gate counts the run length; an even one is a literal backslash and a
    // perfectly good pattern. A naïve `endsWith('\\')` test would refuse it.
    expect(await ids({ name: { $like: 'a\\\\b' } })).toEqual([]);
  });

  it('accepts an EMPTY pattern, which is not the widening $icontains refuses', async () => {
    // `$icontains: ''` is refused because every row contains the empty
    // substring. `LIKE ''` matches only the empty string — a narrow, well-formed
    // predicate. Copying the sibling's rule here would refuse a legitimate query.
    expect(await ids({ name: { $like: '' } })).toEqual([]);
  });
});
