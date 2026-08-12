// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6520] `$icontains` on ALL THREE of this package's filter faces.
 *
 * The operator was refused here until #6520 — not by an arm that said so, but by
 * derivation: `SUPPORTED_FIELD_OPERATORS` is the spec's `FILTER_OPERATORS`, and
 * that array deliberately omitted the name while no face could evaluate it.
 * Admitting it and writing the arms had to happen in ONE PR, because admission
 * alone flips this driver from a loud refusal to a SILENT WIDENING: #5701
 * measured `match({ name: 'zzz' }, { name: { $icontains: 'acme' } })` returning
 * `true` on a branch that added the word early — the predicate dropped, every
 * row matched, which on an RLS read scope is a permission bypass (#3948).
 *
 * ## Why all three faces are in one file
 *
 * Because this package's recurring defect is not "a face is wrong", it is "the
 * faces disagree" — #5374 (`$contains` two ways), #5324/#5328 (a malformed
 * `$between`: no rows on one face, EVERY row on another), #5347 (`$null` three
 * ways). A per-face file would let one arm rot without the others noticing. Each
 * case below therefore runs the same filter through the live query path, the
 * reference matcher and the analytics face and demands ONE answer.
 *
 * ## Why this file drives the ROWS and spells its own cases
 *
 * `check-driver-conformance.mjs` judges coverage by whether a package names the
 * shared text case-set's marker export. Naming it here would have flipped this
 * driver's cell to "covered" while requirement 2 of that case-set — the
 * `$contains` family folding Unicode on this driver — was still open, and a
 * ledger entry for a covered cell fails the gate's RECONCILED invariant. So
 * this file drives `FILTER_TEXT_ROWS`, the fixture, and writes out the
 * `$icontains` cases it was entitled to answer.
 *
 * [#7723] That other half is now closed: `filterSubstringPattern` no longer
 * carries the `i` flag, `memory-filter-text-conformance.test.ts` names the
 * marker and enrolls the cell, and the DEBT row is gone. This file keeps its
 * own cases — the shared case-set enrolls the FAMILY, not this operator's ASCII
 * boundary — but it no longer stands in for a cell nothing else covers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

const TABLE = 'text_rows';

/** The conformance fixture's rows, as this driver stores them. */
const ROWS = FILTER_TEXT_ROWS.map((r) => ({ ...r }));

async function seed(): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver();
  for (const row of ROWS) await driver.create(TABLE, { ...row });
  return driver;
}

/** Ids the LIVE QUERY PATH returns (mingo), ascending. */
const queryIds = async (driver: InMemoryDriver, where: unknown): Promise<string[]> =>
  (await driver.find(TABLE, { where: where as any }))
    .map((r: any) => String(r.id))
    .sort((a, b) => a.localeCompare(b));

/** Ids the REFERENCE MATCHER returns, ascending. */
const matcherIds = (where: unknown): string[] =>
  ROWS.filter((r) => match(r, where)).map((r) => r.id).sort((a, b) => a.localeCompare(b));

describe('[#6520] $icontains — the accept table, on every face', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  /**
   * The measured table from the issue, plus the boundary that makes it a
   * contract rather than a preference. `expected` is the SAME answer the SQL
   * family gives for these rows (`FILTER_TEXT_CASES`' first four rows) — the
   * whole point being that a filter must not change meaning when an app's tests
   * run on this double and production runs SQL.
   */
  const CASES: Array<[string, unknown, string[]]> = [
    ['an upper-case row from a lower-case comparand', { name: { $icontains: 'acme' } }, ['1', '2']],
    ['a lower-case row from an upper-case comparand', { name: { $icontains: 'ACME' } }, ['1', '2']],
    // The ASCII boundary. A Unicode-folding face (`toLowerCase()`, or a RegExp
    // with the `i` flag) answers ['3','4'] to BOTH of these and is wrong twice.
    ['ASCII-ONLY: a lower-case non-ASCII comparand misses its upper-case row', { name: { $icontains: 'café' } }, ['4']],
    ['ASCII-ONLY: an upper-case non-ASCII comparand misses its lower-case row', { name: { $icontains: 'CAFÉ' } }, ['3']],
    // The comparand is LITERAL — the `$regex` defect #4706 retired, restated.
    ['% is a literal character, not a wildcard', { name: { $icontains: '100%' } }, ['5']],
    ['_ is a literal character, not a wildcard', { name: { $icontains: 'a_b' } }, ['7']],
    ['. is a literal character, not a regex metacharacter', { name: { $icontains: 'a.b' } }, ['9']],
  ];

  for (const [label, where, expected] of CASES) {
    it(`query path: ${label}`, async () => {
      expect(await queryIds(driver, where)).toEqual(expected);
    });

    it(`reference matcher: ${label}`, () => {
      expect(matcherIds(where)).toEqual(expected);
    });
  }

  it('the two faces agree on every case — the divergence class #5374 closed', async () => {
    for (const [label, where] of CASES) {
      expect(await queryIds(driver, where), label).toEqual(matcherIds(where));
    }
  });

  /**
   * The #3948 pin, stated as a row COUNT rather than as a throw. Every case
   * above returns a strict subset of the fixture; a face that dropped the
   * predicate would return all nine and still "work".
   */
  it('never answers every row — a dropped predicate WIDENS', async () => {
    for (const [label, where] of CASES) {
      expect((await queryIds(driver, where)).length, label).toBeLessThan(ROWS.length);
      expect(matcherIds(where).length, label).toBeLessThan(ROWS.length);
    }
  });

  /**
   * `$icontains` is the case-INSENSITIVE twin, so its case-EXACT sibling must
   * NOT have moved. This is the row that would catch an implementation that
   * "fixed" the fold by making `$contains` insensitive too. When it was written
   * the matcher was the ONLY face answering `$contains` case-exactly, the query
   * path still folding Unicode (#6682); since #7723 all three agree, so the
   * choice of face here is no longer load-bearing.
   */
  it('leaves $contains case-SENSITIVE on the reference matcher', () => {
    expect(matcherIds({ name: { $contains: 'acme' } })).toEqual(['2']);
    expect(matcherIds({ name: { $contains: 'ACME' } })).toEqual(['1']);
  });
});

describe('[#6520] $icontains comparand refusals, in the ADR-0112 envelope', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  /**
   * `code` AND `status`, never a bare `toThrow()`. A rejection test that only
   * asserts "something threw" carries one bit where the defect has two, and this
   * driver's own history is the argument: #5324 spent an issue routing uncoded
   * engine errors back into the ADR-0112 envelope, and a throw-only assertion
   * cannot tell a correct refusal from an uncoded one.
   */
  const refusal = async (where: unknown): Promise<any> =>
    driver.find(TABLE, { where: where as any }).then(() => null, (e: any) => e);

  it('refuses an EMPTY comparand — it would match every row', async () => {
    const err = await refusal({ name: { $icontains: '' } });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$icontains');
    expect(err.message).toContain('NON-EMPTY');
  });

  it('refuses a NON-STRING comparand rather than coercing it', async () => {
    const err = await refusal({ name: { $icontains: 42 } });
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
    expect(err.message).toContain('$icontains');
  });

  it('refuses on the REFERENCE MATCHER too — one gate, three faces', () => {
    const err = (() => { try { match(ROWS[0], { name: { $icontains: '' } }); return null; } catch (e) { return e as any; } })();
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_FILTER');
    expect(err.status).toBe(400);
  });
});
