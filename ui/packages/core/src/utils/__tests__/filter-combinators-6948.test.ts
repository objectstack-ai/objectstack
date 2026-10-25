/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `$and` / `$or` / `$not` through the repo's ONE lowering — objectui#6948.
 *
 * ## What this file asserts, and why it is row sets and not source shape
 *
 * The card asked for a branch. A branch existing is not the property that
 * matters, so nothing here greps the source: every assertion is either the node
 * that REACHES THE WIRE, put through the spec's own doors (`isFilterAST` /
 * `parseFilterAST`, `@objectstack/spec/data`), or the ROW SET a real
 * `ValueDataSource` returns for it.
 *
 * Both halves are pinned in both directions, because each half alone passes on
 * an implementation strictly worse than the bug:
 *
 *   - an assertion that a combinator is PRESENT passes on a builder that emits
 *     everything;
 *   - an assertion that a row set is EMPTY passes on a converter that emits
 *     nothing at all — `$filter: undefined` returns EVERY row, and a node no
 *     evaluator reads returns NONE.
 *
 * So every row-set case names the exact ids, and {@link ALL_IDS} is asserted to
 * be neither of them.
 *
 * ## What was actually wrong — NOT what the card said
 *
 * The card stated that the pre-fix emission for `$and` / `$or` — a leaf naming a
 * field literally called `$and` / `$or` — was refused by the server with `400
 * INVALID_FILTER`. Re-measured against `@objectstack/spec` 17.3.0 that is FALSE,
 * and this repo already knew: `data-objectstack/src/filter-entry-translation.test.ts`
 * pins the same round trip with the note "verified". `parseFilterAST` lowers
 * `['$or', '=', [...]]` to `{ $or: [...] }` — the FilterCondition the author
 * wrote — because a `[field, '=', value]` node becomes `{ [field]: value }` and
 * `$or` is a legal FilterCondition key. So the combinator DID reach the wire and
 * WAS interpreted correctly there. {@link WIRE_UNMOVED} pins that it still is.
 *
 * The real defect is one door further in, and it is silent: `['$or', '=', [...]]`
 * is a well-formed COMPARISON node, so every AST evaluator in this repo reads
 * `$or` as a field name. `ValueDataSource`'s matcher looks up `record['$or']`,
 * finds nothing, and excludes every row — no error, no console line, an empty
 * list where the author asked for a union. That is the failure this file fixes
 * in place, and {@link PRE_FIX_OR_NODE} is the control that it really did.
 *
 * ## `$not` is refused, and that is an open contract question
 *
 * The ObjectQL AST has no negation: `FILTER_ARRAY_LOGIC_KEYWORDS` is
 * `['and', 'or']`. Rewriting the negation inward is not available either —
 * `startswith`, `endswith`, `between` and `icontains` have no negated
 * counterpart in `VALID_AST_OPERATORS`, so a De Morgan lowering would be
 * silently partial, and `$not` is NULL-safe by ruling (objectstack#5146), which
 * a partial rewrite would quietly drop. So `$not` is refused with an accurate
 * message instead of translated. It threw before this card too — with a message
 * naming a nonsense operator — so this changes the diagnostic, not the verdict;
 * whether the AST should GAIN a negation is a spec decision, not this file's.
 */

import { describe, it, expect } from 'vitest';
import { isFilterAST, parseFilterAST } from '@objectstack/spec/data';
import { convertFiltersToAST, mergeFilterNodes } from '../filter-converter';
import { ValueDataSource } from '../../adapters/ValueDataSource';

// ---------------------------------------------------------------------------
// Fixture — one row per branch of the combinators under test
// ---------------------------------------------------------------------------

const ROWS = [
  { id: 'open-active', status: 'open', is_active: true, age: 30 },
  { id: 'blocked-idle', status: 'blocked', is_active: false, age: 20 },
  { id: 'done-active', status: 'done', is_active: true, age: 40 },
  { id: 'null-status', status: null, is_active: null, age: null },
  { id: 'no-status-key' },
];

/** What "no filter reached the evaluator" looks like. Never an expected answer. */
const ALL_IDS = ['open-active', 'blocked-idle', 'done-active', 'null-status', 'no-status-key'];

async function selectedIds(filter: unknown): Promise<string[]> {
  const ds = new ValueDataSource({ items: ROWS });
  const result = await ds.find('tasks', { $filter: filter as any });
  return result.data.map((r: any) => r.id as string);
}

/** The authored filter of the card: a two-branch union. */
const AUTHORED_OR = { $or: [{ status: 'open' }, { status: 'blocked' }] };

/** Its emission BEFORE this card — a comparison node on a field named `$or`. */
const PRE_FIX_OR_NODE = ['$or', '=', [{ status: 'open' }, { status: 'blocked' }]];

// ---------------------------------------------------------------------------
// 1. The lowering — the node that reaches the wire
// ---------------------------------------------------------------------------

describe('objectui#6948 — the lowering', () => {
  it('lowers $or to an AST group node, children lowered recursively', () => {
    expect(convertFiltersToAST(AUTHORED_OR)).toEqual([
      'or',
      ['status', '=', 'open'],
      ['status', '=', 'blocked'],
    ]);
  });

  it('lowers $and the same way, and lowers operator children too', () => {
    expect(convertFiltersToAST({ $and: [{ status: 'open' }, { age: { $gte: 18 } }] })).toEqual([
      'and',
      ['status', '=', 'open'],
      ['age', '>=', 18],
    ]);
  });

  it('nests, so a combinator inside a combinator survives as a group', () => {
    expect(
      convertFiltersToAST({
        $and: [{ $or: [{ status: 'open' }, { status: 'done' }] }, { is_active: true }],
      }),
    ).toEqual([
      'and',
      ['or', ['status', '=', 'open'], ['status', '=', 'done']],
      ['is_active', '=', true],
    ]);
  });

  it('AND-combines a combinator with the sibling fields of its own object', () => {
    expect(convertFiltersToAST({ is_active: true, ...AUTHORED_OR })).toEqual([
      'and',
      ['is_active', '=', true],
      ['or', ['status', '=', 'open'], ['status', '=', 'blocked']],
    ]);
  });

  it('survives mergeFilterNodes, so a parent scope still NARROWS it', () => {
    // The related-list / line-items shape: a parent scope AND the list's own
    // filter. The union must stay one child of the `and`, never spread into it.
    expect(mergeFilterNodes({ task_version: 'tv-1' }, AUTHORED_OR)).toEqual([
      'and',
      ['task_version', '=', 'tv-1'],
      ['or', ['status', '=', 'open'], ['status', '=', 'blocked']],
    ]);
  });
});

// ---------------------------------------------------------------------------
// 2. The wire door — the spec's own predicate and lowering
// ---------------------------------------------------------------------------

/**
 * The FilterCondition the server sees. Identical before and after this card —
 * the pre-fix leaf round-tripped correctly, which is why the defect was invisible
 * from the wire and why the changeset argues its level from the EVALUATOR side.
 */
const WIRE_UNMOVED = { $or: [{ status: 'open' }, { status: 'blocked' }] };

describe('objectui#6948 — what the wire receives', () => {
  it('emits a node the spec accepts AS A GROUP, which the old leaf was not', () => {
    const node = convertFiltersToAST(AUTHORED_OR);
    expect(isFilterAST(node)).toBe(true);
    // Control that fires: the pre-fix node also passed `isFilterAST` — as a
    // COMPARISON. Passing that gate was never the property in question, which
    // is why this file does not stop here.
    expect(isFilterAST(PRE_FIX_OR_NODE)).toBe(true);
    expect(node).not.toEqual(PRE_FIX_OR_NODE);
  });

  it('lowers to the FilterCondition the author wrote', () => {
    expect(parseFilterAST(convertFiltersToAST(AUTHORED_OR))).toEqual(WIRE_UNMOVED);
  });

  it('does not move the wire: the old leaf lowered to the SAME condition', () => {
    expect(parseFilterAST(PRE_FIX_OR_NODE)).toEqual(WIRE_UNMOVED);
    expect(parseFilterAST(convertFiltersToAST(AUTHORED_OR))).toEqual(parseFilterAST(PRE_FIX_OR_NODE));
  });

  it('keeps the parent scope AROUND the union once merged', () => {
    expect(parseFilterAST(mergeFilterNodes({ task_version: 'tv-1' }, AUTHORED_OR) as any)).toEqual({
      $and: [{ task_version: 'tv-1' }, WIRE_UNMOVED],
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Row sets — both directions, one fixture
// ---------------------------------------------------------------------------

describe('objectui#6948 — row sets through ValueDataSource', () => {
  it('the pre-fix node selected NOTHING — the control this repair is measured against', async () => {
    // Silently: `matchesComparisonNode` reads `$or` as a field, `record['$or']`
    // is undefined, no row equals the array. No throw, no console line.
    expect(await selectedIds(PRE_FIX_OR_NODE)).toEqual([]);
  });

  it('INCLUDES both branches of the union — not empty', async () => {
    expect(await selectedIds(convertFiltersToAST(AUTHORED_OR))).toEqual([
      'open-active',
      'blocked-idle',
    ]);
  });

  it('EXCLUDES the rows outside the union — not everything', async () => {
    const kept = await selectedIds(convertFiltersToAST(AUTHORED_OR));
    for (const excluded of ['done-active', 'null-status', 'no-status-key']) {
      expect(kept).not.toContain(excluded);
    }
  });

  it('so the answer is neither of the two failure shapes', async () => {
    const kept = await selectedIds(convertFiltersToAST(AUTHORED_OR));
    // A converter that emits nothing usable leaves `$filter` unread: every row.
    expect(kept).not.toEqual(ALL_IDS);
    // A converter that emits a node no evaluator reads: no row. That is the bug.
    expect(kept).not.toEqual([]);
    // And the fixture is not trivially the answer either way.
    expect(ALL_IDS.length).toBeGreaterThan(kept.length);
    expect(await selectedIds(undefined)).toEqual(ALL_IDS);
  });

  it('$and intersects, both directions', async () => {
    const node = convertFiltersToAST({ $and: [{ status: 'open' }, { is_active: true }] });
    expect(await selectedIds(node)).toEqual(['open-active']);
    expect(await selectedIds(node)).not.toEqual(ALL_IDS);
  });

  it('a parent scope still narrows a union it wraps', async () => {
    const scoped = mergeFilterNodes({ is_active: true }, AUTHORED_OR);
    // `blocked-idle` is in the union but fails the scope; `done-active` passes
    // the scope but is outside the union. Both directions in one assertion.
    expect(await selectedIds(scoped)).toEqual(['open-active']);
  });

  it('nested combinators evaluate as written', async () => {
    const node = convertFiltersToAST({
      $and: [{ $or: [{ status: 'open' }, { status: 'done' }] }, { is_active: true }],
    });
    expect(await selectedIds(node)).toEqual(['open-active', 'done-active']);
  });
});

// ---------------------------------------------------------------------------
// 4. The boolean identities (#5322) — the boundary of the new branch
// ---------------------------------------------------------------------------

describe('objectui#6948 — empty and vacuous combinators', () => {
  it('drops `$and: []` — the TRUE identity constrains nothing', async () => {
    // NOT `['and']`: measured, `isFilterAST(['and'])` is false and
    // `parseFilterAST(['and'])` is `undefined`, i.e. NO filter — every row. A
    // TRUE conjunct must disappear, never become an empty group.
    expect(isFilterAST(['and'])).toBe(false);
    expect(parseFilterAST(['and'] as any)).toBeUndefined();
    expect(convertFiltersToAST({ $and: [], status: 'open' })).toEqual(['status', '=', 'open']);
    expect(await selectedIds(convertFiltersToAST({ $and: [], status: 'open' }))).toEqual([
      'open-active',
    ]);
  });

  it('keeps the pre-existing leaf for `$or: []` — FALSE is not expressible', async () => {
    // The OR identity is FALSE (#5322) and the AST has no contradiction literal.
    // The leaf answers FALSE at BOTH consumers, which no group node does.
    const node = convertFiltersToAST({ $or: [] });
    expect(node).toEqual(['$or', '=', []]);
    expect(parseFilterAST(node)).toEqual({ $or: [] });
    expect(await selectedIds(node)).toEqual([]);
  });

  it('lets a `{}` disjunct absorb its `$or`, and drops it from an `$and`', () => {
    // #5322: `{}` is TRUE, so it absorbs an OR and vanishes from an AND. The
    // absorbed OR must not leave an object in AST child position — that makes
    // `isFilterAST` false for the whole filter.
    expect(convertFiltersToAST({ $and: [{}, { status: 'open' }] })).toEqual([
      'and',
      ['status', '=', 'open'],
    ]);
    const absorbed = convertFiltersToAST({ $or: [{}, { status: 'open' }], is_active: true });
    expect(absorbed).toEqual(['is_active', '=', true]);
  });
});

// ---------------------------------------------------------------------------
// 5. Refusals — envelope, not a bare throw
// ---------------------------------------------------------------------------

/** Assert the data-API refusal envelope (ADR-0112 / objectui#3066), not just that it threw. */
function expectRefusal(run: () => unknown, messageMatch: RegExp): void {
  expect(run).toThrow();
  try {
    run();
  } catch (e: any) {
    expect(e.code).toBe('INVALID_FILTER');
    expect(e.httpStatus).toBe(400);
    expect(String(e.message)).toMatch(messageMatch);
  }
}

describe('objectui#6948 — refusals', () => {
  it('refuses $not, naming the missing AST negation rather than a nonsense operator', () => {
    // Before this card the message read "Unknown filter operator 'status' for
    // field '$not'" — the author's own nested field name reported as an
    // operator. It threw then and it throws now; only the diagnostic moved.
    expectRefusal(
      () => convertFiltersToAST({ $not: { status: 'done' } }),
      /'\$not' filter combinator cannot be lowered/,
    );
    expect(() => convertFiltersToAST({ $not: { status: 'done' } })).not.toThrow(
      /Unknown filter operator 'status'/,
    );
  });

  it('refuses $not nested inside a combinator too', () => {
    expectRefusal(
      () => convertFiltersToAST({ $or: [{ status: 'open' }, { $not: { status: 'done' } }] }),
      /'\$not' filter combinator cannot be lowered/,
    );
  });

  it('refuses a combinator whose value is not an array', () => {
    expectRefusal(
      () => convertFiltersToAST({ $or: { status: 'open' } as any }),
      /'\$or' filter combinator takes an ARRAY/,
    );
  });

  it('refuses a non-object member', () => {
    expectRefusal(
      () => convertFiltersToAST({ $or: ['open' as any] }),
      /Every member of '\$or' must be a filter condition OBJECT/,
    );
  });

  it('runs the unknown-operator guard on combinator children, which used to escape it', () => {
    // Pre-fix the whole array travelled to the wire verbatim inside the leaf's
    // value slot, so a typo inside a `$or` branch was never checked here.
    expectRefusal(
      () => convertFiltersToAST({ $or: [{ status: { $bogus: 1 } as any }] }),
      /Unknown filter operator '\$bogus'/,
    );
    expectRefusal(
      () => convertFiltersToAST({ $or: [{ name: { $regex: 'a.c' } as any }] }),
      /\$regex/,
    );
  });
});
