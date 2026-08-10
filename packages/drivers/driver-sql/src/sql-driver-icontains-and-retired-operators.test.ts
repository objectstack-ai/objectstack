// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5702] `$icontains` on the SQL family, and the retirement of `$regex` /
 * `$options` — the DRIVER half of the #4706 ruling (its contract half is #5701)
 * — plus [#6518] the case-sensitivity half #5702 could not deliver.
 *
 * ## This cell now answers the WHOLE shared case-set
 *
 * `FILTER_TEXT_CASES` is imported and executed below, which is what
 * `scripts/check-driver-conformance.mjs` reads as coverage. #5702 deliberately
 * imported only `FILTER_TEXT_ROWS` and left the CASES export alone, because
 * five of its cases require the `$contains` family to be case-SENSITIVE (#4706
 * Q2 = A) and SQLite's `LIKE` folds ASCII — an import then would have flipped
 * the cell to "covered" while five cases went unanswered, which is a gate
 * reporting success over a standard nobody runs.
 *
 * #6518 is what makes the import honest: `textMatchPredicate` emits `GLOB` on
 * the SQLite dialects (case-exact, carrying GLOB's own `[*]` / `[?]` / `[[]`
 * escapes because SQLite's grammar gives it no `ESCAPE` clause), keeps `LIKE`
 * on Postgres (already case-exact) with the `$icontains` fold moved off the
 * Unicode-folding `LOWER()` onto an ASCII-only `translate()`, and compares over
 * `CAST(… AS BINARY)` on MySQL. The per-dialect reasoning and the measurements
 * behind each cell live on that function.
 *
 * ## The reverse verification, direction decided BEFORE it was run
 *
 * - **Refusal face** — predicted RED, measured RED. Restoring the deleted
 *   `case '$regex':` fallthrough makes every assertion below that reads `code`
 *   / `status` fail, because the filter compiles again and nothing throws.
 * - **`$icontains` face on SQLite** — #5702 recorded that deleting only the
 *   fold changed NO row here, because `LIKE` folded ASCII by itself, so the
 *   compiled-SQL case was the only witness it could offer. #6518 retires that
 *   caveat, and the retirement was predicted before it was run: under `GLOB`
 *   the fold is load-bearing in ROWS. Measured — dropping the column-side
 *   `lower()` turns `$icontains: 'acme'` and `$icontains: 'ACME'` alike from
 *   `['1','2']` into `['2']`, and `$icontains: 'CAFÉ'` from `['3']` into `[]`.
 * - **`$contains` case-sensitivity** — predicted RED on exactly the five case
 *   rows before the change, measured RED: reverting the sqlite arm of
 *   `textMatchPredicate` to `LIKE` fails those five case rows and NO others in
 *   the table (10 reds in this file: the five, plus the five blocks below that
 *   name the construct directly).
 */

import type { Knex } from 'knex';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { SqlDriver } from './sql-driver.js';

/** The error a refused filter produced — never a bare `toThrow()` (see below). */
interface WireBearingError extends Error {
  code?: string;
  status?: number;
}

/**
 * The compiled statement for one filter, without reaching into a private field.
 *
 * `applyFilters` is `protected` and `getKnex()` is public, so a subclass is the
 * TYPED way in — no `as any` on the driver, which would also switch off the
 * checking on everything else the call touches.
 */
class CompilerProbeDriver extends SqlDriver {
  compileWhere(where: FilterCondition): string {
    const builder: Knex.QueryBuilder = this.getKnex()('txt');
    this.applyFilters(builder, where);
    return builder.toString();
  }
}

/** Diagnostics-only; it never changes which rows a read touches. */
const BYPASS: DriverOptions = { bypassTenantAudit: true };

describe('[#5702] SqlDriver — $icontains, and the retired $regex/$options', () => {
  let driver: CompilerProbeDriver;

  beforeAll(async () => {
    driver = new CompilerProbeDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects([{ name: 'txt', fields: { name: { type: 'string' } } }]);
    for (const row of FILTER_TEXT_ROWS) {
      await driver.create('txt', { ...row }, BYPASS);
    }
  });

  afterAll(async () => {
    await driver.disconnect();
  });

  const ids = async (where: FilterCondition): Promise<string[]> => {
    const rows = await driver.find('txt', { where }, BYPASS);
    return rows.map((r) => String(r.id)).sort((a, b) => a.localeCompare(b));
  };

  const refusalOf = async (where: FilterCondition): Promise<WireBearingError> => {
    const err = await driver
      .find('txt', { where }, BYPASS)
      .then(() => null, (e: unknown) => e as WireBearingError);
    if (!err) throw new Error(`expected the driver to refuse ${JSON.stringify(where)}, but it compiled`);
    return err;
  };

  it('seeded the fixture (the premise)', async () => {
    expect(await ids({})).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });

  // ── The fold ───────────────────────────────────────────────────────────────

  it('folds ASCII case in BOTH directions', async () => {
    // The fold has to run on both operands. Folding only the comparand compares
    // a lower-cased needle against a raw column and answers ['2'] to the first
    // line and [] to the second — half right, which reads as "working".
    expect(await ids({ name: { $icontains: 'acme' } })).toEqual(['1', '2']);
    expect(await ids({ name: { $icontains: 'ACME' } })).toEqual(['1', '2']);
  });

  it('folds ASCII ONLY — the #4706 Q1 = A boundary', async () => {
    // These two ARE the contract, not an edge case. A backend folding the whole
    // Unicode range (a JS `toLowerCase()`, mongo's `$options: "i"`) answers
    // ['3','4'] to both and is wrong on both — not because Unicode folding is
    // worse, but because SQLite cannot do it, so promising it would promise what
    // three of five backends cannot deliver.
    expect(await ids({ name: { $icontains: 'café' } })).toEqual(['4']);
    expect(await ids({ name: { $icontains: 'CAFÉ' } })).toEqual(['3']);
  });

  // ── The comparand is LITERAL ───────────────────────────────────────────────

  it('treats "%" as a literal character, not a LIKE wildcard', async () => {
    // Unescaped this compiles to LIKE '%100%%', which also matches row 6.
    expect(await ids({ name: { $icontains: '100%' } })).toEqual(['5']);
  });

  it('treats "_" as a literal character, not a single-character wildcard', async () => {
    // Unescaped, `%a_b%` also returns rows 8 (axb) and 9 (a.b).
    expect(await ids({ name: { $icontains: 'a_b' } })).toEqual(['7']);
  });

  it('treats "\\" as a literal character, not the escape character', async () => {
    // No fixture row holds a backslash, so the observable claim is that the
    // pattern stays well-formed and selects nothing rather than erroring or
    // degenerating — the `\` limb of the class is pinned per-dialect and per
    // operator in `sql-driver-like-escape.test.ts`.
    expect(await ids({ name: { $icontains: '\\' } })).toEqual([]);
    expect(await ids({ name: { $icontains: 'a\\b' } })).toEqual([]);
  });

  it('treats "." as a literal character, not a regex metacharacter', async () => {
    // The `$regex` defect restated as a requirement: on the regex-evaluating
    // backend "a.b" also matched rows 7 and 8.
    expect(await ids({ name: { $icontains: 'a.b' } })).toEqual(['9']);
  });

  // ── The comparand gate ─────────────────────────────────────────────────────

  for (const [label, comparand] of [
    ['an empty string', ''],
    ['a number', 42],
    ['null', null],
    ['a boolean', true],
  ] as const) {
    it(`REFUSES ${label} comparand, in the ADR-0112 envelope`, async () => {
      const err = await refusalOf({ name: { $icontains: comparand } });
      // `code` AND `status`, never `toThrow()` alone: a bare throw assertion is
      // satisfied by any error, including the uncoded engine errors this
      // driver's whole refusal family exists to keep out of a 500-shaped body.
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('$icontains');
    });
  }

  it('refuses the empty comparand even when a sibling identity would settle the node', async () => {
    // The gate is on the validating walk, not in the emitter, so it cannot be
    // skipped by a `$or` branch that reduces to TRUE first. An emitter-only gate
    // refuses or silently widens depending on the filter's SIBLINGS.
    const err = await refusalOf({ $or: [{}, { name: { $icontains: '' } }] });
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });

  // ── The retirement ─────────────────────────────────────────────────────────

  for (const [label, where, mustMention] of [
    ['a bare $regex', { name: { $regex: 'ac.*' } }, ['$regex', '$icontains']],
    ['a dangling $options', { name: { $options: 'i' } }, ['$options', '$icontains']],
    [
      '$regex with $options — one mistake, one fix',
      { name: { $regex: '^acme', $options: 'i' } },
      ['$regex', '$options', '$icontains'],
    ],
  ] as const) {
    it(`REFUSES ${label}, naming the replacement`, async () => {
      const err = await refusalOf(where);
      expect(err.code).toBe('INVALID_FILTER');
      expect(err.status).toBe(400);
      expect(err.message).toContain('RETIRED');
      for (const mention of mustMention) expect(err.message).toContain(mention);
    });
  }

  it('the $regex refusal is not `expected: []` — refusing and matching nothing are different', async () => {
    // Answering zero rows is what driver-memory already did for an INVALID
    // pattern: the silent wrong answer #4706 retired the operator over. A
    // conformance suite must be able to tell "refused to run" from "ran and
    // matched nothing", which is why this asserts a throw rather than a count.
    expect(await ids({ name: { $contains: 'zzz-matches-nothing' } })).toEqual([]);
    await expect(driver.find('txt', { where: { name: { $regex: 'zzz' } } }, BYPASS)).rejects.toThrow();
  });

  // ── [#6518] The case-SENSITIVE family (#4706 Q2 = A) ───────────────────────

  it('$contains is case-SENSITIVE in both directions', async () => {
    // The defect this closes: on `origin/main` both lines answered ['1','2'],
    // because SQLite's `LIKE` folds ASCII whatever the contract says. Over-
    // matching, not a near miss — the caller asked for one row and got two.
    expect(await ids({ name: { $contains: 'acme' } })).toEqual(['2']);
    expect(await ids({ name: { $contains: 'ACME' } })).toEqual(['1']);
  });

  it('the case rule holds under negation too', async () => {
    // Row 1 is EXCLUDED from the negation only if the positive form excluded
    // it. A folding backend drops row 1 here and looks "stricter", which is the
    // reading that hides the defect.
    expect(await ids({ name: { $notContains: 'acme' } }))
      .toEqual(['1', '3', '4', '5', '6', '7', '8', '9']);
  });

  it('$startsWith and $endsWith are case-SENSITIVE', async () => {
    expect(await ids({ name: { $startsWith: 'ACME' } })).toEqual(['1']);
    expect(await ids({ name: { $endsWith: 'corp' } })).toEqual(['2']);
  });

  it('$contains and $icontains no longer answer identically on SQLite', async () => {
    // #5702 measured that they DID, for every comparand, and recorded it as the
    // reason `$icontains` was unobservable on this dialect. That is the fact
    // #6518 changes, so it is asserted rather than left as a comment: the two
    // operators are now distinguishable in rows on the dialect where they were
    // not.
    expect(await ids({ name: { $contains: 'acme' } })).not
      .toEqual(await ids({ name: { $icontains: 'acme' } }));
  });

  // ── [#6518] GLOB's metacharacters are escaped, exactly as LIKE's were ──────

  for (const [label, comparand] of [
    ['*', 'a*b'],
    ['?', 'a?b'],
    ['[', 'a[b'],
  ] as const) {
    it(`treats "${label}" as a literal character, not a GLOB metacharacter`, async () => {
      // The new operator brings a NEW escaped character class, and an
      // unescaped `*` is the same filter bypass an unescaped `%` is under LIKE:
      // measured on this fixture, the unescaped pattern `*a*b*` returns rows
      // 7, 8 and 9 where the escaped one returns none of them. No fixture row
      // holds these characters, so the observable claim is that the pattern
      // stays literal and selects nothing rather than expanding.
      expect(await ids({ name: { $contains: comparand } })).toEqual([]);
      expect(await ids({ name: { $icontains: comparand } })).toEqual([]);
    });
  }

  it('compiles the case-exact SQLite construct, on both operators', async () => {
    // Identifier quoting is the dialect's (knex renders backticks on the sqlite
    // clients), so the assertion is on the SHAPE. `[` / `]` are NOT stripped
    // here the way #5702's version stripped them: under GLOB they are the
    // escape mechanism, so erasing them would erase what is being pinned.
    const unquote = (sql: string) => sql.replace(/[`"]/g, '');

    const icontainsSql = unquote(driver.compileWhere({ name: { $icontains: 'acme' } }));
    expect(icontainsSql).toContain('lower(name) GLOB lower(');
    expect(icontainsSql).toContain('*acme*');
    // GLOB has no ESCAPE clause in SQLite's grammar; emitting one is a syntax
    // error, so its absence is part of the construct rather than a detail.
    expect(icontainsSql).not.toContain('ESCAPE');

    const containsSql = unquote(driver.compileWhere({ name: { $contains: 'acme' } }));
    expect(containsSql).toContain('name GLOB');
    expect(containsSql).not.toContain('lower');
    expect(containsSql).not.toContain('LIKE');
  });

  // ── The shared standard, executed ──────────────────────────────────────────

  /**
   * [#6518] Every case in `FILTER_TEXT_CASES`, on the live SQLite cell.
   *
   * The invariant this enforces is the case-set's own: a backend answers with
   * the SAME ROW SET, or REFUSES with `INVALID_FILTER` — never a third, quieter
   * answer. So the rejection cases assert `code` AND `status` (ADR-0112) plus
   * the prescription the message must carry, and never a bare `toThrow()`.
   *
   * The blocks above are not redundant with this loop: they name the SQLite
   * construct and its escaped class, which the shared table deliberately does
   * not know about — it encodes the contract, not any dialect's spelling.
   */
  describe('FILTER_TEXT_CASES — the shared standard', () => {
    for (const testCase of FILTER_TEXT_CASES) {
      it(testCase.name, async () => {
        if (testCase.expectRejection) {
          const err = await refusalOf(testCase.filter);
          expect(err.code).toBe(testCase.code);
          expect(err.status).toBe(400);
          for (const mention of testCase.mustMention) expect(err.message).toContain(mention);
          return;
        }
        expect(await ids(testCase.filter), testCase.note ?? testCase.name)
          .toEqual([...testCase.expected]);
      });
    }
  });
});
