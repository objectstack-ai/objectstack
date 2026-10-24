/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8513 — `ValueDataSource`'s OBJECT dialect answers grouped filters
 * the way the platform already answers them, measured against the PUBLISHED
 * standard rather than against a hand-written restatement of it.
 *
 * ## Why the spec's own table, and not a local fixture
 *
 * `FILTER_LOGIC_CASES` (`@objectstack/spec/data`) is the cross-backend
 * conformance table for the combinator family: a four-row fixture whose
 * `(a, b)` columns are a 2x2 truth table — so a wrongly-OR-ed pair of
 * predicates shows up as extra ids rather than passing by luck of the data —
 * plus a nullable `d` column, plus 29 cases each naming the ids it must match.
 * The five platform drivers are held to it. Writing a local fixture instead
 * would be this adapter hand-mirroring what upstream publishes, which is the
 * exact shape objectui#8600 filed against this same file for the text
 * operators. The table is the standard; this file just drives it.
 *
 * It also settles the empty-combinator identities without restating them.
 * objectstack#5322 (closed `completed`, merged as objectstack#5365) ruled
 * `{ $and: [] }` TRUE / every row and `{ $or: [] }` FALSE / no row, and the
 * table carries all four identity cases. An assertion written here from the
 * card's prose could drift from that ruling; a table-driven one cannot.
 *
 * ## The `$not` partition is PINNED, not skipped
 *
 * `$not` is out of scope for #8513 — this repo's `convertFiltersToAST` still
 * throws for it, on a narrowing about the AST rather than about upstream's
 * ruling, and whether that narrowing should stand is a separate question. So
 * the `$not`-bearing cases are not silently filtered out of the run: the
 * partition itself is asserted, by NAME and by SIZE, and the excluded cases are
 * asserted to fail in the REFUSAL direction (no rows, one logged reason). Three
 * things therefore break this file rather than passing quietly:
 *
 *   - implementing `$not` (the excluded cases start passing → move them);
 *   - a new `$not` case landing upstream (the named partition no longer
 *     matches → decide about it deliberately);
 *   - `$not` regressing to its pre-objectui#8447 fail-OPEN behaviour, where it
 *     matched EVERY row (the refusal assertions go red).
 *
 * `@objectstack/spec` 17.5.0 added a second partition of the same kind: the
 * STAGED `$empty` flag (objectstack#20444), enrolled in the table while the spec
 * kept it out of `FILTER_OPERATORS` and said the executors refuse it until each
 * face has its arm. It was pinned the same way — by name, by direction, and with
 * an expiry row that reddens when the staging ends (objectui#11073).
 *
 * That row reddened on `@objectstack/spec` 17.6.0, which admitted `$empty` to
 * `FILTER_OPERATORS` (objectstack#20446). This face owed its arm, and has it
 * (objectui#11094), so the partition moved back into the executed table as the
 * expiry row instructed. The by-name pin stays, now over the executed `$empty`
 * cases, so a new `$empty` case landing upstream is still a decision.
 *
 * That last one is why this file asserts the refusal instead of `it.skip`:
 * `$not` failed in the OPPOSITE direction from `$and` / `$or` before #8447, and
 * a fix that flattened the three combinators into one arm is the specific
 * regression objectui#8513 was told not to allow.
 *
 * ## Ablation (run, not reasoned about)
 *
 * Recorded here because this file is the one that would go quiet if the fix
 * were reverted. Both legs were rebuilt to `dist/` and re-run; see the PR body
 * for the on-disk proof.
 *
 * | ablation | conformance cases passing |
 * |---|---|
 * | `matchesFilter` restored to its pre-#8513 bytes (combinators refused) | 10 / 29 |
 * | this change | 27 / 29 |
 *
 * The 17 cases that move are not only the two identity ones: every case whose
 * filter carries a group at all — including the three `read scope:` shapes,
 * which are the ones a sharing rule actually looks like — answered ZERO ROWS
 * before. The 10 that passed without the fix are the ungrouped operator cases,
 * plus `{ $or: [] }` and `{ $not: {} }`, which expect no rows and so were
 * satisfied by the refusal for the wrong reason.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { FILTER_LOGIC_CASES, FILTER_LOGIC_ROWS, FILTER_OPERATORS } from '@objectstack/spec/data';
import { ValueDataSource } from '../ValueDataSource';
import { toFilterNode } from '../../utils/filter-converter';

/** Cases whose filter mentions `$not` anywhere — the out-of-scope partition. */
const carriesNot = (filter: unknown): boolean => JSON.stringify(filter).includes('"$not"');

/**
 * Cases whose filter mentions the `$empty` flag (objectstack#20444).
 * `@objectstack/spec` 17.5.0 enrolled them in this table while keeping the flag
 * OUT of `FILTER_OPERATORS`, and this matcher refused them as staged
 * (objectui#11073). 17.6.0 admitted the flag (objectstack#20446) and this
 * matcher executes it (objectui#11094), so they are now a SUBSET of the
 * executed cases, named below so that the subset is a decision rather than an
 * accident. A `$not` over `$empty` stays in the `$not` partition: the outer
 * refusal is the one this matcher gives.
 */
const carriesEmpty = (filter: unknown): boolean => JSON.stringify(filter).includes('"$empty"');

const NOT_CASES = FILTER_LOGIC_CASES.filter((c) => carriesNot(c.filter));
const EXECUTED_CASES = FILTER_LOGIC_CASES.filter((c) => !carriesNot(c.filter));
const EMPTY_CASES = EXECUTED_CASES.filter((c) => carriesEmpty(c.filter));

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: FILTER_LOGIC_ROWS as any[] });
  const result = await ds.find('rows', { $filter: filter as any });
  return result.data.map((r) => r.id as string);
}

function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 0. The harness itself has to be able to fail
// ---------------------------------------------------------------------------

describe('objectui#8513 — the conformance harness discriminates', () => {
  it('the table is present, non-trivial, and split into two non-empty parts', () => {
    // A table that failed to import would make every `it.each` below vacuous.
    expect(FILTER_LOGIC_CASES.length).toBeGreaterThan(20);
    expect(FILTER_LOGIC_ROWS.length).toBe(4);
    expect(EXECUTED_CASES.length).toBeGreaterThan(0);
    expect(NOT_CASES.length).toBeGreaterThan(0);
    expect(EXECUTED_CASES.length + NOT_CASES.length).toBe(FILTER_LOGIC_CASES.length);
    // …and the executed part really carries the `$empty` cases, so the run
    // below exercises that arm rather than passing around it.
    expect(EMPTY_CASES.length).toBeGreaterThan(0);
  });

  it('the fixture discriminates: no expectation is the whole table AND none is empty', () => {
    // The two wrong implementations this file must catch are "matches
    // everything" and "matches nothing". Each is the right answer for SOME
    // case in the table, so the guarantee is that neither is right for all.
    const allIds = FILTER_LOGIC_ROWS.map((r) => r.id);
    const expectations = EXECUTED_CASES.map((c) => JSON.stringify(c.expected));
    expect(expectations.some((e) => e !== JSON.stringify(allIds))).toBe(true);
    expect(expectations.some((e) => e !== '[]')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1. The standard, driven
// ---------------------------------------------------------------------------

describe('objectui#8513 — FILTER_LOGIC_CASES through the real ValueDataSource', () => {
  it.each(EXECUTED_CASES.map((c) => [c.name, c] as const))(
    '%s',
    async (_name, testCase) => {
      const warn = spyWarn();
      expect(await selectedIds(testCase.filter)).toEqual(testCase.expected);
      // A case the matcher EXECUTES must not also be logging a refusal: a
      // partially-refused group that happens to land on the right rows is not
      // conformance, and this is the half that catches it.
      expect(warn).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// 2. The out-of-scope partition, pinned by name and by direction
// ---------------------------------------------------------------------------

describe('objectui#8513 — `$not` is out of scope, and stays refused', () => {
  it('the excluded partition is exactly these cases', () => {
    // By NAME, so a new `$not` case landing upstream is a decision rather than
    // a silent widening of the exclusion list.
    // The two `$empty` rows arrived with `@objectstack/spec` 17.5.0 and were
    // added here by decision (objectui#11073): the outer `$not` is what this
    // matcher refuses, whatever it negates.
    expect(NOT_CASES.map((c) => c.name).sort()).toEqual(
      [
        '$not ANDs with its sibling keys inside a branch',
        '$not of {} is FALSE — NOT TRUE',
        '$not returns the rows with no value',
        '$not over $empty true returns the valued rows',
        '$not over $empty false returns the no-value rows',
      ].sort(),
    );
  });

  it.each(NOT_CASES.map((c) => [c.name, c] as const))(
    'refused, not answered: %s',
    async (_name, testCase) => {
      const warn = spyWarn();
      // No rows AND a logged reason. `$not` matched EVERY row before
      // objectui#8447; the row assertion alone would not see that regression
      // come back on the `{ $not: {} }` case, whose ruled answer is also none.
      expect(await selectedIds(testCase.filter)).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('$not');
    },
  );

  it('one of the excluded cases would be WRONG if `$not` were silently ignored', () => {
    // The direction that makes the partition honest: four of the five name a
    // non-empty row set (two of three before the 17.5.0 `$empty` rows), so
    // "refused" is a visibly different answer from "executed", not a coincidence.
    const nonEmpty = NOT_CASES.filter((c) => c.expected.length > 0);
    expect(nonEmpty.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 2b. The `$empty` cases — staged until 17.6.0, executed since (objectui#11094)
// ---------------------------------------------------------------------------

describe('objectui#11094 — the `$empty` flag is executed now that the spec admits it', () => {
  it('the staging is over upstream — `$empty` is in FILTER_OPERATORS', () => {
    // The expiry row objectui#11073 left here, flipped. It read "not in" and
    // reddened on `@objectstack/spec` 17.6.0 (objectstack#20446), which is the
    // day this face owed its arm; the partition it guarded moved into the
    // executed table above. Lit control: a flag operator that was always in.
    expect(FILTER_OPERATORS as readonly string[]).toContain('$empty');
    expect(FILTER_OPERATORS as readonly string[]).toContain('$null');
  });

  it('the formerly staged partition is exactly these cases, and every one is executed', () => {
    // By NAME, so another `$empty` case landing upstream is a decision. They
    // run in §1 with the rest of the executed table: the expected row set, and
    // no logged refusal.
    expect(EMPTY_CASES.map((c) => c.name).sort()).toEqual(
      [
        '$empty true selects exactly the no-value rows',
        '$empty false selects exactly the valued rows',
        '$empty inside a $or branch OR-s with its sibling branch',
        '$empty inside a $and ANDs with its sibling',
        '$empty ANDs with a sibling operator on the same field',
      ].sort(),
    );
    for (const testCase of EMPTY_CASES) expect(EXECUTED_CASES).toContain(testCase);
  });
});

// ---------------------------------------------------------------------------
// 3. The path that actually reaches this matcher
// ---------------------------------------------------------------------------

/**
 * How an object-dialect combinator gets to `ValueDataSource` at all.
 *
 * The card assumed the producer was `filterGroupToMongo`
 * (`packages/fields/.../FilterConditionField.tsx`). It is not: that widget's
 * value is stored criteria the SERVER's sharing evaluator spreads into
 * `engine.find`, and it never passes through this adapter.
 *
 * The producer that does reach here is this repo's own single filter sink.
 * `convertFiltersToAST` returned the ORIGINAL OBJECT when a filter lowered to
 * no conditions, and the identity groups were exactly that case — so
 * `toFilterNode` handed `{ $and: [] }` and `{ $or: [{}] }` back UNLOWERED, and
 * every consumer on that chain (`ObjectGrid`'s `schemaFilter`, `plugin-list`'s
 * `buildEffectiveFilter`, `plugin-view`'s `ObjectView`) dropped them straight
 * onto `$filter`. Before this change the matcher answered ZERO ROWS for both,
 * on filters whose ruled answer is EVERY row — the worst direction, on the
 * reachable path.
 *
 * ⚠️ The PRODUCER half moved afterwards: objectui#8770 made `convertFiltersToAST`
 * answer `undefined` — "no constraint" — for a filter that is nothing but
 * TRUE-identity combinators, so this matcher is no longer handed those objects
 * BY THAT CHAIN. The matcher's own answer is asserted below all the same, and
 * deliberately from the object literals rather than through `toFilterNode`: it
 * is a `DataSource` with a public `find`, the object dialect is what
 * `QuerySchema.where` declares, and #8513's ruling is about what this adapter
 * answers — not about which producer happens to call it this month.
 */
describe('objectui#8513 — this matcher answers the object dialect directly', () => {
  it('the lowering chain no longer hands the identities down in that dialect', () => {
    // objectui#8770: the producer stopped re-emitting the caller's object for a
    // filter it read as "no constraint". Pinned here because the paragraph
    // above rests on it, and a silent revert would put an object back on
    // `$filter` where the wire refuses it.
    expect(toFilterNode({ $and: [] })).toBeUndefined();
    expect(toFilterNode({ $or: [{}] })).toBeUndefined();
  });

  it('and the matcher answers the objects themselves the way the ruling says', async () => {
    const allIds = FILTER_LOGIC_ROWS.map((r) => r.id);
    expect(await selectedIds({ $and: [] })).toEqual(allIds);
    expect(await selectedIds({ $or: [{}] })).toEqual(allIds);
  });

  it('a group that DOES lower still goes down the AST arm, unchanged', async () => {
    // The sibling arm must keep answering the same question, or the fix has
    // moved the dialects apart instead of together.
    const lowered = toFilterNode({ $or: [{ a: 'x' }, { b: 'y' }] });
    expect(Array.isArray(lowered)).toBe(true);
    expect(await selectedIds(lowered)).toEqual(['1', '2', '3']);
  });

  it('`falseIdentityLeaf`\'s documented contract still holds', async () => {
    // `filter-converter.ts` emits `['$or', '=', []]` for `{ $or: [] }` and its
    // doc justifies that spelling partly ON this matcher's answer to it. That
    // is a written cross-file contract, so it is pinned here rather than left
    // to be discovered when it breaks.
    expect(toFilterNode({ $or: [] })).toEqual(['$or', '=', []]);
    expect(await selectedIds(['$or', '=', []])).toEqual([]);
  });
});
