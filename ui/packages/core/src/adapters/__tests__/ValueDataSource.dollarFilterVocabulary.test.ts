/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8447 — the OBJECT (`$`-dialect) matcher executes the operators the
 * spec declares, and refuses the rest instead of waving them through.
 *
 * ## The defect these cases have to be able to see
 *
 * `find()` picks its matcher on nothing but the SHAPE of `$filter` — two arms
 * of one `if`. The array arm (`matchesASTFilter`) refuses an unknown node,
 * excludes the row and logs; the object arm (`matchesFilter`) ended its switch
 * with `default: break`, which adds NO constraint, so an unrecognised operator
 * selected EVERY row in silence. Same file, opposite defaults, and nothing
 * tells an author which dialect their filter took.
 *
 * ## Why every case is a non-empty PROPER subset
 *
 * Two wrong implementations have to fail here, not one:
 *
 * 1. **the bug** — no constraint, so the answer is the full set;
 * 2. **the caricature** — a matcher that answers `false` for everything, so the
 *    answer is the empty set. It is strictly WORSE than the bug and it passes
 *    every assertion whose expected value is `[]`.
 *
 * A row-set equality against a non-empty proper subset of `ROW_IDS` is red for
 * both. The refusal cases below, whose expected row set IS empty, therefore
 * carry the `console.warn` assertion as the half that discriminates: the
 * caricature refuses nothing, so it logs nothing.
 *
 * Both were RUN, not reasoned about, and both were RE-RUN after the contract
 * review flipped `$exists` from refused to executed — the survivor list is not
 * carried forward across that edit, because the edit changes the shape of one
 * of the assertions in it:
 *
 * | ablation | red | green | of |
 * |---|---|---|---|
 * | the bug — `ValueDataSource.ts` restored to its pre-card bytes | 38 | 24 | 62 |
 * | the caricature — `matchesFilter` returns `false` unconditionally | 54 | 8 | 62 |
 *
 * ⚠️ The two counts above are objectui#8447's run against objectui#8447's file,
 * and the denominator has since moved: objectui#8513 rewrote §4 when it made
 * `$and` / `$or` EXECUTE, so this file now holds 66 cases rather than 62. The
 * table is kept as the record of that run — it is what justified the shape of
 * §1-§3 and §5, which #8513 did not touch — and it is ⛔ NOT re-derived here,
 * because re-running an old card's ablation against a new file would replace a
 * true historical measurement with a number that describes neither card. #8513
 * ablated its own change instead; that run is recorded in
 * `ValueDataSource.filterLogicConformance-8513.test.ts`.
 *
 * The eight survivors of the caricature are named rather than counted, because
 * which ones survive is the finding: the two `{}` cases and the AST-group case
 * never reach `matchesFilter` at all, the `FILTER_OPERATORS` parity guard reads
 * no rows, and the remaining FOUR are the card's own `$nin` / `$startsWith` /
 * `$null` / `$exists` examples — the quotable ones, and they cannot tell this
 * fix from an empty result set. They are kept in §5 and labelled as a scope
 * declaration.
 *
 * ⚠️ **The one mover across the flip**, measured rather than predicted:
 * `$exists false selects neither row` was RED under the caricature before the
 * flip and is GREEN after it. Nothing else moved — the red count is 54 in both
 * runs. It discriminated only because it asserted the refusal was LOGGED, and
 * executing the operator removed the log. §5 therefore has no case left that
 * tells the fix from the caricature EXCEPT its last one, which asserts the
 * complement of all four and is four non-empty answers.
 *
 * Assertions name ROWS (`['a','c']`), never a container shape (objectui#8495).
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { runInNewContext } from 'node:vm';
import { FILTER_OPERATORS } from '@objectstack/spec/data';
import { ValueDataSource } from '../ValueDataSource';
import { toFilterNodeSafely } from '../../utils/filter-converter';

/**
 * Three rows: two share a `role`, the ages straddle every bound used below, and
 * `nickname` is present / null / absent so the null-ness arms discriminate.
 */
const ROWS = [
  { id: 'a', role: 'admin', age: 30, nickname: 'ace' },
  { id: 'b', role: 'user', age: 25, nickname: null },
  { id: 'c', role: 'admin', age: 20 },
];

/** What the BUG answers for every case below. No expectation may equal it. */
const ROW_IDS = ['a', 'b', 'c'];

async function selectedIds(
  filter: unknown,
  rows: Array<Record<string, unknown>> = ROWS,
): Promise<string[]> {
  const ds = new ValueDataSource({ items: rows });
  const result = await ds.find('rows', { $filter: filter as any });
  return result.data.map((r) => r.id as string);
}

/** Spy that returns the calls, so a case can assert BOTH the rows and the log. */
function spyWarn() {
  return vi.spyOn(console, 'warn').mockImplementation(() => {});
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 0. Live controls — the harness itself discriminates
// ---------------------------------------------------------------------------

describe('objectui#8447 — live controls', () => {
  it('the plain-equality arm, which was correct all along, still selects', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: 'admin' })).toEqual(['a', 'c']);
    expect(await selectedIds({ age: 25 })).toEqual(['b']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a genuinely matching row still comes back', async () => {
    expect(await selectedIds({ id: 'b' })).toEqual(['b']);
  });

  it('the broken answer is the full set, so every case below discriminates', async () => {
    expect(await selectedIds({})).toEqual(ROW_IDS);
  });
});

