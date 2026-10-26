/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * `convertFilterGroupToAST` reads the operator through the same fold the rest
 * of the predicate already uses, so ONE value-less operator emits ONE node
 * whichever spelling the stored row carries (objectui#9359).
 *
 * ## The defect, in one sentence
 *
 * The two halves of one predicate spoke different vocabularies. The value-less
 * short-circuit did a raw `has()` against `VALUELESS_FILTER_BUILDER_OPERATORS`
 * — six camelCase dropdown ids — while the completeness test it falls through
 * to (`isFilterValueComplete`) DOES fold, through the spec's
 * `normalizeFilterOperator`, to decide arity. So a row spelled `is_null` — the
 * spec's canonical form, which is exactly what `foldFilterGroupToSpecRules`
 * persists into a saved view — missed the short-circuit, landed on `scalar`,
 * had its `value: ''` read as an unfinished row, and was DROPPED. The function
 * then returned `[]`: no filter at all. The live grid returned every record
 * while the panel showed a filter applied. Nothing errored.
 *
 * This is the same failure the exported set was created to prevent, recorded
 * verbatim in its own docblock — *"the live-grid copy listed only
 * `isEmpty`/`isNotEmpty` … the grid read that as an unfinished row, dropped it,
 * and applied NO filter at all while the panel showed one. Silent, and every
 * record came back."* objectui#4744 repaired it for the dropdown's spellings
 * and left the canonical ones on the old path.
 *
 * ## What the repair deliberately does NOT do (the ruling on objectui#9302,
 * which this card is covered by)
 *
 *   - ⛔ the EXPORTED set is not widened. Its stated job is *which rows the
 *     builder leaves value-less* — a fact about that dropdown's own six ids —
 *     and `app-shell`'s `foldFilterGroupToSpecRules` documents its own
 *     `VALUELESS_FILTER_OPERATORS` as that set PLUS the canonical spellings
 *     only that layer sees. Widening the export would make another layer's
 *     deliberate compensation redundant by SIDE EFFECT, in a file nobody is
 *     editing. Pinned below, and pinned identically by the sibling repair in
 *     `packages/components`.
 *   - ⛔ no row's stored `operator` is rewritten. This function converts; it
 *     does not migrate.
 *   - ⛔ no second spelling joins the toolbar's dropdown.
 *
 * ⛔ Out of scope and untouched: WHICH operator vocabulary wins (decision card
 * objectui#9306). This is a defect at one reader regardless of how that lands.
 *
 * ⛔ And the fold does not cross the `contains` / `icontains` boundary —
 * objectui#7379 holds that is "a semantic boundary, not two spellings of one
 * thing", and `VIEW_FILTER_OPERATOR_ALIASES` has no row for either. Pinned by
 * the boundary guard at the bottom.
 *
 * ## DIRECTION, predicted before the first run
 *
 * On the unmodified tree the four CANONICAL rows (`is_null`, `is_not_null`,
 * `is_empty`, `is_not_empty`) are RED — each emits `[]` where a real node is
 * required. Everything else is GREEN in both directions and is carried for a
 * named reason rather than for coverage:
 *
 *   - the six DROPDOWN ids emit their node today and must keep emitting the
 *     SAME node — the over-reach guard. A repair that folded only one
 *     direction, or that replaced the set's members with canonical spellings,
 *     moves these;
 *   - `equals` with a value is the FIRING CONTROL, in the same run. Without it
 *     "every row emits something" and "the converter is dead" read alike;
 *   - `exists` / `notExists` have no canonical twin — the spec's vocabulary has
 *     no existence operator and its alias table deliberately has no row for
 *     one — so the fold returns them verbatim. They pin that routing the
 *     lookup through a fold did not drop the two members with nothing to fold
 *     to. (They are `OPT_IN_OPERATORS` and this toolbar offers neither; the
 *     emission is unreachable in the product and pinned here so a future
 *     decision to offer them lands as a red test, exactly as
 *     `convertFilterGroupToAST.test.ts` already pins it.)
 *
 * ## After objectui#9306
 *
 * The builder's ids — and so the exported set's members — are the canonical
 * spellings now, and its former camelCase ids are the deprecated alias form a
 * stored filter (or a per-user cached panel group) may still carry. This
 * reader is unchanged: it folds before the lookup, so the table reads the same
 * nodes. Only the roles swapped — the canonical rows are the dropdown's own
 * ids, and the camelCase rows are the spellings that reach the set only
 * through the fold, i.e. the firing cases. The rows are relabelled to say so.
 */
import { describe, it, expect } from 'vitest';
import { normalizeFilterOperator } from '@objectstack/spec/ui';
import { isFilterAST } from '@objectstack/spec/data';
import { VALUELESS_FILTER_BUILDER_OPERATORS } from '@object-ui/components';
import type { FilterBuilderRowGroup } from '@object-ui/components';
import { convertFilterGroupToAST } from '../ListView';

/**
 * One row, in the state the panel actually holds: `addCondition` seeds
 * `{ operator: 'equals', value: '' }` and the operator dropdown updates
 * `operator` ALONE, so a value-less row keeps the `''` seed. A stored view
 * folded by `foldFilterGroupToSpecRules` carries no `value` key at all for
 * these operators, so both shapes are swept below.
 */
const emit = (operator: string, value: unknown = '') =>
  convertFilterGroupToAST({
    id: 'root',
    logic: 'and',
    conditions: [{ id: 'c1', field: 'title', operator, value }],
  } as unknown as FilterBuilderRowGroup);

/**
 * The card's measurement table, turned into a pin.
 *
 * `dialect` is load-bearing for reading a failure, not decoration:
 *   - `dropdown` — one of the builder's own ids, i.e. a literal member of the
 *     exported set: `@objectstack/spec`'s canonical spelling, which is also
 *     what a saved view stores (objectui#9306). Emits its node: over-reach
 *     guard;
 *   - `deprecated` — the builder's former camelCase id for the SAME operator,
 *     which a filter stored before objectui#9306 carries. Not a member, so it
 *     reaches the set only through the fold: the firing cases (the canonical
 *     spelling played this part when objectui#9359 was measured);
 *   - `control` — really does take a value, and has one.
 */
const ROWS: ReadonlyArray<{
  operator: string;
  value?: unknown;
  emitted: unknown[];
  dialect: 'dropdown' | 'deprecated' | 'control';
}> = [
  { operator: 'isNull', emitted: ['title', 'isnull', null], dialect: 'deprecated' },
  { operator: 'is_null', emitted: ['title', 'isnull', null], dialect: 'dropdown' },
  { operator: 'isNotNull', emitted: ['title', 'isnotnull', null], dialect: 'deprecated' },
  { operator: 'is_not_null', emitted: ['title', 'isnotnull', null], dialect: 'dropdown' },
  // The empty pair, on the spec's `isempty` / `isnotempty` since
  // objectui#10813 (lowered to `$empty`). It was resolved to a null comparison
  // (`'=' | '!=', null`) before `mapOperator` was consulted; both spellings
  // must still land on ONE node, now through `mapOperator`'s fold.
  { operator: 'isEmpty', emitted: ['title', 'isempty', null], dialect: 'deprecated' },
  { operator: 'is_empty', emitted: ['title', 'isempty', null], dialect: 'dropdown' },
  { operator: 'isNotEmpty', emitted: ['title', 'isnotempty', null], dialect: 'deprecated' },
  { operator: 'is_not_empty', emitted: ['title', 'isnotempty', null], dialect: 'dropdown' },
  // No canonical twin exists for these two.
  { operator: 'exists', emitted: ['title', 'exists', null], dialect: 'dropdown' },
  { operator: 'notExists', emitted: ['title', 'notExists', null], dialect: 'dropdown' },
  // THE FIRING CONTROL, in the same run as the rest.
  { operator: 'equals', value: 'acme', emitted: ['title', '=', 'acme'], dialect: 'control' },
];

describe('objectui#9359 — one operator, one emitted node, whichever spelling it arrives in', () => {
  it.each(ROWS)('$dialect `$operator` emits $emitted', ({ operator, value, emitted }) => {
    expect(
      emit(operator, value ?? ''),
      `a "${operator}" row emitted nothing or the wrong node, so the live grid queries `
        + 'without it: the panel shows a filter applied and every record comes back',
    ).toEqual(emitted);
  });

  it.each(ROWS.filter((r) => r.dialect === 'deprecated'))(
    'deprecated `$operator` emits the SAME node as its dropdown twin',
    ({ operator, emitted }) => {
      // The acceptance criterion stated directly: two spellings of one operator
      // are one filter. Asserted against the twin's own live emission rather
      // than against the literal above, so the two can never drift apart in
      // this file while agreeing in the product (or the reverse).
      const twin = ROWS.find((r) => r.dialect === 'dropdown' && r.emitted[1] === emitted[1]);
      expect(twin, `no dropdown twin listed for ${operator}`).toBeDefined();
      expect(emit(operator)).toEqual(emit(twin!.operator));
    },
  );

  it.each(['is_null', 'is_not_null', 'is_empty', 'is_not_empty'])(
    'a stored `%s` rule with NO value key at all is still a filter',
    (operator) => {
      // What `foldFilterGroupToSpecRules` actually persists: it writes `value`
      // only when the operator takes one, so the rule read back from storage
      // has no `value` property. `undefined` is the other shape the same row
      // reaches this function in, and it must not be read as unfinished either.
      const node = convertFilterGroupToAST({
        id: 'root',
        logic: 'and',
        conditions: [{ id: 'c1', field: 'title', operator }],
      } as unknown as FilterBuilderRowGroup);
      expect(node.length, `a stored "${operator}" rule emitted nothing`).toBeGreaterThan(0);
    },
  );

  it.each(['is_null', 'is_not_null', 'is_empty', 'is_not_empty', 'isNull', 'isEmpty'])(
    '`%s` survives isFilterAST, the gate that decides if the filter is parsed at all',
    (operator) => {
      // A non-empty node the AST gate rejects is no better than `[]` — worse,
      // since driver-sql drops the whole filter without erroring. Emitting a
      // node is only half the repair.
      const node = emit(operator);
      expect(node.length, `${operator} emitted no node`).toBeGreaterThan(0);
      expect(
        isFilterAST(node),
        `${JSON.stringify(node)} is rejected by isFilterAST(); the filter reaches the wire `
          + 'in a spelling the server will not compile',
      ).toBe(true);
    },
  );

  it('emits the same node whatever stale value a canonical row still carries', () => {
    // The operator dropdown preserves `value`, so a row stored as `is_null` can
    // hold text typed under the previous operator — invisible, because no value
    // input is drawn. The emission must be a function of the operator alone.
    expect(emit('is_null', 'typed under equals')).toEqual(['title', 'isnull', null]);
  });

  it('keeps a canonical value-less row alongside a complete one', () => {
    const both = convertFilterGroupToAST({
      id: 'root',
      logic: 'and',
      conditions: [
        { id: 'c1', field: 'stage', operator: 'equals', value: 'won' },
        { id: 'c2', field: 'closed_at', operator: 'is_null', value: '' },
      ],
    } as unknown as FilterBuilderRowGroup);
    expect(both).toEqual(['and', ['stage', '=', 'won'], ['closed_at', 'isnull', null]]);
    expect(isFilterAST(both)).toBe(true);
  });
});

describe('objectui#9359 — the instrument can actually fire', () => {
  it('every firing case is outside the exported set and folds onto a member', () => {
    // The instrument standard. A table built only on spellings the raw `has()`
    // already matched would be green before ANY repair and would measure
    // nothing at all. Since objectui#9306 the firing cases are the deprecated
    // camelCase rows.
    const canonical = ROWS.filter((r) => r.dialect === 'deprecated');
    expect(canonical.length).toBeGreaterThanOrEqual(4);
    const foldedMembers = new Set(
      [...VALUELESS_FILTER_BUILDER_OPERATORS].map((op) => String(normalizeFilterOperator(op))),
    );
    for (const row of canonical) {
      // Not a literal member — so the raw lookup could not have matched it…
      expect(VALUELESS_FILTER_BUILDER_OPERATORS.has(row.operator)).toBe(false);
      // …and it folds ONTO a member, which is what makes the repair reach it.
      expect(foldedMembers.has(String(normalizeFilterOperator(row.operator)))).toBe(true);
    }
    // …and the control is in neither, which is why it keeps needing a value.
    expect(VALUELESS_FILTER_BUILDER_OPERATORS.has('equals')).toBe(false);
    expect(normalizeFilterOperator('equals')).toBe('equals');
  });

  it('the fold adds no members — it only re-keys the six', () => {
    // `exists` / `notExists` fold to themselves, so the derived set is the same
    // SIZE as the one it derives from. A fold that collapsed two members onto
    // one would silently shrink the set the gate consults.
    const folded = new Set(
      [...VALUELESS_FILTER_BUILDER_OPERATORS].map((op) => String(normalizeFilterOperator(op))),
    );
    expect(folded.size).toBe(VALUELESS_FILTER_BUILDER_OPERATORS.size);
  });
});

describe('objectui#9359 — ⛔ the repair moves nothing but this reader', () => {
  it('the EXPORTED set keeps its dropdown-only membership', () => {
    // Acceptance criterion 4: the set states the dropdown's own ids, one per
    // operator, and is not widened with other spellings — readers fold instead.
    // Since objectui#9306 those ids are the canonical spellings; the deprecated
    // camelCase ids are NOT members. It fails for a repair that widened the
    // export instead of folding at the reader.
    expect([...VALUELESS_FILTER_BUILDER_OPERATORS].sort()).toEqual([
      'exists',
      'is_empty',
      'is_not_empty',
      'is_not_null',
      'is_null',
      'notExists',
    ]);
  });

  it('an operator nothing knows still needs a value', () => {
    // The default must stay "takes a value". A fold that swallowed unknown
    // spellings into the value-less set would emit a filter for a row the user
    // never finished — the objectui#4744 failure, inverted.
    expect(normalizeFilterOperator('totally_unknown')).toBe('totally_unknown');
    expect(emit('totally_unknown', '')).toEqual([]);
    expect(emit('totally_unknown', 'v')).toEqual(['title', 'totally_unknown', 'v']);
  });

  it('a value-taking row with no value is still dropped, in both vocabularies', () => {
    // The other half of the same gate: folding must not make every row look
    // finished. `not_in` is the canonical spelling of a value-taking operator.
    expect(emit('equals', '')).toEqual([]);
    expect(emit('not_in', [])).toEqual([]);
    expect(emit('between', ['2024-01-01', ''])).toEqual([]);
  });
});

describe('objectui#9359 — ⛔ the fold does not cross the `contains` boundary', () => {
  it('`contains` and `icontains` are not folded onto each other', () => {
    // objectui#7379: these "must never be folded onto" each other — "That is a
    // semantic boundary, not two spellings of one thing."
    // `VIEW_FILTER_OPERATOR_ALIASES` has no row for either. This reader now
    // routes a lookup through that fold, so pin that the boundary still stands.
    // A seat that folds those two has broken a ruling, not fixed a bug. Green
    // in both directions by construction — a boundary guard, not a control.
    expect(normalizeFilterOperator('contains')).toBe('contains');
    expect(normalizeFilterOperator('icontains')).toBe('icontains');
    expect(normalizeFilterOperator('contains')).not.toBe(normalizeFilterOperator('icontains'));
    // …and neither is value-less under either spelling, so the gate this card
    // repairs never had an opinion about them.
    const folded = new Set(
      [...VALUELESS_FILTER_BUILDER_OPERATORS].map((op) => String(normalizeFilterOperator(op))),
    );
    for (const op of ['contains', 'icontains', 'containsCaseInsensitive']) {
      expect(VALUELESS_FILTER_BUILDER_OPERATORS.has(op)).toBe(false);
      expect(folded.has(String(normalizeFilterOperator(op)))).toBe(false);
    }
    // And they still reach the wire as distinct AST operators from this reader.
    expect(emit('contains', 'ac')).toEqual(['title', 'contains', 'ac']);
    expect(emit('icontains', 'ac')).toEqual(['title', 'icontains', 'ac']);
  });
});

/**
 * The live grid's leg of objectui#9306's 22-id census (the other consumers'
 * legs are `filter-builder-protocol-ids-census-9306.test.ts` in app-shell).
 *
 * The builder's ids moved from camelCase to the protocol's spellings. This
 * reader was already spelling-agnostic — `mapOperator` matches case- and
 * underscore-insensitively and the value-less check folds — so the claim here
 * is that the move changed NOTHING it queries: every former id and the id it
 * became emit the same node. `containsCaseInsensitive` is the one exception,
 * and it is not a regression: the list toolbar never offered it, and neither
 * `mapOperator` nor the spec's alias table knows that spelling; the builder
 * folds it onto `icontains` at its own read boundary before a row gets here.
 */
describe('objectui#9306 — the live grid emits the same node for every former id and its protocol id', () => {
  const CENSUS: ReadonlyArray<readonly [string, string, unknown]> = [
    ['equals', 'equals', 'x'], ['notEquals', 'not_equals', 'x'], ['contains', 'contains', 'x'],
    ['notContains', 'not_contains', 'x'], ['isEmpty', 'is_empty', ''], ['isNotEmpty', 'is_not_empty', ''],
    ['greaterThan', 'greater_than', 5], ['lessThan', 'less_than', 5],
    ['greaterOrEqual', 'greater_than_or_equal', 5], ['lessOrEqual', 'less_than_or_equal', 5],
    ['before', 'before', '2026-01-01'], ['after', 'after', '2026-01-01'], ['between', 'between', [1, 5]],
    ['in', 'in', ['a', 'b']], ['notIn', 'not_in', ['a', 'b']],
    ['startsWith', 'starts_with', 'x'], ['endsWith', 'ends_with', 'x'],
    ['isNull', 'is_null', ''], ['isNotNull', 'is_not_null', ''],
    ['exists', 'exists', ''], ['notExists', 'notExists', ''],
  ];

  it.each(CENSUS)('`%s` and `%s` emit one node', (legacy, id, value) => {
    const node = emit(id, value);
    expect(node.length, `${id} emitted nothing`).toBeGreaterThan(0);
    expect(emit(legacy, value)).toEqual(node);
  });

  it('`icontains` reaches the wire as its own AST operator', () => {
    expect(emit('icontains', 'x')).toEqual(['title', 'icontains', 'x']);
    expect(isFilterAST(emit('icontains', 'x'))).toBe(true);
  });
});
