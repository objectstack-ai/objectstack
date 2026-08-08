// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#5702] `$icontains` on the SQL family, and the retirement of `$regex` /
 * `$options` — the DRIVER half of the #4706 ruling (its contract half is #5701).
 *
 * ## What this pins, and why it is not the shared text case-set
 *
 * `@objectstack/spec/data` carries a canonical text case-set whose rows this
 * file reuses (`FILTER_TEXT_ROWS` — the same nine, so a verdict here is
 * comparable to one anywhere else). It deliberately does NOT import that
 * case-set's CASES export, because `scripts/check-driver-conformance.mjs`
 * judges a cell covered by that import and this driver does not yet answer the
 * whole table: five of its cases require the `$contains` family to be
 * case-SENSITIVE (#4706 Q2 = A), which SQLite's `LIKE` is not, and which cannot
 * be fixed in this driver alone — `read-scope-sql` and `service-analytics`
 * compile the same predicate for RLS and for the analytics face, so a
 * driver-only change would give ONE permission rule two row sets (#3948). That
 * work is filed separately and the driver's DEBT row stays open for it.
 *
 * Importing the case-set here would flip the cell to "covered" while five of
 * its cases were unanswered — a gate reporting success over a standard nobody
 * runs, which is exactly the failure the gate exists to prevent.
 *
 * ## The reverse verification, direction decided BEFORE it was run
 *
 * - **Refusal face** — predicted RED, measured RED. Restoring the deleted
 *   `case '$regex':` fallthrough makes every assertion below that reads `code`
 *   / `status` fail, because the filter compiles again and nothing throws.
 * - **`$icontains` face on SQLite** — predicted red, and the prediction needed
 *   a correction that is recorded here rather than smoothed over: deleting the
 *   `case '$icontains':` arm turns these cases red LOUDLY (the operator falls to
 *   `default:` and is refused), but deleting only the `LOWER()` fold does NOT,
 *   for any comparand. SQLite's `LIKE` folds ASCII by itself, so on this
 *   dialect the fold is unobservable in rows. The compiled-SQL case at the end
 *   is what pins it, and it is the only thing here that can.
 */

import type { Knex } from 'knex';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { DriverOptions, FilterCondition } from '@objectstack/spec/data';
import { FILTER_TEXT_ROWS } from '@objectstack/spec/data';
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

  // ── The fold, where it is actually observable on SQLite ────────────────────

  it('compiles LOWER() on both operands, and $contains on neither', async () => {
    // On SQLite this is the ONLY witness to the fold: `LIKE` already folds ASCII
    // here, so `$contains` and `$icontains` select identical rows for every
    // comparand and a dropped `LOWER()` changes no answer. It changes the SQL,
    // and it changes the answer on Postgres (whose LIKE is case-exact), so the
    // statement is what has to be pinned.
    // Identifier quoting is the dialect's (knex renders backticks on the sqlite
    // clients), so the assertion is on the SHAPE, not on one dialect's quotes.
    const unquote = (sql: string) => sql.replace(/[`"\[\]]/g, '');

    const icontainsSql = unquote(driver.compileWhere({ name: { $icontains: 'acme' } }));
    expect(icontainsSql).toContain('LOWER(name) LIKE LOWER(');
    expect(icontainsSql).toContain('ESCAPE');
    // The escaped pattern still travels as the comparand, wildcards and all.
    expect(icontainsSql).toContain('%acme%');

    const containsSql = unquote(driver.compileWhere({ name: { $contains: 'acme' } }));
    expect(containsSql).toContain('name LIKE');
    expect(containsSql).not.toContain('LOWER');
  });
});