// ---------------------------------------------------------------------------
// 1. Every declared operator this matcher executes
// ---------------------------------------------------------------------------

/**
 * One case per EXECUTED member of the spec's `FILTER_OPERATORS`, each paired
 * with the AST spelling of the same question. Both halves matter:
 *
 *   - the row set proves the operator constrains (vs. the bug) and selects
 *     something (vs. the caricature);
 *   - the AST twin proves the two arms of `find()`'s `if` now answer the same
 *     question, which is this card's objective rather than "add the missing
 *     arms" — adding arms alone leaves the next unrecognised spelling on the
 *     permissive side.
 */
const EXECUTED_CASES: Record<
  string,
  { filter: Record<string, unknown>; ast: unknown[]; expected: string[] }
> = {
  $eq: { filter: { role: { $eq: 'admin' } }, ast: ['role', '=', 'admin'], expected: ['a', 'c'] },
  $ne: { filter: { role: { $ne: 'admin' } }, ast: ['role', '!=', 'admin'], expected: ['b'] },
  $gt: { filter: { age: { $gt: 24 } }, ast: ['age', '>', 24], expected: ['a', 'b'] },
  $gte: { filter: { age: { $gte: 25 } }, ast: ['age', '>=', 25], expected: ['a', 'b'] },
  $lt: { filter: { age: { $lt: 25 } }, ast: ['age', '<', 25], expected: ['c'] },
  $lte: { filter: { age: { $lte: 25 } }, ast: ['age', '<=', 25], expected: ['b', 'c'] },
  $in: { filter: { role: { $in: ['admin'] } }, ast: ['role', 'in', ['admin']], expected: ['a', 'c'] },
  $nin: { filter: { role: { $nin: ['admin'] } }, ast: ['role', 'nin', ['admin']], expected: ['b'] },
  $between: {
    filter: { age: { $between: [24, 31] } },
    ast: ['age', 'between', [24, 31]],
    expected: ['a', 'b'],
  },
  $contains: {
    filter: { role: { $contains: 'dmi' } },
    ast: ['role', 'contains', 'dmi'],
    expected: ['a', 'c'],
  },
  $icontains: {
    filter: { role: { $icontains: 'ADMI' } },
    ast: ['role', 'icontains', 'ADMI'],
    expected: ['a', 'c'],
  },
  $notContains: {
    filter: { role: { $notContains: 'dmi' } },
    ast: ['role', 'not_contains', 'dmi'],
    expected: ['b'],
  },
  $startsWith: {
    filter: { role: { $startsWith: 'adm' } },
    ast: ['role', 'starts_with', 'adm'],
    expected: ['a', 'c'],
  },
  $endsWith: {
    filter: { role: { $endsWith: 'min' } },
    ast: ['role', 'ends_with', 'min'],
    expected: ['a', 'c'],
  },
  // `$null` takes its direction from the VALUE, not from the operator name —
  // the lowering `convertFiltersToAST` performs. Both directions are cases.
  $null: {
    filter: { nickname: { $null: true } },
    ast: ['nickname', 'is_null'],
    expected: ['b', 'c'],
  },
  // The exact INVERSE of `$null`, and the platform's own reading of it:
  // `convertFiltersToAST` lowers `$exists: true` to `is_not_null` three lines
  // below where it lowers `$null: true` to `is_null`.
  $exists: {
    filter: { nickname: { $exists: true } },
    ast: ['nickname', 'is_not_null'],
    expected: ['a'],
  },
  // objectui#11094 — admitted to `FILTER_OPERATORS` by `@objectstack/spec`
  // 17.6.0, which lowers `is_empty` to it. On these rows (no `''`, no `[]`)
  // it selects what `$null: true` selects; the case that tells them apart is
  // below, and the per-type cases are in `ValueDataSource.astFilterVocabulary`.
  $empty: {
    filter: { nickname: { $empty: true } },
    ast: ['nickname', 'is_empty'],
    expected: ['b', 'c'],
  },
};

/**
 * EMPTY, and that is the point of the parity guard below rather than an
 * accident: every operator the spec DECLARES is executed, so the guard covers
 * the whole published vocabulary instead of a subset of it. An operator parked
 * here would be a hole the guard could not see into.
 */
const REFUSED_OPERATORS: string[] = [];

