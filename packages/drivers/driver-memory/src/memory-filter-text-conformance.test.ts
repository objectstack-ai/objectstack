// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6682] Text-operator conformance for `driver-memory` — the WHOLE shared
 * `FILTER_TEXT_CASES` table, executed on every face of this package.
 *
 * This is the file that enrolls this driver's `FILTER_TEXT_CASES` cell:
 * `scripts/check-driver-conformance.mjs` judges coverage by whether a package
 * names the marker export, so importing it here is the claim that this package
 * answers the whole table — every row, refusals included — and the DEBT row
 * that stood in its place is deleted in the same PR.
 *
 * ## Why the cell could not be enrolled before
 *
 * The table asks three things of a backend, and this package answered two.
 * Requirement 1 (`$icontains`, the ASCII-only fold) landed at #6520 on all
 * three faces; requirement 3 (`$regex` / `$options` refused inside the
 * ADR-0112 envelope) landed at #5702. Requirement 2 — the `$contains` family
 * being case-SENSITIVE (#4706 Q2 = A) — is what #6682 closes here, and until it
 * did, importing this table would have flipped the cell to "covered" while a
 * third of it failed.
 *
 * ## What was wrong, measured rather than read
 *
 * The query path and the analytics face lowered the `$contains` family to
 * `new RegExp(escapeRegex(v), 'i')` — a literal comparand (so the `%` / `_` /
 * `.` rows always held) matched case-INSENSITIVELY over the whole Unicode
 * range. The reference matcher (`memory-matcher.ts`, `String.includes`) was
 * case-exact all along, so this package answered ONE operator two ways
 * depending on which face you entered — the divergence class #5374 closed for
 * the same operator between two other faces of the same package.
 *
 * Both defects were OVER-matching: rows the filter excludes came back. On an
 * RLS read scope a wider predicate is over-reach, not a loose filter (#3948).
 *
 * ## Why every face runs every case
 *
 * Because this package's recurring defect is not "a face is wrong", it is "the
 * faces disagree" — #5374, #5324/#5328, #5347, and #6682 itself. A per-face
 * file lets one arm rot without the others noticing, so each case below runs
 * through the live query path and the reference matcher and demands one answer;
 * the analytics face runs the subset its cube vocabulary can express
 * (`contains` / `notContains` / `icontains` — it has no `startsWith` /
 * `endsWith` row in `MONGO_TO_CUBE_OPERATOR`).
 *
 * ## Pre-fix measurement, recorded before the diff existed
 *
 * Run against unmodified `origin/main` @ `21888ab`: **9 failed / 43 passed** of
 * 52. Every failure was a `$contains`-family case — five on the query path
 * (`expected ['1','2'] to deeply equal ['2']`, the extra folded row), three on
 * the analytics face, and the cross-face agreement row. Every `$icontains` row,
 * every literal-comparand row, every refusal row and every reference-matcher
 * row passed BEFORE the fix. That is what says the flag was the whole gap and
 * that nothing here was widened to reach green: after it, 52/52.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { FILTER_TEXT_CASES, FILTER_TEXT_ROWS } from '@objectstack/spec/data';
import type { FilterTextCase, Cube } from '@objectstack/spec/data';
import { InMemoryDriver } from './memory-driver.js';
import { MemoryAnalyticsService } from './memory-analytics.js';
import { match } from './memory-matcher.js';

const TABLE = 'text_rows';

/** The conformance fixture's rows, as this driver stores them. */
const ROWS = FILTER_TEXT_ROWS.map((r) => ({ ...r }));

const byId = (a: string, b: string) => a.localeCompare(b);

async function seed(): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver();
  for (const row of ROWS) await driver.create(TABLE, { ...row });
  return driver;
}

/** Ids the LIVE QUERY PATH returns (mingo), ascending. */
const queryIds = async (driver: InMemoryDriver, filter: unknown): Promise<string[]> =>
  (await driver.find(TABLE, { where: filter as any })).map((r: any) => String(r.id)).sort(byId);

/** Ids the REFERENCE MATCHER returns, ascending. */
const matcherIds = (filter: unknown): string[] =>
  ROWS.filter((r) => match(r, filter)).map((r) => r.id).sort(byId);

const isRejection = (c: FilterTextCase): c is Extract<FilterTextCase, { expectRejection: true }> =>
  c.expectRejection === true;

const rowCases = FILTER_TEXT_CASES.filter((c) => !isRejection(c));
const rejectionCases = FILTER_TEXT_CASES.filter(isRejection);

describe('[#6682] InMemoryDriver — text-operator conformance, the query path', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  it('the fixture is all nine rows, stored verbatim', async () => {
    const rows = await driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] });
    expect((rows as any[]).map((r) => [String(r.id), r.name]))
      .toEqual(FILTER_TEXT_ROWS.map((r) => [r.id, r.name]));
  });

  for (const c of rowCases) {
    it(c.name, async () => {
      expect(await queryIds(driver, c.filter), c.note ?? c.name).toEqual([...c.expected]);
    });
  }
});

