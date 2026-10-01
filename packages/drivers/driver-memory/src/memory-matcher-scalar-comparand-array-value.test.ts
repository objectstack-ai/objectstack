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
 * ⚠️ [#21066] The column here is DECLARED `text` — a scalar column holding
 * arrays — and that is the only population this per-element reading still
 * covers. On a column DECLARED JSON-stored (a `multiple: true` field, `tags`,
 * `json`, …) the equality and ordering family is REFUSED `INVALID_FILTER` /
 * 400 by the shape gate, as the SQL family refuses it, and the membership
 * question is `$contains`'s: `memory-21066-json-column-family-refusal.test.ts`.
 *
 * ⚠️ One level only, measured rather than reasoned: mingo does not descend into
 * a NESTED array, so neither does this face — `[['a']]` does not match `'a'` on
 * either face, and that row is in the fixture to hold it.
 *
 * [#5930 step 4, ruling D6] The reference matcher had no production caller and
 * is RETIRED; this file keeps its name and holds the LIVE path alone. The
 * matrix's cases were already asserted on the live path, case by case; the
 * matcher's own assertions — the card's three rows, the OR-over-elements
 * property and `$ne`'s per-row complement — are asked of `find()` now, a row at
 * a time, because they are statements about the one arm both faces shared.
 */

import { describe, it, expect, beforeAll } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';

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

/**
 * Does the LIVE path select one row storing `tags`? — the matcher's
 * `match({ tags }, where)`, asked of `find()` over a table holding that row
 * alone.
 */
async function liveRowMatches(tags: unknown, where: Record<string, unknown>): Promise<boolean> {
  const one = new InMemoryDriver({ persistence: false });
  await one.connect();
  await one.syncSchema(TABLE, { fields: { id: { type: 'text', name: 'id' }, tags: { type: 'text', name: 'tags' } } } as never);
  await one.create(TABLE, { id: 'row', tags });
  return ((await one.find(TABLE, { where } as never)) as unknown[]).length === 1;
}

describe('[#16838] a scalar comparand against a stored array — the live path, one process', () => {
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
  }

  /**
   * This was "both faces answer the whole matrix identically" — the live path
   * against the reference matcher. With the matcher retired (#5930 step 4) the
   * whole matrix is held, in one assertion, to the expectations both faces were
   * written against, so it survives the per-case loop above being edited.
   */
  it('the live path answers the whole matrix as written', async () => {
    const got: Record<string, string[]> = {};
    for (const c of CASES) got[c.name] = await liveIds(c.where);
    expect(got).toEqual(Object.fromEntries(CASES.map((c) => [c.name, sorted(c.expected)])));
  });

  /**
   * The card's three rows, spelled as it measured them — one row, one filter —
   * so the numbers in the card and the numbers here can be compared without
   * reading the fixture above. The card measured them on the reference matcher
   * (`match()`, retired); they are asked of the live path here.
   */
  it("the card's own three rows, one row at a time", async () => {
    expect(await liveRowMatches(['a', 'b'], { tags: 'a' })).toBe(true); //   was false on the matcher — the missing membership
    expect(await liveRowMatches(['a', 'b'], { tags: 'a,b' })).toBe(false); // was true on the matcher — the false positive
    expect(await liveRowMatches(['a'], { tags: 'a' })).toBe(true); //        the firing control, unmoved
  });

  /**
   * The rule the arm implements, asserted as a property rather than described:
   * an array answers what the OR of its elements answers. A future edit that
   * reintroduces any whole-array conversion breaks this for every case at once,
   * not only for the two the card happened to measure.
   */
  it('a stored array answers the OR of the answers its ELEMENTS would give', async () => {
    for (const c of CASES) {
      if (c.polarity !== 'equality') continue;
      for (const row of ROWS) {
        const stored = row.tags;
        if (!Array.isArray(stored)) continue;
        // One level only: an element that is itself an array is not descended
        // into, on either face.
        let elementwise = false;
        for (const element of stored) {
          if (!Array.isArray(element) && (await liveRowMatches(element, c.where))) elementwise = true;
        }
        expect(await liveRowMatches(stored, c.where), `${c.name} / ${String(row.id)}: not the OR over its elements`)
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
  it('$ne is the per-row complement of $eq, arrays included', async () => {
    const all = sorted(ROWS.map((r) => String(r.id)));
    for (const comparand of ['a', 'b', 'z', 'a,b', null]) {
      const eq = await liveIds({ tags: { $eq: comparand } });
      const ne = await liveIds({ tags: { $ne: comparand } });
      expect(ne, `${JSON.stringify(comparand)}: $ne is not the per-row complement of $eq`)
        .toEqual(all.filter((id) => !eq.includes(id)));
    }
  });

  it('a NESTED array is not descended into — one level', async () => {
    expect(await liveRowMatches([['a']], { tags: 'a' })).toBe(false);
    expect(await liveIds({ tags: 'a' })).not.toContain('array-nested');
  });
});
