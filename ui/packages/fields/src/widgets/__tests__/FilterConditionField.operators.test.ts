/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Operator spelling guard for the sharing-rule criteria builder (#2901).
 *
 * `condToMongo` emitted `$ncontains` — a token that appears nowhere in
 * `@objectstack/spec` and that objectui's own `convertFiltersToAST` throws on,
 * naming the correct spelling (`$notContains`) in its error message. So every
 * "does not contain" rule authored here validated in the UI and was then
 * rejected downstream. Nothing caught it because the builder's operator list is
 * hand-written and never compared against the spec vocabulary.
 *
 * These tests pin the emitted spellings against `FieldOperatorsSchema`'s keys
 * and pin the round-trip, including the pre-fix spelling that stored criteria
 * still carry.
 */
import { describe, it, expect } from 'vitest';
import { FieldOperatorsSchema, FILTER_OPERATORS } from '@objectstack/spec/data';
import { FILTER_BUILDER_OPERATORS, operatorsForFieldType } from '@object-ui/components';
import {
  condToMongo,
  kvToCondition,
  FILTER_CONDITION_EXTRA_OPERATORS,
} from '../FilterConditionField';

/**
 * The `$`-prefixed operator keys of the spec's `FieldOperatorsSchema` —
 * DERIVED from the schema (#2942), so a 16th operator landing in the spec
 * fails the reachability test below instead of drifting unnoticed.
 */
const SPEC_OPERATORS = new Set(
  Object.keys((FieldOperatorsSchema as unknown as { shape?: Record<string, unknown> }).shape ?? {}),
);

const noTypes = () => undefined;

/**
 * Spec `$`-tokens no builder operator emits, each for a stated reason.
 *
 * Module scope, and the ONE list — the ratchet below reads this same Set rather
 * than restating its members. Two copies is how an exclusion outlives its
 * reason: removing `$icontains` from a hand-repeated ratchet list is a separate
 * edit nothing forces, so the ratchet would have gone on vouching for an entry
 * the parity assertion no longer holds (objectui#4023).
 *
 * `$eq` is the spec's IMPLICIT equality form — `equals` deliberately emits the
 * bare `{ field: value }` shape, never an explicit `$eq`. `$between` stays
 * covered by the `$gte`+`$lte` pair `between` emits (kvToCondition reads that
 * pair back as `between`).
 *
 * `$icontains` was here from objectui#3560 until objectui#4023: the spec gained
 * it between @objectstack/spec 17.0.0-rc.2 and rc.5, and no builder operator
 * could author it. `icontains` (spelled `containsCaseInsensitive` until
 * objectui#9306) now does, so the entry is gone and the parity assertion below
 * is what holds that honest.
 *
 * `$like` and `$ilike` arrived with the `@objectstack/spec` 17.0.0 GA pin
 * (objectui#4636), and their entry here is a DECISION, not an open question:
 * objectui#4911, maintainer-ruled B on 2026-08-17 — this visual builder
 * deliberately does not offer raw pattern-matching authoring. The constrained
 * intents are the authorable surface and already reach the dropdown (`contains`
 * / `icontains` / `starts_with` / `ends_with`), so what a `$like`
 * row would add on top of them is exactly the raw `%`/`_` wildcard form — the
 * one operator where a mis-authored value silently returns the wrong rows
 * instead of erroring, which is an error bed in an end-user filter UI, and for
 * zero measured author pull.
 *
 * This is a BUILDER-surface refusal, not a capability removal: the API surface
 * is unaffected and `FieldOperatorsSchema` goes on accepting both operators for
 * hand-written ObjectQL, direct JSON authors and integrations. That is what
 * makes the exclusion honest rather than a gap papered over — the tokens stay
 * reachable, just not from this dropdown.
 *
 * Reopen condition, named by the ruling: a real user or deployment asks to
 * author wildcard patterns in the UI. If that happens, reopen objectui#4911,
 * delete these two members and add the builder operators that author them; the
 * parity assertion below then holds that honest, exactly as it did when
 * objectui#4023 retired `$icontains`.
 *
 * Nothing mechanical can hold that condition for you — the ratchet below checks
 * only that a member is still a spec operator, never that its reason is still
 * the true one. A refusal that outlives its rationale is the stale-exclusion rot
 * this comment block warns about one level up, and a reader is what catches it,
 * not a run.
 */
/*
 * `$empty` was here from `@objectstack/spec` 17.5.0 (objectui#11073) until
 * objectui#10813, and its two reasons expired in turn:
 *
 *   1. STAGED — declared, absent from `FILTER_OPERATORS`, refused by every
 *      query executor, so a row emitting it would have authored a filter
 *      nothing could run. Expired on `@objectstack/spec` 17.6.0
 *      (objectstack#20446), which admitted it and lowers `is_empty` /
 *      `is_not_empty` to it; the first expiry row below holds that.
 *   2. No builder row authored it — this widget's `is_empty` wrote "no value OR
 *      `''`" on every field type (objectui#10790), one of the three meanings of
 *      「is empty」. Expired with objectui#10813, which moved the pair onto
 *      `$empty`; the second expiry row below holds that, and the sweep above it
 *      now holds the token to the spec like every other.
 */
const KNOWN_UNREACHABLE = new Set(['$eq', '$between', '$like', '$ilike']);

/**
 * Pull the operator keys out of a `{ field: { $op: v } }` fragment — descending
 * into a `$or` / `$and` entry, so a row stored as a combinator (as "is empty"
 * was from objectui#10790 until objectui#10813) has its inner operators judged
 * like every other row's.
 */
function operatorsOf(frag: Record<string, any> | null): string[] {
  if (!frag) return [];
  return Object.entries(frag).flatMap(([key, v]) =>
    (key === '$or' || key === '$and') && Array.isArray(v)
      ? v.flatMap((child) => operatorsOf(child))
      : v !== null && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : [],
  );
}

describe('condToMongo emits only spec operator spellings', () => {
  const builderOperators = [
    'equals', 'not_equals', 'contains', 'icontains', 'not_contains',
    'is_empty', 'is_not_empty',
    'greater_than', 'less_than', 'greater_than_or_equal', 'less_than_or_equal', 'in', 'not_in',
    'before', 'after',
    'starts_with', 'ends_with', 'is_null', 'is_not_null', 'exists', 'notExists',
  ];

  it.each(builderOperators)('%s emits a spec-defined operator', (operator) => {
    const frag = condToMongo(
      { id: 'c1', field: 'name', operator, value: operator === 'in' || operator === 'not_in' ? ['a'] : 'a' } as any,
      noTypes,
    );
    const unknown = operatorsOf(frag).filter((op) => !SPEC_OPERATORS.has(op));
    expect(unknown, `${operator} emits an operator @objectstack/spec does not define`).toEqual([]);
  });

  it('icontains emits $icontains, and contains still emits $contains', () => {
    // The pair, in one assertion: objectui#4023's recorded default is a NEW
    // operator, so `contains` keeping its case-SENSITIVE spelling is half of
    // what shipped. Flipping it would silently change every stored filter view.
    expect(
      condToMongo({ id: 'c1', field: 'name', operator: 'icontains', value: 'acme' } as any, noTypes),
    ).toEqual({ name: { $icontains: 'acme' } });
    expect(
      condToMongo({ id: 'c2', field: 'name', operator: 'contains', value: 'acme' } as any, noTypes),
    ).toEqual({ name: { $contains: 'acme' } });
  });

  it('not_contains emits $notContains, not the pre-fix $ncontains', () => {
    const frag = condToMongo({ id: 'c1', field: 'name', operator: 'not_contains', value: 'x' } as any, noTypes);
    expect(frag).toEqual({ name: { $notContains: 'x' } });
  });

  it('between emits a range the spec defines', () => {
    const frag = condToMongo({ id: 'c1', field: 'age', operator: 'between', value: [1, 5] } as any, noTypes);
    expect(operatorsOf(frag).every((op) => SPEC_OPERATORS.has(op))).toBe(true);
  });
});

describe('every spec field operator is reachable from the builder (#2942)', () => {
  it('reads a non-empty operator vocabulary from the spec', () => {
    expect([...SPEC_OPERATORS].length, 'could not read FieldOperatorsSchema.shape').toBeGreaterThan(0);
  });

  it('some builder operator emits every spec $-token', () => {
    // Every id the dropdown can draw, opt-in ones included — DERIVED, so a
    // builder operator that `condToMongo` forgot cannot quietly leave this
    // sweep and take a spec token's only route to the UI with it.
    const emitted = new Set<string>();
    for (const operator of FILTER_BUILDER_OPERATORS) {
      const value = operator === 'in' || operator === 'not_in' ? ['a'] : operator === 'between' ? [1, 5] : 'a';
      const frag = condToMongo({ id: 'c1', field: 'f', operator, value } as any, noTypes);
      for (const op of operatorsOf(frag)) emitted.add(op);
    }
    const unreachable = [...SPEC_OPERATORS].filter(
      (op) => !KNOWN_UNREACHABLE.has(op) && !emitted.has(op),
    );
    expect(
      unreachable,
      'FieldOperatorsSchema accepts these but no builder operator can author them',
    ).toEqual([]);
  });

  it('the staged `$empty` exclusion expired: FILTER_OPERATORS admits it', () => {
    // The objectui#11073 expiry row, flipped. It read "not in" and reddened on
    // `@objectstack/spec` 17.6.0 (objectstack#20446). Lit control: a flag
    // operator that was always in the list.
    expect(FILTER_OPERATORS as readonly string[]).toContain('$empty');
    expect(FILTER_OPERATORS as readonly string[]).toContain('$null');
  });

  it('the `$empty` exclusion expired: a builder operator emits it (objectui#10813)', () => {
    // The objectui#11094 expiry row, flipped. It read "no drawable builder id
    // writes `$empty`" and reddened when objectui#10813 moved the empty pair
    // onto it, which is why `$empty` left KNOWN_UNREACHABLE. Derived from the
    // same drawable vocabulary the sweep feeds `condToMongo`, and the pair is
    // named so the row says WHICH operators author it.
    const emitted = new Set<string>();
    for (const operator of FILTER_BUILDER_OPERATORS) {
      const value = operator === 'in' || operator === 'not_in' ? ['a'] : operator === 'between' ? [1, 5] : 'a';
      const frag = condToMongo({ id: 'c1', field: 'f', operator, value }, noTypes);
      for (const op of operatorsOf(frag)) emitted.add(op);
    }
    // Lit control: the sweep really reads emitted operators.
    expect(emitted.has('$null')).toBe(true);
    expect(emitted.has('$empty')).toBe(true);
    expect(FILTER_BUILDER_OPERATORS).toContain('is_empty');
    expect(FILTER_BUILDER_OPERATORS).toContain('is_not_empty');
    expect(operatorsOf(condToMongo({ id: 'c1', field: 'f', operator: 'is_empty', value: '' }, noTypes)))
      .toEqual(['$empty']);
    expect(operatorsOf(condToMongo({ id: 'c1', field: 'f', operator: 'is_not_empty', value: '' }, noTypes)))
      .toEqual(['$empty']);
  });

  it('every KNOWN_UNREACHABLE token is still a spec operator (the exclusion ratchet)', () => {
    // A stale exclusion is how a parity test rots into a tautology: if the spec
    // ever drops one of these, the entry must go too rather than sit there
    // excusing a token nobody ships. `$eq` / `$between` are real
    // `FieldOperatorsSchema` keys today.
    for (const op of KNOWN_UNREACHABLE) {
      expect(SPEC_OPERATORS.has(op), `'${op}' is excluded but no longer a spec operator`).toBe(
        true,
      );
    }
  });

  /**
   * Emitting the token is only half of "reachable from the filter UI" — the
   * other half is a dropdown row an admin can actually click. `condToMongo`
   * answers to any string it is handed, so a spec token whose only builder
   * operator was never added to the vocabulary would pass the sweep above and
   * still be unauthorable, which is precisely the state objectui#4023 found.
   */
  it('the $icontains operator is one the builder can draw, and this widget offers it', () => {
    expect(FILTER_BUILDER_OPERATORS).toContain('icontains');
    // Every opt-in this widget asks for must be an id the dropdown knows;
    // a typo here is a row that never renders and never fails anything else.
    for (const id of FILTER_CONDITION_EXTRA_OPERATORS) {
      expect(FILTER_BUILDER_OPERATORS, `${id} is not a FilterBuilder operator id`).toContain(id);
    }
    // It reaches a text field's dropdown with this widget's grants — and since
    // objectui#9306 without them too: `icontains` left `OPT_IN_OPERATORS`, so
    // this widget no longer has to name it, and does not.
    const offered = operatorsForFieldType('text', FILTER_CONDITION_EXTRA_OPERATORS).map((o) => o.value);
    expect(offered).toContain('icontains');
    expect(offered).toContain('contains');
    expect(FILTER_CONDITION_EXTRA_OPERATORS).not.toContain('icontains');
    expect(operatorsForFieldType('text').map((o) => o.value)).toContain('icontains');
  });

  /**
   * The same half for `$exists` (objectui#4736). The pair became opt-in when the
   * list and view surfaces — whose dialects have no existence operator — were
   * found offering it, so THIS widget naming it is now the only thing keeping
   * `$exists` authorable at all.
   *
   * The sweep above cannot notice if that opt-in is dropped: it feeds
   * `FILTER_BUILDER_OPERATORS` (every DRAWABLE id) straight to `condToMongo`,
   * which answers to any string it is handed, so `$exists` would still count as
   * emitted while no admin could click a row that emits it — exactly the state
   * objectui#4023 found for `$icontains`.
   */
  it('the $exists operator is one this widget still offers, post-withdrawal', () => {
    expect(SPEC_OPERATORS.has('$exists'), '$exists is no longer a spec operator').toBe(true);
    expect(FILTER_BUILDER_OPERATORS).toContain('exists');
    expect(FILTER_BUILDER_OPERATORS).toContain('notExists');
    expect(FILTER_CONDITION_EXTRA_OPERATORS).toContain('exists');
    expect(FILTER_CONDITION_EXTRA_OPERATORS).toContain('notExists');

    for (const type of ['text', 'number', 'date', 'select', 'lookup']) {
      const offered = operatorsForFieldType(type, FILTER_CONDITION_EXTRA_OPERATORS)
        .map((o) => o.value);
      expect(offered, `${type} lost the existence pair`).toContain('exists');
      expect(offered, `${type} lost the existence pair`).toContain('notExists');
      // Distinct rows from the null predicates, which author `$null`. The two
      // are different spec operators and `condToMongo` keeps them apart (and
      // objectui#9559 ruling B keeps them unfolded).
      expect(offered, type).toContain('is_null');
      expect(offered, type).toContain('is_not_null');
    }
  });
});

describe('kvToCondition round-trips what condToMongo writes', () => {
  const cases: Array<[string, unknown]> = [
    ['not_equals', 'a'],
    ['contains', 'a'],
    // objectui#4023 deliverable 2: a saved filter view must not degrade on
    // reopen. Without the `$icontains` arm in kvToCondition, criteria this very
    // builder wrote comes back "not representable" and forces the JSON editor.
    ['icontains', 'a'],
    ['not_contains', 'a'],
    ['greater_than', 1],
    ['less_than', 1],
    ['greater_than_or_equal', 1],
    ['less_than_or_equal', 1],
    ['starts_with', 'a'],
    ['ends_with', 'a'],
    ['is_null', ''],
    ['is_not_null', ''],
    ['exists', ''],
    ['notExists', ''],
    // objectui#10813: the pair is a field key again (`$empty`), so it rides the
    // same per-field round trip as every other row.
    ['is_empty', ''],
    ['is_not_empty', ''],
  ];

  it.each(cases)('%s survives the round trip', (operator, value) => {
    const frag = condToMongo({ id: 'c1', field: 'f', operator, value } as any, noTypes)!;
    const [[field, v]] = Object.entries(frag);
    expect(kvToCondition(field, v, 0)).toMatchObject({ field: 'f', operator });
  });

  it('still reads the pre-fix $ncontains so stored criteria keep loading', () => {
    // Dropping this would make rules saved before the fix fail to load entirely
    // ("criteria can't be represented") rather than migrate.
    expect(kvToCondition('name', { $ncontains: 'x' }, 0)).toMatchObject({
      field: 'name',
      operator: 'not_contains',
      value: 'x',
    });
  });

  it('rejects an operator it cannot represent rather than guessing', () => {
    expect(kvToCondition('name', { $nope: 'x' }, 0)).toBeNull();
  });

  it('reads `$empty` only with a boolean flag — any other flag is a criteria it cannot represent', () => {
    // `$empty` is declared `z.boolean()` and every evaluator refuses another
    // flag; opened as a row, the next save would make it runnable.
    expect(kvToCondition('name', { $empty: true }, 0)).toMatchObject({ operator: 'is_empty' });
    expect(kvToCondition('name', { $empty: false }, 0)).toMatchObject({ operator: 'is_not_empty' });
    for (const flag of ['yes', 1, null, 'true']) {
      expect(kvToCondition('name', { $empty: flag }, 0), JSON.stringify(flag)).toBeNull();
    }
  });
});

/**
 * objectui#8748 — the producer half of the empty-comparand fix.
 *
 * `condToMongo` emitted `{ [field]: { $icontains: value } }` verbatim, and the
 * only drop on this path was the missing-FIELD guard (`filterGroupToMongo`
 * discards null fragments and nothing else). So a builder row with the operator
 * chosen and the value box still empty authored `{ name: { $icontains: '' } }`
 * — the exact shape `@objectstack/spec`'s `FILTER_TEXT_CASES` carries as a
 * REJECTION row, and the shape `ValueDataSource` now refuses in the same
 * change.
 *
 * ⚠️ This half is what makes that refusal safe, and it is why the two land
 * together. Refusing in the matcher alone would flip a half-built builder row
 * from "every row" to "no rows" — the outcome `ValueDataSource`'s own `$exists`
 * arm names as the one worse than the bug.
 */
describe('objectui#8748 — an unfinished text row is dropped, not emitted', () => {
  const emptyValues: Array<[string, unknown]> = [
    ['never typed in', undefined],
    ['cleared back out', ''],
    ['null', null],
  ];
  const textOperators = ['contains', 'icontains', 'not_contains', 'starts_with', 'ends_with'];

  for (const operator of textOperators) {
    it.each(emptyValues)(`${operator} with an empty comparand (%s) emits nothing`, (_label, value) => {
      expect(
        condToMongo({ id: 'c1', field: 'name', operator, value } as any, noTypes),
        `${operator} still authors the shape FILTER_TEXT_CASES refuses`,
      ).toBeNull();
    });
  }

  it('a NON-empty comparand still emits — the live control for the drop', () => {
    // Green before this card and after it. Without it a `return null` for every
    // text row would satisfy every case above and silently delete the operators.
    expect(
      condToMongo({ id: 'c1', field: 'name', operator: 'icontains', value: 'acme' } as any, noTypes),
    ).toEqual({ name: { $icontains: 'acme' } });
    expect(
      condToMongo({ id: 'c2', field: 'name', operator: 'contains', value: 'a' } as any, noTypes),
    ).toEqual({ name: { $contains: 'a' } });
  });

  it('the value-less operators keep emitting on an empty box — they read no comparand', () => {
    // `is_null` / `exists` / `is_empty` and their negations resolve from the
    // operator NAME; an empty value box is their resting state, not an
    // unfinished row, so the drop must not reach them.
    expect(condToMongo({ id: 'c1', field: 'name', operator: 'is_null', value: '' } as any, noTypes))
      .toEqual({ name: { $null: true } });
    expect(condToMongo({ id: 'c2', field: 'name', operator: 'exists', value: '' } as any, noTypes))
      .toEqual({ name: { $exists: true } });
    expect(condToMongo({ id: 'c3', field: 'name', operator: 'notExists', value: '' } as any, noTypes))
      .toEqual({ name: { $exists: false } });
    // objectui#10813: the spec's `$empty` (pinned per column type in
    // `FilterConditionField.emptyOperators-10790.test.tsx`).
    expect(condToMongo({ id: 'c4', field: 'name', operator: 'is_empty', value: '' } as any, noTypes))
      .toEqual({ name: { $empty: true } });
    expect(condToMongo({ id: 'c5', field: 'name', operator: 'is_not_empty', value: '' } as any, noTypes))
      .toEqual({ name: { $empty: false } });
  });

  it('equals with an empty comparand still emits — it is a real predicate', () => {
    // `name == ""` selects the rows whose value IS the empty string. Only the
    // TEXT operators have an "operator chosen, box empty" state that means
    // nothing; equality does not, so the drop is scoped away from it.
    expect(condToMongo({ id: 'c1', field: 'name', operator: 'equals', value: '' } as any, noTypes))
      .toEqual({ name: '' });
  });
});
