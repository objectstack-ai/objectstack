// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13494/#13495/#13549/#13553] The reference matcher against a null COMPARAND
 * and a null VALUE — held to the live mingo path of its own package.
 *
 * Four cards, three roots, one file. Measured on `df18120502` before the first
 * repair, and on `8b04c75d7d` for #13553:
 *
 * | filter | reading | matcher | live path | |
 * |---|---|---|---|---|
 * | `{$eq: null}` | key ABSENT | `[]` | `['3']` | #13494 |
 * | `{$between: [null, null]}` | value `null` | `['1','3']` | `['3']` | #13495 |
 * | `{$between: ['2026-07-01','2026-07-15']}` | value `null` | `['1','2','4']` | `['1','2']` | #13549 |
 * | `{$gte: -1}` on a NUMERIC column | value `null` | `['1','2','3']` | `['1','2']` | #13553 |
 *
 * ## The two roots — measured, not assumed
 *
 * #13495 and #13549 ARE one root: the same `$between` arm, the same line, the
 * same coercion. It was written as an EXCLUSION test (`value < min ||
 * value > max`), and a relational comparison against a null is false in BOTH
 * directions, so neither disjunct fired and the range stopped bounding.
 *
 * #13494 is a DIFFERENT root in a different place: the pre-switch guard in
 * `checkCondition` short-circuited a MISSING key to "no match" before the
 * `$eq` arm ever ran. Nothing in it is a failed comparison — the arm's own
 * loose `!=` had the right answer for both readings all along, and the proof
 * is `$ne`, which was already on the guard's allowlist and answered both
 * readings correctly throughout.

 * #13553 is the THIRD root, and it is the same DEFECT as #13549 in four arms
 * the `$between` repair did not reach: `$gt` / `$gte` / `$lt` / `$lte` compared
 * a stored `null` instead of deciding first whether the comparison meant
 * anything. It went unseen for the length of three cards because every fixture
 * they used stored ISO date STRINGS, where `null >= '2026-07-01'` compares `0`
 * against `NaN` and is false — the arms look correct. On a NUMERIC column
 * `null` coerces to `0` and the no-value row sits inside the bound, so the
 * matcher answered that one row is both greater than `-1` and less than `1`.
 *
 * ⭐ The reason that mattered beyond the four cells: this package's LIVE path
 * compiles `$between` INTO `$gte` + `$lte` (`memory-driver.ts`). Once #13549
 * landed, this face answered `{n: {$between: [-1, 1]}}` and
 * `{n: {$gte: -1, $lte: 1}}` DIFFERENTLY on the same row, though they are one
 * predicate to the live path. The `$between`-equals-its-two-bounds case below
 * is what holds that closed.
 *
 * ## Why every expectation here is stated on BOTH faces
 *
 * This file's recurring defect is not "a wrong answer", it is "two answers":
 * #5240, #5324, #5328 and #5374 each closed a cell where this reference face
 * and the live query path answered one filter two ways. So no cell below
 * asserts a row set alone — each asserts that both faces produce it. A repair
 * that moved only one face would pass a one-face suite and re-open the class.
 *
 * ⚠️ #13357's `$in: [null]` / `$nin: [null]` arms are deliberately ABSENT from
 * this file. They were `needs-user-decision` when #13494/#13495/#13549 landed;
 * the maintainer ruled them on 2026-08-31 (option C) and the shapes are now
 * REFUSED at the contract's validation entrance, with the negative pin in
 * `memory-null-list-member-unreachable.test.ts`. Their cells are still not
 * asserted here, now for the ruling's own reason — ⛔「不单独修一个到不了的
 * 路径」 — and they were measured byte-identical across this repair too.
 *
 * ⚠️ A null COMPARAND in an ORDERING position (`{$gte: null}`) is absent for
 * the ORIGINAL reason, and it is the one such position the contract still
 * ACCEPTS: the 2026-08-31 ruling refused the three siblings and #5332's
 * landing had already recorded this one in writing as a position "no ruling
 * covers". #13553's guard is scoped to leave those cells exactly where it
 * found them, so pinning them here — in either direction — would prejudge a
 * ruling nobody has made. The invariance is proven in the PR, not asserted
 * here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { InMemoryDriver } from './memory-driver.js';
import { match } from './memory-matcher.js';

const sorted = (ids: string[]): string[] => [...ids].sort();

/**
 * The cards' own fixture, in both readings of "no value" — a stored `null` and
 * an ABSENT key. The two reach different code (`null` reaches the operator
 * arm, `undefined` meets the pre-switch guard first), which is exactly how the
 * matcher came to disagree with ITSELF across them.
 */