describe('objectui#8447 — every executed operator constrains', () => {
  it.each(Object.entries(EXECUTED_CASES))(
    '`%s` selects the rows it names rather than every row',
    async (_op, { filter, expected }) => {
      const warn = spyWarn();
      const ids = await selectedIds(filter);
      expect(ids).toEqual(expected);
      // Executed, not refused. The row-set assertion already fails on a
      // refusal; this names WHICH failure it is.
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('`$null: false` is the other direction of the same operator', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ nickname: { $null: false } })).toEqual(['a']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('`$exists: false` is the other direction of ITS operator', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ nickname: { $exists: false } })).toEqual(['b', 'c']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('`$empty: false` is the other direction of ITS operator', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ nickname: { $empty: false } })).toEqual(['a']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('`$empty` is not `$null`: `\'\'` and `[]` are empty, not values (objectui#11094)', async () => {
    // The row set that separates the two operators the fixture above cannot.
    const rows = [
      { id: 'a', nickname: 'ace' },
      { id: 'blank', nickname: '' },
      { id: 'list', nickname: [] },
      { id: 'null', nickname: null },
    ];
    expect(await selectedIds({ nickname: { $null: true } }, rows)).toEqual(['null']);
    expect(await selectedIds({ nickname: { $empty: true } }, rows)).toEqual(['blank', 'list', 'null']);
    expect(await selectedIds({ nickname: { $empty: false } }, rows)).toEqual(['a']);
  });

  it.each([['yes'], [1], [0], [null]])(
    '`$empty: %j` — a flag that is not a boolean — is refused, not read for truthiness',
    async (flag) => {
      // `SpecialOperatorSchema` declares the flag `boolean`. Reading `'yes'` as
      // true and `0` as false would answer a filter the spec refuses.
      const warn = spyWarn();
      expect(await selectedIds({ nickname: { $empty: flag } })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('$empty');
    },
  );

  it('`$exists` and `$null` are one predicate read from opposite ends', async () => {
    // Not a restatement of the two cases above: it pins the INVERSION, so an
    // arm that got the boolean the wrong way round fails here even if each
    // spelling looks self-consistent. Both directions, and both against a row
    // set that is a non-empty proper subset either way.
    expect(await selectedIds({ nickname: { $exists: true } }))
      .toEqual(await selectedIds({ nickname: { $null: false } }));
    expect(await selectedIds({ nickname: { $exists: false } }))
      .toEqual(await selectedIds({ nickname: { $null: true } }));
    // …and they are NOT the same set as each other, which is what makes the
    // two assertions above worth anything.
    expect(await selectedIds({ nickname: { $exists: true } }))
      .not.toEqual(await selectedIds({ nickname: { $exists: false } }));
  });

  it.each(Object.entries(EXECUTED_CASES))(
    '`%s` answers the same rows as its AST twin — the two arms of find() agree',
    async (_op, { filter, ast, expected }) => {
      expect(await selectedIds(filter)).toEqual(await selectedIds(ast));
      // Pinned to the literal set as well, so the case cannot pass by both
      // arms being wrong in the same direction.
      expect(await selectedIds(ast)).toEqual(expected);
    },
  );

  it('the case table covers FILTER_OPERATORS exactly — none drops out unnoticed', () => {
    // A parity guard against spec drift: when a release adds a `$` operator,
    // this goes red instead of the new operator reaching the refusal arm
    // unannounced — or, before this card, selecting every row.
    expect([...FILTER_OPERATORS].sort()).toEqual(
      [...Object.keys(EXECUTED_CASES), ...REFUSED_OPERATORS].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Composition — several operators, several fields
// ---------------------------------------------------------------------------

describe('objectui#8447 — operators compose without losing a constraint', () => {
  it('two operators on ONE field are ANDed', async () => {
    expect(await selectedIds({ age: { $gte: 21, $lte: 29 } })).toEqual(['b']);
  });

  it('an executed operator beside an unexecutable one refuses the whole row', async () => {
    // The failure direction that matters: dropping the unreadable half would
    // WIDEN the answer to `['a','b']`, which is the defect one level down.
    const warn = spyWarn();
    expect(await selectedIds({ age: { $gte: 21, $zzz: 1 } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('two fields are ANDed, mixing the equality arm and the operator arm', async () => {
    expect(await selectedIds({ role: 'admin', age: { $gt: 24 } })).toEqual(['a']);
  });
});

// ---------------------------------------------------------------------------
// 3. Refusal — the arm that used to be `default: break`
// ---------------------------------------------------------------------------

describe('objectui#8447 — what the matcher cannot execute, it refuses', () => {
  it('an unknown operator excludes every row and logs ONCE for the whole find()', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: { $zzz: 'admin' } })).toEqual([]);
    // One line for three rows: refusals are collected per `find()`, not per row.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('$zzz');
  });

  it.each(['$like', '$ilike'])(
    '`%s` — declared by the schema but staged OUT of FILTER_OPERATORS — refuses',
    async (op) => {
      const warn = spyWarn();
      expect(await selectedIds({ role: { [op]: 'adm%' } })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain(op);
    },
  );

  it('`$regex` refuses with the retired-operator prescription, verbatim', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: { $regex: 'adm.n' } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('$regex');
    // The spec's own table is what six faces now print, rather than six sentences.
    expect(message).toContain('$icontains');
  });

  it('`$options`, the retired regex-flags companion, refuses too', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: { $options: 'i' } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(['$startswith', '$notcontains', '$notin'])(
    'the lowercase alias `%s` is refused, not silently accepted',
    async (op) => {
      // Contract-first (AGENTS.md #0.1): the canonical `$` spellings are
      // camelCase. Growing an alias arm here would fossilise a second dialect
      // in the renderer; refusing is loud and points the author at the spec.
      const warn = spyWarn();
      expect(await selectedIds({ role: { [op]: 'adm' } })).toEqual([]);
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );

  it('`$ncontains`, the off-spec spelling one widget used to emit, refuses', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ role: { $ncontains: 'dmi' } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a nested relation constraint is refused by NAME rather than ignored', async () => {
    // `{ profile: { verified: true } }` and an operator object are the same
    // SHAPE — the spec says so, which is why `FilterConditionSchema` cannot
    // narrow to a closed vocabulary. This matcher does not descend into
    // relations, so it says which key it could not read.
    const warn = spyWarn();
    expect(await selectedIds({ profile: { verified: true } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('verified');
  });

  it('an empty filter still means "no filter"', async () => {
    const warn = spyWarn();
    expect(await selectedIds({})).toEqual(ROW_IDS);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. Combinators — `$and` / `$or` executed, `$not` still refused (objectui#8513)
// ---------------------------------------------------------------------------

/**
 * objectui#8513 moved TWO of these three and deliberately left the third.
 *
 * The heading is one word — "combinators" — over three different behaviours,
 * which is why this block asserts each separately rather than looping. Before
 * objectui#8447 they failed in OPPOSITE directions: `$and` / `$or` carry an
 * array, fell to the simple-equality branch and excluded EVERY row; `$not`
 * carries an object, entered the operator branch and matched every row. #8447
 * made all three loud refusals. #8513 executes the first two — their semantics
 * were ruled upstream (objectstack#5322, merged as objectstack#5365) — and
 * leaves `$not` refused, because this repo's own `convertFiltersToAST` still
 * throws for it on an AST-shaped narrowing that #8513 does not decide.
 *
 * The row sets below are non-empty PROPER subsets wherever the semantics allow
 * one, for the reason in this file's header: an expectation of `[]` is also
 * what the caricature answers.
 */
describe('objectui#8513 — `$and` / `$or` execute; `$not` stays refused', () => {
  it('`$or` selects the union of its branches, and says nothing', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ $or: [{ role: 'user' }, { age: 30 }] })).toEqual(['a', 'b']);
    // A group that EXECUTES is not a refusal, so nothing is logged. This is the
    // half that fails if the arm is added but still routed through
    // `refuseFilterNode`.
    expect(warn).not.toHaveBeenCalled();
  });

  it('`$and` selects the intersection of its branches, and says nothing', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ $and: [{ role: 'admin' }, { age: { $gt: 25 } }] })).toEqual(['a']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a group ANDs with its sibling keys, in either key order', async () => {
    // `{ status, $or }` is "status AND the group" — the group is one ENTRY of
    // the condition object, not a replacement for it. Both orders, because a
    // loop that `return`ed on the group would pass only one of them.
    expect(await selectedIds({ role: 'admin', $or: [{ age: 30 }, { age: 25 }] })).toEqual(['a']);
    expect(await selectedIds({ $or: [{ age: 30 }, { age: 25 }], role: 'admin' })).toEqual(['a']);
  });

  it('groups nest, and a nested group is evaluated by the same recursion', async () => {
    expect(
      await selectedIds({ $and: [{ $or: [{ role: 'user' }, { age: 20 }] }, { age: { $lt: 26 } }] }),
    ).toEqual(['b', 'c']);
  });

  it('`$not` is STILL refused, and its message names it rather than the group arm', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ $not: { role: 'admin' } })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0]?.[0]);
    expect(message).toContain('$not');
    // The three cases must not be flattened into one: the `$not` refusal has to
    // be distinguishable from the generic unknown-`$`-key arm, and it must not
    // claim the AST dialect executes it — `convertFiltersToAST` throws too.
    expect(message).toContain('objectstack#5146');
    expect(message).toContain("['and', 'or']");
  });

  it('an unknown `$` key is refused, and is NOT reported as a combinator', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ $nor: [{ role: 'admin' }] })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('$nor');
  });

  it('a malformed group is refused rather than guessed at', async () => {
    // The spec declares `$and?: FilterCondition[]`. A non-array, and a member
    // that is not a condition object, are both refused — excluded and logged,
    // the direction every other refusal in this file takes.
    const warn = spyWarn();
    expect(await selectedIds({ $and: { role: 'admin' } })).toEqual([]);
    expect(await selectedIds({ $or: ['admin'] })).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('the AST array dialect still executes a group, and agrees with the object one', async () => {
    // The two arms of `find()`'s `if` now answer the same question — the
    // objective objectui#8447 set and the reason this card is not just "add an
    // arm". Same rows, same order, both dialects.
    expect(await selectedIds(['or', ['role', '=', 'user'], ['age', '>', 28]])).toEqual(['a', 'b']);
    expect(await selectedIds({ $or: [{ role: 'user' }, { age: { $gt: 28 } }] })).toEqual(['a', 'b']);
  });
});

// ---------------------------------------------------------------------------
// 5. The card's own measured examples
// ---------------------------------------------------------------------------

/**
 * ⚠️ SCOPE DECLARATION, NOT PROOF.
 *
 * These are the four readings objectui#8447 was filed with, reproduced on the
 * two rows it used. ALL FOUR expect an EMPTY result, so a matcher that answered
 * `false` for everything — strictly worse than the bug — passes every one of
 * them. Before the contract review flipped `$exists` from refused to executed,
 * that fourth case still discriminated, because it asserted the refusal was
 * LOGGED; executing it removed the log and with it the only half of §5 that
 * could tell the fix from the caricature. RE-MEASURED after the flip rather
 * than carried forward — see the ablation table in this file's header.
 *
 * They are kept because they are the card's own words and someone will look for
 * them, not because they measure the fix. The last case in this block is the
 * exception and the reason the block is not purely decorative: it asserts the
 * COMPLEMENT of each of the four, which is four non-empty answers. The
 * discriminating cases are §1-§4.
 */
describe('objectui#8447 — the card’s measured examples (scope declaration)', () => {
  const CARD_ROWS = [
    { id: 'n', score: 5 },
    { id: 's', score: '5' },
  ];

  it('`$nin [5, "5"]` selects neither row', async () => {
    expect(await selectedIds({ score: { $nin: [5, '5'] } }, CARD_ROWS)).toEqual([]);
  });

  it('`$startsWith "zzz"` selects neither row', async () => {
    expect(await selectedIds({ score: { $startsWith: 'zzz' } }, CARD_ROWS)).toEqual([]);
  });

  it('`$null true` selects neither row — both have the key', async () => {
    expect(await selectedIds({ score: { $null: true } }, CARD_ROWS)).toEqual([]);
  });

  it('`$exists false` selects neither row — both have the key', async () => {
    // EXECUTED, not refused (the contract review flipped this one), so it no
    // longer logs — and with the log gone it stopped discriminating against
    // the caricature. Re-measured after the flip rather than assumed; see the
    // ablation table in this file's header.
    const warn = spyWarn();
    expect(await selectedIds({ score: { $exists: false } }, CARD_ROWS)).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('the complements of all four DO select — the fix is not "exclude everything"', async () => {
    // This is the case that carries §5, and the only one here the caricature
    // cannot pass: four non-empty answers, each naming rows.
    expect(await selectedIds({ score: { $in: [5, '5'] } }, CARD_ROWS)).toEqual(['n', 's']);
    expect(await selectedIds({ score: { $startsWith: '5' } }, CARD_ROWS)).toEqual(['s']);
    expect(await selectedIds({ score: { $null: false } }, CARD_ROWS)).toEqual(['n', 's']);
    expect(await selectedIds({ score: { $exists: true } }, CARD_ROWS)).toEqual(['n', 's']);
  });
});

// ---------------------------------------------------------------------------
// A plain-object comparand is refused in the `$` dialect as in the AST dialect
// ---------------------------------------------------------------------------

/**
 * A plain object with no `$` key in comparand position, `{ owner: { $ne:
 * { id: 'u1' } } }`, is the nested relation condition the AST arm refuses by
 * name. Read as a value it compared by reference or as the text
 * `[object Object]`: `$ne`, `$notContains` and `$nin` (a member) answered every
 * row and the orderings answered some rows. The spec's comparand door refuses
 * the same comparand, so this face now refuses it too, with the AST arm's
 * sentence from the one builder the two arms share.
 *
 * `owner` holds text on two rows and null on the third, so a negated operator
 * that reads the object answers all three and an ordering answers `'zeta'`,
 * which sorts past `[object Object]`. The empty set plus the logged sentence is
 * the refusal; for the operators that answered no row before, the sentence is
 * the discriminant.
 */
describe('a plain-object comparand under a `$` operator is refused as the AST arm refuses it', () => {
  const COMPARAND_ROWS = [
    { id: 'a', owner: 'zeta', age: 30, floor: 25 },
    { id: 'b', owner: 'Alpha', age: 25, floor: 25 },
    { id: 'c', owner: null, age: 20, floor: 10 },
  ];
  const NESTED = { id: 'u1' };
  const REFUSAL =
    "filter condition on field 'owner' carries the non-operator key 'id'; "
    + 'the in-memory matcher does not descend into a nested relation constraint';

  /** The declared operators whose slot is a flag rather than a comparand. */
  const FLAG_OPERATORS = new Set(['$null', '$exists', '$empty']);
  const LIST_OPERATORS = new Set(['$in', '$nin', '$between']);
  const COMPARAND_OPERATORS = FILTER_OPERATORS.filter((op) => !FLAG_OPERATORS.has(op));

  async function refusalOf(filter: unknown): Promise<{ ids: string[]; lines: string[] }> {
    const warn = spyWarn();
    const ids = await selectedIds(filter, COMPARAND_ROWS);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    return { ids, lines };
  }

  it('the operator set is the declared vocabulary minus the three flag operators', () => {
    expect(COMPARAND_OPERATORS).toEqual([
      '$eq', '$ne', '$gt', '$gte', '$lt', '$lte', '$in', '$nin', '$between',
      '$contains', '$notContains', '$startsWith', '$endsWith', '$icontains',
    ]);
  });

  it.each(COMPARAND_OPERATORS)(
    '`%s` refuses a plain-object WHOLE comparand by name, excluding every row',
    async (operator) => {
      const { ids, lines } = await refusalOf({ owner: { [operator]: NESTED } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(REFUSAL);
    },
  );

  it.each([...LIST_OPERATORS])(
    '`%s` refuses a plain-object list MEMBER by name, excluding every row',
    async (operator) => {
      const { ids, lines } = await refusalOf({ owner: { [operator]: [NESTED, 'zzz'] } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(REFUSAL);
    },
  );

  const EMPTY_REFUSAL =
    "filter comparand on field 'owner' is an empty object ({}), which is neither "
    + 'a comparison value nor a nested relation constraint';

  it.each(COMPARAND_OPERATORS)(
    '`%s` refuses an EMPTY plain-object whole comparand in its own sentence',
    async (operator) => {
      const { ids, lines } = await refusalOf({ owner: { [operator]: {} } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(EMPTY_REFUSAL);
    },
  );

  it.each([...LIST_OPERATORS])(
    '`%s` refuses an EMPTY plain-object list member in its own sentence',
    async (operator) => {
      const { ids, lines } = await refusalOf({ owner: { [operator]: [{}, 'zzz'] } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(EMPTY_REFUSAL);
    },
  );

  it('`{}` as a field\'s WHOLE condition keeps the converter\'s zero-key refusal', async () => {
    const { ids, lines } = await refusalOf({ owner: {} });
    expect(ids).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('filter rule refused as it is lowered');
    expect(lines[0]).not.toContain(EMPTY_REFUSAL);
  });

  it.each([
    ['$ne {}', { owner: { $ne: {} } }],
    ['$nin [{}]', { owner: { $nin: [{}] } }],
    ['$ne', { owner: { $ne: NESTED } }],
    ['$notContains', { owner: { $notContains: NESTED } }],
    ['$gt', { owner: { $gt: NESTED } }],
    ['$nin member', { owner: { $nin: [NESTED] } }],
  ] as const)(
    '%s: the object form and its lowered AST form log one and the same sentence',
    async (_label, filter) => {
      const lowered = toFilterNodeSafely(filter);
      if (!lowered.ok) throw new Error(`the lowering refused ${JSON.stringify(filter)}`);
      const objectForm = await refusalOf(filter);
      const astForm = await refusalOf(lowered.node);
      expect(objectForm.ids).toEqual([]);
      expect(astForm.ids).toEqual([]);
      expect(objectForm.lines).toHaveLength(1);
      expect(astForm.lines).toEqual(objectForm.lines);
    },
  );

  it('CONTROL: scalar comparands still answer, with nothing logged', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ owner: { $ne: 'zeta' } }, COMPARAND_ROWS)).toEqual(['b', 'c']);
    expect(await selectedIds({ age: { $gt: 22 } }, COMPARAND_ROWS)).toEqual(['a', 'b']);
    expect(await selectedIds({ owner: { $nin: ['zeta'] } }, COMPARAND_ROWS)).toEqual(['b', 'c']);
    expect(await selectedIds({ owner: { $notContains: 'et' } }, COMPARAND_ROWS))
      .toEqual(['b', 'c']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: a `Date` comparand still answers, with nothing logged', async () => {
    const rows = [
      { id: 'a', created: new Date('2026-03-01T00:00:00Z') },
      { id: 'b', created: new Date('2026-01-01T00:00:00Z') },
    ];
    const warn = spyWarn();
    expect(await selectedIds({ created: { $gt: new Date('2026-02-01T00:00:00Z') } }, rows))
      .toEqual(['a']);
    expect(await selectedIds({ created: { $ne: new Date('2026-03-01T00:00:00Z') } }, rows))
      .toEqual(['b']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: a `{ $field }` reference still resolves, with nothing logged', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ age: { $gt: { $field: 'floor' } } }, COMPARAND_ROWS))
      .toEqual(['a', 'c']);
    expect(await selectedIds({ age: { $ne: { $field: 'floor' } } }, COMPARAND_ROWS))
      .toEqual(['a', 'c']);
    expect(warn).not.toHaveBeenCalled();
  });

  /**
   * Only a PLAIN object is a nested condition. A class instance with its own
   * non-`$` keys is data, the way a moment or luxon date or a decimal object
   * is: an ordering operator compares it through its `valueOf`. `age` is
   * 30 / 25 / 20.
   */
  class Amount {
    readonly units: number;
    constructor(units: number) {
      this.units = units;
    }
    valueOf(): number {
      return this.units;
    }
  }

  it.each([
    ['$gt', 22, ['a', 'b']],
    ['$gte', 25, ['a', 'b']],
    ['$lt', 26, ['b', 'c']],
    ['$lte', 25, ['b', 'c']],
  ] as const)(
    'CONTROL: a class instance with own keys under `%s` compares through valueOf, with nothing logged',
    async (operator, units, expected) => {
      const comparand = new Amount(units);
      expect(Object.keys(comparand)).toEqual(['units']);
      const warn = spyWarn();
      expect(await selectedIds({ age: { [operator]: comparand } }, COMPARAND_ROWS))
        .toEqual(expected);
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('a class instance as the WHOLE condition is a value, refused in the converter’s words', async () => {
    // Read as an operator map, its own key `units` was refused as a nested
    // relation. It is a value in comparand position, which the converter
    // refuses as one; this face logs that refusal, alone or inside `$or`.
    for (const filter of [
      { age: new Amount(30) },
      { $or: [{ owner: 'Alpha' }, { age: new Amount(30) }] },
    ]) {
      const { ids, lines } = await refusalOf(filter);
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("The filter on field 'age' carries a Amount instance");
      expect(lines[0]).not.toContain('nested relation');
    }
  });

  it('the flag operator `$empty` keeps its own boolean-flag refusal', async () => {
    const { ids, lines } = await refusalOf({ owner: { $empty: NESTED } });
    expect(ids).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("filter operator '$empty' on field 'owner' takes a boolean flag");
  });

  it('a non-operator key keeps the refusal that names that key', async () => {
    const { ids, lines } = await refusalOf({ owner: { profile: NESTED } });
    expect(ids).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("carries the non-operator key 'profile'");
  });
});

/**
 * `$null` / `$exists` take a BOOLEAN flag on this face too, as `$empty` does,
 * and the converter refuses the same flags before lowering, so the object form
 * and its lowered form cannot answer apart: neither one serves rows.
 * `nickname` is present on `a`, null on `b`, absent on `c`.
 */
describe('a `$null` / `$exists` flag that is not a boolean is refused on the `$` arm', () => {
  const NON_BOOLEAN_FLAGS: unknown[] = ['no', 'false', 1, 0, null, { owner: 'u1' }, {}];

  async function refusalOf(filter: unknown): Promise<{ ids: string[]; lines: string[] }> {
    const warn = spyWarn();
    const ids = await selectedIds(filter);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    return { ids, lines };
  }

  describe.each(['$null', '$exists'] as const)('%s', (operator) => {
    it.each(NON_BOOLEAN_FLAGS.map((flag) => [JSON.stringify(flag), flag]))(
      'the flag %s excludes every row and logs the boolean-flag sentence once',
      async (_label, flag) => {
        const { ids, lines } = await refusalOf({ nickname: { [operator]: flag } });
        expect(ids).toEqual([]);
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(
          `filter operator '${operator}' on field 'nickname' takes a boolean flag (true or false)`,
        );
      },
    );

    it('the converter refuses the same filter, so there is no lowered form to split from', () => {
      const lowered = toFilterNodeSafely({ nickname: { [operator]: 'no' } });
      expect(lowered.ok).toBe(false);
      if (!lowered.ok) {
        expect(lowered.refusal).toMatchObject({ code: 'INVALID_FILTER', operator, field: 'nickname' });
      }
    });
  });

  it.each([
    [{ nickname: { $null: true } }, ['b', 'c']],
    [{ nickname: { $null: false } }, ['a']],
    [{ nickname: { $exists: true } }, ['a']],
    [{ nickname: { $exists: false } }, ['b', 'c']],
  ] as const)(
    'CONTROL: %j answers as before, in the object form and in its lowered form, with nothing logged',
    async (filter, expected) => {
      const lowered = toFilterNodeSafely(filter);
      if (!lowered.ok) throw new Error(`the lowering refused ${JSON.stringify(filter)}`);
      const warn = spyWarn();
      expect(await selectedIds(filter)).toEqual(expected);
      expect(await selectedIds(lowered.node)).toEqual(expected);
      expect(warn).not.toHaveBeenCalled();
    },
  );
});

/**
 * Three more object comparands this matcher cannot compare, refused on both
 * arms by the shared builder: a `$`-keyed plain object that is no `{ $field }`
 * reference (the `{ $now, addDays }` date anchor among them), a plain object
 * of another realm, and a class instance under an equality, membership or text
 * operator. The spec's comparand door refuses the last two at every operator;
 * it steps around a well-formed anchor, which the platform resolves in the
 * compared column's temporal form, and this face, which has no field types,
 * refuses it in words instead of comparing it as `[object Object]`.
 */
describe('a `$`-keyed object, a foreign-realm object and a class instance in comparand position', () => {
  const ROWS_2 = [
    { id: 'a', owner: 'zeta', age: 30, due: '2099-01-01', floor: 25 },
    { id: 'b', owner: 'Alpha', age: 25, due: '2000-01-01', floor: 25 },
    { id: 'c', owner: null, age: 20, due: null, floor: 10 },
  ];
  const FLAG_OPERATORS = new Set(['$null', '$exists', '$empty']);
  const LIST_OPERATORS = new Set(['$in', '$nin', '$between']);
  const COMPARAND_OPERATORS = FILTER_OPERATORS.filter((op) => !FLAG_OPERATORS.has(op));

  /**
   * How each comparand operator compares: by ORDER (a class instance is
   * compared through its `valueOf`), by VALUE (equality, membership, text: a
   * class instance is refused), or by its own text door (`$icontains`, which
   * refuses every non-string comparand already).
   */
  const COMPARISON_KIND: Record<string, 'order' | 'value' | 'text-door'> = {
    $eq: 'value', $ne: 'value', $in: 'value', $nin: 'value',
    $contains: 'value', $notContains: 'value', $startsWith: 'value', $endsWith: 'value',
    $gt: 'order', $gte: 'order', $lt: 'order', $lte: 'order', $between: 'order',
    $icontains: 'text-door',
  };

  async function refusalOf(filter: unknown): Promise<{ ids: string[]; lines: string[] }> {
    const warn = spyWarn();
    const ids = await selectedIds(filter, ROWS_2);
    const lines = warn.mock.calls.map((call) => String(call[0]));
    warn.mockRestore();
    return { ids, lines };
  }

  /** The whole comparand, or a list member for a list operator. */
  const placed = (operator: string, comparand: unknown): unknown =>
    LIST_OPERATORS.has(operator) ? [comparand, 'zzz'] : comparand;

  it('the comparison-kind table covers the comparand operators exactly', () => {
    expect(Object.keys(COMPARISON_KIND).sort()).toEqual([...COMPARAND_OPERATORS].sort());
  });

  const ANCHOR = { $now: true, addDays: 7 };
  const ANCHOR_REFUSAL =
    "filter comparand on field 'due' is a { $now, addDays } date anchor, which the in-memory "
    + 'matcher does not resolve';

  it.each(COMPARAND_OPERATORS)(
    '`%s` refuses a `{ $now, addDays }` anchor by name, whole or as a list member',
    async (operator) => {
      const { ids, lines } = await refusalOf({ due: { [operator]: placed(operator, ANCHOR) } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(ANCHOR_REFUSAL);
    },
  );

  it('the resolved anchor form (`$now` holding an instant) is refused in the same words', async () => {
    const { ids, lines } = await refusalOf({ due: { $lt: { $now: '2026-01-01T00:00:00Z', addDays: 7 } } });
    expect(ids).toEqual([]);
    expect(lines[0]).toContain(ANCHOR_REFUSAL);
  });

  it.each(COMPARAND_OPERATORS)(
    '`%s` refuses another `$`-keyed object that is no `{ $field }` reference',
    async (operator) => {
      const { ids, lines } = await refusalOf({ owner: { [operator]: placed(operator, { $foo: 1 }) } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(
        "filter comparand on field 'owner' is an object carrying the key '$foo', which is neither "
        + 'a comparison value nor a { $field } reference',
      );
    },
  );

  it.each(COMPARAND_OPERATORS)(
    '`%s` refuses a plain object of another realm, whole or as a list member',
    async (operator) => {
      const foreign = runInNewContext('({ id: "u1" })');
      const { ids, lines } = await refusalOf({ owner: { [operator]: placed(operator, foreign) } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("filter comparand on field 'owner' is a plain object from another realm");
    },
  );

  it('a plain object of another realm as the WHOLE condition is refused in the converter’s words', async () => {
    const { ids, lines } = await refusalOf({ owner: runInNewContext('({ id: "u1" })') });
    expect(ids).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("The filter on field 'owner' carries a plain object from another realm");
  });

  /** A class instance: data, compared through its `valueOf` under an ordering. */
  class Amount {
    readonly units: number;
    constructor(units: number) {
      this.units = units;
    }
    valueOf(): number {
      return this.units;
    }
    toString(): string {
      return `Amount(${this.units})`;
    }
  }
  const CLASS_REFUSAL = "filter comparand on field 'age' is a Amount instance, which the in-memory matcher compares only by order";

  it.each(COMPARAND_OPERATORS.filter((op) => COMPARISON_KIND[op] === 'value'))(
    '`%s` refuses a class instance, whole or as a list member, by name',
    async (operator) => {
      const { ids, lines } = await refusalOf({ age: { [operator]: placed(operator, new Amount(25)) } });
      expect(ids).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(CLASS_REFUSAL);
    },
  );

  it('`$icontains` keeps its own text door for a class instance', async () => {
    const { ids, lines } = await refusalOf({ age: { $icontains: new Amount(25) } });
    expect(ids).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(CLASS_REFUSAL);
    expect(lines[0]).toContain('$icontains');
  });

  it('CONTROL: under `$between` a class instance endpoint compares through valueOf, with nothing logged', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ age: { $between: [new Amount(22), new Amount(28)] } }, ROWS_2)).toEqual(['b']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('CONTROL: a scalar, a `Date` and a `{ $field }` reference are compared, with nothing logged', async () => {
    const warn = spyWarn();
    expect(await selectedIds({ owner: { $ne: 'zeta' } }, ROWS_2)).toEqual(['b', 'c']);
    expect(await selectedIds({ due: { $lt: '2050-01-01' } }, ROWS_2)).toEqual(['b']);
    expect(await selectedIds({ age: { $eq: { $field: 'floor' } } }, ROWS_2)).toEqual(['b']);
    const dated = [{ id: 'x', at: new Date('2026-03-01T00:00:00Z') }, { id: 'y', at: new Date('2026-01-01T00:00:00Z') }];
    expect(await selectedIds({ at: { $eq: new Date('2026-03-01T00:00:00Z') } }, dated)).toEqual(['x']);
    expect(await selectedIds({ at: { $nin: [new Date('2026-03-01T00:00:00Z')] } }, dated)).toEqual(['y']);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ['$lt anchor', { due: { $lt: ANCHOR } }],
    ['$in anchor member', { due: { $in: [ANCHOR] } }],
    ['$ne $-keyed', { owner: { $ne: { $foo: 1 } } }],
    ['$eq class instance', { age: { $eq: new Amount(25) } }],
    ['$nin class member', { age: { $nin: [new Amount(25)] } }],
    ['$notContains class instance', { age: { $notContains: new Amount(25) } }],
  ] as const)(
    '%s: the object form and its lowered AST form log one and the same sentence',
    async (_label, filter) => {
      const lowered = toFilterNodeSafely(filter);
      if (!lowered.ok) throw new Error(`the lowering refused ${JSON.stringify(filter)}`);
      const objectForm = await refusalOf(filter);
      const astForm = await refusalOf(lowered.node);
      expect(objectForm.ids).toEqual([]);
      expect(astForm.ids).toEqual([]);
      expect(objectForm.lines).toHaveLength(1);
      expect(astForm.lines).toEqual(objectForm.lines);
    },
  );
});
