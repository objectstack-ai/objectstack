/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#7349 — `ValueDataSource`'s in-memory matcher reads the filter
 * vocabulary the wire already accepts, and refuses what it cannot execute.
 *
 * ## Why every case here needs a control
 *
 * The defect being fixed is a fall-through to `true`: before this card,
 * `matchesASTFilter` answered "matches" for every shape and operator it did not
 * recognise. So "the filter selected my row" passes on the BROKEN code as
 * loudly as on the fixed code, and an assertion written that way measures
 * nothing. Every case below is therefore written as a row-SET equality where
 * the broken answer is the full set — `expect(ids).toEqual(['a','c'])` is red
 * when the matcher returns `['a','b','c']`.
 *
 * The live control is {@link CONTROL_ROWS} + `['role', '=', 'admin']`: an
 * operator and shape the matcher implemented BEFORE this card, so it selects
 * correctly on both trees and proves the harness itself discriminates.
 *
 * ## What the fix taught the matcher
 *
 * 1. The legacy flat array `[[…], […]]` is an implicit AND — at top level and
 *    as a child of `and` / `or`. It is what `mergeFilterNodes` returns for a
 *    lone surviving source, so it is the COMMON shape, not an exotic one.
 * 2. The null-ness operators take their direction from the operator NAME and
 *    never read the value slot, in every spelling the spec folds onto them.
 * 3. An operator or shape the matcher cannot execute excludes the row and says
 *    so, instead of passing every row silently.
 *
 * ## The fold moved under §2 (objectui#11094)
 *
 * Until `@objectstack/spec` 17.6.0, `canonicalAstOperator` folded `is_empty` /
 * `isempty` onto `is_null` and their negatives onto `is_not_null`, and §2 pinned
 * all eight spellings as null tests. objectstack#20570 gave the empty pair its
 * own names and lowers them to the `$empty` operator, whose meaning is an
 * emptiness test: `''` and `[]` count as empty beside null. On that release this
 * matcher had no arm for them and refused every stored `is_empty` rule, which
 * selected no row. §2 is rewritten to the new fold: the null pair stays a null
 * test, and the empty pair is pinned in §2b over text, multi-value and number
 * columns, `''` and `[]` included.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { VIEW_FILTER_OPERATORS } from '@objectstack/spec/ui';
import {
  canonicalAstOperator,
  EMPTY_OPERATOR_ARMS,
  isEmptyFilterValue,
  parseFilterAST,
} from '@objectstack/spec/data';
import { ValueDataSource } from '../ValueDataSource';
import { mergeFilterNodes, toFilterNode } from '../../utils/filter-converter';

/** Three rows, two of them sharing a `role`, so a wrong answer is never the right size. */
const CONTROL_ROWS = [
  { id: 'a', role: 'admin', age: 30 },
  { id: 'b', role: 'user', age: 25 },
  { id: 'c', role: 'admin', age: 20 },
];

const ALL_CONTROL_IDS = ['a', 'b', 'c'];