const NULLED_ROWS: Array<Record<string, unknown>> = [
  { id: '1', name: 'a' },
  { id: '3', name: null },
];
const MISSING_ROWS: Array<Record<string, unknown>> = [
  { id: '1', name: 'a' },
  { id: '3' },
];
/** #13549's five-row fixture: three valued, one null, one absent. */
const SWEEP_ROWS: Array<Record<string, unknown>> = [
  { id: '1', v: '2026-07-01' },
  { id: '2', v: '2026-07-15' },
  { id: '3', v: '2026-07-28' },
  { id: '4', v: null },
  { id: '5' },
];
/**
 * The NUMERIC fixture, and the reason it exists: `null` coerces to `0` under a
 * relational comparison, so a null-valued row sits inside `[-1, 1]` while
 * every string fixture in the three cards shows the arm repaired. A fix
 * validated on strings alone passes those and leaves this one broken.
 */
const NUMERIC_ROWS: Array<Record<string, unknown>> = [
  { id: '1', n: 5 },
  { id: '2', n: 0 },
  { id: '3', n: null },
  { id: '4' },
];

let nulled: InMemoryDriver;
let missing: InMemoryDriver;
let sweep: InMemoryDriver;
let numeric: InMemoryDriver;

async function driverFor(rows: Array<Record<string, unknown>>): Promise<InMemoryDriver> {
  const driver = new InMemoryDriver({ persistence: false });
  await driver.connect();
  for (const row of rows) await driver.create('t', { ...row });
  return driver;
}

beforeAll(async () => {
  nulled = await driverFor(NULLED_ROWS);
  missing = await driverFor(MISSING_ROWS);
  sweep = await driverFor(SWEEP_ROWS);
  numeric = await driverFor(NUMERIC_ROWS);
});

afterAll(async () => {
  await nulled.disconnect();
  await missing.disconnect();
  await sweep.disconnect();
  await numeric.disconnect();
});

/** The LIVE query path: `find()` → `normalizeFilterCondition` → mingo. */
async function liveIds(driver: InMemoryDriver, where: unknown): Promise<string[]> {
  const out = await driver.find('t', { where } as never);
  return sorted((out as Array<Record<string, unknown>>).map((r) => String(r.id)));
}

/** The REFERENCE face: the record-at-a-time matcher. */
const matcherIds = (rows: Array<Record<string, unknown>>, where: unknown): string[] =>
  sorted(rows.filter((row) => match(row, where)).map((row) => String(row.id)));

/**
 * Every cell asserts the row set on BOTH faces, in one call, so a repair that
 * moves one of them cannot pass. The expected set is written out literally —
 * comparing the two faces to each other alone would be satisfied by both being
 * wrong together.
 */
async function bothFaces(
  driver: InMemoryDriver,
  rows: Array<Record<string, unknown>>,
  where: unknown,
  expected: string[],
): Promise<void> {
  expect({ face: 'live', ids: await liveIds(driver, where) }).toEqual({ face: 'live', ids: expected });
  expect({ face: 'matcher', ids: matcherIds(rows, where) }).toEqual({ face: 'matcher', ids: expected });
}

describe('[#13494] `$eq: null` is the null predicate on BOTH readings of "no value"', () => {
  it('a MISSING key matches `$eq: null` — the cell that disagreed', async () => {
    // Was `[]` on the matcher against `['3']` live: `$eq` was not on the
    // pre-switch guard's allowlist, so an absent key short-circuited to "no
    // match" before the arm ran. #5332 ruled `$eq: null` IS the null predicate.
    await bothFaces(missing, MISSING_ROWS, { name: { $eq: null } }, ['3']);
  });

  it('a stored null matches it too — the reading that always worked', async () => {
    await bothFaces(nulled, NULLED_ROWS, { name: { $eq: null } }, ['3']);
  });

  it('`$eq: null` now answers exactly what `$null: true` answers, on both readings', async () => {
    // The anchor #5332 aligned every other surface to. Before the repair these
    // two spellings of one predicate differed on the MISSING reading alone.
    for (const [driver, rows] of [[missing, MISSING_ROWS], [nulled, NULLED_ROWS]] as const) {
      const viaNull = matcherIds(rows, { name: { $null: true } });
      const viaEq = matcherIds(rows, { name: { $eq: null } });
      expect(viaEq).toEqual(viaNull);
      expect(viaEq).toEqual(['3']);
    }
  });

  it('`$ne: null` is unmoved — it was already on the allowlist, and was already right', async () => {
    await bothFaces(missing, MISSING_ROWS, { name: { $ne: null } }, ['1']);
    await bothFaces(nulled, NULLED_ROWS, { name: { $ne: null } }, ['1']);
  });

  it('a REAL comparand keeps the answer it had on a missing key', async () => {
    // The guard exemption moved the no-value cells and only those: the arm
    // reaches the same verdict the guard did (`undefined != 'a'` is true).
    await bothFaces(missing, MISSING_ROWS, { name: { $eq: 'a' } }, ['1']);
    await bothFaces(missing, MISSING_ROWS, { name: { $eq: '' } }, []);
    await bothFaces(missing, MISSING_ROWS, { name: { $eq: false } }, []);
    await bothFaces(nulled, NULLED_ROWS, { name: { $eq: 'a' } }, ['1']);
  });
});

