// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16838] A SCALAR comparand against a stored ARRAY value — the VALUE side of
 * the equality arm, and the third bad direction of `==` that #16810 recorded
 * and deliberately did not repair.
 *
 * # What was measured, and why it is one defect and not two
 *
 * `checkCondition`'s equality arm ended in `value == condition`. Loose `==`
 * converts the stored ARRAY to a primitive, so `['a','b']` becomes the string
 * `"a,b"` — and that single conversion produced a disagreement between this
 * package's two filter faces in BOTH directions at once:
 *
 * | filter | stored | reference matcher, BEFORE | live `InMemoryDriver.find` (mingo) |
 * |---|---|---|---|
 * | `{ tags: 'a' }`   | `['a','b']` | `false` — no row | the row |
 * | `{ tags: 'a,b' }` | `['a','b']` | `true` — the row | no row |
 * | `{ tags: 'a' }`   | `['a']`     | `true` — the row | the row |
 *
 * The second row is the sharper one: a FALSE POSITIVE, a filter written to
 * narrow returning a row it should not, which on an RLS read scope is a
 * permission concern rather than a degraded filter (#3948, and the identical
 * notes `memory-matcher.ts` already carries for `$null`, for the malformed
 * `$between` shape and for an unknown operator). The third row is the firing
 * control: it answers the same on both faces before and after, so a suite that
 * went green by never running would not look like a pass.
 *
 * # Which face was chosen, and why it was not a free choice
 *
 * The live path's membership reading is MongoDB's array semantics; the
 * matcher's string-join reading is an accident of the operator it happens to be
 * written with. This file's tie-break is the one `memory-matcher.ts` has used
 * since #5240, #5324, #5328 and #5374 — the live mingo path is what this
 * package's users actually run, so the reference face converges on it, cell for
 * cell. Refusing the shape was the third answer available and is not open here:
 * a refusal is raised from the FILTER (`assertFilterConditionShape` walks the
 * filter, once, before any row is seen) and this cell is a property of the
 * stored ROW, so a refusal would have to fire or not fire depending on the data
 * — the very record-dependence #5240 moved the shape walk out of the field loop
 * to avoid.
 *
 * # The rule, stated so it can be checked rather than described
 *
 * A stored array is read as its elements, and the arm asks each of them the
 * question it asks a scalar. That is asserted directly, as a property over the
 * whole matrix below: for every case, the answer for a row storing an array
 * equals the OR of the answers for the rows storing its elements. It is the
 * same composition mingo performs, which is why the two faces agree here by
 * construction rather than by coincidence.
 *
 * ⚠️ One level only, measured rather than reasoned: mingo does not descend into
 * a NESTED array, so neither does this face — `[['a']]` does not match `'a'` on
 * either face, and that row is in the fixture to hold it.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

const TABLE = 'array_value_equality';

/**
 * One fixture, both faces, one process. The two scalar rows are the card's
 * firing control — a comparand that legitimately matches and its negative twin
 * — and they are asserted in every case below, so "the filter never ran" and
 * "the filter correctly excluded everything" cannot read alike.
 */
const ROWS: ReadonlyArray<Record<string, unknown>> = [
  { id: 'scalar-hit', tags: 'a' },
  { id: 'scalar-miss', tags: 'z' },
  { id: 'array-multi', tags: ['a', 'b'] },
  { id: 'array-single', tags: ['a'] },
  { id: 'array-other', tags: ['b'] },
  { id: 'array-nested', tags: [['a']] },
  { id: 'array-with-null', tags: [null, 'b'] },
  { id: 'array-empty', tags: [] },
];

/**
 * Every case names the row set BOTH faces must answer. The expectations are the
 * live path's measured answers — see the header for why that is the tie-break.
 */
const CASES: ReadonlyArray<{
  name: string;
  where: Record<string, unknown>;
  expected: string[];
  /**
   * Whether the case asks the equality question or its NEGATION. The OR-over-
   * elements property below is a statement about the equality predicate; `$ne`
   * is that predicate's complement, so on an array it means "NO element equals"
   * — the AND, not the OR. Marking the polarity states which of the two is
   * being asserted instead of leaving a reader to infer it from an operator.
   */
  polarity: 'equality' | 'negated';
}> = [
  {
    name: "{ tags: 'a' } — a scalar comparand is MEMBERSHIP against a stored array",
    where: { tags: 'a' },
    expected: ['array-multi', 'array-single', 'scalar-hit'],
    polarity: 'equality',
  },
  {
    name: "{ tags: 'a,b' } — the JOINED string matches nothing; the false positive is gone",
    where: { tags: 'a,b' },
    expected: [],
    polarity: 'equality',
  },
  {
    name: "{ tags: 'z' } — the firing control's negative twin",
    where: { tags: 'z' },
    expected: ['scalar-miss'],
    polarity: 'equality',
  },
  {
    name: "{ tags: { $eq: 'a' } } — the operator spelling answers as the implicit one",
    where: { tags: { $eq: 'a' } },
    expected: ['array-multi', 'array-single', 'scalar-hit'],
    polarity: 'equality',
  },
  {
    name: "{ tags: { $ne: 'a' } } — and its complement is the exact complement",
    where: { tags: { $ne: 'a' } },
    expected: ['array-empty', 'array-nested', 'array-other', 'array-with-null', 'scalar-miss'],
    polarity: 'negated',
  },
  {
    name: '{ tags: null } — a null comparand finds a null MEMBER, and only that',
    where: { tags: null },
    expected: ['array-with-null'],
    polarity: 'equality',
  },
  {
    name: "{ tags: 'b' } — the member that is not first, so position cannot be what matches",
    where: { tags: 'b' },
    expected: ['array-multi', 'array-other', 'array-with-null'],
    polarity: 'equality',
  },
];

