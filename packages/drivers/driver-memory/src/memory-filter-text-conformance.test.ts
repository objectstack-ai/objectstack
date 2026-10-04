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
 * through the live query path and demands the table's answer; the analytics
 * face runs the subset its cube vocabulary can express (`contains` /
 * `notContains` / `icontains` — it has no `startsWith` / `endsWith` row in
 * `MONGO_TO_CUBE_OPERATOR`).
 *
 * [#5930 step 4, ruling D6] Every case used to run through the reference
 * matcher too. The matcher had no production caller and is retired: its row
 * cases asserted the same `expected` column the query-path cases assert (and
 * `@objectstack/formula` and every other backend answer the same table), its
 * refusals were raised by `assertFilterConditionShape` — asserted on that gate
 * directly below — and its one private cell (#14079, a valued non-string row)
 * is asserted on the live path.
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
import { assertFilterConditionShape } from './filter-refusal.js';

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

const isRejection = (c: FilterTextCase): c is Extract<FilterTextCase, { expectRejection: true }> =>
  c.expectRejection === true;

const rowCases = FILTER_TEXT_CASES.filter((c) => !isRejection(c));
const rejectionCases = FILTER_TEXT_CASES.filter(isRejection);

describe('[#6682] InMemoryDriver — text-operator conformance, the query path', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  it('the fixture is all nine rows, stored verbatim', async () => {
    const rows = await driver.find(TABLE, { orderBy: [{ field: 'id', order: 'asc' }] });
    expect((rows as any[]).map((r) => [String(r.id), r.name, r.score]))
      .toEqual(FILTER_TEXT_ROWS.map((r) => [r.id, r.name, r.score]));
    // [#14079] The premise of the non-string rows: `score` is stored as a
    // NUMBER on this driver, not stringified on the way in.
    for (const r of rows as any[]) expect(typeof r.score, `row ${r.id}`).toBe('number');
  });

  for (const c of rowCases) {
    it(c.name, async () => {
      expect(await queryIds(driver, c.filter), c.note ?? c.name).toEqual([...c.expected]);
    });
  }
});

describe('[#5374] the general-purpose face answers the whole table', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  /**
   * This was "every case returns the same ids through find() and match()" — an
   * equality between the two general-purpose faces, the row that would have
   * been red for the whole life of #6682. [#5930 step 4] One face is left, so
   * the equality is kept against the oracle both faces were held to: the whole
   * table in ONE assertion, which survives the per-case loop being edited.
   */
  it('every case returns the table\'s ids through find(), in one sweep', async () => {
    const got: Record<string, string[]> = {};
    for (const c of rowCases) got[c.name] = await queryIds(driver, c.filter);
    expect(got).toEqual(Object.fromEntries(rowCases.map((c) => [c.name, [...c.expected]])));
  });

  /**
   * The #3948 pin, as a property: every case here selects a strict subset of
   * the fixture, so a face that DROPPED the predicate would answer all nine and
   * still look like it worked. Over-matching is the failure mode both halves of
   * this card are about.
   */
  it('no case answers every row — a dropped predicate WIDENS', async () => {
    // [#14079] ONE case legitimately selects the whole fixture: `$notContains`
    // over the non-string column, whose declared answer IS every row (a number
    // never contains the substring, so every number "does not contain" it).
    // It is named here so the property stays a property, not a loophole — a
    // second whole-set answer is the widening this pin exists to catch, and a
    // dropped predicate on THAT case is caught by its positive twins (whose
    // declared answer is NO rows) and by the face-agreement row above.
    const WHOLE_SET = '$notContains is satisfied by every stored value that is not a string — complementarity holds';
    expect(rowCases.filter((c) => c.expected.length === ROWS.length).map((c) => c.name)).toEqual([WHOLE_SET]);
    for (const c of rowCases) {
      if (c.name === WHOLE_SET) continue;
      expect((await queryIds(driver, c.filter)).length, c.name).toBeLessThan(ROWS.length);
    }
  });
});

/**
 * The refusals, on the query path and on the shared shape gate it runs.
 *
 * `code` AND `status`, never a bare `toThrow()` (ADR-0112): a rejection test
 * that only asserts "something threw" carries one bit where the defect has two,
 * and this package's own history is the argument — #5324 spent an issue routing
 * uncoded engine errors back into the envelope, and a throw-only assertion
 * cannot tell a correct refusal from an uncoded one. `mustMention` is checked
 * because a refusal that does not name the replacement sends the author to the
 * docs, which is what `RETIRED_FILTER_OPERATORS` exists to prevent.
 */