describe('[#13495] a `$between` bound that is null no longer stops bounding', () => {
  it('`[null, null]` does not match the VALUED row', async () => {
    // Was `['1','3']` on the matcher against `['3']` live: `'a' < null` and
    // `'a' > null` are BOTH false, so the exclusion test excluded nothing.
    await bothFaces(nulled, NULLED_ROWS, { name: { $between: [null, null] } }, ['3']);
  });

  it('`[null, null]` on the MISSING reading selects nothing, on both faces', async () => {
    await bothFaces(missing, MISSING_ROWS, { name: { $between: [null, null] } }, []);
  });

  it('a HALF-null bound is the same defect and the same repair', async () => {
    // Neither card named these: #13495 measured `[null, null]` only. A range
    // with one real end and one absent end is not a meaningful range, and both
    // faces now select nothing rather than everything.
    await bothFaces(nulled, NULLED_ROWS, { name: { $between: [null, 'z'] } }, []);
    await bothFaces(nulled, NULLED_ROWS, { name: { $between: ['a', null] } }, []);
    await bothFaces(missing, MISSING_ROWS, { name: { $between: [null, 'z'] } }, []);
    await bothFaces(missing, MISSING_ROWS, { name: { $between: ['a', null] } }, []);
  });

  it('a null bound over a NUMERIC column does not match the zero row', async () => {
    // `0 >= null` is `true` — null coerces to 0 — so the numeric column is
    // where a comparison-only repair silently keeps the defect.
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [null, null] } }, ['3']);
  });
});

describe('[#13549] a null VALUE is not inside a well-formed bounded range', () => {
  it("the card's cell: a bounded `$between` excludes the null-valued row", async () => {
    // Was `['1','2','4']` on the matcher against `['1','2']` live.
    await bothFaces(sweep, SWEEP_ROWS, { v: { $between: ['2026-07-01', '2026-07-15'] } }, ['1', '2']);
  });

  it('the two readings of "no value" now agree with EACH OTHER', async () => {
    // The matcher used to disagree with itself here: the null-valued row
    // matched the range while the same absence spelled as a missing key did
    // not, because only the second met the pre-switch guard.
    const bounded = { v: { $between: ['2026-07-01', '2026-07-28'] } };
    const withNullValue = matcherIds([{ id: 'x', v: null }], bounded);
    const withMissingKey = matcherIds([{ id: 'x' }], bounded);
    expect(withNullValue).toEqual(withMissingKey);
    expect(withNullValue).toEqual([]);
  });

  it('THE NUMERIC CELL — the one a comparison-only repair leaves broken', async () => {
    // Rewriting the arm as `!(value >= min && value <= max)` repairs every
    // string cell in all three cards and NOT this one: `null` coerces to `0`,
    // so `null >= -1 && null <= 1` is true and the null-valued row stays
    // inside the range. Comparability is decided before the comparison, and
    // this cell is what holds that to the code.
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [-1, 1] } }, ['2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [0, 10] } }, ['1', '2']);
  });
});

describe('[#13494/#13495/#13549] the ordinary vocabulary is untouched', () => {
  it('a well-formed range over valued rows still selects the range', async () => {
    await bothFaces(sweep, SWEEP_ROWS, { v: { $between: ['2026-07-01', '2026-07-28'] } }, ['1', '2', '3']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [1, 9] } }, ['1']);
  });

  it('a range that excludes every valued row still selects nothing', async () => {
    await bothFaces(sweep, SWEEP_ROWS, { v: { $between: ['2026-09-01', '2026-09-30'] } }, []);
  });

  it('the range boundaries stay CLOSED on both ends', async () => {
    // `$between` is `$gte min` AND `$lte max` — what the live path compiles it
    // to. An off-by-one in the repair would show up here first.
    await bothFaces(sweep, SWEEP_ROWS, { v: { $between: ['2026-07-01', '2026-07-01'] } }, ['1']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [5, 5] } }, ['1']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [0, 0] } }, ['2']);
  });

  it('`$null` and `$exists` are unmoved on both readings', async () => {
    await bothFaces(missing, MISSING_ROWS, { name: { $null: true } }, ['3']);
    await bothFaces(nulled, NULLED_ROWS, { name: { $null: true } }, ['3']);
    await bothFaces(missing, MISSING_ROWS, { name: { $exists: true } }, ['1']);
    await bothFaces(nulled, NULLED_ROWS, { name: { $exists: true } }, ['1']);
  });
});