describe('[#6682] the reference matcher answers the same table', () => {
  for (const c of rowCases) {
    it(c.name, () => {
      expect(matcherIds(c.filter), c.note ?? c.name).toEqual([...c.expected]);
    });
  }
});

describe('[#5374] the two general-purpose faces agree, case by case', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  /**
   * Not redundant with the two blocks above, and this is the row that would
   * have been red for the whole life of the defect: a package can satisfy a
   * table face-by-face at two different times and still be the thing #6682 was
   * filed about in between. Stated as an equality between the faces so it fails
   * on the DIVERGENCE rather than on the table.
   */
  it('every case returns the same ids through find() and match()', async () => {
    for (const c of rowCases) {
      expect(await queryIds(driver, c.filter), c.name).toEqual(matcherIds(c.filter));
    }
  });

  /**
   * The #3948 pin, as a property: every case here selects a strict subset of
   * the fixture, so a face that DROPPED the predicate would answer all nine and
   * still look like it worked. Over-matching is the failure mode both halves of
   * this card are about.
   */
  it('no case answers every row — a dropped predicate WIDENS', async () => {
    for (const c of rowCases) {
      expect((await queryIds(driver, c.filter)).length, c.name).toBeLessThan(ROWS.length);
      expect(matcherIds(c.filter).length, c.name).toBeLessThan(ROWS.length);
    }
  });
});

/**
 * The refusals, on both general-purpose faces.
 *
 * `code` AND `status`, never a bare `toThrow()` (ADR-0112): a rejection test
 * that only asserts "something threw" carries one bit where the defect has two,
 * and this package's own history is the argument — #5324 spent an issue routing
 * uncoded engine errors back into the envelope, and a throw-only assertion
 * cannot tell a correct refusal from an uncoded one. `mustMention` is checked
 * because a refusal that does not name the replacement sends the author to the
 * docs, which is what `RETIRED_FILTER_OPERATORS` exists to prevent.
 */
describe('[#6682] refusals, in the ADR-0112 envelope, on both faces', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  const thrownBy = async (fn: () => unknown | Promise<unknown>): Promise<any> => {
    try {
      await fn();
      return null;
    } catch (e) {
      return e;
    }
  };

  for (const c of rejectionCases) {
    it(`query path: ${c.name}`, async () => {
      const err = await thrownBy(() => driver.find(TABLE, { where: c.filter as any }));
      expect(err, `${c.name} — resolving is the silent wrong answer the retirement ended`).toBeInstanceOf(Error);
      expect(err.code).toBe(c.code);
      expect(err.status).toBe(400);
      for (const fragment of c.mustMention) expect(err.message).toContain(fragment);
    });

    it(`reference matcher: ${c.name}`, async () => {
      const err = await thrownBy(() => match(ROWS[0], c.filter));
      expect(err, c.name).toBeInstanceOf(Error);
      expect(err.code).toBe(c.code);
      expect(err.status).toBe(400);
      for (const fragment of c.mustMention) expect(err.message).toContain(fragment);
    });
  }
});