describe('[#6682] refusals, in the ADR-0112 envelope, on the query path and the shape gate', () => {
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

    // [#5930 step 4] The retired reference matcher's refusal was this gate's.
    it(`shape gate: ${c.name}`, async () => {
      const err = await thrownBy(() => assertFilterConditionShape(c.filter, 'filter'));
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
      count: { label: 'Count', type: 'count', sql: 'id' },
    },
    dimensions: {
      id: { label: 'Id', type: 'string', sql: 'id' },
      name: { label: 'Name', type: 'string', sql: 'name' },
      // [#14079] The fixture's non-string column, declared as the number it is
      // so the `score` rows reach this face through its own vocabulary.
      score: { label: 'Score', type: 'number', sql: 'score' },
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

  it('covers the whole expressible subset — fifteen cases, not an accidental one', () => {
    // Twelve since #8934: the infix `icontains` spelling's `%`-literal case is
    // computed through `parseFilterAST` and lands as `$icontains`, so it joins
    // this face's expressible subset automatically — exactly the mechanism the
    // selection note above promises. Fifteen since #14079: three of the five
    // non-string rows (`$contains` / `$icontains` / `$notContains` over
    // `score`) are in this face's vocabulary and join the same way; the
    // `$startsWith` / `$endsWith` pair stays outside it, refused loudly.
    expect(analyticsCases.length).toBe(15);
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

/**
 * [#14079] `$like` / `$ilike` over a stored value that is not a string.
 *
 * The ruling names all six positive operators, but the shared table cannot
 * carry `$like` rows — a driver's enrolment is the whole table (rule 2 of its
 * header) and `driver-mongodb` refuses those two operators — so the pair is
 * pinned per face that answers it. Same shape as the table's `score` rows:
 * the positive pattern matches NOTHING, its `$not` matches EVERYTHING. (The
 * retired reference matcher was asserted to agree first; it did, with these
 * same literal answers.) Under coercion `'%5%'` would match seven rows and `'%0'` every row
 * on a REAL column (`5` renders `'5.0'`), which is the wrong answer the
 * assertion keeps out.
 */
describe('[#14079] $like / $ilike over a stored non-string value, on the query path', () => {
  let driver: InMemoryDriver;
  beforeEach(async () => { driver = await seed(); });

  const ALL = FILTER_TEXT_ROWS.map((r) => r.id);
  const CASES: Array<[string, unknown, string[]]> = [
    ['$like never matches a stored number', { score: { $like: '%5%' } }, []],
    ['$like with a trailing wildcard never matches a stored number', { score: { $like: '%0' } }, []],
    ['$ilike never matches a stored number', { score: { $ilike: '%5%' } }, []],
    ['$not over $like admits every stored number — complementarity', { $not: { score: { $like: '%5%' } } }, ALL],
    ['$not over $ilike admits every stored number', { $not: { score: { $ilike: '%5%' } } }, ALL],
  ];

  for (const [name, filter, expected] of CASES) {
    it(name, async () => {
      expect(await queryIds(driver, filter)).toEqual(expected);
    });
  }

  it('BOTH polarities are answered for a valued non-string row — the #14079 cell itself', async () => {
    // The measured defect, on the retired reference matcher: `{ n: 5 }` failed
    // `$contains: '5'` AND `$notContains: '5'`. A type test in place of the
    // predicate says NO to an operator and to its negation; the predicate says
    // NO to one and YES to the other. [#5930 step 4] Held on the live path now.
    const cell = new InMemoryDriver();
    for (const row of [{ id: 'x', n: 5 }, { id: 'y', n: 0 }, { id: 'z', n: true }]) await cell.create('cell', row);
    const ids = async (where: unknown): Promise<string[]> =>
      ((await cell.find('cell', { where: where as any })) as any[]).map((r) => String(r.id)).sort(byId);
    expect(await ids({ n: { $contains: '5' } })).toEqual([]);
    expect(await ids({ n: { $notContains: '5' } })).toEqual(['x', 'y', 'z']);
    expect(await ids({ n: { $notContains: '0' } })).toEqual(['x', 'y', 'z']);
    expect(await ids({ n: { $notContains: 'true' } })).toEqual(['x', 'y', 'z']);
  });
});