describe('[#13553] a no-value row is not inside `$gt` / `$gte` / `$lt` / `$lte`', () => {
  it("the card's table, cell for cell, on the NUMERIC fixture", async () => {
    // Was `['1','2','3']` / `['2','3']` on the matcher against `['1','2']` /
    // `['2']` live. Row 3 (`n: null`) was answered greater than -1 AND less
    // than 1 at the same time, because `null` coerces to `0`.
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gte: -1 } }, ['1', '2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gt: -1 } }, ['1', '2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $lte: 1 } }, ['2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $lt: 1 } }, ['2']);
  });

  it('THE DISCRIMINATOR — the row storing `0` stays IN, on every arm', async () => {
    // `{id: '2', n: 0}` is what stops this pin going vacuous. A "repair" that
    // excluded everything FALSY — the shape a reader reaches for once told
    // that `null` coerces to `0` — would drop this row too and still turn the
    // four cells above green, because they happen not to distinguish them.
    // Here they do: the no-value row leaves and the zero row stays.
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gte: 0 } }, ['1', '2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $lte: 0 } }, ['2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gte: -0.5 } }, ['1', '2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $lt: 0.5 } }, ['2']);
  });

  it('the two readings of "no value" agree with EACH OTHER on all four arms', async () => {
    // The matcher used to disagree with itself: a stored `null` reached the
    // arm and was compared, while the same absence spelled as a MISSING key
    // met the pre-switch guard and was excluded. Both readings now land on the
    // one answer the ruling gives — EXCLUDE.
    for (const op of ['$gt', '$gte', '$lt', '$lte'] as const) {
      const bounded = { n: { [op]: 0 } };
      const withNullValue = matcherIds([{ id: 'x', n: null }], bounded);
      const withMissingKey = matcherIds([{ id: 'x' }], bounded);
      expect({ op, ids: withNullValue }).toEqual({ op, ids: withMissingKey });
      expect({ op, ids: withNullValue }).toEqual({ op, ids: [] });
    }
  });

  it('⭐ `$between` and its own two bounds now answer ONE row the same way', async () => {
    // The reason this card exists. The live path compiles `$between` INTO
    // `$gte` + `$lte`, so these two filters are one predicate to it. Between
    // #13549 landing and this repair, THIS face answered them differently on
    // row 3 — `$between` excluded the null-valued row while `$gte`/`$lte`
    // admitted it. One face, two answers, one query.
    for (const [min, max] of [[-1, 1], [0, 10], [-5, 5]] as const) {
      const viaBetween = matcherIds(NUMERIC_ROWS, { n: { $between: [min, max] } });
      const viaBounds = matcherIds(NUMERIC_ROWS, { n: { $gte: min, $lte: max } });
      expect({ min, max, ids: viaBetween }).toEqual({ min, max, ids: viaBounds });
    }
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gte: -1, $lte: 1 } }, ['2']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [-1, 1] } }, ['2']);
  });

  it('the VALUED rows keep every answer they had — the repair moved no-value cells only', async () => {
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gt: 0 } }, ['1']);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gt: 5 } }, []);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $lt: 0 } }, []);
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $gte: 5 } }, ['1']);
  });

  it('the STRING fixture is unmoved — it agreed before, and still does', async () => {
    // These four cells are why three cards passed over the defect: on strings
    // the comparison against a null is false in both directions already. They
    // are asserted so the repair is measured NOT to have moved them.
    await bothFaces(sweep, SWEEP_ROWS, { v: { $gte: '2026-07-01' } }, ['1', '2', '3']);
    await bothFaces(sweep, SWEEP_ROWS, { v: { $gt: '2026-07-01' } }, ['2', '3']);
    await bothFaces(sweep, SWEEP_ROWS, { v: { $lte: '2026-07-15' } }, ['1', '2']);
    await bothFaces(sweep, SWEEP_ROWS, { v: { $lt: '2026-07-15' } }, ['1']);
  });

  it('⛔ `$between` is NOT in the ordering set — its degenerate cell is unmoved', async () => {
    // `$between` decides the no-value case itself, and its answer is the
    // OPPOSITE one: the range whose both ends are no value selects the
    // no-value rows (#13495). Adding `$between` to the guarded set would
    // return false before `valueWithinRange` ran and silently move this cell.
    await bothFaces(numeric, NUMERIC_ROWS, { n: { $between: [null, null] } }, ['3']);
    await bothFaces(nulled, NULLED_ROWS, { name: { $between: [null, null] } }, ['3']);
  });
});