/**
 * [#5374] The ANALYTICS face, on the cases its cube vocabulary can express.
 *
 * This face is not a second copy of the rule — it asks the driver for it
 * (`filterSubstringPattern`), which is the shape #5374 introduced precisely so
 * the two could not drift. That makes it the face most likely to be believed
 * without being checked, and it was wrong here for exactly as long as the query
 * path was.
 */
describe('[#6682] the analytics face answers the same text rules', () => {
  const cube: Cube = {
    name: 'texts',
    title: 'Texts',
    sql: TABLE,
    measures: {
      count: { name: 'count', label: 'Count', type: 'count', sql: 'id' },
    },
    dimensions: {
      id: { name: 'id', label: 'Id', type: 'string', sql: 'id' },
      name: { name: 'name', label: 'Name', type: 'string', sql: 'name' },
    },
  } as unknown as Cube;

  let service: MemoryAnalyticsService;
  beforeEach(async () => {
    service = new MemoryAnalyticsService({ driver: await seed(), cubes: [cube] });
  });

  /**
   * Ids this face returns for one case's filter, ascending.
   *
   * The filter goes in as `where` — a `FilterCondition`, the case-set's own
   * shape and the only one this face accepts since #5375 (the API layer rejects
   * a `{member, operator, values}` array on the wire). So these rows drive the
   * SHARED cases rather than a cube-dialect restatement of them.
   */
  const analyticsIds = async (filter: unknown): Promise<string[]> => {
    const result = await service.query({
      cube: 'texts',
      measures: ['texts.count'],
      dimensions: ['texts.id'],
      where: filter,
    } as any);
    return result.rows.map((r: any) => String(r['texts.id'])).sort(byId);
  };

  /**
   * The subset this face can express: `MONGO_TO_CUBE_OPERATOR` carries
   * `$contains` / `$notContains` / `$icontains` and has no `$startsWith` /
   * `$endsWith` row, so those two are refused here rather than answered — a
   * LOUD `uncompilableFieldOperatorError`, not a silent drop, and out of this
   * card's scope. Selected by operator off the shared table rather than by
   * name, so a new case joins this face automatically.
   */
  const EXPRESSIBLE = ['$contains', '$notContains', '$icontains'];
  const analyticsCases = rowCases.filter((c) =>
    Object.values(c.filter as Record<string, Record<string, unknown>>)
      .every((ops) => Object.keys(ops).every((op) => EXPRESSIBLE.includes(op))),
  );

  it('covers the whole expressible subset — eleven cases, not an accidental one', () => {
    expect(analyticsCases.length).toBe(11);
  });

  for (const c of analyticsCases) {
    it(c.name, async () => {
      expect(await analyticsIds(c.filter), c.note ?? c.name).toEqual([...c.expected]);
    });
  }

  /**
   * The fix must not be applied one level too deep. `filterSubstringPattern` is
   * shared with the `$contains` family only — `$icontains` builds its pattern
   * from the spec's `asciiCaseInsensitiveRegexSource` instead — so taking the
   * fold out of that helper must leave the ASCII boundary exactly where #6520
   * put it. Stated separately from the loop above because it is the regression
   * this diff could plausibly cause, not a rule this diff establishes.
   */
  it('leaves $icontains folding ASCII and NOTHING else', async () => {
    expect(await analyticsIds({ name: { $icontains: 'acme' } })).toEqual(['1', '2']);
    expect(await analyticsIds({ name: { $icontains: 'café' } })).toEqual(['4']);
    expect(await analyticsIds({ name: { $icontains: 'CAFÉ' } })).toEqual(['3']);
  });
});