async function selectedIds(
  filter: unknown,
  rows: Array<Record<string, unknown>> = CONTROL_ROWS,
): Promise<string[]> {
  const ds = new ValueDataSource({ items: rows });
  const result = await ds.find('rows', { $filter: filter as any });
  return result.data.map((r) => r.id as string);
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 0. The live control
// ---------------------------------------------------------------------------

describe('objectui#7349 — live control', () => {
  it('an operator the matcher implemented BEFORE this card still selects', async () => {
    // Green on the broken tree AND on the fixed one. Its job is to prove the
    // rows, the adapter and the id projection work, so that a red anywhere
    // below is about the vocabulary rather than the harness.
    expect(await selectedIds(['role', '=', 'admin'])).toEqual(['a', 'c']);
    expect(await selectedIds(['and', ['role', '=', 'admin'], ['age', '>', 24]])).toEqual(['a']);
  });

  it('the broken answer is the full set, so every case below discriminates', async () => {
    expect(await selectedIds([])).toEqual(ALL_CONTROL_IDS);
  });
});

// ---------------------------------------------------------------------------
// 1. The flat implicit-AND array
// ---------------------------------------------------------------------------

describe('objectui#7349 — a flat array of rules is an implicit AND', () => {
  it('at top level, multi-rule', async () => {
    expect(await selectedIds([['role', '=', 'admin'], ['age', '>', 24]])).toEqual(['a']);
  });

  it('at top level, single-rule — it is the SHAPE, not the count', async () => {
    expect(await selectedIds([['role', '=', 'admin']])).toEqual(['a', 'c']);
  });

  it('as a child of `and` — the gate’s two-source output keeps its authored rules', async () => {
    // `['and', <authored flat array>, <composed tuple>]` is what
    // `mergeFilterNodes` emits when two sources survive. The nested child used
    // to be swallowed whole.
    expect(
      await selectedIds(['and', [['role', '=', 'admin'], ['age', '>', 24]], ['id', '!=', 'zzz']]),
    ).toEqual(['a']);
  });

  it('as a child of `or`', async () => {
    expect(
      await selectedIds(['or', [['role', '=', 'admin'], ['age', '>', 24]], ['id', '=', 'b']]),
    ).toEqual(['a', 'b']);
  });

  it('nesting is equivalent to flattening, which is what objectui#7221 asked', async () => {
    const nested = ['and', [['role', '=', 'admin'], ['age', '>', 24]], ['id', '!=', 'zzz']];
    const flattened = ['and', ['role', '=', 'admin'], ['age', '>', 24], ['id', '!=', 'zzz']];
    expect(await selectedIds(nested)).toEqual(await selectedIds(flattened));
  });
});

// ---------------------------------------------------------------------------
// 2. The null-ness operators
// ---------------------------------------------------------------------------

const NULL_ROWS = [
  { id: 'has', ts: '2026-01-01' },
  { id: 'null', ts: null },
  { id: 'undef', ts: undefined },
  { id: 'missing' },
];

/** Every spelling the spec's `canonicalAstOperator` folds onto `is_null`. */
const IS_NULL_SPELLINGS = ['is_null', 'isnull'];
/** …and onto `is_not_null`. */
const IS_NOT_NULL_SPELLINGS = ['is_not_null', 'isnotnull'];
/**
 * The two spellings it folds onto `is_empty`, and the two onto `is_not_empty`.
 * They folded onto the null pair above until `@objectstack/spec` 17.6.0.
 */
const IS_EMPTY_SPELLINGS = ['is_empty', 'isempty'];
const IS_NOT_EMPTY_SPELLINGS = ['is_not_empty', 'isnotempty'];

describe('objectui#11094 — the fold this file is written against', () => {
  it('the null pair and the empty pair are four canonical operators, not two', () => {
    // The spec's answer, read rather than restated, so a release that moves the
    // fold again reddens HERE first, beside the reason, instead of only in the
    // row sets below.
    for (const op of IS_NULL_SPELLINGS) expect(canonicalAstOperator(op)).toBe('is_null');
    for (const op of IS_NOT_NULL_SPELLINGS) expect(canonicalAstOperator(op)).toBe('is_not_null');
    for (const op of IS_EMPTY_SPELLINGS) expect(canonicalAstOperator(op)).toBe('is_empty');
    for (const op of IS_NOT_EMPTY_SPELLINGS) expect(canonicalAstOperator(op)).toBe('is_not_empty');
  });

  it('and the spec lowers the empty pair to `$empty`, not to `$null`', () => {
    expect(parseFilterAST(['x', 'is_empty'])).toEqual({ x: { $empty: true } });
    expect(parseFilterAST(['x', 'is_not_empty'])).toEqual({ x: { $empty: false } });
    // Lit control: the null pair still lowers to `$null`.
    expect(parseFilterAST(['x', 'is_null'])).toEqual({ x: { $null: true } });
  });
});

describe('objectui#7349 — null-ness takes direction from the operator NAME', () => {
  it.each(IS_NULL_SPELLINGS)('`%s` selects null, undefined and the absent key', async (op) => {
    expect(await selectedIds([['ts', op]], NULL_ROWS)).toEqual(['null', 'undef', 'missing']);
  });

  it.each(IS_NOT_NULL_SPELLINGS)('`%s` selects only the row that has a value', async (op) => {
    expect(await selectedIds([['ts', op]], NULL_ROWS)).toEqual(['has']);
  });

  it('never reads the value slot — filler, null, or no slot at all', async () => {
    // The 2-tuple and the 3-tuple-with-`null` are the same predicate, and a
    // filler comparand changes nothing. This is the question objectui#7221
    // asked and could not answer, because the operator was unimplemented.
    expect(await selectedIds(['ts', 'is_not_null'], NULL_ROWS)).toEqual(['has']);
    expect(await selectedIds(['ts', 'isnotnull', null], NULL_ROWS)).toEqual(['has']);
    expect(await selectedIds(['ts', 'isnotnull', 'FILLER'], NULL_ROWS)).toEqual(['has']);
    expect(await selectedIds(['and', ['ts', 'isnotnull', null]], NULL_ROWS)).toEqual(['has']);
    expect(await selectedIds([['ts', 'isnotnull', null]], NULL_ROWS)).toEqual(['has']);
  });

  it('the card’s own two-rule filter, in both dialects', async () => {
    const rows = [
      { id: 'both', visible_from: '2026-01-01', due_date: '2026-02-01' },
      { id: 'one', visible_from: '2026-01-01', due_date: null },
      { id: 'neither' },
    ];
    const flat = [['visible_from', 'is_not_null'], ['due_date', 'is_not_null']];
    const wrapped = ['and', ['visible_from', 'isnotnull', null], ['due_date', 'isnotnull', null]];
    expect(await selectedIds(flat, rows)).toEqual(['both']);
    expect(await selectedIds(wrapped, rows)).toEqual(['both']);
  });
});

// ---------------------------------------------------------------------------
// 2b. Emptiness — the empty pair is its own test since spec 17.6.0
// ---------------------------------------------------------------------------

/**
 * A text column (`name`), a multi-value column (`tags`) and a number column
 * (`score`), each holding a value, its type's "blank" (`''`, `[]`, `0`), null,
 * and no key at all. The spec's ruled table makes `''` empty on a text field and
 * `[]` empty on a multi-value field, and leaves `0` a value, so the three
 * columns give three different answers to one operator — and the text column's
 * answer differs from `is_null`'s, which is the flip itself.
 */
const EMPTY_ROWS = [
  { id: 'full', name: 'ada', tags: ['x'], score: 7 },
  { id: 'blank', name: '', tags: [], score: 0 },
  { id: 'null', name: null, tags: null, score: null },
  { id: 'missing' },
];
const EMPTY_ROW_IDS = EMPTY_ROWS.map((r) => r.id);

/** Per column: the rows `is_empty` selects. `is_not_empty` selects the rest. */
const EMPTY_BY_COLUMN: Record<string, string[]> = {
  name: ['blank', 'null', 'missing'],
  tags: ['blank', 'null', 'missing'],
  score: ['null', 'missing'],
};

const complementOf = (ids: string[]) => EMPTY_ROW_IDS.filter((id) => !ids.includes(id));

describe('objectui#11094 — `is_empty` / `is_not_empty` are an emptiness test', () => {
  describe.each(Object.entries(EMPTY_BY_COLUMN))('on the `%s` column', (column, empty) => {
    it.each(IS_EMPTY_SPELLINGS)('`%s` selects the empty rows', async (op) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await selectedIds([[column, op]], EMPTY_ROWS)).toEqual(empty);
      // Executed, not refused: on 17.6.0 without the arm this was `[]` plus
      // one logged refusal.
      expect(warn).not.toHaveBeenCalled();
    });

    it.each(IS_NOT_EMPTY_SPELLINGS)('`%s` selects exactly the rest', async (op) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await selectedIds([[column, op]], EMPTY_ROWS)).toEqual(complementOf(empty));
      expect(warn).not.toHaveBeenCalled();
    });

    it('answers what the spec\'s own `isEmptyFilterValue` answers, row by row', async () => {
      // The by-value reading, called with no declared row: the function itself
      // is the reference, so this table cannot drift into a second copy of it.
      const expected = EMPTY_ROWS
        .filter((row) => isEmptyFilterValue((row as Record<string, unknown>)[column]))
        .map((row) => row.id);
      expect(await selectedIds([column, 'is_empty'], EMPTY_ROWS)).toEqual(expected);
    });

    it('the object dialect\'s `$empty` gives the same rows, both directions', async () => {
      expect(await selectedIds({ [column]: { $empty: true } }, EMPTY_ROWS)).toEqual(empty);
      expect(await selectedIds({ [column]: { $empty: false } }, EMPTY_ROWS))
        .toEqual(complementOf(empty));
    });
  });

  it('is not a null test any more — the flip, on the text column', async () => {
    // `''` is the row that moves. Before 17.6.0 both operators were one arm.
    expect(await selectedIds([['name', 'is_null']], EMPTY_ROWS)).toEqual(['null', 'missing']);
    expect(await selectedIds([['name', 'is_empty']], EMPTY_ROWS)).toEqual(['blank', 'null', 'missing']);
    expect(await selectedIds([['name', 'is_not_null']], EMPTY_ROWS)).toEqual(['full', 'blank']);
    expect(await selectedIds([['name', 'is_not_empty']], EMPTY_ROWS)).toEqual(['full']);
  });

  it('with no declared type, a value is judged by value — `\'\'` in a number column is empty', async () => {
    // This adapter holds no field declarations (its config is rows and an id
    // field), so it takes the by-value reading the spec gives such faces. That
    // differs from a face that holds the declaration on exactly this kind of
    // value: a number field is the `null_only` row of the ruled table, which
    // would leave `''` (and `[]`) a value. The control below is the spec's own
    // function asked both ways, so the divergence this case pins is the
    // spec's, not this file's.
    expect(isEmptyFilterValue('')).toBe(true);
    expect(isEmptyFilterValue('', EMPTY_OPERATOR_ARMS.null_only)).toBe(false);
    expect(isEmptyFilterValue([], EMPTY_OPERATOR_ARMS.null_only)).toBe(false);
    const rows = [
      { id: 'number', score: 3 },
      { id: 'zero', score: 0 },
      { id: 'blank-string', score: '' },
      { id: 'blank-list', score: [] },
    ];
    expect(await selectedIds([['score', 'is_empty']], rows)).toEqual(['blank-string', 'blank-list']);
    expect(await selectedIds([['score', 'is_not_empty']], rows)).toEqual(['number', 'zero']);
  });

  it('never reads the value slot — filler, null, or a stray array', async () => {
    // Same rule as the null pair: direction from the NAME. An array in the slot
    // is not an array comparand here (the spec discards it), so it is neither
    // refused nor read.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const empty = EMPTY_BY_COLUMN.tags;
    expect(await selectedIds(['tags', 'is_empty'], EMPTY_ROWS)).toEqual(empty);
    expect(await selectedIds(['tags', 'is_empty', null], EMPTY_ROWS)).toEqual(empty);
    expect(await selectedIds(['tags', 'is_empty', true], EMPTY_ROWS)).toEqual(empty);
    expect(await selectedIds(['tags', 'isempty', ['x']], EMPTY_ROWS)).toEqual(empty);
    expect(await selectedIds(['tags', 'is_not_empty', 'FILLER'], EMPTY_ROWS)).toEqual(complementOf(empty));
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 3. Refusal — the arm that used to be `return true`
// ---------------------------------------------------------------------------

describe('objectui#7349 — what the matcher cannot execute, it refuses', () => {
  it('an unknown operator excludes every row and logs once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selectedIds(['role', 'no_such_operator', 'admin'])).toEqual([]);
    // One line for three rows: the refusal is collected per `find()`, not per row.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('no_such_operator');
  });

  it('a spec-valid operator this matcher does not implement refuses too', async () => {
    // `like` is a member of the spec's `VALID_AST_OPERATORS`, so the wire would
    // accept it; the in-memory matcher has no pattern engine. Refusing is loud,
    // matching every row was silent.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selectedIds(['role', 'like', '%admin%'])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a shape the matcher cannot read excludes every row and logs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selectedIds(['role'])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a non-array child of `and` is refused rather than passed', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selectedIds(['and', ['role', '=', 'admin'], 'garbage'])).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('an empty filter still means "no filter"', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await selectedIds([])).toEqual(ALL_CONTROL_IDS);
    expect(warn).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. The canonical VIEW vocabulary — what the producer in this package emits
// ---------------------------------------------------------------------------

/**
 * A comparand per canonical view operator, chosen so the expected row set is
 * never the full set. `viewFilterRuleToNode` lowers a stored view's rules
 * through the spec's `normalizeFilterOperator`, which canonicalizes to
 * `VIEW_FILTER_OPERATORS` — so THESE are the spellings that actually arrive at
 * the matcher from a saved view, and 16 of the 20 had no arm before this card.
 */
const VIEW_OPERATOR_CASES: Record<string, { node: unknown[]; expected: string[] }> = {
  equals: { node: ['role', 'equals', 'admin'], expected: ['a', 'c'] },
  not_equals: { node: ['role', 'not_equals', 'admin'], expected: ['b'] },
  contains: { node: ['role', 'contains', 'dmi'], expected: ['a', 'c'] },
  not_contains: { node: ['role', 'not_contains', 'dmi'], expected: ['b'] },
  icontains: { node: ['role', 'icontains', 'ADMI'], expected: ['a', 'c'] },
  starts_with: { node: ['role', 'starts_with', 'adm'], expected: ['a', 'c'] },
  ends_with: { node: ['role', 'ends_with', 'min'], expected: ['a', 'c'] },
  greater_than: { node: ['age', 'greater_than', 24], expected: ['a', 'b'] },
  less_than: { node: ['age', 'less_than', 25], expected: ['c'] },
  greater_than_or_equal: { node: ['age', 'greater_than_or_equal', 25], expected: ['a', 'b'] },
  less_than_or_equal: { node: ['age', 'less_than_or_equal', 25], expected: ['b', 'c'] },
  in: { node: ['role', 'in', ['admin']], expected: ['a', 'c'] },
  not_in: { node: ['role', 'not_in', ['admin']], expected: ['b'] },
  between: { node: ['age', 'between', [24, 31]], expected: ['a', 'b'] },
  // `before` / `after` are canonical view operators with no infix spelling of
  // their own; the spec lowers them to `$lt` / `$gt`.
  before: { node: ['age', 'before', 25], expected: ['c'] },
  after: { node: ['age', 'after', 24], expected: ['a', 'b'] },
  is_empty: { node: ['nickname', 'is_empty'], expected: ['b', 'c'] },
  is_not_empty: { node: ['nickname', 'is_not_empty'], expected: ['a'] },
  is_null: { node: ['nickname', 'is_null'], expected: ['b', 'c'] },
  is_not_null: { node: ['nickname', 'is_not_null'], expected: ['a'] },
};

/** `CONTROL_ROWS` plus a nullable column, so the null-ness cases discriminate. */
const VIEW_ROWS = [
  { id: 'a', role: 'admin', age: 30, nickname: 'ace' },
  { id: 'b', role: 'user', age: 25, nickname: null },
  { id: 'c', role: 'admin', age: 20 },
];

describe('objectui#7349 — every canonical VIEW operator is executed, not waved through', () => {
  it('the case table covers VIEW_FILTER_OPERATORS exactly — no operator drops out unnoticed', () => {
    // A parity guard, not a restatement: when a spec release adds a view
    // operator, this goes red instead of the new operator silently selecting
    // every row through the refusal arm.
    expect([...VIEW_FILTER_OPERATORS].sort()).toEqual(Object.keys(VIEW_OPERATOR_CASES).sort());
  });

  it.each(Object.entries(VIEW_OPERATOR_CASES))(
    '`%s` filters rather than matching everything',
    async (_op, { node, expected }) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await selectedIds(node, VIEW_ROWS)).toEqual(expected);
      // Executed, not refused: a refusal would also fail the row-set assertion,
      // but this names WHICH failure it is.
      expect(warn).not.toHaveBeenCalled();
    },
  );
});

// ---------------------------------------------------------------------------
// 5. The reachability chain, executed
// ---------------------------------------------------------------------------

describe('objectui#7349 — the production chain, end to end', () => {
  const AUTHORED_RULES = [
    { field: 'visible_from', operator: 'is_not_null' },
    { field: 'due_date', operator: 'is_not_null' },
  ];
  const ROWS = [
    { id: 'both', visible_from: '2026-01-01', due_date: '2026-02-01' },
    { id: 'one', visible_from: '2026-01-01', due_date: null },
    { id: 'neither' },
  ];

  it('a lone surviving source reaches the adapter FLAT and is applied', async () => {
    // `buildEffectiveFilter` → `mergeFilterNodes` → `$filter` → `ValueDataSource`.
    // The lone-source path returns the flat array unwrapped, which is exactly
    // the shape the matcher used to ignore.
    const filter = mergeFilterNodes(AUTHORED_RULES);
    expect(filter).toEqual([['visible_from', 'is_not_null'], ['due_date', 'is_not_null']]);
    expect(await selectedIds(filter, ROWS)).toEqual(['both']);
  });

  it('two surviving sources nest the authored array and it still applies', async () => {
    const filter = mergeFilterNodes(AUTHORED_RULES, ['id', '!=', 'zzz']);
    expect(filter).toEqual([
      'and',
      [['visible_from', 'is_not_null'], ['due_date', 'is_not_null']],
      ['id', '!=', 'zzz'],
    ]);
    expect(await selectedIds(filter, ROWS)).toEqual(['both']);
  });

  it('a saved view’s `equals` rule — the shipped spelling — filters', async () => {
    // The spelling `toFilterNode` produces from stored view metadata. It had no
    // arm in the old switch, so a `provider: 'value'` list showed every row.
    const filter = toFilterNode([{ field: 'role', operator: 'equals', value: 'admin' }]);
    expect(filter).toEqual([['role', 'equals', 'admin']]);
    expect(await selectedIds(filter)).toEqual(['a', 'c']);
  });
});