const sorted = (ids: readonly string[]): string[] => [...ids].sort((x, y) => x.localeCompare(y));

/** The reference face: `memory-matcher.ts`, one record at a time. */
const referenceIds = (where: Record<string, unknown>): string[] =>
  sorted(ROWS.filter((r) => match(r, where)).map((r) => String(r.id)));

describe('[#16838] a scalar comparand against a stored array — both faces, one process', () => {
  let driver: InMemoryDriver;
  /** The live face: `InMemoryDriver.find`, through `normalizeFilterCondition` and mingo. */
  let liveIds: (where: Record<string, unknown>) => Promise<string[]>;

  beforeAll(async () => {
    driver = new InMemoryDriver({ persistence: false });
    await driver.connect();
    await driver.syncSchema(TABLE, {
      fields: {
        id: { type: 'text', name: 'id' },
        tags: { type: 'text', name: 'tags' },
      },
    } as never);
    for (const row of ROWS) await driver.create(TABLE, { ...row });

    liveIds = async (where) => {
      const rows = (await driver.find(TABLE, { fields: ['id'], where } as never)) as Array<Record<string, unknown>>;
      return sorted(rows.map((r) => String(r.id)));
    };
  });

  it('the fixture really is all eight rows, arrays included', async () => {
    // A case that returns nothing because the seed failed must not read as a
    // case that correctly excluded everything.
    expect(await liveIds({})).toEqual(sorted(ROWS.map((r) => String(r.id))));
    const stored = (await driver.find(TABLE, {} as never)) as Array<Record<string, unknown>>;
    expect(stored.find((r) => r.id === 'array-multi')?.tags).toEqual(['a', 'b']);
  });

  for (const c of CASES) {
    it(`${c.name} — the LIVE query path`, async () => {
      expect(await liveIds(c.where)).toEqual(sorted(c.expected));
    });

    it(`${c.name} — the REFERENCE matcher`, () => {
      expect(referenceIds(c.where)).toEqual(sorted(c.expected));
    });
  }

  it('both faces answer the whole matrix identically', async () => {
    for (const c of CASES) {
      expect(await liveIds(c.where), `${c.name}: the live query path and the reference matcher disagree`)
        .toEqual(referenceIds(c.where));
    }
  });

  /**
   * The card's three rows, spelled exactly as it measured them — `match()`
   * directly, one row, one filter — so the numbers in the card and the numbers
   * here can be compared without reading the fixture above.
   */
  it("the card's own three rows, on the reference matcher", () => {
    expect(match({ tags: ['a', 'b'] }, { tags: 'a' })).toBe(true); //   was false — the missing membership
    expect(match({ tags: ['a', 'b'] }, { tags: 'a,b' })).toBe(false); // was true  — the false positive
    expect(match({ tags: ['a'] }, { tags: 'a' })).toBe(true); //        the firing control, unmoved
  });

  /**
   * The rule the arm implements, asserted as a property rather than described:
   * an array answers what the OR of its elements answers. A future edit that
   * reintroduces any whole-array conversion breaks this for every case at once,
   * not only for the two the card happened to measure.
   */
  it('a stored array answers the OR of the answers its ELEMENTS would give', () => {
    for (const c of CASES) {
      if (c.polarity !== 'equality') continue;
      for (const row of ROWS) {
        const stored = row.tags;
        if (!Array.isArray(stored)) continue;
        // One level only: an element that is itself an array is not descended
        // into, on either face.
        const elementwise = stored.some((element) => !Array.isArray(element) && match({ tags: element }, c.where));
        expect(match(row, c.where), `${c.name} / ${String(row.id)}: not the OR over its elements`)
          .toBe(elementwise);
      }
    }
  });

  /**
   * `$ne` is the equality predicate's exact complement, per row — which on an
   * array is "NO element equals", the AND rather than the OR. Stated because
   * the two spellings share {@link comparandEquals} and a future edit that
   * fixed one direction only would leave a stored array both matching and not
   * matching the same comparand.
   */
  it('$ne is the per-row complement of $eq, arrays included', () => {
    for (const comparand of ['a', 'b', 'z', 'a,b', null]) {
      for (const row of ROWS) {
        expect(
          match(row, { tags: { $ne: comparand } }),
          `${String(row.id)} / ${JSON.stringify(comparand)}: $ne is not the complement of $eq`,
        ).toBe(!match(row, { tags: { $eq: comparand } }));
      }
    }
  });

  it('a NESTED array is not descended into — one level, on both faces', async () => {
    expect(match({ tags: [['a']] }, { tags: 'a' })).toBe(false);
    expect(await liveIds({ tags: 'a' })).not.toContain('array-nested');
  });
});
